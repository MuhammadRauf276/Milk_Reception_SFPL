'use client';

import { EmptyAction } from './components/EmptyAction';
import React, { useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchJson } from '@/lib/query/fetchJson';
import { useDebouncedValue } from '@/lib/query/useDebouncedValue';
import { useToast } from '@/frontend/context/ToastContext';
import { Search, CheckCircle2, Clock, X } from 'lucide-react';
import { Drawer, DrawerContent, DrawerTitle } from '@/components/ui/drawer';
import { formatOperationalDatetime, toDatetimeLocalInput, datetimeLocalToIso } from '@/lib/datetime-utils';
import { onActivateKey } from '@/lib/a11y';
import { getErrorMessage } from '@/lib/errors';
import { SkeletonList } from '@/components/ui/loaders';
import { formatTime } from '@/lib/format';
import { Pager, pageCount, paginate } from './components/Pager';
import { formatDuration, type FirstWeightVisit } from './weighbridgeTypes';

/** First (loaded) weight: queue of QA-approved vehicles plus a bottom-sheet to record the weighment. */
export const WeighbridgeFirstWeightPanel: React.FC = () => {
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const debounced = useDebouncedValue(searchQuery);

  const queryClient = useQueryClient();
  // Live board: refetch every 30s, paused automatically while the tab is hidden.
  const firstQuery = useQuery({
    queryKey: ['weighbridge', 'ready-for-gross', debounced],
    queryFn: ({ signal }) =>
      fetchJson<{ visits?: FirstWeightVisit[] }>(`/api/scale/ready-for-gross?q=${encodeURIComponent(debounced)}`, { signal }),
    placeholderData: keepPreviousData,
    refetchInterval: 30_000,
  });
  const visits = firstQuery.data?.visits ?? [];
  const totalPages = pageCount(visits.length);
  const currentPage = Math.min(page, totalPages);
  const selectedVisit = visits.find((v) => v.id === selectedId) || null;

  return (
    <div className="space-y-3 animate-panel-in">
      <div className="flex items-center justify-between px-1">
        <h3 className="text-sm font-semibold text-foreground">Ready for first weight</h3>
        <span className="text-xs tabular-nums font-semibold text-muted-foreground">
          {visits.length} vehicle{visits.length !== 1 ? 's' : ''}
        </span>
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => {
            setSearchQuery(e.target.value);
            setPage(1);
          }}
          placeholder="Search vehicle or token…"
          className="w-full min-h-11 pl-9 pr-3 py-2 text-sm tabular-nums rounded-xl border border-input bg-card text-foreground focus:outline-hidden focus:ring-2 focus:ring-ring/30 focus:border-primary"
        />
      </div>

      {firstQuery.isError && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-semibold text-rose-900"
        >
          <span>Could not load first weight queue.</span>
          <button
            type="button"
            onClick={() => void firstQuery.refetch()}
            className="min-h-11 rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-xs font-semibold text-rose-800 hover:bg-rose-100 transition-colors cursor-pointer"
          >
            Retry
          </button>
        </div>
      )}

      <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,18.5rem),1fr))] gap-3">
        {firstQuery.isPending ? (
          <SkeletonList count={3} className="col-span-full" />
        ) : visits.length === 0 ? (
          <EmptyAction message="No vehicles" onRefresh={() => firstQuery.refetch()} className="col-span-full" />
        ) : (
          paginate(visits, currentPage).map((v) => {
            const portionSummaryStr =
              v.portion_count > 1
                ? `${v.portion_count} portions, ${v.accepted_portion_count} accepted`
                : `${v.accepted_portion_count} accepted portion`;

            return (
              <div
                role="button"
                tabIndex={0}
                onKeyDown={onActivateKey}
                key={`first-weight-${v.id}`}
                onClick={() => setSelectedId(v.id)}
                className="w-full min-w-0 p-4 rounded-2xl border transition-colors cursor-pointer space-y-2 min-h-11 bg-card text-foreground border-border hover:border-border-strong hover:bg-subtle"
              >
                <div className="flex items-start justify-between gap-2 min-w-0">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0">
                    <span className="font-mono tabular-nums font-semibold text-sm whitespace-nowrap">{v.vehicle_number}</span>
                    <span className="font-mono tabular-nums text-xs text-muted-foreground whitespace-nowrap">({v.token_number || 'No token'})</span>
                  </div>
                  <span className="px-2 py-0.5 rounded text-xs font-semibold tabular-nums bg-emerald-100 text-emerald-800 border border-emerald-300 whitespace-nowrap shrink-0">
                    QA approved
                  </span>
                </div>

                <div className="text-xs font-semibold text-secondary-foreground">
                  <div>{portionSummaryStr}</div>
                  <div className="text-xs tabular-nums mt-0.5">Initial loaded gross (W0)</div>
                </div>

                <div className="flex items-center justify-between text-xs tabular-nums text-secondary-foreground">
                  <span>Date: {v.operational_date}</span>
                  <span>Waiting: {formatDuration(v.waiting_minutes)}</span>
                </div>
              </div>
            );
          })
        )}
      </div>
      <Pager page={currentPage} totalPages={totalPages} total={visits.length} onPageChange={setPage} />

      {selectedVisit && (
        <FirstWeightDrawer
          key={selectedVisit.id}
          visit={selectedVisit}
          onClose={() => setSelectedId(null)}
          onRecorded={async () => {
            setSelectedId(null);
            await queryClient.invalidateQueries({ queryKey: ['weighbridge'] });
          }}
        />
      )}
    </div>
  );
};

