'use client';

import React, { useState, useEffect } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { fetchJson } from '@/lib/query/fetchJson';
import { User } from '@backend/core/types';
import type { RouteLedgerRow, HcSupplierLedgerRow, TankStorageRow } from './zmccReportTypes';
import { DataTable, type DataColumn } from '@/components/ui/data-table';
import { PageLoader } from '@/components/ui/spinner';
import { ErrorState } from '@/components/ui/empty-state';
import { Pagination, useListPageSize } from '@/components/ui/pagination';
import { getPakistanCalendarDate } from '@/backend/core/business-day';
import { getErrorMessage } from '@/lib/errors';
import {
  FileSpreadsheet,
  Calendar,
  Download,
  Search,
  Truck,
  Users,
  Building2,
  FlaskConical,
  Printer,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { toast } from '@/frontend/lib/appToast';
import { formatTime } from '@/lib/format';
import { formatLabel } from '@/lib/format';
import { formatLossGain, formatLossGainPercent, lossGainClass } from '@/lib/lossGain';

type ReportView = 'ROUTE_COLLECTIONS' | 'HC_SUPPLIERS' | 'TANK_STORAGE';

interface ZMCCComprehensiveReportsScreenProps {
  currentUser: User | null;
  targetZmccId?: string;
  initialView?: string | null;
}

const routeColumns: DataColumn<RouteLedgerRow>[] = [
  { key: 'journey', header: 'Journey #', label: 'Journey #', primary: true, cell: (row) => <span className="tabular-nums font-semibold text-primary">#{row.journeyNumber}</span> },
  { key: 'date', header: 'Date', label: 'Date', cell: (row) => <span className="tabular-nums text-secondary-foreground font-medium">{row.operationalDate}</span> },
  { key: 'route', header: 'Route', label: 'Route', cell: (row) => <span className="font-semibold text-foreground">{row.routeCode} · {row.routeName}</span> },
  { key: 'mot', header: 'Mobile Tester', label: 'Mobile Tester', cell: (row) => <span className="text-foreground">{row.motName}</span> },
  { key: 'vehicle', header: 'Vehicle', label: 'Vehicle', cell: (row) => <span className="tabular-nums font-semibold text-secondary-foreground">{row.vehicleNumber}</span> },
  { key: 'shops', header: 'Shops', label: 'Shops', cell: (row) => <span className="tabular-nums text-secondary-foreground">{row.visitedStops} / {row.plannedStops}</span> },
  { key: 'shopL', header: 'Shop Liters', label: 'Shop liters', cell: (row) => <span className="tabular-nums font-semibold text-foreground">{row.shopLitersCollected.toLocaleString()} L</span> },
  { key: 'arrival', header: 'ZMCC Arrival', label: 'ZMCC arrival', cell: (row) => <span className="tabular-nums font-semibold text-foreground">{row.zmccArrivalLiters != null ? `${row.zmccArrivalLiters.toLocaleString()} L` : '—'}</span> },
  { key: 'shop13', header: 'Shop @13% TS', label: 'Shop @13% TS', cell: (row) => <span className="tabular-nums text-secondary-foreground">{row.at13TsLiters.toLocaleString()} L</span> },
  {
    key: 'zmcc13',
    header: 'ZMCC @13% TS',
    label: 'ZMCC @13% TS',
    cell: (row) => <span className="tabular-nums text-secondary-foreground">{row.zmccArrivalAt13TsLiters !== null ? `${row.zmccArrivalAt13TsLiters.toLocaleString()} L` : '—'}</span>,
  },
  {
    key: 'loss13',
    header: 'Loss / Gain @13% TS',
    label: 'Loss / Gain @13% TS',
    cell: (row) => <span className={`tabular-nums font-semibold ${lossGainClass(row.routeDiffAt13TsLiters)}`}>{row.routeDiffAt13TsLiters !== null ? formatLossGain(row.routeDiffAt13TsLiters) : '—'}</span>,
  },
  { key: 'loss', header: 'Loss / Gain (L)', label: 'Loss / Gain (L)', cell: (row) => <span className={`tabular-nums font-semibold ${lossGainClass(row.routeDiffLiters)}`}>{row.routeDiffLiters != null ? formatLossGain(row.routeDiffLiters) : '—'}</span> },
  {
    key: 'lossPct',
    header: 'Loss / Gain %',
    label: 'Loss / Gain %',
    cell: (row) => (
      <span
        className={`tabular-nums px-2 py-0.5 rounded-md text-xs font-semibold ${
          row.routeDiffPct != null && row.routeDiffPct < -1.0 ? 'bg-rose-100 ' : ''
        }${lossGainClass(row.routeDiffPct)}`}
      >
        {row.routeDiffPct != null ? formatLossGainPercent(row.routeDiffPct) : '—'}
      </span>
    ),
  },
  { key: 'fat', header: 'Fat %', label: 'Fat %', cell: (row) => <span className="tabular-nums font-medium text-secondary-foreground">{row.avgFat != null ? `${row.avgFat}%` : '—'}</span> },
  { key: 'lr', header: 'LR', label: 'LR', cell: (row) => <span className="tabular-nums font-medium text-secondary-foreground">{row.avgLr ?? '—'}</span> },
  {
    key: 'status',
    header: 'Status',
    label: 'Status',
    align: 'right',
    cell: (row) => (
      <span
        className={`px-2 py-0.5 rounded-md text-xs font-semibold ${
          row.status === 'COMPLETED' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-blue-50 text-blue-700 border border-blue-200'
        }`}
      >
        {formatLabel(row.status)}
      </span>
    ),
  },
];

const hcColumns: DataColumn<HcSupplierLedgerRow>[] = [
  { key: 'token', header: 'Token #', label: 'Token #', primary: true, cell: (row) => <span className="tabular-nums font-semibold text-primary">{row.zmccToken}</span> },
  { key: 'arrival', header: 'Arrival Time', label: 'Arrival time', cell: (row) => <span className="tabular-nums text-secondary-foreground">{formatTime(row.arrivalTimestamp)}</span> },
  { key: 'code', header: 'Supplier Code', label: 'Supplier code', cell: (row) => <span className="tabular-nums font-semibold text-secondary-foreground">{row.supplierCode}</span> },
  { key: 'name', header: 'Supplier Name', label: 'Supplier name', cell: (row) => <span className="font-semibold text-foreground">{row.supplierName}</span> },
  { key: 'vehicle', header: 'Vehicle #', label: 'Vehicle #', cell: (row) => <span className="tabular-nums text-secondary-foreground">{row.vehicleNumber}</span> },
  { key: 'gross', header: 'Gross Liters', label: 'Gross liters', cell: (row) => <span className="tabular-nums font-semibold text-foreground">{row.grossLiters.toLocaleString()} L</span> },
  { key: 'ts13', header: '@13% TS', label: '@13% TS', cell: (row) => <span className="tabular-nums font-semibold text-foreground">{row.at13TsLiters !== null ? `${row.at13TsLiters.toLocaleString()} L` : '—'}</span> },
  { key: 'fat', header: 'Fat %', label: 'Fat %', cell: (row) => <span className="tabular-nums text-secondary-foreground font-medium">{row.fat !== null ? `${row.fat}%` : '—'}</span> },
  { key: 'snf', header: 'SNF %', label: 'SNF %', cell: (row) => <span className="tabular-nums text-secondary-foreground font-medium">{row.snf !== null ? `${row.snf}%` : '—'}</span> },
  { key: 'lr', header: 'LR', label: 'LR', cell: (row) => <span className="tabular-nums text-secondary-foreground font-medium">{row.lr ?? '—'}</span> },
  { key: 'temp', header: 'Temp °C', label: 'Temp °C', cell: (row) => <span className="tabular-nums text-secondary-foreground font-medium">{row.temperatureC !== null ? `${row.temperatureC} °C` : '—'}</span> },
  {
    key: 'decision',
    header: 'Decision',
    label: 'Decision',
    cell: (row) => (
      <span
        className={`px-2 py-0.5 rounded-md text-xs font-semibold ${
          row.decision === 'ACCEPTED' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-rose-50 text-rose-700 border border-rose-200'
        }`}
      >
        {row.decision}
      </span>
    ),
  },
  { key: 'rmr', header: 'RMR #', label: 'RMR #', align: 'right', cell: (row) => <span className="tabular-nums font-semibold text-primary">{row.rmrNumber || '—'}</span> },
];

const tankColumns: DataColumn<TankStorageRow>[] = [
  { key: 'code', header: 'Tank Code', label: 'Tank code', primary: true, cell: (tank) => <span className="tabular-nums font-semibold text-primary">{tank.tankCode}</span> },
  { key: 'name', header: 'Tank Name', label: 'Tank name', cell: (tank) => <span className="font-semibold text-foreground">{tank.name}</span> },
  { key: 'capacity', header: 'Capacity (L)', label: 'Capacity (L)', cell: (tank) => <span className="tabular-nums text-secondary-foreground">{tank.capacityLiters.toLocaleString()} L</span> },
  {
    key: 'stock13',
    header: 'Stock @13% TS (L)',
    label: 'Stock @13% TS (L)',
    cell: (tank) => <span className="tabular-nums font-semibold text-foreground">{tank.currentStockAt13Ts !== null ? `${tank.currentStockAt13Ts.toLocaleString()} L` : '—'}</span>,
  },
  {
    key: 'ts',
    header: 'Composite TS %',
    label: 'Composite TS %',
    cell: (tank) => <span className="tabular-nums font-semibold text-blue-800">{tank.compositeTsPercent !== null ? `${tank.compositeTsPercent}%` : '—'}</span>,
  },
  {
    key: 'fill',
    header: 'Fill %',
    label: 'Fill %',
    cell: (tank) => (
      <div className="flex items-center gap-2 tabular-nums">
        <span className="font-semibold text-foreground">{tank.fillPercentage}%</span>
        <div className="w-16 h-1.5 rounded-full bg-muted overflow-hidden">
          <div style={{ width: `${Math.min(100, tank.fillPercentage)}%` }} className="bg-primary h-full rounded-full" />
        </div>
      </div>
    ),
  },
  {
    key: 'temp',
    header: 'Temperature',
    label: 'Temperature',
    cell: (tank) => <span className="tabular-nums font-semibold text-blue-700">{tank.currentTempC !== null ? `${tank.currentTempC} °C` : '—'}</span>,
  },
  { key: 'receipts', header: 'Today Receipts', label: 'Today receipts', cell: (tank) => <span className="tabular-nums text-emerald-700 font-semibold">+{tank.todayReceiptsLiters.toLocaleString()} L</span> },
  { key: 'dispatched', header: 'Dispatched', label: 'Dispatched', cell: (tank) => <span className="tabular-nums text-secondary-foreground">-{tank.todayDispatchesLiters.toLocaleString()} L</span> },
  {
    key: 'status',
    header: 'Status',
    label: 'Status',
    align: 'right',
    cell: () => <span className="px-2 py-0.5 rounded-md text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">Active</span>,
  },
];

export function ZMCCComprehensiveReportsScreen({
  currentUser,
  targetZmccId,
  initialView,
}: ZMCCComprehensiveReportsScreenProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [activeView, setActiveView] = useState<ReportView>(
    initialView === 'HC_SUPPLIERS' || initialView === 'TANK_STORAGE' ? (initialView as ReportView) : 'ROUTE_COLLECTIONS'
  );

  useEffect(() => {
    if (initialView === 'HC_SUPPLIERS' || initialView === 'TANK_STORAGE' || initialView === 'ROUTE_COLLECTIONS') {
      setActiveView(initialView as ReportView);
    }
  }, [initialView]);

  const todayStr = getPakistanCalendarDate(new Date());
  const [fromDate, setFromDate] = useState<string>(todayStr);
  const [toDate, setToDate] = useState<string>(todayStr);
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [page, setPage] = useState<number>(1);
  const pageSize = useListPageSize(25);

  const isSystemScope =
    currentUser?.role === 'HEAD_OF_MPD' ||
    currentUser?.role === 'SUPER_ADMIN' ||
    currentUser?.role === 'DATA_EXECUTIVE' ||
    currentUser?.role === 'EXECUTIVE_MANAGEMENT';

  const facilityId = isSystemScope
    ? targetZmccId || ''
    : currentUser?.procurement_source_id
    ? String(currentUser.procurement_source_id)
    : '';

  // 1. Route Ledger Query
  const routeLedgerQuery = useQuery({
    queryKey: ['zmcc', 'reports', 'route-ledger', facilityId, fromDate, toDate, page, pageSize],
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({
        fromDate,
        toDate,
        page: String(page),
        pageSize: String(pageSize),
      });
      if (facilityId) params.append('zmccId', facilityId);
      return fetchJson<{ rows: RouteLedgerRow[]; totalRecords: number; totalPages: number }>(
        `/api/zmcc/reports/route-ledger?${params.toString()}`,
        { signal }
      );
    },
    enabled: activeView === 'ROUTE_COLLECTIONS',
  });

  // 2. HC Supplier Ledger Query
  const hcLedgerQuery = useQuery({
    queryKey: ['zmcc', 'reports', 'hc-ledger', facilityId, fromDate, toDate, page, pageSize],
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({
        fromDate,
        toDate,
        page: String(page),
        pageSize: String(pageSize),
      });
      if (facilityId) params.append('zmccId', facilityId);
      return fetchJson<{ rows: HcSupplierLedgerRow[]; totalRecords: number; totalPages: number }>(
        `/api/zmcc/reports/hc-ledger?${params.toString()}`,
        { signal }
      );
    },
    enabled: activeView === 'HC_SUPPLIERS',
  });

  // 3. Tank Storage Query
  const tankStorageQuery = useQuery({
    queryKey: ['zmcc', 'reports', 'tank-storage', facilityId],
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams();
      if (facilityId) params.append('zmccId', facilityId);
      return fetchJson<{ rows: TankStorageRow[] }>(
        `/api/zmcc/reports/tank-storage?${params.toString()}`,
        { signal }
      );
    },
    enabled: activeView === 'TANK_STORAGE',
  });

  const handleExportExcel = () => {
    let typeParam = 'ROUTE_LEDGER';
    if (activeView === 'HC_SUPPLIERS') typeParam = 'HC_LEDGER';
    else if (activeView === 'TANK_STORAGE') typeParam = 'TANK_STORAGE';

    const params = new URLSearchParams({
      reportType: typeParam,
      fromDate,
      toDate,
    });
    if (facilityId) params.append('zmccId', facilityId);
    window.open(`/api/zmcc/reports/export?${params.toString()}`, '_blank');
    toast.success('Downloading report (.xlsx)…');
  };

  const handlePrint = () => {
    window.print();
  };

  const totalPages =
    activeView === 'ROUTE_COLLECTIONS'
      ? routeLedgerQuery.data?.totalPages || 1
      : activeView === 'HC_SUPPLIERS'
      ? hcLedgerQuery.data?.totalPages || 1
      : 1;

  const totalRecords =
    activeView === 'ROUTE_COLLECTIONS'
      ? routeLedgerQuery.data?.totalRecords || 0
      : activeView === 'HC_SUPPLIERS'
      ? hcLedgerQuery.data?.totalRecords || 0
      : tankStorageQuery.data?.rows.length || 0;

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="bg-card p-5 rounded-2xl border border-border shadow-2xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5 text-muted-foreground" />
            <h1 className="text-lg font-semibold text-foreground">{activeView === 'HC_SUPPLIERS' ? 'HC supplier milk' : activeView === 'TANK_STORAGE' ? 'Tank storage' : 'Route collections'}</h1>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleExportExcel}
            className="min-h-11 flex items-center space-x-1.5 px-3 py-2 rounded-lg border border-action/30 bg-action-soft hover:bg-action-soft text-xs font-semibold text-action transition"
          >
            <Download className="w-4 h-4 text-secondary-foreground" />
            <span>Export to Excel (.xlsx)</span>
          </button>
          <button
            type="button"
            onClick={handlePrint}
            className="min-h-11 flex items-center space-x-1 px-3 py-2 rounded-lg border border-action/30 bg-action-soft hover:bg-action-soft text-xs font-semibold text-action"
          >
            <Printer className="w-4 h-4" />
            <span>Print</span>
          </button>
        </div>
      </div>

      {/* Date controls */}
      <div className="bg-card p-4 rounded-2xl border border-border shadow-2xs flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">

        {/* Filters */}
        {activeView !== 'TANK_STORAGE' && (
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 bg-subtle px-3 py-2 rounded-lg border border-border text-xs">
              <Calendar className="w-3.5 h-3.5 text-muted-foreground" />
              <input
                type="date"
                value={fromDate}
                onChange={(e) => {
                  setFromDate(e.target.value);
                  setPage(1);
                }}
                className="bg-transparent text-secondary-foreground font-medium focus:outline-hidden"
              />
              <span className="text-muted-foreground">to</span>
              <input
                type="date"
                value={toDate}
                onChange={(e) => {
                  setToDate(e.target.value);
                  setPage(1);
                }}
                className="bg-transparent text-secondary-foreground font-medium focus:outline-hidden"
              />
            </div>

            <button
              type="button"
              onClick={() => {
                routeLedgerQuery.refetch();
                hcLedgerQuery.refetch();
              }}
              className="min-h-11 inline-flex items-center justify-center px-3 py-2 text-xs font-semibold rounded-lg border border-border bg-subtle hover:bg-muted text-secondary-foreground cursor-pointer"
              title="Apply & Refresh"
            >
              Apply
            </button>
          </div>
        )}
      </div>

      {/* 1. ROUTE COLLECTIONS LEDGER */}
      {activeView === 'ROUTE_COLLECTIONS' && (
        <div className="bg-card rounded-xl border border-border overflow-hidden shadow-2xs space-y-3">
          {routeLedgerQuery.isPending ? (
            <PageLoader label="Loading route collection ledger…" className="py-16" />
          ) : routeLedgerQuery.isError ? (
            <ErrorState description={getErrorMessage(routeLedgerQuery.error)} onRetry={() => void routeLedgerQuery.refetch()} className="m-4" />
          ) : (routeLedgerQuery.data?.rows.length || 0) === 0 ? (
            <div className="p-12 text-center text-xs font-semibold text-muted-foreground">
              No route collections found for the selected date range.
            </div>
          ) : (
            <DataTable paginate={false}
              columns={routeColumns}
              rows={routeLedgerQuery.data?.rows ?? []}
              getRowId={(r) => r.id}
              tableFrom="lg"
            />
          )}
        </div>
      )}

      {/* 2. HC LOCAL SUPPLIER LEDGER */}
      {activeView === 'HC_SUPPLIERS' && (
        <div className="bg-card rounded-xl border border-border overflow-hidden shadow-2xs space-y-3">
          {hcLedgerQuery.isPending ? (
            <PageLoader label="Loading HC supplier ledger…" className="py-16" />
          ) : hcLedgerQuery.isError ? (
            <ErrorState description={getErrorMessage(hcLedgerQuery.error)} onRetry={() => void hcLedgerQuery.refetch()} className="m-4" />
          ) : (hcLedgerQuery.data?.rows.length || 0) === 0 ? (
            <div className="p-12 text-center text-xs font-semibold text-muted-foreground">
              No supplier arrival records found for the selected date range.
            </div>
          ) : (
            <DataTable paginate={false}
              columns={hcColumns}
              rows={hcLedgerQuery.data?.rows ?? []}
              getRowId={(r) => r.id}
              tableFrom="lg"
            />
          )}
        </div>
      )}

      {/* 3. TANK STORAGE & CHILLING LOG */}
      {activeView === 'TANK_STORAGE' && (
        <div className="bg-card rounded-xl border border-border overflow-hidden shadow-2xs space-y-3">
          {tankStorageQuery.isPending ? (
            <PageLoader label="Loading tank storage and chilling summary…" className="py-16" />
          ) : tankStorageQuery.isError ? (
            <ErrorState description={getErrorMessage(tankStorageQuery.error)} onRetry={() => void tankStorageQuery.refetch()} className="m-4" />
          ) : (tankStorageQuery.data?.rows.length || 0) === 0 ? (
            <div className="p-12 text-center text-xs font-semibold text-muted-foreground">
              No tanks registered at this facility.
            </div>
          ) : (
            <DataTable paginate={false}
              columns={tankColumns}
              rows={tankStorageQuery.data?.rows ?? []}
              getRowId={(r) => r.id}
              tableFrom="lg"
            />
          )}
        </div>
      )}

      {/* Pagination Bar */}
      <Pagination
        page={page}
        totalPages={totalPages}
        totalRecords={totalRecords}
        pageSize={pageSize}
        noun="records"
        onPageChange={setPage}
        className="bg-card rounded-xl border border-border p-3 text-xs"
      />
    </div>
  );
}
