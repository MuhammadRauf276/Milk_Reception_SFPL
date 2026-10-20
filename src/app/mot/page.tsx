'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { User } from '@core/types';
import { Header } from '@modules/shared/Header';
import { HierarchicalNavDrawer } from '@modules/shared/navigation/HierarchicalNavDrawer';
import {
  Truck,
  Store,
  AlertCircle,
  Wifi,
  WifiOff,
  X,
  Search,
  Plus,
  CheckCircle2,
  MessageSquare,
  ChevronLeft,
  ChevronRight,
  Loader2,
  UserCog,
} from 'lucide-react';
import {
  saveCachedJourney,
  getCachedJourney,
  type CachedJourney,
  saveMotOfflinePreparation,
  getMotOfflinePreparation,
  saveDraft,
  getDraft,
  enqueueMotCollection,
  cacheMotShopPolicy,
  getCachedMotShopPolicy,
  queueGpsLocation,
  getUnsyncedSummary,
  syncAll,
  markStopSkippedInCachedJourney,
  queueStopSkip,
  queueShopRequest,
  syncPendingShopRequests,
  cacheAvailableSources,
  getCachedAvailableSources,
  type CachedAvailableSource,
} from '@/frontend/modules/mot/offlineStore';
import { computeCanonicalMilkMetrics } from '@/backend/utils/milkFormulas';
import { PageLoader } from '@/components/ui/spinner';
import { PageTransition } from '@/components/motion/page-transition';
import { Modal } from '@/components/ui/modal';
import { AnimatePresence } from 'framer-motion';
import { getErrorMessage } from '@/lib/errors';
import { useOnlineStatus } from '@/frontend/hooks/useOnlineStatus';
import { acquireRobustGps } from '@/lib/gps';
import { getFixAgeLabel, shouldRecordPoint, type TrackedPoint } from '@/lib/gpsTracker';
import type { MotTestPhoto, MotTestValue } from '@/frontend/modules/mot/MotShopTestsStep';
import { ShopCollectionWizard } from '@/frontend/modules/mot/ShopCollectionWizard';
import type { DecisionRuleTestRow } from '@/frontend/modules/shared/decision/DecisionRulePanel';
import { DecisionStatusBadge } from '@/frontend/modules/shared/decision/DecisionStatusBadge';
import { canCoverMotWork, canDecideMotException } from '@/frontend/modules/zmcc/stage1Capabilities';
import { buildMotShopDecision } from '@/backend/services/mot/motShopDecision';
import { evaluateGeofence, DEFAULT_SHOP_GEOFENCE_M } from '@/backend/services/mot/geofence';
import { getRoleLabel } from '@/backend/core/roles/labels';
import { saveCapturedPhoto } from '@/lib/offline/photoStore';
import type { PendingPhotoMeta } from '@/frontend/modules/pwa/syncQueueCore';
import type { GeofenceResult, MotShopPolicySnapshot, MotShopPolicyTest, PersonDecision } from '@/types/stage1-decision';
import type { LiveCameraResult } from '@/types/captured-photo';

/** Header a superior sends to cover MOT work (the server checks it). */
const COVER_HEADERS: Record<string, string> = { 'x-acting-as': 'MOT' };

interface StopDetail {
  id: string;
  planned_sequence: number;
  status: string;
  shop_code?: string;
  shop_name?: string;
  owner_name?: string;
  phone_number?: string;
  area_code?: string;
  area_name?: string;
  planned_latitude_snapshot?: number | null;
  planned_longitude_snapshot?: number | null;
  planned_latitude?: number | null;
  planned_longitude?: number | null;
  skipped_at?: string | null;
  skip_reason?: string | null;
  distanceKm?: number | null;
  hasCoordinates?: boolean;
  geofence_radius_m?: number | null;
  shop?: {
    id: string;
    shop_code: string;
    shop_name: string;
    owner_name: string;
    contact_number: string;
    geofence_radius_m?: number | null;
  } | null;
  collection?: {
    id?: string;
    collection_number?: string;
    gross_liters: number;
    unit: string;
    lr: number;
    fat: number;
    at_13ts_liters: number;
    created_at?: string;
    final_decision?: string | null;
  } | null;
}

interface CoverJourneyOption {
  id: string;
  journey_number: string;
  route?: { name?: string; route_code?: string } | null;
  mot_profile?: { name?: string; mot_code?: string } | null;
  mot_vehicle?: { vehicle_number?: string } | null;
}

/** Final decision text for receipts. */
function decisionWord(finalDecision: string | null | undefined): string {
  if (finalDecision === 'REJECTED') return 'Rejected';
  if (finalDecision === 'PENDING') return 'Waiting for Zonal Manager';
  return 'Accepted';
}

function computeHaversineDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function formatDistance(distKm: number): string {
  if (distKm < 1) {
    const meters = Math.round(distKm * 1000);
    return `${meters}m away`;
  }
  return `${distKm.toFixed(1)}km away`;
}

interface CurrentJourney {
  id: string;
  journey_number: string;
  operational_date: string;
  zmcc?: { id: string; code?: string; name?: string } | null;
  route: { id: string; route_code: string; name: string } | null;
  mot_vehicle: { id: string; vehicle_number: string } | null;
  status: string;
  assigned_by_name: string | null;
  assigned_at: string;
  stops: StopDetail[];
}

/** Offline cache -> page model. Assignment metadata is not cached (and not rendered). */
function toCurrentJourney(cached: CachedJourney): CurrentJourney {
  return {
    id: cached.id,
    journey_number: cached.journey_number,
    operational_date: cached.operational_date,
    status: cached.status,
    zmcc: cached.zmcc ?? null,
    route: cached.route ?? null,
    mot_vehicle: cached.mot_vehicle ?? null,
    assigned_by_name: null,
    assigned_at: cached.cached_at,
    stops: cached.stops.map((stop) => ({
      ...stop,
      collection: stop.collection ?? null,
      planned_latitude_snapshot: stop.planned_latitude_snapshot ?? stop.planned_latitude ?? null,
      planned_longitude_snapshot: stop.planned_longitude_snapshot ?? stop.planned_longitude ?? null,
      skipped_at: stop.skipped_at ?? null,
      skip_reason: stop.skip_reason ?? null,
    })),
  };
}

/** A usable offline copy of the journey: cached, prepared for it, and not expired. */
async function getPreparedCachedJourney(): Promise<CurrentJourney | null> {
  const cached = await getCachedJourney();
  const preparation = await getMotOfflinePreparation();
  if (cached && preparation && preparation.journeyId === cached.id && new Date(preparation.expiresAt).getTime() > Date.now()) {
    return toCurrentJourney(cached);
  }
  return null;
}

/**
 * Loads the MOT's current journey online (refreshing the offline cache) or from the offline cache.
 * `journey: undefined` means "keep whatever is shown"; `error` is the message to display, if any.
 */
async function resolveCurrentJourney(
  cover?: { journeyId: string | null }
): Promise<{ journey?: CurrentJourney | null; error: string | null }> {
  // A superior covering MOT work: online only, the chosen journey, nothing cached.
  if (cover) {
    if (!cover.journeyId) return { journey: null, error: null };
    try {
      const res = await fetch(`/api/zmcc/mot/journeys/current?journeyId=${encodeURIComponent(cover.journeyId)}`, {
        headers: COVER_HEADERS,
      });
      const data = await res.json();
      if (!res.ok) return { journey: null, error: data.error || 'Could not open this journey.' };
      return { journey: data.journey ?? null, error: data.journey ? null : data.message || null };
    } catch (err) {
      return { journey: null, error: getErrorMessage(err) || 'You must be online to cover MOT work.' };
    }
  }
  // Shown even if caching it for offline use fails below.
  let onlineJourney: CurrentJourney | undefined;
  try {
    if (navigator.onLine) {
      const res = await fetch('/api/zmcc/mot/journeys/current');
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to fetch current journey.');
      }
      if (!data.journey) return { journey: null, error: null };
      onlineJourney = data.journey;
      await saveCachedJourney(data.journey);
      if (data.journey.status === 'COLLECTING') {
        const preparation = await fetch('/api/zmcc/mot/journeys/current/offline-preparation', { method: 'POST' });
        if (preparation.ok) await saveMotOfflinePreparation(await preparation.json());
      }
      return { journey: data.journey, error: null };
    }
    // Load from offline store
    const prepared = await getPreparedCachedJourney();
    return prepared
      ? { journey: prepared, error: null }
      : { journey: null, error: 'Offline preparation is missing or expired. Reconnect and prepare the active journey again.' };
  } catch (err) {
    // Fallback to cache on error
    try {
      const prepared = await getPreparedCachedJourney();
      return prepared
        ? { journey: prepared, error: null }
        : { journey: onlineJourney, error: getErrorMessage(err) || 'Unable to connect and no cached journey available.' };
    } catch {
      return { journey: onlineJourney, error: getErrorMessage(err) || 'Failed to load journey.' };
    }
  }
}

