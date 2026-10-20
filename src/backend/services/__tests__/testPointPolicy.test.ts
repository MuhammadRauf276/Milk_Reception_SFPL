import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getEffectivePolicy,
  getPolicyMatrix,
  mapLegacyTestPoint,
  updatePolicyCells,
  PolicyValidationError,
  type PolicyDb,
  type PolicyRow,
} from '../testPointPolicyService';
import type { ActingContext } from '@/types/acting';

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
