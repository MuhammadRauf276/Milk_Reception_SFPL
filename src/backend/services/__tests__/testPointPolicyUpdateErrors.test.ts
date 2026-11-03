import test from 'node:test';
import assert from 'node:assert/strict';
import { updatePolicyCells, PolicyValidationError, MIN_REASON_LENGTH, type PolicyDb, type PolicyRow } from '../testPointPolicyService';
import type { ActingContext } from '@/types/acting';

// A matrix shaped like the live one: LR and Fat hold their stored roles, "SNF to Fat Ratio" is a calculated test holding
// SNF_FAT_RATIO, and one test is inactive. No database: the labTest mock answers the way Prisma would for each query.
type T = { id: bigint; testCode: string; testName: string; displayOrder: number; isActive: boolean; systemRole: string | null };
const TESTS: T[] = [
  { id: BigInt(8), testCode: 'LT-000008', testName: 'LR at 20 Celsius', displayOrder: 1, isActive: true, systemRole: 'LR' },
  { id: BigInt(26), testCode: 'LT-000026', testName: 'Fat', displayOrder: 2, isActive: true, systemRole: 'FAT' },
  { id: BigInt(9), testCode: 'LT-000009', testName: 'SNF to Fat Ratio', displayOrder: 3, isActive: true, systemRole: 'SNF_FAT_RATIO' },
  { id: BigInt(30), testCode: 'LT-000030', testName: 'Salt', displayOrder: 4, isActive: true, systemRole: null },
  { id: BigInt(40), testCode: 'LT-000040', testName: 'Starch', displayOrder: 5, isActive: false, systemRole: null },
];

function row(id: number, labTestId: bigint, point: string, testMode: string, version = 1): PolicyRow {
  return { id: BigInt(id), lab_test_id: labTestId, testing_point: point, test_mode: testMode, rule_mode: 'APPLY', photo_mode: 'NONE', version, effective_from: new Date('2026-01-01T00:00:00Z'), effective_to: null };
}

