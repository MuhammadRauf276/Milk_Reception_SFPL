/**
 * MOT Offline Storage & Sync Engine
 * Uses IndexedDB for reliable offline collection queuing, draft saving, and GPS buffering.
 * 
 * Rules:
 * - No auth tokens stored
 * - No CNIC stored
 * - Chronological GPS syncing (max 50 points per batch)
 * - FIFO Collection syncing with state lifecycle: DRAFT -> QUEUED -> SYNCING -> SYNCED / CONFLICT / FAILED_RETRYABLE
 */

export interface CachedJourney {
  id: string;
  journey_number: string;
  operational_date: string;
  status: string;
  zmcc?: { id: string; code: string; name: string };
  route?: { id: string; route_code: string; name: string };
  mot_profile?: { id: string; mot_code: string; name: string; phone_number: string };
  mot_vehicle?: { id: string; vehicle_number: string };
  stops: Array<{
    id: string;
    planned_sequence: number;
    status: 'PENDING' | 'VISITED';
    shop_code: string;
    shop_name: string;
    owner_name: string;
    phone_number: string;
    area_code: string;
    area_name: string;
    planned_latitude: number | null;
    planned_longitude: number | null;
    collection?: any;
  }>;
  cached_at: string;
}

export interface CollectionDraft {
  stop_id: string;
  quantity: string;
  unit: 'LITER' | 'KG';
  lr: string;
  fat: string;
  notes?: string;
  updated_at: string;
}

export interface QueuedCollection {
  client_event_id: string;
  journey_id: string;
  stop_id: string;
  quantity: number;
  unit: 'LITER' | 'KG';
  lr: number;
  fat: number;
  recorded_latitude?: number | null;
  recorded_longitude?: number | null;
  recorded_gps_accuracy?: number | null;
  notes?: string;
  offline_created_at: string;
  status: 'QUEUED' | 'SYNCING' | 'SYNCED' | 'CONFLICT' | 'FAILED_FATAL' | 'FAILED_RETRYABLE';
  last_error?: string;
  attempts?: number;
  synced_at?: string;
}

export interface QueuedGpsPoint {
  id?: number;
  client_location_id: string;
  journey_id: string;
  latitude: number;
  longitude: number;
  gps_accuracy?: number | null;
  device_recorded_at: string;
  synced: number; // 0 for false, 1 for true (IndexedDB boolean index friendly)
  attempts?: number;
}

const DB_NAME = 'milk_reception_mot_db';
const DB_VERSION = 2;

function isIndexedDbSupported(): boolean {
  return typeof window !== 'undefined' && typeof window.indexedDB !== 'undefined';
}

