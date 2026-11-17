import 'dotenv/config';
import test, { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '@/backend/core/db';
import type { Role, User } from '@/backend/core/types';
import { correctPlantQaResults } from '@/backend/services/corrections/plantQaCorrection';
import { correctDispatchPortionTests } from '@/backend/services/corrections/dispatchPortionCorrection';
import { correctLabPortion } from '@/backend/services/zmcc/labPortionCorrectionService';
import { listRecordGroups } from '@/backend/services/recordEditorService';
import { loadLabPolicy } from '@/backend/services/zmcc/labPortionReviewService';
import { buildLabPortionDecision } from '@/backend/services/zmcc/labPortionDecision';
import { isPlantFatTest, isPlantLrTest } from '@/backend/services/vehicleQuantityService';

/**
 * Direct edit: the Super Admin can fill in a test that was assigned but never entered (no result row, or marked not
 * performed). Nobody else can. Every record here is labelled TEST-DEM and removed afterwards.
 */
describe('Direct edit fills in missing test values', () => {
  const run = `DEM-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  let admin: User;
  let executive: User | null = null;
  let adminId: bigint;
  let t1: { id: bigint; testCode: string; testName: string };
  let t2: { id: bigint; testCode: string; testName: string };
  const visitIds: bigint[] = [];
  const arrivalIds: bigint[] = [];
  const sessionIds: bigint[] = [];

  const asUser = (u: { id: bigint; username: string; role: string; full_name: string | null }): User => ({
    id: u.id.toString(),
    username: u.username,
    name: u.full_name || u.username,
    role: u.role as Role,
    department: 'TEST',
    scope_type: 'GLOBAL',
  });

  before(async () => {
    const sa = await prisma.user.findFirstOrThrow({ where: { role: 'SUPER_ADMIN', is_active: true } });
    adminId = sa.id;
    admin = asUser(sa);
    const de = await prisma.user.findFirst({ where: { role: 'DATA_EXECUTIVE', is_active: true } });
    executive = de ? asUser(de) : null;
    const tests = await prisma.labTest.findMany({ where: { isActive: true, resultType: 'NUMERIC', systemRole: null }, orderBy: { id: 'asc' } });
    const plain = tests.filter((t) => !isPlantLrTest(t.testCode, t.testName, t.systemRole) && !isPlantFatTest(t.testCode, t.testName, t.systemRole));
    assert.ok(plain.length >= 2, 'Needs two numeric tests in the lab test list.');
    [t1, t2] = plain;
  });

  after(async () => {
    for (const id of visitIds) {
      const portions = await prisma.visitPortion.findMany({ where: { visit_id: id }, select: { id: true } });
      await prisma.auditLog.deleteMany({
        where: { OR: [{ table_name: 'visit_portion', record_id: { in: portions.map((p) => p.id) } }, { table_name: 'vehicle_visit', record_id: id }] },
      });
      await prisma.vehicleVisit.delete({ where: { id } }).catch(() => undefined);
    }
    for (const id of sessionIds) {
      const portions = await prisma.zmccLabPortion.findMany({ where: { lab_session_id: id }, select: { id: true } });
      await prisma.auditLog.deleteMany({
        where: { OR: [{ table_name: 'zmcc_lab_session', record_id: id }, { table_name: 'zmcc_lab_portion', record_id: { in: portions.map((p) => p.id) } }] },
      });
      await prisma.zmccLabResult.deleteMany({ where: { session_id: id } });
      await prisma.zmccLabPortion.deleteMany({ where: { lab_session_id: id } });
      await prisma.zmccLabSession.delete({ where: { id } }).catch(() => undefined);
    }
    for (const id of arrivalIds) await prisma.zmccLocalSupplierArrival.delete({ where: { id } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  async function visitWithPortion(workflow: 'PLANT_QA' | 'DISPATCH') {
    const visit = await prisma.vehicleVisit.create({
      data: { visit_number: `V-${run}-${workflow}-${visitIds.length}`, vehicle_number: `TEST-${run}`, current_status: 'IN_QA', test_mode: 'COMPOSITE', operational_date: new Date() },
    });
    visitIds.push(visit.id);
    const portion = await prisma.visitPortion.create({
      data: { visit_id: visit.id, portion_number: 1, current_status: 'ACCEPTED', plant_decision: 'ACCEPTED', manager_review_status: 'NONE' },
    });
    await prisma.labTestAssignment.createMany({
      data: [t1, t2].map((t, i) => ({
        visit_id: visit.id,
        workflow,
        test_id: t.id,
        test_code_snapshot: t.testCode,
        test_name_snapshot: t.testName,
        result_type_snapshot: 'NUMERIC',
        display_order_snapshot: i + 1,
        is_required_snapshot: true,
      })),
    });
    return { visit, portion };
  }

  test('Plant QA: a test with no row shows as Not entered, the Super Admin fills it, others cannot', async () => {
    const { visit, portion } = await visitWithPortion('PLANT_QA');
    await prisma.plantLabResult.create({
      data: { visit_id: visit.id, portion_id: portion.id, test_id: t1.id, numeric_value: 5, performance_status: 'PERFORMED', tested_by: adminId, result_timestamp: new Date() },
    });

    const listed = await listRecordGroups({ search: visit.visit_number, page: 1, pageSize: 5 });
    const section = listed.groups.flatMap((g) => g.sections).find((s) => s.entity === 'PLANT_QA' && s.recordId === portion.id.toString());
    assert.ok(section, 'Plant QA section is listed.');
    const f1 = section.fields.find((f) => f.field === `result_${t1.id}`);
    const f2 = section.fields.find((f) => f.field === `result_${t2.id}`);
    assert.equal(f1?.value, 5);
    assert.ok(!f1?.notEntered);
    assert.equal(f2?.value, null);
    assert.equal(f2?.notEntered, true);
    assert.deepEqual(section.fields.slice(0, 2).map((f) => f.field), [`result_${t1.id}`, `result_${t2.id}`], 'Assigned display order.');

    if (executive) {
      const refused = await correctPlantQaResults(executive, visit.id.toString(), portion.id.toString(), { reason: 'try it', results: [{ test_id: t2.id.toString(), numeric_value: 7 }] });
      assert.equal(refused.status, 400);
      assert.equal(await prisma.plantLabResult.count({ where: { portion_id: portion.id, test_id: t2.id } }), 0);
    }

    const saved = await correctPlantQaResults(admin, visit.id.toString(), portion.id.toString(), { reason: 'filled in by test', results: [{ test_id: t2.id.toString(), numeric_value: 7 }] });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    const row = await prisma.plantLabResult.findFirstOrThrow({ where: { portion_id: portion.id, test_id: t2.id } });
    assert.equal(row.performance_status, 'PERFORMED');
    assert.equal(Number(row.numeric_value), 7);
    assert.equal(row.tested_by, adminId);
    assert.ok(row.evaluation_status);
    const after = await prisma.visitPortion.findUniqueOrThrow({ where: { id: portion.id } });
    assert.equal(after.correction_count, 1);
    assert.ok(after.system_quality_outcome, 'The portion is judged again.');
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { table_name: 'visit_portion', record_id: portion.id, action: 'PLANT_QA_MEASUREMENT_CORRECTED' } });
    const oldRows = (audit.old_values as { results: Array<{ test_id: string; numeric_value: number | null; performance_status: string | null }> }).results;
    assert.equal(oldRows[0].test_id, t2.id.toString());
    assert.equal(oldRows[0].numeric_value, null);

    // A value that already exists still corrects as before.
    const again = await correctPlantQaResults(admin, visit.id.toString(), portion.id.toString(), { reason: 'fix first value', results: [{ test_id: t1.id.toString(), numeric_value: 6 }] });
    assert.equal(again.status, 200, JSON.stringify(again.body));
    assert.equal(Number((await prisma.plantLabResult.findFirstOrThrow({ where: { portion_id: portion.id, test_id: t1.id } })).numeric_value), 6);
    assert.equal((await prisma.visitPortion.findUniqueOrThrow({ where: { id: portion.id } })).correction_count, 2);
  });

  test('Plant QA: a test marked not performed becomes performed', async () => {
    const { visit, portion } = await visitWithPortion('PLANT_QA');
    await prisma.plantLabResult.create({
      data: { visit_id: visit.id, portion_id: portion.id, test_id: t1.id, performance_status: 'NOT_PERFORMED', not_performed_reason: 'Skipped' },
    });
    const listed = await listRecordGroups({ search: visit.visit_number, page: 1, pageSize: 5 });
    const section = listed.groups.flatMap((g) => g.sections).find((s) => s.entity === 'PLANT_QA' && s.recordId === portion.id.toString());
    assert.equal(section?.fields.find((f) => f.field === `result_${t1.id}`)?.notEntered, true);
    const saved = await correctPlantQaResults(admin, visit.id.toString(), portion.id.toString(), { reason: 'filled in by test', results: [{ test_id: t1.id.toString(), numeric_value: 4 }] });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    const row = await prisma.plantLabResult.findFirstOrThrow({ where: { portion_id: portion.id, test_id: t1.id } });
    assert.equal(row.performance_status, 'PERFORMED');
    assert.equal(row.not_performed_reason, null);
    assert.equal(row.tested_by, adminId);
  });

  test('Dispatch: the Super Admin creates a missing test result, others cannot', async () => {
    const { visit, portion } = await visitWithPortion('DISPATCH');
    const listed = await listRecordGroups({ search: visit.visit_number, page: 1, pageSize: 5 });
    const section = listed.groups.flatMap((g) => g.sections).find((s) => s.entity === 'DISPATCH_PORTION' && s.recordId === portion.id.toString());
    assert.equal(section?.fields.find((f) => f.field === `result_${t2.id}`)?.notEntered, true);

    const payload = { visitId: visit.id.toString(), portionId: portion.id.toString(), reason: 'filled in by test', results: [{ test_id: t2.id.toString(), numeric_value: 3 }] };
    if (executive) {
      assert.equal((await correctDispatchPortionTests(executive, payload)).status, 400);
      assert.equal(await prisma.dispatchLabResult.count({ where: { portion_id: portion.id } }), 0);
    }
    const saved = await correctDispatchPortionTests(admin, payload);
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    const row = await prisma.dispatchLabResult.findFirstOrThrow({ where: { portion_id: portion.id, test_id: t2.id } });
    assert.equal(row.performance_status, 'PERFORMED');
    assert.equal(Number(row.numeric_value), 3);
    assert.equal(row.tested_by, adminId);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { table_name: 'visit_portion', record_id: portion.id, action: 'DISPATCH_PORTION_TESTS_CORRECTED' } });
    assert.equal((audit.old_values as { results: Array<{ numeric: unknown }> }).results[0].numeric, null);
    await prisma.auditLog.deleteMany({ where: { id: audit.id } });
  });

  test('ZMCC lab portion: the Super Admin fills a test with no row, the version is checked', async () => {
    const supplier = await prisma.zmccLocalSupplier.findFirstOrThrow({ where: { is_active: true } });
    const arrival = await prisma.zmccLocalSupplierArrival.create({
      data: {
        client_event_id: `EV-${run}`,
        zmcc_id: supplier.zmcc_id,
        local_supplier_id: supplier.id,
        zmcc_token: `TEST-${run}`,
        vehicle_number: `TEST-${run}`,
        arrival_timestamp: new Date(),
        arrival_date: new Date(),
        recorded_by_user_id: adminId,
      },
    });
    arrivalIds.push(arrival.id);
    const session = await prisma.zmccLabSession.create({
      data: { arrival_type: 'HC', local_supplier_arrival_id: arrival.id, zmcc_id: supplier.zmcc_id, test_mode: 'COMPOSITE', status: 'COMPLETED', started_at: new Date(), started_by_user_id: adminId },
    });
    sessionIds.push(session.id);

    const policy = await loadLabPolicy('ZMCC_LAB_HC', new Date());
    const typed = policy.tests.find((x) => x.testMode !== 'OFF' && x.testMode !== 'AUTO' && !x.isLr && !x.isFat && x.resultType === 'NUMERIC');
    if (!typed) return; // No numeric typed test in the lab policy: nothing to fill in.
    const built = buildLabPortionDecision(policy, { tests: [], photos: [], personDecision: 'ACCEPT', remarks: null, deciderCanApprove: false });
    const portion = await prisma.zmccLabPortion.create({
      data: {
        lab_session_id: session.id,
        portion_number: 1,
        status: 'PENDING_REVIEW',
        final_decision: 'PENDING',
        lr: 28.5,
        fat: 4.1,
        density: 1.028,
        snf: 8.5,
        ts: 12.6,
        decision_details: built.details as unknown as object,
      },
    });

    const listed = await listRecordGroups({ search: arrival.zmcc_token, page: 1, pageSize: 5, stage: 'HC' });
    const section = listed.groups.flatMap((g) => g.sections).find((s) => s.entity === 'LAB_PORTION' && s.recordId === portion.id.toString());
    assert.equal(section?.fields.find((f) => f.field === `result_${typed.labTestId}`)?.notEntered, true);
    assert.ok(!section?.fields.some((f) => f.field === 'result_' + policy.tests.find((x) => x.isLr)?.labTestId && f.notEntered), 'LR keeps its own field.');

    const stale = await correctLabPortion(admin, portion.id.toString(), { reason: 'stale', version: 99, results: [{ test_id: typed.labTestId, numeric_value: 2 }] });
    assert.equal(stale.status, 409);

    const saved = await correctLabPortion(admin, portion.id.toString(), { reason: 'filled in by test', version: portion.version, results: [{ test_id: typed.labTestId, numeric_value: 2 }] });
    assert.equal(saved.status, 200, JSON.stringify(saved));
    const row = await prisma.zmccLabResult.findFirstOrThrow({ where: { portion_id: portion.id, test_id: BigInt(typed.labTestId) } });
    assert.equal(Number(row.numeric_value), 2);
    const after = await prisma.zmccLabPortion.findUniqueOrThrow({ where: { id: portion.id } });
    assert.equal(after.version, portion.version + 1);
    const stored = (after.decision_details as { tests: Array<{ labTestId: string; value: number | null }> }).tests.find((x) => x.labTestId === typed.labTestId);
    assert.equal(stored?.value, 2, 'The decision record carries the new value.');
    assert.equal((await prisma.zmccLabSession.findUniqueOrThrow({ where: { id: session.id } })).correction_count, 1);

    if (executive) {
      const refused = await correctLabPortion(executive, portion.id.toString(), { reason: 'try it', version: after.version, results: [{ test_id: t2.id.toString(), numeric_value: 1 }] });
      assert.notEqual(refused.status, 200);
    }
  });
});
