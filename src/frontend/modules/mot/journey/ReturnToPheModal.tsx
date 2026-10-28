'use client';

import React from 'react';
import { Truck, AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';
import { Modal } from '@/components/ui/modal';
import { InfoTip } from '@/components/ui/info-tip';
import type { CurrentJourney } from './types';

interface Props {
  journey: CurrentJourney;
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  isSubmitting: boolean;
}

export function ReturnToPheModal({ journey, isOpen, onClose, onConfirm, isSubmitting }: Props) {
  if (!isOpen) return null;

  const visitedStops = journey.stops.filter((s) => s.status === 'VISITED');
  const skippedStops = journey.stops.filter((s) => s.status === 'SKIPPED');
  const rejectedStops = journey.stops.filter((s) => s.status === 'REJECTED');
  const pendingStops = journey.stops.filter(
    (s) => s.status !== 'VISITED' && s.status !== 'SKIPPED' && s.status !== 'REJECTED'
  );

  const acceptedStops = visitedStops.filter(
    (s) => s.collection?.final_decision !== 'PENDING' && s.collection?.final_decision !== 'REJECTED'
  );
  const totalGross = acceptedStops.reduce((sum, s) => sum + (s.collection?.gross_liters || 0), 0);
  const totalAt13ts = acceptedStops.reduce((sum, s) => sum + (s.collection?.at_13ts_liters || 0), 0);

  const hasPending = pendingStops.length > 0;

  return (
    <Modal onClose={onClose} title="Return to PHE (ZMCC Intake)" className="max-w-md overflow-hidden">
      <div className="p-4 space-y-4 text-xs">
        {hasPending ? (
          <div className="bg-card border-border p-3 border rounded-xl text-amber-950 flex items-start space-x-3">
            <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <h4 className="font-bold uppercase tracking-wider text-amber-900 text-[11px]">
                {pendingStops.length} Unvisited {pendingStops.length === 1 ? 'Shop' : 'Shops'} Remaining
              </h4>
              <InfoTip text="Confirming return to PHE concludes shop collection. Remaining shops will not be visited. The PHE Operator and MDO will be alerted." />
            </div>
          </div>
        ) : (
          <div className="bg-card border-border p-3 border rounded-xl text-emerald-950 flex items-start space-x-3">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
            <div>
              <h4 className="font-bold uppercase tracking-wider text-emerald-900 text-[11px]">
                All Assigned Shops Visited
              </h4>
              <InfoTip text="Confirming notifies the PHE Operator and MDO that this tanker is returning." />
            </div>
          </div>
        )}

        <div className="bg-card border-border p-3 border rounded-xl space-y-2">
          <div className="flex justify-between items-center text-slate-600">
            <span>Route:</span>
            <strong className="text-foreground">
              {journey.route?.name || journey.route?.route_code || 'Assigned Route'}
            </strong>
          </div>
          <div className="flex justify-between items-center text-slate-600">
            <span>Vehicle Number:</span>
            <strong className="text-foreground font-mono">
              {journey.mot_vehicle?.vehicle_number || '—'}
            </strong>
          </div>
          <div className="grid grid-cols-4 gap-2 pt-2 border-t border-slate-200 text-center">
            <div className="p-1.5 bg-card rounded-lg border border-border">
              <span className="text-[10px] uppercase text-slate-500 block">Assigned</span>
              <strong className="text-slate-900 tabular-nums">{journey.stops.length}</strong>
            </div>
            <div className="p-1.5 bg-card rounded-lg border border-border">
              <span className="text-[10px] uppercase text-emerald-700 block">Collected</span>
              <strong className="text-emerald-900 tabular-nums">{visitedStops.length}</strong>
            </div>
            <div className="p-1.5 bg-card rounded-lg border border-border">
              <span className="text-[10px] uppercase text-amber-700 block">Skipped/Rej</span>
              <strong className="text-amber-900 tabular-nums">{skippedStops.length + rejectedStops.length}</strong>
            </div>
            <div className="p-1.5 bg-card rounded-lg border border-border">
              <span className="text-[10px] uppercase text-blue-700 block">Pending</span>
              <strong className="text-blue-900 tabular-nums">{pendingStops.length}</strong>
            </div>
          </div>
          <div className="flex justify-between items-center pt-2 border-t border-slate-200">
            <span className="font-semibold text-slate-700">Total Milk Collected:</span>
            <div className="text-right">
              <div className="font-bold text-slate-900 tabular-nums">{totalGross.toFixed(1)} L</div>
              <div className="text-[10px] text-slate-500 tabular-nums font-medium">({totalAt13ts.toFixed(1)} L @13TS)</div>
            </div>
          </div>
        </div>

        <div className="space-y-2 pt-1">
          <button
            type="button"
            disabled={isSubmitting}
            onClick={() => onConfirm()}
            className="w-full min-h-[44px] py-2.5 px-4 rounded-xl bg-primary hover:bg-primary-hover text-white font-semibold text-xs shadow-md transition flex items-center justify-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Marking Return to PHE…</span>
              </>
            ) : (
              <>
                <Truck className="w-4 h-4" />
                <span>Confirm & Return to PHE</span>
              </>
            )}
          </button>

          <button
            type="button"
            disabled={isSubmitting}
            onClick={onClose}
            className="w-full min-h-[44px] py-2 px-4 rounded-xl border border-border text-slate-700 hover:bg-subtle text-xs font-semibold transition disabled:opacity-50"
          >
            Cancel / Continue Collecting
          </button>
        </div>
      </div>
    </Modal>
  );
}
