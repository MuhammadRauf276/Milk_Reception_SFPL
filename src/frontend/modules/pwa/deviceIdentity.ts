/**
 * Device identity for offline sync (client only; safe to import on the server/tests: no top-level window use).
 * - deviceUid: stable random id, kept in localStorage and mirrored in IndexedDB so either can restore it.
 * - device sync key: given once by the office (QR / registration screen) via saveDeviceKey(key).
 * - active owner: the signed-in user id, so queued work records who did it even if saved offline.
 */
import { DEVICE_KEY_HEADER, DEVICE_UID_HEADER, type DeviceStatus } from '@/types/device';

const DB_NAME = 'milk_device_identity';
const DB_VERSION = 1;
const STORE = 'kv';
const LS_UID = 'milk_device_uid';
const LS_KEY = 'milk_device_sync_key';
const LS_OWNER = 'milk_sync_owner_user_id';
const KEY_MAX_LENGTH = 512;

function hasWindow(): boolean {
  return typeof window !== 'undefined';
}

function lsGet(name: string): string | null {
  if (!hasWindow()) return null;
  try {
    return window.localStorage.getItem(name);
  } catch {
    return null;
  }
}

function lsSet(name: string, value: string | null): void {
  if (!hasWindow()) return;
  try {
    if (value == null) window.localStorage.removeItem(name);
    else window.localStorage.setItem(name, value);
  } catch {
    // Storage full / blocked: IndexedDB copy still holds it.
  }
}

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (!hasWindow() || !window.indexedDB) return resolve(null);
    try {
      const req = window.indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function idbGet(name: string): Promise<string | null> {
  const db = await openDb();
  if (!db) return null;
  try {
    return await new Promise<string | null>((resolve) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(name);
      req.onsuccess = () => resolve(typeof req.result === 'string' ? req.result : null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  } finally {
    db.close();
  }
}

async function idbSet(name: string, value: string | null): Promise<void> {
  const db = await openDb();
  if (!db) return;
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      if (value == null) tx.objectStore(STORE).delete(name);
      else tx.objectStore(STORE).put(value, name);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } catch {
    // localStorage copy still holds it.
  } finally {
    db.close();
  }
}

function newUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const rnd = () => Math.random().toString(16).slice(2, 10);
  return `${rnd()}-${rnd().slice(0, 4)}-4${rnd().slice(0, 3)}-a${rnd().slice(0, 3)}-${rnd()}${rnd().slice(0, 4)}`;
}

let uidPromise: Promise<string> | null = null;

/** Stable id of this phone/PC. Created once and never changed (unless the browser wipes both copies). */
export function getDeviceUid(): Promise<string> {
  if (!uidPromise) {
    uidPromise = (async () => {
      const fromLs = lsGet(LS_UID);
      const fromIdb = await idbGet(LS_UID);
      const uid = fromLs || fromIdb || newUuid();
      if (fromLs !== uid) lsSet(LS_UID, uid);
      if (fromIdb !== uid) await idbSet(LS_UID, uid);
      return uid;
    })().catch((err) => {
      uidPromise = null;
      throw err;
    });
  }
  return uidPromise;
}

/** Saves the sync key the office gave this device (from the QR / registration helper). */
export async function saveDeviceKey(key: string): Promise<void> {
  const clean = String(key ?? '').trim();
  if (!clean || clean.length > KEY_MAX_LENGTH || /\s/.test(clean)) throw new Error('Invalid device key');
  lsSet(LS_KEY, clean);
  await idbSet(LS_KEY, clean);
  setDeviceSyncState(null);
  if (hasWindow()) window.dispatchEvent(new CustomEvent('milk-device-key-changed'));
}

export async function getDeviceKey(): Promise<string | null> {
  const fromLs = lsGet(LS_KEY);
  if (fromLs) return fromLs;
  const fromIdb = await idbGet(LS_KEY);
  if (fromIdb) lsSet(LS_KEY, fromIdb);
  return fromIdb;
}

/** Synchronous best-effort check (localStorage copy). Use getDeviceKey() when exactness matters. */
export function hasDeviceKeySync(): boolean {
  return Boolean(lsGet(LS_KEY));
}

export async function hasDeviceKey(): Promise<boolean> {
  return Boolean(await getDeviceKey());
}

/** Removes the stored key (e.g. office re-registers the device). Never touches queued work. */
export async function clearDeviceKey(): Promise<void> {
  lsSet(LS_KEY, null);
  await idbSet(LS_KEY, null);
  setDeviceSyncState(null);
  if (hasWindow()) window.dispatchEvent(new CustomEvent('milk-device-key-changed'));
}

/** Device auth headers when a key is stored; empty object otherwise (session cookie is used). */
export async function getDeviceAuthHeaders(): Promise<Record<string, string>> {
  const key = await getDeviceKey();
  if (!key) return {};
  return { [DEVICE_UID_HEADER]: await getDeviceUid(), [DEVICE_KEY_HEADER]: key };
}

/** Asks the browser not to evict our offline data under storage pressure. */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (typeof navigator === 'undefined' || !navigator.storage?.persist) return false;
    if (navigator.storage.persisted && (await navigator.storage.persisted())) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

// -------------------------------------------------------------
// Last known server answer about this phone's key
// -------------------------------------------------------------

const LS_DEVICE_STATE = 'milk_device_sync_state';
/** Fired on window with detail DeviceSyncState whenever the state changes. */
export const DEVICE_SYNC_STATE_EVENT = 'milk-device-sync-state';

export interface DeviceSyncState {
  /** OK = server accepted the key; BLOCKED = 403 DEVICE_NOT_ACTIVE; KEY_REJECTED = 401. */
  state: 'OK' | 'BLOCKED' | 'KEY_REJECTED';
  deviceStatus: DeviceStatus | null;
  message: string | null;
  /** Epoch ms of the answer. */
  at: number;
}

export function getDeviceSyncState(): DeviceSyncState | null {
  const raw = lsGet(LS_DEVICE_STATE);
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<DeviceSyncState>;
    if (v.state !== 'OK' && v.state !== 'BLOCKED' && v.state !== 'KEY_REJECTED') return null;
    return { state: v.state, deviceStatus: v.deviceStatus ?? null, message: v.message ?? null, at: Number(v.at) || 0 };
  } catch {
    return null;
  }
}

export function setDeviceSyncState(next: DeviceSyncState | null): void {
  const prev = getDeviceSyncState();
  lsSet(LS_DEVICE_STATE, next ? JSON.stringify(next) : null);
  const changed = (prev?.state ?? null) !== (next?.state ?? null) || (prev?.deviceStatus ?? null) !== (next?.deviceStatus ?? null);
  if (changed && hasWindow()) window.dispatchEvent(new CustomEvent(DEVICE_SYNC_STATE_EVENT, { detail: next }));
}

/** The signed-in user id work is attributed to (set by PwaShell after /api/auth/me). */
export function getActiveOwnerUserId(): string | null {
  return lsGet(LS_OWNER);
}

export function setActiveOwnerUserId(userId: string | null): void {
  lsSet(LS_OWNER, userId ? String(userId) : null);
}
