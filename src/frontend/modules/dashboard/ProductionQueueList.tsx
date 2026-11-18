'use client';

import React, { useEffect, useState } from 'react';
import { Clock } from 'lucide-react';
import { SkeletonList } from '@/components/ui/loaders';
import { onActivateKey } from '@/lib/a11y';
import { useQueryClient } from '@tanstack/react-query';
import { EmptyAction } from './components/EmptyAction';
import { Pager, pageCount, paginate } from './components/Pager';
import type { ProductionTab, ReadyVisitDef, SiloOption, UnloadingVisitDef } from './productionTypes';

const cardClass = (selected: boolean) =>
  `w-full min-w-0 p-4 rounded-xl border transition-colors cursor-pointer space-y-2.5 min-h-11 ${
    selected
      ? 'bg-primary/[0.03] text-foreground border-primary'
      : 'bg-card text-foreground border-border hover:border-border-strong hover:bg-muted/30'
  }`;

const statsClass = (selected: boolean, twoCols = true) =>
  `grid ${twoCols ? 'grid-cols-2' : 'grid-cols-1'} gap-3 text-xs p-3 rounded-lg font-mono tabular-nums font-semibold border ${
    selected ? 'bg-muted/70 text-foreground border-border/50' : 'bg-muted/40 text-foreground border-border/50'
  }`;

const Empty: React.FC<{ children: string }> = ({ children }) => {
  const queryClient = useQueryClient();
  return (
    <EmptyAction
      message={children}
      onRefresh={() => queryClient.invalidateQueries()}
      className="col-span-full"
    />
  );
};

