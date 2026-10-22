'use client';

import { useCallback, useEffect, useState } from 'react';
import { acquireRobustGps } from '@/lib/gps';
import type { ZmccSource } from './types';

export interface GpsLocation {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  source?: string;
}

type GpsStatus = 'IDLE' | 'ACQUIRING' | 'SUCCESS' | 'FALLBACK' | 'ERROR';

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

/** GPS acquisition with progressive offline fallback; starts automatically while the Dispatch tab is open. */
export function useDispatchGps(opts: {
  sources: ZmccSource[];
  effectiveZmccId: string | null;
  fallbackFacilityCode?: string;
  dispatchTabActive: boolean;
}) {
  const { sources, effectiveZmccId, fallbackFacilityCode, dispatchTabActive } = opts;
  const [gpsLocation, setGpsLocation] = useState<GpsLocation | null>(null);
  const [gpsStatus, setGpsStatus] = useState<GpsStatus>('IDLE');
  const [gpsErrorMsg, setGpsErrorMsg] = useState('');

  const requestGpsPosition = useCallback(
    async (allowFallback = false) => {
      setGpsStatus('ACQUIRING');
      setGpsErrorMsg('');

      const selectedSource = sources.find((s) => s.id === effectiveZmccId);
      const facilityCode = selectedSource?.code || fallbackFacilityCode;

      const res = await acquireRobustGps({
        facilityCode,
        allowFacilityFallback: allowFallback || (typeof window !== 'undefined' && window.isSecureContext === false),
        maxCacheAgeMs: 30_000,
      });

      if (res.location) {
        setGpsLocation({
          latitude: res.location.latitude,
          longitude: res.location.longitude,
          accuracy: res.location.accuracy,
          source: res.location.source,
        });
        setGpsStatus(res.status === 'FALLBACK' ? 'FALLBACK' : 'SUCCESS');
        if (res.errorMsg) {
          setGpsErrorMsg(res.errorMsg);
        }
      } else {
        setGpsStatus('ERROR');
        setGpsErrorMsg(res.errorMsg || 'Failed to obtain GPS coordinates.');
      }
    },
    [sources, effectiveZmccId, fallbackFacilityCode]
  );

  // Opening the Dispatch tab starts acquisition automatically, so it counts as acquiring.
  const autoAcquiringGps = dispatchTabActive && gpsStatus === 'IDLE';
  const displayedGpsStatus: GpsStatus = autoAcquiringGps ? 'ACQUIRING' : gpsStatus;

  useEffect(() => {
    if (autoAcquiringGps) {
      requestGpsPosition(true);
    }
  }, [autoAcquiringGps, requestGpsPosition]);

  return {
    gpsLocation,
    displayedGpsStatus,
    displayedGpsErrorMsg: gpsErrorMsg,
    acquireGps: () => {
      requestGpsPosition(false);
    },
    requestGpsPosition,
  };
}
export type DispatchGps = ReturnType<typeof useDispatchGps>;
