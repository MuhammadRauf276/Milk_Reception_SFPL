import test from 'node:test';
import assert from 'node:assert/strict';
import type { SyncBatchRequest, SyncItem } from '@/types/sync';
import {
  applyBatchFailure,
  applyPhotoResult,
  applyResults,
  backoffDelayMs,
  BACKOFF_MAX_MS,
  classifyBatchHttp,
  createMemorySyncStore,
  enqueue,
  getCounts,
  nextBatch,
  pendingPhotoUploads,
  purgeRejectedBackground,
  sendQueuedBatches,
  type BatchTransportResult,
  type PendingPhotoMeta,
  type QueueRecord,
  type SendQueuedBatchesOptions,
} from '../syncQueueCore';
import { parseKeyInput } from '../DeviceSetupScreen';
import { combineUnsentWork, hasUnsentWork } from '../../auth/logout';
import {
  chunkGpsPoints,
  deterministicUuid,
  gpsChunkClientUuid,
  GPS_POINTS_PER_SYNC_ITEM,
  isUuid,
  MOT_SESSION_CACHE_STORES,
  summariseUnsentWork,
  syncClientUuidFor,
} from '../../mot/offlineStore';

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

// -------------------------------------------------------------
// Diary / heartbeat items are never "needs office help"
// -------------------------------------------------------------

test('REJECTED diary and heartbeat items are dropped; REJECTED business items are kept', async () => {
  const store = createMemorySyncStore();
  await enqueue(store, item('ev', { kind: 'DEVICE_EVENT', ownerUserId: '' }), { now: T0 });
  await enqueue(store, item('hb', { kind: 'HEARTBEAT', ownerUserId: '' }), { now: T0 });
  await enqueue(store, item('biz'), { now: T0 });
  const out = await applyResults(store, ['ev', 'hb', 'biz'], [
    { clientUuid: 'ev', status: 'REJECTED', code: 'INVALID_OWNER', message: 'no owner' },
    { clientUuid: 'hb', status: 'REJECTED', code: 'DEVICE_REQUIRED', message: 'no device' },
    { clientUuid: 'biz', status: 'REJECTED', code: 'OUTSIDE_SCOPE', message: 'no' },
  ], T0);
  assert.deepEqual(out.dropped.sort(), ['ev', 'hb']);
  assert.deepEqual(out.needsAttention, ['biz']);
  assert.equal(await store.get('ev'), null);
  assert.equal(await store.get('hb'), null);
  assert.equal((await store.get('biz'))?.state, 'NEEDS_ATTENTION');
  assert.deepEqual(await getCounts(store, T0), { waiting: 0, needsAttention: 1, sentToday: 0 });
});

test('RETRY diary items stay (only REJECTED ones are dropped)', async () => {
  const store = createMemorySyncStore();
  await enqueue(store, item('ev', { kind: 'DEVICE_EVENT' }), { now: T0 });
  await applyResults(store, ['ev'], [{ clientUuid: 'ev', status: 'RETRY' }], T0);
  assert.equal((await store.get('ev'))?.state, 'PENDING');
});

test('old stuck diary items are purged; stuck business items are not', async () => {
  const store = createMemorySyncStore();
  const stuck = (id: string, kind: SyncItem['kind']): QueueRecord => ({
    clientUuid: id,
    item: item(id, { kind }),
    state: 'NEEDS_ATTENTION',
    enqueuedAt: T0,
    attempts: 1,
    nextAttemptAt: 0,
    photos: [],
  });
  await store.put(stuck('old-ev', 'DEVICE_EVENT'));
  await store.put(stuck('old-hb', 'HEARTBEAT'));
  await store.put(stuck('old-biz', 'MOT_STOP_SKIP'));
  assert.equal(await purgeRejectedBackground(store), 2);
  assert.deepEqual((await store.list()).map((r) => r.clientUuid), ['old-biz']);
});

