import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getEffectivePolicy,
  getPolicyMatrix,
  mapLegacyTestPoint,
  updatePolicyCells,
  selectStageCells,
  keepFormulaTests, withFormulaInputs, lockFormulaInput,
  PolicyValidationError,
  PolicyConflictError,
  type PolicyDb,
  type PolicyRow,
} from '../testPointPolicyService';
import type { ActingContext } from '@/types/acting';
import type { TestPointPolicyCell } from '@/types/test-point-policy';

const LR = { id: BigInt(1), testCode: 'LT-000008', testName: 'LR at 20 Celsius', displayOrder: 1 };
const FAT = { id: BigInt(2), testCode: 'LT-000026', testName: 'Fat', displayOrder: 2 };
const SALT = { id: BigInt(3), testCode: 'LT-000010', testName: 'Salt', displayOrder: 3 };
const DOC = { id: BigInt(4), testCode: 'LAB_REPORT_HANDWRITTEN', testName: 'Lab report (hand-written)', displayOrder: 99 };

function makeDb(initial: PolicyRow[] = []) {
  const rows: PolicyRow[] = [...initial];
  const changeLogs: Array<Record<string, unknown>> = [];
  const audits: Array<Record<string, unknown>> = [];
  let nextId = 100;
  const db: PolicyDb = {
    testPointPolicy: {
      async findMany() {
        return rows.map((r) => ({ ...r }));
      },
      async updateMany(args: unknown) {
        const a = args as { where: { id: { in: bigint[] } }; data: Partial<PolicyRow> };
        for (const r of rows) if (a.where.id.in.includes(r.id)) Object.assign(r, a.data);
        return { count: 0 };
      },
      async create(args: unknown) {
        const d = (args as { data: Record<string, unknown> }).data;
        rows.push({ id: BigInt(nextId++), ...d } as unknown as PolicyRow);
        return {};
      },
    },
    labTest: {
      async findMany() {
        return [LR, FAT, SALT, DOC];
      },
    },
    configChangeLog: {
      async create(args: unknown) {
        changeLogs.push((args as { data: Record<string, unknown> }).data);
        return { id: BigInt(changeLogs.length) };
      },
    },
    auditLog: {
      async create(args: never) {
        audits.push((args as { data: Record<string, unknown> }).data);
        return { id: BigInt(audits.length) };
      },
    },
    milkTestPolicyAssignment: {
      async findUnique(_args: unknown) { return null; },
      async aggregate(_args: unknown) { return { _max: { display_order: null } }; },
      async create(_args: unknown) { return { id: BigInt(0) }; },
      async update(_args: unknown) { return { id: BigInt(0) }; },
    },
    async $transaction<T>(fn: (tx: PolicyDb) => Promise<T>) {
      return fn(db);
    },
  };
  return { db, rows, changeLogs, audits };
}

const ctx: ActingContext = {
  userId: BigInt(7),
  actorRole: 'SUPER_ADMIN',
  actingAs: 'SUPER_ADMIN',
  isDelegated: false,
  scope: { kind: 'SYSTEM' },
};

function row(over: Partial<PolicyRow>): PolicyRow {
  return {
    id: BigInt(50),
    lab_test_id: SALT.id,
    testing_point: 'MOT_SHOP',
    test_mode: 'COMPULSORY',
    rule_mode: 'WARN',
    photo_mode: 'OPTIONAL',
    version: 1,
    effective_from: new Date('2026-01-01T00:00:00Z'),
    effective_to: null,
    ...over,
  };
}

test('defaults: LR and Fat photo required except contractor dispatch', async () => {
  const { db } = makeDb();
  const { cells } = await getPolicyMatrix(new Date(), db);
  for (const code of ['LT-000008', 'LT-000026']) {
    for (const c of cells.filter((x) => x.testCode === code)) {
      assert.equal(c.photoMode, c.point === 'CONTRACTOR_DISPATCH' ? 'OPTIONAL' : 'REQUIRED');
      assert.equal(c.source, 'DEFAULT');
      assert.equal(c.version, 0);
    }
  }
  const salt = cells.find((c) => c.testCode === 'LT-000010' && c.point === 'PLANT_QA');
  assert.deepEqual([salt?.testMode, salt?.ruleMode, salt?.photoMode], ['OPTIONAL', 'APPLY', 'NONE']);
});

test('defaults: hand-written lab report photo required at dispatch points only', async () => {
  const { db } = makeDb();
  const { cells } = await getPolicyMatrix(new Date(), db);
  for (const c of cells.filter((x) => x.testCode === 'LAB_REPORT_HANDWRITTEN')) {
    if (c.point === 'ZMCC_DISPATCH' || c.point === 'CONTRACTOR_DISPATCH') {
      assert.equal(c.photoMode, 'REQUIRED');
      assert.equal(c.testMode, 'COMPULSORY');
    } else {
      assert.equal(c.photoMode, 'NONE');
      assert.equal(c.testMode, 'OFF');
    }
  }
});

