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
  sync_started_at?: string | null;
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
  status?: 'QUEUED' | 'SYNCED' | 'CONFLICT' | 'FAILED_FATAL' | 'FAILED_RETRYABLE';
  attempts?: number;
  last_error?: string | null;
}

const DB_NAME = 'milk_reception_mot_db';
const DB_VERSION = 3;

function isIndexedDbSupported(): boolean {
  const idb = typeof window !== 'undefined' ? window.indexedDB : typeof globalThis !== 'undefined' ? globalThis.indexedDB : undefined;
  return typeof idb !== 'undefined';
}

function getIdb(): IDBFactory {
  return typeof window !== 'undefined' ? window.indexedDB : (globalThis as any).indexedDB;
}

export function openMotDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!isIndexedDbSupported()) {
      return reject(new Error('IndexedDB is not supported in this environment.'));
    }

    const request = getIdb().open(DB_NAME, DB_VERSION);

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
        store.createIndex('status', 'status', { unique: false });
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
          if (!store.indexNames.contains('status')) {
            store.createIndex('status', 'status', { unique: false });
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

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Transaction failed'));
    tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));

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
    store.put(cleanJourney);
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

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Transaction failed'));
    tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));

    store.clear();
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

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Transaction failed'));
    tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));

    const record: CollectionDraft = {
      stop_id: stopId,
      ...draft,
      updated_at: new Date().toISOString(),
    };
    store.put(record);
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

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Transaction failed'));
    tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));

    store.delete(stopId);
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
    sync_started_at: null,
  };

  return new Promise((resolve, reject) => {
    const tx = db.transaction(['collection_queue', 'collection_drafts'], 'readwrite');
    const queueStore = tx.objectStore('collection_queue');
    const draftStore = tx.objectStore('collection_drafts');

    queueStore.put(queuedItem);
    draftStore.delete(item.stop_id);

    tx.oncomplete = () => resolve(queuedItem);
    tx.onerror = () => reject(tx.error || new Error('Transaction failed'));
    tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
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

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Transaction failed'));
    tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));

    const req = store.get(clientEventId);
    req.onsuccess = () => {
      const item: QueuedCollection = req.result;
      if (item) {
        item.status = status;
        if (status === 'SYNCING') {
          item.sync_started_at = new Date().toISOString();
        } else if (status === 'SYNCED') {
          item.synced_at = new Date().toISOString();
          item.sync_started_at = null;
        } else {
          item.sync_started_at = null;
        }
        if (errorMsg !== undefined) item.last_error = errorMsg;
        if (status !== 'SYNCING') {
          item.attempts = (item.attempts || 0) + 1;
        }
        store.put(item);
      }
    };
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

    tx.oncomplete = () => resolve(clientLocationId);
    tx.onerror = () => reject(tx.error || new Error('Transaction failed'));
    tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));

    const point: QueuedGpsPoint = {
      client_location_id: clientLocationId,
      journey_id: String(location.journey_id),
      latitude: location.latitude,
      longitude: location.longitude,
      gps_accuracy: location.gps_accuracy != null ? location.gps_accuracy : null,
      device_recorded_at: location.device_recorded_at || new Date().toISOString(),
      synced: 0,
      status: 'QUEUED',
      attempts: 0,
      last_error: null,
    };
    store.add(point);
  });
}

export async function getEligibleGpsPoints(limit?: number): Promise<QueuedGpsPoint[]> {
  if (!isIndexedDbSupported()) return [];
  const db = await openMotDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('gps_queue', 'readonly');
    const store = tx.objectStore('gps_queue');
    const req = store.getAll();
    req.onsuccess = () => {
      const points: QueuedGpsPoint[] = req.result || [];
      const eligible = points.filter((p) => {
        if (p.synced === 1 || p.status === 'SYNCED') return false;
        if (p.status === 'CONFLICT' || p.status === 'FAILED_FATAL') return false;
        return true; // 'QUEUED', 'FAILED_RETRYABLE', or undefined
      });
      eligible.sort(
        (a, b) =>
          new Date(a.device_recorded_at).getTime() - new Date(b.device_recorded_at).getTime()
      );
      resolve(limit ? eligible.slice(0, limit) : eligible);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function getUnsyncedGpsPoints(limit = 50): Promise<QueuedGpsPoint[]> {
  return getEligibleGpsPoints(limit);
}

export async function markGpsPointsSynced(ids: number[]): Promise<void> {
  if (!isIndexedDbSupported() || ids.length === 0) return;
  const db = await openMotDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('gps_queue', 'readwrite');
    const store = tx.objectStore('gps_queue');

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Transaction failed'));
    tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));

    for (const id of ids) {
      const req = store.get(id);
      req.onsuccess = () => {
        if (req.result) {
          const item: QueuedGpsPoint = req.result;
          item.synced = 1;
          item.status = 'SYNCED';
          store.put(item);
        }
      };
    }
  });
}

