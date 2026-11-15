// A place on the map as latitude and longitude. Pure: safe in the browser, on the server and in tests.

export interface MapPosition {
  latitude: number;
  longitude: number;
}

/** A real latitude and longitude. (0, 0) is in the sea off Africa and is always a missing value here. */
export function isValidPosition(latitude: unknown, longitude: unknown): boolean {
  const lat = typeof latitude === 'number' ? latitude : Number.NaN;
  const lng = typeof longitude === 'number' ? longitude : Number.NaN;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return false;
  return !(lat === 0 && lng === 0);
}

/**
 * Reads a position typed or pasted by a person: "29.6974, 72.5539" (the form Google Maps copies),
 * or the same with a space. Returns null when it is not a real position.
 */
export function parsePositionText(text: string | null | undefined): MapPosition | null {
  const parts = (text ?? '').trim().split(/[\s,;]+/).filter(Boolean);
  if (parts.length !== 2) return null;
  const latitude = Number(parts[0]);
  const longitude = Number(parts[1]);
  return isValidPosition(latitude, longitude) ? { latitude: round7(latitude), longitude: round7(longitude) } : null;
}

/** A position as "29.6974, 72.5539", or an empty string when there is none. */
export function formatPosition(p: { latitude?: number | null; longitude?: number | null } | null | undefined): string {
  if (!p || p.latitude == null || p.longitude == null) return '';
  return `${trim7(p.latitude)}, ${trim7(p.longitude)}`;
}

/** A stored position (numbers, strings or database decimals) as numbers, or null when either part is missing. */
export function toPosition(latitude: unknown, longitude: unknown): MapPosition | null {
  if (latitude == null || longitude == null) return null;
  const lat = Number(latitude);
  const lng = Number(longitude);
  return isValidPosition(lat, lng) ? { latitude: lat, longitude: lng } : null;
}

/**
 * The location part of a save request. `undefined` = not sent (leave as it is), `null` = clear it,
 * a position = set it. Latitude and longitude must come together.
 */
export function readPositionInput(
  latitude: unknown,
  longitude: unknown
): { ok: true; value: MapPosition | null | undefined } | { ok: false; error: string } {
  if (latitude === undefined && longitude === undefined) return { ok: true, value: undefined };
  if (latitude === null && longitude === null) return { ok: true, value: null };
  if (latitude == null || longitude == null) return { ok: false, error: 'Latitude and longitude must be given together.' };
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!isValidPosition(lat, lng)) {
    return { ok: false, error: 'Location is not valid. Latitude is between -90 and 90, longitude between -180 and 180.' };
  }
  return { ok: true, value: { latitude: round7(lat), longitude: round7(lng) } };
}

function round7(n: number): number {
  return Math.round(n * 1e7) / 1e7;
}

function trim7(n: number): string {
  return String(round7(n));
}
