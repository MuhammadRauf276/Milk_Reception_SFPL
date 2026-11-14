'use client';

import { useAutoClearMessage } from '@/frontend/hooks/useAutoClearMessage';
import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Calendar,
  CheckCircle2,
  Clock,
  Loader2,
  Scale,
  Search,
  Truck,
  Warehouse,
  X,
} from 'lucide-react';
import { fetchJson } from '@/lib/query/fetchJson';
import { getErrorMessage } from '@/lib/errors';
import type { WeighingQueueData, WeighingSessionView } from '@/backend/services/zmccTankService';
import { ZmccPager } from '@/frontend/modules/zmcc/shared/ZmccDrawer';
import { Pagination, useListPageSize, usePagedRows } from '@/components/ui/pagination';
import { WeighingEntryDrawer, type WeighingPolicyView } from './WeighingEntryDrawer';

const DEFAULT_POLICY: WeighingPolicyView = { manual_entry_enabled: false, allowed_units: 'BOTH' };

export type WeighingTab = 'WEIGH' | 'DONE';

function VehicleCard({ session, onOpen }: { session: WeighingSessionView; onOpen?: () => void }) {
  const done = session.status === 'UNLOADED';
  const isClickable = !done && Boolean(onOpen);

  const body = (
    <div className="flex flex-col justify-between h-full space-y-3">
      <div>
        {/* Header row: Vehicle with Truck icon + Source Type badge + Status badge */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center shrink-0">
              <Truck className="h-4 w-4 text-secondary-foreground" />
            </div>
            <div>
              <div className="text-sm font-semibold text-foreground tabular-nums leading-tight">
                {session.vehicle_number || 'Vehicle'}
              </div>
              <span
                className={`inline-block mt-0.5 px-2 py-0.5 rounded text-xs font-semibold tracking-wider ${
                  session.source_type === 'MC' ? 'bg-blue-100 text-blue-800' : 'bg-emerald-100 text-emerald-800'
                }`}
              >
                {session.source_type}
              </span>
            </div>
          </div>

          {done ? (
            <span className="inline-flex items-center gap-1 rounded-md bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800 shrink-0">
              <CheckCircle2 className="h-3.5 w-3.5" /> Unloaded
            </span>
          ) : session.values_complete ? (
            <span className="inline-flex items-center gap-1 rounded-md bg-blue-100 px-3 py-1 text-xs font-semibold text-blue-800 shrink-0">
              <Clock className="h-3.5 w-3.5" /> Values saved
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-md bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800 shrink-0">
              <Clock className="h-3.5 w-3.5" /> Ready
            </span>
          )}
        </div>

        {/* Source Name & Metadata Chips */}
        <div className="mt-3 space-y-1.5">
          <div className="text-sm font-semibold text-foreground line-clamp-1" title={session.source_name || ''}>
            {session.source_name || (session.source_type === 'MC' ? 'Route Milk' : 'Direct Supplier')}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {session.zmcc_token && (
              <span className="font-mono text-xs font-medium px-2 py-0.5 rounded bg-muted text-secondary-foreground border border-border">
                Token: {session.zmcc_token}
              </span>
            )}
            <span className="text-xs font-medium px-2 py-0.5 rounded bg-muted text-secondary-foreground border border-border">
              {session.portions.length} {session.portions.length === 1 ? 'portion' : 'portions'}
            </span>
          </div>
        </div>

        {/* Portions / Net Values (Clean pills instead of pipe string) */}
        {(done || session.values_complete) && session.portions.length > 0 && (
          <div className="mt-3 pt-3 border-t border-border">
            <div className="text-xs font-medium text-muted-foreground mb-1">Portion Weights:</div>
            <div className="flex flex-wrap gap-2">
              {session.portions.map((p) => {
                const hasVal = p.net_value !== null;
                const unit = p.net_unit === 'LITER' ? 'L' : 'kg';
                return (
                  <span
                    key={p.id}
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs tabular-nums font-semibold ${
                      hasVal
                        ? 'bg-muted text-foreground border border-border'
                        : 'bg-amber-50 text-amber-800 border border-amber-200'
                    }`}
                  >
                    <span className="text-muted-foreground font-normal">{p.label}:</span>
                    <span>{hasVal ? `${p.net_value} ${unit}` : 'Pending'}</span>
                  </span>
                );
              })}
            </div>
          </div>
        )}

        {/* Unloaded Destination Tank and Timestamp */}
        {done && (
          <div className="mt-2 space-y-1.5">
            <div className="flex items-center gap-2 text-xs font-medium text-secondary-foreground bg-subtle px-3 py-2 rounded-lg border border-border">
              <Warehouse className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span className="font-semibold text-foreground">{session.tank_code ? `Tank ${session.tank_code}` : 'Tank'}</span>
              {session.milk_source_name && (
                <>
                  <span className="text-neutral-300">·</span>
                  <span className="text-secondary-foreground break-words min-w-0">{session.milk_source_name}</span>
                </>
              )}
            </div>
            {session.unloaded_at && (
              <div className="text-xs text-muted-foreground flex items-center gap-1 px-1 font-medium">
                <Clock className="h-3 w-3 text-muted-foreground" />
                <span>
                  Unloaded:{' '}
                  {new Date(session.unloaded_at).toLocaleString('en-GB', {
                    day: 'numeric',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Call to action footer if ready */}
      {isClickable && (
        <div className="pt-2 border-t border-border flex items-center justify-between text-xs font-semibold text-primary">
          <span>{session.values_complete ? 'Update weights or unload' : 'Record weights'}</span>
          <span className="group-hover:translate-x-0.5 transition-transform">→</span>
        </div>
      )}
    </div>
  );

  if (!isClickable) {
    return <div className="bg-card border-border rounded-2xl border p-4 shadow-2xs flex flex-col justify-between">{body}</div>;
  }
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group block min-h-[44px] w-full rounded-2xl border border-action/30 bg-action-soft p-4 text-left shadow-2xs hover:shadow-md hover:border-action/50 focus:outline-hidden focus:ring-2 focus:ring-primary cursor-pointer transition-[color,background-color,border-color,box-shadow,opacity,transform] duration-150 flex flex-col justify-between hover:bg-action/10"
    >
      {body}
    </button>
  );
}

export const ZmccWeighingWorkspace: React.FC = () => {
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const urlView = searchParams?.get('view')?.toLowerCase();
  const [internalTab, setInternalTab] = useState<WeighingTab>('WEIGH');
  const activeTab: WeighingTab = urlView === 'done' ? 'DONE' : urlView === 'weigh' ? 'WEIGH' : internalTab;
  const setActiveTab = setInternalTab;
  const [range, setRange] = useState<'today' | '7days' | 'custom'>('today');
  const [fromDate, setFromDate] = useState<string>('');
  const [toDate, setToDate] = useState<string>('');
  const [search, setSearch] = useState<string>('');
  const [debouncedSearch, setDebouncedSearch] = useState<string>('');
  const [donePage, setDonePage] = useState(1);
  const [notice, setNotice] = useState<string | null>(null);
  useAutoClearMessage(notice, setNotice);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setDonePage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const handleRangeChange = (newRange: 'today' | '7days' | 'custom') => {
    setRange(newRange);
    setDonePage(1);
  };

  const handleFromDateChange = (val: string) => {
    setFromDate(val);
    setDonePage(1);
    if (val && toDate) {
      const start = new Date(`${val}T00:00:00`);
      const end = new Date(`${toDate}T00:00:00`);
      const diffDays = Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
      if (diffDays > 6) {
        const newEnd = new Date(start.getTime() + 6 * 24 * 60 * 60 * 1000);
        setToDate(newEnd.toISOString().split('T')[0]);
      } else if (diffDays < 0) {
        setToDate(val);
      }
    }
  };

  const handleToDateChange = (val: string) => {
    setToDate(val);
    setDonePage(1);
    if (val && fromDate) {
      const start = new Date(`${fromDate}T00:00:00`);
      const end = new Date(`${val}T00:00:00`);
      const diffDays = Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
      if (diffDays > 6) {
        const newStart = new Date(end.getTime() - 6 * 24 * 60 * 60 * 1000);
        setFromDate(newStart.toISOString().split('T')[0]);
      } else if (diffDays < 0) {
        setFromDate(val);
      }
    }
  };

  const donePageSize = useListPageSize(25);

  const queueQuery = useQuery({
    queryKey: ['zmcc', 'weighing', 'queue', { donePage, donePageSize, range, fromDate, toDate, search: debouncedSearch }],
    queryFn: ({ signal }) => {
      const params = new URLSearchParams();
      params.set('done_page', String(donePage));
      params.set('done_page_size', String(donePageSize));
      params.set('range', range);
      if (range === 'custom') {
        if (fromDate) params.set('from_date', fromDate);
        if (toDate) params.set('to_date', toDate);
      }
      if (debouncedSearch.trim()) {
        params.set('search', debouncedSearch.trim());
      }
      return fetchJson<WeighingQueueData>(`/api/zmcc/weighing/queue?${params.toString()}`, { signal });
    },
    refetchInterval: () => (typeof document !== 'undefined' && document.hidden ? false : 30_000),
  });

  const policyQuery = useQuery({
    queryKey: ['zmcc', 'weighing', 'policy'],
    queryFn: ({ signal }) => fetchJson<WeighingPolicyView>('/api/zmcc/weighing/policy', { signal }),
    staleTime: 60_000,
  });

  const data = queueQuery.data;
  const ready = data?.ready ?? [];
  const pagedReady = usePagedRows(ready, (s) => s.session_id);
  const done = data?.done ?? [];
  const tanks = data?.tanks ?? [];
  const sources = data?.sources ?? [];
  const totalPages = data ? Math.max(1, Math.ceil(data.done_total / data.done_page_size)) : 1;
  const error = queueQuery.error ? getErrorMessage(queueQuery.error) || 'Could not load the list.' : null;
  const reload = () => queryClient.invalidateQueries({ queryKey: ['zmcc', 'weighing'] });
  const openSession = ready.find((s) => s.session_id === openId) ?? null;

  return (
    <div className="space-y-4">
      {/* Top Header: Two Separate Tabs & Refresh Button */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 border-b border-border pb-3">
        {/* Two Tabs: Weigh Milk & Done / Unloaded */}

        {/* Global Refresh Button */}
        <button
          type="button"
          onClick={() => void reload()}
          disabled={queueQuery.isFetching}
          className="inline-flex items-center justify-center gap-2 min-h-11 px-4 rounded-lg border border-action/30 bg-action-soft hover:bg-action/15 active:scale-[0.98] text-xs font-semibold text-action cursor-pointer transition-colors shrink-0 disabled:opacity-50"
        >
          <Loader2 className={`h-3.5 w-3.5 ${queueQuery.isFetching ? 'animate-spin' : ''}`} />
          <span>Refresh</span>
        </button>
      </div>

      {notice && (
        <p role="status" className="flex items-center gap-2 rounded-lg border border-border bg-card p-3 text-sm font-semibold text-emerald-800">
          <CheckCircle2 className="h-4 w-4" /> {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-lg border border-border bg-card p-3 text-sm font-semibold text-rose-800">
          Problem: {error}
        </p>
      )}
      {queueQuery.isFetching && (
        <p className="flex items-center gap-2 text-sm text-secondary-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </p>
      )}

      {/* TAB 1: Weigh Milk (Ready to Weigh / Unload Queue) */}
      {activeTab === 'WEIGH' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-foreground">Ready to Weigh & Unload</h3>
              <p className="text-xs text-muted-foreground">
                Lab-approved vehicles waiting for weight and tank
              </p>
            </div>
            {ready.length > 0 && (
              <span className="text-xs font-medium text-muted-foreground">
                {ready.length} {ready.length === 1 ? 'vehicle' : 'vehicles'} waiting
              </span>
            )}
          </div>

          {!queueQuery.isLoading && ready.length === 0 && (
            <div className="rounded-2xl border border-dashed border-border p-8 text-center bg-subtle/50">
              <Truck className="h-8 w-8 text-neutral-300 mx-auto mb-2" />
              <p className="text-sm font-semibold text-secondary-foreground">No vehicles waiting</p>
              <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
                Vehicles appear here after lab approval.
              </p>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {pagedReady.pageRows.map((s) => (
              <VehicleCard
                key={s.session_id}
                session={s}
                onOpen={() => {
                  setNotice(null);
                  setOpenId(s.session_id);
                }}
              />
            ))}
          </div>

          {pagedReady.totalPages > 1 && (
            <Pagination
              page={pagedReady.page}
              totalPages={pagedReady.totalPages}
              totalRecords={pagedReady.totalRecords}
              pageSize={pagedReady.pageSize}
              noun="vehicles"
              onPageChange={pagedReady.setPage}
            />
          )}
        </div>
      )}

      {/* TAB 2: Done / Unloaded (Current Today & Range 7 Days Only) */}
      {activeTab === 'DONE' && (
        <div className="space-y-4">
          {/* Controls: Range buttons, custom date range capped to 7 days, search */}
          <div className="bg-card rounded-2xl border border-border p-4 shadow-2xs space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              {/* Range Selector: Today vs Last 7 Days vs Custom */}
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-semibold text-muted-foreground mr-1 flex items-center gap-1">
                  <Calendar className="h-3.5 w-3.5" /> Range:
                </span>
                <button
                  type="button"
                  onClick={() => handleRangeChange('today')}
                  className={`px-3 py-2 rounded-lg text-xs font-semibold transition-[color,background-color,border-color,box-shadow,opacity,transform] cursor-pointer ${
                    range === 'today'
                      ? 'bg-primary text-white shadow-2xs'
                      : 'bg-muted text-secondary-foreground hover:bg-muted/80 border border-border'
                  }`}
                >
                  Current Today
                </button>
                <button
                  type="button"
                  onClick={() => handleRangeChange('7days')}
                  className={`px-3 py-2 rounded-lg text-xs font-semibold transition-[color,background-color,border-color,box-shadow,opacity,transform] cursor-pointer ${
                    range === '7days'
                      ? 'bg-primary text-white shadow-2xs'
                      : 'bg-muted text-secondary-foreground hover:bg-muted/80 border border-border'
                  }`}
                >
                  Last 7 Days (Max)
                </button>
                <button
                  type="button"
                  onClick={() => handleRangeChange('custom')}
                  className={`px-3 py-2 rounded-lg text-xs font-semibold transition-[color,background-color,border-color,box-shadow,opacity,transform] cursor-pointer ${
                    range === 'custom'
                      ? 'bg-primary text-white shadow-2xs'
                      : 'bg-muted text-secondary-foreground hover:bg-muted/80 border border-border'
                  }`}
                >
                  Custom (Max 7 Days)
                </button>
              </div>

              {/* Search Box */}
              <div className="relative w-full sm:w-64">
                <Search className="h-3.5 w-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search vehicle, supplier, token…"
                  className="w-full pl-8 pr-8 py-2 rounded-xl border border-border bg-card text-xs font-medium focus:outline-hidden focus:ring-2 focus:ring-primary"
                />
                {search && (
                  <button
                    type="button"
                    onClick={() => setSearch('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-secondary-foreground cursor-pointer"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>

            {/* Custom Date Pickers (Enforcing max 7 days range) */}
            {range === 'custom' && (
              <div className="pt-2 border-t border-border flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2 text-xs">
                  <span className="font-semibold text-secondary-foreground">From:</span>
                  <input
                    type="date"
                    value={fromDate}
                    onChange={(e) => handleFromDateChange(e.target.value)}
                    className="px-3 py-2 rounded-lg border border-border bg-card text-xs font-medium"
                  />
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <span className="font-semibold text-secondary-foreground">To:</span>
                  <input
                    type="date"
                    value={toDate}
                    onChange={(e) => handleToDateChange(e.target.value)}
                    className="px-3 py-2 rounded-lg border border-border bg-card text-xs font-medium"
                  />
                </div>
                <span className="text-xs font-medium text-muted-foreground bg-muted px-3 py-1 rounded-md">
                  Range limited to 7 days maximum
                </span>
              </div>
            )}

            {/* Filter Summary Banner */}
            <div className="flex items-center justify-between text-xs text-secondary-foreground pt-1 border-t border-border">
              <span className="font-medium">
                {range === 'today' && 'Showing unloaded vehicles for today.'}
                {range === '7days' && `Showing unloaded vehicles for the last 7 days${data?.from_date ? ` (${data.from_date} to ${data.to_date})` : ''}.`}
                {range === 'custom' && `Custom range: ${data?.from_date ?? fromDate ?? 'start'} to ${data?.to_date ?? toDate ?? 'end'} (max 7 days).`}
              </span>
              <span className="font-semibold text-foreground tabular-nums">
                Total: {data?.done_total ?? done.length}
              </span>
            </div>
          </div>

          {/* Unloaded List or Empty State */}
          {!queueQuery.isLoading && done.length === 0 && (
            <div className="rounded-2xl border border-dashed border-border p-8 text-center bg-subtle/50">
              <CheckCircle2 className="h-8 w-8 text-neutral-300 mx-auto mb-2" />
              <p className="text-sm font-semibold text-secondary-foreground">No unloaded vehicles found</p>
              <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
                {range === 'today'
                  ? 'No vehicles were unloaded today yet. You can switch range to "Last 7 Days" to inspect previous records.'
                  : 'No records matched your date range or search filter.'}
              </p>
              {range !== 'today' && (
                <button
                  type="button"
                  onClick={() => {
                    setRange('today');
                    setSearch('');
                  }}
                  className="mt-3 px-3 py-2 rounded-lg text-xs font-semibold bg-card border border-border text-secondary-foreground hover:bg-muted cursor-pointer"
                >
                  Reset to Current Today
                </button>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {done.map((s) => (
              <VehicleCard key={s.session_id} session={s} />
            ))}
          </div>

          {totalPages > 1 && (
            <ZmccPager page={donePage} totalPages={totalPages} onPage={setDonePage} disabled={queueQuery.isFetching} />
          )}
        </div>
      )}

      {/* Weighing Entry Drawer */}
      {openSession && (
        <WeighingEntryDrawer
          key={openSession.session_id}
          session={openSession}
          tanks={tanks}
          sources={sources}
          policy={policyQuery.data ?? DEFAULT_POLICY}
          onClose={() => setOpenId(null)}
          onChanged={(m) => {
            setNotice(m);
            setOpenId(null);
            void reload();
          }}
        />
      )}
    </div>
  );
};

export default ZmccWeighingWorkspace;
