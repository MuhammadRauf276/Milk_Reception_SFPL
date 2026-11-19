'use client';

import React, { useState, useMemo } from 'react';
import { ErrorState } from '@/components/ui/empty-state';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { fetchJson } from '@/lib/query/fetchJson';
import { User } from '@backend/core/types';
import type {
  ZmccHierarchyReport,
  ZmccRouteHierarchyNode,
  ZmccAreaHierarchyNode,
  ZmccShopHierarchyNode,
} from './zmccReportTypes';
import {
  Network,
  ChevronDown,
  ChevronRight,
  Search,
  X,
  Download,
  MapPin,
  CheckCircle2,
  Store,
  Phone,
  Milk,
  Truck,
  Building2,
  UserCheck,
} from 'lucide-react';
import { DataTable, type DataColumn } from '@/components/ui/data-table';
import { StatCard } from '@/components/ui/stat-card';
import { QuantityStat } from '@/components/ui/quantity-stat';
import { PageLoader } from '@/components/ui/spinner';
import { getErrorMessage } from '@/lib/errors';
import { toast } from '@/frontend/lib/appToast';
import { formatLossGainPercent, lossGainClass } from '@/lib/lossGain';

interface ZMCCSubordinateHierarchyScreenProps {
  currentUser: User | null;
  targetZmccId?: string;
  onSelectFacility?: (id: string) => void;
}

const shopColumns: DataColumn<ZmccShopHierarchyNode>[] = [
  { key: 'code', header: 'Shop Code', label: 'Shop code', primary: true, cell: (shop) => <span className="tabular-nums font-semibold text-primary">{shop.shopCode}</span> },
  { key: 'name', header: 'Shop Name', label: 'Shop name', cell: (shop) => <span className="font-semibold text-foreground">{shop.shopName}</span> },
  {
    key: 'owner',
    header: 'Owner & Contact',
    label: 'Owner & contact',
    cell: (shop) => (
      <span className="text-secondary-foreground">
        {shop.ownerName}{' '}
        <span className="text-xs text-muted-foreground">({shop.phoneNumber})</span>
      </span>
    ),
  },
  { key: 'chiller', header: 'Chiller', label: 'Chiller', cell: (shop) => <span className="text-secondary-foreground">{shop.chillerOwnership}</span> },
  {
    key: 'geotag',
    header: 'Geotag Status',
    label: 'Geotag status',
    cell: (shop) =>
      shop.geotagStatus === 'VERIFIED' ? (
        <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">
          <CheckCircle2 className="w-2.5 h-2.5" /> Verified
        </span>
      ) : (
        <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-md border border-amber-200">
          <MapPin className="w-2.5 h-2.5" /> Pending GPS
        </span>
      ),
  },
  {
    key: 'liters',
    header: 'Today Liters',
    label: 'Today liters',
    cell: (shop) => <span className="tabular-nums font-semibold text-foreground">{shop.todayLiters > 0 ? `${shop.todayLiters.toLocaleString()} L` : '—'}</span>,
  },
  { key: 'fat', header: 'Fat %', label: 'Fat %', cell: (shop) => <span className="tabular-nums font-semibold text-secondary-foreground">{shop.todayFat ? `${shop.todayFat}%` : '—'}</span> },
  { key: 'lr', header: 'LR', label: 'LR', cell: (shop) => <span className="tabular-nums font-semibold text-secondary-foreground">{shop.todayLr || '—'}</span> },
  {
    key: 'last',
    header: 'Last Collection',
    label: 'Last collection',
    align: 'right',
    cell: (shop) => (
      <span className="text-muted-foreground tabular-nums">
        {shop.lastCollectionAt
          ? new Date(shop.lastCollectionAt).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            })
          : 'None'}
      </span>
    ),
  },
];

type HcSupplierNode = ZmccHierarchyReport['hcSuppliers'][number];

const supplierColumns: DataColumn<HcSupplierNode>[] = [
  { key: 'code', header: 'Supplier Code', label: 'Supplier code', primary: true, cell: (supplier) => <span className="tabular-nums font-semibold text-primary">{supplier.supplierCode}</span> },
  { key: 'name', header: 'Supplier Name', label: 'Supplier name', cell: (supplier) => <span className="font-semibold text-foreground">{supplier.name}</span> },
  { key: 'contact', header: 'Contact Person', label: 'Contact person', cell: (supplier) => <span className="text-secondary-foreground">{supplier.contactPerson || '—'}</span> },
  { key: 'phone', header: 'Phone', label: 'Phone', cell: (supplier) => <span className="tabular-nums text-secondary-foreground">{supplier.phoneNumber || '—'}</span> },
  {
    key: 'status',
    header: 'Status',
    label: 'Status',
    cell: () => <span className="text-xs font-semibold px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200">ACTIVE</span>,
  },
  { key: 'arrivals', header: 'Today Arrivals', label: 'Today arrivals', cell: (supplier) => <span className="tabular-nums font-semibold text-secondary-foreground">{supplier.todayArrivalsCount}</span> },
  { key: 'liters', header: 'Today Liters', label: 'Today liters', cell: (supplier) => <span className="tabular-nums font-semibold text-foreground">{supplier.todayLiters.toLocaleString()} L</span> },
  {
    key: 'last',
    header: 'Last Arrival',
    label: 'Last arrival',
    align: 'right',
    cell: (supplier) => (
      <span className="text-muted-foreground tabular-nums">
        {supplier.lastArrivalAt
          ? new Date(supplier.lastArrivalAt).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            })
          : '—'}
      </span>
    ),
  },
];

