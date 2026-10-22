'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchJson } from '@/lib/query/fetchJson';
import { useDebouncedValue } from '@/lib/query/useDebouncedValue';
import { Search, Truck, ArrowDownCircle, Database } from 'lucide-react';
import { SegmentedTabs, type SegmentedTab } from '@/components/ui/segmented-tabs';
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
  // The action sheet for the selected row; opened by tapping a queue card.
  const [sheetOpen, setSheetOpen] = useState(false);

  const queryClient = useQueryClient();
  const debouncedSearch = useDebouncedValue(searchQuery);

  // Live boards: 30s refresh, paused while the tab is hidden.
  const readyQuery = useQuery({
    queryKey: ['production', 'ready-for-unloading', debouncedSearch],
    queryFn: ({ signal }) =>
      fetchJson<{ visits?: ReadyVisitDef[]; silos?: SiloOption[] }>(
        `/api/production/ready-for-unloading?search=${encodeURIComponent(debouncedSearch)}`,
        { signal }
      ),
    placeholderData: keepPreviousData,
    refetchInterval: 30_000,
  });
  const unloadingQuery = useQuery({
    queryKey: ['production', 'unloading-queue', debouncedSearch],
    queryFn: ({ signal }) =>
      fetchJson<{ visits?: UnloadingVisitDef[] }>(
        `/api/production/unloading-queue?search=${encodeURIComponent(debouncedSearch)}`,
        { signal }
      ),
    placeholderData: keepPreviousData,
    refetchInterval: 30_000,
  });
  const readyVisits = useMemo(() => readyQuery.data?.visits ?? [], [readyQuery.data]);
  const activeSilos = useMemo(() => readyQuery.data?.silos ?? [], [readyQuery.data]);
  const unloadingVisits = useMemo(() => unloadingQuery.data?.visits ?? [], [unloadingQuery.data]);
  const isLoading = readyQuery.isPending;

  // Auto-selection repair for Ready queue and Silo Issue queue
  useEffect(() => {
    if (!readyQuery.data) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelectedUnloadingVisitId((prev) =>
      prev && unloadingVisits.some((v) => v.id === prev) ? prev : unloadingVisits.length > 0 ? unloadingVisits[0].id : null
    );
  }, [unloadingQuery.data, unloadingVisits]);

  const refreshBoards = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['production', 'ready-for-unloading'] });
    queryClient.invalidateQueries({ queryKey: ['production', 'unloading-queue'] });
  }, [queryClient]);

  const selectedReadyVisit = readyVisits.find((v) => v.id === selectedReadyVisitId) || null;
  const selectedUnloadingVisit = unloadingVisits.find((v) => v.id === selectedUnloadingVisitId) || null;
  const selectedIssueSilo = activeSilos.find((s) => s.id === selectedIssueSiloId) || null;

  // Filtered Silo list for Issue tab
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
    <div className="w-full max-w-7xl mx-auto space-y-6 text-foreground">
      <PageHeader
        title={
          activeTab === 'READY'
            ? 'Production · Ready for Unloading'
            : activeTab === 'UNLOADING'
            ? 'Production · Active Unloading'
            : 'Production · Silos & Stock Issue'
        }
        description={
          activeTab === 'READY'
            ? 'Assign unloading bays and record silo receipts for vehicles arriving from weighbridge.'
            : activeTab === 'UNLOADING'
            ? 'Monitor in-progress tanker offloading and confirm completion before tare weighing.'
            : 'Inspect active plant silos, view stock levels, and log issues.'
        }
      />

      <SegmentedTabs
        tabs={[
          {
            value: 'READY',
            label: 'Ready to Unload',
            count: readyVisits.length,
            icon: Truck,
          },
          {
            value: 'UNLOADING',
            label: 'In Unloading',
            count: unloadingVisits.length,
            icon: ArrowDownCircle,
          },
          {
            value: 'SILO_ISSUE',
            label: 'Silos / Stock',
            count: siloIssueList.length,
            icon: Database,
          },
        ]}
        value={activeTab}
        onValueChange={setActiveTab}
        label="Production Unloading Stations"
      />

      <div className="space-y-3">
        <div className="flex items-center justify-between px-1">
          <h3 className="text-sm font-semibold text-foreground">
            {activeTab === 'READY' ? 'Ready Queue' : activeTab === 'UNLOADING' ? 'In Unloading Queue' : 'Active Silos'}
          </h3>
          <span className="text-xs tabular-nums font-semibold text-slate-500">
            {activeTab === 'READY' ? `${readyVisits.length} ready` : activeTab === 'UNLOADING' ? `${unloadingVisits.length} unloading` : `${siloIssueList.length} silos`}
          </span>
        </div>

        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder={activeTab === 'SILO_ISSUE' ? 'Search silo code or name…' : 'Search vehicle or token…'}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full min-h-[44px] pl-9 pr-3 py-2 text-xs tabular-nums font-semibold rounded-xl border border-input bg-card text-foreground focus:outline-hidden focus:ring-2 focus:ring-ring/30 focus:border-primary"
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
          onRecorded={refreshBoards}
        />
      )}
    </div>
  );
};
