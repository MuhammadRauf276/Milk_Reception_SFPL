import {
  saveCachedJourney,
  getCachedJourney,
  type CachedJourney,
  saveMotOfflinePreparation,
  getMotOfflinePreparation,
  cacheAvailableSources,
  cacheMotShopPolicy,
} from '../offlineStore';
import { getActiveOwnerUserId } from '@/frontend/modules/pwa/deviceIdentity';
import { getErrorMessage } from '@/lib/errors';
import { COVER_HEADERS, type CurrentJourney } from './types';

/** Offline cache -> page model. Assignment metadata is not cached (and not rendered). */
function toCurrentJourney(cached: CachedJourney): CurrentJourney {
  return {
    id: cached.id,
    journey_number: cached.journey_number,
    operational_date: cached.operational_date,
    status: cached.status,
    zmcc: cached.zmcc ?? null,
    route: cached.route ?? null,
    mot_vehicle: cached.mot_vehicle ?? null,
    assigned_by_name: null,
    assigned_at: cached.cached_at,
    stops: cached.stops.map((stop) => ({
      ...stop,
      collection: stop.collection ?? null,
      planned_latitude_snapshot: stop.planned_latitude_snapshot ?? stop.planned_latitude ?? null,
      planned_longitude_snapshot: stop.planned_longitude_snapshot ?? stop.planned_longitude ?? null,
      skipped_at: stop.skipped_at ?? null,
      skip_reason: stop.skip_reason ?? null,
    })),
  };
}

/** A usable offline copy of the journey: cached, prepared for it, and not expired. */
async function getPreparedCachedJourney(): Promise<CurrentJourney | null> {
  const cached = await getCachedJourney();
  const preparation = await getMotOfflinePreparation();
  if (cached && preparation && preparation.journeyId === cached.id && new Date(preparation.expiresAt).getTime() > Date.now()) {
    const activeOwner = getActiveOwnerUserId();
    if (activeOwner && preparation.userId && String(preparation.userId) !== String(activeOwner)) {
      return null;
    }
    return toCurrentJourney(cached);
  }
  return null;
}

/**
 * Loads the MOT's current journey online (refreshing the offline cache) or from the offline cache.
 * `journey: undefined` means "keep whatever is shown"; `error` is the message to display, if any.
 */
export async function resolveCurrentJourney(
  cover?: { journeyId: string | null }
): Promise<{ journey?: CurrentJourney | null; error: string | null }> {
  // A superior covering MOT work: online only, the chosen journey, nothing cached.
  if (cover) {
    if (!cover.journeyId) return { journey: null, error: null };
    try {
      const res = await fetch(`/api/zmcc/mot/journeys/current?journeyId=${encodeURIComponent(cover.journeyId)}`, {
        headers: COVER_HEADERS,
      });
      const data = await res.json();
      if (!res.ok) return { journey: null, error: data.error || 'Could not open this journey.' };
      return { journey: data.journey ?? null, error: data.journey ? null : data.message || null };
    } catch (err) {
      return { journey: null, error: getErrorMessage(err) || 'You must be online to cover MOT work.' };
    }
  }
  // Shown even if caching it for offline use fails below.
  let onlineJourney: CurrentJourney | undefined;
  try {
    if (navigator.onLine) {
      const res = await fetch('/api/zmcc/mot/journeys/current');
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to fetch current journey.');
      }
      if (!data.journey) return { journey: null, error: null };
      onlineJourney = data.journey;
      await saveCachedJourney(data.journey);
      if (data.journey.status === 'COLLECTING' || data.journey.status === 'RETURNING') {
        const preparation = await fetch('/api/zmcc/mot/journeys/current/offline-preparation', { method: 'POST' });
        if (preparation.ok) await saveMotOfflinePreparation(await preparation.json());

        // Eagerly pre-cache shop policy and available sources for offline collection readiness
        try {
          const zmccId = data.journey.zmcc?.id;
          const [policyRes, sourcesRes] = await Promise.all([
            fetch('/api/zmcc/mot/shop-policy'),
            zmccId ? fetch(`/api/sources/available?zmcc_id=${encodeURIComponent(zmccId)}`) : Promise.resolve(null),
          ]);
          if (policyRes && policyRes.ok) {
            const policy = await policyRes.json();
            await cacheMotShopPolicy(policy);
          }
          if (sourcesRes && sourcesRes.ok) {
            const sourcesData = await sourcesRes.json();
            if (sourcesData.sources && Array.isArray(sourcesData.sources)) {
              await cacheAvailableSources(sourcesData.sources);
            }
          }
        } catch {
          // Non-fatal eager pre-cache failure
        }
      }
      return { journey: data.journey, error: null };
    }
    // Load from offline store
    const prepared = await getPreparedCachedJourney();
    return prepared
      ? { journey: prepared, error: null }
      : { journey: null, error: 'Offline preparation is missing or expired. Reconnect and prepare the active journey again.' };
  } catch (err) {
    // Fallback to cache on error
    try {
      const prepared = await getPreparedCachedJourney();
      return prepared
        ? { journey: prepared, error: null }
        : { journey: onlineJourney, error: getErrorMessage(err) || 'Unable to connect and no cached journey available.' };
    } catch {
      return { journey: onlineJourney, error: getErrorMessage(err) || 'Failed to load journey.' };
    }
  }
}
