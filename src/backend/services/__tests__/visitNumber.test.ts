import test from 'node:test';
import assert from 'node:assert/strict';
import { isDraftVisitNumber, newDraftVisitNumber, nextVisitNumber } from '../dispatch/visitNumber';

test('the first vehicle of the day is number 1', () => {
  assert.equal(nextVisitNumber('2026-11-09', []), 'VV-20261109-0001');
});

test('the next number is one above the highest', () => {
  assert.equal(nextVisitNumber('2026-11-09', ['VV-20261109-0001', 'VV-20261109-0002', 'VV-20261109-0003']), 'VV-20261109-0004');
});

test('drafts use up no numbers', () => {
  const inUse = ['VV-20261109-0001', newDraftVisitNumber(), newDraftVisitNumber(), 'VV-20261109-0002', newDraftVisitNumber()];
  assert.equal(nextVisitNumber('2026-11-09', inUse), 'VV-20261109-0003');
});

test('each day starts again', () => {
  assert.equal(nextVisitNumber('2026-11-10', ['VV-20261109-0007']), 'VV-20261110-0001');
});

test('other kinds of number are ignored', () => {
  assert.equal(nextVisitNumber('2026-11-09', ['VV-TEST-899-48', 'VV-20261109-0002-OLD', null, undefined]), 'VV-20261109-0001');
});

test('numbers keep counting past 9999', () => {
  assert.equal(nextVisitNumber('2026-11-09', ['VV-20261109-9999']), 'VV-20261109-10000');
});

test('a draft id is recognised and never looks like a visit number', () => {
  const draft = newDraftVisitNumber();
  assert.equal(isDraftVisitNumber(draft), true);
  assert.equal(draft.startsWith('VV-'), false);
  assert.equal(isDraftVisitNumber('VV-20261109-0001'), false);
  assert.notEqual(draft, newDraftVisitNumber());
});
