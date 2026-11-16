'use client';

import React, { useDeferredValue, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { AnimatePresence } from 'framer-motion';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { LayoutGrid, Table2, Truck } from 'lucide-react';
import type { MilkProcessLog } from '@backend/core/types';
import { fetchJson } from '@/lib/query/fetchJson';
import { formatOperationalDate } from '@/lib/datetime-utils';
import { ZMCCManagerLiveDispatches } from '@/frontend/modules/dashboard/zmcc/ZMCCManagerLiveDispatches';
import { ZMCCManagerVisitDetailModal } from '@/frontend/modules/dashboard/zmcc/ZMCCManagerVisitDetailModal';
import { getPakistanCalendarDate } from '@backend/core/business-day';
import { VehicleReportTable } from './VehicleReportTable';
import { VehicleExcelButton } from './VehicleExcelButton';
import { VisitPhotosSection } from './VisitPhotosSection';

const NO_LOGS: MilkProcessLog[] = [];

interface VehiclesResponse {
  items?: MilkProcessLog[];
  pagination?: { page: number; pageSize: number; totalPages: number; totalRecords: number };
  fromDate?: string;
  toDate?: string;
}

/** All sources: cards of the last 7 days, or a report table for a chosen date range. Test photos are optional. */
export function ExecutiveLiveVehicles({ showPhotos }: { showPhotos: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isReport = searchParams?.get('view')?.toUpperCase() === 'REPORT';

  const [selectedLog, setSelectedLog] = useState<MilkProcessLog | null>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search.trim());

  const vehiclesQuery = useQuery({
    queryKey: ['executive', 'vehicles-7d', page, deferredSearch],
    queryFn: ({ signal }) => {
      const params = new URLSearchParams({ page: String(page) });
      if (deferredSearch) params.set('search', deferredSearch);
      return fetchJson<VehiclesResponse>(`/api/executive/vehicles?${params.toString()}`, { signal });
    },
    enabled: !isReport,
    placeholderData: keepPreviousData,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });
  const logs = vehiclesQuery.data?.items ?? NO_LOGS;
  const pagination = vehiclesQuery.data?.pagination;
  const totalPages = pagination?.totalPages ?? 1;
  const totalVehicles = pagination?.totalRecords ?? 0;
  const pageSize = pagination?.pageSize ?? 12;
  const errorMessage = vehiclesQuery.isError ? vehiclesQuery.error.message || 'Failed to load vehicles' : null;
  const { fromDate, toDate } = vehiclesQuery.data ?? {};

  // A page can run out when vehicles age past the 7 days between refreshes.
  const currentPage = Math.min(page, totalPages);
  if (currentPage !== page) setPage(currentPage);

  const selectedPortions = useMemo(
    () => (selectedLog ? logs.filter((l) => l.id === selectedLog.id) : []),
    [logs, selectedLog]
  );

  const onSearchChange = (value: string) => {
    setSearch(value);
    setPage(1);
  };

  const openTab = (report: boolean) => {
    const params = new URLSearchParams(searchParams?.toString() || '');
    if (report) params.set('view', 'REPORT');
    else params.delete('view');
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : (pathname ?? ''));
  };

  // The Excel file of the cards view: the same last 7 days, with the vehicle search when one is typed.
  const lastSevenDaysParams = () => {
    const to = getPakistanCalendarDate(new Date());
    const from = new Date(Date.parse(`${to}T00:00:00Z`) - 6 * 86_400_000).toISOString().slice(0, 10);
    const p = new URLSearchParams({ from, to });
    if (deferredSearch) p.set('f_vehicle', deferredSearch);
    return p;
  };

  const tabClass = (active: boolean) =>
    `min-h-9 px-4 py-2 text-xs font-semibold rounded-md transition flex items-center justify-center gap-2 flex-1 sm:flex-initial ${
      active ? 'bg-primary text-white shadow-2xs' : 'text-secondary-foreground hover:text-foreground'
    }`;

  return (
    <div className="space-y-6">
      <div className="bg-card p-5 rounded-2xl border border-border shadow-2xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Truck className="w-5 h-5 text-muted-foreground" />
            <h1 className="text-lg font-semibold text-foreground">{isReport ? 'Vehicle Report' : 'Vehicles, Last 7 Days'}</h1>
          </div>
          <p className="text-xs text-muted-foreground mt-1 tabular-nums">
            {isReport
              ? 'Choose your own dates. All sources.'
              : fromDate && toDate
              ? `Dispatched ${formatOperationalDate(fromDate)} to ${formatOperationalDate(toDate)}, plus any still in the plant, all sources`
              : 'All sources'}
          </p>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        {!isReport && <VehicleExcelButton chooseSourceType getParams={lastSevenDaysParams} />}
        <div className="flex items-center gap-1 bg-muted/60 p-1 rounded-lg border border-border w-full sm:w-fit" role="tablist" aria-label="Vehicle view">
          <button type="button" role="tab" aria-selected={!isReport} onClick={() => openTab(false)} className={tabClass(!isReport)}>
            <LayoutGrid className="w-3.5 h-3.5" />
            <span>Vehicle Cards</span>
          </button>
          <button type="button" role="tab" aria-selected={isReport} onClick={() => openTab(true)} className={tabClass(isReport)}>
            <Table2 className="w-3.5 h-3.5" />
            <span>Report Table</span>
          </button>
        </div>
        </div>
      </div>

      {isReport ? (
        <VehicleReportTable showPhotos={showPhotos} />
      ) : (
        <ZMCCManagerLiveDispatches
          logs={logs}
          assignedSourceName="All sources"
          onInspectDetails={setSelectedLog}
          isLoading={vehiclesQuery.isPending}
          error={errorMessage}
          onRetry={() => void vehiclesQuery.refetch()}
          serverPaging={{
            title: 'Vehicles, last 7 days',
            page: currentPage,
            pageSize,
            totalPages,
            totalVehicles,
            search,
            onSearchChange,
            onPageChange: setPage,
          }}
        />
      )}

      <AnimatePresence>
        {selectedLog && (
          <ZMCCManagerVisitDetailModal
            key="executive-visit-detail"
            isOpen
            log={selectedLog}
            portions={selectedPortions}
            onClose={() => setSelectedLog(null)}
            extraSection={showPhotos ? <VisitPhotosSection visitId={selectedLog.id} /> : undefined}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
