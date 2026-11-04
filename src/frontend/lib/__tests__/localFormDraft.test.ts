import test from 'node:test';
import assert from 'node:assert/strict';
import type { DraftStorage } from '../draftSync';
import { changedFields, localFormDraftKey, readLocalFormDraft, writeLocalFormDraft } from '../localFormDraft';
import { draftFingerprint } from '../draftSync';

function memoryStorage(): DraftStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

test('only changed fields are kept, so a default time never comes back later', () => {
  assert.deepEqual(
    changedFields({ kg: '20530', time: '2026-11-04T02:33' }, { kg: '', time: '2026-11-04T02:33' }),
    { kg: '20530' }
  );
});

test('a draft survives and comes back', () => {
  const s = memoryStorage();
  writeLocalFormDraft(s, 'k', { kg: '20530' });
  assert.deepEqual(readLocalFormDraft(s, 'k'), { kg: '20530' });
});

test('nothing changed removes the draft', () => {
  const s = memoryStorage();
  writeLocalFormDraft(s, 'k', { kg: '1' });
  writeLocalFormDraft(s, 'k', {});
  assert.equal(s.data.size, 0);
});

test('an old draft expires', () => {
  const s = memoryStorage();
  writeLocalFormDraft(s, 'k', { kg: '1' }, new Date('2026-11-01T00:00:00Z'));
  assert.equal(readLocalFormDraft(s, 'k', new Date('2026-11-05T00:00:00Z')), null);
  assert.equal(s.data.size, 0);
});

test('a damaged draft or a blocked store never breaks the form', () => {
  const s = memoryStorage();
  s.setItem('k', '{not json');
  assert.equal(readLocalFormDraft(s, 'k'), null);
  assert.equal(readLocalFormDraft(null, 'k'), null);
  assert.doesNotThrow(() => writeLocalFormDraft(null, 'k', { a: '1' }));
});

test('each user has their own key on a shared device', () => {
  assert.notEqual(localFormDraftKey('1', 'gate'), localFormDraftKey('2', 'gate'));
});

test('two devices holding the same draft agree, so they never send it back and forth', () => {
  const a = { values: { fat: '5', lr: '', salt: '0.2' }, photos: { t1: 'cap-1' }, remarks: ' ' };
  const b = { values: { salt: '0.2', fat: '5' }, photos: { t1: 'cap-1', t2: '' }, remarks: '' };
  assert.equal(draftFingerprint(a), draftFingerprint(b));
});

test('a real difference is seen', () => {
  const a = { values: { fat: '5' }, photos: {}, remarks: '' };
  assert.notEqual(draftFingerprint(a), draftFingerprint({ ...a, values: { fat: '6' } }));
  assert.notEqual(draftFingerprint(a), draftFingerprint({ ...a, photos: { t1: 'cap-1' } }));
  assert.notEqual(draftFingerprint(a), draftFingerprint({ ...a, remarks: 'note' }));
});
