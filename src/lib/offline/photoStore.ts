/**
 * Offline Photo Store using IndexedDB
 * Persists live camera photos (LR & FAT only) for offline resilience.
 *
 * Phase 3: photos can also be stored as a Blob keyed by captureId and linked to the
 * offline sync queue item (clientUuid) that owns them. The sync engine reads them by
 * captureId and deletes a photo only after the server confirmed its upload.
 */

const DB_NAME = 'milk_reception_lab_photos';
const DB_VERSION = 2;
const STORE_NAME = 'photos';
const CLIENT_UUID_INDEX = 'clientUuid';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      return reject(new Error('IndexedDB not supported in current environment.'));
    }
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = () => {
      const db = request.result;
      const store = db.objectStoreNames.contains(STORE_NAME)
        ? request.transaction!.objectStore(STORE_NAME)
        : db.createObjectStore(STORE_NAME, { keyPath: 'key' });
      if (!store.indexNames.contains(CLIENT_UUID_INDEX)) {
        store.createIndex(CLIENT_UUID_INDEX, CLIENT_UUID_INDEX, { unique: false });
      }
    };
  });
}

export interface StoredPhoto {
  key: string;
  dataUrl: string;
  timestamp: string;
  testType: string;
}

/** Photo kept by captureId (key === captureId), optionally linked to a sync queue item. */
export interface CapturedPhotoRecord {
  key: string;
  captureId: string;
  blob: Blob;
  mimeType: string;
  timestamp: string;
  testType: string;
  /** clientUuid of the offline sync queue item that uploads this photo. */
  clientUuid?: string | null;
  dataUrl?: string;
}

function blobToDataUrl(blob: Blob): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    } catch {
      resolve(null);
    }
  });
}

/**
 * Saves a captured photo by captureId. Resolves only after the write is committed,
 * so callers can enqueue the sync item knowing the photo is on the phone. Throws on failure.
 */
export async function saveCapturedPhoto(input: {
  captureId: string;
  blob: Blob;
  testType?: string;
  clientUuid?: string | null;
}): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const record: CapturedPhotoRecord = {
        key: input.captureId,
        captureId: input.captureId,
        blob: input.blob,
        mimeType: input.blob.type || 'image/jpeg',
        timestamp: new Date().toISOString(),
        testType: input.testType ?? '',
        clientUuid: input.clientUuid ?? null,
      };
      tx.objectStore(STORE_NAME).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/** Links an already-saved photo to the sync queue item that will upload it. */
export async function linkPhotoToQueueItem(captureId: string, clientUuid: string): Promise<boolean> {
  const db = await openDb();
  try {
    return await new Promise<boolean>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      let found = false;
      const req = store.get(captureId);
      req.onsuccess = () => {
        const rec = req.result as (CapturedPhotoRecord | StoredPhoto) | undefined;
        if (rec) {
          found = true;
          store.put({ ...rec, clientUuid });
        }
      };
      tx.oncomplete = () => resolve(found);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/** Reads a captured photo as a Blob (also converts old dataUrl-only records). Null if missing. */
export async function getCapturedPhotoBlob(captureId: string): Promise<Blob | null> {
  try {
    const db = await openDb();
    try {
      const rec = await new Promise<(Partial<CapturedPhotoRecord> & { dataUrl?: string }) | undefined>((resolve) => {
        const req = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(captureId);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(undefined);
      });
      if (!rec) return null;
      if (rec.blob instanceof Blob) return rec.blob;
      if (rec.dataUrl) return await (await fetch(rec.dataUrl)).blob();
      return null;
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

/** captureIds of photos linked to a sync queue item. */
export async function getPhotoIdsForQueueItem(clientUuid: string): Promise<string[]> {
  try {
    const db = await openDb();
    try {
      return await new Promise<string[]>((resolve) => {
        const req = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).index(CLIENT_UUID_INDEX).getAllKeys(clientUuid);
        req.onsuccess = () => resolve((req.result || []).map(String));
        req.onerror = () => resolve([]);
      });
    } finally {
      db.close();
    }
  } catch {
    return [];
  }
}

export async function savePhotoToStore(key: string, dataUrl: string, testType: string): Promise<void> {
  try {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const record: StoredPhoto = {
        key,
        dataUrl,
        timestamp: new Date().toISOString(),
        testType,
      };
      const req = store.put(record);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn('[PhotoStore] Failed to save photo to IndexedDB:', err);
  }
}

export async function getPhotoFromStore(key: string): Promise<string | null> {
  try {
    const db = await openDb();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(key);
      req.onsuccess = () => {
        const result = req.result as (StoredPhoto | CapturedPhotoRecord) | undefined;
        if (result?.dataUrl) return resolve(result.dataUrl);
        // Blob records (saved by captureId) are converted so the old API keeps working.
        if (result && 'blob' in result && result.blob instanceof Blob) {
          void blobToDataUrl(result.blob).then(resolve);
          return;
        }
        resolve(null);
      };
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export async function deletePhotoFromStore(key: string): Promise<void> {
  try {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch {
    // Ignore deletion errors in offline store
  }
}

/** Deletes a captured photo by captureId. Call only after the server confirmed the upload. */
export async function deleteCapturedPhoto(captureId: string): Promise<void> {
  await deletePhotoFromStore(captureId);
}
