import test from 'node:test';
import assert from 'node:assert/strict';
import { getPolicyMatrix, updatePolicyCells, PolicyValidationError, type PolicyDb, type PolicyRow } from '../testPointPolicyService';
import { roleEditBlock, findReplacementTest, lineageName, pickRoleTest, calcKindOf } from '@/lib/lab-test-roles';
import type { ActingContext } from '@/types/acting';

// The live case (commit 55621bd): the SNF_FAT_RATIO role sits on the INACTIVE test 9; an active copy (31) has no role.
// No database: the labTest mock answers the way Prisma would for each query.
type T = { id: bigint; testCode: string; testName: string; displayOrder: number; isActive: boolean; systemRole: string | null };
const TESTS: T[] = [
  { id: BigInt(8), testCode: 'LT-000008', testName: 'LR at 20 Celsius', displayOrder: 1, isActive: true, systemRole: 'LR' },
  { id: BigInt(9), testCode: 'LT-000009', testName: 'SNF to Fat Ratio', displayOrder: 3, isActive: false, systemRole: 'SNF_FAT_RATIO' },
  { id: BigInt(23), testCode: 'LT-000023', testName: 'Whey Protein Ratio', displayOrder: 4, isActive: true, systemRole: null },
  { id: BigInt(31), testCode: 'LT-000100', testName: 'SNF to Fat Ratio', displayOrder: 5, isActive: true, systemRole: null },
  { id: BigInt(60), testCode: 'LT-000200', testName: 'Odd Inactive', displayOrder: 6, isActive: false, systemRole: null },
];

function row(id: number, labTestId: bigint, point: string, testMode: string): PolicyRow {
  return { id: BigInt(id), lab_test_id: labTestId, testing_point: point, test_mode: testMode, rule_mode: 'APPLY', photo_mode: 'NONE', version: 1, effective_from: new Date('2026-01-01T00:00:00Z'), effective_to: null };
}

function makeDb(rows: PolicyRow[]) {
  const created: Array<Record<string, unknown>> = [];
  const db: PolicyDb = {
    testPointPolicy: {
      async findMany() { return rows.map((r) => ({ ...r })); },
      async updateMany() { return { count: 0 }; },
      async create(args: unknown) { created.push((args as { data: Record<string, unknown> }).data); return {}; },
    },
    labTest: {
      async findMany(args: unknown) {
        const a = (args ?? {}) as { where?: { isActive?: boolean; systemRole?: unknown } };
        if (a.where?.systemRole) return TESTS.filter((t) => t.systemRole).map((t) => ({ id: t.id, systemRole: t.systemRole })) as never;
        if (a.where?.isActive) return TESTS.filter((t) => t.isActive);
        return TESTS;
      },
    },
    configChangeLog: { async create() { return { id: BigInt(1) }; } },
    auditLog: { async create() { return { id: BigInt(1) }; } },
    milkTestPolicyAssignment: {
      async findUnique() { return null; },
      async aggregate() { return { _max: { display_order: null } }; },
      async create() { return { id: BigInt(0) }; },
      async update() { return { id: BigInt(0) }; },
    },
    async $transaction<TR>(fn: (tx: PolicyDb) => Promise<TR>) { return fn(db); },
  };
  return { db, created };
}

const ctx: ActingContext = { userId: BigInt(7), actorRole: 'SUPER_ADMIN', actingAs: 'SUPER_ADMIN', isDelegated: false, scope: { kind: 'SYSTEM' } };
// Cells saved for the old test 9 only; the new test 31 has no saved rows.
const stored = [row(1, BigInt(9), 'PLANT_QA', 'AUTO'), row(2, BigInt(9), 'ZMCC_DISPATCH', 'AUTO')];
const edit = (labTestId: string, mode = 'OPTIONAL', reason = 'Super Admin set the ratio') =>
  updatePolicyCells(ctx, [{ labTestId, point: 'PLANT_QA', testMode: mode, ruleMode: 'APPLY', photoMode: 'NONE' } as never], reason, makeDb(stored).db);

test('failure reproduced: matrix omits the inactive role holder; the active copy shows default modes and no role', async () => {
  const { cells } = await getPolicyMatrix(new Date(), makeDb(stored).db);
  assert.equal(cells.some((c) => c.labTestId === '9'), false, 'inactive test 9 is not in the matrix');
  const copy = cells.filter((c) => c.labTestId === '31');
  assert.ok(copy.length > 0);
  assert.ok(copy.every((c) => c.source === 'DEFAULT' && c.systemRole === null), 'active copy: default modes, no stored role');
  // The finders see the copy only by its name, and with no active holder the legacy name match picks another ratio test.
  assert.equal(calcKindOf({ testCode: 'LT-000100', testName: 'SNF to Fat Ratio', systemRole: null }), 'RATIO');
  const atPlant = cells.filter((c) => c.point === 'PLANT_QA').map((c) => ({ id: c.labTestId, testCode: c.testCode, testName: c.testName, systemRole: c.systemRole }));
  assert.equal(atPlant.some((t) => t.systemRole === 'SNF_FAT_RATIO'), false, 'no active test holds SNF_FAT_RATIO');
  assert.ok(pickRoleTest(atPlant, 'SNF_FAT_RATIO'), 'a legacy name match still picks some ratio test');
});

