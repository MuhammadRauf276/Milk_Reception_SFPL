import test from 'node:test';
import assert from 'node:assert/strict';
import { clampPage, pageRange, pageSlice, totalPagesFor } from '../../../lib/pagination';

const rows = Array.from({ length: 60 }, (_, i) => i + 1);

test('pages are counted correctly', () => {
  assert.equal(totalPagesFor(0, 25), 1);
  assert.equal(totalPagesFor(25, 25), 1);
  assert.equal(totalPagesFor(26, 25), 2);
  assert.equal(totalPagesFor(60, 25), 3);
});

test('each page holds the right rows, and every row appears once', () => {
  assert.deepEqual(pageSlice(rows, 1, 25).at(0), 1);
  assert.deepEqual(pageSlice(rows, 2, 25).at(0), 26);
  assert.equal(pageSlice(rows, 3, 25).length, 10);
  const all = [1, 2, 3].flatMap((p) => pageSlice(rows, p, 25));
  assert.deepEqual(all, rows);
});

test('the range shown matches the page', () => {
  assert.deepEqual(pageRange(1, 25, 60), { from: 1, to: 25 });
  assert.deepEqual(pageRange(3, 25, 60), { from: 51, to: 60 });
  assert.deepEqual(pageRange(1, 25, 0), { from: 0, to: 0 });
});

test('a page outside the list moves to the nearest real page', () => {
  assert.equal(clampPage(9, 3), 3);
  assert.equal(clampPage(0, 3), 1);
  assert.equal(clampPage(-2, 3), 1);
  assert.equal(clampPage(Number.NaN, 3), 1);
  assert.equal(clampPage(2, 0), 1);
});
