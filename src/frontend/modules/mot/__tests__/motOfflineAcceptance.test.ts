import test, { describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// In-Memory IDB polyfill for Node test environment
class MockIDBRequest {
  result: any = null;
  error: any = null;
  onsuccess: ((ev: any) => void) | null = null;
  onerror: ((ev: any) => void) | null = null;
  onupgradeneeded: ((ev: any) => void) | null = null;
  transaction: any = null;
}

class MockIDBObjectStore {
  name: string;
  keyPath: string | null;
  autoIncrement: boolean;
  records = new Map<any, any>();
  autoId = 1;
  indexes = new Map<string, { name: string; keyPath: string }>();

  constructor(name: string, options?: { keyPath?: string; autoIncrement?: boolean }) {
    this.name = name;
    this.keyPath = options?.keyPath ?? null;
    this.autoIncrement = options?.autoIncrement ?? false;
  }

  createIndex(name: string, keyPath: string, _opts?: any) {
    this.indexes.set(name, { name, keyPath });
  }

  get indexNames() {
    return {
      contains: (n: string) => this.indexes.has(n),
    };
  }

  index(name: string) {
    const idx = this.indexes.get(name);
    return {
      getAllKeys: (query?: any) => {
        const req = new MockIDBRequest();
        queueMicrotask(() => {
          const keys: any[] = [];
          for (const [k, v] of this.records.entries()) {
            if (query === undefined || (idx && v && v[idx.keyPath] === query)) {
              keys.push(k);
            }
          }
          req.result = keys;
          req.onsuccess?.({ target: req });
        });
        return req;
      },
      getAll: (query?: any) => {
        const req = new MockIDBRequest();
        queueMicrotask(() => {
          const res: any[] = [];
          for (const [, v] of this.records.entries()) {
            if (query === undefined || (idx && v && v[idx.keyPath] === query)) {
              res.push(JSON.parse(JSON.stringify(v)));
            }
          }
          req.result = res;
          req.onsuccess?.({ target: req });
        });
        return req;
      },
    };
  }

  put(value: any, key?: any) {
    let k = key;
    if (this.keyPath && value && typeof value === 'object') {
      k = value[this.keyPath];
    }
    if (k === undefined && this.autoIncrement) {
      k = this.autoId++;
      if (this.keyPath && value && typeof value === 'object') {
        value[this.keyPath] = k;
      }
    }
    this.records.set(k, JSON.parse(JSON.stringify(value)));
    const req = new MockIDBRequest();
    req.result = k;
    queueMicrotask(() => req.onsuccess?.({ target: req }));
    return req;
  }

  get(key: any) {
    const req = new MockIDBRequest();
    queueMicrotask(() => {
      const val = this.records.get(key);
      req.result = val ? JSON.parse(JSON.stringify(val)) : undefined;
      req.onsuccess?.({ target: req });
    });
    return req;
  }

  getAll() {
    const req = new MockIDBRequest();
    queueMicrotask(() => {
      req.result = Array.from(this.records.values()).map((v) => JSON.parse(JSON.stringify(v)));
      req.onsuccess?.({ target: req });
    });
    return req;
  }

  delete(key: any) {
    this.records.delete(key);
    const req = new MockIDBRequest();
    queueMicrotask(() => req.onsuccess?.({ target: req }));
    return req;
  }

  clear() {
    this.records.clear();
    const req = new MockIDBRequest();
    queueMicrotask(() => req.onsuccess?.({ target: req }));
    return req;
  }
}

class MockIDBDatabase {
  name: string;
  version: number;
  stores = new Map<string, MockIDBObjectStore>();

  constructor(name: string, version: number) {
    this.name = name;
    this.version = version;
  }

  get objectStoreNames() {
    return {
      contains: (n: string) => this.stores.has(n),
      filter: (cb: (n: string) => boolean) => Array.from(this.stores.keys()).filter(cb),
    };
  }

  createObjectStore(name: string, options?: { keyPath?: string; autoIncrement?: boolean }) {
    const store = new MockIDBObjectStore(name, options);
    this.stores.set(name, store);
    return store;
  }

  deleteObjectStore(name: string) {
    this.stores.delete(name);
  }

  transaction(storeNames: string | string[], _mode?: string) {
    const names = Array.isArray(storeNames) ? storeNames : [storeNames];
    const tx = {
      oncomplete: null as (() => void) | null,
      onerror: null as ((err: any) => void) | null,
      onabort: null as ((err: any) => void) | null,
      error: null,
      objectStore: (n: string) => {
        const store = this.stores.get(n);
        if (!store) throw new Error(`Store not found: ${n}`);
        return store;
      },
    };
    queueMicrotask(() => {
      tx.oncomplete?.();
    });
    return tx;
  }

  close() {}
}

const mockDatabases = new Map<string, MockIDBDatabase>();

const mockIndexedDB = {
  open(name: string, version: number) {
    const req = new MockIDBRequest();
    queueMicrotask(() => {
      let db = mockDatabases.get(name);
      const isNew = !db;
      if (!db) {
        db = new MockIDBDatabase(name, version);
        mockDatabases.set(name, db);
      }
      req.result = db;
      if (isNew && req.onupgradeneeded) {
        req.onupgradeneeded({
          target: req,
          oldVersion: 0,
          newVersion: version,
        });
      }
      req.onsuccess?.({ target: req });
    });
    return req;
  },
};

const mockLocalStorage = {
  data: new Map<string, string>(),
  getItem(key: string) {
    return this.data.has(key) ? this.data.get(key)! : null;
  },
  setItem(key: string, value: string) {
    this.data.set(key, String(value));
  },
  removeItem(key: string) {
    this.data.delete(key);
  },
  clear() {
    this.data.clear();
  },
};

// Install browser-like mocks globally for test execution
(globalThis as any).indexedDB = mockIndexedDB;
(globalThis as any).window = globalThis;
(globalThis as any).localStorage = mockLocalStorage;
try {
  Object.defineProperty(globalThis, 'window', { value: globalThis, configurable: true, writable: true });
} catch {}
try {
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true, writable: true });
  Object.defineProperty(navigator, 'geolocation', {
    value: {
      getCurrentPosition: () => {},
      watchPosition: () => 1,
      clearWatch: () => {},
    },
    configurable: true,
    writable: true,
  });
} catch {}

