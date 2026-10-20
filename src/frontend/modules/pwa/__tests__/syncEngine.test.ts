import test from 'node:test';
import assert from 'node:assert/strict';
import type { SyncItem } from '@/types/sync';
import {
  applyBatchFailure,
  applyPhotoResult,
  applyResults,
  backoffDelayMs,
  BACKOFF_MAX_MS,
  createMemorySyncStore,
  enqueue,
  getCounts,
  nextBatch,
  pendingPhotoUploads,
  type PendingPhotoMeta,
} from '../syncQueueCore';
import { combineUnsentWork, hasUnsentWork } from '../../auth/logout';
import { MOT_SESSION_CACHE_STORES, summariseUnsentWork } from '../../mot/offlineStore';

const T0 = Date.parse('2026-10-20T08:00:00Z');

function item(id: string, extra: Partial<SyncItem> = {}): SyncItem {
  return { clientUuid: id, kind: 'MOT_COLLECTION', ownerUserId: '7', capturedAt: new Date(T0).toISOString(), payload: { n: id }, ...extra };
}

function photoMeta(captureId: string): PendingPhotoMeta {
  return {
    captureId,
    sha256: 'ab'.repeat(32),
    testingPoint: 'MOT_SHOP',
    photoKind: 'TEST_RESULT',
    deviceCapturedAt: new Date(T0).toISOString(),
    wasOffline: true,
    width: 800,
    height: 600,
  };
}

test('SAVED and DUPLICATE remove the item and count as sent today', async () => {
  const store = createMemorySyncStore();
  await enqueue(store, item('a'), { now: T0 });
  await enqueue(store, item('b'), { now: T0 + 1 });
  const out = await applyResults(store, ['a', 'b'], [
    { clientUuid: 'a', status: 'SAVED', entityId: '11' },
    { clientUuid: 'b', status: 'DUPLICATE', entityId: '12' },
  ], T0 + 10);
  assert.deepEqual(out.removed.sort(), ['a', 'b']);
  assert.equal(store.size(), 0);
  const counts = await getCounts(store, T0 + 20);
  assert.deepEqual(counts, { waiting: 0, needsAttention: 0, sentToday: 2 });
});

test('REJECTED is kept as NEEDS_ATTENTION and never sent again automatically', async () => {
  const store = createMemorySyncStore();
  await enqueue(store, item('r'), { now: T0 });
  await applyResults(store, ['r'], [{ clientUuid: 'r', status: 'REJECTED', code: 'OUTSIDE_SCOPE', message: 'no' }], T0);
  const rec = await store.get('r');
  assert.equal(rec?.state, 'NEEDS_ATTENTION');
  assert.equal(rec?.lastCode, 'OUTSIDE_SCOPE');
  assert.equal((await nextBatch(store, { now: T0 + 10 * 3600_000 })).length, 0);
  assert.deepEqual(await getCounts(store, T0), { waiting: 0, needsAttention: 1, sentToday: 0 });
});

test('backoff grows 5s, 10s, 20s... and is capped at 15 min', () => {
  assert.equal(backoffDelayMs(1), 5_000);
  assert.equal(backoffDelayMs(2), 10_000);
  assert.equal(backoffDelayMs(3), 20_000);
  assert.equal(backoffDelayMs(8), 640_000);
  assert.equal(backoffDelayMs(9), BACKOFF_MAX_MS);
  assert.equal(backoffDelayMs(500), BACKOFF_MAX_MS);
});

