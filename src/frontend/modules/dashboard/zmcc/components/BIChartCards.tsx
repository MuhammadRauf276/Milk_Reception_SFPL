'use client';

import React, { useState } from 'react';
import type {
  DailyIntakeTrendPoint,
  QualityScatterPoint,
  RoutePerformanceRanking,
  HourlyThroughputPoint,
} from '../zmccReportTypes';
import { InfoTip } from '@/components/ui/info-tip';

// ==========================================
// 1. INTAKE TREND & SHIFT CHART (SVG)
// ==========================================

export function IntakeTrendChart({ trends }: { trends: DailyIntakeTrendPoint[] }) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  if (!trends || trends.length === 0) {
    return (
      <div className="h-64 flex items-center justify-center text-xs font-semibold text-slate-400 bg-subtle rounded-xl border border-dashed border-border">
        No trend records available for the selected period.
      </div>
    );
  }

  const maxLiters = Math.max(...trends.map((t) => t.grossLiters), 100);
  const chartHeight = 180;
  const chartWidth = 540;
  const paddingX = 40;
  const paddingY = 25;
  const innerWidth = chartWidth - paddingX * 2;
  const innerHeight = chartHeight - paddingY * 2;

  const barWidth = Math.min(32, Math.max(12, innerWidth / (trends.length * 1.6)));

  return (
    <div className="relative w-full overflow-hidden">
      <svg
        viewBox={`0 0 ${chartWidth} ${chartHeight}`}
        className="w-full h-auto overflow-visible select-none"
      >
        {/* Horizontal grid lines */}
        {[0, 0.25, 0.5, 0.75, 1].map((pct, i) => {
          const y = chartHeight - paddingY - innerHeight * pct;
          const val = Math.round(maxLiters * pct);
          return (
            <g key={i}>
              <line
                x1={paddingX}
                y1={y}
                x2={chartWidth - paddingX}
                y2={y}
                stroke="#e2e8f0"
                strokeDasharray={pct > 0 ? '3 3' : '0'}
                strokeWidth={1}
              />
              <text
                x={paddingX - 8}
                y={y + 3}
                textAnchor="end"
                className="text-[9px] fill-slate-500 font-medium tabular-nums"
              >
                {val >= 1000 ? `${(val / 1000).toFixed(1)}k` : val}
              </text>
            </g>
          );
        })}

        {/* Stacked Bars for Morning vs Evening */}
        {trends.map((t, idx) => {
          const x = paddingX + (idx + 0.5) * (innerWidth / trends.length) - barWidth / 2;
          const totalBarH = (t.grossLiters / maxLiters) * innerHeight;
          const morningH = (t.morningLiters / maxLiters) * innerHeight;
          const eveningH = (t.eveningLiters / maxLiters) * innerHeight;
          const baseY = chartHeight - paddingY;

          const isHovered = hoveredIndex === idx;

          return (
            <g
              key={t.date}
              className="cursor-pointer transition-opacity"
              onMouseEnter={() => setHoveredIndex(idx)}
              onMouseLeave={() => setHoveredIndex(null)}
            >
              {/* Morning Segment (Blue) */}
              <rect
                x={x}
                y={baseY - morningH}
                width={barWidth}
                height={Math.max(1, morningH)}
                rx={eveningH === 0 ? 3 : 0}
                className={isHovered ? 'fill-blue-600' : 'fill-blue-500'}
              />
              {/* Evening Segment (Indigo / Violet) */}
              <rect
                x={x}
                y={baseY - totalBarH}
                width={barWidth}
                height={Math.max(0, eveningH)}
                rx={3}
                className={isHovered ? 'fill-indigo-700' : 'fill-indigo-600'}
              />

              {/* X-axis label */}
              <text
                x={x + barWidth / 2}
                y={chartHeight - 6}
                textAnchor="middle"
                className="text-[9px] fill-slate-500 font-medium"
              >
                {t.date.slice(5)}
              </text>
            </g>
          );
        })}

        {/* Line overlay: 13% TS Liters */}
        <polyline
          fill="none"
          stroke="#10b981"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          points={trends
            .map((t, idx) => {
              const x = paddingX + (idx + 0.5) * (innerWidth / trends.length);
              const y = chartHeight - paddingY - (t.at13TsLiters / maxLiters) * innerHeight;
              return `${x},${y}`;
            })
            .join(' ')}
        />
        {trends.map((t, idx) => {
          const x = paddingX + (idx + 0.5) * (innerWidth / trends.length);
          const y = chartHeight - paddingY - (t.at13TsLiters / maxLiters) * innerHeight;
          return (
            <circle
              key={idx}
              cx={x}
              cy={y}
              r={hoveredIndex === idx ? 4.5 : 3}
              className="fill-emerald-500 stroke-white stroke-2"
            />
          );
        })}
      </svg>

      {/* Hover Card */}
      {hoveredIndex !== null && trends[hoveredIndex] && (
        <div className="mt-2 p-2.5 bg-slate-900 text-white rounded-lg text-xs shadow-lg flex items-center justify-between gap-4">
          <div>
            <span className="font-semibold text-slate-200">{trends[hoveredIndex].date}</span>
            <div className="text-[11px] text-slate-400">
              Total: <span className="font-semibold text-white">{trends[hoveredIndex].grossLiters.toLocaleString()} L</span>
              {' · '}
              13% TS: <span className="font-semibold text-emerald-400">{trends[hoveredIndex].at13TsLiters.toLocaleString()} L</span>
            </div>
          </div>
          <div className="text-right text-[11px] text-slate-300">
            <div>Morning: <span className="text-blue-300 font-medium">{trends[hoveredIndex].morningLiters.toLocaleString()} L</span></div>
            <div>Evening: <span className="text-indigo-300 font-medium">{trends[hoveredIndex].eveningLiters.toLocaleString()} L</span></div>
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="mt-3 flex items-center justify-center gap-6 text-[11px] font-medium text-slate-600">
        <div className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-xs bg-blue-500 inline-block" />
          <span>Morning Shift</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-xs bg-indigo-600 inline-block" />
          <span>Evening Shift</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-4 h-0.5 bg-emerald-500 inline-block" />
          <span className="w-2 h-2 rounded-full bg-emerald-500 -ml-2.5 inline-block" />
          <span className="ml-1">13% TS Standardized</span>
        </div>
      </div>
    </div>
  );
}

// ==========================================
// 2. SHIFT DISTRIBUTION COMPARISON CARD
// ==========================================

export function ShiftDistributionChart({
  shiftComparison,
}: {
  shiftComparison: { morningLiters: number; morningPct: number; eveningLiters: number; eveningPct: number };
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between text-xs font-semibold text-slate-700">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-blue-500" />
          <span>Morning Shift (04:00 - 13:00)</span>
        </div>
        <div className="tabular-nums font-semibold">
          {shiftComparison.morningLiters.toLocaleString()} L ({shiftComparison.morningPct}%)
        </div>
      </div>
      <div className="w-full h-3 rounded-full bg-slate-100 overflow-hidden flex">
        <div
          style={{ width: `${shiftComparison.morningPct}%` }}
          className="bg-blue-500 h-full transition-all duration-500"
        />
        <div
          style={{ width: `${shiftComparison.eveningPct}%` }}
          className="bg-indigo-600 h-full transition-all duration-500"
        />
      </div>
      <div className="flex items-center justify-between text-xs font-semibold text-slate-700">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-indigo-600" />
          <span>Evening Shift (13:00 - 22:00)</span>
        </div>
        <div className="tabular-nums font-semibold">
          {shiftComparison.eveningLiters.toLocaleString()} L ({shiftComparison.eveningPct}%)
        </div>
      </div>
    </div>
  );
}

// ==========================================
// 3. QUALITY SCATTER MATRIX (FAT VS SNF)
// ==========================================

export function QualityMatrixChart({ scatter }: { scatter: QualityScatterPoint[] }) {
  const [selectedPoint, setSelectedPoint] = useState<QualityScatterPoint | null>(null);

  if (!scatter || scatter.length === 0) {
    return (
      <div className="h-64 flex items-center justify-center text-xs font-semibold text-slate-400 bg-subtle rounded-xl border border-dashed border-border">
        No quality test samples available.
      </div>
    );
  }

  // Bounds: Fat 2.5 to 6.5; SNF 7.0 to 10.0
  const minFat = 2.5;
  const maxFat = 6.5;
  const minSnf = 7.0;
  const maxSnf = 10.0;

  const width = 480;
  const height = 240;
  const pad = 35;

  const toX = (fat: number) => pad + ((fat - minFat) / (maxFat - minFat)) * (width - pad * 2);
  const toY = (snf: number) => height - pad - ((snf - minSnf) / (maxSnf - minSnf)) * (height - pad * 2);

  const standardFatX = toX(3.5);
  const standardSnfY = toY(8.5);

  return (
    <div className="space-y-3">
      <div className="relative">
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto overflow-visible select-none">
          {/* Background Quadrants */}
          {/* Premium Quadrant (Fat >= 3.5, SNF >= 8.5) */}
          <rect
            x={standardFatX}
            y={pad}
            width={width - pad - standardFatX}
            height={standardSnfY - pad}
            fill="#ecfdf5"
            opacity={0.7}
          />
          {/* Substandard Quadrant (Fat < 3.5 or SNF < 8.5) */}
          <rect
            x={pad}
            y={standardSnfY}
            width={standardFatX - pad}
            height={height - pad - standardSnfY}
            fill="#fff1f2"
            opacity={0.6}
          />

          {/* Reference Guideline: Fat 3.5% */}
          <line
            x1={standardFatX}
            y1={pad}
            x2={standardFatX}
            y2={height - pad}
            stroke="#f59e0b"
            strokeDasharray="3 3"
            strokeWidth={1.5}
          />
          <text
            x={standardFatX + 4}
            y={pad + 12}
            className="text-[9px] fill-amber-700 font-semibold"
          >
            Std Fat (3.5%)
          </text>

          {/* Reference Guideline: SNF 8.5% */}
          <line
            x1={pad}
            y1={standardSnfY}
            x2={width - pad}
            y2={standardSnfY}
            stroke="#f59e0b"
            strokeDasharray="3 3"
            strokeWidth={1.5}
          />
          <text
            x={width - pad - 60}
            y={standardSnfY - 4}
            className="text-[9px] fill-amber-700 font-semibold"
          >
            Std SNF (8.5%)
          </text>

          {/* Points */}
          {scatter.map((p, i) => {
            const cx = Math.max(pad, Math.min(width - pad, toX(p.fat)));
            const cy = Math.max(pad, Math.min(height - pad, toY(p.snf)));
            const isSelected = selectedPoint?.collectionId === p.collectionId;

            let color = '#3b82f6';
            if (p.tier === 'PREMIUM') color = '#10b981';
            else if (p.tier === 'WARNING') color = '#f43f5e';

            return (
              <circle
                key={i}
                cx={cx}
                cy={cy}
                r={isSelected ? 6 : 4}
                fill={color}
                fillOpacity={0.8}
                stroke="#ffffff"
                strokeWidth={1.5}
                className="cursor-pointer transition-transform hover:scale-125"
                onMouseEnter={() => setSelectedPoint(p)}
                onMouseLeave={() => setSelectedPoint(null)}
              />
            );
          })}

          {/* Axis Labels */}
          <text x={width / 2} y={height - 8} textAnchor="middle" className="text-[10px] fill-slate-500 font-semibold">
            Fat % →
          </text>
          <text
            x={12}
            y={height / 2}
            textAnchor="middle"
            transform={`rotate(-90 12 ${height / 2})`}
            className="text-[10px] fill-slate-500 font-semibold"
          >
            SNF % →
          </text>
        </svg>
      </div>

      {selectedPoint ? (
        <div className="p-2.5 bg-slate-900 text-white rounded-lg text-xs flex items-center justify-between">
          <div>
            <span className="font-semibold text-primary-foreground">#{selectedPoint.collectionNumber}</span> · Route {selectedPoint.routeCode}
          </div>
          <div className="flex items-center gap-3 tabular-nums font-semibold">
            <span>Fat: {selectedPoint.fat}%</span>
            <span>SNF: {selectedPoint.snf}%</span>
            <span>LR: {selectedPoint.lr}</span>
            <span>Vol: {selectedPoint.grossLiters} L</span>
          </div>
        </div>
      ) : (
        <div className="text-[11px] text-slate-500 flex items-center justify-between">
          <span>Hover a point to view batch parameters.</span>
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" /> Premium</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-500 inline-block" /> Standard</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-rose-500 inline-block" /> Substandard</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ==========================================
// 4. ROUTE LOSS & VOLUME BAR CHART
// ==========================================

export function RouteLossBarChart({ rankings }: { rankings: RoutePerformanceRanking[] }) {
  if (!rankings || rankings.length === 0) {
    return (
      <div className="h-48 flex items-center justify-center text-xs font-semibold text-slate-400 bg-subtle rounded-xl border border-dashed border-border">
        No route collection data available.
      </div>
    );
  }

  const maxLiters = Math.max(...rankings.map((r) => r.totalLiters), 100);

  return (
    <div className="space-y-3">
      {rankings.slice(0, 6).map((r) => {
        const barPct = Math.round((r.totalLiters / maxLiters) * 100);
        const lossTone =
          r.routeLossPct > 1.2
            ? 'bg-rose-100 text-rose-800 border-rose-200'
            : r.routeLossPct > 0.8
            ? 'bg-amber-100 text-amber-800 border-amber-200'
            : 'bg-emerald-100 text-emerald-800 border-emerald-200';

        return (
          <div key={r.routeId} className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-foreground">
                {r.routeCode} · <span className="font-normal text-slate-600">{r.name}</span>
              </span>
              <div className="flex items-center gap-2">
                <span className="tabular-nums font-semibold text-foreground">
                  {r.totalLiters.toLocaleString()} L
                </span>
                <span className={`text-[10px] tabular-nums font-semibold px-2 py-0.5 rounded-full border ${lossTone}`}>
                  {r.routeLossPct}% Loss
                </span>
              </div>
            </div>
            <div className="w-full h-2 rounded-full bg-slate-100 overflow-hidden">
              <div
                style={{ width: `${barPct}%` }}
                className="bg-primary h-full rounded-full transition-all duration-500"
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ==========================================
// 5. HOURLY RECEPTION FLOW HEATMAP
// ==========================================

export function HourlyHeatmapChart({ hourlyFlow }: { hourlyFlow: HourlyThroughputPoint[] }) {
  const maxH = Math.max(...hourlyFlow.map((h) => h.liters), 50);

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-12 sm:grid-cols-24 gap-1 items-end h-28 pt-4">
        {hourlyFlow.map((h) => {
          const barH = Math.max(4, Math.round((h.liters / maxH) * 80));
          const isRush = (h.hour >= 7 && h.hour <= 11) || (h.hour >= 17 && h.hour <= 20);

          return (
            <div
              key={h.hour}
              className="group relative flex flex-col items-center justify-end h-full cursor-pointer"
            >
              <div
                style={{ height: `${barH}px` }}
                className={`w-full rounded-xs transition-colors ${
                  isRush
                    ? 'bg-indigo-600 group-hover:bg-indigo-700'
                    : h.liters > 0
                    ? 'bg-blue-400 group-hover:bg-blue-500'
                    : 'bg-slate-200'
                }`}
              />
              <span className="text-[8px] font-semibold text-slate-500 mt-1 tabular-nums">
                {h.hour % 3 === 0 ? h.hour : ''}
              </span>

              {/* Tooltip */}
              <div className="hidden group-hover:block absolute bottom-full mb-1 z-30 p-2 bg-slate-900 text-white rounded-md text-[10px] whitespace-nowrap shadow-lg">
                <div className="font-semibold">{h.label}</div>
                <div>{h.liters.toLocaleString()} Liters</div>
                <div>{h.count} Collections</div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex items-center justify-between text-[11px] text-slate-500 pt-1">
        <span>00:00 Night</span>
        <span className="font-semibold text-indigo-700">Peak Morning: 08:00 - 10:00 · Peak Evening: 18:00 - 20:00</span>
        <span>23:00 Night</span>
      </div>
    </div>
  );
}
