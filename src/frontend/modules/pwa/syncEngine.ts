/**
 * Offline sync engine (client). IndexedDB store 'milk_sync' + a send loop that talks to
 * POST /api/sync/batch (src/types/sync.ts contract) and POST /api/photos (multipart file + meta).
 *
 * - Runs on: start, 'online', tab becoming visible, every 20s, and right after something is queued.
 * - Single flight: one run at a time in this tab, and across tabs via navigator.locks when available.
 * - Auth: device headers (x-device-uid / x-device-key) when a key is stored; otherwise the session
 *   cookie, sending only the signed-in user's own items (server rule).
 * - Nothing is deleted until the server confirms (logic in syncQueueCore.ts).
 *
 * Safe to import in Node tests: no window/indexedDB access at module load.
 */
import { SYNC_BATCH_MAX_ITEMS, type SyncBatchRequest, type SyncBatchResponse, type SyncItem, type SyncItemKind } from '@/types/sync';
import type { CapturedPhotoUploadResult } from '@/types/captured-photo';
import {
  applyBatchFailure,
  applyPhotoResult,
  applyResults,
  countRecords,
  enqueue,
  getCounts,
  nextBatch,
  pendingPhotoUploads,
  type EnqueueOptions,
  type QueueRecord,
  type SyncCounts,
  type SyncQueueStore,
} from './syncQueueCore';
import { getActiveOwnerUserId, getDeviceAuthHeaders, getDeviceKey, getDeviceUid } from './deviceIdentity';

const DB_NAME = 'milk_sync';
const DB_VERSION = 1;
const QUEUE = 'queue';
const META = 'meta';
const LOCK_NAME = 'milk-sync-run';
const DEFAULT_INTERVAL_MS = 20_000;
const MAX_BATCHES_PER_RUN = 10;
const MAX_PHOTOS_PER_RUN = 20;

/** Fired on window whenever queue contents may have changed (SyncStatusSign listens). */
export const SYNC_QUEUE_CHANGED_EVENT = 'milk-sync-queue-changed';
/** Fired on window when a send failed for a reason other than being offline (diary listens). */
export const SYNC_ERROR_EVENT = 'milk-sync-error';

function idbFactory(): IDBFactory | null {
  if (typeof window !== 'undefined' && window.indexedDB) return window.indexedDB;
  if (typeof globalThis !== 'undefined' && (globalThis as { indexedDB?: IDBFactory }).indexedDB) {
    return (globalThis as { indexedDB?: IDBFactory }).indexedDB ?? null;
  }
  return null;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openSyncDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  const factory = idbFactory();
  if (!factory) return Promise.reject(new Error('IndexedDB is not available'));
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = factory.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(QUEUE)) {
        const store = db.createObjectStore(QUEUE, { keyPath: 'clientUuid' });
        store.createIndex('state', 'state', { unique: false });
        store.createIndex('enqueuedAt', 'enqueuedAt', { unique: false });
      }
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: 'key' });
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      db.onclose = () => {
        dbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => {
      dbPromise = null;
      reject(req.error);
    };
  });
  return dbPromise;
}

/** True if the sync database exists (avoids creating it just to count). Unknown → true. */
async function syncDbExists(): Promise<boolean> {
  const factory = idbFactory();
  if (!factory) return false;
  if (dbPromise) return true;
  try {
    if (typeof factory.databases !== 'function') return true;
    return (await factory.databases()).some((d) => d.name === DB_NAME);
  } catch {
    return true;
  }
}

function write(db: IDBDatabase, name: string, fn: (store: IDBObjectStore) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    // 'strict' durability: resolved only once the data is flushed to disk.
    const tx = db.transaction(name, 'readwrite', { durability: 'strict' });
    fn(tx.objectStore(name));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Sync store write failed'));
    tx.onabort = () => reject(tx.error || new Error('Sync store write aborted'));
  });
}

function read<T>(db: IDBDatabase, name: string, fn: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    const req = fn(db.transaction(name, 'readonly').objectStore(name));
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error);
  });
}

