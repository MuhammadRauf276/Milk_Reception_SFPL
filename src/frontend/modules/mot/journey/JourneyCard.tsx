'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { Truck, CheckCircle2 } from 'lucide-react';
import type { CurrentJourney, StopDetail } from './types';

interface Props {
  journey: CurrentJourney;
  onRecord: (stop: StopDetail) => void;
  onReturnToPhe?: () => void;
  onResumeCollection?: () => void;
  isSubmittingReturn?: boolean;
}

/** Journey header, totals and the next pending stop. */
export function JourneyCard({
  journey,
  onRecord,
  onReturnToPhe,
  onResumeCollection,
  isSubmittingReturn = false,
}: Props) {
  const visitedStops = journey.stops.filter((s) => s.status === 'VISITED');
  const skippedStops = journey.stops.filter((s) => s.status === 'SKIPPED');
  const rejectedStops = journey.stops.filter((s) => s.status === 'REJECTED');
  const pendingStops = journey.stops.filter(
    (s) => s.status !== 'VISITED' && s.status !== 'SKIPPED' && s.status !== 'REJECTED'
  );
  const nextPendingStop = pendingStops[0] || null;
  // Totals count accepted milk only (waiting for the Zonal Manager is left out until decided).
  const acceptedStops = visitedStops.filter(
    (s) => s.collection?.final_decision !== 'PENDING' && s.collection?.final_decision !== 'REJECTED'
  );
  const totalGross = acceptedStops.reduce((sum, s) => sum + (s.collection?.gross_liters || 0), 0);
  const totalAt13ts = acceptedStops.reduce((sum, s) => sum + (s.collection?.at_13ts_liters || 0), 0);

  const isReturning = journey.status === 'RETURNING';

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="p-4 sm:p-5 bg-white rounded-xl border border-border shadow-2xs space-y-3"
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-border pb-3 gap-3">
        <div>
          <div className="flex items-center space-x-2">
            <span className="text-[10px] font-semibold uppercase text-slate-500 tracking-wider block">
              Active Journey
            </span>
            {isReturning ? (
              <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 text-[10px] font-bold tracking-wide flex items-center gap-1">
                <Truck className="w-3 h-3 text-amber-700" />
                RETURNING TO PHE
              </span>
            ) : (
              <span className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-900 text-[10px] font-bold tracking-wide">
                COLLECTING
              </span>
            )}
          </div>
          <div className="flex items-center space-x-2 mt-0.5">
            <h2 className="text-base sm:text-lg tabular-nums font-semibold text-primary">
              #{journey.journey_number}
            </h2>
            <span className="text-xs font-semibold text-foreground truncate">
              {journey.route?.name || journey.route?.route_code || 'Assigned Route'}
            </span>
          </div>
        </div>

        <div className="flex items-center justify-between sm:justify-end gap-3">
          <div className="text-left sm:text-right">
            <span className="text-[10px] font-semibold text-slate-500 block uppercase">Vehicle</span>
            <span className="tabular-nums font-semibold text-sm text-foreground">
              {journey.mot_vehicle?.vehicle_number || '—'}
            </span>
          </div>

          {!isReturning && onReturnToPhe && (
            <button
              type="button"
              onClick={onReturnToPhe}
              disabled={isSubmittingReturn}
              title="Conclude shop collection and return to ZMCC PHE"
              className="inline-flex items-center gap-1.5 min-h-[44px] px-3 py-1.5 border border-slate-300 hover:border-slate-400 bg-slate-50 hover:bg-slate-100 text-slate-700 rounded-xl text-xs font-semibold transition shrink-0"
            >
              <Truck className="w-3.5 h-3.5 text-slate-600" />
              <span>Return to PHE</span>
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 sm:gap-3 text-center">
        <div className="p-2 sm:p-2.5 rounded-xl bg-subtle border border-border">
          <span className="text-[10px] font-semibold text-slate-500 uppercase block">Assigned</span>
          <span className="font-semibold text-xs sm:text-sm text-slate-900 tabular-nums">
            {journey.stops.length}
          </span>
        </div>
        <div className="p-2 sm:p-2.5 rounded-xl bg-emerald-50/70 border border-emerald-300">
          <span className="text-[10px] font-semibold text-emerald-800 uppercase block">Collected</span>
          <span className="font-semibold text-xs sm:text-sm text-emerald-950 tabular-nums">
            {visitedStops.length}
          </span>
        </div>
        <div className="p-2 sm:p-2.5 rounded-xl bg-rose-50/70 border border-rose-300">
          <span className="text-[10px] font-semibold text-rose-800 uppercase block">
            {skippedStops.length > 0 ? 'Skipped / Rejected' : 'Rejected'}
          </span>
          <span className="font-semibold text-xs sm:text-sm text-rose-950 tabular-nums">
            {skippedStops.length > 0
              ? `${skippedStops.length} / ${rejectedStops.length}`
              : rejectedStops.length}
          </span>
        </div>
        <div className="p-2 sm:p-2.5 rounded-xl bg-blue-50/70 border border-blue-200">
          <span className="text-[10px] font-semibold text-blue-800 uppercase block">Milk (L)</span>
          <span className="font-semibold text-xs sm:text-sm text-blue-950 tabular-nums">
            {totalGross.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 2 })} L
          </span>
        </div>
        <div className="p-2 sm:p-2.5 rounded-xl bg-emerald-50/70 border border-emerald-300">
          <span className="text-[10px] font-semibold text-emerald-800 uppercase block">@13TS (L)</span>
          <span className="font-semibold text-xs sm:text-sm text-emerald-950 tabular-nums">
            {totalAt13ts.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 2 })} L
          </span>
        </div>
      </div>

      {isReturning ? (
        <div className="mt-2 p-3 sm:p-3.5 bg-amber-50 border border-amber-200 rounded-xl flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 rounded-lg bg-amber-600 text-white flex items-center justify-center shrink-0">
              <Truck className="w-4 h-4 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="text-xs font-bold uppercase tracking-wider text-amber-900">
                  Returning to PHE
                </span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-200 font-semibold text-amber-950">
                  En Route to ZMCC
                </span>
              </div>
              <p className="text-xs text-amber-800 mt-0.5">
                Vehicle is returning. Arrival token will be issued by the PHE Operator / MDO upon gate entry.
              </p>
            </div>
          </div>
          {onResumeCollection && (
            <button
              type="button"
              onClick={onResumeCollection}
              disabled={isSubmittingReturn}
              className="min-h-[44px] px-3.5 py-2 bg-white border border-amber-300 hover:bg-amber-100 text-amber-900 rounded-xl text-xs font-semibold shrink-0 transition"
            >
              Resume Collection
            </button>
          )}
        </div>
      ) : !nextPendingStop ? (
        <div className="mt-2 p-3 sm:p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 rounded-lg bg-emerald-600 text-white flex items-center justify-center shrink-0">
              <CheckCircle2 className="w-4 h-4" />
            </div>
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-emerald-900">
                All Shops Completed
              </span>
              <p className="text-xs text-emerald-800 mt-0.5">
                You have visited {visitedStops.length} shops ({totalGross.toFixed(1)} L collected). Ready to return to ZMCC.
              </p>
            </div>
          </div>
          {onReturnToPhe && (
            <button
              type="button"
              onClick={onReturnToPhe}
              disabled={isSubmittingReturn}
              className="min-h-[44px] w-full sm:w-auto px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-semibold text-xs shadow-2xs transition flex items-center justify-center space-x-1.5 shrink-0"
            >
              <Truck className="w-4 h-4" />
              <span>Return to PHE</span>
            </button>
          )}
        </div>
      ) : (
        <div className="mt-2 p-3 sm:p-3.5 bg-muted/70 border border-border rounded-xl flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center space-x-2.5">
            <span className="w-7 h-7 rounded-lg bg-primary text-white tabular-nums font-semibold text-xs flex items-center justify-center shrink-0">
              {nextPendingStop.planned_sequence}
            </span>
            <div>
              <span className="text-[10px] font-semibold text-slate-500 uppercase block">
                Next Stop
              </span>
              <span className="font-semibold text-xs sm:text-sm text-foreground">
                {nextPendingStop.shop_name || nextPendingStop.shop?.shop_name || 'Shop'}
              </span>
            </div>
          </div>

          <div className="w-full sm:w-auto">
            <button
              type="button"
              onClick={() => onRecord(nextPendingStop)}
              className="min-h-[44px] w-full sm:w-auto px-4 py-2 bg-primary hover:bg-primary-hover text-white rounded-xl font-semibold text-xs shadow-2xs transition flex items-center justify-center space-x-1.5 focus:outline-hidden focus:ring-2 focus:ring-primary"
            >
              <span>Record Collection</span>
            </button>
          </div>
        </div>
      )}
    </motion.div>
  );
}