export default function MotPage() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [loadingUser, setLoadingUser] = useState(true);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const hamburgerButtonRef = useRef<HTMLButtonElement | null>(null);

  // Network and Sync States
  const isOnline = useOnlineStatus();
  const [unsyncedCount, setUnsyncedCount] = useState<number>(0);
  const [lastSyncTime, setLastSyncTime] = useState<string | null>(null);
  const [syncing, setSyncing] = useState<boolean>(false);
  const [syncFeedback, setSyncFeedback] = useState<string | null>(null);

  // Journey States
  const [journey, setJourney] = useState<CurrentJourney | null>(null);
  const [loadingJourney, setLoadingJourney] = useState(true);
  const [journeyError, setJourneyError] = useState<string | null>(null);

  // Collection Modal States
  const [activeStop, setActiveStop] = useState<StopDetail | null>(null);
  const [shopRmrNumber, setShopRmrNumber] = useState<string>('');
  const [availableSources, setAvailableSources] = useState<CachedAvailableSource[]>([]);
  const [selectedSourceId, setSelectedSourceId] = useState<string>('');
  const [showRequestErpModal, setShowRequestErpModal] = useState<boolean>(false);
  const [requestErpForm, setRequestErpForm] = useState({
    proposedName: '',
    proposedCode: '',
    notes: '',
  });
  const [requestErpSubmitting, setRequestErpSubmitting] = useState(false);
  const [requestErpFeedback, setRequestErpFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
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
  // A superior covering MOT work (online only)
  const [coverJourneys, setCoverJourneys] = useState<CoverJourneyOption[]>([]);
  const [coverJourneyId, setCoverJourneyId] = useState<string | null>(null);
  const [coverListError, setCoverListError] = useState<string | null>(null);
  const [collectionGps, setCollectionGps] = useState<{
    latitude: number | null;
    longitude: number | null;
    accuracy: number | null;
    status: 'ACQUIRING' | 'CAPTURED' | 'APPROXIMATE' | 'UNAVAILABLE';
  }>({ latitude: null, longitude: null, accuracy: null, status: 'ACQUIRING' });
  const [formError, setFormError] = useState<string | null>(null);
  const [submittingCollection, setSubmittingCollection] = useState(false);

  // Skip Modal States
  const [skipModalStop, setSkipModalStop] = useState<StopDetail | null>(null);
  const [skipReason, setSkipReason] = useState<string>('');
  const [skipError, setSkipError] = useState<string | null>(null);
  const [submittingSkip, setSubmittingSkip] = useState(false);

  // Stops Pagination (Max 6 per screen)
  const [stopsPage, setStopsPage] = useState<number>(1);
  const stopsPerPage = 6;

  // Shop Request Modal State
  const [isShopRequestModalOpen, setIsShopRequestModalOpen] = useState(false);
  const [shopRequestForm, setShopRequestForm] = useState({
    shop_name: '',
    owner_name: '',
    phone_number: '',
    cnic: '',
  });
  const [submittingShopRequest, setSubmittingShopRequest] = useState(false);
  const [shopRequestError, setShopRequestError] = useState<string | null>(null);
  const [shopRequestSuccess, setShopRequestSuccess] = useState<string | null>(null);

  // Immediate Post-Collection WhatsApp Receipt Modal
  const [completedReceiptModal, setCompletedReceiptModal] = useState<{
    shopName: string;
    phone: string;
    whatsappUrl: string;
    grossLiters: number;
    at13tsLiters: number;
    lr: number;
    fat: number;
  } | null>(null);

  // Device GPS State for Distance Calculation & Auto-Sort
  const [deviceGps, setDeviceGps] = useState<{ latitude: number; longitude: number } | null>(null);
  const [lastFixAt, setLastFixAt] = useState<number | null>(null);
  const [gpsClock, setGpsClock] = useState<number>(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setGpsClock(Date.now()), 15000);
    return () => clearInterval(t);
  }, []);
  const gpsFixAgeMs = lastFixAt === null ? null : Math.max(0, gpsClock - lastFixAt);
  const gpsBadge = (
    <span
      className={`px-2 py-0.5 rounded-full text-xs font-bold ${
        gpsFixAgeMs !== null && gpsFixAgeMs <= 5 * 60 * 1000
          ? 'bg-emerald-100 text-emerald-800'
          : 'bg-slate-200 text-slate-500'
      }`}
    >
      GPS: {gpsFixAgeMs === null ? 'Waiting' : getFixAgeLabel(gpsFixAgeMs)}
    </span>
  );

  // Searchable Shop Selector State
  const [shopSearchQuery, setShopSearchQuery] = useState('');
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const searchDropdownRef = useRef<HTMLDivElement | null>(null);

  // Close search dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (searchDropdownRef.current && !searchDropdownRef.current.contains(e.target as Node)) {
        setIsSearchOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Refresh unsynced count
  const refreshUnsynced = useCallback(
    () =>
      getUnsyncedSummary()
        .then((summary) => setUnsyncedCount(summary.totalUnsynced))
        .catch(() => {
          // IndexedDB might not be ready
        }),
    []
  );

  useEffect(() => {
    refreshUnsynced();
  }, [refreshUnsynced]);

  // Sync execution
  const triggerSync = useCallback(async () => {
    if (syncing) return;
    setSyncing(true);
    setSyncFeedback(null);
    try {
      const result = await syncAll();
      const totalSynced = result.collections.synced + result.gps.synced + (result.skips?.synced || 0);
      if (totalSynced > 0) {
        setSyncFeedback(`Successfully synced ${totalSynced} pending item(s).`);
      }
      setLastSyncTime(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
      await refreshUnsynced();
    } catch {
      setSyncFeedback('Sync failed: Network issue.');
    } finally {
      setSyncing(false);
    }
  }, [syncing, refreshUnsynced]);

  const handleOpenSkipModal = (stop: StopDetail) => {
    setSkipModalStop(stop);
    setSkipReason('');
    setSkipError(null);
  };

  const handleConfirmSkip = async () => {
    if (!skipModalStop || !journey) return;
    const cleanReason = skipReason.trim();
    if (!cleanReason) {
      setSkipError('Please enter a reason for skipping this shop.');
      return;
    }

    setSubmittingSkip(true);
    setSkipError(null);

    try {
      const stopId = skipModalStop.id;
      const nowIso = new Date().toISOString();

      // 1. Update in-memory state
      setJourney((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          stops: prev.stops.map((s) =>
            s.id === stopId
              ? { ...s, status: 'SKIPPED', skipped_at: nowIso, skip_reason: cleanReason }
              : s
          ),
        };
      });

      // 2. Save locally in IndexedDB active_journey (100% offline support)
      await markStopSkippedInCachedJourney(stopId, cleanReason);

      // 3. Queue skip event to be synced via the new skip API route
      await queueStopSkip({
        stop_id: stopId,
        journey_id: journey.id,
        skip_reason: cleanReason,
      });

      await refreshUnsynced();

      // 4. If online, trigger sync immediately
      if (navigator.onLine) {
        triggerSync();
      }

      setSkipModalStop(null);
      setSkipReason('');
    } catch (err) {
      setSkipError(getErrorMessage(err) || 'Failed to skip shop.');
    } finally {
      setSubmittingSkip(false);
    }
  };

  const handleSubmitShopRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!shopRequestForm.shop_name.trim()) {
      setShopRequestError('Shop name is required.');
      return;
    }
    if (!shopRequestForm.owner_name.trim()) {
      setShopRequestError('Owner name is required.');
      return;
    }
    if (!shopRequestForm.phone_number.trim()) {
      setShopRequestError('Phone number is required.');
      return;
    }
    if (!shopRequestForm.cnic.trim()) {
      setShopRequestError('CNIC is required.');
      return;
    }

    setSubmittingShopRequest(true);
    setShopRequestError(null);

    try {
      await queueShopRequest({
        shop_name: shopRequestForm.shop_name.trim(),
        owner_name: shopRequestForm.owner_name.trim(),
        phone_number: shopRequestForm.phone_number.trim(),
        cnic: shopRequestForm.cnic.trim(),
        route_id: journey?.route?.id,
        latitude: deviceGps?.latitude ?? null,
        longitude: deviceGps?.longitude ?? null,
      });

      if (typeof navigator !== 'undefined' && navigator.onLine) {
        syncPendingShopRequests().catch(() => {});
      }

      setShopRequestSuccess('Shop request queued successfully. It will be added to your journey once approved.');
      setShopRequestForm({
        shop_name: '',
        owner_name: '',
        phone_number: '',
        cnic: '',
      });
      setTimeout(() => {
        setIsShopRequestModalOpen(false);
        setShopRequestSuccess(null);
      }, 1500);
    } catch (err) {
      setShopRequestError(getErrorMessage(err) || 'Failed to submit shop request.');
    } finally {
      setSubmittingShopRequest(false);
    }
  };

  // Sync as soon as connectivity returns
  useEffect(() => {
    const handleOnline = () => {
      triggerSync();
    };
    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [triggerSync]);

  // Periodic 30s sync when online
  useEffect(() => {
    const interval = setInterval(() => {
      if (navigator.onLine) {
        triggerSync();
      }
    }, 30000);
    return () => clearInterval(interval);
  }, [triggerSync]);

  // One GPS stream: proximity sorting always, route recording while COLLECTING.
  const journeyIdForGps = journey?.id ?? null;
  // Route GPS is recorded for the MOT only; a superior covering MOT work does not send route points.
  const isCollectingForGps = journey?.status === 'COLLECTING' && currentUser?.role === 'MOT';
  const lastSavedPointRef = useRef<TrackedPoint | null>(null);
  const lastSavedJourneyRef = useRef<string | null>(null);
  const latestFixRef = useRef<TrackedPoint | null>(null);
  const refreshUnsyncedRef = useRef(refreshUnsynced);
  const triggerSyncRef = useRef(triggerSync);
  useEffect(() => {
    refreshUnsyncedRef.current = refreshUnsynced;
    triggerSyncRef.current = triggerSync;
  }, [refreshUnsynced, triggerSync]);

  useEffect(() => {
    if (typeof window === 'undefined' || !navigator.geolocation) return;

    const journeyKey = journeyIdForGps === null ? null : String(journeyIdForGps);
    if (lastSavedJourneyRef.current !== journeyKey) {
      lastSavedJourneyRef.current = journeyKey;
      lastSavedPointRef.current = null;
    }

    const onPosition = (pos: GeolocationPosition) => {
      const point: TrackedPoint = {
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
        timestamp: pos.timestamp,
        speed: pos.coords.speed,
        heading: pos.coords.heading,
      };
      latestFixRef.current = point;
      setDeviceGps({ latitude: point.latitude, longitude: point.longitude });
      setLastFixAt(pos.timestamp);

      if (!isCollectingForGps || !journeyIdForGps) return;

      const decision = shouldRecordPoint(lastSavedPointRef.current, point, Date.now());
      if (!decision.record) return;
      lastSavedPointRef.current = point;

      void (async () => {
        try {
          await queueGpsLocation({
            journey_id: journeyIdForGps,
            latitude: point.latitude,
            longitude: point.longitude,
            gps_accuracy: point.accuracy,
            device_recorded_at: new Date(point.timestamp).toISOString(),
          });
          refreshUnsyncedRef.current();
          if (navigator.onLine) {
            void triggerSyncRef.current();
          }
        } catch {
          // Geolocation/queue error ignored for background queue
        }
      })();
    };

    const watchId = navigator.geolocation.watchPosition(onPosition, () => {}, {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 20000,
    });

    return () => {
      navigator.geolocation.clearWatch(watchId);
    };
  }, [isCollectingForGps, journeyIdForGps]);

  // Authenticate and guard
  useEffect(() => {
    async function loadUser() {
      try {
        const res = await fetch('/api/auth/me');
        if (res.ok) {
          const data = await res.json();
          if (!data.user) {
            router.push('/login');
            return;
          }
          const user = data.user;
          const isMotUser = user.role === 'MOT';
          // MOT: must be linked to an active ZMCC. A superior covering MOT work: the server checks scope.
          if (
            user.is_active === false ||
            (!isMotUser && !canCoverMotWork(user.role)) ||
            (isMotUser &&
              (!user.procurement_source_id ||
                !user.procurement_source ||
                user.procurement_source.is_active === false ||
                user.procurement_source.source_type !== 'ZMCC'))
          ) {
            router.push('/workspace-unavailable');
            return;
          }
          setCurrentUser(user);
        } else {
          router.push('/login');
        }
      } catch (err) {
        console.error('Failed to load MOT user', err);
        router.push('/login');
      } finally {
        setLoadingUser(false);
      }
    }
    loadUser();
  }, [router]);

  const isCovering = Boolean(currentUser && currentUser.role !== 'MOT');

  // Fetch current journey with offline fallback (covering: the chosen journey, online only)
  const loadCurrentJourney = useCallback(
    () =>
      resolveCurrentJourney(isCovering ? { journeyId: coverJourneyId } : undefined)
        .then((result) => {
          if (result.journey !== undefined) setJourney(result.journey);
          setJourneyError(result.error);
        })
        .finally(() => setLoadingJourney(false)),
    [isCovering, coverJourneyId]
  );

  useEffect(() => {
    if (currentUser) {
      loadCurrentJourney();
    }
  }, [currentUser, loadCurrentJourney]);

  // Journeys a superior can cover (collecting, own ZMCC; the server applies scope).
  useEffect(() => {
    if (!currentUser || !isCovering || !isOnline) return;
    let alive = true;
    fetch('/api/zmcc/mot/journeys?status=COLLECTING')
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!alive) return;
        if (!res.ok) {
          setCoverListError(data.error || 'Could not load journeys.');
          return;
        }
        setCoverListError(null);
        setCoverJourneys(Array.isArray(data.journeys) ? data.journeys : []);
      })
      .catch(() => {
        if (alive) setCoverListError('Could not load journeys.');
      });
    return () => {
      alive = false;
    };
  }, [currentUser, isCovering, isOnline]);

  // MOT_SHOP test rules: from the server when online (cached for offline use), else the cached copy.
  useEffect(() => {
    if (!currentUser) return;
    let alive = true;
    (async () => {
      try {
        if (navigator.onLine) {
          const res = await fetch('/api/zmcc/mot/shop-policy', { headers: isCovering ? COVER_HEADERS : undefined });
          if (res.ok) {
            const policy = (await res.json()) as MotShopPolicySnapshot;
            await cacheMotShopPolicy(policy);
            if (alive) setShopPolicy(policy);
            return;
          }
        }
      } catch {
        // Offline fallback below
      }
      const cached = await getCachedMotShopPolicy();
      if (alive) setShopPolicy(cached);
    })();
    return () => {
      alive = false;
    };
  }, [currentUser, isCovering, isOnline]);

  // Refresh available ERP milk sources from server or offline cache
  const refreshAvailableSources = useCallback(async (zmccId?: string) => {
    const zId = zmccId || journey?.zmcc?.id || currentUser?.procurement_source?.id;
    if (!zId) return;
    try {
      const res = await fetch(`/api/sources/available?zmcc_id=${zId}`);
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
    setAvailableSources(cached);
  }, [journey?.zmcc?.id, currentUser?.procurement_source?.id]);

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
      const draft = await getDraft(stop.id);
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

  // Handle Request ERP Code from Finance
  const handleRequestErpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const zId = journey?.zmcc?.id || currentUser?.procurement_source?.id;
    if (!zId || !requestErpForm.proposedName.trim()) return;

    setRequestErpSubmitting(true);
    setRequestErpFeedback(null);
    try {
      const res = await fetch('/api/sources/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          zmcc_id: zId,
          proposed_name: requestErpForm.proposedName.trim(),
          proposed_code: requestErpForm.proposedCode.trim() || undefined,
          request_context: 'MOT_COLLECTION',
          notes: requestErpForm.notes.trim() || undefined,
        }),
      });
      if (res.ok) {
        setRequestErpFeedback({ type: 'success', message: 'Request submitted to Finance.' });
        setTimeout(() => {
          setShowRequestErpModal(false);
          setRequestErpForm({ proposedName: '', proposedCode: '', notes: '' });
          setRequestErpFeedback(null);
        }, 1500);
      } else {
        const d = await res.json();
        setRequestErpFeedback({ type: 'error', message: d.error || 'Failed to submit request.' });
      }
    } catch {
      setRequestErpFeedback({ type: 'error', message: 'Network error. Failed to submit request.' });
    } finally {
      setRequestErpSubmitting(false);
    }
  };

  // Save Draft Action
  const handleSaveDraft = async () => {
    if (!activeStop) return;
    try {
      await saveDraft(activeStop.id, {
        shop_rmr_number: shopRmrNumber.trim() || null,
        milk_source_id: selectedSourceId || null,
        quantity,
        unit,
        lr,
        fat,
        notes,
      });
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
      setFormError('You must be online to cover MOT work.');
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

      const testResults: Array<{ lab_test_id: string; value?: number | null; text_value?: string | null }> = [];
      for (const t of shopPolicy?.tests ?? []) {
        if (t.testMode === 'OFF') continue;
        if (t.isLr) testResults.push({ lab_test_id: t.labTestId, value: lrNum });
        else if (t.isFat) testResults.push({ lab_test_id: t.labTestId, value: fatNum });
        else {
          const v = testValues[t.labTestId];
          if (!v) continue;
          const num = v.value.trim() !== '' && Number.isFinite(Number(v.value)) ? Number(v.value) : null;
          const text = v.text.trim() || null;
          if (num !== null || text !== null) testResults.push({ lab_test_id: t.labTestId, value: num, text_value: text });
        }
      }

      const photoEntries = Object.entries(testPhotos);
      const photoMeta: Array<{ captureId: string; meta: PendingPhotoMeta }> = photoEntries.map(([labTestId, p]) => ({
        captureId: p.captureId,
        meta: {
          captureId: p.captureId,
          sha256: p.sha256,
          testingPoint: 'MOT_SHOP',
          entityType: 'mot_shop_collection',
          entityId: null,
          labTestId,
          photoKind: 'TEST_RESULT',
          deviceCapturedAt: p.capturedAt,
          latitude: p.gps?.lat ?? null,
          longitude: p.gps?.lng ?? null,
          gpsAccuracyM: p.gps?.accuracyM ?? null,
          wasOffline: typeof navigator !== 'undefined' ? !navigator.onLine : false,
          width: p.width,
          height: p.height,
          policyVersion: shopPolicy?.version ?? null,
          requestedAs,
        },
      }));

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
        const shopDisplayName = activeStop.shop_name || activeStop.shop?.shop_name || 'Shop';
        const rawPhone = activeStop.phone_number || activeStop.shop?.contact_number || '';
        const digits = rawPhone.replace(/\D/g, '');
        const intlPhone = digits
          ? digits.startsWith('92')
            ? digits
            : digits.startsWith('0')
              ? `92${digits.slice(1)}`
              : `92${digits}`
          : '';

        const receiptMsg = `*SFPL Milk Collection Receipt*\nShop: ${shopDisplayName}\nJourney: #${journey.journey_number}\nVehicle: ${journey.mot_vehicle?.vehicle_number || 'SFPL-MOT'}\nGross: ${preview.grossLiters.toFixed(2)} L\nLR: ${lrNum.toFixed(1)} | Fat: ${fatNum.toFixed(1)}%\nSNF: ${preview.snf.toFixed(2)}% | Total Solids: ${preview.totalSolids.toFixed(2)}%\n@13TS: ${preview.at13TsLiters.toFixed(2)} L\nStatus: ${decisionWord(finalDecision)}\nTime: ${new Date().toLocaleTimeString()} PKT`;

        setCompletedReceiptModal({
          shopName: shopDisplayName,
          phone: rawPhone,
          whatsappUrl: intlPhone ? `https://wa.me/${intlPhone}?text=${encodeURIComponent(receiptMsg)}` : '',
          grossLiters: preview.grossLiters,
          at13tsLiters: preview.at13TsLiters,
          lr: lrNum,
          fat: fatNum,
        });
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

  const openDrawer = useCallback(() => setIsDrawerOpen(true), []);
  const closeDrawer = useCallback(() => {
    setIsDrawerOpen(false);
    setTimeout(() => {
      hamburgerButtonRef.current?.focus();
    }, 0);
  }, []);

  if (loadingUser) {
    return (
      <PageLoader label="Loading MOT…" className="min-h-screen" />
    );
  }

  if (!currentUser) return null;

  return (
    <div className="w-full max-w-full flex flex-col h-screen bg-background text-foreground overflow-hidden">
      <Header
        currentUser={currentUser}
        title="MOT"
        showBranding={true}
        showMenuButton={true}
        onMenuClick={openDrawer}
        menuButtonRef={hamburgerButtonRef}
      />

      <HierarchicalNavDrawer
        currentUser={currentUser}
        isOpen={isDrawerOpen}
        onClose={closeDrawer}
        triggerButtonRef={hamburgerButtonRef}
      />

      <div className="flex-1 flex overflow-hidden">
        <main className="flex-1 overflow-y-auto p-3 sm:p-5 lg:p-6 w-full max-w-5xl mx-auto space-y-4">
          <PageTransition>
          <div className="flex items-center justify-between gap-2 px-3 py-2 sm:px-4 sm:py-2.5 bg-white rounded-xl border border-border shadow-2xs">
            <div className="flex items-center space-x-2 sm:space-x-3 min-w-0">
              <span
                className={`px-2.5 py-1 rounded-full text-xs font-semibold flex items-center space-x-1.5 shrink-0 ${
                  isOnline ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                }`}
              >
                {isOnline ? (
                  <>
                    <Wifi className="w-3.5 h-3.5" />
                    <span>Online</span>
                  </>
                ) : (
                  <>
                    <WifiOff className="w-3.5 h-3.5" />
                    <span>Offline</span>
                  </>
                )}
              </span>

              <span className="text-xs text-slate-600 font-semibold truncate">
                {unsyncedCount > 0 ? (
                  <span className="text-primary font-semibold">{unsyncedCount} pending sync</span>
                ) : (
                  'All synced'
                )}
              </span>

              {lastSyncTime && (
                <span className="hidden md:inline text-[11px] text-slate-400 tabular-nums">
                  Synced {lastSyncTime}
                </span>
              )}
            </div>

            <div className="flex items-center space-x-2 shrink-0">
              {syncFeedback && (
                <span className="hidden sm:inline text-xs font-semibold text-emerald-700">{syncFeedback}</span>
              )}
              <button
                type="button"
                onClick={triggerSync}
                disabled={syncing || !isOnline}
                className="min-h-[44px] px-3.5 py-2 rounded-xl bg-primary text-white text-xs font-semibold hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed shadow-2xs flex items-center space-x-1.5 focus:outline-hidden focus:ring-2 focus:ring-primary"
              >
                <span>{syncing ? 'Syncing…' : 'Sync Now'}</span>
              </button>
            </div>
          </div>

          {isCovering && (
            <div className="p-3 sm:p-4 rounded-xl border-2 border-violet-300 bg-violet-50 text-violet-900 space-y-3">
              <div className="flex items-start gap-2">
                <UserCog className="w-5 h-5 shrink-0 mt-0.5" aria-hidden="true" />
                <div>
                  <p className="text-sm font-bold">Covering MOT work</p>
                  <p className="text-xs">
                    You are doing MOT work as {getRoleLabel(currentUser.role)}. This needs the internet.
                  </p>
                </div>
              </div>
              {!isOnline ? (
                <p className="text-xs font-semibold flex items-center gap-1.5">
                  <WifiOff className="w-4 h-4" aria-hidden="true" />
                  You are offline. Connect to the internet to cover MOT work.
                </p>
              ) : (
                <div>
                  <label htmlFor="cover-journey" className="block text-xs font-semibold mb-1">
                    Choose a journey
                  </label>
                  <select
                    id="cover-journey"
                    value={coverJourneyId ?? ''}
                    onChange={(e) => {
                      setLoadingJourney(true);
                      setJourney(null);
                      setCoverJourneyId(e.target.value || null);
                    }}
                    className="w-full min-h-[48px] text-sm font-semibold border border-violet-300 rounded-xl p-2.5 bg-white focus:ring-2 focus:ring-violet-500"
                  >
                    <option value="">Choose…</option>
                    {coverJourneys.map((j) => (
                      <option key={j.id} value={j.id}>
                        #{j.journey_number} · {j.mot_profile?.name || j.mot_profile?.mot_code || 'MOT'} ·{' '}
                        {j.route?.name || j.route?.route_code || 'Route'}
                        {j.mot_vehicle?.vehicle_number ? ` · ${j.mot_vehicle.vehicle_number}` : ''}
                      </option>
                    ))}
                  </select>
                  {coverListError && <p className="mt-1 text-xs font-semibold text-red-700">{coverListError}</p>}
                  {!coverListError && coverJourneys.length === 0 && (
                    <p className="mt-1 text-xs">No journey is collecting milk right now.</p>
                  )}
                </div>
              )}
            </div>
          )}

          {isCovering && (!isOnline || !coverJourneyId) ? null : loadingJourney ? (
            <div className="p-12 text-center text-xs font-semibold text-slate-500 bg-white rounded-xl border border-border">
              <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2 text-primary" />
              Checking assigned route…
            </div>
          ) : journeyError ? (
            <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-xs font-semibold flex items-center space-x-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
              <span>{journeyError}</span>
            </div>
          ) : !journey ? (
            <div className="p-10 bg-white rounded-xl border border-border shadow-2xs text-center space-y-3">
              <div className="w-12 h-12 rounded-full bg-blue-50 text-primary flex items-center justify-center mx-auto">
                <Truck className="w-6 h-6" />
              </div>
              <h2 className="text-base font-semibold text-foreground">No Active Journey Assigned</h2>
              <p className="text-xs text-slate-500 max-w-md mx-auto">
                A milk collection journey has not been dispatched to this unit yet.
              </p>
            </div>
          ) : (
            (() => {
              const visitedStops = journey.stops.filter((s) => s.status === 'VISITED');
              const skippedStops = journey.stops.filter((s) => s.status === 'SKIPPED');
              const rejectedStops = journey.stops.filter((s) => s.status === 'REJECTED');
              const pendingStops = journey.stops.filter(
                (s) => s.status !== 'VISITED' && s.status !== 'SKIPPED' && s.status !== 'REJECTED'
              );
              const nextPendingStop = pendingStops[0] || null;
              // Totals count accepted milk only (waiting for the Zonal Manager is left out until decided).
              const acceptedStops = visitedStops.filter(
                (s) => s.collection?.final_decision !== 'PENDING' && s.collection?.final_decision !== 'REJECTED'
              );
              const totalGross = acceptedStops.reduce(
                (sum, s) => sum + (s.collection?.gross_liters || 0),
                0
              );
              const totalAt13ts = acceptedStops.reduce(
                (sum, s) => sum + (s.collection?.at_13ts_liters || 0),
                0
              );

              const computedStops = journey.stops.map((s) => {
                const lat = s.planned_latitude_snapshot ?? s.planned_latitude ?? null;
                const lng = s.planned_longitude_snapshot ?? s.planned_longitude ?? null;
                const hasCoordinates = lat != null && lng != null && !(Number(lat) === 0 && Number(lng) === 0);
                const distanceKm =
                  deviceGps && hasCoordinates
                    ? computeHaversineDistanceKm(deviceGps.latitude, deviceGps.longitude, Number(lat), Number(lng))
                    : null;
                return {
                  ...s,
                  hasCoordinates,
                  distanceKm,
                };
              });

              const sortedStops = [...computedStops].sort((a, b) => {
                if (a.distanceKm != null && b.distanceKm != null) {
                  return a.distanceKm - b.distanceKm;
                }
                if (a.distanceKm != null && b.distanceKm == null) return -1;
                if (a.distanceKm == null && b.distanceKm != null) return 1;
                if (a.hasCoordinates && !b.hasCoordinates) return -1;
                if (!a.hasCoordinates && b.hasCoordinates) return 1;
                return a.planned_sequence - b.planned_sequence;
              });

              const totalStopsPages = Math.ceil(sortedStops.length / stopsPerPage) || 1;
              const pagedStops = sortedStops.slice((stopsPage - 1) * stopsPerPage, stopsPage * stopsPerPage);

              const matchingSearchStops = shopSearchQuery.trim()
                ? journey.stops.filter((s) => {
                    const q = shopSearchQuery.toLowerCase().trim();
                    const sName = (s.shop_name || s.shop?.shop_name || '').toLowerCase();
                    const sCode = (s.shop_code || s.shop?.shop_code || '').toLowerCase();
                    const oName = (s.owner_name || s.shop?.owner_name || '').toLowerCase();
                    const aName = (s.area_name || s.area_code || '').toLowerCase();
                    return sName.includes(q) || sCode.includes(q) || oName.includes(q) || aName.includes(q);
                  })
                : journey.stops;

              return (
                <div className="space-y-4">
                  <div className="p-4 sm:p-5 bg-white rounded-xl border border-border shadow-2xs space-y-3">
                    <div className="flex items-center justify-between border-b border-border pb-3">
                      <div>
                        <span className="text-[10px] font-semibold uppercase text-slate-500 tracking-wider block">
                          Active Journey
                        </span>
                        <div className="flex items-center space-x-2 mt-0.5">
                          <h2 className="text-base sm:text-lg tabular-nums font-semibold text-primary">
                            #{journey.journey_number}
                          </h2>
                          <span className="text-xs font-semibold text-foreground truncate">
                            {journey.route?.name || journey.route?.route_code || 'Assigned Route'}
                          </span>
                        </div>
                      </div>

                      <div className="text-right">
                        <span className="text-[10px] font-semibold text-slate-500 block uppercase">Vehicle</span>
                        <span className="tabular-nums font-semibold text-sm text-foreground">
                          {journey.mot_vehicle?.vehicle_number || '—'}
                        </span>
                      </div>
                    </div>

                    <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 sm:gap-3 text-center">
                      <div className="p-2 sm:p-2.5 rounded-xl bg-subtle border border-border">
                        <span className="text-[10px] font-semibold text-slate-500 uppercase block">Assigned</span>
                        <span className="font-semibold text-xs sm:text-sm text-slate-900 tabular-nums">
                          {journey.stops.length}
                        </span>
                      </div>
                      <div className="p-2 sm:p-2.5 rounded-xl bg-emerald-50/70 border border-emerald-300">
                        <span className="text-[10px] font-semibold text-emerald-800 uppercase block">Collected</span>
                        <span className="font-semibold text-xs sm:text-sm text-emerald-950 tabular-nums">
                          {visitedStops.length}
                        </span>
                      </div>
                      <div className="p-2 sm:p-2.5 rounded-xl bg-rose-50/70 border border-rose-300">
                        <span className="text-[10px] font-semibold text-rose-800 uppercase block">Skipped / Rejected</span>
                        <span className="font-semibold text-xs sm:text-sm text-rose-950 tabular-nums">
                          {skippedStops.length} / {rejectedStops.length}
                        </span>
                      </div>
                      <div className="p-2 sm:p-2.5 rounded-xl bg-blue-50/70 border border-blue-200">
                        <span className="text-[10px] font-semibold text-blue-800 uppercase block">Milk (L)</span>
                        <span className="font-semibold text-xs sm:text-sm text-blue-950 tabular-nums">
                          {totalGross.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 2 })} L
                        </span>
                      </div>
                      <div className="p-2 sm:p-2.5 rounded-xl bg-emerald-50/70 border border-emerald-300">
                        <span className="text-[10px] font-semibold text-emerald-800 uppercase block">@13TS (L)</span>
                        <span className="font-semibold text-xs sm:text-sm text-emerald-950 tabular-nums">
                          {totalAt13ts.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 2 })} L
                        </span>
                      </div>
                    </div>

                    {nextPendingStop && (
                      <div className="mt-2 p-3 sm:p-3.5 bg-muted/70 border border-border rounded-xl flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                        <div className="flex items-center space-x-2.5">
                          <span className="w-7 h-7 rounded-lg bg-primary text-white tabular-nums font-semibold text-xs flex items-center justify-center shrink-0">
                            {nextPendingStop.planned_sequence}
                          </span>
                          <div>
                            <span className="text-[10px] font-semibold text-slate-500 uppercase block">
                              Next Stop
                            </span>
                            <span className="font-semibold text-xs sm:text-sm text-foreground">
                              {nextPendingStop.shop_name || nextPendingStop.shop?.shop_name || 'Shop'}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center space-x-2 w-full sm:w-auto">
                          <button
                            type="button"
                            onClick={() => handleOpenSkipModal(nextPendingStop)}
                            className="min-h-[44px] flex-1 sm:flex-none px-3.5 py-2 border border-rose-300 bg-rose-50/60 hover:bg-rose-100 text-rose-800 rounded-xl font-semibold text-xs shadow-2xs transition focus:outline-hidden focus:ring-2 focus:ring-rose-500"
                          >
                            Skip Shop
                          </button>
                          <button
                            type="button"
                            onClick={() => handleOpenCollectionModal(nextPendingStop)}
                            className="min-h-[44px] flex-1 sm:flex-none px-4 py-2 bg-primary hover:bg-primary-hover text-white rounded-xl font-semibold text-xs shadow-2xs transition flex items-center justify-center space-x-1.5 focus:outline-hidden focus:ring-2 focus:ring-primary"
                          >
                            <span>Record Collection</span>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="bg-white rounded-xl border border-border shadow-2xs overflow-hidden">
                    <div className="p-3 sm:p-4 border-b border-border space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-2">
                          <Store className="w-4 h-4 text-primary" />
                          <h3 className="text-xs sm:text-sm font-semibold text-foreground">
                            Planned Stops ({journey.stops.length})
                          </h3>
                        </div>
                        <div className="flex items-center space-x-2">
                          <span className="text-[11px] font-medium text-slate-500">
                            {visitedStops.length} of {journey.stops.length} completed
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              setIsShopRequestModalOpen(true);
                              setShopRequestError(null);
                              setShopRequestSuccess(null);
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-lg bg-primary text-white hover:bg-primary/90 transition shadow-2xs"
                          >
                            <Plus className="w-3.5 h-3.5" />
                            <span>Request Shop</span>
                          </button>
                        </div>
                      </div>

                      <div ref={searchDropdownRef} className="relative">
                        <div className="relative">
                          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                            <Search className="w-4 h-4" />
                          </div>
                          <input
                            type="text"
                            value={shopSearchQuery}
                            onChange={(e) => {
                              setShopSearchQuery(e.target.value);
                              setIsSearchOpen(true);
                            }}
                            onFocus={() => setIsSearchOpen(true)}
                            placeholder="Type to search or select shop…"
                            className="w-full text-xs font-semibold pl-9 pr-8 py-2.5 bg-subtle border border-border rounded-xl text-foreground focus:ring-2 focus:ring-primary focus:bg-white outline-hidden"
                          />
                          {shopSearchQuery && (
                            <button
                              type="button"
                              onClick={() => {
                                setShopSearchQuery('');
                                setIsSearchOpen(false);
                              }}
                              className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>

                        {isSearchOpen && (
                          <div className="absolute z-30 left-0 right-0 mt-1 max-h-60 overflow-y-auto bg-card border border-border rounded-xl shadow-lg divide-y divide-border">
                            {matchingSearchStops.length === 0 ? (
                              <div className="p-3 text-center text-xs text-slate-400">
                                No matching shops found
                              </div>
                            ) : (
                              matchingSearchStops.map((stop) => {
                                const sName = stop.shop_name || stop.shop?.shop_name || 'Shop';
                                const sCode = stop.shop_code || stop.shop?.shop_code || '—';
                                const isVisited = stop.status === 'VISITED';
                                const isSkipped = stop.status === 'SKIPPED';
                                const isRejected = stop.status === 'REJECTED';
                                return (
                                  <button
                                    key={stop.id}
                                    type="button"
                                    onClick={() => {
                                      setIsSearchOpen(false);
                                      setShopSearchQuery('');
                                      if (!isVisited && !isSkipped && !isRejected) handleOpenCollectionModal(stop);
                                    }}
                                    className="w-full p-2.5 text-left flex items-center justify-between hover:bg-subtle transition"
                                  >
                                    <div className="flex items-center space-x-2">
                                      <span className="w-6 h-6 rounded-md bg-muted text-slate-700 text-xs font-semibold flex items-center justify-center shrink-0">
                                        {stop.planned_sequence}
                                      </span>
                                      <div>
                                        <div className="text-xs font-semibold text-foreground">
                                          {sName} <span className="text-[10px] text-slate-500 font-normal">({sCode})</span>
                                        </div>
                                        <div className="text-[10px] text-slate-500">
                                          {stop.area_name || stop.area_code || 'No area'}
                                        </div>
                                      </div>
                                    </div>
                                    <div className="flex items-center space-x-1.5">
                                      {isVisited ? (
                                        <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-100 text-emerald-800">
                                          Completed
                                        </span>
                                      ) : isSkipped ? (
                                        <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-rose-100 text-rose-800">
                                          Skipped
                                        </span>
                                      ) : isRejected ? (
                                        <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-red-100 text-red-800">
                                          Rejected
                                        </span>
                                      ) : (
                                        <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-primary text-white">
                                          Select
                                        </span>
                                      )}
                                    </div>
                                  </button>
                                );
                              })
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="divide-y divide-border">
                      {pagedStops.map((stop) => {
                        const shopName = stop.shop_name || stop.shop?.shop_name || 'Shop';
                        const shopCode = stop.shop_code || stop.shop?.shop_code || '—';
                        const ownerName = stop.owner_name || stop.shop?.owner_name || '—';
                        const areaName = stop.area_name || stop.area_code || '';
                        const isVisited = stop.status === 'VISITED';
                        const isSkipped = stop.status === 'SKIPPED';
                        const isRejected = stop.status === 'REJECTED';
                        const isPending = !isVisited && !isSkipped && !isRejected;
                        const waitingDecision = isVisited && stop.collection?.final_decision === 'PENDING';

                        return (
                          <div
                            key={stop.id}
                            className="p-3.5 sm:p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 hover:bg-subtle transition"
                          >
                            <div className="flex items-start space-x-3 min-w-0">
                              <span
                                className={`w-7 h-7 rounded-lg text-xs tabular-nums font-semibold flex items-center justify-center shrink-0 mt-0.5 ${
                                  isVisited
                                    ? 'bg-emerald-600 text-white'
                                    : isRejected
                                    ? 'bg-red-100 text-red-800 border border-red-300'
                                    : isSkipped
                                    ? 'bg-rose-100 text-rose-800 border border-rose-300'
                                    : 'bg-muted text-slate-700 border border-border-strong'
                                }`}
                              >
                                {stop.planned_sequence}
                              </span>
                              <div className="space-y-1 min-w-0">
                                <div className="flex items-center space-x-2 flex-wrap gap-y-1">
                                  <span className="text-xs font-semibold text-foreground">
                                    {shopName}
                                  </span>
                                  <span className="text-[10px] tabular-nums text-slate-500">
                                    ({shopCode})
                                  </span>
                                  {waitingDecision ? (
                                    <DecisionStatusBadge status="PENDING" />
                                  ) : isVisited ? (
                                    <span className="px-2 py-0.5 rounded-md text-[10px] font-semibold uppercase bg-emerald-100 text-emerald-800 border border-emerald-300">
                                      Completed ({Number(stop.collection?.gross_liters || 0).toFixed(1)} L)
                                    </span>
                                  ) : isRejected ? (
                                    <DecisionStatusBadge status="REJECTED" />
                                  ) : isSkipped ? (
                                    <span className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-rose-100 text-rose-900 border border-rose-300">
                                      SKIPPED {stop.skip_reason ? `· ${stop.skip_reason}` : ''}
                                    </span>
                                  ) : (
                                    <span className="px-2 py-0.5 rounded-md text-[10px] font-semibold uppercase bg-slate-100 text-slate-700 border border-slate-300">
                                      Pending
                                    </span>
                                  )}
                                  {stop.distanceKm != null && (
                                    <span className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-blue-50 text-blue-800 border border-blue-200">
                                      {formatDistance(stop.distanceKm)}
                                    </span>
                                  )}
                                </div>

                                <p className="text-[11px] text-slate-500">
                                  Owner: {ownerName}
                                </p>

                                <div className="text-[11px] text-slate-500 flex items-center space-x-2 flex-wrap gap-y-1">
                                  {areaName && <span>Area: {areaName}</span>}
                                  {!stop.hasCoordinates && (
                                    <span className="px-1.5 py-0.5 rounded-md text-[10px] font-semibold bg-slate-100 text-slate-700 border border-slate-200">
                                      Geotag on 1st Visit
                                    </span>
                                  )}
                                </div>

                                {isVisited && stop.collection && (
                                  <div className="mt-2 space-y-2">
                                    <div className="p-2 rounded-lg bg-emerald-50/70 border border-emerald-200 text-[11px] tabular-nums font-semibold text-emerald-950 flex flex-wrap gap-x-3 gap-y-1">
                                      <span>Gross: {Number(stop.collection.gross_liters).toFixed(2)} L</span>
                                      <span>@13TS: {Number(stop.collection.at_13ts_liters).toFixed(2)} L</span>
                                      <span>LR: {stop.collection.lr}</span>
                                      <span>Fat: {stop.collection.fat}%</span>
                                    </div>
                                    {(() => {
                                      const rawPhone = stop.phone_number || stop.shop?.contact_number || '';
                                      if (!rawPhone) return null;
                                      const digits = rawPhone.replace(/\D/g, '');
                                      const intlPhone = digits.startsWith('92')
                                        ? digits
                                        : digits.startsWith('0')
                                          ? `92${digits.slice(1)}`
                                          : `92${digits}`;
                                      const msg = `*SFPL Milk Collection Receipt*\nShop: ${shopName}\nJourney: #${journey?.journey_number || '101'}\nVehicle: ${journey?.mot_vehicle?.vehicle_number || 'SFPL-MOT'}\nGross: ${Number(stop.collection.gross_liters).toFixed(2)} L\nLR: ${stop.collection.lr} | Fat: ${stop.collection.fat}%\n@13TS: ${Number(stop.collection.at_13ts_liters).toFixed(2)} L\nStatus: ${decisionWord(stop.collection.final_decision)}`;
                                      return (
                                        <a
                                          href={`https://wa.me/${intlPhone}?text=${encodeURIComponent(msg)}`}
                                          target="_blank"
                                          rel="noreferrer"
                                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold bg-emerald-600 hover:bg-emerald-700 text-white transition shadow-2xs focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
                                        >
                                          <MessageSquare className="w-3.5 h-3.5" />
                                          <span>WhatsApp Receipt ({rawPhone})</span>
                                        </a>
                                      );
                                    })()}
                                  </div>
                                )}
                              </div>
                            </div>

                            {isPending && (
                              <div className="flex items-center space-x-2 self-end sm:self-center">
                                <button
                                  type="button"
                                  onClick={() => handleOpenSkipModal(stop)}
                                  className="min-h-[44px] px-3.5 py-2 rounded-xl border border-rose-300 bg-rose-50/60 hover:bg-rose-100 text-rose-800 text-xs font-semibold transition shadow-2xs focus:outline-hidden focus:ring-2 focus:ring-rose-500"
                                >
                                  Skip Shop
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleOpenCollectionModal(stop)}
                                  className="min-h-[44px] px-3.5 py-2 rounded-xl bg-primary text-white text-xs font-semibold hover:bg-primary-hover transition shadow-2xs focus:outline-hidden focus:ring-2 focus:ring-primary"
                                >
                                  Record Collection
                                </button>
                              </div>
                            )}
                          </div>
                        );
                      })}

                      {totalStopsPages > 1 && (
                        <div className="flex items-center justify-between p-3.5 bg-subtle border-t border-border">
                          <span className="text-xs text-slate-500 font-medium">
                            Showing {(stopsPage - 1) * stopsPerPage + 1}–{Math.min(stopsPage * stopsPerPage, sortedStops.length)} of {sortedStops.length} shops
                          </span>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              disabled={stopsPage === 1}
                              onClick={() => setStopsPage((p) => Math.max(1, p - 1))}
                              className="p-1.5 rounded-lg border border-border text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                              <ChevronLeft className="w-4 h-4" />
                            </button>
                            <span className="text-xs font-semibold text-foreground">
                              {stopsPage} / {totalStopsPages}
                            </span>
                            <button
                              type="button"
                              disabled={stopsPage >= totalStopsPages}
                              onClick={() => setStopsPage((p) => Math.min(totalStopsPages, p + 1))}
                              className="p-1.5 rounded-lg border border-border text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                              <ChevronRight className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })()
          )}

          <AnimatePresence>{activeStop && (
            <Modal
              key="modal-0"
              onClose={() => setActiveStop(null)}
              title="Collection stop"
              preventClose={submittingCollection}
              className="max-w-lg overflow-hidden"
            >
              <ShopCollectionWizard
                key={activeStop.id}
                shopLabel={`${activeStop.shop_name || activeStop.shop?.shop_name || 'Shop'} (${activeStop.shop_code || activeStop.shop?.shop_code || ''})`}
                sequence={activeStop.planned_sequence}
                gpsStatus={collectionGps.status}
                gpsAccuracy={collectionGps.accuracy}
                gpsBadge={gpsBadge}
                formError={formError}
                rmrNumber={shopRmrNumber}
                onRmrNumberChange={setShopRmrNumber}
                sources={availableSources}
                selectedSourceId={selectedSourceId}
                onSourceChange={setSelectedSourceId}
                onRequestErpCode={() => {
                  setRequestErpFeedback(null);
                  setRequestErpForm({ proposedName: '', proposedCode: '', notes: '' });
                  setShowRequestErpModal(true);
                }}
                quantity={quantity}
                onQuantityChange={setQuantity}
                unit={unit}
                onUnitChange={setUnit}
                tests={{
                  policy: shopPolicy,
                  lr,
                  fat,
                  onLrChange: setLr,
                  onFatChange: setFat,
                  values: testValues,
                  onValueChange: (labTestId, patch) =>
                    setTestValues((prev) => ({
                      ...prev,
                      [labTestId]: { ...(prev[labTestId] ?? { value: '', text: '' }), ...patch },
                    })),
                  photos: testPhotos,
                  onPhotoTaken: (test, result) => void handlePhotoTaken(test, result),
                  onPhotoRemoved: handlePhotoRemoved,
                  stamp: {
                    employeeCode: currentUser.username,
                    roleLabel: getRoleLabel(currentUser.role),
                    actingAsLabel: isCovering ? getRoleLabel('MOT') : null,
                    vehicleNo: journey?.mot_vehicle?.vehicle_number || null,
                    tokenNo: shopRmrNumber || null,
                  },
                  disabled: submittingCollection,
                }}
                livePreview={livePreview}
                notes={notes}
                onNotesChange={setNotes}
                decision={{
                  tests: decisionRows,
                  decision: decisionPreview?.decision ?? null,
                  personDecision,
                  onPersonDecisionChange: setPersonDecision,
                  remarks: decisionRemarks,
                  onRemarksChange: setDecisionRemarks,
                  warnings: decisionPreview?.details.warnings ?? [],
                  approverLabel: 'Zonal Manager',
                  routeLabels: {
                    PROCEED: 'Submit & complete shop',
                    REJECT: 'Reject & complete shop',
                    SEND_TO_APPROVER: 'Send request to Zonal Manager',
                    DECIDE_NOW: 'Decide now',
                  },
                  onSubmit: () => void handleRecordCollection(),
                  submitting: submittingCollection,
                }}
                onSaveDraft={handleSaveDraft}
                onClose={() => setActiveStop(null)}
              />
            </Modal>
          )}</AnimatePresence>

          <AnimatePresence>
            {skipModalStop && (
              <Modal
                key="modal-skip-shop"
                onClose={() => setSkipModalStop(null)}
                title="Skip Shop"
                className="max-w-md overflow-hidden flex flex-col"
              >
                <div className="p-4 border-b border-border flex items-center justify-between bg-subtle">
                  <div className="flex items-center space-x-2">
                    <span className="w-6 h-6 rounded-full bg-rose-600 text-white text-xs font-semibold flex items-center justify-center shrink-0">
                      {skipModalStop.planned_sequence}
                    </span>
                    <div>
                      <h3 className="text-sm font-semibold text-foreground">
                        {skipModalStop.shop_name || skipModalStop.shop?.shop_name} ({skipModalStop.shop_code || skipModalStop.shop?.shop_code})
                      </h3>
                      <p className="text-[11px] text-slate-500">Record Skip Reason</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSkipModalStop(null)}
                    className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div className="p-4 space-y-3">
                  {skipError && (
                    <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center space-x-2">
                      <AlertCircle className="w-4 h-4 shrink-0" />
                      <span>{skipError}</span>
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Reason for Skipping <span className="text-rose-500">*</span>
                    </label>
                    <textarea
                      rows={4}
                      value={skipReason}
                      onChange={(e) => setSkipReason(e.target.value)}
                      placeholder="Enter reason for skipping shop (e.g. Shop closed, Owner unavailable, Insufficient milk)…"
                      className="w-full min-w-0 resize-y break-words text-xs font-medium border border-border rounded-xl p-3 bg-white text-foreground focus:ring-2 focus:ring-rose-500 outline-hidden"
                    />
                  </div>
                </div>

                <div className="p-4 border-t border-border bg-subtle flex items-center justify-end space-x-2">
                  <button
                    type="button"
                    onClick={() => setSkipModalStop(null)}
                    className="px-4 py-2 rounded-xl border border-border text-slate-700 text-xs font-semibold hover:bg-slate-100"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={submittingSkip}
                    onClick={handleConfirmSkip}
                    className="px-4 py-2 rounded-xl bg-rose-700 hover:bg-rose-800 text-white text-xs font-semibold shadow-2xs transition disabled:opacity-50"
                  >
                    {submittingSkip ? 'Skipping…' : 'Confirm Skip'}
                  </button>
                </div>
              </Modal>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {isShopRequestModalOpen && (
              <Modal
                key="modal-request-shop"
                onClose={() => setIsShopRequestModalOpen(false)}
                title="Request New Shop in Field"
                className="max-w-md overflow-hidden flex flex-col"
              >
                <div className="p-4 border-b border-border flex items-center justify-between bg-subtle">
                  <div className="flex items-center space-x-2">
                    <Store className="w-5 h-5 text-primary shrink-0" />
                    <div>
                      <h3 className="text-sm font-semibold text-foreground">
                        Field Shop Registration
                      </h3>
                      <p className="text-[11px] text-slate-500">Route: {journey?.route?.name || 'Current Route'}</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsShopRequestModalOpen(false)}
                    className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <form onSubmit={handleSubmitShopRequest} className="p-4 space-y-3">
                  {shopRequestError && (
                    <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center space-x-2">
                      <AlertCircle className="w-4 h-4 shrink-0" />
                      <span>{shopRequestError}</span>
                    </div>
                  )}

                  {shopRequestSuccess && (
                    <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center space-x-2">
                      <CheckCircle2 className="w-4 h-4 shrink-0" />
                      <span>{shopRequestSuccess}</span>
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Shop Name <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={shopRequestForm.shop_name}
                      onChange={(e) => setShopRequestForm({ ...shopRequestForm, shop_name: e.target.value })}
                      placeholder="e.g. Al-Madina Dairy"
                      className="w-full text-xs font-medium border border-border rounded-xl p-2.5 bg-white text-foreground focus:ring-2 focus:ring-primary outline-hidden"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Owner Name <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={shopRequestForm.owner_name}
                      onChange={(e) => setShopRequestForm({ ...shopRequestForm, owner_name: e.target.value })}
                      placeholder="e.g. Shop Owner"
                      className="w-full text-xs font-medium border border-border rounded-xl p-2.5 bg-white text-foreground focus:ring-2 focus:ring-primary outline-hidden"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Mobile Phone <span className="text-rose-500">*</span>
                      </label>
                      <input
                        type="text"
                        required
                        value={shopRequestForm.phone_number}
                        onChange={(e) => setShopRequestForm({ ...shopRequestForm, phone_number: e.target.value })}
                        placeholder="03XXXXXXXXX"
                        className="w-full text-xs font-medium border border-border rounded-xl p-2.5 bg-white text-foreground focus:ring-2 focus:ring-primary outline-hidden"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        CNIC <span className="text-rose-500">*</span>
                      </label>
                      <input
                        type="text"
                        required
                        value={shopRequestForm.cnic}
                        onChange={(e) => setShopRequestForm({ ...shopRequestForm, cnic: e.target.value })}
                        placeholder="35201-1234567-1"
                        className="w-full text-xs font-medium border border-border rounded-xl p-2.5 bg-white text-foreground focus:ring-2 focus:ring-primary outline-hidden"
                      />
                    </div>
                  </div>

                  <div className="p-2.5 rounded-xl bg-subtle border border-border text-[11px] text-slate-600 flex items-center justify-between">
                    <span className="font-medium flex items-center gap-2">
                      Device GPS: {gpsBadge}
                    </span>
                    <span className="font-semibold text-foreground">
                      {deviceGps ? `${deviceGps.latitude.toFixed(6)}, ${deviceGps.longitude.toFixed(6)}` : 'Waiting for GPS…'}
                    </span>
                  </div>

                  <div className="pt-2 border-t border-border flex items-center justify-end space-x-2">
                    <button
                      type="button"
                      onClick={() => setIsShopRequestModalOpen(false)}
                      className="px-4 py-2 rounded-xl border border-border text-slate-700 text-xs font-semibold hover:bg-slate-100"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={submittingShopRequest}
                      className="px-4 py-2 rounded-xl bg-primary hover:bg-primary/90 text-white text-xs font-semibold shadow-2xs transition disabled:opacity-50"
                    >
                      {submittingShopRequest ? 'Submitting…' : 'Submit Request'}
                    </button>
                  </div>
                </form>
              </Modal>
            )}

            {completedReceiptModal && (
              <Modal
                key="completed-receipt-modal"
                onClose={() => setCompletedReceiptModal(null)}
                title="Collection Saved & WhatsApp Receipt"
                className="max-w-md overflow-hidden"
              >
                <div className="p-4 space-y-4">
                  <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-950 flex items-start space-x-3">
                    <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                    <div>
                      <h4 className="text-xs font-bold uppercase tracking-wider text-emerald-900">Collection Recorded Successfully</h4>
                      <p className="text-xs text-emerald-800 mt-0.5">
                        {completedReceiptModal.shopName} · {completedReceiptModal.grossLiters.toFixed(1)} L (@13TS: {completedReceiptModal.at13tsLiters.toFixed(1)} L)
                      </p>
                    </div>
                  </div>

                  <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs space-y-1">
                    <div className="flex justify-between text-slate-600">
                      <span>Shop / Recipient:</span>
                      <strong className="text-foreground">{completedReceiptModal.shopName}</strong>
                    </div>
                    <div className="flex justify-between text-slate-600">
                      <span>WhatsApp Number:</span>
                      <strong className="text-foreground font-mono">{completedReceiptModal.phone}</strong>
                    </div>
                    <div className="flex justify-between text-slate-600">
                      <span>LR / Fat:</span>
                      <strong className="text-foreground">{completedReceiptModal.lr} / {completedReceiptModal.fat}%</strong>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <a
                      href={completedReceiptModal.whatsappUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => setCompletedReceiptModal(null)}
                      className="w-full flex items-center justify-center space-x-2 py-3 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs shadow-md transition"
                    >
                      <MessageSquare className="w-4 h-4" />
                      <span>Send WhatsApp Receipt ({completedReceiptModal.phone})</span>
                    </a>

                    <button
                      type="button"
                      onClick={() => setCompletedReceiptModal(null)}
                      className="w-full py-2.5 px-4 rounded-xl border border-border text-slate-700 hover:bg-subtle text-xs font-semibold transition"
                    >
                      Done / Proceed to Next Shop
                    </button>
                  </div>
                </div>
              </Modal>
            )}

            {showRequestErpModal && (
              <Modal
                key="modal-request-erp"
                onClose={() => setShowRequestErpModal(false)}
                title="Request New ERP Code"
                className="max-w-md overflow-hidden flex flex-col"
              >
                <div className="p-4 border-b border-border flex items-center justify-between bg-subtle">
                  <h3 className="text-sm font-semibold text-foreground">
                    Request New ERP Code
                  </h3>
                  <button
                    type="button"
                    onClick={() => setShowRequestErpModal(false)}
                    className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <form onSubmit={handleRequestErpSubmit} className="p-4 space-y-3">
                  {requestErpFeedback && (
                    <div
                      className={`p-3 rounded-xl text-xs font-semibold ${
                        requestErpFeedback.type === 'success'
                          ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                          : 'bg-rose-50 text-rose-800 border border-rose-200'
                      }`}
                    >
                      {requestErpFeedback.message}
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-semibold text-foreground mb-1">
                      Proposed Source Name <span className="text-rose-600">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={requestErpForm.proposedName}
                      onChange={(e) =>
                        setRequestErpForm((prev) => ({ ...prev, proposedName: e.target.value }))
                      }
                      placeholder="e.g. Bhalwal Dairy Hub"
                      className="w-full text-xs font-semibold border border-border rounded-xl p-2.5 bg-subtle focus:ring-2 focus:ring-primary"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-foreground mb-1">
                      Proposed ERP Code (Optional)
                    </label>
                    <input
                      type="text"
                      value={requestErpForm.proposedCode}
                      onChange={(e) =>
                        setRequestErpForm((prev) => ({ ...prev, proposedCode: e.target.value }))
                      }
                      placeholder="e.g. 1045"
                      className="w-full text-xs font-semibold border border-border rounded-xl p-2.5 bg-subtle focus:ring-2 focus:ring-primary"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-foreground mb-1">
                      Notes / Rationale (Optional)
                    </label>
                    <textarea
                      rows={3}
                      value={requestErpForm.notes}
                      onChange={(e) =>
                        setRequestErpForm((prev) => ({ ...prev, notes: e.target.value }))
                      }
                      placeholder="Enter context or shop details…"
                      className="w-full min-w-0 resize-y break-words text-xs border border-border rounded-xl p-2.5 bg-subtle focus:ring-2 focus:ring-primary"
                    />
                  </div>

                  <div className="flex items-center justify-end space-x-2 pt-2 border-t border-border">
                    <button
                      type="button"
                      onClick={() => setShowRequestErpModal(false)}
                      className="px-4 py-2 rounded-xl border border-border text-xs font-semibold text-slate-700 hover:bg-slate-100 min-h-[40px]"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={requestErpSubmitting || !requestErpForm.proposedName.trim()}
                      className="px-4 py-2 rounded-xl bg-primary text-white text-xs font-semibold hover:bg-primary-hover transition disabled:opacity-50 min-h-[40px]"
                    >
                      {requestErpSubmitting ? 'Submitting…' : 'Submit Request'}
                    </button>
                  </div>
                </form>
              </Modal>
            )}
          </AnimatePresence>
          </PageTransition>
        </main>
      </div>
    </div>
  );
}
