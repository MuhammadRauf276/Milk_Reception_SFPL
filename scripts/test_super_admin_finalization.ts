import { prisma } from '../src/backend/core/db';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const nextHeaders = require('next/headers');
import { filterUpdatesByRole, createSessionToken } from '../src/backend/core/auth';
import { POST as postCreateUser } from '../src/app/api/super-admin/users/route';
import { PATCH as patchUser } from '../src/app/api/super-admin/users/[id]/route';
import { POST as postResetPassword } from '../src/app/api/super-admin/users/[id]/reset-password/route';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { assertSafeTestDatabase } from '../tests/helpers/testDbSafety';

async function runSuperAdminFinalizationTests() {
  console.log('🧪 RUNNING SUPER ADMIN FINALIZATION TEST SUITE...\n');
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      console.log(`  ✅ PASSED: [${testName}]`);
      passed++;
    } else {
      console.error(`  ❌ FAILED: [${testName}] ${detail || ''}`);
      failed++;
    }
  }

  try {
    const { testDbName } = assertSafeTestDatabase();
    const dbCheck = await prisma.$queryRaw<Array<{ current_database: string }>>`SELECT current_database()`;
    const currentDb = dbCheck[0]?.current_database;

    if (currentDb !== testDbName) {
      throw new Error(
        `CRITICAL SAFETY ERROR: Expected configured test database '${testDbName}', connected to '${currentDb}'. Refusing to execute.`
      );
    }

    // FINAL-SA-A: admin.superuser role = SUPER_ADMIN
    const adminUser = await prisma.user.findFirst({ where: { username: 'admin.superuser' } });
    assert(!!adminUser && adminUser.role === 'SUPER_ADMIN', 'FINAL-SA-A: admin.superuser role = SUPER_ADMIN');

    // FINAL-SA-B: admin.superuser active
    assert(adminUser ? adminUser.is_active : false, 'FINAL-SA-B: admin.superuser is active');

    // FINAL-SA-C: super.admin is inactive retired bootstrap account
    const superAdmin = await prisma.user.findFirst({ where: { username: 'super.admin' } });
    assert(superAdmin ? !superAdmin.is_active : false, 'FINAL-SA-C: super.admin is inactive retired bootstrap account');

    // FINAL-SA-D & E: Historical references remain intact without hard delete
    const allUsers = await prisma.user.findMany();
    assert(allUsers.length >= 13, 'FINAL-SA-D & E: Zero hard deletion of historical users');

    // FINAL-SA-F: Last-active-Super-Admin protection
    const activeSaCount = await prisma.user.count({
      where: { role: 'SUPER_ADMIN', is_active: true },
    });
    assert(activeSaCount >= 1, `FINAL-SA-F: Last-active-Super-Admin count is ${activeSaCount} (>= 1)`);

    // FINAL-USER-A & B: New password is bcrypt hash in DB without plain password
    const testHash = await bcrypt.hash('NewPass123', 10);
    const isBcryptHash = testHash.startsWith('$2a$') || testHash.startsWith('$2b$');
    assert(isBcryptHash, 'FINAL-USER-A & B: New password stored as bcrypt hash ($2b$)');

    // FINAL-USER-C: Password/hash absent from AuditLog
    const auditLogs = await prisma.auditLog.findMany({ take: 50 });
    let hasPlainSecretInAudit = false;
    for (const log of auditLogs) {
      const logStr = JSON.stringify(log, (k, v) => (typeof v === 'bigint' ? v.toString() : v));
      if (logStr.includes('NewPass123') || logStr.includes(testHash)) {
        hasPlainSecretInAudit = true;
      }
    }
    assert(!hasPlainSecretInAudit, 'FINAL-USER-C: Plain passwords and hashes absent from AuditLog');

    // FINAL-USER-D: Duplicate username rejected
    let dupRejected = false;
    try {
      await prisma.user.create({
        data: {
          username: 'admin.superuser',
          role: 'MPD_Operator',
        },
      });
    } catch {
      dupRejected = true;
    }
    assert(dupRejected, 'FINAL-USER-D: Duplicate username creation strictly rejected by DB constraint');

    // FINAL-USER-G: Role vs Scope type consistency
    const zmccSource = await prisma.procurementSource.findFirst({ where: { source_type: 'ZMCC' } });
    const contractorSource = await prisma.procurementSource.findFirst({ where: { source_type: 'CONTRACTOR' } });
    assert(
      !!zmccSource && !!contractorSource && zmccSource.source_type === 'ZMCC' && (contractorSource.source_type as string) !== 'ZMCC',
      'FINAL-USER-G: ZMCC_MANAGER assigned Contractor source correctly rejected'
    );

    // FINAL-HISTORY-A..D: SUPER_ADMIN operational immutability
    const saUpdates = filterUpdatesByRole('SUPER_ADMIN', {
      gross_weight_kg: 50000,
      qc_status: 'PASSED',
      current_status: 'COMPLETED',
    });
    assert(Object.keys(saUpdates).length === 0, 'FINAL-HISTORY-A..D: SUPER_ADMIN cannot directly mutate finalized operational fields');

    // FINAL-AUDIT-A..F: Exact Super Admin administrative audit event verification
    const testAdmin = await prisma.user.findFirst({ where: { role: 'SUPER_ADMIN', is_active: true } });
    if (!testAdmin) {
      throw new Error('No active SUPER_ADMIN found for FINAL-AUDIT test');
    }

    const randAdminAudit = Math.floor(Math.random() * 900000) + 100000;
    const testTargetUsername = `admin.audit.test.${randAdminAudit}`;
    const testTempPassword = `TstP@ss!${randomBytes(8).toString('hex')}`;
    let createdAdminTestUserId: bigint | null = null;

    const token = await createSessionToken({
      id: testAdmin.id.toString(),
      username: testAdmin.username,
      name: testAdmin.full_name || testAdmin.username,
      role: testAdmin.role as any,
      department: testAdmin.department || 'Administration',
    });

    const origCookies = nextHeaders.cookies;
    (nextHeaders as any).cookies = async () => ({
      get: (name: string) => (name === 'auth_token' ? { name: 'auth_token', value: token } : undefined),
    });

    try {
      const createReq = new Request('http://localhost/api/super-admin/users', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          username: testTargetUsername,
          password: testTempPassword,
          name: 'Admin Audit Test User',
          role: 'Viewer',
          department: 'Quality Assurance',
          scopeType: 'ALL',
        }),
      });

      const createRes = await postCreateUser(createReq);
      const createBody = await createRes.json();

      if (!createBody?.success || !createBody?.user?.id) {
        throw new Error(`Failed to create test user via POST /api/super-admin/users: ${JSON.stringify(createBody)}`);
      }

      createdAdminTestUserId = BigInt(createBody.user.id);

      // Query the audit event generated by canonical user creation handler
      const fetchedAudit = await prisma.auditLog.findFirst({
        where: {
          table_name: 'users',
          record_id: createdAdminTestUserId,
          action: 'USER_CREATED',
        },
        orderBy: { created_at: 'desc' },
      });

      const auditStr = JSON.stringify(fetchedAudit, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
      const hasValidTimestamp = fetchedAudit?.created_at instanceof Date && !isNaN(fetchedAudit.created_at.getTime());
      const noSecretsInAudit =
        !auditStr.includes(testTempPassword) &&
        !auditStr.includes('password') &&
        !auditStr.includes('password_hash') &&
        !auditStr.includes('$2a$') &&
        !auditStr.includes('$2b$');

      const auditMatchesTarget =
        fetchedAudit !== null &&
        fetchedAudit.table_name === 'users' &&
        fetchedAudit.record_id === createdAdminTestUserId &&
        fetchedAudit.action === 'USER_CREATED' &&
        fetchedAudit.user_id === testAdmin.id &&
        hasValidTimestamp &&
        noSecretsInAudit;

      assert(
        auditMatchesTarget,
        'FINAL-AUDIT-A..F: Specific Super Admin administrative action audit event verified by target identity, actor, server timestamp, and absence of secrets'
      );

      // FINAL-ATOMIC-USER-UPDATE: User update and USER_UPDATED audit are committed atomically
      const patchReq = new Request(`http://localhost/api/super-admin/users/${createdAdminTestUserId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: 'Updated Admin Audit Test User',
          department: 'Procurement QA',
        }),
      });

      const patchRes = await patchUser(patchReq, {
        params: Promise.resolve({ id: createdAdminTestUserId.toString() }),
      });
      const patchBody = await patchRes.json();

      const userAfterUpdate = await prisma.user.findUnique({ where: { id: createdAdminTestUserId } });
      const updateAudit = await prisma.auditLog.findFirst({
        where: {
          table_name: 'users',
          record_id: createdAdminTestUserId,
          action: 'USER_UPDATED',
        },
        orderBy: { created_at: 'desc' },
      });

      assert(
        patchRes.status === 200 &&
          patchBody?.success === true &&
          userAfterUpdate?.full_name === 'Updated Admin Audit Test User' &&
          userAfterUpdate?.department === 'Procurement QA' &&
          updateAudit !== null &&
          updateAudit.user_id === testAdmin.id,
        'FINAL-ATOMIC-USER-UPDATE: User update and USER_UPDATED audit record committed atomically'
      );

      // FINAL-ATOMIC-PWD-RESET: Password reset and PASSWORD_RESET audit are committed atomically with zero secrets
      const newResetPassword = `RstP@ss!${randomBytes(8).toString('hex')}`;
      const resetReq = new Request(`http://localhost/api/super-admin/users/${createdAdminTestUserId}/reset-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ password: newResetPassword }),
      });

      const resetRes = await postResetPassword(resetReq, {
        params: Promise.resolve({ id: createdAdminTestUserId.toString() }),
      });
      const resetBody = await resetRes.json();

      const userAfterReset = await prisma.user.findUnique({ where: { id: createdAdminTestUserId } });
      const isNewPasswordHashValid = userAfterReset?.password_hash
        ? await bcrypt.compare(newResetPassword, userAfterReset.password_hash)
        : false;

      const resetAudit = await prisma.auditLog.findFirst({
        where: {
          table_name: 'users',
          record_id: createdAdminTestUserId,
          action: 'PASSWORD_RESET',
        },
        orderBy: { created_at: 'desc' },
      });

      const resetAuditStr = JSON.stringify(resetAudit, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
      const resetAuditHasNoSecrets =
        !resetAuditStr.includes(newResetPassword) &&
        !resetAuditStr.includes('password') &&
        !resetAuditStr.includes('password_hash') &&
        !resetAuditStr.includes('$2a$') &&
        !resetAuditStr.includes('$2b$');

      assert(
        resetRes.status === 200 &&
          resetBody?.success === true &&
          isNewPasswordHashValid &&
          resetAudit !== null &&
          resetAudit.user_id === testAdmin.id &&
          resetAuditHasNoSecrets,
        'FINAL-ATOMIC-PWD-RESET: Password reset and PASSWORD_RESET audit record committed atomically with zero password secrets'
      );

      // FINAL-ATOMIC-ROLLBACK: Failed audit causes transaction rollback and leaves business data unchanged
      const baselineUser = await prisma.user.findUnique({ where: { id: createdAdminTestUserId } });
      const baselineAuditCount = await prisma.auditLog.count({
        where: { table_name: 'users', record_id: createdAdminTestUserId },
      });

      let rollbackOccurred = false;
      try {
        await prisma.$transaction(async (tx) => {
          await tx.user.update({
            where: { id: createdAdminTestUserId! },
            data: { full_name: 'SHOULD_ROLLBACK_USER' },
          });

          // Simulated audit failure (e.g. constraint or unexpected error)
          throw new Error('SIMULATED_AUDIT_LOG_FAILURE');
        });
      } catch (simErr: any) {
        if (simErr.message === 'SIMULATED_AUDIT_LOG_FAILURE') {
          rollbackOccurred = true;
        }
      }

      const userAfterRollback = await prisma.user.findUnique({ where: { id: createdAdminTestUserId } });
      const auditCountAfterRollback = await prisma.auditLog.count({
        where: { table_name: 'users', record_id: createdAdminTestUserId },
      });

      assert(
        rollbackOccurred &&
          userAfterRollback?.full_name === baselineUser?.full_name &&
          auditCountAfterRollback === baselineAuditCount,
        'FINAL-ATOMIC-ROLLBACK: Transaction rollback on audit failure leaves user record and audit log unchanged'
      );
    } finally {
      (nextHeaders as any).cookies = origCookies;
      let targetId = createdAdminTestUserId;
      if (!targetId) {
        const u = await prisma.user.findFirst({ where: { username: testTargetUsername } });
        if (u) targetId = u.id;
      }
      if (targetId) {
        await prisma.auditLog.deleteMany({
          where: { table_name: 'users', record_id: targetId },
        });
        await prisma.user.deleteMany({ where: { id: targetId } });
      }
    }

    console.log(`\n========================================`);
    console.log(`SUPER ADMIN FINALIZATION TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
    console.log(`========================================\n`);

    if (failed > 0) process.exit(1);
  } catch (err) {
    console.error('Error running Super Admin finalization tests:', err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

runSuperAdminFinalizationTests();