/** IndexedDB implementation of the core store interface. */
export function createIdbSyncStore(): SyncQueueStore {
  return {
    async get(clientUuid) {
      const db = await openSyncDb();
      return (await read<QueueRecord | undefined>(db, QUEUE, (s) => s.get(clientUuid))) ?? null;
    },
    async put(record) {
      await write(await openSyncDb(), QUEUE, (s) => s.put(record));
    },
    async delete(clientUuid) {
      await write(await openSyncDb(), QUEUE, (s) => s.delete(clientUuid));
    },
    async list() {
      return (await read<QueueRecord[]>(await openSyncDb(), QUEUE, (s) => s.getAll())) ?? [];
    },
    async getMeta<T>(key: string) {
      const row = await read<{ key: string; value: T } | undefined>(await openSyncDb(), META, (s) => s.get(key));
      return row ? row.value : null;
    },
    async setMeta<T>(key: string, value: T) {
      await write(await openSyncDb(), META, (s) => s.put({ key, value }));
    },
  };
}

let storeSingleton: SyncQueueStore | null = null;
function store(): SyncQueueStore {
  if (!storeSingleton) storeSingleton = createIdbSyncStore();
  return storeSingleton;
}

function notifyChanged(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(SYNC_QUEUE_CHANGED_EVENT));
}

function emitSyncError(detail: { stage: 'batch' | 'photo'; status?: number; message: string }): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(SYNC_ERROR_EVENT, { detail }));
}

// -------------------------------------------------------------
// Public queue API
// -------------------------------------------------------------

/**
 * Durably stores an item for sending (idempotent by clientUuid). Resolves only after the
 * IndexedDB write committed, so callers may then drop their own copy. Throws if it could not store.
 */
export async function enqueueSyncItem(item: SyncItem, opts?: EnqueueOptions): Promise<QueueRecord> {
  const rec = await enqueue(store(), item, opts);
  notifyChanged();
  scheduleSoonRun();
  return rec;
}

/** All queue records (empty when the sync database was never created). Never throws. */
export async function listSyncQueueRecords(): Promise<QueueRecord[]> {
  try {
    if (!(await syncDbExists())) return [];
    return await store().list();
  } catch {
    return [];
  }
}

/** Counts for the UI and logout guard. Never throws. */
export async function getSyncQueueCounts(): Promise<SyncCounts> {
  try {
    if (!(await syncDbExists())) return { waiting: 0, needsAttention: 0, sentToday: 0 };
    return await getCounts(store());
  } catch {
    return { waiting: 0, needsAttention: 0, sentToday: 0 };
  }
}

/** Pure helper re-exported for callers that already hold records. */
export { countRecords };

// -------------------------------------------------------------
// Sending
// -------------------------------------------------------------

export interface SyncRunSummary {
  skipped?: 'offline' | 'busy' | 'no-auth' | 'no-storage';
  sent: number;
  saved: number;
  savedByKind: Partial<Record<SyncItemKind, number>>;
  rejected: number;
  retrying: number;
  photosUploaded: number;
}

function emptySummary(skipped?: SyncRunSummary['skipped']): SyncRunSummary {
  return { skipped, sent: 0, saved: 0, savedByKind: {}, rejected: 0, retrying: 0, photosUploaded: 0 };
}

let ownerGetter: () => string | null = () => null;
let inFlight: Promise<SyncRunSummary> | null = null;

function appVersion(): string {
  return process.env.NEXT_PUBLIC_APP_VERSION || '1.0.0';
}

function isOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

