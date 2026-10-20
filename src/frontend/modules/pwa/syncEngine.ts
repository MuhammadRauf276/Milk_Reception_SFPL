/**
 * Offline sync engine (client). IndexedDB store 'milk_sync' + a send loop that talks to
 * POST /api/sync/batch (src/types/sync.ts contract) and POST /api/photos (multipart file + meta).
 *
 * - Runs on: start, 'online', tab becoming visible, every 20s, and right after something is queued.
 * - Single flight: one run at a time in this tab, and across tabs via navigator.locks when available.
 * - Auth: device headers (x-device-uid / x-device-key) when a key is stored, plus the session cookie;
 *   the server takes business items only for the phone's assigned user or the user signed in now,
 *   so device mode sends the signed-in user's business items plus all diary/heartbeat items (other
 *   owners' work waits on the phone). Without a key: the session cookie, signed-in user's items only.
 * - Nothing is deleted until the server confirms (logic in syncQueueCore.ts).
 * - 403 DEVICE_NOT_ACTIVE (phone blocked): nothing is touched, no cookie fallback, state BLOCKED
 *   ("This phone is blocked. Ask the office."). 401 on the key: nothing is touched, state
 *   KEY_REJECTED, the signed-in user's own items go with the session cookie instead.
 *
 * Safe to import in Node tests: no window/indexedDB access at module load.
 */
import type { SyncBatchRequest, SyncItem, SyncItemKind } from '@/types/sync';
import { DEVICE_KEY_HEADER } from '@/types/device';
import type { CapturedPhotoUploadResult } from '@/types/captured-photo';
import {
  applyPhotoResult,
  classifyBatchHttp,
  classifyPhotoHttp,
  countRecords,
  deviceBlockedMessage,
  enqueue,
  getCounts,
  nextBatch,
  pendingPhotoUploads,
  purgeRejectedBackground,
  sendQueuedBatches,
  type BatchTransportResult,
  type EnqueueOptions,
  type QueueRecord,
  type SyncCounts,
  type SendQueuedBatchesResult,
  type SyncAuthMode,
  type SyncQueueStore,
} from './syncQueueCore';
import {
  getActiveOwnerUserId,
  getDeviceAuthHeaders,
  getDeviceKey,
  getDeviceSyncState,
  getDeviceUid,
  setDeviceSyncState,
} from './deviceIdentity';

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
  /** Refused diary/heartbeat items that were deleted (not business work). */
  dropped: number;
  photosUploaded: number;
  /** Device-key answer seen in this run (undefined = no device-mode request was made). */
  deviceState?: 'OK' | 'BLOCKED' | 'KEY_REJECTED';
  deviceMessage?: string | null;
}

function emptySummary(skipped?: SyncRunSummary['skipped']): SyncRunSummary {
  return { skipped, sent: 0, saved: 0, savedByKind: {}, rejected: 0, retrying: 0, dropped: 0, photosUploaded: 0 };
}

let ownerGetter: () => string | null = () => null;
let inFlight: Promise<SyncRunSummary> | null = null;

function appVersion(): string {
  return process.env.NEXT_PUBLIC_APP_VERSION || '1.0.0';
}

function isOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

/** After a 401 on the device key, use the session cookie for this long before trying the key again. */
const KEY_REJECTED_RETRY_MS = 10 * 60 * 1000;
/** A blocked phone asks the server again at most this often (the office may unblock it). */
const BLOCKED_RECHECK_MS = 2 * 60 * 1000;

function postBatch(authHeaders: Record<string, string>) {
  return async (body: SyncBatchRequest): Promise<BatchTransportResult> => {
    try {
      const res = await fetch('/api/sync/batch', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify(body),
      });
      return { ok: true, httpStatus: res.status, body: await res.json().catch(() => null) };
    } catch (err) {
      return { ok: false, networkError: err instanceof Error ? err.message : 'Network error' };
    }
  };
}

/** Records the server's answer about the key and tells the UI. */
function noteDeviceAnswer(result: SendQueuedBatchesResult): void {
  if (result.stop === 'DEVICE_BLOCKED') {
    const status = result.deviceStatus ?? null;
    setDeviceSyncState({ state: 'BLOCKED', deviceStatus: status, message: deviceBlockedMessage(status), at: Date.now() });
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('milk-device-status', { detail: { status } }));
  } else if (result.stop === 'DEVICE_KEY_REJECTED') {
    setDeviceSyncState({ state: 'KEY_REJECTED', deviceStatus: null, message: result.stopMessage ?? null, at: Date.now() });
  } else if (result.deviceStatus === 'ACTIVE') {
    setDeviceSyncState({ state: 'OK', deviceStatus: 'ACTIVE', message: null, at: Date.now() });
  }
}