export function openMotDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!isIndexedDbSupported()) {
      return reject(new Error('IndexedDB is not supported in this environment.'));
    }

    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      if (!db.objectStoreNames.contains('active_journey')) {
        db.createObjectStore('active_journey', { keyPath: 'id' });
      }

      if (!db.objectStoreNames.contains('collection_drafts')) {
        db.createObjectStore('collection_drafts', { keyPath: 'stop_id' });
      }

      if (!db.objectStoreNames.contains('collection_queue')) {
        const store = db.createObjectStore('collection_queue', { keyPath: 'client_event_id' });
        store.createIndex('status', 'status', { unique: false });
        store.createIndex('journey_id', 'journey_id', { unique: false });
        store.createIndex('created_at', 'offline_created_at', { unique: false });
      }

      if (!db.objectStoreNames.contains('gps_queue')) {
        const store = db.createObjectStore('gps_queue', { keyPath: 'id', autoIncrement: true });
        store.createIndex('synced', 'synced', { unique: false });
        store.createIndex('device_recorded_at', 'device_recorded_at', { unique: false });
        store.createIndex('journey_id', 'journey_id', { unique: false });
        store.createIndex('client_location_id', 'client_location_id', { unique: false });
      } else {
        const tx = (event.target as IDBOpenDBRequest).transaction;
        const store = tx?.objectStore('gps_queue');
        if (store) {
          if (!store.indexNames.contains('journey_id')) {
            store.createIndex('journey_id', 'journey_id', { unique: false });
          }
          if (!store.indexNames.contains('client_location_id')) {
            store.createIndex('client_location_id', 'client_location_id', { unique: false });
          }
        }
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// -------------------------------------------------------------
// Journey Cache Operations
// -------------------------------------------------------------

export async function saveCachedJourney(journey: any): Promise<void> {
  if (!isIndexedDbSupported()) return;
  const db = await openMotDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('active_journey', 'readwrite');
    const store = tx.objectStore('active_journey');
    const cleanJourney: CachedJourney = {
      id: journey.id?.toString() || 'current',
      journey_number: journey.journey_number,
      operational_date: journey.operational_date,
      status: journey.status,
      zmcc: journey.zmcc,
      route: journey.route,
      mot_profile: journey.mot_profile,
      mot_vehicle: journey.mot_vehicle,
      stops: (journey.stops || []).map((s: any) => ({
        id: s.id?.toString(),
        planned_sequence: s.planned_sequence,
        status: s.status,
        shop_code: s.shop_code || s.shop?.shop_code || '',
        shop_name: s.shop_name || s.shop?.shop_name || '',
        owner_name: s.owner_name || s.shop?.owner_name || '',
        phone_number: s.phone_number || s.shop?.phone_number || '',
        area_code: s.area_code || s.shop?.area_code || '',
        area_name: s.area_name || s.shop?.area_name || '',
        planned_latitude: s.planned_latitude != null ? Number(s.planned_latitude) : null,
        planned_longitude: s.planned_longitude != null ? Number(s.planned_longitude) : null,
        collection: s.collection || null,
      })),
      cached_at: new Date().toISOString(),
    };
    const req = store.put(cleanJourney);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function getCachedJourney(): Promise<CachedJourney | null> {
  if (!isIndexedDbSupported()) return null;
  const db = await openMotDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('active_journey', 'readonly');
    const store = tx.objectStore('active_journey');
    const req = store.getAll();
    req.onsuccess = () => {
      const items = req.result;
      resolve(items && items.length > 0 ? items[0] : null);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function clearCachedJourney(): Promise<void> {
  if (!isIndexedDbSupported()) return;
  const db = await openMotDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('active_journey', 'readwrite');
    const store = tx.objectStore('active_journey');
    const req = store.clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// -------------------------------------------------------------
// Collection Draft Operations
// -------------------------------------------------------------

export async function saveDraft(stopId: string, draft: Omit<CollectionDraft, 'stop_id' | 'updated_at'>): Promise<void> {
  if (!isIndexedDbSupported()) return;
  const db = await openMotDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('collection_drafts', 'readwrite');
    const store = tx.objectStore('collection_drafts');
    const record: CollectionDraft = {
      stop_id: stopId,
      ...draft,
      updated_at: new Date().toISOString(),
    };
    const req = store.put(record);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function getDraft(stopId: string): Promise<CollectionDraft | null> {
  if (!isIndexedDbSupported()) return null;
  const db = await openMotDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('collection_drafts', 'readonly');
    const store = tx.objectStore('collection_drafts');
    const req = store.get(stopId);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteDraft(stopId: string): Promise<void> {
  if (!isIndexedDbSupported()) return;
  const db = await openMotDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('collection_drafts', 'readwrite');
    const store = tx.objectStore('collection_drafts');
    const req = store.delete(stopId);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// -------------------------------------------------------------
// Collection Queue Operations
// -------------------------------------------------------------

export async function queueCollection(
  item: Omit<QueuedCollection, 'status' | 'attempts'>
): Promise<QueuedCollection> {
  if (!isIndexedDbSupported()) throw new Error('Offline storage unavailable');
  const db = await openMotDb();
  const queuedItem: QueuedCollection = {
    ...item,
    status: 'QUEUED',
    attempts: 0,
  };

  return new Promise((resolve, reject) => {
    const tx = db.transaction(['collection_queue', 'collection_drafts'], 'readwrite');
    const queueStore = tx.objectStore('collection_queue');
    const draftStore = tx.objectStore('collection_drafts');

    queueStore.put(queuedItem);
    draftStore.delete(item.stop_id);

    tx.oncomplete = () => resolve(queuedItem);
    tx.onerror = () => reject(tx.error);
  });
}

export async function getQueuedCollections(): Promise<QueuedCollection[]> {
  if (!isIndexedDbSupported()) return [];
  const db = await openMotDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('collection_queue', 'readonly');
    const store = tx.objectStore('collection_queue');
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export async function updateCollectionQueueStatus(
  clientEventId: string,
  status: QueuedCollection['status'],
  errorMsg?: string
): Promise<void> {
  if (!isIndexedDbSupported()) return;
  const db = await openMotDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('collection_queue', 'readwrite');
    const store = tx.objectStore('collection_queue');
    const req = store.get(clientEventId);
    req.onsuccess = () => {
      const item: QueuedCollection = req.result;
      if (item) {
        item.status = status;
        if (errorMsg) item.last_error = errorMsg;
        if (status === 'SYNCED') item.synced_at = new Date().toISOString();
        item.attempts = (item.attempts || 0) + 1;
        store.put(item);
      }
      resolve();
    };
    req.onerror = () => reject(req.error);
  });
}

// -------------------------------------------------------------
// GPS Queue Operations
// -------------------------------------------------------------

export async function queueGpsLocation(location: {
  journey_id: string | number | bigint;
  client_location_id?: string;
  latitude: number;
  longitude: number;
  gps_accuracy?: number | null;
  device_recorded_at?: string;
}): Promise<string> {
  if (!isIndexedDbSupported()) return '';
  const db = await openMotDb();
  const clientLocationId =
    (location.client_location_id || '').trim() ||
    (typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `loc-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`);

  return new Promise((resolve, reject) => {
    const tx = db.transaction('gps_queue', 'readwrite');
    const store = tx.objectStore('gps_queue');
    const point: QueuedGpsPoint = {
      client_location_id: clientLocationId,
      journey_id: String(location.journey_id),
      latitude: location.latitude,
      longitude: location.longitude,
      gps_accuracy: location.gps_accuracy != null ? location.gps_accuracy : null,
      device_recorded_at: location.device_recorded_at || new Date().toISOString(),
      synced: 0,
      attempts: 0,
    };
    const req = store.add(point);
    req.onsuccess = () => resolve(clientLocationId);
    req.onerror = () => reject(req.error);
  });
}

export async function getUnsyncedGpsPoints(limit = 50): Promise<QueuedGpsPoint[]> {
  if (!isIndexedDbSupported()) return [];
  const db = await openMotDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('gps_queue', 'readonly');
    const store = tx.objectStore('gps_queue');
    const index = store.index('synced');
    const req = index.getAll(IDBKeyRange.only(0));
    req.onsuccess = () => {
      const points: QueuedGpsPoint[] = req.result || [];
      points.sort(
        (a, b) =>
          new Date(a.device_recorded_at).getTime() - new Date(b.device_recorded_at).getTime()
      );
      resolve(points.slice(0, limit));
    };
    req.onerror = () => reject(req.error);
  });
}

export async function markGpsPointsSynced(ids: number[]): Promise<void> {
  if (!isIndexedDbSupported() || ids.length === 0) return;
  const db = await openMotDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('gps_queue', 'readwrite');
    const store = tx.objectStore('gps_queue');
    let completed = 0;
    for (const id of ids) {
      const req = store.get(id);
      req.onsuccess = () => {
        if (req.result) {
          req.result.synced = 1;
          store.put(req.result);
        }
        completed++;
        if (completed === ids.length) resolve();
      };
      req.onerror = () => reject(req.error);
    }
  });
}

// -------------------------------------------------------------
// Unsynced Counts & Aggregates
// -------------------------------------------------------------

export async function getUnsyncedSummary(): Promise<{
  pendingCollections: number;
  conflictCollections: number;
  pendingGps: number;
  totalUnsynced: number;
}> {
  if (!isIndexedDbSupported()) {
    return { pendingCollections: 0, conflictCollections: 0, pendingGps: 0, totalUnsynced: 0 };
  }

  const collections = await getQueuedCollections();
  const pendingColl = collections.filter(
    (c) => c.status === 'QUEUED' || c.status === 'FAILED_RETRYABLE' || c.status === 'SYNCING'
  ).length;
  const conflictColl = collections.filter((c) => c.status === 'CONFLICT').length;

  const db = await openMotDb();
  const pendingGpsCount = await new Promise<number>((resolve) => {
    const tx = db.transaction('gps_queue', 'readonly');
    const store = tx.objectStore('gps_queue');
    const index = store.index('synced');
    const req = index.count(IDBKeyRange.only(0));
    req.onsuccess = () => resolve(req.result || 0);
    req.onerror = () => resolve(0);
  });

  return {
    pendingCollections: pendingColl,
    conflictCollections: conflictColl,
    pendingGps: pendingGpsCount,
    totalUnsynced: pendingColl + pendingGpsCount,
  };
}

// -------------------------------------------------------------
// Sync Engine Execution
// -------------------------------------------------------------

export async function syncPendingCollections(): Promise<{
  synced: number;
  conflicts: number;
  failed: number;
}> {
  const all = await getQueuedCollections();
  const toSync = all.filter(
    (c) => c.status === 'QUEUED' || c.status === 'FAILED_RETRYABLE'
  );

  let synced = 0;
  let conflicts = 0;
  let failed = 0;

  for (const item of toSync) {
    await updateCollectionQueueStatus(item.client_event_id, 'SYNCING');
    try {
      const res = await fetch('/api/mot/journeys/current/collections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_event_id: item.client_event_id,
          journey_id: item.journey_id,
          stop_id: item.stop_id,
          quantity: item.quantity,
          unit: item.unit,
          lr: item.lr,
          fat: item.fat,
          recorded_latitude: item.recorded_latitude,
          recorded_longitude: item.recorded_longitude,
          recorded_gps_accuracy: item.recorded_gps_accuracy,
          notes: item.notes,
          collection_notes: item.notes,
          offline_created_at: item.offline_created_at,
        }),
      });

      if (res.ok) {
        await updateCollectionQueueStatus(item.client_event_id, 'SYNCED');
        synced++;
      } else if (res.status === 409) {
        const errJson = await res.json().catch(() => ({}));
        await updateCollectionQueueStatus(
          item.client_event_id,
          'CONFLICT',
          errJson.error || 'Conflict detected upon sync'
        );
        conflicts++;
      } else if (res.status >= 400 && res.status < 500) {
        const errJson = await res.json().catch(() => ({}));
        await updateCollectionQueueStatus(
          item.client_event_id,
          'FAILED_FATAL',
          errJson.error || `Client error (${res.status})`
        );
        failed++;
      } else {
        await updateCollectionQueueStatus(
          item.client_event_id,
          'FAILED_RETRYABLE',
          `Server error (${res.status})`
        );
        failed++;
      }
    } catch (err: any) {
      await updateCollectionQueueStatus(
        item.client_event_id,
        'FAILED_RETRYABLE',
        err.message || 'Network unreachable'
      );
      failed++;
    }
  }

  return { synced, conflicts, failed };
}

