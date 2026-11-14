'use client';

import { getRoleLabel } from '@core/roles/labels';
import { SkeletonList } from '@/components/ui/loaders';
import { formatDateTime } from '@/lib/format';
import React, { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { fetchJson } from '@/lib/query/fetchJson';
import { item as itemVariant } from '@/components/motion/presets';
import { AlertTriangle, CheckCircle2, Clock, XCircle } from 'lucide-react';
import { DecisionStatusBadge } from '@/frontend/modules/shared/decision/DecisionStatusBadge';
import { getErrorMessage } from '@/lib/errors';
import { cn } from '@/lib/utils';
import { DataTable, type DataColumn } from '@/components/ui/data-table';
import { Pagination, usePagedRows } from '@/components/ui/pagination';
import type { LabPortionExceptionItem } from '@/backend/services/zmcc/labPortionReviewService';
import { exceptionReasonShort } from '@/lib/exceptionReasons';

type Tab = 'PENDING' | 'DECIDED';

export interface LabPortionExceptionQueueProps {
  /** false for read-only viewers (e.g. Data Executive). */
  canDecide?: boolean;
  /** Signed-in user id: hides OKAY / NO on the person's own test (the server also refuses it). */
  currentUserId?: string | null;
  onCountChange?: (waiting: number) => void;
}

function reasonText(reason: string): string {
  return exceptionReasonShort(reason);
}

function outcomeText(o: string) {
  if (o === 'PASS') return 'Passed';
  if (o === 'FAIL') return 'Failed';
  if (o === 'WARN') return 'Warning';
  return 'Not done';
}

function waitingInfo(iso: string | null, now: number) {
  if (!iso) return { text: '-', cls: 'text-secondary-foreground' };
  const mins = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60000));
  const text = mins < 60 ? `${mins} min` : `${Math.floor(mins / 60)} h ${mins % 60} min`;
  const cls = mins >= 60 ? 'text-rose-700' : mins >= 15 ? 'text-amber-700' : 'text-secondary-foreground';
  return { text, cls };
}

type ExceptionTest = NonNullable<LabPortionExceptionItem['details']>['tests'][number];