// -------------------------------------------------------------
// Whole-batch HTTP answers (401 / 403)
// -------------------------------------------------------------

function fakeSend(responses: BatchTransportResult[]) {
  const bodies: SyncBatchRequest[] = [];
  return {
    bodies,
    send: async (body: SyncBatchRequest): Promise<BatchTransportResult> => {
      bodies.push(body);
      return responses.shift() ?? { ok: true, httpStatus: 200, body: { serverTime: '', deviceStatus: 'ACTIVE', results: [] } };
    },
  };
}

function sendOpts(send: SendQueuedBatchesOptions['send'], extra: Partial<SendQueuedBatchesOptions> = {}): SendQueuedBatchesOptions {
  return { mode: 'DEVICE', ownerUserId: null, deviceUid: 'dev-1', appVersion: '3.0.0', maxBatches: 10, send, now: () => T0, ...extra };
}

async function seed() {
  const store = createMemorySyncStore();
  await enqueue(store, item('w1'), { now: T0 });
  await enqueue(store, item('w2', { ownerUserId: '8' }), { now: T0 + 1 });
  await enqueue(store, item('d1', { kind: 'DEVICE_EVENT', ownerUserId: '' }), { now: T0 + 2 });
  return store;
}

test('403 DEVICE_NOT_ACTIVE: nothing deleted, nothing backed off, phone shown as blocked', async () => {
  const store = await seed();
  const before = JSON.stringify(await store.list());
  const t = fakeSend([{ ok: true, httpStatus: 403, body: { error: 'x', code: 'DEVICE_NOT_ACTIVE', deviceStatus: 'BLOCKED' } }]);
  const r = await sendQueuedBatches(store, sendOpts(t.send));
  assert.equal(r.stop, 'DEVICE_BLOCKED');
  assert.equal(r.deviceStatus, 'BLOCKED');
  assert.equal(r.stopMessage, 'This phone is blocked. Ask the office.');
  assert.equal(t.bodies.length, 1, 'stops after the first refused batch');
  assert.equal(JSON.stringify(await store.list()), before, 'queue untouched');
  assert.equal((await getCounts(store, T0)).needsAttention, 0);
});

test('401 DEVICE_UNAUTHORIZED: items kept untouched; session mode then sends only the signed-in user items', async () => {
  const store = await seed();
  const before = JSON.stringify(await store.list());
  const t1 = fakeSend([{ ok: true, httpStatus: 401, body: { error: 'Device not recognised.', code: 'DEVICE_UNAUTHORIZED' } }]);
  const r1 = await sendQueuedBatches(store, sendOpts(t1.send));
  assert.equal(r1.stop, 'DEVICE_KEY_REJECTED');
  assert.equal(r1.sent, 0);
  assert.equal(JSON.stringify(await store.list()), before);

  const t2 = fakeSend([
    { ok: true, httpStatus: 200, body: { serverTime: '', deviceStatus: 'PENDING', results: [{ clientUuid: 'w1', status: 'SAVED', entityId: '1' }] } },
  ]);
  const r2 = await sendQueuedBatches(store, sendOpts(t2.send, { mode: 'SESSION', ownerUserId: '7' }));
  assert.deepEqual(t2.bodies[0].items.map((i) => i.clientUuid), ['w1']);
  assert.equal(r2.saved, 1);
  assert.equal(r2.deviceStatus, undefined, 'session answers say nothing about the device');
  assert.deepEqual((await store.list()).map((r) => r.clientUuid).sort(), ['d1', 'w2']);
});

test('401 in session mode keeps everything (session expired)', async () => {
  const store = await seed();
  const before = JSON.stringify(await store.list());
  const t = fakeSend([{ ok: true, httpStatus: 401, body: { code: 'UNAUTHORIZED' } }]);
  const r = await sendQueuedBatches(store, sendOpts(t.send, { mode: 'SESSION', ownerUserId: '7' }));
  assert.equal(r.stop, 'SESSION_EXPIRED');
  assert.equal(JSON.stringify(await store.list()), before);
});

