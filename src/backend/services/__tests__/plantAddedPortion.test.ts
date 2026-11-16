import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '@/backend/core/db';
import { createSessionToken } from '@/backend/core/auth';
import type { Role, User } from '@/backend/core/types';
import { POST as addPortion } from '@/app/api/qa/vehicle-visits/[visitId]/portions/route';
import { POST as completeSession } from '@/app/api/qa/vehicle-visits/[visitId]/complete-session/route';
import { getOperationalVisitLogs } from '@/backend/services/operationalReadModelService';

/**
 * A portion the plant adds for its own testing:
 *  - switches the visit to portion-wise testing, so the first portion's result never decides it;
 *  - must have its own decision before the vehicle can go to the weighbridge, even in composite mode;
 *  - is never shown with dispatch values (it was not dispatched), not even the vehicle's.
 */

async function qaToken() {
  const qa = await prisma.user.findFirstOrThrow({ where: { role: 'QA_LAB_ATTENDANT', is_active: true } });
  const user: User = { id: qa.id.toString(), username: qa.username, name: qa.username, role: qa.role as Role, department: 'QA', scope_type: 'DEPARTMENT' };
  return { qa, token: await createSessionToken(user) };
}

/** A composite visit with one dispatched portion (P-01, accepted at the plant) and a QA session. Labelled as a test. */
async function compositeVisit(qaId: bigint) {
  const run = `PLANTP-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  const visit = await prisma.vehicleVisit.create({
    data: {
      visit_number: `V-${run}`,
      vehicle_number: `TEST-${run}`,
      current_status: 'IN_QA',
      test_mode: 'COMPOSITE',
      vehicle_dispatch_fat: 4.35,
      vehicle_dispatch_lr: 26.5,
      operational_date: new Date(),
    },
  });
  const p1 = await prisma.visitPortion.create({
    data: { visit_id: visit.id, portion_number: 1, current_status: 'ACCEPTED', plant_decision: 'ACCEPTED', manager_review_status: 'NONE' },
  });
  await prisma.dispatchInfo.create({ data: { portion_id: p1.id, dispatch_timestamp: new Date(Date.now() - 3600_000) } });
  await prisma.qATestingSession.create({
    data: { visit: { connect: { id: visit.id } }, starter: { connect: { id: qaId } }, started_at: new Date(), status: 'IN_PROGRESS' },
  });
  return visit;
}

async function removeVisit(visitId: bigint) {
  const portions = await prisma.visitPortion.findMany({ where: { visit_id: visitId }, select: { id: true } });
  const sessions = await prisma.qATestingSession.findMany({ where: { visit_id: visitId }, select: { id: true } });
  const ids = portions.map((p) => p.id);
  await prisma.auditLog.deleteMany({
    where: { OR: [{ table_name: 'visit_portion', record_id: { in: ids } }, { table_name: 'vehicle_visit', record_id: visitId }] },
  });
  await prisma.qATestingSessionEvent.deleteMany({ where: { session_id: { in: sessions.map((s) => s.id) } } });
  await prisma.qATestingSession.deleteMany({ where: { visit_id: visitId } });
  await prisma.dispatchInfo.deleteMany({ where: { portion_id: { in: ids } } });
  await prisma.visitPortion.deleteMany({ where: { visit_id: visitId } });
  await prisma.vehicleVisit.delete({ where: { id: visitId } });
}

const post = (url: string, token: string, body: unknown, key?: string) =>
  new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...(key ? { 'idempotency-key': key } : {}) },
    body: JSON.stringify(body),
  });

test('adding a portion at the plant switches the visit to portion-wise testing', async () => {
  const { qa, token } = await qaToken();
  const visit = await compositeVisit(qa.id);
  try {
    const res = await addPortion(post(`http://localhost/api/qa/vehicle-visits/${visit.id}/portions`, token, {}, `add-${visit.id}`), {
      params: Promise.resolve({ visitId: visit.id.toString() }),
    });
    assert.equal(res.status, 200, JSON.stringify(await res.clone().json()));
    const after = await prisma.vehicleVisit.findUniqueOrThrow({ where: { id: visit.id } });
    assert.equal(after.test_mode, 'PORTION_WISE');
  } finally {
    await removeVisit(visit.id);
  }
});

test('in composite mode a portion added at the plant still needs its own decision before the weighbridge', async () => {
  const { qa, token } = await qaToken();
  const visit = await compositeVisit(qa.id);
  try {
    // Plant portion added directly, with the visit left in composite mode (as if switched back by hand).
    await prisma.visitPortion.create({
      data: { visit_id: visit.id, portion_number: 2, current_status: 'UNDER_TEST', plant_decision: 'PENDING', manager_review_status: 'NONE' },
    });
    const res = await completeSession(post(`http://localhost/api/qa/vehicle-visits/${visit.id}/complete-session`, token, { action: 'WEIGHBRIDGE' }), {
      params: Promise.resolve({ visitId: visit.id.toString() }),
    });
    assert.equal(res.status, 400, 'the untested plant portion blocks the weighbridge');
    const after = await prisma.vehicleVisit.findUniqueOrThrow({ where: { id: visit.id } });
    assert.equal(after.current_status, 'IN_QA', 'the vehicle did not move on');

    // The composite acceptance rule only reaches dispatched compartments (same filter as the completion route).
    await prisma.visitPortion.updateMany({
      where: { visit_id: visit.id, plant_decision: { not: 'ACCEPTED' }, dispatch_info: { isNot: null } },
      data: { plant_decision: 'ACCEPTED' },
    });
    const p2 = await prisma.visitPortion.findFirstOrThrow({ where: { visit_id: visit.id, portion_number: 2 } });
    assert.equal(p2.plant_decision, 'PENDING', 'the plant portion is not accepted by the first portion');
  } finally {
    await removeVisit(visit.id);
  }
});

test('a portion added at the plant shows no dispatch values, not even the vehicle ones', async () => {
  const { qa } = await qaToken();
  const visit = await compositeVisit(qa.id);
  try {
    await prisma.visitPortion.create({
      data: { visit_id: visit.id, portion_number: 2, current_status: 'UNDER_TEST', plant_decision: 'PENDING', manager_review_status: 'NONE' },
    });
    const logs = await getOperationalVisitLogs(visit.id);
    const p1 = logs.find((l) => l.portion_number === 'P-01');
    const p2 = logs.find((l) => l.portion_number === 'P-02');
    assert.ok(p1 && p2);
    assert.equal(p1.is_dispatch_portion, true);
    assert.equal(p1.dispatch_fat, 4.35, 'the dispatched portion keeps the vehicle value');
    assert.equal(p2.is_dispatch_portion, false);
    assert.equal(p2.dispatch_fat, null);
    assert.equal(p2.dispatch_lr, null);
  } finally {
    await removeVisit(visit.id);
  }
});

test.after(async () => {
  await prisma.$disconnect();
});