test('RETRY keeps the item with growing backoff; skipped while in backoff', async () => {
  const store = createMemorySyncStore();
  await enqueue(store, item('x'), { now: T0 });
  let now = T0;
  const delays: number[] = [];
  for (let i = 0; i < 12; i++) {
    const batch = await nextBatch(store, { now });
    assert.equal(batch.length, 1, `attempt ${i} should be due`);
    await applyResults(store, ['x'], [{ clientUuid: 'x', status: 'RETRY' }], now);
    const rec = await store.get('x');
    assert.ok(rec);
    assert.equal(rec.state, 'PENDING');
    delays.push(rec.nextAttemptAt - now);
    assert.equal((await nextBatch(store, { now: rec.nextAttemptAt - 1 })).length, 0, 'in backoff');
    now = rec.nextAttemptAt;
  }
  assert.deepEqual(delays.slice(0, 4), [5_000, 10_000, 20_000, 40_000]);
  assert.equal(Math.max(...delays), BACKOFF_MAX_MS);
  assert.equal(delays[delays.length - 1], BACKOFF_MAX_MS);
});

test('network error (whole batch) keeps every item with backoff', async () => {
  const store = createMemorySyncStore();
  await enqueue(store, item('n1'), { now: T0 });
  await enqueue(store, item('n2'), { now: T0 + 1 });
  await applyBatchFailure(store, ['n1', 'n2'], 'Failed to fetch', T0);
  await applyBatchFailure(store, ['n1', 'n2'], 'Failed to fetch', T0 + 5_000);
  const r1 = await store.get('n1');
  assert.equal(r1?.attempts, 2);
  assert.equal(r1?.nextAttemptAt, T0 + 5_000 + 10_000);
  assert.equal(store.size(), 2);
  assert.equal((await getCounts(store, T0)).waiting, 2);
});

test('missing result for a sent item is treated as retry, not success', async () => {
  const store = createMemorySyncStore();
  await enqueue(store, item('m'), { now: T0 });
  const out = await applyResults(store, ['m'], [], T0);
  assert.deepEqual(out.retrying, ['m']);
  assert.equal(store.size(), 1);
});

test('item with photos is removed only after the record and every photo are ACKed', async () => {
  const store = createMemorySyncStore();
  await enqueue(store, item('p'), { now: T0, photos: [{ captureId: 'c1', meta: photoMeta('c1') }, { captureId: 'c2', meta: photoMeta('c2') }] });

  // No photo uploads before the record is ACKed (entity id unknown).
  assert.equal((await pendingPhotoUploads(store, T0)).length, 0);

  await applyResults(store, ['p'], [{ clientUuid: 'p', status: 'SAVED', entityType: 'MotShopCollection', entityId: '99' }], T0);
  let rec = await store.get('p');
  assert.equal(rec?.state, 'PHOTOS_PENDING');
  assert.equal((await nextBatch(store, { now: T0 })).length, 0, 'record is not resent');

  const tasks = await pendingPhotoUploads(store, T0);
  assert.equal(tasks.length, 2);
  assert.equal(tasks[0].meta.entityId, '99');
  assert.equal(tasks[0].meta.entityType, 'MotShopCollection');
  assert.equal(tasks[0].ownerUserId, '7');

  // c1 fails (network) -> still kept; backoff applies to that photo only.
  await applyPhotoResult(store, 'p', 'c1', { kind: 'RETRY', message: 'offline' }, T0);
  let r = await applyPhotoResult(store, 'p', 'c2', { kind: 'OK', result: { status: 'SAVED', photoId: '5' } }, T0);
  assert.deepEqual(r, { photoConfirmed: true, recordRemoved: false });
  rec = await store.get('p');
  assert.ok(rec);
  assert.equal(rec.state, 'PHOTOS_PENDING');
  assert.equal((await pendingPhotoUploads(store, T0 + 1)).length, 0, 'c1 in backoff');
  assert.equal((await pendingPhotoUploads(store, T0 + 5_000)).length, 1);
  assert.equal((await getCounts(store, T0)).waiting, 1);

  r = await applyPhotoResult(store, 'p', 'c1', { kind: 'OK', result: { status: 'DUPLICATE', photoId: '4' } }, T0 + 5_000);
  assert.deepEqual(r, { photoConfirmed: true, recordRemoved: true });
  assert.equal(store.size(), 0);
  assert.equal((await getCounts(store, T0 + 5_000)).sentToday, 1);
});

