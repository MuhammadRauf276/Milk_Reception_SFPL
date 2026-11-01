import test from 'node:test';
import assert from 'node:assert/strict';
import { ReAuthModal } from '../ReAuthModal';

test('ReAuthModal: exports a valid React component function', () => {
  assert.equal(typeof ReAuthModal, 'function', 'ReAuthModal must be a function component');
  assert.equal(ReAuthModal.name, 'ReAuthModal');
});

test('ReAuthModal: exports component successfully', () => {
  assert.ok(ReAuthModal);
});
