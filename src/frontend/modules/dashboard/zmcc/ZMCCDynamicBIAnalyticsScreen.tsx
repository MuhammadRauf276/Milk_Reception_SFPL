'use client';

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchJson } from '@/lib/query/fetchJson';
import { User } from '@backend/core/types';
import type { ZmccBIAnalyticsData } from './zmccReportTypes';
import {
  IntakeTrendChart,
  ShiftDistributionChart,
  QualityMatrixChart,
  RouteLossBarChart,
  HourlyHeatmapChart,
} from './components/BIChartCards';
import { StatCard } from '@/components/ui/stat-card';
import { PageLoader } from '@/components/ui/spinner';
import { getErrorMessage } from '@/lib/errors';
import { getPakistanCalendarDate } from '@/backend/core/business-day';
import {
  LineChart,
  Calendar,
  Download,
  TrendingUp,
  FlaskConical,
  Layers,
  Thermometer,
  Clock,
  Filter,
} from 'lucide-react';
import { toast } from '@/frontend/lib/appToast';

type HorizonPreset = 'TODAY' | 'YESTERDAY' | 'LAST_7' | 'LAST_14' | 'LAST_30' | 'MTD' | 'CUSTOM';

interface ZMCCDynamicBIAnalyticsScreenProps {
  currentUser: User | null;
  targetZmccId?: string;
}

