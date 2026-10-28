'use client';

import { EmptyAction } from './components/EmptyAction';
import React, { useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchJson } from '@/lib/query/fetchJson';
import { useDebouncedValue } from '@/lib/query/useDebouncedValue';
import { useToast } from '@/frontend/context/ToastContext';
import { Search, CheckCircle2, Clock, Loader2, X } from 'lucide-react';
import { Drawer, DrawerContent, DrawerTitle } from '@/components/ui/drawer';
import { toDatetimeLocalInput, datetimeLocalToIso } from '@/lib/datetime-utils';
import { onActivateKey } from '@/lib/a11y';
import { getErrorMessage } from '@/lib/errors';
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
        <h3 className="text-sm font-semibold text-foreground">Ready for First Weight</h3>
        <span className="text-xs tabular-nums font-semibold text-slate-500">
          {visits.length} vehicle{visits.length !== 1 ? 's' : ''}
        </span>
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => {
            setSearchQuery(e.target.value);
            setPage(1);
          }}
          placeholder="Search vehicle or token…"
          className="w-full min-h-[44px] pl-9 pr-3 py-2 text-xs tabular-nums font-semibold rounded-xl border border-input bg-card text-foreground focus:outline-hidden focus:ring-2 focus:ring-ring/30 focus:border-primary"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5">
        {firstQuery.isPending ? (
          <div className="p-8 text-center border border-dashed border-border rounded-xl text-sm text-muted-foreground md:col-span-2 lg:col-span-3">
            <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2 text-blue-700" />
            Loading weighbridge queue…
          </div>
        ) : visits.length === 0 ? (
          <EmptyAction message="No vehicles" onRefresh={() => firstQuery.refetch()} className="md:col-span-2 lg:col-span-3" />
        ) : (
          paginate(visits, currentPage).map((v) => {
            const portionSummaryStr =
              v.portion_count > 1
                ? `${v.portion_count} Portions · ${v.accepted_portion_count} Accepted`
                : `${v.accepted_portion_count} Accepted Portion`;

            return (
              <div
                role="button"
                tabIndex={0}
                onKeyDown={onActivateKey}
                key={`first-weight-${v.id}`}
                onClick={() => setSelectedId(v.id)}
                className="p-4 rounded-xl border transition cursor-pointer space-y-2 min-h-11 bg-card text-foreground border-border hover:border-border-strong hover:bg-subtle"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <span className="tabular-nums font-semibold text-sm">{v.vehicle_number}</span>
                    <span className="tabular-nums text-xs font-semibold text-primary">({v.token_number || 'No Token'})</span>
                  </div>
                  <span className="px-2 py-0.5 rounded text-[10px] font-semibold tabular-nums bg-emerald-100 text-emerald-800 border border-emerald-300">
                    QA Approved
                  </span>
                </div>

                <div className="text-xs font-semibold text-slate-700">
                  <div>{portionSummaryStr}</div>
                  <div className="text-[11px] tabular-nums mt-0.5">Initial Loaded Gross (W0)</div>
                </div>

                <div className="flex items-center justify-between text-[11px] tabular-nums text-slate-600">
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

    if (visit.min_allowed_timestamp) {
      const minAllowed = new Date(visit.min_allowed_timestamp);
      if (selectedOpDate.getTime() < minAllowed.getTime() - 5000) {
        toast.showError(
          `First weight timestamp cannot be earlier than QA approval (${minAllowed.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}).`,
          'Chronology Error'
        );
        return;
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
          grossTimestamp: isoGrossTs,
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
      <DrawerContent>
        <div className="overflow-y-auto p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-6 space-y-5 text-foreground">
          <DrawerTitle className="sr-only">Record First Weight (Loaded Vehicle)</DrawerTitle>
          <div className="flex items-start justify-between gap-2 pb-3 border-b border-border-strong">
            <div>
              <h3 className="text-base font-semibold text-foreground">Record First Weight (Loaded Vehicle)</h3>
              <p className="text-xs text-slate-700 font-semibold mt-0.5">
                Vehicle: <strong className="tabular-nums text-foreground">{visit.vehicle_number}</strong> | Token: <strong className="tabular-nums text-primary">{visit.token_number || 'NO-TOKEN'}</strong>
              </p>
            </div>
            <button
              type="button"
              aria-label="Close"
              onClick={onClose}
              className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-slate-400 hover:text-slate-700"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="bg-card border-border grid grid-cols-2 gap-3 p-3.5 rounded-xl border text-xs tabular-nums font-semibold">
            <div>
              <span className="text-slate-500 font-sans block text-[10px]">Operational Date</span>
              <span>{visit.operational_date}</span>
            </div>
            <div>
              <span className="text-slate-500 font-sans block text-[10px]">Portions Context</span>
              <span>{visit.portion_count} Portions ({visit.accepted_portion_count} Accepted)</span>
            </div>
            <div>
              <span className="text-slate-500 font-sans block text-[10px]">Weighment Type</span>
              <span className="text-primary">Scale 1 · Loaded Gross (W0)</span>
            </div>
            <div>
              <span className="text-slate-500 font-sans block text-[10px]">Waiting Time</span>
              <span className="text-amber-800">{formatDuration(visit.waiting_minutes)}</span>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-foreground">
                First Weight (Loaded) (kg) <span className="text-rose-600">*</span>
              </label>
              <div className="relative">
                <input
                  type="number"
                  step="1"
                  value={grossInputKg}
                  onChange={(e) => setGrossInputKg(e.target.value)}
                  placeholder="e.g. 32500"
                  className="w-full min-h-[48px] px-4 py-3 text-lg tabular-nums font-semibold rounded-xl border border-border-strong bg-white text-foreground shadow-inner focus:outline-hidden focus:ring-2 focus:ring-primary"
                />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 tabular-nums font-semibold text-slate-400 text-sm">
                  kg
                </span>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-foreground flex items-center justify-between">
                <span>First Weighment Time <span className="text-rose-600">*</span></span>
                <Clock className="w-3.5 h-3.5 text-primary" />
              </label>
              <input
                type="datetime-local"
                value={grossDateTimeInput}
                min={visit.min_allowed_timestamp ? toDatetimeLocalInput(visit.min_allowed_timestamp) : undefined}
                max={toDatetimeLocalInput(new Date())}
                onChange={(e) => setGrossDateTimeInput(e.target.value)}
                className="w-full min-h-[48px] px-3.5 py-3 text-xs tabular-nums font-semibold rounded-xl border border-border-strong bg-white text-foreground focus:outline-hidden focus:ring-2 focus:ring-primary"
              />
            </div>
          </div>

          <button
            type="button"
            disabled={isSubmitting || !grossInputKg}
            onClick={handleRecordFirstWeight}
            className="w-full min-h-[44px] py-3.5 px-4 rounded-xl bg-primary hover:bg-primary-hover disabled:opacity-50 text-white font-semibold text-xs transition shadow-md flex items-center justify-center space-x-2"
          >
            {isSubmitting ? (
              <span>Recording First Weight…</span>
            ) : (
              <>
                <CheckCircle2 className="w-4 h-4" />
                <span>Record First Weight</span>
              </>
            )}
          </button>
        </div>
      </DrawerContent>
    </Drawer>
  );
};