function addToSummary(summary: SyncRunSummary, r: SendQueuedBatchesResult): void {
  summary.sent += r.sent;
  summary.saved += r.saved;
  summary.rejected += r.rejected;
  summary.retrying += r.retrying;
  summary.dropped += r.dropped;
  for (const [kind, n] of Object.entries(r.savedByKind) as Array<[SyncItemKind, number]>) {
    summary.savedByKind[kind] = (summary.savedByKind[kind] ?? 0) + n;
  }
}

function reportStop(r: SendQueuedBatchesResult, mode: SyncAuthMode): void {
  if (r.stop === 'NETWORK') {
    if (isOnline()) emitSyncError({ stage: 'batch', message: 'Network error while online' });
  } else if (r.stop === 'RETRY') {
    emitSyncError({ stage: 'batch', status: r.httpStatus, message: `HTTP ${r.httpStatus}` });
  } else if (r.stop === 'SESSION_EXPIRED' && mode === 'SESSION' && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('milk-auth-expired'));
  }
}

async function sendBatches(summary: SyncRunSummary, hasKey: boolean, owner: string | null): Promise<void> {
  const s = store();
  const deviceUid = await getDeviceUid();
  const base = { deviceUid, appVersion: appVersion(), maxBatches: MAX_BATCHES_PER_RUN };

  if (hasKey) {
    const known = getDeviceSyncState();
    const age = known ? Date.now() - known.at : Infinity;
    const skipDevice =
      (known?.state === 'BLOCKED' && age < BLOCKED_RECHECK_MS) || (known?.state === 'KEY_REJECTED' && age < KEY_REJECTED_RETRY_MS);
    if (known?.state === 'BLOCKED' && skipDevice) {
      // Blocked phone: keep everything, do not fall back to the cookie.
      summary.deviceState = 'BLOCKED';
      summary.deviceMessage = known.message;
      return;
    }
    if (!skipDevice) {
      const r = await sendQueuedBatches(s, { ...base, mode: 'DEVICE', ownerUserId: owner, send: postBatch(await getDeviceAuthHeaders()) });
      addToSummary(summary, r);
      noteDeviceAnswer(r);
      reportStop(r, 'DEVICE');
      if (r.stop === 'DEVICE_BLOCKED') {
        summary.deviceState = 'BLOCKED';
        summary.deviceMessage = deviceBlockedMessage(r.deviceStatus ?? null);
        return;
      }
      if (r.stop !== 'DEVICE_KEY_REJECTED') {
        if (r.deviceStatus === 'ACTIVE') summary.deviceState = 'OK';
        return;
      }
    }
    // Key not recognised: keep the items and send the signed-in user's own work with the cookie.
    summary.deviceState = 'KEY_REJECTED';
    summary.deviceMessage = getDeviceSyncState()?.message ?? null;
  }

  if (!owner) return;
  const r = await sendQueuedBatches(s, { ...base, mode: 'SESSION', ownerUserId: owner, send: postBatch({}) });
  addToSummary(summary, r);
  reportStop(r, 'SESSION');
}

/**
 * Asks the server whether this phone's key works, with an empty batch (nothing is sent or deleted).
 * Used by the device setup screen right after a key is saved.
 */
export async function checkDeviceConnection(): Promise<
  { ok: true } | { ok: false; reason: 'NO_KEY' | 'OFFLINE' | 'BLOCKED' | 'KEY_REJECTED' | 'SERVER'; message: string }
