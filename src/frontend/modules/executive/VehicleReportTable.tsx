'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ChevronDown, Eye } from 'lucide-react';
import { Pagination, useListPageSize } from '@/components/ui/pagination';
import { TableWrapper } from '@/components/ui/table-wrapper';
import { toast } from '@/frontend/lib/appToast';
import type { MilkProcessLog } from '@backend/core/types';
import { getPakistanCalendarDate } from '@backend/core/business-day';
import { fetchJson } from '@/lib/query/fetchJson';
import {
  REPORT_MAX_RANGE_DAYS,
  SOURCE_TYPES,
  dateRangeProblem,
  type SourceTypeFilter,
  type ReportColumnFilters,
} from '@/backend/services/management/vehiclePortionReport';
import type { VehicleVisitReport, VehicleVisitRow } from '@/backend/services/management/vehicleVisitReport';
import { formatOperationalDatetime } from '@/lib/datetime-utils';
import { ZMCCManagerVisitDetailModal } from '@/frontend/modules/dashboard/zmcc/ZMCCManagerVisitDetailModal';
import { VisitPhotosSection } from './VisitPhotosSection';
import { ErrorPopup } from '@/components/ui/error-popup';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { InfoTip } from '@/components/ui/info-tip';
import { SOURCE_TYPE_LABELS, VehicleExcelButton } from './VehicleExcelButton';

interface SourceOption {
  id: string;
  name: string;
  code: string;
  type: string;
  active: boolean;
}

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
    : d === 'PARTLY ACCEPTED'
    ? 'bg-amber-50 text-amber-800 border-amber-200'
    : 'bg-muted text-secondary-foreground border-border';

/** Dispatch, plant and their difference in one cell, each with its name, so one measure takes one column. */
function Compare({ dispatch, plant, decimals = 2, suffix = '' }: { dispatch: number | null; plant: number | null; decimals?: number; suffix?: string }) {
  const show = (v: number | null) => (v == null ? EMPTY : `${v.toLocaleString(undefined, { maximumFractionDigits: decimals })}${suffix}`);
  const diff = dispatch != null && plant != null ? Math.round((plant - dispatch) * 10 ** decimals) / 10 ** decimals : null;
  const diffClass = diff == null || diff === 0 ? 'text-muted-foreground' : diff < 0 ? 'text-rose-700' : 'text-emerald-700';
  return (
    <table className="ml-auto text-xs leading-snug">
      <tbody>
        <tr>
          <td className="pr-2 py-0 text-left text-muted-foreground">Dispatch</td>
          <td className="py-0 text-right text-secondary-foreground">{show(dispatch)}</td>
        </tr>
        <tr>
          <td className="pr-2 py-0 text-left text-muted-foreground">Plant</td>
          <td className="py-0 text-right font-semibold text-foreground">{show(plant)}</td>
        </tr>
        <tr>
          <td className="pr-2 py-0 text-left text-muted-foreground">Diff</td>
          <td className={`py-0 text-right font-semibold ${diffClass}`}>
            {diff == null ? EMPTY : `${diff > 0 ? '+' : ''}${diff.toLocaleString(undefined, { maximumFractionDigits: decimals })}${suffix}`}
          </td>
        </tr>
      </tbody>
    </table>
  );
}

type SearchKey = 'vehicle' | 'token' | 'source' | 'date' | 'stage' | 'decision';

interface Column {
  id: string;
  label: string;
  /** Text columns get a search box. */
  search?: SearchKey;
  numeric?: boolean;
  render: (r: VehicleVisitRow) => React.ReactNode;
}

