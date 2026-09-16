'use client';

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { MilkProcessLog, User } from '@backend/core/types';
import { Header } from '@modules/shared/Header';
import { ZMCCManagerOverview } from './zmcc/ZMCCManagerOverview';
import { ZMCCManagerLiveDispatches } from './zmcc/ZMCCManagerLiveDispatches';
import { ZMCCManagerReconciliation } from './zmcc/ZMCCManagerReconciliation';
import { ZMCCManagerHistoryReports } from './zmcc/ZMCCManagerHistoryReports';
import { ZMCCManagerVisitDetailModal } from './zmcc/ZMCCManagerVisitDetailModal';
import {
  ZMCCManagerTab,
  OverviewDateRange,
} from './zmcc/zmccManagerTypes';
import { getOverviewDateRangeBounds } from './zmcc/zmccManagerHelpers';
import { getPakistanCalendarDate } from '@backend/core/business-day';
import type { RetrievalMode } from '@backend/services/operationalReadModelService';
import {
  LayoutDashboard,
  Truck,
  ArrowRightLeft,
  History,
  Store,
  X,
  Milk,
} from 'lucide-react';
import { ZmccMasterDataWorkspace } from '@/frontend/modules/zmcc/ZmccMasterDataWorkspace';
import { ZmccArrivalsWorkspace } from '@/frontend/modules/zmcc/arrivals/ZmccArrivalsWorkspace';
import { ZmccLabWorkspace } from '@/frontend/modules/zmcc/lab/ZmccLabWorkspace';

interface ZMCCManagerWorkspaceProps {
  currentUser: User | null;
}

type ManagerHistoryView =
  | 'PLANT_HISTORY'
  | 'ARRIVAL_CORRECTIONS'
  | 'LAB_CORRECTIONS';

const TABS: { id: ZMCCManagerTab; label: string; icon: React.FC<{ className?: string }> }[] = [
  { id: 'OVERVIEW', label: 'Overview', icon: LayoutDashboard },
  { id: 'LIVE', label: 'Live Operations', icon: Truck },
  { id: 'RECONCILIATION', label: 'Reconciliation', icon: ArrowRightLeft },
  { id: 'HISTORY', label: 'History & Reports', icon: History },
  { id: 'MASTER_DATA', label: 'Master Data', icon: Store },
];

