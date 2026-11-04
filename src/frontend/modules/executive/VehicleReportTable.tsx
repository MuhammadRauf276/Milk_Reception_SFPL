'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Eye, Truck } from 'lucide-react';
import { toast } from 'sonner';
import type { MilkProcessLog } from '@backend/core/types';
import { getPakistanCalendarDate } from '@backend/core/business-day';
import { fetchJson } from '@/lib/query/fetchJson';
import {
  REPORT_MAX_RANGE_DAYS,
  dateRangeProblem,
  type ReportColumnFilters,
  type ReportColumnKey,
  type VehiclePortionReport,
  type VehiclePortionRow,
} from '@/backend/services/management/vehiclePortionReport';
import { ZMCCManagerVisitDetailModal } from '@/frontend/modules/dashboard/zmcc/ZMCCManagerVisitDetailModal';
import { VisitPhotosSection } from './VisitPhotosSection';

const EMPTY = '—';
const SEARCH_DELAY_MS = 400;

const showNumber = (v: number | null, suffix = '') => (v == null ? EMPTY : `${v.toLocaleString()}${suffix}`);

const daysBefore = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);

const decisionClass = (d: string) =>
  d === 'ACCEPTED'
    ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
    : d === 'REJECTED'
    ? 'bg-rose-50 text-rose-800 border-rose-200'
    : d === 'HOLD'
    ? 'bg-amber-50 text-amber-800 border-amber-200'
    : 'bg-slate-100 text-slate-700 border-slate-200';

interface Column {
  key: ReportColumnKey;
  label: string;
  numeric?: boolean;
  render: (r: VehiclePortionRow) => React.ReactNode;
}

const num = (key: ReportColumnKey, label: string, pick: (r: VehiclePortionRow) => number | null, suffix = ''): Column => ({
  key,
  label,
  numeric: true,
  render: (r) => showNumber(pick(r), suffix),
});

const COLUMNS: Column[] = [
  { key: 'vehicle', label: 'Vehicle', render: (r) => <span className="font-semibold text-slate-900">{r.vehicle}</span> },
  { key: 'token', label: 'Token', render: (r) => r.token || EMPTY },
  { key: 'source', label: 'Source', render: (r) => r.source },
  { key: 'date', label: 'Dispatched', render: (r) => r.date },
  { key: 'stage', label: 'Stage', render: (r) => r.stage },
  { key: 'portion', label: 'Portion', render: (r) => <span className="font-semibold">{r.portion}</span> },
  {
    key: 'decision',
    label: 'Decision',
    render: (r) => (
      <span className={`px-2 py-0.5 rounded border text-[11px] font-semibold ${decisionClass(r.decision)}`}>{r.decision}</span>
    ),
  },
  {
    key: 'quantity',
    label: 'Quantity',
    numeric: true,
    render: (r) => (r.quantity == null ? EMPTY : `${r.quantity.toLocaleString()} ${r.quantityUnit ?? ''}`),
  },
  num('dispatchFat', 'Fat Dispatch', (r) => r.dispatchFat),
  num('plantFat', 'Fat Plant', (r) => r.plantFat),
  num('dispatchLr', 'LR Dispatch', (r) => r.dispatchLr),
  num('plantLr', 'LR Plant', (r) => r.plantLr),
  num('dispatchSnf', 'SNF Dispatch', (r) => r.dispatchSnf),
  num('plantSnf', 'SNF Plant', (r) => r.plantSnf),
  num('dispatchTs', 'TS Dispatch', (r) => r.dispatchTs),
  num('plantTs', 'TS Plant', (r) => r.plantTs),
  num('dispatch13Ts', 'Dispatch @13 TS', (r) => (r.isFirstPortion ? r.dispatch13Ts : null), ' L'),
  num('firstWeight', 'First Weight', (r) => (r.isFirstPortion ? r.firstWeight : null), ' kg'),
  num('secondWeight', 'Second Weight', (r) => (r.isFirstPortion ? r.secondWeight : null), ' kg'),
  num('netWeight', 'Net Weight', (r) => (r.isFirstPortion ? r.netWeight : null), ' kg'),
  num('received13Ts', 'Received @13 TS', (r) => (r.isFirstPortion ? r.received13Ts : null), ' L'),
];