export function ZMCCDynamicBIAnalyticsScreen({
  currentUser,
  targetZmccId,
}: ZMCCDynamicBIAnalyticsScreenProps) {
  const [preset, setPreset] = useState<HorizonPreset>('LAST_7');
  const [selectedRouteId, setSelectedRouteId] = useState<string>('');
  const [selectedShift, setSelectedShift] = useState<string>('ALL');

  const todayStr = getPakistanCalendarDate(new Date());

  const { fromDate, toDate } = React.useMemo(() => {
    const today = new Date(`${todayStr}T00:00:00.000Z`);
    if (preset === 'TODAY') {
      return { fromDate: todayStr, toDate: todayStr };
    }
    if (preset === 'YESTERDAY') {
      const y = new Date(today.getTime() - 86400000);
      const yStr = y.toISOString().split('T')[0];
      return { fromDate: yStr, toDate: yStr };
    }
    if (preset === 'LAST_7') {
      const d = new Date(today.getTime() - 6 * 86400000);
      return { fromDate: d.toISOString().split('T')[0], toDate: todayStr };
    }
    if (preset === 'LAST_14') {
      const d = new Date(today.getTime() - 13 * 86400000);
      return { fromDate: d.toISOString().split('T')[0], toDate: todayStr };
    }
    if (preset === 'LAST_30') {
      const d = new Date(today.getTime() - 29 * 86400000);
      return { fromDate: d.toISOString().split('T')[0], toDate: todayStr };
    }
    if (preset === 'MTD') {
      const firstDay = `${todayStr.slice(0, 7)}-01`;
      return { fromDate: firstDay, toDate: todayStr };
    }
    return { fromDate: todayStr, toDate: todayStr };
  }, [preset, todayStr]);

  const [customFrom, setCustomFrom] = useState<string>(fromDate);
  const [customTo, setCustomTo] = useState<string>(toDate);

  const effectiveFrom = preset === 'CUSTOM' ? customFrom : fromDate;
  const effectiveTo = preset === 'CUSTOM' ? customTo : toDate;

  const isSystemScope =
    currentUser?.role === 'HEAD_OF_MPD' ||
    currentUser?.role === 'SUPER_ADMIN' ||
    currentUser?.role === 'DATA_EXECUTIVE' ||
    currentUser?.role === 'EXECUTIVE_MANAGEMENT';

  const facilityId = isSystemScope
    ? targetZmccId || ''
    : currentUser?.procurement_source_id
    ? String(currentUser.procurement_source_id)
    : '';

  const analyticsQuery = useQuery({
    queryKey: ['zmcc', 'bi-analytics', facilityId, effectiveFrom, effectiveTo, selectedRouteId, selectedShift],
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams();
      if (facilityId) params.append('zmccId', facilityId);
      if (effectiveFrom) params.append('fromDate', effectiveFrom);
      if (effectiveTo) params.append('toDate', effectiveTo);
      if (selectedRouteId) params.append('routeId', selectedRouteId);
      if (selectedShift !== 'ALL') params.append('shift', selectedShift);

      const json = await fetchJson<{ data: ZmccBIAnalyticsData }>(`/api/zmcc/reports/analytics?${params.toString()}`, { signal });
      return json.data;
    },
    staleTime: 60_000,
  });

  const bi = analyticsQuery.data;

  const handleExportExcel = () => {
    const params = new URLSearchParams({
      reportType: 'ANALYTICS',
      fromDate: effectiveFrom,
      toDate: effectiveTo,
    });
    if (facilityId) params.append('zmccId', facilityId);
    window.open(`/api/zmcc/reports/export?${params.toString()}`, '_blank');
    toast.success('Downloading BI Analytics report (.xlsx)…');
  };

  if (analyticsQuery.isPending) {
    return <PageLoader label="Calculating BI telemetry & trends…" className="py-24" />;
  }

  if (analyticsQuery.isError) {
    return (
      <div className="p-8 text-center bg-card rounded-xl border border-rose-200 space-y-3">
        <h3 className="text-sm font-semibold text-rose-800">Failed to load BI analytics</h3>
        <p className="text-xs text-rose-600 max-w-md mx-auto">{getErrorMessage(analyticsQuery.error)}</p>
        <button
          type="button"
          onClick={() => analyticsQuery.refetch()}
          className="min-h-11 px-4 py-2 bg-rose-600 text-white rounded-lg text-xs font-semibold hover:bg-rose-700"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!bi) return null;

  const { summaryKpis, trends, qualityScatter, routeRankings, hourlyFlow, shiftComparison } = bi;

  return (
    <div className="space-y-6">
      {/* Top Banner & Control Bar */}
      <div className="bg-card p-5 rounded-xl border border-border shadow-2xs space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-border pb-4">
          <div>
            <div className="flex items-center gap-2">
              <LineChart className="w-5 h-5 text-primary" />
              <h1 className="text-lg font-semibold text-foreground">
                Business Intelligence & Statistical Analytics
              </h1>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Dynamic volume trends, weighted quality indices, multi-tier loss diagnostics, and route performance
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleExportExcel}
              className="min-h-11 flex items-center space-x-1.5 px-3 py-1.5 rounded-lg border border-border bg-subtle hover:bg-muted text-xs font-semibold text-foreground transition"
            >
              <Download className="w-4 h-4 text-slate-600" />
              <span>Export BI Digest (.xlsx)</span>
            </button>
            <button
              type="button"
              onClick={() => analyticsQuery.refetch()}
              className="min-h-11 flex items-center space-x-1 px-3 py-1.5 rounded-lg border border-border bg-subtle hover:bg-muted text-xs font-semibold text-slate-700"
            >
              <span>Refresh</span>
            </button>
          </div>
        </div>

        {/* Dynamic Slicer Controls */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Horizon Presets */}
          <div className="flex items-center gap-1 bg-muted/60 p-1 rounded-lg border border-border overflow-x-auto">
            {(
              [
                ['TODAY', 'Today'],
                ['YESTERDAY', 'Yesterday'],
                ['LAST_7', 'Last 7 Days'],
                ['LAST_14', '14 Days'],
                ['LAST_30', '30 Days'],
                ['MTD', 'Month-to-Date'],
                ['CUSTOM', 'Custom'],
              ] as const
            ).map(([val, label]) => (
              <button
                key={val}
                type="button"
                onClick={() => setPreset(val)}
                className={`min-h-8 px-3 text-xs font-semibold rounded-md transition whitespace-nowrap ${
                  preset === val ? 'bg-primary text-white shadow-2xs' : 'text-slate-600 hover:text-foreground'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Shift and Route Slicers */}
          <div className="flex flex-wrap items-center gap-2">
            {preset === 'CUSTOM' && (
              <div className="flex items-center gap-1 bg-subtle px-2 py-1 rounded-lg border border-border text-xs">
                <input
                  type="date"
                  value={customFrom}
                  onChange={(e) => setCustomFrom(e.target.value)}
                  className="bg-transparent text-slate-700 focus:outline-hidden"
                />
                <span className="text-slate-400">to</span>
                <input
                  type="date"
                  value={customTo}
                  onChange={(e) => setCustomTo(e.target.value)}
                  className="bg-transparent text-slate-700 focus:outline-hidden"
                />
              </div>
            )}

            <div className="flex items-center gap-1 bg-subtle px-2 py-1 rounded-lg border border-border text-xs">
              <Filter className="w-3.5 h-3.5 text-slate-400" />
              <select
                value={selectedShift}
                onChange={(e) => setSelectedShift(e.target.value)}
                className="bg-transparent text-slate-700 font-semibold focus:outline-hidden"
              >
                <option value="ALL">All Shifts</option>
                <option value="MORNING">Morning Shift</option>
                <option value="EVENING">Evening Shift</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* Executive KPI Ribbon */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard
          label="Total Procured"
          value={`${summaryKpis.totalProcuredLiters.toLocaleString()} L`}
          hint={`+${summaryKpis.intakeVarianceVsPriorPct}% vs baseline`}
          icon={TrendingUp}
          tone="info"
        />
        <StatCard
          label="13% TS Standard"
          value={`${summaryKpis.standardized13TsLiters.toLocaleString()} L`}
          hint="Normalized solids"
          icon={FlaskConical}
          tone="success"
        />
        <StatCard
          label="Weighted Fat"
          value={`${summaryKpis.weightedFatPct}%`}
          hint={`SNF: ${summaryKpis.weightedSnfPct}%`}
          icon={FlaskConical}
          tone="default"
        />
        <StatCard
          label="Tier 1 Route Loss"
          value={`${summaryKpis.tier1RouteLossPct}%`}
          hint={`${summaryKpis.tier1RouteLossLiters.toLocaleString()} L variance`}
          icon={Layers}
          tone={summaryKpis.tier1RouteLossPct > 1.0 ? 'danger' : 'warning'}
        />
        <StatCard
          label="Tier 2 Storage Loss"
          value={`${summaryKpis.tier2StorageLossPct}%`}
          hint={`${summaryKpis.tier2StorageLossLiters.toLocaleString()} L tank diff`}
          icon={Layers}
          tone="default"
        />
        <StatCard
          label="Avg Temperature"
          value={`${summaryKpis.avgTemperatureC} °C`}
          hint="Holding standard"
          icon={Thermometer}
          tone="info"
        />
      </div>

      {/* Charts Grid: Row 1 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Daily Intake Trend Chart (2 Cols) */}
        <div className="lg:col-span-2 bg-card p-5 rounded-xl border border-border shadow-2xs space-y-4">
          <div className="flex items-center justify-between border-b border-border pb-3">
            <div>
              <h2 className="text-sm font-semibold text-foreground">Intake Volume Trend & Shift Breakdown</h2>
              <p className="text-[11px] text-slate-500">Daily intake with Morning vs Evening stacks and 13% TS line</p>
            </div>
            <span className="text-xs text-slate-500 font-semibold tabular-nums">
              {bi.timeHorizon.totalDays} Days Window
            </span>
          </div>

          <IntakeTrendChart trends={trends} />
        </div>

        {/* Shift Distribution Card (1 Col) */}
        <div className="bg-card p-5 rounded-xl border border-border shadow-2xs space-y-4 flex flex-col justify-between">
          <div className="border-b border-border pb-3">
            <h2 className="text-sm font-semibold text-foreground">Shift Contribution</h2>
            <p className="text-[11px] text-slate-500">Intake ratio between reception shifts</p>
          </div>

          <ShiftDistributionChart shiftComparison={shiftComparison} />

          <div className="p-3 bg-subtle rounded-lg text-xs space-y-1.5 border border-border">
            <span className="text-[10px] uppercase font-semibold text-slate-500 block">Turnaround Performance</span>
            <div className="flex items-center justify-between text-slate-700">
              <span>Collection Execution Rate:</span>
              <span className="font-semibold text-emerald-700">{summaryKpis.shopCollectionRatePct}%</span>
            </div>
            <div className="flex items-center justify-between text-slate-700">
              <span>On-Time Arrival Rate:</span>
              <span className="font-semibold text-foreground">{summaryKpis.onTimeArrivalRatePct}%</span>
            </div>
          </div>
        </div>
      </div>

      {/* Charts Grid: Row 2 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Quality Scatter Matrix */}
        <div className="bg-card p-5 rounded-xl border border-border shadow-2xs space-y-4">
          <div className="border-b border-border pb-3">
            <h2 className="text-sm font-semibold text-foreground">Quality Composition Matrix (Fat vs SNF)</h2>
            <p className="text-[11px] text-slate-500">Quality distribution against regulatory baseline standards</p>
          </div>

          <QualityMatrixChart scatter={qualityScatter} />
        </div>

        {/* Route Loss & Variance Diagnostics */}
        <div className="bg-card p-5 rounded-xl border border-border shadow-2xs space-y-4">
          <div className="border-b border-border pb-3">
            <h2 className="text-sm font-semibold text-foreground">Route Intake Volume & Tier 1 Loss</h2>
            <p className="text-[11px] text-slate-500">Volume contribution alongside shop-to-gate variance percentage</p>
          </div>

          <RouteLossBarChart rankings={routeRankings} />
        </div>
      </div>

      {/* Hourly Reception Flow Heatmap */}
      <div className="bg-card p-5 rounded-xl border border-border shadow-2xs space-y-3">
        <div className="border-b border-border pb-3">
          <h2 className="text-sm font-semibold text-foreground">Hourly Reception Gate Throughput Flow</h2>
          <p className="text-[11px] text-slate-500">24-hour distribution of intake volume to identify gate arrival bottlenecks</p>
        </div>

        <HourlyHeatmapChart hourlyFlow={hourlyFlow} />
      </div>

      {/* Route Performance League Table */}
      <div className="bg-card rounded-xl border border-border overflow-hidden shadow-2xs">
        <div className="p-4 border-b border-border flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">Route Performance League Table</h2>
          <span className="text-xs text-slate-500 font-medium">{routeRankings.length} routes active</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-muted/50 text-slate-700 uppercase font-semibold text-[10px] border-b border-border">
              <tr>
                <th className="p-3">Route Code</th>
                <th className="p-3">Route Name</th>
                <th className="p-3">Intake Volume</th>
                <th className="p-3">13% TS Volume</th>
                <th className="p-3">Avg Fat %</th>
                <th className="p-3">Avg SNF %</th>
                <th className="p-3">Shops</th>
                <th className="p-3">Route Loss</th>
                <th className="p-3 text-right">Loss %</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {routeRankings.map((r) => (
                <tr key={r.routeId} className="hover:bg-subtle transition">
                  <td className="p-3 tabular-nums font-semibold text-primary">{r.routeCode}</td>
                  <td className="p-3 font-semibold text-foreground">{r.name}</td>
                  <td className="p-3 tabular-nums font-semibold text-foreground">
                    {r.totalLiters.toLocaleString()} L
                  </td>
                  <td className="p-3 tabular-nums font-semibold text-emerald-700">
                    {r.at13TsLiters.toLocaleString()} L
                  </td>
                  <td className="p-3 tabular-nums text-slate-700">{r.avgFat}%</td>
                  <td className="p-3 tabular-nums text-slate-700">{r.avgSnf}%</td>
                  <td className="p-3 tabular-nums text-slate-700">{r.shopCount} shops</td>
                  <td className="p-3 tabular-nums text-slate-700">{r.routeLossLiters.toLocaleString()} L</td>
                  <td className="p-3 text-right tabular-nums">
                    <span
                      className={`font-semibold px-2 py-0.5 rounded-full text-[10px] ${
                        r.routeLossPct > 1.0
                          ? 'bg-rose-100 text-rose-800'
                          : 'bg-emerald-100 text-emerald-800'
                      }`}
                    >
                      {r.routeLossPct}%
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
