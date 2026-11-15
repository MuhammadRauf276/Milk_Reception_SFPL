'use client';

import { Button } from '@/components/ui/button';
import { DataTable, type DataColumn } from '@/components/ui/data-table';
import { ZmccDrawer } from '@/frontend/modules/zmcc/shared/ZmccDrawer';
import React, { useState, useMemo, useEffect } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { User } from '@core/types';
import { Eye, Truck } from 'lucide-react';
import { DynamicDispatchForm } from '@modules/forms/DynamicDispatchForm';
import { SegmentedTabs } from '@/components/ui/segmented-tabs';
import { Pagination, useListPageSize } from '@/components/ui/pagination';
import { getErrorMessage } from '@/lib/errors';
import { fetchJson } from '@/lib/fetch-json';
import { useUrlSearchParam } from '@/frontend/hooks/useUrlSearchParam';
import { ErrorPopup } from '@/components/ui/error-popup';

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

function quantityOf(log: DispatchRecord): string {
  return log.vehicle_dispatch_quantity_value != null && log.vehicle_dispatch_quantity_unit
    ? `${Number(log.vehicle_dispatch_quantity_value).toLocaleString()} ${log.vehicle_dispatch_quantity_unit}`
    : '—';
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
  const [openLog, setOpenLog] = useState<DispatchRecord | null>(null);
  const pageSize = useListPageSize(25);

  let queryUrl = `/api/dispatches?range=${dateRange}&page=${page}&pageSize=${pageSize}`;
  if (dateRange === 'custom') {
    if (appliedCustomDates.from) queryUrl += `&fromDate=${appliedCustomDates.from}`;
    if (appliedCustomDates.to) queryUrl += `&toDate=${appliedCustomDates.to}`;
  }
  const shouldLoad = activeTab === 'recent' && Boolean(currentUser);

  const queryClient = useQueryClient();
  const dispatchesQuery = useQuery({
    queryKey: ['dispatches', dateRange, page, pageSize, appliedCustomDates],
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
    pageSize,
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

  const columns = useMemo<DataColumn<DispatchRecord>[]>(
    () => [
      { key: 'vehicle', header: 'Vehicle', label: 'Vehicle', primary: true, cell: (l) => <span className="font-semibold tabular-nums">{l.vehicle_number}</span> },
      { key: 'date', header: 'Date', label: 'Date', cardAlways: true, cell: (l) => <span className="tabular-nums whitespace-nowrap">{l.dispatch_date || '—'}</span> },
      { key: 'qty', header: 'Quantity', label: 'Quantity', align: 'right', cell: (l) => <span className="tabular-nums whitespace-nowrap">{quantityOf(l)}</span> },
      { key: 'note', header: 'Note', label: 'Note', cell: (l) => l.raw_milk_dispatch_note_number || '—' },
      { key: 'contractor', header: 'Contractor', label: 'Contractor', cell: (l) => l.zonal_contractor_name },
      {
        key: 'actions',
        header: '',
        label: 'Inspect',
        actions: true,
        align: 'right',
        cell: (l) => (
          <Button type="button" variant="outline" size="sm" className="min-h-11 gap-1.5 text-xs font-semibold" onClick={() => setOpenLog(l)}>
            <Eye aria-hidden />
            Inspect
          </Button>
        ),
      },
    ],
    []
  );

  return (
    <div className="max-w-7xl mx-auto space-y-6 w-full overflow-x-clip">
      
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
          <div className="bg-card border-border p-4 sm:p-5 rounded-2xl border shadow-xs space-y-4">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div className="flex items-center space-x-2">
                <h2 className="text-base font-semibold text-foreground">Recent Dispatches</h2>
              </div>
              <span className="text-xs tabular-nums font-semibold text-secondary-foreground bg-muted px-3 py-1 rounded-lg border border-border-strong">
                {pagination.totalRecords} records
              </span>
            </div>

            {/* Quick Date Window Filter Buttons */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 p-2 rounded-xl bg-subtle border border-border text-xs font-semibold">
              <button
                type="button"
                onClick={() => handleRangeChange('today')}
                className={`h-9 rounded-lg text-xs font-semibold transition ${
                  dateRange === 'today'
                    ? 'bg-primary-hover text-white shadow-xs'
                    : 'text-secondary-foreground hover:bg-white/60'
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
                    : 'text-secondary-foreground hover:bg-white/60'
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
                    : 'text-secondary-foreground hover:bg-white/60'
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
                    : 'text-secondary-foreground hover:bg-white/60'
                }`}
              >
                Custom
              </button>
            </div>

            {/* Custom Date Controls */}
            {dateRange === 'custom' && (
              <div className="pt-3 border-t border-border space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div className="space-y-1">
                    <label className="block text-xs font-semibold text-secondary-foreground">From Date</label>
                    <input
                      type="date"
                      value={fromDate}
                      onChange={(e) => setFromDate(e.target.value)}
                      className="w-full h-11 px-4 rounded-lg border border-border-strong bg-card tabular-nums text-xs text-foreground focus:ring-2 focus:ring-primary-hover outline-hidden min-h-11"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="block text-xs font-semibold text-secondary-foreground">To Date</label>
                    <input
                      type="date"
                      value={toDate}
                      onChange={(e) => setToDate(e.target.value)}
                      className="w-full h-11 px-4 rounded-lg border border-border-strong bg-card tabular-nums text-xs text-foreground focus:ring-2 focus:ring-primary-hover outline-hidden min-h-11"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-end space-x-2 pt-1">
                  <button
                    type="button"
                    onClick={handleClearCustomDate}
                    className="px-4 text-xs font-semibold text-secondary-foreground hover:text-foreground rounded-lg hover:bg-muted transition min-h-11"
                  >
                    Clear
                  </button>
                  <button
                    type="button"
                    onClick={handleApplyCustomDate}
                    className="px-4 bg-primary-hover text-white font-semibold text-xs rounded-lg shadow-xs hover:bg-blue-800 transition min-h-11"
                  >
                    Apply Filter
                  </button>
                </div>
              </div>
            )}

            <ErrorPopup message={dateError} />
          </div>

          {/* Records List */}
          <DataTable
            columns={columns}
            rows={dbDispatches}
            getRowId={(log) => String(log.id)}
            loading={isLoading}
            paginate={false}
            noun="dispatches"
            emptyTitle="No dispatches"
            emptyDescription="Nothing dispatched in this period."
            footer={
              pagination.totalRecords > 0 ? (
                <div className="bg-card border-border rounded-2xl border shadow-2xs overflow-hidden">
                  <Pagination
                    page={pagination.page}
                    totalPages={pagination.totalPages}
                    totalRecords={pagination.totalRecords}
                    pageSize={pagination.pageSize}
                    noun="dispatches"
                    disabled={isLoading}
                    onPageChange={handlePageChange}
                  />
                </div>
              ) : undefined
            }
          />

          <ZmccDrawer
            open={!!openLog}
            onClose={() => setOpenLog(null)}
            title={openLog?.vehicle_number ?? 'Dispatch'}
            subtitle={openLog ? openLog.zonal_contractor_name : undefined}
            icon={<Truck className="mt-0.5 h-5 w-5 shrink-0 text-secondary-foreground" />}
          >
            {openLog && (
              <div className="space-y-3 text-sm">
                <span className="inline-flex rounded-md border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-900">Dispatched</span>
                <dl className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-x-4 gap-y-2">
                  <div>
                    <dt className="text-xs text-muted-foreground">Dispatch date</dt>
                    <dd className="font-medium tabular-nums">{openLog.dispatch_date || '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Quantity</dt>
                    <dd className="font-medium tabular-nums">{quantityOf(openLog)}</dd>
                  </div>
                  {openLog.vehicle_dispatch_quantity_unit === 'KG' && openLog.vehicle_dispatch_gross_liters != null && (
                    <div>
                      <dt className="text-xs text-muted-foreground">Gross litres</dt>
                      <dd className="font-medium tabular-nums">{Number(openLog.vehicle_dispatch_gross_liters).toLocaleString()} L</dd>
                    </div>
                  )}
                  {openLog.vehicle_dispatch_at_13ts_liters != null && (
                    <div>
                      <dt className="text-xs text-muted-foreground">Litres at 13% TS</dt>
                      <dd className="font-medium tabular-nums">{Number(openLog.vehicle_dispatch_at_13ts_liters).toLocaleString()} L</dd>
                    </div>
                  )}
                  {openLog.raw_milk_dispatch_note_number && (
                    <div>
                      <dt className="text-xs text-muted-foreground">Note</dt>
                      <dd className="font-medium tabular-nums">{openLog.raw_milk_dispatch_note_number}</dd>
                    </div>
                  )}
                  <div>
                    <dt className="text-xs text-muted-foreground">Portions</dt>
                    <dd className="font-medium tabular-nums">{openLog.portion_count}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Contractor</dt>
                    <dd className="font-medium break-words">{openLog.zonal_contractor_name}</dd>
                  </div>
                </dl>
              </div>
            )}
          </ZmccDrawer>
        </div>
      </div>
    </div>
  );
};
