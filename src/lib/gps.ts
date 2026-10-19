/**
 * Production-ready offline-first GPS strategy for SFPL Milk Reception.
 * Handles:
 * 1. Modern browser restriction: Geolocation is disabled on insecure contexts (HTTP LAN IPs like 10.168.254.155:3000).
 * 2. Offline / Weak GPS environments: Progressive multi-stage acquisition (Instant Cache -> High Accuracy Satellite -> Coarse Low Power).
 * 3. Offline storage & Persistence: Stores last known valid coordinates across page reloads & PWA sessions in localStorage.
 * 4. Fallback defaults: Provides known facility coordinates (Hasilpur, Jhang, Kabirwala) so operators in rural dead-zones or on laptops without GPS chips can never be blocked from dispatching or collecting milk.
 */

export interface GpsCoordinate {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  timestamp: number;
  source: 'LIVE_HIGH' | 'LIVE_COARSE' | 'DEVICE_CACHE' | 'OFFLINE_PERSISTED' | 'FACILITY_DEFAULT' | 'MANUAL';
  label?: string;
}

export interface GpsAcquisitionResult {
  location: GpsCoordinate | null;
  status: 'SUCCESS' | 'ERROR' | 'FALLBACK';
  errorMsg: string | null;
  isInsecureContext: boolean;
  isOffline: boolean;
}

export const KNOWN_FACILITY_COORDINATES: Record<
  string,
  { code: string; name: string; latitude: number; longitude: number }
> = {
  'ZMCC-HASILPUR': { code: 'ZMCC-HASILPUR', name: 'ZMCC Hasilpur', latitude: 29.6978, longitude: 72.5539 },
  'ZMCC-JHANG': { code: 'ZMCC-JHANG', name: 'ZMCC Jhang', latitude: 31.2698, longitude: 72.3169 },
  'ZMCC-KABIRWALA': { code: 'ZMCC-KABIRWALA', name: 'ZMCC Kabirwala', latitude: 30.4042, longitude: 71.8647 },
};

// Default fallback if no specific facility is matched (Hasilpur base)
export const DEFAULT_FALLBACK_COORDINATE: GpsCoordinate = {
  latitude: 29.6978,
  longitude: 72.5539,
  accuracy: 15,
  timestamp: Date.now(),
  source: 'FACILITY_DEFAULT',
  label: 'ZMCC Hasilpur (Default Center)',
};

export function getStoredLastKnownGps(): GpsCoordinate | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem('sfpl_last_known_gps');
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.latitude === 'number' && typeof parsed.longitude === 'number') {
      return parsed as GpsCoordinate;
    }
  } catch {
    // Ignore storage errors
  }
  return null;
}

export function saveStoredLastKnownGps(coord: GpsCoordinate): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem('sfpl_last_known_gps', JSON.stringify(coord));
  } catch {
    // Ignore storage quota errors
  }
}

/**
 * Checks if current window is in a secure context where navigator.geolocation is permitted.
 */
export function isBrowserGpsAllowed(): { allowed: boolean; reason?: string } {
  if (typeof window === 'undefined') return { allowed: false, reason: 'SSR' };
  if (!('geolocation' in navigator)) {
    return { allowed: false, reason: 'Geolocation is not supported by this browser.' };
  }
  if (window.isSecureContext === false) {
    return {
      allowed: false,
      reason: 'Browser blocks live GPS over HTTP (e.g. 10.168.254.155:3000). HTTPS or localhost is required.',
    };
  }
  return { allowed: true };
}

/**
 * Resolves a fallback coordinate based on facility code or saved location.
 */
export function getFacilityOrStoredFallback(facilityCode?: string | null): GpsCoordinate {
  const stored = getStoredLastKnownGps();
  if (stored) return stored;

  if (facilityCode) {
    const upper = facilityCode.toUpperCase();
    for (const [key, val] of Object.entries(KNOWN_FACILITY_COORDINATES)) {
      if (key === upper || upper.includes(key.replace('ZMCC-', ''))) {
        return {
          latitude: val.latitude,
          longitude: val.longitude,
          accuracy: 25,
          timestamp: Date.now(),
          source: 'FACILITY_DEFAULT',
          label: `${val.name} Coordinates`,
        };
      }
    }
  }
  return DEFAULT_FALLBACK_COORDINATE;
}

/**
 * Robust progressive GPS acquisition:
 * Stage 1: Quick device cache check (maximumAge: maxCacheAgeMs or 10 min, timeout: 2.5s)
 * Stage 2: High accuracy satellite request (timeout: 10s)
 * Stage 3: Coarse low-power fallback (timeout: 12s, maximumAge: maxCacheAgeMs or 15 min)
 * Stage 4: LocalStorage cached position from previous session
 * Stage 5: Facility default coordinates
 */
