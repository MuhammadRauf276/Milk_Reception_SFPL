import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decideOnOpen,
  hasDraftContent,
  localDraftKey,
  readLocalDraft,
  removeLocalDraft,
  shouldResync,
  writeLocalDraft,
  type DraftContent,
  type DraftStorage,
  type LocalDraftRecord,
} from '../draftSync';

const content = (values: Record<string, string>, remarks = ''): DraftContent => ({ values, photos: {}, remarks });
const rec = (over: Partial<LocalDraftRecord> = {}): LocalDraftRecord => ({
  content: content({ a: '1' }),
  baseVersion: 3,
  dirty: false,
  updatedAt: new Date('2026-11-04T08:00:00Z').toISOString(),
  ...over,
});
const NOW = new Date('2026-11-04T09:00:00Z');

function memoryStorage(): DraftStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

test('keys are per user, form, scope and portion', () => {
  assert.notEqual(localDraftKey('1', 'MOT_SHOP', '5', 'form'), localDraftKey('2', 'MOT_SHOP', '5', 'form'));
  assert.notEqual(localDraftKey('1', 'MOT_SHOP', '5', 'form'), localDraftKey('1', 'MOT_SHOP', '6', 'form'));
});

test('write then read returns the same draft; another user key is empty', () => {
  const s = memoryStorage();
  const k = localDraftKey('1', 'PLANT_QA', '5', '10');
  assert.ok(writeLocalDraft(s, k, rec()));
  assert.deepEqual(readLocalDraft(s, k, NOW)?.content.values, { a: '1' });
  assert.equal(readLocalDraft(s, localDraftKey('2', 'PLANT_QA', '5', '10'), NOW), null);
  removeLocalDraft(s, k);
  assert.equal(readLocalDraft(s, k, NOW), null);
});

test('a draft older than 7 days is dropped; broken data and no storage are safe', () => {
  const s = memoryStorage();
  const k = localDraftKey('1', 'PLANT_QA', '5', '10');
  writeLocalDraft(s, k, rec({ updatedAt: new Date('2026-10-20T08:00:00Z').toISOString() }));
  assert.equal(readLocalDraft(s, k, NOW), null);
  assert.equal(s.data.has(k), false, 'expired copy is removed');
  s.setItem(k, '{not json');
  assert.equal(readLocalDraft(s, k, NOW), null);
  assert.equal(readLocalDraft(null, k, NOW), null);
  assert.equal(writeLocalDraft(null, k, rec()), false);
});

test('hasDraftContent ignores blank values', () => {
  assert.equal(hasDraftContent(content({ a: ' ' })), false);
  assert.equal(hasDraftContent(content({}, 'note')), true);
});

test('nothing on the server: push only what the phone has not sent', () => {
  assert.deepEqual(decideOnOpen(rec({ dirty: true, baseVersion: null }), null), { apply: null, push: true, baseVersion: null, keptPhone: false });
  assert.equal(decideOnOpen(rec({ dirty: false }), null).push, false);
  assert.equal(decideOnOpen(null, null).push, false);
});

test('nothing on the phone: take the server copy into empty fields', () => {
  const d = decideOnOpen(null, { version: 4, content: content({ a: '9' }) });
  assert.deepEqual(d, { apply: 'fill-empty', push: false, baseVersion: 4, keptPhone: false });
});

test('same version: nothing to apply, push only unsent edits', () => {
  const server = { version: 3, content: content({ a: '1' }) };
  assert.deepEqual(decideOnOpen(rec({ dirty: false }), server), { apply: null, push: false, baseVersion: 3, keptPhone: false });
  assert.equal(decideOnOpen(rec({ dirty: true }), server).push, true);
});

test('newer server copy and no unsent edits on the phone: the server copy wins', () => {
  const d = decideOnOpen(rec({ dirty: false, baseVersion: 3 }), { version: 5, content: content({ a: '2' }) });
  assert.deepEqual(d, { apply: 'server-wins', push: false, baseVersion: 5, keptPhone: false });
});

test('newer server copy and unsent edits on the phone: the phone wins, server only fills empty fields, phone is sent', () => {
  const d = decideOnOpen(rec({ dirty: true, baseVersion: 3 }), { version: 5, content: content({ a: '2' }) });
  assert.deepEqual(d, { apply: 'fill-empty', push: true, baseVersion: 5, keptPhone: true });
});

test('the phone never synced (no base version) and the server has a copy: the phone is kept when it has edits', () => {
  const d = decideOnOpen(rec({ dirty: true, baseVersion: null }), { version: 1, content: content({ b: '1' }) });
  assert.equal(d.keptPhone, true);
  assert.equal(d.push, true);
  assert.equal(d.baseVersion, 1);
});

test('shouldResync: needs an open target and a connection', () => {
  assert.equal(shouldResync({ hasTarget: false, online: true, lastSyncAt: null, now: 1000 }), false);
  assert.equal(shouldResync({ hasTarget: true, online: false, lastSyncAt: null, now: 1000 }), false);
  assert.equal(shouldResync({ hasTarget: true, online: true, lastSyncAt: null, now: 1000 }), true);
});

test('shouldResync: at most once per 10 seconds', () => {
  assert.equal(shouldResync({ hasTarget: true, online: true, lastSyncAt: 1000, now: 10_999 }), false);
  assert.equal(shouldResync({ hasTarget: true, online: true, lastSyncAt: 1000, now: 11_000 }), true);
  assert.equal(shouldResync({ hasTarget: true, online: true, lastSyncAt: 5000, now: 1000 }), true); // clock went back
});
