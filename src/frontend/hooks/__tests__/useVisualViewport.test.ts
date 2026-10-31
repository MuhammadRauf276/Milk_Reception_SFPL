import test from 'node:test';
import assert from 'node:assert/strict';
import { useVisualViewport, useVisualViewportHeight } from '../useVisualViewport';

test('useVisualViewport exports and structure', () => {
  assert.equal(typeof useVisualViewport, 'function');
  assert.equal(typeof useVisualViewportHeight, 'function');
});
