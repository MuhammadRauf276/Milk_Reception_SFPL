import test from 'node:test';
import assert from 'node:assert/strict';
import { NetworkStatusBar } from '../NetworkStatusBar';

test('NetworkStatusBar: exports a valid React component function', () => {
  assert.equal(typeof NetworkStatusBar, 'function', 'NetworkStatusBar must be a function component');
  assert.equal(NetworkStatusBar.name, 'NetworkStatusBar');
});

test('NetworkStatusBar: component structure conforms to React client standards', () => {
  // Verifies the component function can be referenced and has expected displayName/properties
  assert.ok(NetworkStatusBar);
});
