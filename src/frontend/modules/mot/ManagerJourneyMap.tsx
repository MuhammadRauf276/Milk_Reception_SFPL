'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { User } from '@core/types';
import {
  MapPin,
  Truck,
  Store,
  Navigation,
  Clock,
  RotateCw,
  AlertTriangle,
  CheckCircle2,
  Calendar,
  X,
} from 'lucide-react';

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
    endpoint: any | null;
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
      recorded_latitude?: number | null;
      recorded_longitude?: number | null;
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
  const isAuthorized = isSuperAdmin || isZmccManager || isPheOperator;

  // Fetch journey map data
  const fetchMapData = async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/zmcc/mot/journeys/${id}/map`);
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || 'Failed to load journey map data.');
      }
      setMapData(json);
    } catch (err: any) {
      setError(err.message || 'Error loading map data.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (journeyId && isAuthorized) {
      fetchMapData(journeyId);
    }
  }, [journeyId, isAuthorized]);

  // Project coordinates into SVG viewbox (800 x 480)
  const projection = useMemo(() => {
    if (!mapData) return null;

    const points: Array<{ lat: number; lng: number; type: string; meta?: any }> = [];

    // Start point
    if (mapData.journey.start_point) {
      points.push({
        lat: mapData.journey.start_point.latitude,
        lng: mapData.journey.start_point.longitude,
        type: 'START',
      });
    }

    // Stops
    for (const stop of mapData.stops) {
      if (stop.planned_latitude != null && stop.planned_longitude != null) {
        points.push({
          lat: stop.planned_latitude,
          lng: stop.planned_longitude,
          type: 'STOP',
          meta: stop,
        });
      }
    }

    // GPS Trail
    for (const gps of mapData.gps_trail) {
      points.push({
        lat: gps.latitude,
        lng: gps.longitude,
        type: 'GPS',
        meta: gps,
      });
    }

    if (points.length === 0) return null;

    let minLat = Infinity;
    let maxLat = -Infinity;
    let minLng = Infinity;
    let maxLng = -Infinity;

    for (const p of points) {
      if (p.lat < minLat) minLat = p.lat;
      if (p.lat > maxLat) maxLat = p.lat;
      if (p.lng < minLng) minLng = p.lng;
      if (p.lng > maxLng) maxLng = p.lng;
    }

    // Add margin if points are too close
    const latSpan = Math.max(maxLat - minLat, 0.005);
    const lngSpan = Math.max(maxLng - minLng, 0.005);

    const padLat = latSpan * 0.15;
    const padLng = lngSpan * 0.15;

    const bounds = {
      minLat: minLat - padLat,
      maxLat: maxLat + padLat,
      minLng: minLng - padLng,
      maxLng: maxLng + padLng,
    };

    const width = 800;
    const height = 480;

    const project = (lat: number, lng: number) => {
      const x = ((lng - bounds.minLng) / (bounds.maxLng - bounds.minLng)) * width;
      // Invert Y for latitude (higher latitude = higher up on map = lower Y)
      const y = height - ((lat - bounds.minLat) / (bounds.maxLat - bounds.minLat)) * height;
      return { x: Math.max(20, Math.min(width - 20, x)), y: Math.max(20, Math.min(height - 20, y)) };
    };

    return { project, width, height };
  }, [mapData]);

  if (!isAuthorized) {
    return (
      <div className="p-8 bg-rose-50 border border-rose-200 rounded-2xl text-rose-800 text-center space-y-2">
        <AlertTriangle className="w-8 h-8 text-rose-600 mx-auto" />
        <h3 className="text-base font-black">Access Denied</h3>
        <p className="text-xs">
          Only Super Admins, ZMCC Managers, and PHE Operators are permitted to view the Manager Journey Map.
        </p>
      </div>
    );
  }

  if (!journeyId) {
    return (
      <div className="p-12 bg-white rounded-2xl border border-[#EAE4D5] text-center space-y-3">
        <MapPin className="w-10 h-10 text-slate-400 mx-auto" />
        <h3 className="text-base font-black text-[#111311]">No Journey Selected</h3>
        <p className="text-xs text-slate-500 max-w-sm mx-auto">
          Please select a journey from the Active Journeys or Journey History list to view its live trail and stop status.
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="p-16 bg-white rounded-2xl border border-[#EAE4D5] text-center space-y-3">
        <RotateCw className="w-8 h-8 text-[#1E3A8A] animate-spin mx-auto" />
        <p className="text-xs font-bold text-slate-600">Loading live journey tracking data...</p>
      </div>
    );
  }

  if (error || !mapData) {
    return (
      <div className="p-6 bg-rose-50 border border-rose-200 rounded-2xl text-rose-800 space-y-3">
        <div className="flex items-center space-x-2">
          <AlertTriangle className="w-5 h-5 text-rose-600" />
          <h3 className="text-sm font-bold">Failed to load journey map</h3>
        </div>
        <p className="text-xs">{error || 'No map data available.'}</p>
        <button
          type="button"
          onClick={() => fetchMapData(journeyId)}
          className="px-3 py-1.5 bg-rose-600 text-white rounded-xl text-xs font-bold hover:bg-rose-700"
        >
          Retry
        </button>
      </div>
    );
  }

  const { journey, stops, gps_trail, totals } = mapData;

  // Build SVG path for GPS trail
  let gpsPath = '';
  if (projection && gps_trail.length > 0) {
    gpsPath = gps_trail
      .map((pt, idx) => {
        const { x, y } = projection.project(pt.latitude, pt.longitude);
        return `${idx === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
      })
      .join(' ');
  }

  const startCoord = projection?.project(
    journey.start_point.latitude,
    journey.start_point.longitude
  );

  const firstMotCoord =
    projection && journey.first_mot_gps?.latitude != null && journey.first_mot_gps?.longitude != null
      ? projection.project(journey.first_mot_gps.latitude, journey.first_mot_gps.longitude)
      : null;

  const latestCoord =
    projection && journey.latest_point
      ? projection.project(journey.latest_point.latitude, journey.latest_point.longitude)
      : null;

  return (
    <div className="space-y-4">
      {/* Degraded Fallback Banner */}
      <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-800 text-xs font-medium flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
          <span>Basemap tiles unavailable - showing schematic route trail</span>
        </div>
        <div className="flex items-center space-x-2">
          <button
            type="button"
            onClick={() => fetchMapData(journeyId)}
            className="flex items-center space-x-1 px-2.5 py-1 bg-white border border-amber-300 rounded-lg text-[11px] font-bold text-amber-900 hover:bg-amber-100"
          >
            <RotateCw className="w-3 h-3" />
            <span>Refresh Map</span>
          </button>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="p-1 rounded-lg text-amber-700 hover:bg-amber-200"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Journey Header & Summary Metric Cards */}
      <div className="p-5 bg-white rounded-2xl border border-[#EAE4D5] shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-[#EAE4D5] pb-3">
          <div>
            <span className="text-[10px] font-black uppercase text-slate-500 tracking-wider">
              Journey Trail & Map
            </span>
            <div className="flex items-center space-x-2">
              <h2 className="text-lg font-mono font-black text-[#1E3A8A]">
                #{journey.journey_number}
              </h2>
              <span className="px-2.5 py-0.5 rounded-full bg-blue-100 text-[#1E3A8A] text-xs font-bold">
                {journey.status}
              </span>
            </div>
          </div>
          <div className="text-right text-xs text-slate-500">
            <div>
              Route: <span className="font-bold text-slate-800">{journey.route?.name}</span> ({journey.route?.route_code})
            </div>
            <div>
              MOT: <span className="font-bold text-slate-800">{journey.mot_profile?.name}</span> | Vehicle: <span className="font-bold text-slate-800">{journey.mot_vehicle?.vehicle_number}</span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <div className="p-3 bg-[#FDFBF9] rounded-xl border border-[#EAE4D5]">
            <span className="text-[10px] font-bold text-slate-500 uppercase block">Stops Visited</span>
            <span className="text-sm font-black text-[#111311]">
              {totals.visited_stops} / {totals.total_stops}
            </span>
          </div>
          <div className="p-3 bg-[#FDFBF9] rounded-xl border border-[#EAE4D5]">
            <span className="text-[10px] font-bold text-slate-500 uppercase block">Pending Stops</span>
            <span className="text-sm font-black text-amber-600">{totals.pending_stops}</span>
          </div>
          <div className="p-3 bg-[#FDFBF9] rounded-xl border border-[#EAE4D5]">
            <span className="text-[10px] font-bold text-slate-500 uppercase block">Total Gross Ltr</span>
            <span className="text-sm font-black text-emerald-700">{totals.total_gross_liters} L</span>
          </div>
          <div className="p-3 bg-[#FDFBF9] rounded-xl border border-[#EAE4D5]">
            <span className="text-[10px] font-bold text-slate-500 uppercase block">@13 TS Liters</span>
            <span className="text-sm font-black text-emerald-700">{totals.total_at_13ts_liters} L</span>
          </div>
          <div className="p-3 bg-[#FDFBF9] rounded-xl border border-[#EAE4D5]">
            <span className="text-[10px] font-bold text-slate-500 uppercase block">GPS Points / Sync</span>
            <span className="text-xs font-bold text-slate-700">
              {totals.gps_point_count} pts
            </span>
            <span className="text-[10px] text-slate-400 block">
              {new Date(totals.last_sync_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
        </div>
      </div>

      {/* Interactive Map Visual (Schematic Canvas) */}
      <div className="relative bg-slate-900 rounded-2xl border border-slate-800 overflow-hidden shadow-md">
        {/* Map Canvas / SVG */}
        <div className="w-full h-[480px] relative overflow-hidden flex items-center justify-center">
          {projection ? (
            <svg
              viewBox={`0 0 ${projection.width} ${projection.height}`}
              className="w-full h-full"
              preserveAspectRatio="xMidYMid meet"
            >
              {/* Background Grid Lines */}
              <defs>
                <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
                  <path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgba(255, 255, 255, 0.05)" strokeWidth="1" />
                </pattern>
              </defs>
              <rect width="100%" height="100%" fill="url(#grid)" />

              {/* GPS Trail Polyline */}
              {gpsPath && (
                <path
                  d={gpsPath}
                  fill="none"
                  stroke="#38BDF8"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  opacity="0.8"
                />
              )}

              {/* Start Point Marker */}
              {startCoord && (
                <g transform={`translate(${startCoord.x}, ${startCoord.y})`}>
                  <circle r="8" fill="#2563EB" stroke="#FFFFFF" strokeWidth="2" />
                  <text
                    y="-12"
                    textAnchor="middle"
                    fill="#93C5FD"
                    fontSize="10"
                    fontWeight="bold"
                  >
                    Start (Dispatch)
                  </text>
                </g>
              )}

              {/* First MOT Point Marker */}
              {firstMotCoord && (
                <g transform={`translate(${firstMotCoord.x}, ${firstMotCoord.y})`}>
                  <circle r="7" fill="#8B5CF6" stroke="#FFFFFF" strokeWidth="2" />
                  <text
                    y="18"
                    textAnchor="middle"
                    fill="#C4B5FD"
                    fontSize="9"
                    fontWeight="bold"
                  >
                    1st GPS
                  </text>
                </g>
              )}

              {/* Latest Recorded Point Marker (Pulsing Vehicle) */}
              {latestCoord && (
                <g transform={`translate(${latestCoord.x}, ${latestCoord.y})`}>
                  <circle r="12" fill="#EF4444" opacity="0.3" className="animate-ping" />
                  <circle r="8" fill="#EF4444" stroke="#FFFFFF" strokeWidth="2" />
                  <text
                    y="-12"
                    textAnchor="middle"
                    fill="#FCA5A5"
                    fontSize="10"
                    fontWeight="bold"
                  >
                    Latest Position
                  </text>
                </g>
              )}

              {/* Shop Stop Nodes */}
              {stops.map((stop) => {
                if (stop.planned_latitude == null || stop.planned_longitude == null) return null;
                const pos = projection.project(stop.planned_latitude, stop.planned_longitude);
                const isVisited = stop.status === 'VISITED';
                const isSelected = selectedStop?.id === stop.id;

                return (
                  <g
                    key={stop.id}
                    transform={`translate(${pos.x}, ${pos.y})`}
                    onClick={() => setSelectedStop(stop)}
                    className="cursor-pointer transition-transform hover:scale-125"
                  >
                    <circle
                      r={isSelected ? '14' : '10'}
                      fill={isVisited ? '#10B981' : '#F59E0B'}
                      stroke={isSelected ? '#FFFFFF' : 'rgba(255, 255, 255, 0.7)'}
                      strokeWidth={isSelected ? '3' : '1.5'}
                    />
                    <text
                      textAnchor="middle"
                      dy=".35em"
                      fill="#FFFFFF"
                      fontSize={isSelected ? '10' : '8'}
                      fontWeight="bold"
                    >
                      {stop.planned_sequence}
                    </text>
                  </g>
                );
              })}
            </svg>
          ) : (
            <div className="text-slate-400 text-xs">No coordinate trail points to project.</div>
          )}

          {/* Map Legend Overlay */}
          <div className="absolute bottom-3 left-3 bg-slate-800/90 backdrop-blur-xs border border-slate-700 p-2.5 rounded-xl text-[11px] text-slate-300 space-y-1.5 pointer-events-none">
            <div className="flex items-center space-x-2">
              <span className="w-2.5 h-2.5 rounded-full bg-blue-600 border border-white shrink-0" />
              <span>Start Dispatch Point</span>
            </div>
            <div className="flex items-center space-x-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 border border-white shrink-0" />
              <span>Visited Stop</span>
            </div>
            <div className="flex items-center space-x-2">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-500 border border-white shrink-0" />
              <span>Pending Stop</span>
            </div>
            <div className="flex items-center space-x-2">
              <span className="w-2.5 h-2.5 rounded-full bg-red-500 border border-white shrink-0" />
              <span>Latest GPS Position</span>
            </div>
            <div className="flex items-center space-x-2">
              <span className="w-4 h-0.5 bg-sky-400 shrink-0" />
              <span>GPS Trail</span>
            </div>
          </div>

          {/* Endpoint Placeholder Status Badge */}
          <div className="absolute top-3 right-3 bg-slate-800/90 backdrop-blur-xs border border-slate-700 px-3 py-1.5 rounded-xl text-[11px] font-bold text-slate-300">
            <span className="text-slate-400">Endpoint: </span>
            <span className="text-amber-400">{journey.endpoint_status}</span>
          </div>
        </div>

        {/* Stop Detail Drawer / Card when a Stop is clicked */}
        {selectedStop && (
          <div className="p-4 bg-slate-800 border-t border-slate-700 text-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="space-y-1">
              <div className="flex items-center space-x-2">
                <span className="px-2 py-0.5 bg-emerald-600 text-white rounded text-xs font-black">
                  Stop #{selectedStop.planned_sequence}
                </span>
                <span className="font-bold text-white text-sm">
                  {selectedStop.shop_name} ({selectedStop.shop_code})
                </span>
                <span
                  className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-full ${
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
              className="self-start sm:self-center px-3 py-1 bg-slate-700 hover:bg-slate-600 rounded-lg text-xs font-bold text-slate-200"
            >
              Close Stop Info
            </button>
          </div>
        )}
      </div>

      {/* Stops List */}
      <div className="p-4 bg-white rounded-2xl border border-[#EAE4D5] shadow-xs space-y-3">
        <h3 className="text-xs font-black uppercase text-slate-500 tracking-wider">
          Journey Stops & Collections ({stops.length})
        </h3>
        <div className="divide-y divide-[#EAE4D5]">
          {stops.map((s) => (
            <div
              key={s.id}
              onClick={() => setSelectedStop(s)}
              className={`p-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 cursor-pointer hover:bg-[#FDFBF9] rounded-xl transition-colors ${
                selectedStop?.id === s.id ? 'bg-blue-50/50' : ''
              }`}
            >
              <div className="flex items-center space-x-3">
                <span
                  className={`w-6 h-6 rounded-full text-xs font-black flex items-center justify-center ${
                    s.status === 'VISITED'
                      ? 'bg-emerald-600 text-white'
                      : 'bg-amber-500 text-white'
                  }`}
                >
                  {s.planned_sequence}
                </span>
                <div>
                  <p className="text-xs font-black text-[#111311]">
                    {s.shop_name} <span className="font-mono text-slate-500">({s.shop_code})</span>
                  </p>
                  <p className="text-[11px] text-slate-500">
                    {s.owner_name} &bull; {s.phone_number} &bull; {s.area_name}
                  </p>
                </div>
              </div>

              <div className="flex items-center space-x-3 text-right">
                {s.collection ? (
                  <div className="text-xs">
                    <span className="font-black text-emerald-800">{s.collection.gross_liters} L</span>
                    <span className="text-[10px] text-slate-500 block">
                      Fat {s.collection.fat}% &bull; LR {s.collection.lr}
                    </span>
                  </div>
                ) : (
                  <span className="text-xs text-amber-700 font-medium">Pending Collection</span>
                )}
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase ${
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