async function sendBatches(summary: SyncRunSummary, hasKey: boolean, owner: string | null): Promise<void> {
  const s = store();
  const authHeaders = await getDeviceAuthHeaders();
  const deviceUid = await getDeviceUid();
  for (let i = 0; i < MAX_BATCHES_PER_RUN; i++) {
    const batch = await nextBatch(s, { limit: SYNC_BATCH_MAX_ITEMS, ownerUserId: hasKey ? null : owner });
    if (batch.length === 0) return;
    const ids = batch.map((r) => r.clientUuid);
    const body: SyncBatchRequest = {
      deviceUid,
      appVersion: appVersion(),
      deviceSentAt: new Date().toISOString(),
      items: batch.map((r) => r.item),
    };
    summary.sent += batch.length;
    let res: Response;
    try {
      res = await fetch('/api/sync/batch', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify(body),
      });
    } catch (err) {
      await applyBatchFailure(s, ids, err instanceof Error ? err.message : 'Network error');
      summary.retrying += ids.length;
      if (isOnline()) emitSyncError({ stage: 'batch', message: 'Network error while online' });
      return;
    }

    if (!res.ok) {
      await applyBatchFailure(s, ids, `Server error (${res.status})`);
      summary.retrying += ids.length;
      if (res.status === 401 && !hasKey && typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('milk-auth-expired'));
      emitSyncError({ stage: 'batch', status: res.status, message: `HTTP ${res.status}` });
      return;
    }

    const data = (await res.json().catch(() => null)) as Partial<SyncBatchResponse> | null;
    const results = Array.isArray(data?.results) ? data!.results : [];
    if (data?.deviceStatus && data.deviceStatus !== 'ACTIVE' && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('milk-device-status', { detail: { status: data.deviceStatus } }));
    }
    const outcome = await applyResults(s, ids, results);
    const savedIds = new Set([...outcome.removed, ...outcome.photosPending]);
    for (const r of batch) {
      if (!savedIds.has(r.clientUuid)) continue;
      summary.saved++;
      summary.savedByKind[r.item.kind] = (summary.savedByKind[r.item.kind] ?? 0) + 1;
    }
    summary.rejected += outcome.needsAttention.length;
    summary.retrying += outcome.retrying.length;
    notifyChanged();
    // Server asked to retry everything: stop for this run.
    if (outcome.retrying.length === ids.length) return;
  }
}

async function uploadPhotos(summary: SyncRunSummary): Promise<void> {
  const s = store();
  const tasks = await pendingPhotoUploads(s, Date.now(), MAX_PHOTOS_PER_RUN);
  if (tasks.length === 0) return;
  const { getCapturedPhotoBlob, deleteCapturedPhoto } = await import('@/lib/offline/photoStore');
  const authHeaders = await getDeviceAuthHeaders();
  for (const task of tasks) {
    const blob = await getCapturedPhotoBlob(task.captureId);
    if (!blob) {
      await applyPhotoResult(s, task.clientUuid, task.captureId, { kind: 'REJECTED', code: 'PHOTO_MISSING', message: 'Photo is missing on this phone.' });
      continue;
    }
    const form = new FormData();
    form.append('file', blob, `${task.captureId}.jpg`);
    form.append('meta', JSON.stringify(task.meta));
    if (task.ownerUserId) form.append('ownerUserId', task.ownerUserId);
    let res: Response;
    try {
      res = await fetch('/api/photos', { method: 'POST', credentials: 'same-origin', headers: { ...authHeaders }, body: form });
    } catch (err) {
      await applyPhotoResult(s, task.clientUuid, task.captureId, { kind: 'RETRY', message: err instanceof Error ? err.message : 'Network error' });
      return;
    }
    if (res.ok) {
      const data = (await res.json().catch(() => null)) as Partial<CapturedPhotoUploadResult> | null;
      if (data && (data.status === 'SAVED' || data.status === 'DUPLICATE')) {
        const r = await applyPhotoResult(s, task.clientUuid, task.captureId, { kind: 'OK', result: { status: data.status, photoId: String(data.photoId ?? '') } });
        if (r.photoConfirmed) await deleteCapturedPhoto(task.captureId);
        summary.photosUploaded++;
      } else {
        await applyPhotoResult(s, task.clientUuid, task.captureId, { kind: 'RETRY', message: 'Unexpected photo upload response' });
      }
      continue;
    }
    // Retryable: auth/session, timeouts, rate limits, server errors. Others are the server refusing this photo.
    const retryable = res.status === 401 || res.status === 403 || res.status === 408 || res.status === 429 || res.status >= 500;
    const err = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
    emitSyncError({ stage: 'photo', status: res.status, message: err.error || `HTTP ${res.status}` });
    if (retryable) {
      await applyPhotoResult(s, task.clientUuid, task.captureId, { kind: 'RETRY', message: err.error || `Server error (${res.status})` });
      return;
    }
    await applyPhotoResult(s, task.clientUuid, task.captureId, {
      kind: 'REJECTED',
      code: err.code || `HTTP_${res.status}`,
      message: err.error || 'Photo refused by server',
    });
  }
}

