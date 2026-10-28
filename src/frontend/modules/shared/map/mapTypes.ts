export type Freshness = 'live' | 'recent' | 'stale' | 'offline';

export interface LiveMapVehicle {
  id: string;
  /** Vehicle number shown in the popup and on the marker. */
  label: string;
  latitude: number;
  longitude: number;
  /** Degrees clockwise from north. */
  heading?: number | null;
  /** Metres per second (GeolocationCoordinates.speed). */
  speedMps?: number | null;
  /** Time of the GPS fix itself (ms epoch, ISO string or Date). */
  lastFixAt?: number | string | Date | null;
  journeyLabel?: string | null;
  subtitle?: string | null;
  /** Force the offline (red) state, e.g. device reported GPS off. */
  offline?: boolean;
  /** Journey group, to dim this vehicle when another journey is focused. */
  group?: string;
}

export type PinStatus = 'visited' | 'rejected' | 'notVisited' | 'pending';

export interface LiveMapPin {
  id: string;
  label: string;
  latitude: number;
  longitude: number;
  status: PinStatus;
  /** Sequence number drawn inside the pin. */
  sequence?: number | null;
  detail?: string | null;
  group?: string;
}

export interface LiveMapRoutePoint {
  latitude: number;
  longitude: number;
  /** Fix time (ms epoch, ISO string or Date). Needed for gap detection and playback. */
  recordedAt?: number | string | Date | null;
}

export interface LiveMapRoute {
  id: string;
  points: LiveMapRoutePoint[];
  color?: string;
  /** Planned route: drawn as a thin dashed line, no arrows, no playback. */
  planned?: boolean;
  /** Journey this line belongs to; used to highlight one journey and dim the rest. */
  group?: string;
}

export type MarkerKind = 'zmcc' | 'form' | 'dwell' | 'start' | 'end';

/** Icon markers: ZMCC building, "form entered here", dwell clock, start / end. */
export interface LiveMapMarker {
  id: string;
  kind: MarkerKind;
  latitude: number;
  longitude: number;
  /** Max ~3 words, shown under the icon (ZMCC only) and as the popup title. */
  label: string;
  /** Short popup lines (one fact each). */
  lines?: string[];
  group?: string;
}

export const MARKER_COLOR: Record<MarkerKind, string> = {
  zmcc: '#1e3a8a',
  form: '#7c3aed',
  dwell: '#0891b2',
  start: '#16a34a',
  end: '#475569',
};

export function haversineM(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
  const R = 6371000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLng = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Places where the vehicle stayed within `radiusM` for at least `minMs` (default 3 min / 60 m). */
export function computeDwells(
  points: LiveMapRoutePoint[],
  minMs = 3 * 60_000,
  radiusM = 60
): Array<{ latitude: number; longitude: number; durationMs: number; startMs: number }> {
  const out: Array<{ latitude: number; longitude: number; durationMs: number; startMs: number }> = [];
  let i = 0;
  while (i < points.length) {
    const ti = toMs(points[i].recordedAt);
    let j = i;
    while (j + 1 < points.length && haversineM(points[i], points[j + 1]) <= radiusM) j++;
    const tj = toMs(points[j].recordedAt);
    if (ti !== null && tj !== null && j > i && tj - ti >= minMs) {
      const seg = points.slice(i, j + 1);
      out.push({
        latitude: seg.reduce((a, p) => a + p.latitude, 0) / seg.length,
        longitude: seg.reduce((a, p) => a + p.longitude, 0) / seg.length,
        durationMs: tj - ti,
        startMs: ti,
      });
      i = j + 1;
    } else {
      i++;
    }
  }
  return out;
}

export const FRESH_LIVE_MS = 5 * 60_000;
export const FRESH_RECENT_MS = 15 * 60_000;
/** A jump between two route points longer than this is drawn dashed (offline gap). */
export const ROUTE_GAP_MS = 10 * 60_000;

export const FRESHNESS_COLOR: Record<Freshness, string> = {
  live: '#16a34a',
  recent: '#f59e0b',
  stale: '#94a3b8',
  offline: '#dc2626',
};

export const PIN_COLOR: Record<PinStatus, string> = {
  visited: '#16a34a',
  rejected: '#dc2626',
  notVisited: '#94a3b8',
  pending: '#f59e0b',
};

export const PIN_LABEL: Record<PinStatus, string> = {
  visited: 'Visited',
  rejected: 'Rejected',
  notVisited: 'Not visited',
  pending: 'Pending',
};

export function toMs(v: number | string | Date | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = v instanceof Date ? v.getTime() : typeof v === 'number' ? v : Date.parse(v);
  return Number.isFinite(n) ? n : null;
}

export function freshnessOf(v: LiveMapVehicle, now: number): Freshness {
  if (v.offline) return 'offline';
  const t = toMs(v.lastFixAt);
  if (t === null) return 'offline';
  const age = now - t;
  if (age < FRESH_LIVE_MS) return 'live';
  if (age < FRESH_RECENT_MS) return 'recent';
  return 'stale';
}

export function fixAgeText(lastFixAt: LiveMapVehicle['lastFixAt'], now: number): string {
  const t = toMs(lastFixAt);
  if (t === null) return 'No GPS fix';
  const mins = Math.max(0, Math.floor((now - t) / 60_000));
  if (mins < 1) return 'Fix just now';
  if (mins < 60) return `Fix ${mins} min ago`;
  const h = Math.floor(mins / 60);
  return h < 48 ? `Fix ${h} hr ago` : `Fix ${Math.floor(h / 24)} d ago`;
}

export function speedText(mps: number | null | undefined): string {
  if (mps === null || mps === undefined || !Number.isFinite(mps)) return 'Speed n/a';
  return `${Math.round(mps * 3.6)} km/h`;
}
