'use client';

import { useToast } from '@/frontend/context/ToastContext';
import { acquireRobustGps } from '@/lib/gps';
import { EMPTY_GPS, type GpsState } from './arrivalTypes';

/** GPS capture handler with progressive offline fallback. */
export function useGpsCapture(facilityCode?: string) {
  const toast = useToast();
  return async (setGps: (g: GpsState) => void) => {
    try {
      const res = await acquireRobustGps({ facilityCode, allowFacilityFallback: true, maxCacheAgeMs: 30_000 });
      if (res.location) {
        setGps({
          lat: Number(res.location.latitude.toFixed(7)),
          lng: Number(res.location.longitude.toFixed(7)),
          acc: res.location.accuracy != null ? Number(res.location.accuracy.toFixed(2)) : null,
        });
        if (res.status === 'FALLBACK') {
          toast.showInfo(`Using ${res.location.label || 'offline fallback'} coordinates.`);
        } else {
          toast.showSuccess('GPS coordinates captured successfully.');
        }
      } else {
        toast.showWarning(res.errorMsg || 'Failed to capture GPS. Arrival can proceed without GPS.');
        setGps(EMPTY_GPS);
      }
    } catch {
      toast.showWarning('GPS unavailable. Arrival can proceed without GPS.');
      setGps(EMPTY_GPS);
    }
  };
}
