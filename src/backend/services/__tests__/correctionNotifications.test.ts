import assert from 'node:assert/strict';
import test from 'node:test';
import { prisma } from '@/backend/core/db';
import type { User } from '@/backend/core/types';
import { createCorrectionRequest, managerDecideCorrectionRequest } from '@/backend/services/correctionGovernanceService';

test('a correction request with a manager step rings the manager bell and clears it on reject', async () => {
  const requester = await prisma.user.findFirst({ where: { is_active: true, role: 'PHE_OPERATOR' } });
  const manager = await prisma.user.findFirst({ where: { is_active: true, role: 'ZMCC_MANAGER' } });
  if (!requester || !manager) {
    console.warn('Skipped: no active PHE_OPERATOR and ZMCC_MANAGER user in the database.');
    return;
  }

  let ticketId: bigint | null = null;
  try {
    const ticket = await createCorrectionRequest({
      userId: requester.id,
      actorRole: 'PHE_OPERATOR',
      module: 'ZMCC_LAB_SESSION',
      recordId: '0',
      reason: 'TEST ONLY',
      requestedChanges: { remarks: 'TEST ONLY' },
    });
    ticketId = ticket.id;
    assert.equal(ticket.status, 'MANAGER_PENDING');

    const waiting = await prisma.notification.findMany({
      where: { event_key: 'CORRECTION_WITH_ZMCC_MANAGER', source_id: ticketId.toString() },
    });
    assert.ok(waiting.some((n) => n.recipient_user_id === manager.id), 'manager should have a bell item');
    assert.ok(waiting.every((n) => n.read_at === null));
    assert.equal(waiting[0].deep_link, '/request-correction?tab=requests');

    await managerDecideCorrectionRequest(
      ticketId,
      { id: manager.id.toString(), role: manager.role, username: manager.username, name: manager.full_name } as unknown as User,
      'REJECT',
      'TEST ONLY'
    );

    const after = await prisma.notification.findMany({
      where: { event_key: 'CORRECTION_WITH_ZMCC_MANAGER', source_id: ticketId.toString() },
    });
    assert.ok(after.length > 0 && after.every((n) => n.read_at !== null), 'bell item should be cleared');
  } finally {
    if (ticketId !== null) {
      await prisma.notification.deleteMany({ where: { source_type: 'CORRECTION_REQUEST', source_id: ticketId.toString() } });
      await prisma.auditLog.deleteMany({ where: { table_name: 'correction_request', record_id: ticketId } });
      await prisma.correctionRequest.delete({ where: { id: ticketId } });
    }
    await prisma.$disconnect();
  }
});
