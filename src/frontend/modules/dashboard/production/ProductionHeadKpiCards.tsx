import React from 'react';
import { Droplet, Truck, Scale, Database, AlertTriangle } from 'lucide-react';
import type { ProductionHeadKpis } from '@/backend/services/productionHeadOverviewService';

interface ProductionHeadKpiCardsProps {
  kpis: ProductionHeadKpis;
  waitingForGrossCount?: number;
  waitingForTareCount?: number;
}

export const ProductionHeadKpiCards: React.FC<ProductionHeadKpiCardsProps> = ({
  kpis,
  waitingForGrossCount = 0,
  waitingForTareCount = 0,
}) => {
  const totalScaleWaiting = waitingForGrossCount + waitingForTareCount;

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
      {/* 1. Today's Intake (@13% TS) */}
      <div className="rounded-xl border border-border bg-card p-3.5 sm:p-4 shadow-2xs flex flex-col justify-between">
        <div className="flex items-center justify-between text-muted-foreground mb-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Intake Today
          </span>
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400">
            <Droplet className="h-4 w-4" />
          </div>
        </div>
        <div>
          <div className="text-xl sm:text-2xl font-bold tracking-tight text-foreground tabular-nums">
            {kpis.totalIntake13TsLitersToday.toLocaleString()}{' '}
            <span className="text-xs font-normal text-muted-foreground">L @13% TS</span>
          </div>
          <p className="text-[11px] text-muted-foreground mt-1 truncate">
            {kpis.totalIntakeGrossLitersToday.toLocaleString()} L gross · {kpis.totalIntakeNetKgToday.toLocaleString()} kg net
          </p>
        </div>
      </div>

      {/* 2. Active In-Plant Tankers */}
      <div className="rounded-xl border border-border bg-card p-3.5 sm:p-4 shadow-2xs flex flex-col justify-between">
        <div className="flex items-center justify-between text-muted-foreground mb-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            In-Plant Tankers
          </span>
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
            <Truck className="h-4 w-4" />
          </div>
        </div>
        <div>
          <div className="text-xl sm:text-2xl font-bold tracking-tight text-foreground tabular-nums">
            {kpis.activeVehiclesInPlant}{' '}
            <span className="text-xs font-normal text-muted-foreground">vehicles</span>
          </div>
          <p className="text-[11px] text-muted-foreground mt-1 truncate">
            Inside factory security boundary
          </p>
        </div>
      </div>

      {/* 3. Weighbridge Activity */}
      <div className="rounded-xl border border-border bg-card p-3.5 sm:p-4 shadow-2xs flex flex-col justify-between">
        <div className="flex items-center justify-between text-muted-foreground mb-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Weighbridge
          </span>
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400">
            <Scale className="h-4 w-4" />
          </div>
        </div>
        <div>
          <div className="text-xl sm:text-2xl font-bold tracking-tight text-foreground tabular-nums">
            {kpis.weighbridgeTicketsToday}{' '}
            <span className="text-xs font-normal text-muted-foreground">weighed</span>
          </div>
          {totalScaleWaiting > 0 ? (
            <p className="text-[11px] font-semibold text-amber-600 dark:text-amber-400 mt-1 flex items-center gap-1 truncate">
              <AlertTriangle className="h-3 w-3 shrink-0" />
              <span>{waitingForGrossCount} gross · {waitingForTareCount} tare waiting</span>
            </p>
          ) : (
            <p className="text-[11px] text-muted-foreground mt-1 truncate">
              Scale queues clear
            </p>
          )}
        </div>
      </div>

      {/* 4. Silo Storage */}
      <div className="rounded-xl border border-border bg-card p-3.5 sm:p-4 shadow-2xs flex flex-col justify-between">
        <div className="flex items-center justify-between text-muted-foreground mb-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Silo Stock
          </span>
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-violet-500/10 text-violet-600 dark:text-violet-400">
            <Database className="h-4 w-4" />
          </div>
        </div>
        <div>
          <div className="text-xl sm:text-2xl font-bold tracking-tight text-foreground tabular-nums">
            {kpis.currentSiloStock13TsLiters.toLocaleString()}{' '}
            <span className="text-xs font-normal text-muted-foreground">L @13% TS</span>
          </div>
          <p className="text-[11px] text-muted-foreground mt-1 truncate">
            {kpis.siloUtilizationPercent}% of {kpis.totalSiloCapacityLiters.toLocaleString()} L capacity
          </p>
        </div>
      </div>
    </div>
  );
};
