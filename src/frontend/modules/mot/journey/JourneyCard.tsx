'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { Truck, CheckCircle2 } from 'lucide-react';
import { HorizontalScrollRow } from '@/components/ui/horizontal-scroll-row';
import type { CurrentJourney, StopDetail } from './types';
import { InfoTip } from '@/components/ui/info-tip';

interface Props {
  journey: CurrentJourney;
  onRecord: (stop: StopDetail) => void;
  onReturnToPhe?: () => void;
  onResumeCollection?: () => void;
  isSubmittingReturn?: boolean;
  /** A vehicle request is waiting for the manager: no more shops until it is answered. */
  locked?: boolean;
}

/** Journey header, totals and the next pending stop. */
export function JourneyCard({
  journey,
  onRecord,
  onReturnToPhe,
  onResumeCollection,
  isSubmittingReturn = false,
  locked = false,
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
  const isAtZmcc = journey.status === 'ARRIVED';

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="p-4 sm:p-5 bg-card rounded-2xl border border-border shadow-2xs space-y-3"
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-border pb-3 gap-3">
        <div>
          <div className="flex items-center space-x-2">
            <span className="text-xs font-semibold text-muted-foreground block">
              Active Journey
            </span>
            {isAtZmcc ? (
              <span className="px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-900 text-xs font-semibold inline-flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3 text-emerald-700" />
                AT ZMCC
              </span>
            ) : isReturning ? (
              <span className="px-2 py-0.5 rounded-md bg-amber-100 text-amber-900 text-xs font-semibold flex items-center gap-1">
                <Truck className="w-3 h-3 text-amber-700" />
                Returning to PHE
              </span>
            ) : (
              <span className="px-2 py-0.5 rounded-md bg-blue-100 text-blue-900 text-xs font-semibold">
                Collecting
              </span>
            )}
          </div>
          <div className="flex items-center space-x-2 mt-0.5">
            <h2 className="text-base sm:text-lg tabular-nums font-semibold text-primary">
              #{journey.journey_number}
            </h2>
            <span className="text-xs font-semibold text-foreground break-words min-w-0">
              {journey.route?.name || journey.route?.route_code || 'Route'}
            </span>
          </div>
        </div>

        <div className="flex items-center justify-between sm:justify-end gap-3">
          <div className="text-left sm:text-right">
            <span className="text-xs font-semibold text-muted-foreground block">Vehicle</span>
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
              className="inline-flex items-center gap-2 min-h-11 px-3 py-2 border border-action/30 hover:border-action/50 bg-action-soft hover:bg-action/15 active:scale-[0.98] text-action rounded-xl text-xs font-semibold transition shrink-0"
            >
              <Truck className="w-3.5 h-3.5 text-secondary-foreground" />
              <span>Return to PHE</span>
            </button>
          )}
        </div>
      </div>

      <HorizontalScrollRow>
        <div className="flex items-stretch gap-2 sm:gap-3 min-w-max text-center">
          <div className="min-w-23 flex-1 bg-card border-border p-2.5 sm:p-3 rounded-xl border">
            <span className="text-xs font-semibold text-muted-foreground block">Active shops</span>
            <span className="font-semibold text-xs sm:text-sm text-foreground tabular-nums">
              {journey.stops.length}
            </span>
          </div>
          <div className="min-w-23 flex-1 bg-card border-border p-2.5 sm:p-3 rounded-xl border">
            <span className="text-xs font-semibold text-emerald-800 block">Collected</span>
            <span className="font-semibold text-xs sm:text-sm text-emerald-950 tabular-nums">
              {visitedStops.length}
            </span>
          </div>
          <div className="min-w-24 flex-1 bg-card border-border p-2.5 sm:p-3 rounded-xl border">
            <span className="text-xs font-semibold text-rose-800 block">
              {skippedStops.length > 0 ? 'Skipped / Rejected' : 'Rejected'}
            </span>
            <span className="font-semibold text-xs sm:text-sm text-rose-950 tabular-nums">
              {skippedStops.length > 0
                ? `${skippedStops.length} / ${rejectedStops.length}`
                : rejectedStops.length}
            </span>
          </div>
          <div className="min-w-24 flex-1 bg-card border-border p-2.5 sm:p-3 rounded-xl border">
            <span className="text-xs font-semibold text-blue-800 block">Milk (L)</span>
            <span className="font-semibold text-xs sm:text-sm text-blue-950 tabular-nums">
              {totalGross.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 2 })} L
            </span>
          </div>
          <div className="min-w-24 flex-1 bg-card border-border p-2.5 sm:p-3 rounded-xl border">
            <span className="text-xs font-semibold text-emerald-800 block">@13 TS (L)</span>
            <span className="font-semibold text-xs sm:text-sm text-emerald-950 tabular-nums">
              {totalAt13ts.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 2 })} L
            </span>
          </div>
        </div>
      </HorizontalScrollRow>

      {isAtZmcc ? (
        <div role="status" className="bg-card border-border mt-2 p-3 sm:p-4 border rounded-2xl flex items-start gap-2 text-emerald-950">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
          <div>
            <span className="text-xs font-semibold text-emerald-900 block">
              {journey.arrival?.lab_status === 'COMPLETED'
                ? 'Lab finished. Waiting for final weight'
                : journey.arrival?.lab_status
                  ? 'Milk is in lab testing'
                  : 'Reached ZMCC. Waiting for lab'}
            </span>
            {journey.arrival?.zmcc_token && (
              <p className="text-xs text-emerald-800 mt-0.5">Token: {journey.arrival.zmcc_token}</p>
            )}
            <p className="text-xs text-secondary-foreground mt-0.5">
              Open until final receipt.<InfoTip text="This journey stays open until the final receipt, or until the lab rejects all milk." />
            </p>
          </div>
        </div>
      ) : isReturning ? (
        <div className="bg-card border-border mt-2 p-3 sm:p-4 border rounded-2xl flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 rounded-lg bg-amber-600 text-white flex items-center justify-center shrink-0">
              <Truck className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="text-xs font-semibold text-amber-900">
                  Returning to PHE
                </span>
                <span className="text-xs px-2 py-0.5 rounded-md bg-amber-200 font-semibold text-amber-950">
                  En Route to ZMCC
                </span>
              </div>
            </div>
          </div>
          {onResumeCollection && (
            <button
              type="button"
              onClick={onResumeCollection}
              disabled={isSubmittingReturn}
              className="min-h-11 px-4 py-2 bg-accent border border-amber-300 hover:bg-amber-100 text-amber-900 rounded-xl text-xs font-semibold shrink-0 transition"
            >
              Resume Collection
            </button>
          )}
        </div>
      ) : !nextPendingStop ? (
        <div className="bg-card border-border mt-2 p-3 sm:p-4 border rounded-2xl flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 rounded-lg bg-emerald-600 text-white flex items-center justify-center shrink-0">
              <CheckCircle2 className="w-4 h-4" />
            </div>
            <div>
              <span className="text-xs font-semibold text-emerald-900">
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
              className="min-h-11 w-full sm:w-auto px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-semibold text-xs shadow-2xs transition flex items-center justify-center space-x-1.5 shrink-0"
            >
              <Truck className="w-4 h-4" />
              <span>Return to PHE</span>
            </button>
          )}
        </div>
      ) : (
        <div className="bg-card border-border mt-2 p-3 sm:p-4 border rounded-2xl flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center space-x-2.5">
            <span className="w-7 h-7 rounded-lg bg-primary text-white tabular-nums font-semibold text-xs flex items-center justify-center shrink-0">
              {nextPendingStop.planned_sequence}
            </span>
            <div>
              <span className="text-xs font-semibold text-muted-foreground block">
                Next Stop
              </span>
              <span className="font-semibold text-xs sm:text-sm text-foreground">
                {nextPendingStop.shop_name || nextPendingStop.shop?.shop_name || 'Shop'}
              </span>
            </div>
          </div>

          <div className={locked ? 'hidden' : 'w-full sm:w-auto'}>
            <button
              type="button"
              onClick={() => onRecord(nextPendingStop)}
              className="min-h-11 w-full sm:w-auto px-4 py-2 bg-primary hover:bg-primary-hover text-white rounded-xl font-semibold text-xs shadow-2xs transition flex items-center justify-center space-x-1.5 focus:outline-hidden focus:ring-2 focus:ring-primary"
            >
              <span>Record collection</span>
            </button>
          </div>
        </div>
      )}
    </motion.div>
  );
}
