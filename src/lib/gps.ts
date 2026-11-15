/**
 * Production-ready offline-first GPS strategy for SFPL Milk Reception.
 * Handles:
 * 1. Modern browser restriction: Geolocation is disabled on insecure contexts (plain HTTP addresses on the local network).
 * 2. Offline / weak GPS: the GPS chip only (a recent GPS reading, then a fresh one). The mobile network is never used for position.
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
  'ZMCC-HASILPUR': { code: 'ZMCC-HASILPUR', name: 'ZMCC Hasilpur', latitude: 29.6974, longitude: 72.5539 },
  'ZMCC-JHANG': { code: 'ZMCC-JHANG', name: 'ZMCC Jhang', latitude: 31.2698, longitude: 72.3169 },
  'ZMCC-KABIRWALA': { code: 'ZMCC-KABIRWALA', name: 'ZMCC Kabirwala', latitude: 30.4042, longitude: 71.8647 },
};

// Default fallback if no specific facility is matched (Hasilpur base)
export const DEFAULT_FALLBACK_COORDINATE: GpsCoordinate = {
  latitude: 29.6974,
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
      reason: 'The browser blocks GPS on a plain HTTP address. HTTPS is required.',
    };
  }
  return { allowed: true };
}

/**
 * Resolves a fallback coordinate based on facility code or saved location.
 */
export function getFacilityOrStoredFallback(facilityCode?: string | null): GpsCoordinate | null {
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
  // No match: there is no honest position to give. (It used to answer with one ZMCC's coordinates for everyone.)
  return null;
}

/**
 * GPS acquisition. Every request asks for the GPS chip (enableHighAccuracy), never the low-power
 * mobile-network or Wi-Fi position: the GPS chip works with no signal and no internet.
 * Stage 1: A GPS reading the phone already has (maximumAge: maxCacheAgeMs or 30 s, timeout: 2.5s)
 * Stage 2: A fresh GPS reading (timeout: 10s)
 * Stage 3: Position saved on this device from an earlier reading (only when the caller allows a fallback)
 * Stage 4: Facility coordinates (only when the caller allows a fallback)
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

  // If running in an insecure context (a plain HTTP address),
  // mobile browsers immediately block navigator.geolocation.
  // We still try in case flags/permissions allow it, but catch gracefully.
  // Stage 1: Try device cache (instant offline-compatible)
  try {
    const cachedPos = await tryPosition({
      enableHighAccuracy: true,
      maximumAge: maxCacheAge ?? 30 * 1000,
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
      let errorMsg = 'Location is blocked.';
      if (isInsecure) {
        errorMsg = 'The browser blocks GPS on a plain HTTP address.';
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

  // Stage 3 & 4: Return fallback (Stored or Facility)
  if (options?.allowFacilityFallback) {
    if (!fallbackCoord) {
      return { location: null, status: 'ERROR', errorMsg: 'GPS signal could not be acquired. Move outdoors and try again.', isInsecureContext: isInsecure, isOffline };
    }
    const isStored = fallbackCoord.source !== 'FACILITY_DEFAULT';
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
      ? 'The browser blocks GPS on a plain HTTP address. HTTPS is required.'
      : 'GPS signal could not be acquired (timeout/offline). Move outdoors or use facility fallback.',
    isInsecureContext: isInsecure,
    isOffline,
  };
}
