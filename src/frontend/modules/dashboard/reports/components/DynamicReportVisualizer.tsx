'use client';

import React, { useState, useMemo } from 'react';
import type {
  ReportFieldDefinition,
  GroupedSubtotal,
} from '../dynamicReportTypes';
import {
  BarChart3,
  TrendingUp,
  ScatterChart,
  Layers,
} from 'lucide-react';

interface DynamicReportVisualizerProps {
  fields: ReportFieldDefinition[];
  rows: Record<string, any>[];
  groupByFieldId?: string;
  groupedSubtotals?: GroupedSubtotal[];
}

type ChartMode = 'BAR' | 'TREND' | 'SCATTER';

export function DynamicReportVisualizer({
  fields,
  rows,
  groupByFieldId,
  groupedSubtotals,
}: DynamicReportVisualizerProps) {
  const [chartMode, setChartMode] = useState<ChartMode>('BAR');
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  // Available numeric metrics
  const numericMetrics = useMemo(() => {
    return fields.filter(
      (f) =>
        f.dataType === 'number' &&
        (f.format === 'liters' || f.format === 'percent' || f.id.includes('liters') || f.id.includes('loss'))
    );
  }, [fields]);

  const [selectedMetricId, setSelectedMetricId] = useState<string>(
    numericMetrics[0]?.id || 'gross_liters'
  );

  const selectedMetricDef = useMemo(() => {
    return fields.find((f) => f.id === selectedMetricId) || numericMetrics[0];
  }, [fields, selectedMetricId, numericMetrics]);

  // Bar Chart Data (Grouped subtotals or Top 12 records)
  const barData = useMemo(() => {
    if (groupedSubtotals && groupedSubtotals.length > 0) {
      return groupedSubtotals.map((g) => ({
        label: g.groupLabel,
        value: g.aggregations[selectedMetricId] || 0,
      }));
    }

    // Default to grouping by the first string field (e.g. route_name, shop_name)
    const labelField = fields.find((f) => f.dataType === 'string' && f.id.includes('name')) || fields[0];
    const topRows = rows.slice(0, 12);
    return topRows.map((r) => ({
      label: String(r[labelField?.id || ''] || 'Record'),
      value: Number(r[selectedMetricId]) || 0,
    }));
  }, [groupedSubtotals, selectedMetricId, fields, rows]);

  // Scatter Data (Fat vs SNF)
  const scatterData = useMemo(() => {
    const hasFat = rows.some((r) => r.fat !== undefined && r.fat !== null);
    const hasSnf = rows.some((r) => r.snf !== undefined && r.snf !== null);
    if (!hasFat || !hasSnf) return [];

    return rows
      .filter((r) => r.fat !== null && r.snf !== null && !isNaN(Number(r.fat)) && !isNaN(Number(r.snf)))
      .map((r, idx) => ({
        id: idx,
        x: Number(r.fat),
        y: Number(r.snf),
        label: String(r.shop_name || r.supplier_name || r.route_name || `#${idx + 1}`),
        liters: Number(r.gross_liters) || 0,
      }));
  }, [rows]);

  if (rows.length === 0) {
    return (
      <div className="bg-card border border-border p-12 text-center rounded-xl text-muted-foreground text-xs">
        No data available to visualize. Adjust filters to populate the report.
      </div>
    );
  }

  const maxBarValue = Math.max(...barData.map((d) => d.value), 1);

  return (
    <div className="bg-card border border-border rounded-xl p-5 space-y-5 shadow-xs animate-panel-in">
      {/* Header Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
            <BarChart3 className="w-4 h-4 text-primary" /> Visual Analytics & Distributions
          </span>
          <span className="text-slate-400 text-xs">·</span>
          <span className="text-xs text-muted-foreground">
            {barData.length} data points
          </span>
        </div>

        <div className="flex items-center gap-3">
          {/* Metric Selector */}
          {numericMetrics.length > 1 && (
            <div className="flex items-center gap-1.5 text-xs">
              <span className="text-muted-foreground">Metric:</span>
              <select
                value={selectedMetricId}
                onChange={(e) => setSelectedMetricId(e.target.value)}
                className="bg-background border border-border rounded-lg px-2.5 py-1 text-xs font-medium text-foreground focus:outline-hidden focus:ring-1 focus:ring-primary cursor-pointer"
              >
                {numericMetrics.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Mode Switcher */}
          <div className="flex items-center gap-1 bg-muted/60 p-1 rounded-lg">
            <button
              type="button"
              onClick={() => setChartMode('BAR')}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors flex items-center gap-1 ${
                chartMode === 'BAR'
                  ? 'bg-background text-foreground shadow-2xs font-semibold'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <BarChart3 className="w-3.5 h-3.5" /> Bar
            </button>
            <button
              type="button"
              onClick={() => setChartMode('TREND')}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors flex items-center gap-1 ${
                chartMode === 'TREND'
                  ? 'bg-background text-foreground shadow-2xs font-semibold'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <TrendingUp className="w-3.5 h-3.5" /> Trend
            </button>
            {scatterData.length > 0 && (
              <button
                type="button"
                onClick={() => setChartMode('SCATTER')}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors flex items-center gap-1 ${
                  chartMode === 'SCATTER'
                    ? 'bg-background text-foreground shadow-2xs font-semibold'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <ScatterChart className="w-3.5 h-3.5" /> Quality Scatter
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 1. BAR CHART */}
      {chartMode === 'BAR' && (
        <div className="space-y-3">
          <div className="h-64 flex items-end gap-2 pt-6 pb-2 px-2 border-b border-border">
            {barData.map((d, i) => {
              const heightPct = Math.max(8, (d.value / maxBarValue) * 100);
              const isHovered = hoveredIndex === i;

              return (
                <div
                  key={i}
                  className="flex-1 flex flex-col items-center justify-end h-full group relative"
                  onMouseEnter={() => setHoveredIndex(i)}
                  onMouseLeave={() => setHoveredIndex(null)}
                >
                  {/* Floating Tooltip */}
                  {isHovered && (
                    <div className="absolute -top-12 z-20 bg-slate-900 text-white text-[11px] font-medium py-1 px-2.5 rounded-lg shadow-xl whitespace-nowrap pointer-events-none">
                      <span className="font-semibold">{d.label}</span>: {d.value.toLocaleString()} {selectedMetricDef?.unit || ''}
                    </div>
                  )}

                  {/* Value badge */}
                  <span className="text-[10px] tabular-nums font-mono text-muted-foreground mb-1 group-hover:text-primary transition-colors">
                    {d.value >= 1000 ? `${(d.value / 1000).toFixed(1)}k` : d.value.toFixed(0)}
                  </span>

                  {/* Bar Body */}
                  <div
                    style={{ height: `${heightPct}%` }}
                    className={`w-full max-w-[48px] rounded-t-md transition-all duration-200 ${
                      isHovered
                        ? 'bg-primary shadow-md shadow-primary/20 scale-y-105 origin-bottom'
                        : 'bg-primary/75 hover:bg-primary'
                    }`}
                  />
                </div>
              );
            })}
          </div>

          {/* Labels row */}
          <div className="flex items-center gap-2 px-2 text-[10px] text-muted-foreground">
            {barData.map((d, i) => (
              <div key={i} className="flex-1 text-center truncate font-medium" title={d.label}>
                {d.label}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 2. TREND CHART */}
      {chartMode === 'TREND' && (
        <div className="h-64 w-full relative pt-4">
          <svg className="w-full h-full overflow-visible" viewBox="0 0 600 200" preserveAspectRatio="none">
            <defs>
              <linearGradient id="dynamicGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#1E3A8A" stopOpacity="0.25" />
                <stop offset="100%" stopColor="#1E3A8A" stopOpacity="0.0" />
              </linearGradient>
            </defs>

            {/* Grid lines */}
            <line x1="0" y1="50" x2="600" y2="50" stroke="currentColor" className="text-border" strokeDasharray="3 3" />
            <line x1="0" y1="100" x2="600" y2="100" stroke="currentColor" className="text-border" strokeDasharray="3 3" />
            <line x1="0" y1="150" x2="600" y2="150" stroke="currentColor" className="text-border" strokeDasharray="3 3" />

            {/* Area Path */}
            {barData.length > 1 && (
              <>
                <path
                  d={`
                    M 0,200
                    ${barData
                      .map((d, i) => {
                        const x = (i / (barData.length - 1)) * 600;
                        const y = 200 - (d.value / maxBarValue) * 160 - 20;
                        return `L ${x},${y}`;
                      })
                      .join(' ')}
                    L 600,200 Z
                  `}
                  fill="url(#dynamicGrad)"
                />
                <path
                  d={`
                    M 0,${200 - (barData[0].value / maxBarValue) * 160 - 20}
                    ${barData
                      .map((d, i) => {
                        const x = (i / (barData.length - 1)) * 600;
                        const y = 200 - (d.value / maxBarValue) * 160 - 20;
                        return `L ${x},${y}`;
                      })
                      .join(' ')}
                  `}
                  fill="none"
                  stroke="#1E3A8A"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                />
              </>
            )}

            {/* Points */}
            {barData.map((d, i) => {
              const x = barData.length === 1 ? 300 : (i / (barData.length - 1)) * 600;
              const y = 200 - (d.value / maxBarValue) * 160 - 20;
              return (
                <circle
                  key={i}
                  cx={x}
                  cy={y}
                  r="4"
                  className="fill-background stroke-primary stroke-[2.5] hover:r-6 transition-all cursor-pointer"
                />
              );
            })}
          </svg>
        </div>
      )}

      {/* 3. QUALITY SCATTER (Fat vs SNF) */}
      {chartMode === 'SCATTER' && scatterData.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
            <span>X-Axis: Fat % (3.0% to 5.5%)</span>
            <span>Y-Axis: SNF % (7.5% to 9.5%)</span>
          </div>

          <div className="h-64 w-full relative bg-muted/20 border border-border rounded-xl p-4 overflow-hidden">
            <svg className="w-full h-full" viewBox="0 0 500 200" preserveAspectRatio="none">
              {/* Reference Baseline 3.5% Fat & 8.5% SNF */}
              <line x1="120" y1="0" x2="120" y2="200" stroke="#f43f5e" strokeWidth="1" strokeDasharray="4 4" />
              <line x1="0" y1="100" x2="500" y2="100" stroke="#f43f5e" strokeWidth="1" strokeDasharray="4 4" />

              {scatterData.map((pt, i) => {
                // Map fat [3.0, 5.5] to [20, 480]
                const cx = Math.max(20, Math.min(480, ((pt.x - 3.0) / 2.5) * 460 + 20));
                // Map snf [7.5, 9.5] to [180, 20]
                const cy = Math.max(20, Math.min(180, 180 - ((pt.y - 7.5) / 2.0) * 160));
                const isCompliant = pt.x >= 3.5 && pt.y >= 8.5;

                return (
                  <circle
                    key={i}
                    cx={cx}
                    cy={cy}
                    r="4.5"
                    className={`${
                      isCompliant
                        ? 'fill-emerald-500/80 stroke-emerald-700'
                        : 'fill-rose-500/80 stroke-rose-700'
                    } stroke-[1.5] hover:r-7 transition-all cursor-pointer`}
                  >
                    <title>{`${pt.label}: ${pt.x}% Fat, ${pt.y}% SNF`}</title>
                  </circle>
                );
              })}
            </svg>
          </div>
        </div>
      )}
    </div>
  );
}
