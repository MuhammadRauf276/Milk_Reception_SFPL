import React, { useState, useMemo } from 'react';
import { Database, Activity, CheckCircle2, AlertCircle, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { Pagination, usePagedRows } from '@/components/ui/pagination';
import type { ProductionHeadSiloState } from '@/backend/services/productionHeadOverviewService';

interface PlantSiloInventoryGridProps {
  silos: ProductionHeadSiloState[];
}

export const PlantSiloInventoryGrid: React.FC<PlantSiloInventoryGridProps> = ({ silos }) => {
  const [selectedSilo, setSelectedSilo] = useState<ProductionHeadSiloState | null>(null);
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'RECEIVING' | 'STORAGE' | 'EMPTY'>('ALL');

  const totalStock13Ts = silos.some((s) => s.current_stock_at_13ts == null)
    ? null
    : silos.reduce((acc, s) => acc + Number(s.current_stock_at_13ts), 0);
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

  const pagedSilos = usePagedRows(filteredSilos, (s) => s.id);

  const getProgressColor = (utilization: number) => {
    if (utilization >= 90) return 'bg-rose-500';
    if (utilization >= 75) return 'bg-amber-500';
    if (utilization >= 50) return 'bg-blue-500';
    return 'bg-emerald-500';
  };

  return (
    <div className="space-y-4">
      {/* 1. Overall Plant Storage Summary Card */}
      <div className="rounded-2xl border border-border bg-card p-4 sm:p-5 shadow-2xs space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-1">
          <div className="flex items-center gap-2">
            <Database className="h-4 w-4 shrink-0 text-muted-foreground" />
            <div>
              <h3 className="font-semibold text-foreground text-sm sm:text-base leading-tight">
                Silo storage
              </h3>
              <p className="text-xs text-muted-foreground">
                Silo stock @13 TS
              </p>
            </div>
          </div>
          <div className="text-right sm:text-right">
            <div className="font-mono text-lg sm:text-xl font-semibold text-foreground tabular-nums">
              {totalStock13Ts != null ? totalStock13Ts.toLocaleString() : '—'}{' '}
              <span className="text-xs font-normal text-muted-foreground">L @13 TS</span>
            </div>
            <p className="text-xs text-muted-foreground tabular-nums">
              {totalPhysical.toLocaleString()} L physical · {overallUtil}% of {totalCapacity.toLocaleString()} L
            </p>
          </div>
        </div>

        {/* Overall capacity progress bar */}
        <div className="space-y-1">
          <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
            <div
              className={`h-full transition-[width] duration-300 ${getProgressColor(overallUtil)}`}
              style={{ width: `${Math.min(100, overallUtil)}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-xs text-muted-foreground tabular-nums">
            <span>Reception silo use</span>
            <span>{overallUtil}% full, {Math.max(0, totalCapacity - totalPhysical).toLocaleString()} L free{totalPhysical > totalCapacity ? ` (over capacity by ${(totalPhysical - totalCapacity).toLocaleString()} L)` : ''}</span>
          </div>
        </div>
      </div>

      {/* 2. Filter Pills */}
      <div className="flex items-center gap-2 overflow-x-auto scrollbar-thin pb-1.5 text-xs">
        <button
          type="button"
          onClick={() => setStatusFilter('ALL')}
          className={`min-h-11 px-3 py-2 shrink-0 whitespace-nowrap rounded-lg font-semibold transition-colors flex items-center gap-2 ${
            statusFilter === 'ALL'
              ? 'bg-primary text-primary-foreground'
              : 'border border-border bg-card text-muted-foreground hover:text-foreground'
          }`}
        >
          <span>All silos</span>
          <span className="text-xs px-2 py-0.5 rounded-md bg-primary-foreground/20">
            {silos.length}
          </span>
        </button>
        <button
          type="button"
          onClick={() => setStatusFilter('RECEIVING')}
          className={`min-h-11 shrink-0 whitespace-nowrap px-3 py-2 rounded-lg font-semibold transition-colors flex items-center gap-2 ${
            statusFilter === 'RECEIVING'
              ? 'bg-primary text-primary-foreground'
              : 'border border-border bg-card text-muted-foreground hover:text-foreground'
          }`}
        >
          <span>Receiving</span>
          {receivingCount > 0 && (
            <span className="text-xs px-2 py-0.5 rounded-md bg-primary-foreground/20">
              {receivingCount}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={() => setStatusFilter('STORAGE')}
          className={`min-h-11 shrink-0 whitespace-nowrap px-3 py-2 rounded-lg font-semibold transition-colors flex items-center gap-2 ${
            statusFilter === 'STORAGE'
              ? 'bg-primary text-primary-foreground'
              : 'border border-border bg-card text-muted-foreground hover:text-foreground'
          }`}
        >
          <span>In storage</span>
          <span className="text-xs px-2 py-0.5 rounded-md bg-primary-foreground/20">
            {storageCount}
          </span>
        </button>
        <button
          type="button"
          onClick={() => setStatusFilter('EMPTY')}
          className={`min-h-11 shrink-0 whitespace-nowrap px-3 py-2 rounded-lg font-semibold transition-colors flex items-center gap-2 ${
            statusFilter === 'EMPTY'
              ? 'bg-primary text-primary-foreground'
              : 'border border-border bg-card text-muted-foreground hover:text-foreground'
          }`}
        >
          <span>Empty</span>
          <span className="text-xs px-2 py-0.5 rounded-md bg-primary-foreground/20">
            {emptyCount}
          </span>
        </button>
      </div>

      {/* 3. Silo Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
        {pagedSilos.pageRows.map((silo) => {
          const isReceiving = silo.status === 'RECEIVING';
          const fillPercent = Math.min(100, silo.utilizationPercent);
          const hasStock = silo.current_stock_liters > 0;
          const availableLiters = Math.max(0, silo.capacity_liters - silo.current_stock_liters);

          return (
            <div
              key={silo.id}
              onClick={() => setSelectedSilo(silo)}
              className="group cursor-pointer rounded-2xl border border-border bg-card p-4 space-y-3 hover:border-border-strong transition-colors"
            >
              {/* Top row: Code, Name, Status Badge */}
              <div className="flex items-center justify-between">
                <div>
                  <span className="font-mono text-base font-semibold text-foreground">
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

              {/* Primary @13 TS Metric */}
              <div className="flex items-baseline justify-between pt-0.5">
                <div className="font-mono text-xl font-semibold text-foreground tabular-nums">
                  {silo.current_stock_at_13ts !== null
                    ? silo.current_stock_at_13ts.toLocaleString()
                    : silo.current_stock_liters > 0
                    ? `${silo.current_stock_liters.toLocaleString()} (est)`
                    : '0'}{' '}
                  <span className="text-xs font-normal text-muted-foreground">L @13 TS</span>
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
                    className={`h-full rounded-full transition-[width] duration-300 ${getProgressColor(fillPercent)}`}
                    style={{ width: `${fillPercent}%` }}
                  />
                </div>
                <div className="flex justify-between text-xs text-muted-foreground tabular-nums">
                  <span>Physical: {silo.current_stock_liters.toLocaleString()} L</span>
                  <span>{fillPercent}% ({availableLiters.toLocaleString()} L free{silo.current_stock_liters > silo.capacity_liters ? ', over capacity' : ''})</span>
                </div>
              </div>

              {/* Receiving Indicator if active */}
              {isReceiving && silo.activePumpingVehicle && (
                <div className="flex items-center gap-2 text-xs font-medium text-emerald-700 dark:text-emerald-300 pt-2 border-t border-border/60">
                  <Activity className="h-3.5 w-3.5 text-emerald-600" />
                  <span>Receiving tanker: <strong className="font-mono">{silo.activePumpingVehicle}</strong></span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {filteredSilos.length > 0 && (
        <Pagination
          page={pagedSilos.page}
          totalPages={pagedSilos.totalPages}
          totalRecords={pagedSilos.totalRecords}
          pageSize={pagedSilos.pageSize}
          noun="silos"
          onPageChange={pagedSilos.setPage}
          className="px-0 pt-1"
        />
      )}

      {/* 4. Silo Inspection Drawer / Modal (Responsive dual-mode) */}
      <Drawer open={Boolean(selectedSilo)} onOpenChange={(open) => !open && setSelectedSilo(null)}>
        {selectedSilo && (
          <DrawerContent showClose={false} className="max-w-lg">
            <DrawerHeader className="border-b border-border pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Database className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <DrawerTitle className="font-mono text-lg font-semibold text-foreground">
                      {selectedSilo.silo_code}
                    </DrawerTitle>
                    <p className="text-xs text-muted-foreground">{selectedSilo.silo_name}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedSilo(null)}
                  aria-label="Close"
                  className="flex h-11 w-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </DrawerHeader>

            <div className="p-4 sm:p-5 space-y-4 text-xs">
              {/* Stock telemetry summary */}
              <div className="rounded-2xl border border-border bg-muted/20 p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Volume @13 TS</span>
                  <span className="font-mono font-semibold text-base text-foreground tabular-nums">
                    {selectedSilo.current_stock_at_13ts != null ? `${selectedSilo.current_stock_at_13ts.toLocaleString()} L` : '—'}
                  </span>
                </div>
                <div className="flex items-center justify-between border-t border-border/60 pt-2">
                  <span className="text-muted-foreground">Physical stock</span>
                  <span className="font-mono font-semibold text-foreground tabular-nums">
                    {selectedSilo.current_stock_liters.toLocaleString()} L
                  </span>
                </div>
                <div className="flex items-center justify-between border-t border-border/60 pt-2">
                  <span className="text-muted-foreground">Silo capacity</span>
                  <span className="font-mono font-semibold text-foreground tabular-nums">
                    {selectedSilo.capacity_liters.toLocaleString()} L
                  </span>
                </div>
                <div className="flex items-center justify-between border-t border-border/60 pt-2">
                  <span className="text-muted-foreground">Capacity used</span>
                  <span className="font-mono font-semibold text-foreground tabular-nums">
                    {selectedSilo.utilizationPercent}%
                  </span>
                </div>
                {selectedSilo.composite_ts_percent !== null && (
                  <div className="flex items-center justify-between border-t border-border/60 pt-2">
                    <span className="text-muted-foreground">Composite TS</span>
                    <span className="font-mono font-semibold text-foreground tabular-nums">
                      {selectedSilo.composite_ts_percent.toFixed(2)}%
                    </span>
                  </div>
                )}
              </div>

              {/* Status details */}
              <div className="space-y-2">
                <h4 className="font-semibold text-foreground">Status</h4>
                <div className="flex items-center justify-between p-3 rounded-lg border border-border bg-card">
                  <span className="text-muted-foreground">Current state</span>
                  <Badge variant="outline" className="text-xs font-semibold">
                    {selectedSilo.status}
                  </Badge>
                </div>
                {selectedSilo.activePumpingVehicle && (
                  <div className="flex items-center justify-between p-3 rounded-lg border border-emerald-500/20 bg-emerald-50/40 dark:bg-emerald-950/20 text-emerald-800 dark:text-emerald-200">
                    <span>Tanker unloading</span>
                    <span className="font-mono font-semibold">{selectedSilo.activePumpingVehicle}</span>
                  </div>
                )}
              </div>
            </div>
          </DrawerContent>
        )}
      </Drawer>
    </div>
  );
};
