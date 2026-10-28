'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Crosshair, Expand, Locate, MapPinOff, Minus, Plus, Shrink, X } from 'lucide-react';
import {
  MARKER_COLOR,
  FRESHNESS_COLOR,
  PIN_COLOR,
  PIN_LABEL,
  ROUTE_GAP_MS,
  fixAgeText,
  freshnessOf,
  speedText,
  toMs,
  type Freshness,
  type LiveMapMarker,
  type LiveMapPin,
  type MarkerKind,
  type LiveMapRoute,
  type LiveMapVehicle,
} from './mapTypes';

export interface LiveMapProps {
  vehicles?: LiveMapVehicle[];
  pins?: LiveMapPin[];
  routes?: LiveMapRoute[];
  /** Icon markers: ZMCC, form-entered-here, dwell, start/end. */
  markers?: LiveMapMarker[];
  /** When set, only this journey group is emphasised (others dimmed) and the map fits to it. */
  highlightGroup?: string | null;
  /** Show a time slider that replays the first route that has timestamps. */
  playback?: boolean;
  /** Tailwind height classes for the map area. */
  heightClass?: string;
  emptyMessage?: string;
  onVehicleSelect?: (id: string | null) => void;
  onPinSelect?: (id: string | null) => void;
}

const TILE_URL = process.env.NEXT_PUBLIC_MAP_TILE_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_ATTRIBUTION =
  process.env.NEXT_PUBLIC_MAP_TILE_ATTRIBUTION ||
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors';
const CLUSTER_THRESHOLD = 80;
let workerConfigured = false;
function configureWorker() {
  if (workerConfigured) return;
  workerConfigured = true;
  // The bundler cannot resolve MapLibre's module worker; serve it from /public instead.
  try {
    maplibregl.setWorkerUrl('/maplibre-gl-worker.mjs');
  } catch {
    /* default worker */
  }
}
// Pakistan centre, used only until data arrives.
const DEFAULT_CENTER: [number, number] = [71.5, 30.2];

type FC = { type: 'FeatureCollection'; features: unknown[] };
const EMPTY_FC: FC = { type: 'FeatureCollection', features: [] };
type Selection = { kind: 'vehicle' | 'pin' | 'marker'; id: string } | null;

function isDark(): boolean {
  if (typeof document === 'undefined') return false;
  return (
    document.documentElement.classList.contains('dark') ||
    document.documentElement.getAttribute('data-theme') === 'dark' ||
    window.matchMedia?.('(prefers-color-scheme: dark)').matches === true
  );
}

function arrowImage(): ImageData {
  const c = document.createElement('canvas');
  c.width = 20;
  c.height = 20;
  const g = c.getContext('2d')!;
  g.strokeStyle = '#ffffff';
  g.lineWidth = 3;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.beginPath();
  g.moveTo(6, 4);
  g.lineTo(14, 10);
  g.lineTo(6, 16);
  g.stroke();
  return g.getImageData(0, 0, 20, 20);
}

const TRUCK_SVG =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 17h4V5H2v12h3"/><path d="M14 8h4l4 4v5h-3"/><circle cx="7.5" cy="17.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/></svg>';

