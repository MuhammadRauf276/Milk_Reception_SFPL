import test from 'node:test';
import assert from 'node:assert/strict';
import { pairTests, summariseTests } from '@/backend/services/management/dispatchVsPlantReport';

const t = (testId: string, testName: string, value: number | null, displayOrder = 1) => ({ testId, testName, unit: null, displayOrder, value });

test('pairTests averages portions per side and reports plant minus dispatch', () => {
  const out = pairTests([t('1', 'Fat', 4), t('1', 'Fat', 3.8), t('2', 'LR', 28)], [t('1', 'Fat', 3.7), t('3', 'Temp', 4, 3)]);
  const fat = out.find((x) => x.testId === '1')!;
  assert.equal(fat.dispatch, 3.9);
  assert.equal(fat.plant, 3.7);
  assert.equal(fat.delta, -0.2);
  assert.equal(out.find((x) => x.testId === '2')!.plant, null);
  assert.equal(out.find((x) => x.testId === '2')!.delta, null);
  assert.equal(out.find((x) => x.testId === '3')!.dispatch, null);
});

test('pairTests ignores empty values and keeps the master test order', () => {
  const out = pairTests([t('b', 'B', 1, 2), t('a', 'A', null, 1), t('c', 'C', 5, 1)], []);
  assert.deepEqual(out.map((x) => x.testId), ['c', 'b']);
});

test('summariseTests only counts tankers that have both sides', () => {
  const rows = [
    { tests: pairTests([t('1', 'Fat', 4)], [t('1', 'Fat', 3.8)]) },
    { tests: pairTests([t('1', 'Fat', 3)], [t('1', 'Fat', 3.2)]) },
    { tests: pairTests([t('1', 'Fat', 9)], []) },
  ];
  const [fat] = summariseTests(rows);
  assert.equal(fat.vehicles, 2);
  assert.equal(fat.dispatchAvg, 3.5);
  assert.equal(fat.plantAvg, 3.5);
  assert.equal(fat.deltaAvg, 0);
});
