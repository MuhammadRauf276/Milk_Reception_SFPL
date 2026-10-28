'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { User } from '@core/types';
import { ChevronLeft, ChevronRight, Truck, Loader2 } from 'lucide-react';
import { DynamicDispatchForm } from '@modules/forms/DynamicDispatchForm';
import { SegmentedTabs } from '@/components/ui/segmented-tabs';
import { getErrorMessage } from '@/lib/errors';
import { fetchJson } from '@/lib/fetch-json';
import { useUrlSearchParam } from '@/frontend/hooks/useUrlSearchParam';

interface DispatchRecord {
  id: string;
  visit_number: string;
  reception_number: string | null;
  vehicle_number: string;
  token_number: string | null;
  raw_milk_dispatch_note_number?: string | null;
  dispatch_date?: string | null;
  dispatch_timestamp?: string | null;
  operational_date: string | null;
  current_status: string;
  portion_count: number;
  vehicle_dispatch_quantity_value?: number | null;
  vehicle_dispatch_quantity_unit?: string | null;
  vehicle_dispatch_lr?: number | null;
  vehicle_dispatch_density?: number | null;
  vehicle_dispatch_gross_liters?: number | null;
  vehicle_dispatch_at_13ts_liters?: number | null;
  zonal_contractor_name: string;
  zonal_contractor_dispatch_time: string | null;
  has_gate_entry: boolean;
  portions: Array<{
    id: string;
    portion_number: number;
    dispatch_quantity_value?: number | null;
    dispatch_quantity_unit?: string | null;
    plant_decision: string;
    current_status: string;
  }>;
}

interface PaginationMeta {
  page: number;
  pageSize: number;
  totalRecords: number;
  totalPages: number;
}

interface MPDFieldWorkspaceProps {
  currentUser: User | null;
  onRefresh?: () => void;
  hideTabBar?: boolean;
}

