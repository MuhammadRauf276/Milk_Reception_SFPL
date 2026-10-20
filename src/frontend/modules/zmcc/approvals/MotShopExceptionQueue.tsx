'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Camera, CheckCircle2, Clock, Loader2, XCircle } from 'lucide-react';
import { DecisionStatusBadge } from '@/frontend/modules/shared/decision/DecisionStatusBadge';
import { getErrorMessage } from '@/lib/errors';
import { cn } from '@/lib/utils';
import type { MotShopExceptionItem } from '@/backend/services/mot/motShopReviewService';

type Tab = 'PENDING' | 'DECIDED';

interface MotShopExceptionQueueProps {
  canDecide?: boolean;
  onCountChange?: (waiting: number) => void;
}

export function reasonText(reason: string): string {
  if (reason === 'MISMATCH') return 'Person decision differs from the test result';
  if (reason === 'PICTURE_MISSING') return 'Picture missing';
  if (reason === 'MISSING_FIELD') return 'Test not done';
  if (reason === 'AWAY_FROM_SHOP') return 'Recorded away from the shop';
  if (reason.startsWith('RULE_FAIL:')) return `${reason.slice('RULE_FAIL:'.length)} failed`;
  return reason;
}

function waitingInfo(iso: string, now: number) {
  const mins = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60000));
  const text = mins < 60 ? `${mins} min` : `${Math.floor(mins / 60)} h ${mins % 60} min`;
  const cls = mins >= 60 ? 'text-red-700' : mins >= 15 ? 'text-amber-700' : 'text-slate-600';
  return { text, cls };
}

function outcomeText(o: string) {
  if (o === 'PASS') return 'Passed';
  if (o === 'FAIL') return 'Failed';
  if (o === 'WARN') return 'Warning';
  return 'Not done';
}

