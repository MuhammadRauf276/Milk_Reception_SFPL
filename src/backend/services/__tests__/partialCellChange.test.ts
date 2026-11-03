import test from 'node:test';
import assert from 'node:assert/strict';
import { updatePolicyCells, PolicyValidationError, type PolicyDb, type PolicyRow } from '../testPointPolicyService';
import type { ActingContext } from '@/types/acting';

// A dropdown change sends only the field that changed; the server keeps the saved rule mode / photo mode of the cell.
type T = { id: bigint; testCode: string; testName: string; displayOrder: number; isActive: boolean; systemRole: string | null };
const TESTS: T[] = [
  { id: BigInt(8), testCode: 'LT-000008', testName: 'LR at 20 Celsius', displayOrder: 1, isActive: true, systemRole: 'LR' },
  { id: BigInt(30), testCode: 'LT-000030', testName: 'Salt', displayOrder: 2, isActive: true, systemRole: null },
  { id: BigInt(40), testCode: 'LT-000040', testName: 'Starch', displayOrder: 3, isActive: false, systemRole: null },
];

const savedRow = (labTestId: bigint, testMode: string, ruleMode: string, photoMode: string): PolicyRow => ({
  id: BigInt(Number(labTestId) * 10), lab_test_id: labTestId, testing_point: 'PLANT_QA', test_mode: testMode, rule_mode: ruleMode, photo_mode: photoMode,
  version: 3, effective_from: new Date('2026-01-01T00:00:00Z'), effective_to: null,
});

function makeDb(rows: PolicyRow[]) {
  const created: Array<Record<string, unknown>> = [];
  const assignments: Array<Record<string, unknown>> = [];
  const db: PolicyDb = {
    testPointPolicy: {
      async findMany() { return rows.map((r) => ({ ...r })); },
      async updateMany() { return { count: 1 }; },
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
      async findUnique() { return { id: BigInt(1), display_order: 1, is_active: true, is_required: true }; },
      async aggregate() { return { _max: { display_order: null } }; },
      async create() { return { id: BigInt(0) }; },
      async update(args: unknown) { assignments.push((args as { data: Record<string, unknown> }).data); return { id: BigInt(1) }; },
    },
    async $transaction<TR>(fn: (tx: PolicyDb) => Promise<TR>) { return fn(db); },
  };
  return { db, created, assignments };
}

const ctx: ActingContext = { userId: BigInt(7), actorRole: 'SUPER_ADMIN', actingAs: 'SUPER_ADMIN', isDelegated: false, scope: { kind: 'SYSTEM' } };
const run = (rows: PolicyRow[], change: Record<string, unknown>, reason = 'Super Admin changed one field') => {
  const m = makeDb(rows);
  return { m, promise: updatePolicyCells(ctx, [{ point: 'PLANT_QA', ...change } as never], reason, m.db) };
};

test('changing only testMode keeps the saved ruleMode and photoMode', async () => {
  const { m, promise } = run([savedRow(BigInt(30), 'OPTIONAL', 'WARN', 'REQUIRED')], { labTestId: '30', testMode: 'COMPULSORY' });
  assert.equal((await promise).applied, 1);
  assert.equal(m.created.length, 1);
  assert.deepEqual([m.created[0].test_mode, m.created[0].rule_mode, m.created[0].photo_mode, m.created[0].version], ['COMPULSORY', 'WARN', 'REQUIRED', 4]);
  assert.equal(m.assignments[0].is_photo_required, true, 'stage assignment photo flag follows the kept photo mode');
});

test('changing only photoMode keeps testMode and ruleMode', async () => {
  const { m, promise } = run([savedRow(BigInt(30), 'COMPULSORY', 'WARN', 'NONE')], { labTestId: '30', photoMode: 'REQUIRED' });
  assert.equal((await promise).applied, 1);
  assert.deepEqual([m.created[0].test_mode, m.created[0].rule_mode, m.created[0].photo_mode], ['COMPULSORY', 'WARN', 'REQUIRED']);
});

test('a change equal to the saved value is "no change" (applied 0, no new version)', async () => {
  const { m, promise } = run([savedRow(BigInt(30), 'OPTIONAL', 'WARN', 'REQUIRED')], { labTestId: '30', testMode: 'OPTIONAL' });
  assert.equal((await promise).applied, 0);
  assert.equal(m.created.length, 0);
});

test('full three-field payloads still work (old clients)', async () => {
  const { m, promise } = run([savedRow(BigInt(30), 'OPTIONAL', 'WARN', 'REQUIRED')], { labTestId: '30', testMode: 'OPTIONAL', ruleMode: 'APPLY', photoMode: 'NONE' });
  assert.equal((await promise).applied, 1);
  assert.deepEqual([m.created[0].rule_mode, m.created[0].photo_mode], ['APPLY', 'NONE']);
});

test('invalid values and an empty change are still 400', async () => {
  await assert.rejects(run([savedRow(BigInt(30), 'OPTIONAL', 'APPLY', 'NONE')], { labTestId: '30', photoMode: 'BAD' }).promise, PolicyValidationError);
  await assert.rejects(run([savedRow(BigInt(30), 'OPTIONAL', 'APPLY', 'NONE')], { labTestId: '30' }).promise, /Nothing to change/);
});

test('minimum reason length is still required', async () => {
  await assert.rejects(run([savedRow(BigInt(30), 'OPTIONAL', 'APPLY', 'NONE')], { labTestId: '30', testMode: 'OFF' }, 'x').promise, /reason/i);
});

test('LR lock still rejects OFF and OPTIONAL when only testMode is sent', async () => {
  for (const mode of ['OFF', 'NOT_APPLIED', 'OPTIONAL']) {
    await assert.rejects(
      run([savedRow(BigInt(8), 'COMPULSORY', 'APPLY', 'REQUIRED')], { labTestId: '8', testMode: mode }).promise,
      (e: unknown) => e instanceof PolicyValidationError && /LR is needed/.test(e.message),
      mode
    );
  }
});

test('LR photo-only change is allowed (lock is about the test mode)', async () => {
  const { m, promise } = run([savedRow(BigInt(8), 'COMPULSORY', 'APPLY', 'REQUIRED')], { labTestId: '8', photoMode: 'NONE' });
  assert.equal((await promise).applied, 1);
  assert.equal(m.created[0].test_mode, 'COMPULSORY');
});

test('inactive test is still rejected with the descriptive 400', async () => {
  await assert.rejects(
    run([], { labTestId: '40', testMode: 'COMPULSORY' }).promise,
    (e: unknown) => e instanceof PolicyValidationError && /"Starch" \(LT-000040\) is not an active test/.test(e.message)
  );
});
