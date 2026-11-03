import test from 'node:test';
import assert from 'node:assert/strict';
import { calcKindOf, isCalculatedTest, isTemperatureTest } from '../../../lib/lab-test-roles';
import { findRoleResult, isConfiguredSnfTest, isRoleTest } from '../../utils/roleAwareMatch';
import { incidentKind } from '../mpdExecutiveService';
import { isMissingSystemRoleColumn, loadSystemRoles, type PolicyDb } from '../testPointPolicyService';
import { labPolicyToEffectiveTests, type LabPolicySnapshot, type LabPolicyTest } from '../zmcc/labPortionDecision';

// ---- Temperature (report columns) --------------------------------------------------------------------------------

test('isTemperatureTest finds the seeded LT-000001 "Temperature" although its code has no TEMP in it', () => {
  assert.equal(isTemperatureTest({ testCode: 'LT-000001', testName: 'Temperature' }), true);
  assert.equal(isTemperatureTest({ testCode: 'lt-000001', testName: '  temperature ' }), true);
  assert.equal(isTemperatureTest({ testCode: 'MY-TEMP', testName: 'Chilling reading' }), true);
});

test('isTemperatureTest does not capture other tests or tests that hold a stored role', () => {
  assert.equal(isTemperatureTest({ testCode: 'LT-000010', testName: 'Salt' }), false);
  assert.equal(isTemperatureTest({ testCode: 'LT-000008', testName: 'LR at 20 Celsius', systemRole: 'LR' }), false);
  assert.equal(isTemperatureTest({ testCode: 'TEMP-LR', testName: 'x', systemRole: 'LR' }), false);
});

// ---- calcKindOf: Salt is not SNF ---------------------------------------------------------------------------------

test('calcKindOf: LT-000010 (Salt) is not SNF, SYS-SNF still is, a stored role wins over a changed name', () => {
  assert.equal(calcKindOf({ testCode: 'LT-000010', testName: 'Salt' }), null);
  assert.equal(isCalculatedTest({ testCode: 'LT-000010', testName: 'Salt', resultType: 'NUMERIC' }), false);
  assert.equal(calcKindOf({ testCode: 'SYS-SNF', testName: 'SNF' }), 'SNF');
  assert.equal(calcKindOf({ testCode: 'SYS-TS', testName: 'TS' }), 'TOTAL_SOLIDS');
  assert.equal(calcKindOf({ testCode: 'X1', testName: 'Dry matter calc', systemRole: 'SNF' }), 'SNF');
  assert.equal(calcKindOf({ testCode: 'X2', testName: 'Dry matter total', systemRole: 'TOTAL_SOLIDS' }), 'TOTAL_SOLIDS');
});

// ---- LR incidents / averages: role first, look-alike only without a holder ---------------------------------------

const lt = (testCode: string, testName: string, systemRole: string | null = null) => ({ testCode, testName, resultType: 'NUMERIC', systemRole });

test('incidentKind: while a test holds the LR role, "Lactometer Reading" without a role is not a water/low-LR incident', () => {
  assert.equal(incidentKind(lt('LT-000008', 'LR at 20 Celsius', 'LR'), true), 'waterLowLr');
  assert.equal(incidentKind(lt('LT-000027', 'Lactometer Reading'), true), null);
});

test('incidentKind: with no LR role anywhere the old name match still applies; another stored role is never LR', () => {
  assert.equal(incidentKind(lt('LT-000027', 'Lactometer Reading'), false), 'waterLowLr');
  assert.equal(incidentKind(lt('LT-000026', 'Lactometer Fat', 'FAT'), false), null);
  assert.equal(incidentKind(lt('LT-000018', 'Formalin'), true), 'formalin');
});

test('isRoleTest / findRoleResult: the stored holder wins and look-alikes are ignored once the role is held', () => {
  const lr = { numeric_value: 28, lab_test: lt('LT-000008', 'LR at 20 Celsius', 'LR') };
  const lookAlike = { numeric_value: 30, lab_test: lt('LT-000027', 'Lactometer Reading') };
  assert.equal(findRoleResult([lookAlike, lr], 'LR', true), lr);
  assert.equal(findRoleResult([lookAlike], 'LR', true), undefined, 'role is held elsewhere: the look-alike is not used');
  assert.equal(findRoleResult([lookAlike], 'LR', false), lookAlike, 'no holder: the old match still works');
  assert.equal(isRoleTest(lt('LT-000026', 'Fat', 'FAT'), 'FAT', true), true);
  assert.equal(isRoleTest(lt('LT-000026', 'Fat', 'FAT'), 'LR', false), false);
});

