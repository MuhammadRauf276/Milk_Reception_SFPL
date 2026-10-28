import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateAllCalculatedTests,
  FORMULA_SNF_CANONICAL,
  FORMULA_TOTAL_SOLIDS,
  FORMULA_RATIO_SNF_FAT,
} from '@/lib/calculated-tests';
import { evaluateTestObservation, type QualityRule } from '@/lib/lab-rules';
import { MASTER_30_LAB_TESTS, getMasterSpec } from '@/lib/master-lab-tests-data';

test('Richmond Equation - cow milk (LR=28.0, Fat=3.5%)', () => {
  // Richmond formula: 28.0 / 4 + 0.22 * 3.5 + 0.72 = 7.0 + 0.77 + 0.72 = 8.49
  const snf = FORMULA_SNF_CANONICAL.calculate({ LR: 28.0, FAT: 3.5 });
  assert.ok(snf !== null);
  assert.ok(Math.abs(snf - 8.49) < 0.01, `Expected 8.49, got ${snf}`);
});

test('Richmond Equation - buffalo milk (LR=30.0, Fat=6.5%)', () => {
  // Richmond formula: 30.0 / 4 + 0.22 * 6.5 + 0.72 = 7.5 + 1.43 + 0.72 = 9.65
  const snf = FORMULA_SNF_CANONICAL.calculate({ LR: 30.0, FAT: 6.5 });
  assert.ok(snf !== null);
  assert.ok(Math.abs(snf - 9.65) < 0.01, `Expected 9.65, got ${snf}`);
});

test('Total Solids calculation (Fat + SNF)', () => {
  const ts = FORMULA_TOTAL_SOLIDS.calculate({ FAT: 3.5, SNF: 8.49 });
  assert.ok(ts !== null);
  assert.ok(Math.abs(ts - 11.99) < 0.01, `Expected 11.99, got ${ts}`);
});

test('SNF to Fat Ratio calculation (SNF / Fat)', () => {
  const ratio = FORMULA_RATIO_SNF_FAT.calculate({ FAT: 3.5, SNF: 8.49 });
  assert.ok(ratio !== null);
  assert.ok(Math.abs(ratio - 2.426) < 0.01, `Expected 2.426, got ${ratio}`);
});

test('evaluateAllCalculatedTests computes canonical values', () => {
  const res = evaluateAllCalculatedTests({ LR: 28.0, FAT: 3.5 });
  assert.ok(res.SNF_CANONICAL !== null);
  assert.ok(Math.abs(res.SNF_CANONICAL - 8.49) < 0.01);
  assert.ok(res.TOTAL_SOLIDS !== null);
  assert.ok(Math.abs(res.TOTAL_SOLIDS - 11.99) < 0.01);
  assert.ok(res.RATIO_SNF_FAT !== null);
  assert.ok(Math.abs(res.RATIO_SNF_FAT - 2.43) < 0.01);
});

test('Safe null handling when dependencies are missing or zero-fat divisor', () => {
  const missing = evaluateAllCalculatedTests({ LR: null, FAT: 3.5 });
  assert.equal(missing.SNF_CANONICAL, null);
  assert.equal(missing.TOTAL_SOLIDS, null);
  assert.equal(missing.RATIO_SNF_FAT, null);

  const zeroFat = FORMULA_RATIO_SNF_FAT.calculate({ FAT: 0, SNF: 8.5 });
  assert.equal(zeroFat, null);
});

test('3-Zone SOP: Temperature evaluation (Pass vs Fail)', () => {
  const temperatureRule: QualityRule = {
    testCode: 'LT-000001',
    testName: 'Temperature (°C)',
    resultType: 'NUMERIC',
    category: 'RELEASE',
    minValue: 0,
    maxValue: 10,
  };

  const pass = evaluateTestObservation(temperatureRule, 4.0, 'COMPULSORY');
  assert.equal(pass.zone, 'PASS');
  assert.equal(pass.isPass, true);
  assert.equal(pass.isFail, false);

  const fail = evaluateTestObservation(temperatureRule, 11.5, 'COMPULSORY');
  assert.equal(fail.zone, 'FAIL');
  assert.equal(fail.isPass, false);
  assert.equal(fail.isFail, true);
});

test('3-Zone SOP: Lactometer Warning Zone (Tolerance Hold)', () => {
  const lrRule: QualityRule = {
    testCode: 'LT-000008',
    testName: 'Lactometer Reading (LR)',
    resultType: 'NUMERIC',
    category: 'RELEASE',
    minValue: 28.0,
    maxValue: 32.0,
    warningBands: [{ min: 26.0, max: 27.9 }],
  };

  const pass = evaluateTestObservation(lrRule, 29.0, 'COMPULSORY');
  assert.equal(pass.zone, 'PASS');

  const warn = evaluateTestObservation(lrRule, 27.0, 'COMPULSORY');
  assert.equal(warn.zone, 'WARNING');
  assert.equal(warn.isWarning, true);
  assert.equal(warn.isFail, false); // Warnings never auto-reject!

  const fail = evaluateTestObservation(lrRule, 25.0, 'COMPULSORY');
  assert.equal(fail.zone, 'FAIL');
  assert.equal(fail.isFail, true);
});

test('Monitoring Norms are compulsory to record but never reject milk', () => {
  const monitoringRule: QualityRule = {
    testCode: 'LT-000026',
    testName: 'Monitoring LR Min (Yield)',
    resultType: 'NUMERIC',
    category: 'MONITORING',
    minValue: 22.0,
  };

  const res = evaluateTestObservation(monitoringRule, 20.0, 'COMPULSORY');
  assert.equal(res.isFail, false); // Never system-rejects milk!
  assert.equal(res.isWarning, true); // Informational warning alert
  assert.ok(res.message.includes('Monitoring Norm'));
});

test('Applied (non-compulsory) mode does not enforce system rules', () => {
  const aflatoxinRule: QualityRule = {
    testCode: 'LT-000030',
    testName: 'Aflatoxin value',
    resultType: 'NUMERIC',
    category: 'RELEASE',
    minValue: 0,
    maxValue: 1000,
  };

  const res = evaluateTestObservation(aflatoxinRule, 1500, 'APPLIED');
  assert.equal(res.zone, 'INFORMATIONAL_APPLIED');
  assert.equal(res.isFail, false);
  assert.ok(res.message.includes('Not under SOP'));
});

test('Master 30 Lab Tests catalog contains 30 items matching Excel', () => {
  assert.equal(MASTER_30_LAB_TESTS.length, 30);
  const temp = getMasterSpec('LT-000001');
  assert.ok(temp);
  assert.equal(temp?.passRange, '0 – 10');
  assert.equal(temp?.failReject, '≥ 11');
});