function vehicleElement(v: LiveMapVehicle, f: Freshness, dim: boolean): HTMLElement {
  const el = document.createElement('button');
  el.type = 'button';
  el.title = v.label;
  el.setAttribute('aria-label', `Vehicle ${v.label}`);
  el.style.cssText = `width:30px;height:30px;background:none;border:0;padding:0;cursor:pointer;position:relative;opacity:${dim ? 0.4 : 1};`;
  const badge = document.createElement('span');
  badge.style.cssText = `position:absolute;left:3px;top:3px;width:24px;height:24px;border-radius:50%;background:${FRESHNESS_COLOR[f]};border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;`;
  badge.innerHTML = TRUCK_SVG;
  el.appendChild(badge);
  if (typeof v.heading === 'number' && Number.isFinite(v.heading)) {
    const wedge = document.createElement('span');
    wedge.style.cssText = `position:absolute;inset:0;transform:rotate(${v.heading}deg);pointer-events:none;`;
    const tip = document.createElement('span');
    tip.style.cssText = `position:absolute;left:10px;top:-4px;border-left:5px solid transparent;border-right:5px solid transparent;border-bottom:7px solid ${FRESHNESS_COLOR[f]};`;
    wedge.appendChild(tip);
    el.appendChild(wedge);
  }
  if (f === 'live') {
    const pulse = document.createElement('span');
    pulse.style.cssText =
      'position:absolute;left:3px;top:3px;width:24px;height:24px;border-radius:50%;animation:livemap-pulse 2s infinite;pointer-events:none;';
    el.insertBefore(pulse, badge);
  }
  return el;
}

function pinElement(p: LiveMapPin, dim: boolean): HTMLElement {
  const el = document.createElement('button');
  el.type = 'button';
  el.title = p.label;
  el.setAttribute('aria-label', `${p.label} (${PIN_LABEL[p.status]})`);
  el.style.cssText = `width:26px;height:26px;background:none;border:0;padding:0;cursor:pointer;opacity:${dim ? 0.35 : 1};`;
  const dot = document.createElement('span');
  dot.textContent = p.sequence != null ? String(p.sequence) : '';
  dot.style.cssText = `display:flex;width:20px;height:20px;margin:3px;border-radius:50%;background:${PIN_COLOR[p.status]};border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.4);align-items:center;justify-content:center;color:#fff;font:700 10px system-ui,sans-serif;`;
  el.appendChild(dot);
  return el;
}

const ICON_PATH: Record<MarkerKind, string> = {
  zmcc: '<path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z"/><path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"/><path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2"/><path d="M10 6h4"/><path d="M10 10h4"/><path d="M10 14h4"/><path d="M10 18h4"/>',
  form: '<rect width="8" height="4" x="8" y="2" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M12 11h4"/><path d="M12 16h4"/><path d="M8 11h.01"/><path d="M8 16h.01"/>',
  dwell: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  start: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" x2="4" y1="22" y2="15"/>',
  end: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
};

function markerElement(m: LiveMapMarker, dim: boolean): HTMLElement {
  const el = document.createElement('button');
  el.type = 'button';
  el.title = m.label;
  el.setAttribute('aria-label', m.label);
  const big = m.kind === 'zmcc';
  const size = big ? 26 : 20;
  el.style.cssText = `width:${size + 4}px;height:${size + 4}px;background:none;border:0;padding:0;cursor:pointer;position:relative;opacity:${dim ? 0.3 : 1};`;
  const dot = document.createElement('span');
  dot.style.cssText = `position:absolute;left:2px;top:2px;width:${size}px;height:${size}px;border-radius:${m.kind === 'form' ? '6px' : '50%'};background:${MARKER_COLOR[m.kind]};border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;`;
  dot.innerHTML = `<svg viewBox="0 0 24 24" width="${big ? 15 : 11}" height="${big ? 15 : 11}" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATH[m.kind]}</svg>`;
  el.appendChild(dot);
  return el;
}

const MARKER_OFFSET: Record<MarkerKind, [number, number]> = {
  zmcc: [0, 0],
  form: [14, -14],
  dwell: [-14, 14],
  start: [0, 0],
  end: [0, 0],
};

