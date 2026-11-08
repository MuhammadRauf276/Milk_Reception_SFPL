'use client';

import { EmptyAction } from './components/EmptyAction';
import React, { useState, useRef } from 'react';
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
import { apiClient } from '@/frontend/lib/apiClient';
import type { SecondWeightVisit } from './weighbridgeTypes';

/** Second (empty) weight: queue of unloaded vehicles plus a bottom-sheet to record the weighment. */
export const WeighbridgeSecondWeightPanel: React.FC = () => {
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const debounced = useDebouncedValue(searchQuery);

  const queryClient = useQueryClient();
  const secondQuery = useQuery({
    queryKey: ['weighbridge', 'ready-for-tare', debounced],
    queryFn: ({ signal }) =>
      fetchJson<{ visits?: SecondWeightVisit[] }>(`/api/scale/ready-for-tare?q=${encodeURIComponent(debounced)}`, { signal }),
    placeholderData: keepPreviousData,
    refetchInterval: 30_000,
  });
  const visits = secondQuery.data?.visits ?? [];
  const totalPages = pageCount(visits.length);
  const currentPage = Math.min(page, totalPages);
  const selectedVisit = visits.find((v) => v.id === selectedId) || null;

  return (
    <div className="space-y-3 animate-panel-in">
      <div className="flex items-center justify-between px-1">
        <h3 className="text-sm font-semibold text-foreground">Ready for second weight</h3>
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

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
        {secondQuery.isPending ? (
          <SkeletonList count={3} className="md:col-span-2 lg:col-span-3" />
        ) : visits.length === 0 ? (
          <EmptyAction message="No vehicles" onRefresh={() => secondQuery.refetch()} className="md:col-span-2 lg:col-span-3" />
        ) : (
          paginate(visits, currentPage).map((v) => (
            <div
              role="button"
              tabIndex={0}
              onKeyDown={onActivateKey}
              key={`second-weight-${v.id}`}
              onClick={() => setSelectedId(v.id)}
              className="p-4 rounded-2xl border transition-colors cursor-pointer space-y-2 min-h-11 bg-card text-foreground border-border hover:border-border-strong hover:bg-subtle"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <span className="font-mono tabular-nums font-semibold text-sm">{v.vehicle_number}</span>
                  <span className="font-mono tabular-nums text-xs text-muted-foreground">({v.token_number || 'No token'})</span>
                </div>
                <span className="px-2 py-0.5 rounded text-xs font-semibold tabular-nums bg-blue-100 text-primary border border-blue-300">
                  Unloading completed
                </span>
              </div>

              <div className="flex items-center justify-between text-xs font-semibold text-secondary-foreground">
                <span className="font-mono tabular-nums">First weight: {v.gross_weight_kg.toLocaleString()} kg</span>
                <span>Date: {v.operational_date}</span>
              </div>

              <div className="flex items-center justify-between text-xs tabular-nums text-secondary-foreground">
                <span>{v.is_portion_wise ? `Portion #${v.active_portion_number} of ${v.total_accepted_portions}` : 'Full vehicle tare'}</span>
                <span>Destination: {v.destination_silo_text || 'Silo'}</span>
              </div>
            </div>
          ))
        )}
      </div>
      <Pager page={currentPage} totalPages={totalPages} total={visits.length} onPageChange={setPage} />

      {selectedVisit && (
        <SecondWeightDrawer
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

const SecondWeightDrawer: React.FC<{
  visit: SecondWeightVisit;
  onClose: () => void;
  onRecorded: () => Promise<void>;
}> = ({ visit, onClose, onRecorded }) => {
  const toast = useToast();
  const [tareInputKg, setTareInputKg] = useState<string>('');
  const [tareDateTimeInput, setTareDateTimeInput] = useState<string>(toDatetimeLocalInput(new Date()));
  const [isSubmitting, setIsSubmitting] = useState(false);
  const activeTareOpIdRef = useRef<string | null>(null);

  const handleRecordSecondWeight = async () => {
    const tareVal = Number(tareInputKg);
    if (isNaN(tareVal) || tareVal <= 0) {
      toast.showError('Please enter a valid second weight greater than 0 kg.', 'Invalid Second Weight');
      return;
    }

    if (tareVal >= visit.gross_weight_kg) {
      toast.showError(
        `Second weight (${tareVal.toLocaleString()} kg) must be strictly less than First weight (${visit.gross_weight_kg.toLocaleString()} kg).`,
        'Weight Hierarchy Error'
      );
      return;
    }

    if (!tareDateTimeInput) {
      toast.showError('Please select a valid operational date & time for the second weight.', 'Missing Timestamp');
      return;
    }

    const isoTareTs = datetimeLocalToIso(tareDateTimeInput);
    if (!isoTareTs) {
      toast.showError('Please select a valid operational date & time for the second weight.', 'Invalid Timestamp');
      return;
    }

    const selectedOpDate = new Date(isoTareTs);
    const now = new Date();
    if (selectedOpDate.getTime() > now.getTime() + 60000) {
      toast.showError('Second weight operational timestamp cannot be in the future.', 'Timestamp Error');
      return;
    }

    let effectiveTareTs = isoTareTs;
    if (visit.min_allowed_timestamp) {
      const minAllowed = new Date(visit.min_allowed_timestamp);
      if (selectedOpDate.getTime() < minAllowed.getTime() - 5000) {
        effectiveTareTs = new Date().toISOString();
        if (new Date(effectiveTareTs) < minAllowed) {
          effectiveTareTs = minAllowed.toISOString();
        }
      }
    }

    setIsSubmitting(true);
    try {
      if (!activeTareOpIdRef.current) {
        activeTareOpIdRef.current = "tare-" + visit.id + "-" + Date.now();
      }
      const opId = activeTareOpIdRef.current;
      const data = await apiClient.post<any>('/api/scale/tare-weight', {
        visitId: visit.id,
        tareWeightKg: tareVal,
        tareTimestamp: effectiveTareTs,
        clientOperationId: opId,
      }, {
        idempotencyKey: opId,
        dedupKey: `wb-tare-${visit.id}`,
        timeoutMs: 25_000,
      });
        activeTareOpIdRef.current = "tare-" + visit.id + "-" + Date.now();
      

      if (data.isPortionCycle) {
        toast.showSuccess(
          data.message || `Portion #${data.completedPortionNumber} weighed! Vehicle ready for Portion #${data.nextPortionNumber}.`,
          'Portion Tare Recorded'
        );
      } else if (data.pendingInventoryReceipt) {
        toast.showWarning('Second weight recorded. Plant LR missing. Silo Receipt pending.', 'Silo Receipt Pending');
      } else {
        toast.showSuccess(
          data.message || `Second weight (${tareVal.toLocaleString()} kg) recorded & Final Silo Receipt posted!`,
          'Silo Receipt Finalized'
        );
      }

      await onRecorded();
    } catch (err) {
      toast.showError(getErrorMessage(err) || 'Failed to record second weight', 'Weighbridge Error');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Preview Net Weight calculation
  const currentTareVal = Number(tareInputKg);
  const previewNetKg =
    !isNaN(currentTareVal) && currentTareVal > 0 && currentTareVal < visit.gross_weight_kg
      ? visit.gross_weight_kg - currentTareVal
      : null;

  const currentPass = (visit.completed_accepted_portions ?? 0) + 2;
  const totalPasses = (visit.total_accepted_portions ?? 1) + 1;
  const isFinalPass = Boolean(visit.is_final_weighment || !visit.is_portion_wise);

  return (
    <Drawer open onOpenChange={(o) => !o && onClose()}>
      <DrawerContent>
        <div className="overflow-y-auto p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-6 space-y-5 text-foreground">
          <DrawerTitle className="sr-only">Record second weight</DrawerTitle>
          <div className="flex items-start justify-between gap-2 pb-3 border-b border-border-strong">
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-0.5 rounded-md text-xs font-semibold bg-muted text-foreground mb-1">
                Scale pass {currentPass} of {totalPasses}
              </div>
              <h3 className="text-base font-semibold text-foreground">
                {isFinalPass
                  ? 'Final tare weight, empty vehicle'
                  : `Intermediate weight after compartment #${visit.active_portion_number} of ${visit.total_accepted_portions}`}
              </h3>
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

          <div className="bg-card border-border grid grid-cols-[repeat(auto-fit,minmax(min(100%,7rem),1fr))] gap-3 p-4 rounded-2xl border text-xs tabular-nums font-semibold">
            <div>
              <span className="text-muted-foreground font-sans block text-xs">
                {visit.is_portion_wise ? `Weight before compartment #${visit.active_portion_number} unloading` : 'Loaded gross weight, before unloading'}
              </span>
              <span className="font-mono text-lg text-foreground font-semibold">{visit.gross_weight_kg.toLocaleString()} kg</span>
            </div>
            <div>
              <span className="text-muted-foreground font-sans block text-xs">First weight time</span>
              <span>{visit.gross_timestamp ? formatTime(visit.gross_timestamp) : '-'}</span>
            </div>
            <div>
              <span className="text-muted-foreground font-sans block text-xs">Recorded by</span>
              <span>{visit.gross_recorded_by_name}</span>
            </div>
            <div>
              <span className="text-muted-foreground font-sans block text-xs">Date</span>
              <span>{visit.operational_date}</span>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-foreground">
                {isFinalPass
                  ? 'Final empty vehicle weight (kg)'
                  : `Weight after compartment #${visit.active_portion_number} unloaded (kg)`}{' '}
                <span className="text-rose-600">*</span>
              </label>
              <div className="relative">
                <input
                  type="number"
                  inputMode="decimal"
                  step="1"
                  value={tareInputKg}
                  onChange={(e) => setTareInputKg(e.target.value)}
                  placeholder="12200"
                  className="w-full min-h-12 px-4 py-3 font-mono text-2xl tabular-nums font-semibold rounded-xl border border-border-strong bg-card text-foreground focus:outline-hidden focus:ring-2 focus:ring-primary"
                />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 font-mono tabular-nums font-semibold text-muted-foreground text-sm">
                  kg
                </span>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-foreground flex items-center justify-between">
                <span>Second weighment time <span className="text-rose-600">*</span></span>
                <Clock className="w-3.5 h-3.5 text-muted-foreground" />
              </label>
              <input
                type="datetime-local"
                value={tareDateTimeInput}
                min={visit.min_allowed_timestamp ? toDatetimeLocalInput(visit.min_allowed_timestamp) : undefined}
                max={toDatetimeLocalInput(new Date())}
                onChange={(e) => setTareDateTimeInput(e.target.value)}
                className="w-full min-h-12 px-4 py-3 text-sm tabular-nums rounded-xl border border-border-strong bg-card text-foreground focus:outline-hidden focus:ring-2 focus:ring-primary"
              />
            </div>
          </div>

          {previewNetKg !== null && (
            <div className="space-y-2 pt-1">
              <div className="p-4 rounded-2xl bg-card border border-border flex items-center justify-between text-foreground tabular-nums font-semibold text-xs">
                <span>{visit.is_portion_wise ? `Portion #${visit.active_portion_number} net weight` : 'Net milk weight'}</span>
                <span className="font-mono text-lg font-semibold text-foreground">{previewNetKg.toLocaleString()} kg</span>
              </div>

              {visit.destination_silo_text && (
                <div className="bg-card border-border p-3 rounded-xl border text-xs tabular-nums font-semibold flex items-center justify-between text-foreground">
                  <span className="font-sans text-xs text-secondary-foreground">Destination silo</span>
                  <span className="px-2 py-0.5 rounded bg-muted text-foreground font-semibold text-xs">
                    {visit.is_multi_silo_different ? 'Multi-silo allocation required' : `Silo: ${visit.destination_silo_text}`}
                  </span>
                </div>
              )}
            </div>
          )}

          <button
            type="button"
            disabled={isSubmitting || !tareInputKg}
            onClick={handleRecordSecondWeight}
            className="w-full min-h-11 py-4 px-4 rounded-xl bg-primary hover:bg-primary-hover disabled:opacity-50 text-white font-semibold text-xs transition-colors flex items-center justify-center space-x-2"
          >
            {isSubmitting ? (
              <span>Recording second weight…</span>
            ) : (
              <>
                <CheckCircle2 className="w-4 h-4" />
                <span>
                  {visit.is_portion_wise
                    ? `Record weight for portion #${visit.active_portion_number}`
                    : 'Record second weight'}
                </span>
              </>
            )}
          </button>
        </div>
      </DrawerContent>
    </Drawer>
  );
};
