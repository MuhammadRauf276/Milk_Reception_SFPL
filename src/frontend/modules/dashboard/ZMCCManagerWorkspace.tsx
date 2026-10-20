'use client';

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { MilkProcessLog, User } from '@backend/core/types';
import { Header } from '@modules/shared/Header';
import { HierarchicalNavDrawer } from '@modules/shared/navigation/HierarchicalNavDrawer';
import { ZMCCManagerOverview } from './zmcc/ZMCCManagerOverview';
import { ZMCCManagerLiveDispatches } from './zmcc/ZMCCManagerLiveDispatches';
import { ZMCCManagerReconciliation } from './zmcc/ZMCCManagerReconciliation';
import { ZMCCManagerHistoryReports } from './zmcc/ZMCCManagerHistoryReports';
import { ZMCCManagerQualityRejections } from './zmcc/ZMCCManagerQualityRejections';
import { ZMCCManagerVisitDetailModal } from './zmcc/ZMCCManagerVisitDetailModal';
import {
  ZMCCManagerTab,
  OverviewDateRange,
} from './zmcc/zmccManagerTypes';
import { getOverviewDateRangeBounds } from './zmcc/zmccManagerHelpers';
import { getPakistanCalendarDate } from '@backend/core/business-day';
import type { RetrievalMode } from '@backend/services/operationalReadModelService';
import { ZmccMasterDataWorkspace, type MasterDataTab } from '@/frontend/modules/zmcc/ZmccMasterDataWorkspace';
import { ZmccArrivalsWorkspace } from '@/frontend/modules/zmcc/arrivals/ZmccArrivalsWorkspace';
import { ZmccLabWorkspace } from '@/frontend/modules/zmcc/lab/ZmccLabWorkspace';
import { ApprovalInbox } from '@/frontend/modules/approvals/ApprovalInbox';
import { AnimatePresence } from 'framer-motion';
import { PageTransition } from '@/components/motion/page-transition';
import { getErrorMessage } from '@/lib/errors';

interface ZMCCManagerWorkspaceProps {
  currentUser: User | null;
}

type ManagerHistoryView =
  | 'PLANT_HISTORY'
  | 'QUALITY_REJECTIONS'
  | 'ARRIVAL_CORRECTIONS'
  | 'LAB_CORRECTIONS';

const MANAGER_TABS: readonly ZMCCManagerTab[] = ['OVERVIEW', 'LIVE', 'RECONCILIATION', 'HISTORY', 'MASTER_DATA', 'APPROVALS'];
const HISTORY_VIEWS: readonly ManagerHistoryView[] = ['PLANT_HISTORY', 'QUALITY_REJECTIONS', 'ARRIVAL_CORRECTIONS', 'LAB_CORRECTIONS'];

function parseManagerTab(raw: string | null | undefined): ZMCCManagerTab | null {
  const value = raw?.toUpperCase();
  return MANAGER_TABS.find((tab) => tab === value) ?? null;
}

function parseHistoryView(raw: string | null | undefined): ManagerHistoryView | null {
  const value = raw?.toUpperCase();
  return HISTORY_VIEWS.find((view) => view === value) ?? null;
}

