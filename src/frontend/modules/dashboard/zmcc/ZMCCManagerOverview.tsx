'use client';

import React, { useMemo } from 'react';
import { ZmccManagerExitPanel } from './ZmccManagerSnapshot';
import { MilkProcessLog } from '@backend/core/types';
import {
  OverviewDateRange,
  ZMCCManagerOverviewMetrics,
  ZMCCManagerTab,
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
  Building2,
  Calendar,
  Layers,
  History,
  ChevronRight,
  AlertTriangle,
  Milk,
  Clock,
  CheckCircle2,
} from 'lucide-react';
import { StatCard } from '@/components/ui/stat-card';

interface ZMCCManagerOverviewProps {
  logs: MilkProcessLog[];
  serverBusinessDate?: string;
  serverCalendarDate?: string;
  assignedSourceName: string;
  dateRange: OverviewDateRange;
  onDateRangeChange: (range: OverviewDateRange) => void;
  onInspectDetails: (log: MilkProcessLog) => void;
  onNavigateToTab: (tab: ZMCCManagerTab) => void;
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
  serverCalendarDate,
  assignedSourceName,
  dateRange,
  onDateRangeChange,
  onInspectDetails,
  onNavigateToTab,
  isLoading = false,
  error = null,
  onRetry,
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
      <div className="bg-card border-border p-8 rounded-xl border text-center space-y-3" role="alert">
        <div className="w-12 h-12 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center mx-auto border border-rose-200">
          <AlertTriangle className="w-6 h-6" />
        </div>
        <h4 className="text-base font-semibold text-rose-800">Unable to Load Manager Overview Data</h4>
        <p className="text-xs text-rose-700 max-w-md mx-auto">{error}</p>
        {onRetry && (
          <button
            onClick={onRetry}
            className="inline-flex items-center space-x-1.5 px-4 py-2 rounded-xl bg-rose-700 text-white text-xs font-semibold hover:bg-rose-800 transition min-h-11"
          >
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
        <div className="p-5 rounded-xl bg-card border border-border/80 shadow-xs animate-pulse space-y-4">
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
      <div className="p-5 rounded-xl bg-card border border-border/80 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-border/80">
          <div className="flex items-center space-x-2">
            <Layers className="w-5 h-5 text-primary" />
            <div>
              <h3 className="text-sm font-semibold text-foreground">
                {assignedSourceName} overview
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                {displayCalendarDate}
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <span className="text-xs font-semibold text-slate-700 flex items-center gap-1">
              <Calendar className="w-3.5 h-3.5 text-primary" /> Period:
            </span>
            <select
              value={dateRange}
              onChange={(e) => onDateRangeChange(e.target.value as OverviewDateRange)}
              aria-label="Select overview period"
              className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-subtle border border-border/80 text-foreground focus:ring-2 focus:ring-primary outline-hidden shadow-xs min-h-11"
            >
              <option value="TODAY">Today ({displayCalendarDate})</option>
              <option value="YESTERDAY">Yesterday</option>
              <option value="LAST_7">Last 7 Days</option>
              <option value="LAST_15">Last 15 Days</option>
              <option value="ALL">All time</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 stagger-children">
          <StatCard
            label="Current tank stock"
            icon={Milk}
            tone="info"
            value={zmccTankStock != null ? `${zmccTankStock.toLocaleString()} L` : '—'}
          />
          <StatCard
            label="Accepted intake today"
            icon={CheckCircle2}
            tone="success"
            value={todayAcceptedIntakeLiters != null ? `${todayAcceptedIntakeLiters.toLocaleString()} L` : '0 L'}
          />
          <StatCard
            label="Dispatches to plant"
            icon={Truck}
            value={summary?.totalVisits != null ? summary.totalVisits : '—'}
          />
          <StatCard
            label="Vehicles inside ZMCC"
            icon={Clock}
            tone="warning"
            value={vehiclesInsideZmccCount != null ? vehiclesInsideZmccCount : '—'}
          />
          <StatCard
            label="Active plant-bound"
            icon={Building2}
            value={liveActiveInPlantCount != null ? liveActiveInPlantCount : '—'}
          />
          <StatCard
            label="Needs attention"
            icon={AlertTriangle}
            tone={attentionItems.length > 0 ? 'danger' : 'default'}
            value={attentionItems.length}
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 pt-2 border-t border-border/80 tabular-nums">
          <div className="bg-card border-border p-4 rounded-xl border space-y-2">
            <div className="flex items-center justify-between font-sans">
              <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                <Scale className="w-4 h-4 text-primary" />
                <span>Gross Volume</span>
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2 text-xs pt-1">
              <div>
                <span className="text-xs text-slate-500 font-sans block">Dispatch gross</span>
                <span className="font-semibold text-foreground">
                  {metrics.totalDispatchGrossLiters != null
                    ? `${metrics.totalDispatchGrossLiters.toLocaleString()} L`
                    : '—'}
                </span>
              </div>
              <div>
                <span className="text-xs text-slate-500 font-sans block">Physical received</span>
                <span className="font-semibold text-emerald-800">
                  {metrics.totalPhysicalReceivedLiters != null
                    ? `${metrics.totalPhysicalReceivedLiters.toLocaleString()} L`
                    : '—'}
                </span>
              </div>
              <div>
                <span className="text-xs text-slate-500 font-sans block">Difference</span>
                <span
                  className={`font-semibold ${
                    metrics.quantityDifferenceLiters == null
                      ? 'text-slate-500'
                      : metrics.quantityDifferenceLiters >= 0
                      ? 'text-emerald-800'
                      : 'text-rose-800'
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

          <div className="bg-card border-border p-4 rounded-xl border space-y-2">
            <div className="flex items-center justify-between font-sans">
              <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                <FlaskConical className="w-4 h-4 text-primary" />
                <span>Commercial Volume</span>
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2 text-xs pt-1">
              <div>
                <span className="text-xs text-slate-500 font-sans block">Dispatch @13% TS</span>
                <span className="font-semibold text-foreground">
                  {metrics.totalDispatch13TsLiters != null
                    ? `${metrics.totalDispatch13TsLiters.toLocaleString()} L`
                    : '—'}
                </span>
              </div>
              <div>
                <span className="text-xs text-slate-500 font-sans block">Plant @13% TS</span>
                <span className="font-semibold text-foreground">
                  {metrics.totalPlant13TsLiters != null
                    ? `${metrics.totalPlant13TsLiters.toLocaleString()} L`
                    : '—'}
                </span>
              </div>
              <div>
                <span className="text-xs text-slate-500 font-sans block">TS variance</span>
                <span
                  className={`font-semibold ${
                    metrics.tsDifferenceLiters == null
                      ? 'text-slate-500'
                      : metrics.tsDifferenceLiters >= 0
                      ? 'text-emerald-800'
                      : 'text-rose-800'
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

      <ManagerAttentionPanel items={attentionItems} onInspectDetails={onInspectDetails} />

      <div className="p-5 rounded-xl bg-card border border-border/80 shadow-xs space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-border/80">
          <div className="flex items-center space-x-2">
            <History className="w-4 h-4 text-primary" />
            <h3 className="text-sm font-semibold text-foreground">
              Recent dispatches
            </h3>
          </div>
          <button
            onClick={() => onNavigateToTab('HISTORY')}
            className="text-xs font-semibold text-primary hover:underline flex items-center gap-1 min-h-11 min-w-11"
          >
            <span>History</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {logs.length === 0 ? (
          <div className="py-6 text-center text-xs text-slate-500 font-semibold">
            No dispatches
          </div>
        ) : (
          <div className="divide-y divide-border/40 text-xs">
            {logs.slice(0, 5).map((log) => (
              <div
                key={log.id}
                className="py-2.5 flex items-center justify-between hover:bg-subtle transition-colors rounded px-2"
              >
                <div className="flex items-center space-x-3">
                  <span className="font-semibold text-slate-900 tabular-nums">
                    {log.vehicle_number}
                  </span>
                  {log.token_number && (
                    <span className="text-[11px] tabular-nums text-slate-500">{log.token_number}</span>
                  )}
                  <span className="text-[11px] text-slate-600">{log.dispatch_date || '—'}</span>
                </div>

                <div className="flex items-center space-x-3">
                  <span className="px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider bg-slate-100 text-slate-800">
                    {log.status || 'In Progress'}
                  </span>
                  <button
                    onClick={() => onInspectDetails(log)}
                    className="text-xs font-semibold text-primary hover:underline min-h-11 min-w-11"
                  >
                    View Details
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <ZmccManagerExitPanel />
    </div>
  );
};
