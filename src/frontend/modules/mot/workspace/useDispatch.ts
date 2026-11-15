'use client';

import { useState } from 'react';
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
  const { sources, effectiveZmccId, fallbackStation } = opts;
  const picked = sources.find((s) => s.id === effectiveZmccId) ?? null;
  const station: StationPosition | null = picked ?? fallbackStation ?? null;
  return {
    origin: station,
    originSet: station ? isValidPosition(station.latitude, station.longitude) : null,
  };
}
export type DispatchGps = ReturnType<typeof useDispatchGps>;