test('legacy point mapping', () => {
  assert.equal(mapLegacyTestPoint('ZMCC_LAB_MOT'), 'ZMCC_LAB_MC');
  assert.equal(mapLegacyTestPoint('ZMCC_LAB_LOCAL_SUPPLIER'), 'ZMCC_LAB_HC');
  assert.equal(mapLegacyTestPoint('ZMCC_LAB_CONTRACTOR'), 'ZMCC_LAB_HC');
  assert.equal(mapLegacyTestPoint('DISPATCH'), 'ZMCC_DISPATCH');
  assert.equal(mapLegacyTestPoint('DISPATCH', 'ZMCC'), 'ZMCC_DISPATCH');
  assert.equal(mapLegacyTestPoint('DISPATCH', 'CONTRACTOR'), 'CONTRACTOR_DISPATCH');
  assert.equal(mapLegacyTestPoint('PLANT_QA'), 'PLANT_QA');
  assert.equal(mapLegacyTestPoint('NOPE'), null);
});

test('legacy DB rows are read under the new point code', async () => {
  const { db } = makeDb([row({ testing_point: 'ZMCC_LAB_MOT', test_mode: 'OFF' })]);
  const eff = await getEffectivePolicy('ZMCC_LAB_MC', new Date(), db);
  const c = eff.cells.find((x) => x.testCode === 'LT-000010');
  assert.equal(c?.testMode, 'OFF');
  assert.equal(c?.source, 'DB');
  assert.equal(eff.version, 1);
});

test('version selection by at', async () => {
  const t1 = new Date('2026-01-01T00:00:00Z');
  const t2 = new Date('2026-03-01T00:00:00Z');
  const { db } = makeDb([
    row({ id: BigInt(1), version: 1, effective_from: t1, effective_to: t2, test_mode: 'OPTIONAL' }),
    row({ id: BigInt(2), version: 2, effective_from: t2, effective_to: null, test_mode: 'COMPULSORY' }),
  ]);
  const pick = async (at: Date) =>
    (await getEffectivePolicy('MOT_SHOP', at, db)).cells.find((c) => c.testCode === 'LT-000010');
  assert.equal((await pick(new Date('2026-02-01T00:00:00Z')))?.version, 1);
  assert.equal((await pick(t2))?.version, 2);
  assert.equal((await pick(new Date('2026-06-01T00:00:00Z')))?.testMode, 'COMPULSORY');
  assert.equal((await pick(new Date('2025-06-01T00:00:00Z')))?.source, 'DEFAULT');
});

test('update closes old row, inserts version+1, writes change log and audit', async () => {
  const { db, rows, changeLogs, audits } = makeDb([row({ id: BigInt(1), version: 3 })]);
  const res = await updatePolicyCells(
    ctx,
    [{ labTestId: '3', point: 'MOT_SHOP', testMode: 'OFF', ruleMode: 'APPLY', photoMode: 'REQUIRED' }],
    'Owner request for winter season',
    db
  );
  assert.equal(res.applied, 1);
  const old = rows.find((r) => r.id === BigInt(1));
  assert.ok(old?.effective_to instanceof Date);
  const created = rows.find((r) => r.id !== BigInt(1));
  assert.equal(created?.version, 4);
  assert.equal(created?.effective_to, null);
  assert.equal(created?.test_mode, 'OFF');
  assert.equal(changeLogs.length, 1);
  assert.equal(changeLogs[0].module, 'TEST_POINT_POLICY');
  assert.equal(changeLogs[0].reason, 'Owner request for winter season');
  assert.equal(audits.length, 1);
  assert.equal(audits[0].action, 'TEST_POINT_POLICY_UPDATE');
  assert.equal(audits[0].user_id, BigInt(7));
});

test('update on default cell creates version 1; unchanged cells are skipped', async () => {
  const { db, rows } = makeDb();
  const res = await updatePolicyCells(
    ctx,
    [
      { labTestId: '3', point: 'PLANT_QA', testMode: 'COMPULSORY', ruleMode: 'APPLY', photoMode: 'NONE' },
      { labTestId: '3', point: 'MOT_SHOP', testMode: 'OPTIONAL', ruleMode: 'APPLY', photoMode: 'NONE' },
    ],
    'Make salt compulsory at plant',
    db
  );
  assert.equal(res.applied, 1);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].version, 1);
});

