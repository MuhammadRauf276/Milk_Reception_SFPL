import test from 'node:test';
import assert from 'node:assert/strict';
import { TableWrapper, ResponsiveTableWrapper } from '../table-wrapper';

test('TableWrapper exports and aliases', () => {
  assert.equal(typeof TableWrapper, 'object'); // React.forwardRef object
  assert.equal(TableWrapper, ResponsiveTableWrapper);
});
