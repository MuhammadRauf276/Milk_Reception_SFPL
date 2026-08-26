'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { MilkProcessLog, User } from '@backend/core/types';
import { Sidebar } from '@modules/shared/Sidebar';
import { Header } from '@modules/shared/Header';
import { ZMCCManagerOverview } from './zmcc/ZMCCManagerOverview';
import { ZMCCManagerLiveDispatches } from './zmcc/ZMCCManagerLiveDispatches';
import { ZMCCManagerCrossVerification } from './zmcc/ZMCCManagerCrossVerification';
import { ZMCCManagerQualityRejections } from './zmcc/ZMCCManagerQualityRejections';
import { ZMCCManagerReceiptsPerformance } from './zmcc/ZMCCManagerReceiptsPerformance';
import { ZonalHistoryTable } from '@modules/dashboard/ZonalHistoryTable';
import { LogDetailModal } from '@modules/dashboard/LogDetailModal';
import {
  ZMCCManagerTab,
  OverviewDateRange,
} from './zmcc/zmccManagerTypes';
import { buildVehicleVisitGroups } from './zmcc/zmccManagerHelpers';
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
  AlertTriangle,
  Info,
  TrendingUp,
  Search,
} from 'lucide-react';

interface ZMCCManagerWorkspaceProps {
  currentUser: User | null;
}

