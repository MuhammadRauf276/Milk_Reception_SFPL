'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { User } from '@core/types';
import {
  MapPin,
  AlertTriangle,
  CheckCircle2,
  X,
  Loader2,
} from 'lucide-react';
import { onActivateKey } from '@/lib/a11y';
import { getErrorMessage } from '@/lib/errors';
import { fetchJson } from '@/lib/fetch-json';
import { LiveMap, type LiveMapVehicle } from '@/frontend/modules/shared/map/LiveMap';
import { buildJourneyOverlays } from '@/frontend/modules/shared/map/journeyOverlays';

interface ManagerJourneyMapProps {
  currentUser: User | null;
  journeyId?: string | null;
  onClose?: () => void;
}

interface MapData {
  journey: {
    id: string;
    journey_number: string;
    operational_date: string;
    status: string;
    zmcc: { id: string; code: string; name: string } | null;
    route: { id: string; route_code: string; name: string } | null;
    mot_profile: { id: string; mot_code: string; name: string; phone_number: string } | null;
    mot_vehicle: { id: string; vehicle_number: string } | null;
    assigner: { id: string; username: string; full_name: string | null } | null;
    assigned_at: string;
    started_at: string;
    ended_at?: string | null;
    start_point: {
      latitude: number;
      longitude: number;
      gps_accuracy: number | null;
    };
    first_mot_gps: {
      timestamp: string;
      latitude: number | null;
      longitude: number | null;
      gps_accuracy: number | null;
    } | null;
    latest_point: {
      timestamp: string;
      latitude: number;
      longitude: number;
      gps_accuracy: number | null;
    } | null;
    endpoint: unknown;
    endpoint_status: string;
  };
  stops: Array<{
    id: string;
    planned_sequence: number;
    status: string;
    shop_code: string;
    shop_name: string;
    owner_name: string;
    phone_number: string;
    area_code: string;
    area_name: string;
    planned_latitude: number | null;
    planned_longitude: number | null;
    arrived_at: string | null;
    completed_at: string | null;
    collection: {
      id: string;
      collection_number: string;
      quantity: number;
      unit: string;
      gross_liters: number;
      lr: number;
      fat: number;
      snf: number;
      total_solids: number;
      at_13ts_liters: number;
      collection_latitude?: number | null;
      collection_longitude?: number | null;
      device_collected_at?: string | null;
      milk_source_name_snapshot?: string | null;
      entered_by?: string | null;
      created_at: string;
    } | null;
  }>;
  gps_trail: Array<{
    id: string;
    source_type: string;
    latitude: number;
    longitude: number;
    gps_accuracy: number | null;
    device_recorded_at: string;
    server_received_at: string;
  }>;
  totals: {
    total_stops: number;
    visited_stops: number;
    pending_stops: number;
    total_gross_liters: number;
    total_at_13ts_liters: number;
    gps_point_count: number;
    last_sync_time: string;
  };
}