test('reason is required', async () => {
  const { db, rows } = makeDb();
  const change = [{ labTestId: '3', point: 'PLANT_QA' as const, testMode: 'OFF' as const, ruleMode: 'APPLY' as const, photoMode: 'NONE' as const }];
  await assert.rejects(updatePolicyCells(ctx, change, '', db), PolicyValidationError);
  await assert.rejects(updatePolicyCells(ctx, change, '  abc ', db), PolicyValidationError);
  assert.equal(rows.length, 0);
});

test('legacy DISPATCH row applies to both dispatch points', async () => {
  const { db } = makeDb([row({ testing_point: 'DISPATCH', test_mode: 'OFF' })]);
  for (const p of ['ZMCC_DISPATCH', 'CONTRACTOR_DISPATCH'] as const) {
    const c = (await getEffectivePolicy(p, new Date(), db)).cells.find((x) => x.testCode === 'LT-000010');
    assert.equal(c?.testMode, 'OFF');
    assert.equal(c?.source, 'DB');
  }
});

test('updating one dispatch point keeps legacy DISPATCH row for the other', async () => {
  const { db, rows } = makeDb([row({ id: BigInt(1), testing_point: 'DISPATCH', test_mode: 'OFF' })]);
  await updatePolicyCells(ctx, [{ labTestId: '3', point: 'ZMCC_DISPATCH', testMode: 'COMPULSORY', ruleMode: 'APPLY', photoMode: 'NONE' }], 'Change zmcc only', db);
  assert.equal(rows[0].effective_to, null);
  const z = (await getEffectivePolicy('ZMCC_DISPATCH', new Date(), db)).cells.find((x) => x.testCode === 'LT-000010');
  const k = (await getEffectivePolicy('CONTRACTOR_DISPATCH', new Date(), db)).cells.find((x) => x.testCode === 'LT-000010');
  assert.equal(z?.testMode, 'COMPULSORY');
  assert.equal(k?.testMode, 'OFF');
});

test('unique violation becomes PolicyConflictError', async () => {
  const { db } = makeDb();
  db.testPointPolicy.create = async () => {
    throw Object.assign(new Error('unique'), { code: 'P2002' });
  };
  await assert.rejects(
    updatePolicyCells(ctx, [{ labTestId: '3', point: 'PLANT_QA', testMode: 'OFF', ruleMode: 'APPLY', photoMode: 'NONE' }], 'Some reason', db),
    PolicyConflictError
  );
});

function stageCell(id: string, testMode: TestPointPolicyCell['testMode'], source: 'DB' | 'DEFAULT', photoMode: TestPointPolicyCell['photoMode'] = 'NONE'): TestPointPolicyCell {
  return {
    labTestId: id,
    testCode: `T${id}`,
    testName: `Test ${id}`,
    displayOrder: 10,
    point: 'PLANT_QA',
    testMode,
    ruleMode: 'APPLY',
    photoMode,
    version: source === 'DB' ? 1 : 0,
    effectiveFrom: new Date(0).toISOString(),
    source,
  };
}

test('selectStageCells: saved matrix row decides required, photo and visibility', () => {
  const cells = [
    stageCell('1', 'COMPULSORY', 'DB', 'REQUIRED'),
    stageCell('2', 'APPLIED', 'DB'),
    stageCell('3', 'NOT_APPLIED', 'DB'),
    stageCell('4', 'OFF', 'DB'),
    stageCell('5', 'AUTO', 'DB'),
  ];
  const out = selectStageCells(cells, new Map());
  assert.deepEqual(out.map((s) => s.cell.labTestId), ['1', '2', '5']);
  assert.equal(out[0].isRequired, true);
  assert.equal(out[0].isPhotoRequired, true);
  assert.equal(out[1].isRequired, false);
  assert.equal(out[2].isRequired, false);
  assert.ok(out.every((s) => s.origin === 'MATRIX'));
});

test('selectStageCells: never-configured cells are hidden, active assignment is the fallback', () => {
  const cells = [stageCell('1', 'OPTIONAL', 'DEFAULT'), stageCell('2', 'OPTIONAL', 'DEFAULT')];
  const out = selectStageCells(cells, new Map([['2', { is_required: true, is_photo_required: true, display_order: 3 }]]));
  assert.equal(out.length, 1);
  assert.equal(out[0].cell.labTestId, '2');
  assert.equal(out[0].origin, 'ASSIGNMENT');
  assert.equal(out[0].isRequired, true);
  assert.equal(out[0].isPhotoRequired, true);
  assert.equal(out[0].displayOrder, 10); // master order, not the assignment's 3
});

