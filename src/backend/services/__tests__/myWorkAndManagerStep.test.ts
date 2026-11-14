import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '@/backend/core/db';
import { clampWorkDays, listMyWork, MY_WORK_MAX_DAYS } from '@/backend/services/myWorkService';
import { correctionStatusLabel, managerRoleFor } from '@/backend/services/correctionGovernanceService';
import { requestableEntities, REQUESTING_ROLES } from '@/lib/recordEditor';

test('previous work never goes further back than 15 days', () => {
  assert.equal(MY_WORK_MAX_DAYS, 15);
  assert.equal(clampWorkDays(400), 15);
  assert.equal(clampWorkDays(15), 15);
  assert.equal(clampWorkDays(7), 7);
  assert.equal(clampWorkDays(1), 1);
  assert.equal(clampWorkDays(0), 15);
  assert.equal(clampWorkDays(-3), 15);
  assert.equal(clampWorkDays(undefined), 15);
  assert.equal(clampWorkDays(Number.NaN), 15);
});

test('a correction request goes to the role directly above, unless that is the Data Executive', () => {
  assert.equal(managerRoleFor('MOT'), 'ZMCC_MANAGER');
  assert.equal(managerRoleFor('PHE_OPERATOR'), 'ZMCC_MANAGER');
  assert.equal(managerRoleFor('ZMCC_LAB_ATTENDANT'), 'ZMCC_MANAGER');
  assert.equal(managerRoleFor('CONTRACTOR_OPERATOR'), 'CONTRACTOR_MANAGER');
  assert.equal(managerRoleFor('SECURITY_OPERATOR'), 'ADMIN_HEAD');
  assert.equal(managerRoleFor('WEIGHBRIDGE_OPERATOR'), 'PRODUCTION_HEAD');
  assert.equal(managerRoleFor('PRODUCTION_RECEPTION_OPERATOR'), 'PRODUCTION_HEAD');
  assert.equal(managerRoleFor('QA_LAB_ATTENDANT'), 'QA_HEAD');
  assert.equal(managerRoleFor('ZMCC_MANAGER'), 'HEAD_OF_MPD');
  // The role above these is the Data Executive, who resolves tickets anyway: no manager step.
  assert.equal(managerRoleFor('QA_HEAD'), null);
  assert.equal(managerRoleFor('HEAD_OF_MPD'), null);
  assert.equal(managerRoleFor('PRODUCTION_HEAD'), null);
  assert.equal(managerRoleFor(null), null);
  assert.equal(correctionStatusLabel('MANAGER_PENDING'), 'With manager');
  assert.equal(correctionStatusLabel('REQUESTED'), 'Open');
});

// Read-only: each role takes its own branch of the list query, so each is run once.
for (const role of REQUESTING_ROLES) {
  test(`previous work list runs for ${role}`, async () => {
    const user = await prisma.user.findFirst({ where: { role: role as never, is_active: true } });
    const result = await listMyWork({
      userId: user?.id ?? BigInt(0),
      role,
      entities: requestableEntities(role),
      sourceId: user?.procurement_source_id ?? undefined,
      days: 400,
      search: undefined,
      page: 1,
      pageSize: 5,
    });
    assert.equal(result.days, 15);
    assert.ok(result.rows.length <= 5);
    const oldest = Date.now() - 15 * 24 * 60 * 60 * 1000 - 60_000;
    for (const row of result.rows) assert.ok(new Date(row.at).getTime() >= oldest, `${row.key} is older than 15 days`);
  });
}

test.after(async () => {
  await prisma.$disconnect();
});