function buildRouteFeatures(route: LiveMapRoute, upTo: number | null, dim = false, focus = false) {
  const dimV = dim ? 1 : 0;
  const focusV = focus ? 1 : 0;
  const pts = upTo === null ? route.points : route.points.slice(0, upTo + 1);
  const color = route.color || '#2563eb';
  const features: unknown[] = [];
  let solid: [number, number][] = [];
  const flush = () => {
    if (solid.length > 1) {
      features.push({
        type: 'Feature',
        properties: { gap: 0, color, dim: dimV, focus: focusV },
        geometry: { type: 'LineString', coordinates: solid },
      });
    }
  };
  for (let i = 0; i < pts.length; i++) {
    const cur = pts[i];
    const coord: [number, number] = [cur.longitude, cur.latitude];
    if (i > 0) {
      const a = toMs(pts[i - 1].recordedAt);
      const b = toMs(cur.recordedAt);
      if (a !== null && b !== null && b - a > ROUTE_GAP_MS) {
        flush();
        const prev = pts[i - 1];
        features.push({
          type: 'Feature',
          properties: { gap: 1, color, dim: dimV, focus: focusV },
          geometry: { type: 'LineString', coordinates: [[prev.longitude, prev.latitude], coord] },
        });
        solid = [coord];
        continue;
      }
    }
    solid.push(coord);
  }
  flush();
  return features;
}

