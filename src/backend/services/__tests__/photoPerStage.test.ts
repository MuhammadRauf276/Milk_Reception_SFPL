import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getEffectivePolicy,
  getTestPhotoStages,
  photoModeFor,
  resolveStageCells,
  selectStageCells,
  setStagePhotoRequired,
  updatePolicyCells,
  PHOTO_CHANGE_REASON,
  MIN_REASON_LENGTH,
  PolicyValidationError,
  type PolicyDb,
  type PolicyRow,
} from '../testPointPolicyService';
import { MilkTestPolicyService } from '../milkTestPolicyService';
import { stagesWithPhotoCheckbox, TEST_POINT_CODES, type TestPointCode } from '@/types/test-point-policy';
import type { ActingContext } from '@/types/acting';

// The test edit screen sets the photo rule per stage. A small stateful mock: new rows become the saved value of the cell.
type T = { id: bigint; testCode: string; testName: string; displayOrder: number; isActive: boolean; systemRole: string | null; resultType: string };
const TESTS: T[] = [
  { id: BigInt(8), testCode: 'LT-000008', testName: 'LR at 20 Celsius', displayOrder: 1, isActive: true, systemRole: 'LR', resultType: 'NUMERIC' },
  { id: BigInt(30), testCode: 'LT-900030', testName: 'Salt', displayOrder: 2, isActive: true, systemRole: null, resultType: 'POSITIVE_NEGATIVE' },
  { id: BigInt(40), testCode: 'LT-900040', testName: 'Starch', displayOrder: 3, isActive: false, systemRole: null, resultType: 'POSITIVE_NEGATIVE' },
  // Odd code and name on purpose: found by stored role, not by name or code.
  { id: BigInt(50), testCode: 'LT-900050', testName: 'Worked out value', displayOrder: 4, isActive: true, systemRole: 'SNF', resultType: 'NUMERIC' },
];

type Assignment = { id: bigint; display_order: number; is_active: boolean; is_required: boolean; is_photo_required: boolean };

let nextRowId = 1000;
const row = (labTestId: number, point: string, testMode: string, photoMode: string, ruleMode = 'WARN', version = 3): PolicyRow => ({
  id: BigInt(nextRowId++), lab_test_id: BigInt(labTestId), testing_point: point, test_mode: testMode, rule_mode: ruleMode, photo_mode: photoMode,
  version, effective_from: new Date('2026-01-01T00:00:00Z'), effective_to: null,
});

function makeDb(initial: PolicyRow[], assignments: Record<string, Assignment> = {}) {
  const rows = [...initial];
  const created: Array<Record<string, unknown>> = [];
  const assignmentWrites: Array<{ data: Record<string, unknown> }> = [];
  const assignmentCreates: Array<Record<string, unknown>> = [];
  const logs: Array<Record<string, unknown>> = [];
  const db: PolicyDb = {
    testPointPolicy: {
      async findMany() { return [...rows].sort((a, b) => a.version - b.version).map((r) => ({ ...r })); },
      async updateMany(args: unknown) {
        const a = args as { where: { id: { in: bigint[] } }; data: { effective_to: Date } };
        for (const r of rows) if (a.where.id.in.includes(r.id)) r.effective_to = a.data.effective_to;
        return { count: a.where.id.in.length };
      },
      async create(args: unknown) {
        const d = (args as { data: Record<string, unknown> }).data;
        created.push(d);
        rows.push({
          id: BigInt(nextRowId++), lab_test_id: d.lab_test_id as bigint, testing_point: d.testing_point as string, test_mode: d.test_mode as string,
          rule_mode: d.rule_mode as string, photo_mode: d.photo_mode as string, version: d.version as number, effective_from: d.effective_from as Date, effective_to: null,
        });
        return {};
      },
    },
    labTest: {
      async findMany(args: unknown) {
        const a = (args ?? {}) as { where?: { isActive?: boolean; systemRole?: unknown } };
        if (a.where?.systemRole) return TESTS.filter((t) => t.systemRole).map((t) => ({ id: t.id, systemRole: t.systemRole })) as never;
        if (a.where?.isActive) return TESTS.filter((t) => t.isActive);
        return TESTS;
      },
    },
    configChangeLog: { async create(args: unknown) { logs.push((args as { data: Record<string, unknown> }).data); return { id: BigInt(1) }; } },
    auditLog: { async create() { return { id: BigInt(1) }; } },
    milkTestPolicyAssignment: {
      async findUnique(args: unknown) {
        const k = (args as { where: { lab_test_id_testing_point: { lab_test_id: bigint; testing_point: string } } }).where.lab_test_id_testing_point;
        return assignments[`${k.lab_test_id}|${k.testing_point}`] ?? null;
      },
      async aggregate() { return { _max: { display_order: null } }; },
      async create(args: unknown) { assignmentCreates.push((args as { data: Record<string, unknown> }).data); return { id: BigInt(0) }; },
      async update(args: unknown) { assignmentWrites.push(args as { data: Record<string, unknown> }); return { id: BigInt(1) }; },
    },
    async $transaction<TR>(fn: (tx: PolicyDb) => Promise<TR>) { return fn(db); },
  };
  return { db, created, assignmentWrites, assignmentCreates, logs };
}

