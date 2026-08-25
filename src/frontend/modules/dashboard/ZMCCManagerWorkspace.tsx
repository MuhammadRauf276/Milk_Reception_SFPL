'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { MilkProcessLog, User } from '@core/types';
import {
  computeAuthoritativeZonalAnalytics,
  computeRuntimeMetrics,
  computeVehicleDecisionSummary,
} from '@backend/services/operationalCalculations';
import { formatOperationalDatetime, formatOperationalTime } from '@/lib/datetime-utils';
import { ZonalHistoryTable } from '@modules/dashboard/ZonalHistoryTable';
import { LogDetailModal } from '@modules/dashboard/LogDetailModal';
import { Sidebar } from '@modules/shared/Sidebar';
import { Header } from '@modules/shared/Header';
import { ZMCCManagerOverview } from './zmcc/ZMCCManagerOverview';
import { ZMCCManagerLiveDispatches } from './zmcc/ZMCCManagerLiveDispatches';
import { OverviewDateRange } from './zmcc/zmccManagerTypes';
import {
  LayoutDashboard,
  Truck,
  ArrowRightLeft,
  AlertTriangle,
  TrendingUp,
  History,
  Lock,
  RefreshCw,
  Calendar,
  ShieldCheck,
  CheckCircle2,
  XCircle,
  Scale,
  FlaskConical,
  Factory,
  Search,
  Eye,
  Filter,
  Clock,
  Layers,
  ChevronDown,
  ChevronRight,
  Info,
} from 'lucide-react';

export type ZMCCManagerTab =
  | 'OVERVIEW'
  | 'LIVE'
  | 'CROSS_VERIFICATION'
  | 'QUALITY'
  | 'RECEIPTS'
  | 'HISTORY';

interface TabConfig {
  id: ZMCCManagerTab;
  label: string;
  icon: React.ElementType;
}

const TABS: TabConfig[] = [
  { id: 'OVERVIEW', label: 'Overview', icon: LayoutDashboard },
  { id: 'LIVE', label: 'Live Dispatches', icon: Truck },
  { id: 'CROSS_VERIFICATION', label: 'Cross Verification', icon: ArrowRightLeft },
  { id: 'QUALITY', label: 'Quality & Rejections', icon: AlertTriangle },
  { id: 'RECEIPTS', label: 'Receipts & Performance', icon: TrendingUp },
  { id: 'HISTORY', label: 'History & Reports', icon: History },
];

interface ZMCCManagerWorkspaceProps {
  currentUser: User | null;
}

