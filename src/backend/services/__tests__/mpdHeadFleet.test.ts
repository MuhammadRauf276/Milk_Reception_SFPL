import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '@/backend/core/db';
import { resolveMotAuth, transferMotVehicle } from '@/backend/services/motService';
import type { Role, User } from '@/backend/core/types';

async function userWithRole(role: string): Promise<User | null> {
  const u = await prisma.user.findFirst({ where: { role, is_active: true } });
  return u ? { id: u.id.toString(), username: u.username, name: u.full_name || u.username, role: u.role as Role, department: u.department || '', scope_type: u.scope_type } : null;
}

test('the MPD Head may see the fleet, add and change vehicles, and move them between ZMCCs', async () => {
  const head = await userWithRole('HEAD_OF_MPD');
  if (!head) return;
  for (const action of ['READ_FLEET', 'WRITE_VEHICLE', 'TRANSFER_VEHICLE'] as const) {
    const { auth, errorResponse } = await resolveMotAuth(head, action, { requestedAs: null });
    assert.equal(errorResponse, undefined, `${action}: ${errorResponse?.error}`);
    assert.equal(auth?.isSystemScope, true);
  }
  // Past the role check, a missing vehicle answers 404 (not 403).
  const { auth } = await resolveMotAuth(head, 'TRANSFER_VEHICLE', { requestedAs: null });
  const res = await transferMotVehicle(auth!, '999999999', '1');
  assert.notEqual(res.status, 403);
});

test('a Zonal Manager still cannot manage the fleet', async () => {
  const manager = await userWithRole('ZMCC_MANAGER');
  if (!manager) return;
  for (const action of ['READ_FLEET', 'WRITE_VEHICLE', 'TRANSFER_VEHICLE'] as const) {
    const { errorResponse } = await resolveMotAuth(manager, action, { requestedAs: null });
    assert.equal(errorResponse?.status, 403, action);
  }
});

test.after(async () => {
  await prisma.$disconnect();
});
