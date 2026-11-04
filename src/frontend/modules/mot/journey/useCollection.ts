'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { User } from '@core/types';
import {
  saveDraft,
  getDraft,
  enqueueMotCollection,
  cacheMotShopPolicy,
  getCachedMotShopPolicy,
  cacheAvailableSources,
  getCachedAvailableSources,
  type CachedAvailableSource,
} from '../offlineStore';
import { computeCanonicalMilkMetrics } from '@/backend/utils/milkFormulas';
import { useServerDraft } from '@/frontend/hooks/useServerDraft';
import { applyMotDraft, motDraftFromForm } from '@/lib/mot-draft';
import { getErrorMessage } from '@/lib/errors';
import { acquireRobustGps } from '@/lib/gps';
import type { TrackedPoint } from '@/lib/gpsTracker';
import type { MotTestPhoto, MotTestValue } from '../MotShopTestsStep';
import type { DecisionRuleTestRow } from '@/frontend/modules/shared/decision/DecisionRulePanel';
import { canDecideMotException } from '@/frontend/modules/zmcc/stage1Capabilities';
import { buildMotShopDecision } from '@/backend/services/mot/motShopDecision';
import { evaluateGeofence, DEFAULT_SHOP_GEOFENCE_M } from '@/backend/services/mot/geofence';
import { saveCapturedPhoto } from '@/lib/offline/photoStore';
import { buildPhotoMeta, buildReceipt, buildTestResults } from './collectionPayload';
import type { GeofenceResult, MotShopPolicySnapshot, MotShopPolicyTest, PersonDecision } from '@/types/stage1-decision';
import type { LiveCameraResult } from '@/types/captured-photo';
import { COVER_HEADERS, type CurrentJourney, type StopDetail } from './types';

export interface CompletedReceipt {
  shopName: string;
  phone: string;
  whatsappUrl: string;
  grossLiters: number;
  at13tsLiters: number;
  lr: number;
  fat: number;
}

interface Params {
  currentUser: User | null;
  journey: CurrentJourney | null;
  setJourney: React.Dispatch<React.SetStateAction<CurrentJourney | null>>;
  isCovering: boolean;
  isOnline: boolean;
  latestFixRef: React.MutableRefObject<TrackedPoint | null>;
  refreshUnsynced: () => Promise<unknown>;
  triggerSync: () => unknown;
  setSyncFeedback: (message: string | null) => void;
}