const COLUMNS: Column[] = [
  { id: 'vehicle', label: 'Vehicle', search: 'vehicle', render: (r) => <span className="font-semibold text-foreground">{r.vehicle}</span> },
  { id: 'token', label: 'Token', search: 'token', render: (r) => r.token || EMPTY },
  { id: 'source', label: 'Source', search: 'source', render: (r) => r.source },
  { id: 'date', label: 'Dispatched', search: 'date', render: (r) => r.date },
  { id: 'stage', label: 'Stage', search: 'stage', render: (r) => r.stage },
  {
    id: 'decision',
    label: 'Decision',
    search: 'decision',
    render: (r) => <span className={`px-2 py-0.5 rounded border text-xs font-semibold whitespace-nowrap ${decisionClass(r.decision)}`}>{r.decision}</span>,
  },
  {
    id: 'portions',
    label: 'Compartments',
    numeric: true,
    render: (r) => (
      <span title={r.plantAddedPortions > 0 ? `${r.plantAddedPortions} added at the plant` : undefined}>
        {r.portions}
        {r.plantAddedPortions > 0 && <span className="text-muted-foreground"> ({r.plantAddedPortions} plant)</span>}
      </span>
    ),
  },
  { id: 'fat', label: 'Fat', numeric: true, render: (r) => <Compare dispatch={r.dispatchFat} plant={r.plantFat} /> },
  { id: 'lr', label: 'LR', numeric: true, render: (r) => <Compare dispatch={r.dispatchLr} plant={r.plantLr} /> },
  { id: 'snf', label: 'SNF', numeric: true, render: (r) => <Compare dispatch={r.dispatchSnf} plant={r.plantSnf} decimals={3} /> },
  { id: 'ts', label: 'TS', numeric: true, render: (r) => <Compare dispatch={r.dispatchTs} plant={r.plantTs} decimals={3} /> },
  { id: 'gross', label: 'Gross L', numeric: true, render: (r) => <Compare dispatch={r.dispatchGrossLiters} plant={r.receivedGrossLiters} /> },
  { id: 'at13', label: '@13 TS L', numeric: true, render: (r) => <Compare dispatch={r.dispatch13Ts} plant={r.received13Ts} /> },
  { id: 'net', label: 'Net kg', numeric: true, render: (r) => showNumber(r.netWeight) },
  { id: 'gateOut', label: 'Gate exit', render: (r) => (r.gateOutAt ? formatOperationalDatetime(r.gateOutAt) : EMPTY) },
];