export const ZMCCManagerWorkspace: React.FC<ZMCCManagerWorkspaceProps> = ({
  currentUser,
}) => {
  const [activeTab, setActiveTab] = useState<ZMCCManagerTab>('OVERVIEW');
  const [historyView, setHistoryView] = useState<ManagerHistoryView>('PLANT_HISTORY');
  const [summaryDateRange, setSummaryDateRange] = useState<OverviewDateRange>('TODAY');
  const [serverBusinessDate, setServerBusinessDate] = useState<string>('');
  const [serverCalendarDate, setServerCalendarDate] = useState<string>('');
  const [isDrawerOpen, setIsDrawerOpen] = useState<boolean>(false);
  const hamburgerButtonRef = useRef<HTMLButtonElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const drawerRef = useRef<HTMLElement | null>(null);

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
  }, [selectedLog, liveLogs, reportingLogs, receiptLogs]);

  const openDrawer = useCallback(() => {
    setIsDrawerOpen(true);
  }, []);

  const closeDrawer = useCallback(() => {
    setIsDrawerOpen(false);
    setTimeout(() => {
      hamburgerButtonRef.current?.focus();
    }, 0);
  }, []);

  // Keyboard navigation & Focus management for Navigation Drawer
  useEffect(() => {
    if (isDrawerOpen) {
      const originalOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';

      // Move focus into the drawer when opened
      const focusTimer = setTimeout(() => {
        closeButtonRef.current?.focus();
      }, 50);

      // Close drawer on Escape key press and restore focus to hamburger trigger
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          closeDrawer();
        }
      };

      window.addEventListener('keydown', handleKeyDown);
      return () => {
        clearTimeout(focusTimer);
        document.body.style.overflow = originalOverflow;
        window.removeEventListener('keydown', handleKeyDown);
      };
    }
  }, [isDrawerOpen, closeDrawer]);

  // Focus trap: keep Tab and Shift+Tab inside the open drawer
  const handleDrawerKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.key !== 'Tab') return;
    if (!drawerRef.current) return;

    const focusableElements = drawerRef.current.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    if (focusableElements.length === 0) return;

    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];

    if (e.shiftKey) {
      if (document.activeElement === firstElement) {
        e.preventDefault();
        lastElement.focus();
      }
    } else {
      if (document.activeElement === lastElement) {
        e.preventDefault();
        firstElement.focus();
      }
    }
  };

  const handleSelectTab = (tabId: ZMCCManagerTab) => {
    setActiveTab(tabId);
    closeDrawer();
  };

  // Fetch Live Logs: Mode 'live' active pipeline only
  const fetchLiveLogs = useCallback(async () => {
    setLiveLoading(true);
    setLiveError(null);
    try {
      const res = await fetch('/api/logs?mode=live');
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
    } catch (err: any) {
      setLiveActiveInPlantCount(null);
      setLiveError(err.message || 'Failed to load live pipeline logs');
    } finally {
      setLiveLoading(false);
    }
  }, []);

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
      } catch (err: any) {
        setReportingError(err.message || 'Failed to load reporting logs');
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
  const fetchZmccLocalStats = useCallback(async () => {
    try {
      const tanksRes = await fetch('/api/zmcc/tanks?active_only=true');
      if (tanksRes.ok) {
        const tanksData = await tanksRes.json();
        const tanks = Array.isArray(tanksData) ? tanksData : tanksData.tanks || tanksData.items;
        if (Array.isArray(tanks) && tanks.length === 1) {
          const stock = Number(tanks[0].current_stock);
          setZmccTankStock(Number.isFinite(stock) ? Number(stock.toFixed(2)) : null);
        } else {
          setZmccTankStock(null);
        }
      } else {
        setZmccTankStock(null);
      }
    } catch {
      setZmccTankStock(null);
    }

    try {
      const insideRes = await fetch('/api/zmcc/arrivals/inside');
      if (insideRes.ok) {
        const insideData = await insideRes.json();
        if (typeof insideData.total_count === 'number') {
          setVehiclesInsideZmccCount(insideData.total_count);
        } else {
          setVehiclesInsideZmccCount(null);
        }
      } else {
        setVehiclesInsideZmccCount(null);
      }
    } catch {
      setVehiclesInsideZmccCount(null);
    }

    try {
      const todayDate =
        serverCalendarDate || getPakistanCalendarDate(new Date());

      const labRes = await fetch(
        `/api/zmcc/lab/history?date=${todayDate}&decision=ACCEPTED&page=1&pageSize=1`
      );

      if (labRes.ok) {
        const labData = await labRes.json();
        const totalGross = labData.summary?.totalGrossLiters;

        if (typeof totalGross === 'number') {
          setTodayAcceptedIntakeLiters(Number(totalGross.toFixed(2)));
        } else if (labData.total === 0) {
          setTodayAcceptedIntakeLiters(0);
        } else {
          setTodayAcceptedIntakeLiters(null);
        }
      } else {
        setTodayAcceptedIntakeLiters(null);
      }
    } catch {
      setTodayAcceptedIntakeLiters(null);
    }
  }, [serverCalendarDate]);

  // A. Live Flow: Initial mount and interval polling (LIVE ONLY)
  useEffect(() => {
    fetchLiveLogs();
    fetchZmccLocalStats();
    const interval = setInterval(() => {
      fetchLiveLogs();
      fetchZmccLocalStats();
    }, 15000);
    return () => clearInterval(interval);
  }, [fetchLiveLogs, fetchZmccLocalStats]);

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
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 bg-white border border-[#EAE4D5] rounded-xl text-xs shadow-xs mt-4">
        <div className="text-slate-600 font-medium">
          Showing visits <span className="font-bold text-slate-900">{startItem}</span> to{' '}
          <span className="font-bold text-slate-900">{endItem}</span> of{' '}
          <span className="font-bold text-slate-900">{reportingTotalRecords}</span> total
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
            className="px-3.5 py-1.5 min-h-[36px] bg-[#FDFBF9] hover:bg-[#EFE9D9]/60 border border-[#C4B9A3] rounded-lg font-bold text-[#111311] disabled:opacity-40 disabled:cursor-not-allowed transition"
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
            className="px-3.5 py-1.5 min-h-[36px] bg-[#FDFBF9] hover:bg-[#EFE9D9]/60 border border-[#C4B9A3] rounded-lg font-bold text-[#111311] disabled:opacity-40 disabled:cursor-not-allowed transition"
          >
            Next
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="w-full max-w-full flex flex-col h-screen bg-[#FDFBF9] text-[#111311] overflow-hidden font-sans">
      {/* Header with Hamburger Trigger */}
      <Header
        currentUser={currentUser}
        sourceName={assignedSourceName}
        showBranding={true}
        onMenuClick={openDrawer}
        isZmccVariant={true}
        menuButtonRef={hamburgerButtonRef}
      />

      {/* Accessible Navigation Drawer */}
      {isDrawerOpen && (
        <div
          className="fixed inset-0 z-50 flex"
          role="dialog"
          aria-modal="true"
          aria-label="Navigation Drawer"
          onKeyDown={handleDrawerKeyDown}
        >
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs transition-opacity"
            onClick={closeDrawer}
            aria-hidden="true"
          />

          {/* Drawer Panel */}
          <aside
            ref={drawerRef}
            className="relative z-50 w-80 max-w-[85vw] sm:max-w-[320px] bg-[#FFFFFF] border-r border-[#C4B9A3] shadow-2xl flex flex-col p-4 sm:p-5 text-[#111311] overflow-y-auto h-full"
          >
            <div className="space-y-5">
              {/* Drawer Header: Corporate Branding + Close Button */}
              <div className="flex items-start justify-between pb-4 border-b border-[#EAE4D5]">
                <div className="flex items-center space-x-3 min-w-0">
                  <div className="p-2.5 bg-[#1E3A8A] rounded-xl shadow-xs text-white shrink-0">
                    <Milk className="w-5 h-5 sm:w-6 sm:h-6" />
                  </div>
                  <div className="min-w-0">
                    <span className="font-extrabold text-sm sm:text-base leading-tight block text-[#111311] truncate">
                      Shakarganj
                    </span>
                    <span className="text-[9px] sm:text-[10px] uppercase font-extrabold text-slate-500 tracking-wider block truncate">
                      Food Products Limited
                    </span>
                  </div>
                </div>
                <button
                  ref={closeButtonRef}
                  type="button"
                  onClick={closeDrawer}
                  className="min-h-[44px] min-w-[44px] p-2.5 rounded-xl border border-[#EAE4D5] bg-[#FDFBF9] text-slate-700 hover:bg-[#F4F0E6] hover:text-[#111311] transition flex items-center justify-center shrink-0 focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]"
                  aria-label="Close navigation drawer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Navigation */}
              <nav aria-label="Navigation" className="space-y-1.5">
                {TABS.map((tab) => {
                  const IconComponent = tab.icon;
                  const isActive = activeTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => handleSelectTab(tab.id)}
                      className={`w-full min-h-[44px] flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-black transition-all border text-left ${
                        isActive
                          ? 'bg-[#1E3A8A] text-white border-[#1E3A8A] shadow-md'
                          : 'bg-[#FDFBF9] text-[#111311] border-[#EAE4D5] hover:bg-[#F4F0E6] hover:border-[#C4B9A3]'
                      }`}
                      aria-current={isActive ? 'page' : undefined}
                    >
                      <div className="flex items-center space-x-3">
                        <IconComponent className={`w-4 h-4 ${isActive ? 'text-white' : 'text-[#1E3A8A]'}`} />
                        <span className="truncate">{tab.label}</span>
                      </div>
                      {isActive && (
                        <span className="w-2 h-2 rounded-full bg-emerald-400 ring-4 ring-emerald-400/30 shrink-0" />
                      )}
                    </button>
                  );
                })}
              </nav>
            </div>
          </aside>
        </div>
      )}

      {/* Main Content Area */}
      <main className="flex-1 p-3 sm:p-6 overflow-y-auto space-y-5 sm:space-y-6 w-full max-w-full">
        {/* TAB 1: OVERVIEW */}
        {activeTab === 'OVERVIEW' && (
          <div id="tabpanel-OVERVIEW" role="tabpanel" aria-labelledby="tab-OVERVIEW" className="space-y-6">
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

        {/* TAB 2: LIVE OPERATIONS */}
        {activeTab === 'LIVE' && (
          <div id="tabpanel-LIVE" role="tabpanel" aria-labelledby="tab-LIVE" className="space-y-6">
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

        {/* TAB 3: RECONCILIATION */}
        {activeTab === 'RECONCILIATION' && (
          <div id="tabpanel-RECONCILIATION" role="tabpanel" aria-labelledby="tab-RECONCILIATION" className="space-y-6">
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

        {/* TAB 4: HISTORY & REPORTS */}
        {activeTab === 'HISTORY' && (
          <div id="tabpanel-HISTORY" role="tabpanel" aria-labelledby="tab-HISTORY" className="space-y-6">
            {/* Secondary Sub-Navigation for History View */}
            <div className="flex items-center gap-2 p-1.5 bg-[#FFFFFF] border border-[#EAE4D5] rounded-xl shadow-xs w-fit">
              <button
                type="button"
                onClick={() => setHistoryView('PLANT_HISTORY')}
                className={`px-3.5 py-1.5 text-xs font-bold rounded-lg transition-all ${
                  historyView === 'PLANT_HISTORY'
                    ? 'bg-[#1E3A8A] text-white shadow-xs'
                    : 'text-slate-700 hover:bg-[#F4F0E6]'
                }`}
              >
                Plant / Dispatch History
              </button>
              <button
                type="button"
                onClick={() => setHistoryView('ARRIVAL_CORRECTIONS')}
                className={`px-3.5 py-1.5 text-xs font-bold rounded-lg transition-all ${
                  historyView === 'ARRIVAL_CORRECTIONS'
                    ? 'bg-[#1E3A8A] text-white shadow-xs'
                    : 'text-slate-700 hover:bg-[#F4F0E6]'
                }`}
              >
                Arrival Corrections
              </button>
              <button
                type="button"
                onClick={() => setHistoryView('LAB_CORRECTIONS')}
                className={`px-3.5 py-1.5 text-xs font-bold rounded-lg transition-all ${
                  historyView === 'LAB_CORRECTIONS'
                    ? 'bg-[#1E3A8A] text-white shadow-xs'
                    : 'text-slate-700 hover:bg-[#F4F0E6]'
                }`}
              >
                Lab Corrections
              </button>
            </div>

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

            {historyView === 'ARRIVAL_CORRECTIONS' && (
              <ZmccArrivalsWorkspace currentUser={currentUser} />
            )}

            {historyView === 'LAB_CORRECTIONS' && (
              <ZmccLabWorkspace currentUser={currentUser} />
            )}
          </div>
        )}

        {/* TAB 5: MASTER DATA */}
        {activeTab === 'MASTER_DATA' && (
          <div id="tabpanel-MASTER_DATA" role="tabpanel" aria-labelledby="tab-MASTER_DATA" className="space-y-6">
            <ZmccMasterDataWorkspace currentUser={currentUser} />
          </div>
        )}

          {/* Detail Inspection Modal */}
          {selectedLog && (
            <ZMCCManagerVisitDetailModal
              isOpen={!!selectedLog}
              log={selectedLog}
              portions={selectedVisitPortions}
              onClose={() => setSelectedLog(null)}
              assignedSourceName={assignedSourceName}
            />
          )}
        </main>
    </div>
  );
};
