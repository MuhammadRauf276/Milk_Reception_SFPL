'use client';

import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchJson } from '@/lib/query/fetchJson';
import { useSearchParams, useRouter } from 'next/navigation';
import { MilkProcessLog, User } from '@backend/core/types';
import { Header } from '@modules/shared/Header';
import { HierarchicalNavDrawer } from '@modules/shared/navigation/HierarchicalNavDrawer';
import { ZMCCManagerOverview } from './zmcc/ZMCCManagerOverview';
import { ZMCCManagerVisitDetailModal } from './zmcc/ZMCCManagerVisitDetailModal';
import { ZMCCSubordinateHierarchyScreen } from './zmcc/ZMCCSubordinateHierarchyScreen';
import { ZMCCOperationalJourneysScreen } from './zmcc/ZMCCOperationalJourneysScreen';
import { ZMCCPlantTransitHub } from './zmcc/ZMCCPlantTransitHub';
import { ZMCCComprehensiveReportsScreen } from './zmcc/ZMCCComprehensiveReportsScreen';
import { ZMCCDynamicBIAnalyticsScreen } from './zmcc/ZMCCDynamicBIAnalyticsScreen';
import { DynamicReportGeneratorScreen } from './reports/DynamicReportGeneratorScreen';
import {
  ZMCCManagerTab,
  OverviewDateRange,
} from './zmcc/zmccManagerTypes';
import { getOverviewDateRangeBounds } from './zmcc/zmccManagerHelpers';
import { getPakistanCalendarDate } from '@backend/core/business-day';
import type { RetrievalMode } from '@backend/services/operationalReadModelService';
import { ZmccMasterDataWorkspace, type MasterDataTab } from '@/frontend/modules/zmcc/ZmccMasterDataWorkspace';
import { ApprovalInbox } from '@/frontend/modules/approvals/ApprovalInbox';
import { AnimatePresence } from 'framer-motion';
import { PageTransition } from '@/components/motion/page-transition';
import { getErrorMessage } from '@/lib/errors';

interface ZMCCManagerWorkspaceProps {
  currentUser: User | null;
}

const MANAGER_TABS: readonly ZMCCManagerTab[] = [
  'OVERVIEW',
  'HIERARCHY',
  'MOT_JOURNEYS',
  'PLANT_TRANSIT',
  'REPORTS',
  'LIVE',
  'RECONCILIATION',
  'HISTORY',
  'MASTER_DATA',
  'APPROVALS',
];

function parseManagerTab(raw: string | null | undefined): ZMCCManagerTab | null {
  if (raw?.toUpperCase() === 'ANALYTICS') return 'REPORTS';
  const value = raw?.toUpperCase();
  return MANAGER_TABS.find((tab) => tab === value) ?? null;
}

