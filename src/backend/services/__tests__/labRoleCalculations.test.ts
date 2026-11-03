import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateVehicleReceivedQuantity,
  isPlantLrTest,
  isPlantFatTest,
  type VehicleCalculationPortion,
} from '../vehicleQuantityService';
import { calcKindOf, calculatedValueFor, isCalculatedTest } from '../../../lib/lab-test-roles';
import { evaluateAllCalculatedTests } from '../../../lib/calculated-tests';
import { resolveCoreMilkTestResults, validateCoreMilkTestCandidates } from '../../utils/milkTestResolvers';

/**
 * A database a user builds from scratch: LR and Fat get their own codes and names. The stored role (not the code,
 * name, order or id) is what must tell the quantity math which result is LR and which is Fat.
 */
function portion(lrCode: string, fatCode: string, withRoles: boolean): VehicleCalculationPortion {
  return {
    portionId: '1',
    portionNumber: 1,
    plantDecision: 'ACCEPTED',
    netWeightKg: 10000,
    plantLabResults: [
      { testCode: lrCode, testName: 'My Lactometer', systemRole: withRoles ? 'LR' : null, numericValue: 28, performanceStatus: 'PERFORMED' },
      { testCode: fatCode, testName: 'My Butter Fat', systemRole: withRoles ? 'FAT' : null, numericValue: 4, performanceStatus: 'PERFORMED' },
    ],
  };
}

const base = { grossWeightKg: 20000, secondWeightKg: 10000, testMode: 'PORTION' };

test('quantity math finds LR and Fat by stored role when the codes are brand new', () => {
  const custom = calculateVehicleReceivedQuantity({ ...base, portions: [portion('MY-LR-1', 'MY-FAT-9', true)] });
  const original = calculateVehicleReceivedQuantity({ ...base, portions: [portion('LT-000008', 'LT-000026', false)] });
  assert.equal(custom.isCalculable, true);
  assert.equal(original.isCalculable, true);
  if (custom.isCalculable && original.isCalculable) {
    // Same readings must give exactly the same quantities whatever the tests are called.
    assert.deepEqual(custom.internalCalculationBasis, original.internalCalculationBasis);
    assert.equal(custom.finalPhysicalLiters, original.finalPhysicalLiters);
    assert.equal(custom.finalAt13TSLiters, original.finalAt13TSLiters);
  }
});

test('without a stored role, unfamiliar codes are still refused (legacy behaviour is unchanged)', () => {
  const r = calculateVehicleReceivedQuantity({ ...base, portions: [portion('MY-LR-1', 'MY-FAT-9', false)] });
  assert.equal(r.isCalculable, false);
  if (!r.isCalculable) assert.equal(r.reason, 'MISSING_PLANT_LR');
});

test('the stored role beats the code: LT-000008 holding another role is not LR', () => {
  assert.equal(isPlantLrTest('LT-000008', 'LR at 20 Celsius', 'TOTAL_SOLIDS'), false);
  assert.equal(isPlantLrTest('ANYTHING', 'whatever', 'LR'), true);
  assert.equal(isPlantFatTest('LT-000026', 'Fat', 'LR'), false);
  assert.equal(isPlantFatTest('ANYTHING', 'whatever', 'FAT'), true);
  // legacy fallbacks (no stored role)
  assert.equal(isPlantLrTest('LT-000008'), true);
  assert.equal(isPlantFatTest('LT-000026'), true);
  assert.equal(isPlantLrTest('LT-000027'), false);
  assert.equal(isPlantFatTest('LT-000001'), false);
});

test('calculated tests are found by stored role even with unfamiliar codes and names', () => {
  const snf = { testCode: 'ZZ-1', testName: 'Dry Matter', systemRole: 'SNF', resultType: 'NUMERIC' };
  const ts = { testCode: 'ZZ-2', testName: 'Solids', systemRole: 'TOTAL_SOLIDS', resultType: 'NUMERIC' };
  const ratio = { testCode: 'ZZ-3', testName: 'Proportion', systemRole: 'SNF_FAT_RATIO', resultType: 'NUMERIC' };
  for (const t of [snf, ts, ratio]) assert.equal(isCalculatedTest(t), true);
  assert.equal(calcKindOf(snf), 'SNF');
  assert.equal(calcKindOf(ts), 'TOTAL_SOLIDS');
  assert.equal(calcKindOf(ratio), 'RATIO');

  const calcs = evaluateAllCalculatedTests({ LR: 28, FAT: 4 });
  assert.equal(calculatedValueFor(snf, calcs), calcs.SNF_CANONICAL);
  assert.equal(calculatedValueFor(ts, calcs), calcs.TOTAL_SOLIDS);
  assert.equal(calculatedValueFor(ratio, calcs), calcs.RATIO_SNF_FAT);
  assert.ok((calculatedValueFor(snf, calcs) ?? 0) > 0);
});

