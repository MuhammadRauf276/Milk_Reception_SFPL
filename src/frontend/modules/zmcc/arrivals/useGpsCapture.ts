'use client';

import { useCallback, useEffect, useState } from 'react';
import { acquireRobustGps, DEFAULT_FALLBACK_COORDINATE, saveStoredLastKnownGps } from '@/lib/gps';
import { EMPTY_GPS, type GpsState } from './arrivalTypes';

/** LIVE: this phone's GPS. APPROXIMATE: last saved or ZMCC position, labelled on screen. NONE: nothing to save. */
export type AutoGpsStatus = 'ACQUIRING' | 'LIVE' | 'APPROXIMATE' | 'NONE';

const toGpsState = (latitude: number, longitude: number, accuracy: number | null): GpsState => ({
  lat: Number(latitude.toFixed(7)),
  lng: Number(longitude.toFixed(7)),
  acc: accuracy != null ? Number(accuracy.toFixed(2)) : null,
});

/**
 * Saves the location into the form by itself while the form is open, with no button. Phone GPS needs no internet, so
 * this works offline, and the location goes with the arrival when it is queued. A live fix always replaces an estimate.
 */
export function useAutoGps(open: boolean, setGps: (g: GpsState) => void, facilityCode?: string) {
  const [status, setStatus] = useState<AutoGpsStatus>('ACQUIRING');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    let live = false;
    setStatus('ACQUIRING');

    void acquireRobustGps({ facilityCode, allowFacilityFallback: true, maxCacheAgeMs: 30_000 })
      .then((res) => {
        if (cancelled || live) return;
        // The general default is one ZMCC's position: wrong anywhere else, so it is never saved.
        if (!res.location || res.location === DEFAULT_FALLBACK_COORDINATE) {
          setGps(EMPTY_GPS);
          setStatus('NONE');
          return;
        }
        setGps(toGpsState(res.location.latitude, res.location.longitude, res.location.accuracy));
        setStatus(res.status === 'SUCCESS' ? 'LIVE' : 'APPROXIMATE');
      })
      .catch(() => {
        if (!cancelled && !live) setStatus('NONE');
      });

    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      return () => {
        cancelled = true;
      };
    }
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        if (cancelled) return;
        live = true;
        const accuracy = pos.coords.accuracy ?? null;
        setGps(toGpsState(pos.coords.latitude, pos.coords.longitude, accuracy));
        setStatus('LIVE');
        saveStoredLastKnownGps({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy,
          timestamp: pos.timestamp || Date.now(),
          source: 'LIVE_HIGH',
          label: 'Live High-Accuracy GPS',
        });
      },
      () => {
        // No signal yet: the estimate above stays, and the next fix replaces it.
      },
      { enableHighAccuracy: true, maximumAge: 30_000, timeout: 20_000 }
    );
    return () => {
      cancelled = true;
      navigator.geolocation.clearWatch(watchId);
    };
  }, [open, facilityCode, setGps, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { status, retry };
}
