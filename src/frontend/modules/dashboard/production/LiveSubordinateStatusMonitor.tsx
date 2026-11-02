import React from 'react';
import { Scale, Database, Clock, Truck, Play, CheckCircle2, AlertTriangle, ArrowRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { ProductionHeadSubordinateStations } from '@/backend/services/productionHeadOverviewService';

interface LiveSubordinateStatusMonitorProps {
  stations: ProductionHeadSubordinateStations;
}

export const LiveSubordinateStatusMonitor: React.FC<LiveSubordinateStatusMonitorProps> = ({ stations }) => {
  const { weighbridge, reception } = stations;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* 1. Weighbridge Sub-Station Live Progress */}
      <div className="rounded-xl border bg-card p-4 sm:p-5 shadow-2xs space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-border/60">
          <div className="flex items-center gap-2">
            <Scale className="h-5 w-5 text-blue-600 dark:text-blue-400" />
            <h3 className="font-semibold text-foreground text-sm sm:text-base">
              Weighbridge Live Status
            </h3>
          </div>
          <Badge
            variant={weighbridge.currentlyOnScale ? 'destructive' : 'secondary'}
            className="text-[11px]"
          >
            {weighbridge.currentlyOnScale ? 'SCALE IN USE' : 'SCALE CLEAR'}
          </Badge>
        </div>

        {/* Current Scale Occupancy */}
        {weighbridge.currentlyOnScale ? (
          <div className="p-3.5 rounded-lg border border-amber-500/30 bg-amber-500/5 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
                </span>
                Active on Scale ({weighbridge.currentlyOnScale.stepType} Weighment)
              </span>
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {weighbridge.currentlyOnScale.waitingMinutes} min elapsed
              </span>
            </div>

            <div className="flex items-baseline justify-between pt-1">
              <div>
                <p className="text-lg font-bold text-foreground">
                  {weighbridge.currentlyOnScale.vehicleNumber}
                </p>
                <p className="text-xs text-muted-foreground">
                  Token: {weighbridge.currentlyOnScale.tokenNumber || 'Standard'}
                </p>
              </div>
              <Badge variant="outline" className="text-xs">
                {weighbridge.currentlyOnScale.stepType === 'GROSS' ? 'Gross Loaded (1st Weight)' : 'Tare Empty (2nd Weight)'}
              </Badge>
            </div>
          </div>
        ) : (
          <div className="p-3.5 rounded-lg border border-border/60 bg-muted/30 text-center py-6">
            <CheckCircle2 className="h-6 w-6 text-emerald-500 mx-auto mb-1.5" />
            <p className="text-sm font-medium text-foreground">Scale Platform Ready</p>
            <p className="text-xs text-muted-foreground mt-0.5">No tanker currently on scale</p>
          </div>
        )}

        {/* Weighbridge Queues */}
        <div className="grid grid-cols-2 gap-3 pt-1">
          <div className="p-3 rounded-lg border bg-background/50">
            <span className="text-xs text-muted-foreground">Waiting for Gross (1st)</span>
            <p className="text-xl font-bold text-foreground mt-1">
              {weighbridge.waitingForGrossCount}{' '}
              <span className="text-xs font-normal text-muted-foreground">trucks</span>
            </p>
          </div>
          <div className="p-3 rounded-lg border bg-background/50">
            <span className="text-xs text-muted-foreground">Waiting for Tare (2nd)</span>
            <p className="text-xl font-bold text-foreground mt-1">
              {weighbridge.waitingForTareCount}{' '}
              <span className="text-xs font-normal text-muted-foreground">trucks</span>
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between text-xs text-muted-foreground pt-2 border-t border-border/60">
          <span>Avg scale turnaround: ~{weighbridge.avgWeighmentMinutes} mins</span>
          <span>Completed today: {weighbridge.completedTodayCount} tickets</span>
        </div>
      </div>

      {/* 2. Silo Reception Bays Live Progress */}
      <div className="rounded-xl border bg-card p-4 sm:p-5 shadow-2xs space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-border/60">
          <div className="flex items-center gap-2">
            <Database className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
            <h3 className="font-semibold text-foreground text-sm sm:text-base">
              Reception Bays Live Status
            </h3>
          </div>
          <Badge
            variant={reception.activeBaysCount > 0 ? 'default' : 'secondary'}
            className="text-[11px]"
          >
            {reception.activeBaysCount > 0
              ? `${reception.activeBaysCount} BAYS PUMPING`
              : 'ALL BAYS STANDBY'}
          </Badge>
        </div>

        {/* Active Pumpings */}
        {reception.activePumpings.length > 0 ? (
          <div className="space-y-2.5">
            {reception.activePumpings.map((p, idx) => (
              <div
                key={idx}
                className="p-3.5 rounded-lg border border-emerald-500/30 bg-emerald-500/5 space-y-2"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                    </span>
                    {p.bayNumber} &rarr; {p.siloNumber}
                  </span>
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {p.elapsedMinutes} mins pumping
                  </span>
                </div>

                <div className="flex items-baseline justify-between pt-1">
                  <div>
                    <p className="text-base font-bold text-foreground">{p.vehicleNumber}</p>
                    <p className="text-xs text-muted-foreground">
                      Portion #{p.portionNumber} · Operator: {p.startedByName}
                    </p>
                  </div>
                  <Badge variant="outline" className="text-xs text-emerald-600 border-emerald-500/30">
                    TRANSFERRING MILK
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-3.5 rounded-lg border border-border/60 bg-muted/30 text-center py-6">
            <CheckCircle2 className="h-6 w-6 text-emerald-500 mx-auto mb-1.5" />
            <p className="text-sm font-medium text-foreground">Reception Bays Available</p>
            <p className="text-xs text-muted-foreground mt-0.5">No tanker currently pumping into silos</p>
          </div>
        )}

        {/* Reception Queue */}
        <div className="grid grid-cols-2 gap-3 pt-1">
          <div className="p-3 rounded-lg border bg-background/50">
            <span className="text-xs text-muted-foreground">Waiting for Bay Allocation</span>
            <p className="text-xl font-bold text-foreground mt-1">
              {reception.waitingForUnloadingCount}{' '}
              <span className="text-xs font-normal text-muted-foreground">ready</span>
            </p>
          </div>
          <div className="p-3 rounded-lg border bg-background/50">
            <span className="text-xs text-muted-foreground">Avg Unload Duration</span>
            <p className="text-xl font-bold text-foreground mt-1">
              ~{reception.avgUnloadingMinutes}{' '}
              <span className="text-xs font-normal text-muted-foreground">mins/truck</span>
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between text-xs text-muted-foreground pt-2 border-t border-border/60">
          <span>Active pumping transfers: {reception.activeBaysCount}</span>
          <span>Completed today: {reception.completedPortionsToday} portions</span>
        </div>
      </div>
    </div>
  );
};
