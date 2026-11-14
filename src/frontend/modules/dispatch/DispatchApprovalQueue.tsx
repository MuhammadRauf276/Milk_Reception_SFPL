'use client';

import { Pagination, usePagedRows } from '@/components/ui/pagination';
import { useLocalFormDraft } from '@/frontend/hooks/useLocalFormDraft';
import React, { useState, useEffect, useMemo } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, CheckCircle2, ChevronRight, Clock, FileText, Loader2, Truck, X, XCircle } from 'lucide-react';
import { fetchJson } from '@/lib/query/fetchJson';
import { Drawer, DrawerContent, DrawerTitle } from '@/components/ui/drawer';
import { getErrorMessage } from '@/lib/errors';
import { cn } from '@/lib/utils';
import { SkeletonList } from '@/components/ui/loaders';
import { formatLabel } from '@/lib/format';
import { exceptionReasonText } from '@/lib/exceptionReasons';

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
  return exceptionReasonText(reason);
}

function waitingInfo(iso: string, now: number) {
  const mins = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60000));
  const text = mins < 60 ? `${mins}m ago` : `${Math.floor(mins / 60)}h ${mins % 60}m ago`;
  const badgeCls = mins > 60 ? 'bg-rose-100 text-rose-800 border-rose-300' : mins > 15 ? 'bg-amber-100 text-amber-800 border-amber-300' : 'bg-blue-100 text-blue-800 border-blue-300';
  return { text, badgeCls };
}

function OutcomeChip({ outcome }: { outcome: Outcome }) {
  if (outcome === 'PASS')
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">
        <CheckCircle2 className="h-3 w-3" aria-hidden="true" /> Pass
      </span>
    );
  if (outcome === 'FAIL')
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-rose-100 px-2 py-0.5 text-xs font-semibold text-rose-800">
        <XCircle className="h-3 w-3" aria-hidden="true" /> Fail
      </span>
    );
  if (outcome === 'WARN')
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
        <AlertTriangle className="h-3 w-3" aria-hidden="true" /> Warn
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs font-semibold text-secondary-foreground">
      <Clock className="h-3 w-3" aria-hidden="true" /> Not tested
    </span>
  );
}

