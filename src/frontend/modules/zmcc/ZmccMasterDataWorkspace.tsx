'use client';

import React, { useState, useMemo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { keepPreviousData, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchJson } from '@/lib/query/fetchJson';
import { stationQueryKeys } from '@/lib/query/stationQueryKeys';
import { Combobox } from '@/components/ui/combobox';
import { useDebouncedValue } from '@/frontend/modules/super-admin/shared/useDebouncedValue';
import { User } from '@core/types';
import {
  MapPin,
  Route as RouteIcon,
  Store,
  Milk,
  Building2,
  Search,
  Plus,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Users,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react';
import { SegmentedTabs } from '@/components/ui/segmented-tabs';
import { fadeSlide } from '@/components/motion/presets';
import { getErrorMessage } from '@/lib/errors';
import { PendingApprovalsPanel } from './approvals/PendingApprovalsPanel';
import { canCreateRoute, isFieldStationRole } from './stage1Capabilities';
import {
  fetchMasterData,
  type AreaItem,
  type ChillerOwnershipItem,
  type MasterDataFilters,
  type MasterDataResult,
  type MasterDataTab,
  type RouteItem,
  type ZmccSource,
  type TankItem,
} from './master/masterTypes';
import { useMasterRecordForm } from './master/useMasterRecordForm';
import { MasterTables } from './master/MasterTables';
import { MasterRecordDrawer } from './master/MasterRecordDrawer';
import { ZmccTankIntakeDrawer } from '@/frontend/modules/super-admin/zmcc-tanks/ZmccTankIntakeDrawer';
import { ZmccTankLedgerDrawer } from '@/frontend/modules/super-admin/zmcc-tanks/ZmccTankLedgerDrawer';
import { ZmccPager } from './shared/ZmccDrawer';

export type { MasterDataTab };

interface ZmccMasterDataWorkspaceProps {
  currentUser: User | null;
  initialTab?: MasterDataTab;
  activeTab?: MasterDataTab;
  onTabChange?: (tab: MasterDataTab) => void;
  hideTabBar?: boolean;
}

const ADD_LABEL: Partial<Record<MasterDataTab, string>> = {
  LOCAL_SUPPLIERS: 'Add HC Supplier',
  ROUTES: 'Add Route',
  AREAS: 'Add Area',
  MILK_SOURCES: 'Add Milk Source',
  CHILLER_OWNERSHIP: 'Add Chiller Ownership',
  SHOPS: 'Add Shop',
  TANKS: 'Add Tank',
};

export const ZmccMasterDataWorkspace: React.FC<ZmccMasterDataWorkspaceProps> = ({
  currentUser,
  initialTab,
  activeTab: controlledTab,
  onTabChange,
  hideTabBar = false,
}) => {
  const isSuperAdmin = currentUser?.role === 'SUPER_ADMIN';
  const isDataExecutive = currentUser?.role === 'DATA_EXECUTIVE';
  const isZmccManager = currentUser?.role === 'ZMCC_MANAGER';
  // PHE Operator, MDO and other field-station roles get the shop-station view.
  const isFieldStation = isFieldStationRole(currentUser?.role ?? '');
  const canEditMaster = isDataExecutive || isSuperAdmin;
  // Only these roles see ERP codes and can create/edit milk sources; ZMCC staff see names only.
  const isSourceOwner = isDataExecutive || isSuperAdmin || currentUser?.role === 'HEAD_OF_MPD';

  const permittedTabs: { id: MasterDataTab; label: string; icon: LucideIcon }[] = React.useMemo(() => {
    if (isFieldStation) {
      return [
        { id: 'LOCAL_SUPPLIERS', label: 'HC Suppliers', icon: Users },
        { id: 'SHOPS', label: 'Shop Details (Reference)', icon: Store },
        { id: 'APPROVALS', label: 'Pending Approvals', icon: ShieldCheck },
      ];
    }
    const tabs: { id: MasterDataTab; label: string; icon: LucideIcon }[] = [
      { id: 'LOCAL_SUPPLIERS', label: 'HC Suppliers', icon: Users },
      { id: 'ROUTES', label: 'Routes', icon: RouteIcon },
      { id: 'AREAS', label: 'Areas', icon: MapPin },
      { id: 'MILK_SOURCES', label: 'Milk Sources', icon: Milk },
      { id: 'SHOPS', label: 'Shop Details', icon: Store },
    ];
    if (isSuperAdmin || isDataExecutive) {
      tabs.push({ id: 'CHILLER_OWNERSHIP', label: 'Chiller Ownership', icon: Building2 });
    }
    if (isSuperAdmin || isDataExecutive || isZmccManager) {
      tabs.push({ id: 'TANKS', label: 'Tanks', icon: Building2 });
    }
    tabs.push({ id: 'APPROVALS', label: 'Approvals', icon: ShieldCheck });
    return tabs;
  }, [isSuperAdmin, isDataExecutive, isZmccManager, isFieldStation]);

  const [internalTab, setInternalTab] = useState<MasterDataTab>(controlledTab || initialTab || 'LOCAL_SUPPLIERS');
  const activeTab = controlledTab || internalTab;
  const [intakeTank, setIntakeTank] = useState<TankItem | null>(null);
  const [ledgerTank, setLedgerTank] = useState<TankItem | null>(null);

  const setActiveTab = (tab: MasterDataTab) => {
    setInternalTab(tab);
    if (onTabChange) onTabChange(tab);
  };

  // ZMCC Scope
  const queryClient = useQueryClient();
  const sourcesQuery = useQuery({
    queryKey: stationQueryKeys.zmcc.sources(),
    staleTime: 10 * 60_000,
    queryFn: ({ signal }) => fetchJson<{ zmccs?: ZmccSource[] }>('/api/zmcc/sources', { signal }),
  });
  const sources = useMemo(() => sourcesQuery.data?.zmccs ?? [], [sourcesQuery.data]);
  const [pickedZmccId, setSelectedZmccId] = useState<string>('');
  const selectedZmccId = pickedZmccId || sources[0]?.id || '';

  const currentZmccName =
    currentUser?.procurement_source?.name ||
    sources.find((s) => s.id === selectedZmccId)?.name ||
    'Assigned ZMCC';

  // Filtering states
  const [search, setSearch] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'true' | 'false'>('all');
  const [routeFilter, setRouteFilter] = useState<string>('');
  const [areaFilter, setAreaFilter] = useState<string>('');

  const clearFilters = () => {
    setSearch('');
    setStatusFilter('all');
    setRouteFilter('');
    setAreaFilter('');
  };

  // A parent-driven tab change starts the new tab with cleared filters.
  const [previousControlledTab, setPreviousControlledTab] = useState(controlledTab);
  if (controlledTab !== previousControlledTab) {
    setPreviousControlledTab(controlledTab);
    if (controlledTab) {
      setInternalTab(controlledTab);
      clearFilters();
    }
  }

  // Scoped reference data (search is debounced 300ms).
  const debouncedSearch = useDebouncedValue(search, 300);
  const [pageState, setPageState] = useState({ key: '', page: 1 });
  const filterKey = [activeTab, selectedZmccId, statusFilter, debouncedSearch, routeFilter, areaFilter].join('|');
  if (pageState.key !== filterKey) setPageState({ key: filterKey, page: 1 });
  const page = pageState.key === filterKey ? pageState.page : 1;
  const dataFilters = useMemo<MasterDataFilters>(
    () => ({
      zmccId: isSuperAdmin ? selectedZmccId : '',
      status: statusFilter,
      search: debouncedSearch,
      routeId: routeFilter,
      areaId: areaFilter,
      page,
    }),
    [isSuperAdmin, selectedZmccId, statusFilter, debouncedSearch, routeFilter, areaFilter, page]
  );
  const masterQuery = useQuery({
    queryKey: ['zmcc', 'master', activeTab, dataFilters],
    enabled: activeTab !== 'APPROVALS',
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) => fetchMasterData(activeTab, dataFilters, signal),
  });
  const loading = masterQuery.isFetching;
  const masterResult = masterQuery.data;
  const itemsFor = <T extends MasterDataResult['tab']>(tab: T) =>
    (masterResult && masterResult.tab === tab ? masterResult.items : []) as Extract<MasterDataResult, { tab: T }>['items'];
  const errorMsg = masterQuery.error ? getErrorMessage(masterQuery.error) || 'Error loading data.' : null;
  const loadData = () => queryClient.invalidateQueries({ queryKey: ['zmcc', 'master'] });

  const form = useMasterRecordForm({
    activeTab,
    isSuperAdmin,
    selectedZmccId,
    currentZmccName,
    onSaved: () => {
      loadData();
      queryClient.invalidateQueries({ queryKey: ['zmcc', 'helper'] });
    },
  });

  // Dropdown helper data for Shop and Area forms (lazy loaded, active rows only).
  const helperZmccParam = isSuperAdmin && selectedZmccId ? `&zmcc_id=${selectedZmccId}` : '';
  const isDrawerOpen = Boolean(form.modalType);
  const needsRoutes = activeTab === 'SHOPS' || activeTab === 'AREAS' || isDrawerOpen;
  const needsAreas = activeTab === 'SHOPS' || isDrawerOpen;
  const needsChillers = isDrawerOpen;

  const [helperRoutesQ, helperAreasQ, helperChillersQ] = useQueries({
    queries: [
      {
        queryKey: stationQueryKeys.zmcc.helpers.routes(selectedZmccId),
        queryFn: ({ signal }) => fetchJson<{ routes?: RouteItem[] }>(`/api/zmcc/routes?is_active=true${helperZmccParam}`, { signal }),
        enabled: needsRoutes,
        staleTime: 5 * 60_000,
      },
      {
        queryKey: stationQueryKeys.zmcc.helpers.areas(selectedZmccId),
        queryFn: ({ signal }) => fetchJson<{ areas?: AreaItem[] }>(`/api/zmcc/areas?is_active=true${helperZmccParam}`, { signal }),
        enabled: needsAreas,
        staleTime: 5 * 60_000,
      },
      {
        queryKey: stationQueryKeys.zmcc.helpers.chillers(),
        queryFn: ({ signal }) => fetchJson<{ chiller_ownerships?: ChillerOwnershipItem[] }>('/api/zmcc/chiller-ownerships?is_active=true', { signal }),
        enabled: needsChillers,
        staleTime: 10 * 60_000,
      },
    ],
  });
  const helperRoutes = useMemo(() => helperRoutesQ.data?.routes ?? [], [helperRoutesQ.data]);
  const helperAreas = useMemo(() => helperAreasQ.data?.areas ?? [], [helperAreasQ.data]);
  const helperChillers = useMemo(() => helperChillersQ.data?.chiller_ownerships ?? [], [helperChillersQ.data]);

  // When selected ZMCC changes for Super Admin, clear dependent filters
  const handleZmccChange = (zmccId: string) => {
    setSelectedZmccId(zmccId);
    setRouteFilter('');
    setAreaFilter('');
    setSearch('');
  };

  const canAdd =
    (activeTab === 'MILK_SOURCES' ? isSourceOwner : isSuperAdmin || isDataExecutive) ||
    (isZmccManager && activeTab !== 'CHILLER_OWNERSHIP' && activeTab !== 'TANKS' && activeTab !== 'MILK_SOURCES') ||
    (isFieldStation && (activeTab === 'SHOPS' || activeTab === 'LOCAL_SUPPLIERS'));

  const routeOptions = [{ value: '', label: 'All routes' }, ...helperRoutes.map((r) => ({ value: r.id, label: `${r.name} · ${r.route_code}`, keywords: r.route_code }))];

  return (
    <div className="space-y-6 max-w-full overflow-x-hidden">
      {/* Header Banner */}
      <div className="bg-card p-5 rounded-xl border border-border shadow-2xs flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <div>
            <h1 className="text-lg sm:text-xl font-semibold text-foreground">
              {isFieldStation ? (currentUser?.role === 'MDO' ? 'MDO Station' : 'PHE Station') : 'ZMCC master data'}
            </h1>
          </div>
        </div>

        {/* ZMCC Context selector or Fixed Badge */}
        <div className="flex items-center gap-3">
          {isSuperAdmin ? (
            <div className="bg-card border-border flex items-center gap-2 px-3.5 py-2 rounded-xl border">
              <span className="text-xs font-semibold text-slate-600 uppercase tracking-wider">ZMCC</span>
              <Combobox
                options={sources.map((s) => ({ value: s.id, label: `${s.name} · ${s.code}`, keywords: s.code }))}
                value={selectedZmccId}
                onValueChange={handleZmccChange}
                placeholder="Select ZMCC"
                searchPlaceholder="Search ZMCC"
                className="min-h-[44px] w-56 bg-transparent text-xs font-semibold"
              />
            </div>
          ) : (
            <div className="bg-card border-border flex items-center gap-2 px-3.5 py-2 rounded-xl border">
              <span className="text-xs font-semibold text-primary uppercase tracking-wider">ZMCC</span>
              <span className="text-xs font-semibold text-foreground">
                {currentZmccName} ({currentUser?.procurement_source?.code || 'ZMCC'})
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Success/Error Banners */}
      {form.successMsg && (
        <div className="bg-card border-border p-3.5 border rounded-xl text-xs font-semibold text-emerald-800 flex items-center gap-2 animate-panel-in">
          <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
          <span>{form.successMsg}</span>
        </div>
      )}
      {errorMsg && (
        <div className="bg-card border-border p-3.5 border rounded-xl text-xs font-semibold text-rose-800 flex items-center gap-2 animate-panel-in">
          <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Navigation Tabs (Only if more than 1 tab and not hidden; hidden on large screens where sidebar is present) */}
      {!hideTabBar && permittedTabs.length > 1 && (
        <div className="lg:hidden">
          <SegmentedTabs
            label="Master data sections"
            value={activeTab}
            onValueChange={(tab) => {
              setActiveTab(tab);
              clearFilters();
            }}
            tabs={permittedTabs.map((t) => ({ value: t.id, label: t.label, icon: t.icon }))}
          />
        </div>
      )}

      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={activeTab} variants={fadeSlide} initial="initial" animate="animate" exit="exit" className="space-y-6">
          {activeTab === 'APPROVALS' ? (
            <div id="tabpanel-APPROVALS" role="tabpanel" aria-labelledby="tab-APPROVALS" className="space-y-6">
              <PendingApprovalsPanel
                currentUser={currentUser}
                showRoutes={canCreateRoute(currentUser?.role ?? '')}
                showShops={true}
                onRefreshParent={loadData}
              />
            </div>
          ) : (
            <>
              <div className="bg-card p-4 rounded-xl border border-border flex flex-col md:flex-row md:items-center justify-between gap-3 shadow-2xs">
                <div className="flex flex-wrap items-center gap-2.5 flex-1">
                  <div className="relative flex-1 min-w-[200px] max-w-sm">
                    <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Search code or name…"
                      className="w-full pl-9 pr-3 py-2 min-h-[44px] bg-subtle border border-border rounded-xl text-xs font-medium text-foreground placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-primary"
                    />
                  </div>

                  <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value as 'all' | 'true' | 'false')}
                    className="px-3 py-2 min-h-[44px] bg-subtle border border-border rounded-xl text-xs font-semibold text-slate-700 focus:outline-hidden focus:ring-2 focus:ring-primary"
                    aria-label="Filter by Status"
                  >
                    <option value="all">All statuses</option>
                    <option value="true">Active</option>
                    <option value="false">Inactive</option>
                  </select>

                  {activeTab === 'SHOPS' && (
                    <>
                      <Combobox
                        options={routeOptions}
                        value={routeFilter}
                        onValueChange={(v) => {
                          setRouteFilter(v);
                          setAreaFilter('');
                        }}
                        placeholder="All routes"
                        searchPlaceholder="Search route"
                        className="min-h-[44px] w-48 text-xs font-semibold"
                      />
                      <Combobox
                        options={[{ value: '', label: 'All areas' }, ...helperAreas.filter((a) => !routeFilter || a.route_id === routeFilter).map((a) => ({ value: a.id, label: `${a.name} · ${a.area_code}`, keywords: a.area_code }))]}
                        value={areaFilter}
                        onValueChange={setAreaFilter}
                        placeholder="All areas"
                        searchPlaceholder="Search area"
                        className="min-h-[44px] w-48 text-xs font-semibold"
                      />
                    </>
                  )}

                  {activeTab === 'AREAS' && (
                    <Combobox
                      options={routeOptions}
                      value={routeFilter}
                      onValueChange={setRouteFilter}
                      placeholder="All routes"
                      searchPlaceholder="Search route"
                      className="min-h-[44px] w-48 text-xs font-semibold"
                    />
                  )}
                </div>

                <div className="flex items-center gap-2">
                  {activeTab === 'TANKS' && (isSuperAdmin || isDataExecutive) && itemsFor('TANKS').some((t) => t.is_active) && (
                    <button
                      type="button"
                      onClick={() => setIntakeTank(itemsFor('TANKS').find((t) => t.is_active) || null)}
                      className="flex items-center justify-center gap-2 px-4 py-2 min-h-[44px] bg-emerald-700 text-white rounded-xl text-xs font-semibold hover:bg-emerald-800 transition shadow-2xs shrink-0"
                    >
                      <Milk className="w-4 h-4" />
                      <span>Intake Milk Stock</span>
                    </button>
                  )}
                  {canAdd && (
                    <button
                      type="button"
                      onClick={form.openCreate}
                      className="flex items-center justify-center gap-2 px-4 py-2 min-h-[44px] bg-primary text-white rounded-xl text-xs font-semibold hover:bg-primary-hover transition shadow-2xs shrink-0"
                    >
                      <Plus className="w-4 h-4" />
                      <span>{ADD_LABEL[activeTab]}</span>
                    </button>
                  )}
                </div>

              </div>

              <div className="bg-card rounded-xl border border-border shadow-2xs overflow-hidden">
                {loading ? (
                  <div className="p-12 text-center flex flex-col items-center justify-center text-slate-500 space-y-2">
                    <Loader2 className="w-6 h-6 animate-spin text-primary" />
                    <span className="text-xs font-semibold">Loading master data…</span>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <MasterTables
                      activeTab={activeTab}
                      canEdit={canEditMaster}
                      canEditSources={isSourceOwner}
                      canViewSourceErp={isSourceOwner}
                      localSuppliers={itemsFor('LOCAL_SUPPLIERS')}
                      routes={itemsFor('ROUTES')}
                      areas={itemsFor('AREAS')}
                      milkSources={itemsFor('MILK_SOURCES')}
                      chillerOwnerships={itemsFor('CHILLER_OWNERSHIP')}
                      shops={itemsFor('SHOPS')}
                      tanks={itemsFor('TANKS')}
                      onIntakeTank={setIntakeTank}
                      onViewLedger={setLedgerTank}
                      onEdit={form.openEdit}
                      onToggle={form.openToggle}
                    />
                  </div>
                )}
                {masterResult?.pagination && (
                  <ZmccPager
                    page={masterResult.pagination.page}
                    totalPages={masterResult.pagination.total_pages}
                    disabled={loading}
                    onPage={(p) => setPageState({ key: filterKey, page: p })}
                    summary={<> ({masterResult.pagination.total} records)</>}
                  />
                )}
              </div>
            </>
          )}
        </motion.div>
      </AnimatePresence>

      <MasterRecordDrawer
        form={form}
        helperRoutes={helperRoutes}
        helperAreas={helperAreas}
        helperChillers={helperChillers}
      />

      <ZmccTankIntakeDrawer
        tank={intakeTank}
        onClose={() => setIntakeTank(null)}
        onSaved={(msg) => {
          form.setSuccessMsg(msg);
          loadData();
        }}
      />

      <ZmccTankLedgerDrawer
        tank={ledgerTank}
        onClose={() => setLedgerTank(null)}
      />
    </div>
  );
};
