import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '@core/db';
import { createSessionToken } from '@/backend/core/auth';
import type { Role } from '@/backend/core/types';
import { GET as managerQueue } from '@/app/api/qa/manager/queue/route';

// A PENDING review sent by a QA operator must appear in the AVP QA queue (this route returned 500 for every call
// because it asked Prisma for a relation that does not exist on VehicleVisit). Fixture rows are removed in `finally`.
const tag = `T-QAQ-${Date.now()}`;

async function tokenFor(role: string) {
  const u = await prisma.user.findFirst({ where: { role, is_active: true }, orderBy: { id: 'asc' } });
  assert.ok(u, `an active ${role} user is needed`);
  return createSessionToken({
    id: u.id.toString(),
    username: u.username,
    name: u.full_name || u.username,
    role: u.role as Role,
    department: u.department,
    scope_type: 'ALL',
    procurement_source_id: u.procurement_source_id ? u.procurement_source_id.toString() : null,
  } as never);
}

const call = (token?: string) =>
  managerQueue(
    new Request('http://localhost:3000/api/qa/manager/queue', { headers: token ? { authorization: `Bearer ${token}` } : {} })
  );

test('AVP QA manager queue lists PENDING portions sent for review, and only for roles that can decide', async () => {
  const requester = await prisma.user.findFirstOrThrow({ where: { role: 'QA_LAB_ATTENDANT', is_active: true }, orderBy: { id: 'asc' } });
  const labTest = await prisma.labTest.findFirstOrThrow({ orderBy: { id: 'asc' } });
  const src = await prisma.procurementSource.create({ data: { code: tag, name: 'Queue test ZMCC', source_type: 'ZMCC' } });
  try {
    const visit = await prisma.vehicleVisit.create({
      data: { visit_number: `${tag}-V`, vehicle_number: 'QAQ-1', operational_date: new Date('2031-04-01T00:00:00Z'), procurement_source_id: src.id },
    });
    const pending = await prisma.visitPortion.create({
      data: {
        visit_id: visit.id,
        portion_number: 1,
        plant_decision: 'PENDING',
        manager_review_status: 'PENDING',
        manager_requested_decision: 'ACCEPTED',
        manager_review_requested_by_user_id: requester.id,
        manager_review_requested_at: new Date('2031-04-01T08:00:00Z'),
        manager_review_reason: 'Test photo not available',
        exception_reasons: ['PICTURE_MISSING:LR'],
        system_quality_outcome: 'PASS',
      },
    });
    const notPending = await prisma.visitPortion.create({ data: { visit_id: visit.id, portion_number: 2, plant_decision: 'ACCEPTED', manager_review_status: 'NONE' } });
    await prisma.plantLabResult.create({ data: { visit_id: visit.id, portion_id: pending.id, test_id: labTest.id, numeric_value: 4, performance_status: 'PERFORMED' } });

    // AVP QA (QA_HEAD) and Super Admin see the request, with the shape the screen reads.
    for (const role of ['QA_HEAD', 'SUPER_ADMIN', 'DATA_EXECUTIVE']) {
      const res = await call(await tokenFor(role));
      assert.equal(res.status, 200, `${role} must get the queue`);
      const body = await res.json();
      assert.equal(body.success, true);
      assert.equal(body.pendingCount, body.queue.length);
      assert.deepEqual(body.portions, body.queue);
      const mine = body.queue.find((p: { portionId: string }) => p.portionId === pending.id.toString());
      assert.ok(mine, `${role}: the pending portion must be listed`);
      assert.equal(mine.visitId, visit.id.toString());
      assert.equal(mine.portionNumber, 1);
      assert.equal(mine.vehicleNumber, 'QAQ-1');
      assert.equal(mine.sourceCode, tag);
      assert.equal(mine.managerReviewStatus, 'PENDING');
      assert.equal(mine.managerRequestedDecision, 'ACCEPTED');
      assert.equal(mine.managerReviewReason, 'Test photo not available');
      assert.deepEqual(mine.exceptionReasons, ['PICTURE_MISSING:LR']);
      assert.equal(mine.requesterName, requester.full_name || requester.username);
      assert.equal(mine.vehicleExited, false);
      assert.equal(mine.results.length, 1);
      assert.equal(mine.results[0].testCode, labTest.testCode);
      assert.equal(mine.results[0].numericValue, 4);
      assert.equal(body.queue.some((p: { portionId: string }) => p.portionId === notPending.id.toString()), false, 'a portion with no review request must not be listed');
    }

    // Roles that cannot decide get 403 and no data; a call without a session gets 401.
    for (const role of ['QA_LAB_ATTENDANT', 'ZMCC_MANAGER', 'WEIGHBRIDGE_OPERATOR']) {
      const res = await call(await tokenFor(role));
      assert.equal(res.status, 403, `${role} must not read the AVP queue`);
      const body = await res.json();
      assert.equal(body.queue, undefined);
    }
    assert.equal((await call()).status, 401);
  } finally {
    const visits = await prisma.vehicleVisit.findMany({ where: { procurement_source_id: src.id }, select: { id: true } });
    const ids = visits.map((v) => v.id);
    await prisma.plantLabResult.deleteMany({ where: { visit_id: { in: ids } } });
    await prisma.visitPortion.deleteMany({ where: { visit_id: { in: ids } } });
    await prisma.vehicleVisit.deleteMany({ where: { id: { in: ids } } });
    await prisma.procurementSource.delete({ where: { id: src.id } });
  }
  assert.equal(await prisma.procurementSource.count({ where: { code: tag } }), 0, 'fixture must be removed');
});

test.after(async () => {
  await prisma.$disconnect();
});
