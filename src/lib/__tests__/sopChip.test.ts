import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSopChipText, numericSopRange } from '../sop-chip';

const yesNo = [{ value: 'NEGATIVE', label: 'Negative' }, { value: 'POSITIVE', label: 'Positive' }];

test('numeric range both ends, one end, none', () => {
  assert.equal(buildSopChipText({ resultType: 'NUMERIC', min: 0.07, max: 0.16 }), 'SOP 0.07 – 0.16');
  assert.equal(buildSopChipText({ resultType: 'NUMERIC', min: 3, max: 32 }), 'SOP 3.0 – 32.0');
  assert.equal(buildSopChipText({ resultType: 'NUMERIC', min: 3.5 }), 'SOP ≥ 3.5');
  assert.equal(buildSopChipText({ resultType: 'NUMERIC', max: 3.5 }), 'SOP ≤ 3.5');
  assert.equal(buildSopChipText({ resultType: 'NUMERIC' }), null);
});

test('calculated tests use the numeric range', () => {
  assert.equal(buildSopChipText({ resultType: 'CALCULATED', min: 0, max: 2.35 }), 'SOP 0.0 – 2.35');
});

test('categorical shows accepted option with its label, never a number', () => {
  assert.equal(buildSopChipText({ resultType: 'POSITIVE_NEGATIVE', allowed: ['Negative'], options: yesNo }), 'SOP: Negative');
  assert.equal(buildSopChipText({ resultType: 'POSITIVE_NEGATIVE', allowed: ['NEGATIVE'], options: yesNo }), 'SOP: Negative');
  assert.equal(buildSopChipText({ resultType: 'POSITIVE_NEGATIVE', min: 0, max: 2.35, allowed: ['Negative'], options: yesNo }), 'SOP: Negative');
  assert.equal(numericSopRange({ resultType: 'POSITIVE_NEGATIVE', min: 0, max: 2.35 }), null);
});

test('categorical with a numeric range but no accepted option has no chip', () => {
  assert.equal(buildSopChipText({ resultType: 'POSITIVE_NEGATIVE', min: 0, max: 2.35, options: yesNo }), null);
});

test('no rule means no chip', () => {
  assert.equal(buildSopChipText({ resultType: 'POSITIVE_NEGATIVE', options: yesNo }), null);
  assert.equal(buildSopChipText({ resultType: 'OK_NOT_OK', allowed: [], options: ['OK', 'NOT_OK'] }), null);
});

test('accepted values the test does not offer are ignored', () => {
  assert.equal(buildSopChipText({ resultType: 'OK_NOT_OK', allowed: ['OK', 'PASS', 'CLEAN'], options: ['OK', 'NOT_OK'] }), 'SOP: OK');
  assert.equal(buildSopChipText({ resultType: 'OK_NOT_OK', allowed: ['PASS'], options: ['OK', 'NOT_OK'] }), null);
});

test('different stages carry different rules', () => {
  assert.equal(buildSopChipText({ resultType: 'NUMERIC', min: 0.1, max: 0.16 }), 'SOP 0.1 – 0.16');
  assert.equal(buildSopChipText({ resultType: 'NUMERIC', min: 0.07, max: 0.16 }), 'SOP 0.07 – 0.16');
});