export const LiveMapCanvas: React.FC<LiveMapProps> = ({
  vehicles = [],
  pins = [],
  routes = [],
  markers = [],
  highlightGroup = null,
  playback = false,
  heightClass = 'h-[480px]',
  emptyMessage = 'No GPS points to show on the map yet.',
  onVehicleSelect,
  onPinSelect,
}) => {
  const wrapRef = useRef<HTMLDivElement>(null);
  const mapElRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const playMarkerRef = useRef<maplibregl.Marker | null>(null);
  const meMarkerRef = useRef<maplibregl.Marker | null>(null);
  const fitKeyRef = useRef<string>('');
  const [ready, setReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [selection, setSelection] = useState<Selection>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [playIdx, setPlayIdx] = useState<number | null>(null);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const useClusters = pins.length > CLUSTER_THRESHOLD;

  const allCoords = useMemo(() => {
    const out: [number, number][] = [];
    vehicles.forEach((v) => out.push([v.longitude, v.latitude]));
    pins.forEach((p) => out.push([p.longitude, p.latitude]));
    routes.forEach((r) => r.points.forEach((p) => out.push([p.longitude, p.latitude])));
    markers.forEach((m) => out.push([m.longitude, m.latitude]));
    return out.filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
  }, [vehicles, pins, routes, markers]);

  const focusCoords = useMemo(() => {
    if (!highlightGroup) return null;
    const out: [number, number][] = [];
    routes.forEach((r) => r.group === highlightGroup && r.points.forEach((p) => out.push([p.longitude, p.latitude])));
    markers.forEach((m) => m.group === highlightGroup && out.push([m.longitude, m.latitude]));
    const f = out.filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
    return f.length > 0 ? f : null;
  }, [highlightGroup, routes, markers]);

  const playRoute = useMemo(
    () =>
      playback
        ? routes.find((r) => !r.planned && r.points.length > 1 && r.points.every((p) => toMs(p.recordedAt) !== null))
        : undefined,
    [playback, routes]
  );
  const playLast = playRoute ? playRoute.points.length - 1 : 0;
  const effectiveIdx = playRoute ? Math.min(playIdx ?? playLast, playLast) : null;

  const fitAll = useCallback(() => {
    const map = mapRef.current;
    const coords = focusCoords ?? allCoords;
    if (!map || coords.length === 0) return;
    if (coords.length === 1) {
      map.flyTo({ center: coords[0], zoom: 15 });
      return;
    }
    const b = new maplibregl.LngLatBounds(coords[0], coords[0]);
    coords.forEach((c) => b.extend(c));
    map.fitBounds(b, {
      padding: { top: 48, left: 48, right: 64, bottom: playRoute ? 96 : 48 },
      maxZoom: 16,
      duration: 600,
    });
  }, [allCoords, focusCoords, playRoute]);

  // Create the map once.
  useEffect(() => {
    if (!mapElRef.current) return;
    let map: maplibregl.Map;
    configureWorker();
    try {
      map = new maplibregl.Map({
        container: mapElRef.current,
        style: {
          version: 8,
          sources: {
            base: { type: 'raster', tiles: [TILE_URL], tileSize: 256, maxzoom: 19, attribution: TILE_ATTRIBUTION },
          },
          layers: [
            { id: 'bg', type: 'background', paint: { 'background-color': '#e5e7eb' } },
            { id: 'base', type: 'raster', source: 'base' },
          ],
        },
        center: DEFAULT_CENTER,
        zoom: 5,
        attributionControl: { compact: true },
      });
    } catch (e) {
      setMapError(e instanceof Error ? e.message : 'Map could not start (WebGL unavailable).');
      return;
    }
    mapRef.current = map;

    map.on('load', () => {
      map.addImage('route-arrow', arrowImage());
      map.addSource('planned', { type: 'geojson', data: EMPTY_FC as never });
      map.addLayer({
        id: 'planned-line',
        type: 'line',
        source: 'planned',
        layout: { 'line-cap': 'butt', 'line-join': 'round' },
        paint: {
          'line-color': ['get', 'color'],
          'line-width': ['case', ['==', ['get', 'focus'], 1], 3, 1.5],
          'line-dasharray': [2, 2],
          'line-opacity': ['case', ['==', ['get', 'dim'], 1], 0.15, 0.8],
        },
      });
      map.addSource('routes', { type: 'geojson', data: EMPTY_FC as never });
      map.addLayer({
        id: 'routes-casing',
        type: 'line',
        source: 'routes',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#ffffff', 'line-width': ['case', ['==', ['get', 'focus'], 1], 7, 4.5], 'line-opacity': ['case', ['==', ['get', 'dim'], 1], 0.15, 0.85] },
      });
      map.addLayer({
        id: 'routes-solid',
        type: 'line',
        source: 'routes',
        filter: ['==', ['get', 'gap'], 0],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': ['get', 'color'], 'line-width': ['case', ['==', ['get', 'focus'], 1], 5, 2.5], 'line-opacity': ['case', ['==', ['get', 'dim'], 1], 0.25, 1] },
      });
      map.addLayer({
        id: 'routes-gap',
        type: 'line',
        source: 'routes',
        filter: ['==', ['get', 'gap'], 1],
        layout: { 'line-cap': 'butt' },
        paint: { 'line-color': ['get', 'color'], 'line-width': ['case', ['==', ['get', 'focus'], 1], 4, 2], 'line-dasharray': [1.5, 1.5], 'line-opacity': ['case', ['==', ['get', 'dim'], 1], 0.2, 0.8] },
      });
      map.addLayer({
        id: 'routes-arrows',
        type: 'symbol',
        source: 'routes',
        filter: ['all', ['==', ['get', 'gap'], 0], ['==', ['get', 'focus'], 1]],
        layout: {
          'symbol-placement': 'line',
          'symbol-spacing': 110,
          'icon-image': 'route-arrow',
          'icon-size': 0.5,
          'icon-allow-overlap': true,
          'icon-rotation-alignment': 'map',
        },
        paint: { 'icon-opacity': ['case', ['==', ['get', 'dim'], 1], 0.25, 1] },
      });
      map.addSource('pins', {
        type: 'geojson',
        data: EMPTY_FC as never,
        cluster: true,
        clusterRadius: 50,
        clusterMaxZoom: 14,
      });
      map.addLayer({
        id: 'pin-clusters',
        type: 'circle',
        source: 'pins',
        filter: ['has', 'point_count'],
        paint: {
          'circle-color': '#2563eb',
          'circle-radius': ['step', ['get', 'point_count'], 16, 20, 22, 100, 30],
          'circle-stroke-width': 3,
          'circle-stroke-color': '#ffffff',
          'circle-opacity': 0.9,
        },
      });
      map.addLayer({
        id: 'pin-points',
        type: 'circle',
        source: 'pins',
        filter: ['!', ['has', 'point_count']],
        paint: {
          'circle-color': ['get', 'color'],
          'circle-radius': 7,
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff',
        },
      });
      map.on('click', 'pin-clusters', (e) => {
        const f = map.queryRenderedFeatures(e.point, { layers: ['pin-clusters'] })[0];
        if (!f) return;
        map.easeTo({
          center: (f.geometry as unknown as { coordinates: [number, number] }).coordinates,
          zoom: map.getZoom() + 2,
        });
      });
      map.on('click', 'pin-points', (e) => {
        const id = e.features?.[0]?.properties?.id;
        if (id) setSelection({ kind: 'pin', id: String(id) });
      });
      for (const l of ['pin-clusters', 'pin-points']) {
        map.on('mouseenter', l, () => {
          map.getCanvas().style.cursor = 'pointer';
        });
        map.on('mouseleave', l, () => {
          map.getCanvas().style.cursor = '';
        });
      }
      setReady(true);
    });
    map.on('error', (e) => {
      const msg = (e as { error?: { message?: string } }).error?.message;
      if (msg && /webgl/i.test(msg)) setMapError(msg);
    });

    return () => {
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
      playMarkerRef.current?.remove();
      meMarkerRef.current?.remove();
      map.remove();
      mapRef.current = null;
      setReady(false);
    };
  }, []);

  // Dark-mode friendly tiles.
  useEffect(() => {
    if (!ready) return;
    const apply = () => {
      const map = mapRef.current;
      if (!map) return;
      const dark = isDark();
      map.setPaintProperty('base', 'raster-brightness-max', dark ? 0.55 : 1);
      map.setPaintProperty('base', 'raster-saturation', dark ? -0.4 : -0.15);
      map.setPaintProperty('base', 'raster-contrast', dark ? 0.1 : 0);
      map.setPaintProperty('bg', 'background-color', dark ? '#0f172a' : '#e5e7eb');
    };
    apply();
    const mo = new MutationObserver(apply);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] });
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    mq?.addEventListener?.('change', apply);
    return () => {
      mo.disconnect();
      mq?.removeEventListener?.('change', apply);
    };
  }, [ready]);

  // Routes (with optional playback truncation).
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const isDim = (r: LiveMapRoute) => Boolean(highlightGroup && r.group !== highlightGroup);
    const features = routes
      .filter((r) => !r.planned)
      .flatMap((r) =>
        buildRouteFeatures(r, playRoute && r.id === playRoute.id ? effectiveIdx : null, isDim(r), Boolean(highlightGroup && r.group === highlightGroup))
      );
    (map.getSource('routes') as maplibregl.GeoJSONSource | undefined)?.setData({
      type: 'FeatureCollection',
      features,
    } as never);
    const planned = routes
      .filter((r) => r.planned && r.points.length > 1)
      .map((r) => ({
        type: 'Feature',
        properties: { color: r.color || '#2563eb', dim: isDim(r) ? 1 : 0, focus: highlightGroup && r.group === highlightGroup ? 1 : 0 },
        geometry: { type: 'LineString', coordinates: r.points.map((p) => [p.longitude, p.latitude]) },
      }));
    (map.getSource('planned') as maplibregl.GeoJSONSource | undefined)?.setData({
      type: 'FeatureCollection',
      features: planned,
    } as never);
  }, [ready, routes, playRoute, effectiveIdx, highlightGroup]);

  // Playback marker.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    playMarkerRef.current?.remove();
    playMarkerRef.current = null;
    if (!playRoute || effectiveIdx === null || effectiveIdx >= playLast) return;
    const pt = playRoute.points[effectiveIdx];
    const el = document.createElement('div');
    el.style.cssText =
      'width:18px;height:18px;border-radius:50%;background:#2563eb;border:3px solid #fff;box-shadow:0 1px 6px rgba(0,0,0,.45);';
    playMarkerRef.current = new maplibregl.Marker({ element: el }).setLngLat([pt.longitude, pt.latitude]).addTo(map);
  }, [ready, playRoute, effectiveIdx, playLast]);

  // Clustered pin layer data (used when there are many pins).
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const src = map.getSource('pins') as maplibregl.GeoJSONSource | undefined;
    src?.setData(
      (useClusters
        ? {
            type: 'FeatureCollection',
            features: pins.map((p) => ({
              type: 'Feature',
              properties: { id: p.id, color: PIN_COLOR[p.status] },
              geometry: { type: 'Point', coordinates: [p.longitude, p.latitude] },
            })),
          }
        : EMPTY_FC) as never
    );
  }, [ready, pins, useClusters]);

  // DOM markers (vehicles always; pins when not clustered).
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];
    if (!useClusters) {
      for (const p of pins) {
        const el = pinElement(p, Boolean(highlightGroup && p.group && p.group !== highlightGroup));
        el.addEventListener('click', (ev) => {
          ev.stopPropagation();
          setSelection({ kind: 'pin', id: p.id });
        });
        markersRef.current.push(new maplibregl.Marker({ element: el }).setLngLat([p.longitude, p.latitude]).addTo(map));
      }
    }
    for (const m of markers) {
      const el = markerElement(m, Boolean(highlightGroup && m.group && m.group !== highlightGroup));
      el.addEventListener('click', (ev) => {
        ev.stopPropagation();
        setSelection({ kind: 'marker', id: m.id });
      });
      markersRef.current.push(
        new maplibregl.Marker({ element: el, offset: MARKER_OFFSET[m.kind] }).setLngLat([m.longitude, m.latitude]).addTo(map)
      );
    }
    for (const v of vehicles) {
      const el = vehicleElement(v, freshnessOf(v, now), Boolean(highlightGroup && v.group && v.group !== highlightGroup));
      el.addEventListener('click', (ev) => {
        ev.stopPropagation();
        setSelection({ kind: 'vehicle', id: v.id });
      });
      markersRef.current.push(new maplibregl.Marker({ element: el }).setLngLat([v.longitude, v.latitude]).addTo(map));
    }
  }, [ready, vehicles, pins, markers, highlightGroup, useClusters, now]);

  // Fit to data when the set of things on the map changes (not on every refresh).
  useEffect(() => {
    if (!ready) return;
    const key = `${highlightGroup ?? ''}|${vehicles.map((v) => v.id).join(',')}|${pins.map((p) => p.id).join(',')}|${routes
      .map((r) => `${r.id}:${r.points.length > 0 ? 1 : 0}`)
      .join(',')}|${markers.length}`;
    if (key === fitKeyRef.current || allCoords.length === 0) return;
    fitKeyRef.current = key;
    fitAll();
  }, [ready, vehicles, pins, routes, markers, highlightGroup, allCoords, fitAll]);

  useEffect(() => {
    onVehicleSelect?.(selection?.kind === 'vehicle' ? selection.id : null);
    onPinSelect?.(selection?.kind === 'pin' ? selection.id : null);
  }, [selection, onVehicleSelect, onPinSelect]);

  // Fullscreen state + resize.
  useEffect(() => {
    const onFs = () => {
      setFullscreen(document.fullscreenElement === wrapRef.current);
      setTimeout(() => mapRef.current?.resize(), 50);
    };
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  const toggleFullscreen = () => {
    const el = wrapRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen?.().catch(() => undefined);
  };

  const locateMe = () => {
    const map = mapRef.current;
    if (!map || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const c: [number, number] = [pos.coords.longitude, pos.coords.latitude];
        meMarkerRef.current?.remove();
        const el = document.createElement('div');
        el.style.cssText =
          'width:16px;height:16px;border-radius:50%;background:#1d4ed8;border:3px solid #fff;box-shadow:0 0 0 6px rgba(29,78,216,.25);';
        meMarkerRef.current = new maplibregl.Marker({ element: el }).setLngLat(c).addTo(map);
        map.flyTo({ center: c, zoom: Math.max(map.getZoom(), 14) });
      },
      () => undefined,
      { enableHighAccuracy: true, timeout: 10_000 }
    );
  };

  const selVehicle = selection?.kind === 'vehicle' ? vehicles.find((v) => v.id === selection.id) : undefined;
  const selPin = selection?.kind === 'pin' ? pins.find((p) => p.id === selection.id) : undefined;
  const selMarker = selection?.kind === 'marker' ? markers.find((m) => m.id === selection.id) : undefined;
  const isEmpty = allCoords.length === 0;
  const hasKind = (k: MarkerKind) => markers.some((m) => m.kind === k);
  const chip = 'inline-flex items-center gap-1 rounded-full border border-border bg-white px-2 py-0.5 dark:bg-slate-800';
  const btn =
    'flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-white text-slate-700 shadow-md hover:bg-slate-50 active:bg-slate-100 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700';

  return (
    <div ref={wrapRef} className="flex flex-col gap-2 bg-background">
      <style>{`@keyframes livemap-pulse{0%{box-shadow:0 0 0 0 rgba(22,163,74,.55)}70%{box-shadow:0 0 0 14px rgba(22,163,74,0)}100%{box-shadow:0 0 0 0 rgba(22,163,74,0)}}`}</style>
      <div
        className={`relative w-full overflow-hidden rounded-xl border border-border ${fullscreen ? 'h-[calc(100vh-64px)]' : heightClass}`}
      >
        <div ref={mapElRef} className="absolute inset-0 h-full w-full" />

        {mapError && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-subtle p-6 text-center text-xs text-rose-700">
            The map could not be shown on this device: {mapError}
          </div>
        )}

        {isEmpty && !mapError && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-6">
            <div className="flex items-center gap-2 rounded-xl border border-border bg-white/95 px-4 py-3 text-xs font-medium text-slate-600 shadow-md dark:bg-slate-800/95 dark:text-slate-200">
              <MapPinOff className="h-4 w-4 text-slate-400" />
              {emptyMessage}
            </div>
          </div>
        )}

        <div className="absolute right-3 top-3 z-10 flex flex-col gap-2">
          <button type="button" className={btn} aria-label="Zoom in" onClick={() => mapRef.current?.zoomIn()}>
            <Plus className="h-4 w-4" />
          </button>
          <button type="button" className={btn} aria-label="Zoom out" onClick={() => mapRef.current?.zoomOut()}>
            <Minus className="h-4 w-4" />
          </button>
          <button type="button" className={btn} aria-label="Fit all points" title="Fit all" onClick={fitAll}>
            <Crosshair className="h-4 w-4" />
          </button>
          <button type="button" className={btn} aria-label="Show my location" title="My location" onClick={locateMe}>
            <Locate className="h-4 w-4" />
          </button>
          <button
            type="button"
            className={btn}
            aria-label={fullscreen ? 'Exit full screen' : 'Full screen'}
            onClick={toggleFullscreen}
          >
            {fullscreen ? <Shrink className="h-4 w-4" /> : <Expand className="h-4 w-4" />}
          </button>
        </div>

        {(selVehicle || selPin || selMarker) && (
          <div className="absolute left-3 top-3 z-10 w-[min(280px,calc(100%-84px))] rounded-xl border border-border bg-white p-3 text-xs text-slate-700 shadow-lg dark:bg-slate-800 dark:text-slate-100">
            <button
              type="button"
              aria-label="Close details"
              onClick={() => setSelection(null)}
              className="absolute right-0 top-0 flex h-11 w-11 items-center justify-center text-slate-500"
            >
              <X className="h-4 w-4" />
            </button>
            {selVehicle && (
              <div className="space-y-1 pr-8">
                <div className="flex items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ background: FRESHNESS_COLOR[freshnessOf(selVehicle, now)] }}
                  />
                  <span className="text-sm font-semibold tabular-nums">{selVehicle.label}</span>
                </div>
                {selVehicle.subtitle && <div>{selVehicle.subtitle}</div>}
                {selVehicle.journeyLabel && <div>Route: {selVehicle.journeyLabel}</div>}
                <div className="font-medium">{fixAgeText(selVehicle.lastFixAt, now)}</div>
                <div>{speedText(selVehicle.speedMps)}</div>
              </div>
            )}
            {selMarker && (
              <div className="space-y-1 pr-8">
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: MARKER_COLOR[selMarker.kind] }} />
                  <span className="text-sm font-semibold">{selMarker.label}</span>
                </div>
                {selMarker.lines?.map((l, i) => (
                  <div key={i}>{l}</div>
                ))}
              </div>
            )}
            {selPin && (
              <div className="space-y-1 pr-8">
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: PIN_COLOR[selPin.status] }} />
                  <span className="text-sm font-semibold">{selPin.label}</span>
                </div>
                <div>
                  {selPin.sequence != null ? `Stop ${selPin.sequence} · ` : ''}
                  {PIN_LABEL[selPin.status]}
                </div>
                {selPin.detail && <div className="text-slate-500 dark:text-slate-300">{selPin.detail}</div>}
              </div>
            )}
          </div>
        )}

        {playRoute && effectiveIdx !== null && (
          <div className="absolute inset-x-3 bottom-8 z-10 flex items-center gap-3 rounded-xl border border-border bg-white/95 px-3 py-2 shadow-lg dark:bg-slate-800/95">
            <input
              type="range"
              min={0}
              max={playLast}
              value={effectiveIdx}
              onChange={(e) => setPlayIdx(Number(e.target.value))}
              aria-label="Journey playback time"
              className="h-11 flex-1 accent-blue-600"
            />
            <span className="w-16 shrink-0 text-right text-xs font-semibold tabular-nums text-slate-700 dark:text-slate-100">
              {new Date(toMs(playRoute.points[effectiveIdx].recordedAt)!).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
          </div>
        )}
      </div>

      {(vehicles.length > 0 || pins.length > 0 || markers.length > 0 || routes.length > 0) && (
        <div className="flex flex-wrap gap-1.5 px-1 text-[10px] text-slate-600 dark:text-slate-300">
          {vehicles.length > 0 &&
            (
              [
                ['live', 'Live'],
                ['recent', 'Recent'],
                ['stale', 'Stale'],
                ['offline', 'Offline'],
              ] as const
            ).map(([k, l]) => (
              <span key={k} className={chip}>
                <span className="h-2 w-2 rounded-full" style={{ background: FRESHNESS_COLOR[k] }} />
                {l}
              </span>
            ))}
          {pins.length > 0 &&
            (['visited', 'rejected', 'notVisited', 'pending'] as const).map((k) => (
              <span key={k} className={chip}>
                <span className="h-2 w-2 rounded-full" style={{ background: PIN_COLOR[k] }} />
                {PIN_LABEL[k]}
              </span>
            ))}
          {routes.some((r) => r.planned) && (
            <span className={chip}>
              <span className="h-0 w-4 border-t-2 border-dashed border-slate-500" />
              Plan
            </span>
          )}
          {routes.some((r) => !r.planned) && (
            <span className={chip}>
              <span className="h-0 w-4 border-t-2 border-blue-600" />
              Travelled
            </span>
          )}
          {(['zmcc', 'form', 'dwell'] as const)
            .filter(hasKind)
            .map((k) => (
              <span key={k} className={chip}>
                <span className="h-2 w-2 rounded-sm" style={{ background: MARKER_COLOR[k] }} />
                {k === 'zmcc' ? 'ZMCC' : k === 'form' ? 'Form' : 'Stop'}
              </span>
            ))}
        </div>
      )}
    </div>
  );
};
