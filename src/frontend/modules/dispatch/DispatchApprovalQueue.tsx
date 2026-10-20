'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock, Loader2, XCircle } from 'lucide-react';
import { getErrorMessage } from '@/lib/errors';
import { cn } from '@/lib/utils';

type Tab = 'PENDING' | 'DECIDED';
type Outcome = 'PASS' | 'FAIL' | 'WARN' | 'NOT_TESTED';

interface PhotoRef {
  captureId: string;
  received: boolean;
}

export interface DispatchApprovalItem {
  id: string;
  dispatchNumber: string;
  sourceId: string;
  sourceName: string;
  sourceType: 'ZMCC' | 'CONTRACTOR';
  vehicleNumber: string;
  submittedBy: string;
  submittedAt: string;
  performedAsRole: string | null;
  isDelegated: boolean;
  testMode: 'COMPOSITE' | 'PORTION_WISE';
  totals: { grossLiters: number; weightedLr: number; weightedFat: number; weightedTs13: number };
  portions: Array<{
    portionNumber: number;
    sealNumber: string;
    quantityLiters: number;
    lr: number | null;
    fat: number | null;
    tests: Array<{ testCode: string; testName: string; value: number | null; outcome: Outcome }>;
    photos: PhotoRef[];
  }>;
  labReportPhoto: PhotoRef | null;
  personDecision: 'ACCEPT' | 'REJECT';
  decisionRemarks: string | null;
  exceptionReasons: string[];
  status: string;
  version: number;
  submittedById?: string | null;
}

export interface DispatchApprovalQueueProps {
  canDecide: boolean;
  currentUserId?: string | null;
  sourceType?: 'ZMCC' | 'CONTRACTOR' | 'ALL';
  onCountChange?: (waiting: number) => void;
}

function reasonText(reason: string): string {
  if (reason === 'MISMATCH') return 'The person decision differs from the test result';
  if (reason === 'PICTURE_MISSING') return 'Picture missing';
  if (reason === 'MISSING_FIELD' || reason === 'COMPULSORY_TEST_MISSING') return 'A compulsory test was not done';
  if (reason === 'LAB_REPORT_MISSING') return 'Lab report picture missing';
  if (reason.startsWith('RULE_FAIL:')) return `${reason.slice('RULE_FAIL:'.length)} failed`;
  return reason.replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase());
}

function waitingInfo(iso: string, now: number) {
  const mins = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60000));
  const text = mins < 60 ? `${mins} min` : `${Math.floor(mins / 60)} h ${mins % 60} min`;
  const cls = mins > 60 ? 'text-red-700' : mins > 15 ? 'text-amber-700' : 'text-slate-600';
  return { text, cls };
}

function OutcomeChip({ outcome }: { outcome: Outcome }) {
  if (outcome === 'PASS')
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-sm font-semibold text-green-800">
        <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> Passed
      </span>
    );
  if (outcome === 'FAIL')
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-sm font-semibold text-red-800">
        <XCircle className="h-4 w-4" aria-hidden="true" /> Failed
      </span>
    );
  if (outcome === 'WARN')
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-sm font-semibold text-amber-800">
        <AlertTriangle className="h-4 w-4" aria-hidden="true" /> Warning
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-sm font-semibold text-slate-700">
      <Clock className="h-4 w-4" aria-hidden="true" /> Not done
    </span>
  );
}

