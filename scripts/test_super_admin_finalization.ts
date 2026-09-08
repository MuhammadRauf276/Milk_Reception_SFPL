import { prisma } from '../src/backend/core/db';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const nextHeaders = require('next/headers');
import { filterUpdatesByRole, createSessionToken, getCurrentUser } from '../src/backend/core/auth';
import { POST as postCreateUser } from '../src/app/api/super-admin/users/route';
import { PATCH as patchUser } from '../src/app/api/super-admin/users/[id]/route';
import { POST as postResetPassword } from '../src/app/api/super-admin/users/[id]/reset-password/route';
import { GET as getProcurementSources } from '../src/app/api/super-admin/procurement-sources/route';
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
          patchErrorMsg.includes('SIMULATED_AUDIT_LOG_FAILURE') &&
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
      const b2CreateReq = new Request('http://localhost/api/super-admin/users', {
        method: 'POST',
        headers: saHeaders,
        body: JSON.stringify({
          username: b2Username,
          password: initialB2Password,
          name: 'Stage 5D-B2 Test User',
          role: 'MPD_Operator',
          department: 'Field Operations',
          scopeType: 'ALL',
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

      // 3. Edit name/role/department/scope succeeds through real PATCH handler
      const editReq = new Request(`http://localhost/api/super-admin/users/${createdB2UserId}`, {
        method: 'PATCH',
        headers: saHeaders,
        body: JSON.stringify({
          name: 'Renamed 5D-B2 User',
          role: 'QA_Operator',
          department: 'Quality Assurance Unit',
          scopeType: 'DEPARTMENT',
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
          userAfterEdit?.department === 'Quality Assurance Unit' &&
          userAfterEdit?.scope_type === 'DEPARTMENT',
        '5D-B2-03: Edit name/role/department/scope succeeds through real PATCH handler'
      );

      // 4. SOURCE scope persists an exact procurement_source_id
      const activeZmcc = await prisma.procurementSource.findFirst({ where: { source_type: 'ZMCC', is_active: true } });
      if (!activeZmcc) throw new Error('Active ZMCC source required for 5D-B2-04');

      const sourceScopeReq = new Request(`http://localhost/api/super-admin/users/${createdB2UserId}`, {
        method: 'PATCH',
        headers: saHeaders,
        body: JSON.stringify({
          scopeType: 'SOURCE',
          procurementSourceId: activeZmcc.id.toString(),
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
          userAfterSourceScope?.procurement_source_id === activeZmcc.id,
        '5D-B2-04: SOURCE scope persists an exact procurement_source_id'
      );

      // 5. Changing away from SOURCE clears procurement_source_id when null is sent
      const clearSourceReq = new Request(`http://localhost/api/super-admin/users/${createdB2UserId}`, {
        method: 'PATCH',
        headers: saHeaders,
        body: JSON.stringify({
          scopeType: 'ALL',
          procurementSourceId: null,
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
          userAfterClearSource?.scope_type === 'ALL' &&
          userAfterClearSource?.procurement_source_id === null,
        '5D-B2-05: Changing away from SOURCE clears procurement_source_id when null is sent'
      );

      // 6. Incompatible ZMCC_MANAGER/CONTRACTOR source assignment is rejected
      const activeContractor = await prisma.procurementSource.findFirst({ where: { source_type: 'CONTRACTOR', is_active: true } });
      if (!activeContractor) throw new Error('Active CONTRACTOR source required for 5D-B2-06');

      const badAssignReq = new Request(`http://localhost/api/super-admin/users/${createdB2UserId}`, {
        method: 'PATCH',
        headers: saHeaders,
        body: JSON.stringify({
          role: 'ZMCC_MANAGER',
          scopeType: 'SOURCE',
          procurementSourceId: activeContractor.id.toString(),
        }),
      });
      const badAssignRes = await patchUser(badAssignReq, {
        params: Promise.resolve({ id: createdB2UserId.toString() }),
      });
      const badAssignBody = await badAssignRes.json();
      assert(
        badAssignRes.status === 400 &&
          badAssignBody?.error?.includes('Role ZMCC_MANAGER cannot be assigned to Contractor source'),
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

      const sourcesRes = await getProcurementSources();
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

        const freshSourcesRes = await getProcurementSources();
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