test('legacy calculated tests behave as before, and a name match never captures ordinary tests', () => {
  const master = { testCode: 'SYS-SNF', testName: 'Solids-Not-Fat (SNF)', resultType: 'CALCULATED' };
  const masterTs = { testCode: 'SYS-TS', testName: 'Total Solids (TS)', resultType: 'CALCULATED' };
  const masterRatio = { testCode: 'LT-000009', testName: 'SNF to Fat Ratio', resultType: 'CALCULATED' };
  assert.equal(calcKindOf(master), 'SNF'); // was wrongly read as Total Solids before
  assert.equal(calcKindOf(masterTs), 'TOTAL_SOLIDS');
  assert.equal(calcKindOf(masterRatio), 'RATIO');

  // "Whey Protein Ratio" is an ordinary lab test: it must never be treated as the SNF/Fat ratio.
  assert.equal(isCalculatedTest({ testCode: 'LT-000023', testName: 'Whey Protein Ratio', resultType: 'NUMERIC' }), false);
  // Categorical tests are never calculated, even if they carry a stored calculated role by mistake.
  assert.equal(isCalculatedTest({ testCode: 'LT-000011', testName: 'Starch', systemRole: 'SNF', resultType: 'POSITIVE_NEGATIVE' }), false);
  // A plain numeric test is not calculated.
  assert.equal(isCalculatedTest({ testCode: 'LT-000001', testName: 'Temperature', resultType: 'NUMERIC' }), false);
});

// ─── ZMCC lab core LR/Fat resolver ──────────────────────────────────────────────────────────────────────────────
const snap = (id: number, code: string, name: string, value: number | null, type = 'NUMERIC') => ({
  test_id: BigInt(id),
  test_code_snapshot: code,
  test_name_snapshot: name,
  result_type_snapshot: type,
  numeric_value: value,
});

test('resolver: a fresh database with odd names resolves LR and Fat by the stored roles', () => {
  const rows = [
    snap(11, 'X-1', 'Butter %', 4.1),
    snap(12, 'X-2', 'Density Meter', 29),
    snap(13, 'X-3', 'Temperature', 6),
  ];
  const roles = new Map<string, string | null>([['11', 'FAT'], ['12', 'LR']]);
  const r = resolveCoreMilkTestResults(rows, roles);
  assert.equal(r.success, true);
  if (r.success) {
    assert.equal(r.lr, 29);
    assert.equal(r.fat, 4.1);
  }
  // Without the stored roles the same odd names cannot be resolved (fails closed, as before).
  assert.equal(resolveCoreMilkTestResults(rows).success, false);
});

test('resolver: the stored role beats a look-alike name, and removes false ambiguity', () => {
  const rows = [
    snap(1, 'LT-000008', 'LR at 20 Celsius', 28),
    snap(2, 'LT-000027', 'Lactometer Reading', 30), // also looks like LR by name
    snap(3, 'LT-000026', 'Fat', 4),
    snap(4, 'LT-000009', 'SNF to Fat Ratio', 2.1, 'CALCULATED'),
  ];
  // Legacy only: two LR-looking tests -> ambiguous.
  assert.equal(validateCoreMilkTestCandidates(rows).valid, false);
  // With the stored roles the LR test is exactly the one holding the role.
  const roles = new Map<string, string | null>([['1', 'LR'], ['3', 'FAT']]);
  const r = resolveCoreMilkTestResults(rows, roles);
  assert.equal(r.success, true);
  if (r.success) assert.equal(r.lr, 28);
});

test('resolver: behaviour without stored roles is unchanged', () => {
  const rows = [snap(1, 'LT-000008', 'LR at 20 Celsius', 28), snap(3, 'LT-000026', 'Fat', 4)];
  const r = resolveCoreMilkTestResults(rows);
  assert.equal(r.success, true);
  if (r.success) {
    assert.equal(r.lr, 28);
    assert.equal(r.fat, 4);
  }
});

import { pickVehicleLrFat } from '../dispatch/vehicleQuality';

test('dispatch LR/Fat: server totals first, client values only as a fallback', () => {
  const none = { singlePortionLr: null, singlePortionFat: null };
  // server has values, client disagrees -> server wins
  assert.deepEqual(
    pickVehicleLrFat({ serverWeightedLr: 28, serverWeightedFat: 4, ...none, clientLr: [31, 30], clientFat: [6, 5] }),
    { lr: 28, fat: 4 }
  );
  // server totals empty, single portion has them -> portion value, not client
  assert.deepEqual(
    pickVehicleLrFat({ serverWeightedLr: 0, serverWeightedFat: 0, singlePortionLr: 27, singlePortionFat: 3.5, clientLr: [31], clientFat: [6] }),
    { lr: 27, fat: 3.5 }
  );
  // policy without LR/Fat tests -> client fallback (first valid one)
  assert.deepEqual(
    pickVehicleLrFat({ serverWeightedLr: 0, serverWeightedFat: 0, ...none, clientLr: [null, 29], clientFat: [undefined, 0] }),
    { lr: 29, fat: 0 }
  );
  // nothing anywhere -> null (the caller decides: ZMCC answers 400)
  assert.deepEqual(
    pickVehicleLrFat({ serverWeightedLr: 0, serverWeightedFat: 0, ...none, clientLr: [0, NaN], clientFat: [-1] }),
    { lr: null, fat: null }
  );
});
