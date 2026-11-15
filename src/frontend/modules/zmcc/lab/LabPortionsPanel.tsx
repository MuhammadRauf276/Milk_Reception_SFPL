'use client';

import { SkeletonList } from '@/components/ui/loaders';
import { formatDateTime } from '@/lib/format';
import { useCurrentUser } from '@/frontend/hooks/useCurrentUser';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { fetchJson } from '@/lib/query/fetchJson';
import { apiClient, ApiError } from '@/frontend/lib/apiClient';
import {
  AlertTriangle,
  Camera,
  Check,
  CheckCircle2,
  Edit3,
  FlaskConical,
  Loader2,
  PlusCircle,
  Send,
  Trash2,
  X,
  XCircle,
} from 'lucide-react';
import { LiveCamera } from '@/components/camera/LiveCamera';
import { BriefText } from '@/components/ui/brief-text';
import { Button } from '@/components/ui/button';
import { confirmAction } from '@/components/ui/confirm-dialog';
import { Drawer, DrawerContent, DrawerTitle } from '@/components/ui/drawer';
import { InfoTip } from '@/components/ui/info-tip';
import { Progress } from '@/components/ui/progress';
import { useToast } from '@/frontend/context/ToastContext';
import { DecisionStatusBadge } from '@/frontend/modules/shared/decision/DecisionStatusBadge';
import {
  buildLabPortionDecision,
  MAX_LAB_PORTIONS,
  type LabPolicyTest,
  type LabPortionView,
} from '@/backend/services/zmcc/labPortionDecision';
import type { LabPortionsState } from '@/backend/services/zmccLabService';
import type { LiveCameraResult } from '@/types/captured-photo';
import type { PersonDecision } from '@/types/stage1-decision';
import { getErrorMessage } from '@/lib/errors';
import { cn } from '@/lib/utils';
import { evaluate3ZoneTest } from '@/lib/sop-evaluation';
import { calculatedValuesForPortion, readingToNumber } from '@/lib/portion-calculated-values';
import { pickRoleTest, isCalculatedTest } from '@/lib/lab-test-roles';
import { milkQualityFromLrFat } from '@/backend/utils/milkFormulas';
import { buildSopChipText } from '@/lib/sop-chip';
import { useServerDraft } from '@/frontend/hooks/useServerDraft';
import { exceptionReasonShort, exceptionReasonText } from '@/lib/exceptionReasons';
import { stampEmployeeCode, stampRoleLabel } from '@/lib/photo/stampIdentity';
import { ErrorPopup } from '@/components/ui/error-popup';

export interface LabPortionsPanelProps {
  sessionId: string;
  arrivalType: string;
  tokenNo?: string | null;
  vehicleNo?: string | null;
  arrivalId?: string | null;
  /** Called when every portion has a final decision (vehicle finished at the lab). */
  onFinished?: () => void;
  onViewHistory?: () => void;
}

type Draft = {
  quantity: string;
  unit: 'KG' | 'LITER';
  values: Record<string, string>;
  person: PersonDecision | null;
  remarks: string;
};

const emptyDraft = (): Draft => ({
  quantity: '',
  unit: 'KG',
  values: {},
  person: null,
  remarks: '',
});

function reasonText(reason: string): string {
  return exceptionReasonShort(reason);
}

function labSopChipText(t: LabPolicyTest): string | null {
  const accepted = t.rule?.allowed?.length ? t.rule.allowed : t.rule?.acceptableOption ? [t.rule.acceptableOption] : null;
  return buildSopChipText({
    resultType: t.resultType,
    min: t.rule?.min,
    max: t.rule?.max,
    allowed: accepted,
    options: t.resultOptions?.length ? t.resultOptions : t.options,
  });
}

function isServerSubmitted(p: LabPortionView): boolean {
  return p.status !== 'TESTING' || p.finalDecision !== 'PENDING' || p.reviewStatus === 'PENDING';
}