const ctx: ActingContext = { userId: BigInt(7), actorRole: 'SUPER_ADMIN', actingAs: 'SUPER_ADMIN', isDelegated: false, scope: { kind: 'SYSTEM' } };
const setPhoto = (db: PolicyDb, id: string, changes: Array<{ point: TestPointCode; photoRequired: boolean }>) => setStagePhotoRequired(ctx, id, changes, undefined, db);
const allStages = (labTestId: number, mode: string, photo: string) => TEST_POINT_CODES.map((p) => row(labTestId, p, mode, photo));

test('only the chosen stage changes: one new version, test and rule mode kept, reason logged', async () => {
  const m = makeDb(allStages(30, 'COMPULSORY', 'NONE'));
  assert.equal((await setPhoto(m.db, '30', [{ point: 'PLANT_QA', photoRequired: true }])).applied, 1);
  assert.equal(m.created.length, 1);
  assert.deepEqual(
    [m.created[0].testing_point, m.created[0].test_mode, m.created[0].rule_mode, m.created[0].photo_mode, m.created[0].version, m.created[0].change_reason],
    ['PLANT_QA', 'COMPULSORY', 'WARN', 'REQUIRED', 4, PHOTO_CHANGE_REASON]
  );
  assert.ok(PHOTO_CHANGE_REASON.length >= MIN_REASON_LENGTH);
  assert.equal(m.logs.length, 1, 'config log written once');
  const after = await getTestPhotoStages('30', m.db);
  for (const s of after.stages) assert.equal(s.photoMode, s.point === 'PLANT_QA' ? 'REQUIRED' : 'NONE', s.point);
});

test('the assignment sync writes only the photo flag of that stage', async () => {
  const a = { id: BigInt(5), display_order: 1, is_active: true, is_required: true, is_photo_required: false };
  const m = makeDb(allStages(30, 'OPTIONAL', 'NONE'), { '30|MOT_SHOP': a });
  await setPhoto(m.db, '30', [{ point: 'MOT_SHOP', photoRequired: true }]);
  assert.equal(m.assignmentWrites.length, 1);
  assert.deepEqual(Object.keys(m.assignmentWrites[0].data).sort(), ['is_photo_required', 'updated_by_user_id']);
  assert.equal(m.assignmentWrites[0].data.is_photo_required, true);
  assert.equal(m.assignmentCreates.length, 0);
});

test('two stages ON gives two settable stages; each sent stage gets its own version', async () => {
  const rows = [
    row(30, 'MOT_SHOP', 'COMPULSORY', 'NONE'),
    row(30, 'PLANT_QA', 'APPLIED', 'REQUIRED'),
    row(30, 'ZMCC_LAB_MC', 'NOT_APPLIED', 'NONE'),
    row(30, 'ZMCC_LAB_HC', 'OFF', 'NONE'),
    row(30, 'ZMCC_DISPATCH', 'OFF', 'NONE'),
    row(30, 'CONTRACTOR_DISPATCH', 'OFF', 'NONE'),
  ];
  const m = makeDb(rows);
  const read = await getTestPhotoStages('30', m.db);
  assert.deepEqual(stagesWithPhotoCheckbox(read.stages, read.calculated).map((s) => s.point), ['MOT_SHOP', 'PLANT_QA']);
  assert.equal((await setPhoto(m.db, '30', [{ point: 'MOT_SHOP', photoRequired: true }, { point: 'PLANT_QA', photoRequired: false }])).applied, 2);
  assert.deepEqual(m.created.map((c) => [c.testing_point, c.photo_mode]), [['MOT_SHOP', 'REQUIRED'], ['PLANT_QA', 'NONE']]);
});

