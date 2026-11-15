'use client';

import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchJson } from '@/lib/query/fetchJson';
import {
  Truck,
  FlaskConical,
  Scale,
  Thermometer,
  AlertTriangle,
  CheckCircle2,
  Download,
  Calendar,
  Search,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StatCard } from '@/components/ui/stat-card';
import { TableWrapper } from '@/components/ui/table-wrapper';
import { Pagination, usePagedRows } from '@/components/ui/pagination';
import { formatTime } from '@/lib/format';

interface PlantQaComparisonRow {
  id: string;
  dispatchNote: string;
  vehicleNumber: string;
  sourceZmcc: string;
  dispatchDate: string | null;
  plantReceivedTime: string | null;
  dispatchedLiters: number | null;
  plantAcceptedLiters: number | null;
  /** Signed: received minus dispatched, so a loss is negative and a gain is positive. */
  varianceLiters: number | null;
  variancePct: number | null;
  dispatchFat: number | null;
  dispatchLr: number | null;
  plantFat: number | null;
  plantLr: number | null;
  fatDelta: number | null;
  status: 'ACCEPTED' | 'FLAGGED_LOSS' | 'FLAGGED_QA' | 'IN_TRANSIT';
}

const numOrNull = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const fmtNum = (v: number | null, digits?: number, suffix = ''): string =>
  v == null ? '—' : `${digits != null ? v.toFixed(digits) : v.toLocaleString()}${suffix}`;