const testColumns: DataColumn<ExceptionTest>[] = [
  {
    key: 'test',
    header: 'Test',
    label: 'Test',
    primary: true,
    cell: (t) => t.testName,
  },
  {
    key: 'result',
    header: 'Result',
    label: 'Result',
    cell: (t) => (
      <>
        {t.value ?? t.textValue ?? '-'}
        {t.unit && t.value !== null ? ` ${t.unit}` : ''}
      </>
    ),
  },
  {
    key: 'outcome',
    header: 'Outcome',
    label: 'Outcome',
    cell: (t) => (
      <span className={cn('font-semibold', t.outcome === 'FAIL' ? 'text-rose-700' : t.outcome === 'PASS' ? 'text-emerald-700' : 'text-amber-700')}>
        {outcomeText(t.outcome)}
      </span>
    ),
  },
];
export const LabPortionExceptionQueue: React.FC<LabPortionExceptionQueueProps> = ({ canDecide = true, currentUserId = null, onCountChange }) => {
  const [tab, setTab] = useState<Tab>('PENDING');
  const [now, setNow] = useState(() => Date.now());
  const [remarks, setRemarks] = useState<Record<string, string>>({});
  const queryClient = useQueryClient();
  const listQuery = useQuery({
    queryKey: ['zmcc', 'exceptions', 'lab', tab],
    queryFn: ({ signal }) => fetchJson<{ items?: LabPortionExceptionItem[] }>(`/api/zmcc/lab/portions/exceptions?status=${tab}`, { signal }),
    refetchInterval: () => (typeof document !== 'undefined' && document.hidden ? false : 60_000),
  });
  const items = listQuery.data?.items ?? [];
  const paged = usePagedRows(items, (item) => String(item.id));
  const loading = listQuery.isFetching && !listQuery.data;
  const error = listQuery.error ? getErrorMessage(listQuery.error) || 'Could not load the list.' : null;
  const load = () => queryClient.invalidateQueries({ queryKey: ['zmcc', 'exceptions'] });
  const reviewMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      fetchJson(`/api/zmcc/lab/portions/${id}/review`, {
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

  const decide = async (item: LabPortionExceptionItem, verdict: 'OKAY' | 'NO') => {
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
    } catch (err) {
      setItemError((e) => ({ ...e, [item.id]: getErrorMessage(err) || 'Could not save.' }));
      void load();
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="space-y-4" aria-label="Lab exceptions">
      <div className="flex gap-2">
        {(['PENDING', 'DECIDED'] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn(
              'min-h-[44px] flex-1 rounded-xl border px-4 text-base font-semibold sm:flex-none',
              tab === t ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card text-secondary-foreground'
            )}
          >
            {t === 'PENDING' ? 'Waiting' : 'Decided'}
          </button>
        ))}
      </div>

      {loading && <SkeletonList count={3} />}
      {error && (
        <div className="bg-card border-border flex items-center gap-2 rounded-xl border p-3 text-rose-800">
          <AlertTriangle className="h-5 w-5" aria-hidden="true" /> {error}
          <button type="button" onClick={load} className="ml-auto min-h-[44px] px-3 font-semibold underline">Try again</button>
        </div>
      )}
      {!loading && !error && items.length === 0 && (
        <div className="rounded-2xl border border-border bg-card p-6 text-center text-secondary-foreground">
          {tab === 'PENDING' ? 'No lab portion is waiting for you.' : 'No decided lab exceptions yet.'}
        </div>
      )}

      {paged.pageRows.map((item) => {
        const wait = waitingInfo(item.decidedAt, now);
        const pending = item.reviewStatus === 'PENDING';
        const own = !!currentUserId && item.createdByUserId === currentUserId;
        return (
          <motion.article key={item.id} variants={itemVariant} initial="initial" animate="animate" className="flex flex-col rounded-2xl border border-border bg-card shadow-2xs">
            <div className="flex-1 space-y-4 p-4">
              <header className="space-y-1">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-lg font-semibold text-foreground">
                    {item.vehicleNumber || 'Vehicle'} · {item.testMode === 'PORTION_WISE' ? `Portion ${item.portionNumber} of ${item.portionCount}` : 'Composite'}
                  </h3>
                  <DecisionStatusBadge status={pending ? 'PENDING' : item.finalDecision === 'REJECTED' ? 'REJECTED' : 'ACCEPTED'} />
                </div>
                <p className="text-sm text-secondary-foreground">
                  {item.point === 'ZMCC_LAB_MC' ? 'Mobile Tester (route milk)' : 'HC (supplier)'}
                  {item.sourceName ? ` · ${item.sourceName}` : ''}
                  {item.token ? ` · Token ${item.token}` : ''}
                  {item.submittedByName ? ` · by ${item.submittedByName}` : ''}
                  {item.isDelegated && item.performedAsRole ? ` (as ${getRoleLabel(item.performedAsRole)})` : ''}
                </p>
                {pending ? (
                  <p className={cn('flex items-center gap-1 text-sm font-semibold', wait.cls)}>
                    <Clock className="h-4 w-4" aria-hidden="true" /> Waiting {wait.text}
                  </p>
                ) : (
                  <p className="text-sm text-secondary-foreground">
                    Decided {item.reviewedAt ? formatDateTime(item.reviewedAt) : ''}
                    {item.reviewRemarks ? `: ${item.reviewRemarks}` : ''}
                  </p>
                )}
              </header>

              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="bg-card border-border border rounded-xl p-2"><div className="text-xs text-muted-foreground">Weight (KG)</div><div className="text-base font-semibold">{item.quantityValue ?? item.grossLiters ?? '-'}</div></div>
                <div className="bg-card border-border border rounded-xl p-2"><div className="text-xs text-muted-foreground">LR</div><div className="text-base font-semibold">{item.lr ?? '-'}</div></div>
                <div className="bg-card border-border border rounded-xl p-2"><div className="text-xs text-muted-foreground">Fat</div><div className="text-base font-semibold">{item.fat ?? '-'}</div></div>
              </div>

              {item.exceptionReasons.length > 0 && (
                <div className="bg-card border-border rounded-xl border p-3">
                  <p className="mb-1 flex items-center gap-2 font-semibold text-amber-900">
                    <AlertTriangle className="h-4 w-4" aria-hidden="true" /> Why it needs a decision
                  </p>
                  <ul className="list-disc space-y-0.5 pl-5 text-sm text-amber-900">
                    {item.exceptionReasons.map((r) => <li key={r}>{reasonText(r)}</li>)}
                  </ul>
                </div>
              )}

              <p className="text-sm">
                <span className="font-semibold">Lab said:</span> {item.personDecision === 'REJECT' ? 'Reject' : 'Accept'}
                {item.decisionRemarks ? ` - "${item.decisionRemarks}"` : ''}
              </p>

              {item.details && item.details.tests.length > 0 && (
                <DataTable columns={testColumns} rows={item.details.tests} getRowId={(t) => String(t.labTestId)} />
              )}

              {item.photos.length > 0 && (
                <div className="grid grid-cols-2 gap-2">
                  {item.photos.map((p) => (
                    <div key={p.captureId} className="overflow-hidden rounded-xl border border-border">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={`/api/photos/${p.captureId}`} alt="Lab test photo" className="h-40 w-full object-cover" />
                    </div>
                  ))}
                </div>
              )}
            </div>

            {pending && canDecide && own && (
              <p className="border-t border-border p-3 text-sm text-secondary-foreground">Your own test.</p>
            )}
            {pending && canDecide && !own && (
              <div className="sticky bottom-0 space-y-2 rounded-b-2xl border-t border-border bg-card p-3">
                <textarea
                  value={remarks[item.id] || ''}
                  onChange={(e) => setRemarks((r) => ({ ...r, [item.id]: e.target.value }))}
                  placeholder="Reason (needed for NO)"
                  rows={2}
                  className="min-h-11 w-full rounded-lg border border-border-strong p-2 text-base"
                />
                {itemError[item.id] && <p className="text-sm font-semibold text-rose-700">{itemError[item.id]}</p>}
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    disabled={busyId === item.id}
                    onClick={() => decide(item, 'NO')}
                    className="flex h-14 items-center justify-center gap-2 rounded-xl bg-rose-600 text-lg font-semibold text-white disabled:opacity-50"
                  >
                    Reject
                  </button>
                  <button
                    type="button"
                    disabled={busyId === item.id}
                    onClick={() => decide(item, 'OKAY')}
                    className="flex h-14 items-center justify-center gap-2 rounded-xl bg-emerald-600 text-lg font-semibold text-white disabled:opacity-50"
                  >
                    Approve
                  </button>
                </div>
              </div>
            )}
          </motion.article>
        );
      })}

      {paged.totalPages > 1 && (
        <Pagination
          page={paged.page}
          totalPages={paged.totalPages}
          totalRecords={paged.totalRecords}
          pageSize={paged.pageSize}
          noun="portions"
          onPageChange={paged.setPage}
        />
      )}
    </section>
  );
};
