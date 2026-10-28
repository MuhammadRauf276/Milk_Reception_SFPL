'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Truck, Navigation, Thermometer, Clock, Search } from 'lucide-react';
import type { InTransitTankerTelemetry, MotRouteTelemetry, EmergencySubstituteTelemetry } from '../types';
import { formatMetric, NO_DATA } from '../format';
import { LiveMap, type LiveMapMarker, type LiveMapPin, type LiveMapRoute, type LiveMapVehicle } from '@/frontend/modules/shared/map/LiveMap';
import { buildJourneyOverlays, JOURNEY_COLORS, type JourneyOverlayData } from '@/frontend/modules/shared/map/journeyOverlays';
import { Pager, paginate, pageCount } from '@/frontend/modules/dashboard/components/Pager';

/** Optional live-position fields. Shown on the map only when the overview API returns them. */
interface OptionalPosition {
  latitude?: number | string | null;
  longitude?: number | string | null;
  lastFixAt?: string | number | null;
  headingDeg?: number | null;
  speedMps?: number | null;
}

/** Short chip / marker name: demo ids like DEMO-GPS-LIVE-A become LIVE-A. */
function shortLabel(v: string): string {
  const parts = v.split('-');
  return v.length > 12 && parts.length > 2 ? parts.slice(-2).join('-') : v;
}

