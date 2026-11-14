'use client';

import React, { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Truck } from 'lucide-react';

import { formatDispatchQuantity } from '@/backend/modules/dispatch/quantity/dispatchQuantityService';
import { getErrorMessage } from '@/lib/errors';
import { fetchJson } from '@/lib/query/fetchJson';
import { Button } from '@/components/ui/button';
import { DataFilters, type ActiveFilter } from '@/components/ui/data-filters';
import { DataTable, type DataColumn } from '@/components/ui/data-table';
import { ErrorState } from '@/components/ui/empty-state';
import { Pagination, useListPageSize } from '@/components/ui/pagination';
import { formatDateTime, formatTime } from '@/lib/format';
import { useDebouncedValue } from '@/frontend/modules/super-admin/shared/useDebouncedValue';

interface Portion {
  id: string;
  portionNumber: number;
  contractorName: string;
  dispatchQuantityValue: number | null;
  dispatchQuantityUnit: string | null;
  dispatchQuantityBasis?: string | null;
  provisionalPhysicalLiters?: number | null;
  plantDecision: string | null;
  rejectionReason: string | null;
  unloadingLog: {
    siloCode: string;
    siloName: string;
    status: string;
    provisionalPhysicalLiters?: number | null;
  } | null;
}

interface Visit {
  id: string;
  visitNumber: string;
  vehicleNumber: string;
  tokenNumber: string | null;
  currentStatus: string;
  createdAt: string;
  vehicleDispatchQuantityValue?: number | null;
  vehicleDispatchQuantityUnit?: string | null;
  gateLog: {
    entryTimestamp: string | null;
    exitTimestamp: string | null;
  } | null;
  weightTicket: {
    grossWeightKg: number | null;
    grossTimestamp: string | null;
    tareWeightKg: number | null;
    tareTimestamp: string | null;
    netWeightKg: number | null;
  } | null;
  portions: Portion[];
}

