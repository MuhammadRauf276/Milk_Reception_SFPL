import test from 'node:test';
import assert from 'node:assert/strict';

test('Progress: percentage calculation and clamping boundaries', () => {
  const calculateProgressPct = (val: number | null | undefined, max = 100) => {
    if (typeof val !== 'number' || Number.isNaN(val)) return null;
    const clamped = Math.max(0, Math.min(max, val));
    return Math.round((clamped / max) * 100);
  };

  // Normal within range
  assert.equal(calculateProgressPct(45), 45);
  assert.equal(calculateProgressPct(78.6), 79);

  // Clamping lower bound
  assert.equal(calculateProgressPct(-15), 0);

  // Clamping upper bound
  assert.equal(calculateProgressPct(150), 100);

  // Indeterminate values
  assert.equal(calculateProgressPct(null), null);
  assert.equal(calculateProgressPct(undefined), null);

  // Custom max
  assert.equal(calculateProgressPct(3, 6), 50);
});

test('Progress: batch upload queue completion logic', () => {
  const getBatchUploadStatus = (completed: number, total: number, isUploading: boolean) => {
    const isDone = completed >= total && !isUploading;
    const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
    return { isDone, pct };
  };

  // In-flight halfway
  const midState = getBatchUploadStatus(2, 4, true);
  assert.equal(midState.pct, 50);
  assert.equal(midState.isDone, false);

  // Complete
  const doneState = getBatchUploadStatus(4, 4, false);
  assert.equal(doneState.pct, 100);
  assert.equal(doneState.isDone, true);

  // Zero items
  const zeroState = getBatchUploadStatus(0, 0, false);
  assert.equal(zeroState.pct, 0);
  assert.equal(zeroState.isDone, true);
});