> {
  const headers = await getDeviceAuthHeaders();
  if (!headers[DEVICE_KEY_HEADER]) return { ok: false, reason: 'NO_KEY', message: 'No key on this phone.' };
  const res = await postBatch(headers)({ deviceUid: await getDeviceUid(), appVersion: appVersion(), deviceSentAt: new Date().toISOString(), items: [] });
  if (!res.ok) return { ok: false, reason: 'OFFLINE', message: 'No internet. Try again when online.' };
  const verdict = classifyBatchHttp(res.httpStatus, res.body, 'DEVICE');
  if (verdict.kind === 'OK') {
    setDeviceSyncState({ state: 'OK', deviceStatus: 'ACTIVE', message: null, at: Date.now() });
    return { ok: true };
  }
  if (verdict.kind === 'DEVICE_BLOCKED') {
    setDeviceSyncState({ state: 'BLOCKED', deviceStatus: verdict.deviceStatus, message: verdict.message, at: Date.now() });
    return { ok: false, reason: 'BLOCKED', message: verdict.message };
  }
  if (verdict.kind === 'DEVICE_KEY_REJECTED') {
    setDeviceSyncState({ state: 'KEY_REJECTED', deviceStatus: null, message: verdict.message, at: Date.now() });
    return { ok: false, reason: 'KEY_REJECTED', message: 'The key is wrong or old. Ask the office for a new key.' };
  }
  return { ok: false, reason: 'SERVER', message: 'Server problem. Try again in a minute.' };
}

/**
 * useDeviceKey false = session cookie: only the signed-in owner's photos are tried (the server
 * refuses everyone else's); with no signed-in owner nothing is uploaded.
 */
async function uploadPhotos(summary: SyncRunSummary, useDeviceKey: boolean, owner: string | null): Promise<void> {
  const s = store();
  if (!useDeviceKey && !owner) return;
  const tasks = await pendingPhotoUploads(s, Date.now(), MAX_PHOTOS_PER_RUN, useDeviceKey ? null : owner);
  if (tasks.length === 0) return;
  const { getCapturedPhotoBlob, deleteCapturedPhoto } = await import('@/lib/offline/photoStore');
  const authHeaders = useDeviceKey ? await getDeviceAuthHeaders() : {};
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
    const err = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
    emitSyncError({ stage: 'photo', status: res.status, message: err.error || `HTTP ${res.status}` });
    const verdict = classifyPhotoHttp(res.status, err);
    if (verdict.kind === 'BLOCKED') {
      // Phone blocked: photo untouched (no backoff), stop uploading.
      setDeviceSyncState({ state: 'BLOCKED', deviceStatus: verdict.deviceStatus, message: verdict.message, at: Date.now() });
      summary.deviceState = 'BLOCKED';
      summary.deviceMessage = verdict.message;
      return;
    }
    if (verdict.kind === 'RETRY') {
      await applyPhotoResult(s, task.clientUuid, task.captureId, { kind: 'RETRY', message: verdict.message });
      return;
    }
    // Refused (e.g. outside scope): only this photo needs office help; the others keep going.
    await applyPhotoResult(s, task.clientUuid, task.captureId, { kind: 'REJECTED', code: verdict.code, message: verdict.message });
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
    // Old app versions kept refused diary items as 'needs office help': clear them.
    if ((await purgeRejectedBackground(store())) > 0) notifyChanged();
    const pending = await nextBatch(store(), { limit: 1, mode: hasKey ? 'DEVICE' : 'SESSION', ownerUserId: owner });
    if (pending.length > 0 && typeof window !== 'undefined') {
      announced = true;
      window.dispatchEvent(new CustomEvent('milk-sync-state', { detail: { syncing: true } }));
    }
    await sendBatches(summary, hasKey, owner);
    // Blocked phone: photos wait too. Key not recognised: photos go with the session cookie.
    if (summary.deviceState !== 'BLOCKED') await uploadPhotos(summary, hasKey && summary.deviceState !== 'KEY_REJECTED', owner);
  } finally {
    if (announced && typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('milk-sync-state', { detail: { syncing: false } }));
    notifyChanged();
  }
  return summary;
}

/**
 * One sync pass. Concurrent callers share the same run; other tabs holding the lock → 'busy'.
 * fresh: wait for any running pass (and the other tabs' lock) and then start a new one, so the
 * result reflects state saved just before the call (device setup screen).
 */
export function runSyncOnce(opts: { fresh?: boolean } = {}): Promise<SyncRunSummary> {
  if (inFlight && opts.fresh) {
    const previous = inFlight;
    return previous.then(() => runSyncOnce(opts));
  }
  if (inFlight) return inFlight;
  const run = async (): Promise<SyncRunSummary> => {
    const locks = typeof navigator !== 'undefined' ? (navigator as Navigator & { locks?: LockManager }).locks : undefined;
    if (locks?.request) {
      return (await locks.request(LOCK_NAME, { ifAvailable: !opts.fresh }, async (lock) => {
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
