'use client';

import React, { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { fetchJson } from '@/lib/query/fetchJson';
import { item as itemVariant } from '@/components/motion/presets';
import { AlertTriangle, Camera, Clock, Eye, Gavel, Loader2, X, XCircle } from 'lucide-react';
import { DecisionStatusBadge } from '@/frontend/modules/shared/decision/DecisionStatusBadge';
import { Drawer, DrawerContent, DrawerTitle } from '@/components/ui/drawer';
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
  const cls = mins >= 60 ? 'text-rose-700' : mins >= 15 ? 'text-amber-700' : 'text-slate-600';
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
  const [now, setNow] = useState(() => Date.now());
  const [remarks, setRemarks] = useState<Record<string, string>>({});
  const [activeModalItem, setActiveModalItem] = useState<MotShopExceptionItem | null>(null);

  const queryClient = useQueryClient();
  const listQuery = useQuery({
    queryKey: ['zmcc', 'exceptions', 'mot', tab],
    queryFn: ({ signal }) => fetchJson<{ items?: MotShopExceptionItem[] }>(`/api/zmcc/mot/collections/exceptions?status=${tab}`, { signal }),
    refetchInterval: () => (typeof document !== 'undefined' && document.hidden ? false : 60_000),
  });
  const items = listQuery.data?.items ?? [];
  const loading = listQuery.isFetching && !listQuery.data;
  const error = listQuery.error ? getErrorMessage(listQuery.error) || 'Could not load the list.' : null;
  const load = () => queryClient.invalidateQueries({ queryKey: ['zmcc', 'exceptions'] });

  const reviewMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      fetchJson(`/api/zmcc/mot/collections/${id}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
  });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [itemError, setItemError] = useState<Record<string, string>>({});

  useEffect(() => {
    if (tab === 'PENDING' && listQuery.data) onCountChange?.((listQuery.data.items || []).length);
  }, [tab, listQuery.data, onCountChange]);

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
      await reviewMutation.mutateAsync({ id: item.id, body: { verdict, remarks: text, version: item.version } });
      await load();
      setActiveModalItem(null);
    } catch (err) {
      setItemError((e) => ({ ...e, [item.id]: getErrorMessage(err) || 'Could not save decision.' }));
      void load();
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="space-y-4" aria-label="Shop exceptions">
      {/* Header filter tabs */}
      <div className="flex gap-2 border-b border-border pb-3">
        {(['PENDING', 'DECIDED'] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn('min-h-11 min-w-11', 
              'min-h-[40px] rounded-xl border px-4 text-xs font-semibold transition',
              tab === t
                ? 'border-violet-600 bg-violet-600 text-white shadow-2xs'
                : 'border-border bg-white text-slate-700 hover:bg-slate-50'
            )}
          >
            {t === 'PENDING' ? 'Waiting Review' : 'Decided History'}
            {t === 'PENDING' && items.length > 0 && tab === 'PENDING' && (
              <span className="ml-2 rounded-full bg-white/20 px-1.5 py-0.5 text-[10px] text-white">
                {items.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {loading && (
        <div className="flex items-center justify-center gap-2 py-8 text-xs font-medium text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden="true" />
          <span>Loading exception records…</span>
        </div>
      )}

      {error && (
        <div className="bg-card border-border flex items-center gap-2 rounded-xl border p-3 text-xs text-rose-800">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{error}</span>
          <button type="button" onClick={load} className="min-h-11 min-w-11 ml-auto font-semibold underline">
            Try again
          </button>
        </div>
      )}

      {!loading && !error && items.length === 0 && (
        <div className="rounded-xl border border-border bg-card p-8 text-center text-xs text-slate-500">
          {tab === 'PENDING' ? 'Nothing is waiting for review.' : 'No decided exceptions in history.'}
        </div>
      )}

      {/* Compact Cards Grid */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => {
          const wait = waitingInfo(item.submittedAt, now);
          const pending = item.reviewStatus === 'PENDING';

          return (
            <motion.article
              variants={itemVariant}
              initial="initial"
              animate="animate"
              key={item.id}
              className="flex flex-col justify-between rounded-xl border border-border bg-card p-4 shadow-2xs transition hover:border-slate-300"
            >
              <div className="space-y-3">
                <header className="flex items-start justify-between gap-2 border-b border-border pb-2.5">
                  <div className="min-w-0">
                    <h3 className="line-clamp-1 text-sm font-bold text-slate-900">{item.shopName}</h3>
                    <p className="text-[11px] text-slate-500">
                      RMR: <strong className="tabular-nums text-slate-800">{item.collectionNumber}</strong> · Journey #{item.journeyNumber}
                    </p>
                  </div>
                  <DecisionStatusBadge
                    status={pending ? 'PENDING' : item.finalDecision === 'REJECTED' ? 'REJECTED' : 'ACCEPTED'}
                  />
                </header>

                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="text-[11px] text-slate-600">
                    By <strong>{item.motName}</strong>
                    {item.isDelegated && item.performedAsRole ? ` (${item.performedAsRole.replace(/_/g, ' ').toLowerCase()})` : ''}
                  </span>
                  {pending ? (
                    <span className={cn('flex items-center gap-1 text-[11px] font-semibold tabular-nums', wait.cls)}>
                      <Clock className="h-3 w-3" aria-hidden="true" /> {wait.text}
                    </span>
                  ) : (
                    <span className="text-[10px] text-slate-500">
                      {item.reviewedAt ? new Date(item.reviewedAt).toLocaleDateString() : ''}
                    </span>
                  )}
                </div>

                {/* Metrics Pill Row */}
                <div className="bg-card border-border border grid grid-cols-3 gap-1.5 rounded-lg p-2 text-center text-xs">
                  <div>
                    <span className="block text-[10px] text-slate-500">Gross</span>
                    <strong className="text-slate-900 tabular-nums">{item.grossLiters} L</strong>
                  </div>
                  <div>
                    <span className="block text-[10px] text-slate-500">LR</span>
                    <strong className="text-slate-900 tabular-nums">{item.lr}</strong>
                  </div>
                  <div>
                    <span className="block text-[10px] text-slate-500">Fat</span>
                    <strong className="text-slate-900 tabular-nums">{item.fat}%</strong>
                  </div>
                </div>

                {/* Reason Chips */}
                <div className="flex flex-wrap gap-1">
                  {item.exceptionReasons.map((r) => (
                    <span
                      key={r}
                      className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-900"
                    >
                      {reasonText(r)}
                    </span>
                  ))}
                </div>

                <div className="text-[11px] text-slate-600">
                  <span className="font-semibold text-slate-700">Tester choice:</span>{' '}
                  {item.personDecision === 'ACCEPT' ? 'Accept' : 'Reject'}
                  {item.decisionRemarks ? ` ("${item.decisionRemarks}")` : ''}
                </div>
              </div>

              {/* Action Button */}
              <div className="mt-4 pt-3 border-t border-border">
                {pending && canDecide ? (
                  <button
                    type="button"
                    onClick={() => setActiveModalItem(item)}
                    className="min-h-11 min-w-11 flex min-h-[40px] w-full items-center justify-center gap-1.5 rounded-lg bg-violet-600 px-3 text-xs font-semibold text-white shadow-2xs hover:bg-violet-700"
                  >
                    <Gavel className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Review & Decide</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setActiveModalItem(item)}
                    className="min-h-11 min-w-11 flex min-h-[40px] w-full items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                  >
                    <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>View Inspection Details</span>
                  </button>
                )}
              </div>
            </motion.article>
          );
        })}
      </div>

      {/* Decision Modal: Centered Dialog on desktop, Bottom Drawer on mobile */}
      <Drawer
        open={Boolean(activeModalItem)}
        onOpenChange={(open) => {
          if (!open && !busyId) setActiveModalItem(null);
        }}
      >
        <DrawerContent className="max-w-2xl">
          {activeModalItem && (
            <>
              <div className="flex items-center justify-between border-b border-border px-4 py-3 sm:px-5">
                <div>
                  <DrawerTitle className="text-base font-bold text-slate-900">
                    {activeModalItem.reviewStatus === 'PENDING' ? 'Decide Shop Exception' : 'Shop Exception Record'}
                  </DrawerTitle>
                  <p className="text-xs text-slate-500 font-medium">
                    {activeModalItem.shopName} · RMR: <strong className="text-slate-800">{activeModalItem.collectionNumber}</strong> · Journey #{activeModalItem.journeyNumber}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveModalItem(null)}
                  disabled={Boolean(busyId)}
                  aria-label="Close"
                  className="min-h-11 min-w-11 flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="space-y-4 overflow-y-auto p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-5">
                {/* Summary Metrics */}
                <div className="bg-card border-border border grid grid-cols-3 gap-2 rounded-xl p-3 text-center text-xs">
                  <div>
                    <span className="block text-[10px] text-slate-500">Gross Quantity</span>
                    <strong className="text-base text-slate-900 tabular-nums">{activeModalItem.grossLiters} L</strong>
                  </div>
                  <div>
                    <span className="block text-[10px] text-slate-500">Lactometer (LR)</span>
                    <strong className="text-base text-slate-900 tabular-nums">{activeModalItem.lr}</strong>
                  </div>
                  <div>
                    <span className="block text-[10px] text-slate-500">Fat Percentage</span>
                    <strong className="text-base text-slate-900 tabular-nums">{activeModalItem.fat}%</strong>
                  </div>
                </div>

                {/* Why Exception Triggered */}
                <div className="bg-card border-border rounded-xl border p-3">
                  <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-amber-900">
                    <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" /> Why this needs review
                  </p>
                  <ul className="list-disc space-y-0.5 pl-5 text-xs text-amber-900">
                    {activeModalItem.exceptionReasons.map((r) => (
                      <li key={r}>{reasonText(r)}</li>
                    ))}
                  </ul>
                </div>

                {/* Tester choice & remarks */}
                <div className="bg-card border-border rounded-xl border p-3 text-xs text-slate-700 space-y-1">
                  <p>
                    <span className="font-semibold text-slate-900">Tester Decision:</span>{' '}
                    <span className="font-bold">{activeModalItem.personDecision === 'ACCEPT' ? 'Accept Milk' : 'Reject Milk'}</span>
                    {activeModalItem.decisionRemarks && (
                      <span className="text-slate-600"> · &ldquo;{activeModalItem.decisionRemarks}&rdquo;</span>
                    )}
                  </p>
                  <p className="text-slate-500 text-[11px]">
                    Recorded by {activeModalItem.motName}
                    {activeModalItem.isDelegated && activeModalItem.performedAsRole ? ` (as ${activeModalItem.performedAsRole.replace(/_/g, ' ').toLowerCase()})` : ''}
                  </p>
                </div>

                {/* Test Results Table */}
                {activeModalItem.details && activeModalItem.details.tests.length > 0 && (
                  <div className="overflow-x-auto rounded-xl border border-border">
                    <table className="w-full text-xs">
                      <thead className="bg-slate-50 text-left text-[11px] font-semibold text-slate-600">
                        <tr>
                          <th className="p-2.5">Test Name</th>
                          <th className="p-2.5">Recorded Result</th>
                          <th className="p-2.5">Outcome</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {activeModalItem.details.tests.map((t) => (
                          <tr key={t.labTestId}>
                            <td className="p-2.5 font-medium text-slate-800">{t.testName}</td>
                            <td className="p-2.5 tabular-nums text-slate-700">{t.value ?? t.textValue ?? '—'}</td>
                            <td className="p-2.5 font-semibold">
                              <span
                                className={cn(
                                  'inline-flex items-center rounded-full px-2 py-0.5 text-[10px]',
                                  t.outcome === 'FAIL'
                                    ? 'bg-rose-100 text-rose-800'
                                    : t.outcome === 'PASS'
                                      ? 'bg-emerald-100 text-emerald-800'
                                      : 'bg-amber-100 text-amber-800'
                                )}
                              >
                                {outcomeText(t.outcome)}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Photo Evidence */}
                {activeModalItem.photos.length > 0 && (
                  <div>
                    <h4 className="mb-1.5 text-xs font-semibold text-slate-900">Photo Evidence</h4>
                    <div className="grid grid-cols-2 gap-2">
                      {activeModalItem.photos.map((p) => (
                        <div key={p.captureId} className="bg-card border-border overflow-hidden rounded-xl border">
                          {p.received ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={`/api/photos/${p.captureId}`}
                              alt="Test evidence"
                              className="h-36 w-full object-cover"
                            />
                          ) : (
                            <div className="flex h-36 flex-col items-center justify-center gap-1 p-2 text-center text-xs text-amber-800">
                              <Camera className="h-5 w-5" aria-hidden="true" />
                              <span>Picture pending sync</span>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Decided info if already decided */}
                {activeModalItem.reviewStatus !== 'PENDING' && (
                  <div className="bg-card border-border rounded-xl border p-3 text-xs text-slate-700">
                    <p className="font-semibold text-slate-900">Decision History</p>
                    <p className="mt-0.5">
                      Verdict: <strong>{activeModalItem.finalDecision}</strong>
                      {activeModalItem.reviewedAt && (
                        <span> · {new Date(activeModalItem.reviewedAt).toLocaleString()}</span>
                      )}
                    </p>
                    {activeModalItem.reviewRemarks && (
                      <p className="mt-1 text-slate-600">Remarks: &ldquo;{activeModalItem.reviewRemarks}&rdquo;</p>
                    )}
                  </div>
                )}

                {/* Action Section for pending reviews */}
                {activeModalItem.reviewStatus === 'PENDING' && canDecide && (
                  <div className="space-y-3 pt-2 border-t border-border">
                    <div>
                      <label htmlFor="modal-exception-remarks" className="mb-1 block text-xs font-semibold text-slate-900">
                        Zonal Manager Remarks / Justification
                      </label>
                      <textarea
                        id="modal-exception-remarks"
                        value={remarks[activeModalItem.id] || ''}
                        onChange={(e) => setRemarks((r) => ({ ...r, [activeModalItem.id]: e.target.value }))}
                        placeholder="Decision reason"
                        rows={2}
                        className="min-h-11 w-full resize-none rounded-xl border border-slate-300 p-2.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary"
                      />
                      {itemError[activeModalItem.id] && (
                        <p className="mt-1 text-xs font-semibold text-rose-700">{itemError[activeModalItem.id]}</p>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-2.5">
                      <button
                        type="button"
                        disabled={busyId === activeModalItem.id}
                        onClick={() => decide(activeModalItem, 'NO')}
                        className="flex min-h-[48px] items-center justify-center gap-1.5 rounded-xl border border-rose-300 bg-rose-50 px-4 text-xs font-bold text-rose-700 hover:bg-rose-100 disabled:opacity-50"
                      >
                        {busyId === activeModalItem.id ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                        <span>NO (Reject Shop)</span>
                      </button>

                      <button
                        type="button"
                        disabled={busyId === activeModalItem.id}
                        onClick={() => decide(activeModalItem, 'OKAY')}
                        className="flex min-h-[48px] items-center justify-center gap-1.5 rounded-xl bg-emerald-700 px-4 text-xs font-bold text-white shadow-2xs hover:bg-emerald-800 disabled:opacity-50"
                      >
                        {busyId === activeModalItem.id ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                        <span>OKAY (Approve Shop)</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </DrawerContent>
      </Drawer>
    </section>
  );
};
