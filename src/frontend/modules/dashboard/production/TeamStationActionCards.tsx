import React from 'react';
import Link from 'next/link';
import { Scale, Database, Clock, ArrowRight, User, CheckCircle2, AlertCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { ProductionHeadSubordinateStations } from '@/backend/services/productionHeadOverviewService';

interface TeamStationActionCardsProps {
  stations: ProductionHeadSubordinateStations;
}

export const TeamStationActionCards: React.FC<TeamStationActionCardsProps> = ({ stations }) => {
  const { weighbridge, reception } = stations;
  const isScaleBusy = weighbridge.currentlyOnScale !== null;
  const isReceptionPumping = reception.activePumpings.length > 0;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5 sm:gap-5">
      {/* 1. Weighbridge Station Live Oversight */}
      <div className="flex flex-col justify-between rounded-xl border border-border bg-card p-4 sm:p-5 shadow-2xs space-y-4">
        <div className="space-y-3.5">
          {/* Header */}
          <div className="flex items-center justify-between pb-3 border-b border-border/60">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400">
                <Scale className="h-4 w-4" />
              </div>
              <div>
                <h3 className="font-bold text-foreground text-sm sm:text-base leading-tight">
                  Plant Weighbridge
                </h3>
                <p className="text-[11px] text-muted-foreground">Gross &amp; Tare Scale Station</p>
              </div>
            </div>
            <Badge
              variant="outline"
              className={
                isScaleBusy
                  ? 'bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/20 font-semibold text-xs flex items-center gap-1.5'
                  : 'bg-muted text-muted-foreground font-medium text-xs'
              }
            >
              {isScaleBusy && (
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-600"></span>
                </span>
              )}
              {isScaleBusy ? 'Scale Active' : 'Scale Ready'}
            </Badge>
          </div>

          {/* Current Scale Platform State */}
          {weighbridge.currentlyOnScale ? (
            <div className="rounded-xl border border-blue-500/20 bg-blue-50/40 dark:bg-blue-950/20 p-3 sm:p-3.5 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold uppercase tracking-wider text-blue-700 dark:text-blue-300 flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-blue-600"></span>
                  Vehicle On Scale
                </span>
                <span className="text-muted-foreground flex items-center gap-1 tabular-nums font-medium">
                  <Clock className="h-3 w-3" />
                  {weighbridge.currentlyOnScale.waitingMinutes}m on scale
                </span>
              </div>

              <div className="flex items-baseline justify-between pt-0.5">
                <div>
                  <div className="font-mono text-base sm:text-lg font-bold uppercase tracking-wider text-foreground">
                    {weighbridge.currentlyOnScale.vehicleNumber}
                  </div>
                  {weighbridge.currentlyOnScale.tokenNumber && (
                    <span className="text-xs text-muted-foreground font-mono">
                      Token #{weighbridge.currentlyOnScale.tokenNumber}
                    </span>
                  )}
                </div>
                <Badge
                  variant="secondary"
                  className="text-xs font-semibold px-2 py-0.5"
                >
                  {weighbridge.currentlyOnScale.stepType === 'GROSS'
                    ? 'Gross (Loaded 1st)'
                    : 'Tare (Empty 2nd)'}
                </Badge>
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-border/60 bg-muted/20 p-3.5 text-center space-y-1">
              <div className="flex items-center justify-center gap-1.5 text-emerald-600 dark:text-emerald-400 text-xs font-semibold">
                <CheckCircle2 className="h-4 w-4" />
                <span>Scale Platform Clear</span>
              </div>
              <p className="text-[11px] text-muted-foreground">Ready for next arriving tanker</p>
            </div>
          )}

          {/* Scale Queues Telemetry */}
          <div className="grid grid-cols-2 gap-2.5 pt-0.5">
            <div className="rounded-lg border border-border/70 bg-background/50 p-2.5">
              <span className="text-[11px] font-medium text-muted-foreground block truncate">
                Gross Queue (1st Weight)
              </span>
              <div className="text-lg font-bold text-foreground tabular-nums mt-0.5">
                {weighbridge.waitingForGrossCount}{' '}
                <span className="text-xs font-normal text-muted-foreground">tankers</span>
              </div>
            </div>
            <div className="rounded-lg border border-border/70 bg-background/50 p-2.5">
              <span className="text-[11px] font-medium text-muted-foreground block truncate">
                Tare Queue (2nd Weight)
              </span>
              <div className="text-lg font-bold text-foreground tabular-nums mt-0.5">
                {weighbridge.waitingForTareCount}{' '}
                <span className="text-xs font-normal text-muted-foreground">tankers</span>
              </div>
            </div>
          </div>

          {/* Operator and Turnaround info */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between text-xs text-muted-foreground pt-1 border-t border-border/60 gap-1">
            <div className="flex items-center gap-1.5 truncate">
              <User className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate">
                {weighbridge.activeOperators.length > 0
                  ? weighbridge.activeOperators.join(', ')
                  : 'Weighbridge Operator'}
              </span>
            </div>
            <div className="text-[11px] tabular-nums sm:text-right">
              {weighbridge.completedTodayCount} weighed · ~{weighbridge.avgWeighmentMinutes}m avg
            </div>
          </div>
        </div>

        {/* Action button */}
        <div className="pt-2">
          <Link
            href="/department/weighbridge"
            className="inline-flex w-full min-h-11 items-center justify-center gap-2 rounded-xl border border-input bg-background hover:bg-muted/70 px-4 text-xs font-semibold text-foreground transition-colors shadow-2xs"
          >
            <span>Open Weighbridge Station</span>
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>

      {/* 2. Silo Reception Bays Live Oversight */}
      <div className="flex flex-col justify-between rounded-xl border border-border bg-card p-4 sm:p-5 shadow-2xs space-y-4">
        <div className="space-y-3.5">
          {/* Header */}
          <div className="flex items-center justify-between pb-3 border-b border-border/60">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                <Database className="h-4 w-4" />
              </div>
              <div>
                <h3 className="font-bold text-foreground text-sm sm:text-base leading-tight">
                  Silo Reception
                </h3>
                <p className="text-[11px] text-muted-foreground">Direct Tanker Offloading Bays</p>
              </div>
            </div>
            <Badge
              variant="outline"
              className={
                isReceptionPumping
                  ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20 font-semibold text-xs flex items-center gap-1.5'
                  : 'bg-muted text-muted-foreground font-medium text-xs'
              }
            >
              {isReceptionPumping && (
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-600"></span>
                </span>
              )}
              {isReceptionPumping
                ? `${reception.activePumpings.length} Active ${reception.activePumpings.length === 1 ? 'Bay' : 'Bays'}`
                : 'Bays Ready'}
            </Badge>
          </div>

          {/* Current Bays State */}
          {reception.activePumpings.length > 0 ? (
            <div className="space-y-2">
              {reception.activePumpings.slice(0, 2).map((p, idx) => (
                <div
                  key={`${p.vehicleNumber}-${p.bayNumber}-${idx}`}
                  className="rounded-xl border border-emerald-500/20 bg-emerald-50/40 dark:bg-emerald-950/20 p-3 sm:p-3.5 space-y-1.5"
                >
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-300 flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full bg-emerald-600"></span>
                      {p.bayNumber} &rarr; {p.siloNumber}
                    </span>
                    <span className="text-muted-foreground flex items-center gap-1 tabular-nums font-medium">
                      <Clock className="h-3 w-3" />
                      {p.elapsedMinutes}m elapsed
                    </span>
                  </div>

                  <div className="flex items-baseline justify-between">
                    <span className="font-mono text-base font-bold uppercase tracking-wider text-foreground">
                      {p.vehicleNumber}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      Portion #{p.portionNumber} · by {p.startedByName}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-border/60 bg-muted/20 p-3.5 text-center space-y-1">
              <div className="flex items-center justify-center gap-1.5 text-emerald-600 dark:text-emerald-400 text-xs font-semibold">
                <CheckCircle2 className="h-4 w-4" />
                <span>All Unloading Bays Clear</span>
              </div>
              <p className="text-[11px] text-muted-foreground">Ready for next QA-cleared tanker</p>
            </div>
          )}

          {/* Reception Queues Telemetry */}
          <div className="grid grid-cols-2 gap-2.5 pt-0.5">
            <div className="rounded-lg border border-border/70 bg-background/50 p-2.5">
              <span className="text-[11px] font-medium text-muted-foreground block truncate">
                Ready for Bay (QA Cleared)
              </span>
              <div className="text-lg font-bold text-foreground tabular-nums mt-0.5">
                {reception.waitingForUnloadingCount}{' '}
                <span className="text-xs font-normal text-muted-foreground">tankers</span>
              </div>
            </div>
            <div className="rounded-lg border border-border/70 bg-background/50 p-2.5">
              <span className="text-[11px] font-medium text-muted-foreground block truncate">
                Offloaded Today
              </span>
              <div className="text-lg font-bold text-foreground tabular-nums mt-0.5">
                {reception.completedPortionsToday}{' '}
                <span className="text-xs font-normal text-muted-foreground">portions</span>
              </div>
            </div>
          </div>

          {/* Operator and Turnaround info */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between text-xs text-muted-foreground pt-1 border-t border-border/60 gap-1">
            <div className="flex items-center gap-1.5 truncate">
              <User className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate">
                {reception.activeOperators.length > 0
                  ? reception.activeOperators.join(', ')
                  : 'Production Operator'}
              </span>
            </div>
            <div className="text-[11px] tabular-nums sm:text-right">
              ~{reception.avgUnloadingMinutes}m avg / portion
            </div>
          </div>
        </div>

        {/* Action button */}
        <div className="pt-2">
          <Link
            href="/department/production"
            className="inline-flex w-full min-h-11 items-center justify-center gap-2 rounded-xl border border-input bg-background hover:bg-muted/70 px-4 text-xs font-semibold text-foreground transition-colors shadow-2xs"
          >
            <span>Open Silo Reception Station</span>
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>
    </div>
  );
};