export const ZMCCManagerWorkspace: React.FC<ZMCCManagerWorkspaceProps> = ({
  currentUser,
}) => {
  const searchParams = useSearchParams();
  // ?tab= and ?view= select the tab/history view; later URL changes win over manual choices.
  const urlView = searchParams?.get('view')?.toUpperCase();
  const urlTab = parseManagerTab(searchParams?.get('tab')) ?? (urlView === 'MOT_EXCEPTIONS' || urlView === 'LAB_EXCEPTIONS' || urlView === 'DISPATCH_REQUESTS' ? 'APPROVALS' : null);
  const urlHistoryView = parseHistoryView(searchParams?.get('view'));
  const [activeTab, setActiveTab] = useState<ZMCCManagerTab>(urlTab ?? 'OVERVIEW');
  const [historyView, setHistoryView] = useState<ManagerHistoryView>(urlHistoryView ?? 'PLANT_HISTORY');
  const [syncedUrl, setSyncedUrl] = useState({ tab: urlTab, view: urlHistoryView });
  if (urlTab !== syncedUrl.tab || urlHistoryView !== syncedUrl.view) {
    setSyncedUrl({ tab: urlTab, view: urlHistoryView });
    if (urlTab) setActiveTab(urlTab);
    if (urlHistoryView) setHistoryView(urlHistoryView);
  }

  const [summaryDateRange, setSummaryDateRange] = useState<OverviewDateRange>('TODAY');
  const [serverBusinessDate, setServerBusinessDate] = useState<string>('');
  const [serverCalendarDate, setServerCalendarDate] = useState<string>('');
  const [isDrawerOpen, setIsDrawerOpen] = useState<boolean>(false);
  const hamburgerButtonRef = useRef<HTMLButtonElement | null>(null);


  // 1. Independent Live State
  const [liveLogs, setLiveLogs] = useState<MilkProcessLog[]>([]);
  const [liveLoading, setLiveLoading] = useState<boolean>(true);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [liveActiveInPlantCount, setLiveActiveInPlantCount] = useState<number | null>(null);

  // 2. Independent Reporting State
  const [reportingLogs, setReportingLogs] = useState<MilkProcessLog[]>([]);
  const [reportingLoading, setReportingLoading] = useState<boolean>(true);
  const [reportingError, setReportingError] = useState<string | null>(null);
  const [reportingPage, setReportingPage] = useState<number>(1);
  const [reportingTotalPages, setReportingTotalPages] = useState<number>(1);
  const [reportingTotalRecords, setReportingTotalRecords] = useState<number>(0);
  const [reportingHasMore, setReportingHasMore] = useState<boolean>(false);
  const [reportingSummary, setReportingSummary] = useState<{
    totalVisits: number;
    completedVisits: number;
    activeInPlantVisits: number;
  } | null>(null);

  // 3. Local ZMCC Operational Snapshot State (Tank stock, Inside yard vehicles, Today accepted intake)
  const [zmccTankStock, setZmccTankStock] = useState<number | null>(null);
  const [vehiclesInsideZmccCount, setVehiclesInsideZmccCount] = useState<number | null>(null);
  const [todayAcceptedIntakeLiters, setTodayAcceptedIntakeLiters] = useState<number | null>(null);

  // History & Table search/filter state (isolated to historical reporting tables)
  const initialOverviewBounds = useMemo(() => getOverviewDateRangeBounds('TODAY'), []);
  const [fromDate, setFromDate] = useState<string>(initialOverviewBounds.fromDate);
  const [toDate, setToDate] = useState<string>(initialOverviewBounds.toDate);
  const [selectedLog, setSelectedLog] = useState<MilkProcessLog | null>(null);

  const assignedSourceName =
    currentUser?.procurement_source?.name ||
    currentUser?.zone ||
    'Assigned ZMCC Source';

  const selectedVisitPortions = useMemo(() => {
    if (!selectedLog) return [];
    const pool = [...liveLogs, ...reportingLogs];
    const matching = pool.filter(
      (l) =>
        l.id === selectedLog.id ||
        (l.vehicle_number === selectedLog.vehicle_number &&
          l.dispatch_date === selectedLog.dispatch_date)
    );
    const uniqueMap = new Map<string, MilkProcessLog>();
    for (const m of matching) {
      const key = m.portion_id != null ? String(m.portion_id) : (m.portion_number || '1');
      if (!uniqueMap.has(key)) {
        uniqueMap.set(key, m);
      }
    }
    const result = Array.from(uniqueMap.values());
    return result.length > 0 ? result : [selectedLog];
  }, [selectedLog, liveLogs, reportingLogs]);

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
    if (activeTab === 'LIVE') return { sectionTitle: 'Operations', subpageTitle: null };
    if (activeTab === 'RECONCILIATION') return { sectionTitle: 'Reconciliation', subpageTitle: null };
    if (activeTab === 'HISTORY') {
      const hTitle =
        historyView === 'ARRIVAL_CORRECTIONS'
          ? 'Arrival Corrections'
          : historyView === 'LAB_CORRECTIONS'
          ? 'Lab Corrections'
          : historyView === 'QUALITY_REJECTIONS'
          ? 'Quality & Rejections Review'
          : 'Plant History';
      return { sectionTitle: 'History & Reports', subpageTitle: hTitle };
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
          : 'Local Suppliers';
      return { sectionTitle: 'Master Data', subpageTitle: mTitle };
    }
    if (activeTab === 'APPROVALS') {
      return { sectionTitle: 'Approval Inbox', subpageTitle: null };
    }
    return { sectionTitle: 'Overview', subpageTitle: null };
  }, [activeTab, historyView, searchParams]);

  // Fetch Live Logs: Mode 'live' active pipeline only
  const loadLiveLogs = useCallback(
    () =>
      fetch('/api/logs?mode=live')
        .then(async (res) => {
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Failed to fetch live logs');

          const items = data.items || data.logs;
          if (items) setLiveLogs(items);

          if (typeof data.summary?.activeInPlantVisits === 'number') {
            setLiveActiveInPlantCount(data.summary.activeInPlantVisits);
          } else {
            setLiveActiveInPlantCount(null);
          }

          if (data.serverBusinessDate) setServerBusinessDate(data.serverBusinessDate);
          setLiveError(null);
        })
        .catch((err) => {
          setLiveActiveInPlantCount(null);
          setLiveError(getErrorMessage(err) || 'Failed to load live pipeline logs');
        })
        .finally(() => {
          setLiveLoading(false);
        }),
    []
  );

  const fetchLiveLogs = () => {
    setLiveLoading(true);
    setLiveError(null);
    return loadLiveLogs();
  };

  const lastReportingQueryRef = useRef<string>('');

  // Fetch Reporting Logs: Parameterized fetch for Overview / History date queries
  const fetchReportingLogs = useCallback(
    async (fDate?: string, tDate?: string, targetPage: number = 1, explicitMode?: RetrievalMode) => {
      const modeToUse = explicitMode || 'report';
      lastReportingQueryRef.current = `${fDate || ''}|${tDate || ''}|${targetPage}|${modeToUse}`;
      setReportingLoading(true);
      setReportingError(null);
      try {
        const params = new URLSearchParams();
        params.append('mode', modeToUse);
        params.append('page', String(targetPage));
        params.append('pageSize', '20');
        if (fDate) params.append('fromDate', fDate);
        if (tDate) params.append('toDate', tDate);

        const res = await fetch(`/api/logs?${params.toString()}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to fetch reporting logs');

        const items = data.items || data.logs;
        if (items) setReportingLogs(items);
        if (data.pagination) {
          setReportingPage(data.pagination.page || targetPage);
          setReportingTotalPages(data.pagination.totalPages || data.pagination.total_pages || 1);
          setReportingTotalRecords(data.pagination.totalRecords || data.pagination.total_count || 0);
          setReportingHasMore(Boolean(data.pagination.hasMore ?? data.pagination.has_more));
        }
        if (data.summary) {
          setReportingSummary(data.summary);
        }
        if (data.serverBusinessDate) setServerBusinessDate(data.serverBusinessDate);
        if (data.serverCalendarDate) setServerCalendarDate(data.serverCalendarDate);
      } catch (err) {
        setReportingError(getErrorMessage(err) || 'Failed to load reporting logs');
      } finally {
        setReportingLoading(false);
      }
    },
    []
  );

  const handleOverviewDateRangeChange = useCallback(
    (range: OverviewDateRange) => {
      setSummaryDateRange(range);
      const bounds = getOverviewDateRangeBounds(range);
      setReportingPage(1);
      setFromDate(bounds.fromDate);
      setToDate(bounds.toDate);
      fetchReportingLogs(bounds.fromDate, bounds.toDate, 1, 'report');
    },
    [fetchReportingLogs]
  );

  // Fetch local ZMCC operational snapshot metrics (live metrics polled every 15 seconds)
  const fetchZmccLocalStats = useCallback(
    () =>
      fetch('/api/zmcc/tanks?active_only=true')
        .then(async (tanksRes) => {
          if (!tanksRes.ok) {
            setZmccTankStock(null);
            return;
          }
          const tanksData = await tanksRes.json();
          const tanks = Array.isArray(tanksData) ? tanksData : tanksData.tanks || tanksData.items;
          if (Array.isArray(tanks) && tanks.length === 1) {
            const stock = Number(tanks[0].current_stock);
            setZmccTankStock(Number.isFinite(stock) ? Number(stock.toFixed(2)) : null);
          } else {
            setZmccTankStock(null);
          }
        })
        .catch(() => setZmccTankStock(null))
        .then(() => fetch('/api/zmcc/arrivals/inside'))
        .then(async (insideRes) => {
          if (!insideRes.ok) {
            setVehiclesInsideZmccCount(null);
            return;
          }
          const insideData = await insideRes.json();
          if (typeof insideData.total_count === 'number') {
            setVehiclesInsideZmccCount(insideData.total_count);
          } else {
            setVehiclesInsideZmccCount(null);
          }
        })
        .catch(() => setVehiclesInsideZmccCount(null)),
    []
  );

  // Fetch today's accepted intake volume (authoritative DB aggregate, non-polled)
  const fetchTodayAcceptedIntakeLiters = useCallback(() => {
    const todayDate = serverCalendarDate || getPakistanCalendarDate(new Date());
    return fetch(`/api/zmcc/lab/history?date=${todayDate}&decision=ACCEPTED&page=1&pageSize=1`)
      .then(async (labRes) => {
        if (!labRes.ok) {
          setTodayAcceptedIntakeLiters(null);
          return;
        }

        const labData = await labRes.json();
        const totalGross = labData.summary?.totalGrossLiters;

        if (typeof totalGross === 'number') {
          setTodayAcceptedIntakeLiters(Number(totalGross.toFixed(2)));
        } else if (labData.total === 0) {
          setTodayAcceptedIntakeLiters(0);
        } else {
          setTodayAcceptedIntakeLiters(null);
        }
      })
      .catch(() => {
        setTodayAcceptedIntakeLiters(null);
      });
  }, [serverCalendarDate]);

  // A. Live Flow: Initial mount and interval polling (LIVE ONLY)
  useEffect(() => {
    loadLiveLogs();
    fetchZmccLocalStats();
    const interval = setInterval(() => {
      loadLiveLogs();
      fetchZmccLocalStats();
    }, 15000);
    return () => clearInterval(interval);
  }, [loadLiveLogs, fetchZmccLocalStats]);

  // Separate non-polled load for accepted intake aggregate
  useEffect(() => {
    fetchTodayAcceptedIntakeLiters();
  }, [fetchTodayAcceptedIntakeLiters]);

  // B. Reporting Flow: Initial load and when fromDate/toDate changes (resets to page 1)
  useEffect(() => {
    const queryKey = `${fromDate}|${toDate}|1|report`;
    if (lastReportingQueryRef.current !== queryKey) {
      setReportingPage(1);
      fetchReportingLogs(fromDate, toDate, 1, 'report');
    }
  }, [fetchReportingLogs, fromDate, toDate]);

  const renderReportingPaginationBar = () => {
    if (reportingTotalRecords === 0) return null;
    const startItem = (reportingPage - 1) * 20 + 1;
    const endItem = Math.min(reportingPage * 20, reportingTotalRecords);
    return (
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 bg-white border border-border rounded-xl text-xs shadow-2xs mt-4">
        <div className="text-slate-600 font-medium">
          Showing visits <span className="font-semibold text-slate-900">{startItem}</span> to{' '}
          <span className="font-semibold text-slate-900">{endItem}</span> of{' '}
          <span className="font-semibold text-slate-900">{reportingTotalRecords}</span> total
          {reportingTotalPages > 1 && (
            <span className="ml-2 text-[11px] text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
              Page {reportingPage} of {reportingTotalPages}
            </span>
          )}
        </div>
        <div className="flex items-center space-x-2">
          <button
            type="button"
            onClick={() => {
              const prevPage = Math.max(1, reportingPage - 1);
              fetchReportingLogs(fromDate, toDate, prevPage, 'report');
            }}
            disabled={reportingPage <= 1 || reportingLoading}
            className="px-3.5 py-1.5 min-h-[36px] bg-subtle hover:bg-muted/60 border border-border-strong rounded-lg font-semibold text-foreground disabled:opacity-40 disabled:cursor-not-allowed transition"
          >
            Previous
          </button>
          <button
            type="button"
            onClick={() => {
              const nextPage = Math.min(reportingTotalPages, reportingPage + 1);
              fetchReportingLogs(fromDate, toDate, nextPage, 'report');
            }}
            disabled={reportingPage >= reportingTotalPages || !reportingHasMore || reportingLoading}
            className="px-3.5 py-1.5 min-h-[36px] bg-subtle hover:bg-muted/60 border border-border-strong rounded-lg font-semibold text-foreground disabled:opacity-40 disabled:cursor-not-allowed transition"
          >
            Next
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="w-full max-w-full flex flex-col h-screen bg-background text-foreground overflow-hidden">
      <Header
        currentUser={currentUser}
        title={subpageTitle ? `${sectionTitle} · ${subpageTitle}` : sectionTitle}
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
            {renderReportingPaginationBar()}
          </div>
        )}

        {activeTab === 'LIVE' && (
          <div id="tabpanel-LIVE" role="tabpanel" aria-labelledby="tab-LIVE" className="space-y-6 animate-panel-in">
            <ZMCCManagerLiveDispatches
              logs={liveLogs}
              assignedSourceName={assignedSourceName}
              onInspectDetails={(l) => setSelectedLog(l)}
              isLoading={liveLoading}
              error={liveError}
              onRetry={() => fetchLiveLogs()}
            />
          </div>
        )}

        {activeTab === 'RECONCILIATION' && (
          <div id="tabpanel-RECONCILIATION" role="tabpanel" aria-labelledby="tab-RECONCILIATION" className="space-y-6 animate-panel-in">
            <ZMCCManagerReconciliation
              logs={reportingLogs}
              assignedSourceName={assignedSourceName}
              onInspectDetails={(l) => setSelectedLog(l)}
              isLoading={reportingLoading}
              error={reportingError}
              onRetry={() => fetchReportingLogs(fromDate, toDate, reportingPage, 'report')}
              pagination={{
                page: reportingPage,
                totalPages: reportingTotalPages,
                totalRecords: reportingTotalRecords,
                hasMore: reportingHasMore,
              }}
            />
            {renderReportingPaginationBar()}
          </div>
        )}

        {activeTab === 'HISTORY' && (
          <div id="tabpanel-HISTORY" role="tabpanel" aria-labelledby="tab-HISTORY" className="space-y-6 animate-panel-in">
            {historyView === 'PLANT_HISTORY' && (
              <div className="space-y-6">
                <ZMCCManagerHistoryReports
                  logs={reportingLogs}
                  assignedSourceName={assignedSourceName}
                  onInspectDetails={(l) => setSelectedLog(l)}
                  isLoading={reportingLoading}
                  error={reportingError}
                  onRetry={() => fetchReportingLogs(fromDate, toDate, reportingPage, 'report')}
                  currentFromDate={fromDate}
                  currentToDate={toDate}
                  onDateFilterChange={(f, t) => {
                    setFromDate(f || '');
                    setToDate(t || '');
                  }}
                />
                {renderReportingPaginationBar()}
              </div>
            )}

            {historyView === 'QUALITY_REJECTIONS' && (
              <ZMCCManagerQualityRejections
                logs={reportingLogs}
                assignedSourceName={assignedSourceName}
                onInspectDetails={(l) => setSelectedLog(l)}
                isLoading={reportingLoading}
                error={reportingError}
                onRetry={() => fetchReportingLogs(fromDate, toDate, reportingPage, 'report')}
                currentFromDate={fromDate}
                currentToDate={toDate}
                onDateFilterChange={(f, t) => {
                  setFromDate(f || '');
                  setToDate(t || '');
                }}
              />
            )}

            {historyView === 'ARRIVAL_CORRECTIONS' && (
              <ZmccArrivalsWorkspace currentUser={currentUser} />
            )}

            {historyView === 'LAB_CORRECTIONS' && (
              <ZmccLabWorkspace currentUser={currentUser} />
            )}
          </div>
        )}

        {activeTab === 'MASTER_DATA' && (
          <div id="tabpanel-MASTER_DATA" role="tabpanel" aria-labelledby="tab-MASTER_DATA" className="space-y-6 animate-panel-in">
            <ZmccMasterDataWorkspace
              currentUser={currentUser}
              activeTab={
                (searchParams?.get('view')?.toUpperCase() as MasterDataTab | undefined) || undefined
              }
            />
          </div>
        )}

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
