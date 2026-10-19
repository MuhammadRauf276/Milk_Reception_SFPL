import test from 'node:test';
import assert from 'node:assert/strict';
import { summariseUnsentWork } from '../offlineStore';

test('empty input gives zeros', () => {
  assert.deepEqual(summariseUnsentWork({}), { collections: 0, gpsPoints: 0, skips: 0, shopRequests: 0, drafts: 0, total: 0, needsAttention: 0 });
});

test('synced items are not counted, all other statuses are', () => {
  const r = summariseUnsentWork({
    collections: [{ status: 'QUEUED' }, { status: 'SYNCED' }, { status: 'FAILED_FATAL' }, { status: 'SYNCING' }],
    gpsPoints: [{ synced: 0, status: 'QUEUED' }, { synced: 1 }, { status: 'SYNCED', synced: 0 }, { synced: 0 }],
    skips: [{ status: 'CONFLICT' }],
    shopRequests: [{ status: 'SYNCED' }],
    drafts: [{}, {}],
  });
  assert.deepEqual(r, { collections: 2, gpsPoints: 2, skips: 0, shopRequests: 0, drafts: 2, total: 6, needsAttention: 2 });
});