export function ZMCCSubordinateHierarchyScreen({
  currentUser,
  targetZmccId,
  onSelectFacility,
}: ZMCCSubordinateHierarchyScreenProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedRoutes, setExpandedRoutes] = useState<Set<string>>(new Set());
  const [expandedAreas, setExpandedAreas] = useState<Set<string>>(new Set());
  const [selectedShop, setSelectedShop] = useState<ZmccShopHierarchyNode | null>(null);
  const searchParams = useSearchParams();
  const urlView = searchParams?.get('view')?.toUpperCase();
    // Command Center uses ?view for its own page, so it picks this list with ?sub.
  const activeTab = urlView === 'HC_SUPPLIERS' || searchParams?.get('sub')?.toUpperCase() === 'HC_SUPPLIERS' ? 'HC_SUPPLIERS' : 'ROUTES';

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

  // Query hierarchy report
  const hierarchyQuery = useQuery({
    queryKey: ['zmcc', 'hierarchy-report', facilityId],
    queryFn: async ({ signal }) => {
      const url = `/api/zmcc/reports/hierarchy${facilityId ? `?zmccId=${encodeURIComponent(facilityId)}` : ''}`;
      const json = await fetchJson<{ data: ZmccHierarchyReport | ZmccHierarchyReport[] }>(url, { signal });
      return json.data;
    },
    staleTime: 60_000,
  });

  const reportData: ZmccHierarchyReport | null = useMemo(() => {
    if (!hierarchyQuery.data) return null;
    if (Array.isArray(hierarchyQuery.data)) {
      return hierarchyQuery.data[0] || null;
    }
    return hierarchyQuery.data;
  }, [hierarchyQuery.data]);

  const toggleRoute = (routeId: string) => {
    setExpandedRoutes((prev) => {
      const next = new Set(prev);
      if (next.has(routeId)) next.delete(routeId);
      else next.add(routeId);
      return next;
    });
  };

  const toggleArea = (areaId: string) => {
    setExpandedAreas((prev) => {
      const next = new Set(prev);
      if (next.has(areaId)) next.delete(areaId);
      else next.add(areaId);
      return next;
    });
  };

  const handleExportExcel = () => {
    const url = `/api/zmcc/reports/export?reportType=HIERARCHY${facilityId ? `&zmccId=${encodeURIComponent(facilityId)}` : ''}`;
    window.open(url, '_blank');
    toast.success('Downloading…');
  };

  // Filter routes and shops by search term
  const filteredRoutes = useMemo(() => {
    if (!reportData?.routes) return [];
    if (!searchTerm.trim()) return reportData.routes;

    const term = searchTerm.toLowerCase();
    return reportData.routes
      .map((route) => {
        const routeMatches =
          route.routeCode.toLowerCase().includes(term) ||
          route.name.toLowerCase().includes(term) ||
          (route.assignedMot?.name || '').toLowerCase().includes(term);

        const matchingAreas = route.areas
          .map((area) => {
            const areaMatches = area.name.toLowerCase().includes(term) || area.areaCode.toLowerCase().includes(term);
            const matchingShops = area.shops.filter(
              (shop) =>
                shop.shopName.toLowerCase().includes(term) ||
                shop.shopCode.toLowerCase().includes(term) ||
                shop.ownerName.toLowerCase().includes(term) ||
                shop.phoneNumber.includes(term)
            );

            if (areaMatches || matchingShops.length > 0) {
              return {
                ...area,
                shops: areaMatches ? area.shops : matchingShops,
              };
            }
            return null;
          })
          .filter(Boolean) as ZmccAreaHierarchyNode[];

        if (routeMatches || matchingAreas.length > 0) {
          return {
            ...route,
            areas: routeMatches ? route.areas : matchingAreas,
          };
        }
        return null;
      })
      .filter(Boolean) as ZmccRouteHierarchyNode[];
  }, [reportData, searchTerm]);

  if (hierarchyQuery.isPending) {
    return <PageLoader label="Loading…" className="py-24" />;
  }

  if (hierarchyQuery.isError) {
    return (
      <ErrorState description={getErrorMessage(hierarchyQuery.error)} onRetry={() => void hierarchyQuery.refetch()} />
    );
  }

  if (!reportData) {
    return (
      <div className="p-12 text-center bg-card rounded-xl border border-border text-xs text-muted-foreground">
        No hierarchy yet
      </div>
    );
  }

  const { summary, zmcc } = reportData;

  return (
    <div className="space-y-6">
      {/* Top Banner & Header */}
      <div className="bg-card p-5 rounded-2xl border border-border shadow-2xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Network className="w-5 h-5 text-muted-foreground" />
            <h1 className="text-lg font-semibold text-foreground">
              {zmcc.name} ({zmcc.code}) · Subordinate Hierarchy
            </h1>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Routes and shops
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleExportExcel}
            className="min-h-11 flex items-center space-x-1.5 px-3 py-2 rounded-lg border border-action/30 bg-action-soft hover:bg-action-soft text-xs font-semibold text-action transition"
          >
            <Download className="w-4 h-4 text-secondary-foreground" />
            <span>Export Directory (.xlsx)</span>
          </button>
          <button
            type="button"
            onClick={() => hierarchyQuery.refetch()}
            className="min-h-11 flex items-center space-x-1 px-3 py-2 rounded-lg border border-border bg-subtle hover:bg-muted text-xs font-semibold text-secondary-foreground"
          >
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Summary KPI Ribbon */}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,11rem),1fr))] gap-3">
        <StatCard label="Total Routes" value={summary.totalRoutes} icon={Truck} tone="info" />
        <StatCard label="Total Areas" value={summary.totalAreas} icon={Building2} tone="default" />
        <StatCard label="Total Shops" value={summary.totalShops} hint={`${summary.activeShops} active`} icon={Store} tone="default" />
        <StatCard
          label="GPS Verified"
          value={`${summary.gpsVerifiedRate}%`}
          hint="Geotagged shops"
          icon={CheckCircle2}
          tone={summary.gpsVerifiedRate > 80 ? 'success' : 'warning'}
        />
        <QuantityStat
          label="Today's Intake"
          at13ts={summary.todayIntakeAt13TsLiters}
          gross={summary.todayIntakeLiters}
          missingAt13tsCount={summary.todayIntakeMissingAt13Ts}
          hint="Field collection"
          icon={Milk}
          tone="info"
        />
        <StatCard label="Active Mobile Testers" value={summary.activeMotCount} icon={UserCheck} tone="success" />
      </div>

      {/* Tab Switcher & Search Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">

        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search route, shop or phone…"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-border bg-card focus:outline-hidden focus:border-primary min-h-11"
          />
        </div>
      </div>

      {/* Hierarchy Drill-Down Tree */}
      {activeTab === 'ROUTES' ? (
        <div className="space-y-4">
          {filteredRoutes.length === 0 ? (
            <div className="p-8 text-center bg-card rounded-2xl border border-border text-xs text-muted-foreground">
              No matches
            </div>
          ) : (
            filteredRoutes.map((route) => {
              const isRouteOpen = expandedRoutes.has(route.id) || Boolean(searchTerm);

              return (
                <div key={route.id} className="bg-card rounded-xl border border-border overflow-hidden shadow-2xs">
                  {/* Route Header Row */}
                  <div
                    onClick={() => toggleRoute(route.id)}
                    className="p-4 bg-muted/30 hover:bg-muted/60 cursor-pointer flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-border/60 transition"
                  >
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        aria-label="Toggle Route"
                        className="p-1 rounded-md text-muted-foreground hover:bg-muted transition"
                      >
                        {isRouteOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                      </button>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-sm text-foreground">
                            {route.routeCode} · {route.name}
                          </span>
                          <span className="text-xs font-semibold px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 border border-blue-200">
                            {route.origin} → {route.destination}
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          Mobile Tester: <span className="font-medium text-secondary-foreground">{route.assignedMot?.name || 'Unassigned'}</span>
                          {route.assignedMot?.vehicleNumber && ` (${route.assignedMot.vehicleNumber})`}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-4 text-xs tabular-nums text-right">
                      <div>
                        <span className="text-xs text-muted-foreground block">Shops</span>
                        <span className="font-semibold text-foreground">
                          {route.activeShops} / {route.totalShops}
                        </span>
                      </div>
                      <div>
                        <span className="text-xs text-muted-foreground block">Today Intake</span>
                        <span className="font-semibold text-emerald-700">
                          {route.todayLiters.toLocaleString()} L
                        </span>
                      </div>
                      <div>
                        <span className="text-xs text-muted-foreground block">Avg Fat</span>
                        <span className="font-semibold text-secondary-foreground">
                          {route.todayAvgFat ? `${route.todayAvgFat}%` : '—'}
                        </span>
                      </div>
                      {route.routeDiffPct !== null && (
                        <div>
                          <span className="text-xs text-muted-foreground block">Loss / Gain</span>
                          <span className={`font-semibold ${lossGainClass(route.routeDiffPct)}`}>{formatLossGainPercent(route.routeDiffPct)}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Areas & Shops under this Route */}
                  {isRouteOpen && (
                    <div className="p-4 space-y-3 bg-subtle/30">
                      {route.areas.length === 0 ? (
                        <div className="text-xs text-muted-foreground p-3">No areas yet</div>
                      ) : (
                        route.areas.map((area) => {
                          const isAreaOpen = expandedAreas.has(area.id) || Boolean(searchTerm);

                          return (
                            <div key={area.id} className="bg-card rounded-lg border border-border/80 overflow-hidden">
                              <div
                                onClick={() => toggleArea(area.id)}
                                className="p-3 bg-muted/20 hover:bg-muted/40 cursor-pointer flex items-center justify-between text-xs transition"
                              >
                                <div className="flex items-center gap-2">
                                  {isAreaOpen ? (
                                    <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
                                  ) : (
                                    <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
                                  )}
                                  <span className="font-semibold text-foreground">
                                    Area: {area.name} ({area.areaCode})
                                  </span>
                                  <span className="text-xs text-muted-foreground">
                                    · {area.shops.length} shops ({area.verifiedGpsShops} verified GPS)
                                  </span>
                                </div>
                                <span className="tabular-nums font-semibold text-secondary-foreground">
                                  {area.todayLiters.toLocaleString()} L today
                                </span>
                              </div>

                              {isAreaOpen && (
                                <DataTable
                                  columns={shopColumns}
                                  rows={area.shops}
                                  getRowId={(shop) => shop.id}
                                  onRowClick={(shop) => setSelectedShop(shop)}
                                  tableFrom="lg"
                                />
                              )}
                            </div>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      ) : (
        /* Direct HC Suppliers List */
        <div className="bg-card rounded-xl border border-border overflow-hidden shadow-2xs">
          <div className="p-4 border-b border-border flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">Direct HC suppliers</h2>
            <span className="text-xs text-muted-foreground">{reportData.hcSuppliers.length} registered suppliers</span>
          </div>

          <div className="p-3">
            <DataTable
              columns={supplierColumns}
              rows={reportData.hcSuppliers}
              getRowId={(supplier) => supplier.id}
              tableFrom="lg"
            />
          </div>
        </div>
      )}

      {/* Selected Shop Modal */}
      {selectedShop && (
        <div className="fixed inset-0 z-50 bg-neutral-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-card w-full max-w-lg rounded-2xl border border-border shadow-xl p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div>
                <span className="text-xs font-semibold text-muted-foreground">Shop Details</span>
                <h3 className="text-base font-semibold text-foreground">
                  {selectedShop.shopName} ({selectedShop.shopCode})
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setSelectedShop(null)}
                aria-label="Close"
                className="flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
              ><X className="w-4 h-4" /></button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div className="bg-subtle p-3 rounded-lg">
                <span className="text-xs text-muted-foreground block">Owner</span>
                <span className="font-semibold text-foreground">{selectedShop.ownerName}</span>
              </div>
              <div className="bg-subtle p-3 rounded-lg">
                <span className="text-xs text-muted-foreground block">Phone</span>
                <span className="font-semibold text-foreground">{selectedShop.phoneNumber}</span>
              </div>
              <div className="bg-subtle p-3 rounded-lg">
                <span className="text-xs text-muted-foreground block">Chiller Ownership</span>
                <span className="font-semibold text-foreground">{selectedShop.chillerOwnership}</span>
              </div>
              <div className="bg-subtle p-3 rounded-lg">
                <span className="text-xs text-muted-foreground block">Geotag Status</span>
                <span className="font-semibold text-foreground">{selectedShop.geotagStatus}</span>
              </div>
            </div>

            <div className="bg-emerald-50 border border-emerald-200 p-3 rounded-lg text-xs space-y-1">
              <span className="text-xs font-semibold text-emerald-800 block">Today's Performance</span>
              <div className="flex items-center justify-between text-emerald-900 font-semibold tabular-nums">
                <span>Intake: {selectedShop.todayLiters.toLocaleString()} L</span>
                <span>Fat: {selectedShop.todayFat ? `${selectedShop.todayFat}%` : '—'}</span>
                <span>LR: {selectedShop.todayLr || '—'}</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
