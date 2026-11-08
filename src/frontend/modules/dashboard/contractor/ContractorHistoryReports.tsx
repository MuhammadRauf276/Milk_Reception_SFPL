'use client';

import React, { useState, useMemo } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { fetchJson } from '@/lib/query/fetchJson';
import { MilkProcessLog } from '@backend/core/types';
import { ContractorHistoryMetrics, ContractorVehicleVisit } from './contractorManagerTypes';
import { DataTable, type DataColumn } from '@/components/ui/data-table';
import {
  buildContractorVehicleVisits,
  computeContractorHistoryMetrics,
} from './contractorManagerHelpers';
import {
  History,
  Calendar,
  Search,
  Scale,
  ArrowRightLeft,
  Truck,
  AlertCircle,
  CheckCircle2,
  ShieldCheck,
  Loader2,
} from 'lucide-react';
import { getErrorMessage } from '@/lib/errors';

interface ContractorHistoryReportsProps {
  initialLogs: MilkProcessLog[];
  serverBusinessDate: string;
  assignedSourceName: string;
}

export const ContractorHistoryReports: React.FC<ContractorHistoryReportsProps> = ({
  initialLogs,
  assignedSourceName,
}) => {
  const [fromDate, setFromDate] = useState<string>('');
  const [toDate, setToDate] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [page, setPage] = useState<number>(1);
  const [pageSize] = useState<number>(20);
  const [formError, setError] = useState<string | null>(null);
  // Null until the user applies/resets a filter; until then the server-provided initial logs are shown.
  const [applied, setApplied] = useState<{ fromDate: string; toDate: string; search: string } | null>(null);

  const historyQuery = useQuery({
    queryKey: ['contractor', 'history-logs', { ...applied, page, pageSize }],
    enabled: applied !== null,
    queryFn: ({ signal }) => {
      const params = new URLSearchParams();
      params.set('mode', applied!.fromDate || applied!.toDate ? 'report' : 'recent');
      params.set('dateBasis', 'reporting');
      params.set('page', String(page));
      params.set('pageSize', String(pageSize));
      if (applied!.fromDate) params.set('fromDate', applied!.fromDate);
      if (applied!.toDate) params.set('toDate', applied!.toDate);
      if (applied!.search.trim()) params.set('search', applied!.search.trim());
      return fetchJson<{
        items?: MilkProcessLog[];
        logs?: MilkProcessLog[];
        pagination?: { totalPages?: number; totalRecords?: number };
      }>(`/api/logs?${params.toString()}`, { signal });
    },
    placeholderData: keepPreviousData,
  });
  const logs = useMemo(
    () => historyQuery.data?.items ?? historyQuery.data?.logs ?? initialLogs,
    [historyQuery.data, initialLogs]
  );
  const loading = historyQuery.isFetching;
  const totalPages = historyQuery.data?.pagination?.totalPages ?? 1;
  const totalRecords = historyQuery.data?.pagination?.totalRecords ?? 0;
  const error = formError ?? (historyQuery.isError ? getErrorMessage(historyQuery.error) || 'Failed to load historical contractor records' : null);

  const handleApplyFilter = (e: React.FormEvent) => {
    e.preventDefault();
    if (fromDate && toDate && fromDate > toDate) {
      setError('From Date cannot be after To Date.');
      return;
    }
    setError(null);
    setPage(1);
    setApplied({ fromDate, toDate, search: searchQuery });
  };

  const handleResetFilter = () => {
    setFromDate('');
    setToDate('');
    setSearchQuery('');
    setPage(1);
    setError(null);
    setApplied({ fromDate: '', toDate: '', search: '' });
  };

  const visits = useMemo(() => {
    return buildContractorVehicleVisits(logs);
  }, [logs]);

  const metrics: ContractorHistoryMetrics = useMemo(() => {
    return computeContractorHistoryMetrics(visits);
  }, [visits]);

  // Local vehicle search filter
  const filteredVisits = useMemo(() => {
    return visits.filter((v) => {
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      const matchVeh = v.vehicleNumber.toLowerCase().includes(q);
      const matchRec = v.receptionNumber.toLowerCase().includes(q);
      const matchTok = v.tokenNumber ? v.tokenNumber.toLowerCase().includes(q) : false;
      return matchVeh || matchRec || matchTok;
    });
  }, [visits, searchQuery]);

  const columns: DataColumn<ContractorVehicleVisit>[] = [
    {
      key: 'vehicle',
      header: 'Vehicle',
      label: 'Vehicle',
      primary: true,
      cell: (v) => <span className="tabular-nums font-semibold text-foreground">{v.vehicleNumber}</span>,
    },
    {
      key: 'reception',
      header: 'Reception #',
      label: 'Reception #',
      cell: (v) => <span className="tabular-nums text-secondary-foreground text-xs">{v.receptionNumber}</span>,
    },
    {
      key: 'date',
      header: 'Reporting Date',
      label: 'Reporting Date',
      cell: (v) => (
        <div className="tabular-nums text-foreground text-xs">
          <span className="font-semibold">{v.reportingDate || '—'}</span>
          <span className="block text-xs text-muted-foreground font-normal">
            {v.finalReceiptExists ? 'Final Receipt Date' : 'Dispatch Date'}
          </span>
        </div>
      ),
    },
    {
      key: 'gross',
      header: 'Dispatch Gross',
      label: 'Dispatch Gross',
      align: 'right',
      cell: (v) => (
        <span className="tabular-nums font-semibold text-foreground">
          {v.grossLiters != null ? `${v.grossLiters.toLocaleString()} L` : '—'}
        </span>
      ),
    },
    {
      key: 'qa',
      header: 'QA Outcome',
      label: 'QA Outcome',
      cell: (v) => (
        <span
          className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${
            v.qaSummary.badgeType === 'ALL_ACCEPTED'
              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
              : v.qaSummary.badgeType === 'ALL_REJECTED'
              ? 'bg-rose-50 text-rose-700 border border-rose-200'
              : v.qaSummary.badgeType === 'HAS_HOLD'
              ? 'bg-amber-50 text-amber-700 border border-amber-200'
              : 'bg-subtle text-secondary-foreground border border-border'
          }`}
        >
          {v.qaSummary.summaryText}
        </span>
      ),
    },
    {
      key: 'lifecycle',
      header: 'Lifecycle / Receipt',
      label: 'Lifecycle / Receipt',
      cell: (v) =>
        v.finalReceiptExists ? (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-emerald-100 text-emerald-800 border border-emerald-200">
            Final Receipt
          </span>
        ) : v.secondWeightTimestamp ? (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-amber-100 text-amber-800 border border-amber-200">
            Receipt Pending
          </span>
        ) : (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-muted text-secondary-foreground border border-border">
            {v.journeyStageLabel}
          </span>
        ),
    },
    {
      key: 'received',
      header: 'Authoritative Received',
      label: 'Authoritative Received',
      align: 'right',
      cell: (v) => (
        <span className="tabular-nums font-semibold">
          {v.finalReceiptExists && v.authoritativeFinalLiters != null ? (
            <span className="text-emerald-700">{v.authoritativeFinalLiters.toLocaleString()} L</span>
          ) : (
            <span className="text-muted-foreground font-normal">Pending</span>
          )}
        </span>
      ),
    },
    {
      key: 'variance',
      header: 'Variance (L)',
      label: 'Variance (L)',
      align: 'right',
      cell: (v) => (
        <span className="tabular-nums font-semibold">
          {v.litersVariance != null ? (
            <span
              className={
                v.litersVariance < 0
                  ? 'text-rose-700'
                  : v.litersVariance > 0
                  ? 'text-emerald-700'
                  : 'text-secondary-foreground'
              }
            >
              {v.litersVariance > 0 ? '+' : ''}
              {v.litersVariance.toLocaleString()} L
            </span>
          ) : (
            <span className="text-muted-foreground font-normal">—</span>
          )}
        </span>
      ),
    },
  ];
  return (
    <div className="space-y-6">
      {/* 1. Header Scope Banner */}
      <div className="bg-card border-border p-5 rounded-2xl border shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center space-x-3">
          <div className="p-2.5 bg-blue-900 text-white rounded-xl shadow-xs">
            <History className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-foreground leading-tight">
              {assignedSourceName}: History & Operational Reports
            </h2>
            <p className="text-xs text-muted-foreground font-medium mt-0.5">
              History by report date
            </p>
          </div>
        </div>

      </div>

      {/* 2. Date Filter Toolbar */}
      <div className="bg-card border-border p-5 rounded-2xl border shadow-xs space-y-4">
        <form onSubmit={handleApplyFilter} className="flex flex-wrap items-end gap-3">
          {/* From Date */}
          <div className="flex-1 min-w-[160px]">
            <label className="block text-xs font-semibold text-secondary-foreground mb-1">
              From Date (YYYY-MM-DD)
            </label>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="w-full px-3 py-2 text-xs tabular-nums font-semibold bg-subtle border border-border-strong rounded-lg focus:outline-hidden focus:ring-2 focus:ring-blue-900 min-h-11"
            />
          </div>

          {/* To Date */}
          <div className="flex-1 min-w-[160px]">
            <label className="block text-xs font-semibold text-secondary-foreground mb-1">
              To Date (YYYY-MM-DD)
            </label>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="w-full px-3 py-2 text-xs tabular-nums font-semibold bg-subtle border border-border-strong rounded-lg focus:outline-hidden focus:ring-2 focus:ring-blue-900 min-h-11"
            />
          </div>

          {/* Search Box */}
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs font-semibold text-secondary-foreground mb-1">
              Search Vehicle / Token
            </label>
            <div className="relative">
              <Search className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search…"
                className="w-full pl-9 pr-3 py-2 text-xs tabular-nums font-semibold bg-subtle border border-border-strong rounded-lg focus:outline-hidden focus:ring-2 focus:ring-blue-900 min-h-11"
              />
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 bg-blue-900 hover:bg-blue-950 text-white rounded-lg text-xs font-semibold shadow-xs transition active:scale-95 disabled:opacity-50 flex items-center space-x-1.5 min-h-11"
            >
              <Calendar className="w-3.5 h-3.5" />
              <span>Apply Filter</span>
            </button>

            <button
              type="button"
              onClick={handleResetFilter}
              disabled={loading}
              className="px-4 py-2 bg-muted hover:bg-muted text-secondary-foreground rounded-lg text-xs font-semibold transition active:scale-95 disabled:opacity-50 min-h-11"
            >
              Reset
            </button>
          </div>
        </form>

        {error && (
          <div className="bg-card border-border p-3 rounded-xl border text-rose-800 text-xs font-semibold flex items-center space-x-2 animate-panel-in">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </div>

      {/* Bounded Page Notice */}
      {totalPages > 1 && (
        <div className="bg-card border-border p-3.5 rounded-2xl border text-xs text-amber-800 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
            <span>
              Showing page <strong>{page}</strong> of <strong>{totalPages}</strong> ({totalRecords} total visits in query). Volume and variance summaries below reflect the visible page.
            </span>
          </div>
          <span className="text-xs font-semibold text-amber-700">Bounded page metrics</span>
        </div>
      )}

      {/* 3. Summary Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Historical Visits */}
        <div className="bg-card border-border p-5 rounded-2xl border shadow-xs space-y-2">
          <div className="flex items-center justify-between text-muted-foreground text-xs font-semibold">
            <span>Historical Visits</span>
            <Truck className="w-4 h-4 text-muted-foreground" />
          </div>
          <p className="text-3xl font-semibold text-foreground tabular-nums">
            {totalRecords > 0 ? totalRecords : metrics.totalHistoryVisits}
          </p>
          <p className="text-xs text-muted-foreground font-medium">
            {totalPages > 1 ? (
              <span className="text-blue-700 font-semibold">Authoritative Total Query Visits</span>
            ) : (
              <>Dispatched: <strong className="text-secondary-foreground tabular-nums">{metrics.totalDispatchedGrossLiters.toLocaleString()} L</strong></>
            )}
          </p>
        </div>

        {/* Completed Receipts */}
        <div className="bg-card border-border p-5 rounded-2xl border shadow-xs space-y-2">
          <div className="flex items-center justify-between text-emerald-700 text-xs font-semibold">
            <span>Final Receipts {totalPages > 1 ? '(Current Page)' : ''}</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          </div>
          <p className="text-3xl font-semibold text-emerald-950 tabular-nums">
            {metrics.totalCompletedReceipts}
          </p>
          <p className="text-xs text-emerald-700 font-medium">
            {totalPages > 1 ? 'Page receipt count' : 'Posted Silo transactions'}
          </p>
        </div>

        {/* Total Received Liters */}
        <div className="bg-card border-border p-5 rounded-2xl border shadow-xs space-y-2">
          <div className="flex items-center justify-between text-blue-800 text-xs font-semibold">
            <span>Received Vol {totalPages > 1 ? '(Current Page)' : ''}</span>
            <Scale className="w-4 h-4 text-muted-foreground" />
          </div>
          <p className="text-2xl font-semibold text-blue-950 tabular-nums">
            {metrics.totalReceivedLiters.toLocaleString()} L
          </p>
          <p className="text-xs text-blue-700 font-medium">
            {totalPages > 1 ? `Page physical volume (${filteredVisits.length} visits)` : 'Authoritative physical volume'}
          </p>
        </div>

        {/* Net Liters Variance */}
        <div className="bg-card border-border p-5 rounded-2xl border shadow-xs space-y-2">
          <div className="flex items-center justify-between text-secondary-foreground text-xs font-semibold">
            <span>Net Variance {totalPages > 1 ? '(Current Page)' : ''}</span>
            <ArrowRightLeft className="w-4 h-4 text-secondary-foreground" />
          </div>
          <p
            className={`text-2xl font-semibold tabular-nums ${
              metrics.netLitersVariance == null
                ? 'text-muted-foreground'
                : metrics.netLitersVariance < 0
                ? 'text-rose-700'
                : metrics.netLitersVariance > 0
                ? 'text-emerald-700'
                : 'text-foreground'
            }`}
          >
            {metrics.netLitersVariance != null
              ? `${metrics.netLitersVariance > 0 ? '+' : ''}${metrics.netLitersVariance.toLocaleString()} L`
              : '—'}
          </p>
          <p className="text-xs text-muted-foreground font-medium">
            {totalPages > 1 ? 'Page received vs dispatched' : 'Received vs Dispatched (L)'}
          </p>
        </div>
      </div>

      {/* 4. Historical Ledger Table */}
      <div className="bg-card border-border p-5 sm:p-6 rounded-2xl border shadow-xs space-y-4">
        <div className="flex items-center justify-between border-b border-muted pb-3">
          <div className="flex items-center space-x-2">
            <History className="w-4 h-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold text-foreground">Historical Dispatches & Receipts</h3>
          </div>
          <span className="text-xs text-muted-foreground tabular-nums font-semibold">
            {filteredVisits.length} {filteredVisits.length === 1 ? 'record' : 'records'}
          </span>
        </div>

        <DataTable
          columns={columns}
          rows={filteredVisits}
          getRowId={(v) => String(v.visitId)}
          loading={loading}
          emptyTitle="No Historical Records Found"
          emptyDescription="No records"
          footer={
            totalPages > 1 && filteredVisits.length > 0 ? (
              <div className="flex flex-col sm:flex-row items-center justify-between gap-3 p-4 bg-subtle border border-border rounded-2xl text-xs font-semibold text-secondary-foreground">
                <div>
                  Showing <span className="font-semibold text-blue-950">{(page - 1) * pageSize + 1}</span> to{' '}
                  <span className="font-semibold text-blue-950">{Math.min(page * pageSize, totalRecords)}</span> of{' '}
                  <span className="font-semibold text-blue-950">{totalRecords}</span> visits
                </div>
                <div className="flex items-center space-x-2">
                  <button
                    type="button"
                    disabled={page <= 1 || loading}
                    onClick={() => {
                      const prev = Math.max(1, page - 1);
                      setPage(prev);
                    }}
                    className="px-3.5 py-1.5 min-h-11 bg-card border border-border-strong rounded-lg hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed font-semibold transition shadow-2xs"
                  >
                    Previous
                  </button>
                  <span className="px-2 text-xs tabular-nums font-semibold text-secondary-foreground">
                    Page {page} / {totalPages}
                  </span>
                  <button
                    type="button"
                    disabled={page >= totalPages || loading}
                    onClick={() => {
                      const next = Math.min(totalPages, page + 1);
                      setPage(next);
                    }}
                    className="px-3.5 py-1.5 min-h-11 bg-card border border-border-strong rounded-lg hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed font-semibold transition shadow-2xs"
                  >
                    Next
                  </button>
                </div>
              </div>
            ) : null
          }
        />
      </div>
    </div>
  );
};
