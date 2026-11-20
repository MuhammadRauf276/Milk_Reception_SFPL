import test from 'node:test';
import assert from 'node:assert/strict';
import {
  businessDate,
  crossesBusinessDay,
  lateEntry,
  medianOf,
  notAtPlantYet,
  pkDate,
  plantNextDay,
  sharedFill,
  tankerFlags,
  transitBucket,
  transitMinutes,
} from '@/backend/modules/management-reporting/visuals/tankersContracts';

// 2026-10-10 20:00 Pakistan = 15:00 UTC
const DISPATCH = '2026-10-10T15:00:00Z';

test('pakistan date and business date', () => {
  assert.equal(pkDate('2026-10-10T20:30:00Z'), '2026-10-11');
  assert.equal(businessDate('2026-10-10T02:30:00Z'), '2026-10-09'); // 07:30 PK belongs to the day before
  assert.equal(businessDate('2026-10-10T03:00:00Z'), '2026-10-10'); // 08:00 PK
});

test('plantNextDay compares calendar dates, gate entry first then first weight', () => {
  assert.deepEqual(plantNextDay(DISPATCH, '2026-10-10T18:00:00Z', null), { next: false, days: 0 }); // 23:00 PK same day
  assert.deepEqual(plantNextDay(DISPATCH, '2026-10-10T19:30:00Z', null), { next: true, days: 1 }); // 00:30 PK next
  assert.deepEqual(plantNextDay(DISPATCH, null, '2026-10-12T09:00:00Z'), { next: true, days: 2 });
  assert.deepEqual(plantNextDay(DISPATCH, null, null), { next: false, days: 0 });
  assert.deepEqual(plantNextDay(null, '2026-10-12T09:00:00Z', null), { next: false, days: 0 });
});

test('crossesBusinessDay', () => {
  assert.equal(crossesBusinessDay(DISPATCH, '2026-10-10T19:30:00Z', null), false); // 00:30 PK is still the same business day
  assert.equal(crossesBusinessDay(DISPATCH, '2026-10-11T03:30:00Z', null), true); // 08:30 PK, next business day
  assert.equal(crossesBusinessDay(DISPATCH, null, null), false);
});

test('sharedFill and notAtPlantYet', () => {
  assert.equal(sharedFill(1), false);
  assert.equal(sharedFill(2), true);
  assert.equal(sharedFill(null), false);
  assert.equal(notAtPlantYet(null), true);
  assert.equal(notAtPlantYet(DISPATCH), false);
});

test('transitMinutes', () => {
  assert.equal(transitMinutes(DISPATCH, '2026-10-10T17:30:00Z'), 150);
  assert.equal(transitMinutes(DISPATCH, '2026-10-10T14:00:00Z'), null);
  assert.equal(transitMinutes(DISPATCH, null), null);
});

test('lateEntry reports the worst step at 60 minutes or more', () => {
  assert.deepEqual(lateEntry({ dispatch: 59, gate: 10, weight: null }), { late: false, step: null, minutes: null });
  assert.deepEqual(lateEntry({ dispatch: 60, gate: 200, weight: 90 }), { late: true, step: 'gate', minutes: 200 });
  assert.deepEqual(lateEntry({ dispatch: 60 }), { late: true, step: 'dispatch', minutes: 60 });
});

test('buckets and median', () => {
  assert.deepEqual([0, 119, 120, 239, 240, 479, 480, 719, 720, 1439, 1440].map(transitBucket), [0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5]);
  assert.equal(medianOf([]), null);
  assert.equal(medianOf([3, 1, 2]), 2);
  assert.equal(medianOf([4, 1, 2, 3]), 2.5);
});

test('tankerFlags puts it together', () => {
  const f = tankerFlags({ dispatchAt: DISPATCH, gateIn: '2026-10-11T03:30:00Z', firstWeightAt: null, fillCount: 2, delays: { dispatch: 0, gate: 75, weight: null } });
  assert.equal(f.nextDay, true);
  assert.equal(f.crosses, true);
  assert.equal(f.shared, true);
  assert.equal(f.late, true);
  assert.equal(f.lateStep, 'gate');
  assert.equal(f.notYet, false);
  assert.equal(f.transit, 750);
});