test('500 / network error: items kept with backoff', async () => {
  const store = createMemorySyncStore();
  await enqueue(store, item('w1'), { now: T0 });
  await enqueue(store, item('w2'), { now: T0 + 1 });
  await enqueue(store, item('d1', { kind: 'DEVICE_EVENT', ownerUserId: '' }), { now: T0 + 2 });
  const r = await sendQueuedBatches(store, sendOpts(fakeSend([{ ok: true, httpStatus: 500, body: { code: 'SERVER_ERROR' } }]).send, { ownerUserId: '7' }));
  assert.equal(r.stop, 'RETRY');
  assert.equal(store.size(), 3);
  assert.ok((await store.list()).every((x) => x.attempts === 1 && x.nextAttemptAt > T0));

  const store2 = createMemorySyncStore();
  await enqueue(store2, item('w1'), { now: T0 });
  await enqueue(store2, item('w2'), { now: T0 + 1 });
  await enqueue(store2, item('d1', { kind: 'DEVICE_EVENT', ownerUserId: '' }), { now: T0 + 2 });
  const r2 = await sendQueuedBatches(store2, sendOpts(fakeSend([{ ok: false, networkError: 'Failed to fetch' }]).send, { ownerUserId: '7' }));
  assert.equal(r2.stop, 'NETWORK');
  assert.equal(store2.size(), 3);
});

test('200 device mode: SAVED removed, refused diary dropped, refused work kept, device ACTIVE reported', async () => {
  const store = createMemorySyncStore();
  await enqueue(store, item('w1'), { now: T0 });
  await enqueue(store, item('w2'), { now: T0 + 1 });
  await enqueue(store, item('d1', { kind: 'DEVICE_EVENT', ownerUserId: '' }), { now: T0 + 2 });
  const t = fakeSend([
    {
      ok: true,
      httpStatus: 200,
      body: {
        serverTime: '',
        deviceStatus: 'ACTIVE',
        results: [
          { clientUuid: 'w1', status: 'SAVED', entityId: '1' },
          { clientUuid: 'w2', status: 'REJECTED', code: 'OWNER_NOT_ALLOWED' },
          { clientUuid: 'd1', status: 'REJECTED', code: 'INVALID_PAYLOAD' },
        ],
      },
    },
  ]);
  const r = await sendQueuedBatches(store, sendOpts(t.send, { ownerUserId: '7' }));
  assert.equal(r.stop, undefined);
  assert.equal(r.deviceStatus, 'ACTIVE');
  assert.deepEqual([r.saved, r.rejected, r.dropped], [1, 1, 1]);
  assert.deepEqual((await store.list()).map((x) => x.clientUuid), ['w2']);
  assert.deepEqual(t.bodies[0].items.map((i) => i.clientUuid), ['w1', 'w2', 'd1']);
});

test('classifyBatchHttp maps auth answers', () => {
  assert.deepEqual(classifyBatchHttp(200, {}, 'DEVICE'), { kind: 'OK' });
  assert.equal(classifyBatchHttp(403, { code: 'DEVICE_NOT_ACTIVE', deviceStatus: 'RELEASED' }, 'DEVICE').kind, 'DEVICE_BLOCKED');
  assert.equal(classifyBatchHttp(401, { code: 'DEVICE_UNAUTHORIZED' }, 'DEVICE').kind, 'DEVICE_KEY_REJECTED');
  assert.equal(classifyBatchHttp(401, { code: 'UNAUTHORIZED' }, 'SESSION').kind, 'SESSION_EXPIRED');
  assert.equal(classifyBatchHttp(400, { code: 'INVALID_BATCH' }, 'DEVICE').kind, 'RETRY');
});

