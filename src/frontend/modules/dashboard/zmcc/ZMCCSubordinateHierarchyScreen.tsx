'use client';

import React, { useState, useMemo } from 'react';
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
  AlertTriangle,
  Store,
  Phone,
  Milk,
  Truck,
  Building2,
  UserCheck,
} from 'lucide-react';
import { StatCard } from '@/components/ui/stat-card';
import { PageLoader } from '@/components/ui/spinner';
import { getErrorMessage } from '@/lib/errors';
import { toast } from '@/frontend/lib/appToast';

interface ZMCCSubordinateHierarchyScreenProps {
  currentUser: User | null;
  targetZmccId?: string;
  onSelectFacility?: (id: string) => void;
}

export function ZMCCSubordinateHierarchyScreen({
  currentUser,
  targetZmccId,
  onSelectFacility,
}: ZMCCSubordinateHierarchyScreenProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedRoutes, setExpandedRoutes] = useState<Set<string>>(new Set());
  const [expandedAreas, setExpandedAreas] = useState<Set<string>>(new Set());
  const [selectedShop, setSelectedShop] = useState<ZmccShopHierarchyNode | null>(null);
  const [activeTab, setActiveTab] = useState<'ROUTES' | 'HC_SUPPLIERS'>('ROUTES');

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
    toast.success('Downloading hierarchy export (.xlsx)…');
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
    return <PageLoader label="Loading subordinate hierarchy…" className="py-24" />;
  }

  if (hierarchyQuery.isError) {
    return (
      <div className="p-8 text-center bg-card rounded-xl border border-rose-200 space-y-3">
        <AlertTriangle className="w-8 h-8 text-rose-600 mx-auto" />
        <h3 className="text-sm font-semibold text-rose-800">Failed to load hierarchy</h3>
        <p className="text-xs text-rose-600 max-w-md mx-auto">{getErrorMessage(hierarchyQuery.error)}</p>
        <button
          type="button"
          onClick={() => hierarchyQuery.refetch()}
          className="min-h-11 px-4 py-2 bg-rose-600 text-white rounded-lg text-xs font-semibold hover:bg-rose-700"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!reportData) {
    return (
      <div className="p-12 text-center bg-card rounded-xl border border-border text-xs text-slate-500">
        No hierarchy records found for this facility.
      </div>
    );
  }

  const { summary, zmcc } = reportData;

  return (
    <div className="space-y-6">
      {/* Top Banner & Header */}
      <div className="bg-card p-5 rounded-xl border border-border shadow-2xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Network className="w-5 h-5 text-primary" />
            <h1 className="text-lg font-semibold text-foreground">
              {zmcc.name} ({zmcc.code}) · Subordinate Hierarchy
            </h1>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Complete downward operational structure: Routes → Areas → Collection Shops → Field Receipts
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleExportExcel}
            className="min-h-11 flex items-center space-x-1.5 px-3 py-1.5 rounded-lg border border-border bg-subtle hover:bg-muted text-xs font-semibold text-foreground transition"
          >
            <Download className="w-4 h-4 text-slate-600" />
            <span>Export Directory (.xlsx)</span>
          </button>
          <button
            type="button"
            onClick={() => hierarchyQuery.refetch()}
            className="min-h-11 flex items-center space-x-1 px-3 py-1.5 rounded-lg border border-border bg-subtle hover:bg-muted text-xs font-semibold text-slate-700"
          >
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Summary KPI Ribbon */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
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
        <StatCard
          label="Today's Intake"
          value={`${summary.todayIntakeLiters.toLocaleString()} L`}
          hint="Field collection"
          icon={Milk}
          tone="info"
        />
        <StatCard label="Active MOT Fleet" value={summary.activeMotCount} icon={UserCheck} tone="success" />
      </div>

      {/* Tab Switcher & Search Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="flex items-center gap-1 bg-muted/60 p-1 rounded-lg border border-border">
          <button
            type="button"
            onClick={() => setActiveTab('ROUTES')}
            className={`min-h-9 px-3 py-1.5 text-xs font-semibold rounded-md transition ${
              activeTab === 'ROUTES' ? 'bg-primary text-white shadow-2xs' : 'text-slate-700 hover:text-foreground'
            }`}
          >
            Routes & Collection Points ({reportData.routes.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('HC_SUPPLIERS')}
            className={`min-h-9 px-3 py-1.5 text-xs font-semibold rounded-md transition ${
              activeTab === 'HC_SUPPLIERS' ? 'bg-primary text-white shadow-2xs' : 'text-slate-700 hover:text-foreground'
            }`}
          >
            Direct HC Suppliers ({reportData.hcSuppliers.length})
          </button>
        </div>

        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search Route, Area, Shop or Phone…"
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
            <div className="p-8 text-center bg-card rounded-xl border border-border text-xs text-slate-500">
              No routes or shops matching your search term.
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
                        className="p-1 rounded-md text-slate-500 hover:bg-slate-200 transition"
                      >
                        {isRouteOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                      </button>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-sm text-foreground">
                            {route.routeCode} · {route.name}
                          </span>
                          <span className="text-[10px] uppercase font-semibold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
                            {route.origin} → {route.destination}
                          </span>
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5">
                          Assigned MOT: <span className="font-medium text-slate-700">{route.assignedMot?.name || 'Unassigned'}</span>
                          {route.assignedMot?.vehicleNumber && ` (${route.assignedMot.vehicleNumber})`}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-4 text-xs tabular-nums text-right">
                      <div>
                        <span className="text-[10px] text-slate-500 uppercase block">Shops</span>
                        <span className="font-semibold text-foreground">
                          {route.activeShops} / {route.totalShops}
                        </span>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-500 uppercase block">Today Intake</span>
                        <span className="font-semibold text-emerald-700">
                          {route.todayLiters.toLocaleString()} L
                        </span>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-500 uppercase block">Avg Fat</span>
                        <span className="font-semibold text-slate-700">
                          {route.todayAvgFat ? `${route.todayAvgFat}%` : '—'}
                        </span>
                      </div>
                      {route.routeLossPct !== null && (
                        <div>
                          <span className="text-[10px] text-slate-500 uppercase block">Loss</span>
                          <span className="font-semibold text-amber-700">{route.routeLossPct}%</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Areas & Shops under this Route */}
                  {isRouteOpen && (
                    <div className="p-4 space-y-3 bg-subtle/30">
                      {route.areas.length === 0 ? (
                        <div className="text-xs text-slate-500 italic p-3">No areas configured on this route.</div>
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
                                    <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
                                  ) : (
                                    <ChevronRight className="w-3.5 h-3.5 text-slate-500" />
                                  )}
                                  <span className="font-semibold text-foreground">
                                    Area: {area.name} ({area.areaCode})
                                  </span>
                                  <span className="text-[10px] text-slate-500">
                                    · {area.shops.length} shops ({area.verifiedGpsShops} verified GPS)
                                  </span>
                                </div>
                                <span className="tabular-nums font-semibold text-slate-700">
                                  {area.todayLiters.toLocaleString()} L today
                                </span>
                              </div>

                              {isAreaOpen && (
                                <div className="overflow-x-auto">
                                  <table className="w-full text-left text-xs border-t border-border/60">
                                    <thead className="bg-muted/40 text-slate-600 font-semibold text-[10px] uppercase">
                                      <tr>
                                        <th className="p-2.5">Shop Code</th>
                                        <th className="p-2.5">Shop Name</th>
                                        <th className="p-2.5">Owner & Contact</th>
                                        <th className="p-2.5">Chiller</th>
                                        <th className="p-2.5">Geotag Status</th>
                                        <th className="p-2.5">Today Liters</th>
                                        <th className="p-2.5">Fat %</th>
                                        <th className="p-2.5">LR</th>
                                        <th className="p-2.5 text-right">Last Collection</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-border/60">
                                      {area.shops.map((shop) => (
                                        <tr
                                          key={shop.id}
                                          onClick={() => setSelectedShop(shop)}
                                          className="hover:bg-subtle cursor-pointer transition"
                                        >
                                          <td className="p-2.5 tabular-nums font-semibold text-primary">
                                            {shop.shopCode}
                                          </td>
                                          <td className="p-2.5 font-semibold text-foreground">{shop.shopName}</td>
                                          <td className="p-2.5 text-slate-600">
                                            {shop.ownerName}{' '}
                                            <span className="text-[10px] text-slate-400">({shop.phoneNumber})</span>
                                          </td>
                                          <td className="p-2.5 text-slate-600">{shop.chillerOwnership}</td>
                                          <td className="p-2.5">
                                            {shop.geotagStatus === 'VERIFIED' ? (
                                              <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                                                <CheckCircle2 className="w-2.5 h-2.5" /> Verified
                                              </span>
                                            ) : (
                                              <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
                                                <MapPin className="w-2.5 h-2.5" /> Pending GPS
                                              </span>
                                            )}
                                          </td>
                                          <td className="p-2.5 tabular-nums font-semibold text-foreground">
                                            {shop.todayLiters > 0 ? `${shop.todayLiters.toLocaleString()} L` : '—'}
                                          </td>
                                          <td className="p-2.5 tabular-nums font-semibold text-slate-700">
                                            {shop.todayFat ? `${shop.todayFat}%` : '—'}
                                          </td>
                                          <td className="p-2.5 tabular-nums font-semibold text-slate-700">
                                            {shop.todayLr || '—'}
                                          </td>
                                          <td className="p-2.5 text-right text-slate-500 tabular-nums">
                                            {shop.lastCollectionAt
                                              ? new Date(shop.lastCollectionAt).toLocaleTimeString([], {
                                                  hour: '2-digit',
                                                  minute: '2-digit',
                                                })
                                              : 'None'}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
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
            <h2 className="text-sm font-semibold text-foreground">Direct / High Capacity Local Suppliers</h2>
            <span className="text-xs text-slate-500">{reportData.hcSuppliers.length} registered suppliers</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-muted/50 text-slate-600 font-semibold text-[10px] uppercase border-b border-border">
                <tr>
                  <th className="p-3">Supplier Code</th>
                  <th className="p-3">Supplier Name</th>
                  <th className="p-3">Contact Person</th>
                  <th className="p-3">Phone</th>
                  <th className="p-3">Status</th>
                  <th className="p-3">Today Arrivals</th>
                  <th className="p-3">Today Liters</th>
                  <th className="p-3 text-right">Last Arrival</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {reportData.hcSuppliers.map((supplier) => (
                  <tr key={supplier.id} className="hover:bg-subtle">
                    <td className="p-3 tabular-nums font-semibold text-primary">{supplier.supplierCode}</td>
                    <td className="p-3 font-semibold text-foreground">{supplier.name}</td>
                    <td className="p-3 text-slate-600">{supplier.contactPerson || '—'}</td>
                    <td className="p-3 tabular-nums text-slate-600">{supplier.phoneNumber || '—'}</td>
                    <td className="p-3">
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                        ACTIVE
                      </span>
                    </td>
                    <td className="p-3 tabular-nums font-semibold text-slate-700">{supplier.todayArrivalsCount}</td>
                    <td className="p-3 tabular-nums font-semibold text-foreground">
                      {supplier.todayLiters.toLocaleString()} L
                    </td>
                    <td className="p-3 text-right text-slate-500 tabular-nums">
                      {supplier.lastArrivalAt
                        ? new Date(supplier.lastArrivalAt).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Selected Shop Modal */}
      {selectedShop && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-card w-full max-w-lg rounded-xl border border-border shadow-xl p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div>
                <span className="text-[10px] font-semibold uppercase text-slate-500">Shop Details</span>
                <h3 className="text-base font-semibold text-foreground">
                  {selectedShop.shopName} ({selectedShop.shopCode})
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setSelectedShop(null)}
                className="p-1 rounded-md text-slate-400 hover:text-foreground"
              ><X className="w-4 h-4" /></button>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="bg-subtle p-3 rounded-lg">
                <span className="text-[10px] text-slate-500 uppercase block">Owner</span>
                <span className="font-semibold text-foreground">{selectedShop.ownerName}</span>
              </div>
              <div className="bg-subtle p-3 rounded-lg">
                <span className="text-[10px] text-slate-500 uppercase block">Phone</span>
                <span className="font-semibold text-foreground">{selectedShop.phoneNumber}</span>
              </div>
              <div className="bg-subtle p-3 rounded-lg">
                <span className="text-[10px] text-slate-500 uppercase block">Chiller Ownership</span>
                <span className="font-semibold text-foreground">{selectedShop.chillerOwnership}</span>
              </div>
              <div className="bg-subtle p-3 rounded-lg">
                <span className="text-[10px] text-slate-500 uppercase block">Geotag Status</span>
                <span className="font-semibold text-foreground">{selectedShop.geotagStatus}</span>
              </div>
            </div>

            <div className="bg-emerald-50 border border-emerald-200 p-3 rounded-lg text-xs space-y-1">
              <span className="text-[10px] uppercase font-semibold text-emerald-800 block">Today's Performance</span>
              <div className="flex items-center justify-between text-emerald-900 font-semibold tabular-nums">
                <span>Intake: {selectedShop.todayLiters.toLocaleString()} L</span>
                <span>Fat: {selectedShop.todayFat ? `${selectedShop.todayFat}%` : '—'}</span>
                <span>LR: {selectedShop.todayLr || '—'}</span>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => setSelectedShop(null)}
                className="min-h-11 px-4 py-2 bg-subtle hover:bg-muted text-xs font-semibold rounded-lg text-foreground"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