async function runUnlocked(): Promise<SyncRunSummary> {
  const summary = emptySummary();
  if (!idbFactory()) return emptySummary('no-storage');
  if (!isOnline()) return emptySummary('offline');
  const owner = ownerGetter() ?? getActiveOwnerUserId();
  const hasKey = Boolean(await getDeviceKey());
  if (!hasKey && !owner) return emptySummary('no-auth');

  if (hasKey) {
    // MOT queues move into this queue only when the device has a key (old path otherwise).
    try {
      const mot = await import('@/frontend/modules/mot/offlineStore');
      await mot.drainMotQueuesToSyncQueue({ fallbackOwnerUserId: owner });
    } catch {
      // Old queue keeps the items; next run tries again.
    }
  }

  if (!(await syncDbExists())) return summary;
  let announced = false;
  try {
    const pending = await nextBatch(store(), { limit: 1, ownerUserId: hasKey ? null : owner });
    if (pending.length > 0 && typeof window !== 'undefined') {
      announced = true;
      window.dispatchEvent(new CustomEvent('milk-sync-state', { detail: { syncing: true } }));
    }
    await sendBatches(summary, hasKey, owner);
    await uploadPhotos(summary);
  } finally {
    if (announced && typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('milk-sync-state', { detail: { syncing: false } }));
    notifyChanged();
  }
  return summary;
}

/** One sync pass. Concurrent callers share the same run; other tabs holding the lock → 'busy'. */
export function runSyncOnce(): Promise<SyncRunSummary> {
  if (inFlight) return inFlight;
  const run = async (): Promise<SyncRunSummary> => {
    const locks = typeof navigator !== 'undefined' ? (navigator as Navigator & { locks?: LockManager }).locks : undefined;
    if (locks?.request) {
      return (await locks.request(LOCK_NAME, { ifAvailable: true }, async (lock) => {
        if (!lock) return emptySummary('busy');
        return runUnlocked();
      })) as SyncRunSummary;
    }
    return runUnlocked();
  };
  inFlight = run()
    .catch(() => emptySummary())
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

let soonTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleSoonRun(): void {
  if (typeof window === 'undefined' || engineRefs === 0) return;
  if (soonTimer) clearTimeout(soonTimer);
  soonTimer = setTimeout(() => {
    soonTimer = null;
    void runSyncOnce();
  }, 1_500);
}

// -------------------------------------------------------------
// Loop
// -------------------------------------------------------------

let engineRefs = 0;
let teardown: (() => void) | null = null;

export interface StartSyncEngineOptions {
  /** Signed-in user id (session-cookie mode sends only this user's items). */
  getOwnerUserId: () => string | null;
  intervalMs?: number;
}

/**
 * Starts the background loop. Reference counted (safe under React StrictMode double effects):
 * every call must be paired with a call of the returned stop function.
 */
export function startSyncEngine(opts: StartSyncEngineOptions): () => void {
  ownerGetter = opts.getOwnerUserId;
  engineRefs++;
  if (engineRefs === 1 && typeof window !== 'undefined') {
    const kick = () => void runSyncOnce();
    const onVisible = () => {
      if (document.visibilityState === 'visible') kick();
    };
    window.addEventListener('online', kick);
    window.addEventListener('milk-device-key-changed', kick);
    document.addEventListener('visibilitychange', onVisible);
    const timer = setInterval(kick, opts.intervalMs ?? DEFAULT_INTERVAL_MS);
    const first = setTimeout(kick, 1_000);
    teardown = () => {
      window.removeEventListener('online', kick);
      window.removeEventListener('milk-device-key-changed', kick);
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(timer);
      clearTimeout(first);
      if (soonTimer) {
        clearTimeout(soonTimer);
        soonTimer = null;
      }
    };
  }
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    engineRefs = Math.max(0, engineRefs - 1);
    if (engineRefs === 0 && teardown) {
      teardown();
      teardown = null;
      ownerGetter = () => null;
    }
  };
}

/** The owner id the running engine attributes new events to (null when not running/logged out). */
export function getEngineOwnerUserId(): string | null {
  return ownerGetter();
}