/** Queue cards for the active production tab (ready / unloading / silos), 25 per page. */
export const ProductionQueueList: React.FC<{
  activeTab: ProductionTab;
  isLoading: boolean;
  readyVisits: ReadyVisitDef[];
  unloadingVisits: UnloadingVisitDef[];
  silos: SiloOption[];
  selectedReadyVisitId: string | null;
  selectedUnloadingVisitId: string | null;
  selectedIssueSiloId: string | null;
  onSelectReady: (id: string) => void;
  onSelectUnloading: (id: string) => void;
  onSelectSilo: (id: string) => void;
}> = ({
  activeTab,
  isLoading,
  readyVisits,
  unloadingVisits,
  silos,
  selectedReadyVisitId,
  selectedUnloadingVisitId,
  selectedIssueSiloId,
  onSelectReady,
  onSelectUnloading,
  onSelectSilo,
}) => {
  const [page, setPage] = useState(1);
  const total = activeTab === 'READY' ? readyVisits.length : activeTab === 'UNLOADING' ? unloadingVisits.length : silos.length;
  const totalPages = pageCount(total);
  const currentPage = Math.min(page, totalPages);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPage(1);
  }, [activeTab]);

  return (
    <div className="space-y-2.5">
      <div
        key={activeTab}
        className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,18.5rem),1fr))] gap-3 stagger-children"
      >
        {isLoading ? (
          <SkeletonList count={3} className="col-span-full" />
        ) : activeTab === 'READY' ? (
          readyVisits.length === 0 ? (
            <Empty>No vehicles</Empty>
          ) : (
            paginate(readyVisits, currentPage).map((v) => {
              const isSelected = v.id === selectedReadyVisitId;
              return (
                <div
                  role="button"
                  tabIndex={0}
                  onKeyDown={onActivateKey}
                  key={v.id}
                  onClick={() => onSelectReady(v.id)}
                  className={cardClass(isSelected)}
                >
                  <div className="flex items-start justify-between gap-2 min-w-0">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0">
                      <span className="font-mono tabular-nums font-semibold text-sm whitespace-nowrap">
                        {v.vehicle_number}
                      </span>
                      {v.token_number && (
                        <span className="font-mono tabular-nums text-xs text-muted-foreground whitespace-nowrap">
                          ({v.token_number})
                        </span>
                      )}
                      {v.is_portion_wise && (
                        <span className="px-2 py-0.5 rounded text-xs font-semibold bg-muted text-foreground border border-border whitespace-nowrap shrink-0">
                          Portion #{v.active_portion_number}
                        </span>
                      )}
                    </div>
                    <span className="text-xs tabular-nums font-semibold inline-flex items-center gap-1 text-muted-foreground whitespace-nowrap shrink-0">
                      <Clock className="w-3 h-3 shrink-0" />
                      <span>{v.waiting_minutes}m</span>
                    </span>
                  </div>

                  <div className={statsClass(isSelected, v.total_accepted_at13_ts_liters !== null || v.total_accepted_physical_liters !== null)}>
                    <div className="min-w-0">
                      <span className="font-sans block text-xs opacity-75">
                        {v.is_portion_wise ? `Portion #${v.active_portion_number} weight` : 'Gross weight'}
                      </span>
                      <span className="block">{v.gross_weight_kg ? `${v.gross_weight_kg.toLocaleString()} kg` : 'N/A'}</span>
                    </div>
                    {(v.total_accepted_at13_ts_liters !== null || v.total_accepted_physical_liters !== null) && (
                      <div className="min-w-0">
                        <span className="font-sans block text-xs opacity-75">
                          {v.total_accepted_at13_ts_liters !== null ? 'Volume (@13 TS)' : 'Expected volume'}
                        </span>
                        <span className="block">
                          {v.total_accepted_at13_ts_liters !== null
                            ? `~${v.total_accepted_at13_ts_liters.toLocaleString()} L @13 TS`
                            : `~${v.total_accepted_physical_liters!.toLocaleString()} L`}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )
        ) : activeTab === 'UNLOADING' ? (
          unloadingVisits.length === 0 ? (
            <Empty>None unloading</Empty>
          ) : (
            paginate(unloadingVisits, currentPage).map((v) => {
              const isSelected = v.id === selectedUnloadingVisitId;
              return (
                <div
                  role="button"
                  tabIndex={0}
                  onKeyDown={onActivateKey}
                  key={v.id}
                  onClick={() => onSelectUnloading(v.id)}
                  className={cardClass(isSelected)}
                >
                  <div className="flex items-start justify-between gap-2 min-w-0">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0">
                      <span className="font-mono tabular-nums font-semibold text-sm whitespace-nowrap">
                        {v.vehicle_number}
                      </span>
                      <span className="px-2 py-0.5 rounded text-xs font-semibold tabular-nums bg-muted text-foreground border border-border whitespace-nowrap shrink-0">
                        {v.is_portion_wise ? `Portion #${v.active_portion_number} unloading` : 'Unloading'}
                      </span>
                    </div>
                    <span className="text-xs tabular-nums font-semibold inline-flex items-center gap-1 text-muted-foreground whitespace-nowrap shrink-0">
                      <Clock className="w-3 h-3 shrink-0" />
                      <span>{v.elapsed_minutes}m</span>
                    </span>
                  </div>

                  <div className={statsClass(isSelected, v.total_accepted_at13_ts_liters !== null || v.total_accepted_physical_liters !== null)}>
                    {(v.total_accepted_at13_ts_liters !== null || v.total_accepted_physical_liters !== null) && (
                      <div className="min-w-0">
                        <span className="font-sans block text-xs opacity-75">
                          {v.total_accepted_at13_ts_liters !== null ? 'Volume (@13 TS)' : 'Unloading volume'}
                        </span>
                        <span className="block">
                          {v.total_accepted_at13_ts_liters !== null
                            ? `~${v.total_accepted_at13_ts_liters.toLocaleString()} L @13 TS`
                            : `~${v.total_accepted_physical_liters!.toLocaleString()} L`}
                        </span>
                      </div>
                    )}
                    <div className="min-w-0">
                      <span className="font-sans block text-xs opacity-75">Started by</span>
                      <span className="block min-w-0">{v.started_by_name}</span>
                    </div>
                  </div>
                </div>
              );
            })
          )
        ) : silos.length === 0 ? (
          <Empty>No silos</Empty>
        ) : (
          paginate(silos, currentPage).map((silo) => {
            const isSelected = silo.id === selectedIssueSiloId;
            return (
              <div
                role="button"
                tabIndex={0}
                onKeyDown={onActivateKey}
                key={silo.id}
                onClick={() => onSelectSilo(silo.id)}
                className={cardClass(isSelected)}
              >
                <div className="flex items-start justify-between gap-2 min-w-0">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0">
                    <span className="tabular-nums font-semibold text-sm whitespace-nowrap">{silo.silo_code}</span>
                    <span className="text-xs font-semibold text-secondary-foreground min-w-0">({silo.silo_name})</span>
                  </div>
                  <span
                    className={`px-2 py-0.5 rounded text-xs font-semibold tabular-nums whitespace-nowrap shrink-0 ${
                      silo.is_active
                        ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                        : 'bg-amber-100 text-amber-800 border border-amber-300'
                    }`}
                  >
                    {silo.is_active ? 'Active' : 'Inactive'}
                  </span>
                </div>

                <div className={statsClass(isSelected)}>
                  <div className="min-w-0">
                    <span className="font-sans block text-xs opacity-75">{silo.current_stock_at_13ts != null ? 'Stock (@13 TS)' : silo.current_stock_liters != null ? 'Physical stock' : 'State'}</span>
                    <span className="text-sm font-semibold block">
                      {silo.current_stock_at_13ts != null
                        ? `${silo.current_stock_at_13ts.toLocaleString()} L`
                        : silo.current_stock_liters != null
                        ? `${silo.current_stock_liters.toLocaleString()} L`
                        : 'Operational'}
                    </span>
                  </div>
                  <div className="min-w-0">
                    <span className="font-sans block text-xs opacity-75">Capacity</span>
                    <span className="block">{silo.capacity_liters != null ? `${silo.capacity_liters.toLocaleString()} L` : 'Allocated bay'}</span>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
      <Pager page={currentPage} totalPages={totalPages} total={total} onPageChange={setPage} />
    </div>
  );
};