function Photo({ photo, label }: { photo: PhotoRef; label: string }) {
  if (!photo.received) {
    return (
      <div className="flex h-20 w-20 items-center justify-center rounded-xl border border-dashed border-amber-300 bg-amber-50/60 p-2 text-center text-xs font-semibold text-amber-800">
        Photo not received yet
      </div>
    );
  }
  return (
    <a href={`/api/photos/${photo.captureId}`} target="_blank" rel="noreferrer" aria-label={label}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/api/photos/${photo.captureId}`}
        alt={label}
        className="h-20 w-20 rounded-xl border border-border object-cover shadow-2xs hover:opacity-90 transition"
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
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>('PENDING');
  const [now, setNow] = useState(() => Date.now());
  const [selectedItem, setSelectedItem] = useState<DispatchApprovalItem | null>(null);
  const [remarks, setRemarks] = useState('');
  const formDraft = useLocalFormDraft({
    formKey: selectedItem ? `dispatch-approval:${selectedItem.id}` : null,
    values: { remarks },
    onRestore: (fields) => {
      if (fields.remarks !== undefined) setRemarks(fields.remarks);
    },
  });
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // TanStack Query for approvals
  const approvalsQuery = useQuery({
    queryKey: ['dispatch', 'approvals', tab],
    queryFn: ({ signal }) =>
      fetchJson<{ items?: DispatchApprovalItem[] }>(`/api/dispatches/approvals?status=${tab}`, { signal }),
    placeholderData: keepPreviousData,
    refetchInterval: 30_000,
  });

  const allItems = approvalsQuery.data?.items ?? [];
  const items = useMemo(() => {
    return sourceType === 'ALL' ? allItems : allItems.filter((i) => i.sourceType === sourceType);
  }, [allItems, sourceType]);
  const paged = usePagedRows(items, (i) => String(i.id));

  useEffect(() => {
    if (tab === 'PENDING') {
      onCountChange?.(items.length);
    }
  }, [tab, items.length, onCountChange]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  // Update selectedItem if it was updated in the query data
  useEffect(() => {
    if (selectedItem) {
      const refreshed = items.find((i) => i.id === selectedItem.id);
      if (refreshed) {
        setSelectedItem(refreshed);
      }
    }
  }, [items, selectedItem]);

  const handleOpenItem = (item: DispatchApprovalItem) => {
    setSelectedItem(item);
    setRemarks('');
    setActionError(null);
  };

  const handleCloseModal = () => {
    if (!busy) {
      setSelectedItem(null);
      setActionError(null);
    }
  };

  const decide = async (item: DispatchApprovalItem, verdict: 'OKAY' | 'NO') => {
    const text = remarks.trim();
    if (verdict === 'NO' && text.length < 3) {
      setActionError('Please provide a substantive reason (at least 3 characters) for rejecting this dispatch.');
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/dispatches/${item.id}/approver-decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ verdict, remarks: text || undefined, version: item.version }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg =
          res.status === 409
            ? 'This dispatch has already been decided by another manager. Refreshing…'
            : data.error || 'Failed to submit decision.';
        setActionError(msg);
        queryClient.invalidateQueries({ queryKey: ['dispatch', 'approvals'] });
        return;
      }
      formDraft.clear();
      queryClient.invalidateQueries({ queryKey: ['dispatch', 'approvals'] });
      setSelectedItem(null);
    } catch (err) {
      setActionError(getErrorMessage(err) || 'Network error while recording decision.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-4" aria-label="Dispatch requests">
      {/* Tab bar */}
      <div className="flex gap-2">
        {(['PENDING', 'DECIDED'] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn(
              'min-h-[44px] flex-1 sm:flex-none rounded-xl border px-4 text-xs font-semibold transition cursor-pointer',
              tab === t
                ? 'border-primary bg-primary text-white shadow-2xs'
                : 'border-border bg-card text-secondary-foreground hover:bg-subtle'
            )}
          >
            {t === 'PENDING' ? `Waiting for Approval (${items.length})` : 'Decided History'}
          </button>
        ))}
      </div>

      {approvalsQuery.isPending && (
        <SkeletonList count={3} />
      )}

      {approvalsQuery.isError && (
        <div className="flex items-center gap-2 rounded-2xl border border-border bg-card p-4 text-xs text-rose-800">
          <AlertTriangle className="h-4 w-4 shrink-0 text-rose-600" />
          <span>{getErrorMessage(approvalsQuery.error) || 'Failed to load dispatch queue.'}</span>
          <button
            type="button"
            onClick={() => approvalsQuery.refetch()}
            className="ml-auto font-semibold underline text-rose-700 hover:text-rose-900"
          >
            Retry
          </button>
        </div>
      )}

      {!approvalsQuery.isPending && !approvalsQuery.isError && items.length === 0 && (
        <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center text-xs text-muted-foreground">
          {tab === 'PENDING' ? 'No dispatch requests currently waiting for manager review.' : 'No decided dispatches found.'}
        </div>
      )}

      {/* Compact Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <AnimatePresence>
          {paged.pageRows.map((item) => {
            const wait = waitingInfo(item.submittedAt, now);
            const pending = item.status === 'PENDING_APPROVAL';

            return (
              <motion.article
                key={item.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.18 }}
                onClick={() => handleOpenItem(item)}
                className="flex flex-col justify-between rounded-2xl border border-border bg-card p-4 shadow-2xs hover:shadow-2xs hover:border-border transition cursor-pointer"
              >
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center space-x-1.5">
                        <Truck className="w-4 h-4 text-muted-foreground shrink-0" />
                        <h3 className="text-sm font-semibold text-foreground tabular-nums">
                          {item.vehicleNumber}
                        </h3>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {item.sourceName} · {item.dispatchNumber}
                      </p>
                    </div>

                    {pending ? (
                      <span className={cn('text-xs font-semibold px-2 py-0.5 rounded-md border tabular-nums', wait.badgeCls)}>
                        {wait.text}
                      </span>
                    ) : (
                      <span className="text-xs font-semibold px-2 py-0.5 rounded-md bg-muted text-secondary-foreground border border-border">
                        {formatLabel(item.status)}
                      </span>
                    )}
                  </div>

                  {/* Summary Metrics */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 bg-card p-3 rounded-xl border border-border text-center">
                    <div>
                      <span className="text-xs text-muted-foreground font-semibold">Litres</span>
                      <p className="text-xs font-semibold tabular-nums text-foreground mt-0.5">
                        {item.totals.grossLiters.toLocaleString()}
                      </p>
                    </div>
                    <div>
                      <span className="text-xs text-muted-foreground font-semibold">Avg LR</span>
                      <p className="text-xs font-semibold tabular-nums text-foreground mt-0.5">
                        {item.totals.weightedLr || '—'}
                      </p>
                    </div>
                    <div>
                      <span className="text-xs text-muted-foreground font-semibold">Avg Fat</span>
                      <p className="text-xs font-semibold tabular-nums text-foreground mt-0.5">
                        {item.totals.weightedFat ? `${item.totals.weightedFat}%` : '—'}
                      </p>
                    </div>
                    <div>
                      <span className="text-xs text-muted-foreground font-semibold">13 TS</span>
                      <p className="text-xs font-semibold tabular-nums text-foreground mt-0.5">
                        {item.totals.weightedTs13 ? Number(item.totals.weightedTs13).toFixed(1) : '—'}
                      </p>
                    </div>
                  </div>

                  {/* Exceptions & Info pills */}
                  <div className="flex flex-wrap gap-2 items-center">
                    <span className="text-xs font-semibold px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">
                      {item.portions.length} Portion{item.portions.length > 1 ? 's' : ''}
                    </span>
                    <span className="text-xs font-semibold px-2 py-0.5 rounded bg-muted text-secondary-foreground">
                      {item.testMode === 'COMPOSITE' ? 'Composite' : 'Portion-wise'}
                    </span>
                    {item.exceptionReasons.length > 0 && (
                      <span className="text-xs font-semibold px-2 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-300">
                        {item.exceptionReasons.length} Exception{item.exceptionReasons.length > 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                </div>

                <div className="pt-3 border-t border-border mt-3 flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">By {item.submittedBy}</span>
                  <span className="font-semibold text-primary flex items-center">
                    {pending && canDecide ? 'Review & Decide' : 'View Details'} <ChevronRight className="w-3.5 h-3.5 ml-0.5" />
                  </span>
                </div>
              </motion.article>
            );
          })}
        </AnimatePresence>
      </div>
      {items.length > 0 ? (
        <Pagination page={paged.page} totalPages={paged.totalPages} totalRecords={paged.totalRecords} pageSize={paged.pageSize} noun="dispatches" onPageChange={paged.setPage} />
      ) : null}

      {/* Decision / Review Modal */}
      {selectedItem && (
        <Drawer open={Boolean(selectedItem)} onOpenChange={(open) => !open && handleCloseModal()}>
          <DrawerContent showClose={false}>
            <div className="flex items-center justify-between border-b border-border px-4 py-3 sm:px-6">
              <div>
                <DrawerTitle className="text-base font-semibold text-foreground">
                  {selectedItem.status === 'PENDING_APPROVAL' ? 'Review & Decide Dispatch' : 'Dispatch Details'}
                </DrawerTitle>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Vehicle: <strong className="text-foreground">{selectedItem.vehicleNumber}</strong> · {selectedItem.sourceName} ({selectedItem.dispatchNumber})
                </p>
              </div>
              <button
                type="button"
                onClick={handleCloseModal}
                className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-muted-foreground hover:bg-muted hover:text-secondary-foreground cursor-pointer"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 sm:p-6 overflow-y-auto space-y-4 max-h-[calc(85vh-8rem)]">
              {actionError && (
                <div className="p-3 bg-card border border-border text-rose-800 text-xs rounded-xl flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600" />
                  <span>{actionError}</span>
                </div>
              )}

              {/* Quality Totals Header */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 bg-card p-3 rounded-xl border border-border text-center">
                <div>
                  <span className="text-xs text-muted-foreground font-semibold">Total Litres</span>
                  <p className="text-sm font-semibold tabular-nums text-foreground mt-0.5">
                    {selectedItem.totals.grossLiters.toLocaleString()} L
                  </p>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground font-semibold">Weighted LR</span>
                  <p className="text-sm font-semibold tabular-nums text-foreground mt-0.5">
                    {selectedItem.totals.weightedLr || '—'}
                  </p>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground font-semibold">Weighted Fat</span>
                  <p className="text-sm font-semibold tabular-nums text-foreground mt-0.5">
                    {selectedItem.totals.weightedFat ? `${selectedItem.totals.weightedFat}%` : '—'}
                  </p>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground font-semibold">13 Total Solids</span>
                  <p className="text-sm font-semibold tabular-nums text-foreground mt-0.5">
                    {selectedItem.totals.weightedTs13 ? Number(selectedItem.totals.weightedTs13).toFixed(1) : '—'}
                  </p>
                </div>
              </div>

              {/* Person Decision & Exception Reasons */}
              <div className="p-4 rounded-2xl border border-border bg-card space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-secondary-foreground font-semibold">Station Submitter Verdict:</span>
                  <span className={cn('px-3 py-0.5 rounded-md text-xs font-semibold', selectedItem.personDecision === 'ACCEPT' ? 'bg-emerald-100 text-emerald-800 border border-emerald-300' : 'bg-rose-100 text-rose-800 border border-rose-300')}>
                    {selectedItem.personDecision === 'ACCEPT' ? 'Accepted by Station' : 'Rejected by Station'}
                  </span>
                </div>
                {selectedItem.decisionRemarks && (
                  <p className="text-xs text-secondary-foreground bg-card p-3 rounded-lg border border-border">
                    <strong className="text-foreground">Submitter Remarks:</strong> {selectedItem.decisionRemarks}
                  </p>
                )}
                {selectedItem.exceptionReasons.length > 0 && (
                  <div className="space-y-1 pt-2 border-t border-border">
                    <span className="text-xs font-semibold text-amber-900">Triggered Escalations:</span>
                    <ul className="list-disc pl-5 text-xs text-amber-800 space-y-0.5">
                      {selectedItem.exceptionReasons.map((r) => (
                        <li key={r}>{reasonText(r)}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              {/* Portions & Tests List */}
              <div className="space-y-3">
                <h4 className="text-xs font-semibold text-foreground">
                  Portion Breakdown & Lab Tests
                </h4>
                {selectedItem.portions.map((p) => (
                  <div key={p.portionNumber} className="rounded-2xl border border-border bg-card p-4 space-y-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/80 pb-2">
                      <span className="text-xs font-semibold text-foreground">
                        Portion #{p.portionNumber}
                      </span>
                      <div className="flex items-center space-x-2 text-xs tabular-nums text-secondary-foreground font-semibold">
                        <span>Quantity: <strong>{p.quantityLiters.toLocaleString()} L</strong></span>
                        <span>·</span>
                        <span>Seal: <strong className="text-primary">{p.sealNumber}</strong></span>
                      </div>
                    </div>

                    {p.tests.length > 0 && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                        {p.tests.map((t) => (
                          <div key={t.testCode} className="flex items-center justify-between p-2 rounded-lg bg-card border border-border text-xs">
                            <span className="text-foreground font-medium">
                              {t.testName} {t.value !== null ? `(${t.value})` : ''}
                            </span>
                            <OutcomeChip outcome={t.outcome} />
                          </div>
                        ))}
                      </div>
                    )}

                    {p.photos.length > 0 && (
                      <div className="pt-2 border-t border-border/60">
                        <span className="text-xs font-semibold text-secondary-foreground block mb-1">Portion Evidence Photos</span>
                        <div className="flex flex-wrap gap-2">
                          {p.photos.map((ph) => (
                            <Photo key={ph.captureId} photo={ph} label={`Portion ${p.portionNumber} photo`} />
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Hand-written Lab Report Photo */}
              <div className="p-4 rounded-2xl border border-border bg-card space-y-2">
                <div className="flex items-center space-x-1.5 text-xs font-semibold text-foreground">
                  <FileText className="w-4 h-4 text-muted-foreground" />
                  <span>Official Hand-written Lab Report Sheet</span>
                </div>
                {selectedItem.labReportPhoto ? (
                  <div className="pt-1">
                    <Photo photo={selectedItem.labReportPhoto} label="Hand-written lab report" />
                  </div>
                ) : (
                  <p className="text-xs text-amber-700 bg-card p-2 rounded-lg border border-border">
                    No physical lab report photo was attached to this dispatch.
                  </p>
                )}
              </div>

              {/* Decision Section for Authorised Manager */}
              {canDecide && selectedItem.status === 'PENDING_APPROVAL' && (
                <div className="pt-2 space-y-3">
                  <label className="block text-xs font-semibold text-secondary-foreground">
                    Supervisor / Manager Remarks {remarks.trim().length === 0 && <span className="text-amber-600 font-normal">(Required if rejecting)</span>}
                  </label>
                  <textarea
                    value={remarks}
                    onChange={(e) => setRemarks(e.target.value)}
                    placeholder="Enter approval rationale or rejection reasoning…"
                    rows={2}
                    className="w-full text-xs font-semibold p-3 border rounded-xl outline-hidden focus:ring-2 focus:ring-primary bg-subtle"
                  />

                  <div className="grid grid-cols-2 gap-3 pt-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => decide(selectedItem, 'NO')}
                      className="min-h-[48px] py-2 px-4 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-semibold flex items-center justify-center space-x-1.5 transition disabled:opacity-50 cursor-pointer"
                    >
                      {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                      <span>Reject & Return (NO)</span>
                    </button>

                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => decide(selectedItem, 'OKAY')}
                      className="min-h-[48px] py-2 px-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-semibold flex items-center justify-center space-x-1.5 transition disabled:opacity-50 cursor-pointer"
                    >
                      {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                      <span>Approve Dispatch (OKAY)</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </DrawerContent>
        </Drawer>
      )}
    </section>
  );
};
