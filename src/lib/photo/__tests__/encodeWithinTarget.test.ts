import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeWithinTarget } from '../captureFrame';

const blobOf = (bytes: number) => new Blob([new Uint8Array(bytes)]);

test('it keeps the best quality that fits', async () => {
  const tried: number[] = [];
  const blob = await encodeWithinTarget(
    async (q) => {
      tried.push(q);
      return blobOf(300);
    },
    [0.8, 0.7],
    500
  );
  assert.deepEqual(tried, [0.8]);
  assert.equal(blob.size, 300);
});

test('it steps down only until the photo fits', async () => {
  const sizes: Record<number, number> = { 0.8: 900, 0.7: 450, 0.6: 200 };
  const tried: number[] = [];
  const blob = await encodeWithinTarget(
    async (q) => {
      tried.push(q);
      return blobOf(sizes[q]);
    },
    [0.8, 0.7, 0.6],
    500
  );
  assert.deepEqual(tried, [0.8, 0.7]);
  assert.equal(blob.size, 450);
});

test('a very detailed photo stops at the lowest quality instead of losing more clarity', async () => {
  const tried: number[] = [];
  const blob = await encodeWithinTarget(
    async (q) => {
      tried.push(q);
      return blobOf(900);
    },
    [0.8, 0.6],
    500
  );
  assert.deepEqual(tried, [0.8, 0.6]);
  assert.equal(blob.size, 900);
});

test('a failed encode reaches the caller', async () => {
  await assert.rejects(encodeWithinTarget(async () => Promise.reject(new Error('Could not save the photo.'))));
});