import {
  saveCachedJourney,
  getCachedJourney,
  saveMotOfflinePreparation,
  getMotOfflinePreparation,
  clearMotSessionCache,
  saveDraft,
  getDraft,
  deleteDraft,
  queueCollection,
  getQueuedCollections,
  updateCollectionQueueStatus,
  cacheAvailableSources,
  getCachedAvailableSources,
  cacheMotShopPolicy,
  getCachedMotShopPolicy,
  motCollectionRequestBody,
} from '../offlineStore';
import { resolveCurrentJourney } from '../journey/resolveJourney';
import { setActiveOwnerUserId, getActiveOwnerUserId } from '@/frontend/modules/pwa/deviceIdentity';
import type { MotShopPolicySnapshot } from '@/types/stage1-decision';

function setOnline(online: boolean) {
  Object.defineProperty(navigator, 'onLine', { value: online, configurable: true, writable: true });
}

describe('MOT Offline Acceptance & Synchronization Lifecycle Suite', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    mockDatabases.clear();
    mockLocalStorage.clear();
    setActiveOwnerUserId('user-mot-1');
    setOnline(true);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('ACC-01: Online journey preparation persists journey, stops, sources, policy, and 8-hour token', async () => {
    const sampleJourney = {
      id: 'journey-901',
      journey_number: 'J-2026-901',
      operational_date: '2026-11-01',
      status: 'COLLECTING',
      zmcc: { id: 'zmcc-1', code: 'ZM01', name: 'Jhang Central ZMCC' },
      route: { id: 'route-5', route_code: 'R-05', name: 'Kot Lakhpat Route' },
      mot_profile: { id: 'prof-1', mot_code: 'MOT-01', name: 'Rauf Officer', phone_number: '03001234567' },
      mot_vehicle: { id: 'veh-1', vehicle_number: 'LHR-8821' },
      stops: [
        {
          id: 'stop-101',
          planned_sequence: 1,
          status: 'PENDING',
          shop_code: 'SH-001',
          shop_name: 'Bismillah Milk Shop',
          owner_name: 'Muhammad Aslam',
          phone_number: '03009876543',
          area_code: 'AR-01',
          area_name: 'Chak 45',
          planned_latitude: 31.5204,
          planned_longitude: 74.3587,
          shop: { geofence_radius_m: 120 },
        },
      ],
    };

    const samplePolicy = {
      point: 'MOT_SHOP',
      version: 1,
      name: 'Default MOT Shop Policy',
      tests: [
        {
          lab_test_id: 'lt-temp',
          test_code: 'TEMP',
          name: 'Temperature',
          unit: 'C',
          rule_type: 'RANGE',
          min_value: 4,
          max_value: 10,
          rejection_stage: 'STAGE_1',
          require_photo_on_reject: false,
          is_active: true,
        },
      ],
    };

    const sampleSources = [
      { id: 'src-1', erp_code: 'SRC-01', name: 'Direct Farmer Procurement' },
    ];

    const prepExpires = new Date(Date.now() + 8 * 3600 * 1000).toISOString();

    // Mock fetch for online preparation
    globalThis.fetch = async (input: any) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url.includes('/api/zmcc/mot/journeys/current/offline-preparation')) {
        return new Response(JSON.stringify({
          userId: 'user-mot-1',
          journeyId: 'journey-901',
          zmccId: 'zmcc-1',
          expiresAt: prepExpires,
          receipt: 'mock-offline-token-xyz',
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.includes('/api/zmcc/mot/journeys/current')) {
        return new Response(JSON.stringify({ journey: sampleJourney }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/api/zmcc/mot/shop-policy')) {
        return new Response(JSON.stringify(samplePolicy), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/api/sources/available')) {
        return new Response(JSON.stringify({ sources: sampleSources }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('{}', { status: 404 });
    };

    // 1. Resolve journey online -> triggers eager caching & preparation token persistence
    const res = await resolveCurrentJourney();
    assert.equal(res.error, null);
    assert.equal(res.journey?.id, 'journey-901');

    // 2. Verify all caches are populated
    const cachedJourney = await getCachedJourney();
    assert.ok(cachedJourney, 'Cached journey must be saved in IndexedDB');
    assert.equal(cachedJourney?.journey_number, 'J-2026-901');
    assert.equal(cachedJourney?.stops[0]?.geofence_radius_m, 120);

    const cachedPrep = await getMotOfflinePreparation();
    assert.ok(cachedPrep, 'Offline preparation must be stored');
    assert.equal(cachedPrep?.userId, 'user-mot-1');
    assert.equal(cachedPrep?.receipt, 'mock-offline-token-xyz');

    const cachedSources = await getCachedAvailableSources();
    assert.equal(cachedSources.length, 1);
    assert.equal(cachedSources[0].erp_code, 'SRC-01');

    const cachedPolicy = await getCachedMotShopPolicy();
    assert.ok(cachedPolicy);
    assert.equal(cachedPolicy?.point, 'MOT_SHOP');
  });

  test('ACC-02: Offline journey access succeeds when prepared; rejects when expired or absent', async () => {
    // 1. Unprepared journey while offline:
    setOnline(false);
    const missingRes = await resolveCurrentJourney();
    assert.equal(missingRes.journey, null);
    assert.match(missingRes.error || '', /Offline preparation is missing or expired/i);

    // 2. Expired preparation token while offline:
    await saveCachedJourney({
      id: 'journey-expired',
      journey_number: 'J-OLD',
      operational_date: '2026-10-30',
      status: 'COLLECTING',
      stops: [],
    });
    await saveMotOfflinePreparation({
      userId: 'user-mot-1',
      journeyId: 'journey-expired',
      zmccId: 'zmcc-1',
      expiresAt: new Date(Date.now() - 1000).toISOString(), // Expired 1s ago
      receipt: 'expired-receipt',
    });

    const expiredRes = await resolveCurrentJourney();
    assert.equal(expiredRes.journey, null);
    assert.match(expiredRes.error || '', /Offline preparation is missing or expired/i);

    // 3. Valid preparation token while offline:
    await saveMotOfflinePreparation({
      userId: 'user-mot-1',
      journeyId: 'journey-expired',
      zmccId: 'zmcc-1',
      expiresAt: new Date(Date.now() + 3600_000).toISOString(), // Valid for 1hr
      receipt: 'valid-receipt',
    });

    const validRes = await resolveCurrentJourney();
    assert.equal(validRes.error, null);
    assert.equal(validRes.journey?.id, 'journey-expired');
    assert.equal(validRes.journey?.journey_number, 'J-OLD');
  });

  test('ACC-03: Offline collection draft lifecycle and queue submission with client_event_id', async () => {
    const stopId = 'stop-202';
    const ownerId = 'user-mot-1';

    // 1. Save draft
    await saveDraft(
      stopId,
      {
        quantity: '250',
        unit: 'LITER',
        lr: '28.5',
        fat: '4.2',
        notes: 'Evening batch from farmer group',
      },
      ownerId
    );

    const draft = await getDraft(stopId, ownerId);
    assert.ok(draft);
    assert.equal(draft?.quantity, '250');
    assert.equal(draft?.lr, '28.5');
    assert.equal(draft?.fat, '4.2');

    // 2. Submit collection offline into collection_queue
    const clientEventId = 'evt-client-uuid-999';
    await queueCollection({
      client_event_id: clientEventId,
      journey_id: 'journey-901',
      stop_id: stopId,
      quantity: 250,
      unit: 'LITER',
      lr: 28.5,
      fat: 4.2,
      recorded_latitude: 31.5204,
      recorded_longitude: 74.3587,
      recorded_gps_accuracy: 8.5,
      notes: 'Evening batch from farmer group',
      owner_user_id: ownerId,
      offline_created_at: new Date().toISOString(),
    });

    // 3. Draft must be deleted upon submission
    const draftAfter = await getDraft(stopId, ownerId);
    assert.equal(draftAfter, null, 'Draft must be cleared once queued');

    // 4. Queue item verification
    const queue = await getQueuedCollections();
    assert.equal(queue.length, 1);
    const item = queue[0];
    assert.equal(item.client_event_id, clientEventId);
    assert.equal(item.status, 'QUEUED');
    assert.equal(item.quantity, 250);
    assert.equal(item.recorded_gps_accuracy, 8.5);

    // 5. Canonical request body generation
    const requestBody = motCollectionRequestBody(item);
    assert.equal(requestBody.client_event_id, clientEventId);
    assert.equal(requestBody.quantity, 250);
    assert.equal(requestBody.lr, 28.5);
    assert.equal(requestBody.fat, 4.2);
    assert.equal(requestBody.recorded_latitude, 31.5204);
  });

  test('ACC-04: Multi-user isolation prevents User B from accessing User A offline journey', async () => {
    // 1. Prepare journey for User A
    await saveCachedJourney({
      id: 'journey-user-a',
      journey_number: 'J-USER-A',
      operational_date: '2026-11-01',
      status: 'COLLECTING',
      stops: [],
    });
    await saveMotOfflinePreparation({
      userId: 'user-A',
      journeyId: 'journey-user-a',
      zmccId: 'zmcc-1',
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      receipt: 'user-a-receipt',
    });

    setOnline(false);

    // Active user is User A: Allowed
    setActiveOwnerUserId('user-A');
    const userARes = await resolveCurrentJourney();
    assert.equal(userARes.error, null);
    assert.equal(userARes.journey?.journey_number, 'J-USER-A');

    // Active user is User B: Denied (isolation boundary)
    setActiveOwnerUserId('user-B');
    const userBRes = await resolveCurrentJourney();
    assert.equal(userBRes.journey, null);
    assert.match(userBRes.error || '', /Offline preparation is missing or expired/i);
  });

  test('ACC-05: Logout clears journey session cache while preserving queued unsent work', async () => {
    // Seed journey, preparation, and unsent queued collection
    await saveCachedJourney({
      id: 'journey-session-clear',
      journey_number: 'J-CLEAR',
      operational_date: '2026-11-01',
      status: 'COLLECTING',
      stops: [],
    });
    await saveMotOfflinePreparation({
      userId: 'user-mot-1',
      journeyId: 'journey-session-clear',
      zmccId: 'zmcc-1',
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      receipt: 'clear-receipt',
    });
    await queueCollection({
      client_event_id: 'evt-preserve-on-logout',
      journey_id: 'journey-session-clear',
      stop_id: 'stop-preserved',
      quantity: 100,
      unit: 'LITER',
      lr: 28,
      fat: 4,
      owner_user_id: 'user-mot-1',
      offline_created_at: new Date().toISOString(),
    });

    // Verify presence before logout
    assert.ok(await getCachedJourney());
    assert.ok(await getMotOfflinePreparation());
    assert.equal((await getQueuedCollections()).length, 1);

    // Perform session cache cleanup (as called during logout)
    await clearMotSessionCache();

    // Journey and preparation must be cleared
    assert.equal(await getCachedJourney(), null);
    assert.equal(await getMotOfflinePreparation(), null);

    // CRITICAL: Unsent queued work MUST NEVER be deleted on logout!
    const queueAfter = await getQueuedCollections();
    assert.equal(queueAfter.length, 1, 'Queued work must be preserved across logout');
    assert.equal(queueAfter[0].client_event_id, 'evt-preserve-on-logout');
  });

  test('ACC-06: Sync lifecycle correctly tracks SYNCING, SYNCED, CONFLICT, and FAILED_RETRYABLE', async () => {
    const item1Id = 'evt-sync-success';
    const item2Id = 'evt-sync-conflict';
    const item3Id = 'evt-sync-network-fail';

    await queueCollection({
      client_event_id: item1Id,
      journey_id: 'journey-sync-test',
      stop_id: 'stop-1',
      quantity: 150,
      unit: 'LITER',
      lr: 29,
      fat: 4.1,
      offline_created_at: new Date().toISOString(),
    });

    // 1. Initial state
    let items = await getQueuedCollections();
    assert.equal(items[0].status, 'QUEUED');

    // 2. Transition to SYNCING
    await updateCollectionQueueStatus(item1Id, 'SYNCING');
    items = await getQueuedCollections();
    assert.equal(items[0].status, 'SYNCING');

    // 3. Server returns 200 OK -> transition to SYNCED
    await updateCollectionQueueStatus(item1Id, 'SYNCED');
    items = await getQueuedCollections();
    assert.equal(items[0].status, 'SYNCED');

    // 4. Test conflict handling (409 Conflict)
    await queueCollection({
      client_event_id: item2Id,
      journey_id: 'journey-sync-test',
      stop_id: 'stop-2',
      quantity: 120,
      unit: 'LITER',
      lr: 28,
      fat: 3.9,
      offline_created_at: new Date().toISOString(),
    });
    await updateCollectionQueueStatus(item2Id, 'CONFLICT', 'Collection already recorded with different values');
    items = await getQueuedCollections();
    const conflictItem = items.find((i) => i.client_event_id === item2Id);
    assert.equal(conflictItem?.status, 'CONFLICT');
    assert.match(conflictItem?.last_error || '', /already recorded/);

    // 5. Test retryable network error
    await queueCollection({
      client_event_id: item3Id,
      journey_id: 'journey-sync-test',
      stop_id: 'stop-3',
      quantity: 80,
      unit: 'LITER',
      lr: 28.2,
      fat: 4.0,
      offline_created_at: new Date().toISOString(),
    });
    await updateCollectionQueueStatus(item3Id, 'FAILED_RETRYABLE', 'Network unreachable');
    items = await getQueuedCollections();
    const retryableItem = items.find((i) => i.client_event_id === item3Id);
    assert.equal(retryableItem?.status, 'FAILED_RETRYABLE');
    assert.match(retryableItem?.last_error || '', /Network unreachable/);
  });
});