/** The vehicle report for a chosen date range: one row per portion, dispatch beside plant, a search on every column. */
export function VehicleReportTable({ showPhotos }: { showPhotos: boolean }) {
  const [to, setTo] = useState(() => getPakistanCalendarDate(new Date()));
  const [from, setFrom] = useState(() => daysBefore(getPakistanCalendarDate(new Date()), 6));
  const [page, setPage] = useState(1);
  const [typedFilters, setTypedFilters] = useState<ReportColumnFilters>({});
  const [filters, setFilters] = useState<ReportColumnFilters>({});
  const [inspectVisitId, setInspectVisitId] = useState<string | null>(null);

  // Wait for a pause in typing, so one search sends one request instead of one per letter.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setFilters(typedFilters);
      setPage(1);
    }, SEARCH_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [typedFilters]);

  const rangeProblem = dateRangeProblem(from, to);
  const params = useMemo(() => {
    const p = new URLSearchParams({ from, to, page: String(page) });
    for (const [key, value] of Object.entries(filters)) {
      if (value?.trim()) p.set(`f_${key}`, value.trim());
    }
    return p.toString();
  }, [from, to, page, filters]);

  // No background refresh: a report only asks the database when the person changes something.
  const reportQuery = useQuery({
    queryKey: ['executive', 'vehicle-report', params],
    queryFn: ({ signal }) => fetchJson<VehiclePortionReport>(`/api/executive/vehicles/report?${params}`, { signal }),
    enabled: !rangeProblem,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
    staleTime: 60_000,
  });
  const report = reportQuery.data;
  const rows = report?.rows ?? [];
  const totalPages = report?.totalPages ?? 1;
  const totalRows = report?.totalRows ?? 0;
  const currentPage = report?.page ?? page;
  const pageSize = report?.pageSize ?? 50;

  const visitQuery = useQuery({
    queryKey: ['executive', 'vehicle-report-visit', inspectVisitId],
    queryFn: ({ signal }) => fetchJson<{ items: MilkProcessLog[] }>(`/api/executive/vehicles/${inspectVisitId}`, { signal }),
    enabled: inspectVisitId != null,
  });
  const inspectLogs = visitQuery.data?.items;

  useEffect(() => {
    if (!visitQuery.isError) return;
    toast.error('Could not open this vehicle.');
    const timer = window.setTimeout(() => setInspectVisitId(null), 0);
    return () => window.clearTimeout(timer);
  }, [visitQuery.isError]);

  const inputClass =
    'px-3 py-2 text-xs font-semibold rounded-lg bg-subtle border border-border/80 text-foreground focus:ring-2 focus:ring-primary outline-hidden shadow-2xs min-h-11';

  return (
    <div className="space-y-4" role="region" aria-label="Vehicle report table">
      <div className="p-5 rounded-xl bg-card border border-border/80 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-border/80">
          <div className="flex items-center space-x-2">
            <Truck className="w-5 h-5 text-primary" />
            <h3 className="text-sm font-semibold text-foreground">Vehicle report</h3>
          </div>
          <span className="self-start sm:self-auto px-3 py-1 rounded-full text-xs tabular-nums font-semibold bg-blue-50 text-primary-hover border border-blue-200">
            {totalRows.toLocaleString()} portions
          </span>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs font-semibold text-slate-600 space-y-1">
            <span className="block">From</span>
            <input
              type="date"
              value={from}
              max={to}
              onChange={(e) => {
                setFrom(e.target.value);
                setPage(1);
              }}
              className={inputClass}
            />
          </label>
          <label className="text-xs font-semibold text-slate-600 space-y-1">
            <span className="block">To</span>
            <input
              type="date"
              value={to}
              min={from}
              onChange={(e) => {
                setTo(e.target.value);
                setPage(1);
              }}
              className={inputClass}
            />
          </label>
          <p className="text-xs text-slate-500 pb-3">Up to {REPORT_MAX_RANGE_DAYS} days at a time</p>
        </div>
        {rangeProblem && (
          <p className="text-xs font-semibold text-rose-800" role="alert">
            {rangeProblem}
          </p>
        )}
      </div>

      {reportQuery.isError && !rangeProblem && (
        <div className="bg-card border-border p-6 rounded-xl border text-center space-y-3" role="alert">
          <p className="text-xs font-semibold text-rose-800">{reportQuery.error.message || 'Failed to load the report.'}</p>
          <button
            onClick={() => void reportQuery.refetch()}
            className="px-4 py-2 rounded-xl bg-primary text-white text-xs font-semibold hover:bg-primary-hover transition min-h-11"
          >
            Retry Loading
          </button>
        </div>
      )}

      <div className={`overflow-x-auto rounded-xl bg-card border border-border/80 shadow-2xs transition-opacity ${reportQuery.isFetching ? 'opacity-70' : ''}`}>
        <table className="w-full text-left text-xs tabular-nums">
          <thead>
            <tr className="border-b border-border text-slate-500 uppercase tracking-wider">
              {COLUMNS.map((c) => (
                <th key={c.key} className={`px-2 py-2 font-semibold whitespace-nowrap ${c.numeric ? 'text-right' : ''}`}>
                  {c.label}
                </th>
              ))}
              <th className="px-2 py-2">
                <span className="sr-only">Inspect</span>
              </th>
            </tr>
            <tr className="border-b border-border">
              {COLUMNS.map((c) => (
                <th key={c.key} className="px-1 py-1 font-normal">
                  <input
                    type="search"
                    value={typedFilters[c.key] ?? ''}
                    onChange={(e) => setTypedFilters((prev) => ({ ...prev, [c.key]: e.target.value }))}
                    placeholder="Search"
                    aria-label={`Search ${c.label}`}
                    className="w-full min-w-20 px-2 py-1 text-xs rounded border border-border/80 bg-subtle text-foreground focus:ring-2 focus:ring-primary outline-hidden min-h-9"
                  />
                </th>
              ))}
              <th />
            </tr>
          </thead>
          <tbody className="divide-y divide-border/40">
            {rows.map((r) => (
              <tr key={r.key} className="hover:bg-slate-50/60">
                {COLUMNS.map((c) => (
                  <td key={c.key} className={`px-2 py-2 whitespace-nowrap ${c.numeric ? 'text-right' : ''}`}>
                    {c.render(r)}
                  </td>
                ))}
                <td className="px-2 py-1">
                  <button
                    onClick={() => setInspectVisitId(r.visitId)}
                    aria-label={`Inspect ${r.vehicle}`}
                    className="inline-flex items-center gap-1 px-2 rounded-lg bg-primary hover:bg-primary-hover text-white text-[11px] font-semibold transition min-h-9"
                  >
                    <Eye className="w-3 h-3" />
                    <span>Inspect</span>
                  </button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && !rangeProblem && (
              <tr>
                <td colSpan={COLUMNS.length + 1} className="px-4 py-8 text-center text-slate-500">
                  {reportQuery.isPending ? 'Loading report…' : 'No vehicles match these dates and searches.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="p-3.5 rounded-xl bg-card border border-border/80 shadow-2xs flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
          <span className="text-slate-600 font-semibold tabular-nums">
            Showing{' '}
            <strong className="text-foreground">
              {((currentPage - 1) * pageSize + 1).toLocaleString()}–{Math.min(currentPage * pageSize, totalRows).toLocaleString()}
            </strong>{' '}
            of <strong className="text-foreground">{totalRows.toLocaleString()}</strong> portions (Page {currentPage} of {totalPages})
          </span>
          <div className="flex items-center space-x-2">
            <button
              onClick={() => setPage(currentPage - 1)}
              disabled={currentPage <= 1}
              aria-label="Previous Page"
              className="inline-flex items-center space-x-1 px-3 py-1.5 rounded-lg border border-border bg-subtle hover:bg-muted text-xs font-semibold text-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition shadow-2xs min-h-11"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              <span>Previous</span>
            </button>
            <button
              onClick={() => setPage(currentPage + 1)}
              disabled={currentPage >= totalPages}
              aria-label="Next Page"
              className="inline-flex items-center space-x-1 px-3 py-1.5 rounded-lg border border-border bg-subtle hover:bg-muted text-xs font-semibold text-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition shadow-2xs min-h-11"
            >
              <span>Next</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      <AnimatePresence>
        {inspectVisitId && inspectLogs && inspectLogs.length > 0 && (
          <ZMCCManagerVisitDetailModal
            key="report-visit-detail"
            isOpen
            log={inspectLogs[0]}
            portions={inspectLogs}
            onClose={() => setInspectVisitId(null)}
            extraSection={showPhotos ? <VisitPhotosSection visitId={inspectLogs[0].id} /> : undefined}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