test('a stage that is OFF is refused and the message names the test and stage; nothing is written', async () => {
  for (const mode of ['OFF', 'NOT_APPLIED']) {
    const m = makeDb([row(30, 'PLANT_QA', mode, 'NONE'), row(30, 'MOT_SHOP', 'COMPULSORY', 'NONE')]);
    await assert.rejects(
      setPhoto(m.db, '30', [{ point: 'MOT_SHOP', photoRequired: true }, { point: 'PLANT_QA', photoRequired: true }]),
      (e: unknown) => e instanceof PolicyValidationError && /"Salt" \(LT-900030\) is off at Plant QA Reception Lab/.test(e.message),
      mode
    );
    assert.equal(m.created.length, 0, 'no partial write');
  }
});

test('unknown point, duplicate point and a non-boolean value are refused', async () => {
  const m = makeDb(allStages(30, 'COMPULSORY', 'NONE'));
  await assert.rejects(setPhoto(m.db, '30', [{ point: 'DISPATCH' as TestPointCode, photoRequired: true }]), /Unknown testing point: DISPATCH/);
  await assert.rejects(setPhoto(m.db, '30', [{ point: 'MOT_SHOP', photoRequired: true }, { point: 'MOT_SHOP', photoRequired: false }]), /listed twice/);
  await assert.rejects(setPhoto(m.db, '30', [{ point: 'MOT_SHOP', photoRequired: 'yes' as unknown as boolean }]), /Say whether/);
  await assert.rejects(setStagePhotoRequired(ctx, '30', undefined as never, undefined, m.db), /list of stages/);
});

test('a calculated test (found by stored role) is refused and offers no checkbox', async () => {
  const m = makeDb(allStages(50, 'AUTO', 'NONE'));
  await assert.rejects(setPhoto(m.db, '50', [{ point: 'PLANT_QA', photoRequired: true }]), /"Worked out value" \(LT-900050\) is calculated automatically/);
  assert.equal(m.created.length, 0);
  const read = await getTestPhotoStages('50', m.db);
  assert.equal(read.calculated, true);
  assert.deepEqual(stagesWithPhotoCheckbox(read.stages, read.calculated), []);
});

test('LR photo change is allowed and leaves it compulsory; the LR mode lock still holds', async () => {
  const m = makeDb(allStages(8, 'COMPULSORY', 'REQUIRED'));
  assert.equal((await setPhoto(m.db, '8', [{ point: 'PLANT_QA', photoRequired: false }])).applied, 1);
  assert.deepEqual([m.created[0].test_mode, m.created[0].photo_mode], ['COMPULSORY', 'NONE']);
  await assert.rejects(updatePolicyCells(ctx, [{ labTestId: '8', point: 'PLANT_QA', testMode: 'OFF' }], 'Trying to turn LR off', m.db), /LR is needed/);
});

test('a change equal to the saved value sends no new version', async () => {
  const m = makeDb([row(30, 'PLANT_QA', 'COMPULSORY', 'REQUIRED'), row(30, 'MOT_SHOP', 'COMPULSORY', 'NONE')]);
  const result = await setPhoto(m.db, '30', [{ point: 'PLANT_QA', photoRequired: true }, { point: 'MOT_SHOP', photoRequired: false }]);
  assert.equal(result.applied, 0);
  assert.equal(m.created.length, 0);
  assert.equal((await setPhoto(m.db, '30', [])).applied, 0);
});

test('unticking an OPTIONAL photo is no change, so it does not silently become NONE', async () => {
  const m = makeDb([row(30, 'CONTRACTOR_DISPATCH', 'APPLIED', 'OPTIONAL')]);
  assert.equal((await setPhoto(m.db, '30', [{ point: 'CONTRACTOR_DISPATCH', photoRequired: false }])).applied, 0);
  assert.deepEqual([photoModeFor('OPTIONAL', false), photoModeFor('OPTIONAL', true), photoModeFor('REQUIRED', false), photoModeFor('NONE', false)], ['OPTIONAL', 'REQUIRED', 'NONE', 'NONE']);
});