const TABS: { id: ZMCCManagerTab; label: string; icon: React.FC<any> }[] = [
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

  // 1. Independent Live State
  const [liveLogs, setLiveLogs] = useState<MilkProcessLog[]>([]);
  const [liveLoading, setLiveLoading] = useState<boolean>(true);
  const [liveError, setLiveError] = useState<string | null>(null);

  // 2. Independent Reporting State
  const [reportingLogs, setReportingLogs] = useState<MilkProcessLog[]>([]);
  const [reportingLoading, setReportingLoading] = useState<boolean>(true);
  const [reportingError, setReportingError] = useState<string | null>(null);

  // History & Table search/filter state (isolated to historical reporting tables)
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [fromDate, setFromDate] = useState<string>('');
  const [toDate, setToDate] = useState<string>('');
  const [selectedLog, setSelectedLog] = useState<MilkProcessLog | null>(null);

  const assignedSourceName =
    currentUser?.procurement_source?.name ||
    currentUser?.zone ||
    (currentUser?.role === 'ZMCC_MANAGER' ? 'Assigned ZMCC Source' : 'ZMCC Source');

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
    const interval = setInterval(() => {
      fetchLiveLogs();
    }, 15000);
    return () => clearInterval(interval);
  }, [fetchLiveLogs]);

  // B. Reporting Flow: Initial load and when fromDate/toDate changes
  useEffect(() => {
    fetchReportingLogs(fromDate, toDate);
  }, [fetchReportingLogs, fromDate, toDate]);

  // Filtered reporting logs for historical tables (search query does NOT affect liveLogs)
  const filteredReportingLogs = useMemo(() => {
    return reportingLogs.filter((log) => {
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const match =
          log.vehicle_number.toLowerCase().includes(q) ||
          (log.token_number && log.token_number.toLowerCase().includes(q)) ||
          log.zonal_contractor_name.toLowerCase().includes(q);
        if (!match) return false;
      }
      return true;
    });
  }, [reportingLogs, searchQuery]);

  // Distinct active pipeline count for sidebar (derived from unbounded liveLogs)
  const activeInPlantCount = useMemo(() => {
    return buildVehicleVisitGroups(liveLogs).filter((g) => g.lifecycle.isInPlant).length;
  }, [liveLogs]);

  return (
    <div className="min-h-screen w-screen overflow-x-hidden bg-[#FDFBF9] text-[#111311] flex flex-row font-sans">
      <Sidebar currentUser={currentUser} activeCount={activeInPlantCount} />

      <div className="flex-1 flex flex-col min-w-0 min-h-screen">
        <Header
          currentUser={currentUser}
          title="ZMCC Manager Station"
          showBranding={false}
        />

        <main className="flex-1 p-6 overflow-y-auto space-y-6">
          {/* Top Supervisory Banner */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-5 rounded-xl bg-[#FFFFFF] border border-[#EAE4D5]/80 shadow-sm">
            <div>
              <div className="flex items-center space-x-2.5 flex-wrap gap-y-1">
                <ShieldCheck className="w-6 h-6 text-[#1E3A8A]" />
                <h1 className="text-xl font-extrabold tracking-tight text-[#111311]">
                  ZMCC Source Station: {assignedSourceName}
                </h1>
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-[#1E3A8A] text-white">
                  ZMCC_MANAGER
                </span>
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-[#E2E8F0] text-slate-800 flex items-center gap-1">
                  <Lock className="w-3 h-3 text-slate-600" /> Read-only supervisory workspace
                </span>
              </div>
              <p className="text-xs text-[#334155] font-semibold mt-1">
                Live dispatch monitoring, physical plant milestones, and authoritative cross-verification ledger for assigned source.
              </p>
            </div>

            <div className="flex items-center space-x-3">
              <button
                onClick={() => {
                  fetchLiveLogs();
                  fetchReportingLogs(fromDate, toDate);
                }}
                disabled={liveLoading || reportingLoading}
                className="flex items-center space-x-1.5 px-3.5 py-2 rounded-xl bg-[#FDFBF9] border border-[#EAE4D5]/80 text-xs font-bold text-[#111311] hover:bg-[#F4F0E6]/60 transition-all shadow-sm disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 text-[#1E3A8A] ${liveLoading || reportingLoading ? 'animate-spin' : ''}`} />
                <span>{liveLoading || reportingLoading ? 'Syncing...' : 'Refresh Logs'}</span>
              </button>
            </div>
          </div>

          {/* Accessible Tab Navigation */}
          <div className="border-b border-[#EAE4D5]/80 pb-px">
            <nav className="flex space-x-2 overflow-x-auto" role="tablist" aria-label="ZMCC Manager Workspace Tabs">
              {TABS.map((tab) => {
                const IconComponent = tab.icon;
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    role="tab"
                    id={`tab-${tab.id}`}
                    aria-controls={`tabpanel-${tab.id}`}
                    aria-selected={isActive}
                    onClick={() => setActiveTab(tab.id)}
                    className={`flex items-center space-x-2 px-4 py-2.5 rounded-t-xl text-xs font-extrabold transition-all border-t border-l border-r ${
                      isActive
                        ? 'bg-[#FFFFFF] text-[#1E3A8A] border-[#EAE4D5]/80 border-b-2 border-b-transparent -mb-px shadow-sm'
                        : 'bg-transparent text-slate-600 border-transparent hover:text-[#111311] hover:bg-[#F4F0E6]/40'
                    }`}
                  >
                    <IconComponent className={`w-4 h-4 ${isActive ? 'text-[#1E3A8A]' : 'text-slate-500'}`} />
                    <span className="whitespace-nowrap">{tab.label}</span>
                  </button>
                );
              })}
            </nav>
          </div>

          {/* TAB 1: OVERVIEW (Receives reportingLogs directly) */}
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

          {/* TAB 2: LIVE DISPATCHES (Uses independent liveLogs, liveLoading, liveError) */}
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

          {/* TAB 6: HISTORY & REPORTS */}
          {activeTab === 'HISTORY' && (
            <div id="tabpanel-HISTORY" role="tabpanel" aria-labelledby="tab-HISTORY" className="space-y-6">
              <div className="p-5 rounded-xl bg-[#FFFFFF] border border-[#EAE4D5]/80 shadow-sm space-y-4">
                <div className="flex items-center justify-between pb-2 border-b border-[#EAE4D5]/80">
                  <div className="flex items-center space-x-2">
                    <History className="w-5 h-5 text-[#1E3A8A]" />
                    <h3 className="text-sm font-extrabold text-[#111311]">
                      Historical Dispatch & Milestone Archive: {assignedSourceName}
                    </h3>
                  </div>
                  <span className="text-xs font-mono font-bold text-slate-500">
                    Total Dispatches: {filteredReportingLogs.length}
                  </span>
                </div>

                <div className="relative w-full md:w-80">
                  <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search vehicle #, token #..."
                    className="w-full pl-10 pr-4 py-2 text-xs font-semibold rounded-lg bg-[#FDFBF9] border border-[#EAE4D5]/80 text-[#111311] focus:ring-2 focus:ring-[#1E3A8A] outline-none"
                  />
                </div>
              </div>

              <ZonalHistoryTable
                logs={filteredReportingLogs}
                targetZone={assignedSourceName}
                onInspectDetails={(l) => setSelectedLog(l)}
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
            <LogDetailModal
              isOpen={!!selectedLog}
              log={selectedLog}
              onClose={() => setSelectedLog(null)}
              currentUser={currentUser}
            />
          )}
        </main>
      </div>
    </div>
  );
};
