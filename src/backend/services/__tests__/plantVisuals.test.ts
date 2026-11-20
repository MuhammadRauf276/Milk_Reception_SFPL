import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hourBucketIndex,
  histogramBuckets,
  normaliseReason,
  percentile,
  rejectionRate,
  slowestStage,
  topReasons,
  weightedMedian,
} from '@/backend/modules/management-reporting/visuals/plantContracts';

test('percentile interpolates like percentile_cont', () => {
  assert.equal(percentile([], 0.5), null);
  assert.equal(percentile([5], 0.9), 5);
  assert.equal(percentile([1, 2, 3, 4], 0.5), 2.5);
  assert.equal(percentile([40, 10, 30, 20], 0.9), 37);
});

test('time buckets are whole hours with 8 h and more last', () => {
  assert.equal(hourBucketIndex(0), 0);
  assert.equal(hourBucketIndex(59.9), 0);
  assert.equal(hourBucketIndex(60), 1);
  assert.equal(hourBucketIndex(479), 7);
  assert.equal(hourBucketIndex(480), 8);
  assert.equal(hourBucketIndex(5000), 8);
  assert.equal(hourBucketIndex(-1), null);
  assert.equal(hourBucketIndex(null), null);
  assert.deepEqual(histogramBuckets([10, 70, 75, 600, null]), [1, 2, 0, 0, 0, 0, 0, 0, 1]);
});

test('reasons are cleaned, merged, and the tail becomes Others', () => {
  assert.equal(normaliseReason('  High   ACIDITY '), 'high acidity');
  assert.equal(normaliseReason('   '), '(no reason)');
  const rows = [
    { reason: 'Clots', count: 2 },
    { reason: ' clots ', count: 1 },
    { reason: 'Urea', count: 2 },
    { reason: 'Water', count: 1 },
    { reason: 'Odd', count: 1 },
  ];
  assert.deepEqual(topReasons(rows, 2), [
    { reason: 'clots', count: 3 },
    { reason: 'urea', count: 2 },
    { reason: 'Others', count: 2 },
  ]);
});

test('slowest stage, rejection rate and weighted median', () => {
  assert.equal(slowestStage({ qa: 20, unloading: 45, gate_qa: null }), 'unloading');
  assert.equal(slowestStage({}), null);
  assert.equal(rejectionRate(9, 1), 10);
  assert.equal(rejectionRate(0, 0), null);
  assert.equal(weightedMedian(30 * 2 + 60 * 2, 4), 45);
  assert.equal(weightedMedian(0, 0), null);
});
