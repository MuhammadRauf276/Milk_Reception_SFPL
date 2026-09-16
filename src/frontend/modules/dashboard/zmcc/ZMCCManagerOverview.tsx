'use client';

import React, { useMemo } from 'react';
import { MilkProcessLog } from '@backend/core/types';
import {
  OverviewDateRange,
  ZMCCManagerOverviewMetrics,
} from './zmccManagerTypes';
import {
  computeManagerOverview,
  deriveManagerAttention,
} from './zmccManagerHelpers';
import { getPakistanCalendarDate } from '@backend/core/business-day';
import { ManagerAttentionPanel } from './ManagerAttentionPanel';
import {
  Truck,
  FlaskConical,
  Scale,
  Factory,
  ArrowRightLeft,
  Calendar,
  Layers,
  History,
  ChevronRight,
  TrendingUp,
  AlertTriangle,
  RefreshCw,
  Milk,
  Clock,
  CheckCircle2,
} from 'lucide-react';

interface ZMCCManagerOverviewProps {
  logs: MilkProcessLog[];
  serverBusinessDate?: string;
  serverCalendarDate?: string;
  assignedSourceName: string;
  dateRange: OverviewDateRange;
  onDateRangeChange: (range: OverviewDateRange) => void;
  onInspectDetails: (log: MilkProcessLog) => void;
  onNavigateToTab: (tab: any) => void;
  currentFromDate?: string;
  currentToDate?: string;
  onDateFilterChange?: (fromDate?: string, toDate?: string) => void;
  isLoading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  pagination?: {
    page: number;
    totalPages: number;
    totalRecords: number;
    hasMore: boolean;
  };
  summary?: {
    totalVisits?: number;
    completedVisits?: number;
    activeInPlantVisits?: number;
  };
  liveActiveInPlantCount?: number | null;
  zmccTankStock?: number | null;
  todayAcceptedIntakeLiters?: number | null;
  vehiclesInsideZmccCount?: number | null;
}