export const ZMCCManagerWorkspace: React.FC<ZMCCManagerWorkspaceProps> = ({
  currentUser,
}) => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlView = searchParams?.get('view')?.toUpperCase();
  const initialMode = searchParams?.get('mode')?.toUpperCase() === 'LEDGERS' || urlView ? 'LEDGERS' : 'STUDIO';
  const [reportSubMode, setReportSubMode] = useState<'STUDIO' | 'LEDGERS'>(initialMode);

  useEffect(() => {
    setReportSubMode(initialMode);
  }, [initialMode]);
  const urlTab =
    parseManagerTab(searchParams?.get('tab')) ??
    (urlView === 'MOT_EXCEPTIONS' || urlView === 'LAB_EXCEPTIONS' || urlView === 'DISPATCH_REQUESTS'
      ? 'APPROVALS'
      : null);

  const [activeTab, setActiveTab] = useState<ZMCCManagerTab>(urlTab ?? 'OVERVIEW');
  const [syncedUrl, setSyncedUrl] = useState({ tab: urlTab });

  if (urlTab !== syncedUrl.tab) {
    setSyncedUrl({ tab: urlTab });
    if (urlTab) setActiveTab(urlTab);
  }

  const [summaryDateRange, setSummaryDateRange] = useState<OverviewDateRange>('TODAY');
  const [isDrawerOpen, setIsDrawerOpen] = useState<boolean>(false);
  const hamburgerButtonRef = useRef<HTMLButtonElement | null>(null);

  const [reportingPage, setReportingPage] = useState<number>(1);
  const initialOverviewBounds = useMemo(() => getOverviewDateRangeBounds('TODAY'), []);
  const [fromDate, setFromDate] = useState<string>(initialOverviewBounds.fromDate);
  const [toDate, setToDate] = useState<string>(initialOverviewBounds.toDate);
  const [selectedLog, setSelectedLog] = useState<MilkProcessLog | null>(null);

  const assignedSourceName =
    currentUser?.procurement_source?.name ||
    currentUser?.zone ||
    'Assigned ZMCC Source';

  const openDrawer = useCallback(() => {
    setIsDrawerOpen(true);
  }, []);

  const closeDrawer = useCallback(() => {
    setIsDrawerOpen(false);
    setTimeout(() => {
      hamburgerButtonRef.current?.focus();
    }, 0);
  }, []);

  const { sectionTitle, subpageTitle } = useMemo(() => {
    if (activeTab === 'OVERVIEW') return { sectionTitle: 'Overview', subpageTitle: null };
    if (activeTab === 'HIERARCHY') return { sectionTitle: 'Hierarchy & Routes', subpageTitle: null };
    if (activeTab === 'MOT_JOURNEYS') {
      const motTitle =
        urlView === 'DISPATCH'
          ? 'Assign & Dispatch'
          : urlView === 'HISTORY'
          ? 'Journey History & Audit'
          : 'Fleet Radar';
      return { sectionTitle: 'MOT Fleet Journeys', subpageTitle: motTitle };
    }
    if (activeTab === 'PLANT_TRANSIT' || activeTab === 'LIVE' || activeTab === 'RECONCILIATION') {
      return { sectionTitle: 'Plant Dispatches', subpageTitle: null };
    }
    if (activeTab === 'REPORTS' || activeTab === 'HISTORY') {
      const hTitle =
        urlView === 'HC_SUPPLIERS'
          ? 'HC Suppliers Ledger'
          : urlView === 'TANK_STORAGE'
          ? 'Tank Storage & Chilling Log'
          : urlView === 'QUALITY_REJECTIONS'
          ? 'Quality & Rejections'
          : 'Route Collections Ledger';
      return { sectionTitle: 'Reports & Ledgers', subpageTitle: hTitle };
    }
    if (activeTab === 'MASTER_DATA') {
      const rawView = searchParams?.get('view')?.toUpperCase();
      const mTitle =
        rawView === 'ROUTES'
          ? 'Routes'
          : rawView === 'AREAS'
          ? 'Areas'
          : rawView === 'MILK_SOURCES'
          ? 'Milk Sources'
          : rawView === 'SHOPS'
          ? 'Shops'
          : rawView === 'TANKS'
          ? 'Tanks'
          : 'HC Suppliers';
      return { sectionTitle: 'Master Data', subpageTitle: mTitle };
    }
    if (activeTab === 'APPROVALS') {
      return { sectionTitle: 'Approval Inbox', subpageTitle: null };
    }
    return { sectionTitle: 'Overview', subpageTitle: null };
  }, [activeTab, urlView, searchParams]);

  type LogsResponse = {
    items?: MilkProcessLog[];
    logs?: MilkProcessLog[];
    pagination?: {
      page?: number;
      totalPages?: number;
      total_pages?: number;
      totalRecords?: number;
      total_count?: number;
      hasMore?: boolean;
      has_more?: boolean;
    };
    summary?: { totalVisits: number; completedVisits: number; activeInPlantVisits: number };
    serverBusinessDate?: string;
    serverCalendarDate?: string;
  };

  const queryClient = useQueryClient();
  const facilityId = currentUser?.procurement_source_id
    ? String(currentUser.procurement_source_id)
    : (searchParams?.get('zmccId') || 'active');

  const needsLiveLogs =
    activeTab === 'PLANT_TRANSIT' ||
    activeTab === 'LIVE' ||
    activeTab === 'OVERVIEW';
  const needsReportingLogs =
    activeTab === 'OVERVIEW' ||
    activeTab === 'PLANT_TRANSIT' ||
    activeTab === 'RECONCILIATION' ||
    activeTab === 'HISTORY';
  const needsOverviewStats = activeTab === 'OVERVIEW';

  // Live dispatches flow
  const liveQuery = useQuery({
    queryKey: ['zmcc-manager', facilityId, 'live-logs'],
    queryFn: ({ signal }) => fetchJson<LogsResponse>('/api/logs?mode=live', { signal }),
    enabled: needsLiveLogs,
    refetchInterval: needsLiveLogs ? 30_000 : false,
    refetchIntervalInBackground: false,
  });
  const liveLogs = useMemo(() => liveQuery.data?.items ?? liveQuery.data?.logs ?? [], [liveQuery.data]);
  const liveLoading = liveQuery.isPending;
  const liveError = liveQuery.isError ? getErrorMessage(liveQuery.error) || 'Failed to load live pipeline logs' : null;
  const liveActiveInPlantCount =
    typeof liveQuery.data?.summary?.activeInPlantVisits === 'number'
      ? liveQuery.data.summary.activeInPlantVisits
      : null;
  const fetchLiveLogs = () => queryClient.invalidateQueries({ queryKey: ['zmcc-manager', facilityId, 'live-logs'] });

  // Reporting logs flow
  const reportingQuery = useQuery({
    queryKey: ['zmcc-manager', facilityId, 'report-logs', { fromDate, toDate, page: reportingPage }],
    queryFn: ({ signal }) => {
      const params = new URLSearchParams({ mode: 'report', page: String(reportingPage), pageSize: '20' });
      if (fromDate) params.append('fromDate', fromDate);
      if (toDate) params.append('toDate', toDate);
      return fetchJson<LogsResponse>(`/api/logs?${params.toString()}`, { signal });
    },
    enabled: needsReportingLogs,
    placeholderData: keepPreviousData,
  });
  const reportingData = reportingQuery.data;
  const reportingLogs = useMemo(() => reportingData?.items ?? reportingData?.logs ?? [], [reportingData]);
  const reportingLoading = reportingQuery.isPending;
  const reportingError = reportingQuery.isError
    ? getErrorMessage(reportingQuery.error) || 'Failed to load reporting logs'
    : null;
  const reportingTotalPages = reportingData?.pagination?.totalPages || reportingData?.pagination?.total_pages || 1;
  const reportingTotalRecords = reportingData?.pagination?.totalRecords || reportingData?.pagination?.total_count || 0;
  const reportingHasMore = Boolean(reportingData?.pagination?.hasMore ?? reportingData?.pagination?.has_more);
  const reportingSummary = reportingData?.summary ?? null;
  const serverBusinessDate = reportingData?.serverBusinessDate || liveQuery.data?.serverBusinessDate || '';
  const serverCalendarDate = reportingData?.serverCalendarDate || '';

  const fetchReportingLogs = (_f?: string, _t?: string, targetPage: number = 1, _mode?: RetrievalMode) => {
    if (targetPage === reportingPage)
      return queryClient.invalidateQueries({ queryKey: ['zmcc-manager', facilityId, 'report-logs'] });
    setReportingPage(targetPage);
    return Promise.resolve();
  };

  const handleOverviewDateRangeChange = useCallback((range: OverviewDateRange) => {
    setSummaryDateRange(range);
    const bounds = getOverviewDateRangeBounds(range);
    setReportingPage(1);
    setFromDate(bounds.fromDate);
    setToDate(bounds.toDate);
  }, []);

  // Stats query
  const statsQuery = useQuery({
    queryKey: ['zmcc-manager', facilityId, 'local-stats'],
    queryFn: async ({ signal }) => {
      const [tanksData, insideData] = await Promise.all([
        fetchJson<unknown>('/api/zmcc/tanks?active_only=true', { signal }).catch(() => null),
        fetchJson<{ total_count?: number }>('/api/zmcc/arrivals/inside', { signal }).catch(() => null),
      ]);
      let tankStock: number | null = null;
      const td = tanksData as
        | { tanks?: Array<{ current_stock: unknown }>; items?: Array<{ current_stock: unknown }> }
        | Array<{ current_stock: unknown }>
        | null;
      const tanks = Array.isArray(td) ? td : td?.tanks || td?.items;
      if (Array.isArray(tanks) && tanks.length === 1) {
        const stock13Ts = Number((tanks[0] as Record<string, unknown>).current_stock_at_13ts);
        const stock = Number((tanks[0] as Record<string, unknown>).current_stock);
        tankStock = Number.isFinite(stock13Ts)
          ? Number(stock13Ts.toFixed(2))
          : Number.isFinite(stock)
          ? Number(stock.toFixed(2))
          : null;
      }
      return {
        tankStock,
        insideCount: typeof insideData?.total_count === 'number' ? insideData.total_count : null,
      };
    },
    enabled: needsOverviewStats,
    refetchInterval: needsOverviewStats ? 30_000 : false,
    refetchIntervalInBackground: false,
  });
  const zmccTankStock = statsQuery.data?.tankStock ?? null;
  const vehiclesInsideZmccCount = statsQuery.data?.insideCount ?? null;

  // Today's intake
  const todayDate = serverCalendarDate || getPakistanCalendarDate(new Date());
  const intakeQuery = useQuery({
    queryKey: ['zmcc-manager', facilityId, 'accepted-intake', todayDate],
    queryFn: async ({ signal }) => {
      const labData = await fetchJson<{ summary?: { totalGrossLiters?: unknown }; total?: number }>(
        `/api/zmcc/lab/history?date=${todayDate}&decision=ACCEPTED&page=1&pageSize=1`,
        { signal }
      ).catch(() => null);
      const totalGross = labData?.summary?.totalGrossLiters;
      if (typeof totalGross === 'number') return Number(totalGross.toFixed(2));
      if (labData?.total === 0) return 0;
      return null;
    },
    enabled: needsOverviewStats,
    staleTime: 5 * 60_000,
  });
  const todayAcceptedIntakeLiters = intakeQuery.data ?? null;

  const selectedVisitPortions = useMemo(() => {
    if (!selectedLog) return [];
    const pool = [...liveLogs, ...reportingLogs];
    const matching = pool.filter(
      (l) =>
        l.id === selectedLog.id ||
        (l.vehicle_number === selectedLog.vehicle_number && l.dispatch_date === selectedLog.dispatch_date)
    );
    const uniqueMap = new Map<string, MilkProcessLog>();
    for (const m of matching) {
      const key = m.portion_id != null ? String(m.portion_id) : m.portion_number || '1';
      if (!uniqueMap.has(key)) {
        uniqueMap.set(key, m);
      }
    }
    const result = Array.from(uniqueMap.values());
    return result.length > 0 ? result : [selectedLog];
  }, [selectedLog, liveLogs, reportingLogs]);

  return (
    <div className="w-full max-w-full flex flex-col min-h-[100dvh] bg-background text-foreground overflow-x-hidden">
      <Header
        currentUser={currentUser}
        title={subpageTitle ?? sectionTitle}
        sourceName={assignedSourceName}
        showBranding={true}
        onMenuClick={openDrawer}
        isZmccVariant={true}
        menuButtonRef={hamburgerButtonRef}
      />

      <HierarchicalNavDrawer
        currentUser={currentUser}
        isOpen={isDrawerOpen}
        onClose={closeDrawer}
        triggerButtonRef={hamburgerButtonRef}
      />

      <main className="flex-1 p-3 sm:p-6 overflow-y-auto space-y-5 sm:space-y-6 w-full max-w-full">
        <PageTransition>
          {/* 1. OVERVIEW */}
          {activeTab === 'OVERVIEW' && (
            <div id="tabpanel-OVERVIEW" role="tabpanel" aria-labelledby="tab-OVERVIEW" className="space-y-6 animate-panel-in">
              <ZMCCManagerOverview
                logs={reportingLogs}
                serverBusinessDate={serverBusinessDate}
                serverCalendarDate={serverCalendarDate}
                assignedSourceName={assignedSourceName}
                dateRange={summaryDateRange}
                onDateRangeChange={handleOverviewDateRangeChange}
                onInspectDetails={(l) => setSelectedLog(l)}
                onNavigateToTab={(tab) => setActiveTab(tab)}
                currentFromDate={fromDate}
                currentToDate={toDate}
                onDateFilterChange={(f, t) => {
                  setFromDate(f || '');
                  setToDate(t || '');
                }}
                isLoading={reportingLoading}
                error={reportingError}
                onRetry={() => fetchReportingLogs(fromDate, toDate, reportingPage, 'report')}
                pagination={{
                  page: reportingPage,
                  totalPages: reportingTotalPages,
                  totalRecords: reportingTotalRecords,
                  hasMore: reportingHasMore,
                }}
                summary={reportingSummary || undefined}
                liveActiveInPlantCount={liveActiveInPlantCount}
                zmccTankStock={zmccTankStock}
                todayAcceptedIntakeLiters={todayAcceptedIntakeLiters}
                vehiclesInsideZmccCount={vehiclesInsideZmccCount}
              />
            </div>
          )}

          {/* 2. SUBORDINATE HIERARCHY */}
          {activeTab === 'HIERARCHY' && (
            <div id="tabpanel-HIERARCHY" role="tabpanel" aria-labelledby="tab-HIERARCHY" className="space-y-6 animate-panel-in">
              <ZMCCSubordinateHierarchyScreen currentUser={currentUser} />
            </div>
          )}

          {/* 3. MOT JOURNEYS & RADAR */}
          {activeTab === 'MOT_JOURNEYS' && (
            <div id="tabpanel-MOT_JOURNEYS" role="tabpanel" aria-labelledby="tab-MOT_JOURNEYS" className="space-y-6 animate-panel-in">
              <ZMCCOperationalJourneysScreen currentUser={currentUser} />
            </div>
          )}

          {/* 4. CONSOLIDATED PLANT TRANSIT (Replaces repetitive LIVE, RECONCILIATION, and PLANT_HISTORY) */}
          {(activeTab === 'PLANT_TRANSIT' ||
            activeTab === 'LIVE' ||
            activeTab === 'RECONCILIATION' ||
            (activeTab === 'HISTORY' && urlView !== 'QUALITY_REJECTIONS')) && (
            <div id="tabpanel-PLANT_TRANSIT" role="tabpanel" aria-labelledby="tab-PLANT_TRANSIT" className="space-y-6 animate-panel-in">
              <ZMCCPlantTransitHub
                logs={reportingLogs}
                liveLogs={liveLogs}
                assignedSourceName={assignedSourceName}
                onInspectDetails={(l) => setSelectedLog(l)}
                isLoading={reportingLoading}
                error={reportingError}
                onRetry={() => fetchReportingLogs(fromDate, toDate, reportingPage, 'report')}
                liveLoading={liveLoading}
                liveError={liveError}
                onRetryLive={fetchLiveLogs}
                fromDate={fromDate}
                toDate={toDate}
                onDateFilterChange={(f, t) => {
                  setFromDate(f || '');
                  setToDate(t || '');
                }}
                pagination={{
                  page: reportingPage,
                  totalPages: reportingTotalPages,
                  totalRecords: reportingTotalRecords,
                  hasMore: reportingHasMore,
                }}
              />
            </div>
          )}

          {/* 5. OPERATIONAL REPORTS & LEDGERS */}
          {(activeTab === 'REPORTS' || (activeTab === 'HISTORY' && urlView === 'QUALITY_REJECTIONS')) && (
            <div id="tabpanel-REPORTS" role="tabpanel" aria-labelledby="tab-REPORTS" className="space-y-6 animate-panel-in">
              {/* Studio vs Ledgers Mode Switcher */}
              <div className="flex items-center justify-between border-b border-border pb-3">
                <div className="flex items-center gap-1.5 bg-muted/60 p-1 rounded-xl">
                  <button
                    type="button"
                    onClick={() => {
                      setReportSubMode('STUDIO');
                      const params = new URLSearchParams(searchParams?.toString() || '');
                      params.set('tab', 'REPORTS');
                      params.set('mode', 'STUDIO');
                      params.delete('view');
                      router.replace(`/mpd/zmcc-manager?${params.toString()}`);
                    }}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      reportSubMode === 'STUDIO'
                        ? 'bg-background text-foreground shadow-2xs font-semibold'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    Report Studio
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setReportSubMode('LEDGERS');
                      const params = new URLSearchParams(searchParams?.toString() || '');
                      params.set('tab', 'REPORTS');
                      params.set('view', 'ROUTE_COLLECTIONS');
                      params.delete('mode');
                      router.replace(`/mpd/zmcc-manager?${params.toString()}`);
                    }}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      reportSubMode === 'LEDGERS'
                        ? 'bg-background text-foreground shadow-2xs font-semibold'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    Operational Ledgers
                  </button>
                </div>
              </div>

              {reportSubMode === 'STUDIO' ? (
                <DynamicReportGeneratorScreen currentUser={currentUser} />
              ) : (
                <ZMCCComprehensiveReportsScreen
                  currentUser={currentUser}
                  initialView={urlView}
                />
              )}
            </div>
          )}



          {/* 7. MASTER DATA */}
          {activeTab === 'MASTER_DATA' && (
            <div id="tabpanel-MASTER_DATA" role="tabpanel" aria-labelledby="tab-MASTER_DATA" className="space-y-6 animate-panel-in">
              <ZmccMasterDataWorkspace
                currentUser={currentUser}
                activeTab={
                  (searchParams?.get('view')?.toUpperCase() as MasterDataTab | undefined) || undefined
                }
                onTabChange={(tab) => {
                  const params = new URLSearchParams(searchParams?.toString() || '');
                  params.set('tab', 'MASTER_DATA');
                  params.set('view', tab);
                  router.replace(`/mpd/zmcc-manager?${params.toString()}`);
                }}
              />
            </div>
          )}

          {/* 8. APPROVALS */}
          {activeTab === 'APPROVALS' && (
            <div id="tabpanel-APPROVALS" role="tabpanel" aria-labelledby="tab-APPROVALS" className="space-y-6 animate-panel-in">
              <ApprovalInbox
                currentUser={currentUser}
                initialStage="ALL"
              />
            </div>
          )}

          <AnimatePresence>
            {selectedLog && (
              <ZMCCManagerVisitDetailModal
                key="visit-detail"
                isOpen={!!selectedLog}
                log={selectedLog}
                portions={selectedVisitPortions}
                onClose={() => setSelectedLog(null)}
                assignedSourceName={assignedSourceName}
              />
            )}
          </AnimatePresence>
        </PageTransition>
      </main>
    </div>
  );
};
