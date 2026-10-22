'use client';

import React, { useEffect, useState } from 'react';
import { Clock, Loader2 } from 'lucide-react';
import { onActivateKey } from '@/lib/a11y';
import { Pager, pageCount, paginate } from './components/Pager';
import type { ProductionTab, ReadyVisitDef, SiloOption, UnloadingVisitDef } from './productionTypes';

const cardClass = (selected: boolean) =>
  `p-4 rounded-xl border transition cursor-pointer space-y-2 min-h-11 ${
    selected
      ? 'bg-primary/4 text-foreground border-primary ring-1 ring-primary shadow-xs'
      : 'bg-card text-foreground border-border hover:border-border-strong hover:bg-subtle'
  }`;

const statsClass = (selected: boolean) =>
  `grid grid-cols-2 gap-2 text-xs p-2.5 rounded-lg tabular-nums font-semibold ${
    selected ? 'bg-blue-900/60 text-slate-100 border border-blue-800' : 'bg-muted text-slate-700 border border-border-strong'
  }`;

const Empty: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="p-8 text-center border border-dashed border-border rounded-xl text-sm text-muted-foreground md:col-span-2 lg:col-span-3">
    {children}
  </div>
);

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
      <div key={activeTab} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5 stagger-children">
        {isLoading ? (
          <div className="p-8 text-center border border-dashed border-border rounded-xl text-sm text-muted-foreground md:col-span-2 lg:col-span-3">
            <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2 text-blue-700" />
            Loading production queue…
          </div>
        ) : activeTab === 'READY' ? (
          readyVisits.length === 0 ? (
            <Empty>No vehicles currently ready for unloading.</Empty>
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
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <span className="tabular-nums font-semibold text-sm">{v.vehicle_number}</span>
                      {v.token_number && (
                        <span className="tabular-nums text-xs font-semibold text-primary">({v.token_number})</span>
                      )}
                      {v.is_portion_wise && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-purple-100 text-purple-800 border border-purple-200">
                          Portion #{v.active_portion_number}
                        </span>
                      )}
                    </div>
                    <span className="text-[10px] tabular-nums font-semibold flex items-center space-x-1 text-slate-500">
                      <Clock className="w-3 h-3" />
                      <span>{v.waiting_minutes}m wait</span>
                    </span>
                  </div>

                  <div className={statsClass(isSelected)}>
                    <div>
                      <span className="font-sans block text-[10px] opacity-75">
                        {v.is_portion_wise ? `Portion #${v.active_portion_number} Weight` : 'Gross Weight'}
                      </span>
                      <span>{v.gross_weight_kg ? `${v.gross_weight_kg.toLocaleString()} kg` : 'N/A'}</span>
                    </div>
                    <div>
                      <span className="font-sans block text-[10px] opacity-75">Expected Volume</span>
                      <span>{v.total_accepted_physical_liters !== null ? `~${v.total_accepted_physical_liters.toLocaleString()} L` : 'N/A'}</span>
                    </div>
                  </div>
                </div>
              );
            })
          )
        ) : activeTab === 'UNLOADING' ? (
          unloadingVisits.length === 0 ? (
            <Empty>No vehicles are currently unloading.</Empty>
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
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <span className="tabular-nums font-semibold text-sm">{v.vehicle_number}</span>
                      <span className="px-2 py-0.5 rounded text-[10px] font-semibold tabular-nums bg-blue-100 text-primary border border-blue-300">
                        {v.is_portion_wise ? `Portion #${v.active_portion_number} Unloading` : 'Unloading Active'}
                      </span>
                    </div>
                    <span className="text-[10px] tabular-nums font-semibold flex items-center space-x-1 text-amber-800">
                      <Clock className="w-3 h-3" />
                      <span>{v.elapsed_minutes}m</span>
                    </span>
                  </div>

                  <div className={statsClass(isSelected)}>
                    <div>
                      <span className="font-sans block text-[10px] opacity-75">Unloading Volume</span>
                      <span>{v.total_accepted_physical_liters !== null ? `~${v.total_accepted_physical_liters.toLocaleString()} L` : 'N/A'}</span>
                    </div>
                    <div>
                      <span className="font-sans block text-[10px] opacity-75">Started By</span>
                      <span className="truncate block">{v.started_by_name}</span>
                    </div>
                  </div>
                </div>
              );
            })
          )
        ) : silos.length === 0 ? (
          <Empty>No silos match query or have stock available.</Empty>
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
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <span className="tabular-nums font-semibold text-sm">{silo.silo_code}</span>
                    <span className="text-xs font-semibold text-slate-700">({silo.silo_name})</span>
                  </div>
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-semibold tabular-nums ${
                      silo.is_active
                        ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                        : 'bg-amber-100 text-amber-800 border border-amber-300'
                    }`}
                  >
                    {silo.is_active ? 'Active' : 'Inactive'}
                  </span>
                </div>

                <div className={statsClass(isSelected)}>
                  <div>
                    <span className="font-sans block text-[10px] opacity-75">Physical Stock</span>
                    <span className="text-sm font-semibold">{silo.current_stock_liters.toLocaleString()} L</span>
                  </div>
                  <div>
                    <span className="font-sans block text-[10px] opacity-75">Capacity</span>
                    <span>{silo.capacity_liters.toLocaleString()} L</span>
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
