'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchJson } from '@/lib/query/fetchJson';
import type { StationPosition } from '@/lib/gps';
import { isValidPosition } from '@/lib/coordinates';
import type { ZmccSource } from './types';

/** Dispatch form fields. Lives in the workspace so values survive tab switches. */
export function useDispatchForm() {
  const [routeId, setRouteId] = useState('');
  const [profileId, setProfileId] = useState('');
  const [vehicleId, setVehicleId] = useState('');
  const reset = () => {
    setRouteId('');
    setProfileId('');
    setVehicleId('');
  };
  return {
    routeId, setRouteId, profileId, setProfileId, vehicleId, setVehicleId,
    reset,
  };
}
export type DispatchForm = ReturnType<typeof useDispatchForm>;

/**
 * Where a new journey starts from: always the ZMCC it belongs to. The person assigning it is not asked for
 * their own location any more. Null when this screen does not know the ZMCC (the server still checks).
 */
export function useDispatchGps(opts: {
  sources: ZmccSource[];
  effectiveZmccId: string | null;
  /** The signed-in person's own ZMCC, used when none is picked. */
  fallbackStation?: StationPosition | null;
  dispatchTabActive: boolean;
}) {
  const { sources, effectiveZmccId, fallbackStation, dispatchTabActive } = opts;
  // Read the ZMCC's location fresh from the server while dispatching, so a location the Super Admin just added
  // counts at once (a list loaded earlier, or the signed-in user's own record, can be minutes old).
  const fresh = useQuery({
    queryKey: ['dispatch', 'zmcc-location'],
    queryFn: ({ signal }) => fetchJson<{ zmccs?: ZmccSource[] }>('/api/zmcc/sources', { signal }),
    enabled: dispatchTabActive,
    staleTime: 30_000,
  });
  const freshList = fresh.data?.zmccs ?? [];
  const ownId = fallbackStation && 'id' in fallbackStation ? String((fallbackStation as { id?: unknown }).id ?? '') : '';
  const targetId = effectiveZmccId ?? (freshList.length === 1 ? freshList[0].id : ownId || null);
  const picked =
    freshList.find((s) => s.id === targetId) ?? sources.find((s) => s.id === targetId) ?? null;
  // The user's own ZMCC only stands in when it is the ZMCC being dispatched.
  const own = fallbackStation && (!targetId || ownId === targetId) ? fallbackStation : null;
  const station: StationPosition | null = picked ?? own ?? null;
  return {
    origin: station,
    originSet: station ? isValidPosition(station.latitude, station.longitude) : null,
  };
}
export type DispatchGps = ReturnType<typeof useDispatchGps>;
