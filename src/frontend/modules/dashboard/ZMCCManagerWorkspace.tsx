'use client';

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { MilkProcessLog, User } from '@backend/core/types';
import { Header } from '@modules/shared/Header';
import { ZMCCManagerOverview } from './zmcc/ZMCCManagerOverview';
import { ZMCCManagerLiveDispatches } from './zmcc/ZMCCManagerLiveDispatches';
import { ZMCCManagerCrossVerification } from './zmcc/ZMCCManagerCrossVerification';
import { ZMCCManagerQualityRejections } from './zmcc/ZMCCManagerQualityRejections';
import { ZMCCManagerReceiptsPerformance } from './zmcc/ZMCCManagerReceiptsPerformance';
import { ZMCCManagerHistoryReports } from './zmcc/ZMCCManagerHistoryReports';
import { ZMCCManagerVisitDetailModal } from './zmcc/ZMCCManagerVisitDetailModal';
import {
  ZMCCManagerTab,
  OverviewDateRange,
} from './zmcc/zmccManagerTypes';
import {
  LayoutDashboard,
  Truck,
  ArrowRightLeft,
  FlaskConical,
  Receipt,
  History,
  ShieldCheck,
  RefreshCw,
  Lock,
  X,
  Menu,
  LogOut,
  Milk,
} from 'lucide-react';

interface ZMCCManagerWorkspaceProps {
  currentUser: User | null;
}

const TABS: { id: ZMCCManagerTab; label: string; icon: React.FC<{ className?: string }> }[] = [
  { id: 'OVERVIEW', label: 'Overview', icon: LayoutDashboard },
  { id: 'LIVE', label: 'Live Dispatches', icon: Truck },
  { id: 'CROSS_VERIFICATION', label: 'Cross Verification', icon: ArrowRightLeft },
  { id: 'QUALITY', label: 'Quality & Rejections', icon: FlaskConical },
  { id: 'RECEIPTS', label: 'Receipts & Performance', icon: Receipt },
  { id: 'HISTORY', label: 'History & Reports', icon: History },
];