/** The vehicle report for a chosen date range: one row per vehicle, dispatch to plant in one cell per measure. */
export function VehicleReportTable({ showPhotos }: { showPhotos: boolean }) {
  const [to, setTo] = useState(() => getPakistanCalendarDate(new Date()));
  const [from, setFrom] = useState(() => daysBefore(getPakistanCalendarDate(new Date()), 6));
  const [page, setPage] = useState(1);
  const [typedFilters, setTypedFilters] = useState<ReportColumnFilters>({});
  const [filters, setFilters] = useState<ReportColumnFilters>({});
  const requestedPageSize = useListPageSize(25);
  const [inspectVisitId, setInspectVisitId] = useState<string | null>(null);
  const [sourceType, setSourceType] = useState<SourceTypeFilter>('ALL');
  const [sourceIds, setSourceIds] = useState<string[]>([]);

  const sourcesQuery = useQuery({
    queryKey: ['executive', 'vehicle-report-sources'],
    queryFn: ({ signal }) => fetchJson<{ items: SourceOption[] }>('/api/executive/vehicles/sources', { signal }),
    staleTime: 300_000,
    refetchOnWindowFocus: false,
  });
  const sourceOptions = useMemo(
    () => (sourcesQuery.data?.items ?? []).filter((s) => sourceType === 'ALL' || s.type === sourceType),
    [sourcesQuery.data, sourceType]
  );

  const chooseSourceType = (type: SourceTypeFilter) => {
    setSourceType(type);
    // A chosen source of the other kind would leave the report empty.
    setSourceIds((prev) => prev.filter((id) => (sourcesQuery.data?.items ?? []).some((s) => s.id === id && (type === 'ALL' || s.type === type))));
    setPage(1);
  };
  const toggleSource = (id: string) => {
    setSourceIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    setPage(1);
  };

  // Wait for a pause in typing, so one search sends one request instead of one per letter.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setFilters(typedFilters);
      setPage(1);
    }, SEARCH_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [typedFilters]);

  const rangeProblem = dateRangeProblem(from, to);
  // The dates, the source choice and the column searches: the same for the screen and the Excel file.
  const filterParams = useMemo(() => {
    const p = new URLSearchParams({ from, to });
    if (sourceType !== 'ALL') p.set('sourceType', sourceType);
    if (sourceIds.length > 0) p.set('sourceIds', sourceIds.join(','));
    for (const [key, value] of Object.entries(filters)) {
      if (value?.trim()) p.set(`f_${key}`, value.trim());
    }
    return p;
  }, [from, to, sourceType, sourceIds, filters]);
  const params = useMemo(() => {
    const p = new URLSearchParams(filterParams);
    p.set('page', String(page));
    p.set('pageSize', String(requestedPageSize));
    return p.toString();
  }, [filterParams, page, requestedPageSize]);

  // No background refresh: a report only asks the database when the person changes something.
  const reportQuery = useQuery({
    queryKey: ['executive', 'vehicle-report', params],
    queryFn: ({ signal }) => fetchJson<VehicleVisitReport>(`/api/executive/vehicles/report?${params}`, { signal }),
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
  const pageSize = report?.pageSize ?? requestedPageSize;

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
      <div className="p-4 rounded-2xl bg-card border border-border/80 shadow-xs space-y-3">
        <div className="grid grid-cols-2 lg:flex lg:flex-wrap lg:items-end gap-3">
          <label className="text-xs font-semibold text-secondary-foreground space-y-1">
            <span className="block">From</span>
            <input
              type="date"
              value={from}
              max={to}
              onChange={(e) => {
                setFrom(e.target.value);
                setPage(1);
              }}
              className={`${inputClass} w-full`}
            />
          </label>
          <label className="text-xs font-semibold text-secondary-foreground space-y-1">
            <span className="block">To</span>
            <input
              type="date"
              value={to}
              min={from}
              onChange={(e) => {
                setTo(e.target.value);
                setPage(1);
              }}
              className={`${inputClass} w-full`}
            />
          </label>
          <div className="col-span-2 lg:col-span-1 text-xs font-semibold text-secondary-foreground space-y-1">
            <span className="block">Dispatched from</span>
            <div className="flex gap-1 p-1 rounded-lg bg-muted/60 border border-border min-h-11" role="radiogroup" aria-label="Dispatched from">
              {SOURCE_TYPES.map((t) => (
                <button
                  key={t}
                  type="button"
                  role="radio"
                  aria-checked={sourceType === t}
                  onClick={() => chooseSourceType(t)}
                  className={`flex-1 lg:flex-initial min-h-9 px-3 rounded-md text-xs font-semibold transition ${
                    sourceType === t ? 'bg-primary text-white shadow-2xs' : 'text-secondary-foreground hover:text-foreground'
                  }`}
                >
                  {SOURCE_TYPE_LABELS[t]}
                </button>
              ))}
            </div>
          </div>
          <div className="col-span-2 lg:col-span-1 text-xs font-semibold text-secondary-foreground space-y-1">
            <span className="block">Source</span>
            <Popover>
              <PopoverTrigger asChild>
                <button type="button" className={`${inputClass} w-full lg:w-auto inline-flex items-center justify-between gap-2 min-w-44`}>
                  <span>{sourceIds.length === 0 ? 'All sources' : `${sourceIds.length} chosen`}</span>
                  <ChevronDown className="w-4 h-4 text-muted-foreground" />
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-72 p-2 max-h-80 overflow-y-auto">
                <button
                  type="button"
                  onClick={() => {
                    setSourceIds([]);
                    setPage(1);
                  }}
                  className="w-full text-left min-h-9 px-2 rounded text-xs font-semibold text-primary hover:bg-subtle"
                >
                  All sources
                </button>
                {sourceOptions.map((s) => (
                  <label key={s.id} className="flex items-center gap-2 min-h-9 px-2 rounded text-xs text-foreground cursor-pointer hover:bg-subtle">
                    <input type="checkbox" checked={sourceIds.includes(s.id)} onChange={() => toggleSource(s.id)} className="w-4 h-4 accent-primary" />
                    <span className="flex-1 truncate">{s.name}</span>
                    <span className="text-muted-foreground">{s.type === 'ZMCC' ? 'ZMCC' : 'Contractor'}</span>
                  </label>
                ))}
                {sourceOptions.length === 0 && <p className="px-2 py-3 text-xs text-muted-foreground">{sourcesQuery.isPending ? 'Loading…' : 'No sources'}</p>}
              </PopoverContent>
            </Popover>
          </div>
          <div className="col-span-2 lg:col-span-1 lg:ml-auto flex items-center justify-between lg:justify-end gap-2">
            <span className="px-3 py-1 rounded-md text-xs tabular-nums font-semibold bg-blue-50 text-primary-hover border border-blue-200">
              {totalRows.toLocaleString()} {totalRows === 1 ? 'vehicle' : 'vehicles'}
            </span>
            <InfoTip
              text={`One row per vehicle. Each cell shows the dispatch value, the plant value and the difference (plant minus dispatch). A vehicle can have several compartments; Inspect shows each one. Up to ${REPORT_MAX_RANGE_DAYS} days at a time. Excel uses the same filters.`}
            />
            <VehicleExcelButton getParams={() => rangeProblem ?? new URLSearchParams(filterParams)} />
          </div>
        </div>
        {rangeProblem && (
          <p className="text-xs font-semibold text-rose-800" role="alert">
            {rangeProblem}
          </p>
        )}
      </div>

      <ErrorPopup message={reportQuery.isError && !rangeProblem ? reportQuery.error.message || 'Failed to load the report.' : null} onRetry={() => void reportQuery.refetch()} />

      <TableWrapper className={`rounded-xl bg-card border border-border/80 shadow-2xs transition-opacity ${reportQuery.isFetching ? 'opacity-70' : ''}`}>
        <table className="w-full text-left text-xs tabular-nums">
          <thead>
            <tr className="border-b border-border text-muted-foreground">
              {COLUMNS.map((c) => (
                <th key={c.id} className={`px-2 py-2 font-semibold whitespace-nowrap ${c.numeric ? 'text-right' : ''}`}>
                  {c.label}
                </th>
              ))}
              <th className="px-2 py-2">
                <span className="sr-only">Inspect</span>
              </th>
            </tr>
            <tr className="border-b border-border">
              {COLUMNS.map((c) => {
                const key = c.search;
                return (
                  <th key={c.id} className="px-1 py-1 font-normal">
                    {key && (
                      <input
                        type="search"
                        value={typedFilters[key] ?? ''}
                        onChange={(e) => setTypedFilters((prev) => ({ ...prev, [key]: e.target.value }))}
                        placeholder="Search"
                        aria-label={`Search ${c.label}`}
                        className="w-full min-w-20 px-2 py-1 text-xs rounded border border-border/80 bg-subtle text-foreground focus:ring-2 focus:ring-primary outline-hidden min-h-9"
                      />
                    )}
                  </th>
                );
              })}
              <th />
            </tr>
          </thead>
          <tbody className="divide-y divide-border/40">
            {rows.map((r) => (
              <tr key={r.visitId} className="hover:bg-subtle/60">
                {COLUMNS.map((c) => (
                  <td key={c.id} className={`px-2 py-2 whitespace-nowrap align-top ${c.numeric ? 'text-right' : ''}`}>
                    {c.render(r)}
                  </td>
                ))}
                <td className="px-2 py-1">
                  <button
                    onClick={() => setInspectVisitId(r.visitId)}
                    aria-label={`Inspect ${r.vehicle}`}
                    className="inline-flex items-center gap-1 px-2 rounded-lg bg-primary hover:bg-primary-hover text-white text-xs font-semibold transition min-h-9"
                  >
                    <Eye className="w-3 h-3" />
                    <span>Inspect</span>
                  </button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && !rangeProblem && (
              <tr>
                <td colSpan={COLUMNS.length + 1} className="px-4 py-8 text-center text-muted-foreground">
                  {reportQuery.isPending ? 'Loading report…' : 'No vehicles match these dates and searches.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </TableWrapper>

      {totalPages > 1 && (
        <div className="rounded-2xl bg-card border border-border/80 shadow-2xs overflow-hidden">
          <Pagination
            page={currentPage}
            totalPages={totalPages}
            totalRecords={totalRows}
            pageSize={pageSize}
            noun="vehicles"
            onPageChange={setPage}
          />
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
