/**
 * Pure offline sync queue logic (no IndexedDB, no fetch, no window).
 * The real store lives in syncEngine.ts; tests use createMemorySyncStore().
 *
 * Rules (docs/PHASE3_BRIEF.md):
 * - Nothing is deleted until the server says SAVED or DUPLICATE.
 * - REJECTED items stay as NEEDS_ATTENTION ("needs help from office"); never auto-deleted.
 *   Exception: diary/heartbeat items (not business work) are dropped when REJECTED, so they
 *   never show a red sign for nothing.
 * - Whole-batch auth answers (401 / 403 DEVICE_NOT_ACTIVE) touch nothing: items stay as they are.
 * - RETRY / network errors stay, retried forever with backoff 5s, 10s, 20s... capped at 15 min.
 * - Photos upload only after the record is ACKed (CapturedPhoto.entity_id is required);
 *   the item is removed only when the record and every photo are confirmed.
 */
import {
  SYNC_BATCH_MAX_ITEMS,
  type SyncBatchRequest,
  type SyncBatchResponse,
  type SyncItem,
  type SyncItemKind,
  type SyncItemResult,
} from '@/types/sync';
import type { CapturedPhotoMeta, CapturedPhotoUploadResult } from '@/types/captured-photo';
import type { DeviceStatus } from '@/types/device';

export const BACKOFF_BASE_MS = 5_000;
export const BACKOFF_MAX_MS = 15 * 60 * 1000;

export type QueueItemState = 'PENDING' | 'PHOTOS_PENDING' | 'NEEDS_ATTENTION';
export type QueuedPhotoState = 'PENDING' | 'DONE' | 'REJECTED';

/** Photo meta known at capture time; entityType/entityId are filled from the server ACK. */
export type PendingPhotoMeta = Omit<CapturedPhotoMeta, 'entityType' | 'entityId'> & {
  entityType?: string | null;
  entityId?: string | null;
};

export interface QueuedPhoto {
  captureId: string;
  meta: PendingPhotoMeta;
  state: QueuedPhotoState;
  attempts: number;
  nextAttemptAt: number;
  photoId?: string | null;
  lastError?: string | null;
  lastCode?: string | null;
}

export interface QueueRecord {
  clientUuid: string;
  item: SyncItem;
  state: QueueItemState;
  /** Epoch ms when stored on the phone; batches go oldest first. */
  enqueuedAt: number;
  attempts: number;
  nextAttemptAt: number;
  lastError?: string | null;
  lastCode?: string | null;
  ackedAt?: number | null;
  entityType?: string | null;
  entityId?: string | null;
  receipt?: string | null;
  photos: QueuedPhoto[];
}

/** Storage the core needs. Writes must be durable when the promise resolves. */
export interface SyncQueueStore {
  get(clientUuid: string): Promise<QueueRecord | null>;
  put(record: QueueRecord): Promise<void>;
  delete(clientUuid: string): Promise<void>;
  list(): Promise<QueueRecord[]>;
  getMeta<T>(key: string): Promise<T | null>;
  setMeta<T>(key: string, value: T): Promise<void>;
}

export interface SyncCounts {
  /** Not yet confirmed by the server (record or photos still to send). */
  waiting: number;
  /** Server refused; kept on the phone for the office to resolve. */
  needsAttention: number;
  /** Fully confirmed today (device local day). */
  sentToday: number;
}

const SENT_TODAY_KEY = 'sentToday';

/** Diary/heartbeat items: sent like any other item but not "work" (not shown as waiting, not a logout blocker). */
export const BACKGROUND_KINDS: readonly SyncItemKind[] = ['DEVICE_EVENT', 'HEARTBEAT'];
export function isBackgroundKind(kind: string): boolean {
  return (BACKGROUND_KINDS as readonly string[]).includes(kind);
}
type SentTodayMeta = { day: string; count: number };

/** Delay before retry number `attempt` (1-based): 5s, 10s, 20s, ... capped at 15 min. */
export function backoffDelayMs(attempt: number): number {
  const n = Math.max(1, Math.floor(attempt));
  // 2^18 * 5s already exceeds the cap; avoid huge exponents.
  if (n > 18) return BACKOFF_MAX_MS;
  return Math.min(BACKOFF_BASE_MS * 2 ** (n - 1), BACKOFF_MAX_MS);
}