export const ManagerJourneyMap: React.FC<ManagerJourneyMapProps> = ({
  currentUser,
  journeyId,
  onClose,
}) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mapData, setMapData] = useState<MapData | null>(null);
  const [selectedStop, setSelectedStop] = useState<MapData['stops'][0] | null>(null);

  const isSuperAdmin = currentUser?.role === 'SUPER_ADMIN';
  const isZmccManager = currentUser?.role === 'ZMCC_MANAGER';
  const isPheOperator = currentUser?.role === 'PHE_OPERATOR';
  const isMdo = currentUser?.role === 'MDO';
  const isHeadOfMpd = currentUser?.role === 'HEAD_OF_MPD';
  const isExecMgmt = currentUser?.role === 'EXECUTIVE_MANAGEMENT';
  const isDataExec = currentUser?.role === 'DATA_EXECUTIVE';
  const isAuthorized = isSuperAdmin || isHeadOfMpd || isExecMgmt || isDataExec || isZmccManager || isPheOperator || isMdo;

  // Fetch journey map data
  // Journey whose request last settled; a different journeyId means its map is still loading.
  const [loadedJourneyId, setLoadedJourneyId] = useState<string | null>(null);

  const loadMapData = useCallback(
    (id: string) =>
      fetchJson<MapData>(`/api/zmcc/mot/journeys/${id}/map`, undefined, 'Failed to load journey map data.')
        .then(
          (json) => {
            setMapData(json);
            setError(null);
          },
          (err) => setError(getErrorMessage(err) || 'Error loading map data.')
        )
        .finally(() => {
          setLoading(false);
          setLoadedJourneyId(id);
        }),
    []
  );

  const fetchMapData = (id: string) => {
    setLoading(true);
    setError(null);
    return loadMapData(id);
  };

  useEffect(() => {
    if (journeyId && isAuthorized) {
      loadMapData(journeyId);
    }
  }, [journeyId, isAuthorized, loadMapData]);

  const isLoading = loading || (Boolean(journeyId && isAuthorized) && loadedJourneyId !== journeyId);

  if (!isAuthorized) {
    return (
      <div className="bg-card border-border p-8 border rounded-xl text-rose-800 text-center space-y-2">
        <AlertTriangle className="w-8 h-8 text-rose-600 mx-auto" />
        <h3 className="text-base font-semibold">Access Denied</h3>
        <p className="text-xs">
          Your role cannot open the journey map. Please ask your Zonal Manager.
        </p>
      </div>
    );
  }

  if (!journeyId) {
    return (
      <div className="p-12 bg-card rounded-xl border border-border text-center space-y-3">
        <MapPin className="w-10 h-10 text-slate-400 mx-auto" />
        <h3 className="text-base font-semibold text-foreground">No Journey Selected</h3>
        <p className="text-xs text-slate-500 max-w-sm mx-auto">
          Please select a journey from the Active Journeys or Journey History list to view its live trail and stop status.
        </p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="p-16 bg-card rounded-xl border border-border text-center space-y-3">
        <Loader2 className="w-8 h-8 text-primary animate-spin mx-auto" />
        <p className="text-xs font-semibold text-slate-600">Loading live journey tracking data…</p>
      </div>
    );
  }

  if (error || !mapData) {
    return (
      <div className="bg-card border-border p-6 border rounded-xl text-rose-800 space-y-3">
        <div className="flex items-center space-x-2">
          <AlertTriangle className="w-5 h-5 text-rose-600" />
          <h3 className="text-sm font-semibold">Failed to load journey map</h3>
        </div>
        <p className="text-xs">{error || 'No map data available.'}</p>
        <button
          type="button"
          onClick={() => fetchMapData(journeyId)}
          className="min-h-11 min-w-11 px-3 py-1.5 bg-rose-600 text-white rounded-xl text-xs font-semibold hover:bg-rose-700"
        >
          Retry
        </button>
      </div>
    );
  }

  const { journey, stops, gps_trail, totals } = mapData;

  const isJourneyActive = !['COMPLETED', 'CANCELLED', 'CLOSED'].includes(journey.status);
  const { pins, routes, markers } = buildJourneyOverlays(mapData, '#2563eb');
  const vehicles: LiveMapVehicle[] =
    isJourneyActive && journey.latest_point
      ? [
          {
            id: 'vehicle-' + journey.id,
            label: journey.mot_vehicle?.vehicle_number ?? 'Vehicle',
            latitude: journey.latest_point.latitude,
            longitude: journey.latest_point.longitude,
            lastFixAt: journey.latest_point.timestamp,
            journeyLabel: '#' + journey.journey_number,
            subtitle: journey.mot_profile?.name ? 'Mobile Tester: ' + journey.mot_profile.name : null,
          },
        ]
      : [];

  return (
    <div className="space-y-4">
      <div className="bg-card border-border p-3 border rounded-xl text-emerald-800 text-xs font-medium flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>GPS Route Trail Active · All waypoints recorded</span>
        </div>
        <div className="flex items-center space-x-2">
          <button
            type="button"
            onClick={() => fetchMapData(journeyId)}
            className="min-h-11 min-w-11 flex items-center space-x-1 px-2.5 py-1 bg-white border border-emerald-300 rounded-lg text-[11px] font-semibold text-emerald-900 hover:bg-emerald-100"
          >
            <span>Refresh Map</span>
          </button>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="min-h-11 min-w-11 p-1 rounded-lg text-emerald-700 hover:bg-emerald-200"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      <div className="p-5 bg-card rounded-xl border border-border shadow-2xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-border pb-3">
          <div>
            <span className="text-[10px] font-semibold uppercase text-slate-500 tracking-wider">
              Journey Trail & Map
            </span>
            <div className="flex items-center space-x-2">
              <h2 className="text-lg tabular-nums font-semibold text-primary">
                #{journey.journey_number}
              </h2>
              <span className="px-2.5 py-0.5 rounded-full bg-blue-100 text-primary text-xs font-semibold">
                {journey.status}
              </span>
            </div>
          </div>
          <div className="text-right text-xs text-slate-500">
            <div>
              Route: <span className="font-semibold text-slate-800">{journey.route?.name}</span> ({journey.route?.route_code})
            </div>
            <div>
              Mobile Tester: <span className="font-semibold text-slate-800">{journey.mot_profile?.name}</span> | Vehicle: <span className="font-semibold text-slate-800">{journey.mot_vehicle?.vehicle_number}</span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <div className="bg-card border-border p-3 rounded-xl border">
            <span className="text-[10px] font-semibold text-slate-500 uppercase block">Stops Visited</span>
            <span className="text-sm font-semibold text-foreground">
              {totals.visited_stops} / {totals.total_stops}
            </span>
          </div>
          <div className="bg-card border-border p-3 rounded-xl border">
            <span className="text-[10px] font-semibold text-slate-500 uppercase block">Pending Stops</span>
            <span className="text-sm font-semibold text-amber-600">{totals.pending_stops}</span>
          </div>
          <div className="bg-card border-border p-3 rounded-xl border">
            <span className="text-[10px] font-semibold text-slate-500 uppercase block">Total Gross Ltr</span>
            <span className="text-sm font-semibold text-emerald-700">{totals.total_gross_liters} L</span>
          </div>
          <div className="bg-card border-border p-3 rounded-xl border">
            <span className="text-[10px] font-semibold text-slate-500 uppercase block">@13 TS Liters</span>
            <span className="text-sm font-semibold text-emerald-700">{totals.total_at_13ts_liters} L</span>
          </div>
          <div className="bg-card border-border p-3 rounded-xl border">
            <span className="text-[10px] font-semibold text-slate-500 uppercase block">GPS Points / Sync</span>
            <span className="text-xs font-semibold text-slate-700">
              {totals.gps_point_count} pts
            </span>
            <span className="text-[10px] text-slate-400 block">
              {new Date(totals.last_sync_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
        </div>
      </div>

      <div className="relative bg-card rounded-xl border border-border overflow-hidden shadow-md">
        <LiveMap
          vehicles={vehicles}
          pins={pins}
          routes={routes}
          markers={markers}
          playback
          heightClass="h-[480px]"
          emptyMessage="No GPS trail or stop coordinates recorded for this journey yet."
          onPinSelect={(id) => setSelectedStop(id ? stops.find((s) => s.id === id) ?? null : null)}
        />
        <div className="px-3 pb-2 text-[11px] font-semibold text-slate-600">
          Endpoint: <span className="text-amber-600">{journey.endpoint_status}</span>
        </div>

        {selectedStop && (
          <div className="p-4 bg-slate-800 border-t border-slate-700 text-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="space-y-1">
              <div className="flex items-center space-x-2">
                <span className="px-2 py-0.5 bg-emerald-600 text-white rounded text-xs font-semibold">
                  Stop #{selectedStop.planned_sequence}
                </span>
                <span className="font-semibold text-white text-sm">
                  {selectedStop.shop_name} ({selectedStop.shop_code})
                </span>
                <span
                  className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full ${
                    selectedStop.status === 'VISITED'
                      ? 'bg-emerald-900/60 text-emerald-300 border border-emerald-500'
                      : 'bg-amber-900/60 text-amber-300 border border-amber-500'
                  }`}
                >
                  {selectedStop.status}
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Owner: {selectedStop.owner_name} | Contact: {selectedStop.phone_number} | Area: {selectedStop.area_name} ({selectedStop.area_code})
              </p>
              {selectedStop.collection && (
                <div className="text-xs text-emerald-400 font-medium">
                  Collected: {selectedStop.collection.gross_liters} L ({selectedStop.collection.unit}) | LR: {selectedStop.collection.lr} | Fat: {selectedStop.collection.fat}% | SNF: {selectedStop.collection.snf}% | TS: {selectedStop.collection.total_solids}% | @13 TS: {selectedStop.collection.at_13ts_liters} L
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => setSelectedStop(null)}
              className="min-h-11 min-w-11 self-start sm:self-center px-3 py-1 bg-slate-700 hover:bg-slate-600 rounded-lg text-xs font-semibold text-slate-200"
            >
              Close Stop Info
            </button>
          </div>
        )}
      </div>

      <div className="p-4 bg-card rounded-xl border border-border shadow-2xs space-y-3">
        <h3 className="text-xs font-semibold text-slate-500">
          Journey Stops & Collections ({stops.length})
        </h3>
        <div className="divide-y divide-border">
          {stops.map((s) => (
            <div
              role="button"
              tabIndex={0}
              onKeyDown={onActivateKey}
              key={s.id}
              onClick={() => setSelectedStop(s)}
              className={`p-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 cursor-pointer hover:bg-subtle rounded-xl transition-colors ${
                selectedStop?.id === s.id ? 'bg-blue-50/50' : ''
              }`}
            >
              <div className="flex items-center space-x-3">
                <span
                  className={`w-6 h-6 rounded-full text-xs font-semibold flex items-center justify-center ${
                    s.status === 'VISITED'
                      ? 'bg-emerald-600 text-white'
                      : 'bg-amber-500 text-white'
                  }`}
                >
                  {s.planned_sequence}
                </span>
                <div>
                  <p className="text-xs font-semibold text-foreground">
                    {s.shop_name} <span className="tabular-nums text-slate-500">({s.shop_code})</span>
                  </p>
                  <p className="text-[11px] text-slate-500">
                    {s.owner_name} · {s.phone_number} · {s.area_name}
                  </p>
                </div>
              </div>

              <div className="flex items-center space-x-3 text-right">
                {s.collection ? (
                  <div className="text-xs">
                    <span className="font-semibold text-emerald-800">{s.collection.gross_liters} L</span>
                    <span className="text-[10px] text-slate-500 block">
                      Fat {s.collection.fat}% · LR {s.collection.lr}
                    </span>
                  </div>
                ) : (
                  <span className="text-xs text-amber-700 font-medium">Pending Collection</span>
                )}
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase ${
                    s.status === 'VISITED'
                      ? 'bg-emerald-100 text-emerald-800'
                      : 'bg-amber-100 text-amber-800'
                  }`}
                >
                  {s.status}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