export const ZMCCManagerWorkspace: React.FC<ZMCCManagerWorkspaceProps> = ({
  currentUser,
}) => {
  const [activeTab, setActiveTab] = useState<ZMCCManagerTab>('OVERVIEW');
  const [summaryDateRange, setSummaryDateRange] = useState<OverviewDateRange>('TODAY');
  const [serverBusinessDate, setServerBusinessDate] = useState<string>('');
  const [isDrawerOpen, setIsDrawerOpen] = useState<boolean>(false);
  const hamburgerButtonRef = useRef<HTMLButtonElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const drawerRef = useRef<HTMLElement | null>(null);

  // 1. Independent Live State
  const [liveLogs, setLiveLogs] = useState<MilkProcessLog[]>([]);
  const [liveLoading, setLiveLoading] = useState<boolean>(true);
  const [liveError, setLiveError] = useState<string | null>(null);

  // 2. Independent Reporting State
  const [reportingLogs, setReportingLogs] = useState<MilkProcessLog[]>([]);
  const [reportingLoading, setReportingLoading] = useState<boolean>(true);
  const [reportingError, setReportingError] = useState<string | null>(null);

  // 3. Independent Receipts & Performance State (Unbounded source-scoped fetch for complete receipt lifecycle)
  const [receiptLogs, setReceiptLogs] = useState<MilkProcessLog[]>([]);
  const [receiptLoading, setReceiptLoading] = useState<boolean>(true);
  const [receiptError, setReceiptError] = useState<string | null>(null);

  // History & Table search/filter state (isolated to historical reporting tables)
  const [fromDate, setFromDate] = useState<string>('');
  const [toDate, setToDate] = useState<string>('');
  const [selectedLog, setSelectedLog] = useState<MilkProcessLog | null>(null);

  const assignedSourceName =
    currentUser?.procurement_source?.name ||
    currentUser?.zone ||
    'Assigned ZMCC Source';

  const currentTabConfig = useMemo(() => {
    return TABS.find((t) => t.id === activeTab) || TABS[0];
  }, [activeTab]);

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch (_err) {
      // Ignore
    }
    window.location.href = '/login';
  };

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

  // Fetch Live Logs: Unbounded source-scoped fetch without date or search filters
  const fetchLiveLogs = useCallback(async () => {
    setLiveLoading(true);
    setLiveError(null);
    try {
      const res = await fetch('/api/logs');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to fetch live logs');

      if (data.logs) setLiveLogs(data.logs);
      if (data.serverBusinessDate) setServerBusinessDate(data.serverBusinessDate);
    } catch (err: any) {
      setLiveError(err.message || 'Failed to load live pipeline logs');
    } finally {
      setLiveLoading(false);
    }
  }, []);

  // Fetch Receipt Logs: Unbounded source-scoped fetch without Dispatch Business Date filtering
  const fetchReceiptLogs = useCallback(async () => {
    setReceiptLoading(true);
    setReceiptError(null);
    try {
      const res = await fetch('/api/logs');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to fetch receipt logs');

      if (data.logs) setReceiptLogs(data.logs);
      if (data.serverBusinessDate) setServerBusinessDate(data.serverBusinessDate);
    } catch (err: any) {
      setReceiptError(err.message || 'Failed to load receipt logs');
    } finally {
      setReceiptLoading(false);
    }
  }, []);

  // Fetch Reporting Logs: Parameterized fetch for Overview / History date queries
  const fetchReportingLogs = useCallback(
    async (fDate?: string, tDate?: string) => {
      setReportingLoading(true);
      setReportingError(null);
      try {
        let url = '/api/logs';
        const params = new URLSearchParams();
        if (fDate) params.append('fromDate', fDate);
        if (tDate) params.append('toDate', tDate);
        if (params.toString()) url += `?${params.toString()}`;

        const res = await fetch(url);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to fetch reporting logs');

        if (data.logs) setReportingLogs(data.logs);
        if (data.serverBusinessDate) setServerBusinessDate(data.serverBusinessDate);
      } catch (err: any) {
        setReportingError(err.message || 'Failed to load reporting logs');
      } finally {
        setReportingLoading(false);
      }
    },
    []
  );

  // A. Live Flow: Initial mount and interval polling (NO fromDate/toDate dependency)
  useEffect(() => {
    fetchLiveLogs();
    fetchReceiptLogs();
    const interval = setInterval(() => {
      fetchLiveLogs();
      fetchReceiptLogs();
    }, 15000);
    return () => clearInterval(interval);
  }, [fetchLiveLogs, fetchReceiptLogs]);

  // B. Reporting Flow: Initial load and when fromDate/toDate changes
  useEffect(() => {
    fetchReportingLogs(fromDate, toDate);
  }, [fetchReportingLogs, fromDate, toDate]);

  return (
    <div className="w-full max-w-full flex flex-col h-screen bg-[#FDFBF9] text-[#111311] overflow-hidden font-sans">
      {/* Header with Hamburger Trigger */}
      <Header
        currentUser={currentUser}
        title="ZMCC Manager Station"
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
            className="relative z-50 w-80 max-w-[85vw] sm:max-w-[320px] bg-[#FFFFFF] border-r border-[#C4B9A3] shadow-2xl flex flex-col justify-between p-4 sm:p-5 text-[#111311] overflow-y-auto h-full"
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

              {/* User & Assigned Source Identity Card */}
              <div className="p-3.5 rounded-xl bg-[#FDFBF9] border border-[#EAE4D5] space-y-2.5">
                <div className="flex items-center space-x-2">
                  <ShieldCheck className="w-4 h-4 text-[#1E3A8A] shrink-0" />
                  <span className="text-[10px] font-black uppercase tracking-wider text-slate-500">
                    Logged In Manager
                  </span>
                </div>
                <div className="space-y-0.5">
                  <p className="text-sm font-black text-[#111311] truncate">
                    {currentUser?.name || currentUser?.username || 'ZMCC Manager'}
                  </p>
                  <p className="text-xs font-semibold text-slate-500 truncate">
                    @{currentUser?.username || 'user'}
                  </p>
                </div>
                <div className="pt-2 border-t border-[#EAE4D5] flex items-center justify-between gap-1.5 text-xs">
                  <span className="text-slate-500 font-bold">Assigned ZMCC:</span>
                  <span className="font-extrabold text-[#1E3A8A] truncate text-right">
                    {assignedSourceName}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-1.5 text-[10.5px] text-slate-500 font-bold">
                  <span>Access Mode:</span>
                  <span className="inline-flex items-center gap-1 font-extrabold text-slate-700">
                    <Lock className="w-3 h-3 text-slate-500" /> Read-Only Supervisory
                  </span>
                </div>
              </div>

              {/* Navigation Sections */}
              <nav aria-label="ZMCC Manager Navigation" className="space-y-1.5">
                <label className="text-[10px] font-black uppercase tracking-wider text-slate-500 block px-1 mb-2">
                  Navigation Sections
                </label>
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

            {/* Drawer Footer: Sign Out Button */}
            <div className="pt-4 border-t border-[#EAE4D5]">
              <button
                type="button"
                onClick={handleLogout}
                className="w-full min-h-[44px] flex items-center justify-center space-x-2 px-4 py-2.5 rounded-xl bg-[#FEF2F2] text-[#991B1B] border border-[#FECACA] hover:bg-rose-100 font-black text-xs transition active:scale-95 shadow-xs focus:outline-none focus:ring-2 focus:ring-rose-500"
                aria-label="Sign Out"
              >
                <LogOut className="w-4 h-4 text-[#991B1B]" />
                <span>Sign Out</span>
              </button>
            </div>
          </aside>
        </div>
      )}

      {/* Main Content Area */}
      <main className="flex-1 p-3 sm:p-6 overflow-y-auto space-y-5 sm:space-y-6 w-full max-w-full">
        {/* Top Supervisory Banner */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-4 sm:p-5 rounded-2xl bg-white border border-[#C4B9A3] shadow-xs">
          <div className="min-w-0">
            <div className="flex items-center space-x-2.5 flex-wrap gap-y-1.5">
              <ShieldCheck className="w-6 h-6 text-[#1E3A8A] shrink-0" />
              <h1 className="text-lg sm:text-xl font-black tracking-tight text-[#111311] truncate">
                ZMCC Source Station: {assignedSourceName}
              </h1>
              <span className="px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider bg-[#1E3A8A] text-white">
                ZMCC Manager
              </span>
              <span className="px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider bg-[#E2E8F0] text-slate-800 flex items-center gap-1">
                <Lock className="w-3.5 h-3.5 text-slate-600" /> Read-only supervisory workspace
              </span>
            </div>
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              <p className="text-xs text-slate-600 font-semibold">
                Active View: <span className="font-extrabold text-[#1E3A8A]">{currentTabConfig.label}</span>
              </p>
              <span className="text-slate-300 hidden sm:inline">•</span>
              <p className="text-xs text-slate-500 font-medium hidden sm:block">
                Live dispatch monitoring, physical plant milestones, and authoritative cross-verification ledger.
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2.5 self-start md:self-auto shrink-0">
            <button
              type="button"
              onClick={() => {
                fetchLiveLogs();
                fetchReportingLogs(fromDate, toDate);
                fetchReceiptLogs();
              }}
              disabled={liveLoading || reportingLoading || receiptLoading}
              className="flex items-center space-x-2 px-4 py-2.5 min-h-[44px] rounded-xl bg-[#1E3A8A] text-white hover:bg-blue-900 active:scale-95 transition-all shadow-xs disabled:opacity-50 text-xs font-black"
              aria-label="Refresh logs"
            >
              <RefreshCw className={`w-4 h-4 text-white ${liveLoading || reportingLoading || receiptLoading ? 'animate-spin' : ''}`} />
              <span>{liveLoading || reportingLoading || receiptLoading ? 'Syncing...' : 'Refresh Logs'}</span>
            </button>
          </div>
        </div>

        {/* TAB 1: OVERVIEW */}
        {activeTab === 'OVERVIEW' && (
            <div id="tabpanel-OVERVIEW" role="tabpanel" aria-labelledby="tab-OVERVIEW" className="space-y-6">
              <ZMCCManagerOverview
                logs={reportingLogs}
                serverBusinessDate={serverBusinessDate}
                assignedSourceName={assignedSourceName}
                dateRange={summaryDateRange}
                onDateRangeChange={(r) => setSummaryDateRange(r)}
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
                onRetry={() => fetchReportingLogs(fromDate, toDate)}
              />
            </div>
          )}

          {/* TAB 2: LIVE DISPATCHES */}
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

          {/* TAB 3: CROSS VERIFICATION */}
          {activeTab === 'CROSS_VERIFICATION' && (
            <div id="tabpanel-CROSS_VERIFICATION" role="tabpanel" aria-labelledby="tab-CROSS_VERIFICATION" className="space-y-6">
              <ZMCCManagerCrossVerification
                logs={reportingLogs}
                assignedSourceName={assignedSourceName}
                onInspectDetails={(l) => setSelectedLog(l)}
                isLoading={reportingLoading}
                error={reportingError}
                onRetry={() => fetchReportingLogs(fromDate, toDate)}
                currentFromDate={fromDate}
                currentToDate={toDate}
                onDateFilterChange={(f, t) => {
                  setFromDate(f || '');
                  setToDate(t || '');
                }}
              />
            </div>
          )}

          {/* TAB 4: QUALITY & REJECTIONS */}
          {activeTab === 'QUALITY' && (
            <div id="tabpanel-QUALITY" role="tabpanel" aria-labelledby="tab-QUALITY" className="space-y-6">
              <ZMCCManagerQualityRejections
                logs={reportingLogs}
                assignedSourceName={assignedSourceName}
                onInspectDetails={(l) => setSelectedLog(l)}
                isLoading={reportingLoading}
                error={reportingError}
                onRetry={() => fetchReportingLogs(fromDate, toDate)}
                currentFromDate={fromDate}
                currentToDate={toDate}
                onDateFilterChange={(f, t) => {
                  setFromDate(f || '');
                  setToDate(t || '');
                }}
              />
            </div>
          )}

          {/* TAB 5: RECEIPTS & PERFORMANCE */}
          {activeTab === 'RECEIPTS' && (
            <div id="tabpanel-RECEIPTS" role="tabpanel" aria-labelledby="tab-RECEIPTS" className="space-y-6">
              <ZMCCManagerReceiptsPerformance
                logs={receiptLogs}
                assignedSourceName={assignedSourceName}
                onInspectDetails={(l) => setSelectedLog(l)}
                isLoading={receiptLoading}
                error={receiptError}
                onRetry={() => fetchReceiptLogs()}
                currentFromDate={fromDate}
                currentToDate={toDate}
                onDateFilterChange={(f, t) => {
                  setFromDate(f || '');
                  setToDate(t || '');
                }}
              />
            </div>
          )}

          {/* TAB 6: HISTORY & REPORTS */}
          {activeTab === 'HISTORY' && (
            <div id="tabpanel-HISTORY" role="tabpanel" aria-labelledby="tab-HISTORY" className="space-y-6">
              <ZMCCManagerHistoryReports
                logs={reportingLogs}
                assignedSourceName={assignedSourceName}
                onInspectDetails={(l) => setSelectedLog(l)}
                isLoading={reportingLoading}
                error={reportingError}
                onRetry={() => fetchReportingLogs(fromDate, toDate)}
                currentFromDate={fromDate}
                currentToDate={toDate}
                onDateFilterChange={(f, t) => {
                  setFromDate(f || '');
                  setToDate(t || '');
                }}
              />
            </div>
          )}

          {/* Detail Inspection Modal */}
          {selectedLog && (
            <ZMCCManagerVisitDetailModal
              isOpen={!!selectedLog}
              log={selectedLog}
              onClose={() => setSelectedLog(null)}
              assignedSourceName={assignedSourceName}
            />
          )}
        </main>
    </div>
  );
};