export function localDayKey(now: number): string {
  const d = new Date(now);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function compareOldestFirst(a: QueueRecord, b: QueueRecord): number {
  if (a.enqueuedAt !== b.enqueuedAt) return a.enqueuedAt - b.enqueuedAt;
  return a.clientUuid < b.clientUuid ? -1 : a.clientUuid > b.clientUuid ? 1 : 0;
}

async function bumpSentToday(store: SyncQueueStore, now: number): Promise<void> {
  const day = localDayKey(now);
  const cur = await store.getMeta<SentTodayMeta>(SENT_TODAY_KEY);
  const count = cur && cur.day === day ? cur.count + 1 : 1;
  await store.setMeta<SentTodayMeta>(SENT_TODAY_KEY, { day, count });
}

/** Removes a fully confirmed record (the only place records are deleted). */
async function removeConfirmed(store: SyncQueueStore, record: QueueRecord, now: number): Promise<void> {
  await store.delete(record.clientUuid);
  if (!isBackgroundKind(record.item.kind)) await bumpSentToday(store, now);
}

export interface EnqueueOptions {
  photos?: Array<{ captureId: string; meta: PendingPhotoMeta }>;
  now?: number;
}

/**
 * Stores an item. Idempotent by clientUuid: an existing record is kept as is
 * (never overwritten, so a resend cannot reset its ACK/photo progress).
 */
export async function enqueue(store: SyncQueueStore, item: SyncItem, opts: EnqueueOptions = {}): Promise<QueueRecord> {
  if (!item.clientUuid) throw new Error('clientUuid is required');
  const existing = await store.get(item.clientUuid);
  if (existing) return existing;
  const now = opts.now ?? Date.now();
  const record: QueueRecord = {
    clientUuid: item.clientUuid,
    item,
    state: 'PENDING',
    enqueuedAt: now,
    attempts: 0,
    nextAttemptAt: 0,
    lastError: null,
    lastCode: null,
    ackedAt: null,
    entityType: null,
    entityId: null,
    receipt: null,
    photos: (opts.photos ?? []).map((p) => ({
      captureId: p.captureId,
      meta: { ...p.meta, captureId: p.captureId },
      state: 'PENDING' as const,
      attempts: 0,
      nextAttemptAt: 0,
      photoId: null,
      lastError: null,
      lastCode: null,
    })),
  };
  await store.put(record);
  return record;
}

export interface NextBatchOptions {
  now?: number;
  limit?: number;
  /**
   * Without mode (or mode SESSION): when set, only this user's items (session cookie: the server
   * only accepts the session user's own items).
   * mode DEVICE: diary/heartbeat items always; business items only when they belong to ownerUserId
   * (the user signed in on the phone now; null = none). The server accepts other owners' work only
   * while they are signed in, so it waits on the phone until they are.
   */
  ownerUserId?: string | null;
  mode?: SyncAuthMode;
}

/** Up to 50 PENDING records, oldest first, skipping records still in backoff. */
export async function nextBatch(store: SyncQueueStore, opts: NextBatchOptions = {}): Promise<QueueRecord[]> {
  const now = opts.now ?? Date.now();
  const limit = Math.max(0, Math.min(opts.limit ?? SYNC_BATCH_MAX_ITEMS, SYNC_BATCH_MAX_ITEMS));
  const all = await store.list();
  return all
    .filter((r) => r.state === 'PENDING' && r.nextAttemptAt <= now)
    .filter((r) => {
      if (opts.mode === 'DEVICE') return isBackgroundKind(r.item.kind) || (opts.ownerUserId != null && r.item.ownerUserId === opts.ownerUserId);
      return opts.ownerUserId == null || r.item.ownerUserId === opts.ownerUserId;
    })
    .sort(compareOldestFirst)
    .slice(0, limit);
}

export interface ApplyOutcome {
  removed: string[];
  photosPending: string[];
  needsAttention: string[];
  retrying: string[];
  /** Diary/heartbeat items the server refused: deleted, not kept as "needs office help". */
  dropped: string[];
}

function emptyOutcome(): ApplyOutcome {
  return { removed: [], photosPending: [], needsAttention: [], retrying: [], dropped: [] };
}

function scheduleRetry(record: QueueRecord, now: number, message: string | null, code: string | null): QueueRecord {
  const attempts = record.attempts + 1;
  return { ...record, attempts, nextAttemptAt: now + backoffDelayMs(attempts), lastError: message, lastCode: code };
}

/**
 * Applies server results for the records that were sent. A sent record with no
 * result in the response is treated as RETRY (never as success).
 */
export async function applyResults(
  store: SyncQueueStore,
  sentClientUuids: readonly string[],
  results: readonly SyncItemResult[],
  now: number = Date.now()
): Promise<ApplyOutcome> {
  const out = emptyOutcome();
  const byId = new Map<string, SyncItemResult>();
  for (const r of results) if (r && typeof r.clientUuid === 'string') byId.set(r.clientUuid, r);

  for (const clientUuid of sentClientUuids) {
    const record = await store.get(clientUuid);
    if (!record || record.state !== 'PENDING') continue;
    const result = byId.get(clientUuid);
    const status = result?.status;

    if (status === 'SAVED' || status === 'DUPLICATE') {
      const acked: QueueRecord = {
        ...record,
        ackedAt: now,
        entityType: result?.entityType ?? record.entityType ?? null,
        entityId: result?.entityId ?? record.entityId ?? null,
        receipt: result?.receipt ?? record.receipt ?? null,
        lastError: null,
        lastCode: null,
      };
      const pendingPhotos = acked.photos.filter((p) => p.state !== 'DONE');
      if (pendingPhotos.length === 0) {
        await removeConfirmed(store, record, now);
        out.removed.push(clientUuid);
      } else if (!acked.entityId) {
        // Photos cannot be linked without the server record id: office must look.
        await store.put({ ...acked, state: 'NEEDS_ATTENTION', lastCode: 'MISSING_ENTITY_ID', lastError: 'Saved, but photos could not be linked.' });
        out.needsAttention.push(clientUuid);
      } else {
        await store.put({ ...acked, state: 'PHOTOS_PENDING', attempts: 0, nextAttemptAt: 0 });
        out.photosPending.push(clientUuid);
      }
    } else if (status === 'REJECTED' && isBackgroundKind(record.item.kind)) {
      // Diary/heartbeat is not business work: never keep it as "needs office help".
      await store.delete(clientUuid);
      out.dropped.push(clientUuid);
    } else if (status === 'REJECTED') {
      await store.put({
        ...record,
        state: 'NEEDS_ATTENTION',
        attempts: record.attempts + 1,
        lastError: result?.message ?? 'Rejected by server',
        lastCode: result?.code ?? 'REJECTED',
      });
      out.needsAttention.push(clientUuid);
    } else {
      const msg = status === 'RETRY' ? result?.message ?? 'Server asked to retry' : 'No result from server';
      await store.put(scheduleRetry(record, now, msg, result?.code ?? 'RETRY'));
      out.retrying.push(clientUuid);
    }
  }
  return out;
}

/** Network failure / bad HTTP response for a whole batch: keep everything, back off. */
export async function applyBatchFailure(
  store: SyncQueueStore,
  sentClientUuids: readonly string[],
  message: string,
  now: number = Date.now()
): Promise<ApplyOutcome> {
  const out = emptyOutcome();
  for (const clientUuid of sentClientUuids) {
    const record = await store.get(clientUuid);
    if (!record || record.state !== 'PENDING') continue;
    await store.put(scheduleRetry(record, now, message, 'NETWORK'));
    out.retrying.push(clientUuid);
  }
  return out;
}

/**
 * Deletes diary/heartbeat items left as NEEDS_ATTENTION by older app versions
 * (before refused background items were dropped). Business items are never touched.
 */
export async function purgeRejectedBackground(store: SyncQueueStore): Promise<number> {
  let n = 0;
  for (const r of await store.list()) {
    if (r.state === 'NEEDS_ATTENTION' && isBackgroundKind(r.item.kind)) {
      await store.delete(r.clientUuid);
      n++;
    }
  }
  return n;
}

// -------------------------------------------------------------
// Whole-batch HTTP answers
// -------------------------------------------------------------

/** 'DEVICE' = x-device-uid / x-device-key headers; 'SESSION' = session cookie only. */
export type SyncAuthMode = 'DEVICE' | 'SESSION';

export type BatchHttpVerdict =
  | { kind: 'OK' }
  /** 403 DEVICE_NOT_ACTIVE: the office blocked / released this phone (or it is not active yet). Keep everything. */
  | { kind: 'DEVICE_BLOCKED'; deviceStatus: DeviceStatus | null; message: string }
  /** 401 in device mode: key not recognised. Keep everything; fall back to the session cookie. */
  | { kind: 'DEVICE_KEY_REJECTED'; message: string }
  /** 401 in session mode: signed out / session expired. Keep everything. */
  | { kind: 'SESSION_EXPIRED'; message: string }
  /** Anything else that is not 2xx: keep everything, back off. */
  | { kind: 'RETRY'; message: string };

const DEVICE_STATUSES: readonly DeviceStatus[] = ['PENDING', 'ACTIVE', 'BLOCKED', 'RELEASED'];

/** Plain-English text for a phone that is not allowed to send. */
export function deviceBlockedMessage(status: DeviceStatus | null): string {
  if (status === 'RELEASED') return 'This phone was released. Ask the office.';
  if (status === 'PENDING') return 'This phone is not switched on yet. Ask the office.';
  return 'This phone is blocked. Ask the office.';
}

export function classifyBatchHttp(httpStatus: number, body: unknown, mode: SyncAuthMode): BatchHttpVerdict {
  if (httpStatus >= 200 && httpStatus < 300) return { kind: 'OK' };
  const rec = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  const code = typeof rec.code === 'string' ? rec.code : '';
  if (httpStatus === 403 && (code === 'DEVICE_NOT_ACTIVE' || (mode === 'DEVICE' && typeof rec.deviceStatus === 'string'))) {
    const raw = rec.deviceStatus;
    const deviceStatus = typeof raw === 'string' && (DEVICE_STATUSES as readonly string[]).includes(raw) ? (raw as DeviceStatus) : null;
    return { kind: 'DEVICE_BLOCKED', deviceStatus, message: deviceBlockedMessage(deviceStatus) };
  }
  if (httpStatus === 401 && mode === 'DEVICE') {
    return { kind: 'DEVICE_KEY_REJECTED', message: 'This phone key is not recognised. Ask the office.' };
  }
  if (httpStatus === 401) return { kind: 'SESSION_EXPIRED', message: 'Please log in again.' };
  return { kind: 'RETRY', message: `Server error (${httpStatus})` };
}

export type BatchTransportResult = { ok: true; httpStatus: number; body: unknown } | { ok: false; networkError: string };

export interface SendQueuedBatchesOptions {
  mode: SyncAuthMode;
  /** User signed in on the phone now. Session mode: only their items. Device mode: their business items + all diary/heartbeat. */
  ownerUserId: string | null;
  deviceUid: string;
  appVersion: string;
  maxBatches: number;
  /** Posts one batch to /api/sync/batch. Must not throw (report network errors as ok:false). */
  send(body: SyncBatchRequest): Promise<BatchTransportResult>;
  now?: () => number;
}

export interface SendQueuedBatchesResult {
  sent: number;
  saved: number;
  savedByKind: Partial<Record<SyncItemKind, number>>;
  rejected: number;
  retrying: number;
  dropped: number;
  /** Why sending stopped early (undefined = queue drained or batch limit reached). */
  stop?: 'NETWORK' | 'RETRY' | 'DEVICE_BLOCKED' | 'DEVICE_KEY_REJECTED' | 'SESSION_EXPIRED';
  stopMessage?: string;
  httpStatus?: number;
  /** deviceStatus from a 200 answer (device mode) or a 403 DEVICE_NOT_ACTIVE answer. */
  deviceStatus?: DeviceStatus | null;
}

/**
 * Sends due items in batches of up to 50 and applies the answers.
 * 401 / 403 answers leave every item exactly as it was (nothing deleted, no backoff).
 */
export async function sendQueuedBatches(store: SyncQueueStore, opts: SendQueuedBatchesOptions): Promise<SendQueuedBatchesResult> {
  const now = opts.now ?? Date.now;
  const out: SendQueuedBatchesResult = { sent: 0, saved: 0, savedByKind: {}, rejected: 0, retrying: 0, dropped: 0 };
  if (opts.mode === 'SESSION' && !opts.ownerUserId) return out;
  for (let i = 0; i < opts.maxBatches; i++) {
    const batch = await nextBatch(store, { now: now(), limit: SYNC_BATCH_MAX_ITEMS, mode: opts.mode, ownerUserId: opts.ownerUserId });
    if (batch.length === 0) return out;
    const ids = batch.map((r) => r.clientUuid);
    out.sent += batch.length;
    const res = await opts.send({
      deviceUid: opts.deviceUid,
      appVersion: opts.appVersion,
      deviceSentAt: new Date(now()).toISOString(),
      items: batch.map((r) => r.item),
    });

    if (!res.ok) {
      await applyBatchFailure(store, ids, res.networkError, now());
      out.retrying += ids.length;
      out.stop = 'NETWORK';
      out.stopMessage = res.networkError;
      return out;
    }

    const verdict = classifyBatchHttp(res.httpStatus, res.body, opts.mode);
    if (verdict.kind !== 'OK') {
      out.httpStatus = res.httpStatus;
      out.stopMessage = verdict.message;
      if (verdict.kind === 'RETRY') {
        await applyBatchFailure(store, ids, verdict.message, now());
        out.retrying += ids.length;
        out.stop = 'RETRY';
      } else {
        // Auth answers: nothing was processed; leave every item untouched.
        out.sent -= batch.length;
        out.stop = verdict.kind;
        if (verdict.kind === 'DEVICE_BLOCKED') out.deviceStatus = verdict.deviceStatus;
      }
      return out;
    }

    const data = (res.body ?? null) as Partial<SyncBatchResponse> | null;
    if (opts.mode === 'DEVICE' && data && typeof data.deviceStatus === 'string') out.deviceStatus = data.deviceStatus;
    const results = Array.isArray(data?.results) ? data.results : [];
    const outcome = await applyResults(store, ids, results, now());
    const savedIds = new Set([...outcome.removed, ...outcome.photosPending]);
    for (const r of batch) {
      if (!savedIds.has(r.clientUuid)) continue;
      out.saved++;
      out.savedByKind[r.item.kind] = (out.savedByKind[r.item.kind] ?? 0) + 1;
    }
    out.rejected += outcome.needsAttention.length;
    out.retrying += outcome.retrying.length;
    out.dropped += outcome.dropped.length;
    // Server asked to retry everything: stop for this run.
    if (outcome.retrying.length === ids.length) return out;
  }
  return out;
}

export interface PhotoUploadTask {
  clientUuid: string;
  captureId: string;
  /** Owner of the queue item (sent as form field ownerUserId; required on shared-station devices). */
  ownerUserId: string;
  meta: CapturedPhotoMeta;
}

/** Photos ready to upload: record ACKed, photo pending, photo not in backoff. Oldest first. */
/** ownerUserId (session-cookie uploads): only that user's photos; the server refuses others. */
export async function pendingPhotoUploads(
  store: SyncQueueStore,
  now: number = Date.now(),
  limit = 20,
  ownerUserId: string | null = null
): Promise<PhotoUploadTask[]> {
  const all = (await store.list())
    .filter((r) => r.state === 'PHOTOS_PENDING' && r.entityId)
    .filter((r) => ownerUserId == null || r.item.ownerUserId === ownerUserId)
    .sort(compareOldestFirst);
  const tasks: PhotoUploadTask[] = [];
  for (const r of all) {
    for (const p of r.photos) {
      if (p.state !== 'PENDING' || p.nextAttemptAt > now) continue;
      tasks.push({
        clientUuid: r.clientUuid,
        captureId: p.captureId,
        ownerUserId: r.item.ownerUserId,
        meta: {
          ...p.meta,
          captureId: p.captureId,
          entityType: p.meta.entityType || r.entityType || r.item.kind,
          entityId: String(p.meta.entityId || r.entityId),
          requestedAs: p.meta.requestedAs ?? r.item.requestedAs ?? null,
        },
      });
      if (tasks.length >= limit) return tasks;
    }
  }
  return tasks;
}

export type PhotoUploadOutcome =
  | { kind: 'OK'; result: Pick<CapturedPhotoUploadResult, 'status' | 'photoId'> }
  | { kind: 'RETRY'; message: string }
  | { kind: 'REJECTED'; code: string; message: string };

/** 403 codes meaning "this user may not attach this photo" (will not fix itself by retrying). */
export const PHOTO_SCOPE_CODES: readonly string[] = ['NO_SCOPE_BOUND', 'OUTSIDE_SCOPE', 'SOURCE_TYPE_MISMATCH', 'CANNOT_ACT_AS', 'FORBIDDEN'];

export type PhotoHttpVerdict =
  | { kind: 'RETRY'; message: string }
  | { kind: 'REJECTED'; code: string; message: string }
  /** Phone blocked / not active: keep the photo untouched and stop uploading. */
  | { kind: 'BLOCKED'; deviceStatus: DeviceStatus | null; message: string };

/** Maps a non-2xx /api/photos answer. */
export function classifyPhotoHttp(httpStatus: number, body: unknown): PhotoHttpVerdict {
  const rec = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  const code = typeof rec.code === 'string' ? rec.code : '';
  const error = typeof rec.error === 'string' ? rec.error : '';
  if (httpStatus === 403) {
    if (PHOTO_SCOPE_CODES.includes(code)) return { kind: 'REJECTED', code, message: error || 'Photo refused by server' };
    if (code === 'DEVICE_NOT_ACTIVE' || typeof rec.deviceStatus === 'string') {
      const raw = rec.deviceStatus;
      const deviceStatus = typeof raw === 'string' && (DEVICE_STATUSES as readonly string[]).includes(raw) ? (raw as DeviceStatus) : null;
      return { kind: 'BLOCKED', deviceStatus, message: deviceBlockedMessage(deviceStatus) };
    }
    return { kind: 'RETRY', message: error || 'Server error (403)' };
  }
  if (httpStatus === 401 || httpStatus === 408 || httpStatus === 429 || httpStatus >= 500) {
    return { kind: 'RETRY', message: error || `Server error (${httpStatus})` };
  }
  return { kind: 'REJECTED', code: code || `HTTP_${httpStatus}`, message: error || 'Photo refused by server' };
}

/**
 * Applies one photo upload outcome. Returns whether the whole record is now removed
 * and whether the photo is confirmed (so the caller may delete the local photo file).
 */
export async function applyPhotoResult(
  store: SyncQueueStore,
  clientUuid: string,
  captureId: string,
  outcome: PhotoUploadOutcome,
  now: number = Date.now()
): Promise<{ photoConfirmed: boolean; recordRemoved: boolean }> {
  const record = await store.get(clientUuid);
  if (!record) return { photoConfirmed: false, recordRemoved: false };
  const idx = record.photos.findIndex((p) => p.captureId === captureId);
  if (idx < 0) return { photoConfirmed: false, recordRemoved: false };
  const photo = record.photos[idx];
  const photos = record.photos.slice();

  if (outcome.kind === 'OK' && (outcome.result.status === 'SAVED' || outcome.result.status === 'DUPLICATE')) {
    photos[idx] = { ...photo, state: 'DONE', photoId: outcome.result.photoId ?? null, lastError: null, lastCode: null };
    if (photos.every((p) => p.state === 'DONE') && record.state !== 'NEEDS_ATTENTION') {
      await removeConfirmed(store, record, now);
      return { photoConfirmed: true, recordRemoved: true };
    }
    await store.put(settlePhotos(record, photos));
    return { photoConfirmed: true, recordRemoved: false };
  }

  if (outcome.kind === 'REJECTED') {
    // Only this photo needs office help; the record's other photos keep uploading. Never deleted.
    photos[idx] = { ...photo, state: 'REJECTED', attempts: photo.attempts + 1, lastError: outcome.message, lastCode: outcome.code };
    await store.put(settlePhotos(record, photos));
    return { photoConfirmed: false, recordRemoved: false };
  }

  const message = outcome.kind === 'RETRY' ? outcome.message : 'Unexpected upload result';
  const attempts = photo.attempts + 1;
  photos[idx] = { ...photo, attempts, nextAttemptAt: now + backoffDelayMs(attempts), lastError: message, lastCode: 'RETRY' };
  await store.put({ ...record, photos });
  return { photoConfirmed: false, recordRemoved: false };
}

/**
 * Record state after a photo changed: PHOTOS_PENDING while any photo still waits to upload;
 * NEEDS_ATTENTION once nothing waits and at least one photo was refused.
 */
function settlePhotos(record: QueueRecord, photos: QueuedPhoto[]): QueueRecord {
  if (record.state === 'NEEDS_ATTENTION') return { ...record, photos };
  if (photos.some((p) => p.state === 'PENDING')) return { ...record, photos, state: 'PHOTOS_PENDING' };
  const refused = photos.filter((p) => p.state === 'REJECTED');
  if (refused.length === 0) return { ...record, photos };
  const last = refused[refused.length - 1];
  return {
    ...record,
    photos,
    state: 'NEEDS_ATTENTION',
    lastError: refused.length === 1 ? last.lastError ?? 'Photo refused by server' : `${refused.length} photos refused by server`,
    lastCode: last.lastCode ?? 'PHOTO_REJECTED',
  };
}

/** Work counts (diary/heartbeat items are left out). */
export function countRecords(records: readonly QueueRecord[]): Pick<SyncCounts, 'waiting' | 'needsAttention'> {
  let waiting = 0;
  let needsAttention = 0;
  for (const r of records) {
    if (isBackgroundKind(r.item.kind)) continue;
    if (r.state === 'NEEDS_ATTENTION') needsAttention++;
    else waiting++;
  }
  return { waiting, needsAttention };
}

export async function getCounts(store: SyncQueueStore, now: number = Date.now()): Promise<SyncCounts> {
  const records = await store.list();
  const meta = await store.getMeta<SentTodayMeta>(SENT_TODAY_KEY);
  const sentToday = meta && meta.day === localDayKey(now) ? meta.count : 0;
  return { ...countRecords(records), sentToday };
}

/** Earliest time any work becomes due (for scheduling); null when nothing is waiting. */
export async function nextDueAt(store: SyncQueueStore): Promise<number | null> {
  let best: number | null = null;
  for (const r of await store.list()) {
    if (r.state === 'PENDING') best = best == null ? r.nextAttemptAt : Math.min(best, r.nextAttemptAt);
    else if (r.state === 'PHOTOS_PENDING') {
      for (const p of r.photos) if (p.state === 'PENDING') best = best == null ? p.nextAttemptAt : Math.min(best, p.nextAttemptAt);
    }
  }
  return best;
}

/** In-memory store for tests and for environments without IndexedDB. Deep-copies on read/write. */
export function createMemorySyncStore(): SyncQueueStore & { size(): number } {
  const rows = new Map<string, QueueRecord>();
  const meta = new Map<string, unknown>();
  const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
  return {
    async get(id) {
      const r = rows.get(id);
      return r ? clone(r) : null;
    },
    async put(r) {
      rows.set(r.clientUuid, clone(r));
    },
    async delete(id) {
      rows.delete(id);
    },
    async list() {
      return Array.from(rows.values()).map(clone);
    },
    async getMeta<T>(key: string) {
      return meta.has(key) ? clone(meta.get(key) as T) : null;
    },
    async setMeta<T>(key: string, value: T) {
      meta.set(key, clone(value));
    },
    size() {
      return rows.size;
    },
  };
}
