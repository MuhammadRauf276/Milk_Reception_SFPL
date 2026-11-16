import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '@/backend/core/db';
import { createSessionToken } from '@/backend/core/auth';
import type { Role, User } from '@/backend/core/types';
import { resolveWorkListOwner } from '@/backend/services/myWorkOwner';

async function tokenFor(where: { role?: string; username?: string }) {
  const u = await prisma.user.findFirstOrThrow({ where: { ...where, is_active: true } });
  const user: User = {
    id: u.id.toString(),
    username: u.username,
    name: u.username,
    role: u.role as Role,
    department: u.department ?? '',
    scope_type: (u.scope_type ?? 'SYSTEM') as never,
    procurement_source_id: u.procurement_source_id ? u.procurement_source_id.toString() : null,
  };
  return { id: u.id, token: await createSessionToken(user) };
}

const req = (token: string, headers: Record<string, string> = {}) =>
  new Request('http://localhost/api/my-work', { headers: { authorization: `Bearer ${token}`, ...headers } });

test('an operator gets their own work list, for their own stages', async () => {
  const { id, token } = await tokenFor({ role: 'SECURITY_OPERATOR' });
  const owner = await resolveWorkListOwner(req(token));
  assert.ok(!('response' in owner));
  assert.equal(owner.role, 'SECURITY_OPERATOR');
  assert.equal(owner.userId, id);
  assert.deepEqual([...owner.entities], ['PLANT_RECEPTION']);
});

test('a Super Admin has no work list of their own, but gets the covered role while covering', async () => {
  const { id, token } = await tokenFor({ role: 'SUPER_ADMIN' });
  const own = await resolveWorkListOwner(req(token));
  assert.ok('response' in own && own.response.status === 403, 'refused without covering');
  const covering = await resolveWorkListOwner(req(token, { 'x-acting-as': 'MOT' }));
  assert.ok(!('response' in covering));
  assert.equal(covering.role, 'MOT');
  assert.equal(covering.userId, id, 'still the records this person entered');
});

test('an operator cannot open another role by sending the covering header', async () => {
  const { token } = await tokenFor({ role: 'MOT' });
  const owner = await resolveWorkListOwner(req(token, { 'x-acting-as': 'QA_HEAD' }));
  assert.ok('response' in owner && owner.response.status === 403);
});

test.after(async () => {
  await prisma.$disconnect();
});
