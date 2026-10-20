'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Camera, CheckCircle2, Layers, Loader2, Plus, Send, XCircle } from 'lucide-react';
import { LiveCamera } from '@/components/camera/LiveCamera';
import { Modal } from '@/components/ui/modal';
import { DecisionStatusBadge } from '@/frontend/modules/shared/decision/DecisionStatusBadge';
import { buildLabPortionDecision, MAX_LAB_PORTIONS, type LabPolicyTest, type LabPortionView } from '@/backend/services/zmcc/labPortionDecision';
import type { LabPortionsState } from '@/backend/services/zmccLabService';
import type { LiveCameraResult } from '@/types/captured-photo';
import type { PersonDecision } from '@/types/stage1-decision';
import { getErrorMessage } from '@/lib/errors';
import { cn } from '@/lib/utils';

export interface LabPortionsPanelProps {
  sessionId: string;
  arrivalType: string;
  tokenNo?: string | null;
  vehicleNo?: string | null;
  arrivalId?: string | null;
  /** Called when every portion has a final decision (vehicle finished at the lab). */
  onFinished?: () => void;
}

type Draft = {
  quantity: string;
  unit: 'KG' | 'LITER';
  values: Record<string, string>;
  person: PersonDecision | null;
  remarks: string;
};

const emptyDraft = (): Draft => ({ quantity: '', unit: 'KG', values: {}, person: null, remarks: '' });

