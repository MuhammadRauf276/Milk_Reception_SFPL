/**
 * Offline Photo Store using IndexedDB
 * Persists live camera photos (LR & FAT only) for offline resilience.
 */

const DB_NAME = 'milk_reception_lab_photos';
const DB_VERSION = 1;
const STORE_NAME = 'photos';

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
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'key' });
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
        const result = req.result as StoredPhoto | undefined;
        resolve(result?.dataUrl || null);
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
