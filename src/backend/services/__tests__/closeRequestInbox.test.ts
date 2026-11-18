import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '@/backend/core/db';
import { getApprovalInbox } from '@/backend/services/approvals/approvalInboxService';

test('a waiting "leave without unloading" request is in the Zonal Manager Approval Inbox, decidable only for their own ZMCC', async (t) => {
  const waiting = await prisma.zmccLabSession.findFirst({
    where: { close_requested_at: { not: null }, close_approved_at: null, journey_closed_at: null },
    select: { id: true, zmcc_id: true, close_requested_by_user_id: true },
  });
  if (!waiting) return t.skip('needs a waiting close request');

  const manager = await prisma.user.findFirst({
    where: { role: 'ZMCC_MANAGER', is_active: true, procurement_source_id: waiting.zmcc_id, NOT: { id: waiting.close_requested_by_user_id ?? undefined } },
  });
  if (!manager) return t.skip('needs a Zonal Manager for that ZMCC');

  const inbox = await getApprovalInbox({ id: manager.id, role: 'ZMCC_MANAGER', procurementSourceId: manager.procurement_source_id });
  const item = inbox.items.find((i) => i.id === `close_${waiting.id}`);
  assert.ok(item, 'listed in the inbox');
  assert.equal(item.approvalType, 'STAGE_2_CLOSE_REQUEST');
  assert.equal(item.canDecide, true, item.disabledReason ?? '');

  const other = await prisma.user.findFirst({
    where: { role: 'ZMCC_MANAGER', is_active: true, procurement_source_id: { not: waiting.zmcc_id } },
  });
  if (other) {
    const theirs = await getApprovalInbox({ id: other.id, role: 'ZMCC_MANAGER', procurementSourceId: other.procurement_source_id });
    assert.equal(theirs.items.some((i) => i.id === `close_${waiting.id}`), false, 'not shown to another ZMCC');
  }
});

test.after(async () => {
  await prisma.$disconnect();
});