export const MPDFieldWorkspace: React.FC<MPDFieldWorkspaceProps> = ({
  currentUser,
  hideTabBar = false,
}) => {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // The URL's ?tab= picks the initial view until the user chooses one.
  const urlTab = useUrlSearchParam('tab')?.toLowerCase();
  const [selectedTab, setSelectedTab] = useState<'new' | 'recent' | null>(null);
  const activeTab: 'new' | 'recent' = selectedTab ?? (urlTab === 'recent' ? 'recent' : 'new');

  useEffect(() => {
    if (urlTab === 'recent' || urlTab === 'new') {
      setSelectedTab(urlTab);
    }
  }, [urlTab]);

  const handleTabChange = (tab: string) => {
    const validTab = tab === 'recent' ? 'recent' : 'new';
    setSelectedTab(validTab);
    const params = new URLSearchParams(searchParams?.toString() || '');
    params.set('tab', validTab);
    router.replace(`${pathname}?${params.toString()}`);
  };

  // Date Filter State
  const [dateRange, setDateRange] = useState<'today' | '7d' | '30d' | 'custom'>('7d');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [customDateError, setCustomDateError] = useState<string | null>(null);
  const [appliedCustomDates, setAppliedCustomDates] = useState({ from: '', to: '' });
  const [page, setPage] = useState(1);

  let queryUrl = `/api/dispatches?range=${dateRange}&page=${page}&pageSize=20`;
  if (dateRange === 'custom') {
    if (appliedCustomDates.from) queryUrl += `&fromDate=${appliedCustomDates.from}`;
    if (appliedCustomDates.to) queryUrl += `&toDate=${appliedCustomDates.to}`;
  }
  const shouldLoad = activeTab === 'recent' && Boolean(currentUser);

  const queryClient = useQueryClient();
  const dispatchesQuery = useQuery({
    queryKey: ['dispatches', dateRange, page, appliedCustomDates],
    queryFn: ({ signal }) =>
      fetchJson<{ dispatches?: DispatchRecord[]; pagination?: PaginationMeta }>(
        queryUrl,
        { signal },
        'Failed to fetch dispatches'
      ),
    enabled: shouldLoad,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });

  const dbDispatches = dispatchesQuery.data?.dispatches ?? [];
  const pagination = dispatchesQuery.data?.pagination ?? {
    page: 1,
    pageSize: 20,
    totalRecords: 0,
    totalPages: 1,
  };
  const isLoading = shouldLoad && dispatchesQuery.isFetching;
  const dateError = customDateError || (dispatchesQuery.error ? getErrorMessage(dispatchesQuery.error) : null);
  const setDateError = setCustomDateError;

  const handleRangeChange = (newRange: 'today' | '7d' | '30d' | 'custom') => {
    setDateRange(newRange);
    setPage(1);
  };

  const handleApplyCustomDate = () => {
    if (fromDate && toDate && fromDate > toDate) {
      setDateError('From Date cannot be after To Date');
      return;
    }
    setDateError(null);
    setPage(1);
    setAppliedCustomDates({ from: fromDate, to: toDate });
    // trigger re-query via appliedCustomDates
  };

  const handleClearCustomDate = () => {
    setFromDate('');
    setToDate('');
    setDateError(null);
    setAppliedCustomDates({ from: '', to: '' });
    setDateRange('7d');
    setPage(1);
  };

  const handlePageChange = (newPage: number) => {
    if (newPage < 1 || newPage > pagination.totalPages) return;
    setPage(newPage);
  };

  const reloadFirstPage = () => {
    setPage(1);
    void queryClient.invalidateQueries({ queryKey: ['dispatches'] });
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6 w-full overflow-x-hidden">
      {/* Top-Level Dispatch Workspace Tabs */}
      {!hideTabBar && (
        <div className="lg:hidden">
          <SegmentedTabs
            label="Dispatch views"
            value={activeTab}
            onValueChange={handleTabChange}
            tabs={[
              { value: 'new', label: 'New dispatch', id: 'tab-new-dispatch', panelId: 'panel-new-dispatch' },
              {
                value: 'recent',
                label: 'Recent dispatches',
                id: 'tab-recent-dispatches',
                panelId: 'panel-recent-dispatches',
                count: pagination.totalRecords > 0 ? pagination.totalRecords : undefined,
              },
            ]}
          />
        </div>
      )}

      {/* Tab Panels: New Dispatch Panel (state preserved when hidden) */}
      <div
        id="panel-new-dispatch"
        role="tabpanel"
        aria-labelledby="tab-new-dispatch"
        className={activeTab === 'new' ? 'block animate-panel-in' : 'hidden'}
      >
        <DynamicDispatchForm currentUser={currentUser} onSuccess={reloadFirstPage} />
      </div>

      {/* Tab Panels: Recent Dispatches Panel */}
      <div
        id="panel-recent-dispatches"
        role="tabpanel"
        aria-labelledby="tab-recent-dispatches"
        className={activeTab === 'recent' ? 'block animate-panel-in' : 'hidden'}
      >
        <div className="max-w-4xl mx-auto space-y-4">
          {/* Header & Date Controls */}
          <div className="bg-card border-border p-4 sm:p-5 rounded-xl border shadow-xs space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center space-x-2">
                <h2 className="text-base font-semibold text-foreground">Recent Dispatches</h2>
              </div>
              <span className="text-xs tabular-nums font-semibold text-slate-600 bg-muted px-2.5 py-1 rounded-lg border border-border-strong">
                {pagination.totalRecords} records
              </span>
            </div>

            {/* Quick Date Window Filter Buttons */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 p-1.5 rounded-xl bg-subtle border border-border text-xs font-semibold">
              <button
                type="button"
                onClick={() => handleRangeChange('today')}
                className={`h-9 rounded-lg text-xs font-semibold transition ${
                  dateRange === 'today'
                    ? 'bg-primary-hover text-white shadow-xs'
                    : 'text-slate-700 hover:bg-white/60'
                }`}
              >
                Today
              </button>
              <button
                type="button"
                onClick={() => handleRangeChange('7d')}
                className={`h-9 rounded-lg text-xs font-semibold transition ${
                  dateRange === '7d'
                    ? 'bg-primary-hover text-white shadow-xs'
                    : 'text-slate-700 hover:bg-white/60'
                }`}
              >
                Last 7 Days
              </button>
              <button
                type="button"
                onClick={() => handleRangeChange('30d')}
                className={`h-9 rounded-lg text-xs font-semibold transition ${
                  dateRange === '30d'
                    ? 'bg-primary-hover text-white shadow-xs'
                    : 'text-slate-700 hover:bg-white/60'
                }`}
              >
                Last 30 Days
              </button>
              <button
                type="button"
                onClick={() => handleRangeChange('custom')}
                className={`h-9 rounded-lg text-xs font-semibold transition ${
                  dateRange === 'custom'
                    ? 'bg-primary-hover text-white shadow-xs'
                    : 'text-slate-700 hover:bg-white/60'
                }`}
              >
                Custom
              </button>
            </div>

            {/* Custom Date Controls */}
            {dateRange === 'custom' && (
              <div className="pt-3 border-t border-slate-100 space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div className="space-y-1">
                    <label className="block text-xs font-semibold text-slate-600">From Date</label>
                    <input
                      type="date"
                      value={fromDate}
                      onChange={(e) => setFromDate(e.target.value)}
                      className="w-full h-11 px-3.5 rounded-xl border border-border-strong bg-white tabular-nums text-xs text-foreground focus:ring-2 focus:ring-primary-hover outline-hidden min-h-11"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="block text-xs font-semibold text-slate-600">To Date</label>
                    <input
                      type="date"
                      value={toDate}
                      onChange={(e) => setToDate(e.target.value)}
                      className="w-full h-11 px-3.5 rounded-xl border border-border-strong bg-white tabular-nums text-xs text-foreground focus:ring-2 focus:ring-primary-hover outline-hidden min-h-11"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-end space-x-2 pt-1">
                  <button
                    type="button"
                    onClick={handleClearCustomDate}
                    className="px-3.5 text-xs font-semibold text-slate-600 hover:text-slate-900 rounded-xl hover:bg-slate-100 transition min-h-11"
                  >
                    Clear
                  </button>
                  <button
                    type="button"
                    onClick={handleApplyCustomDate}
                    className="px-4 bg-primary-hover text-white font-semibold text-xs rounded-xl shadow-xs hover:bg-blue-800 transition min-h-11"
                  >
                    Apply Filter
                  </button>
                </div>
              </div>
            )}

            {dateError && (
              <p className="bg-card border-border text-xs font-semibold text-rose-700 p-3 rounded-xl border">
                {dateError}
              </p>
            )}
          </div>

          {/* Records List */}
          <div className="space-y-3 max-h-[580px] overflow-y-auto pr-1">
            {isLoading ? (
              <div className="bg-card border-border p-10 text-center border border-dashed rounded-xl text-sm text-muted-foreground">
                <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2 text-blue-700" />
                Loading dispatches…
              </div>
            ) : dbDispatches.length === 0 ? (
              <div className="bg-card border-border p-10 text-center border border-dashed rounded-xl text-sm text-muted-foreground">
                No dispatches found for this period.
              </div>
            ) : (
              dbDispatches.map((log) => (
                <div
                  key={`mpd-dispatch-${String(log.id)}`}
                  className="bg-card border-border p-4 sm:p-5 rounded-xl border text-foreground shadow-xs space-y-3 transition"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2.5">
                      <div className="p-2 rounded-xl bg-muted text-primary-hover">
                        <Truck className="w-4 h-4" />
                      </div>
                      <div>
                        <span className="font-semibold tabular-nums text-base tracking-tight text-foreground">
                          {log.vehicle_number}
                        </span>
                        <div className="flex items-center space-x-1.5 mt-0.5">
                          <span className="px-2 py-0.5 rounded-lg text-xs font-semibold bg-muted border border-border-strong tabular-nums">
                            {log.portion_count} Portion{log.portion_count > 1 ? 's' : ''}
                          </span>
                          {log.raw_milk_dispatch_note_number && (
                            <span className="px-2 py-0.5 rounded-lg text-xs font-semibold bg-blue-50 border border-blue-200 text-blue-800 tabular-nums">
                              Note: {log.raw_milk_dispatch_note_number}
                            </span>
                          )}
                          <span className="text-xs font-medium text-slate-600">
                            {log.zonal_contractor_name}
                          </span>
                        </div>
                      </div>
                    </div>

                    <span className="px-3 py-1 rounded-full text-xs font-semibold uppercase bg-emerald-100 text-emerald-800 border border-emerald-300 tabular-nums">
                      Dispatched
                    </span>
                  </div>

                  <div className="bg-card border-border grid grid-cols-2 gap-2 p-2.5 rounded-xl border text-xs tabular-nums font-semibold">
                    <div>
                      <span className="text-slate-500 font-sans block text-xs font-semibold">Vehicle Quantity</span>
                      <span className="text-slate-900 font-semibold text-sm">
                        {log.vehicle_dispatch_quantity_value != null && log.vehicle_dispatch_quantity_unit
                          ? `${Number(log.vehicle_dispatch_quantity_value).toLocaleString()} ${log.vehicle_dispatch_quantity_unit}`
                          : '—'}
                      </span>
                      {log.vehicle_dispatch_quantity_unit === 'KG' && log.vehicle_dispatch_gross_liters != null && (
                        <span className="text-xs text-blue-700 block tabular-nums font-semibold">
                          {Number(log.vehicle_dispatch_gross_liters).toLocaleString()} Gross L
                        </span>
                      )}
                      {log.vehicle_dispatch_at_13ts_liters != null && (
                        <span className="text-xs text-emerald-700 block tabular-nums font-semibold">
                          {Number(log.vehicle_dispatch_at_13ts_liters).toLocaleString()} L @13% TS
                        </span>
                      )}
                    </div>
                    <div>
                      <span className="text-slate-500 font-sans block text-xs font-semibold">Dispatch Date</span>
                      <span className="text-slate-900 font-semibold text-sm">
                        {log.dispatch_date || '—'}
                      </span>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Server-side Pagination Footer */}
          {pagination.totalRecords > 0 && (
            <div className="bg-card border-border p-3.5 rounded-xl border shadow-2xs flex flex-col sm:flex-row items-center justify-between gap-3 text-xs font-semibold">
              <span className="text-slate-600 font-sans text-xs">
                Showing {Math.min((pagination.page - 1) * pagination.pageSize + 1, pagination.totalRecords)}–{Math.min(pagination.page * pagination.pageSize, pagination.totalRecords)} of {pagination.totalRecords} dispatches
              </span>

              {pagination.totalPages > 1 && (
                <div className="flex items-center space-x-2">
                  <button
                    type="button"
                    disabled={page <= 1 || isLoading}
                    onClick={() => handlePageChange(page - 1)}
                    className="min-h-[44px] min-w-[44px] flex items-center justify-center space-x-1 px-3.5 py-2 rounded-xl bg-muted border border-border-strong text-foreground disabled:opacity-40 disabled:cursor-not-allowed hover:bg-accent transition focus:outline-hidden focus:ring-2 focus:ring-primary-hover"
                    aria-label="Previous page"
                  >
                    <ChevronLeft className="w-4 h-4" />
                    <span>Previous</span>
                  </button>

                  <span className="tabular-nums text-slate-700 px-2">
                    Page {pagination.page} of {pagination.totalPages}
                  </span>

                  <button
                    type="button"
                    disabled={page >= pagination.totalPages || isLoading}
                    onClick={() => handlePageChange(page + 1)}
                    className="min-h-[44px] min-w-[44px] flex items-center justify-center space-x-1 px-3.5 py-2 rounded-xl bg-muted border border-border-strong text-foreground disabled:opacity-40 disabled:cursor-not-allowed hover:bg-accent transition focus:outline-hidden focus:ring-2 focus:ring-primary-hover"
                    aria-label="Next page"
                  >
                    <span>Next</span>
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