function toVehicle(
  id: string,
  label: string,
  item: OptionalPosition,
  extra: Partial<LiveMapVehicle>
): LiveMapVehicle | null {
  const lat = Number(item.latitude);
  const lng = Number(item.longitude);
  if (item.latitude == null || item.longitude == null || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return {
    id,
    label,
    latitude: lat,
    longitude: lng,
    lastFixAt: item.lastFixAt ?? null,
    heading: item.headingDeg ?? null,
    speedMps: item.speedMps ?? null,
    ...extra,
  };
}

interface MpdFleetRadarScreenProps {
  tankers: InTransitTankerTelemetry[];
  routes: MotRouteTelemetry[];
  substitutes?: EmergencySubstituteTelemetry[];
}

export const MpdFleetRadarScreen: React.FC<MpdFleetRadarScreenProps> = ({
  tankers = [],
  routes = [],
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [TankerPage, setTankerPage] = useState(1);
  const [RoutePage, setRoutePage] = useState(1);
  const [activeFilter, setActiveFilter] = useState<'ALL' | 'TANKERS' | 'MOT_ROUTES'>('ALL');
  const [focusId, setFocusId] = useState<string | null>(null);
  const [journeyData, setJourneyData] = useState<Record<string, JourneyOverlayData>>({});

  // Full route (plan, trail, forms, stops) for each active MC journey; refreshed every minute.
  const journeyIdsKey = (routes ?? []).slice(0, 12).map((r) => r.id).join(',');
  useEffect(() => {
    const ids = journeyIdsKey ? journeyIdsKey.split(',') : [];
    if (ids.length === 0) return;
    let cancelled = false;
    const load = async () => {
      const results = await Promise.all(
        ids.map((id) =>
          fetch(`/api/zmcc/mot/journeys/${id}/map`)
            .then((r) => (r.ok ? (r.json() as Promise<JourneyOverlayData>) : null))
            .catch(() => null)
        )
      );
      if (cancelled) return;
      setJourneyData((prev) => {
        const next = { ...prev };
        ids.forEach((id, i) => {
          const d = results[i];
          if (d) next[id] = d;
        });
        return next;
      });
    };
    void load();
    const t = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [journeyIdsKey]);

  const matches = (...fields: Array<string | null>) =>
    fields.some((field) => (field ?? '').toLowerCase().includes(searchTerm.toLowerCase()));

  const filteredTankers = (tankers ?? []).filter((t) => matches(t.vehicleNumber, t.sourceName, t.sourceCode));

  const filteredRoutes = (routes ?? []).filter((r) => matches(r.routeCode, r.routeName, r.motName, r.vehicleNumber));

  const mapVehicles = useMemo(() => {
    const out: LiveMapVehicle[] = [];
    if (activeFilter === 'ALL' || activeFilter === 'TANKERS') {
      for (const t of filteredTankers) {
        const v = toVehicle('tanker-' + t.id, t.vehicleNumber, t as unknown as OptionalPosition, {
          subtitle: 'Plant tanker from ' + (t.sourceName ?? NO_DATA),
        });
        if (v) out.push(v);
      }
    }
    if (activeFilter === 'ALL' || activeFilter === 'MOT_ROUTES') {
      for (const r of filteredRoutes) {
        const v = toVehicle('route-' + r.id, shortLabel(r.vehicleNumber ?? r.routeCode ?? 'Vehicle'), r as unknown as OptionalPosition, {
          journeyLabel: r.routeName ?? r.routeCode ?? null,
          group: r.id,
          subtitle: r.motName ? 'Mobile Tester: ' + r.motName : null,
        });
        if (v) out.push(v);
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tankers, routes, searchTerm, activeFilter]);

  const overlays = useMemo(() => {
    const mapRoutes: LiveMapRoute[] = [];
    const mapMarkers: LiveMapMarker[] = [];
    const mapPins: LiveMapPin[] = [];
    const seenZmcc = new Set<string>();
    if (activeFilter === 'ALL' || activeFilter === 'MOT_ROUTES') {
      filteredRoutes.forEach((r, i) => {
        const d = journeyData[r.id];
        if (!d) return;
        const o = buildJourneyOverlays(d, JOURNEY_COLORS[i % JOURNEY_COLORS.length]);
        mapRoutes.push(...o.routes);
        for (const m of o.markers) {
          if (m.kind === 'zmcc') {
            // Draw each ZMCC once, however many journeys start there.
            const key = d.journey.zmcc?.name ?? `${m.latitude.toFixed(3)},${m.longitude.toFixed(3)}`;
            if (seenZmcc.has(key)) continue;
            seenZmcc.add(key);
            mapMarkers.push({ ...m, id: 'zmcc-' + key, lines: undefined, group: undefined });
          } else if (m.kind === 'dwell' || m.kind === 'end') {
            // Clocks and end flags only for the focused journey keeps the overview clean.
            if (focusId === r.id) mapMarkers.push(m);
          } else {
            mapMarkers.push(m);
          }
        }
        // Stop pins only for the focused journey keeps the overview readable.
        if (focusId === r.id) mapPins.push(...o.pins);
      });
    }
    return { mapRoutes, mapMarkers, mapPins };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [journeyData, routes, searchTerm, activeFilter, focusId]);

  const focusable = filteredRoutes.filter((r) => journeyData[r.id]);

  return (
    <div className="space-y-6">
      <div className="bg-card border-border flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 p-3.5 rounded-xl border">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-border focus:outline-hidden focus:border-primary bg-subtle min-h-11"
          />
        </div>
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
          {(['ALL', 'TANKERS', 'MOT_ROUTES'] as const).map((filter) => (
            <button
              key={filter}
              onClick={() => setActiveFilter(filter)}
              className={`px-3 py-1.5 min-h-11 shrink-0 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
                activeFilter === filter
                  ? 'bg-primary text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {filter === 'ALL' && 'All'}
              {filter === 'TANKERS' && 'Tankers'}
              {filter === 'MOT_ROUTES' && 'Mobile Tester'}
            </button>
          ))}
        </div>
      </div>

      {focusable.length > 0 && (
        <div className="flex items-center gap-1.5 overflow-x-auto">
          <button
            type="button"
            onClick={() => setFocusId(null)}
            className={`px-3 min-h-11 shrink-0 rounded-lg text-xs font-semibold whitespace-nowrap ${
              focusId === null ? 'bg-primary text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            All
          </button>
          {focusable.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setFocusId(focusId === r.id ? null : r.id)}
              className={`px-3 min-h-11 shrink-0 rounded-lg text-xs font-semibold whitespace-nowrap tabular-nums ${
                focusId === r.id ? 'bg-primary text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {shortLabel(r.vehicleNumber ?? r.routeCode ?? 'Vehicle')}
            </button>
          ))}
        </div>
      )}

      <div className="relative bg-card rounded-xl border border-border overflow-hidden shadow-2xs">
        <LiveMap
          vehicles={mapVehicles}
          routes={overlays.mapRoutes}
          markers={overlays.mapMarkers}
          pins={overlays.mapPins}
          highlightGroup={focusId}
          onVehicleSelect={(id) => {
            if (id?.startsWith('route-')) setFocusId(id.slice('route-'.length));
          }}
          emptyMessage="No live GPS."
        />
      </div>

      {(activeFilter === 'ALL' || activeFilter === 'TANKERS') && (
        <div className="bg-card border border-border rounded-xl overflow-hidden shadow-xs">
          <div className="p-4 border-b border-border flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Truck className="w-4 h-4 text-primary" />
              <h2 className="text-xs font-semibold text-foreground">
                Tankers in transit
              </h2>
            </div>
            <span className="text-xs tabular-nums font-medium text-slate-500">
              {filteredTankers.length} active shipments
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-subtle border-b border-border text-slate-600 font-semibold">
                  <th className="py-3 px-4">Vehicle</th>
                  <th className="py-3 px-4">Origin ZMCC</th>
                  <th className="py-3 px-4 text-right">Volume</th>
                  <th className="py-3 px-4 text-center">Quality (Fat / LR)</th>
                  <th className="py-3 px-4 text-center">Temp</th>
                  <th className="py-3 px-4">Departed</th>
                  <th className="py-3 px-4 text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredTankers.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-6 text-center text-slate-500">
                      No tankers
                    </td>
                  </tr>
                ) : (
                  paginate(filteredTankers, Math.min(TankerPage, pageCount(filteredTankers.length))).map((t) => (
                    <tr key={t.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-3 px-4">
                        <div className="tabular-nums font-semibold text-foreground">{t.vehicleNumber}</div>
                      </td>
                      <td className="py-3 px-4">
                        <div className="font-semibold text-slate-800">{t.sourceName ?? NO_DATA}</div>
                        <div className="text-slate-500 tabular-nums text-xs">{t.sourceCode}</div>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="tabular-nums font-semibold text-foreground">{t.grossLiters.toLocaleString()} L</div>
                        <div className="text-slate-500 tabular-nums text-xs">{formatMetric(t.at13tsLiters, ' L')} @13%TS</div>
                      </td>
                      <td className="py-3 px-4 text-center tabular-nums">
                        <span className="font-semibold text-slate-800">{formatMetric(t.fatPercent, '%')}</span>
                        <span className="text-slate-400 mx-1">|</span>
                        <span className="font-semibold text-slate-800">{formatMetric(t.lr)}</span>
                      </td>
                      <td className="py-3 px-4 text-center">
                        {t.temperatureCelsius === null ? (
                          <span className="text-slate-400">{NO_DATA}</span>
                        ) : (
                          <span
                            className={`inline-flex items-center gap-1 tabular-nums font-semibold px-2 py-0.5 rounded ${
                              t.temperatureCelsius <= 4.0
                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                : t.temperatureCelsius <= 6.0
                                ? 'bg-amber-50 text-amber-700 border border-amber-200'
                                : 'bg-rose-50 text-rose-700 border border-rose-200'
                            }`}
                          >
                            <Thermometer className="w-3 h-3" />
                            {t.temperatureCelsius}°C
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-1 text-slate-600">
                          <Clock className="w-3 h-3 text-slate-400" />
                          <span className="tabular-nums">
                            {new Date(t.departureTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-center">
                        <span className="inline-block px-2.5 py-1 rounded-full text-xs font-semibold bg-muted text-foreground border border-border">
                          {t.status}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
<Pager page={Math.min(TankerPage, pageCount(filteredTankers.length))} totalPages={pageCount(filteredTankers.length)} total={filteredTankers.length} onPageChange={setTankerPage} />
          </div>
        </div>
      )}

      {(activeFilter === 'ALL' || activeFilter === 'MOT_ROUTES') && (
        <div className="bg-card border border-border rounded-xl overflow-hidden shadow-xs">
          <div className="p-4 border-b border-border flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Navigation className="w-4 h-4 text-primary" />
              <h2 className="text-xs font-semibold text-foreground">
                Mobile Tester routes
              </h2>
            </div>
            <span className="text-xs tabular-nums font-medium text-slate-500">
              {filteredRoutes.length} active routes
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-subtle border-b border-border text-slate-600 font-semibold">
                  <th className="py-3 px-4">Route / Mobile Tester</th>
                  <th className="py-3 px-4">Vehicle</th>
                  <th className="py-3 px-4 text-center">Shop Progress</th>
                  <th className="py-3 px-4 text-right">Collected Volume</th>
                  <th className="py-3 px-4 text-center">Quality (Fat / LR)</th>
                  <th className="py-3 px-4">ZMCC Arrival</th>
                  <th className="py-3 px-4 text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredRoutes.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-6 text-center text-slate-500">
                      No active Mobile Tester field routes.
                    </td>
                  </tr>
                ) : (
                  paginate(filteredRoutes, Math.min(RoutePage, pageCount(filteredRoutes.length))).map((r) => (
                    <tr key={r.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-3 px-4">
                        <div className="font-semibold text-foreground">{r.routeName ?? NO_DATA}</div>
                        <div className="text-slate-500 text-xs">
                          <span className="tabular-nums">{r.routeCode ?? NO_DATA}</span> · Mobile Tester: <strong className="text-slate-700">{r.motName ?? NO_DATA}</strong>
                        </div>
                      </td>
                      <td className="py-3 px-4 tabular-nums font-semibold text-slate-800">
                        {r.vehicleNumber ?? NO_DATA}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <div className="inline-flex items-center gap-1.5">
                          <span className="tabular-nums font-semibold text-slate-800">
                            {r.completedShops}/{r.totalShops}
                          </span>
                          <div className="w-16 h-2 bg-slate-100 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-primary"
                              style={{ width: `${r.totalShops > 0 ? (r.completedShops / r.totalShops) * 100 : 0}%` }}
                            />
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-right tabular-nums font-semibold text-foreground">
                        {r.grossLiters.toLocaleString()} L
                      </td>
                      <td className="py-3 px-4 text-center tabular-nums">
                        <span className="font-semibold text-slate-800">{formatMetric(r.fatPercent, '%')}</span>
                        <span className="text-slate-400 mx-1">|</span>
                        <span className="font-semibold text-slate-800">{formatMetric(r.lr)}</span>
                      </td>
                      <td className="py-3 px-4 text-slate-700 font-medium">
                        {r.etaOrArrival}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <span
                          className={`inline-block px-2.5 py-1 rounded-full text-xs font-semibold ${
                            r.status === 'COMPLETED'
                              ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                              : 'bg-blue-50 text-primary border border-blue-200'
                          }`}
                        >
                          {r.status}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
<Pager page={Math.min(RoutePage, pageCount(filteredRoutes.length))} totalPages={pageCount(filteredRoutes.length)} total={filteredRoutes.length} onPageChange={setRoutePage} />
          </div>
        </div>
      )}
    </div>
  );
};