function makeDb(rows: PolicyRow[], tests: T[] = TESTS) {
  const store = [...rows];
  const created: Array<Record<string, unknown>> = [];
  const db: PolicyDb = {
    testPointPolicy: {
      async findMany() { return store.map((r) => ({ ...r })); },
      async updateMany() { return { count: 0 }; },
      async create(args: unknown) {
        const d = (args as { data: Record<string, unknown> }).data;
        created.push(d);
        store.push({ id: BigInt(500 + created.length), ...d } as unknown as PolicyRow);
        return {};
      },
    },
    labTest: {
      async findMany(args: unknown) {
        const a = (args ?? {}) as { where?: { isActive?: boolean; systemRole?: unknown } };
        if (a.where?.systemRole) return tests.filter((t) => t.systemRole).map((t) => ({ id: t.id, systemRole: t.systemRole })) as never;
        if (a.where?.isActive) return tests.filter((t) => t.isActive);
        return tests; // names lookup: every test, active or not
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

// The payload the Unified Stage Policies screen sends for ONE dropdown change (UnifiedStagePoliciesRulesWorkspace.tsx).
const screenPayload = (labTestId: string, point: string, mode: string) => ({
  reason: `Super Admin set ${point} to ${mode}`,
  changes: [{ labTestId, point, testMode: mode, ruleMode: 'APPLY', photoMode: 'NONE' }] as never,
});

// LR and Fat are saved COMPULSORY at the plant (as on a configured site); the ratio is AUTO at the dispatch point.
const stored = [
  row(1, BigInt(9), 'ZMCC_DISPATCH', 'AUTO'),
  row(2, BigInt(40), 'ZMCC_DISPATCH', 'AUTO'),
  row(3, BigInt(8), 'PLANT_QA', 'COMPULSORY'),
  row(4, BigInt(26), 'PLANT_QA', 'COMPULSORY'),
];

test('SNF to Fat Ratio AUTO -> APPLIED from the screen applies when the test is active and holds SNF_FAT_RATIO', async () => {
  const { db, created } = makeDb(stored);
  const p = screenPayload('9', 'ZMCC_DISPATCH', 'APPLIED');
  const res = await updatePolicyCells(ctx, p.changes, p.reason, db);
  assert.equal(res.applied, 1);
  assert.equal(created.length, 1);
  assert.equal(created[0].test_mode, 'APPLIED');
  assert.equal(created[0].version, 2);
});

test('the same change for a test that is not active is rejected, and the message names the test and the stage', async () => {
  const { db, created } = makeDb(stored);
  const p = screenPayload('40', 'ZMCC_DISPATCH', 'APPLIED');
  await assert.rejects(updatePolicyCells(ctx, p.changes, p.reason, db), (e: unknown) => {
    assert.ok(e instanceof PolicyValidationError);
    assert.equal(e.status, 400);
    assert.match(e.message, /"Starch" \(LT-000040\) is not an active test/);
    assert.match(e.message, /ZMCC Lab Dispatch to Plant/);
    return true;
  });
  assert.equal(created.length, 0);
});

test('an unknown test id is reported as not existing, with the stage', async () => {
  const { db } = makeDb(stored);
  const p = screenPayload('999', 'PLANT_QA', 'OFF');
  await assert.rejects(updatePolicyCells(ctx, p.changes, p.reason, db), /Test 999 does not exist \(Plant QA Reception Lab\)/);
});

test('LR and Fat lock still rejects turning them off or optional, naming the test and stage', async () => {
  const { db, created } = makeDb(stored);
  for (const [id, mode, name] of [['8', 'OFF', 'LR at 20 Celsius'], ['8', 'APPLIED', 'LR at 20 Celsius'], ['26', 'NOT_APPLIED', 'Fat'], ['26', 'OPTIONAL', 'Fat']] as const) {
    const p = screenPayload(id, 'PLANT_QA', mode);
    await assert.rejects(updatePolicyCells(ctx, p.changes, p.reason, db), (e: unknown) => {
      assert.ok(e instanceof PolicyValidationError);
      assert.ok(e.message.includes(`"${name}"`), e.message);
      assert.match(e.message, /Plant QA Reception Lab/);
      assert.match(e.message, /stays compulsory at every stage/);
      return true;
    });
  }
  assert.equal(created.length, 0);
});

test('LR may still change its photo or rule setting, and may be set COMPULSORY, but not off', async () => {
  const { db } = makeDb(stored);
  // Keeps COMPULSORY, changes only the photo and rule settings: allowed.
  const photo = await updatePolicyCells(ctx, [{ labTestId: '8', point: 'PLANT_QA', testMode: 'COMPULSORY', ruleMode: 'WARN', photoMode: 'OPTIONAL' }] as never, 'Photo not needed here', db);
  assert.equal(photo.applied, 1);
  // A stage where LR was never saved (default OPTIONAL) may be made COMPULSORY.
  const comp = await updatePolicyCells(ctx, [{ labTestId: '8', point: 'MOT_SHOP', testMode: 'COMPULSORY', ruleMode: 'APPLY', photoMode: 'NONE' }] as never, 'Make it compulsory', db);
  assert.equal(comp.applied, 1);
});

test('a reason shorter than the minimum is still rejected', async () => {
  const { db } = makeDb(stored);
  const p = screenPayload('9', 'ZMCC_DISPATCH', 'APPLIED');
  await assert.rejects(updatePolicyCells(ctx, p.changes, '', db), new RegExp(`at least ${MIN_REASON_LENGTH} characters`));
  await assert.rejects(updatePolicyCells(ctx, p.changes, ' abc ', db), PolicyValidationError);
});

test('a batch with one unchanged cell and one valid change applies only the valid change', async () => {
  const { db, created } = makeDb(stored);
  const res = await updatePolicyCells(
    ctx,
    [
      { labTestId: '9', point: 'ZMCC_DISPATCH', testMode: 'AUTO', ruleMode: 'APPLY', photoMode: 'NONE' }, // same as stored
      { labTestId: '30', point: 'PLANT_QA', testMode: 'COMPULSORY', ruleMode: 'APPLY', photoMode: 'NONE' },
    ] as never,
    'Salt is compulsory at plant',
    db
  );
  assert.equal(res.applied, 1);
  assert.equal(created.length, 1);
  assert.equal(created[0].lab_test_id, BigInt(30));
});

test('validation errors name the test and the stage', async () => {
  const { db } = makeDb(stored);
  const bad = (change: Record<string, unknown>) => updatePolicyCells(ctx, [{ labTestId: '9', point: 'PLANT_QA', testMode: 'OFF', ruleMode: 'APPLY', photoMode: 'NONE', ...change }] as never, 'A fine reason', db);
  await assert.rejects(bad({ testMode: 'MAYBE' }), /Invalid test mode "MAYBE" for test 9 at Plant QA Reception Lab/);
  await assert.rejects(bad({ ruleMode: 'LOUD' }), /Invalid rule mode "LOUD" for test 9 at Plant QA Reception Lab/);
  await assert.rejects(bad({ photoMode: 'ALWAYS' }), /Invalid photo mode "ALWAYS" for test 9 at Plant QA Reception Lab/);
  await assert.rejects(bad({ labTestId: 'abc' }), /Invalid test id "abc" at Plant QA Reception Lab/);
  await assert.rejects(bad({ point: 'NOWHERE' }), /Unknown testing point: NOWHERE \(test 9\)/);
  await assert.rejects(
    updatePolicyCells(ctx, [
      { labTestId: '9', point: 'PLANT_QA', testMode: 'OFF', ruleMode: 'APPLY', photoMode: 'NONE' },
      { labTestId: '9', point: 'PLANT_QA', testMode: 'OPTIONAL', ruleMode: 'APPLY', photoMode: 'NONE' },
    ] as never, 'A fine reason', db),
    /Duplicate cell in changes: test 9 at Plant QA Reception Lab/
  );
});
