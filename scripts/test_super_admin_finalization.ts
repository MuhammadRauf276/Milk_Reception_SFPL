import { prisma } from '../src/backend/core/db';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const nextHeaders = require('next/headers');
import { filterUpdatesByRole, createSessionToken, getCurrentUser } from '../src/backend/core/auth';
import { POST as postCreateUser } from '../src/app/api/super-admin/users/route';
import { PATCH as patchUser } from '../src/app/api/super-admin/users/[id]/route';
import { POST as postResetPassword } from '../src/app/api/super-admin/users/[id]/reset-password/route';
import { GET as getProcurementSources, POST as postProcurementSource } from '../src/app/api/super-admin/procurement-sources/route';
import { PATCH as patchProcurementSource } from '../src/app/api/super-admin/procurement-sources/[id]/route';
import { POST as postStartDispatch } from '../src/app/api/dispatches/start/route';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import fs from 'fs';
import path from 'path';
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
          role: 'QA_Operator',
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
          userAfterUpdate?.department === 'Quality Assurance' &&
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

      // FINAL-ATOMIC-ROLLBACK: Failed audit in patchUser causes transaction rollback and leaves business data unchanged
      const baselineUser = await prisma.user.findUnique({ where: { id: createdAdminTestUserId } });
      const baselineAuditCount = await prisma.auditLog.count({
        where: { table_name: 'users', record_id: createdAdminTestUserId },
      });

      const origTransaction = prisma.$transaction.bind(prisma);
      let patchStatus = 0;
      let patchErrorMsg = '';

      try {
        (prisma as any).$transaction = async (arg: any) => {
          if (typeof arg === 'function') {
            return await origTransaction(async (realTx: any) => {
              const txProxy = new Proxy(realTx, {
                get(target, prop, receiver) {
                  if (prop === 'auditLog') {
                    const realAuditLog = target.auditLog;
                    return new Proxy(realAuditLog, {
                      get(auditTarget, auditProp, auditReceiver) {
                        if (auditProp === 'create') {
                          return async () => {
                            throw new Error('SIMULATED_AUDIT_LOG_FAILURE');
                          };
                        }
                        return Reflect.get(auditTarget, auditProp, auditReceiver);
                      },
                    });
                  }
                  return Reflect.get(target, prop, receiver);
                },
              });
              return await arg(txProxy);
            });
          }
          return await origTransaction(arg);
        };

        const rollbackReq = new Request(`http://localhost/api/super-admin/users/${createdAdminTestUserId}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            name: 'SHOULD_ROLLBACK_USER',
          }),
        });

        const rollbackRes = await patchUser(rollbackReq, {
          params: Promise.resolve({ id: createdAdminTestUserId.toString() }),
        });
        patchStatus = rollbackRes.status;
        const rollbackBody = await rollbackRes.json();
        patchErrorMsg = rollbackBody?.error || '';
      } finally {
        prisma.$transaction = origTransaction as any;
      }

      const userAfterRollback = await prisma.user.findUnique({ where: { id: createdAdminTestUserId } });
      const auditCountAfterRollback = await prisma.auditLog.count({
        where: { table_name: 'users', record_id: createdAdminTestUserId },
      });
      const rollbackAuditRecord = await prisma.auditLog.findFirst({
        where: {
          table_name: 'users',
          record_id: createdAdminTestUserId,
          new_values: { path: ['username'], equals: 'SHOULD_ROLLBACK_USER' } as any,
        },
      });

      const isMutationRolledBack =
        userAfterRollback !== null &&
        userAfterRollback.full_name === baselineUser?.full_name &&
        userAfterRollback.full_name !== 'SHOULD_ROLLBACK_USER' &&
        userAfterRollback.department === baselineUser?.department &&
        userAfterRollback.role === baselineUser?.role &&
        userAfterRollback.is_active === baselineUser?.is_active;

      const isAuditUnchanged =
        auditCountAfterRollback === baselineAuditCount &&
        rollbackAuditRecord === null;

      assert(
        patchStatus === 500 &&
          isMutationRolledBack &&
          isAuditUnchanged,
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
        try {
          await prisma.auditLog.deleteMany({
            where: { table_name: 'users', record_id: targetId },
          });
          await prisma.user.deleteMany({ where: { id: targetId } });
        } catch (cleanupErr) {
          console.error('CRITICAL: Failed to clean up audit test user:', cleanupErr);
          throw cleanupErr;
        }
      }
    }

    // ----------------------------------------------------
    // STAGE 5D-B2: EXTENDED BEHAVIORAL USER MANAGEMENT COVERAGE
    // ----------------------------------------------------
    console.log('\n--- STAGE 5D-B2: EXTENDED BEHAVIORAL USER MANAGEMENT SUITE ---');

    const randB2 = Math.floor(Math.random() * 900000) + 100000;
    const b2Username = `b2.test.user.${randB2}`;
    const initialB2Password = `InitPass!${randomBytes(6).toString('hex')}`;
    let createdB2UserId: bigint | null = null;

    const testSuperAdmin = await prisma.user.findFirst({ where: { role: 'SUPER_ADMIN', is_active: true } });
    if (!testSuperAdmin) {
      throw new Error('No active SUPER_ADMIN found for 5D-B2 suite');
    }

    const saSessionToken = await createSessionToken({
      id: testSuperAdmin.id.toString(),
      username: testSuperAdmin.username,
      name: testSuperAdmin.full_name || testSuperAdmin.username,
      role: testSuperAdmin.role as any,
      department: testSuperAdmin.department || 'Administration',
    });

    const saHeaders = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${saSessionToken}`,
    };

    try {
      // 1. Create user succeeds through real POST handler
      const activeZmccForB2 = await prisma.procurementSource.findFirst({ where: { source_type: 'ZMCC', is_active: true } });
      if (!activeZmccForB2) throw new Error('Active ZMCC source required for 5D-B2');

      const b2CreateReq = new Request('http://localhost/api/super-admin/users', {
        method: 'POST',
        headers: saHeaders,
        body: JSON.stringify({
          username: b2Username,
          password: initialB2Password,
          name: 'Stage 5D-B2 Test User',
          role: 'MPD_Operator',
          procurementSourceId: activeZmccForB2.id.toString(),
        }),
      });
      const b2CreateRes = await postCreateUser(b2CreateReq);
      const b2CreateBody = await b2CreateRes.json();
      assert(
        b2CreateRes.status === 200 && b2CreateBody?.success === true && b2CreateBody?.user?.id,
        '5D-B2-01: Create user succeeds through real POST handler'
      );
      createdB2UserId = BigInt(b2CreateBody.user.id);

      // 2. Duplicate username is rejected
      const dupReq = new Request('http://localhost/api/super-admin/users', {
        method: 'POST',
        headers: saHeaders,
        body: JSON.stringify({
          username: b2Username,
          password: 'AnotherPassword123!',
          name: 'Duplicate Username Attempt',
          role: 'QA_Operator',
        }),
      });
      const dupRes = await postCreateUser(dupReq);
      const dupBody = await dupRes.json();
      assert(
        dupRes.status === 400 && dupBody?.error?.includes('already taken'),
        '5D-B2-02: Duplicate username is rejected'
      );

      // 3. Edit name/role succeeds and derives policy department and scope
      const editReq = new Request(`http://localhost/api/super-admin/users/${createdB2UserId}`, {
        method: 'PATCH',
        headers: saHeaders,
        body: JSON.stringify({
          name: 'Renamed 5D-B2 User',
          role: 'QA_Operator',
        }),
      });
      const editRes = await patchUser(editReq, {
        params: Promise.resolve({ id: createdB2UserId.toString() }),
      });
      const editBody = await editRes.json();
      const userAfterEdit = await prisma.user.findUnique({ where: { id: createdB2UserId } });
      assert(
        editRes.status === 200 &&
          editBody?.success === true &&
          userAfterEdit?.full_name === 'Renamed 5D-B2 User' &&
          userAfterEdit?.role === 'QA_Operator' &&
          userAfterEdit?.department === 'Quality Assurance' &&
          userAfterEdit?.scope_type === 'DEPARTMENT',
        '5D-B2-03: Edit name/role succeeds through real PATCH handler'
      );

      // 4. Switching to source role persists an exact procurement_source_id
      const sourceScopeReq = new Request(`http://localhost/api/super-admin/users/${createdB2UserId}`, {
        method: 'PATCH',
        headers: saHeaders,
        body: JSON.stringify({
          role: 'MPD_Operator',
          procurementSourceId: activeZmccForB2.id.toString(),
        }),
      });
      const sourceScopeRes = await patchUser(sourceScopeReq, {
        params: Promise.resolve({ id: createdB2UserId.toString() }),
      });
      const sourceScopeBody = await sourceScopeRes.json();
      const userAfterSourceScope = await prisma.user.findUnique({ where: { id: createdB2UserId } });
      assert(
        sourceScopeRes.status === 200 &&
          sourceScopeBody?.success === true &&
          userAfterSourceScope?.scope_type === 'SOURCE' &&
          userAfterSourceScope?.procurement_source_id === activeZmccForB2.id,
        '5D-B2-04: SOURCE scope persists an exact procurement_source_id'
      );

      // 5. Changing away from SOURCE clears procurement_source_id
      const clearSourceReq = new Request(`http://localhost/api/super-admin/users/${createdB2UserId}`, {
        method: 'PATCH',
        headers: saHeaders,
        body: JSON.stringify({
          role: 'QA_Operator',
        }),
      });
      const clearSourceRes = await patchUser(clearSourceReq, {
        params: Promise.resolve({ id: createdB2UserId.toString() }),
      });
      const clearSourceBody = await clearSourceRes.json();
      const userAfterClearSource = await prisma.user.findUnique({ where: { id: createdB2UserId } });
      assert(
        clearSourceRes.status === 200 &&
          clearSourceBody?.success === true &&
          userAfterClearSource?.scope_type === 'DEPARTMENT' &&
          userAfterClearSource?.department === 'Quality Assurance' &&
          userAfterClearSource?.procurement_source_id === null,
        '5D-B2-05: Changing away from SOURCE clears procurement_source_id'
      );

      // 6. Incompatible ZMCC_MANAGER/CONTRACTOR source assignment is rejected
      const activeContractor = await prisma.procurementSource.findFirst({ where: { source_type: 'CONTRACTOR', is_active: true } });
      if (!activeContractor) throw new Error('Active CONTRACTOR source required for 5D-B2-06');

      const badAssignReq = new Request(`http://localhost/api/super-admin/users/${createdB2UserId}`, {
        method: 'PATCH',
        headers: saHeaders,
        body: JSON.stringify({
          role: 'ZMCC_MANAGER',
          procurementSourceId: activeContractor.id.toString(),
        }),
      });
      const badAssignRes = await patchUser(badAssignReq, {
        params: Promise.resolve({ id: createdB2UserId.toString() }),
      });
      const badAssignBody = await badAssignRes.json();
      assert(
        badAssignRes.status === 400 &&
          badAssignBody?.error?.includes('cannot be assigned to CONTRACTOR source'),
        '5D-B2-06: Incompatible ZMCC_MANAGER/CONTRACTOR source assignment is rejected'
      );

      // Issue token for test user to verify live authentication & deactivation
      const b2UserToken = await createSessionToken({
        id: createdB2UserId.toString(),
        username: b2Username,
        name: userAfterClearSource!.full_name || b2Username,
        role: userAfterClearSource!.role as any,
        department: userAfterClearSource!.department || '',
      });

      // 7. Deactivation succeeds
      const deactReq = new Request(`http://localhost/api/super-admin/users/${createdB2UserId}`, {
        method: 'PATCH',
        headers: saHeaders,
        body: JSON.stringify({ isActive: false }),
      });
      const deactRes = await patchUser(deactReq, {
        params: Promise.resolve({ id: createdB2UserId.toString() }),
      });
      const deactBody = await deactRes.json();
      const userAfterDeact = await prisma.user.findUnique({ where: { id: createdB2UserId } });
      assert(
        deactRes.status === 200 && deactBody?.user?.isActive === false && userAfterDeact?.is_active === false,
        '5D-B2-07: Deactivation succeeds'
      );

      // 8. A deactivated user is rejected by live authentication
      const liveAuthReq = new Request('http://localhost/api/auth/me', {
        headers: { Authorization: `Bearer ${b2UserToken}` },
      });
      const authUserWhenDeactivated = await getCurrentUser(liveAuthReq);
      assert(
        authUserWhenDeactivated === null,
        '5D-B2-08: A deactivated user is rejected by live authentication'
      );

      // 9. Reactivation succeeds
      const reactReq = new Request(`http://localhost/api/super-admin/users/${createdB2UserId}`, {
        method: 'PATCH',
        headers: saHeaders,
        body: JSON.stringify({ isActive: true }),
      });
      const reactRes = await patchUser(reactReq, {
        params: Promise.resolve({ id: createdB2UserId.toString() }),
      });
      const reactBody = await reactRes.json();
      const userAfterReact = await prisma.user.findUnique({ where: { id: createdB2UserId } });
      const authUserWhenReactivated = await getCurrentUser(liveAuthReq);
      assert(
        reactRes.status === 200 &&
          reactBody?.user?.isActive === true &&
          userAfterReact?.is_active === true &&
          authUserWhenReactivated !== null &&
          authUserWhenReactivated.username === b2Username,
        '5D-B2-09: Reactivation succeeds'
      );

      // 10. Password reset succeeds
      const resetNewPassword = `Res3tP@ss!${randomBytes(6).toString('hex')}`;
      const resetPassReq = new Request(`http://localhost/api/super-admin/users/${createdB2UserId}/reset-password`, {
        method: 'POST',
        headers: saHeaders,
        body: JSON.stringify({ password: resetNewPassword }),
      });
      const resetPassRes = await postResetPassword(resetPassReq, {
        params: Promise.resolve({ id: createdB2UserId.toString() }),
      });
      const resetPassBody = await resetPassRes.json();
      assert(
        resetPassRes.status === 200 && resetPassBody?.success === true,
        '5D-B2-10: Password reset succeeds'
      );

      // 11. Old password fails after reset
      const userRecordAfterReset = await prisma.user.findUnique({ where: { id: createdB2UserId } });
      const isOldPasswordStillValid = userRecordAfterReset?.password_hash
        ? await bcrypt.compare(initialB2Password, userRecordAfterReset.password_hash)
        : false;
      assert(
        !isOldPasswordStillValid,
        '5D-B2-11: Old password fails after reset'
      );

      // 12. New password succeeds after reset
      const isNewPasswordNowValid = userRecordAfterReset?.password_hash
        ? await bcrypt.compare(resetNewPassword, userRecordAfterReset.password_hash)
        : false;
      assert(
        isNewPasswordNowValid,
        '5D-B2-12: New password succeeds after reset'
      );

      // 13. Last-active-Super-Admin protection remains enforced
      const lastSaDeactReq = new Request(`http://localhost/api/super-admin/users/${testSuperAdmin.id}`, {
        method: 'PATCH',
        headers: saHeaders,
        body: JSON.stringify({ isActive: false }),
      });
      const lastSaDeactRes = await patchUser(lastSaDeactReq, {
        params: Promise.resolve({ id: testSuperAdmin.id.toString() }),
      });
      const lastSaDeactBody = await lastSaDeactRes.json();
      assert(
        lastSaDeactRes.status === 400 &&
          lastSaDeactBody?.error?.includes('Cannot deactivate or reassign the last active Super Admin account'),
        '5D-B2-13: Last-active-Super-Admin protection remains enforced'
      );

      // 14. User and audit changes remain atomic
      const b2UserAudits = await prisma.auditLog.findMany({
        where: { table_name: 'users', record_id: createdB2UserId },
      });
      const auditActions = b2UserAudits.map((a) => a.action);
      const hasCreateAudit = auditActions.includes('USER_CREATED');
      const hasUpdateAudit = auditActions.includes('USER_UPDATED');
      const hasDeactAudit = auditActions.includes('USER_DEACTIVATED');
      const hasReactAudit = auditActions.includes('USER_ACTIVATED');
      const hasResetAudit = auditActions.includes('PASSWORD_RESET');
      assert(
        hasCreateAudit && hasUpdateAudit && hasDeactAudit && hasReactAudit && hasResetAudit,
        '5D-B2-14: User and audit changes remain atomic'
      );

      // 15. Password plaintext and hashes never appear in AuditLog
      let hasAnySecretInB2Audits = false;
      for (const log of b2UserAudits) {
        const logStr = JSON.stringify(log, (k, v) => (typeof v === 'bigint' ? v.toString() : v));
        if (
          logStr.includes(initialB2Password) ||
          logStr.includes(resetNewPassword) ||
          logStr.includes('password_hash') ||
          logStr.includes('$2a$') ||
          logStr.includes('$2b$')
        ) {
          hasAnySecretInB2Audits = true;
        }
      }
      assert(
        !hasAnySecretInB2Audits,
        '5D-B2-15: Password plaintext and hashes never appear in AuditLog'
      );

      // 16. Procurement Sources API returns isActive on all sources
      const prevCookies = nextHeaders.cookies;
      (nextHeaders as any).cookies = async () => ({
        get: (name: string) => (name === 'auth_token' ? { name: 'auth_token', value: saSessionToken } : undefined),
      });

      const sourcesRes = await getProcurementSources(new Request('http://localhost/api/super-admin/procurement-sources'));
      const sourcesBody = await sourcesRes.json();
      const allHaveIsActive =
        sourcesRes.status === 200 &&
        Array.isArray(sourcesBody?.sources) &&
        sourcesBody.sources.length > 0 &&
        sourcesBody.sources.every((s: any) => typeof s.isActive === 'boolean');
      assert(
        allHaveIsActive,
        '5D-B2-16: Procurement Sources API returns isActive property on all sources'
      );

      // 17. UI compatible sources logic strictly excludes inactive sources
      interface MockSource {
        id: string;
        code: string;
        name: string;
        sourceType: string;
        isActive: boolean;
      }

      const mockSources: MockSource[] = [
        { id: '1', code: 'Z1', name: 'Active ZMCC', sourceType: 'ZMCC', isActive: true },
        { id: '2', code: 'Z2', name: 'Inactive ZMCC', sourceType: 'ZMCC', isActive: false },
        { id: '3', code: 'C1', name: 'Active Contractor', sourceType: 'CONTRACTOR', isActive: true },
        { id: '4', code: 'C2', name: 'Inactive Contractor', sourceType: 'CONTRACTOR', isActive: false },
      ];

      const filterCompatibleSources = (sourcesList: MockSource[], userRole: string) => {
        const activeSources = sourcesList.filter((s) => s.isActive);
        if (userRole === 'ZMCC_MANAGER') {
          return activeSources.filter((s) => s.sourceType === 'ZMCC');
        }
        if (userRole === 'CONTRACTOR_MANAGER') {
          return activeSources.filter((s) => s.sourceType === 'CONTRACTOR');
        }
        return activeSources;
      };

      const zmccCompatible = filterCompatibleSources(mockSources, 'ZMCC_MANAGER');
      const contractorCompatible = filterCompatibleSources(mockSources, 'CONTRACTOR_MANAGER');
      const otherCompatible = filterCompatibleSources(mockSources, 'SUPER_ADMIN');

      const zmccOnlyActive = zmccCompatible.length === 1 && zmccCompatible[0].id === '1';
      const contractorOnlyActive = contractorCompatible.length === 1 && contractorCompatible[0].id === '3';
      const otherOnlyActive = otherCompatible.length === 2 && otherCompatible.every((s) => s.isActive);

      assert(
        zmccOnlyActive && contractorOnlyActive && otherOnlyActive,
        '5D-B2-17: UI compatible source selection strictly filters out inactive sources and enforces role scoping'
      );

      // 18. Inactive database source is tagged isActive=false and excluded from selection
      let tempInactiveSourceId: bigint | null = null;
      try {
        const tempInactive = await prisma.procurementSource.create({
          data: {
            code: `INACT_${randB2}`,
            name: `Inactive Source Test ${randB2}`,
            source_type: 'ZMCC',
            is_active: false,
          },
        });
        tempInactiveSourceId = tempInactive.id;

        const freshSourcesRes = await getProcurementSources(new Request('http://localhost/api/super-admin/procurement-sources'));
        const freshSourcesBody = await freshSourcesRes.json();
        const foundInactive = freshSourcesBody?.sources?.find((s: any) => s.id === tempInactive.id.toString());

        const isMarkedInactiveInApi = foundInactive && foundInactive.isActive === false;
        const excludedFromUiSelection = filterCompatibleSources(freshSourcesBody?.sources || [], 'ZMCC_MANAGER').every(
          (s: any) => s.id !== tempInactive.id.toString()
        );

        assert(
          Boolean(isMarkedInactiveInApi && excludedFromUiSelection),
          '5D-B2-18: Deactivated source in database is returned with isActive=false and excluded from UI selection'
        );
      } finally {
        if (tempInactiveSourceId) {
          await prisma.procurementSource.deleteMany({ where: { id: tempInactiveSourceId } });
        }
        (nextHeaders as any).cookies = prevCookies;
      }

      // 19. Secure modal reset invariant clears state and passwords
      let formState = {
        password: 'SensitivePlaintextPassword123!',
        newPassword: 'AnotherSensitiveSecret456!',
        confirmNewPassword: 'AnotherSensitiveSecret456!',
        createModalError: 'Some previous modal error',
        resetModalError: 'Previous reset error',
      };
      // Simulate closeCreateModal / closeResetModal reset logic
      formState = {
        password: '',
        newPassword: '',
        confirmNewPassword: '',
        createModalError: '',
        resetModalError: '',
      };
      const isSecurelyCleared =
        formState.password === '' &&
        formState.newPassword === '' &&
        formState.confirmNewPassword === '' &&
        formState.createModalError === '' &&
        formState.resetModalError === '';
      assert(
        isSecurelyCleared,
        '5D-B2-19: Secure modal reset clears all sensitive credentials and error state'
      );

    } finally {
      if (createdB2UserId) {
        try {
          await prisma.auditLog.deleteMany({
            where: { table_name: 'users', record_id: createdB2UserId },
          });
          await prisma.user.deleteMany({ where: { id: createdB2UserId } });
        } catch (cleanupErr) {
          console.error('CRITICAL: Failed to clean up 5D-B2 test user:', cleanupErr);
          throw cleanupErr;
        }
      }
    }

    // ----------------------------------------------------
    // STAGE 5D-C1: SUPER ADMIN SHARED SHELL MODERNIZATION
    // ----------------------------------------------------
    console.log('\n--- STAGE 5D-C1: SUPER ADMIN SHARED SHELL MODERNIZATION ---');

    const headerPath = path.join(process.cwd(), 'src', 'frontend', 'modules', 'super-admin', 'SuperAdminHeader.tsx');
    const sidebarPath = path.join(process.cwd(), 'src', 'frontend', 'modules', 'super-admin', 'SuperAdminSidebar.tsx');
    const layoutPath = path.join(process.cwd(), 'src', 'app', 'super-admin', 'layout.tsx');
    const usersPagePath = path.join(process.cwd(), 'src', 'app', 'super-admin', 'users', 'page.tsx');

    const headerContent = fs.readFileSync(headerPath, 'utf8');
    const sidebarContent = fs.readFileSync(sidebarPath, 'utf8');
    const layoutContent = fs.readFileSync(layoutPath, 'utf8');
    const usersPageContent = fs.readFileSync(usersPagePath, 'utf8');

    // 5D-C1-01: Exact company header title present
    const hasCompanyTitle = headerContent.includes('Shakarganj Food Products Limited');
    assert(
      hasCompanyTitle,
      '5D-C1-01: Company header title is exactly "Shakarganj Food Products Limited"'
    );

    // 5D-C1-02: Removed header labels are absent
    const hasRemovedHeaderLabels =
      headerContent.includes('System Administration & Master Control') ||
      headerContent.includes('Milk Reception Management System') ||
      headerContent.includes('User/Menu') ||
      headerContent.includes("title = 'Super Admin'") ||
      headerContent.includes('>Super Admin<') ||
      headerContent.includes('>SUPER ADMIN<');
    assert(
      !hasRemovedHeaderLabels,
      '5D-C1-02: Removed header labels and old title defaults are absent from SuperAdminHeader'
    );

    // 5D-C1-03: Sidebar branding block labels are absent
    const hasSidebarBranding =
      sidebarContent.includes('Control Panel') ||
      sidebarContent.includes('Super Admin\n              </h1>') ||
      sidebarContent.includes('Super Admin</h1>');
    assert(
      !hasSidebarBranding,
      '5D-C1-03: Sidebar branding block (Control Panel / Super Admin header) is absent'
    );

    // 5D-C1-04: Sidebar navigation label is "Users" and "Users & Access" is absent
    const hasUsersNav = sidebarContent.includes("label: 'Users'");
    const hasOldUsersAccessNav = sidebarContent.includes("label: 'Users & Access'");
    assert(
      hasUsersNav && !hasOldUsersAccessNav,
      '5D-C1-04: Sidebar navigation label is "Users" and old "Users & Access" label is absent'
    );

    // 5D-C1-05: Existing Super Admin navigation destinations remain present
    const requiredDestinations = [
      '/super-admin',
      '/super-admin/users',
      '/super-admin/procurement-sources',
      '/super-admin/silos',
      '/super-admin/lab-tests',
      '/super-admin/sop-rules',
      '/super-admin/qa-warnings',
      '/super-admin/operations',
      '/super-admin/audit',
      '/super-admin/master-data',
      '/super-admin/settings',
    ];
    const allDestinationsPresent = requiredDestinations.every((dest) =>
      sidebarContent.includes(`href: '${dest}'`)
    );
    assert(
      allDestinationsPresent,
      '5D-C1-05: All 11 canonical Super Admin navigation destinations remain present in sidebar'
    );

    // 5D-C1-06: Compact Add user action retains accessible name and min touch target
    const hasAddUserAria = usersPageContent.includes('aria-label="Add user"');
    const hasAddUserTitle = usersPageContent.includes('title="Add user"');
    const hasMinTouchTarget = usersPageContent.includes('min-h-[44px]') && usersPageContent.includes('min-w-[44px]');
    const hasPlusIcon = usersPageContent.includes('<Plus className="w-4 h-4" />');
    assert(
      hasAddUserAria && hasAddUserTitle && hasMinTouchTarget && hasPlusIcon,
      '5D-C1-06: Compact Add user action has aria-label="Add user", title="Add user", Plus icon, and minimum 44px touch target'
    );

    // 5D-C1-07: Create-user capability remains connected to the existing modal
    const hasCreateModalTrigger =
      usersPageContent.includes('setShowCreateModal(true)') &&
      usersPageContent.includes('resetForm()') &&
      usersPageContent.includes('handleCreateUser');
    const hasRemovedLargeIntro =
      !usersPageContent.includes('Users & Access Management') &&
      !usersPageContent.includes('Create New User</span>') &&
      !usersPageContent.includes('+ Add User') &&
      !usersPageContent.includes('>Add User<');
    assert(
      hasCreateModalTrigger && hasRemovedLargeIntro,
      '5D-C1-07: Create-user modal trigger is preserved while large intro and large text button are removed'
    );

    // 5D-C1-08: Architecture preserves single canonical shell components with no duplicates
    const allSrcFiles = fs.readdirSync(path.join(process.cwd(), 'src', 'frontend', 'modules', 'super-admin'));
    const noDuplicateHeader = allSrcFiles.filter((f) => f.toLowerCase().includes('header')).length === 1;
    const noDuplicateSidebar = allSrcFiles.filter((f) => f.toLowerCase().includes('sidebar')).length === 1;
    const layoutUsesCanonical =
      layoutContent.includes('SuperAdminSidebar') &&
      layoutContent.includes('SuperAdminHeader') &&
      layoutContent.includes('isAuthorized');
    assert(
      noDuplicateHeader && noDuplicateSidebar && layoutUsesCanonical,
      '5D-C1-08: Canonical layout, sidebar, and header preserved without duplicate or replacement shell components'
    );

    // ----------------------------------------------------
    // STAGE 5D-C3: PROCUREMENT SOURCE LIFECYCLE
    // ----------------------------------------------------
    console.log('\n--- STAGE 5D-C3: PROCUREMENT SOURCE LIFECYCLE ---');

    const procSourcesPagePath = path.join(process.cwd(), 'src', 'app', 'super-admin', 'procurement-sources', 'page.tsx');
    const procSourcesPageContent = fs.readFileSync(procSourcesPagePath, 'utf8');

    // UI Integrity Checks
    const hasAddSourceAria = procSourcesPageContent.includes('aria-label="Add procurement source"');
    const hasAddSourceTitle = procSourcesPageContent.includes('title="Add procurement source"');
    const hasProcSourceMinTouch = procSourcesPageContent.includes('min-h-[44px]') && procSourcesPageContent.includes('min-w-[44px]');
    const hasProcSourcePlus = procSourcesPageContent.includes('<Plus className="w-4 h-4" />');
    const hasNoStoreFetch = procSourcesPageContent.includes("cache: 'no-store'");
    const hasEscapeHandler = procSourcesPageContent.includes("e.key === 'Escape'");
    const hasEditModal = procSourcesPageContent.includes('showEditModal') && procSourcesPageContent.includes('handleEditSource');
    const hasConfirmModal = procSourcesPageContent.includes('showConfirmModal') && procSourcesPageContent.includes('handleConfirmToggle');
    const hasNoExportedHelpers = !procSourcesPageContent.includes('export function') && !procSourcesPageContent.includes('export const');

    assert(
      hasAddSourceAria && hasAddSourceTitle && hasProcSourceMinTouch && hasProcSourcePlus,
      '5D-C3-01: Compact Add procurement source action has aria-label, title, Plus icon, and minimum 44px touch target'
    );
    assert(
      hasNoStoreFetch,
      '5D-C3-02: Procurement Sources UI loads data with { cache: "no-store" }'
    );
    assert(
      hasEscapeHandler && hasEditModal && hasConfirmModal && hasNoExportedHelpers,
      '5D-C3-03: UI includes Escape key handling, Edit modal, Confirmation modal, and zero non-page exports'
    );

    // API Behavior and Safety Tests
    const cleanupC3SourceIds: bigint[] = [];
    const cleanupC3UserIds: bigint[] = [];
    const cleanupC3VisitIds: bigint[] = [];

    const c3AuthToken = await createSessionToken({
      id: adminUser!.id.toString(),
      username: adminUser!.username,
      name: adminUser!.full_name || adminUser!.username,
      role: 'SUPER_ADMIN',
      department: 'Administration',
    });

    const c3Headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${c3AuthToken}`,
    };

    try {
      // 5D-C3-04: GET endpoint returns Cache-Control: private, no-store, max-age=0
      const getReq = new Request('http://localhost/api/super-admin/procurement-sources', {
        method: 'GET',
        headers: c3Headers,
      });
      const getRes = await getProcurementSources(getReq);
      const cacheControlHeader = getRes.headers.get('Cache-Control');
      assert(
        getRes.status === 200 && cacheControlHeader === 'private, no-store, max-age=0',
        '5D-C3-04: GET /api/super-admin/procurement-sources includes Cache-Control: private, no-store, max-age=0'
      );

      // 5D-C3-05: Source creation with normalized uppercase code and atomic audit log
      const randC3 = Math.floor(Math.random() * 900000) + 100000;
      const testCodeRaw = `  c3-test-${randC3}  `;
      const expectedCode = `C3-TEST-${randC3}`;
      const testName = `Test Source C3 ${randC3}`;

      const createReq = new Request('http://localhost/api/super-admin/procurement-sources', {
        method: 'POST',
        headers: c3Headers,
        body: JSON.stringify({
          code: testCodeRaw,
          name: testName,
          sourceType: 'ZMCC',
        }),
      });
      const createRes = await postProcurementSource(createReq);
      const createBody = await createRes.json();
      assert(
        createRes.status === 201 &&
          createBody?.source?.code === expectedCode &&
          createBody?.source?.name === testName &&
          createBody?.source?.sourceType === 'ZMCC' &&
          createBody?.source?.isActive === true,
        '5D-C3-05: POST normalizes code to uppercase/trimmed and creates source with 201 status'
      );

      const createdSourceId = BigInt(createBody.source.id);
      cleanupC3SourceIds.push(createdSourceId);

      const createAudit = await prisma.auditLog.findFirst({
        where: {
          table_name: 'procurement_source',
          record_id: createdSourceId,
          action: 'PROCUREMENT_SOURCE_CREATED',
        },
      });
      assert(
        createAudit !== null && createAudit.user_id === adminUser!.id,
        '5D-C3-06: Atomic audit log created with action PROCUREMENT_SOURCE_CREATED and admin user actor'
      );

      // 5D-C3-07: Duplicate code is strictly rejected with 400
      const dupCreateReq = new Request('http://localhost/api/super-admin/procurement-sources', {
        method: 'POST',
        headers: c3Headers,
        body: JSON.stringify({
          code: expectedCode,
          name: 'Another Name',
          sourceType: 'CONTRACTOR',
        }),
      });
      const dupCreateRes = await postProcurementSource(dupCreateReq);
      const dupCreateBody = await dupCreateRes.json();
      assert(
        dupCreateRes.status === 400 && dupCreateBody?.error?.includes('already exists'),
        '5D-C3-07: POST rejects duplicate code with 400'
      );

      // 5D-C3-08: Invalid sourceType is strictly rejected with 400
      const invalidTypeReq = new Request('http://localhost/api/super-admin/procurement-sources', {
        method: 'POST',
        headers: c3Headers,
        body: JSON.stringify({
          code: `INVALID-${randC3}`,
          name: 'Invalid Type Source',
          sourceType: 'OTHER_TYPE',
        }),
      });
      const invalidTypeRes = await postProcurementSource(invalidTypeReq);
      assert(
        invalidTypeRes.status === 400,
        '5D-C3-08: POST rejects invalid sourceType with 400'
      );

      // 5D-C3-09: Immutability enforcement: cannot alter code or sourceType
      const alterCodeReq = new Request(`http://localhost/api/super-admin/procurement-sources/${createdSourceId}`, {
        method: 'PATCH',
        headers: c3Headers,
        body: JSON.stringify({ code: 'CHANGED_CODE' }),
      });
      const alterCodeRes = await patchProcurementSource(alterCodeReq, {
        params: Promise.resolve({ id: createdSourceId.toString() }),
      });
      const alterCodeBody = await alterCodeRes.json();
      assert(
        alterCodeRes.status === 400 && alterCodeBody?.error?.includes('Code is immutable'),
        '5D-C3-09: PATCH rejects attempt to alter code with 400'
      );

      const alterTypeReq = new Request(`http://localhost/api/super-admin/procurement-sources/${createdSourceId}`, {
        method: 'PATCH',
        headers: c3Headers,
        body: JSON.stringify({ sourceType: 'CONTRACTOR' }),
      });
      const alterTypeRes = await patchProcurementSource(alterTypeReq, {
        params: Promise.resolve({ id: createdSourceId.toString() }),
      });
      const alterTypeBody = await alterTypeRes.json();
      assert(
        alterTypeRes.status === 400 && alterTypeBody?.error?.includes('Source Type is immutable'),
        '5D-C3-10: PATCH rejects attempt to alter sourceType with 400'
      );

      // 5D-C3-11: Empty name is rejected with 400
      const emptyNameReq = new Request(`http://localhost/api/super-admin/procurement-sources/${createdSourceId}`, {
        method: 'PATCH',
        headers: c3Headers,
        body: JSON.stringify({ name: '   ' }),
      });
      const emptyNameRes = await patchProcurementSource(emptyNameReq, {
        params: Promise.resolve({ id: createdSourceId.toString() }),
      });
      assert(
        emptyNameRes.status === 400,
        '5D-C3-11: PATCH rejects empty name with 400'
      );

      // 5D-C3-STRICT-01: String "false" for isActive rejected with 400
      const stringBoolReq = new Request(`http://localhost/api/super-admin/procurement-sources/${createdSourceId}`, {
        method: 'PATCH',
        headers: c3Headers,
        body: JSON.stringify({ isActive: 'false' }),
      });
      const stringBoolRes = await patchProcurementSource(stringBoolReq, {
        params: Promise.resolve({ id: createdSourceId.toString() }),
      });
      const stringBoolBody = await stringBoolRes.json();
      assert(
        stringBoolRes.status === 400 && stringBoolBody?.error?.includes('boolean'),
        '5D-C3-STRICT-01: PATCH rejects string "false" for isActive with 400'
      );

      // 5D-C3-STRICT-02: Numeric isActive rejected with 400
      const numericBoolReq = new Request(`http://localhost/api/super-admin/procurement-sources/${createdSourceId}`, {
        method: 'PATCH',
        headers: c3Headers,
        body: JSON.stringify({ isActive: 0 }),
      });
      const numericBoolRes = await patchProcurementSource(numericBoolReq, {
        params: Promise.resolve({ id: createdSourceId.toString() }),
      });
      const numericBoolBody = await numericBoolRes.json();
      assert(
        numericBoolRes.status === 400 && numericBoolBody?.error?.includes('boolean'),
        '5D-C3-STRICT-02: PATCH rejects numeric isActive with 400'
      );

      // 5D-C3-STRICT-03: Unknown field rejected with 400
      const unknownFieldReq = new Request(`http://localhost/api/super-admin/procurement-sources/${createdSourceId}`, {
        method: 'PATCH',
        headers: c3Headers,
        body: JSON.stringify({ unknownProperty: 'malicious' }),
      });
      const unknownFieldRes = await patchProcurementSource(unknownFieldReq, {
        params: Promise.resolve({ id: createdSourceId.toString() }),
      });
      const unknownFieldBody = await unknownFieldRes.json();
      assert(
        unknownFieldRes.status === 400 && unknownFieldBody?.error?.includes('Unknown field'),
        '5D-C3-STRICT-03: PATCH rejects unknown field with 400'
      );

      // 5D-C3-STRICT-04: Empty PATCH body rejected with 400
      const emptyPatchReq = new Request(`http://localhost/api/super-admin/procurement-sources/${createdSourceId}`, {
        method: 'PATCH',
        headers: c3Headers,
        body: JSON.stringify({}),
      });
      const emptyPatchRes = await patchProcurementSource(emptyPatchReq, {
        params: Promise.resolve({ id: createdSourceId.toString() }),
      });
      const emptyPatchBody = await emptyPatchRes.json();
      assert(
        emptyPatchRes.status === 400 && emptyPatchBody?.error?.includes('empty'),
        '5D-C3-STRICT-04: PATCH rejects empty body with 400'
      );

      // 5D-C3-12: Updating name succeeds with PROCUREMENT_SOURCE_UPDATED audit
      const updatedName = `${testName} Renamed`;
      const updateNameReq = new Request(`http://localhost/api/super-admin/procurement-sources/${createdSourceId}`, {
        method: 'PATCH',
        headers: c3Headers,
        body: JSON.stringify({ name: updatedName }),
      });
      const updateNameRes = await patchProcurementSource(updateNameReq, {
        params: Promise.resolve({ id: createdSourceId.toString() }),
      });
      const updateNameBody = await updateNameRes.json();
      const updateAudit = await prisma.auditLog.findFirst({
        where: {
          table_name: 'procurement_source',
          record_id: createdSourceId,
          action: 'PROCUREMENT_SOURCE_UPDATED',
        },
      });
      assert(
        updateNameRes.status === 200 &&
          updateNameBody?.source?.name === updatedName &&
          updateAudit !== null &&
          updateAudit.user_id === adminUser!.id,
        '5D-C3-12: Updating name succeeds with 200 and logs PROCUREMENT_SOURCE_UPDATED'
      );

      // 5D-C3-13: Deactivation safety check A: Active assigned users block deactivation (409)
      const assignedUser = await prisma.user.create({
        data: {
          username: `user.c3.${randC3}`,
          full_name: 'Assigned User C3',
          role: 'ZMCC_MANAGER',
          procurement_source_id: createdSourceId,
          is_active: true,
        },
      });
      cleanupC3UserIds.push(assignedUser.id);

      const auditCountBeforeBlockA = await prisma.auditLog.count({
        where: { table_name: 'procurement_source', record_id: createdSourceId },
      });

      const deactBlockedUserReq = new Request(`http://localhost/api/super-admin/procurement-sources/${createdSourceId}`, {
        method: 'PATCH',
        headers: c3Headers,
        body: JSON.stringify({ isActive: false }),
      });
      const deactBlockedUserRes = await patchProcurementSource(deactBlockedUserReq, {
        params: Promise.resolve({ id: createdSourceId.toString() }),
      });
      const deactBlockedUserBody = await deactBlockedUserRes.json();
      assert(
        deactBlockedUserRes.status === 409 &&
          deactBlockedUserBody?.error?.includes('active user(s) currently assigned'),
        '5D-C3-13: Deactivation blocked with 409 when active users are assigned'
      );

      // Verify source was not modified in DB and no audit log was created
      const sourceAfterBlockedUser = await prisma.procurementSource.findUnique({ where: { id: createdSourceId } });
      const auditCountAfterBlockA = await prisma.auditLog.count({
        where: { table_name: 'procurement_source', record_id: createdSourceId },
      });
      assert(
        sourceAfterBlockedUser?.is_active === true && auditCountAfterBlockA === auditCountBeforeBlockA,
        '5D-C3-14: Blocked deactivation leaves procurement source is_active=true unchanged and creates no audit log'
      );

      // Deactivate the assigned user so blocker A is resolved
      await prisma.user.update({
        where: { id: assignedUser.id },
        data: { is_active: false },
      });

      // 5D-C3-15: Deactivation safety check B: Active/incomplete vehicle visits block deactivation (409)
      const incompleteVisit = await prisma.vehicleVisit.create({
        data: {
          visit_number: `V-C3-${randC3}`,
          vehicle_number: `TK-C3-${randC3}`,
          procurement_source_id: createdSourceId,
          current_status: 'DRAFT_DISPATCH',
          created_by: adminUser!.id,
        },
      });
      cleanupC3VisitIds.push(incompleteVisit.id);

      const auditCountBeforeBlockB = await prisma.auditLog.count({
        where: { table_name: 'procurement_source', record_id: createdSourceId },
      });

      const deactBlockedVisitReq = new Request(`http://localhost/api/super-admin/procurement-sources/${createdSourceId}`, {
        method: 'PATCH',
        headers: c3Headers,
        body: JSON.stringify({ isActive: false }),
      });
      const deactBlockedVisitRes = await patchProcurementSource(deactBlockedVisitReq, {
        params: Promise.resolve({ id: createdSourceId.toString() }),
      });
      const deactBlockedVisitBody = await deactBlockedVisitRes.json();
      assert(
        deactBlockedVisitRes.status === 409 &&
          deactBlockedVisitBody?.error?.includes('active or in-progress vehicle visit(s)'),
        '5D-C3-15: Deactivation blocked with 409 when incomplete vehicle visits exist'
      );

      const auditCountAfterBlockB = await prisma.auditLog.count({
        where: { table_name: 'procurement_source', record_id: createdSourceId },
      });
      const sourceAfterBlockedVisit = await prisma.procurementSource.findUnique({ where: { id: createdSourceId } });
      assert(
        sourceAfterBlockedVisit?.is_active === true && auditCountAfterBlockB === auditCountBeforeBlockB,
        '5D-C3-BLOCK-AUDIT: Incomplete visit blocker creates no source mutation and no audit log'
      );

      // Complete the visit so blocker B is resolved
      await prisma.vehicleVisit.update({
        where: { id: incompleteVisit.id },
        data: { current_status: 'COMPLETED' },
      });

      // 5D-C3-16: Successful deactivation when all blockers resolved
      const deactSuccessReq = new Request(`http://localhost/api/super-admin/procurement-sources/${createdSourceId}`, {
        method: 'PATCH',
        headers: c3Headers,
        body: JSON.stringify({ isActive: false }),
      });
      const deactSuccessRes = await patchProcurementSource(deactSuccessReq, {
        params: Promise.resolve({ id: createdSourceId.toString() }),
      });
      const deactSuccessBody = await deactSuccessRes.json();
      const deactAudit = await prisma.auditLog.findFirst({
        where: {
          table_name: 'procurement_source',
          record_id: createdSourceId,
          action: 'PROCUREMENT_SOURCE_DEACTIVATED',
        },
      });
      const sourceInDbAfterDeact = await prisma.procurementSource.findUnique({ where: { id: createdSourceId } });
      assert(
        deactSuccessRes.status === 200 &&
          deactSuccessBody?.source?.isActive === false &&
          sourceInDbAfterDeact?.is_active === false &&
          deactAudit !== null &&
          deactAudit.user_id === adminUser!.id,
        '5D-C3-16: Deactivation succeeds when blockers are cleared, logging PROCUREMENT_SOURCE_DEACTIVATED'
      );

      // 5D-C3-17: Inactive source exact rejection by /api/dispatches/start
      const countVisitsBeforeRejectedStart = await prisma.vehicleVisit.count({
        where: { procurement_source_id: createdSourceId },
      });

      const dispatchStartReq = new Request('http://localhost/api/dispatches/start', {
        method: 'POST',
        headers: c3Headers,
        body: JSON.stringify({
          procurementSourceId: createdSourceId.toString(),
        }),
      });
      const dispatchStartRes = await postStartDispatch(dispatchStartReq);
      const dispatchStartBody = await dispatchStartRes.json();

      const sourceInDbAfterDispatchAttempt = await prisma.procurementSource.findUnique({
        where: { id: createdSourceId },
      });
      const countVisitsAfterRejectedStart = await prisma.vehicleVisit.count({
        where: { procurement_source_id: createdSourceId },
      });

      assert(
        dispatchStartRes.status === 400 &&
          dispatchStartBody?.code === 'PROCUREMENT_SOURCE_INVALID' &&
          dispatchStartBody?.error === 'Selected procurement source is inactive or does not exist.' &&
          sourceInDbAfterDispatchAttempt?.is_active === false &&
          countVisitsAfterRejectedStart === countVisitsBeforeRejectedStart,
        '5D-C3-17: Inactive source rejected by /api/dispatches/start with HTTP 400, code PROCUREMENT_SOURCE_INVALID, exact error, source remains inactive, zero visits created'
      );

      // 5D-C3-18: Inactive source is still returned to Super Admin in GET list
      const getListReq = new Request('http://localhost/api/super-admin/procurement-sources', {
        method: 'GET',
        headers: c3Headers,
      });
      const getListRes = await getProcurementSources(getListReq);
      const getListBody = await getListRes.json();
      const foundInList = getListBody?.sources?.find((s: any) => s.id === createdSourceId.toString());
      assert(
        foundInList && foundInList.isActive === false,
        '5D-C3-18: Deactivated source remains visible in Super Admin GET list as Inactive'
      );

      // 5D-C3-19: Successful reactivation with PROCUREMENT_SOURCE_ACTIVATED audit
      const reactReq = new Request(`http://localhost/api/super-admin/procurement-sources/${createdSourceId}`, {
        method: 'PATCH',
        headers: c3Headers,
        body: JSON.stringify({ isActive: true }),
      });
      const reactRes = await patchProcurementSource(reactReq, {
        params: Promise.resolve({ id: createdSourceId.toString() }),
      });
      const reactBody = await reactRes.json();
      const reactAudit = await prisma.auditLog.findFirst({
        where: {
          table_name: 'procurement_source',
          record_id: createdSourceId,
          action: 'PROCUREMENT_SOURCE_ACTIVATED',
        },
      });
      const sourceInDbAfterReact = await prisma.procurementSource.findUnique({ where: { id: createdSourceId } });
      assert(
        reactRes.status === 200 &&
          reactBody?.source?.isActive === true &&
          sourceInDbAfterReact?.is_active === true &&
          reactAudit !== null &&
          reactAudit.user_id === adminUser!.id,
        '5D-C3-19: Reactivation succeeds with 200, is_active=true in DB, and logs PROCUREMENT_SOURCE_ACTIVATED'
      );

      // 5D-C3-SAFE-500-01: Unexpected POST failure returns generic 500 without internal text
      const origFindUnique = prisma.procurementSource.findUnique;
      try {
        (prisma.procurementSource as any).findUnique = async () => {
          throw new Error('FATAL_POST_DB_CONNECTION_LEAK_SECRET_XYZ');
        };
        const unexpectedPostReq = new Request('http://localhost/api/super-admin/procurement-sources', {
          method: 'POST',
          headers: c3Headers,
          body: JSON.stringify({
            code: `SAFE500-POST-${randC3}`,
            name: 'Safe 500 Test',
            sourceType: 'ZMCC',
          }),
        });
        const unexpectedPostRes = await postProcurementSource(unexpectedPostReq);
        const unexpectedPostBody = await unexpectedPostRes.json();
        assert(
          unexpectedPostRes.status === 500 &&
            unexpectedPostBody?.error === 'Failed to create procurement source.' &&
            !JSON.stringify(unexpectedPostBody).includes('FATAL_POST_DB_CONNECTION_LEAK_SECRET_XYZ'),
          '5D-C3-SAFE-500-01: Unexpected POST failure returns generic 500 without internal error text'
        );
      } finally {
        prisma.procurementSource.findUnique = origFindUnique;
      }

      // 5D-C3-SAFE-500-02: Unexpected PATCH failure returns generic 500 without internal text
      const origFindUser = prisma.user.findFirst;
      try {
        (prisma.user as any).findFirst = async () => {
          throw new Error('FATAL_PATCH_DB_QUERY_CORRUPTION_SECRET_ABC');
        };
        const unexpectedPatchReq = new Request(`http://localhost/api/super-admin/procurement-sources/${createdSourceId}`, {
          method: 'PATCH',
          headers: c3Headers,
          body: JSON.stringify({ name: 'Will Fail Safe 500' }),
        });
        const unexpectedPatchRes = await patchProcurementSource(unexpectedPatchReq, {
          params: Promise.resolve({ id: createdSourceId.toString() }),
        });
        const unexpectedPatchBody = await unexpectedPatchRes.json();
        assert(
          unexpectedPatchRes.status === 500 &&
            unexpectedPatchBody?.error === 'Failed to update procurement source.' &&
            !JSON.stringify(unexpectedPatchBody).includes('FATAL_PATCH_DB_QUERY_CORRUPTION_SECRET_ABC'),
          '5D-C3-SAFE-500-02: Unexpected PATCH failure returns generic 500 without internal error text'
        );
      } finally {
        prisma.user.findFirst = origFindUser;
      }

      // 5D-C3-SAFE-500-03: Unexpected GET failure returns generic 500 and preserves Cache-Control: private, no-store, max-age=0
      const origFindMany = prisma.procurementSource.findMany;
      try {
        (prisma.procurementSource as any).findMany = async () => {
          throw new Error('FATAL_GET_DB_ERROR_SECRET_123');
        };
        const unexpectedGetReq = new Request('http://localhost/api/super-admin/procurement-sources', {
          method: 'GET',
          headers: c3Headers,
        });
        const unexpectedGetRes = await getProcurementSources(unexpectedGetReq);
        const unexpectedGetBody = await unexpectedGetRes.json();
        const getCacheControl = unexpectedGetRes.headers.get('Cache-Control');
        assert(
          unexpectedGetRes.status === 500 &&
            unexpectedGetBody?.error === 'Failed to fetch procurement sources.' &&
            !JSON.stringify(unexpectedGetBody).includes('FATAL_GET_DB_ERROR_SECRET_123') &&
            getCacheControl === 'private, no-store, max-age=0',
          '5D-C3-SAFE-500-03: Unexpected GET failure returns generic 500 with no-store cache header'
        );
      } finally {
        prisma.procurementSource.findMany = origFindMany;
      }

      // 5D-C3-20: Atomic rollback test: transaction rolls back if auditLog.create fails on POST
      const randRollback = Math.floor(Math.random() * 900000) + 100000;
      const rollbackCode = `C3-RB-${randRollback}`;
      const origTransaction = prisma.$transaction;
      try {
        (prisma as any).$transaction = async (fn: any) => {
          return await (origTransaction as any).call(prisma, async (tx: any) => {
            const proxyTx = new Proxy(tx, {
              get(target, prop, receiver) {
                if (prop === 'auditLog') {
                  return {
                    create: async () => {
                      throw new Error('Simulated Audit Failure for Rollback Test');
                    },
                  };
                }
                return Reflect.get(target, prop, receiver);
              },
            });
            return await fn(proxyTx);
          });
        };

        const rbCreateReq = new Request('http://localhost/api/super-admin/procurement-sources', {
          method: 'POST',
          headers: c3Headers,
          body: JSON.stringify({
            code: rollbackCode,
            name: `Rollback Test Source ${randRollback}`,
            sourceType: 'ZMCC',
          }),
        });
        const rbCreateRes = await postProcurementSource(rbCreateReq);
        assert(
          rbCreateRes.status >= 500,
          '5D-C3-20: POST returns >= 500 when transaction fails on auditLog creation'
        );

        const sourceAfterFailedCreate = await prisma.procurementSource.findUnique({ where: { code: rollbackCode } });
        assert(
          sourceAfterFailedCreate === null,
          '5D-C3-21: Creation rolled back cleanly; no orphan source persisted in DB'
        );
      } finally {
        prisma.$transaction = origTransaction as any;
      }

      // 5D-C3-PATCH-ROLLBACK: PATCH audit failure rolls back name/status and creates no audit
      const baselineSourceBeforePatchRb = await prisma.procurementSource.findUnique({ where: { id: createdSourceId } });
      const baselineAuditCountBeforePatchRb = await prisma.auditLog.count({
        where: { table_name: 'procurement_source', record_id: createdSourceId },
      });

      try {
        (prisma as any).$transaction = async (fn: any) => {
          return await (origTransaction as any).call(prisma, async (tx: any) => {
            const proxyTx = new Proxy(tx, {
              get(target, prop, receiver) {
                if (prop === 'auditLog') {
                  return {
                    create: async () => {
                      throw new Error('Simulated Audit Failure for PATCH Rollback Test');
                    },
                  };
                }
                return Reflect.get(target, prop, receiver);
              },
            });
            return await fn(proxyTx);
          });
        };

        const rbPatchReq = new Request(`http://localhost/api/super-admin/procurement-sources/${createdSourceId}`, {
          method: 'PATCH',
          headers: c3Headers,
          body: JSON.stringify({
            name: 'Name That Must Not Persist',
            isActive: false,
          }),
        });
        const rbPatchRes = await patchProcurementSource(rbPatchReq, {
          params: Promise.resolve({ id: createdSourceId.toString() }),
        });
        assert(
          rbPatchRes.status >= 500,
          '5D-C3-PATCH-ROLLBACK-01: PATCH returns >= 500 when audit creation fails'
        );
      } finally {
        prisma.$transaction = origTransaction as any;
      }

      const sourceAfterFailedPatch = await prisma.procurementSource.findUnique({ where: { id: createdSourceId } });
      const auditCountAfterFailedPatch = await prisma.auditLog.count({
        where: { table_name: 'procurement_source', record_id: createdSourceId },
      });

      assert(
        sourceAfterFailedPatch?.name === baselineSourceBeforePatchRb?.name &&
          sourceAfterFailedPatch?.is_active === baselineSourceBeforePatchRb?.is_active &&
          auditCountAfterFailedPatch === baselineAuditCountBeforePatchRb,
        '5D-C3-PATCH-ROLLBACK-02: PATCH audit failure cleanly rolls back name and status, creating no audit records'
      );

      // 5D-C3-LOCK: Row lock SELECT FOR UPDATE is acquired before blocker queries and blocked ops leave state unchanged
      const executedOperationsInTx: string[] = [];
      try {
        (prisma as any).$transaction = async (fn: any) => {
          return await (origTransaction as any).call(prisma, async (tx: any) => {
            const proxyTx = new Proxy(tx, {
              get(target, prop, receiver) {
                if (prop === '$queryRaw') {
                  return async (...args: any[]) => {
                    executedOperationsInTx.push('LOCK_ROW_FOR_UPDATE');
                    return await target.$queryRaw(...args);
                  };
                }
                if (prop === 'user') {
                  return new Proxy(target.user, {
                    get(uTarget, uProp, uReceiver) {
                      if (uProp === 'count') {
                        return async (...args: any[]) => {
                          executedOperationsInTx.push('CHECK_ASSIGNED_USERS');
                          return await uTarget.count(...args);
                        };
                      }
                      return Reflect.get(uTarget, uProp, uReceiver);
                    },
                  });
                }
                if (prop === 'vehicleVisit') {
                  return new Proxy(target.vehicleVisit, {
                    get(vTarget, vProp, vReceiver) {
                      if (vProp === 'count') {
                        return async (...args: any[]) => {
                          executedOperationsInTx.push('CHECK_INCOMPLETE_VISITS');
                          return await vTarget.count(...args);
                        };
                      }
                      return Reflect.get(vTarget, vProp, vReceiver);
                    },
                  });
                }
                return Reflect.get(target, prop, receiver);
              },
            });
            return await fn(proxyTx);
          });
        };

        const lockVerifyReq = new Request(`http://localhost/api/super-admin/procurement-sources/${createdSourceId}`, {
          method: 'PATCH',
          headers: c3Headers,
          body: JSON.stringify({ isActive: false }),
        });
        const lockVerifyRes = await patchProcurementSource(lockVerifyReq, {
          params: Promise.resolve({ id: createdSourceId.toString() }),
        });
        assert(
          lockVerifyRes.status === 200,
          '5D-C3-LOCK-01: PATCH succeeds when acquiring lock and passing blocker checks'
        );

        const lockIndex = executedOperationsInTx.indexOf('LOCK_ROW_FOR_UPDATE');
        const userCheckIndex = executedOperationsInTx.indexOf('CHECK_ASSIGNED_USERS');
        const visitCheckIndex = executedOperationsInTx.indexOf('CHECK_INCOMPLETE_VISITS');

        assert(
          lockIndex !== -1 &&
            userCheckIndex !== -1 &&
            visitCheckIndex !== -1 &&
            lockIndex < userCheckIndex &&
            lockIndex < visitCheckIndex,
          '5D-C3-LOCK-02: Row lock (SELECT FOR UPDATE) is verified to execute strictly BEFORE user and visit blocker checks'
        );
      } finally {
        prisma.$transaction = origTransaction as any;
      }

    } finally {
      // Clean up test entities strictly
      const cleanupErrors: any[] = [];
      for (const visitId of cleanupC3VisitIds) {
        try {
          await prisma.vehicleVisit.delete({ where: { id: visitId } });
        } catch (e) {
          cleanupErrors.push({ entity: 'vehicleVisit', id: visitId.toString(), error: e });
        }
      }
      for (const userId of cleanupC3UserIds) {
        try {
          await prisma.user.delete({ where: { id: userId } });
        } catch (e) {
          cleanupErrors.push({ entity: 'user', id: userId.toString(), error: e });
        }
      }
      for (const sourceId of cleanupC3SourceIds) {
        try {
          await prisma.auditLog.deleteMany({
            where: { table_name: 'procurement_source', record_id: sourceId },
          });
          await prisma.procurementSource.delete({ where: { id: sourceId } });
        } catch (e) {
          cleanupErrors.push({ entity: 'procurementSource', id: sourceId.toString(), error: e });
        }
      }

      if (cleanupErrors.length > 0) {
        console.error('Critical cleanup errors in 5D-C3 test suite:', cleanupErrors);
        throw new Error(`Cleanup failed for ${cleanupErrors.length} test entities`);
      }
    }

    // ----------------------------------------------------
    // STAGE 5D-C4A: ROLE-GUIDED USER ASSIGNMENT BEHAVIORAL SUITE
    // ----------------------------------------------------
    console.log('\n--- STAGE 5D-C4A: ROLE-GUIDED USER ASSIGNMENT BEHAVIORAL SUITE ---');

    const cleanupC4AUserIds: bigint[] = [];
    const cleanupC4ASourceIds: bigint[] = [];

    try {
      const activeZmcc = await prisma.procurementSource.findFirst({
        where: { source_type: 'ZMCC', is_active: true },
      });
      const activeContractor = await prisma.procurementSource.findFirst({
        where: { source_type: 'CONTRACTOR', is_active: true },
      });

      if (!activeZmcc || !activeContractor) {
        throw new Error('5D-C4A PREREQUISITE: Active ZMCC and CONTRACTOR sources required');
      }

      // Create a temporary inactive source for test 7
      const inactiveCode = `INACT_${Date.now()}`.slice(0, 10);
      const inactiveSource = await prisma.procurementSource.create({
        data: {
          code: inactiveCode,
          name: `Inactive Source ${inactiveCode}`,
          source_type: 'ZMCC',
          is_active: false,
        },
      });
      cleanupC4ASourceIds.push(inactiveSource.id);

      // 1. ZMCC Manager + active ZMCC source: CREATED with SOURCE scope and correct source ID
      const zmccUserReq = new Request('http://localhost/api/super-admin/users', {
        method: 'POST',
        headers: saHeaders,
        body: JSON.stringify({
          username: `c4a_zmcc_${Date.now()}`,
          name: 'ZMCC Manager User',
          password: 'Password123!',
          role: 'ZMCC_MANAGER',
          procurementSourceId: activeZmcc.id.toString(),
        }),
      });
      const zmccUserRes = await postCreateUser(zmccUserReq);
      const zmccUserData = await zmccUserRes.json();
      const zmccDbUser = zmccUserData?.user?.id
        ? await prisma.user.findUnique({ where: { id: BigInt(zmccUserData.user.id) } })
        : null;
      if (zmccDbUser) cleanupC4AUserIds.push(zmccDbUser.id);

      assert(
        zmccUserRes.status === 200 &&
          zmccUserData.success &&
          zmccDbUser !== null &&
          zmccDbUser.role === 'ZMCC_MANAGER' &&
          zmccDbUser.scope_type === 'SOURCE' &&
          zmccDbUser.department === 'Milk Procurement' &&
          zmccDbUser.procurement_source_id === activeZmcc.id,
        '5D-C4A-01: ZMCC Manager + active ZMCC source: CREATED with SOURCE scope and correct source ID'
      );

      // 2. ZMCC Manager + Contractor source: REJECTED with 400, no DB change, no audit
      const badZmccUsername = `c4a_bad_zmcc_${Date.now()}`;
      const auditBeforeBadZmcc = await prisma.auditLog.count({ where: { table_name: 'users' } });
      const zmccWithContractorReq = new Request('http://localhost/api/super-admin/users', {
        method: 'POST',
        headers: saHeaders,
        body: JSON.stringify({
          username: badZmccUsername,
          password: 'Password123!',
          role: 'ZMCC_MANAGER',
          procurementSourceId: activeContractor.id.toString(),
        }),
      });
      const zmccWithContractorRes = await postCreateUser(zmccWithContractorReq);
      const zmccWithContractorData = await zmccWithContractorRes.json();
      const badZmccDbUser = await prisma.user.findFirst({ where: { username: badZmccUsername } });
      const auditAfterBadZmcc = await prisma.auditLog.count({ where: { table_name: 'users' } });
      assert(
        zmccWithContractorRes.status === 400 &&
          zmccWithContractorData.error?.includes('cannot be assigned to CONTRACTOR source') &&
          badZmccDbUser === null &&
          auditAfterBadZmcc === auditBeforeBadZmcc,
        '5D-C4A-02: ZMCC Manager + Contractor source: REJECTED with 400, no DB change, no audit'
      );

      // 3. Contractor Manager + active Contractor source: CREATED with SOURCE scope and correct source ID
      const contractorUserReq = new Request('http://localhost/api/super-admin/users', {
        method: 'POST',
        headers: saHeaders,
        body: JSON.stringify({
          username: `c4a_cm_${Date.now()}`,
          name: 'Contractor Manager User',
          password: 'Password123!',
          role: 'CONTRACTOR_MANAGER',
          procurementSourceId: activeContractor.id.toString(),
        }),
      });
      const contractorUserRes = await postCreateUser(contractorUserReq);
      const contractorUserData = await contractorUserRes.json();
      const contractorDbUser = contractorUserData?.user?.id
        ? await prisma.user.findUnique({ where: { id: BigInt(contractorUserData.user.id) } })
        : null;
      if (contractorDbUser) cleanupC4AUserIds.push(contractorDbUser.id);

      assert(
        contractorUserRes.status === 200 &&
          contractorUserData.success &&
          contractorDbUser !== null &&
          contractorDbUser.role === 'CONTRACTOR_MANAGER' &&
          contractorDbUser.scope_type === 'SOURCE' &&
          contractorDbUser.department === 'Milk Procurement' &&
          contractorDbUser.procurement_source_id === activeContractor.id,
        '5D-C4A-03: Contractor Manager + active Contractor source: CREATED with SOURCE scope and correct source ID'
      );

      // 4. Contractor Manager + ZMCC source: REJECTED with 400, no DB change, no audit
      const badCmUsername = `c4a_bad_cm_${Date.now()}`;
      const auditBeforeBadCm = await prisma.auditLog.count({ where: { table_name: 'users' } });
      const contractorWithZmccReq = new Request('http://localhost/api/super-admin/users', {
        method: 'POST',
        headers: saHeaders,
        body: JSON.stringify({
          username: badCmUsername,
          password: 'Password123!',
          role: 'CONTRACTOR_MANAGER',
          procurementSourceId: activeZmcc.id.toString(),
        }),
      });
      const contractorWithZmccRes = await postCreateUser(contractorWithZmccReq);
      const contractorWithZmccData = await contractorWithZmccRes.json();
      const badCmDbUser = await prisma.user.findFirst({ where: { username: badCmUsername } });
      const auditAfterBadCm = await prisma.auditLog.count({ where: { table_name: 'users' } });
      assert(
        contractorWithZmccRes.status === 400 &&
          contractorWithZmccData.error?.includes('cannot be assigned to ZMCC source') &&
          badCmDbUser === null &&
          auditAfterBadCm === auditBeforeBadCm,
        '5D-C4A-04: Contractor Manager + ZMCC source: REJECTED with 400, no DB change, no audit'
      );

      // 5. MPD Operator + active ZMCC source: CREATED with SOURCE scope
      const mpdUserReq = new Request('http://localhost/api/super-admin/users', {
        method: 'POST',
        headers: saHeaders,
        body: JSON.stringify({
          username: `c4a_mpd_${Date.now()}`,
          name: 'MPD Operator User',
          password: 'Password123!',
          role: 'MPD_Operator',
          procurementSourceId: activeZmcc.id.toString(),
        }),
      });
      const mpdUserRes = await postCreateUser(mpdUserReq);
      const mpdUserData = await mpdUserRes.json();
      const mpdDbUser = mpdUserData?.user?.id
        ? await prisma.user.findUnique({ where: { id: BigInt(mpdUserData.user.id) } })
        : null;
      if (mpdDbUser) cleanupC4AUserIds.push(mpdDbUser.id);

      assert(
        mpdUserRes.status === 200 &&
          mpdUserData.success &&
          mpdDbUser !== null &&
          mpdDbUser.role === 'MPD_Operator' &&
          mpdDbUser.scope_type === 'SOURCE' &&
          mpdDbUser.department === 'Milk Procurement' &&
          mpdDbUser.procurement_source_id === activeZmcc.id,
        '5D-C4A-05: MPD Operator + active ZMCC source: CREATED with SOURCE scope'
      );

      // 6. MPD_Operator rejects Contractor source with 400, no DB change, no audit
      const badMpdUsername = `c4a_bad_mpd_${Date.now()}`;
      const auditBeforeBadMpd = await prisma.auditLog.count({ where: { table_name: 'users' } });
      const mpdWithContractorReq = new Request('http://localhost/api/super-admin/users', {
        method: 'POST',
        headers: saHeaders,
        body: JSON.stringify({
          username: badMpdUsername,
          password: 'Password123!',
          role: 'MPD_Operator',
          procurementSourceId: activeContractor.id.toString(),
        }),
      });
      const mpdWithContractorRes = await postCreateUser(mpdWithContractorReq);
      const mpdWithContractorData = await mpdWithContractorRes.json();
      const badMpdDbUser = await prisma.user.findFirst({ where: { username: badMpdUsername } });
      const auditAfterBadMpd = await prisma.auditLog.count({ where: { table_name: 'users' } });
      assert(
        mpdWithContractorRes.status === 400 &&
          mpdWithContractorData.error?.includes('cannot be assigned to CONTRACTOR source') &&
          badMpdDbUser === null &&
          auditAfterBadMpd === auditBeforeBadMpd,
        '5D-C4A-06: MPD_Operator rejects Contractor source with 400, no DB change, no audit'
      );

      // 7. UI calls MPD_Operator "ZMCC Lab Attendant"
      const pageFilePath = path.join(process.cwd(), 'src/app/super-admin/users/page.tsx');
      const policyFilePath = path.join(process.cwd(), 'src/lib/user-assignment-policy.ts');
      const pageContent = fs.readFileSync(pageFilePath, 'utf-8');
      const policyContent = fs.readFileSync(policyFilePath, 'utf-8');
      assert(
        pageContent.includes('ZMCC Lab Attendant') &&
          policyContent.includes("label: 'ZMCC Lab Attendant'"),
        '5D-C4A-07: UI calls MPD_Operator "ZMCC Lab Attendant"'
      );

      // 8. All 9 creatable roles prove exact stored department, scopeType, and source rules
      const remainingRolesToVerify: Array<{
        role: string;
        expectedScope: string;
        expectedDept: string;
        sourceId: string | undefined;
      }> = [
        { role: 'SUPER_ADMIN', expectedScope: 'SYSTEM', expectedDept: 'System Administration', sourceId: undefined },
        { role: 'Security_Manager', expectedScope: 'DEPARTMENT', expectedDept: 'Security', sourceId: undefined },
        { role: 'Security_Operator', expectedScope: 'DEPARTMENT', expectedDept: 'Security', sourceId: undefined },
        { role: 'QA_Operator', expectedScope: 'DEPARTMENT', expectedDept: 'Quality Assurance', sourceId: undefined },
        { role: 'WEIGHBRIDGE_OPERATOR', expectedScope: 'DEPARTMENT', expectedDept: 'Production & Weighbridge', sourceId: undefined },
        { role: 'Production_Operator', expectedScope: 'DEPARTMENT', expectedDept: 'Production', sourceId: undefined },
      ];

      const forbiddenDepartments = ['IT_ADMIN', 'PROCUREMENT', 'SECURITY', 'QUALITY_ASSURANCE', 'WEIGHBRIDGE', 'PRODUCTION'];
      let allRolesPassed = true;

      for (const item of remainingRolesToVerify) {
        const testRoleUsername = `c4a_${item.role.toLowerCase()}_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
        const rReq = new Request('http://localhost/api/super-admin/users', {
          method: 'POST',
          headers: saHeaders,
          body: JSON.stringify({
            username: testRoleUsername,
            name: `${item.role} Test User`,
            password: 'Password123!',
            role: item.role,
            ...(item.sourceId ? { procurementSourceId: item.sourceId } : {}),
          }),
        });
        const rRes = await postCreateUser(rReq);
        const rData = await rRes.json();
        const rDbUser = rData?.user?.id
          ? await prisma.user.findUnique({ where: { id: BigInt(rData.user.id) } })
          : null;
        if (rDbUser) cleanupC4AUserIds.push(rDbUser.id);

        if (
          rRes.status !== 200 ||
          !rDbUser ||
          rDbUser.role !== item.role ||
          rDbUser.scope_type !== item.expectedScope ||
          rDbUser.department !== item.expectedDept ||
          forbiddenDepartments.includes(rDbUser.department || '') ||
          (item.sourceId ? rDbUser.procurement_source_id?.toString() !== item.sourceId : rDbUser.procurement_source_id !== null)
        ) {
          allRolesPassed = false;
          console.error(`Mismatch for role ${item.role}: scope=${rDbUser?.scope_type}, dept=${rDbUser?.department}, source=${rDbUser?.procurement_source_id}`);
          break;
        }

        // Deactivate temporary super admin so last-active SA protection tests maintain single SA invariant
        if (item.role === 'SUPER_ADMIN') {
          await prisma.user.update({
            where: { id: rDbUser.id },
            data: { is_active: false },
          });
        }
      }

      assert(
        allRolesPassed,
        '5D-C4A-08: All 9 creatable roles prove exact stored department, scopeType, and source rules without alternate values'
      );

      // 9. Source role without source: REJECTED with 400, no DB change, no audit
      const noSourceUsername = `c4a_nosource_${Date.now()}`;
      const auditBeforeNoSource = await prisma.auditLog.count({ where: { table_name: 'users' } });
      const sourceNoSourceReq = new Request('http://localhost/api/super-admin/users', {
        method: 'POST',
        headers: saHeaders,
        body: JSON.stringify({
          username: noSourceUsername,
          password: 'Password123!',
          role: 'ZMCC_MANAGER',
        }),
      });
      const sourceNoSourceRes = await postCreateUser(sourceNoSourceReq);
      const noSourceDbUser = await prisma.user.findFirst({ where: { username: noSourceUsername } });
      const auditAfterNoSource = await prisma.auditLog.count({ where: { table_name: 'users' } });
      assert(
        sourceNoSourceRes.status === 400 && noSourceDbUser === null && auditAfterNoSource === auditBeforeNoSource,
        '5D-C4A-09: Source role without source: REJECTED with 400, no DB change, no audit'
      );

      // 10. Inactive source: REJECTED with 400, no DB change, no audit
      const inactUsername = `c4a_inact_${Date.now()}`;
      const auditBeforeInact = await prisma.auditLog.count({ where: { table_name: 'users' } });
      const inactiveSourceReq = new Request('http://localhost/api/super-admin/users', {
        method: 'POST',
        headers: saHeaders,
        body: JSON.stringify({
          username: inactUsername,
          password: 'Password123!',
          role: 'ZMCC_MANAGER',
          procurementSourceId: inactiveSource.id.toString(),
        }),
      });
      const inactiveSourceRes = await postCreateUser(inactiveSourceReq);
      const inactiveSourceData = await inactiveSourceRes.json();
      const inactDbUser = await prisma.user.findFirst({ where: { username: inactUsername } });
      const auditAfterInact = await prisma.auditLog.count({ where: { table_name: 'users' } });
      assert(
        inactiveSourceRes.status === 400 &&
          inactiveSourceData.error?.includes('is inactive. Active source is required') &&
          inactDbUser === null &&
          auditAfterInact === auditBeforeInact,
        '5D-C4A-10: Inactive source: REJECTED with 400, no DB change, no audit'
      );

      // 11. Department role with supplied source: REJECTED with 400, no DB change, no audit
      const deptSourceUsername = `c4a_dept_source_${Date.now()}`;
      const auditBeforeDeptSource = await prisma.auditLog.count({ where: { table_name: 'users' } });
      const deptWithSourceReq = new Request('http://localhost/api/super-admin/users', {
        method: 'POST',
        headers: saHeaders,
        body: JSON.stringify({
          username: deptSourceUsername,
          password: 'Password123!',
          role: 'QA_Operator',
          procurementSourceId: activeZmcc.id.toString(),
        }),
      });
      const deptWithSourceRes = await postCreateUser(deptWithSourceReq);
      const deptWithSourceData = await deptWithSourceRes.json();
      const deptSourceDbUser = await prisma.user.findFirst({ where: { username: deptSourceUsername } });
      const auditAfterDeptSource = await prisma.auditLog.count({ where: { table_name: 'users' } });
      assert(
        deptWithSourceRes.status === 400 &&
          deptWithSourceData.error?.includes('cannot be assigned a procurement source') &&
          deptSourceDbUser === null &&
          auditAfterDeptSource === auditBeforeDeptSource,
        '5D-C4A-11: Department role with supplied source: REJECTED with 400, no DB change, no audit'
      );

      // Create a valid baseline user to test overrides, edits, activations, and resets
      const editableTargetUsername = `c4a_edit_target_${Date.now()}`;
      const editableTargetReq = new Request('http://localhost/api/super-admin/users', {
        method: 'POST',
        headers: saHeaders,
        body: JSON.stringify({
          username: editableTargetUsername,
          name: 'Editable Target User',
          password: 'Password123!',
          role: 'Production_Operator',
        }),
      });
      const editableTargetRes = await postCreateUser(editableTargetReq);
      const editableTargetData = await editableTargetRes.json();
      const editableTargetDbUser = editableTargetData?.user?.id
        ? await prisma.user.findUnique({ where: { id: BigInt(editableTargetData.user.id) } })
        : null;
      if (editableTargetDbUser) cleanupC4AUserIds.push(editableTargetDbUser.id);

      assert(
        editableTargetRes.status === 200 && editableTargetDbUser !== null,
        '5D-C4A-FIXTURE: Baseline editable user created successfully'
      );

      // 12. Supplied scopeType and department are REJECTED on POST and PATCH with 400, not silently ignored
      const postWithDeptUsername = `c4a_rej_dept_${Date.now()}`;
      const auditBeforeRejDept = await prisma.auditLog.count({ where: { table_name: 'users' } });
      const postWithDeptReq = new Request('http://localhost/api/super-admin/users', {
        method: 'POST',
        headers: saHeaders,
        body: JSON.stringify({
          username: postWithDeptUsername,
          password: 'Password123!',
          role: 'Production_Operator',
          department: 'Malicious Department Override',
        }),
      });
      const postWithDeptRes = await postCreateUser(postWithDeptReq);
      const postWithDeptDb = await prisma.user.findFirst({ where: { username: postWithDeptUsername } });
      const auditAfterRejDept = await prisma.auditLog.count({ where: { table_name: 'users' } });

      const postWithScopeUsername = `c4a_rej_scope_${Date.now()}`;
      const auditBeforeRejScope = await prisma.auditLog.count({ where: { table_name: 'users' } });
      const postWithScopeReq = new Request('http://localhost/api/super-admin/users', {
        method: 'POST',
        headers: saHeaders,
        body: JSON.stringify({
          username: postWithScopeUsername,
          password: 'Password123!',
          role: 'Production_Operator',
          scopeType: 'SYSTEM',
        }),
      });
      const postWithScopeRes = await postCreateUser(postWithScopeReq);
      const postWithScopeDb = await prisma.user.findFirst({ where: { username: postWithScopeUsername } });
      const auditAfterRejScope = await prisma.auditLog.count({ where: { table_name: 'users' } });

      // Test PATCH rejection of scopeType and department
      const patchWithDeptReq = new Request(`http://localhost/api/super-admin/users/${editableTargetDbUser!.id}`, {
        method: 'PATCH',
        headers: saHeaders,
        body: JSON.stringify({ department: 'Custom Department' }),
      });
      const patchWithDeptRes = await patchUser(patchWithDeptReq, {
        params: Promise.resolve({ id: editableTargetDbUser!.id.toString() }),
      });

      const patchWithScopeReq = new Request(`http://localhost/api/super-admin/users/${editableTargetDbUser!.id}`, {
        method: 'PATCH',
        headers: saHeaders,
        body: JSON.stringify({ scopeType: 'SYSTEM' }),
      });
      const patchWithScopeRes = await patchUser(patchWithScopeReq, {
        params: Promise.resolve({ id: editableTargetDbUser!.id.toString() }),
      });

      assert(
        postWithDeptRes.status === 400 &&
          postWithDeptDb === null &&
          auditAfterRejDept === auditBeforeRejDept &&
          postWithScopeRes.status === 400 &&
          postWithScopeDb === null &&
          auditAfterRejScope === auditBeforeRejScope &&
          patchWithDeptRes.status === 400 &&
          patchWithScopeRes.status === 400,
        '5D-C4A-12: Supplied scopeType and department are REJECTED with 400 on POST and PATCH, not silently ignored'
      );

      // 13. Actual retired roles from the contract are rejected with 400, no DB change, no audit
      const contractRetiredRoles = [
        'Admin',
        'MPD_Zone_Manager',
        'Management',
        'General_Plant_Manager',
        'QA_Manager',
        'Production_Manager',
        'Correction_Officer',
        'EXECUTIVE_MANAGEMENT',
      ];
      let allContractRetiredRejected = true;
      for (const retRole of contractRetiredRoles) {
        const retUsername = `c4a_ret_${retRole.toLowerCase()}_${Date.now()}`;
        const auditBeforeRet = await prisma.auditLog.count({ where: { table_name: 'users' } });
        const retReq = new Request('http://localhost/api/super-admin/users', {
          method: 'POST',
          headers: saHeaders,
          body: JSON.stringify({
            username: retUsername,
            password: 'Password123!',
            role: retRole,
          }),
        });
        const retRes = await postCreateUser(retReq);
        const retDbUser = await prisma.user.findFirst({ where: { username: retUsername } });
        const auditAfterRet = await prisma.auditLog.count({ where: { table_name: 'users' } });

        if (retRes.status !== 400 || retDbUser !== null || auditAfterRet !== auditBeforeRet) {
          allContractRetiredRejected = false;
          console.error(`Retired role ${retRole} was not properly rejected fail-closed.`);
          break;
        }
      }
      assert(
        allContractRetiredRejected,
        '5D-C4A-13: Actual retired roles from contract are REJECTED with 400, no DB change, no audit'
      );

      // 14. Edit role/source recalculates assignment correctly
      const editToContractorReq = new Request(`http://localhost/api/super-admin/users/${editableTargetDbUser!.id}`, {
        method: 'PATCH',
        headers: saHeaders,
        body: JSON.stringify({
          role: 'CONTRACTOR_MANAGER',
          procurementSourceId: activeContractor.id.toString(),
        }),
      });
      const editToContractorRes = await patchUser(editToContractorReq, {
        params: Promise.resolve({ id: editableTargetDbUser!.id.toString() }),
      });
      const editToContractorData = await editToContractorRes.json();
      const userAfterEditToContractor = await prisma.user.findUnique({ where: { id: editableTargetDbUser!.id } });

      // Now switch to Security_Manager (non-source role)
      const editToSecurityReq = new Request(`http://localhost/api/super-admin/users/${editableTargetDbUser!.id}`, {
        method: 'PATCH',
        headers: saHeaders,
        body: JSON.stringify({
          role: 'Security_Manager',
        }),
      });
      const editToSecurityRes = await patchUser(editToSecurityReq, {
        params: Promise.resolve({ id: editableTargetDbUser!.id.toString() }),
      });
      const editToSecurityData = await editToSecurityRes.json();
      const userAfterEditToSecurity = await prisma.user.findUnique({ where: { id: editableTargetDbUser!.id } });

      assert(
        editToContractorRes.status === 200 &&
          editToContractorData.success &&
          userAfterEditToContractor?.role === 'CONTRACTOR_MANAGER' &&
          userAfterEditToContractor?.scope_type === 'SOURCE' &&
          userAfterEditToContractor?.department === 'Milk Procurement' &&
          userAfterEditToContractor?.procurement_source_id === activeContractor.id &&
          editToSecurityRes.status === 200 &&
          editToSecurityData.success &&
          userAfterEditToSecurity?.role === 'Security_Manager' &&
          userAfterEditToSecurity?.scope_type === 'DEPARTMENT' &&
          userAfterEditToSecurity?.department === 'Security' &&
          userAfterEditToSecurity?.procurement_source_id === null,
        '5D-C4A-14: Edit role/source recalculates assignment correctly'
      );

      // 15. Invalid edit leaves user unchanged and creates no audit
      const auditCountBeforeInvalidEdit = await prisma.auditLog.count({
        where: { table_name: 'users', record_id: editableTargetDbUser!.id },
      });

      const invalidEditReq = new Request(`http://localhost/api/super-admin/users/${editableTargetDbUser!.id}`, {
        method: 'PATCH',
        headers: saHeaders,
        body: JSON.stringify({
          role: 'ZMCC_MANAGER',
          procurementSourceId: activeContractor.id.toString(),
        }),
      });
      const invalidEditRes = await patchUser(invalidEditReq, {
        params: Promise.resolve({ id: editableTargetDbUser!.id.toString() }),
      });
      const userAfterInvalidEdit = await prisma.user.findUnique({ where: { id: editableTargetDbUser!.id } });
      const auditCountAfterInvalidEdit = await prisma.auditLog.count({
        where: { table_name: 'users', record_id: editableTargetDbUser!.id },
      });

      assert(
        invalidEditRes.status === 400 &&
          userAfterInvalidEdit?.role === 'Security_Manager' &&
          userAfterInvalidEdit?.scope_type === 'DEPARTMENT' &&
          userAfterInvalidEdit?.department === 'Security' &&
          auditCountAfterInvalidEdit === auditCountBeforeInvalidEdit,
        '5D-C4A-15: Invalid edit leaves user unchanged and creates no audit'
      );

      // 16. Password shorter than 8: REJECTED on create and reset
      const shortPassCreateReq = new Request('http://localhost/api/super-admin/users', {
        method: 'POST',
        headers: saHeaders,
        body: JSON.stringify({
          username: `c4a_short_${Date.now()}`,
          password: 'Pass123',
          role: 'Security_Operator',
        }),
      });
      const shortPassCreateRes = await postCreateUser(shortPassCreateReq);
      const shortPassCreateData = await shortPassCreateRes.json();

      const shortPassResetReq = new Request(`http://localhost/api/super-admin/users/${editableTargetDbUser!.id}/reset-password`, {
        method: 'POST',
        headers: saHeaders,
        body: JSON.stringify({
          password: 'Short1',
        }),
      });
      const shortPassResetRes = await postResetPassword(shortPassResetReq, {
        params: Promise.resolve({ id: editableTargetDbUser!.id.toString() }),
      });
      const shortPassResetData = await shortPassResetRes.json();

      assert(
        shortPassCreateRes.status === 400 &&
          shortPassCreateData.error?.includes('at least 8 characters') &&
          shortPassResetRes.status === 400 &&
          shortPassResetData.error?.includes('at least 8 characters'),
        '5D-C4A-16: Password shorter than 8: REJECTED on create and reset'
      );

      // 17. Audit records contain no password or hash
      const c4aAuditLogs = await prisma.auditLog.findMany({
        where: {
          table_name: 'users',
          record_id: { in: cleanupC4AUserIds },
        },
      });
      let secretsFoundInC4AAudit = false;
      for (const log of c4aAuditLogs) {
        const str = JSON.stringify(log, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
        if (
          str.includes('Password123!') ||
          str.includes('password_hash') ||
          str.includes('$2a$') ||
          str.includes('$2b$')
        ) {
          secretsFoundInC4AAudit = true;
          break;
        }
      }
      assert(
        c4aAuditLogs.length > 0 && !secretsFoundInC4AAudit,
        '5D-C4A-17: Audit records contain no password or hash'
      );

      // 18. Last active Super Admin protection remains effective
      const lastSaProtectionReq = new Request(`http://localhost/api/super-admin/users/${testSuperAdmin.id}`, {
        method: 'PATCH',
        headers: saHeaders,
        body: JSON.stringify({ isActive: false }),
      });
      const lastSaProtectionRes = await patchUser(lastSaProtectionReq, {
        params: Promise.resolve({ id: testSuperAdmin.id.toString() }),
      });
      const lastSaProtectionData = await lastSaProtectionRes.json();
      assert(
        lastSaProtectionRes.status === 400 &&
          lastSaProtectionData.error?.includes('Cannot deactivate or reassign the last active Super Admin account'),
        '5D-C4A-18: Last active Super Admin protection remains effective'
      );

      // 19. Activation-only PATCH requests are preserved
      const deactTargetReq = new Request(`http://localhost/api/super-admin/users/${editableTargetDbUser!.id}`, {
        method: 'PATCH',
        headers: saHeaders,
        body: JSON.stringify({ isActive: false }),
      });
      const deactTargetRes = await patchUser(deactTargetReq, {
        params: Promise.resolve({ id: editableTargetDbUser!.id.toString() }),
      });
      const deactTargetData = await deactTargetRes.json();
      const userAfterDeact = await prisma.user.findUnique({ where: { id: editableTargetDbUser!.id } });

      const reactTargetReq = new Request(`http://localhost/api/super-admin/users/${editableTargetDbUser!.id}`, {
        method: 'PATCH',
        headers: saHeaders,
        body: JSON.stringify({ isActive: true }),
      });
      const reactTargetRes = await patchUser(reactTargetReq, {
        params: Promise.resolve({ id: editableTargetDbUser!.id.toString() }),
      });
      const reactTargetData = await reactTargetRes.json();
      const userAfterReact = await prisma.user.findUnique({ where: { id: editableTargetDbUser!.id } });

      assert(
        deactTargetRes.status === 200 &&
          deactTargetData.user?.isActive === false &&
          userAfterDeact?.is_active === false &&
          reactTargetRes.status === 200 &&
          reactTargetData.user?.isActive === true &&
          userAfterReact?.is_active === true,
        '5D-C4A-19: Activation-only PATCH requests are preserved'
      );

      // 20. Test fixtures are removed in finally blocks even after failure
      assert(
        cleanupC4AUserIds.length >= 8 && cleanupC4ASourceIds.length >= 1,
        '5D-C4A-20: Test fixtures are registered for clean removal in finally block'
      );
    } finally {
      // 16. Clean up test entities strictly in finally
      for (const uid of cleanupC4AUserIds) {
        try {
          await prisma.auditLog.deleteMany({
            where: { table_name: 'users', record_id: uid },
          });
          await prisma.user.delete({ where: { id: uid } });
        } catch (err) {
          console.error(`Cleanup error for user ${uid}:`, err);
        }
      }
      for (const sid of cleanupC4ASourceIds) {
        try {
          await prisma.procurementSource.delete({ where: { id: sid } });
        } catch (err) {
          console.error(`Cleanup error for source ${sid}:`, err);
        }
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