test('selectStageCells: a saved OFF row beats an active assignment; the form keeps master order', () => {
  const cells = [stageCell('1', 'OFF', 'DB'), stageCell('2', 'COMPULSORY', 'DB')];
  const out = selectStageCells(
    cells,
    new Map([
      ['1', { is_required: true, display_order: 1 }],
      ['2', { is_required: false, display_order: 7 }],
    ])
  );
  assert.deepEqual(out.map((s) => s.cell.labTestId), ['2']);
  assert.equal(out[0].isRequired, true);
  assert.equal(out[0].displayOrder, 10); // master order, not the assignment's 7
});

function named(id: string, code: string, name: string, testMode: TestPointPolicyCell['testMode'], source: 'DB' | 'DEFAULT'): TestPointPolicyCell {
  return { ...stageCell(id, testMode, source), testCode: code, testName: name };
}

test('keepFormulaTests: keeps LR at 20, drops the duplicate lactometer test, adds missing Fat as compulsory', () => {
  const lr20 = named('1', 'LT-000008', 'LR at 20 Celsius', 'COMPULSORY', 'DB');
  const lactometer = named('2', 'LT-000027', 'Lactometer Reading', 'APPLIED', 'DB');
  const fat = named('3', 'LT-000026', 'Fat', 'OPTIONAL', 'DEFAULT');
  const salt = named('4', 'LT-000010', 'Salt', 'APPLIED', 'DB');
  const cells = [lr20, lactometer, fat, salt];
  const out = keepFormulaTests(selectStageCells(cells, new Map()), cells);
  const ids = out.map((s) => s.cell.labTestId).sort();
  assert.deepEqual(ids, ['1', '3', '4']);
  assert.equal(out.find((s) => s.cell.labTestId === '1')?.isRequired, true);
  assert.equal(out.find((s) => s.cell.labTestId === '3')?.isRequired, true);
});

test('keepFormulaTests: LR and Fat are locked ON and compulsory even when the matrix turned them off', () => {
  const lr20 = named('1', 'LT-000008', 'LR at 20 Celsius', 'OFF', 'DB');
  const fat = named('3', 'LT-000026', 'Fat', 'NOT_APPLIED', 'DB');
  const cells = [lr20, fat];
  const out = keepFormulaTests(selectStageCells(cells, new Map()), cells);
  assert.deepEqual(out.map((s) => s.cell.labTestId).sort(), ['1', '3']);
  assert.ok(out.every((s) => s.isRequired === true));
});

test('keepFormulaTests: LR and Fat are found by stored role, whatever their name, code, order or id', () => {
  const lr = { ...named('90', 'MY-LACTO', 'Lactometer 20C custom', 'OPTIONAL', 'DB'), displayOrder: 5, systemRole: 'LR' } as TestPointPolicyCell;
  const fat = { ...named('12', 'X-F', 'Butterfat', 'OFF', 'DB'), displayOrder: 99, systemRole: 'FAT' } as TestPointPolicyCell;
  const other = named('7', 'LT-000010', 'Salt', 'COMPULSORY', 'DB');
  const cells = [lr, fat, other];
  const out = keepFormulaTests(selectStageCells(cells, new Map()), cells);
  assert.deepEqual(out.map((s) => s.cell.labTestId).sort(), ['12', '7', '90']);
  assert.ok(out.filter((s) => s.cell.labTestId !== '7').every((s) => s.isRequired));
});

test('keepFormulaTests: a renamed LR with a stored role wins over a look-alike duplicate', () => {
  const real = { ...named('50', 'ZZ-1', 'Reading A', 'COMPULSORY', 'DB'), systemRole: 'LR' } as TestPointPolicyCell;
  const lookAlike = named('51', 'LT-000008', 'LR at 20 Celsius', 'COMPULSORY', 'DB');
  const fat = named('3', 'LT-000026', 'Fat', 'COMPULSORY', 'DB');
  const cells = [real, lookAlike, fat];
  const out = keepFormulaTests(selectStageCells(cells, new Map()), cells);
  assert.deepEqual(out.map((s) => s.cell.labTestId).sort(), ['3', '50']);
});

test('withFormulaInputs / lockFormulaInput: one LR, one Fat, locked compulsory (not at contractor dispatch)', () => {
  const lr = named('1', 'LT-000008', 'LR at 20 Celsius', 'OFF', 'DB');
  const dup = named('2', 'LT-000027', 'Lactometer Reading', 'COMPULSORY', 'DB');
  const fat = named('3', 'LT-000026', 'Fat', 'OFF', 'DB');
  const all = [lr, dup, fat];
  const picked = withFormulaInputs([dup], all);
  assert.deepEqual(picked.map((c) => c.labTestId).sort(), ['1', '3']);
  assert.ok(picked.map(lockFormulaInput).every((c) => c.testMode === 'COMPULSORY'));
  const contractor = { ...fat, point: 'CONTRACTOR_DISPATCH' as const };
  assert.equal(lockFormulaInput(contractor).testMode, 'OFF');
});