export const LabPortionsPanel: React.FC<LabPortionsPanelProps> = ({
  sessionId,
  arrivalType,
  tokenNo,
  vehicleNo,
  arrivalId: _arrivalId,
  onFinished,
  onViewHistory,
}) => {
  void _arrivalId;
  const queryClient = useQueryClient();
  const toast = useToast();
  const [state, setState] = useState<LabPortionsState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'COMPOSITE' | 'PORTION_WISE'>('COMPOSITE');
  const [busy, setBusy] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [savedPortions, setSavedPortions] = useState<Record<string, boolean>>({});
  const [itemError, setItemError] = useState<Record<string, string>>({});
  const [photos, setPhotos] = useState<Record<string, Record<string, string>>>({}); // portionId -> labTestId -> captureId
  const [photoUploadState, setPhotoUploadState] = useState<
    Record<string, { progress: number; status: 'uploading' | 'complete' | 'error' }>
  >({});
  const [camera, setCamera] = useState<{ portion: LabPortionView; test: LabPolicyTest } | null>(null);
  const [activePortionModal, setActivePortionModal] = useState<LabPortionView | null>(null);
  const [decideOpen, setDecideOpen] = useState(false);
  const [showWhy, setShowWhy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [me, setMe] = useState<{ code: string; role: string }>({ code: '', role: '' });

  const load = useCallback(async () => {
    setError(null);
    try {
      const s = await queryClient.fetchQuery({
        queryKey: ['zmcc', 'lab', 'portions', sessionId],
        queryFn: ({ signal }) => fetchJson<LabPortionsState>(`/api/zmcc/lab/sessions/${sessionId}/portions`, { signal }),
        staleTime: 0,
      });
      setState(s);
      setMode(s.testMode);
      const ph: Record<string, Record<string, string>> = {};
      for (const p of s.portions) {
        ph[p.id] = {};
        for (const x of p.photos) if (x.labTestId) ph[p.id][x.labTestId] = x.captureId;
      }
      setPhotos(ph);
      // Hydrate drafts for returned portions (denied by Zonal Manager) that have prior test readings
      setDrafts((prev) => {
        const next = { ...prev };
        for (const p of s.portions) {
          if (!isServerSubmitted(p) && p.details?.tests?.length && !next[p.id]) {
            const byCode = new Map(s.policy.tests.map((t) => [t.testCode, t.labTestId]));
            const values: Record<string, string> = {};
            for (const t of p.details.tests) {
              const id = byCode.get(t.testCode);
              if (!id) continue;
              if (t.value !== null && t.value !== undefined) values[id] = String(t.value);
              else if (t.textValue) values[id] = String(t.textValue);
            }
            next[p.id] = {
              values,
              person: null,
              remarks: p.decisionRemarks ?? '',
              quantity: p.quantityValue !== null && p.quantityValue !== undefined ? String(p.quantityValue) : '',
              unit: (p.quantityUnit as 'KG' | 'LITER') || 'KG',
            };
          }
        }
        return next;
      });
    } catch (err) {
      setError(getErrorMessage(err) || 'Could not load portions.');
    } finally {
      setLoading(false);
    }
  }, [sessionId, queryClient]);

  useEffect(() => {
    load();
  }, [load]);

  // The one shared signed-in user: a second query on its cache key sent people to "No workspace".
  const { currentUser } = useCurrentUser();
  useEffect(() => {
    if (!currentUser) return;
    setMe({ code: stampEmployeeCode(currentUser), role: stampRoleLabel(currentUser) });
  }, [currentUser]);

  const finished = Boolean(state && state.portions.length > 0 && state.portions.every((p) => p.finalDecision !== 'PENDING'));
  const hasSubmittedPortion = Boolean(state?.portions.some(isServerSubmitted));
  const allPortionsSubmitted = Boolean(state && state.portions.length > 0 && state.portions.every(isServerSubmitted));
  const isModeAndAddLocked = finished || hasSubmittedPortion || state?.sessionStatus !== 'IN_PROGRESS';
  const isVehicleLocked = finished || allPortionsSubmitted || state?.sessionStatus !== 'IN_PROGRESS';

  const handleModeSwitch = async (newMode: 'COMPOSITE' | 'PORTION_WISE') => {
    if (newMode === mode) return;
    if (isModeAndAddLocked) {
      setError('Cannot switch test mode after vehicle decisions have been submitted.');
      return;
    }
    if (newMode === 'COMPOSITE' && state && (state.portions.length > 1 || state.portions.some((p) => savedPortions[p.id]))) {
      const ok = await confirmAction({
        title: 'Switch to Composite mode?',
        description: 'Portions beyond Portion 1 will be discarded. Continue?',
        confirmLabel: 'Switch to Composite',
        destructive: true,
      });
      if (!ok) return;
    }
    setBusy('setup');
    setError(null);
    setSubmitError(null);
    try {
      const portionCount = newMode === 'COMPOSITE' ? 1 : Math.max(2, state?.portions.length ?? 2);
      const res = await fetch(`/api/zmcc/lab/sessions/${sessionId}/portions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ test_mode: newMode, portion_count: portionCount }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not update testing mode.');
      const nextState = data as LabPortionsState;
      setState(nextState);
      setMode(newMode);
      const nextIds = new Set(nextState.portions.map((p) => p.id));
      setSavedPortions((prev) => {
        const keep: Record<string, boolean> = {};
        for (const id of Object.keys(prev)) {
          if (nextIds.has(id) && prev[id]) keep[id] = true;
        }
        return keep;
      });
      setDrafts((prev) => {
        const keep: Record<string, Draft> = {};
        for (const id of Object.keys(prev)) {
          if (nextIds.has(id)) keep[id] = prev[id];
        }
        return keep;
      });
      setItemError((prev) => {
        const keep: Record<string, string> = {};
        for (const id of Object.keys(prev)) {
          if (nextIds.has(id)) keep[id] = prev[id];
        }
        return keep;
      });
    } catch (err) {
      setError(getErrorMessage(err) || 'Could not update testing mode.');
    } finally {
      setBusy(null);
    }
  };

  const handleDiscardPortion = async (portion: LabPortionView) => {
    if (finished || state?.sessionStatus !== 'IN_PROGRESS' || isServerSubmitted(portion)) return;
    const d = drafts[portion.id];
    const hasData =
      Boolean(savedPortions[portion.id]) ||
      Boolean(d?.person) ||
      Boolean(d?.remarks.trim()) ||
      Object.values(d?.values ?? {}).some((v) => Boolean(v && v.trim()));
    if (hasData) {
      const ok = await confirmAction({
        title: `Remove Portion ${portion.portionNumber}?`,
        description: 'Entered test readings and decision for this portion will be cleared.',
        confirmLabel: 'Remove',
        destructive: true,
      });
      if (!ok) return;
    }
    setBusy(`discard-${portion.portionNumber}`);
    setError(null);
    setSubmitError(null);
    try {
      const res = await fetch(`/api/zmcc/lab/sessions/${sessionId}/portions?portionNumber=${portion.portionNumber}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not remove portion.');
      const nextState = data as LabPortionsState;
      setState(nextState);
      if (nextState.testMode) setMode(nextState.testMode);
      setSavedPortions((prev) => {
        const next = { ...prev };
        delete next[portion.id];
        return next;
      });
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[portion.id];
        return next;
      });
      setItemError((prev) => {
        const next = { ...prev };
        delete next[portion.id];
        return next;
      });
      if (activePortionModal?.id === portion.id) {
        setActivePortionModal(null);
      }
    } catch (err) {
      setError(getErrorMessage(err) || 'Could not remove portion.');
    } finally {
      setBusy(null);
    }
  };

  const handleAddPortion = async () => {
    if (isModeAndAddLocked) return;
    setBusy('add-portion');
    setError(null);
    setSubmitError(null);
    try {
      const res = await fetch(`/api/zmcc/lab/sessions/${sessionId}/portions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'ADD_PORTION' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not add portion.');
      const nextState = data as LabPortionsState;
      setState(nextState);
      if (nextState.testMode) setMode(nextState.testMode);
      const added = nextState.portions[nextState.portions.length - 1];
      if (added) {
        setActivePortionModal(added);
      }
    } catch (err) {
      setError(getErrorMessage(err) || 'Could not add portion.');
    } finally {
      setBusy(null);
    }
  };

  const draftOf = (id: string) => drafts[id] ?? emptyDraft();
  const setDraft = (id: string, patch: Partial<Draft>) => {
    setDrafts((d) => ({ ...d, [id]: { ...(d[id] ?? emptyDraft()), ...patch } }));
    setItemError((e) => (e[id] ? { ...e, [id]: '' } : e));
    setSubmitError(null);
  };

  const preview = useCallback(
    (p: LabPortionView) => {
      if (!state) return null;
      const d = drafts[p.id] ?? emptyDraft();
      const ph = photos[p.id] ?? {};
      const personDecision = d.person || 'ACCEPT';
      return buildLabPortionDecision(state.policy, {
        tests: state.policy.tests.map((t) => ({
          labTestId: t.labTestId,
          value: t.resultType === 'NUMERIC' && d.values[t.labTestId] ? Number(d.values[t.labTestId]) : null,
          textValue: t.resultType !== 'NUMERIC' ? d.values[t.labTestId] || null : null,
        })),
        photos: Object.entries(ph).map(([labTestId, captureId]) => ({ labTestId, captureId })),
        personDecision,
        remarks: d.remarks,
        deciderCanApprove: state.canDecideNow,
      }).decision;
    },
    [state, drafts, photos]
  );

  const uploadPhoto = async (portion: LabPortionView, test: LabPolicyTest, res: LiveCameraResult) => {
    if (!state) return;
    setCamera(null);
    const key = `${portion.id}:${test.labTestId}`;
    setBusy(`photo:${key}`);
    setPhotoUploadState((prev) => ({ ...prev, [key]: { progress: 25, status: 'uploading' } }));
    setItemError((e) => ({ ...e, [portion.id]: '' }));
    try {
      const form = new FormData();
      form.append('file', res.blob, `${res.captureId}.jpg`);
      form.append(
        'meta',
        JSON.stringify({
          captureId: res.captureId,
          sha256: res.sha256,
          testingPoint: state.point,
          entityType: 'zmcc_lab_portion',
          entityId: portion.id,
          labTestId: test.labTestId,
          portionNumber: portion.portionNumber,
          photoKind: 'TEST_RESULT',
          deviceCapturedAt: res.capturedAt,
          latitude: res.gps?.lat ?? null,
          longitude: res.gps?.lng ?? null,
          gpsAccuracyM: res.gps?.accuracyM ?? null,
          wasOffline: false,
          width: res.width,
          height: res.height,
          policyVersion: state.policy.version,
        })
      );
      const r = await fetch('/api/photos', { method: 'POST', body: form });
      setPhotoUploadState((prev) => ({ ...prev, [key]: { progress: 80, status: 'uploading' } }));
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || 'Could not save the photo.');
      setPhotos((ph) => ({ ...ph, [portion.id]: { ...(ph[portion.id] ?? {}), [test.labTestId]: res.captureId } }));
      setPhotoUploadState((prev) => ({ ...prev, [key]: { progress: 100, status: 'complete' } }));
    } catch (err) {
      setPhotoUploadState((prev) => ({ ...prev, [key]: { progress: 0, status: 'error' } }));
      setItemError((e) => ({ ...e, [portion.id]: getErrorMessage(err) || 'Could not save the photo.' }));
    } finally {
      setBusy(null);
    }
  };

  const sortedTests = useMemo(
    () =>
      [...(state?.policy.tests ?? [])].sort((a, b) => {
        const orderA = typeof a.displayOrder === 'number' ? a.displayOrder : 999;
        const orderB = typeof b.displayOrder === 'number' ? b.displayOrder : 999;
        if (orderA !== orderB) return orderA - orderB;
        return (a.testCode || '').localeCompare(b.testCode || '');
      }),
    [state?.policy.tests]
  );

  const testNameByCode = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of sortedTests) map.set(t.testCode, t.testName);
    return map;
  }, [sortedTests]);
  const nameOfCode = useCallback((code: string) => testNameByCode.get(code) ?? code, [testNameByCode]);

  const validatePortionForSave = useCallback(
    (p: LabPortionView): string | null => {
      if (!state) return 'Session not loaded.';
      const uploading = Object.entries(photoUploadState).some(
        ([k, st]) => k.startsWith(`${p.id}:`) && st.status === 'uploading'
      );
      if (uploading) return 'Please wait for photo upload to finish.';
      const d = drafts[p.id] ?? emptyDraft();
      for (const t of sortedTests) {
        if (isCalculatedTest(t)) continue;
        if (t.resultType === 'NUMERIC') {
          const raw = (d.values[t.labTestId] ?? '').trim();
          if (raw !== '') {
            const num = Number(raw);
            if (!Number.isFinite(num) || num < 0) {
              return `Enter a valid non-negative number for ${t.testName}.`;
            }
          }
        }
      }
      if (!d.person) return 'Choose Accept or Reject portion.';
      const pv = preview(p);
      if (pv && !pv.remarksOk) return 'Please write remarks (at least 3 letters).';
      return null;
    },
    [state, photoUploadState, drafts, sortedTests, preview]
  );

  const evaluatePortion = useCallback(
    (p: LabPortionView) => {
      const submitted = isServerSubmitted(p);
      const nonCalc = sortedTests.filter((t) => !isCalculatedTest(t));
      const lrTest = nonCalc.find((t) => t.isLr) ?? pickRoleTest(nonCalc, 'LR');
      const fatTest = nonCalc.find((t) => t.isFat) ?? pickRoleTest(nonCalc, 'FAT');
      const compulsoryTests = nonCalc.filter((t) => t.testMode === 'COMPULSORY');
      const compulsoryTotal = compulsoryTests.length;

      if (submitted) {
        const qual = milkQualityFromLrFat(p.lr, p.fat);
        const done = compulsoryTests.filter((t) =>
          (p.details?.tests ?? []).some(
            (x) => x.testCode === t.testCode && (x.value !== null || Boolean(x.textValue))
          )
        ).length;
        const statusLabel =
          p.reviewStatus === 'PENDING'
            ? 'With Zonal Manager'
            : p.finalDecision === 'ACCEPTED'
              ? 'Accepted'
              : 'Rejected';
        return {
          submitted: true,
          isSaved: true,
          lr: p.lr,
          fat: p.fat,
          snf: qual?.snf ?? null,
          ts: qual?.ts ?? null,
          compulsoryDone: done,
          compulsoryTotal,
          progressLabel: compulsoryTotal > 0 ? `${done}/${compulsoryTotal} must-do · ${statusLabel}` : statusLabel,
          personDecision: p.personDecision,
          remarks: p.decisionRemarks ?? '',
          route: p.reviewStatus === 'PENDING' ? 'SEND_TO_APPROVER' : p.finalDecision === 'ACCEPTED' ? 'PROCEED' : 'REJECT',
          exceptionReasons: p.exceptionReasons,
          validationError: null as string | null,
        };
      }

      const d = drafts[p.id] ?? emptyDraft();
      const lrNum = lrTest ? readingToNumber(d.values[lrTest.labTestId]) : null;
      const fatNum = fatTest ? readingToNumber(d.values[fatTest.labTestId]) : null;
      const qual = milkQualityFromLrFat(lrNum, fatNum);
      const done = compulsoryTests.filter((t) => Boolean(d.values[t.labTestId]?.trim())).length;
      const pv = preview(p);
      const isSaved = Boolean(savedPortions[p.id]);
      const validationError = isSaved ? validatePortionForSave(p) : null;
      const decisionWord = d.person === 'REJECT' ? 'Reject' : d.person === 'ACCEPT' ? 'Accept' : 'Draft';
      return {
        submitted: false,
        isSaved,
        lr: lrNum,
        fat: fatNum,
        snf: qual?.snf ?? null,
        ts: qual?.ts ?? null,
        compulsoryDone: done,
        compulsoryTotal,
        progressLabel:
          compulsoryTotal > 0 ? `${done}/${compulsoryTotal} must-do · ${decisionWord}` : decisionWord,
        personDecision: d.person,
        remarks: d.remarks,
        route: pv?.route ?? null,
        exceptionReasons: pv?.exceptionReasons ?? [],
        validationError,
      };
    },
    [sortedTests, drafts, preview, savedPortions, validatePortionForSave]
  );

  const handleSavePortion = (p: LabPortionView): boolean => {
    const validationErr = validatePortionForSave(p);
    if (validationErr) {
      setItemError((e) => ({ ...e, [p.id]: validationErr }));
      return false;
    }
    setItemError((e) => ({ ...e, [p.id]: '' }));
    setSavedPortions((prev) => ({ ...prev, [p.id]: true }));
    setSubmitError(null);
    setActivePortionModal(null);
    return true;
  };

  const pendingPortions = useMemo(
    () => (state?.portions ?? []).filter((p) => !isServerSubmitted(p)),
    [state?.portions]
  );

  const vehicleReview = useMemo(() => {
    const incompleteLines: string[] = [];
    const approverLines: string[] = [];
    // A superior decides their own exception here, so the reasons are listed but nothing is sent on.
    let needsApprover = false;
    const multi = (state?.portions.length ?? 0) > 1;

    for (const p of pendingPortions) {
      const label = state?.testMode === 'COMPOSITE' ? 'Composite Sample' : `Portion ${p.portionNumber}`;
      if (!savedPortions[p.id]) {
        incompleteLines.push(`${label} is not saved yet.`);
        continue;
      }
      const err = validatePortionForSave(p);
      if (err) {
        incompleteLines.push(`${label}: ${err}`);
      }
      const ev = evaluatePortion(p);
      if (ev.route === 'SEND_TO_APPROVER' || ev.exceptionReasons.length > 0) {
        if (ev.route === 'SEND_TO_APPROVER') needsApprover = true;
        const prefix = multi ? `${label}: ` : '';
        if (ev.exceptionReasons.length > 0) {
          for (const r of ev.exceptionReasons) {
            approverLines.push(`${prefix}${exceptionReasonText(r, nameOfCode)}`);
          }
        } else {
          approverLines.push(`${prefix}Needs Zonal Manager review.`);
        }
      }
    }

    const goesToApprover = needsApprover;
    const allRejectedClear =
      !goesToApprover &&
      (state?.portions.length ?? 0) > 0 &&
      (state?.portions ?? []).every((p) =>
        isServerSubmitted(p)
          ? p.finalDecision === 'REJECTED'
          : Boolean(savedPortions[p.id]) && evaluatePortion(p).personDecision === 'REJECT'
      );
    const allSavedValid = pendingPortions.length > 0 && incompleteLines.length === 0;
    const whyLines = incompleteLines.length > 0 ? incompleteLines : approverLines;
    const showWarning = whyLines.length > 0;
    return {
      incompleteLines,
      approverLines,
      goesToApprover,
      allRejectedClear,
      allSavedValid,
      whyLines,
      showWarning,
    };
  }, [pendingPortions, savedPortions, state?.portions, state?.testMode, validatePortionForSave, evaluatePortion, nameOfCode]);

  const handleOpenDecide = () => {
    if (!state || isVehicleLocked) return;
    if (activePortionModal && !handleSavePortion(activePortionModal)) {
      return;
    }
    const firstUnsaved = pendingPortions.find((p) => !savedPortions[p.id]);
    if (firstUnsaved) {
      const err = validatePortionForSave(firstUnsaved);
      if (err) {
        setItemError((e) => ({ ...e, [firstUnsaved.id]: err }));
        setShowWhy(true);
        setActivePortionModal(firstUnsaved);
        return;
      }
      setSavedPortions((prev) => ({ ...prev, [firstUnsaved.id]: true }));
    }
    const firstInvalid = pendingPortions.find((p) => Boolean(validatePortionForSave(p)));
    if (firstInvalid) {
      const err = validatePortionForSave(firstInvalid) ?? 'Complete required fields.';
      setItemError((e) => ({ ...e, [firstInvalid.id]: err }));
      setShowWhy(true);
      setActivePortionModal(firstInvalid);
      return;
    }
    setSubmitError(null);
    setDecideOpen(true);
  };

  useEffect(() => {
    if (finished && onFinished) {
      // Notification handled in UI
    }
  }, [finished, onFinished]);

  // Active portion currently open in modal
  const modalPortion = activePortionModal
    ? state?.portions.find((p) => p.id === activePortionModal.id) ?? activePortionModal
    : null;
  const modalDraft = modalPortion ? draftOf(modalPortion.id) : null;
  // SNF, Total Solids and the ratio are worked out from this portion's LR and Fat, never typed.
  const modalCalculated = modalDraft ? calculatedValuesForPortion(sortedTests, (t) => modalDraft.values[t.labTestId]) : {};
  const modalOpen = Boolean(
    modalPortion &&
    !isServerSubmitted(modalPortion) &&
    !finished
  );
  const modalPreview = modalPortion && modalOpen ? preview(modalPortion) : null;
  const modalPortionId = modalPortion?.id ?? null;
  const modalPhotos = useMemo(() => (modalPortionId ? photos[modalPortionId] ?? {} : {}), [modalPortionId, photos]);

  // Private server draft of the open portion: the same login continues on any device. The decision is never drafted.
  const draftPortionId = modalOpen && modalPortion ? modalPortion.id : null;
  const draftContent = useMemo(
    () => ({
      values: { ...(modalDraft?.values ?? {}), qty: modalDraft?.quantity ?? '', unit: modalDraft?.unit ?? 'KG' },
      photos: Object.fromEntries(Object.entries(modalPhotos).filter(([, id]) => Boolean(id))) as Record<string, string>,
      remarks: modalDraft?.remarks ?? '',
    }),
    [modalDraft, modalPhotos]
  );
  const serverDraft = useServerDraft({
    // Same rule as labPointForArrival on the server: MOT milk is tested at MC, direct supplier milk at HC.
    formType: arrivalType === 'MOT' ? 'ZMCC_LAB_MC' : 'ZMCC_LAB_HC',
    scopeId: sessionId,
    portionKey: draftPortionId,
    content: draftContent,
    onRemote: (remote, reason) => {
      if (!draftPortionId) return;
      const take = (local: string | undefined, incoming: string | undefined) =>
        incoming && incoming.trim() !== '' && (reason === 'stale' || !local || local.trim() === '') ? incoming : local ?? '';
      setDrafts((d) => {
        const cur = d[draftPortionId] ?? emptyDraft();
        const { qty, unit, ...rest } = remote.values;
        const values = { ...cur.values };
        for (const [k, v] of Object.entries(rest)) values[k] = take(values[k], v);
        return {
          ...d,
          [draftPortionId]: {
            ...cur,
            values,
            quantity: take(cur.quantity, qty),
            unit: (unit === 'LITER' || unit === 'KG') && !cur.quantity ? unit : cur.unit,
            remarks: take(cur.remarks, remote.remarks),
          },
        };
      });
      if (Object.keys(remote.photos).length > 0) {
        setPhotos((p) => ({ ...p, [draftPortionId]: { ...remote.photos, ...(p[draftPortionId] ?? {}) } }));
      }
    },
  });

  const submitAllPortions = async () => {
    if (!state) return;
    const targets = state.portions.filter((p) => !isServerSubmitted(p));
    if (targets.length === 0) return;
    for (const p of targets) {
      const err = validatePortionForSave(p);
      if (err) {
        setDecideOpen(false);
        setItemError((e) => ({ ...e, [p.id]: err }));
        setActivePortionModal(p);
        return;
      }
    }

    setBusy('submit-all');
    setSubmitError(null);
    // Stop any queued auto-draft PUT before firing /decision so drafts do not race cleanup.
    serverDraft.discard();
    let anySucceeded = false;
    try {
      for (const p of targets) {
        const d = draftOf(p.id);
        await apiClient.post(
          `/api/zmcc/lab/sessions/${sessionId}/portions/${p.id}/decision`,
          {
            version: p.version,
            person_decision: d.person,
            remarks: d.remarks.trim() || null,
            quantity_value: null,
            quantity_unit: 'KG',
            tests: state.policy.tests.map((t) => ({
              lab_test_id: t.labTestId,
              value: t.resultType === 'NUMERIC' ? d.values[t.labTestId] ?? null : null,
              text_value: t.resultType !== 'NUMERIC' ? d.values[t.labTestId] ?? null : null,
            })),
          },
          {
            dedupKey: `zmcc-lab-decision-${sessionId}-${p.id}-${p.version}`,
            timeoutMs: 30_000,
          }
        );
        anySucceeded = true;
      }
      serverDraft.discard();
      setSavedPortions({});
      setDrafts({});
      setDecideOpen(false);
      await load();
      toast.showSuccess(
        vehicleReview.goesToApprover
          ? 'Complete vehicle request sent to Zonal Manager.'
          : 'Lab decision submitted for all portions.'
      );
    } catch (err) {
      if (anySucceeded || (err instanceof ApiError && err.status === 409)) {
        await load();
      }
      const msg = getErrorMessage(err) || 'Could not submit lab decisions.';
      setSubmitError(msg);
      toast.showError(msg, 'Submission failed');
    } finally {
      setBusy(null);
    }
  };

  const displayTokenNo = tokenNo || state?.tokenNo || null;
  const displayVehicleNo = vehicleNo || state?.vehicleNo || null;

  if (loading) {
    return <SkeletonList count={3} />;
  }

  return (
    <section className="space-y-4" aria-label="Laboratory tests">
      {/* Session Header Card */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card p-4 shadow-2xs">
        <div>
          <div className="flex items-center space-x-2">
            <FlaskConical className="h-5 w-5 text-muted-foreground" />
            <h3 className="text-base font-semibold text-foreground">
              {arrivalType === 'MOT' ? 'Mobile Tester arrival testing' : 'HC arrival testing'}
            </h3>
            <span className="rounded-md bg-blue-50 px-2 py-0.5 text-xs font-semibold text-primary">
              {state?.testMode === 'COMPOSITE' ? 'Composite' : 'Portion-wise'}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Token: <strong className="text-foreground tabular-nums">{displayTokenNo || '—'}</strong> · Vehicle:{' '}
            <strong className="text-foreground">{displayVehicleNo || '—'}</strong>
          </p>
        </div>

      </div>

      <ErrorPopup message={error} onRetry={() => void load()} />

      {/* Test Mode Selector: Composite vs Portion-wise (matches Dispatch to Plant) */}
      {!finished && state && (
        <div className="p-4 sm:p-5 rounded-2xl bg-card border border-border-strong shadow-xs space-y-2">
          <label className="block text-xs font-semibold text-secondary-foreground">Test mode</label>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              disabled={isModeAndAddLocked || Boolean(busy)}
              onClick={() => void handleModeSwitch('COMPOSITE')}
              className={cn(
                'px-3 py-2 rounded-xl border text-xs font-semibold flex flex-col items-center justify-center transition min-h-11',
                mode === 'COMPOSITE'
                  ? 'border-primary-hover bg-blue-50 text-primary-hover ring-2 ring-primary-hover/20'
                  : 'border-border text-secondary-foreground hover:bg-muted',
                (isModeAndAddLocked || Boolean(busy)) && 'opacity-60 cursor-not-allowed'
              )}
            >
              <span>Composite</span>
              <span className="text-xs font-normal text-muted-foreground">One portion</span>
            </button>
            <button
              type="button"
              disabled={isModeAndAddLocked || Boolean(busy)}
              onClick={() => void handleModeSwitch('PORTION_WISE')}
              className={cn(
                'px-3 py-2 rounded-xl border text-xs font-semibold flex flex-col items-center justify-center transition min-h-11',
                mode === 'PORTION_WISE'
                  ? 'border-primary-hover bg-blue-50 text-primary-hover ring-2 ring-primary-hover/20'
                  : 'border-border text-secondary-foreground hover:bg-muted',
                (isModeAndAddLocked || Boolean(busy)) && 'opacity-60 cursor-not-allowed'
              )}
            >
              <span>Portion-wise</span>
              <span className="text-xs font-normal text-muted-foreground">Per portion</span>
            </button>
          </div>
        </div>
      )}

      {/* Awaiting Manager Banner */}
      {!finished && state && state.portions.some((p) => p.reviewStatus === 'PENDING') && (
        <div className="flex items-center gap-2 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-2.5 text-xs text-amber-950 shadow-2xs">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-700" aria-hidden="true" />
          <span className="font-semibold">With Zonal Manager</span>
          <InfoTip
            label="Status details"
            className="-my-2"
            text={
              allPortionsSubmitted
                ? 'All portions of this vehicle have been submitted for Zonal Manager review. Portions are locked until manager decides.'
                : 'Submitted portions are locked until Zonal Manager decides. You can cancel unsubmitted extra portions or complete them below.'
            }
          />
        </div>
      )}

      {/* Finished Banner */}
      {finished && state && (
        <div
          className={cn(
            'flex flex-wrap items-center justify-between gap-3 rounded-2xl border p-4 shadow-2xs',
            state.rollUp.allRejected
              ? 'border-border bg-card text-rose-900'
              : 'border-border bg-card text-emerald-900'
          )}
        >
          <div className="flex items-center gap-1.5">
            {state.rollUp.allRejected ? (
              <XCircle className="h-5 w-5 text-rose-700" aria-hidden="true" />
            ) : (
              <CheckCircle2 className="h-5 w-5 text-emerald-700" aria-hidden="true" />
            )}
            <span className="text-xs font-semibold">
              {state.rollUp.allRejected
                ? 'All rejected'
                : `${state.rollUp.accepted} accepted · ${state.rollUp.rejected} rejected`}
            </span>
            <InfoTip
              label="Result details"
              className="-my-2"
              text={
                state.rollUp.allRejected
                  ? `All portions rejected${state.journeyClosed && arrivalType === 'MOT' ? ' and journey closed' : ''}.`
                  : 'Ready for weighing and tank unloading.'
              }
            />
          </div>
          <div className="flex items-center gap-2">
            {onViewHistory && (
              <button
                type="button"
                onClick={onViewHistory}
                className="min-h-11 px-3 text-xs font-semibold rounded-lg border border-action/30 bg-action-soft text-action hover:bg-action/15 active:scale-[0.98] transition shadow-2xs"
              >
                View in Test History
              </button>
            )}
            {onFinished && (
              <button
                type="button"
                onClick={onFinished}
                className="min-h-11 px-4 text-xs font-semibold rounded-lg bg-emerald-700 text-white hover:bg-emerald-800 transition shadow-2xs"
              >
                Done &amp; Back to Queue
              </button>
            )}
          </div>
        </div>
      )}

      {/* Milk Portions (N) Header + Add Portion */}
      {state && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2 pt-1">
            <h3 className="text-xs font-semibold text-foreground">
              Milk Portions ({state.portions.length})
            </h3>

            {!isModeAndAddLocked && mode === 'PORTION_WISE' && state.portions.length < MAX_LAB_PORTIONS && (
              <button
                type="button"
                onClick={handleAddPortion}
                disabled={Boolean(busy)}
                className="flex items-center space-x-1.5 min-h-12 px-4 rounded-xl bg-primary-hover text-white text-sm font-semibold shadow-xs hover:bg-blue-800 transition disabled:opacity-50"
                title="Add another test portion"
              >
                {busy === 'add-portion' ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <PlusCircle className="h-4 w-4" />
                )}
                <span>+ Add Portion</span>
              </button>
            )}
          </div>

          <div className="space-y-3.5">
            {state.portions.map((p) => {
              const ev = evaluatePortion(p);
              const label = state.testMode === 'COMPOSITE' ? 'Composite Sample' : `Portion ${p.portionNumber}`;
              const needsApprover = ev.route === 'SEND_TO_APPROVER';
              const isReject = ev.personDecision === 'REJECT';

                if (!ev.isSaved && !ev.submitted) {
                  const wasReturnedByManager =
                    p.status === 'TESTING' &&
                    (p.reviewStatus === 'REJECTED' || p.reviewStatus === 'NONE') &&
                    Boolean(p.reviewRemarks || p.reviewedAt);
                  return (
                    <div key={p.id} className="space-y-1.5">
                      {wasReturnedByManager && (
                        <div className="flex items-center gap-1.5 rounded-xl border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs text-amber-950">
                          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-700" aria-hidden="true" />
                          <span className="font-semibold">Returned by manager</span>
                          <InfoTip
                            label="Manager remarks"
                            className="-my-2"
                            text={
                              [p.reviewedAt ? formatDateTime(p.reviewedAt) : null, p.reviewRemarks ? `"${p.reviewRemarks}"` : 'Please re-test or revise decision.']
                                .filter(Boolean)
                                .join(' · ')
                            }
                          />
                        </div>
                      )}
                      <div className="flex items-stretch gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setSubmitError(null);
                            setActivePortionModal(p);
                          }}
                          className="flex flex-1 min-h-14 items-center justify-between rounded-xl border border-dashed border-action/40 bg-action-soft px-4 text-left text-sm font-semibold text-action hover:bg-action/10 transition"
                        >
                          <span>{label}: enter tests and decision</span>
                          <Edit3 className="h-4 w-4 shrink-0" aria-hidden="true" />
                        </button>
                        {!ev.submitted && !finished && state.sessionStatus === 'IN_PROGRESS' && state.portions.length > 1 && (
                          <button
                            type="button"
                            onClick={() => void handleDiscardPortion(p)}
                            disabled={Boolean(busy)}
                            aria-label={`Cancel ${label}`}
                            title={`Cancel ${label}`}
                            className="min-h-14 min-w-14 shrink-0 inline-flex items-center justify-center rounded-xl border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 transition disabled:opacity-50"
                          >
                            {busy === `discard-${p.portionNumber}` ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <X className="h-5 w-5" />
                            )}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                }

              return (
                <div
                  key={p.id}
                  className={cn(
                    'p-4 rounded-2xl bg-card border shadow-xs space-y-3 transition',
                    ev.validationError ? 'border-rose-300' : 'border-border-strong'
                  )}
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="flex items-center space-x-3">
                      <div className="bg-card border-border border p-2 rounded-xl shrink-0">
                        {isReject ? (
                          <XCircle className="w-4 h-4 text-rose-700" />
                        ) : needsApprover ? (
                          <AlertTriangle className="w-4 h-4 text-amber-700" />
                        ) : (
                          <Check className="w-4 h-4 stroke-3 text-emerald-800" />
                        )}
                      </div>
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-sm text-foreground">{label}</span>
                          {ev.submitted ? (
                            <DecisionStatusBadge
                              status={
                                p.finalDecision === 'ACCEPTED'
                                  ? 'ACCEPTED'
                                  : p.finalDecision === 'REJECTED'
                                    ? 'REJECTED'
                                    : p.reviewStatus === 'PENDING'
                                      ? 'PENDING'
                                      : 'EXCEPTION'
                              }
                            />
                          ) : (
                            <span
                              className={cn(
                                'px-2 py-0.5 rounded-lg text-xs font-semibold border',
                                isReject
                                  ? 'bg-rose-50 text-rose-800 border-rose-200'
                                  : needsApprover
                                    ? 'bg-amber-50 text-amber-900 border-amber-200'
                                    : 'bg-emerald-50 text-emerald-800 border-emerald-200'
                              )}
                            >
                              {isReject ? 'Reject' : needsApprover ? 'Needs Zonal Manager' : 'Accept'}
                            </span>
                          )}
                        </div>
                        <p className="text-xs font-medium text-secondary-foreground mt-0.5">
                          {ev.progressLabel}
                        </p>
                        {ev.validationError && (
                          <p className="text-xs font-semibold text-rose-700 mt-0.5">{ev.validationError}</p>
                        )}
                        {(ev.submitted || p.status === 'TESTING') && (p.reviewedAt || p.reviewRemarks) && (
                          <div className={cn('inline-flex items-center text-xs mt-0.5', !ev.submitted ? 'font-semibold text-amber-800' : 'text-muted-foreground')}>
                            <span>{!ev.submitted ? 'Returned by manager' : 'Manager decided'}</span>
                            <InfoTip
                              label="Manager note"
                              className="-my-2"
                              text={[p.reviewedAt ? formatDateTime(p.reviewedAt) : null, p.reviewRemarks].filter(Boolean).join(' · ')}
                            />
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center space-x-2 self-end sm:self-center">
                      <button
                        type="button"
                        onClick={() => {
                          setSubmitError(null);
                          setActivePortionModal(p);
                        }}
                        className="min-h-11 min-w-11 flex items-center space-x-1 h-9 px-3 rounded-lg bg-card border border-border-strong text-xs font-semibold text-primary-hover hover:bg-blue-50 transition"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                        <span>{ev.submitted ? 'View' : 'Edit'}</span>
                      </button>

                      {!ev.submitted && !finished && state.sessionStatus === 'IN_PROGRESS' && state.portions.length > 1 && (
                        <button
                          type="button"
                          onClick={() => void handleDiscardPortion(p)}
                          disabled={Boolean(busy)}
                          className="min-h-11 min-w-11 flex items-center space-x-1 h-9 px-3 rounded-lg bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100 text-xs font-semibold transition disabled:opacity-50"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>{busy === `discard-${p.portionNumber}` ? 'Removing…' : 'Remove'}</span>
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Quality Summary Strip (LR, Fat %, SNF %, TS %) */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-border text-xs tabular-nums font-semibold text-secondary-foreground">
                    <div className="bg-card border-border p-2 rounded-xl border">
                      <span className="text-xs font-sans text-muted-foreground block">LR</span>
                      <span className="text-foreground">{ev.lr !== null ? ev.lr.toFixed(1) : '—'}</span>
                    </div>
                    <div className="bg-card border-border p-2 rounded-xl border">
                      <span className="text-xs font-sans text-muted-foreground block">Fat %</span>
                      <span className="text-foreground">{ev.fat !== null ? `${ev.fat.toFixed(2)}%` : '—'}</span>
                    </div>
                    <div className="bg-card border-border p-2 rounded-xl border">
                      <span className="text-xs font-sans text-muted-foreground block">SNF %</span>
                      <span className="text-foreground">{ev.snf !== null ? `${ev.snf.toFixed(2)}%` : '—'}</span>
                    </div>
                    <div className="bg-card border-border p-2 rounded-xl border">
                      <span className="text-xs font-sans text-muted-foreground block">TS %</span>
                      <span className={ev.ts !== null ? 'text-foreground font-semibold' : 'text-muted-foreground'}>
                        {ev.ts !== null ? `${ev.ts.toFixed(2)}%` : '—'}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Vehicle-Level Warning Details & Bottom Action Bar */}
      {!isVehicleLocked && state && pendingPortions.length > 0 && (
        <div className="space-y-3 pt-1">
          {vehicleReview.showWarning && showWhy && (
            <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-xs text-amber-950">
              <div className="font-semibold">
                {vehicleReview.incompleteLines.length > 0
                  ? 'Not ready yet'
                  : 'Why this goes to Zonal Manager'}
              </div>
              <ul className="mt-2 list-disc space-y-0.5 pl-4">
                {vehicleReview.whyLines.map((line, i) => (
                  <li key={`${line}-${i}`}>{line}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex w-full items-stretch justify-end gap-2">
            {vehicleReview.showWarning && (
              <button
                type="button"
                onClick={() => setShowWhy((v) => !v)}
                aria-label="Show what needs attention"
                aria-expanded={showWhy}
                className="flex min-h-14 min-w-14 shrink-0 items-center justify-center rounded-xl border border-amber-300 bg-amber-50 text-amber-600 transition hover:bg-amber-100 active:scale-[0.97] active:bg-amber-200 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-2"
              >
                <AlertTriangle className="h-6 w-6" />
              </button>
            )}
            <Button
              type="button"
              variant={vehicleReview.allRejectedClear ? 'destructive' : 'default'}
              size="lg"
              loading={busy === 'submit-all'}
              loadingText="Submitting…"
              disabled={Boolean(busy)}
              onClick={handleOpenDecide}
              className="min-h-14 h-auto min-w-0 flex-1 shrink whitespace-normal rounded-xl px-5 py-2.5 text-base font-semibold sm:flex-initial sm:min-w-65 sm:px-8"
            >
              {vehicleReview.goesToApprover ? (
                <AlertTriangle className="h-4 w-4" />
              ) : vehicleReview.allRejectedClear ? (
                <XCircle className="h-4 w-4" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              <span>
                {vehicleReview.goesToApprover
                  ? 'Review & Send Request to Zonal Manager'
                  : vehicleReview.allRejectedClear
                    ? 'Review & Reject Vehicle'
                    : 'Review & Submit Lab Decision'}
              </span>
            </Button>
          </div>
        </div>
      )}

      {/* Portion Decision Modal: Dialog on desktop, Drawer on mobile */}
      <Drawer
        open={Boolean(activePortionModal)}
        onOpenChange={(open) => {
          if (!open && !busy) setActivePortionModal(null);
        }}
      >
        <DrawerContent showClose={false} className="max-w-2xl">
          {modalPortion && modalDraft && (
            <>
              <div className="flex items-center justify-between border-b border-border px-4 py-3 sm:px-5">
                <div>
                  <DrawerTitle className="text-base font-semibold text-foreground">
                    {state?.testMode === 'COMPOSITE' ? 'Composite Sample Tests & Decision' : `Portion #${modalPortion.portionNumber} Tests & Decision`}
                  </DrawerTitle>
                  <p className="text-xs text-muted-foreground font-medium">
                    Vehicle: <strong className="text-foreground">{displayVehicleNo || '—'}</strong> · Token: <strong className="text-foreground tabular-nums">{displayTokenNo || '—'}</strong>
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setActivePortionModal(null)}
                  disabled={Boolean(busy)}
                  aria-label="Close"
                  className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-secondary-foreground"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="space-y-4 overflow-y-auto p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-5">
                {/* Read-only summary if portion is already decided */}
                {!modalOpen && (
                  <div className="bg-card border-border space-y-2 rounded-2xl border p-4 text-xs text-secondary-foreground">
                    <p className="font-semibold text-foreground">
                      Person Decision: <strong>{modalPortion.personDecision === 'REJECT' ? 'Reject' : modalPortion.personDecision === 'ACCEPT' ? 'Accept' : '—'}</strong>
                      {modalPortion.decisionRemarks ? ` · "${modalPortion.decisionRemarks}"` : ''}
                    </p>
                    {modalPortion.exceptionReasons.length > 0 && (
                      <p className="text-amber-800">Reasons: {modalPortion.exceptionReasons.map(reasonText).join(', ')}</p>
                    )}
                    {modalPortion.reviewStatus === 'PENDING' && (
                      <p className="font-semibold text-amber-800">With Zonal Manager</p>
                    )}
                    {modalPortion.reviewedAt && (
                      <p>
                        Manager decided {formatDateTime(modalPortion.reviewedAt)}
                        {modalPortion.reviewRemarks ? `: "${modalPortion.reviewRemarks}"` : ''}
                      </p>
                    )}
                    {(modalPortion.lr !== null || modalPortion.fat !== null) && (
                      <p className="tabular-nums font-semibold">
                        LR {modalPortion.lr ?? '—'} · Fat {modalPortion.fat ?? '—'}%
                        {modalPortion.quantityValue !== null
                          ? ` · ${modalPortion.quantityValue} ${modalPortion.quantityUnit === 'LITER' ? 'L' : 'KG'}`
                          : modalPortion.grossLiters !== null
                            ? ` · ${modalPortion.grossLiters} L`
                            : ''}
                      </p>
                    )}
                  </div>
                )}

                {/* Data entry fields if testing is open */}
                {modalOpen && (
                  <>

                    {/* Tests observation list */}
                    <div className="divide-y divide-border rounded-xl border border-border overflow-hidden">
                      {sortedTests.map((t) => {
                        const v = modalDraft.values[t.labTestId] ?? '';
                        const photoBusy = busy === `photo:${modalPortion.id}:${t.labTestId}`;
                        const chip = labSopChipText(t);
                        const isNumeric = t.resultType === 'NUMERIC';
                        const isCalc = t.labTestId in modalCalculated;
                        const calcValue = isCalc ? modalCalculated[t.labTestId] : null;
                        const isRequired = t.testMode === 'COMPULSORY' && !isCalc;

                        const fallbackStrings = t.rule?.allowed?.length
                          ? t.rule.allowed
                          : t.options ?? [];
                        const ruleOptions = t.resultOptions?.length
                          ? t.resultOptions
                          : fallbackStrings.map((opt) => ({
                              value: opt,
                              label: opt,
                              outcome: t.rule?.acceptableOption
                                ? opt.trim().toLowerCase() === t.rule.acceptableOption.trim().toLowerCase()
                                  ? ('PASS' as const)
                                  : ('FAIL' as const)
                                : undefined,
                            }));
                        const evalRes = evaluate3ZoneTest(
                          {
                            min: t.rule?.min,
                            max: t.rule?.max,
                            warningTrigger: t.rule?.warningTrigger,
                            decisionConsequence: t.rule?.decisionConsequence,
                            acceptableOption: t.rule?.acceptableOption ?? t.rule?.allowed?.[0] ?? null,
                            category: t.rule?.ruleCategory,
                            ruleCategory: t.rule?.ruleCategory,
                            testMode: t.testMode,
                            resultType: t.resultType,
                            resultOptions: ruleOptions,
                            unit: t.unit,
                          },
                          v
                        );

                        const isWarning = Boolean(v) && evalRes.isWarning;
                        const isFail = Boolean(v) && evalRes.isRuleFailure;
                        const isOut = isWarning || isFail;

                        return (
                          <div
                            key={t.labTestId}
                            className={cn(
                              'p-3 space-y-1.5 transition',
                              isOut ? 'bg-card' : 'bg-card'
                            )}
                          >
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <div className="min-w-[9rem] flex-1">
                                <div className="flex items-center gap-2">
                                  <span className="text-xs font-semibold text-foreground">{t.testName}</span>
                                  <span
                                    className={cn(
                                      'rounded-md px-2 py-0.5 text-xs font-semibold',
                                      isRequired ? 'bg-primary text-white shadow-2xs' : 'bg-muted text-secondary-foreground'
                                    )}
                                  >
                                    {isCalc ? 'Auto' : isRequired ? 'Required *' : 'Optional'}
                                  </span>
                                  {t.photoMode === 'REQUIRED' && !isCalc && (
                                    <span
                                      className={cn(
                                        'rounded-md border px-2 py-0.5 text-xs font-semibold',
                                        modalPhotos[t.labTestId]
                                          ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                                          : 'border-amber-300 bg-amber-50 text-amber-900'
                                      )}
                                    >
                                      {modalPhotos[t.labTestId] ? 'Photo OK' : 'Photo required'}
                                    </span>
                                  )}
                                  {chip && (
                                    <span
                                      className={cn(
                                        'rounded-md border px-2 py-0.5 text-xs font-semibold tabular-nums',
                                        isFail
                                          ? 'border-rose-300 bg-rose-50 text-rose-800'
                                          : isWarning
                                            ? 'border-amber-300 bg-amber-50 text-amber-900 font-semibold'
                                            : 'border-border-strong bg-subtle text-secondary-foreground'
                                      )}
                                    >
                                      {chip}
                                    </span>
                                  )}
                                </div>
                                <div className="text-xs text-muted-foreground mt-0.5">
                                  {t.unit ? `Unit: ${t.unit}` : ''}
                                </div>
                              </div>

                              <div className="flex items-center gap-2">
                                {isCalc ? (
                                  <input
                                    type="text"
                                    readOnly
                                    disabled
                                    aria-readonly="true"
                                    value={calcValue !== null ? calcValue.toFixed(2) : ''}
                                    aria-label={t.testName}
                                    placeholder="Auto"
                                    className="min-h-11 h-10 w-28 cursor-not-allowed rounded-lg border border-border bg-muted px-2 text-base sm:text-sm font-semibold tabular-nums text-secondary-foreground"
                                  />
                                ) : isNumeric ? (
                                  <input
                                    type="number"
                                    inputMode="decimal"
                                    step="any"
                                    value={v}
                                    aria-label={t.testName}
                                    placeholder="0.00"
                                    onChange={(e) =>
                                      setDraft(modalPortion.id, {
                                        values: { ...modalDraft.values, [t.labTestId]: e.target.value },
                                      })
                                    }
                                    aria-invalid={isOut || undefined}
                                    className={cn('min-h-11', 
                                      'h-10 w-28 rounded-lg border px-2 text-base sm:text-sm font-semibold tabular-nums focus:outline-none focus:ring-2',
                                      isFail
                                        ? 'border-rose-400 bg-rose-50/40 text-rose-950 focus:border-rose-500 focus:ring-rose-500'
                                        : isWarning
                                          ? 'border-amber-400 bg-amber-50/50 text-amber-950 focus:border-amber-500 focus:ring-amber-500'
                                          : 'border-border focus:ring-primary'
                                    )}
                                  />
                                ) : t.options ? (
                                  <select
                                    value={v}
                                    aria-label={t.testName}
                                    onChange={(e) =>
                                      setDraft(modalPortion.id, {
                                        values: { ...modalDraft.values, [t.labTestId]: e.target.value },
                                      })
                                    }
                                    aria-invalid={isOut || undefined}
                                    className={cn('min-h-11', 
                                      'h-10 w-32 rounded-lg border px-2 text-xs font-semibold focus:outline-none focus:ring-2',
                                      isFail
                                        ? 'border-rose-400 bg-rose-50/40 text-rose-950 focus:border-rose-500 focus:ring-rose-500'
                                        : isWarning
                                          ? 'border-amber-400 bg-amber-50/50 text-amber-950 focus:border-amber-500 focus:ring-amber-500'
                                          : 'border-border focus:ring-primary'
                                    )}
                                  >
                                    <option value="">Select</option>
                                    {t.options.map((o) => (
                                      <option key={o} value={o}>
                                        {o}
                                      </option>
                                    ))}
                                  </select>
                                ) : (
                                  <input
                                    type="text"
                                    value={v}
                                    aria-label={t.testName}
                                    placeholder="Observation"
                                    onChange={(e) =>
                                      setDraft(modalPortion.id, {
                                        values: { ...modalDraft.values, [t.labTestId]: e.target.value },
                                      })
                                    }
                                    aria-invalid={isOut || undefined}
                                    className={cn('min-h-11', 
                                      'h-10 w-32 rounded-lg border px-2 text-xs font-semibold focus:outline-none focus:ring-2',
                                      isFail
                                        ? 'border-rose-400 bg-rose-50/40 text-rose-950 focus:border-rose-500 focus:ring-rose-500'
                                        : isWarning
                                          ? 'border-amber-400 bg-amber-50/50 text-amber-950 focus:border-amber-500 focus:ring-amber-500'
                                          : 'border-border focus:ring-primary'
                                    )}
                                  />
                                )}

                                {t.photoMode !== 'NONE' && !isCalc && (
                                  <button
                                    type="button"
                                    disabled={photoBusy}
                                    onClick={() => setCamera({ portion: modalPortion, test: t })}
                                    className={cn('min-h-11 min-w-11', 
                                      'flex items-center gap-1 rounded-lg border px-3 text-xs font-semibold transition disabled:opacity-50',
                                      modalPhotos[t.labTestId]
                                        ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                                        : t.photoMode === 'REQUIRED'
                                          ? 'border-amber-300 bg-amber-50 text-amber-900'
                                          : 'border-border bg-card text-secondary-foreground hover:bg-subtle'
                                    )}
                                  >
                                    {photoBusy ? (
                                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    ) : modalPhotos[t.labTestId] ? (
                                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                                    ) : (
                                      <Camera className="h-3.5 w-3.5" />
                                    )}
                                    <span>{photoBusy ? 'Uploading…' : modalPhotos[t.labTestId] ? 'Photo saved' : 'Take photo'}</span>
                                  </button>
                                )}
                              </div>
                            </div>

                            {t.photoMode !== 'NONE' && !isCalc && (photoUploadState[`${modalPortion.id}:${t.labTestId}`] || modalPhotos[t.labTestId]) && (() => {
                              const uploadState = photoUploadState[`${modalPortion.id}:${t.labTestId}`];
                              const hasSavedPhoto = Boolean(modalPhotos[t.labTestId]);
                              return (
                                <Progress
                                  value={uploadState ? uploadState.progress : 100}
                                  status={uploadState ? uploadState.status : 'complete'}
                                  variant={
                                    uploadState?.status === 'error'
                                      ? 'destructive'
                                      : uploadState?.status === 'complete' || hasSavedPhoto
                                        ? 'success'
                                        : 'default'
                                  }
                                  size="sm"
                                  label={
                                    uploadState?.status === 'uploading'
                                      ? 'Uploading photo…'
                                      : uploadState?.status === 'error'
                                        ? 'Photo upload failed'
                                        : 'Photo uploaded (100%)'
                                  }
                                  showValueLabel
                                  className="mt-2"
                                />
                              );
                            })()}

                            {Boolean(v) && evalRes.verdict !== 'NOT_TESTED' && evalRes.verdict !== 'NOT_APPLIED' && (
                              <p
                                className={cn(
                                  'flex items-center gap-1 text-xs font-semibold',
                                  isFail ? 'text-rose-700' : isWarning ? 'text-amber-800' : 'text-emerald-700'
                                )}
                              >
                                {isFail ? (
                                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-rose-600" aria-hidden="true" />
                                ) : isWarning ? (
                                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-600" aria-hidden="true" />
                                ) : (
                                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden="true" />
                                )}
                                <span>{evalRes.message}</span>
                              </p>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    {/* Decision Choice */}
                    <div>
                      <p className="mb-1 text-xs font-semibold text-foreground">Your Decision</p>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => setDraft(modalPortion.id, { person: 'REJECT' })}
                          className={cn(
                            'flex min-h-12 items-center justify-center rounded-xl border text-xs font-semibold transition',
                            modalDraft.person === 'REJECT'
                              ? 'border-rose-600 bg-rose-600 text-white shadow-2xs'
                              : 'border-rose-300 bg-card text-rose-700 hover:bg-rose-50'
                          )}
                        >
                          <span>Reject Portion</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setDraft(modalPortion.id, { person: 'ACCEPT' })}
                          className={cn(
                            'flex min-h-12 items-center justify-center rounded-xl border text-xs font-semibold transition',
                            modalDraft.person === 'ACCEPT'
                              ? 'border-emerald-600 bg-emerald-600 text-white shadow-2xs'
                              : 'border-emerald-300 bg-card text-emerald-700 hover:bg-emerald-50'
                          )}
                        >
                          <span>Accept Portion</span>
                        </button>
                      </div>
                    </div>

                    {/* System Evaluation Preview */}
                    {modalPreview && (
                      <div
                        className={cn(
                          'flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-xs',
                          modalPreview.route === 'PROCEED'
                            ? 'border-border bg-card text-emerald-900'
                            : modalPreview.route === 'REJECT'
                              ? 'border-border bg-card text-rose-900'
                              : 'border-border bg-card text-amber-900'
                        )}
                      >
                        <span className="font-semibold">
                          System: {modalPreview.systemOutcome === 'PASS' ? 'Passed' : modalPreview.route === 'SEND_TO_APPROVER' ? 'Needs Manager' : 'Failed'}
                          {modalPreview.route === 'DECIDE_NOW' && ' · You decide'}
                        </span>
                        {modalPreview.exceptionReasons.length > 0 && (
                          <InfoTip
                            label="Exception details"
                            className="-my-2"
                            text={
                              <ul className="list-disc space-y-1 pl-4">
                                {modalPreview.exceptionReasons.map((r) => (
                                  <li key={r}>{reasonText(r)}</li>
                                ))}
                              </ul>
                            }
                          />
                        )}
                      </div>
                    )}

                    <div className="space-y-2">
                      <label htmlFor="portion-remarks" className="block text-xs font-semibold text-secondary-foreground">
                        {modalPreview?.remarksRequired ? 'Remarks / Justification (Required)' : 'Remarks (Optional)'}
                      </label>
                      <textarea
                        id="portion-remarks"
                        value={modalDraft.remarks}
                        onChange={(e) => setDraft(modalPortion.id, { remarks: e.target.value })}
                        rows={2}
                        placeholder={modalPreview?.remarksRequired ? 'Enter reason…' : 'Observations…'}
                        className="min-h-11 w-full resize-none rounded-lg border border-border p-3 text-base sm:text-xs font-medium focus:outline-none focus:ring-2 focus:ring-primary"
                      />
                    </div>

                    <ErrorPopup message={itemError[modalPortion.id]} />

                    {/* Save Portion Footer (matches Dispatch to Plant) */}
                    <div className="flex flex-wrap items-center justify-end gap-2.5 border-t border-border pt-3">
                      {!isServerSubmitted(modalPortion) && !finished && state?.sessionStatus === 'IN_PROGRESS' && (state?.portions.length ?? 0) > 1 && (
                        <Button
                          type="button"
                          variant="outline"
                          loading={busy === `discard-${modalPortion.portionNumber}`}
                          loadingText="Removing…"
                          onClick={() => void handleDiscardPortion(modalPortion)}
                          disabled={Boolean(busy)}
                          className="min-h-11 border-rose-200 bg-rose-50 text-rose-700 hover:border-rose-300 hover:bg-rose-100 hover:text-rose-800"
                        >
                          Remove
                        </Button>
                      )}

                      <Button
                        type="button"
                        variant="default"
                        size="lg"
                        disabled={Boolean(busy)}
                        onClick={() => handleSavePortion(modalPortion)}
                        className="min-h-12 flex-1 bg-emerald-700 px-6 text-base font-semibold text-white hover:bg-emerald-800 sm:flex-initial"
                      >
                        <Check className="h-4 w-4" />
                        <span>Save Portion</span>
                      </Button>
                    </div>
                  </>
                )}
              </div>
            </>
          )}
        </DrawerContent>
      </Drawer>

      {/* Vehicle-Level Review and Decide Drawer */}
      <Drawer open={decideOpen} onOpenChange={setDecideOpen} dismissible={busy !== 'submit-all'}>
        <DrawerContent>
          <div className="flex items-center justify-between border-b border-border px-4 pb-3 pt-2 sm:px-5">
            <div>
              <DrawerTitle>Review and decide</DrawerTitle>
              <p className="text-xs text-muted-foreground font-medium">
                Vehicle: <strong className="text-foreground">{displayVehicleNo || '—'}</strong> · Token:{' '}
                <strong className="text-foreground tabular-nums">{displayTokenNo || '—'}</strong> ·{' '}
                {mode === 'COMPOSITE' ? 'Composite' : `Portion-wise (${state?.portions.length ?? 0})`}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setDecideOpen(false)}
              disabled={busy === 'submit-all'}
              aria-label="Close"
              className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-secondary-foreground disabled:opacity-50"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="space-y-4 overflow-y-auto p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-5">
            {/* Overall Vehicle Outcome Banner */}
            <div
              className={cn(
                'flex items-center justify-between gap-2 rounded-2xl border px-4 py-3 text-xs',
                vehicleReview.goesToApprover
                  ? 'border-amber-300 bg-amber-50 text-amber-950'
                  : vehicleReview.allRejectedClear
                    ? 'border-rose-300 bg-rose-50 text-rose-950'
                    : 'border-emerald-300 bg-emerald-50 text-emerald-950'
              )}
            >
              <span className="font-semibold text-sm">
                {vehicleReview.goesToApprover
                  ? 'Goes to Zonal Manager'
                  : vehicleReview.allRejectedClear
                    ? 'Ready to reject'
                    : 'Ready to submit'}
              </span>
              <InfoTip
                label="Submission details"
                className="-my-2"
                text={
                  vehicleReview.goesToApprover
                    ? `All ${pendingPortions.length} portion(s) will be sent together for Zonal Manager review before weighing or tank unloading begins.`
                    : vehicleReview.allRejectedClear
                      ? `All ${pendingPortions.length} portion(s) are marked Reject in line with test results.`
                      : `All ${pendingPortions.length} portion(s) will be recorded together now.`
                }
              />
            </div>

            {/* Per-Portion Breakdown */}
            <div className="space-y-2.5">
              {(state?.portions ?? []).map((p) => {
                const ev = evaluatePortion(p);
                const label = state?.testMode === 'COMPOSITE' ? 'Composite Sample' : `Portion ${p.portionNumber}`;
                return (
                  <div key={p.id} className="rounded-xl border border-border bg-card p-3 space-y-2 text-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-semibold text-foreground">{label}</span>
                      <div className="flex items-center gap-1.5">
                        {ev.submitted && (
                          <span className="px-2 py-0.5 rounded-md bg-muted text-secondary-foreground font-semibold">
                            Already submitted
                          </span>
                        )}
                        <span
                          className={cn(
                            'px-2 py-0.5 rounded-md font-semibold border',
                            ev.personDecision === 'REJECT'
                              ? 'bg-rose-50 text-rose-800 border-rose-200'
                              : ev.route === 'SEND_TO_APPROVER'
                                ? 'bg-amber-50 text-amber-900 border-amber-200'
                                : 'bg-emerald-50 text-emerald-800 border-emerald-200'
                          )}
                        >
                          {ev.personDecision === 'REJECT' ? 'Reject' : 'Accept'}
                          {ev.route === 'SEND_TO_APPROVER' ? ' · Needs Manager' : ''}
                        </span>
                        {ev.exceptionReasons.length > 0 && (
                          <InfoTip
                            label={ev.route === 'SEND_TO_APPROVER' ? 'Why it goes to manager' : 'Exceptions on this portion'}
                            className="-my-2"
                            text={
                              <ul className="list-disc space-y-1 pl-4">
                                {ev.exceptionReasons.map((r) => (
                                  <li key={r}>{exceptionReasonText(r, nameOfCode)}</li>
                                ))}
                              </ul>
                            }
                          />
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-4 gap-2 text-xs tabular-nums">
                      <div>
                        <span className="text-muted-foreground block">LR</span>
                        <strong className="text-foreground">{ev.lr !== null ? ev.lr.toFixed(1) : '—'}</strong>
                      </div>
                      <div>
                        <span className="text-muted-foreground block">Fat</span>
                        <strong className="text-foreground">{ev.fat !== null ? `${ev.fat.toFixed(2)}%` : '—'}</strong>
                      </div>
                      <div>
                        <span className="text-muted-foreground block">SNF</span>
                        <strong className="text-foreground">{ev.snf !== null ? `${ev.snf.toFixed(2)}%` : '—'}</strong>
                      </div>
                      <div>
                        <span className="text-muted-foreground block">TS</span>
                        <strong className="text-foreground">{ev.ts !== null ? `${ev.ts.toFixed(2)}%` : '—'}</strong>
                      </div>
                    </div>

                    {ev.remarks && (
                      <div className="text-secondary-foreground">
                        <BriefText text={ev.remarks} label="Remarks" />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <ErrorPopup message={submitError} />

            <div className="pt-2">
              <Button
                type="button"
                variant={vehicleReview.allRejectedClear ? 'destructive' : 'default'}
                size="lg"
                loading={busy === 'submit-all'}
                loadingText="Submitting…"
                disabled={pendingPortions.length === 0 || Boolean(busy)}
                onClick={() => void submitAllPortions()}
                className="min-h-12 h-auto w-full min-w-0 shrink whitespace-normal rounded-xl px-4 py-3 text-base font-semibold"
              >
                {vehicleReview.goesToApprover ? (
                  <AlertTriangle className="h-4 w-4" />
                ) : vehicleReview.allRejectedClear ? (
                  <XCircle className="h-4 w-4" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                <span>
                  {vehicleReview.goesToApprover
                    ? 'Send Request to Zonal Manager'
                    : vehicleReview.allRejectedClear
                      ? 'Submit Rejection'
                      : 'Submit Lab Decision'}
                </span>
              </Button>
            </div>
          </div>
        </DrawerContent>
      </Drawer>

      {/* Camera Overlay */}
      {camera && state && (
        <LiveCamera
          stamp={{
            employeeCode: me.code,
            roleLabel: me.role,
            pointLabel: `ZMCC lab ${state.point === 'ZMCC_LAB_MC' ? 'Mobile Tester' : 'HC'} - P${camera.portion.portionNumber} - ${camera.test.testName}`,
            vehicleNo: displayVehicleNo ?? null,
            tokenNo: displayTokenNo ?? null,
          }}
          onCapture={(res) => void uploadPhoto(camera.portion, camera.test, res)}
          onCancel={() => setCamera(null)}
        />
      )}

    </section>
  );
};
