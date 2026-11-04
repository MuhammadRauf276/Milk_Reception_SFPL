import test from 'node:test';
import assert from 'node:assert/strict';
import { validateOperationalTimestamp } from '../chronology-validator';

// The Weighbridge report: QA completed 22:50 UTC on 3 Nov, which is 03:50 on 4 Nov in Pakistan.
const qaCompleted = new Date('2026-11-03T22:50:00.000Z');
const check = (input: string) => validateOperationalTimestamp(input, qaCompleted, 'Gross Weight', 'QA Completion');

test('a time before the previous stage is refused, and the message uses plant time', () => {
  const result = check('2026-11-04T02:33:00+05:00');
  assert.equal(result.isValid, false);
  assert.match(String(result.error), /04 Nov 2026/);
  assert.match(String(result.error), /03:50/);
  assert.doesNotMatch(String(result.error), /2026-11-03T/);
});

test('the same moment as the previous stage is allowed', () => {
  assert.equal(check('2026-11-04T03:50:00+05:00').isValid, true);
});

test('a time after the previous stage is allowed', () => {
  assert.equal(check('2026-11-04T04:10:00+05:00').isValid, true);
});

test('a future time is still refused', () => {
  const future = new Date(Date.now() + 3_600_000).toISOString();
  const result = check(future);
  assert.equal(result.isValid, false);
  assert.match(String(result.error), /future/);
});
