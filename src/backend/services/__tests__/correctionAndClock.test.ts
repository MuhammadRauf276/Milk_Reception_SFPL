import test from 'node:test';
import assert from 'node:assert/strict';
import { planTankCorrectionRows } from '../tankCorrectionLedger';
import { resolveCollectionTime } from '../mot/collectionTime';
import { getPakistanDayWindow } from '../../core/business-day';

test('no change writes no ledger row', () => {
  assert.deepEqual(planTankCorrectionRows(0, 0), []);
  assert.deepEqual(planTankCorrectionRows(0.001, -0.004), []);
});

test('litres and @13 TS moving together share one row', () => {
  assert.deepEqual(planTankCorrectionRows(10, 9.5), [{ kind: 'PHYSICAL', type: 'ADJUSTMENT_IN', quantityLiters: 10, at13Liters: 9.5 }]);
  assert.deepEqual(planTankCorrectionRows(-10, -9.5), [{ kind: 'PHYSICAL', type: 'ADJUSTMENT_OUT', quantityLiters: 10, at13Liters: 9.5 }]);
});

const sign = (t: string) => (t === 'ADJUSTMENT_IN' ? 1 : -1);
const netLiters = (rows: ReturnType<typeof planTankCorrectionRows>) => Number(rows.reduce((n, r) => n + sign(r.type) * r.quantityLiters, 0).toFixed(2));
const netAt13 = (rows: ReturnType<typeof planTankCorrectionRows>) => Number(rows.reduce((n, r) => n + sign(r.type) * r.at13Liters, 0).toFixed(2));

test('a change in @13 TS alone reaches the ledger and leaves litres alone', () => {
  for (const change of [12, -12]) {
    const rows = planTankCorrectionRows(0, change);
    assert.equal(netLiters(rows), 0);
    assert.equal(netAt13(rows), change);
  }
});

test('opposite directions keep both totals correct', () => {
  const rows = planTankCorrectionRows(5, -3);
  assert.equal(netLiters(rows), 5);
  assert.equal(netAt13(rows), -3);
});

test('every row satisfies the database rule: litres above zero, and a unique key', () => {
  for (const [liters, at13] of [[0, 12], [0, -12], [5, 3], [-5, -3], [5, -3], [-5, 3], [5, 0], [-5, 0]]) {
    const rows = planTankCorrectionRows(liters, at13);
    assert.ok(rows.length > 0);
    assert.ok(rows.every((r) => r.quantityLiters > 0 && r.at13Liters >= 0));
    assert.equal(new Set(rows.map((r) => r.kind)).size, rows.length);
  }
});

const startedAt = new Date('2026-11-09T05:00:00Z');
const now = new Date('2026-11-09T07:00:00Z');

test('a sensible phone time is kept', () => {
  const phoneTime = new Date('2026-11-09T06:00:00Z');
  assert.deepEqual(resolveCollectionTime({ phoneTime, now, startedAt }), { collectedAt: phoneTime, corrected: false });
});

test('small clock drift is allowed and not flagged', () => {
  const phoneTime = new Date('2026-11-09T07:04:00Z');
  assert.equal(resolveCollectionTime({ phoneTime, now, startedAt }).corrected, false);
});

test('a phone clock in the future saves at the server time and is flagged', () => {
  const r = resolveCollectionTime({ phoneTime: new Date('2027-01-01T00:00:00Z'), now, startedAt });
  assert.deepEqual(r, { collectedAt: now, corrected: true });
});

test('a phone clock before the journey saves at the journey start and is flagged', () => {
  const r = resolveCollectionTime({ phoneTime: new Date('2020-01-01T00:00:00Z'), now, startedAt });
  assert.deepEqual(r, { collectedAt: startedAt, corrected: true });
});

test('a time after the journey ended moves back to the end and is flagged', () => {
  const endedAt = new Date('2026-11-09T06:30:00Z');
  const r = resolveCollectionTime({ phoneTime: new Date('2026-11-09T06:50:00Z'), now, startedAt, endedAt });
  assert.deepEqual(r, { collectedAt: endedAt, corrected: true });
});

test('the business day runs 08:00 to 08:00 Pakistan time', () => {
  const day = getPakistanDayWindow('2026-11-09');
  assert.equal(day.start.toISOString(), '2026-11-09T03:00:00.000Z');
  assert.equal(day.end.toISOString(), '2026-11-10T02:59:59.999Z');
  assert.equal(day.dateStart.toISOString(), '2026-11-09T00:00:00.000Z');
});

test('the business day crosses a month end', () => {
  assert.equal(getPakistanDayWindow('2026-11-30').end.toISOString(), '2026-12-01T02:59:59.999Z');
});
