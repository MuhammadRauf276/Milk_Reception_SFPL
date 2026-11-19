import test from 'node:test';
import assert from 'node:assert/strict';
import { FUTURE_ALLOWANCE_MS, validateOperationalTimestamp, withinFutureAllowance } from '@/backend/services/chronology-validator';
import { learnServerTime, serverClockOffsetMs, serverNow } from '@/lib/serverClock';

const now = new Date('2026-11-19T08:00:00.000Z');

test('a time slightly ahead of the server counts as now; clearly ahead is refused; past times stay as they are', () => {
  assert.equal(withinFutureAllowance(new Date(now.getTime() + 3 * 60_000), now)?.getTime(), now.getTime());
  assert.equal(withinFutureAllowance(new Date(now.getTime() + FUTURE_ALLOWANCE_MS), now)?.getTime(), now.getTime());
  assert.equal(withinFutureAllowance(new Date(now.getTime() + FUTURE_ALLOWANCE_MS + 1), now), null);
  const past = new Date(now.getTime() - 60_000);
  assert.equal(withinFutureAllowance(past, now), past);
});

test('the shared step check uses the same rule and message', () => {
  const slightlyAhead = new Date(Date.now() + 5 * 60_000).toISOString();
  assert.equal(validateOperationalTimestamp(slightlyAhead, null, 'QA Decision', 'QA Start').isValid, true);
  const wrongHour = new Date(Date.now() + 60 * 60_000).toISOString();
  const r = validateOperationalTimestamp(wrongHour, null, 'QA Decision', 'QA Start');
  assert.equal(r.isValid, false);
  assert.match(String(r.error), /ahead of the server clock/);
});

test('the device learns how far its clock is from the server and fills times with server time', () => {
  // Phone 7 minutes fast: the server says 08:00 while the phone's clock read 08:07 around the request.
  const phone = Date.now();
  learnServerTime(phone - 7 * 60_000, phone - 100, phone + 100);
  assert.ok(Math.abs(serverClockOffsetMs() + 7 * 60_000) < 1_000);
  assert.ok(Math.abs(serverNow().getTime() - (Date.now() - 7 * 60_000)) < 1_000);
  // Ordinary network delay is not treated as a wrong clock.
  learnServerTime(phone + 500, phone, phone + 200);
  assert.equal(serverClockOffsetMs(), 0);
});
