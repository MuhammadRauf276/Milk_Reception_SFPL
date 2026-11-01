import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createMemorySyncStore,
  enqueue,
  applyResults,
  getCounts,
} from '@/frontend/modules/pwa/syncQueueCore';
import type { SyncItem } from '@/types/sync';

test('offlineArrivalSync: offline arrival enqueues with stable client_event_id', async () => {
  const store = createMemorySyncStore();
  const arrivalPayload = {
    journey_id: '1001',
    raw_milk_token_number: 'PHE-789',
    arrival_timestamp: '2026-10-31T10:00:00.000Z',
    client_event_id: 'mot-arr-1001-xyz',
  };

  const item: SyncItem = {
    clientUuid: 'arrival-uuid-1',
    kind: 'ZMCC_MOT_ARRIVAL',
    ownerUserId: '10',
    capturedAt: '2026-10-31T10:00:00.000Z',
    payload: arrivalPayload,
  };

  // 1. Enqueue offline item
  await enqueue(store, item);
  assert.equal(store.size(), 1);

  // 2. Verify queue status is waiting
  const countsBefore = await getCounts(store, Date.now());
  assert.equal(countsBefore.waiting, 1);
  assert.equal(countsBefore.needsAttention, 0);

  // 3. Simulate online sync acknowledging as SAVED
  const res = await applyResults(
    store,
    ['arrival-uuid-1'],
    [{ clientUuid: 'arrival-uuid-1', status: 'SAVED', entityId: '5001' }]
  );

  assert.deepEqual(res.removed, ['arrival-uuid-1']);
  assert.equal(store.size(), 0, 'Item must be removed from queue once server confirms SAVED');
});

test('offlineArrivalSync: lost response replay recognized as DUPLICATE and removed without double save', async () => {
  const store = createMemorySyncStore();
  const item: SyncItem = {
    clientUuid: 'arrival-uuid-2',
    kind: 'ZMCC_MOT_ARRIVAL',
    ownerUserId: '10',
    capturedAt: '2026-10-31T10:00:00.000Z',
    payload: {
      journey_id: '1002',
      client_event_id: 'mot-arr-1002-abc',
    },
  };

  await enqueue(store, item);
  assert.equal(store.size(), 1);

  // Server was reached earlier, so server acknowledges replay as DUPLICATE
  const res = await applyResults(
    store,
    ['arrival-uuid-2'],
    [{ clientUuid: 'arrival-uuid-2', status: 'DUPLICATE', entityId: '5002' }]
  );

  // DUPLICATE ack confirms the server already has the record, so client safely purges it
  assert.deepEqual(res.removed, ['arrival-uuid-2']);
  assert.equal(store.size(), 0);
  const countsAfter = await getCounts(store, Date.now());
  assert.equal(countsAfter.waiting, 0);
  assert.equal(countsAfter.sentToday, 1);
});

test('offlineArrivalSync: item is retained in queue if sync fails due to network error', async () => {
  const store = createMemorySyncStore();
  const item: SyncItem = {
    clientUuid: 'arrival-uuid-3',
    kind: 'ZMCC_MOT_ARRIVAL',
    ownerUserId: '10',
    capturedAt: '2026-10-31T10:00:00.000Z',
    payload: {
      journey_id: '1003',
      client_event_id: 'mot-arr-1003-def',
    },
  };

  await enqueue(store, item);

  // Simulate network retry outcome (connection dropped)
  await applyResults(
    store,
    ['arrival-uuid-3'],
    [{ clientUuid: 'arrival-uuid-3', status: 'RETRY' }]
  );

  // Item must NOT be deleted from queue
  assert.equal(store.size(), 1);
  const record = await store.get('arrival-uuid-3');
  assert.ok(record);
  assert.equal(record.state, 'PENDING');
});
