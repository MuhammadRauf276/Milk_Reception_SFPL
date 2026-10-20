// Shop geofence check (pure). Distance by haversine; GPS accuracy gives the shop the benefit of the doubt (up to 50 m).
import type { GeofenceInput, GeofenceResult } from '@/types/stage1-decision';

export type { GeofenceInput, GeofenceResult } from '@/types/stage1-decision';

export const DEFAULT_SHOP_GEOFENCE_M = 100;
const EARTH_RADIUS_M = 6371000;
const MAX_ACCURACY_CREDIT_M = 50;
const WEAK_ACCURACY_M = 150;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function evaluateGeofence(i: GeofenceInput): GeofenceResult {
  const radiusM = i.radiusM !== null && i.radiusM > 0 ? i.radiusM : DEFAULT_SHOP_GEOFENCE_M;
  if (i.shopLat === null || i.shopLng === null || !Number.isFinite(i.shopLat) || !Number.isFinite(i.shopLng)) {
    return { status: 'NO_SHOP_GPS', distanceM: null, radiusM };
  }
  const distanceM = haversineMeters(i.shopLat, i.shopLng, i.lat, i.lng);
  const accuracy = i.accuracyM !== null && Number.isFinite(i.accuracyM) && i.accuracyM > 0 ? i.accuracyM : 0;
  if (distanceM - Math.min(accuracy, MAX_ACCURACY_CREDIT_M) > radiusM) {
    return { status: 'OUTSIDE', distanceM, radiusM };
  }
  if (accuracy > WEAK_ACCURACY_M || i.approximate) return { status: 'WEAK_GPS', distanceM, radiusM };
  return { status: 'INSIDE', distanceM, radiusM };
}