export async function acquireRobustGps(options?: {
  facilityCode?: string | null;
  allowFacilityFallback?: boolean;
  /**
   * Max age of a cached device position, in ms. Applies to stage 1 and stage 3
   * (and caps stage 2). Default keeps the old behaviour (10 min / 15 min).
   * Pass a small value (e.g. 30_000) when a fresh position is needed.
   */
  maxCacheAgeMs?: number;
}): Promise<GpsAcquisitionResult> {
  const isInsecure = typeof window !== 'undefined' && window.isSecureContext === false;
  const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;

  const maxCacheAge = options?.maxCacheAgeMs;
  const fallbackCoord = getFacilityOrStoredFallback(options?.facilityCode);

  const tryPosition = (posOptions: PositionOptions): Promise<GeolocationPosition> => {
    return new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, posOptions);
    });
  };

  if (typeof window === 'undefined' || !('geolocation' in navigator)) {
    return {
      location: options?.allowFacilityFallback ? fallbackCoord : null,
      status: options?.allowFacilityFallback ? 'FALLBACK' : 'ERROR',
      errorMsg: 'Geolocation is not supported by this browser.',
      isInsecureContext: isInsecure,
      isOffline,
    };
  }

  // If running in an insecure context (e.g. http://10.168.254.155:3000),
  // mobile browsers immediately block navigator.geolocation.
  // We still try in case flags/permissions allow it, but catch gracefully.
  // Stage 1: Try device cache (instant offline-compatible)
  try {
    const cachedPos = await tryPosition({
      enableHighAccuracy: false,
      maximumAge: maxCacheAge ?? 10 * 60 * 1000,
      timeout: 2500,
    });
    const result: GpsCoordinate = {
      latitude: Number(cachedPos.coords.latitude.toFixed(7)),
      longitude: Number(cachedPos.coords.longitude.toFixed(7)),
      accuracy: cachedPos.coords.accuracy ? Number(cachedPos.coords.accuracy.toFixed(1)) : null,
      timestamp: cachedPos.timestamp || Date.now(),
      source: 'DEVICE_CACHE',
      label: 'Device GPS Cache',
    };
    saveStoredLastKnownGps(result);
    return { location: result, status: 'SUCCESS', errorMsg: null, isInsecureContext: isInsecure, isOffline };
  } catch {
    // Continue
  }

  // Stage 2: Try High Accuracy (Satellite)
  try {
    const livePos = await tryPosition({
      enableHighAccuracy: true,
      maximumAge: Math.min(60 * 1000, maxCacheAge ?? 60 * 1000),
      timeout: 10000,
    });
    const result: GpsCoordinate = {
      latitude: Number(livePos.coords.latitude.toFixed(7)),
      longitude: Number(livePos.coords.longitude.toFixed(7)),
      accuracy: livePos.coords.accuracy ? Number(livePos.coords.accuracy.toFixed(1)) : null,
      timestamp: livePos.timestamp || Date.now(),
      source: 'LIVE_HIGH',
      label: 'Live High-Accuracy GPS',
    };
    saveStoredLastKnownGps(result);
    return { location: result, status: 'SUCCESS', errorMsg: null, isInsecureContext: isInsecure, isOffline };
  } catch (err) {
    const geoErr = err as GeolocationPositionError;
    if (geoErr && geoErr.code === 1) {
      // Permission denied or blocked by insecure HTTP origin
      let errorMsg = 'Location permission was denied. Please allow location in your browser settings.';
      if (isInsecure) {
        errorMsg = 'Browser restricts live GPS on HTTP (http://10.168.254.155). You can use offline fallback coordinates.';
      }
      return {
        location: options?.allowFacilityFallback ? fallbackCoord : null,
        status: options?.allowFacilityFallback ? 'FALLBACK' : 'ERROR',
        errorMsg,
        isInsecureContext: isInsecure,
        isOffline,
      };
    }
  }

  // Stage 3: Coarse low-power fallback (indoors / offline)
  try {
    const coarsePos = await tryPosition({
      enableHighAccuracy: false,
      maximumAge: maxCacheAge ?? 15 * 60 * 1000,
      timeout: 12000,
    });
    const result: GpsCoordinate = {
      latitude: Number(coarsePos.coords.latitude.toFixed(7)),
      longitude: Number(coarsePos.coords.longitude.toFixed(7)),
      accuracy: coarsePos.coords.accuracy ? Number(coarsePos.coords.accuracy.toFixed(1)) : null,
      timestamp: coarsePos.timestamp || Date.now(),
      source: 'LIVE_COARSE',
      label: 'Coarse GPS Fix',
    };
    saveStoredLastKnownGps(result);
    return { location: result, status: 'SUCCESS', errorMsg: null, isInsecureContext: isInsecure, isOffline };
  } catch {
    // Both live attempts failed
  }

  // Stage 4 & 5: Return fallback (Stored or Facility)
  if (options?.allowFacilityFallback) {
    const isStored = fallbackCoord.source === 'OFFLINE_PERSISTED' || fallbackCoord.source === 'DEVICE_CACHE';
    return {
      location: fallbackCoord,
      status: 'FALLBACK',
      errorMsg: isStored
        ? `Live GPS unavailable offline. Using last saved position (${new Date(fallbackCoord.timestamp).toLocaleTimeString()}).`
        : isInsecure
        ? 'Live GPS blocked on HTTP. Using facility coordinates fallback.'
        : 'Hardware GPS unavailable. Using ZMCC center coordinates.',
      isInsecureContext: isInsecure,
      isOffline,
    };
  }

  return {
    location: null,
    status: 'ERROR',
    errorMsg: isInsecure
      ? 'Live GPS blocked on HTTP (http://10.168.254.155). Enable offline fallback or use HTTPS.'
      : 'GPS signal could not be acquired (timeout/offline). Move outdoors or use facility fallback.',
    isInsecureContext: isInsecure,
    isOffline,
  };
}