export async function updateGpsPointsStatus(
  updates: Array<{
    id: number;
    status: 'SYNCED' | 'CONFLICT' | 'FAILED_FATAL' | 'FAILED_RETRYABLE';
    error?: string;
  }>
): Promise<void> {
  if (!isIndexedDbSupported() || updates.length === 0) return;
  const db = await openMotDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('gps_queue', 'readwrite');
    const store = tx.objectStore('gps_queue');

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Transaction failed'));
    tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));

    for (const u of updates) {
      const req = store.get(u.id);
      req.onsuccess = () => {
        if (req.result) {
          const item: QueuedGpsPoint = req.result;
          item.status = u.status;
          item.synced = u.status === 'SYNCED' ? 1 : 0;
          if (u.error !== undefined) {
            item.last_error = u.error;
          }
          item.attempts = (item.attempts || 0) + 1;
          store.put(item);
        }
      };
    }
  });
}

// -------------------------------------------------------------
// Unsynced Counts & Aggregates
// -------------------------------------------------------------

export async function getUnsyncedSummary(): Promise<{
  pendingCollections: number;
  conflictCollections: number;
  fatalCollections: number;
  pendingGps: number;
  conflictGps: number;
  fatalGps: number;
  totalUnsynced: number;
}> {
  if (!isIndexedDbSupported()) {
    return {
      pendingCollections: 0,
      conflictCollections: 0,
      fatalCollections: 0,
      pendingGps: 0,
      conflictGps: 0,
      fatalGps: 0,
      totalUnsynced: 0,
    };
  }

  const collections = await getQueuedCollections();
  const pendingColl = collections.filter(
    (c) => c.status === 'QUEUED' || c.status === 'FAILED_RETRYABLE' || c.status === 'SYNCING'
  ).length;
  const conflictColl = collections.filter((c) => c.status === 'CONFLICT').length;
  const fatalColl = collections.filter((c) => c.status === 'FAILED_FATAL').length;

  const db = await openMotDb();
  const gpsCounts = await new Promise<{ pending: number; conflict: number; fatal: number }>((resolve) => {
    const tx = db.transaction('gps_queue', 'readonly');
    const store = tx.objectStore('gps_queue');
    const req = store.getAll();
    req.onsuccess = () => {
      const points: QueuedGpsPoint[] = req.result || [];
      let pending = 0;
      let conflict = 0;
      let fatal = 0;
      for (const p of points) {
        if (p.synced === 1 || p.status === 'SYNCED') continue;
        if (p.status === 'CONFLICT') {
          conflict++;
        } else if (p.status === 'FAILED_FATAL') {
          fatal++;
        } else {
          pending++;
        }
      }
      resolve({ pending, conflict, fatal });
    };
    req.onerror = () => resolve({ pending: 0, conflict: 0, fatal: 0 });
  });

  return {
    pendingCollections: pendingColl,
    conflictCollections: conflictColl,
    fatalCollections: fatalColl,
    pendingGps: gpsCounts.pending,
    conflictGps: gpsCounts.conflict,
    fatalGps: gpsCounts.fatal,
    totalUnsynced: pendingColl + gpsCounts.pending,
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
  const STALE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
  const now = Date.now();

  const all = await getQueuedCollections();

  // FIX 2: Recover stale SYNCING records (> 5 minutes or missing sync_started_at)
  for (const item of all) {
    if (item.status === 'SYNCING') {
      const startedAt = item.sync_started_at ? new Date(item.sync_started_at).getTime() : 0;
      if (!startedAt || now - startedAt > STALE_TIMEOUT_MS) {
        await updateCollectionQueueStatus(
          item.client_event_id,
          'FAILED_RETRYABLE',
          'Sync timed out or crashed; recovered from stale SYNCING state'
        );
        item.status = 'FAILED_RETRYABLE';
        item.sync_started_at = null;
      }
    }
  }

  // A fresh currently-running SYNCING item must NOT be submitted twice!
  // Eligible: QUEUED or FAILED_RETRYABLE
  const toSync = all.filter(
    (c) => c.status === 'QUEUED' || c.status === 'FAILED_RETRYABLE'
  );

  let synced = 0;
  let conflicts = 0;
  let failed = 0;

  for (const item of toSync) {
    await updateCollectionQueueStatus(item.client_event_id, 'SYNCING');
    try {
      const res = await fetch('/api/zmcc/mot/journeys/current/collections', {
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
        err?.message || 'Network unreachable'
      );
      failed++;
    }
  }

  return { synced, conflicts, failed };
}

export async function syncPendingGps(): Promise<{
  synced: number;
  conflicts: number;
  fatal: number;
  retryable: number;
  failed: number;
}> {
  let totalSynced = 0;
  let totalConflicts = 0;
  let totalFatal = 0;
  let totalRetryable = 0;

  // Snapshot eligible points at the start of this sync invocation.
  // Guarantees each eligible point is attempted at most once. No unbounded while loop.
  const eligiblePoints = await getEligibleGpsPoints();
  if (eligiblePoints.length === 0) {
    return { synced: 0, conflicts: 0, fatal: 0, retryable: 0, failed: 0 };
  }

  const BATCH_SIZE = 50;
  for (let i = 0; i < eligiblePoints.length; i += BATCH_SIZE) {
    const batch = eligiblePoints.slice(i, i + BATCH_SIZE);

    // Group by journey_id (server rejects mixed-journey batches)
    const byJourney = new Map<string, QueuedGpsPoint[]>();
    for (const p of batch) {
      const jId = String(p.journey_id || '');
      if (!byJourney.has(jId)) byJourney.set(jId, []);
      byJourney.get(jId)!.push(p);
    }

    let hadNetworkOrServerFailure = false;

    for (const [journeyId, journeyPoints] of Array.from(byJourney.entries())) {
      try {
        const res = await fetch('/api/zmcc/mot/journeys/current/locations/batch', {
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
          const itemResults = new Map<string, { status: string; reason?: string }>();
          if (Array.isArray(data.items)) {
            for (const item of data.items) {
              itemResults.set(item.client_location_id, item);
            }
          }

          const updates: Array<{
            id: number;
            status: 'SYNCED' | 'CONFLICT' | 'FAILED_FATAL' | 'FAILED_RETRYABLE';
            error?: string;
          }> = [];

          for (const p of journeyPoints) {
            if (typeof p.id !== 'number') continue;
            const r = itemResults.get(p.client_location_id);
            if (!r) {
              updates.push({
                id: p.id,
                status: 'FAILED_RETRYABLE',
                error: 'Point missing from server response',
              });
              totalRetryable++;
            } else if (r.status === 'ACCEPTED' || r.status === 'ALREADY_PROCESSED') {
              updates.push({ id: p.id, status: 'SYNCED' });
              totalSynced++;
            } else if (r.status === 'CONFLICT') {
              updates.push({
                id: p.id,
                status: 'CONFLICT',
                error: r.reason || 'Conflict detected',
              });
              totalConflicts++;
            } else if (r.status === 'REJECTED') {
              updates.push({
                id: p.id,
                status: 'FAILED_FATAL',
                error: r.reason || 'Point rejected by server validation',
              });
              totalFatal++;
            } else {
              updates.push({
                id: p.id,
                status: 'FAILED_FATAL',
                error: r.reason || `Unknown status: ${r.status}`,
              });
              totalFatal++;
            }
          }

          if (updates.length > 0) {
            await updateGpsPointsStatus(updates);
          }
        } else if (res.status >= 400 && res.status < 500) {
          // HTTP 4xx -> Permanent validation / auth rejection (FAILED_FATAL)
          const errJson = await res.json().catch(() => ({}));
          const errorMsg = errJson.error || `Client error (${res.status})`;
          const updates = journeyPoints
            .filter((p): p is QueuedGpsPoint & { id: number } => typeof p.id === 'number')
            .map((p) => ({
              id: p.id,
              status: 'FAILED_FATAL' as const,
              error: errorMsg,
            }));
          if (updates.length > 0) {
            await updateGpsPointsStatus(updates);
            totalFatal += updates.length;
          }
        } else {
          // HTTP 5xx -> Server error (FAILED_RETRYABLE, retried only in subsequent cycle)
          const errorMsg = `Server error (${res.status})`;
          const updates = journeyPoints
            .filter((p): p is QueuedGpsPoint & { id: number } => typeof p.id === 'number')
            .map((p) => ({
              id: p.id,
              status: 'FAILED_RETRYABLE' as const,
              error: errorMsg,
            }));
          if (updates.length > 0) {
            await updateGpsPointsStatus(updates);
            totalRetryable += updates.length;
          }
          hadNetworkOrServerFailure = true;
        }
      } catch (err: any) {
        // Network unreachable / fetch exception -> FAILED_RETRYABLE
        const errorMsg = err?.message || 'Network unreachable';
        const updates = journeyPoints
          .filter((p): p is QueuedGpsPoint & { id: number } => typeof p.id === 'number')
          .map((p) => ({
            id: p.id,
            status: 'FAILED_RETRYABLE' as const,
            error: errorMsg,
          }));
        if (updates.length > 0) {
          await updateGpsPointsStatus(updates);
          totalRetryable += updates.length;
        }
        hadNetworkOrServerFailure = true;
      }
    }

    if (hadNetworkOrServerFailure) {
      break;
    }
  }

  const failed = totalConflicts + totalFatal + totalRetryable;
  return {
    synced: totalSynced,
    conflicts: totalConflicts,
    fatal: totalFatal,
    retryable: totalRetryable,
    failed,
  };
}

export async function syncAll(): Promise<{
  collections: { synced: number; conflicts: number; failed: number };
  gps: { synced: number; conflicts?: number; fatal?: number; retryable?: number; failed: number };
}> {
  const collRes = await syncPendingCollections();
  const gpsRes = await syncPendingGps();
  return { collections: collRes, gps: gpsRes };
}