export const ZMCCManagerOverview: React.FC<ZMCCManagerOverviewProps> = ({
  logs,
  serverBusinessDate,
  serverCalendarDate,
  assignedSourceName,
  dateRange,
  onDateRangeChange,
  onInspectDetails,
  onNavigateToTab,
  currentFromDate,
  currentToDate,
  onDateFilterChange,
  isLoading = false,
  error = null,
  onRetry,
  pagination,
  summary,
  liveActiveInPlantCount,
  zmccTankStock,
  todayAcceptedIntakeLiters,
  vehiclesInsideZmccCount,
}) => {
  const displayCalendarDate = serverCalendarDate || getPakistanCalendarDate(new Date());

  // Compute overview metrics
  const metrics: ZMCCManagerOverviewMetrics = useMemo(() => {
    return computeManagerOverview(logs, displayCalendarDate, dateRange);
  }, [logs, displayCalendarDate, dateRange]);

  // Derive attention items
  const attentionItems = useMemo(() => {
    return deriveManagerAttention(logs);
  }, [logs]);

  // Error State Render: Never show KPI numbers or zeros on error
  if (error) {
    return (
      <div className="p-8 rounded-xl bg-[#FEF2F2] border border-[#FECACA] text-center space-y-3" role="alert">
        <div className="w-12 h-12 rounded-full bg-red-100 text-red-600 flex items-center justify-center mx-auto border border-red-200">
          <AlertTriangle className="w-6 h-6" />
        </div>
        <h4 className="text-base font-extrabold text-[#991B1B]">Unable to Load Manager Overview Data</h4>
        <p className="text-xs text-red-700 max-w-md mx-auto">{error}</p>
        {onRetry && (
          <button
            onClick={onRetry}
            className="inline-flex items-center space-x-1.5 px-4 py-2 rounded-xl bg-[#991B1B] text-white text-xs font-bold hover:bg-red-800 transition"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Retry Loading</span>
          </button>
        )}
      </div>
    );
  }

  // Loading State: Render skeletons rather than authoritative business zeros
  if (isLoading && logs.length === 0) {
    return (
      <div className="space-y-6" aria-busy="true" aria-label="Loading overview data">
        <div className="p-5 rounded-xl bg-[#FFFFFF] border border-[#EAE4D5]/80 shadow-sm animate-pulse space-y-4">
          <div className="h-6 bg-slate-200 rounded w-1/3" />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-24 bg-slate-100 rounded-xl" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6" role="region" aria-label="ZMCC Manager Overview">
      {/* 1. Date Range & Scope Header */}
      <div className="p-5 rounded-xl bg-[#FFFFFF] border border-[#EAE4D5]/80 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-[#EAE4D5]/80">
          <div className="flex items-center space-x-2">
            <Layers className="w-5 h-5 text-[#1E3A8A]" />
            <div>
              <h3 className="text-sm font-extrabold text-[#111311]">
                Operational Overview: {assignedSourceName}
              </h3>
              <p className="text-[11px] text-slate-500 font-semibold mt-0.5">
                Pakistan Calendar Date: {displayCalendarDate}
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <span className="text-xs font-extrabold text-[#334155] flex items-center gap-1">
              <Calendar className="w-3.5 h-3.5 text-[#1E3A8A]" /> Period:
            </span>
            <select
              value={dateRange}
              onChange={(e) => onDateRangeChange(e.target.value as OverviewDateRange)}
              aria-label="Select overview period"
              className="px-3 py-1.5 text-xs font-extrabold rounded-lg bg-[#FDFBF9] border border-[#EAE4D5]/80 text-[#111311] focus:ring-2 focus:ring-[#1E3A8A] outline-none shadow-sm"
            >
              <option value="TODAY">Today ({displayCalendarDate})</option>
              <option value="YESTERDAY">Yesterday</option>
              <option value="LAST_7">Last 7 Days</option>
              <option value="LAST_15">Last 15 Days</option>
              <option value="ALL">All Time</option>
            </select>
          </div>
        </div>

        {/* Bounded Page Notice */}
        {pagination && pagination.totalPages > 1 && (
          <div className="flex items-center justify-between p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-800">
            <div className="flex items-center space-x-2">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
              <span>
                Showing page <strong>{pagination.page}</strong> of <strong>{pagination.totalPages}</strong> ({pagination.totalRecords} total visits in query). Volume, variance, and exceptions/attention reflect the visible page.
              </span>
            </div>
            <span className="text-[11px] font-bold text-amber-700">Bounded page metrics</span>
          </div>
        )}

        {/* 2. Primary 6 Operational KPI Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3.5">
          {/* Card 1: Current ZMCC Tank Stock */}
          <div className="p-4 rounded-xl bg-[#EFF6FF] border border-[#BFDBFE] shadow-xs flex items-center justify-between">
            <div>
              <p className="text-[10.5px] font-extrabold text-[#1E40AF] uppercase tracking-wider">
                Current Tank Stock
              </p>
              <h2 className="text-xl font-black font-mono text-[#111311] mt-1">
                {zmccTankStock != null ? `${zmccTankStock.toLocaleString()} L` : '—'}
              </h2>
              <span className="text-[10px] font-bold text-[#1E40AF]">
                Active Storage Tanks
              </span>
            </div>
            <div className="p-2.5 rounded-xl bg-[#FFFFFF] border border-[#BFDBFE] text-[#1E40AF]">
              <Milk className="w-5 h-5" />
            </div>
          </div>

          {/* Card 2: Today Accepted Intake */}
          <div className="p-4 rounded-xl bg-[#F0FDF4] border border-[#BBF7D0] shadow-xs flex items-center justify-between">
            <div>
              <p className="text-[10.5px] font-extrabold text-[#166534] uppercase tracking-wider">
                Today Accepted Intake
              </p>
              <h2 className="text-xl font-black font-mono text-[#111311] mt-1">
                {todayAcceptedIntakeLiters != null ? `${todayAcceptedIntakeLiters.toLocaleString()} L` : '—'}
              </h2>
              <span className="text-[10px] font-bold text-[#166534]">
                Authoritative Accepted Liters
              </span>
            </div>
            <div className="p-2.5 rounded-xl bg-[#FFFFFF] border border-[#BBF7D0] text-[#166534]">
              <CheckCircle2 className="w-5 h-5" />
            </div>
          </div>

          {/* Card 3: Today Dispatch to Plant */}
          <div className="p-4 rounded-xl bg-[#F8FAFC] border border-[#CBD5E1] shadow-xs flex items-center justify-between">
            <div>
              <p className="text-[10.5px] font-extrabold text-[#334155] uppercase tracking-wider">
                {dateRange === 'TODAY'
                  ? 'Today Dispatches to Plant'
                  : 'Dispatches to Plant'}
              </p>
              <h2 className="text-xl font-black font-mono text-[#111311] mt-1">
                {summary?.totalVisits != null ? summary.totalVisits : '—'}
              </h2>
              <span className="text-[10px] font-bold text-[#475569]">
                Visits in selected period
              </span>
            </div>
            <div className="p-2.5 rounded-xl bg-[#FFFFFF] border border-[#CBD5E1] text-[#334155]">
              <Truck className="w-5 h-5" />
            </div>
          </div>

          {/* Card 4: Vehicles Inside ZMCC */}
          <div className="p-4 rounded-xl bg-[#FFFBEB] border border-[#FDE68A] shadow-xs flex items-center justify-between">
            <div>
              <p className="text-[10.5px] font-extrabold text-[#92400E] uppercase tracking-wider">
                Vehicles Inside ZMCC
              </p>
              <h2 className="text-xl font-black font-mono text-[#111311] mt-1">
                {vehiclesInsideZmccCount != null ? vehiclesInsideZmccCount : '—'}
              </h2>
              <span className="text-[10px] font-bold text-[#92400E]">
                Yard / Intake / Lab
              </span>
            </div>
            <div className="p-2.5 rounded-xl bg-[#FFFFFF] border border-[#FDE68A] text-[#92400E]">
              <Clock className="w-5 h-5" />
            </div>
          </div>

          {/* Card 5: Active Plant-Bound Vehicles */}
          <div className="p-4 rounded-xl bg-[#FAF5FF] border border-[#E9D5FF] shadow-xs flex items-center justify-between">
            <div>
              <p className="text-[10.5px] font-extrabold text-[#6B21A8] uppercase tracking-wider">
                Active Plant-Bound
              </p>
              <h2 className="text-xl font-black font-mono text-[#111311] mt-1">
                {liveActiveInPlantCount != null ? liveActiveInPlantCount : '—'}
              </h2>
              <span className="text-[10px] font-bold text-[#6B21A8]">
                Live Active Tankers
              </span>
            </div>
            <div className="p-2.5 rounded-xl bg-[#FFFFFF] border border-[#E9D5FF] text-[#6B21A8]">
              <Factory className="w-5 h-5" />
            </div>
          </div>

          {/* Card 6: Needs Attention */}
          <div className="p-4 rounded-xl bg-[#FEF2F2] border border-[#FECACA] shadow-xs flex items-center justify-between">
            <div>
              <p className="text-[10.5px] font-extrabold text-[#991B1B] uppercase tracking-wider">
                Needs Attention
              </p>
              <h2 className="text-xl font-black font-mono text-[#991B1B] mt-1">
                {attentionItems.length}
              </h2>
              <span className="text-[10px] font-bold text-[#991B1B]">
                {pagination && pagination.totalPages > 1
                  ? 'Current Page Exceptions'
                  : 'Actionable Exceptions'}
              </span>
            </div>
            <div className="p-2.5 rounded-xl bg-[#FFFFFF] border border-[#FECACA] text-[#991B1B]">
              <AlertTriangle className="w-5 h-5" />
            </div>
          </div>
        </div>

        {/* 3. Secondary Quantity & Volume Summary (Missing != Zero) */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 pt-2 border-t border-[#EAE4D5]/80 font-mono">
          {/* Physical Volume Summary */}
          <div className="p-4 rounded-xl bg-[#FDFBF9] border border-[#EAE4D5] space-y-2">
            <div className="flex items-center justify-between font-sans">
              <span className="text-xs font-black text-[#111311] flex items-center gap-1.5">
                <Scale className="w-4 h-4 text-[#1E3A8A]" />
                <span>Physical Volume Summary ({pagination && pagination.totalPages > 1 ? 'Current Page' : dateRange})</span>
              </span>
              <span className="text-[10px] font-bold text-slate-500">
                {pagination && pagination.totalPages > 1
                  ? `Page Gross vs Received (Page ${pagination.page} of ${pagination.totalPages})`
                  : 'Gross Liters vs Physical Received'}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2 text-xs pt-1">
              <div>
                <span className="text-[9.5px] text-slate-500 font-sans block">Dispatch Gross:</span>
                <span className="font-black text-[#111311]">
                  {metrics.totalDispatchGrossLiters != null
                    ? `${metrics.totalDispatchGrossLiters.toLocaleString()} L`
                    : '—'}
                </span>
              </div>
              <div>
                <span className="text-[9.5px] text-slate-500 font-sans block">Physical Received:</span>
                <span className="font-black text-[#166534]">
                  {metrics.totalPhysicalReceivedLiters != null
                    ? `${metrics.totalPhysicalReceivedLiters.toLocaleString()} L`
                    : '—'}
                </span>
              </div>
              <div>
                <span className="text-[9.5px] text-slate-500 font-sans block">Difference:</span>
                <span
                  className={`font-black ${
                    metrics.quantityDifferenceLiters == null
                      ? 'text-slate-500'
                      : metrics.quantityDifferenceLiters >= 0
                      ? 'text-[#166534]'
                      : 'text-[#991B1B]'
                  }`}
                >
                  {metrics.quantityDifferenceLiters == null
                    ? '—'
                    : metrics.quantityDifferenceLiters > 0
                    ? `+${metrics.quantityDifferenceLiters.toLocaleString()} L`
                    : `${metrics.quantityDifferenceLiters.toLocaleString()} L`}
                </span>
              </div>
            </div>
          </div>

          {/* 13% TS Equivalent Volume Summary */}
          <div className="p-4 rounded-xl bg-[#FDFBF9] border border-[#EAE4D5] space-y-2">
            <div className="flex items-center justify-between font-sans">
              <span className="text-xs font-black text-[#111311] flex items-center gap-1.5">
                <FlaskConical className="w-4 h-4 text-[#6B21A8]" />
                <span>13% TS Volume Summary ({pagination && pagination.totalPages > 1 ? 'Current Page' : dateRange})</span>
              </span>
              <span className="text-[10px] font-bold text-slate-500">
                {pagination && pagination.totalPages > 1
                  ? `Normalized Solids (Page ${pagination.page} of ${pagination.totalPages})`
                  : 'Normalized Solids Metric'}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2 text-xs pt-1">
              <div>
                <span className="text-[9.5px] text-slate-500 font-sans block">Dispatch @ 13% TS:</span>
                <span className="font-black text-[#111311]">
                  {metrics.totalDispatch13TsLiters != null
                    ? `${metrics.totalDispatch13TsLiters.toLocaleString()} L`
                    : '—'}
                </span>
              </div>
              <div>
                <span className="text-[9.5px] text-slate-500 font-sans block">Plant @ 13% TS:</span>
                <span className="font-black text-[#6B21A8]">
                  {metrics.totalPlant13TsLiters != null
                    ? `${metrics.totalPlant13TsLiters.toLocaleString()} L`
                    : '—'}
                </span>
              </div>
              <div>
                <span className="text-[9.5px] text-slate-500 font-sans block">TS Variance:</span>
                <span
                  className={`font-black ${
                    metrics.tsDifferenceLiters == null
                      ? 'text-slate-500'
                      : metrics.tsDifferenceLiters >= 0
                      ? 'text-[#166534]'
                      : 'text-[#991B1B]'
                  }`}
                >
                  {metrics.tsDifferenceLiters == null
                    ? '—'
                    : metrics.tsDifferenceLiters > 0
                    ? `+${metrics.tsDifferenceLiters.toLocaleString()} L`
                    : `${metrics.tsDifferenceLiters.toLocaleString()} L`}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 4. Needs Attention Panel */}
      <ManagerAttentionPanel items={attentionItems} onInspectDetails={onInspectDetails} />

      {/* 5. Quick Recent Dispatches Preview */}
      <div className="p-5 rounded-xl bg-[#FFFFFF] border border-[#EAE4D5]/80 shadow-sm space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-[#EAE4D5]/80">
          <div className="flex items-center space-x-2">
            <History className="w-4 h-4 text-[#1E3A8A]" />
            <h3 className="text-sm font-extrabold text-[#111311]">
              Recent Dispatches ({logs.length} Total Logs)
            </h3>
          </div>
          <button
            onClick={() => onNavigateToTab('HISTORY')}
            className="text-xs font-extrabold text-[#1E3A8A] hover:underline flex items-center gap-1"
          >
            <span>View Full History Archive</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {logs.length === 0 ? (
          <div className="py-6 text-center text-xs text-slate-500 font-semibold">
            No dispatches recorded for the selected period.
          </div>
        ) : (
          <div className="divide-y divide-[#EAE4D5]/40 text-xs">
            {logs.slice(0, 5).map((log) => (
              <div
                key={log.id}
                className="py-2.5 flex items-center justify-between hover:bg-[#FDFBF9] transition-colors rounded px-2"
              >
                <div className="flex items-center space-x-3">
                  <span className="font-extrabold text-slate-900 font-mono">
                    {log.vehicle_number}
                  </span>
                  {log.token_number && (
                    <span className="text-[11px] font-mono text-slate-500">
                      Token: {log.token_number}
                    </span>
                  )}
                  <span className="text-[11px] text-slate-600">
                    Date: {log.dispatch_date || '—'}
                  </span>
                </div>

                <div className="flex items-center space-x-3">
                  <span className="px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider bg-slate-100 text-slate-800">
                    {log.status || 'In Progress'}
                  </span>
                  <button
                    onClick={() => onInspectDetails(log)}
                    className="text-xs font-bold text-[#1E3A8A] hover:underline"
                  >
                    View Details
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
