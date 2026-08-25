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
import { ManagerAttentionPanel } from './ManagerAttentionPanel';
import { ZonalHistoryTable } from '@modules/dashboard/ZonalHistoryTable';
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
} from 'lucide-react';

interface ZMCCManagerOverviewProps {
  logs: MilkProcessLog[];
  serverBusinessDate: string;
  assignedSourceName: string;
  dateRange: OverviewDateRange;
  onDateRangeChange: (range: OverviewDateRange) => void;
  onInspectDetails: (log: MilkProcessLog) => void;
  onNavigateToTab: (tab: any) => void;
  currentFromDate?: string;
  currentToDate?: string;
  onDateFilterChange?: (fromDate?: string, toDate?: string) => void;
}

export const ZMCCManagerOverview: React.FC<ZMCCManagerOverviewProps> = ({
  logs,
  serverBusinessDate,
  assignedSourceName,
  dateRange,
  onDateRangeChange,
  onInspectDetails,
  onNavigateToTab,
  currentFromDate,
  currentToDate,
  onDateFilterChange,
}) => {
  // Compute overview metrics
  const metrics: ZMCCManagerOverviewMetrics = useMemo(() => {
    return computeManagerOverview(logs, serverBusinessDate, dateRange);
  }, [logs, serverBusinessDate, dateRange]);

  // Derive attention items
  const attentionItems = useMemo(() => {
    return deriveManagerAttention(logs);
  }, [logs]);

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
                Current Business Date: {serverBusinessDate || 'Live'} (08:00 PKT operational grouping)
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
              <option value="TODAY">Today ({serverBusinessDate || 'Live'})</option>
              <option value="YESTERDAY">Yesterday</option>
              <option value="LAST_7">Last 7 Days</option>
              <option value="LAST_15">Last 15 Days</option>
              <option value="ALL">All Time</option>
            </select>
          </div>
        </div>

        {/* 2. Primary 4 Operational KPI Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
          {/* Card A: Dispatched */}
          <div className="p-4 rounded-xl bg-[#EFF6FF] border border-[#BFDBFE] shadow-xs flex items-center justify-between">
            <div>
              <p className="text-[11px] font-extrabold text-[#1E40AF] uppercase tracking-wider">
                Dispatched ({dateRange})
              </p>
              <h2 className="text-2xl font-black font-mono text-[#111311] mt-1">
                {metrics.dispatchedCount}
              </h2>
              <span className="text-[10px] font-bold text-[#1E40AF]">Vehicle Dispatches</span>
            </div>
            <div className="p-2.5 rounded-xl bg-[#FFFFFF] border border-[#BFDBFE] text-[#1E40AF]">
              <Truck className="w-5 h-5" />
            </div>
          </div>

          {/* Card B: Currently in Plant */}
          <div className="p-4 rounded-xl bg-[#FAF5FF] border border-[#E9D5FF] shadow-xs flex items-center justify-between">
            <div>
              <p className="text-[11px] font-extrabold text-[#6B21A8] uppercase tracking-wider">
                Currently in Plant
              </p>
              <h2 className="text-2xl font-black font-mono text-[#111311] mt-1">
                {metrics.currentlyInPlantCount}
              </h2>
              <span className="text-[10px] font-bold text-[#6B21A8]">Active in Factory</span>
            </div>
            <div className="p-2.5 rounded-xl bg-[#FFFFFF] border border-[#E9D5FF] text-[#6B21A8]">
              <Factory className="w-5 h-5" />
            </div>
          </div>

          {/* Card C: Completed */}
          <div className="p-4 rounded-xl bg-[#F0FDF4] border border-[#BBF7D0] shadow-xs flex items-center justify-between">
            <div>
              <p className="text-[11px] font-extrabold text-[#166534] uppercase tracking-wider">
                Completed ({dateRange})
              </p>
              <h2 className="text-2xl font-black font-mono text-[#111311] mt-1">
                {metrics.completedCount}
              </h2>
              <span className="text-[10px] font-bold text-[#166534]">Final Silo Receipts</span>
            </div>
            <div className="p-2.5 rounded-xl bg-[#FFFFFF] border border-[#BBF7D0] text-[#166534]">
              <TrendingUp className="w-5 h-5" />
            </div>
          </div>

          {/* Card D: QA Rejected Portions */}
          <div className="p-4 rounded-xl bg-[#FEF2F2] border border-[#FECACA] shadow-xs flex items-center justify-between">
            <div>
              <p className="text-[11px] font-extrabold text-[#991B1B] uppercase tracking-wider">
                Rejected Portions ({dateRange})
              </p>
              <h2 className="text-2xl font-black font-mono text-[#991B1B] mt-1">
                {metrics.rejectedPortionsCount}
              </h2>
              <span className="text-[10px] font-bold text-[#991B1B]">Portion QA Rejections</span>
            </div>
            <div className="p-2.5 rounded-xl bg-[#FFFFFF] border border-[#FECACA] text-[#991B1B]">
              <AlertTriangle className="w-5 h-5" />
            </div>
          </div>
        </div>

        {/* 3. Secondary Quantity & Volume Summary */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 pt-2 border-t border-[#EAE4D5]/80 font-mono">
          {/* Physical Volume Summary */}
          <div className="p-4 rounded-xl bg-[#FDFBF9] border border-[#EAE4D5] space-y-2">
            <div className="flex items-center justify-between font-sans">
              <span className="text-xs font-black text-[#111311] flex items-center gap-1.5">
                <Scale className="w-4 h-4 text-[#1E3A8A]" />
                <span>Physical Volume Summary ({dateRange})</span>
              </span>
              <span className="text-[10px] font-bold text-slate-500">Gross Liters vs Physical Received</span>
            </div>
            <div className="grid grid-cols-3 gap-2 text-xs pt-1">
              <div>
                <span className="text-[9.5px] text-slate-500 font-sans block">Dispatch Gross:</span>
                <span className="font-black text-[#111311]">
                  {metrics.totalDispatchGrossLiters.toLocaleString()} L
                </span>
              </div>
              <div>
                <span className="text-[9.5px] text-slate-500 font-sans block">Physical Received:</span>
                <span className="font-black text-[#166534]">
                  {metrics.totalPhysicalReceivedLiters.toLocaleString()} L
                </span>
              </div>
              <div>
                <span className="text-[9.5px] text-slate-500 font-sans block">Difference:</span>
                <span
                  className={`font-black ${
                    metrics.quantityDifferenceLiters >= 0 ? 'text-[#166534]' : 'text-[#991B1B]'
                  }`}
                >
                  {metrics.quantityDifferenceLiters > 0
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
                <span>13% TS Volume Summary ({dateRange})</span>
              </span>
              <span className="text-[10px] font-bold text-slate-500">Normalized Solids Metric</span>
            </div>
            <div className="grid grid-cols-3 gap-2 text-xs pt-1">
              <div>
                <span className="text-[9.5px] text-slate-500 font-sans block">Dispatch @ 13% TS:</span>
                <span className="font-black text-[#111311]">
                  {metrics.totalDispatch13TsLiters.toLocaleString()} L
                </span>
              </div>
              <div>
                <span className="text-[9.5px] text-slate-500 font-sans block">Plant @ 13% TS:</span>
                <span className="font-black text-[#6B21A8]">
                  {metrics.totalPlant13TsLiters.toLocaleString()} L
                </span>
              </div>
              <div>
                <span className="text-[9.5px] text-slate-500 font-sans block">TS Variance:</span>
                <span
                  className={`font-black ${
                    metrics.tsDifferenceLiters >= 0 ? 'text-[#166534]' : 'text-[#991B1B]'
                  }`}
                >
                  {metrics.tsDifferenceLiters > 0
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
        <div className="flex items-center justify-between">
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
            <span>View Full History</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <ZonalHistoryTable
          logs={logs.slice(0, 10)}
          targetZone={assignedSourceName}
          onInspectDetails={onInspectDetails}
          currentFromDate={currentFromDate}
          currentToDate={currentToDate}
          onDateFilterChange={onDateFilterChange}
        />
      </div>
    </div>
  );
};
