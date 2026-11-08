'use client';

import React, { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Search, Truck } from 'lucide-react';

import { formatDispatchQuantity } from '@/backend/modules/dispatch/quantity/dispatchQuantityService';
import { getErrorMessage } from '@/lib/errors';
import { fetchJson } from '@/lib/query/fetchJson';
import { Button } from '@/components/ui/button';
import { EmptyState, ErrorState } from '@/components/ui/empty-state';
import { SkeletonList } from '@/components/ui/loaders';
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
  const pageSize = 20;
  const q = useDebouncedValue(searchQuery.trim(), 300);

  const query = useQuery({
    queryKey: ['super-admin', 'operations', { q, page }],
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

  return (
    <div className="w-full min-w-0 space-y-6">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
        <p className="min-w-0 text-sm text-muted-foreground">Vehicle visits from gate to silo</p>

        {/* SEARCH FORM */}
        <form onSubmit={(e) => e.preventDefault()} className="flex min-w-0 max-w-full flex-1 flex-wrap items-center gap-2 sm:max-w-md">
          <div className="relative min-w-[min(100%,12rem)] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setPage(1);
              }}
              placeholder="Search vehicle or visit #"
              aria-label="Search vehicle or visit number"
              className="min-h-11 w-full rounded-lg border border-input bg-card pl-9 pr-3 text-sm focus:border-primary focus:outline-hidden"
            />
          </div>
          <Button type="submit">Search</Button>
        </form>
      </div>

      {error && <ErrorState description={error} onRetry={() => void query.refetch()} />}

      {/* VISITS LIST */}
      <div className="space-y-4">
        {loading ? (
          <SkeletonList count={3} />
        ) : visits.length === 0 ? (
          <EmptyState title="No vehicle visits found" />
        ) : (
          visits.map((v) => (
            <div key={v.id} className="min-w-0 space-y-4 rounded-2xl border border-border p-5 shadow-2xs bg-card">
              <div className="flex min-w-0 flex-wrap items-start justify-between gap-3 border-b border-border pb-3">
                <div className="flex min-w-0 items-center gap-3">
                  <Truck className="h-5 w-5 shrink-0 text-muted-foreground" />
                  <div className="min-w-0">
                    <h3 className="flex flex-wrap items-center gap-x-2 text-sm font-semibold text-foreground">
                      <span className="break-all font-mono">{v.vehicleNumber}</span>
                      <span className="break-all font-mono text-xs font-medium tabular-nums text-muted-foreground">({v.visitNumber})</span>
                    </h3>
                    <div className="text-xs text-muted-foreground">
                      Token: <span className="break-all font-mono font-semibold tabular-nums">{v.tokenNumber || 'N/A'}</span> | Created:{' '}
                      <span className="tabular-nums">{formatDateTime(v.createdAt)}</span>
                    </div>
                  </div>
                </div>

                <span className="rounded border border-border bg-muted px-3 py-1 text-xs font-medium tabular-nums text-foreground">
                  {v.currentStatus}
                </span>
              </div>

              {/* TIMELINE MILESTONE SUMMARY */}
              <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,12rem),1fr))] gap-3 rounded-lg border border-border bg-card p-3 text-xs">
                <div className="min-w-0">
                  <span className="block text-xs font-medium text-muted-foreground">Gate security</span>
                  <div className="mt-0.5 font-medium text-secondary-foreground">
                    Entry: {v.gateLog?.entryTimestamp ? formatTime(v.gateLog.entryTimestamp) : 'Pending'}
                  </div>
                  <div className="font-medium text-secondary-foreground">
                    Exit: {v.gateLog?.exitTimestamp ? formatTime(v.gateLog.exitTimestamp) : 'Pending'}
                  </div>
                </div>

                <div className="min-w-0">
                  <span className="block text-xs font-medium text-muted-foreground">Weighbridge tickets</span>
                  <div className="mt-0.5 font-mono font-medium tabular-nums text-secondary-foreground">
                    Gross: {v.weightTicket?.grossWeightKg ? `${v.weightTicket.grossWeightKg.toLocaleString()} kg` : 'Pending'}
                  </div>
                  <div className="font-mono font-medium tabular-nums text-secondary-foreground">
                    Tare: {v.weightTicket?.tareWeightKg ? `${v.weightTicket.tareWeightKg.toLocaleString()} kg` : 'Pending'}
                  </div>
                </div>

                <div className="min-w-0">
                  <span className="block text-xs font-medium text-muted-foreground">Net reception volume</span>
                  <div className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-foreground">
                    {v.weightTicket?.netWeightKg ? `${v.weightTicket.netWeightKg.toLocaleString()} kg net` : 'Pending'}
                  </div>
                </div>
              </div>

              {/* PORTIONS BREAKDOWN */}
              <div className="space-y-2">
                <h4 className="text-xs font-semibold text-secondary-foreground">Milk portions ({v.portions.length})</h4>
                <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,16rem),1fr))] gap-2 text-xs">
                  {v.portions.map((p) => (
                    <div key={p.id} className="min-w-0 space-y-1 rounded-lg border border-border bg-card p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2 font-semibold text-foreground">
                        <span className="min-w-0">Portion #{p.portionNumber} ({p.contractorName})</span>
                        <span className={`rounded px-2 py-0.5 text-xs ${
                          p.plantDecision === 'ACCEPTED'
                            ? 'bg-emerald-100 text-emerald-900'
                            : p.plantDecision === 'REJECTED'
                            ? 'bg-rose-100 text-rose-900'
                            : 'bg-amber-100 text-amber-900'
                        }`}>
                          {p.plantDecision || 'PENDING'}
                        </span>
                      </div>
                      <div className="text-xs text-secondary-foreground">
                        Dispatch qty: <strong className="font-mono tabular-nums">{formatDispatchQuantity(p.dispatchQuantityValue, p.dispatchQuantityUnit)}</strong>
                      </div>
                      {p.unloadingLog && (
                        <div className="text-xs text-secondary-foreground">
                          Silo: <strong className="font-mono">{p.unloadingLog.siloCode}</strong> ({p.unloadingLog.siloName})
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* PAGINATION CONTROLS */}
      {totalPages > 1 && (
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card px-4 py-3 text-xs font-medium text-secondary-foreground">
          <div className="min-w-0 tabular-nums">
            Page {currentPage} of {totalPages} ({totalRecords.toLocaleString()} total visits)
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" disabled={currentPage <= 1 || query.isFetching} onClick={() => goToPage(Math.max(1, currentPage - 1))}>
              Previous
            </Button>
            <Button variant="outline" disabled={currentPage >= totalPages || query.isFetching} onClick={() => goToPage(Math.min(totalPages, currentPage + 1))}>
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