const fmtSigned = (v: number | null, digits: number, suffix = ''): string =>
  v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(digits)}${suffix}`;

// Loss flag limit (percent of dispatched volume). Hard-coded: no policy value found in the codebase.
const LOSS_FLAG_PCT = 0.8;

interface PlantQaComparisonViewProps {
  targetZmccId?: string;
}

export function PlantQaComparisonView({ targetZmccId }: PlantQaComparisonViewProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');

  const query = useQuery({
    queryKey: ['plant-qa-comparison', targetZmccId],
    queryFn: async () => {
      const url = targetZmccId
        ? `/api/management/reports/views?type=plant-transit&zmccId=${targetZmccId}&pageSize=50`
        : `/api/management/reports/views?type=plant-transit&pageSize=50`;
      const res = await fetchJson<{ items: any[] }>(url);
      return res.items || [];
    },
  });

  const activeData: PlantQaComparisonRow[] = useMemo(() => {
    return (query.data ?? []).map((r: any) => {
      const dispatched = numOrNull(r.dispatch_gross_liters) ?? numOrNull(r.sent_gross_liters);
      const received = numOrNull(r.received_gross_liters);
      const varianceLiters = numOrNull(r.gross_variance_liters);
      const variancePct = numOrNull(r.gross_variance_percent);
      const dFat = numOrNull(r.dispatch_fat);
      const pFat = numOrNull(r.plant_fat);
      const dLr = numOrNull(r.dispatch_lr);
      const pLr = numOrNull(r.plant_lr);
      const fatDelta = dFat != null && pFat != null ? Number((pFat - dFat).toFixed(2)) : null;

      let status: PlantQaComparisonRow['status'] = 'ACCEPTED';
      if (r.current_status === 'DISPATCHED' || r.current_status === 'IN_TRANSIT') {
        status = 'IN_TRANSIT';
      } else if (variancePct != null && variancePct < -LOSS_FLAG_PCT) {
        status = 'FLAGGED_LOSS';
      } else if (fatDelta != null && Math.abs(fatDelta) > 0.2) {
        status = 'FLAGGED_QA';
      }

      return {
        id: r.visit_id,
        dispatchNote: r.visit_number || '—',
        vehicleNumber: r.vehicle_number || '—',
        sourceZmcc: r.zmcc_name || '—',
        dispatchDate: r.operational_date || null,
        plantReceivedTime: r.reconciled_at ? formatTime(r.reconciled_at) : null,
        dispatchedLiters: dispatched,
        plantAcceptedLiters: received,
        varianceLiters,
        variancePct,
        dispatchFat: dFat,
        dispatchLr: dLr,
        plantFat: pFat,
        plantLr: pLr,
        fatDelta,
        status,
      };
    });
  }, [query.data]);

  const filteredRows = activeData.filter((r) => {
    const matchSearch =
      searchTerm === '' ||
      r.dispatchNote.toLowerCase().includes(searchTerm.toLowerCase()) ||
      r.vehicleNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
      r.sourceZmcc.toLowerCase().includes(searchTerm.toLowerCase());
    const matchStatus = statusFilter === 'ALL' || r.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const pagedRows = usePagedRows(filteredRows, (r) => String(r.id));

  const arrived = filteredRows.filter((r) => r.status !== 'IN_TRANSIT');
  const totalDispatched = filteredRows.reduce((s, r) => s + (r.dispatchedLiters ?? 0), 0);
  const totalReceived = arrived.reduce((s, r) => s + (r.plantAcceptedLiters ?? 0), 0);
  const withVariance = arrived.filter((r) => r.varianceLiters != null && r.dispatchedLiters != null);
  // Signed total: negative is a net loss, positive a net gain. In-transit rows are excluded.
  const totalVariance = withVariance.length > 0 ? withVariance.reduce((s, r) => s + (r.varianceLiters ?? 0), 0) : null;
  const varianceBase = withVariance.reduce((s, r) => s + (r.dispatchedLiters ?? 0), 0);
  const avgVariancePct = totalVariance != null && varianceBase > 0 ? (totalVariance / varianceBase) * 100 : null;

  return (
    <div className="space-y-5 animate-panel-in">
      {/* Top Description Banner */}
      <div className="bg-card border border-border p-4 rounded-2xl shadow-xs flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
            <FlaskConical className="w-4 h-4 text-muted-foreground" /> Plant QA vs. ZMCC Dispatch QA Audit
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Dispatch test values compared with plant results
          </p>
        </div>
      </div>

      {/* KPI Ribbon */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard
          label="Total Dispatched"
          value={<span>{totalDispatched.toLocaleString()} <span className="text-xs font-normal text-muted-foreground">L</span></span>}
          hint="Across all filtered tankers"
        />
        <StatCard
          label="Plant Accepted"
          value={<span>{totalReceived.toLocaleString()} <span className="text-xs font-normal text-muted-foreground">L</span></span>}
          hint="Weighbridge net weight truth"
        />
        <StatCard
          label="Transit Volume Variance"
          value={totalVariance != null ? <span>{fmtSigned(totalVariance, 0)} <span className="text-xs font-normal text-muted-foreground">L</span></span> : '—'}
          hint={avgVariancePct != null ? `${fmtSigned(avgVariancePct, 2)}% of dispatched, arrived tankers only` : 'Arrived tankers only'}
          tone={avgVariancePct != null && avgVariancePct < -LOSS_FLAG_PCT ? 'danger' : 'default'}
        />
        <StatCard
          label="Flagged Tankers"
          value={filteredRows.filter((r) => r.status.startsWith('FLAGGED')).length}
          hint="High loss or QA deviation"
          tone={filteredRows.some((r) => r.status.startsWith('FLAGGED')) ? 'warning' : 'success'}
        />
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-card border border-border p-3 rounded-xl">
        <div className="relative flex-1 min-w-50 max-w-sm">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search dispatch note, tanker, or ZMCC…"
            className="w-full pl-8 pr-3 py-2 bg-background border border-border rounded-lg text-xs font-medium text-foreground focus:outline-hidden focus:ring-1 focus:ring-primary placeholder:text-muted-foreground"
          />
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground font-medium">Status:</span>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-background border border-border rounded-lg px-3 py-1 text-xs font-medium text-foreground focus:outline-hidden focus:ring-1 focus:ring-primary cursor-pointer"
          >
            <option value="ALL">All Dispatches</option>
            <option value="ACCEPTED">Accepted (Normal)</option>
            <option value="FLAGGED_LOSS">High Loss Alert (&gt; {LOSS_FLAG_PCT}%)</option>
            <option value="FLAGGED_QA">QA Discrepancy Alert</option>
            <option value="IN_TRANSIT">In-Transit</option>
          </select>
        </div>
      </div>

      {/* Side-by-Side Audit Table */}
      <div className="bg-card border border-border rounded-xl shadow-xs overflow-hidden">
        <TableWrapper>
          <table className="w-full text-xs text-left border-collapse">
            <thead>
              {/* Category Super Header */}
              <tr className="border-b border-border bg-muted/80 text-muted-foreground font-semibold text-xs text-center">
                <th colSpan={4} className="py-2 px-3 border-r border-border text-left">
                  Tanker & Journey Identifiers
                </th>
                <th colSpan={3} className="py-2 px-3 border-r border-border bg-blue-50/50 dark:bg-blue-950/20 text-blue-800 dark:text-blue-300">
                  ZMCC Dispatch QA & Volume
                </th>
                <th colSpan={3} className="py-2 px-3 border-r border-border bg-emerald-50/50 dark:bg-emerald-950/20 text-emerald-800 dark:text-emerald-300">
                  Central Plant Reception QA & Volume
                </th>
                <th colSpan={4} className="py-2 px-3 bg-amber-50/50 dark:bg-amber-950/20 text-amber-800 dark:text-amber-300">
                  Transit Reconciliation & Test Deltas
                </th>
              </tr>

              {/* Sub Column Headers */}
              <tr className="border-b border-border bg-muted/40 text-muted-foreground font-semibold text-xs">
                <th className="py-2 px-3">Slip #</th>
                <th className="py-2 px-3">Vehicle #</th>
                <th className="py-2 px-3">Source ZMCC</th>
                <th className="py-2 px-3 border-r border-border">Date & Time</th>

                {/* Dispatch */}
                <th className="py-2 px-3 text-right bg-blue-50/20">Gross (L)</th>
                <th className="py-2 px-3 text-right bg-blue-50/20">Fat %</th>
                <th className="py-2 px-3 text-right border-r border-border bg-blue-50/20">LR</th>

                {/* Plant */}
                <th className="py-2 px-3 text-right bg-emerald-50/20">Accepted (L)</th>
                <th className="py-2 px-3 text-right bg-emerald-50/20">Fat %</th>
                <th className="py-2 px-3 text-right border-r border-border bg-emerald-50/20">LR</th>

                {/* Delta & Status */}
                <th className="py-2 px-3 text-right bg-amber-50/20">Variance (L)</th>
                <th className="py-2 px-3 text-right bg-amber-50/20">Variance %</th>
                <th className="py-2 px-3 text-right bg-amber-50/20">Fat Delta</th>
                <th className="py-2 px-3 text-center">Audit Status</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-border/60">
              {filteredRows.length === 0 && (
                <tr>
                  <td colSpan={14} className="py-8 px-3 text-center text-muted-foreground">
                    {query.isLoading ? 'Loading dispatches…' : query.isError ? 'Could not load dispatches.' : 'No dispatches found.'}
                  </td>
                </tr>
              )}
              {pagedRows.pageRows.map((row) => (
                <tr key={row.id} className="hover:bg-muted/30 transition-colors">
                  <td className="py-2 px-3 font-semibold text-foreground">{row.dispatchNote}</td>
                  <td className="py-2 px-3 font-mono">{row.vehicleNumber}</td>
                  <td className="py-2 px-3">{row.sourceZmcc}</td>
                  <td className="py-2 px-3 text-muted-foreground border-r border-border">
                    {row.dispatchDate ?? '—'}
                  </td>

                  {/* Dispatch Values */}
                  <td className="py-2 px-3 text-right tabular-nums font-mono font-medium">
                    {fmtNum(row.dispatchedLiters, undefined, ' L')}
                  </td>
                  <td className="py-2 px-3 text-right tabular-nums font-mono">{fmtNum(row.dispatchFat, 2, '%')}</td>
                  <td className="py-2 px-3 text-right tabular-nums font-mono border-r border-border">{fmtNum(row.dispatchLr, 1)}</td>

                  {/* Plant Values */}
                  <td className="py-2 px-3 text-right tabular-nums font-mono font-medium">
                    {row.status === 'IN_TRANSIT' ? '—' : fmtNum(row.plantAcceptedLiters, undefined, ' L')}
                  </td>
                  <td className="py-2 px-3 text-right tabular-nums font-mono">
                    {row.status === 'IN_TRANSIT' ? '—' : fmtNum(row.plantFat, 2, '%')}
                  </td>
                  <td className="py-2 px-3 text-right tabular-nums font-mono border-r border-border">
                    {row.status === 'IN_TRANSIT' ? '—' : fmtNum(row.plantLr, 1)}
                  </td>

                  {/* Deltas & Loss */}
                  <td className="py-2 px-3 text-right tabular-nums font-mono font-semibold text-foreground">
                    {row.status === 'IN_TRANSIT' ? '—' : fmtSigned(row.varianceLiters, 0, ' L')}
                  </td>
                  <td className={`py-2 px-3 text-right tabular-nums font-mono font-semibold ${
                    row.variancePct != null && row.variancePct < -LOSS_FLAG_PCT ? 'text-rose-600 dark:text-rose-400' : 'text-foreground'
                  }`}>
                    {row.status === 'IN_TRANSIT' ? '—' : fmtSigned(row.variancePct, 2, '%')}
                  </td>
                  <td className={`py-2 px-3 text-right tabular-nums font-mono ${
                    row.fatDelta != null && Math.abs(row.fatDelta) > 0.15 ? 'text-rose-600 font-semibold' : 'text-muted-foreground'
                  }`}>
                    {row.status === 'IN_TRANSIT' ? '—' : fmtSigned(row.fatDelta, 2, '%')}
                  </td>

                  {/* Status Pill */}
                  <td className="py-2 px-3 text-center">
                    {row.status === 'ACCEPTED' && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400 text-xs font-semibold border border-emerald-200 dark:border-emerald-800">
                        <CheckCircle2 className="w-3 h-3" /> Reconciled
                      </span>
                    )}
                    {row.status === 'FLAGGED_QA' && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-400 text-xs font-semibold border border-rose-200 dark:border-rose-800">
                        <AlertTriangle className="w-3 h-3" /> QA Discrepancy
                      </span>
                    )}
                    {row.status === 'FLAGGED_LOSS' && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400 text-xs font-semibold border border-amber-200 dark:border-amber-800">
                        <AlertTriangle className="w-3 h-3" /> High Loss (&gt;{LOSS_FLAG_PCT}%)
                      </span>
                    )}
                    {row.status === 'IN_TRANSIT' && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400 text-xs font-semibold border border-blue-200 dark:border-blue-800">
                        <Truck className="w-3 h-3" /> In-Transit
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrapper>
        {pagedRows.totalPages > 1 && (
          <Pagination
            page={pagedRows.page}
            totalPages={pagedRows.totalPages}
            totalRecords={pagedRows.totalRecords}
            pageSize={pagedRows.pageSize}
            noun="dispatches"
            onPageChange={pagedRows.setPage}
          />
        )}
      </div>
    </div>
  );
}