test('the photo setting is kept when a stage is turned OFF and ON again', async () => {
  const m = makeDb([row(30, 'PLANT_QA', 'COMPULSORY', 'REQUIRED')]);
  await updatePolicyCells(ctx, [{ labTestId: '30', point: 'PLANT_QA', testMode: 'NOT_APPLIED' }], 'Super Admin set PLANT_QA to NOT_APPLIED', m.db);
  const off = await getTestPhotoStages('30', m.db);
  const offStage = off.stages.find((s) => s.point === 'PLANT_QA')!;
  assert.deepEqual([offStage.testMode, offStage.photoMode], ['NOT_APPLIED', 'REQUIRED']);
  assert.equal(stagesWithPhotoCheckbox(off.stages, false).some((s) => s.point === 'PLANT_QA'), false, 'no checkbox while OFF');
  await updatePolicyCells(ctx, [{ labTestId: '30', point: 'PLANT_QA', testMode: 'COMPULSORY' }], 'Super Admin set PLANT_QA to COMPULSORY', m.db);
  const on = (await getTestPhotoStages('30', m.db)).stages.find((s) => s.point === 'PLANT_QA')!;
  assert.deepEqual([on.testMode, on.photoMode], ['COMPULSORY', 'REQUIRED']);
});

test('a stage with no saved row keeps the mode in force from its assignment after the first photo change', async () => {
  const a = { id: BigInt(5), display_order: 1, is_active: true, is_required: true, is_photo_required: false };
  const m = makeDb([], { '30|MOT_SHOP': a });
  const before = (await getTestPhotoStages('30', m.db)).stages.find((s) => s.point === 'MOT_SHOP')!;
  assert.deepEqual([before.testMode, before.photoMode, before.source], ['COMPULSORY', 'NONE', 'DEFAULT']);
  await setPhoto(m.db, '30', [{ point: 'MOT_SHOP', photoRequired: true }]);
  assert.deepEqual([m.created[0].test_mode, m.created[0].photo_mode], ['COMPULSORY', 'REQUIRED'], 'not moved to the default OPTIONAL');
});

test('dispatch: a ZMCC change does not touch the shared assignment while Contractor still reads it', async () => {
  const a = { id: BigInt(5), display_order: 1, is_active: true, is_required: false, is_photo_required: false };
  const m = makeDb([row(30, 'ZMCC_DISPATCH', 'COMPULSORY', 'NONE')], { '30|DISPATCH': a });
  await setPhoto(m.db, '30', [{ point: 'ZMCC_DISPATCH', photoRequired: true }]);
  assert.equal(m.assignmentWrites.length, 0);
  const contractor = (await getTestPhotoStages('30', m.db)).stages.find((s) => s.point === 'CONTRACTOR_DISPATCH')!;
  assert.deepEqual([contractor.testMode, contractor.photoMode], ['OPTIONAL', 'NONE']);
});

test('dispatch: no assignment is created by a photo change, and once both points are saved the shared flag follows', async () => {
  const none = makeDb([row(30, 'ZMCC_DISPATCH', 'COMPULSORY', 'NONE')]);
  await setPhoto(none.db, '30', [{ point: 'ZMCC_DISPATCH', photoRequired: true }]);
  assert.equal(none.assignmentCreates.length, 0);
  const a = { id: BigInt(5), display_order: 1, is_active: true, is_required: true, is_photo_required: false };
  const both = makeDb([row(30, 'ZMCC_DISPATCH', 'COMPULSORY', 'NONE'), row(30, 'CONTRACTOR_DISPATCH', 'OFF', 'NONE')], { '30|DISPATCH': a });
  await setPhoto(both.db, '30', [{ point: 'ZMCC_DISPATCH', photoRequired: true }]);
  assert.deepEqual(Object.keys(both.assignmentWrites[0].data).sort(), ['is_photo_required', 'updated_by_user_id']);
});

test('an inactive test has no stages and a save is refused with the descriptive message', async () => {
  const m = makeDb([]);
  const read = await getTestPhotoStages('40', m.db);
  assert.deepEqual(read.stages, []);
  await assert.rejects(setPhoto(m.db, '40', [{ point: 'PLANT_QA', photoRequired: true }]), /"Starch" \(LT-900040\) is not an active test/);
  await assert.rejects(getTestPhotoStages('999', m.db), /does not exist/);
});

