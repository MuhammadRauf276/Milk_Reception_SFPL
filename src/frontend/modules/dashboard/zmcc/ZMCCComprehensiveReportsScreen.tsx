'use client';

import React, { useState, useEffect } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { fetchJson } from '@/lib/query/fetchJson';
import { User } from '@backend/core/types';
import type { RouteLedgerRow, HcSupplierLedgerRow, TankStorageRow } from './zmccReportTypes';
import { PageLoader } from '@/components/ui/spinner';
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

type ReportView = 'ROUTE_COLLECTIONS' | 'HC_SUPPLIERS' | 'TANK_STORAGE';

interface ZMCCComprehensiveReportsScreenProps {
  currentUser: User | null;
  targetZmccId?: string;
  initialView?: string | null;
}

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

  const handleViewChange = (view: ReportView) => {
    setActiveView(view);
    setPage(1);
    const params = new URLSearchParams(searchParams?.toString() || '');
    params.set('tab', 'REPORTS');
    params.set('view', view);
    params.delete('mode');
    router.replace(`${pathname}?${params.toString()}`);
  };

  const todayStr = getPakistanCalendarDate(new Date());
  const [fromDate, setFromDate] = useState<string>(todayStr);
  const [toDate, setToDate] = useState<string>(todayStr);
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [page, setPage] = useState<number>(1);

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
    queryKey: ['zmcc', 'reports', 'route-ledger', facilityId, fromDate, toDate, page],
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({
        fromDate,
        toDate,
        page: String(page),
        pageSize: '20',
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
    queryKey: ['zmcc', 'reports', 'hc-ledger', facilityId, fromDate, toDate, page],
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({
        fromDate,
        toDate,
        page: String(page),
        pageSize: '20',
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
      <div className="bg-card p-5 rounded-xl border border-border shadow-2xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5 text-primary" />
            <h1 className="text-lg font-semibold text-foreground">Operational Ledgers & Reports</h1>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Detailed shift-level ledgers for Route collections, HC direct suppliers, and Silo/Tank inventory
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleExportExcel}
            className="min-h-11 flex items-center space-x-1.5 px-3 py-1.5 rounded-lg border border-border bg-subtle hover:bg-muted text-xs font-semibold text-foreground transition"
          >
            <Download className="w-4 h-4 text-slate-600" />
            <span>Export to Excel (.xlsx)</span>
          </button>
          <button
            type="button"
            onClick={handlePrint}
            className="min-h-11 flex items-center space-x-1 px-3 py-1.5 rounded-lg border border-border bg-subtle hover:bg-muted text-xs font-semibold text-slate-700"
          >
            <Printer className="w-4 h-4" />
            <span>Print</span>
          </button>
        </div>
      </div>

      {/* Subtabs & Date Controls */}
      <div className="bg-card p-4 rounded-xl border border-border shadow-2xs flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
        {/* Subtabs */}
        <div className="flex items-center gap-1 bg-muted/60 p-1 rounded-lg border border-border overflow-x-auto">
          <button
            type="button"
            onClick={() => handleViewChange('ROUTE_COLLECTIONS')}
            className={`min-h-8 px-3 text-xs font-semibold rounded-md transition whitespace-nowrap flex items-center gap-1.5 ${
              activeView === 'ROUTE_COLLECTIONS'
                ? 'bg-primary text-white shadow-2xs'
                : 'text-slate-600 hover:text-foreground'
            }`}
          >
            <Truck className="w-3.5 h-3.5" />
            <span>Route & MOT Collections</span>
          </button>
          <button
            type="button"
            onClick={() => handleViewChange('HC_SUPPLIERS')}
            className={`min-h-8 px-3 text-xs font-semibold rounded-md transition whitespace-nowrap flex items-center gap-1.5 ${
              activeView === 'HC_SUPPLIERS'
                ? 'bg-primary text-white shadow-2xs'
                : 'text-slate-600 hover:text-foreground'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            <span>HC Supplier Milk</span>
          </button>
          <button
            type="button"
            onClick={() => handleViewChange('TANK_STORAGE')}
            className={`min-h-8 px-3 text-xs font-semibold rounded-md transition whitespace-nowrap flex items-center gap-1.5 ${
              activeView === 'TANK_STORAGE'
                ? 'bg-primary text-white shadow-2xs'
                : 'text-slate-600 hover:text-foreground'
            }`}
          >
            <Building2 className="w-3.5 h-3.5" />
            <span>Tank Storage & Chilling</span>
          </button>
        </div>

        {/* Filters */}
        {activeView !== 'TANK_STORAGE' && (
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 bg-subtle px-2.5 py-1.5 rounded-lg border border-border text-xs">
              <Calendar className="w-3.5 h-3.5 text-slate-500" />
              <input
                type="date"
                value={fromDate}
                onChange={(e) => {
                  setFromDate(e.target.value);
                  setPage(1);
                }}
                className="bg-transparent text-slate-700 font-medium focus:outline-hidden"
              />
              <span className="text-slate-400">to</span>
              <input
                type="date"
                value={toDate}
                onChange={(e) => {
                  setToDate(e.target.value);
                  setPage(1);
                }}
                className="bg-transparent text-slate-700 font-medium focus:outline-hidden"
              />
            </div>

            <button
              type="button"
              onClick={() => {
                routeLedgerQuery.refetch();
                hcLedgerQuery.refetch();
              }}
              className="p-2 rounded-lg border border-border bg-subtle hover:bg-muted text-slate-700"
              title="Apply & Refresh"
            >
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
            <div className="p-8 text-center text-xs text-rose-600">
              {getErrorMessage(routeLedgerQuery.error)}
            </div>
          ) : (routeLedgerQuery.data?.rows.length || 0) === 0 ? (
            <div className="p-12 text-center text-xs font-semibold text-slate-500">
              No route collections found for the selected date range.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-muted/50 text-slate-700 uppercase font-semibold text-[10px] border-b border-border">
                  <tr>
                    <th className="p-3">Journey #</th>
                    <th className="p-3">Date</th>
                    <th className="p-3">Route</th>
                    <th className="p-3">Mobile Tester</th>
                    <th className="p-3">Vehicle</th>
                    <th className="p-3">Shops</th>
                    <th className="p-3">Shop Liters</th>
                    <th className="p-3">ZMCC Arrival</th>
                    <th className="p-3">Route Loss</th>
                    <th className="p-3">Loss %</th>
                    <th className="p-3">Shop @13% TS</th>
                    <th className="p-3">ZMCC @13% TS</th>
                    <th className="p-3">Loss @13% TS</th>
                    <th className="p-3">Fat %</th>
                    <th className="p-3">LR</th>
                    <th className="p-3 text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {routeLedgerQuery.data?.rows.map((row) => (
                    <tr key={row.id} className="hover:bg-subtle transition">
                      <td className="p-3 tabular-nums font-semibold text-primary">#{row.journeyNumber}</td>
                      <td className="p-3 tabular-nums text-slate-600 font-medium">{row.operationalDate}</td>
                      <td className="p-3 font-semibold text-foreground">
                        {row.routeCode} · {row.routeName}
                      </td>
                      <td className="p-3 text-foreground">{row.motName}</td>
                      <td className="p-3 tabular-nums font-semibold text-slate-700">{row.vehicleNumber}</td>
                      <td className="p-3 tabular-nums text-slate-700">
                        {row.visitedStops} / {row.plannedStops}
                      </td>
                      <td className="p-3 tabular-nums font-semibold text-foreground">
                        {row.shopLitersCollected.toLocaleString()} L
                      </td>
                      <td className="p-3 tabular-nums font-semibold text-slate-800">
                        {row.zmccArrivalLiters.toLocaleString()} L
                      </td>
                      <td className="p-3 tabular-nums font-semibold text-amber-700">
                        {row.routeLossLiters.toLocaleString()} L
                      </td>
                      <td className="p-3 tabular-nums">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                            row.routeLossPct > 1.0
                              ? 'bg-rose-100 text-rose-800'
                              : 'bg-emerald-100 text-emerald-800'
                          }`}
                        >
                          {row.routeLossPct}%
                        </span>
                      </td>
                      <td className="p-3 tabular-nums text-slate-700">{row.at13TsLiters.toLocaleString()} L</td>
                      <td className="p-3 tabular-nums text-slate-700">
                        {row.zmccArrivalAt13TsLiters !== null ? `${row.zmccArrivalAt13TsLiters.toLocaleString()} L` : '—'}
                      </td>
                      <td className="p-3 tabular-nums font-semibold text-amber-700">
                        {row.routeLossAt13TsLiters !== null ? `${row.routeLossAt13TsLiters.toLocaleString()} L` : '—'}
                      </td>
                      <td className="p-3 tabular-nums font-medium text-slate-700">{row.avgFat}%</td>
                      <td className="p-3 tabular-nums font-medium text-slate-700">{row.avgLr}</td>
                      <td className="p-3 text-right">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase ${
                            row.status === 'COMPLETED'
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                              : 'bg-blue-50 text-blue-700 border border-blue-200'
                          }`}
                        >
                          {row.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* 2. HC LOCAL SUPPLIER LEDGER */}
      {activeView === 'HC_SUPPLIERS' && (
        <div className="bg-card rounded-xl border border-border overflow-hidden shadow-2xs space-y-3">
          {hcLedgerQuery.isPending ? (
            <PageLoader label="Loading HC supplier ledger…" className="py-16" />
          ) : hcLedgerQuery.isError ? (
            <div className="p-8 text-center text-xs text-rose-600">
              {getErrorMessage(hcLedgerQuery.error)}
            </div>
          ) : (hcLedgerQuery.data?.rows.length || 0) === 0 ? (
            <div className="p-12 text-center text-xs font-semibold text-slate-500">
              No supplier arrival records found for the selected date range.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-muted/50 text-slate-700 uppercase font-semibold text-[10px] border-b border-border">
                  <tr>
                    <th className="p-3">Token #</th>
                    <th className="p-3">Arrival Time</th>
                    <th className="p-3">Supplier Code</th>
                    <th className="p-3">Supplier Name</th>
                    <th className="p-3">Vehicle #</th>
                    <th className="p-3">Gross Liters</th>
                    <th className="p-3">@13% TS</th>
                    <th className="p-3">Fat %</th>
                    <th className="p-3">SNF %</th>
                    <th className="p-3">LR</th>
                    <th className="p-3">Temp °C</th>
                    <th className="p-3">Decision</th>
                    <th className="p-3 text-right">RMR #</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {hcLedgerQuery.data?.rows.map((row) => (
                    <tr key={row.id} className="hover:bg-subtle transition">
                      <td className="p-3 tabular-nums font-semibold text-primary">{row.zmccToken}</td>
                      <td className="p-3 tabular-nums text-slate-600">
                        {new Date(row.arrivalTimestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td className="p-3 tabular-nums font-semibold text-slate-700">{row.supplierCode}</td>
                      <td className="p-3 font-semibold text-foreground">{row.supplierName}</td>
                      <td className="p-3 tabular-nums text-slate-700">{row.vehicleNumber}</td>
                      <td className="p-3 tabular-nums font-semibold text-foreground">
                        {row.grossLiters.toLocaleString()} L
                      </td>
                      <td className="p-3 tabular-nums font-semibold text-foreground">
                        {row.at13TsLiters !== null ? `${row.at13TsLiters.toLocaleString()} L` : '—'}
                      </td>
                      <td className="p-3 tabular-nums text-slate-700 font-medium">
                        {row.fat !== null ? `${row.fat}%` : '—'}
                      </td>
                      <td className="p-3 tabular-nums text-slate-700 font-medium">
                        {row.snf !== null ? `${row.snf}%` : '—'}
                      </td>
                      <td className="p-3 tabular-nums text-slate-700 font-medium">{row.lr ?? '—'}</td>
                      <td className="p-3 tabular-nums text-slate-700 font-medium">
                        {row.temperatureC !== null ? `${row.temperatureC} °C` : '—'}
                      </td>
                      <td className="p-3">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase ${
                            row.decision === 'ACCEPTED'
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                              : 'bg-rose-50 text-rose-700 border border-rose-200'
                          }`}
                        >
                          {row.decision}
                        </span>
                      </td>
                      <td className="p-3 text-right tabular-nums font-semibold text-primary">
                        {row.rmrNumber || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* 3. TANK STORAGE & CHILLING LOG */}
      {activeView === 'TANK_STORAGE' && (
        <div className="bg-card rounded-xl border border-border overflow-hidden shadow-2xs space-y-3">
          {tankStorageQuery.isPending ? (
            <PageLoader label="Loading tank storage and chilling summary…" className="py-16" />
          ) : tankStorageQuery.isError ? (
            <div className="p-8 text-center text-xs text-rose-600">
              {getErrorMessage(tankStorageQuery.error)}
            </div>
          ) : (tankStorageQuery.data?.rows.length || 0) === 0 ? (
            <div className="p-12 text-center text-xs font-semibold text-slate-500">
              No tanks registered at this facility.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-muted/50 text-slate-700 uppercase font-semibold text-[10px] border-b border-border">
                  <tr>
                    <th className="p-3">Tank Code</th>
                    <th className="p-3">Tank Name</th>
                    <th className="p-3">Capacity (L)</th>
                    <th className="p-3">Stock @13% TS (L)</th>
                    <th className="p-3">Composite TS %</th>
                    <th className="p-3">Fill %</th>
                    <th className="p-3">Temperature</th>
                    <th className="p-3">Today Receipts</th>
                    <th className="p-3">Dispatched</th>
                    <th className="p-3 text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {tankStorageQuery.data?.rows.map((tank) => (
                    <tr key={tank.id} className="hover:bg-subtle transition">
                      <td className="p-3 tabular-nums font-semibold text-primary">{tank.tankCode}</td>
                      <td className="p-3 font-semibold text-foreground">{tank.name}</td>
                      <td className="p-3 tabular-nums text-slate-700">{tank.capacityLiters.toLocaleString()} L</td>
                      <td className="p-3 tabular-nums font-semibold text-foreground">
                        {tank.currentStockAt13Ts !== null
                          ? `${tank.currentStockAt13Ts.toLocaleString()} L`
                          : '—'}
                      </td>
                      <td className="p-3 tabular-nums font-semibold text-blue-800">
                        {tank.compositeTsPercent !== null ? `${tank.compositeTsPercent}%` : '—'}
                      </td>
                      <td className="p-3 tabular-nums">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-slate-800">{tank.fillPercentage}%</span>
                          <div className="w-16 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                            <div
                              style={{ width: `${Math.min(100, tank.fillPercentage)}%` }}
                              className="bg-primary h-full rounded-full"
                            />
                          </div>
                        </div>
                      </td>
                      <td className="p-3 tabular-nums font-semibold text-blue-700">
                        {tank.currentTempC !== null ? `${tank.currentTempC} °C` : '—'}
                      </td>
                      <td className="p-3 tabular-nums text-emerald-700 font-semibold">
                        +{tank.todayReceiptsLiters.toLocaleString()} L
                      </td>
                      <td className="p-3 tabular-nums text-slate-600">
                        -{tank.todayDispatchesLiters.toLocaleString()} L
                      </td>
                      <td className="p-3 text-right">
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase bg-emerald-50 text-emerald-700 border border-emerald-200">
                          Active
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Pagination Bar */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between p-3 bg-card rounded-xl border border-border text-xs">
          <span className="text-slate-500 font-medium">
            Page <span className="font-semibold text-foreground">{page}</span> of{' '}
            <span className="font-semibold text-foreground">{totalPages}</span> ({totalRecords} records)
          </span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="p-1.5 rounded-md border border-border bg-subtle hover:bg-muted disabled:opacity-40"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="p-1.5 rounded-md border border-border bg-subtle hover:bg-muted disabled:opacity-40"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