const FirstWeightDrawer: React.FC<{
  visit: FirstWeightVisit;
  onClose: () => void;
  onRecorded: () => Promise<void>;
}> = ({ visit, onClose, onRecorded }) => {
  const toast = useToast();
  const [grossInputKg, setGrossInputKg] = useState<string>('');
  const [grossDateTimeInput, setGrossDateTimeInput] = useState<string>(toDatetimeLocalInput(new Date()));
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleRecordFirstWeight = async () => {
    const grossVal = Number(grossInputKg);
    if (isNaN(grossVal) || grossVal <= 0) {
      toast.showError('Please enter a valid first weight greater than 0 kg.', 'Invalid First Weight');
      return;
    }

    if (!grossDateTimeInput) {
      toast.showError('Please select a valid operational date & time for the first weight.', 'Missing Timestamp');
      return;
    }

    const isoGrossTs = datetimeLocalToIso(grossDateTimeInput);
    if (!isoGrossTs) {
      toast.showError('Please select a valid operational date & time for the first weight.', 'Invalid Timestamp');
      return;
    }

    const selectedOpDate = new Date(isoGrossTs);
    const now = new Date();
    if (selectedOpDate.getTime() > now.getTime() + 60000) {
      toast.showError('First weight operational timestamp cannot be in the future.', 'Timestamp Error');
      return;
    }

    let effectiveGrossTs = isoGrossTs;
    if (visit.min_allowed_timestamp) {
      const minAllowed = new Date(visit.min_allowed_timestamp);
      if (selectedOpDate.getTime() < minAllowed.getTime() - 5000) {
        effectiveGrossTs = new Date().toISOString();
        if (new Date(effectiveGrossTs) < minAllowed) {
          effectiveGrossTs = minAllowed.toISOString();
        }
      }
    }

    setIsSubmitting(true);
    try {
      const res = await fetch('/api/scale/gross-weight', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          visitId: visit.id,
          grossWeightKg: grossVal,
          grossTimestamp: effectiveGrossTs,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to record first weight');
      }

      toast.showSuccess(
        `First weight (${grossVal.toLocaleString()} kg) recorded for vehicle ${visit.vehicle_number}. Vehicle ready for unloading!`,
        'First Weight Recorded'
      );
      await onRecorded();
    } catch (err) {
      toast.showError(getErrorMessage(err) || 'Failed to record first weight', 'Weighbridge Error');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Drawer open onOpenChange={(o) => !o && onClose()}>
      <DrawerContent showClose={false}>
        <div className="overflow-y-auto p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-6 space-y-5 text-foreground">
          <DrawerTitle className="sr-only">Record first weight</DrawerTitle>
          <div className="flex items-start justify-between gap-2 pb-3 border-b border-border-strong">
            <div>
              <h3 className="text-base font-semibold text-foreground">Record first weight</h3>
              <p className="text-xs text-secondary-foreground font-semibold mt-0.5">
                Vehicle: <strong className="font-mono tabular-nums text-foreground">{visit.vehicle_number}</strong> | Token: <strong className="font-mono tabular-nums text-foreground">{visit.token_number || 'NO-TOKEN'}</strong>
              </p>
            </div>
            <button
              type="button"
              aria-label="Close"
              onClick={onClose}
              className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-muted-foreground hover:text-secondary-foreground"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="bg-card border-border grid grid-cols-2 gap-3 p-4 rounded-2xl border text-xs tabular-nums font-semibold">
            <div>
              <span className="text-muted-foreground font-sans block text-xs">Date</span>
              <span>{visit.operational_date}</span>
            </div>
            <div>
              <span className="text-muted-foreground font-sans block text-xs">Portions</span>
              <span>{visit.portion_count} portions ({visit.accepted_portion_count} accepted)</span>
            </div>
            <div>
              <span className="text-muted-foreground font-sans block text-xs">Weighment</span>
              <span>Scale 1, loaded gross (W0)</span>
            </div>
            <div>
              <span className="text-muted-foreground font-sans block text-xs">Waiting time</span>
              <span className="text-foreground">{formatDuration(visit.waiting_minutes)}</span>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-foreground">
                First weight, loaded (kg) <span className="text-rose-600">*</span>
              </label>
              <div className="relative">
                <input
                  type="number"
                  inputMode="decimal"
                  step="1"
                  value={grossInputKg}
                  onChange={(e) => setGrossInputKg(e.target.value)}
                  placeholder="32500"
                  className="w-full min-h-12 px-4 py-3 font-mono text-2xl tabular-nums font-semibold rounded-xl border border-border-strong bg-card text-foreground focus:outline-hidden focus:ring-2 focus:ring-primary"
                />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 font-mono tabular-nums font-semibold text-muted-foreground text-sm">
                  kg
                </span>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-foreground flex items-center justify-between">
                <span>First weighment time <span className="text-rose-600">*</span></span>
                <Clock className="w-3.5 h-3.5 text-muted-foreground" />
              </label>
              <input
                type="datetime-local"
                value={grossDateTimeInput}
                min={visit.min_allowed_timestamp ? toDatetimeLocalInput(visit.min_allowed_timestamp) : undefined}
                max={toDatetimeLocalInput(new Date())}
                onChange={(e) => setGrossDateTimeInput(e.target.value)}
                className="w-full min-h-12 px-4 py-3 text-sm tabular-nums rounded-xl border border-border-strong bg-card text-foreground focus:outline-hidden focus:ring-2 focus:ring-primary"
              />
            </div>
          </div>

          <button
            type="button"
            disabled={isSubmitting || !grossInputKg}
            onClick={handleRecordFirstWeight}
            className="w-full min-h-11 py-4 px-4 rounded-xl bg-primary hover:bg-primary-hover disabled:opacity-50 text-white font-semibold text-xs transition-colors flex items-center justify-center space-x-2"
          >
            {isSubmitting ? (
              <span>Recording first weight…</span>
            ) : (
              <>
                <CheckCircle2 className="w-4 h-4" />
                <span>Record first weight</span>
              </>
            )}
          </button>
        </div>
      </DrawerContent>
    </Drawer>
  );
};