export default function SuperAdminOperationsPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = useListPageSize(25);
  const q = useDebouncedValue(searchQuery.trim(), 300);

  const query = useQuery({
    queryKey: ['super-admin', 'operations', { q, page, pageSize }],
    queryFn: ({ signal }) =>
      fetchJson<{ visits?: Visit[]; pagination?: { totalRecords: number; totalPages: number; page: number } }>(
        `/api/super-admin/operations?q=${encodeURIComponent(q)}&page=${page}&pageSize=${pageSize}`,
        { signal }
      ),
    placeholderData: keepPreviousData,
  });
  const visits = query.data?.visits ?? [];
  const loading = query.isPending;
  const error = query.error ? getErrorMessage(query.error) : null;
  const totalRecords = query.data?.pagination?.totalRecords ?? 0;
  const totalPages = query.data?.pagination?.totalPages ?? 1;
  const currentPage = query.data?.pagination?.page ?? page;
  const goToPage = (pageNum: number) => setPage(pageNum);

  const activeFilters: ActiveFilter[] = searchQuery.trim()
    ? [{ key: 'q', label: `Search: ${searchQuery.trim()}`, onClear: () => { setSearchQuery(''); setPage(1); } }]
    : [];

  const columns: DataColumn<Visit>[] = [
    {
      key: 'visit',
      header: 'Visit & Vehicle',
      label: 'Visit & Vehicle',
      primary: true,
      cell: (v) => (
        <div className="min-w-0 space-y-0.5">
          <div className="flex flex-wrap items-center gap-x-2">
            <span className="font-mono font-semibold text-foreground">{v.vehicleNumber}</span>
            <span className="font-mono text-xs tabular-nums text-muted-foreground">#{v.visitNumber}</span>
          </div>
          <div className="text-xs text-muted-foreground">
            Token: <span className="font-mono font-semibold tabular-nums">{v.tokenNumber || 'N/A'}</span> ·{' '}
            <span className="tabular-nums">{formatDateTime(v.createdAt)}</span>
          </div>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      label: 'Status',
      cardAlways: true,
      cell: (v) => (
        <span className="inline-flex rounded border border-border bg-muted px-2.5 py-0.5 text-xs font-medium tabular-nums text-foreground">
          {v.currentStatus}
        </span>
      ),
    },
    {
      key: 'gate',
      header: 'Gate security',
      label: 'Gate security',
      cell: (v) => (
        <div className="space-y-0.5 text-xs text-secondary-foreground tabular-nums">
          <div>In: {v.gateLog?.entryTimestamp ? formatTime(v.gateLog.entryTimestamp) : 'Pending'}</div>
          <div>Out: {v.gateLog?.exitTimestamp ? formatTime(v.gateLog.exitTimestamp) : 'Pending'}</div>
        </div>
      ),
    },
    {
      key: 'weights',
      header: 'Weights (kg)',
      label: 'Weights (kg)',
      cardAlways: true,
      align: 'right',
      cell: (v) => (
        <div className="space-y-0.5 font-mono text-xs tabular-nums">
          <div className="font-semibold text-foreground">
            {v.weightTicket?.netWeightKg ? `${v.weightTicket.netWeightKg.toLocaleString()} kg net` : 'Net pending'}
          </div>
          <div className="text-muted-foreground">
            G: {v.weightTicket?.grossWeightKg ? v.weightTicket.grossWeightKg.toLocaleString() : '—'} · T:{' '}
            {v.weightTicket?.tareWeightKg ? v.weightTicket.tareWeightKg.toLocaleString() : '—'}
          </div>
        </div>
      ),
    },
    {
      key: 'portions',
      header: 'Portions',
      label: 'Portions',
      align: 'center',
      cell: (v) => (
        <span className="rounded-md bg-subtle px-2 py-0.5 text-xs font-semibold tabular-nums text-secondary-foreground">
          {v.portions.length}
        </span>
      ),
    },
  ];

  return (
    <div className="w-full min-w-0 max-w-full space-y-4">
      {error && <ErrorState description={error} onRetry={() => void query.refetch()} />}

      <div className="w-full min-w-0 max-w-full rounded-2xl border border-border/80 bg-card shadow-2xs">
        <div className="space-y-3 border-b border-border p-3 sm:px-4 sm:py-3">
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <Truck className="h-4 w-4 shrink-0 text-primary" aria-hidden />
              <h2 className="text-sm font-semibold text-foreground">Vehicle visits</h2>
              <span className="rounded-md border border-border bg-subtle px-2 py-0.5 text-xs tabular-nums text-secondary-foreground">
                {totalRecords.toLocaleString()}
              </span>
              <span className="hidden text-xs text-muted-foreground sm:inline">Gate to silo timeline</span>
            </div>
            <Button
              variant="outline"
              size="sm"
              loading={query.isFetching && !loading}
              loadingText="Refreshing…"
              onClick={() => void query.refetch()}
            >
              Refresh
            </Button>
          </div>
          <DataFilters
            search={searchQuery}
            onSearchChange={(v) => {
              setSearchQuery(v);
              setPage(1);
            }}
            searchPlaceholder="Search vehicle or visit #"
            active={activeFilters}
          />
        </div>

        <div className="p-3 sm:p-4">
          <DataTable
            paginate={false}
            columns={columns}
            rows={visits}
            getRowId={(v) => v.id}
            loading={loading}
            stale={query.isFetching && !loading}
            emptyTitle="No vehicle visits found"
            tableFrom="lg"
            renderExpanded={(v) =>
              v.portions.length === 0 ? null : (
                <div className="space-y-1.5 text-xs">
                  <div className="font-semibold text-secondary-foreground">Milk portions ({v.portions.length})</div>
                  <div className="divide-y divide-border/70 rounded-lg border border-border/80 bg-card">
                    {v.portions.map((p) => (
                      <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                        <div className="min-w-0">
                          <span className="font-semibold text-foreground">
                            Portion #{p.portionNumber} ({p.contractorName})
                          </span>
                          <span className="ml-2 font-mono tabular-nums text-secondary-foreground">
                            {formatDispatchQuantity(p.dispatchQuantityValue, p.dispatchQuantityUnit)}
                          </span>
                          {p.unloadingLog ? (
                            <span className="ml-2 text-muted-foreground">
                              · Silo <strong className="font-mono text-foreground">{p.unloadingLog.siloCode}</strong> ({p.unloadingLog.siloName})
                            </span>
                          ) : null}
                        </div>
                        <span
                          className={`rounded px-2 py-0.5 text-xs font-medium ${
                            p.plantDecision === 'ACCEPTED'
                              ? 'bg-emerald-100 text-emerald-900'
                              : p.plantDecision === 'REJECTED'
                              ? 'bg-rose-100 text-rose-900'
                              : 'bg-amber-100 text-amber-900'
                          }`}
                        >
                          {p.plantDecision || 'PENDING'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )
            }
          />
        </div>

        <Pagination
          page={currentPage}
          totalPages={totalPages}
          totalRecords={totalRecords}
          pageSize={pageSize}
          noun="visits"
          disabled={query.isFetching}
          onPageChange={goToPage}
          className="border-t border-border bg-card"
        />
      </div>
    </div>
  );
}
