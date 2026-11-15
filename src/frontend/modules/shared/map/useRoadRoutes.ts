'use client';

import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import { fetchJson } from '@/lib/query/fetchJson';
import type { LiveMapRoute } from './mapTypes';

/** Mirrors the server's limit: longer plans stay as straight lines. */
const MAX_ROUTE_POINTS = 80;

interface RoadRouteAnswer {
  route: { coordinates: Array<[number, number]>; distanceM: number; durationS: number } | null;
}

const keyOf = (r: LiveMapRoute) => r.points.map((p) => `${p.longitude.toFixed(5)},${p.latitude.toFixed(5)}`).join(';');

/**
 * Planned journey lines follow real roads. Each planned route (ZMCC, the shops in order, back to the ZMCC) is sent
 * to the server once for its road path and then kept, so opening the same map again asks for nothing.
 * Until the answer arrives, or when there is none, the straight line stays. The travelled GPS trail is never changed.
 */
export function useRoadRoutes(routes: LiveMapRoute[] | undefined): LiveMapRoute[] | undefined {
  const planned = useMemo(
    () => (routes ?? []).filter((r) => r.planned && r.points.length >= 2 && r.points.length <= MAX_ROUTE_POINTS),
    [routes]
  );

  const answers = useQueries({
    queries: planned.map((r) => ({
      queryKey: ['road-route', keyOf(r)],
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        fetchJson<RoadRouteAnswer>('/api/map/road-route', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ points: r.points.map((p) => ({ latitude: p.latitude, longitude: p.longitude })) }),
          signal,
        }),
      staleTime: Infinity,
      gcTime: 60 * 60_000,
      retry: 0,
      refetchOnWindowFocus: false,
    })),
  });

  // One string that changes only when a road path arrives, so the map is not redrawn on every render.
  const ready = answers.map((a) => (a.data?.route ? a.data.route.coordinates.length : 0)).join(',');

  return useMemo(() => {
    if (!routes) return routes;
    const byId = new Map<string, Array<[number, number]>>();
    planned.forEach((r, i) => {
      const path = answers[i]?.data?.route?.coordinates;
      if (path && path.length > 1) byId.set(r.id, path);
    });
    if (byId.size === 0) return routes;
    return routes.map((r) => {
      const path = byId.get(r.id);
      return path ? { ...r, points: path.map(([longitude, latitude]) => ({ latitude, longitude })) } : r;
    });
    // `ready` stands in for `answers`, which is a new array on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routes, planned, ready]);
}
