'use client';

import { useLocalFormDraft } from '@/frontend/hooks/useLocalFormDraft';
import React, { useState } from 'react';
import { Play, X, Layers, CheckCircle } from 'lucide-react';
import { Combobox } from '@/components/ui/combobox';
import { Drawer, DrawerContent, DrawerTitle } from '@/components/ui/drawer';
import { useToast } from '@/frontend/context/ToastContext';
import { toDatetimeLocalInput, datetimeLocalToIso } from '@/lib/datetime-utils';
import { getErrorMessage } from '@/lib/errors';
import { apiClient } from '@/frontend/lib/apiClient';
import type { ReadyVisitDef, SiloOption } from './productionTypes';

/** Bottom sheet: assign a destination silo to each accepted portion and start unloading. */
export const ProductionStartUnloadingDrawer: React.FC<{
  visit: ReadyVisitDef;
  silos: SiloOption[];
  onClose: () => void;
  onStarted: () => void;
}> = ({ visit, silos, onClose, onStarted }) => {
  const toast = useToast();
  const acceptedPortions = (visit.portions ?? []).filter((p) => p.plant_decision === 'ACCEPTED');
  const isMultiPortion = acceptedPortions.length > 1;
  const isPortionWise = isMultiPortion || visit.test_mode === 'PORTION_WISE';

  // In portion-wise mode, find the portion that is ready to be unloaded
  const activePortion = isPortionWise
    ? acceptedPortions.find((p) => p.current_status !== 'UNLOADED' && p.current_status !== 'WEIGHED') || acceptedPortions[0]
    : null;

  // The portions to display and assign in this drawer
  const portionsToAssign = isPortionWise && activePortion ? [activePortion] : acceptedPortions;

  // portionId -> siloId, defaulting to active silos in round-robin order.
  const [portionSiloMap, setPortionSiloMap] = useState<Record<string, string>>(() => {
    const map: Record<string, string> = {};
    const activeOnlySilos = (silos ?? []).filter((s) => s.is_active);
    portionsToAssign.forEach((p, idx) => {
      const targetSilo = activeOnlySilos[idx % activeOnlySilos.length] || silos[0];
      map[p.id] = targetSilo?.id || '';
    });
    return map;
  });

  const [startOpTimestamp, setStartOpTimestamp] = useState<string>(() => toDatetimeLocalInput(new Date()));
  const [actionLoading, setActionLoading] = useState(false);
  const formDraft = useLocalFormDraft({
    formKey: `unload-start:${visit.id}`,
    values: { time: startOpTimestamp },
    onRestore: (fields) => {
      if (fields.time !== undefined) setStartOpTimestamp(fields.time);
    },
  });

  const minTimestamp = isPortionWise && activePortion?.first_weight_at
    ? activePortion.first_weight_at
    : visit.gross_timestamp;

  const handleStartUnloading = async () => {
    const assignments = portionsToAssign.map((p) => ({
      portionId: p.id,
      siloId: portionSiloMap[p.id],
    }));

    const missingSilo = assignments.some((a) => !a.siloId);
    if (missingSilo) {
      toast.showError('Destination Silo is required for every accepted portion before starting unloading.', 'Validation Error');
      return;
    }

    const targetPortionId = isPortionWise && activePortion ? activePortion.id : acceptedPortions[0]?.id;
    if (!targetPortionId) {
      toast.showError('No accepted portion found to start unloading.', 'Error');
      return;
    }

    setActionLoading(true);
    try {
      await apiClient.post(
        `/api/production/vehicle-visits/${visit.id}/portions/${targetPortionId}/start`,
        {
          assignments,
          siloId: assignments[0]?.siloId,
          opTimestamp: datetimeLocalToIso(startOpTimestamp) || undefined,
        },
        {
          dedupKey: `prod-start-${visit.id}-${targetPortionId}`,
          timeoutMs: 20_000,
        }
      );

      formDraft.clear();
      toast.showSuccess(
        isPortionWise && activePortion
          ? `Unloading started for Portion #${activePortion.portion_number} (${visit.vehicle_number}).`
          : `Unloading started for vehicle ${visit.vehicle_number}.`,
        'Unloading Started'
      );
      onStarted();
    } catch (err) {
      toast.showError(getErrorMessage(err) || 'Failed to start unloading', 'Unloading Error');
    } finally {
      setActionLoading(false);
    }
  };

  // Completed portions summary for portion-wise mode
  const completedPortions = isPortionWise
    ? acceptedPortions.filter((p) => p.current_status === 'UNLOADED' || p.current_status === 'WEIGHED')
    : [];

  return (
    <Drawer open onOpenChange={(o) => !o && onClose()}>
      <DrawerContent>
        <div className="overflow-y-auto p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-6 space-y-6 text-foreground">
          <DrawerTitle className="sr-only">Start Silo Unloading</DrawerTitle>
          <div className="flex items-start justify-between gap-2 border-b border-border-strong pb-4">
            <div>
              <div className="flex items-center space-x-2">
                <h3 className="text-base font-semibold text-foreground">Start Silo Unloading</h3>
                {isPortionWise && (
                  <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-purple-100 text-purple-800 border border-purple-200">
                    Portion-Wise Loop
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-700 font-semibold mt-0.5">
                Vehicle: <strong className="tabular-nums text-foreground">{visit.vehicle_number}</strong> | Token: <strong className="tabular-nums text-primary">{visit.token_number || 'NO-TOKEN'}</strong>
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="hidden sm:inline px-2.5 py-1 rounded-full text-[10px] uppercase tabular-nums font-semibold bg-blue-100 text-primary border border-blue-300">
                Ready for Unloading
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
            <div className="bg-card border-border p-3 rounded-xl border text-xs">
              <div className="flex items-center justify-between font-semibold text-purple-900">
                <span className="flex items-center space-x-1.5">
                  <Layers className="w-4 h-4 text-purple-700" />
                  <span>Portion #{activePortion.portion_number} of {acceptedPortions.length} · Ready to Unload</span>
                </span>
                <span className="tabular-nums">
                  Starting Weight: {activePortion.first_weight_kg ? `${activePortion.first_weight_kg.toLocaleString()} kg` : `${visit.gross_weight_kg?.toLocaleString()} kg`}
                </span>
              </div>
              {completedPortions.length > 0 && (
                <div className="mt-2 pt-2 border-t border-purple-200 flex flex-wrap gap-2 text-[11px] text-purple-800">
                  <span className="font-semibold">Completed:</span>
                  {completedPortions.map((cp) => (
                    <span key={cp.id} className="inline-flex items-center space-x-1 bg-white px-2 py-0.5 rounded border border-purple-200">
                      <CheckCircle className="w-3 h-3 text-emerald-600" />
                      <span>Portion #{cp.portion_number} ({cp.net_weight_kg ? `${cp.net_weight_kg.toLocaleString()} kg net` : 'Unloaded'})</span>
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="space-y-3">
            <h4 className="text-xs font-semibold text-foreground">
              {isPortionWise ? 'Destination Silo Assignment' : 'Accepted Portions & Destination Silos'}
            </h4>
            {portionsToAssign.map((p) => (
              <div key={p.id} className="bg-card border-border p-4 rounded-xl border space-y-3">
                <div className="flex items-center justify-between">
                  <span className="tabular-nums font-semibold text-sm text-foreground">
                    Portion #{p.portion_number}
                  </span>
                  <span className="text-xs font-semibold text-primary bg-subtle px-2 py-0.5 rounded border border-border">
                    Ready for Unloading
                  </span>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold text-foreground">
                    Destination Silo <span className="text-rose-600">*</span>
                  </label>
                  <Combobox
                    value={portionSiloMap[p.id] || ''}
                    onValueChange={(v) => setPortionSiloMap((prev) => ({ ...prev, [p.id]: v }))}
                    placeholder="Select target silo"
                    searchPlaceholder="Search silo code or name"
                    options={silos
                      .filter((s) => s.is_active)
                      .map((s) => ({
                        value: s.id,
                        label: s.provisional_available_liters !== null
                          ? `${s.silo_code} · ${s.silo_name} · ${s.provisional_available_liters.toLocaleString()} L free`
                          : `${s.silo_code} · ${s.silo_name} (Operational)`,
                        keywords: `${s.silo_code} ${s.silo_name}`,
                      }))}
                  />
                </div>
              </div>
            ))}
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-foreground">
              Unloading Start Time <span className="text-rose-600">*</span>
            </label>
            <input
              type="datetime-local"
              value={startOpTimestamp}
              min={minTimestamp ? toDatetimeLocalInput(minTimestamp) : undefined}
              max={toDatetimeLocalInput(new Date())}
              onChange={(e) => setStartOpTimestamp(e.target.value)}
              className="w-full min-h-[44px] px-3.5 py-2 text-xs tabular-nums font-semibold rounded-xl border border-border-strong bg-white text-foreground focus:outline-hidden focus:ring-2 focus:ring-primary"
            />
          </div>

          <button
            type="button"
            disabled={actionLoading}
            onClick={handleStartUnloading}
            className="w-full min-h-[44px] py-3.5 px-4 bg-primary hover:bg-primary-hover disabled:opacity-50 text-white font-semibold text-xs rounded-xl transition shadow-md flex items-center justify-center space-x-2"
          >
            {actionLoading ? (
              <span>Starting Unloading…</span>
            ) : (
              <>
                <Play className="w-4 h-4" />
                <span>
                  {isPortionWise && activePortion
                    ? `Start Silo Unloading (Portion #${activePortion.portion_number})`
                    : 'Start Silo Unloading'}
                </span>
              </>
            )}
          </button>
        </div>
      </DrawerContent>
    </Drawer>
  );
};
