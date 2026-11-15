import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '@/backend/core/db';
import { createVisitForSubmit, discardUnsentVisit, previewNewDispatch } from '@/backend/services/dispatch/unsentVisit';
import { isDraftVisitNumber } from '@/backend/services/dispatch/visitNumber';

async function fixture() {
  const user = await prisma.user.findFirstOrThrow({ where: { is_active: true, procurement_source_id: { not: null } } });
  return { userId: user.id, sourceId: user.procurement_source_id as bigint };
}

test('opening a dispatch form saves nothing: the fields come from a preview', async () => {
  const { sourceId } = await fixture();
  const before = await prisma.vehicleVisit.count();
  const preview = await previewNewDispatch(sourceId);
  assert.equal(await prisma.vehicleVisit.count(), before, 'no visit row was created');
  assert.ok(preview.assignedTests.length >= 0);
  assert.equal(preview.quantityPolicy.sourceId, sourceId.toString());
  assert.equal(preview.quantityPolicy.visitId, '', 'there is no visit yet');
  assert.ok(preview.quantityPolicy.policy, 'the quantity rules are returned');
});

test('a refused submit leaves no row: the visit made for it is removed with its tests and rules', async () => {
  const { userId, sourceId } = await fixture();
  const before = await prisma.vehicleVisit.count();

  const visitId = await createVisitForSubmit(userId, sourceId);
  const row = await prisma.vehicleVisit.findUniqueOrThrow({ where: { id: visitId } });
  assert.equal(row.current_status, 'DRAFT_DISPATCH');
  assert.ok(isDraftVisitNumber(row.visit_number), 'it carries a private id, not a visit number');
  assert.equal(await prisma.dispatchQuantityPolicySnapshot.count({ where: { visit_id: visitId } }), 1);

  await discardUnsentVisit(visitId);
  assert.equal(await prisma.vehicleVisit.findUnique({ where: { id: visitId } }), null);
  assert.equal(await prisma.labTestAssignment.count({ where: { visit_id: visitId } }), 0);
  assert.equal(await prisma.dispatchQuantityPolicySnapshot.count({ where: { visit_id: visitId } }), 0);
  assert.equal(await prisma.vehicleVisit.count(), before, 'the visit table is exactly as it was');
});

test('a visit that was really sent is never removed', async () => {
  const { userId, sourceId } = await fixture();
  const visitId = await createVisitForSubmit(userId, sourceId);
  try {
    // Stand-in for a successful submit: the row is no longer an unsent form.
    await prisma.vehicleVisit.update({ where: { id: visitId }, data: { current_status: 'DISPATCHED' } });
    await discardUnsentVisit(visitId);
    assert.ok(await prisma.vehicleVisit.findUnique({ where: { id: visitId } }), 'still there');
  } finally {
    // This test's own row.
    await prisma.vehicleVisit.delete({ where: { id: visitId } });
  }
});

test.after(async () => {
  await prisma.$disconnect();
});
