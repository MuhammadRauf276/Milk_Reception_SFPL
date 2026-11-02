import React, { useState, useMemo } from 'react';
import { Database, Activity, CheckCircle2, AlertCircle, X, Sparkles } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import type { ProductionHeadSiloState } from '@/backend/services/productionHeadOverviewService';

interface PlantSiloInventoryGridProps {
  silos: ProductionHeadSiloState[];
}

export const PlantSiloInventoryGrid: React.FC<PlantSiloInventoryGridProps> = ({ silos }) => {
  const [selectedSilo, setSelectedSilo] = useState<ProductionHeadSiloState | null>(null);
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'RECEIVING' | 'STORAGE' | 'EMPTY'>('ALL');

  const totalStock13Ts = silos.reduce((acc, s) => acc + (s.current_stock_at_13ts || 0), 0);
  const totalCapacity = silos.reduce((acc, s) => acc + s.capacity_liters, 0);
  const totalPhysical = silos.reduce((acc, s) => acc + s.current_stock_liters, 0);
  const overallUtil = totalCapacity > 0 ? Math.round((totalPhysical / totalCapacity) * 100) : 0;
  const receivingCount = silos.filter((s) => s.status === 'RECEIVING').length;
  const storageCount = silos.filter((s) => s.status === 'STORAGE' || (s.current_stock_liters > 0 && s.status !== 'RECEIVING')).length;
  const emptyCount = silos.filter((s) => s.current_stock_liters === 0 && s.status !== 'RECEIVING').length;

  const filteredSilos = useMemo(() => {
    return silos.filter((s) => {
      if (statusFilter === 'RECEIVING') return s.status === 'RECEIVING';
      if (statusFilter === 'STORAGE') return s.status === 'STORAGE' || (s.current_stock_liters > 0 && s.status !== 'RECEIVING');
      if (statusFilter === 'EMPTY') return s.current_stock_liters === 0 && s.status !== 'RECEIVING';
      return true;
    });
  }, [silos, statusFilter]);

  const getProgressColor = (utilization: number) => {
    if (utilization >= 90) return 'bg-rose-500';
    if (utilization >= 75) return 'bg-amber-500';
    if (utilization >= 50) return 'bg-blue-500';
    return 'bg-emerald-500';
  };

  return (
    <div className="space-y-4">
      {/* 1. Overall Plant Storage Summary Card */}
      <div className="rounded-xl border border-border bg-card p-4 sm:p-5 shadow-2xs space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-1">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/10 text-violet-600 dark:text-violet-400">
              <Database className="h-4 w-4" />
            </div>
            <div>
              <h3 className="font-bold text-foreground text-sm sm:text-base leading-tight">
                Plant Silo Storage Overview
              </h3>
              <p className="text-[11px] text-muted-foreground">
                Total plant reception silos stock calculated @13% Total Solids
              </p>
            </div>
          </div>
          <div className="text-right sm:text-right">
            <div className="text-lg sm:text-xl font-bold tracking-tight text-foreground tabular-nums">
              {totalStock13Ts.toLocaleString()}{' '}
              <span className="text-xs font-normal text-muted-foreground">L @13% TS</span>
            </div>
            <p className="text-[11px] text-muted-foreground tabular-nums">
              {totalPhysical.toLocaleString()} L physical · {overallUtil}% of {totalCapacity.toLocaleString()} L
            </p>
          </div>
        </div>

        {/* Overall capacity progress bar */}
        <div className="space-y-1">
          <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
            <div
              className={`h-full transition-all duration-300 ${getProgressColor(overallUtil)}`}
              style={{ width: `${Math.min(100, overallUtil)}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-[11px] text-muted-foreground tabular-nums">
            <span>Overall Tanker Reception Utilization</span>
            <span>{overallUtil}% Full · {(totalCapacity - totalPhysical).toLocaleString()} L Available Headspace</span>
          </div>
        </div>
      </div>

      {/* 2. Filter Pills */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
        <button
          type="button"
          onClick={() => setStatusFilter('ALL')}
          className={`min-h-9 px-3 py-1.5 rounded-lg font-semibold transition-colors flex items-center gap-1.5 ${
            statusFilter === 'ALL'
              ? 'bg-primary text-primary-foreground shadow-2xs'
              : 'border border-border bg-card text-muted-foreground hover:text-foreground'
          }`}
        >
          <span>All Silos</span>
          <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-primary-foreground/20">
            {silos.length}
          </span>
        </button>
        <button
          type="button"
          onClick={() => setStatusFilter('RECEIVING')}
          className={`min-h-9 px-3 py-1.5 rounded-lg font-semibold transition-colors flex items-center gap-1.5 ${
            statusFilter === 'RECEIVING'
              ? 'bg-primary text-primary-foreground shadow-2xs'
              : 'border border-border bg-card text-muted-foreground hover:text-foreground'
          }`}
        >
          <span>Receiving</span>
          {receivingCount > 0 && (
            <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-primary-foreground/20">
              {receivingCount}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={() => setStatusFilter('STORAGE')}
          className={`min-h-9 px-3 py-1.5 rounded-lg font-semibold transition-colors flex items-center gap-1.5 ${
            statusFilter === 'STORAGE'
              ? 'bg-primary text-primary-foreground shadow-2xs'
              : 'border border-border bg-card text-muted-foreground hover:text-foreground'
          }`}
        >
          <span>In Storage</span>
          <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-primary-foreground/20">
            {storageCount}
          </span>
        </button>
        <button
          type="button"
          onClick={() => setStatusFilter('EMPTY')}
          className={`min-h-9 px-3 py-1.5 rounded-lg font-semibold transition-colors flex items-center gap-1.5 ${
            statusFilter === 'EMPTY'
              ? 'bg-primary text-primary-foreground shadow-2xs'
              : 'border border-border bg-card text-muted-foreground hover:text-foreground'
          }`}
        >
          <span>Empty</span>
          <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-primary-foreground/20">
            {emptyCount}
          </span>
        </button>
      </div>

      {/* 3. Silo Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
        {filteredSilos.map((silo) => {
          const isReceiving = silo.status === 'RECEIVING';
          const fillPercent = Math.min(100, silo.utilizationPercent);
          const hasStock = silo.current_stock_liters > 0;
          const availableLiters = Math.max(0, silo.capacity_liters - silo.current_stock_liters);

          return (
            <div
              key={silo.id}
              onClick={() => setSelectedSilo(silo)}
              className="group cursor-pointer rounded-xl border border-border bg-card p-4 shadow-2xs space-y-3 hover:border-primary/50 hover:shadow-xs transition-all"
            >
              {/* Top row: Code, Name, Status Badge */}
              <div className="flex items-center justify-between">
                <div>
                  <span className="font-mono text-base font-bold uppercase tracking-wider text-foreground">
                    {silo.silo_code}
                  </span>
                  <span className="text-xs text-muted-foreground ml-2">
                    {silo.silo_name}
                  </span>
                </div>
                <Badge
                  variant="outline"
                  className={
                    isReceiving
                      ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20 text-xs font-semibold flex items-center gap-1'
                      : hasStock
                      ? 'bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/20 text-xs font-medium'
                      : 'bg-muted text-muted-foreground text-xs font-medium'
                  }
                >
                  {isReceiving && (
                    <span className="relative flex h-1.5 w-1.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-600"></span>
                    </span>
                  )}
                  {isReceiving ? 'Receiving' : hasStock ? 'Storage' : 'Empty'}
                </Badge>
              </div>

              {/* Primary @13% TS Metric */}
              <div className="flex items-baseline justify-between pt-0.5">
                <div className="text-xl font-bold tracking-tight text-foreground tabular-nums">
                  {silo.current_stock_at_13ts !== null
                    ? silo.current_stock_at_13ts.toLocaleString()
                    : silo.current_stock_liters > 0
                    ? `${silo.current_stock_liters.toLocaleString()} (est)`
                    : '0'}{' '}
                  <span className="text-xs font-normal text-muted-foreground">L @13% TS</span>
                </div>
                {silo.composite_ts_percent !== null && (
                  <span className="text-xs font-mono font-semibold text-muted-foreground">
                    {silo.composite_ts_percent.toFixed(2)}% TS
                  </span>
                )}
              </div>

              {/* Progress Bar with Semantic Color Coding */}
              <div className="space-y-1.5">
                <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${getProgressColor(fillPercent)}`}
                    style={{ width: `${fillPercent}%` }}
                  />
                </div>
                <div className="flex justify-between text-[11px] text-muted-foreground tabular-nums">
                  <span>Physical: {silo.current_stock_liters.toLocaleString()} L</span>
                  <span>{fillPercent}% ({availableLiters.toLocaleString()} L free)</span>
                </div>
              </div>

              {/* Receiving Indicator if active */}
              {isReceiving && silo.activePumpingVehicle && (
                <div className="flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-300 pt-2 border-t border-border/60">
                  <Activity className="h-3.5 w-3.5 animate-pulse text-emerald-600" />
                  <span>Receiving tanker: <strong className="font-mono uppercase">{silo.activePumpingVehicle}</strong></span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* 4. Silo Inspection Drawer / Modal (Responsive dual-mode) */}
      <Drawer open={Boolean(selectedSilo)} onOpenChange={(open) => !open && setSelectedSilo(null)}>
        {selectedSilo && (
          <DrawerContent className="max-w-lg">
            <DrawerHeader className="border-b border-border pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Database className="h-5 w-5 text-primary" />
                  <div>
                    <DrawerTitle className="font-mono text-lg font-bold uppercase tracking-wider text-foreground">
                      {selectedSilo.silo_code}
                    </DrawerTitle>
                    <p className="text-xs text-muted-foreground">{selectedSilo.silo_name}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedSilo(null)}
                  className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </DrawerHeader>

            <div className="p-4 sm:p-5 space-y-4 text-xs">
              {/* Stock telemetry summary */}
              <div className="rounded-xl border border-border bg-muted/20 p-3.5 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Standardized @13% TS Volume:</span>
                  <span className="font-bold text-base text-foreground tabular-nums">
                    {selectedSilo.current_stock_at_13ts?.toLocaleString() || '0'} L
                  </span>
                </div>
                <div className="flex items-center justify-between border-t border-border/60 pt-2">
                  <span className="text-muted-foreground">Physical Liquid Stock:</span>
                  <span className="font-semibold text-foreground tabular-nums">
                    {selectedSilo.current_stock_liters.toLocaleString()} Liters
                  </span>
                </div>
                <div className="flex items-center justify-between border-t border-border/60 pt-2">
                  <span className="text-muted-foreground">Total Silo Capacity:</span>
                  <span className="font-semibold text-foreground tabular-nums">
                    {selectedSilo.capacity_liters.toLocaleString()} Liters
                  </span>
                </div>
                <div className="flex items-center justify-between border-t border-border/60 pt-2">
                  <span className="text-muted-foreground">Capacity Utilization:</span>
                  <span className="font-semibold text-foreground tabular-nums">
                    {selectedSilo.utilizationPercent}%
                  </span>
                </div>
                {selectedSilo.composite_ts_percent !== null && (
                  <div className="flex items-center justify-between border-t border-border/60 pt-2">
                    <span className="text-muted-foreground">Composite Total Solids (TS):</span>
                    <span className="font-mono font-semibold text-foreground tabular-nums">
                      {selectedSilo.composite_ts_percent.toFixed(2)}%
                    </span>
                  </div>
                )}
              </div>

              {/* Status details */}
              <div className="space-y-2">
                <h4 className="font-semibold text-foreground">Operational Status</h4>
                <div className="flex items-center justify-between p-3 rounded-lg border border-border bg-card">
                  <span className="text-muted-foreground">Current Operating State:</span>
                  <Badge variant="outline" className="text-xs font-semibold">
                    {selectedSilo.status}
                  </Badge>
                </div>
                {selectedSilo.activePumpingVehicle && (
                  <div className="flex items-center justify-between p-3 rounded-lg border border-emerald-500/20 bg-emerald-50/40 dark:bg-emerald-950/20 text-emerald-800 dark:text-emerald-200">
                    <span>Active Inflow Tanker:</span>
                    <span className="font-mono font-bold uppercase">{selectedSilo.activePumpingVehicle}</span>
                  </div>
                )}
              </div>

              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => setSelectedSilo(null)}
                  className="w-full min-h-11 rounded-xl bg-primary text-primary-foreground font-semibold text-xs hover:bg-primary/90 transition shadow-2xs"
                >
                  Close Inspection
                </button>
              </div>
            </div>
          </DrawerContent>
        )}
      </Drawer>
    </div>
  );
};
