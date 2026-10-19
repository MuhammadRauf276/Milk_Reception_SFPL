/**
 * Pure helpers for MOT route tracking.
 * Decides whether a GPS fix is good enough and different enough to be saved.
 */

export interface TrackedPoint {
  latitude: number;
  longitude: number;
  /** Accuracy in metres. */
  accuracy: number;
  /** Fix time in ms (GeolocationPosition.timestamp), NOT the time we saved it. */
  timestamp: number;
  speed?: number | null;
  heading?: number | null;
}

export interface TrackingConfig {
  /** Drop fixes with accuracy worse than this (metres). */
  maxAccuracyM: number;
  /** Drop fixes older than this (ms). */
  maxFixAgeMs: number;
  /** Record when moved at least this far (metres). */
  minDistanceM: number;
  /** Record when this much time passed since the last saved point (ms), even if standing still. */
  heartbeatMs: number;
}

export const DEFAULT_TRACKING_CONFIG: TrackingConfig = {
  maxAccuracyM: 50,
  maxFixAgeMs: 30_000,
  minDistanceM: 25,
  heartbeatMs: 120_000,
};

export function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * @param prev last point that was SAVED (null if none yet)
 * @param next new fix from the GPS
 * @param now current time in ms
 */
export function shouldRecordPoint(
  prev: TrackedPoint | null,
  next: TrackedPoint,
  now: number,
  cfg: TrackingConfig = DEFAULT_TRACKING_CONFIG,
): { record: boolean; reason: string } {
  if (!Number.isFinite(next.accuracy) || next.accuracy > cfg.maxAccuracyM) {
    return { record: false, reason: 'low-accuracy' };
  }
  if (now - next.timestamp > cfg.maxFixAgeMs) {
    return { record: false, reason: 'stale' };
  }
  if (!prev) {
    return { record: true, reason: 'first-point' };
  }
  const dist = haversineMeters(prev.latitude, prev.longitude, next.latitude, next.longitude);
  if (dist >= cfg.minDistanceM) {
    return { record: true, reason: 'moved' };
  }
  if (next.timestamp - prev.timestamp >= cfg.heartbeatMs) {
    return { record: true, reason: 'heartbeat' };
  }
  return { record: false, reason: 'no-change' };
}

/** Simple text for the GPS badge, e.g. "Live", "1 min ago", "5 min ago". */
export function getFixAgeLabel(ageMs: number): string {
  const age = Math.max(0, ageMs);
  if (age < 60_000) return 'Live';
  const mins = Math.floor(age / 60_000);
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs} hr ago`;
}
