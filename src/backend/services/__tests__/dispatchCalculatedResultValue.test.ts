import test from 'node:test';
import assert from 'node:assert/strict';
import { storedCalculatedValue } from '@/backend/services/dispatch/calculatedResultValue';

const snf = { testCode: 'LT-X1', testName: 'Solids Not Fat', resultType: 'CALCULATED', systemRole: 'SNF' };
const ts = { testCode: 'LT-X2', testName: 'Total Solids', resultType: 'CALCULATED', systemRole: 'TOTAL_SOLIDS' };
const ratio = { testCode: 'LT-X3', testName: 'SNF to Fat Ratio', resultType: 'CALCULATED', systemRole: 'SNF_FAT_RATIO' };

test('each calculated test is stored with its own value (LR 25, Fat 4.0)', () => {
  assert.equal(storedCalculatedValue(snf, 25, 4)?.value, 7.85);
  assert.equal(storedCalculatedValue(ts, 25, 4)?.value, 11.85);
  assert.equal(storedCalculatedValue(ratio, 25, 4)?.value, 1.96);
});

test('renamed codes and names with a stored role still map to the right kind', () => {
  const renamed = (role: string, resultType = 'CALCULATED') => ({ testCode: 'ZZ-1', testName: 'Renamed thing', resultType, systemRole: role });
  assert.equal(storedCalculatedValue(renamed('SNF'), 25, 4)?.value, 7.85);
  assert.equal(storedCalculatedValue(renamed('TOTAL_SOLIDS', 'NUMERIC'), 25, 4)?.value, 11.85);
  assert.equal(storedCalculatedValue(renamed('SNF_FAT_RATIO'), 25, 4)?.value, 1.96);
});

test('legacy tests with no stored role fall back to the existing matching', () => {
  assert.equal(storedCalculatedValue({ testCode: 'LT-000009', testName: 'SNF to Fat Ratio', resultType: 'CALCULATED' }, 25, 4)?.value, 1.96);
  assert.equal(storedCalculatedValue({ testCode: 'SYS-TS', testName: 'Total Solids', resultType: 'CALCULATED' }, 25, 4)?.value, 11.85);
});

test('missing or invalid LR or Fat stores null (never 0, never the ratio)', () => {
  for (const t of [snf, ts, ratio]) {
    assert.equal(storedCalculatedValue(t, null, 4)?.value, null);
    assert.equal(storedCalculatedValue(t, 25, null)?.value, null);
    assert.equal(storedCalculatedValue(t, undefined, undefined)?.value, null);
    assert.equal(storedCalculatedValue(t, 0, 4)?.value, null);
    assert.equal(storedCalculatedValue(t, 25, 0)?.value, null);
    assert.equal(storedCalculatedValue(t, NaN, 4)?.value, null);
  }
});

test('the helper takes no client value: the result depends only on LR and Fat', () => {
  assert.equal(storedCalculatedValue.length, 3);
  assert.deepEqual(storedCalculatedValue(snf, 25, 4), { value: 7.85 });
});

test('a categorical or ordinary test is never calculated', () => {
  assert.equal(storedCalculatedValue({ testCode: 'LT-STARCH', testName: 'Starch', resultType: 'POSITIVE_NEGATIVE' }, 25, 4), null);
  assert.equal(storedCalculatedValue({ testCode: 'LT-000026', testName: 'Fat', resultType: 'NUMERIC', systemRole: 'FAT' }, 25, 4), null);
  assert.equal(storedCalculatedValue({ testCode: 'LT-T', testName: 'Temperature', resultType: 'NUMERIC' }, 25, 4), null);
  assert.equal(storedCalculatedValue({ ...snf, resultType: 'OK_NOT_OK', systemRole: null }, 25, 4), null);
});