test('each form loader reads its own stage: different photo modes per stage stay separate', async () => {
  const photoAt: Record<TestPointCode, 'REQUIRED' | 'NONE'> = {
    MOT_SHOP: 'REQUIRED', ZMCC_LAB_MC: 'NONE', ZMCC_LAB_HC: 'REQUIRED', ZMCC_DISPATCH: 'NONE', CONTRACTOR_DISPATCH: 'REQUIRED', PLANT_QA: 'NONE',
  };
  const m = makeDb(TEST_POINT_CODES.map((p) => row(30, p, 'COMPULSORY', photoAt[p])));
  for (const point of TEST_POINT_CODES) {
    const { cells } = await getEffectivePolicy(point, new Date(), m.db);
    const atStage = cells.filter((c) => c.labTestId === '30');
    // The shared loader rule of the ZMCC lab, MOT shop and dispatch forms, with the wrong answer in the assignment on purpose.
    const opposite = new Map([['30', { is_active: true, is_required: true, is_photo_required: photoAt[point] !== 'REQUIRED' }]]);
    assert.equal(resolveStageCells(atStage, opposite).find((c) => c.labTestId === '30')?.photoMode, photoAt[point], point);
    // The Plant QA loader rule.
    assert.equal(selectStageCells(atStage, opposite).find((s) => s.cell.labTestId === '30')?.isPhotoRequired, photoAt[point] === 'REQUIRED', point);
  }
});

test('checkbox rule: one per ON stage in matrix order, none for OFF, none for calculated', () => {
  const s = (point: TestPointCode, testMode: 'COMPULSORY' | 'OPTIONAL' | 'OFF' | 'APPLIED' | 'NOT_APPLIED' | 'AUTO') => ({ point, testMode });
  const on = [s('PLANT_QA', 'COMPULSORY'), s('MOT_SHOP', 'APPLIED'), s('ZMCC_LAB_MC', 'OPTIONAL'), s('ZMCC_LAB_HC', 'AUTO'), s('ZMCC_DISPATCH', 'COMPULSORY')];
  assert.deepEqual(stagesWithPhotoCheckbox(on, false).map((x) => x.point), ['MOT_SHOP', 'ZMCC_LAB_MC', 'ZMCC_LAB_HC', 'ZMCC_DISPATCH', 'PLANT_QA']);
  assert.deepEqual(stagesWithPhotoCheckbox([s('PLANT_QA', 'OFF'), s('MOT_SHOP', 'COMPULSORY'), s('ZMCC_LAB_MC', 'NOT_APPLIED')], false).map((x) => x.point), ['MOT_SHOP']);
  assert.deepEqual(stagesWithPhotoCheckbox([s('PLANT_QA', 'OFF')], false), []);
  assert.deepEqual(stagesWithPhotoCheckbox(on, true), []);
});

test('MilkTestPolicyService never takes the photo flag from the test: assignment and default are per stage', async () => {
  const flagged = { id: BigInt(30), testCode: 'LT-900030', testName: 'Salt', resultType: 'POSITIVE_NEGATIVE', unit: null, resultOptions: null, isRequired: false, isPhotoRequired: true, displayOrder: 2, systemRole: null };
  const lr = { ...flagged, id: BigInt(8), testCode: 'LT-000008', testName: 'LR at 20 Celsius', isPhotoRequired: false, systemRole: 'LR' };
  const withAssignment = {
    milkTestPolicyAssignment: { findMany: async () => [{ id: BigInt(1), lab_test: flagged, is_required: true, is_photo_required: null, display_order: 1, is_active: true, testing_point: 'MOT_SHOP' }] },
  };
  const [assigned] = await MilkTestPolicyService.getEffectivePolicy('MOT_SHOP', withAssignment as never);
  assert.equal(assigned.isPhotoRequired, false);

  const neverConfigured = { milkTestPolicyAssignment: { findMany: async () => [] }, labTest: { findMany: async () => [flagged, lr] } };
  const fallback = await MilkTestPolicyService.getEffectivePolicy('MOT_SHOP', neverConfigured as never);
  assert.deepEqual(fallback.map((t) => [t.testCode, t.isPhotoRequired]), [['LT-900030', false], ['LT-000008', true]]);
});
