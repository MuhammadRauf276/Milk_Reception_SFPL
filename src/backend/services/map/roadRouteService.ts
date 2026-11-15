// The road path between places, for drawing a journey along real roads instead of straight lines.
//
// The path comes from a routing engine that speaks the OSRM API (open-source, built on OpenStreetMap roads).
// Which engine is set by MAP_ROUTING_URL:
//   - not set  : the public OSRM server. Fine for a few routes; it is a shared demo service with no guarantee.
//   - a URL    : your own OSRM server (recommended for daily use: nothing leaves your network and it cannot be rate-limited).
//   - "off"    : no road paths; maps draw straight lines.
// Only coordinates are sent. No names, numbers or anything else about the journey.
import { isValidPosition, type MapPosition } from '@/lib/coordinates';

const PUBLIC_OSRM = 'https://router.project-osrm.org';
/** A journey with more places than this is drawn with straight lines (routing engines cap the number of stops). */
export const MAX_ROUTE_POINTS = 80;
const TIMEOUT_MS = 8000;
const CACHE_MAX = 400;
/** A place moved by less than about a metre is the same place for routing. */
const KEY_DECIMALS = 5;

export interface RoadRoute {
  /** The path as [longitude, latitude] pairs, in travel order. */
  coordinates: Array<[number, number]>;
  distanceM: number;
  durationS: number;
}

const cache = new Map<string, RoadRoute>();
/** When the engine fails, wait before asking again, so a broken connection is not hammered on every map view. */
let pausedUntil = 0;
const PAUSE_AFTER_FAILURE_MS = 60_000;

export function routingBaseUrl(env: Record<string, string | undefined> = process.env): string | null {
  const raw = (env.MAP_ROUTING_URL ?? '').trim();
  if (raw.toLowerCase() === 'off') return null;
  return (raw || PUBLIC_OSRM).replace(/\/+$/, '');
}

/** The places as the routing engine wants them (longitude first), or null when the list cannot be routed. */
export function routeKey(points: readonly MapPosition[]): string | null {
  if (points.length < 2 || points.length > MAX_ROUTE_POINTS) return null;
  if (!points.every((p) => isValidPosition(p.latitude, p.longitude))) return null;
  return points.map((p) => `${p.longitude.toFixed(KEY_DECIMALS)},${p.latitude.toFixed(KEY_DECIMALS)}`).join(';');
}

/**
 * The road path through the places, in the order given. Null when there is no engine, the places cannot be
 * routed, or the engine did not answer: the caller then draws straight lines. Never throws.
 */
export async function getRoadRoute(
  points: readonly MapPosition[],
  deps: { fetchImpl?: typeof fetch; now?: () => number; env?: Record<string, string | undefined> } = {}
): Promise<RoadRoute | null> {
  const base = routingBaseUrl(deps.env);
  const key = routeKey(points);
  if (!base || !key) return null;

  const hit = cache.get(key);
  if (hit) return hit;

  const now = deps.now ?? Date.now;
  if (now() < pausedUntil) return null;

  try {
    const res = await (deps.fetchImpl ?? fetch)(`${base}/route/v1/driving/${key}?overview=full&geometries=geojson&steps=false`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`routing engine answered ${res.status}`);
    const body = (await res.json()) as {
      code?: string;
      routes?: Array<{ distance?: number; duration?: number; geometry?: { coordinates?: unknown } }>;
    };
    const route = body.code === 'Ok' ? body.routes?.[0] : undefined;
    const raw = route?.geometry?.coordinates;
    if (!Array.isArray(raw) || raw.length < 2) throw new Error('routing engine found no road path');

    const coordinates: Array<[number, number]> = [];
    for (const c of raw) {
      if (Array.isArray(c) && typeof c[0] === 'number' && typeof c[1] === 'number' && isValidPosition(c[1], c[0])) {
        coordinates.push([c[0], c[1]]);
      }
    }
    if (coordinates.length < 2) throw new Error('routing engine returned an empty path');

    const result: RoadRoute = { coordinates, distanceM: Number(route?.distance) || 0, durationS: Number(route?.duration) || 0 };
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
    cache.set(key, result);
    return result;
  } catch (err) {
    pausedUntil = now() + PAUSE_AFTER_FAILURE_MS;
    console.warn('[road-route] no road path, drawing straight lines:', err instanceof Error ? err.message : err);
    return null;
  }
}

/** For tests. */
export function resetRoadRouteCache(): void {
  cache.clear();
  pausedUntil = 0;
}