export async function syncPendingGps(): Promise<{ synced: number; failed: number }> {
  let totalSynced = 0;
  let totalFailed = 0;

  // Drain in batches of 50 points, grouped by journey_id
  while (true) {
    const points = await getUnsyncedGpsPoints(50);
    if (points.length === 0) break;

    const byJourney = new Map<string, QueuedGpsPoint[]>();
    for (const p of points) {
      const jId = String(p.journey_id || '');
      if (!byJourney.has(jId)) byJourney.set(jId, []);
      byJourney.get(jId)!.push(p);
    }

    let hadBatchFailure = false;

    for (const [journeyId, journeyPoints] of Array.from(byJourney.entries())) {
      try {
        const res = await fetch('/api/mot/journeys/current/locations/batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            journey_id: journeyId,
            locations: journeyPoints.map((p: QueuedGpsPoint) => ({
              client_location_id: p.client_location_id,
              journey_id: p.journey_id,
              latitude: p.latitude,
              longitude: p.longitude,
              gps_accuracy: p.gps_accuracy,
              device_recorded_at: p.device_recorded_at,
            })),
          }),
        });

        if (res.ok) {
          const data = await res.json().catch(() => ({}));
          const confirmedLocationIds = new Set<string>();
          if (Array.isArray(data.items)) {
            for (const item of data.items) {
              if (item.status === 'ACCEPTED' || item.status === 'ALREADY_PROCESSED') {
                confirmedLocationIds.add(item.client_location_id);
              }
            }
          }

          const idsToMark = journeyPoints
            .filter((p: QueuedGpsPoint) => confirmedLocationIds.has(p.client_location_id) && typeof p.id === 'number')
            .map((p: QueuedGpsPoint) => p.id!);

          if (idsToMark.length > 0) {
            await markGpsPointsSynced(idsToMark);
            totalSynced += idsToMark.length;
          }

          const unconfirmedCount = journeyPoints.length - idsToMark.length;
          if (unconfirmedCount > 0) {
            totalFailed += unconfirmedCount;
          }
        } else {
          totalFailed += journeyPoints.length;
          hadBatchFailure = true;
          break;
        }
      } catch {
        totalFailed += journeyPoints.length;
        hadBatchFailure = true;
        break;
      }
    }

    if (hadBatchFailure) {
      break;
    }
  }

  return { synced: totalSynced, failed: totalFailed };
}

export async function syncAll(): Promise<{
  collections: { synced: number; conflicts: number; failed: number };
  gps: { synced: number; failed: number };
}> {
  const collRes = await syncPendingCollections();
  const gpsRes = await syncPendingGps();
  return { collections: collRes, gps: gpsRes };
}
