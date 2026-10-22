'use client';

import React, { useState } from 'react';
import { CheckCheck, X, Layers } from 'lucide-react';
import { Drawer, DrawerContent, DrawerTitle } from '@/components/ui/drawer';
import { useToast } from '@/frontend/context/ToastContext';
import { toDatetimeLocalInput, datetimeLocalToIso } from '@/lib/datetime-utils';
import type { UnloadingVisitDef } from './productionTypes';

/** Bottom sheet: review the silo allocation and confirm unloading completion. */
export const ProductionCompleteUnloadingDrawer: React.FC<{
  visit: UnloadingVisitDef;
  onClose: () => void;
  onCompleted: () => void;
}> = ({ visit, onClose, onCompleted }) => {
  const toast = useToast();
  const [completeOpTimestamp, setCompleteOpTimestamp] = useState<string>(() => toDatetimeLocalInput(new Date()));
  const [actionLoading, setActionLoading] = useState(false);
  const acceptedPortions = (visit.portions ?? []).filter((p) => p.plant_decision === 'ACCEPTED');
  const isPortionWise = visit.test_mode === 'PORTION_WISE';

  // In portion-wise mode, find the portion that is currently unloading:
  const activePortion = isPortionWise
    ? acceptedPortions.find(
        (p) => p.current_status === 'UNLOADING' || (p.unloading_log?.pump_start_timestamp && !p.unloading_log?.pump_end_timestamp)
      ) || acceptedPortions[0]
    : null;

  const portionsToDisplay = isPortionWise && activePortion ? [activePortion] : acceptedPortions;
  const targetPortionId = activePortion ? activePortion.id : acceptedPortions[0]?.id;

  const minTimestamp = activePortion?.unloading_log?.pump_start_timestamp || visit.started_at;

  const handleCompleteUnloading = async () => {
    if (!targetPortionId) return;

    setActionLoading(true);
    try {
      const res = await fetch(`/api/production/vehicle-visits/${visit.id}/portions/${targetPortionId}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          opTimestamp: datetimeLocalToIso(completeOpTimestamp) || undefined,
        }),
      });

      const data = await res.json();
      if (res.ok) {
        toast.showSuccess(
          isPortionWise && activePortion
            ? `Unloading completed for Portion #${activePortion.portion_number}. Vehicle ready for Scale 2 second weight.`
            : `Unloading completed for vehicle ${visit.vehicle_number}. Vehicle moved to READY_FOR_TARE.`,
          'Unloading Completed'
        );
        onCompleted();
      } else {
        toast.showError(data.error || 'Failed to complete unloading', 'Unloading Error');
      }
    } catch (_err) {
      toast.showError('Network error completing unloading', 'Network Error');
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <Drawer open onOpenChange={(o) => !o && onClose()}>
      <DrawerContent>
        <div className="overflow-y-auto p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-6 space-y-6 text-foreground">
          <DrawerTitle className="sr-only">Complete Silo Unloading</DrawerTitle>
          <div className="flex items-start justify-between gap-2 border-b border-border-strong pb-4">
            <div>
              <div className="flex items-center space-x-2">
                <h3 className="text-base font-semibold text-foreground">Complete Silo Unloading</h3>
                {isPortionWise && (
                  <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-purple-100 text-purple-800 border border-purple-200">
                    Portion-Wise Loop
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-700 font-semibold mt-0.5">
                Vehicle: <strong className="tabular-nums text-foreground">{visit.vehicle_number}</strong> | Started by: <strong className="text-primary">{visit.started_by_name}</strong>
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="hidden sm:inline px-2.5 py-1 rounded-full text-[10px] uppercase tabular-nums font-semibold bg-blue-100 text-primary border border-blue-300">
                Unloading Active
              </span>
              <button
                type="button"
                aria-label="Close"
                onClick={onClose}
                className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-slate-400 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Portion-wise Cycle Header */}
          {isPortionWise && activePortion && (
            <div className="p-3 bg-purple-50 rounded-xl border border-purple-200 text-xs">
              <div className="flex items-center justify-between font-semibold text-purple-900">
                <span className="flex items-center space-x-1.5">
                  <Layers className="w-4 h-4 text-purple-700" />
                  <span>Portion #{activePortion.portion_number} of {acceptedPortions.length} · In Progress</span>
                </span>
                <span className="tabular-nums">
                  Started: {activePortion.unloading_log?.pump_start_timestamp ? new Date(activePortion.unloading_log.pump_start_timestamp).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : 'Active'}
                </span>
              </div>
            </div>
          )}

          <div className="space-y-3">
            <h4 className="text-xs font-semibold text-foreground">
              {isPortionWise ? 'Active Unloading Portion & Destination Silo' : 'Assigned Silo Allocation'}
            </h4>
            {portionsToDisplay.map((p) => (
              <div key={p.id} className="p-4 bg-subtle rounded-xl border border-border flex items-center justify-between text-xs tabular-nums font-semibold">
                <div>
                  <span className="font-semibold text-foreground block">
                    Portion #{p.portion_number} ({p.dispatch_quantity_value !== null && p.dispatch_quantity_value !== undefined ? p.dispatch_quantity_value.toLocaleString() : 'N/A'} {p.dispatch_quantity_unit === 'LITER' ? 'L' : 'kg'})
                  </span>
                  <span className="text-slate-600 font-sans text-[11px]">
                    Destination Silo: <strong className="text-primary">{p.unloading_log?.silo_code || p.unloading_log?.silo_number || 'Silo 1'}</strong>
                  </span>
                </div>
                <span className="text-emerald-800 text-sm font-semibold">
                  {p.expected_physical_liters !== null ? `~${p.expected_physical_liters.toLocaleString()} L` : 'N/A'}
                </span>
              </div>
            ))}
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-foreground">
              Unloading Completion Time <span className="text-rose-600">*</span>
            </label>
            <input
              type="datetime-local"
              value={completeOpTimestamp}
              min={minTimestamp ? toDatetimeLocalInput(minTimestamp) : undefined}
              max={toDatetimeLocalInput(new Date())}
              onChange={(e) => setCompleteOpTimestamp(e.target.value)}
              className="w-full min-h-[44px] px-3.5 py-2 text-xs tabular-nums font-semibold rounded-xl border border-border-strong bg-white text-foreground focus:outline-hidden focus:ring-2 focus:ring-primary"
            />
          </div>

          <button
            type="button"
            disabled={actionLoading}
            onClick={handleCompleteUnloading}
            className="w-full min-h-[44px] py-3.5 px-4 bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white font-semibold text-xs rounded-xl transition shadow-md flex items-center justify-center space-x-2"
          >
            {actionLoading ? (
              <span>Completing Unloading…</span>
            ) : (
              <>
                <CheckCheck className="w-4 h-4" />
                <span>
                  {isPortionWise && activePortion
                    ? `Confirm Portion #${activePortion.portion_number} Unloading Completion`
                    : 'Confirm Unloading Completion'}
                </span>
              </>
            )}
          </button>
        </div>
      </DrawerContent>
    </Drawer>
  );
};