// ---- SNF found by its stored role ------------------------------------------------------------------------------

test('isConfiguredSnfTest: a renamed SNF test is found by its stored role; without a role the old match applies', () => {
  assert.equal(isConfiguredSnfTest('ABC-9', 'Dry matter calc', 'SNF'), true);
  assert.equal(isConfiguredSnfTest('SYS-SNF', 'SNF', 'TOTAL_SOLIDS'), false, 'another stored role is not SNF');
  assert.equal(isConfiguredSnfTest('SYS-SNF', 'SNF', null), true);
  assert.equal(isConfiguredSnfTest('LT-000009', 'SNF to Fat Ratio', null), false);
  assert.equal(isConfiguredSnfTest('LT-000010', 'Salt', null), false);
});

// ---- loadSystemRoles error handling ------------------------------------------------------------------------------

function dbThrowing(err: unknown): PolicyDb {
  return { labTest: { findMany: async () => { throw err; } } } as unknown as PolicyDb;
}

async function captureErrors<T>(fn: () => Promise<T>): Promise<{ result: T; logs: string[] }> {
  const logs: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => { logs.push(args.map(String).join(' ')); };
  try {
    return { result: await fn(), logs };
  } finally {
    console.error = original;
  }
}

test('loadSystemRoles: a missing system_role column stays silent and returns an empty map', async () => {
  for (const err of [
    Object.assign(new Error('column "system_role" does not exist'), { code: '42703' }),
    Object.assign(new Error('The column `lab_test.system_role` does not exist'), { code: 'P2022' }),
    new Error('something about system_role'),
  ]) {
    const { result, logs } = await captureErrors(() => loadSystemRoles(dbThrowing(err)));
    assert.equal(result.size, 0);
    assert.deepEqual(logs, []);
    assert.equal(isMissingSystemRoleColumn(err), true);
  }
});

test('loadSystemRoles: any other error is logged in one line, the request still gets an empty map', async () => {
  const { result, logs } = await captureErrors(() => loadSystemRoles(dbThrowing(new Error('connection refused'))));
  assert.equal(result.size, 0);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /loadSystemRoles/);
  assert.match(logs[0], /connection refused/);
  const nonError = await captureErrors(() => loadSystemRoles(dbThrowing('boom')));
  assert.equal(nonError.result.size, 0);
  assert.equal(nonError.logs.length, 1);
});

test('loadSystemRoles: stored roles are returned by test id', async () => {
  const db = { labTest: { findMany: async () => [{ id: BigInt(8), systemRole: 'LR' }, { id: BigInt(9), systemRole: null }] } } as unknown as PolicyDb;
  assert.deepEqual([...(await loadSystemRoles(db)).entries()], [['8', 'LR']]);
});

// ---- Required tests at ZMCC session start come from the matrix, not the catalog flag -----------------------------

function policyOf(tests: Array<Record<string, unknown>>): LabPolicySnapshot {
  return {
    point: 'ZMCC_LAB_MC',
    version: 1,
    fetchedAt: '',
    tests: tests.map((t, i) => ({
      labTestId: String(i + 1),
      testCode: `T-${i + 1}`,
      testName: `Test ${i + 1}`,
      resultType: 'NUMERIC',
      unit: null,
      displayOrder: i + 1,
      photoMode: 'NONE',
      isLr: false,
      isFat: false,
      options: null,
      rule: null,
      ...t,
    }) as unknown as LabPolicyTest),
  };
}

test('session start: matrix COMPULSORY is required even when the catalog flag says false, and the reverse', () => {
  const session = labPolicyToEffectiveTests(
    policyOf([
      { testMode: 'COMPULSORY', catalogIsRequired: false },
      { testMode: 'OPTIONAL', catalogIsRequired: true },
    ])
  );
  assert.equal(session[0].isRequired, true, 'matrix COMPULSORY, catalog isRequired=false');
  assert.equal(session[1].isRequired, false, 'matrix OPTIONAL, catalog isRequired=true');
});