export const MotShopExceptionQueue: React.FC<MotShopExceptionQueueProps> = ({ canDecide = true, onCountChange }) => {
  const [tab, setTab] = useState<Tab>('PENDING');
  const [items, setItems] = useState<MotShopExceptionItem[]>([]);
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
      const res = await fetch(`/api/zmcc/mot/collections/exceptions?status=${tab}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not load the list.');
      setItems(data.items || []);
      if (tab === 'PENDING') onCountChange?.((data.items || []).length);
    } catch (err) {
      setError(getErrorMessage(err) || 'Could not load the list.');
    } finally {
      setLoading(false);
    }
  }, [tab, onCountChange]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  const decide = async (item: MotShopExceptionItem, verdict: 'OKAY' | 'NO') => {
    const text = (remarks[item.id] || '').trim();
    if (verdict === 'NO' && text.length < 3) {
      setItemError((e) => ({ ...e, [item.id]: 'Please write a reason for NO.' }));
      return;
    }
    setBusyId(item.id);
    setItemError((e) => ({ ...e, [item.id]: '' }));
    try {
      const res = await fetch(`/api/zmcc/mot/collections/${item.id}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ verdict, remarks: text, version: item.version }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setItemError((e) => ({ ...e, [item.id]: data.error || 'Could not save.' }));
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
    <section className="space-y-4" aria-label="Shop exceptions">
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
          <button type="button" onClick={load} className="ml-auto min-h-[44px] px-3 font-semibold underline">Try again</button>
        </div>
      )}
      {!loading && !error && items.length === 0 && (
        <div className="rounded-xl border border-border bg-white p-6 text-center text-slate-600">
          {tab === 'PENDING' ? 'Nothing is waiting for you.' : 'No decided exceptions yet.'}
        </div>
      )}

      {items.map((item) => {
        const wait = waitingInfo(item.submittedAt, now);
        const pending = item.reviewStatus === 'PENDING';
        return (
          <article
            key={item.id}
            className="flex min-h-[calc(100dvh-8rem)] flex-col rounded-2xl border border-border bg-white shadow-2xs sm:min-h-0"
          >
            <div className="flex-1 space-y-4 p-4">
              <header className="space-y-1">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-lg font-bold text-slate-900">{item.shopName}</h3>
                  <DecisionStatusBadge
                    status={pending ? 'PENDING' : item.finalDecision === 'REJECTED' ? 'REJECTED' : 'ACCEPTED'}
                  />
                </div>
                <p className="text-sm text-slate-600">
                  {item.collectionNumber} · {item.journeyNumber} · {item.motName}
                  {item.isDelegated && item.performedAsRole ? ` (as ${item.performedAsRole.replace(/_/g, ' ').toLowerCase()})` : ''}
                </p>
                {pending ? (
                  <p className={cn('flex items-center gap-1 text-sm font-semibold', wait.cls)}>
                    <Clock className="h-4 w-4" aria-hidden="true" /> Waiting {wait.text}
                  </p>
                ) : (
                  <p className="text-sm text-slate-600">
                    Decided {item.reviewedAt ? new Date(item.reviewedAt).toLocaleString() : ''}
                    {item.reviewRemarks ? `: ${item.reviewRemarks}` : ''}
                  </p>
                )}
              </header>

              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-xl bg-slate-50 p-2"><div className="text-xs text-slate-500">Litres</div><div className="text-base font-bold">{item.grossLiters}</div></div>
                <div className="rounded-xl bg-slate-50 p-2"><div className="text-xs text-slate-500">LR</div><div className="text-base font-bold">{item.lr}</div></div>
                <div className="rounded-xl bg-slate-50 p-2"><div className="text-xs text-slate-500">Fat</div><div className="text-base font-bold">{item.fat}</div></div>
              </div>

              <div className="rounded-xl border border-amber-300 bg-amber-50 p-3">
                <p className="mb-1 flex items-center gap-1.5 font-semibold text-amber-900">
                  <AlertTriangle className="h-4 w-4" aria-hidden="true" /> Why it needs a decision
                </p>
                <ul className="list-disc space-y-0.5 pl-5 text-sm text-amber-900">
                  {item.exceptionReasons.map((r) => <li key={r}>{reasonText(r)}</li>)}
                </ul>
              </div>

              <p className="text-sm">
                <span className="font-semibold">Person said:</span>{' '}
                {item.personDecision === 'ACCEPT' ? 'Accept' : 'Reject'}
                {item.decisionRemarks ? ` - "${item.decisionRemarks}"` : ''}
              </p>

              {item.details && item.details.tests.length > 0 && (
                <div className="overflow-x-auto rounded-xl border border-border">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-left text-xs text-slate-600">
                      <tr><th className="p-2">Test</th><th className="p-2">Result</th><th className="p-2">Outcome</th></tr>
                    </thead>
                    <tbody>
                      {item.details.tests.map((t) => (
                        <tr key={t.labTestId} className="border-t border-border">
                          <td className="p-2">{t.testName}</td>
                          <td className="p-2">{t.value ?? t.textValue ?? '-'}</td>
                          <td className={cn('p-2 font-semibold', t.outcome === 'FAIL' ? 'text-red-700' : t.outcome === 'PASS' ? 'text-green-700' : 'text-amber-700')}>
                            {t.outcome === 'PASS' ? '✓ ' : t.outcome === 'FAIL' ? '✗ ' : '⚠ '}{outcomeText(t.outcome)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {item.photos.length > 0 && (
                <div className="grid grid-cols-2 gap-2">
                  {item.photos.map((p) => (
                    <div key={p.captureId} className="overflow-hidden rounded-xl border border-border">
                      {p.received ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={`/api/photos/${p.captureId}`} alt="Test result photo" className="h-40 w-full object-cover" />
                      ) : (
                        <div className="flex h-40 flex-col items-center justify-center gap-1 bg-slate-50 p-2 text-center text-sm text-amber-800">
                          <Camera className="h-6 w-6" aria-hidden="true" /> Picture not received yet
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {pending && canDecide && (
              <div className="sticky bottom-0 space-y-2 rounded-b-2xl border-t border-border bg-white p-3">
                <textarea
                  value={remarks[item.id] || ''}
                  onChange={(e) => setRemarks((r) => ({ ...r, [item.id]: e.target.value }))}
                  placeholder="Reason (needed for NO)"
                  rows={2}
                  className="w-full rounded-xl border border-border-strong p-2 text-base"
                />
                {itemError[item.id] && <p className="text-sm font-semibold text-red-700">{itemError[item.id]}</p>}
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    disabled={busyId === item.id}
                    onClick={() => decide(item, 'NO')}
                    className="flex h-14 items-center justify-center gap-2 rounded-xl bg-red-600 text-lg font-bold text-white disabled:opacity-50"
                  >
                    <XCircle className="h-6 w-6" aria-hidden="true" /> NO
                  </button>
                  <button
                    type="button"
                    disabled={busyId === item.id}
                    onClick={() => decide(item, 'OKAY')}
                    className="flex h-14 items-center justify-center gap-2 rounded-xl bg-green-600 text-lg font-bold text-white disabled:opacity-50"
                  >
                    <CheckCircle2 className="h-6 w-6" aria-hidden="true" /> OKAY
                  </button>
                </div>
              </div>
            )}
          </article>
        );
      })}
    </section>
  );
};