function Photo({ photo, label }: { photo: PhotoRef; label: string }) {
  if (!photo.received) {
    return (
      <div className="flex h-24 w-24 items-center justify-center rounded-lg border border-dashed border-amber-400 bg-amber-50 p-1 text-center text-xs font-semibold text-amber-800">
        Picture not received yet
      </div>
    );
  }
  return (
    <a href={`/api/photos/${photo.captureId}`} target="_blank" rel="noreferrer" aria-label={label}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/api/photos/${photo.captureId}`}
        alt={label}
        className="h-24 w-24 rounded-lg border border-border object-cover"
        loading="lazy"
      />
    </a>
  );
}

export const DispatchApprovalQueue: React.FC<DispatchApprovalQueueProps> = ({
  canDecide,
  currentUserId = null,
  sourceType = 'ALL',
  onCountChange,
}) => {
  const [tab, setTab] = useState<Tab>('PENDING');
  const [items, setItems] = useState<DispatchApprovalItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [remarks, setRemarks] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [itemError, setItemError] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/dispatches/approvals?status=${tab}`, { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not load the list.');
      const all: DispatchApprovalItem[] = data.items || [];
      const list = sourceType === 'ALL' ? all : all.filter((i) => i.sourceType === sourceType);
      setItems(list);
      if (tab === 'PENDING') onCountChange?.(list.length);
    } catch (err) {
      setError(getErrorMessage(err) || 'Could not load the list.');
    } finally {
      setLoading(false);
    }
  }, [tab, sourceType, onCountChange]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  const decide = async (item: DispatchApprovalItem, verdict: 'OKAY' | 'NO') => {
    const text = (remarks[item.id] || '').trim();
    if (verdict === 'NO' && text.length < 3) {
      setItemError((e) => ({ ...e, [item.id]: 'Please write a reason for NO.' }));
      return;
    }
    setBusyId(item.id);
    setItemError((e) => ({ ...e, [item.id]: '' }));
    try {
      const res = await fetch(`/api/dispatches/${item.id}/approver-decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ verdict, remarks: text || undefined, version: item.version }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg =
          res.status === 409 ? 'Someone already decided this. Reload.' : data.error || 'Could not save.';
        setItemError((e) => ({ ...e, [item.id]: msg }));
        if (res.status === 409) load();
        return;
      }
      load();
    } catch (err) {
      setItemError((e) => ({ ...e, [item.id]: getErrorMessage(err) || 'Could not save.' }));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="space-y-4" aria-label="Dispatch requests">
      <div className="flex gap-2">
        {(['PENDING', 'DECIDED'] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn(
              'min-h-[44px] flex-1 rounded-xl border px-4 text-base font-semibold sm:flex-none',
              tab === t ? 'border-violet-600 bg-violet-600 text-white' : 'border-border bg-white text-slate-700'
            )}
          >
            {t === 'PENDING' ? 'Waiting' : 'Decided'}
          </button>
        ))}
      </div>

      {loading && (
        <div className="flex items-center gap-2 py-6 text-slate-600">
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> Loading...
        </div>
      )}
      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-red-300 bg-red-50 p-3 text-red-800">
          <AlertTriangle className="h-5 w-5" aria-hidden="true" /> {error}
          <button type="button" onClick={load} className="ml-auto min-h-[44px] px-3 font-semibold underline">
            Try again
          </button>
        </div>
      )}
      {!loading && !error && items.length === 0 && (
        <div className="rounded-xl border border-border bg-white p-6 text-center text-slate-600">
          {tab === 'PENDING' ? 'No dispatch request is waiting for you.' : 'No decided dispatch requests yet.'}
        </div>
      )}

      {items.map((item) => {
        const wait = waitingInfo(item.submittedAt, now);
        const pending = item.status === 'PENDING_APPROVAL';
        const own = !!currentUserId && item.submittedById === currentUserId;
        const showButtons = canDecide && pending && !own;
        return (
          <article key={item.id} className="flex flex-col rounded-2xl border border-border bg-white shadow-2xs">
            <div className="flex-1 space-y-4 p-4">
              <header className="space-y-1">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-lg font-bold text-slate-900">
                    {item.vehicleNumber} <span className="font-medium text-slate-600">· {item.sourceName}</span>
                  </h3>
                  {pending ? (
                    <span className={cn('inline-flex items-center gap-1 text-base font-semibold', wait.cls)}>
                      <Clock className="h-4 w-4" aria-hidden="true" /> Waiting {wait.text}
                    </span>
                  ) : (
                    <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-sm font-semibold text-slate-800">
                      {item.status === 'DISPATCHED' ? 'Okay' : item.status === 'REOPENED' ? 'No - sent back' : item.status}
                    </span>
                  )}
                </div>
                <p className="text-sm text-slate-600">
                  {item.dispatchNumber} · Sent by {item.submittedBy}
                  {item.isDelegated && item.performedAsRole
                    ? ` (acting as ${item.performedAsRole.replace(/_/g, ' ').toLowerCase()})`
                    : ''}
                  {' · '}
                  {item.testMode === 'COMPOSITE' ? 'One mixed sample' : 'Test per portion'}
                </p>
              </header>

              <div className="grid grid-cols-2 gap-2 rounded-xl bg-slate-50 p-3 text-base sm:grid-cols-4">
                <div><div className="text-xs text-slate-600">Total litres</div><div className="font-bold">{item.totals.grossLiters}</div></div>
                <div><div className="text-xs text-slate-600">Avg LR</div><div className="font-bold">{item.totals.weightedLr}</div></div>
                <div><div className="text-xs text-slate-600">Avg Fat</div><div className="font-bold">{item.totals.weightedFat}</div></div>
                <div><div className="text-xs text-slate-600">13 TS</div><div className="font-bold">{item.totals.weightedTs13}</div></div>
              </div>

              <div className="space-y-3">
                {item.portions.map((p) => (
                  <div key={p.portionNumber} className="rounded-xl border border-border p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-semibold text-slate-900">Portion {p.portionNumber}</span>
                      <span className="text-sm text-slate-700">Seal {p.sealNumber} · {p.quantityLiters} L</span>
                    </div>
                    {p.tests.length > 0 && (
                      <ul className="mt-2 space-y-1">
                        {p.tests.map((t) => (
                          <li key={t.testCode} className="flex items-center justify-between gap-2 text-base">
                            <span className="text-slate-800">{t.testName}{t.value !== null ? `: ${t.value}` : ''}</span>
                            <OutcomeChip outcome={t.outcome} />
                          </li>
                        ))}
                      </ul>
                    )}
                    {p.photos.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {p.photos.map((ph) => (
                          <Photo key={ph.captureId} photo={ph} label={`Portion ${p.portionNumber} test picture`} />
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <div>
                <div className="mb-1 text-sm font-semibold text-slate-700">Lab report picture</div>
                {item.labReportPhoto ? (
                  <Photo photo={item.labReportPhoto} label="Hand-written lab report" />
                ) : (
                  <p className="text-sm font-semibold text-amber-800">No lab report picture.</p>
                )}
              </div>

              <div className="space-y-1 rounded-xl border border-border p-3 text-base">
                <div>
                  Person decision:{' '}
                  <span className={cn('font-bold', item.personDecision === 'ACCEPT' ? 'text-green-700' : 'text-red-700')}>
                    {item.personDecision === 'ACCEPT' ? 'Accept' : 'Reject'}
                  </span>
                </div>
                {item.decisionRemarks && <div className="text-slate-800">Remarks: {item.decisionRemarks}</div>}
                {item.exceptionReasons.length > 0 && (
                  <ul className="list-disc pl-5 text-amber-800">
                    {item.exceptionReasons.map((r) => (
                      <li key={r}>{reasonText(r)}</li>
                    ))}
                  </ul>
                )}
              </div>

              {itemError[item.id] && (
                <p role="alert" className="rounded-lg bg-red-50 p-2 text-base font-semibold text-red-800">
                  {itemError[item.id]}
                </p>
              )}
              {showButtons && (
                <label className="block">
                  <span className="mb-1 block text-sm font-semibold text-slate-700">Remarks (needed for NO)</span>
                  <textarea
                    value={remarks[item.id] || ''}
                    onChange={(e) => setRemarks((r) => ({ ...r, [item.id]: e.target.value }))}
                    rows={2}
                    className="w-full rounded-lg border border-border-strong p-2 text-base"
                  />
                </label>
              )}
            </div>

            {showButtons && (
              <div className="sticky bottom-0 grid grid-cols-2 gap-3 rounded-b-2xl border-t border-border bg-white p-3">
                <button
                  type="button"
                  disabled={busyId === item.id}
                  onClick={() => decide(item, 'NO')}
                  className="flex min-h-[56px] items-center justify-center gap-2 rounded-xl bg-red-600 text-lg font-bold text-white disabled:opacity-50"
                >
                  <XCircle className="h-6 w-6" aria-hidden="true" /> ✗ NO
                </button>
                <button
                  type="button"
                  disabled={busyId === item.id}
                  onClick={() => decide(item, 'OKAY')}
                  className="flex min-h-[56px] items-center justify-center gap-2 rounded-xl bg-green-600 text-lg font-bold text-white disabled:opacity-50"
                >
                  <CheckCircle2 className="h-6 w-6" aria-hidden="true" /> ✓ OKAY
                </button>
              </div>
            )}
          </article>
        );
      })}
    </section>
  );
};