test('rejected photo keeps the item as NEEDS_ATTENTION', async () => {
  const store = createMemorySyncStore();
  await enqueue(store, item('q'), { now: T0, photos: [{ captureId: 'c9', meta: photoMeta('c9') }] });
  await applyResults(store, ['q'], [{ clientUuid: 'q', status: 'SAVED', entityId: '3' }], T0);
  await applyPhotoResult(store, 'q', 'c9', { kind: 'REJECTED', code: 'BAD_HASH', message: 'hash mismatch' }, T0);
  const rec = await store.get('q');
  assert.equal(rec?.state, 'NEEDS_ATTENTION');
  assert.equal(store.size(), 1);
});

test('batch holds at most 50 items, oldest first', async () => {
  const store = createMemorySyncStore();
  for (let i = 0; i < 70; i++) {
    // Insert in reverse time order to prove sorting.
    await enqueue(store, item(`i${String(i).padStart(2, '0')}`), { now: T0 + (70 - i) * 1000 });
  }
  const batch = await nextBatch(store, { now: T0 + 999_999, limit: 500 });
  assert.equal(batch.length, 50);
  for (let i = 1; i < batch.length; i++) assert.ok(batch[i - 1].enqueuedAt <= batch[i].enqueuedAt);
  assert.equal(batch[0].clientUuid, 'i69');
});

test('session-cookie mode only picks the signed-in user items', async () => {
  const store = createMemorySyncStore();
  await enqueue(store, item('u1', { ownerUserId: '1' }), { now: T0 });
  await enqueue(store, item('u2', { ownerUserId: '2' }), { now: T0 });
  const batch = await nextBatch(store, { now: T0, ownerUserId: '2' });
  assert.deepEqual(batch.map((r) => r.clientUuid), ['u2']);
});

test('enqueue is idempotent by clientUuid and does not reset progress', async () => {
  const store = createMemorySyncStore();
  await enqueue(store, item('d'), { now: T0 });
  await applyBatchFailure(store, ['d'], 'x', T0);
  await enqueue(store, item('d'), { now: T0 + 1 });
  assert.equal((await store.get('d'))?.attempts, 1);
});

test('diary events are sent but not counted as waiting work', async () => {
  const store = createMemorySyncStore();
  await enqueue(store, item('e', { kind: 'DEVICE_EVENT' }), { now: T0 });
  assert.equal((await nextBatch(store, { now: T0 })).length, 1);
  assert.equal((await getCounts(store, T0)).waiting, 0);
  await applyResults(store, ['e'], [{ clientUuid: 'e', status: 'SAVED' }], T0);
  assert.equal((await getCounts(store, T0)).sentToday, 0);
});

test('logout counts unsent work from both queues', () => {
  const mot = summariseUnsentWork({ collections: [{ status: 'QUEUED' }], gpsPoints: [{ status: 'FAILED_FATAL' }] });
  const combined = combineUnsentWork(mot, { waiting: 3, needsAttention: 2 });
  assert.equal(combined.total, 4);
  assert.equal(combined.needsAttention, 3);
  assert.equal(combined.syncWaiting, 3);
  assert.equal(hasUnsentWork(combined), true);
  assert.equal(hasUnsentWork(combineUnsentWork(summariseUnsentWork({}), { waiting: 0, needsAttention: 1 })), true);
  assert.equal(hasUnsentWork(combineUnsentWork(summariseUnsentWork({}), { waiting: 0, needsAttention: 0 })), false);
});

test('logout clears only the session cache, never a queue or drafts', () => {
  for (const name of ['collection_queue', 'gps_queue', 'skip_queue', 'shop_request_queue', 'collection_drafts']) {
    assert.ok(!MOT_SESSION_CACHE_STORES.includes(name), `${name} must never be cleared on logout`);
  }
  assert.deepEqual([...MOT_SESSION_CACHE_STORES].sort(), ['active_journey', 'offline_preparation']);
});
