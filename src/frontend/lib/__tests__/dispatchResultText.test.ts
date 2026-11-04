import test from 'node:test';
import assert from 'node:assert/strict';
import type { PortionLabTestResult } from '@backend/core/types';
import { dispatchResultText } from '../dispatchResultText';

const result = (over: Partial<PortionLabTestResult>): PortionLabTestResult => ({
  test_code: 'LT-1',
  test_name: 'Test',
  result_type: 'NUMERIC',
  dispatch_performed: false,
  plant_performed: false,
  ...over,
});

test('a value is shown as it is, even when zero', () => {
  assert.equal(dispatchResultText(result({ dispatch_performed: true, dispatch_numeric_value: 0 })), '0');
  assert.equal(dispatchResultText(result({ dispatch_performed: true, dispatch_text_value: 'OK' })), 'OK');
});

test('a value wins over a not-performed mark', () => {
  assert.equal(
    dispatchResultText(result({ dispatch_numeric_value: 3.8, dispatch_marked_not_performed: true, dispatch_not_performed_reason: 'Contract Vehicle' })),
    '3.8'
  );
});

test('a test marked not performed shows its reason', () => {
  assert.equal(
    dispatchResultText(result({ dispatch_marked_not_performed: true, dispatch_not_performed_reason: ' Contract Vehicle ' })),
    'Not performed: Contract Vehicle'
  );
});

test('a test marked not performed without a reason still says so', () => {
  assert.equal(dispatchResultText(result({ dispatch_marked_not_performed: true, dispatch_not_performed_reason: null })), 'Not performed');
  assert.equal(dispatchResultText(result({ dispatch_marked_not_performed: true, dispatch_not_performed_reason: '  ' })), 'Not performed');
});

test('a reason that already says not performed is not repeated', () => {
  assert.equal(
    dispatchResultText(result({ dispatch_marked_not_performed: true, dispatch_not_performed_reason: 'Not performed at dispatch' })),
    'Not performed at dispatch'
  );
});

test('a test with no result row is not recorded', () => {
  assert.equal(dispatchResultText(result({})), 'Not recorded');
});
