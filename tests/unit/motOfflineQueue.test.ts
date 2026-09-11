import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  openMotDb,
  queueGpsLocation,
  syncPendingGps,
  syncPendingCollections,
  queueCollection,
  getQueuedCollections,
  getUnsyncedSummary,
  updateGpsPointsStatus,
  markGpsPointsSynced,
  updateCollectionQueueStatus,
  QueuedGpsPoint,
} from '@/frontend/modules/mot/offlineStore';

describe('MOT Offline Queue Bounded Recovery & Synchronization', () => {
  beforeEach(async () => {
    const db = await openMotDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(
        ['active_journey', 'collection_drafts', 'collection_queue', 'gps_queue'],
        'readwrite'
      );
      tx.objectStore('active_journey').clear();
      tx.objectStore('collection_drafts').clear();
      tx.objectStore('collection_queue').clear();
      tx.objectStore('gps_queue').clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('1. One rejected GPS point does not create an infinite retry loop', async () => {
    const locId = await queueGpsLocation({
      journey_id: '101',
      client_location_id: 'loc-reject-1',
      latitude: 31.52,
      longitude: 74.35,
      device_recorded_at: new Date().toISOString(),
    });

    let fetchCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      fetchCount++;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          total: 1,
          accepted: 0,
          accepted_count: 0,
          rejected_count: 1,
          items: [
            {
              client_location_id: locId,
              status: 'REJECTED',
              reason: 'Invalid coordinates',
            },
          ],
        }),
      } as any;
    });

    const res1 = await syncPendingGps();
    expect(fetchCount).toBe(1);
    expect(res1.synced).toBe(0);
    expect(res1.fatal).toBe(1);
    expect(res1.failed).toBe(1);

    // Calling sync again must NOT call fetch or loop, because the rejected point is FAILED_FATAL
    const res2 = await syncPendingGps();
    expect(fetchCount).toBe(1);
    expect(res2.synced).toBe(0);
    expect(res2.failed).toBe(0);

    const summary = await getUnsyncedSummary();
    expect(summary.pendingGps).toBe(0);
    expect(summary.fatalGps).toBe(1);
  });

  it('2. A conflict is attempted once and stored as CONFLICT', async () => {
    const locId = await queueGpsLocation({
      journey_id: '101',
      client_location_id: 'loc-conflict-1',
      latitude: 31.52,
      longitude: 74.35,
      device_recorded_at: new Date().toISOString(),
    });

    let fetchCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      fetchCount++;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          total: 1,
          accepted: 0,
          accepted_count: 0,
          rejected_count: 1,
          items: [
            {
              client_location_id: locId,
              status: 'CONFLICT',
              reason: 'Reused client_location_id with changed coordinates',
            },
          ],
        }),
      } as any;
    });

    const res = await syncPendingGps();
    expect(fetchCount).toBe(1);
    expect(res.conflicts).toBe(1);
    expect(res.synced).toBe(0);

    // Verify record in IndexedDB
    const db = await openMotDb();
    const point: QueuedGpsPoint = await new Promise((resolve) => {
      const tx = db.transaction('gps_queue', 'readonly');
      const req = tx.objectStore('gps_queue').getAll();
      req.onsuccess = () => resolve(req.result[0]);
    });

    expect(point.status).toBe('CONFLICT');
    expect(point.synced).toBe(0);
    expect(point.attempts).toBe(1);
    expect(point.last_error).toContain('changed coordinates');

    // Subsequent sync must not retry CONFLICT
    await syncPendingGps();
    expect(fetchCount).toBe(1);

    const summary = await getUnsyncedSummary();
    expect(summary.pendingGps).toBe(0);
    expect(summary.conflictGps).toBe(1);
  });

  it('3. A fatal rejection (HTTP 400 client error) is not retried automatically', async () => {
    await queueGpsLocation({
      journey_id: '101',
      client_location_id: 'loc-fatal-400',
      latitude: 31.52,
      longitude: 74.35,
      device_recorded_at: new Date().toISOString(),
    });

    let fetchCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      fetchCount++;
      return {
        ok: false,
        status: 400,
        json: async () => ({ error: 'Mixed-journey batches are not permitted.' }),
      } as any;
    });

    const res = await syncPendingGps();
    expect(fetchCount).toBe(1);
    expect(res.fatal).toBe(1);
    expect(res.synced).toBe(0);

    // Verify stored as FAILED_FATAL
    const db = await openMotDb();
    const point: QueuedGpsPoint = await new Promise((resolve) => {
      const tx = db.transaction('gps_queue', 'readonly');
      const req = tx.objectStore('gps_queue').getAll();
      req.onsuccess = () => resolve(req.result[0]);
    });

    expect(point.status).toBe('FAILED_FATAL');
    expect(point.last_error).toContain('Mixed-journey');

    // Not retried in subsequent sync
    await syncPendingGps();
    expect(fetchCount).toBe(1);
  });

  it('4. Network/5xx failure becomes FAILED_RETRYABLE and retries only in a later sync invocation', async () => {
    await queueGpsLocation({
      journey_id: '101',
      client_location_id: 'loc-retry-1',
      latitude: 31.52,
      longitude: 74.35,
      device_recorded_at: new Date().toISOString(),
    });

    let fetchCount = 0;
    // First sync fails with 500 server error
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      fetchCount++;
      return {
        ok: false,
        status: 500,
        json: async () => ({ error: 'Internal Server Error' }),
      } as any;
    });

    const res1 = await syncPendingGps();
    expect(fetchCount).toBe(1);
    expect(res1.retryable).toBe(1);
    expect(res1.synced).toBe(0);

    // Point was marked FAILED_RETRYABLE with attempts = 1
    const db = await openMotDb();
    const point: QueuedGpsPoint = await new Promise((resolve) => {
      const tx = db.transaction('gps_queue', 'readonly');
      const req = tx.objectStore('gps_queue').getAll();
      req.onsuccess = () => resolve(req.result[0]);
    });
    expect(point.status).toBe('FAILED_RETRYABLE');
    expect(point.attempts).toBe(1);

    // Later sync invocation succeeds
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      fetchCount++;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          total: 1,
          accepted: 1,
          items: [{ client_location_id: 'loc-retry-1', status: 'ACCEPTED' }],
        }),
      } as any;
    });

    const res2 = await syncPendingGps();
    expect(fetchCount).toBe(2);
    expect(res2.synced).toBe(1);

    const pointAfter: QueuedGpsPoint = await new Promise((resolve) => {
      const tx = db.transaction('gps_queue', 'readonly');
      const req = tx.objectStore('gps_queue').getAll();
      req.onsuccess = () => resolve(req.result[0]);
    });
    expect(pointAfter.status).toBe('SYNCED');
    expect(pointAfter.synced).toBe(1);
  });

  it('5. Accepted and already-processed points become SYNCED', async () => {
    const id1 = await queueGpsLocation({
      journey_id: '101',
      client_location_id: 'loc-acc-1',
      latitude: 31.52,
      longitude: 74.35,
      device_recorded_at: new Date(Date.now() - 10000).toISOString(),
    });
    const id2 = await queueGpsLocation({
      journey_id: '101',
      client_location_id: 'loc-already-2',
      latitude: 31.53,
      longitude: 74.36,
      device_recorded_at: new Date().toISOString(),
    });

    globalThis.fetch = vi.fn().mockImplementation(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        total: 2,
        accepted: 2,
        items: [
          { client_location_id: id1, status: 'ACCEPTED' },
          { client_location_id: id2, status: 'ALREADY_PROCESSED' },
        ],
      }),
    } as any));

    const res = await syncPendingGps();
    expect(res.synced).toBe(2);
    expect(res.failed).toBe(0);

    const db = await openMotDb();
    const points: QueuedGpsPoint[] = await new Promise((resolve) => {
      const tx = db.transaction('gps_queue', 'readonly');
      const req = tx.objectStore('gps_queue').getAll();
      req.onsuccess = () => resolve(req.result);
    });

    expect(points.every((p) => p.status === 'SYNCED' && p.synced === 1)).toBe(true);
  });

  it('6. Partial batch responses update every point correctly', async () => {
    const p1 = await queueGpsLocation({
      journey_id: '101',
      client_location_id: 'loc-p1',
      latitude: 31.51,
      longitude: 74.31,
      device_recorded_at: new Date(Date.now() - 4000).toISOString(),
    });
    const p2 = await queueGpsLocation({
      journey_id: '101',
      client_location_id: 'loc-p2',
      latitude: 31.52,
      longitude: 74.32,
      device_recorded_at: new Date(Date.now() - 3000).toISOString(),
    });
    const p3 = await queueGpsLocation({
      journey_id: '101',
      client_location_id: 'loc-p3',
      latitude: 31.53,
      longitude: 74.33,
      device_recorded_at: new Date(Date.now() - 2000).toISOString(),
    });
    const p4 = await queueGpsLocation({
      journey_id: '101',
      client_location_id: 'loc-p4',
      latitude: 31.54,
      longitude: 74.34,
      device_recorded_at: new Date(Date.now() - 1000).toISOString(),
    });

    globalThis.fetch = vi.fn().mockImplementation(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        total: 4,
        accepted: 2,
        items: [
          { client_location_id: p1, status: 'ACCEPTED' },
          { client_location_id: p2, status: 'ALREADY_PROCESSED' },
          { client_location_id: p3, status: 'CONFLICT', reason: 'Reused id' },
          { client_location_id: p4, status: 'REJECTED', reason: 'Predates start' },
        ],
      }),
    } as any));

    const res = await syncPendingGps();
    expect(res.synced).toBe(2);
    expect(res.conflicts).toBe(1);
    expect(res.fatal).toBe(1);

    const summary = await getUnsyncedSummary();
    expect(summary.pendingGps).toBe(0);
    expect(summary.conflictGps).toBe(1);
    expect(summary.fatalGps).toBe(1);
  });

  it('7. Stale collection SYNCING state is recovered and synced', async () => {
    await queueCollection({
      client_event_id: 'evt-stale-1',
      journey_id: '101',
      stop_id: '201',
      quantity: 100,
      unit: 'LITER',
      lr: 28,
      fat: 4.0,
      notes: 'Stale collection test',
      offline_created_at: new Date(Date.now() - 1000000).toISOString(),
    });

    // Simulate browser crash 10 minutes ago mid-sync
    await updateCollectionQueueStatus('evt-stale-1', 'SYNCING');
    const db = await openMotDb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction('collection_queue', 'readwrite');
      const store = tx.objectStore('collection_queue');
      const req = store.get('evt-stale-1');
      req.onsuccess = () => {
        const item = req.result;
        // set sync_started_at to 10 minutes ago
        item.sync_started_at = new Date(Date.now() - 10 * 60 * 1000).toISOString();
        store.put(item);
      };
      tx.oncomplete = () => resolve();
    });

    let submittedPayload: any = null;
    globalThis.fetch = vi.fn().mockImplementation(async (_url: string, opts: any) => {
      submittedPayload = JSON.parse(opts.body);
      return {
        ok: true,
        status: 201,
        json: async () => ({ success: true }),
      } as any;
    });

    const res = await syncPendingCollections();
    expect(res.synced).toBe(1);
    expect(submittedPayload?.client_event_id).toBe('evt-stale-1');

    const collections = await getQueuedCollections();
    expect(collections[0].status).toBe('SYNCED');
  });

  it('8. Fresh SYNCING collection is not duplicated', async () => {
    // Collection 1: currently running (active for only 30 seconds)
    await queueCollection({
      client_event_id: 'evt-fresh-syncing',
      journey_id: '101',
      stop_id: '201',
      quantity: 100,
      unit: 'LITER',
      lr: 28,
      fat: 4.0,
      offline_created_at: new Date().toISOString(),
    });
    await updateCollectionQueueStatus('evt-fresh-syncing', 'SYNCING');

    // Collection 2: regular queued item
    await queueCollection({
      client_event_id: 'evt-queued-2',
      journey_id: '101',
      stop_id: '202',
      quantity: 150,
      unit: 'LITER',
      lr: 28,
      fat: 4.0,
      offline_created_at: new Date().toISOString(),
    });

    const submittedEvents: string[] = [];
    globalThis.fetch = vi.fn().mockImplementation(async (_url: string, opts: any) => {
      const body = JSON.parse(opts.body);
      submittedEvents.push(body.client_event_id);
      return {
        ok: true,
        status: 201,
        json: async () => ({ success: true }),
      } as any;
    });

    const res = await syncPendingCollections();
    expect(res.synced).toBe(1);
    // Only evt-queued-2 was submitted; evt-fresh-syncing was not duplicated!
    expect(submittedEvents).toEqual(['evt-queued-2']);

    const collections = await getQueuedCollections();
    const freshItem = collections.find((c) => c.client_event_id === 'evt-fresh-syncing');
    expect(freshItem?.status).toBe('SYNCING');
  });

  it('9. IndexedDB update functions resolve only after transaction completion', async () => {
    const locId = await queueGpsLocation({
      journey_id: '101',
      client_location_id: 'loc-tx-complete',
      latitude: 31.52,
      longitude: 74.35,
      device_recorded_at: new Date().toISOString(),
    });

    const db = await openMotDb();
    let pointId: number;
    const initialPoint: QueuedGpsPoint = await new Promise((resolve) => {
      const tx = db.transaction('gps_queue', 'readonly');
      const req = tx.objectStore('gps_queue').getAll();
      req.onsuccess = () => {
        pointId = req.result[0].id;
        resolve(req.result[0]);
      };
    });

    expect(initialPoint.status).toBe('QUEUED');

    // Test updateGpsPointsStatus
    await updateGpsPointsStatus([
      { id: pointId!, status: 'FAILED_RETRYABLE', error: 'Network test' },
    ]);

    // Right after promise resolves, a new transaction MUST immediately see the committed update
    const updatedPoint: QueuedGpsPoint = await new Promise((resolve) => {
      const tx = db.transaction('gps_queue', 'readonly');
      const req = tx.objectStore('gps_queue').get(pointId);
      req.onsuccess = () => resolve(req.result);
    });

    expect(updatedPoint.status).toBe('FAILED_RETRYABLE');
    expect(updatedPoint.attempts).toBe(1);
    expect(updatedPoint.last_error).toBe('Network test');

    // Test markGpsPointsSynced
    await markGpsPointsSynced([pointId!]);

    const syncedPoint: QueuedGpsPoint = await new Promise((resolve) => {
      const tx = db.transaction('gps_queue', 'readonly');
      const req = tx.objectStore('gps_queue').get(pointId);
      req.onsuccess = () => resolve(req.result);
    });

    expect(syncedPoint.status).toBe('SYNCED');
    expect(syncedPoint.synced).toBe(1);
  });
});
