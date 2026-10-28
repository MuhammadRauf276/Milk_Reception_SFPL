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
        <h3 className="text-sm font-semibold text-foreground">Ready for Second Weight</h3>
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
        {secondQuery.isPending ? (
          <div className="p-8 text-center border border-dashed border-border rounded-xl text-sm text-muted-foreground md:col-span-2 lg:col-span-3">
            <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2 text-blue-700" />
            Loading weighbridge queue…
          </div>
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
              className="p-4 rounded-xl border transition cursor-pointer space-y-2 min-h-11 bg-card text-foreground border-border hover:border-border-strong hover:bg-subtle"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <span className="tabular-nums font-semibold text-sm">{v.vehicle_number}</span>
                  <span className="tabular-nums text-xs font-semibold text-primary">({v.token_number || 'No Token'})</span>
                </div>
                <span className="px-2 py-0.5 rounded text-[10px] font-semibold tabular-nums bg-blue-100 text-primary border border-blue-300">
                  Unloading Completed
                </span>
              </div>

              <div className="flex items-center justify-between text-xs font-semibold text-slate-700">
                <span>First Weight: {v.gross_weight_kg.toLocaleString()} kg</span>
                <span>Date: {v.operational_date}</span>
              </div>

              <div className="flex items-center justify-between text-[11px] tabular-nums text-slate-600">
                <span>{v.is_portion_wise ? `Portion #${v.active_portion_number} of ${v.total_accepted_portions}` : 'Full Vehicle Tare'}</span>
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

    if (visit.min_allowed_timestamp) {
      const minAllowed = new Date(visit.min_allowed_timestamp);
      if (selectedOpDate.getTime() < minAllowed.getTime() - 5000) {
        toast.showError(
          `Second weight timestamp cannot be earlier than First weight or unloading completion (${minAllowed.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}).`,
          'Chronology Error'
        );
        return;
      }
    }

    setIsSubmitting(true);
    try {
      const res = await fetch('/api/scale/tare-weight', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          visitId: visit.id,
          tareWeightKg: tareVal,
          tareTimestamp: isoTareTs,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to record second weight');
      }

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

  return (
    <Drawer open onOpenChange={(o) => !o && onClose()}>
      <DrawerContent>
        <div className="overflow-y-auto p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-6 space-y-5 text-foreground">
          <DrawerTitle className="sr-only">Record Second Weight (After Unloading)</DrawerTitle>
          <div className="flex items-start justify-between gap-2 pb-3 border-b border-border-strong">
            <div>
              <h3 className="text-base font-semibold text-foreground">
                {visit.is_portion_wise
                  ? `Record Second Weight: Portion #${visit.active_portion_number} of ${visit.total_accepted_portions}`
                  : 'Record Second Weight (After Unloading)'}
              </h3>
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
              <span className="text-slate-500 font-sans block text-[10px]">
                {visit.is_portion_wise ? `First Weight (Before Portion #${visit.active_portion_number} Unloading)` : 'First Weight (Loaded Vehicle)'}
              </span>
              <span className="text-base text-primary font-semibold">{visit.gross_weight_kg.toLocaleString()} kg</span>
            </div>
            <div>
              <span className="text-slate-500 font-sans block text-[10px]">First Weight Time</span>
              <span>{visit.gross_timestamp ? new Date(visit.gross_timestamp).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '-'}</span>
            </div>
            <div>
              <span className="text-slate-500 font-sans block text-[10px]">Recorded By</span>
              <span>{visit.gross_recorded_by_name}</span>
            </div>
            <div>
              <span className="text-slate-500 font-sans block text-[10px]">Operational Date</span>
              <span>{visit.operational_date}</span>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-foreground">
                {visit.is_portion_wise
                  ? `Second Weight (After Unloading Portion #${visit.active_portion_number}) (kg)`
                  : 'Second Weight (Empty Vehicle) (kg)'}{' '}
                <span className="text-rose-600">*</span>
              </label>
              <div className="relative">
                <input
                  type="number"
                  step="1"
                  value={tareInputKg}
                  onChange={(e) => setTareInputKg(e.target.value)}
                  placeholder="e.g. 12200"
                  className="w-full min-h-[48px] px-4 py-3 text-lg tabular-nums font-semibold rounded-xl border border-border-strong bg-white text-foreground shadow-inner focus:outline-hidden focus:ring-2 focus:ring-primary"
                />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 tabular-nums font-semibold text-slate-400 text-sm">
                  kg
                </span>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-foreground flex items-center justify-between">
                <span>Second Weighment Time <span className="text-rose-600">*</span></span>
                <Clock className="w-3.5 h-3.5 text-primary" />
              </label>
              <input
                type="datetime-local"
                value={tareDateTimeInput}
                min={visit.min_allowed_timestamp ? toDatetimeLocalInput(visit.min_allowed_timestamp) : undefined}
                max={toDatetimeLocalInput(new Date())}
                onChange={(e) => setTareDateTimeInput(e.target.value)}
                className="w-full min-h-[48px] px-3.5 py-3 text-xs tabular-nums font-semibold rounded-xl border border-border-strong bg-white text-foreground focus:outline-hidden focus:ring-2 focus:ring-primary"
              />
            </div>
          </div>

          {previewNetKg !== null && (
            <div className="space-y-2 pt-1">
              <div className="p-3.5 rounded-xl bg-card border border-border flex items-center justify-between text-emerald-900 tabular-nums font-semibold text-xs">
                <span>{visit.is_portion_wise ? `Portion #${visit.active_portion_number} Net Weight:` : 'Net Milk Weight:'}</span>
                <span className="text-base font-semibold text-emerald-800">{previewNetKg.toLocaleString()} kg</span>
              </div>

              {visit.destination_silo_text && (
                <div className="bg-card border-border p-3 rounded-xl border text-xs tabular-nums font-semibold flex items-center justify-between text-blue-950">
                  <span className="font-sans text-[11px] text-slate-600">Destination Silo:</span>
                  <span className="px-2 py-0.5 rounded bg-blue-200 text-blue-900 font-semibold text-[10px]">
                    {visit.is_multi_silo_different ? 'Multi-Silo Allocation Required' : `Silo: ${visit.destination_silo_text}`}
                  </span>
                </div>
              )}
            </div>
          )}

          <button
            type="button"
            disabled={isSubmitting || !tareInputKg}
            onClick={handleRecordSecondWeight}
            className="w-full min-h-[44px] py-3.5 px-4 rounded-xl bg-primary hover:bg-primary-hover disabled:opacity-50 text-white font-semibold text-xs transition shadow-md flex items-center justify-center space-x-2"
          >
            {isSubmitting ? (
              <span>Recording Second Weight…</span>
            ) : (
              <>
                <CheckCircle2 className="w-4 h-4" />
                <span>
                  {visit.is_portion_wise
                    ? `Record Weight for Portion #${visit.active_portion_number}`
                    : 'Record Second Weight'}
                </span>
              </>
            )}
          </button>
        </div>
      </DrawerContent>
    </Drawer>
  );
};
