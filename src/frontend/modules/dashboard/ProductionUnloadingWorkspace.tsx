'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchJson } from '@/lib/query/fetchJson';
import { useDebouncedValue } from '@/lib/query/useDebouncedValue';
import { stationQueryKeys } from '@/lib/query/stationQueryKeys';
import { Search, Truck, ArrowDownCircle, Database, CheckCircle2 } from 'lucide-react';
import { SegmentedTabs } from '@/components/ui/segmented-tabs';
import { InfoTip } from '@/components/ui/info-tip';
import { User } from '@core/types';
import { PageHeader } from '@/components/ui/page-header';
import type { ProductionTab, ReadyVisitDef, SiloOption, UnloadingVisitDef } from './productionTypes';
import { ProductionQueueList } from './ProductionQueueList';
import { ProductionStartUnloadingDrawer } from './ProductionStartUnloadingDrawer';
import { ProductionCompleteUnloadingDrawer } from './ProductionCompleteUnloadingDrawer';
import { ProductionSiloIssueDrawer } from './ProductionSiloIssueDrawer';

export type { ProductionTab };

interface ProductionUnloadingWorkspaceProps {
  currentUser?: User | null;
  activeTab?: ProductionTab;
  onTabChange?: (tab: ProductionTab) => void;
}

export const ProductionUnloadingWorkspace: React.FC<ProductionUnloadingWorkspaceProps> = ({
  currentUser,
  activeTab: controlledTab,
  onTabChange,
}) => {
  const [internalTab, setInternalTab] = useState<ProductionTab>('READY');
  const activeTab = controlledTab !== undefined ? controlledTab : internalTab;

  const setActiveTab = (tab: ProductionTab) => {
    setInternalTab(tab);
    if (onTabChange) onTabChange(tab);
  };
  const [searchQuery, setSearchQuery] = useState('');

  const [selectedReadyVisitId, setSelectedReadyVisitId] = useState<string | null>(null);
  const [selectedUnloadingVisitId, setSelectedUnloadingVisitId] = useState<string | null>(null);
  const [selectedIssueSiloId, setSelectedIssueSiloId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const queryClient = useQueryClient();
  const debouncedSearch = useDebouncedValue(searchQuery);

  const facilityId = currentUser?.procurement_source_id || currentUser?.procurement_source?.id || null;

  const readyQuery = useQuery({
    queryKey: stationQueryKeys.production.queue(facilityId, 'ready', debouncedSearch),
    queryFn: ({ signal }) =>
      fetchJson<{ visits?: ReadyVisitDef[]; silos?: SiloOption[] }>(
        `/api/production/ready-for-unloading?search=${encodeURIComponent(debouncedSearch)}`,
        { signal }
      ),
    placeholderData: keepPreviousData,
    enabled: activeTab === 'READY',
    refetchInterval: activeTab === 'READY' ? 30_000 : false,
    refetchIntervalInBackground: false,
  });
  const unloadingQuery = useQuery({
    queryKey: stationQueryKeys.production.queue(facilityId, 'unloading', debouncedSearch),
    queryFn: ({ signal }) =>
      fetchJson<{ visits?: UnloadingVisitDef[] }>(
        `/api/production/unloading-queue?search=${encodeURIComponent(debouncedSearch)}`,
        { signal }
      ),
    placeholderData: keepPreviousData,
    enabled: activeTab === 'UNLOADING',
    refetchInterval: activeTab === 'UNLOADING' ? 30_000 : false,
    refetchIntervalInBackground: false,
  });
  const readyVisits = useMemo(() => readyQuery.data?.visits ?? [], [readyQuery.data]);
  const activeSilos = useMemo(() => readyQuery.data?.silos ?? [], [readyQuery.data]);
  const unloadingVisits = useMemo(() => unloadingQuery.data?.visits ?? [], [unloadingQuery.data]);
  const isLoading = (activeTab === 'READY' && readyQuery.isPending) || (activeTab === 'UNLOADING' && unloadingQuery.isPending);

  useEffect(() => {
    if (!readyQuery.data) return;
    setSelectedReadyVisitId((prev) =>
      prev && readyVisits.some((v) => v.id === prev) ? prev : readyVisits.length > 0 ? readyVisits[0].id : null
    );
    setSelectedIssueSiloId((prev) => {
      if (prev && activeSilos.some((s) => s.id === prev)) return prev;
      const eligible = (activeSilos ?? []).filter((s) => s.current_stock_liters > 0);
      return eligible.length > 0 ? eligible[0].id : activeSilos.length > 0 ? activeSilos[0].id : null;
    });
  }, [readyQuery.data, readyVisits, activeSilos]);

  useEffect(() => {
    if (!unloadingQuery.data) return;
    setSelectedUnloadingVisitId((prev) =>
      prev && unloadingVisits.some((v) => v.id === prev) ? prev : unloadingVisits.length > 0 ? unloadingVisits[0].id : null
    );
  }, [unloadingQuery.data, unloadingVisits]);

  const refreshBoards = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: stationQueryKeys.production.all(facilityId) });
  }, [queryClient, facilityId]);

  const selectedReadyVisit = readyVisits.find((v) => v.id === selectedReadyVisitId) || null;
  const selectedUnloadingVisit = unloadingVisits.find((v) => v.id === selectedUnloadingVisitId) || null;
  const selectedIssueSilo = activeSilos.find((s) => s.id === selectedIssueSiloId) || null;

  const siloIssueList = (activeSilos ?? []).filter((s) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return s.silo_code.toLowerCase().includes(q) || s.silo_name.toLowerCase().includes(q);
  });

  const closeSheet = () => setSheetOpen(false);
  const select = (setter: (id: string) => void) => (id: string) => {
    setter(id);
    setSheetOpen(true);
  };

  return (
    <div className="w-full max-w-7xl mx-auto space-y-5 text-foreground animate-panel-in">
      <div className="flex items-center justify-between border-b border-border pb-3">
        <div className="flex items-center gap-1.5">
          <h1 className="text-lg font-bold tracking-tight text-foreground">Silo Offloading</h1>
          <InfoTip text="Assign unloading bays, pump raw milk into storage silos, and track real-time tank capacity." />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold tabular-nums px-2.5 py-1 rounded-md bg-muted text-foreground border border-border">
            {activeTab === 'READY' ? `${readyVisits.length} Ready` : activeTab === 'UNLOADING' ? `${unloadingVisits.length} Active` : `${siloIssueList.length} Silos`}
          </span>
        </div>
      </div>

      <div className="lg:hidden">
        <SegmentedTabs
          tabs={[
            {
              value: 'READY',
              label: 'Ready',
              count: readyVisits.length,
              icon: Truck,
            },
            {
              value: 'UNLOADING',
              label: 'Unloading',
              count: unloadingVisits.length,
              icon: ArrowDownCircle,
            },
            {
              value: 'SILO_ISSUE',
              label: 'Silos',
              count: siloIssueList.length,
              icon: Database,
            },
          ]}
          value={activeTab}
          onValueChange={setActiveTab}
          label="Unloading Stations"
        />
      </div>

      {activeTab === 'SILO_ISSUE' ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1">
              <h2 className="text-sm font-semibold text-foreground">Silo Stock</h2>
              <InfoTip text="Select a silo to record physical issues or corrections." />
            </div>
          </div>
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search silo code…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full min-h-[44px] pl-9 pr-3 py-2 text-xs tabular-nums font-semibold rounded-xl border border-input bg-card text-foreground focus:ring-2 focus:ring-ring/30 focus:border-primary"
            />
          </div>
          <ProductionQueueList
            activeTab={activeTab}
            isLoading={isLoading}
            readyVisits={readyVisits}
            unloadingVisits={unloadingVisits}
            silos={siloIssueList}
            selectedReadyVisitId={selectedReadyVisitId}
            selectedUnloadingVisitId={selectedUnloadingVisitId}
            selectedIssueSiloId={selectedIssueSiloId}
            onSelectReady={select(setSelectedReadyVisitId)}
            onSelectUnloading={select(setSelectedUnloadingVisitId)}
            onSelectSilo={select(setSelectedIssueSiloId)}
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* Left Column: Tanker Queue */}
          <div className="lg:col-span-7 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1">
                <h2 className="text-sm font-semibold text-foreground">
                  {activeTab === 'READY' ? 'Ready Queue' : 'Unloading Queue'}
                </h2>
                <InfoTip text={activeTab === 'READY' ? 'Vehicles cleared by QA and Gross Scale awaiting bay allocation.' : 'Active tankers transferring milk into plant silos.'} />
              </div>
              <span className="text-xs tabular-nums font-semibold text-muted-foreground">
                {activeTab === 'READY' ? `${readyVisits.length} waiting` : `${unloadingVisits.length} active`}
              </span>
            </div>

            <div className="relative w-full">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search vehicle or token…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full min-h-[44px] pl-9 pr-3 py-2 text-xs tabular-nums font-semibold rounded-xl border border-input bg-card text-foreground focus:ring-2 focus:ring-ring/30 focus:border-primary"
              />
            </div>

            <ProductionQueueList
              activeTab={activeTab}
              isLoading={isLoading}
              readyVisits={readyVisits}
              unloadingVisits={unloadingVisits}
              silos={siloIssueList}
              selectedReadyVisitId={selectedReadyVisitId}
              selectedUnloadingVisitId={selectedUnloadingVisitId}
              selectedIssueSiloId={selectedIssueSiloId}
              onSelectReady={select(setSelectedReadyVisitId)}
              onSelectUnloading={select(setSelectedUnloadingVisitId)}
              onSelectSilo={select(setSelectedIssueSiloId)}
            />
          </div>

          {/* Right Column: Plant Silos Level Overview */}
          <div className="lg:col-span-5 p-4 rounded-xl border border-border bg-card space-y-3 shadow-2xs">
            <div className="flex items-center justify-between pb-2 border-b border-border">
              <div className="flex items-center gap-1.5">
                <Database className="w-4 h-4 text-primary" />
                <h2 className="text-sm font-semibold text-foreground">Plant Silos</h2>
                <InfoTip text="Live storage levels across all plant raw milk silos." />
              </div>
              <span className="text-xs font-semibold tabular-nums text-muted-foreground">
                {activeSilos.length} Silos
              </span>
            </div>

            {activeSilos.length === 0 ? (
              <p className="text-xs text-muted-foreground p-4 text-center">No silos found.</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-2.5">
                {activeSilos.slice(0, 6).map((silo) => {
                  const cap = silo.capacity_liters || 200000;
                  const stock = silo.current_stock_liters || 0;
                  const pct = Math.min(100, Math.round((stock / cap) * 100));

                  return (
                    <div
                      key={`sidebar-silo-${silo.id}`}
                      className="p-2.5 rounded-lg border border-border bg-muted/30 hover:bg-muted/60 transition space-y-1.5"
                    >
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-bold tabular-nums text-foreground">{silo.silo_code}</span>
                        <span className="tabular-nums font-semibold text-xs text-foreground">
                          {stock.toLocaleString()} L <span className="text-muted-foreground font-normal text-[10px]">({pct}%)</span>
                        </span>
                      </div>
                      <div className="w-full h-1.5 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full bg-primary rounded-full transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {sheetOpen && activeTab === 'READY' && selectedReadyVisit && (
        <ProductionStartUnloadingDrawer
          key={selectedReadyVisit.id}
          visit={selectedReadyVisit}
          silos={activeSilos}
          onClose={closeSheet}
          onStarted={() => {
            closeSheet();
            refreshBoards();
            setActiveTab('UNLOADING');
          }}
        />
      )}
      {sheetOpen && activeTab === 'UNLOADING' && selectedUnloadingVisit && (
        <ProductionCompleteUnloadingDrawer
          key={selectedUnloadingVisit.id}
          visit={selectedUnloadingVisit}
          onClose={closeSheet}
          onCompleted={() => {
            closeSheet();
            refreshBoards();
            setActiveTab('READY');
          }}
        />
      )}
      {sheetOpen && activeTab === 'SILO_ISSUE' && selectedIssueSilo && (
        <ProductionSiloIssueDrawer
          key={selectedIssueSilo.id}
          silo={selectedIssueSilo}
          onClose={closeSheet}
          onRecorded={() => {
            closeSheet();
            refreshBoards();
          }}
        />
      )}
    </div>
  );
};
