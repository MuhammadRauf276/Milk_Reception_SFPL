'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { fetchJson } from '@/lib/query/fetchJson';
import { apiClient, ApiError } from '@/frontend/lib/apiClient';
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  ChevronRight,
  FlaskConical,
  Gavel,
  Layers,
  Loader2,
  Send,
  Sparkles,
  X,
  XCircle,
} from 'lucide-react';
import { LiveCamera } from '@/components/camera/LiveCamera';
import { Drawer, DrawerContent, DrawerTitle } from '@/components/ui/drawer';
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
import { calculatedValuesForPortion } from '@/lib/portion-calculated-values';
import { buildSopChipText } from '@/lib/sop-chip';
import { useServerDraft } from '@/frontend/hooks/useServerDraft';

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
  if (reason === 'MISMATCH') return 'Differs from test result';
  if (reason === 'PICTURE_MISSING') return 'Picture missing';
  if (reason === 'MISSING_FIELD') return 'Test not done';
  if (reason.startsWith('RULE_FAIL:')) return `${reason.slice('RULE_FAIL:'.length)} failed`;
  return reason;
}

function portionBadge(p: LabPortionView) {
  if (p.finalDecision === 'ACCEPTED') return <DecisionStatusBadge status="ACCEPTED" />;
  if (p.finalDecision === 'REJECTED') return <DecisionStatusBadge status="REJECTED" />;
  if (p.reviewStatus === 'PENDING') return <DecisionStatusBadge status="PENDING" />;
  return <DecisionStatusBadge status="EXCEPTION" label="Testing" />;
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

function outsideLabRange(t: LabPolicyTest, raw: string): boolean {
  if (!raw || raw.trim() === '') return false;
  const n = Number(raw);
  if (!Number.isFinite(n)) return false;
  const min = t.rule?.min ?? null;
  const max = t.rule?.max ?? null;
  return (min != null && n < min) || (max != null && n > max);
}

function isDisallowedLabOption(t: LabPolicyTest, val: string): boolean {
  if (!val || !val.trim()) return false;
  const allowed = t.rule?.allowed;
  if (!allowed || allowed.length === 0) return false;
  const upper = val.trim().toUpperCase();
  return !allowed.some((a) => a.trim().toUpperCase() === upper);
}

export const LabPortionsPanel: React.FC<LabPortionsPanelProps> = ({
  sessionId,
  arrivalType,
  tokenNo,
  vehicleNo,
  arrivalId,
  onFinished,
  onViewHistory,
}) => {
  const [state, setState] = useState<LabPortionsState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'COMPOSITE' | 'PORTION_WISE'>('COMPOSITE');
  const [count, setCount] = useState('2');
  const [editingSetup, setEditingSetup] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [itemError, setItemError] = useState<Record<string, string>>({});
  const [photos, setPhotos] = useState<Record<string, Record<string, string>>>({}); // portionId -> labTestId -> captureId
  const [camera, setCamera] = useState<{ portion: LabPortionView; test: LabPolicyTest } | null>(null);
  const [activePortionModal, setActivePortionModal] = useState<LabPortionView | null>(null);
  const [me, setMe] = useState<{ code: string; role: string }>({ code: 'unknown', role: 'unknown' });

  const queryClient = useQueryClient();

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
      if (s.portions.length > 1) setCount(String(s.portions.length));
      const ph: Record<string, Record<string, string>> = {};
      for (const p of s.portions) {
        ph[p.id] = {};
        for (const x of p.photos) if (x.labTestId) ph[p.id][x.labTestId] = x.captureId;
      }
      setPhotos(ph);
    } catch (err) {
      setError(getErrorMessage(err) || 'Could not load portions.');
    } finally {
      setLoading(false);
    }
  }, [sessionId, queryClient]);

  useEffect(() => {
    load();
  }, [load]);

  const meQuery = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: ({ signal }) => fetchJson<{ user?: { employee_code?: string; username?: string; role?: string } }>('/api/auth/me', { signal }),
    staleTime: 5 * 60_000,
    retry: false,
  });
  useEffect(() => {
    const u = meQuery.data?.user;
    if (u) setMe({ code: u.employee_code || u.username || 'unknown', role: u.role || 'unknown' });
  }, [meQuery.data]);

  const anyDecided = !!state?.portions.some((p) => p.personDecision !== null || p.finalDecision !== 'PENDING');
  const showSetup = !!state && state.sessionStatus === 'IN_PROGRESS' && editingSetup;

  const handleModeSwitch = async (newMode: 'COMPOSITE' | 'PORTION_WISE') => {
    if (newMode === mode) return;
    if (anyDecided) {
      setError('Cannot switch to composite mode because some portions already have decisions.');
      return;
    }
    setBusy('setup');
    setError(null);
    try {
      const portionCount = newMode === 'COMPOSITE' ? 1 : Number(count) || 2;
      const res = await fetch(`/api/zmcc/lab/sessions/${sessionId}/portions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ test_mode: newMode, portion_count: portionCount }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not update testing mode.');
      setState(data as LabPortionsState);
      setMode(newMode);
    } catch (err) {
      setError(getErrorMessage(err) || 'Could not update testing mode.');
    } finally {
      setBusy(null);
    }
  };

  const handlePortionCountChange = async (newCountStr: string) => {
    const targetCount = Number(newCountStr);
    const drop = (state?.portions ?? []).filter((p) => p.portionNumber > targetCount);
    const dropHasDecided = drop.some((p) => p.personDecision !== null || p.finalDecision !== 'PENDING');
    if (dropHasDecided) {
      setError('Cannot reduce portions: one or more of the removed portions already has a decision.');
      return;
    }
    setCount(newCountStr);
    setBusy('setup');
    setError(null);
    try {
      const res = await fetch(`/api/zmcc/lab/sessions/${sessionId}/portions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ test_mode: 'PORTION_WISE', portion_count: targetCount }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not update portion count.');
      setState(data as LabPortionsState);
    } catch (err) {
      setError(getErrorMessage(err) || 'Could not update portion count.');
    } finally {
      setBusy(null);
    }
  };

  const handleDiscardPortion = async (portionNumber: number) => {
    setBusy(`discard-${portionNumber}`);
    setError(null);
    try {
      const res = await fetch(`/api/zmcc/lab/sessions/${sessionId}/portions?portionNumber=${portionNumber}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not discard portion.');
      setState(data as LabPortionsState);
      if (data.portions?.length) setCount(String(data.portions.length));
    } catch (err) {
      setError(getErrorMessage(err) || 'Could not discard portion.');
    } finally {
      setBusy(null);
    }
  };

  const handleAddPortion = async () => {
    setBusy('add-portion');
    setError(null);
    try {
      const res = await fetch(`/api/zmcc/lab/sessions/${sessionId}/portions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'ADD_PORTION' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not add portion.');
      setState(data as LabPortionsState);
      if (data.portions?.length) setCount(String(data.portions.length));
      if (data.testMode) setMode(data.testMode);
    } catch (err) {
      setError(getErrorMessage(err) || 'Could not add portion.');
    } finally {
      setBusy(null);
    }
  };


  const saveSetup = async () => {
    setBusy('setup');
    setError(null);
    try {
      const res = await fetch(`/api/zmcc/lab/sessions/${sessionId}/portions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ test_mode: mode, portion_count: mode === 'COMPOSITE' ? 1 : Number(count) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not save.');
      setState(data as LabPortionsState);
      setEditingSetup(false);
    } catch (err) {
      setError(getErrorMessage(err) || 'Could not save.');
    } finally {
      setBusy(null);
    }
  };

  const draftOf = (id: string) => drafts[id] ?? emptyDraft();
  const setDraft = (id: string, patch: Partial<Draft>) =>
    setDrafts((d) => ({ ...d, [id]: { ...(d[id] ?? emptyDraft()), ...patch } }));

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
    setBusy(`photo:${portion.id}:${test.labTestId}`);
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
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || 'Could not save the photo.');
      setPhotos((ph) => ({ ...ph, [portion.id]: { ...(ph[portion.id] ?? {}), [test.labTestId]: res.captureId } }));
    } catch (err) {
      setItemError((e) => ({ ...e, [portion.id]: getErrorMessage(err) || 'Could not save the photo.' }));
    } finally {
      setBusy(null);
    }
  };

  const submit = async (p: LabPortionView) => {
    if (!state) return;
    const d = draftOf(p.id);
    if (!d.person) {
      setItemError((e) => ({ ...e, [p.id]: 'Choose Accept or Reject.' }));
      return;
    }
    const pv = preview(p);
    if (pv && !pv.remarksOk) {
      setItemError((e) => ({ ...e, [p.id]: 'Please write remarks (at least 3 letters).' }));
      return;
    }
    setBusy(`submit:${p.id}`);
    setItemError((e) => ({ ...e, [p.id]: '' }));
    try {
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
          dedupKey: `zmcc-lab-decision-${sessionId}-${p.id}`,
          timeoutMs: 20_000,
        }
      );
      serverDraft.discard();
      await load();
      setActivePortionModal(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setItemError((e) => ({ ...e, [p.id]: err.message || 'This portion was already decided or modified. Reloading…' }));
        load();
      } else {
        setItemError((e) => ({ ...e, [p.id]: getErrorMessage(err) || 'Could not save.' }));
      }
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

  const finished = Boolean(state && state.portions.length > 0 && state.portions.every((p) => p.finalDecision !== 'PENDING'));

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
  const modalOpen =
    modalPortion &&
    modalPortion.finalDecision === 'PENDING' &&
    modalPortion.reviewStatus !== 'PENDING' &&
    !finished;
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

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12 text-xs font-semibold text-slate-500">
        <Loader2 className="mr-2 h-5 w-5 animate-spin text-primary" /> Loading…
      </div>
    );
  }

  return (
    <section className="space-y-4" aria-label="Laboratory tests">
      {/* Session Header Card */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4 shadow-2xs">
        <div>
          <div className="flex items-center space-x-2">
            <FlaskConical className="h-5 w-5 text-primary" />
            <h3 className="text-base font-bold text-slate-900">
              {arrivalType === 'MOT' ? 'Mobile Tester Arrival Testing' : 'HC Arrival Testing'}
            </h3>
            <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-semibold text-primary">
              {state?.testMode === 'COMPOSITE' ? 'Composite' : 'Portion-wise'}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-slate-500">
            Token: <strong className="text-slate-800 tabular-nums">{tokenNo || '—'}</strong> · Vehicle:{' '}
            <strong className="text-slate-800">{vehicleNo || '—'}</strong>
          </p>
        </div>

      </div>

      {error && (
        <div className="bg-card border-border flex items-center gap-2 rounded-xl border p-3 text-xs text-rose-800">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{error}</span>
          <button type="button" onClick={load} className="min-h-11 min-w-11 ml-auto font-semibold underline">
            Try again
          </button>
        </div>
      )}

      {/* Testing Method Selector: Composite vs Portion-wise (available for all arrivals) */}
      {!finished && state && (
        <div className="space-y-2.5 rounded-xl border border-border bg-card p-4 shadow-2xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-bold text-slate-800 uppercase tracking-wider">
              Testing Method
            </p>
            {mode === 'PORTION_WISE' && !anyDecided && (
              <div className="flex items-center space-x-2">
                <span className="text-xs font-semibold text-slate-600">Portions:</span>
                <select
                  value={count}
                  onChange={(e) => handlePortionCountChange(e.target.value)}
                  disabled={Boolean(busy)}
                  className="min-h-11 h-8 rounded-lg border border-border px-2 text-xs font-bold bg-white text-slate-900"
                >
                  {[2, 3, 4, 5, 6].map((n) => (
                    <option key={n} value={n}>{n} Portions</option>
                  ))}
                </select>
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => handleModeSwitch('COMPOSITE')}
              disabled={anyDecided || Boolean(busy)}
              className={cn(
                'min-h-[48px] rounded-xl border px-3 text-left text-xs font-semibold transition flex flex-col justify-center',
                mode === 'COMPOSITE'
                  ? 'border-primary bg-primary text-white shadow-2xs'
                  : 'border-border bg-card text-slate-700 hover:bg-slate-50',
                anyDecided && 'opacity-60 cursor-not-allowed'
              )}
            >
              <div className="font-bold">Composite</div>
              <div className={cn('text-[10px] font-normal', mode === 'COMPOSITE' ? 'text-white/80' : 'text-slate-500')}>
                One sample
              </div>
            </button>
            <button
              type="button"
              onClick={() => handleModeSwitch('PORTION_WISE')}
              disabled={anyDecided || Boolean(busy)}
              className={cn(
                'min-h-[48px] rounded-xl border px-3 text-left text-xs font-semibold transition flex flex-col justify-center',
                mode === 'PORTION_WISE'
                  ? 'border-primary bg-primary text-white shadow-2xs'
                  : 'border-border bg-card text-slate-700 hover:bg-slate-50',
                anyDecided && 'opacity-60 cursor-not-allowed'
              )}
            >
              <div className="font-bold">Portion-wise</div>
              <div className={cn('text-[10px] font-normal', mode === 'PORTION_WISE' ? 'text-white/80' : 'text-slate-500')}>
                Portions ({state.portions.length})
              </div>
            </button>
          </div>
        </div>
      )}

      {/* Finished Banner */}
      {finished && state && (
        <div
          className={cn(
            'flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4 shadow-2xs',
            state.rollUp.allRejected
              ? 'border-border bg-card text-rose-900'
              : 'border-border bg-card text-emerald-900'
          )}
        >
          <div className="flex items-center space-x-2">
            {state.rollUp.allRejected ? (
              <XCircle className="h-5 w-5 text-rose-700" aria-hidden="true" />
            ) : (
              <CheckCircle2 className="h-5 w-5 text-emerald-700" aria-hidden="true" />
            )}
            <p className="text-xs font-semibold">
              {state.rollUp.allRejected
                ? `All portions rejected. Vehicle rejected${state.journeyClosed && arrivalType === 'MOT' ? ' and journey closed' : ''}.`
                : `${state.rollUp.accepted} portion(s) accepted, ${state.rollUp.rejected} rejected. Ready for weighing & tank unloading.`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {onViewHistory && (
              <button
                type="button"
                onClick={onViewHistory}
                className="min-h-11 px-3 text-xs font-semibold rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 transition shadow-2xs"
              >
                View in Test History
              </button>
            )}
            {onFinished && (
              <button
                type="button"
                onClick={onFinished}
                className="min-h-11 px-4 text-xs font-bold rounded-lg bg-emerald-700 text-white hover:bg-emerald-800 transition shadow-2xs"
              >
                Done &amp; Back to Queue
              </button>
            )}
          </div>
        </div>
      )}

      {/* Portions Section Header with Add Portion Action */}
      {state && !showSetup && (
        <div className="flex items-center justify-between gap-2 pt-1">
          <div className="flex items-center space-x-2">
            <span className="text-xs font-bold text-slate-800 uppercase tracking-wider">
              Portion Samples ({state.portions.length})
            </span>
            <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-primary">
              {state.testMode === 'COMPOSITE' ? 'Composite' : 'Portion-wise'}
            </span>
          </div>

          {!finished && state.sessionStatus === 'IN_PROGRESS' && state.portions.length < 12 && (
            <button
              type="button"
              onClick={handleAddPortion}
              disabled={Boolean(busy)}
              className="flex min-h-11 items-center space-x-1.5 rounded-xl border border-dashed border-primary px-3.5 text-xs font-bold text-primary shadow-2xs hover:bg-primary/5 transition disabled:opacity-50"
              title="Add another test portion"
            >
              {busy === 'add-portion' ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : null}
              <span>+ Add Portion</span>
            </button>
          )}
        </div>
      )}

      {/* Minimalist Portions Grid Overview */}
      {state && !showSetup && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {state.portions.map((p) => {
            const isCompleted = p.finalDecision !== 'PENDING';
            const isPendingReview = p.reviewStatus === 'PENDING';

            return (
              <article
                key={p.id}
                className="flex flex-col justify-between rounded-xl border border-border bg-card p-4 shadow-2xs transition hover:border-slate-300"
              >
                <div className="space-y-2.5">
                  <header className="flex items-center justify-between gap-2 border-b border-border pb-2">
                    <h4 className="text-sm font-bold text-slate-900">
                      {state.testMode === 'COMPOSITE' ? 'Composite Sample' : `Portion #${p.portionNumber}`}
                    </h4>
                    {portionBadge(p)}
                  </header>

                  <div className="space-y-1 text-xs text-slate-600">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">Quantity:</span>
                      <strong className="text-slate-900 tabular-nums">
                        {p.quantityValue ? `${p.quantityValue} KG` : p.grossLiters ? `${p.grossLiters} KG` : '—'}
                      </strong>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">Quality:</span>
                      <span className="tabular-nums font-semibold text-slate-800">
                        {p.lr !== null || p.fat !== null ? `LR ${p.lr ?? '—'} · Fat ${p.fat ?? '—'}%` : 'Not recorded'}
                      </span>
                    </div>
                    {isPendingReview && (
                      <p className="font-semibold text-violet-800 text-[11px] pt-1">
                        With manager
                      </p>
                    )}
                    {p.reviewedAt && (
                      <p className="text-[11px] text-slate-500 pt-1">
                        Manager decided {new Date(p.reviewedAt).toLocaleDateString()}
                        {p.reviewRemarks ? `: "${p.reviewRemarks}"` : ''}
                      </p>
                    )}
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-border space-y-2">
                  <button
                    type="button"
                    onClick={() => setActivePortionModal(p)}
                    className={cn('min-h-11 min-w-11', 
                      'flex w-full items-center justify-center rounded-lg text-sm font-semibold shadow-2xs transition',
                      !isCompleted && !isPendingReview
                        ? 'bg-primary text-white hover:bg-primary-hover'
                        : 'border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                    )}
                  >
                    <span>{!isCompleted && !isPendingReview ? 'Test & Decide' : 'View details'}</span>
                  </button>

                  {state.portions.length > 1 && !isCompleted && !isPendingReview && !p.quantityValue && !p.grossLiters && p.lr === null && p.fat === null && p.photos.length === 0 && !finished && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDiscardPortion(p.portionNumber);
                      }}
                      disabled={Boolean(busy)}
                      className="w-full min-h-11 flex items-center justify-center text-xs text-rose-700 hover:text-rose-900 font-semibold py-1.5 px-3 rounded-lg border border-rose-200 bg-rose-50 hover:bg-rose-100 transition"
                    >
                      <span>{busy === `discard-${p.portionNumber}` ? 'Discarding…' : 'Discard Empty Portion'}</span>
                    </button>
                  )}
                </div>
              </article>
            );
          })}

          {/* Dashed Add Card */}
          {!finished && state.sessionStatus === 'IN_PROGRESS' && state.portions.length < 12 && (
            <button
              type="button"
              onClick={handleAddPortion}
              disabled={Boolean(busy)}
              className="flex min-h-[180px] flex-col items-center justify-center rounded-xl border-2 border-dashed border-primary/30 bg-primary/5 p-6 text-center text-primary transition hover:border-primary hover:bg-primary/10 shadow-2xs disabled:opacity-50"
            >
              {busy === 'add-portion' ? (
                <Loader2 className="mb-1 h-5 w-5 animate-spin text-primary" />
              ) : (
                <span className="text-base font-bold mb-1">+</span>
              )}
              <span className="text-xs font-bold">Add Another Portion</span>
              <span className="mt-0.5 text-[11px] font-normal text-slate-500">
                Test additional chamber or compartment
              </span>
            </button>
          )}
        </div>
      )}

      {/* Portion Decision Modal: Dialog on desktop, Drawer on mobile */}
      <Drawer
        open={Boolean(activePortionModal)}
        onOpenChange={(open) => {
          if (!open && !busy) setActivePortionModal(null);
        }}
      >
        <DrawerContent className="max-w-2xl">
          {modalPortion && modalDraft && (
            <>
              <div className="flex items-center justify-between border-b border-border px-4 py-3 sm:px-5">
                <div>
                  <DrawerTitle className="text-base font-bold text-slate-900">
                    {state?.testMode === 'COMPOSITE' ? 'Composite Sample Tests & Decision' : `Portion #${modalPortion.portionNumber} Tests & Decision`}
                  </DrawerTitle>
                  <p className="text-xs text-slate-500 font-medium">
                    Vehicle: <strong className="text-slate-800">{vehicleNo || '—'}</strong> · Token: <strong className="text-slate-800 tabular-nums">{tokenNo || '—'}</strong>
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setActivePortionModal(null)}
                  disabled={Boolean(busy)}
                  aria-label="Close"
                  className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="space-y-4 overflow-y-auto p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-5">
                {/* Read-only summary if portion is already decided */}
                {!modalOpen && (
                  <div className="bg-card border-border space-y-2 rounded-xl border p-4 text-xs text-slate-700">
                    <p className="font-semibold text-slate-900">
                      Person Decision: <strong>{modalPortion.personDecision === 'REJECT' ? 'Reject' : modalPortion.personDecision === 'ACCEPT' ? 'Accept' : '—'}</strong>
                      {modalPortion.decisionRemarks ? ` · "${modalPortion.decisionRemarks}"` : ''}
                    </p>
                    {modalPortion.exceptionReasons.length > 0 && (
                      <p className="text-amber-800">Reasons: {modalPortion.exceptionReasons.map(reasonText).join(', ')}</p>
                    )}
                    {modalPortion.reviewStatus === 'PENDING' && (
                      <p className="font-semibold text-violet-800">With Zonal Manager</p>
                    )}
                    {modalPortion.reviewedAt && (
                      <p>
                        Manager decided {new Date(modalPortion.reviewedAt).toLocaleString()}
                        {modalPortion.reviewRemarks ? `: "${modalPortion.reviewRemarks}"` : ''}
                      </p>
                    )}
                    {(modalPortion.lr !== null || modalPortion.fat !== null) && (
                      <p className="tabular-nums font-semibold">
                        LR {modalPortion.lr ?? '—'} · Fat {modalPortion.fat ?? '—'}%
                        {modalPortion.quantityValue !== null ? ` · ${modalPortion.quantityValue} KG` : modalPortion.grossLiters !== null ? ` · ${modalPortion.grossLiters} KG` : ''}
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

                        const evalRes = evaluate3ZoneTest(
                          {
                            min: t.rule?.min,
                            max: t.rule?.max,
                            warningTrigger: t.rule?.warningTrigger,
                            decisionConsequence: t.rule?.decisionConsequence,
                            acceptableOption: t.rule?.acceptableOption,
                            category: t.rule?.ruleCategory,
                            ruleCategory: t.rule?.ruleCategory,
                            testMode: t.testMode,
                            resultType: t.resultType,
                            resultOptions: t.resultOptions,
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
                                  <span className="text-xs font-semibold text-slate-800">{t.testName}</span>
                                  <span
                                    className={cn(
                                      'rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                                      isRequired ? 'bg-primary text-white shadow-2xs' : 'bg-slate-100 text-slate-600'
                                    )}
                                  >
                                    {isCalc ? 'Auto' : isRequired ? 'Required *' : 'Optional'}
                                  </span>
                                  {chip && (
                                    <span
                                      className={cn(
                                        'rounded-full border px-2 py-0.5 text-[10px] font-semibold tabular-nums',
                                        isFail
                                          ? 'border-rose-300 bg-rose-50 text-rose-800'
                                          : isWarning
                                            ? 'border-amber-300 bg-amber-50 text-amber-900 font-bold'
                                            : 'border-slate-300 bg-slate-50 text-slate-700'
                                      )}
                                    >
                                      {chip}
                                    </span>
                                  )}
                                </div>
                                <div className="text-[11px] text-slate-500 mt-0.5">
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
                                    className="min-h-11 h-10 w-28 cursor-not-allowed rounded-lg border border-border bg-muted px-2 text-base sm:text-sm font-semibold tabular-nums text-slate-600"
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
                                      'flex items-center gap-1 rounded-lg border px-2.5 text-xs font-semibold transition',
                                      modalPhotos[t.labTestId]
                                        ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                                        : t.photoMode === 'REQUIRED'
                                          ? 'border-amber-300 bg-amber-50 text-amber-900'
                                          : 'border-border bg-card text-slate-700 hover:bg-slate-50'
                                    )}
                                  >
                                    {photoBusy ? (
                                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    ) : modalPhotos[t.labTestId] ? (
                                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                                    ) : (
                                      <Camera className="h-3.5 w-3.5" />
                                    )}
                                    <span>{modalPhotos[t.labTestId] ? 'Photo saved' : 'Take photo'}</span>
                                  </button>
                                )}
                              </div>
                            </div>

                            {Boolean(v) && (
                              <p
                                className={cn(
                                  'flex items-center gap-1 text-[11px] font-semibold',
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
                      <p className="mb-1 text-xs font-semibold text-slate-900">Your Decision</p>
                      <div className="grid grid-cols-2 gap-2.5">
                        <button
                          type="button"
                          onClick={() => setDraft(modalPortion.id, { person: 'REJECT' })}
                          className={cn(
                            'flex min-h-[48px] items-center justify-center rounded-xl border text-xs font-bold transition',
                            modalDraft.person === 'REJECT'
                              ? 'border-rose-600 bg-rose-600 text-white shadow-2xs'
                              : 'border-rose-300 bg-white text-rose-700 hover:bg-rose-50'
                          )}
                        >
                          <span>Reject Portion</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setDraft(modalPortion.id, { person: 'ACCEPT' })}
                          className={cn(
                            'flex min-h-[48px] items-center justify-center rounded-xl border text-xs font-bold transition',
                            modalDraft.person === 'ACCEPT'
                              ? 'border-emerald-600 bg-emerald-600 text-white shadow-2xs'
                              : 'border-emerald-300 bg-white text-emerald-700 hover:bg-emerald-50'
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
                          'rounded-xl border p-3 text-xs',
                          modalPreview.route === 'PROCEED'
                            ? 'border-border bg-card text-emerald-900'
                            : modalPreview.route === 'REJECT'
                              ? 'border-border bg-card text-rose-900'
                              : 'border-border bg-card text-amber-900'
                        )}
                      >
                        <p className="font-bold">
                          System result: {modalPreview.systemOutcome === 'PASS' ? 'Passed' : modalPreview.route === 'SEND_TO_APPROVER' ? 'Warning (QA Review)' : 'Failed'}
                          {modalPreview.route === 'SEND_TO_APPROVER' && ' · Goes to manager'}
                          {modalPreview.route === 'DECIDE_NOW' && ' · You decide'}
                        </p>
                        {modalPreview.exceptionReasons.length > 0 && (
                          <ul className="mt-1 list-disc pl-5 space-y-0.5">
                            {modalPreview.exceptionReasons.map((r) => (
                              <li key={r}>{reasonText(r)}</li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}

                    <div className="space-y-2">
                      <label htmlFor="portion-remarks" className="block text-xs font-semibold text-slate-700">
                        {modalPreview?.remarksRequired ? 'Remarks / Justification (Required)' : 'Remarks (Optional)'}
                      </label>
                      <textarea
                        id="portion-remarks"
                        value={modalDraft.remarks}
                        onChange={(e) => setDraft(modalPortion.id, { remarks: e.target.value })}
                        rows={2}
                        placeholder={modalPreview?.remarksRequired ? 'Enter reason…' : 'Observations…'}
                        className="min-h-11 w-full resize-none rounded-xl border border-border p-2.5 text-base sm:text-xs font-medium focus:outline-none focus:ring-2 focus:ring-primary"
                      />
                    </div>

                    {itemError[modalPortion.id] && (
                      <p className="text-xs font-semibold text-rose-700">{itemError[modalPortion.id]}</p>
                    )}

                    {/* Submit Button */}
                    <div className="pt-2">
                      <button
                        type="button"
                        disabled={!modalDraft.person || busy === `submit:${modalPortion.id}`}
                        onClick={() => submit(modalPortion)}
                        className={cn(
                          'flex min-h-[48px] w-full items-center justify-center rounded-xl text-xs font-bold text-white shadow-2xs transition disabled:opacity-50',
                          modalPreview?.route === 'SEND_TO_APPROVER'
                            ? 'bg-violet-600 hover:bg-violet-700'
                            : modalDraft.person === 'REJECT'
                              ? 'bg-rose-600 hover:bg-rose-700'
                              : 'bg-emerald-700 hover:bg-emerald-800'
                        )}
                      >
                        {busy === `submit:${modalPortion.id}` ? (
                          <Loader2 className="h-4 w-4 animate-spin mr-1.5" aria-hidden="true" />
                        ) : null}
                        <span>
                          {modalPreview?.route === 'SEND_TO_APPROVER'
                            ? 'Send to manager'
                            : modalPreview?.route === 'DECIDE_NOW'
                              ? `${modalDraft.person === 'REJECT' ? 'Reject' : 'Accept'} now`
                              : modalDraft.person === 'REJECT'
                                ? 'Reject portion'
                                : 'Accept portion'}
                        </span>
                      </button>
                    </div>
                  </>
                )}
              </div>
            </>
          )}
        </DrawerContent>
      </Drawer>

      {/* Camera Overlay */}
      {camera && state && (
        <LiveCamera
          stamp={{
            employeeCode: me.code,
            roleLabel: me.role,
            pointLabel: `ZMCC lab ${state.point === 'ZMCC_LAB_MC' ? 'Mobile Tester' : 'HC'} - P${camera.portion.portionNumber} - ${camera.test.testName}`,
            vehicleNo: vehicleNo ?? null,
            tokenNo: tokenNo ?? null,
          }}
          onCapture={(res) => void uploadPhoto(camera.portion, camera.test, res)}
          onCancel={() => setCamera(null)}
        />
      )}

    </section>
  );
};
