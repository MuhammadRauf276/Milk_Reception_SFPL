'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { fetchJson } from '@/lib/query/fetchJson';
import { User } from '@backend/core/types';
import {
  Truck,
  MapPin,
  Calendar,
  Search,
  ExternalLink,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Layers,
  X,
  Send,
  Ban,
} from 'lucide-react';
import { ManagerJourneyMap } from '@/frontend/modules/mot/ManagerJourneyMap';
import { LiveMap, type LiveMapVehicle } from '@/frontend/modules/shared/map/LiveMap';
import { buildJourneyOverlays, type JourneyOverlayData } from '@/frontend/modules/shared/map/journeyOverlays';
import { PageLoader } from '@/components/ui/spinner';
import { StatCard } from '@/components/ui/stat-card';
import { getPakistanCalendarDate } from '@/backend/core/business-day';
import { toast } from 'sonner';
import { useDispatchForm, useDispatchGps } from '@/frontend/modules/mot/workspace/useDispatch';
import { DispatchTab } from '@/frontend/modules/mot/workspace/DispatchTab';
import { RouteRequestSheet } from '@/frontend/modules/mot/workspace/RouteRequestSheet';
import { CancelJourneySheet } from '@/frontend/modules/mot/workspace/CancelJourneySheet';
import { canAssignJourney, canCreateRoute, routeNeedsApproval } from '@/frontend/modules/zmcc/stage1Capabilities';
import type { MotProfileItem, MotVehicleItem, RouteOption, JourneyItem } from '@/frontend/modules/mot/workspace/types';

interface ZMCCOperationalJourneysScreenProps {
  currentUser: User | null;
  targetZmccId?: string;
}

interface JourneyRecord {
  id: string;
  journey_number: string;
  operational_date: string;
  zmcc_id: string;
  zmcc: { id: string; code: string; name: string };
  route_id: string;
  route: { id: string; route_code: string; name: string };
  mot_profile: { id: string; mot_code: string; name: string; phone_number: string };
  mot_vehicle: { id: string; vehicle_number: string };
  status: string;
  assigned_at: string;
  assigned_by_name?: string;
  _count?: { stops: number };
}