test('saving a cell of the inactive role holder returns 400 naming the active replacement and the stranded role', async () => {
  await assert.rejects(edit('9'), (e: unknown) => {
    assert.ok(e instanceof PolicyValidationError);
    assert.match(e.message, /"SNF to Fat Ratio" \(LT-000009\) is not an active test/);
    assert.match(e.message, /Edit the active test "SNF to Fat Ratio" \(LT-000100\) instead/);
    assert.match(e.message, /SNF_FAT_RATIO role/);
    return true;
  });
});

test('inactive test with no replacement keeps the 400 and says to activate it', async () => {
  await assert.rejects(edit('60'), (e: unknown) => e instanceof PolicyValidationError && /Odd Inactive.*Make the test active first/.test(e.message) && !/Edit the active test/.test(e.message));
});

test('unknown test id is still refused', async () => {
  await assert.rejects(edit('999'), (e: unknown) => e instanceof PolicyValidationError && /does not exist/.test(e.message));
});

test('short reason is still refused', async () => {
  await assert.rejects(edit('31', 'OPTIONAL', 'x'), (e: unknown) => e instanceof PolicyValidationError && /reason/i.test(e.message));
});

test('a change on the active copy is saved as a new version (not blocked)', async () => {
  const { db, created } = makeDb(stored);
  const res = await updatePolicyCells(ctx, [{ labTestId: '31', point: 'PLANT_QA', testMode: 'OFF', ruleMode: 'APPLY', photoMode: 'NONE' } as never], 'Switch the copy off for the test', db);
  assert.equal(res.applied, 1);
  assert.equal(created.length, 1);
});

test('LR lock still holds (the active LR cannot be switched off)', async () => {
  const rows = [row(3, BigInt(8), 'PLANT_QA', 'COMPULSORY')];
  await assert.rejects(
    updatePolicyCells(ctx, [{ labTestId: '8', point: 'PLANT_QA', testMode: 'OFF', ruleMode: 'APPLY', photoMode: 'NONE' } as never], 'Try to switch LR off', makeDb(rows).db),
    (e: unknown) => e instanceof PolicyValidationError && /LR is needed/.test(e.message)
  );
});

test('roleEditBlock: a role holder cannot be deactivated', () => {
  assert.match(roleEditBlock({ testName: 'Fat', systemRole: 'FAT', isActive: true }, { isActive: false })!, /FAT test the milk formulas use, so it cannot be deactivated/);
  assert.equal(roleEditBlock({ testName: 'Salt', systemRole: null, isActive: true }, { isActive: false }), null);
  assert.equal(roleEditBlock({ testName: 'Fat', systemRole: 'FAT', isActive: true }, { isActive: true }), null);
});

test('roleEditBlock: a role cannot be given to an inactive test (nor together with deactivating)', () => {
  assert.match(roleEditBlock({ testName: 'SNF to Fat Ratio', systemRole: null, isActive: false }, { systemRole: 'SNF_FAT_RATIO' })!, /not an active test/);
  assert.match(roleEditBlock({ testName: 'Ratio', systemRole: null, isActive: true }, { systemRole: 'SNF_FAT_RATIO', isActive: false })!, /not an active test/);
  assert.equal(roleEditBlock({ testName: 'Ratio', systemRole: null, isActive: false }, { systemRole: 'SNF_FAT_RATIO', isActive: true }), null, 'activating in the same request is fine');
  assert.equal(roleEditBlock({ testName: 'Ratio', systemRole: 'SNF_FAT_RATIO', isActive: true }, { systemRole: null }), null, 'clearing a role is not blocked here');
  assert.equal(roleEditBlock({ testName: 'Ratio', systemRole: null, isActive: true }, { systemRole: 'SNF_FAT_RATIO' }), null);
});

test('findReplacementTest: same name lineage, "(Updated)" suffix ignored, newest active wins', () => {
  assert.equal(lineageName('Appearance Quality (Updated) 1787839639092'), 'appearance quality');
  const all = [
    { id: 1, testCode: 'A', testName: 'Appearance Quality', isActive: false, systemRole: null },
    { id: 2, testCode: 'B', testName: 'Appearance Quality (Updated) 5', isActive: true, systemRole: null },
    { id: 3, testCode: 'C', testName: 'appearance quality', isActive: true, systemRole: null },
  ];
  assert.equal(findReplacementTest(all[0], all)?.testCode, 'C');
  assert.equal(findReplacementTest({ id: 4, testCode: 'D', testName: 'Solo', isActive: false, systemRole: null }, all), null);
});
