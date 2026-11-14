import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '@/backend/core/db';
import { getMySubmittedRequests } from '@/backend/services/approvals/submitterRequestService';

// Read-only. Every role takes a different branch of the query; a wrong relation name in one branch
// only fails at run time, so each branch is run once here.
const ROLES = ['HEAD_OF_MPD', 'ZMCC_MANAGER', 'CONTRACTOR_MANAGER', 'MOT', 'QA_LAB_ATTENDANT', 'QA_HEAD', 'SUPER_ADMIN'];

for (const role of ROLES) {
  test(`my submitted requests load for ${role}`, async () => {
    const user = await prisma.user.findFirst({ where: { role: role as never, is_active: true } });
    const userId = user?.id ?? BigInt(0);
    const items = await getMySubmittedRequests(userId, user?.procurement_source_id ?? undefined, role);
    assert.ok(Array.isArray(items));
  });
}

test.after(async () => {
  await prisma.$disconnect();
});
