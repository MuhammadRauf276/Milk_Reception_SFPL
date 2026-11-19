import test from 'node:test';
import assert from 'node:assert/strict';
import { advancePastPredecessors, validateOperationalTimestamp } from '../chronology-validator';

// The Weighbridge report: QA completed 22:50 UTC on 3 Nov, which is 03:50 on 4 Nov in Pakistan.
const qaCompleted = new Date('2026-11-03T22:50:00.000Z');
const check = (input: string) => validateOperationalTimestamp(input, qaCompleted, 'Gross Weight', 'QA Completion');

test('a time before the previous stage is auto-advanced so idle screen stays are never blocked', () => {
  const result = check('2026-11-04T02:33:00+05:00');
  assert.equal(result.isValid, true);
  assert.ok(result.date && result.date.getTime() >= qaCompleted.getTime());
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
  assert.match(String(result.error), /ahead of the server clock/);
});

test('a stale arrival time moves up to the latest recorded event instead of blocking', () => {
  const entered = new Date('2026-11-07T10:12:00.000Z');
  const collected = new Date('2026-11-07T10:17:06.583Z');
  assert.equal(advancePastPredecessors(entered, [new Date('2026-11-07T06:00:00.000Z'), collected, null]).getTime(), collected.getTime());
});

test('a correct arrival time is left exactly as entered', () => {
  const entered = new Date('2026-11-07T10:20:00.000Z');
  assert.equal(advancePastPredecessors(entered, [new Date('2026-11-07T10:17:06.583Z'), undefined]), entered);
});