export function ZMCCOperationalJourneysScreen({
  currentUser,
  targetZmccId,
}: ZMCCOperationalJourneysScreenProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const rawView = searchParams?.get('view')?.toUpperCase();
  const [activeTab, setActiveTab] = useState<'DISPATCH' | 'ACTIVE' | 'HISTORY'>(
    rawView === 'DISPATCH' ? 'DISPATCH' : rawView === 'HISTORY' ? 'HISTORY' : 'ACTIVE'
  );

  const handleTabChange = (newTab: 'DISPATCH' | 'ACTIVE' | 'HISTORY') => {
    setActiveTab(newTab);
    const params = new URLSearchParams(searchParams?.toString() || '');
    params.set('tab', 'MOT_JOURNEYS');
    params.set('view', newTab);
    router.replace(`${pathname}?${params.toString()}`);
  };

  useEffect(() => {
    if (rawView === 'DISPATCH' || rawView === 'ACTIVE' || rawView === 'HISTORY') {
      setActiveTab(rawView);
    }
  }, [rawView]);

  const [selectedJourneyIdForMap, setSelectedJourneyIdForMap] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [historyStatusFilter, setHistoryStatusFilter] = useState<string>('all');
  const [historyDate, setHistoryDate] = useState<string>(getPakistanCalendarDate(new Date()));
  const [dispatchError, setDispatchError] = useState<string | null>(null);
  const [cancelSheetJourney, setCancelSheetJourney] = useState<JourneyItem | null>(null);
  const [routeRequestOpen, setRouteRequestOpen] = useState(false);

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

  // Dispatch form & GPS state for ZMCC Manager
  const dispatchForm = useDispatchForm();
  const dispatchGps = useDispatchGps({
    sources: [],
    effectiveZmccId: facilityId || null,
    fallbackFacilityCode: currentUser?.procurement_source?.code as string | undefined,
    dispatchTabActive: activeTab === 'DISPATCH',
  });

  // Query dispatch resources (routes, profiles, vehicles) for this ZMCC
  const dispatchDataQuery = useQuery({
    queryKey: ['zmcc', 'dispatch-options', facilityId],
    queryFn: async ({ signal }) => {
      const zmccParam = facilityId ? `zmcc_id=${facilityId}` : '';
      const [rData, pData, vData] = await Promise.all([
        fetchJson<{ routes?: RouteOption[] }>(`/api/zmcc/routes?${zmccParam}&is_active=true`, { signal }),
        fetchJson<{ profiles?: MotProfileItem[] }>(`/api/zmcc/mot/profiles?${zmccParam}&is_active=true`, { signal }),
        fetchJson<{ vehicles?: MotVehicleItem[] }>(`/api/zmcc/mot/vehicles?${zmccParam}&is_active=true`, { signal }),
      ]);
      return {
        routes: rData.routes || [],
        profiles: pData.profiles || [],
        vehicles: vData.vehicles || [],
      };
    },
    enabled: Boolean(facilityId),
  });

  const routes: RouteOption[] = dispatchDataQuery.data?.routes ?? [];
  const profiles: MotProfileItem[] = dispatchDataQuery.data?.profiles ?? [];
  const vehicles: MotVehicleItem[] = dispatchDataQuery.data?.vehicles ?? [];

  // 1. Fetch active journeys (COLLECTING / ASSIGNED / RETURNING)
  const activeJourneysQuery = useQuery({
    queryKey: ['zmcc', 'mot-journeys', 'active', facilityId],
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({ status: 'COLLECTING' });
      if (facilityId) params.append('zmcc_id', facilityId);
      const json = await fetchJson<{ journeys?: JourneyRecord[] }>(`/api/zmcc/mot/journeys?${params.toString()}`, { signal });
      return json.journeys ?? [];
    },
    refetchInterval: 30_000,
  });

  // 2. Fetch history journeys
  const historyJourneysQuery = useQuery({
    queryKey: ['zmcc', 'mot-journeys', 'history', facilityId, historyDate, historyStatusFilter],
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams();
      if (facilityId) params.append('zmcc_id', facilityId);
      if (historyDate) params.append('operational_date', historyDate);
      if (historyStatusFilter !== 'all') params.append('status', historyStatusFilter);
      const json = await fetchJson<{ journeys?: JourneyRecord[] }>(`/api/zmcc/mot/journeys?${params.toString()}`, { signal });
      return json.journeys ?? [];
    },
    staleTime: 60_000,
  });

  const activeJourneys = activeJourneysQuery.data ?? [];
  const historyJourneys = historyJourneysQuery.data ?? [];

  // Map overlay fetch for active journeys (first 5)
  const activeJourneyIdsKey = activeJourneys.slice(0, 5).map((j) => j.id).join(',');
  const [activeOverlays, setActiveOverlays] = useState<Record<string, JourneyOverlayData>>({});

  React.useEffect(() => {
    if (!activeJourneyIdsKey) return;
    const ids = activeJourneyIdsKey.split(',');
    let cancelled = false;

    Promise.all(
      ids.map((id) =>
        fetchJson<JourneyOverlayData>(`/api/zmcc/mot/journeys/${id}/map`)
          .then((d) => ({ id, data: d }))
          .catch(() => null)
      )
    ).then((results) => {
      if (cancelled) return;
      const nextMap: Record<string, JourneyOverlayData> = {};
      for (const res of results) {
        if (res?.data) nextMap[res.id] = res.data;
      }
      setActiveOverlays(nextMap);
    });

    return () => {
      cancelled = true;
    };
  }, [activeJourneyIdsKey]);

  // Build overlays for the combined active live map
  const liveMapVehicles = useMemo<LiveMapVehicle[]>(() => {
    const list: LiveMapVehicle[] = [];
    for (const j of activeJourneys) {
      const overlay = activeOverlays[j.id];
      const latestGps =
        overlay?.gps_trail && overlay.gps_trail.length > 0
          ? overlay.gps_trail[overlay.gps_trail.length - 1]
          : null;
      const pos = latestGps ?? overlay?.journey?.start_point;
      if (pos?.latitude && pos?.longitude) {
        list.push({
          id: `veh-${j.id}`,
          label: j.mot_vehicle?.vehicle_number ?? 'MOT Vehicle',
          latitude: Number(pos.latitude),
          longitude: Number(pos.longitude),
          lastFixAt: latestGps?.device_recorded_at,
          journeyLabel: `#${j.journey_number}`,
          subtitle: `Route: ${j.route?.name} · ${j.mot_profile?.name}`,
        });
      }
    }
    return list;
  }, [activeJourneys, activeOverlays]);

  const filteredHistory = useMemo(() => {
    if (!searchTerm.trim()) return historyJourneys;
    const term = searchTerm.toLowerCase();
    return historyJourneys.filter(
      (j) =>
        j.journey_number.toLowerCase().includes(term) ||
        j.route?.name.toLowerCase().includes(term) ||
        j.route?.route_code.toLowerCase().includes(term) ||
        j.mot_profile?.name.toLowerCase().includes(term) ||
        j.mot_vehicle?.vehicle_number.toLowerCase().includes(term)
    );
  }, [historyJourneys, searchTerm]);

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="bg-card p-5 rounded-xl border border-border shadow-2xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Truck className="w-5 h-5 text-primary" />
            <h1 className="text-lg font-semibold text-foreground">MOT Fleet Journeys & Route Radar</h1>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Track active Mobile Tester collections on the live map and review historical route trails with full audit details
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => handleTabChange('DISPATCH')}
            className="min-h-11 flex items-center space-x-1.5 px-3.5 py-1.5 rounded-lg bg-primary text-white hover:bg-primary/90 text-xs font-semibold shadow-2xs transition"
          >
            <Send className="w-3.5 h-3.5" />
            <span>Assign & Dispatch</span>
          </button>
          <button
            type="button"
            onClick={() => {
              activeJourneysQuery.refetch();
              historyJourneysQuery.refetch();
              dispatchDataQuery.refetch();
              toast.success('Journeys updated');
            }}
            className="min-h-11 flex items-center space-x-1.5 px-3 py-1.5 rounded-lg border border-border bg-subtle hover:bg-muted text-xs font-semibold text-foreground transition"
          >
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* KPI Ribbon */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard
          label="Active Journeys"
          value={activeJourneys.length}
          hint="Currently collecting"
          icon={Truck}
          tone="info"
        />
        <StatCard
          label="Active Vehicles"
          value={liveMapVehicles.length}
          hint="Reporting live GPS"
          icon={MapPin}
          tone="success"
        />
        <StatCard
          label="Completed Today"
          value={historyJourneys.filter((j) => j.status === 'COMPLETED').length}
          hint="Safely arrived at ZMCC"
          icon={CheckCircle2}
          tone="default"
        />
        <StatCard
          label="Cancelled"
          value={historyJourneys.filter((j) => j.status === 'CANCELLED').length}
          hint="Exceptions recorded"
          icon={AlertTriangle}
          tone={historyJourneys.some((j) => j.status === 'CANCELLED') ? 'warning' : 'default'}
        />
      </div>

      {/* Segmented Subtabs */}
      <div className="flex items-center gap-1 bg-muted/60 p-1 rounded-lg border border-border w-fit">
        <button
          type="button"
          onClick={() => handleTabChange('DISPATCH')}
          className={`min-h-9 px-4 py-1.5 text-xs font-semibold rounded-md transition inline-flex items-center gap-1.5 ${
            activeTab === 'DISPATCH' ? 'bg-primary text-white shadow-2xs' : 'text-slate-700 hover:text-foreground'
          }`}
        >
          <Send className="w-3.5 h-3.5" />
          <span>Assign & Dispatch</span>
        </button>
        <button
          type="button"
          onClick={() => handleTabChange('ACTIVE')}
          className={`min-h-9 px-4 py-1.5 text-xs font-semibold rounded-md transition inline-flex items-center gap-1.5 ${
            activeTab === 'ACTIVE' ? 'bg-primary text-white shadow-2xs' : 'text-slate-700 hover:text-foreground'
          }`}
        >
          <Truck className="w-3.5 h-3.5" />
          <span>Active Fleet Radar ({activeJourneys.length})</span>
        </button>
        <button
          type="button"
          onClick={() => handleTabChange('HISTORY')}
          className={`min-h-9 px-4 py-1.5 text-xs font-semibold rounded-md transition inline-flex items-center gap-1.5 ${
            activeTab === 'HISTORY' ? 'bg-primary text-white shadow-2xs' : 'text-slate-700 hover:text-foreground'
          }`}
        >
          <Clock className="w-3.5 h-3.5" />
          <span>Journey History & Map Audit ({historyJourneys.length})</span>
        </button>
      </div>

      {/* 0. ASSIGN & DISPATCH VIEW */}
      {activeTab === 'DISPATCH' && (
        <div className="space-y-4">
          {dispatchError && (
            <div className="max-w-4xl mx-auto rounded-lg border border-rose-300 bg-rose-50 p-3 text-xs font-semibold text-rose-800 flex items-center justify-between">
              <span>{dispatchError}</span>
              <button
                type="button"
                onClick={() => setDispatchError(null)}
                className="text-rose-600 hover:text-rose-900 ml-2"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}
          <DispatchTab
            form={dispatchForm}
            gps={dispatchGps}
            routes={routes}
            profiles={profiles}
            vehicles={vehicles}
            effectiveZmccId={facilityId || null}
            canAssignAndDispatch={canAssignJourney(currentUser?.role ?? '')}
            canCreateRoutes={canCreateRoute(currentUser?.role ?? '')}
            routeNeedsZonalApproval={routeNeedsApproval(currentUser?.role ?? '')}
            onRequestRoute={() => setRouteRequestOpen(true)}
            onError={setDispatchError}
            onDispatched={(message) => {
              toast.success(message);
              dispatchDataQuery.refetch();
              activeJourneysQuery.refetch();
              historyJourneysQuery.refetch();
              setActiveTab('ACTIVE');
            }}
          />
        </div>
      )}

      {/* 1. ACTIVE FLEET RADAR VIEW */}
      {activeTab === 'ACTIVE' && (
        <div className="space-y-6">
          {/* Live Map Box */}
          <div className="bg-card rounded-xl border border-border overflow-hidden shadow-2xs">
            <div className="p-4 border-b border-border flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
                <h2 className="text-xs font-semibold text-foreground uppercase tracking-wider">
                  Live Mobile Tester Fleet Radar
                </h2>
              </div>
              <span className="text-xs font-medium text-slate-500">
                {liveMapVehicles.length} vehicles reporting coordinates
              </span>
            </div>

            <div className="h-96 w-full relative">
              <LiveMap
                vehicles={liveMapVehicles}
                routes={[]}
                markers={[]}
                pins={[]}
                emptyMessage="No active journeys reporting GPS coordinates currently."
              />
            </div>
          </div>

          {/* Active Journeys Table */}
          <div className="bg-card rounded-xl border border-border overflow-hidden shadow-2xs">
            <div className="p-4 border-b border-border">
              <h2 className="text-sm font-semibold text-foreground">Active Journeys in Progress</h2>
            </div>

            {activeJourneysQuery.isPending ? (
              <PageLoader label="Loading active journeys…" className="py-12" />
            ) : activeJourneys.length === 0 ? (
              <div className="p-8 text-center text-xs font-semibold text-slate-500">
                No MOT journeys currently in progress.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-muted/60 text-slate-700 uppercase font-semibold text-[10px] border-b border-border">
                    <tr>
                      <th className="p-3">Journey #</th>
                      <th className="p-3">Route</th>
                      <th className="p-3">Mobile Tester</th>
                      <th className="p-3">Vehicle</th>
                      <th className="p-3">Dispatched At</th>
                      <th className="p-3">Status</th>
                      <th className="p-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {activeJourneys.map((j) => (
                      <tr key={j.id} className="hover:bg-subtle transition">
                        <td className="p-3 tabular-nums font-semibold text-primary">#{j.journey_number}</td>
                        <td className="p-3 font-semibold text-foreground">
                          {j.route?.route_code} · {j.route?.name}
                        </td>
                        <td className="p-3 text-foreground font-medium">{j.mot_profile?.name}</td>
                        <td className="p-3 tabular-nums font-semibold text-slate-700">
                          {j.mot_vehicle?.vehicle_number}
                        </td>
                        <td className="p-3 tabular-nums text-slate-600">
                          {new Date(j.assigned_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </td>
                        <td className="p-3">
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase bg-blue-100 text-blue-800">
                            {j.status}
                          </span>
                        </td>
                        <td className="p-3 text-right space-x-1.5">
                          <button
                            type="button"
                            onClick={() => setSelectedJourneyIdForMap(j.id)}
                            className="min-h-9 px-3 rounded-lg bg-emerald-50 text-emerald-800 border border-emerald-200 text-xs font-semibold hover:bg-emerald-100 transition inline-flex items-center gap-1.5"
                          >
                            <MapPin className="w-3.5 h-3.5" />
                            <span>View Trail & Map</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setCancelSheetJourney(j as unknown as JourneyItem)}
                            className="min-h-9 px-3 rounded-lg bg-rose-50 text-rose-700 border border-rose-200 text-xs font-semibold hover:bg-rose-100 transition inline-flex items-center gap-1.5"
                          >
                            <Ban className="w-3.5 h-3.5" />
                            <span>Cancel</span>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 2. JOURNEY HISTORY & AUDIT VIEW */}
      {activeTab === 'HISTORY' && (
        <div className="space-y-4">
          {/* Controls: Date Picker, Status Filter, Search */}
          <div className="bg-card p-4 rounded-xl border border-border shadow-2xs flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1 bg-subtle px-2.5 py-1.5 rounded-lg border border-border text-xs">
                <Calendar className="w-3.5 h-3.5 text-slate-500" />
                <input
                  type="date"
                  value={historyDate}
                  onChange={(e) => setHistoryDate(e.target.value)}
                  className="bg-transparent font-medium text-foreground focus:outline-hidden"
                />
              </div>

              <div className="inline-flex rounded-lg border border-border bg-subtle p-0.5 text-xs">
                {['all', 'COMPLETED', 'CANCELLED'].map((st) => (
                  <button
                    key={st}
                    type="button"
                    onClick={() => setHistoryStatusFilter(st)}
                    className={`min-h-8 px-3 rounded-md font-semibold transition ${
                      historyStatusFilter === st
                        ? 'bg-primary text-white shadow-2xs'
                        : 'text-slate-600 hover:text-foreground'
                    }`}
                  >
                    {st === 'all' ? 'All' : st}
                  </button>
                ))}
              </div>
            </div>

            <div className="relative w-full md:w-72">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search journey, MOT, vehicle…"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-border bg-card focus:outline-hidden focus:border-primary min-h-10"
              />
            </div>
          </div>

          {/* History Records Table */}
          <div className="bg-card rounded-xl border border-border overflow-hidden shadow-2xs">
            {historyJourneysQuery.isPending ? (
              <PageLoader label="Loading journey history…" className="py-12" />
            ) : filteredHistory.length === 0 ? (
              <div className="p-8 text-center text-xs font-semibold text-slate-500">
                No journey records match the selected date and filters.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-muted/60 text-slate-700 uppercase font-semibold text-[10px] border-b border-border">
                    <tr>
                      <th className="p-3">Journey #</th>
                      <th className="p-3">Date</th>
                      <th className="p-3">Route</th>
                      <th className="p-3">Mobile Tester</th>
                      <th className="p-3">Vehicle</th>
                      <th className="p-3">Status</th>
                      <th className="p-3">Dispatched</th>
                      <th className="p-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {filteredHistory.map((j) => (
                      <tr key={j.id} className="hover:bg-subtle transition">
                        <td className="p-3 tabular-nums font-semibold text-primary">#{j.journey_number}</td>
                        <td className="p-3 tabular-nums text-slate-600 font-medium">{j.operational_date}</td>
                        <td className="p-3 font-semibold text-foreground">
                          {j.route?.route_code} · {j.route?.name}
                        </td>
                        <td className="p-3 text-foreground font-medium">{j.mot_profile?.name}</td>
                        <td className="p-3 tabular-nums font-semibold text-slate-700">
                          {j.mot_vehicle?.vehicle_number}
                        </td>
                        <td className="p-3">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase ${
                              j.status === 'COMPLETED'
                                ? 'bg-emerald-100 text-emerald-800'
                                : j.status === 'CANCELLED'
                                ? 'bg-rose-100 text-rose-800'
                                : 'bg-blue-100 text-blue-800'
                            }`}
                          >
                            {j.status}
                          </span>
                        </td>
                        <td className="p-3 tabular-nums text-slate-600">
                          {new Date(j.assigned_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </td>
                        <td className="p-3 text-right">
                          <button
                            type="button"
                            onClick={() => setSelectedJourneyIdForMap(j.id)}
                            className="min-h-9 px-3 rounded-lg bg-emerald-50 text-emerald-800 border border-emerald-200 text-xs font-semibold hover:bg-emerald-100 transition inline-flex items-center gap-1.5"
                          >
                            <MapPin className="w-3.5 h-3.5" />
                            <span>Audit Map & Stops</span>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Interactive Manager Journey Map Modal */}
      {selectedJourneyIdForMap && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6 overflow-y-auto">
          <div className="bg-card w-full max-w-5xl rounded-2xl border border-border shadow-2xl p-5 my-auto max-h-[92vh] overflow-y-auto space-y-4">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div>
                <span className="text-[10px] font-semibold uppercase text-slate-500">Journey Map & Field Trail</span>
                <h3 className="text-base font-semibold text-foreground">
                  Interactive Route Map Replay
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setSelectedJourneyIdForMap(null)}
                className="p-1 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-foreground transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <ManagerJourneyMap
              currentUser={currentUser}
              journeyId={selectedJourneyIdForMap}
              onClose={() => setSelectedJourneyIdForMap(null)}
            />
          </div>
        </div>
      )}

      {/* Interactive Cancel Journey Sheet */}
      {cancelSheetJourney && (
        <CancelJourneySheet
          journey={cancelSheetJourney}
          onClose={() => setCancelSheetJourney(null)}
          onDone={(message) => {
            toast.success(message);
            setCancelSheetJourney(null);
            activeJourneysQuery.refetch();
            historyJourneysQuery.refetch();
            dispatchDataQuery.refetch();
          }}
        />
      )}

      {/* Route Creation Sheet */}
      {routeRequestOpen && (
        <RouteRequestSheet
          zmccId={facilityId || null}
          needsZonalApproval={routeNeedsApproval(currentUser?.role ?? '')}
          onClose={() => setRouteRequestOpen(false)}
          onDone={(message) => {
            toast.success(message);
            setRouteRequestOpen(false);
            dispatchDataQuery.refetch();
          }}
        />
      )}
    </div>
  );
}