function reasonText(reason: string): string {
  if (reason === 'MISMATCH') return 'Your decision differs from the test result';
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

export const LabPortionsPanel: React.FC<LabPortionsPanelProps> = ({ sessionId, arrivalType, tokenNo, vehicleNo, arrivalId, onFinished }) => {
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
  const [me, setMe] = useState<{ code: string; role: string }>({ code: 'unknown', role: 'unknown' });
  const [sourceOpen, setSourceOpen] = useState(false);
  const [sourceName, setSourceName] = useState('');
  const [sourcePhone, setSourcePhone] = useState('');
  const [sourceNotes, setSourceNotes] = useState('');
  const [sourceMsg, setSourceMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`/api/zmcc/lab/sessions/${sessionId}/portions`, { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not load portions.');
      const s = data as LabPortionsState;
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
  }, [sessionId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    let alive = true;
    fetch('/api/auth/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const u = d?.user;
        if (alive && u) setMe({ code: u.employee_code || u.username || 'unknown', role: u.role || 'unknown' });
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const anyDecided = !!state?.portions.some((p) => p.personDecision !== null || p.finalDecision !== 'PENDING');
  const showSetup = !!state && state.sessionStatus === 'IN_PROGRESS' && (state.portions.length === 0 || editingSetup) && !anyDecided;

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
  const setDraft = (id: string, patch: Partial<Draft>) => setDrafts((d) => ({ ...d, [id]: { ...(d[id] ?? emptyDraft()), ...patch } }));

  const preview = useCallback(
    (p: LabPortionView) => {
      if (!state) return null;
      const d = drafts[p.id] ?? emptyDraft();
      if (!d.person) return null;
      const ph = photos[p.id] ?? {};
      return buildLabPortionDecision(state.policy, {
        tests: state.policy.tests.map((t) => ({
          labTestId: t.labTestId,
          value: t.resultType === 'NUMERIC' && d.values[t.labTestId] ? Number(d.values[t.labTestId]) : null,
          textValue: t.resultType !== 'NUMERIC' ? d.values[t.labTestId] || null : null,
        })),
        photos: Object.entries(ph).map(([labTestId, captureId]) => ({ labTestId, captureId })),
        personDecision: d.person,
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
      const res = await fetch(`/api/zmcc/lab/sessions/${sessionId}/portions/${p.id}/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          version: p.version,
          person_decision: d.person,
          remarks: d.remarks.trim() || null,
          quantity_value: d.quantity.trim() ? Number(d.quantity) : null,
          quantity_unit: d.unit,
          tests: state.policy.tests.map((t) => ({
            lab_test_id: t.labTestId,
            value: t.resultType === 'NUMERIC' ? d.values[t.labTestId] ?? null : null,
            text_value: t.resultType !== 'NUMERIC' ? d.values[t.labTestId] ?? null : null,
          })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setItemError((e) => ({ ...e, [p.id]: data.error || 'Could not save.' }));
        if (res.status === 409) load();
        return;
      }
      await load();
    } catch (err) {
      setItemError((e) => ({ ...e, [p.id]: getErrorMessage(err) || 'Could not save.' }));
    } finally {
      setBusy(null);
    }
  };

  const sendSourceRequest = async () => {
    setBusy('source');
    setSourceMsg(null);
    try {
      const res = await fetch('/api/zmcc/lab/source-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source_name: sourceName, phone: sourcePhone || null, notes: sourceNotes || null, arrival_id: arrivalId ?? null }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not send.');
      setSourceOpen(false);
      setSourceName('');
      setSourcePhone('');
      setSourceNotes('');
      setSourceMsg('Request sent to the Zonal Manager.');
    } catch (err) {
      setSourceMsg(getErrorMessage(err) || 'Could not send.');
    } finally {
      setBusy(null);
    }
  };

  const finished = state?.sessionStatus === 'COMPLETED';
  const pointLabel = state?.point === 'ZMCC_LAB_MC' ? 'MC (MOT milk)' : 'HC (local supplier)';
  const sortedTests = useMemo(() => state?.policy.tests ?? [], [state]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-6 text-slate-600">
        <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> Loading portions...
      </div>
    );
  }

  return (
    <section className="space-y-4" aria-label="Lab portions">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="flex items-center gap-2 text-base font-semibold text-slate-800">
            <Layers className="h-5 w-5" aria-hidden="true" /> Tests for {pointLabel}
          </h3>
          {state && (
            <p className="text-sm text-slate-600">
              {state.testMode === 'PORTION_WISE' ? `Portion-wise: ${state.portions.length} portions` : 'Composite: 1 portion'} · rules version {state.policy.version}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {state && !anyDecided && state.portions.length > 0 && !editingSetup && !finished && (
            <button type="button" onClick={() => setEditingSetup(true)} className="min-h-[44px] rounded-xl border border-border bg-white px-4 text-sm font-semibold text-slate-700">
              Change portions
            </button>
          )}
          <button
            type="button"
            onClick={() => setSourceOpen(true)}
            className="flex min-h-[44px] items-center gap-1.5 rounded-xl border border-border bg-white px-4 text-sm font-semibold text-slate-700"
          >
            <Plus className="h-4 w-4" aria-hidden="true" /> Request new source
          </button>
        </div>
      </div>
      {sourceMsg && <p className="rounded-xl border border-border bg-slate-50 p-3 text-sm">{sourceMsg}</p>}

      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-red-300 bg-red-50 p-3 text-red-800">
          <AlertTriangle className="h-5 w-5" aria-hidden="true" /> {error}
          <button type="button" onClick={load} className="ml-auto min-h-[44px] px-3 font-semibold underline">Try again</button>
        </div>
      )}

      {state && state.policy.tests.length === 0 && (
        <div className="flex items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-amber-900">
          <AlertTriangle className="h-5 w-5" aria-hidden="true" /> No tests are switched on for this lab point. Ask the Super Admin to set the test matrix.
        </div>
      )}

      {showSetup && (
        <div className="space-y-3 rounded-2xl border border-border bg-white p-4">
          <p className="font-semibold text-slate-800">How will you test this vehicle?</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {(['COMPOSITE', 'PORTION_WISE'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={cn(
                  'min-h-[56px] rounded-xl border px-4 text-left text-base font-semibold',
                  mode === m ? 'border-primary bg-primary text-white' : 'border-border bg-white text-slate-700'
                )}
              >
                {m === 'COMPOSITE' ? 'Composite (one sample for the whole vehicle)' : 'Portion-wise (test each portion)'}
              </button>
            ))}
          </div>
          {mode === 'PORTION_WISE' && (
            <label className="block text-sm font-semibold text-slate-700">
              Number of portions
              <input
                type="number"
                min={2}
                max={MAX_LAB_PORTIONS}
                value={count}
                onChange={(e) => setCount(e.target.value)}
                className="mt-1 block h-12 w-32 rounded-xl border border-border-strong px-3 text-base"
              />
            </label>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={saveSetup}
              disabled={busy === 'setup'}
              className="flex h-14 flex-1 items-center justify-center gap-2 rounded-xl bg-primary text-lg font-bold text-white disabled:opacity-50 sm:flex-none sm:px-8"
            >
              {busy === 'setup' && <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />} Start tests
            </button>
            {editingSetup && (
              <button type="button" onClick={() => setEditingSetup(false)} className="h-14 rounded-xl border border-border px-6 font-semibold">
                Cancel
              </button>
            )}
          </div>
        </div>
      )}

      {finished && state && (
        <div
          className={cn(
            'flex flex-wrap items-center gap-3 rounded-2xl border p-4',
            state.rollUp.allRejected ? 'border-red-300 bg-red-50 text-red-900' : 'border-green-300 bg-green-50 text-green-900'
          )}
        >
          {state.rollUp.allRejected ? <XCircle className="h-6 w-6" aria-hidden="true" /> : <CheckCircle2 className="h-6 w-6" aria-hidden="true" />}
          <p className="flex-1 font-semibold">
            {state.rollUp.allRejected
              ? `All portions rejected. Vehicle rejected${state.journeyClosed && arrivalType === 'MOT' ? ' and journey closed' : ''}.`
              : `${state.rollUp.accepted} portion(s) accepted, ${state.rollUp.rejected} rejected. Next: weighing and tank.`}
          </p>
          {onFinished && (
            <button type="button" onClick={onFinished} className="min-h-[44px] rounded-xl border border-current px-4 font-semibold">
              Back to queue
            </button>
          )}
        </div>
      )}

      {state && !showSetup &&
        state.portions.map((p) => {
          const d = draftOf(p.id);
          const open = p.status === 'TESTING' && p.finalDecision === 'PENDING' && p.reviewStatus !== 'PENDING' && !finished;
          const pv = open ? preview(p) : null;
          const ph = photos[p.id] ?? {};
          return (
            <article key={p.id} className="space-y-3 rounded-2xl border border-border bg-white p-4 shadow-2xs">
              <header className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="text-lg font-bold text-slate-900">
                  {state.testMode === 'COMPOSITE' ? 'Composite sample' : `Portion ${p.portionNumber}`}
                </h4>
                {portionBadge(p)}
              </header>

              {!open && (
                <div className="space-y-1 text-sm text-slate-700">
                  <p>
                    Person said: <strong>{p.personDecision === 'REJECT' ? 'Reject' : p.personDecision === 'ACCEPT' ? 'Accept' : '-'}</strong>
                    {p.decisionRemarks ? ` - "${p.decisionRemarks}"` : ''}
                  </p>
                  {p.exceptionReasons.length > 0 && <p>Reasons: {p.exceptionReasons.map(reasonText).join(', ')}</p>}
                  {p.reviewStatus === 'PENDING' && <p className="font-semibold text-violet-800">Sent to Zonal Manager. Waiting for decision.</p>}
                  {p.reviewedAt && <p>Decided by Zonal Manager {new Date(p.reviewedAt).toLocaleString()}{p.reviewRemarks ? `: ${p.reviewRemarks}` : ''}</p>}
                  {(p.lr !== null || p.fat !== null) && <p>LR {p.lr ?? '-'} · Fat {p.fat ?? '-'}{p.grossLiters !== null ? ` · ${p.grossLiters} L` : ''}</p>}
                </div>
              )}

              {open && (
                <>
                  <div className="flex flex-wrap items-end gap-3">
                    <label className="text-sm font-semibold text-slate-700">
                      Quantity (optional)
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={d.quantity}
                        onChange={(e) => setDraft(p.id, { quantity: e.target.value })}
                        className="mt-1 block h-12 w-40 rounded-xl border border-border-strong px-3 text-base tabular-nums"
                      />
                    </label>
                    <label className="text-sm font-semibold text-slate-700">
                      Unit
                      <select
                        value={d.unit}
                        onChange={(e) => setDraft(p.id, { unit: e.target.value as 'KG' | 'LITER' })}
                        className="mt-1 block h-12 w-28 rounded-xl border border-border-strong px-2 text-base"
                      >
                        <option value="KG">KG</option>
                        <option value="LITER">Litres</option>
                      </select>
                    </label>
                  </div>

                  <div className="divide-y divide-border rounded-xl border border-border">
                    {sortedTests.map((t) => {
                      const v = d.values[t.labTestId] ?? '';
                      const photoBusy = busy === `photo:${p.id}:${t.labTestId}`;
                      return (
                        <div key={t.labTestId} className="flex flex-wrap items-center gap-3 p-3">
                          <div className="min-w-[10rem] flex-1">
                            <div className="font-semibold text-slate-800">{t.testName}</div>
                            <div className="text-xs text-slate-500">
                              {t.testMode === 'COMPULSORY' ? 'Must do' : 'Optional'}
                              {t.unit ? ` · ${t.unit}` : ''}
                              {t.rule && (t.rule.min !== null || t.rule.max !== null) ? ` · allowed ${t.rule.min ?? '…'} to ${t.rule.max ?? '…'}` : ''}
                              {t.ruleMode === 'WARN' ? ' · warning only' : ''}
                            </div>
                          </div>
                          {t.resultType === 'NUMERIC' ? (
                            <input
                              type="number"
                              step="any"
                              value={v}
                              aria-label={t.testName}
                              onChange={(e) => setDraft(p.id, { values: { ...d.values, [t.labTestId]: e.target.value } })}
                              className="h-12 w-32 rounded-xl border border-border-strong px-3 text-base tabular-nums"
                            />
                          ) : t.options ? (
                            <select
                              value={v}
                              aria-label={t.testName}
                              onChange={(e) => setDraft(p.id, { values: { ...d.values, [t.labTestId]: e.target.value } })}
                              className="h-12 w-40 rounded-xl border border-border-strong px-2 text-base"
                            >
                              <option value="">Choose</option>
                              {t.options.map((o) => <option key={o} value={o}>{o}</option>)}
                            </select>
                          ) : (
                            <input
                              type="text"
                              value={v}
                              aria-label={t.testName}
                              onChange={(e) => setDraft(p.id, { values: { ...d.values, [t.labTestId]: e.target.value } })}
                              className="h-12 w-40 rounded-xl border border-border-strong px-3 text-base"
                            />
                          )}
                          {t.photoMode !== 'NONE' && (
                            <button
                              type="button"
                              disabled={photoBusy}
                              onClick={() => setCamera({ portion: p, test: t })}
                              className={cn(
                                'flex min-h-[44px] items-center gap-1.5 rounded-xl border px-3 text-sm font-semibold',
                                ph[t.labTestId]
                                  ? 'border-green-300 bg-green-50 text-green-800'
                                  : t.photoMode === 'REQUIRED'
                                    ? 'border-amber-300 bg-amber-50 text-amber-900'
                                    : 'border-border bg-white text-slate-700'
                              )}
                            >
                              {photoBusy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : ph[t.labTestId] ? <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> : <Camera className="h-4 w-4" aria-hidden="true" />}
                              {ph[t.labTestId] ? 'Photo saved (retake)' : t.photoMode === 'REQUIRED' ? 'Take photo (needed)' : 'Take photo'}
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setDraft(p.id, { person: 'REJECT' })}
                      className={cn(
                        'flex h-14 items-center justify-center gap-2 rounded-xl border text-lg font-bold',
                        d.person === 'REJECT' ? 'border-red-600 bg-red-600 text-white' : 'border-red-300 bg-white text-red-700'
                      )}
                    >
                      <XCircle className="h-6 w-6" aria-hidden="true" /> Reject
                    </button>
                    <button
                      type="button"
                      onClick={() => setDraft(p.id, { person: 'ACCEPT' })}
                      className={cn(
                        'flex h-14 items-center justify-center gap-2 rounded-xl border text-lg font-bold',
                        d.person === 'ACCEPT' ? 'border-green-600 bg-green-600 text-white' : 'border-green-300 bg-white text-green-700'
                      )}
                    >
                      <CheckCircle2 className="h-6 w-6" aria-hidden="true" /> Accept
                    </button>
                  </div>

                  {pv && (
                    <div
                      className={cn(
                        'rounded-xl border p-3 text-sm',
                        pv.route === 'PROCEED' ? 'border-green-300 bg-green-50 text-green-900'
                          : pv.route === 'REJECT' ? 'border-red-300 bg-red-50 text-red-900'
                            : 'border-amber-300 bg-amber-50 text-amber-900'
                      )}
                    >
                      <p className="font-semibold">
                        Test result: {pv.systemOutcome === 'PASS' ? '✓ Passed' : '✗ Failed'}
                        {pv.route === 'SEND_TO_APPROVER' && ' · This will be sent to the Zonal Manager.'}
                        {pv.route === 'DECIDE_NOW' && ' · Exception: you can decide it now.'}
                      </p>
                      {pv.exceptionReasons.length > 0 && (
                        <ul className="mt-1 list-disc pl-5">
                          {pv.exceptionReasons.map((r) => <li key={r}>{reasonText(r)}</li>)}
                        </ul>
                      )}
                    </div>
                  )}

                  <textarea
                    value={d.remarks}
                    onChange={(e) => setDraft(p.id, { remarks: e.target.value })}
                    rows={2}
                    placeholder={pv?.remarksRequired ? 'Remarks (needed)' : 'Remarks (optional)'}
                    className="w-full rounded-xl border border-border-strong p-2 text-base"
                  />
                  {itemError[p.id] && <p className="text-sm font-semibold text-red-700">{itemError[p.id]}</p>}

                  <button
                    type="button"
                    disabled={!d.person || busy === `submit:${p.id}`}
                    onClick={() => submit(p)}
                    className={cn(
                      'flex h-14 w-full items-center justify-center gap-2 rounded-xl text-lg font-bold text-white disabled:opacity-50',
                      pv?.route === 'SEND_TO_APPROVER' ? 'bg-violet-600' : d.person === 'REJECT' ? 'bg-red-600' : 'bg-green-600'
                    )}
                  >
                    {busy === `submit:${p.id}` ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> : pv?.route === 'SEND_TO_APPROVER' ? <Send className="h-5 w-5" aria-hidden="true" /> : null}
                    {pv?.route === 'SEND_TO_APPROVER'
                      ? 'Send to Zonal Manager'
                      : pv?.route === 'DECIDE_NOW'
                        ? `Decide now: ${d.person === 'REJECT' ? 'Reject' : 'Accept'}`
                        : d.person === 'REJECT'
                          ? 'Save: Reject'
                          : 'Save: Accept'}
                  </button>
                </>
              )}
              {!open && itemError[p.id] && <p className="text-sm font-semibold text-red-700">{itemError[p.id]}</p>}
            </article>
          );
        })}

      {camera && state && (
        <LiveCamera
          stamp={{
            employeeCode: me.code,
            roleLabel: me.role,
            pointLabel: `ZMCC lab ${state.point === 'ZMCC_LAB_MC' ? 'MC' : 'HC'} - P${camera.portion.portionNumber} - ${camera.test.testName}`,
            vehicleNo: vehicleNo ?? null,
            tokenNo: tokenNo ?? null,
          }}
          onCapture={(res) => void uploadPhoto(camera.portion, camera.test, res)}
          onCancel={() => setCamera(null)}
        />
      )}

      {sourceOpen && (
        <Modal onClose={() => setSourceOpen(false)} title="Request new source" className="max-w-md space-y-3 p-6">
          <p className="text-sm text-slate-600">The Zonal Manager will be asked to add this source.</p>
          <label className="block text-sm font-semibold text-slate-700">
            Source name
            <input value={sourceName} onChange={(e) => setSourceName(e.target.value)} className="mt-1 block h-12 w-full rounded-xl border border-border-strong px-3 text-base" />
          </label>
          <label className="block text-sm font-semibold text-slate-700">
            Phone (optional)
            <input value={sourcePhone} onChange={(e) => setSourcePhone(e.target.value)} className="mt-1 block h-12 w-full rounded-xl border border-border-strong px-3 text-base" />
          </label>
          <label className="block text-sm font-semibold text-slate-700">
            Notes (optional)
            <textarea value={sourceNotes} onChange={(e) => setSourceNotes(e.target.value)} rows={2} className="mt-1 block w-full rounded-xl border border-border-strong p-2 text-base" />
          </label>
          {sourceMsg && <p className="text-sm font-semibold text-red-700">{sourceMsg}</p>}
          <button
            type="button"
            disabled={busy === 'source' || sourceName.trim().length < 3}
            onClick={sendSourceRequest}
            className="flex h-14 w-full items-center justify-center gap-2 rounded-xl bg-primary text-lg font-bold text-white disabled:opacity-50"
          >
            <Send className="h-5 w-5" aria-hidden="true" /> Send request
          </button>
        </Modal>
      )}
    </section>
  );
};