test('device setup: QR for another phone is refused; bare key and matching QR are accepted', () => {
  assert.deepEqual(parseKeyInput(JSON.stringify({ deviceUid: 'me', key: 'k-123' }), 'me'), { ok: true, key: 'k-123' });
  assert.equal(parseKeyInput(JSON.stringify({ deviceUid: 'other', key: 'k-123' }), 'me').ok, false);
  assert.deepEqual(parseKeyInput('  k-456 ', 'me'), { ok: true, key: 'k-456' });
  assert.equal(parseKeyInput('has space', 'me').ok, false);
  assert.equal(parseKeyInput('{bad json', 'me').ok, false);
});

test('MOT drain: UUID ids are kept, legacy ids get a stable derived UUID', async () => {
  const real = '3f2b8c1e-9a4d-4e6f-8b2a-1c3d5e7f9a0b';
  assert.equal(await syncClientUuidFor('mot-collection', real), real);
  const a = await syncClientUuidFor('mot-collection', 'evt-1700000000000-abc1234');
  const b = await syncClientUuidFor('mot-collection', 'evt-1700000000000-abc1234');
  assert.ok(isUuid(a), `derived id ${a} must be a UUID`);
  assert.equal(a, b, 'same old id always gives the same UUID');
  assert.match(a!, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.notEqual(a, await syncClientUuidFor('mot-stop-skip', 'evt-1700000000000-abc1234'), 'namespaced');
  assert.notEqual(a, await syncClientUuidFor('mot-collection', 'evt-1700000000000-abc1235'));
  assert.equal(await syncClientUuidFor('mot-collection', ''), null, 'no id: item stays on the old path');
  assert.equal(isUuid('skip-123-abc'), false);
  assert.ok(isUuid(await deterministicUuid('x', 'loc-1')));
});

test('MOT drain: GPS points are chunked per journey and owner, at most 200 per item', async () => {
  const pts = [] as Array<{ id: number; journey_id: string; client_location_id: string; device_recorded_at: string; owner_user_id: string | null }>;
  for (let i = 0; i < 450; i++) {
    pts.push({ id: i, journey_id: i % 10 === 0 ? 'J2' : 'J1', client_location_id: `loc-${i}`, device_recorded_at: new Date(T0 + (450 - i) * 1000).toISOString(), owner_user_id: '7' });
  }
  pts.push({ id: 999, journey_id: 'J1', client_location_id: 'loc-x', device_recorded_at: new Date(T0).toISOString(), owner_user_id: null });
  pts.push({ id: 998, journey_id: 'J1', client_location_id: '', device_recorded_at: new Date(T0).toISOString(), owner_user_id: '7' });
  const chunks = chunkGpsPoints(pts, (p) => p.owner_user_id);
  assert.equal(GPS_POINTS_PER_SYNC_ITEM, 200);
  const total = chunks.reduce((n, c) => n + c.points.length, 0);
  assert.equal(total, 450, 'points without owner or id are left on the old path');
  for (const c of chunks) {
    assert.ok(c.points.length <= 200);
    assert.ok(c.points.every((p) => p.journey_id === c.journeyId && p.owner_user_id === c.ownerUserId));
    for (let i = 1; i < c.points.length; i++) assert.ok(c.points[i - 1].device_recorded_at <= c.points[i].device_recorded_at);
  }
  assert.deepEqual(chunks.map((c) => `${c.journeyId}:${c.points.length}`).sort(), ['J1:200', 'J1:200', 'J1:5', 'J2:45'].sort());

  const ids = chunks[0].points.map((p) => p.client_location_id);
  const u1 = await gpsChunkClientUuid(ids);
  const u2 = await gpsChunkClientUuid(ids.slice().reverse());
  assert.ok(isUuid(u1));
  assert.equal(u1, u2, 'chunk id does not depend on order');
  assert.notEqual(u1, await gpsChunkClientUuid(ids.slice(1)));
});