export const ZMCCManagerWorkspace: React.FC<ZMCCManagerWorkspaceProps> = ({ currentUser }) => {
  const [activeTab, setActiveTab] = useState<ZMCCManagerTab>('OVERVIEW');
  const [logs, setLogs] = useState<MilkProcessLog[]>([]);
  const [serverBusinessDate, setServerBusinessDate] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Filters & State
  const [summaryDateRange, setSummaryDateRange] = useState<'TODAY' | 'YESTERDAY' | 'LAST_7' | 'LAST_15' | 'ALL'>('TODAY');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [fromDate, setFromDate] = useState<string>('');
  const [toDate, setToDate] = useState<string>('');
  const [selectedLog, setSelectedLog] = useState<MilkProcessLog | null>(null);

  const assignedSourceName =
    currentUser?.procurement_source?.name ||
    currentUser?.zone ||
    (currentUser?.role === 'ZMCC_MANAGER' ? 'Assigned ZMCC Source' : 'ZMCC Source');

  const fetchLogs = useCallback(
    async (fDate?: string, tDate?: string) => {
      setIsLoading(true);
      setError(null);
      try {
        let url = '/api/logs';
        const params = new URLSearchParams();
        if (fDate) params.append('fromDate', fDate);
        if (tDate) params.append('toDate', tDate);
        if (params.toString()) url += `?${params.toString()}`;

        const res = await fetch(url);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to fetch logs');

        if (data.logs) setLogs(data.logs);
        if (data.serverBusinessDate) setServerBusinessDate(data.serverBusinessDate);
      } catch (err: any) {
        setError(err.message || 'Failed to load manager logs');
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    fetchLogs(fromDate, toDate);
    const interval = setInterval(() => {
      fetchLogs(fromDate, toDate);
    }, 15000);
    return () => clearInterval(interval);
  }, [fetchLogs, fromDate, toDate]);

  // Scoped logs (server-side scoped, safe on client)
  const scopedLogs = logs;

  // Filtered logs for summary cards by date range
  const summaryScopedLogs = useMemo(() => {
    return scopedLogs.filter((l) => {
      const logDate = l.dispatch_date || (l.created_at ? l.created_at.split('T')[0] : '');
      if (!logDate) return false;

      if (summaryDateRange === 'TODAY') {
        return !serverBusinessDate || logDate === serverBusinessDate;
      }
      if (summaryDateRange === 'YESTERDAY') {
        if (!serverBusinessDate) return true;
        const refDate = new Date(serverBusinessDate);
        refDate.setDate(refDate.getDate() - 1);
        const yesterdayStr = refDate.toISOString().split('T')[0];
        return logDate === yesterdayStr;
      }
      if (summaryDateRange === 'LAST_7') {
        if (!serverBusinessDate) return true;
        const diffMs = new Date(serverBusinessDate).getTime() - new Date(logDate).getTime();
        const diffDays = Math.floor(diffMs / (1000 * 3600 * 24));
        return diffDays >= 0 && diffDays <= 7;
      }
      if (summaryDateRange === 'LAST_15') {
        if (!serverBusinessDate) return true;
        const diffMs = new Date(serverBusinessDate).getTime() - new Date(logDate).getTime();
        const diffDays = Math.floor(diffMs / (1000 * 3600 * 24));
        return diffDays >= 0 && diffDays <= 15;
      }
      return true;
    });
  }, [scopedLogs, summaryDateRange, serverBusinessDate]);

  // Analytics for the source
  const zonalAnalytics = useMemo(() => {
    return computeAuthoritativeZonalAnalytics(summaryScopedLogs, assignedSourceName);
  }, [summaryScopedLogs, assignedSourceName]);

  // Filtered logs for tables
  const filteredLogs = useMemo(() => {
    return scopedLogs.filter((log) => {
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
  }, [scopedLogs, searchQuery]);

  // Distinct pipeline counts
  const activeInPlantCount = useMemo(() => {
    const inPlantStatuses = ['GATE_IN', 'IN_QA', 'QA_ACCEPTED', 'WEIGHED_IN', 'UNLOADING', 'UNLOADED', 'READY_FOR_TARE', 'TARE_WEIGHED'];
    const matching = scopedLogs.filter((l) => inPlantStatuses.includes(String(l.status).toUpperCase()));
    return new Set(matching.map((l) => l.vehicle_number)).size;
  }, [scopedLogs]);

  const qaTestingQueueCount = useMemo(() => {
    const qaStatuses = ['GATE_IN', 'IN_QA'];
    const matching = scopedLogs.filter((l) => qaStatuses.includes(String(l.status).toUpperCase()));
    return new Set(matching.map((l) => l.vehicle_number)).size;
  }, [scopedLogs]);

  const weighbridgeQueueCount = useMemo(() => {
    const wbStatuses = ['QA_ACCEPTED', 'UNLOADED', 'READY_FOR_TARE'];
    const matching = scopedLogs.filter((l) => wbStatuses.includes(String(l.status).toUpperCase()));
    return new Set(matching.map((l) => l.vehicle_number)).size;
  }, [scopedLogs]);

  const completedTodayCount = useMemo(() => {
    const completedStatuses = ['READY_FOR_GATE_EXIT', 'COMPLETED', 'GATE_OUT'];
    const matching = scopedLogs.filter(
      (l) => completedStatuses.includes(String(l.status).toUpperCase()) && (!serverBusinessDate || l.dispatch_date === serverBusinessDate)
    );
    return new Set(matching.map((l) => l.vehicle_number)).size;
  }, [scopedLogs, serverBusinessDate]);

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
                onClick={() => fetchLogs(fromDate, toDate)}
                disabled={isLoading}
                className="flex items-center space-x-1.5 px-3.5 py-2 rounded-xl bg-[#FDFBF9] border border-[#EAE4D5]/80 text-xs font-bold text-[#111311] hover:bg-[#F4F0E6]/60 transition-all shadow-sm disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 text-[#1E3A8A] ${isLoading ? 'animate-spin' : ''}`} />
                <span>{isLoading ? 'Syncing...' : 'Refresh Logs'}</span>
              </button>
            </div>
          </div>

          {error && (
            <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-800 text-xs font-bold flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-600" />
              <span>{error}</span>
            </div>
          )}

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

          {/* TAB 1: OVERVIEW */}
          {activeTab === 'OVERVIEW' && (
            <div id="tabpanel-OVERVIEW" role="tabpanel" aria-labelledby="tab-OVERVIEW" className="space-y-6">
              <ZMCCManagerOverview
                logs={filteredLogs}
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
                  fetchLogs(f, t);
                }}
              />
            </div>
          )}

          {/* TAB 2: LIVE DISPATCHES */}
          {activeTab === 'LIVE' && (
            <div id="tabpanel-LIVE" role="tabpanel" aria-labelledby="tab-LIVE" className="space-y-6">
              <ZMCCManagerLiveDispatches
                logs={filteredLogs}
                assignedSourceName={assignedSourceName}
                onInspectDetails={(l) => setSelectedLog(l)}
              />
            </div>
          )}

          {/* TAB 3: CROSS VERIFICATION */}
          {activeTab === 'CROSS_VERIFICATION' && (
            <div id="tabpanel-CROSS_VERIFICATION" role="tabpanel" aria-labelledby="tab-CROSS_VERIFICATION" className="space-y-6">
              <div className="p-5 rounded-xl bg-[#FFFFFF] border border-[#EAE4D5]/80 shadow-sm space-y-4">
                <div className="flex items-center justify-between pb-2 border-b border-[#EAE4D5]/80">
                  <div className="flex items-center space-x-2">
                    <ArrowRightLeft className="w-5 h-5 text-[#1E3A8A]" />
                    <h3 className="text-sm font-extrabold text-[#111311]">
                      Authoritative Cross-Verification Ledger: {assignedSourceName}
                    </h3>
                  </div>
                  <span className="text-xs font-mono font-bold text-slate-500">
                    Source-Locked ({filteredLogs.length} Records)
                  </span>
                </div>
                <p className="text-xs text-[#334155] font-semibold">
                  Comparing declared ZMCC dispatch figures (Gross Liters, LR, Fat, 13% TS) against official plant scale and laboratory measurements.
                </p>
              </div>

              <ZonalHistoryTable
                logs={filteredLogs}
                targetZone={assignedSourceName}
                onInspectDetails={(l) => setSelectedLog(l)}
                currentFromDate={fromDate}
                currentToDate={toDate}
                onDateFilterChange={(f, t) => {
                  setFromDate(f || '');
                  setToDate(t || '');
                  fetchLogs(f, t);
                }}
              />
            </div>
          )}

          {/* TAB 4: QUALITY & REJECTIONS (4D-D Foundation) */}
          {activeTab === 'QUALITY' && (
            <div id="tabpanel-QUALITY" role="tabpanel" aria-labelledby="tab-QUALITY" className="space-y-6">
              <div className="p-6 rounded-xl bg-[#FFFFFF] border border-[#EAE4D5]/80 shadow-sm space-y-3">
                <div className="flex items-center space-x-2 text-[#991B1B]">
                  <AlertTriangle className="w-5 h-5" />
                  <h3 className="text-sm font-extrabold text-[#111311]">Quality Analysis & Portion Rejections</h3>
                </div>
                <p className="text-xs text-slate-600">
                  Detailed quality comparison breakdown and quarantine/rejection root-cause tracking for <strong>{assignedSourceName}</strong>.
                </p>
                <div className="p-4 rounded-lg bg-amber-50/60 border border-amber-200 text-xs font-semibold text-amber-900 flex items-start gap-2.5">
                  <Info className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold">Quality & Rejections Workspace</span>
                    <p className="text-[11px] text-amber-800 mt-0.5">
                      Highlights rejected portions, test deviations (LR, Fat, Acidity, Temperature, Adulteration), and QA rejection rationales. Full analytical charts will be expanded in Stage 4D-D.
                    </p>
                  </div>
                </div>
              </div>

              <ZonalHistoryTable
                logs={filteredLogs.filter((l) => String(l.calculated_status).toUpperCase() === 'REJECTED' || String(l.status).toUpperCase().includes('REJECT'))}
                targetZone={assignedSourceName}
                onInspectDetails={(l) => setSelectedLog(l)}
                currentFromDate={fromDate}
                currentToDate={toDate}
                onDateFilterChange={(f, t) => {
                  setFromDate(f || '');
                  setToDate(t || '');
                  fetchLogs(f, t);
                }}
              />
            </div>
          )}

          {/* TAB 5: RECEIPTS & PERFORMANCE (4D-E Foundation) */}
          {activeTab === 'RECEIPTS' && (
            <div id="tabpanel-RECEIPTS" role="tabpanel" aria-labelledby="tab-RECEIPTS" className="space-y-6">
              <div className="p-6 rounded-xl bg-[#FFFFFF] border border-[#EAE4D5]/80 shadow-sm space-y-3">
                <div className="flex items-center space-x-2 text-[#166534]">
                  <TrendingUp className="w-5 h-5" />
                  <h3 className="text-sm font-extrabold text-[#111311]">Final Silo Receipts & Quantity Performance</h3>
                </div>
                <p className="text-xs text-slate-600">
                  Authoritative weighbridge receipts, net milk weight reconciliations, and silo allocation performance for <strong>{assignedSourceName}</strong>.
                </p>
                <div className="p-4 rounded-lg bg-emerald-50/60 border border-emerald-200 text-xs font-semibold text-emerald-900 flex items-start gap-2.5">
                  <Info className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold">Receipts & Performance Workspace</span>
                    <p className="text-[11px] text-emerald-800 mt-0.5">
                      Physical Received Liters and @13% TS volume metrics computed from official First Weight and Second Weight weighbridge scale operations. Detailed trend reports will be expanded in Stage 4D-E.
                    </p>
                  </div>
                </div>
              </div>

              <ZonalHistoryTable
                logs={filteredLogs.filter((l) => ['READY_FOR_GATE_EXIT', 'COMPLETED', 'GATE_OUT'].includes(String(l.status).toUpperCase()))}
                targetZone={assignedSourceName}
                onInspectDetails={(l) => setSelectedLog(l)}
                currentFromDate={fromDate}
                currentToDate={toDate}
                onDateFilterChange={(f, t) => {
                  setFromDate(f || '');
                  setToDate(t || '');
                  fetchLogs(f, t);
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
                    Total Dispatches: {filteredLogs.length}
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
                logs={filteredLogs}
                targetZone={assignedSourceName}
                onInspectDetails={(l) => setSelectedLog(l)}
                currentFromDate={fromDate}
                currentToDate={toDate}
                onDateFilterChange={(f, t) => {
                  setFromDate(f || '');
                  setToDate(t || '');
                  fetchLogs(f, t);
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