/** Everything behind the shop collection wizard: form values, policy, GPS, decision preview, draft and offline queueing. */
export function useCollection({
  currentUser,
  journey,
  setJourney,
  isCovering,
  isOnline,
  latestFixRef,
  refreshUnsynced,
  triggerSync,
  setSyncFeedback,
}: Params) {
  const [activeStop, setActiveStop] = useState<StopDetail | null>(null);
  const [shopRmrNumber, setShopRmrNumber] = useState<string>('');
  const [availableSources, setAvailableSources] = useState<CachedAvailableSource[]>([]);
  const [selectedSourceId, setSelectedSourceId] = useState<string>('');
  const [quantity, setQuantity] = useState<string>('');
  const [unit, setUnit] = useState<'LITER' | 'KG'>('LITER');
  const [lr, setLr] = useState<string>('');
  const [fat, setFat] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  // Stage 1 decision (Phase 4a)
  const [shopPolicy, setShopPolicy] = useState<MotShopPolicySnapshot | null>(null);
  const [testValues, setTestValues] = useState<Record<string, MotTestValue>>({});
  const [testPhotos, setTestPhotos] = useState<Record<string, MotTestPhoto>>({});
  const [personDecision, setPersonDecision] = useState<PersonDecision | null>(null);
  const [decisionRemarks, setDecisionRemarks] = useState<string>('');
  const [collectionGps, setCollectionGps] = useState<{
    latitude: number | null;
    longitude: number | null;
    accuracy: number | null;
    status: 'ACQUIRING' | 'CAPTURED' | 'APPROXIMATE' | 'UNAVAILABLE';
  }>({ latitude: null, longitude: null, accuracy: null, status: 'ACQUIRING' });
  const [formError, setFormError] = useState<string | null>(null);
  const [submittingCollection, setSubmittingCollection] = useState(false);
  // Immediate post-collection WhatsApp receipt
  const [completedReceiptModal, setCompletedReceiptModal] = useState<CompletedReceipt | null>(null);

  // Private server draft of the typed values, so this login continues on any device. Never a result.
  useServerDraft({
    formType: 'MOT_SHOP',
    scopeId: activeStop && !isCovering ? String(activeStop.id) : null,
    portionKey: 'form',
    content: motDraftFromForm({ shopRmrNumber, quantity, unit, lr, fat, notes, selectedSourceId, testValues }),
    onRemote: (content, reason) => {
      const next = applyMotDraft({ shopRmrNumber, quantity, unit, lr, fat, notes, selectedSourceId, testValues }, content, reason);
      setShopRmrNumber(next.shopRmrNumber);
      setQuantity(next.quantity);
      setUnit(next.unit);
      setLr(next.lr);
      setFat(next.fat);
      setNotes(next.notes);
      setSelectedSourceId(next.selectedSourceId);
      setTestValues(next.testValues);
    },
  });

  // MOT_SHOP test rules: fetched with TanStack Query and cached (offline-first)
  const policyQuery = useQuery({
    queryKey: ['mot', 'shop-policy', isCovering],
    queryFn: async ({ signal }) => {
      if (typeof navigator !== 'undefined' && navigator.onLine) {
        try {
          const res = await fetch('/api/zmcc/mot/shop-policy', {
            headers: isCovering ? COVER_HEADERS : undefined,
            signal,
          });
          if (res.ok) {
            const policy = (await res.json()) as MotShopPolicySnapshot;
            await cacheMotShopPolicy(policy);
            return policy;
          }
        } catch {
          // Fall through to offline cache
        }
      }
      return (await getCachedMotShopPolicy()) || null;
    },
    enabled: Boolean(currentUser),
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
  });

  useEffect(() => {
    if (policyQuery.data) {
      setShopPolicy(policyQuery.data);
    }
  }, [policyQuery.data]);

  // Available ERP milk sources: fetched with TanStack Query and cached for 5 min
  const effectiveZmccId = journey?.zmcc?.id || currentUser?.procurement_source_id || currentUser?.procurement_source?.id;
  const sourcesQuery = useQuery({
    queryKey: ['mot', 'available-sources', effectiveZmccId, isCovering],
    queryFn: async ({ signal }) => {
      if (!effectiveZmccId) return [];
      if (typeof navigator !== 'undefined' && navigator.onLine) {
        try {
          const res = await fetch(`/api/sources/available?zmcc_id=${encodeURIComponent(effectiveZmccId)}`, {
            headers: isCovering ? COVER_HEADERS : undefined,
            signal,
          });
          if (res.ok) {
            const data = await res.json();
            if (data.sources && Array.isArray(data.sources)) {
              await cacheAvailableSources(data.sources);
              return data.sources as CachedAvailableSource[];
            }
          }
        } catch {
          // Fall through to offline cache
        }
      }
      return (await getCachedAvailableSources()) || [];
    },
    enabled: Boolean(currentUser && effectiveZmccId),
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
  });

  useEffect(() => {
    if (sourcesQuery.data && sourcesQuery.data.length > 0) {
      setAvailableSources(sourcesQuery.data);
    }
  }, [sourcesQuery.data]);

  // Refresh available ERP milk sources from server or offline cache
  const refreshAvailableSources = useCallback(async (zmccId?: string) => {
    const zId = zmccId || effectiveZmccId;
    if (!zId) return;
    try {
      const res = await fetch(`/api/sources/available?zmcc_id=${encodeURIComponent(zId)}`);
      if (res.ok) {
        const data = await res.json();
        if (data.sources && Array.isArray(data.sources)) {
          setAvailableSources(data.sources);
          await cacheAvailableSources(data.sources);
          return;
        }
      }
    } catch {
      // Offline fallback
    }
    const cached = await getCachedAvailableSources();
    if (cached) setAvailableSources(cached);
  }, [effectiveZmccId]);

  // Handle open collection modal
  const handleOpenCollectionModal = async (stop: StopDetail) => {
    setActiveStop(stop);
    setFormError(null);
    void refreshAvailableSources(journey?.zmcc?.id);

    // Acquire GPS for collection event with offline fallback
    setCollectionGps({ latitude: null, longitude: null, accuracy: null, status: 'ACQUIRING' });
    try {
      const fix = latestFixRef.current;
      if (fix && Date.now() - fix.timestamp <= 30_000 && fix.accuracy <= 100) {
        setCollectionGps({
          latitude: fix.latitude,
          longitude: fix.longitude,
          accuracy: fix.accuracy,
          status: 'CAPTURED',
        });
      } else {
        const res = await acquireRobustGps({
          facilityCode: currentUser?.procurement_source?.code,
          allowFacilityFallback: true,
          maxCacheAgeMs: 30_000,
        });

        // Fallback (saved or facility position) is not a real fix: keep the coordinates
        // (the server requires them, otherwise the collection can never sync) but label
        // them APPROXIMATE so nobody mistakes them for a fresh GPS fix.
        if (res.location) {
          setCollectionGps({
            latitude: res.location.latitude,
            longitude: res.location.longitude,
            accuracy: res.location.accuracy,
            status: res.status === 'SUCCESS' ? 'CAPTURED' : 'APPROXIMATE',
          });
        } else {
          setCollectionGps({ latitude: null, longitude: null, accuracy: null, status: 'UNAVAILABLE' });
        }
      }
    } catch {
      setCollectionGps({ latitude: null, longitude: null, accuracy: null, status: 'UNAVAILABLE' });
    }

    // Reset decision states
    setTestValues({});
    setTestPhotos((prev) => {
      Object.values(prev).forEach((p) => URL.revokeObjectURL(p.previewUrl));
      return {};
    });
    setPersonDecision(null);
    setDecisionRemarks('');

    // Check for existing draft
    try {
      const currentUserId = currentUser?.id ? String(currentUser.id) : undefined;
      const draft = await getDraft(stop.id, currentUserId);
      if (draft) {
        setShopRmrNumber(draft.shop_rmr_number || '');
        setSelectedSourceId(draft.milk_source_id || '');
        setQuantity(draft.quantity || '');
        setUnit(draft.unit || 'LITER');
        setLr(draft.lr || '');
        setFat(draft.fat || '');
        setNotes(draft.notes || '');
      } else {
        setShopRmrNumber('');
        setSelectedSourceId('');
        setQuantity('');
        setUnit('LITER');
        setLr('');
        setFat('');
        setNotes('');
      }
    } catch {
      setShopRmrNumber('');
      setSelectedSourceId('');
      setQuantity('');
      setUnit('LITER');
      setLr('');
      setFat('');
      setNotes('');
    }
  };

  // Shop geofence preview (the server checks again with the saved shop location).
  const geofencePreview = React.useMemo((): (GeofenceResult & { accuracyM: number | null; approximate: boolean }) | null => {
    if (!activeStop || collectionGps.latitude == null || collectionGps.longitude == null) return null;
    const shopLat = activeStop.planned_latitude_snapshot ?? activeStop.planned_latitude ?? null;
    const shopLng = activeStop.planned_longitude_snapshot ?? activeStop.planned_longitude ?? null;
    const approximate = collectionGps.status === 'APPROXIMATE';
    const g = evaluateGeofence({
      shopLat: shopLat != null && !(Number(shopLat) === 0 && Number(shopLng) === 0) ? Number(shopLat) : null,
      shopLng: shopLng != null ? Number(shopLng) : null,
      radiusM: activeStop.geofence_radius_m ?? activeStop.shop?.geofence_radius_m ?? DEFAULT_SHOP_GEOFENCE_M,
      lat: collectionGps.latitude,
      lng: collectionGps.longitude,
      accuracyM: collectionGps.accuracy,
      approximate,
    });
    return { ...g, accuracyM: collectionGps.accuracy, approximate };
  }, [activeStop, collectionGps]);

  // Live decision preview (same pure rule the server runs).
  const decisionPreview = React.useMemo(() => {
    if (!shopPolicy || !currentUser) return null;
    const lrNum = parseFloat(lr);
    const fatNum = parseFloat(fat);
    const tests = Object.entries(testValues).map(([labTestId, v]) => ({
      labTestId,
      value: v.value.trim() !== '' && Number.isFinite(Number(v.value)) ? Number(v.value) : null,
      textValue: v.text.trim() || null,
    }));
    return buildMotShopDecision(shopPolicy, {
      lr: Number.isFinite(lrNum) ? lrNum : NaN,
      fat: Number.isFinite(fatNum) ? fatNum : NaN,
      tests,
      photos: Object.entries(testPhotos).map(([labTestId, p]) => ({ labTestId, captureId: p.captureId })),
      personDecision: personDecision ?? 'ACCEPT',
      remarks: decisionRemarks,
      geofence: geofencePreview ?? { status: 'NO_SHOP_GPS', distanceM: null, radiusM: DEFAULT_SHOP_GEOFENCE_M, accuracyM: null, approximate: false },
      deciderCanApprove: canDecideMotException(currentUser.role),
    });
  }, [shopPolicy, currentUser, lr, fat, testValues, testPhotos, personDecision, decisionRemarks, geofencePreview]);

  const decisionRows = React.useMemo((): DecisionRuleTestRow[] => {
    if (!decisionPreview) return [];
    return decisionPreview.details.tests.map((t) => ({
      key: t.labTestId,
      name: t.testName,
      outcome: t.outcome,
      valueText: t.value != null ? String(t.value) : t.textValue,
      note:
        t.photoMode === 'REQUIRED' && t.outcome !== 'NOT_TESTED' && !t.photoCaptureId
          ? 'Picture missing'
          : t.testMode === 'COMPULSORY' && t.outcome === 'NOT_TESTED'
            ? 'Must be tested'
            : null,
    }));
  }, [decisionPreview]);

  const handlePhotoTaken = async (test: MotShopPolicyTest, result: LiveCameraResult) => {
    try {
      // Kept on the phone until the server confirms the upload.
      await saveCapturedPhoto({ captureId: result.captureId, blob: result.blob, testType: test.testCode });
    } catch (err) {
      setFormError('Could not save the picture on this phone: ' + (getErrorMessage(err) || 'storage error'));
      return;
    }
    const previewUrl = URL.createObjectURL(result.blob);
    setTestPhotos((prev) => {
      const old = prev[test.labTestId];
      if (old) URL.revokeObjectURL(old.previewUrl);
      return {
        ...prev,
        [test.labTestId]: {
          captureId: result.captureId,
          previewUrl,
          sha256: result.sha256,
          width: result.width,
          height: result.height,
          capturedAt: result.capturedAt,
          gps: result.gps,
        },
      };
    });
  };

  const handlePhotoRemoved = (labTestId: string) => {
    setTestPhotos((prev) => {
      const next = { ...prev };
      const old = next[labTestId];
      if (old) URL.revokeObjectURL(old.previewUrl);
      delete next[labTestId];
      return next;
    });
  };

  // Live calculated milk metrics preview
  const livePreview = React.useMemo(() => {
    const qNum = parseFloat(quantity);
    const lrNum = parseFloat(lr);
    const fatNum = parseFloat(fat);

    if (isNaN(qNum) || qNum <= 0 || isNaN(lrNum) || isNaN(fatNum)) {
      return null;
    }

    try {
      return computeCanonicalMilkMetrics(qNum, unit, lrNum, fatNum);
    } catch {
      return null;
    }
  }, [quantity, unit, lr, fat]);


  // Save Draft Action
  const handleSaveDraft = async () => {
    if (!activeStop) return;
    try {
      const currentUserId = currentUser?.id ? String(currentUser.id) : undefined;
      await saveDraft(
        activeStop.id,
        {
          shop_rmr_number: shopRmrNumber.trim() || null,
          milk_source_id: selectedSourceId || null,
          quantity,
          unit,
          lr,
          fat,
          notes,
        },
        currentUserId
      );
      setActiveStop(null);
      setSyncFeedback('Draft saved locally.');
    } catch (err) {
      setFormError('Failed to save draft: ' + getErrorMessage(err));
    }
  };

  // Record & Queue Collection Action
  const handleRecordCollection = async () => {
    if (!activeStop || !journey || !currentUser) return;
    setFormError(null);

    const qNum = parseFloat(quantity);
    const lrNum = parseFloat(lr);
    const fatNum = parseFloat(fat);

    if (isNaN(qNum) || qNum <= 0 || qNum > 10000) {
      setFormError('Quantity must be a positive number up to 10,000.');
      return;
    }
    if (isNaN(lrNum) || lrNum <= 0) {
      setFormError('LR reading must be more than zero.');
      return;
    }
    if (isNaN(fatNum) || fatNum < 0) {
      setFormError('Fat % cannot be below zero.');
      return;
    }
    if (!selectedSourceId) {
      setFormError('Choose the milk source for this shop.');
      return;
    }
    if (!personDecision) {
      setFormError('Choose Accept milk or Reject milk.');
      return;
    }
    const decision = decisionPreview?.decision ?? null;
    const remarksText = decisionRemarks.trim();
    const remarksNeeded = decision ? decision.remarksRequired : personDecision === 'REJECT';
    if (remarksNeeded && remarksText.length < 3) {
      setFormError('Please write a short reason (at least 3 letters).');
      return;
    }
    if (isCovering && !navigator.onLine) {
      setFormError('You must be online to cover MC work.');
      return;
    }

    setSubmittingCollection(true);
    try {
      const clientEventId =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `evt-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      const offlineCreatedAt = new Date().toISOString();
      const requestedAs = isCovering ? 'MOT' : null;

      const testResults = buildTestResults(shopPolicy, testValues, lrNum, fatNum);

      const photoEntries = Object.entries(testPhotos);
      const photoMeta = buildPhotoMeta(photoEntries, shopPolicy?.version ?? null, requestedAs);

      const queued = await enqueueMotCollection(
        {
          client_event_id: clientEventId,
          journey_id: journey.id,
          stop_id: activeStop.id,
          shop_rmr_number: shopRmrNumber.trim() || null,
          milk_source_id: selectedSourceId || null,
          quantity: qNum,
          unit,
          lr: lrNum,
          fat: fatNum,
          recorded_latitude: collectionGps.latitude,
          recorded_longitude: collectionGps.longitude,
          recorded_gps_accuracy: collectionGps.accuracy,
          notes: notes.trim() || undefined,
          person_decision: personDecision,
          decision_remarks: remarksText || null,
          gps_approximate: collectionGps.status === 'APPROXIMATE',
          test_results: testResults,
          photos: photoEntries.map(([labTestId, p]) => ({ lab_test_id: labTestId, capture_id: p.captureId })),
          policy_version: shopPolicy?.version ?? null,
          requested_as: requestedAs,
          offline_created_at: offlineCreatedAt,
        },
        photoMeta
      );
      const picturesWait = queued.mode === 'OLD_QUEUE' && queued.photosWaitForSetup;

      const finalDecision = decision?.finalDecision ?? (personDecision === 'REJECT' ? 'REJECTED' : 'ACCEPTED');
      const stopStatus = personDecision === 'REJECT' ? 'REJECTED' : 'VISITED';

      // Update local stop state immediately for instant UI feedback
      const preview = computeCanonicalMilkMetrics(qNum, unit, lrNum, fatNum);
      setJourney((prev) => {
        if (!prev) return null;
        return {
          ...prev,
          stops: prev.stops.map((s) =>
            s.id === activeStop.id
              ? {
                  ...s,
                  status: stopStatus,
                  collection: {
                    gross_liters: preview.grossLiters,
                    unit,
                    lr: lrNum,
                    fat: fatNum,
                    at_13ts_liters: preview.at13TsLiters,
                    created_at: offlineCreatedAt,
                    final_decision: finalDecision,
                  },
                }
              : s
          ),
        };
      });

      // Pictures are now owned by the queue; only the screen previews are released.
      Object.values(testPhotos).forEach((p) => URL.revokeObjectURL(p.previewUrl));
      setTestPhotos({});

      if (personDecision === 'REJECT') {
        setSyncFeedback(picturesWait ? 'Shop rejected. Pictures will send after the phone is set up.' : 'Shop rejected and saved.');
      } else {
        setCompletedReceiptModal(
          buildReceipt({ stop: activeStop, journey, preview, lr: lrNum, fat: fatNum, finalDecision })
        );
        if (picturesWait) setSyncFeedback('Pictures will send after the phone is set up.');
      }

      setActiveStop(null);
      await refreshUnsynced();

      // Trigger immediate sync if online
      if (navigator.onLine) {
        triggerSync();
      }
    } catch (err) {
      setFormError(getErrorMessage(err) || 'Could not save this collection on the phone.');
    } finally {
      setSubmittingCollection(false);
    }
  };

  return {
    activeStop,
    setActiveStop,
    shopRmrNumber,
    setShopRmrNumber,
    availableSources,
    selectedSourceId,
    setSelectedSourceId,
    quantity,
    setQuantity,
    unit,
    setUnit,
    lr,
    setLr,
    fat,
    setFat,
    notes,
    setNotes,
    shopPolicy,
    testValues,
    setTestValues,
    testPhotos,
    personDecision,
    setPersonDecision,
    decisionRemarks,
    setDecisionRemarks,
    collectionGps,
    formError,
    submittingCollection,
    completedReceiptModal,
    setCompletedReceiptModal,
    livePreview,
    decisionPreview,
    decisionRows,
    handleOpenCollectionModal,
    handlePhotoTaken,
    handlePhotoRemoved,
    handleSaveDraft,
    handleRecordCollection,
  };
}
