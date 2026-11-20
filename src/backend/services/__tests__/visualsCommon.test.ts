import test from 'node:test';
import assert from 'node:assert/strict';
import { allDays, dayCount, median, previousRange, qty, tsOfPair } from '@/backend/services/visuals/visualsCommon';

test('the comparison period has the same length and ends the day before', () => {
  assert.deepEqual(previousRange('2026-11-01', '2026-11-19'), { from: '2026-10-13', to: '2026-10-31' });
  assert.deepEqual(previousRange('2026-03-01', '2026-03-01'), { from: '2026-02-28', to: '2026-02-28' });
  assert.equal(dayCount('2026-10-13', '2026-10-31'), dayCount('2026-11-01', '2026-11-19'));
});

test('every day of the range is listed, quiet days included', () => {
  assert.deepEqual(allDays('2026-02-27', '2026-03-02'), ['2026-02-27', '2026-02-28', '2026-03-01', '2026-03-02']);
});

test('median and TS from a pair', () => {
  assert.equal(median([]), null);
  assert.equal(median([5, 1, 3]), 3);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(tsOfPair(qty(1000, 1000)), 13);
  assert.equal(tsOfPair(qty(0, 0)), null);
});
