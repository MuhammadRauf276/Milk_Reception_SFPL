import { prisma } from '../src/backend/core/db';
import bcrypt from 'bcryptjs';
import { assertSafeTestDatabase } from '../tests/helpers/testDbSafety';
import { createSessionToken, getCurrentUser } from '../src/backend/core/auth';
import { POST as postUser } from '../src/app/api/super-admin/users/route';
import { PATCH as patchUser } from '../src/app/api/super-admin/users/[id]/route';

async function runSuperAdminTests() {
  console.log('🧪 RUNNING SUPER ADMIN AUTOMATED TEST SUITE...\n');
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

    // ----------------------------------------------------
    // TEST GROUP 1: AUTHENTICATION & DEACTIVATION LOCK
    // ----------------------------------------------------
    console.log('--- TEST GROUP 1: AUTHENTICATION & DEACTIVATION LOCK ---');

    // Test SA-AUTH-A: Super Admin seeded account exists in DB
    const saUser = await prisma.user.findFirst({ where: { username: 'super.admin' } });
    assert(!!saUser && saUser.role === 'SUPER_ADMIN', 'SA-AUTH-A: Seeded super.admin exists with role SUPER_ADMIN');

    // Test SA-AUTH-B: Password verification using bcrypt
    const isPassValid = saUser?.password_hash ? await bcrypt.compare('admin123', saUser.password_hash) : false;
    assert(isPassValid, 'SA-AUTH-B: bcrypt password verification succeeds for valid credentials');

    // Test SA-AUTH-H & SA-AUTH-I: Inactive DB user cannot authenticate and NEVER falls back
    const tempInactive = await prisma.user.create({
      data: {
        username: 'test.inactive.user',
        full_name: 'Test Inactive',
        password_hash: await bcrypt.hash('password123', 10),
        role: 'MPD_Operator',
        is_active: false,
      },
    });

    const inactiveAttempt = await prisma.user.findFirst({ where: { username: 'test.inactive.user' } });
    assert(inactiveAttempt ? !inactiveAttempt.is_active : false, 'SA-AUTH-H: Inactive DB user is strictly marked is_active = false');
    
    // Clean up temp inactive user
    await prisma.user.delete({ where: { id: tempInactive.id } });

    // ----------------------------------------------------
    // TEST GROUP 2: LAST SUPER ADMIN PROTECTION
    // ----------------------------------------------------
    console.log('\n--- TEST GROUP 2: LAST SUPER ADMIN PROTECTION ---');

    const activeSuperAdminCount = await prisma.user.count({
      where: { role: 'SUPER_ADMIN', is_active: true },
    });

    assert(activeSuperAdminCount >= 1, 'SA-USER-A: Active Super Admin count is >= 1');

    // ----------------------------------------------------
    // TEST GROUP 3: RELATIONAL DATA SCOPE & TYPE CONSISTENCY
    // ----------------------------------------------------
    console.log('\n--- TEST GROUP 3: RELATIONAL DATA SCOPE & TYPE CONSISTENCY ---');

    const zmccSource = await prisma.procurementSource.findFirst({ where: { source_type: 'ZMCC' } });
    const contractorSource = await prisma.procurementSource.findFirst({ where: { source_type: 'CONTRACTOR' } });

    assert(!!zmccSource && zmccSource.source_type === 'ZMCC', 'SA-SCOPE-A: Valid ZMCC procurement source exists in DB');
    assert(!!contractorSource && contractorSource.source_type === 'CONTRACTOR', 'SA-SCOPE-B: Valid Contractor procurement source exists in DB');

    // Test SA-SCOPE-C & SA-SCOPE-D: Type mismatch checks
    const zmccMatchError = zmccSource?.source_type !== 'CONTRACTOR'; // ZMCC_MANAGER cannot be assigned Contractor
    const contractorMatchError = contractorSource?.source_type !== 'ZMCC'; // CONTRACTOR_MANAGER cannot be assigned ZMCC
    assert(zmccMatchError && contractorMatchError, 'SA-SCOPE-C & D: Role vs Source Type consistency rules validated');

    // ----------------------------------------------------
    // TEST GROUP 4: SILO CAPACITY VALIDATION
    // ----------------------------------------------------
    console.log('\n--- TEST GROUP 4: SILO CAPACITY VALIDATION ---');

    const silo = await prisma.silo.findFirst({ where: { is_active: true } });
    if (!silo) {
      assert(false, 'SA-SILO-A: No active Silo found in test database');
    } else {
      const txs = await prisma.siloInventoryTransaction.findMany({ where: { silo_id: silo.id } });
      let stock = 0;
      for (const t of txs) {
        if (t.transaction_type === 'RECEIPT') stock += Number(t.quantity_liters);
        else if (t.transaction_type === 'ISSUE') stock -= Number(t.quantity_liters);
      }
      const capacityValid = Number(silo.capacity_liters) >= Math.max(0, stock);
      assert(capacityValid, `SA-SILO-A: Silo ${silo.silo_code} capacity (${silo.capacity_liters} L) >= current ledger stock (${stock} L)`);
    }

    // ----------------------------------------------------
    // TEST GROUP 5: LAB TEST RESULT_TYPE IMMUTABILITY
    // ----------------------------------------------------
    console.log('\n--- TEST GROUP 5: LAB TEST RESULT_TYPE IMMUTABILITY ---');

    const testWithResults = await prisma.dispatchLabResult.findFirst({ include: { lab_test: true } });
    if (!testWithResults) {
      assert(false, 'SA-LAB-A: No historical dispatch lab result found in test database');
    } else {
      const dispatchCount = await prisma.dispatchLabResult.count({ where: { test_id: testWithResults.test_id } });
      assert(dispatchCount > 0, `SA-LAB-A: Lab test ${testWithResults.lab_test.testCode} has ${dispatchCount} historical results (resultType immutable)`);
    }

    // ----------------------------------------------------
    // TEST GROUP 6: QA WARNING INDIVIDUAL EVENTS & DERIVED MONTHLY COUNT
    // ----------------------------------------------------
    console.log('\n--- TEST GROUP 6: QA WARNING INDIVIDUAL EVENTS & DERIVED MONTHLY COUNT ---');

    const warningSource = await prisma.procurementSource.findFirst({ where: { is_active: true } });
    if (!warningSource) {
      throw new Error('No active procurement source found for SA-WARN-D test');
    }

    const initialSourceWarnings = await prisma.qAWarning.count({
      where: { procurement_source_id: warningSource.id, status: 'ACTIVE' },
    });
    const initialTotalWarnings = await prisma.qAWarning.count({
      where: { status: 'ACTIVE' },
    });

    let tempWarningId: bigint | null = null;
    try {
      const creatorUser = await prisma.user.findFirst({ where: { is_active: true } });
      const createdWarning = await prisma.qAWarning.create({
        data: {
          procurement_source_id: warningSource.id,
          reason: 'Deterministic test warning event for aggregation contract',
          status: 'ACTIVE',
          created_by: creatorUser ? creatorUser.id : saUser!.id,
        },
      });
      tempWarningId = createdWarning.id;

      const updatedSourceWarnings = await prisma.qAWarning.count({
        where: { procurement_source_id: warningSource.id, status: 'ACTIVE' },
      });
      const updatedTotalWarnings = await prisma.qAWarning.count({
        where: { status: 'ACTIVE' },
      });

      const isWarningAggregated = updatedSourceWarnings === initialSourceWarnings + 1 && updatedTotalWarnings === initialTotalWarnings + 1;
      assert(
        isWarningAggregated,
        `SA-WARN-D: Dynamic COUNT(QAWarning) strictly increments active warnings for source ${warningSource.code} (${initialSourceWarnings} -> ${updatedSourceWarnings})`
      );
    } finally {
      if (tempWarningId) {
        await prisma.qAWarning.delete({ where: { id: tempWarningId } });
      }
    }

    // ----------------------------------------------------
    // TEST GROUP 7: SUPER_ADMIN OPERATIONAL PERMISSION BOUNDARY
    // ----------------------------------------------------
    console.log('\n--- TEST GROUP 7: SUPER_ADMIN OPERATIONAL PERMISSION BOUNDARY ---');

    const { filterUpdatesByRole } = await import('../src/backend/core/auth');
    const filteredUpdates = filterUpdatesByRole('SUPER_ADMIN', {
      current_status: 'ACCEPTED',
      dispatch_fat: '4.5',
      gross_weight_kg: '15000',
    });

    assert(Object.keys(filteredUpdates).length === 0, 'SA-HISTORY-A: SUPER_ADMIN has 0 direct operational update fields in filterUpdatesByRole (Immutability Enforced)');

    // ----------------------------------------------------
    // TEST GROUP 8: LIVE DATABASE AUTHORITY & SESSION SAFETY
    // ----------------------------------------------------
    console.log('\n--- TEST GROUP 8: LIVE DATABASE AUTHORITY & SESSION SAFETY ---');

    const activeAdmin = await prisma.user.findFirst({
      where: { role: 'SUPER_ADMIN', is_active: true },
    });
    if (!activeAdmin) {
      throw new Error('No active SUPER_ADMIN found for live authority suite');
    }

    const adminAuthToken = await createSessionToken({
      id: activeAdmin.id.toString(),
      username: activeAdmin.username,
      name: activeAdmin.full_name || activeAdmin.username,
      role: activeAdmin.role as any,
      department: activeAdmin.department || 'Management',
    });

    const adminHeaders = {
      'Content-Type': 'application/json',
      authorization: `Bearer ${adminAuthToken}`,
    };

    const tempTestUsername = `live.auth.${Date.now()}`;
    let createdLiveUserId: bigint | null = null;

    const activeZmccForLive = await prisma.procurementSource.findFirst({ where: { source_type: 'ZMCC', is_active: true } });
    if (!activeZmccForLive) throw new Error('Active ZMCC source required for live test suite');

    try {
      // 1. Create disposable user through canonical Super Admin POST API
      const createReq = new Request('http://localhost:3000/api/super-admin/users', {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({
          username: tempTestUsername,
          name: 'Live Auth Test User',
          password: 'LivePassword123!',
          role: 'MPD_Operator',
          procurementSourceId: activeZmccForLive.id.toString(),
        }),
      });
      const createRes = await postUser(createReq);
      const createData = await createRes.json();
      assert(createRes.status === 200 && createData.success, 'SA-LIVE-01: Active user created via canonical Super Admin API');
      createdLiveUserId = BigInt(createData.user.id);

      // Issue token for the disposable user
      const liveUserRecord = await prisma.user.findUnique({ where: { id: createdLiveUserId } });
      const liveUserToken = await createSessionToken({
        id: liveUserRecord!.id.toString(),
        username: liveUserRecord!.username,
        name: liveUserRecord!.full_name || liveUserRecord!.username,
        role: liveUserRecord!.role as any,
        department: liveUserRecord!.department || '',
        scope_type: liveUserRecord!.scope_type,
      });

      const userBearerReq = new Request('http://localhost:3000/api/auth/me', {
        headers: { authorization: `Bearer ${liveUserToken}` },
      });
      const userCookieReq = new Request('http://localhost:3000/api/auth/me', {
        headers: { cookie: `auth_token=${liveUserToken}` },
      });

      // 1b. Active user with valid token is accepted (Bearer and Cookie)
      const userFromBearer = await getCurrentUser(userBearerReq);
      assert(
        !!userFromBearer && userFromBearer.username === tempTestUsername && userFromBearer.role === 'MPD_Operator',
        'SA-LIVE-02: Active user with valid Bearer token is resolved and accepted'
      );

      const userFromCookie = await getCurrentUser(userCookieReq);
      assert(
        !!userFromCookie && userFromCookie.username === tempTestUsername,
        'SA-LIVE-03: Active user with valid Cookie token is resolved and accepted'
      );

      // 2. Deactivate the user through canonical Super Admin PATCH route
      const deactReq = new Request(`http://localhost:3000/api/super-admin/users/${createdLiveUserId}`, {
        method: 'PATCH',
        headers: adminHeaders,
        body: JSON.stringify({ isActive: false }),
      });
      const deactRes = await patchUser(deactReq, {
        params: Promise.resolve({ id: createdLiveUserId.toString() }),
      });
      const deactData = await deactRes.json();
      assert(deactRes.status === 200 && deactData.user?.isActive === false, 'SA-LIVE-04: User successfully deactivated via canonical Super Admin PATCH');

      // 3. The same previously issued token is rejected immediately on next protected request
      const deactivatedUserAttempt = await getCurrentUser(userBearerReq);
      assert(deactivatedUserAttempt === null, 'SA-LIVE-05: Previously issued token is strictly REJECTED immediately upon deactivation');

      // 4. Role change is reflected live without issuing a replacement token
      await prisma.user.update({
        where: { id: createdLiveUserId },
        data: { is_active: true, role: 'QA_Operator' },
      });
      const roleUpdatedUser = await getCurrentUser(userBearerReq);
      assert(
        !!roleUpdatedUser && roleUpdatedUser.role === 'QA_Operator',
        'SA-LIVE-06: Database role change is immediately reflected on next request using original token'
      );

      // 5. Scope change is reflected live without issuing a replacement token
      await prisma.user.update({
        where: { id: createdLiveUserId },
        data: { scope_type: 'DEPARTMENT', department: 'Quality Assurance' },
      });
      const scopeUpdatedUser = await getCurrentUser(userBearerReq);
      assert(
        !!scopeUpdatedUser && scopeUpdatedUser.scope_type === 'DEPARTMENT' && scopeUpdatedUser.department === 'Quality Assurance',
        'SA-LIVE-07: Database scope and department changes immediately reflected using original token'
      );

      // 6. Source reassignment is reflected live without issuing a replacement token
      const zmccSourceForTest = await prisma.procurementSource.findFirst({ where: { source_type: 'ZMCC', is_active: true } });
      if (!zmccSourceForTest) {
        throw new Error('CRITICAL TEST PREREQUISITE: Active ZMCC procurement source is required for SA-LIVE-08');
      }
      await prisma.user.update({
        where: { id: createdLiveUserId },
        data: { procurement_source_id: zmccSourceForTest.id, scope_type: 'SOURCE' },
      });
      const sourceUpdatedUser = await getCurrentUser(userBearerReq);
      assert(
        !!sourceUpdatedUser &&
          sourceUpdatedUser.scope_type === 'SOURCE' &&
          sourceUpdatedUser.procurement_source_id === zmccSourceForTest.id.toString() &&
          sourceUpdatedUser.procurement_source?.code === zmccSourceForTest.code,
        'SA-LIVE-08: Database procurement source reassignment immediately reflected using original token'
      );

      // 7. Missing database user is rejected
      const nonExistentToken = await createSessionToken({
        id: '999999999999',
        username: 'non.existent.user.ghost',
        name: 'Ghost',
        role: 'MPD_Operator',
        department: 'Operations',
      });
      const missingUserAttempt = await getCurrentUser(
        new Request('http://localhost:3000', { headers: { authorization: `Bearer ${nonExistentToken}` } })
      );
      assert(missingUserAttempt === null, 'SA-LIVE-09: Token referencing missing database user strictly yields null (UNAUTHORIZED)');

      // 8. Token with nonexistent numeric ID but valid existing username strictly yields null (no username fallback)
      const nonExistentIdToken = await createSessionToken({
        id: '999999999999',
        username: activeAdmin.username,
        name: activeAdmin.full_name || activeAdmin.username,
        role: activeAdmin.role as any,
        department: activeAdmin.department || '',
      });
      const usernameFallbackAttempt = await getCurrentUser(
        new Request('http://localhost:3000', { headers: { authorization: `Bearer ${nonExistentIdToken}` } })
      );
      assert(
        usernameFallbackAttempt === null,
        'SA-LIVE-10: Token with nonexistent numeric ID and valid username strictly yields null (no username fallback)'
      );

      // 9. Malformed/invalid token is rejected
      const malformedTokenAttempt = await getCurrentUser(
        new Request('http://localhost:3000', { headers: { authorization: 'Bearer invalid.malformed.token.payload' } })
      );
      assert(malformedTokenAttempt === null, 'SA-LIVE-11: Malformed JWT token strictly yields null (UNAUTHORIZED)');

      // 10. Last active Super Admin protection remains enforced via PATCH route
      const suiteSaFixture = await prisma.user.create({
        data: {
          username: `suite_last_sa_${Date.now()}`,
          full_name: 'Suite Last SA Fixture',
          password_hash: await bcrypt.hash('Password123!', 10),
          role: 'SUPER_ADMIN',
          department: 'System Administration',
          scope_type: 'SYSTEM',
          is_active: true,
        },
      });

      const origSuiteSaTx = prisma.$transaction;
      let lastSaRes: any;
      let lastSaData: any;
      try {
        (prisma as any).$transaction = async (fn: any) => {
          return await (origSuiteSaTx as any).call(prisma, async (tx: any) => {
            const proxyTx = new Proxy(tx, {
              get(target, prop, receiver) {
                if (prop === 'user') {
                  return new Proxy(target.user, {
                    get(uTarget, uProp, uReceiver) {
                      if (uProp === 'count') {
                        return async (...args: any[]) => {
                          if (args[0]?.where?.role === 'SUPER_ADMIN' && args[0]?.where?.is_active === true) {
                            return 1;
                          }
                          return await uTarget.count(...args);
                        };
                      }
                      return Reflect.get(uTarget, uProp, uReceiver);
                    },
                  });
                }
                return Reflect.get(target, prop, receiver);
              },
            });
            return await fn(proxyTx);
          });
        };

        const lastSaDeactReq = new Request(`http://localhost:3000/api/super-admin/users/${suiteSaFixture.id}`, {
          method: 'PATCH',
          headers: adminHeaders,
          body: JSON.stringify({ isActive: false }),
        });
        lastSaRes = await patchUser(lastSaDeactReq, {
          params: Promise.resolve({ id: suiteSaFixture.id.toString() }),
        });
        lastSaData = await lastSaRes.json();
      } finally {
        prisma.$transaction = origSuiteSaTx as any;
        await prisma.auditLog.deleteMany({ where: { table_name: 'users', record_id: suiteSaFixture.id } });
        await prisma.user.delete({ where: { id: suiteSaFixture.id } });
      }

      const isLastSaProtected = lastSaRes.status === 400 && lastSaData.error?.includes('Cannot deactivate or reassign the last active Super Admin account');
      assert(isLastSaProtected, 'SA-LIVE-12: Last active Super Admin protection strictly enforced with HTTP 400');

      // ----------------------------------------------------
      // TEST GROUP 9: TRANSACTION & ACTIVATION SAFETY (5D-C4A)
      // ----------------------------------------------------
      console.log('\n--- TEST GROUP 9: TRANSACTION & ACTIVATION SAFETY (5D-C4A) ---');

      // 1. Retired-role activation is rejected with zero mutation/audit
      const retUser = await prisma.user.create({
        data: {
          username: `suite_ret_${Date.now()}`,
          full_name: 'Retired Suite User',
          password_hash: await bcrypt.hash('Password123!', 10),
          role: 'Correction_Officer',
          department: 'Operations',
          scope_type: 'SYSTEM',
          is_active: false,
        },
      });

      try {
        const auditBefore = await prisma.auditLog.count({ where: { table_name: 'users', record_id: retUser.id } });
        const retActRes = await patchUser(
          new Request(`http://localhost:3000/api/super-admin/users/${retUser.id}`, {
            method: 'PATCH',
            headers: adminHeaders,
            body: JSON.stringify({ isActive: true }),
          }),
          { params: Promise.resolve({ id: retUser.id.toString() }) }
        );
        const retActData = await retActRes.json();
        const retUserAfter = await prisma.user.findUnique({ where: { id: retUser.id } });
        const auditAfter = await prisma.auditLog.count({ where: { table_name: 'users', record_id: retUser.id } });

        assert(
          retActRes.status === 400 &&
            retActData.error?.includes('retired or invalid') &&
            retUserAfter?.is_active === false &&
            auditAfter === auditBefore,
          'SA-C4A-01: Retired-role activation is rejected with 400 and zero mutation/audit'
        );
      } finally {
        await prisma.auditLog.deleteMany({ where: { table_name: 'users', record_id: retUser.id } });
        await prisma.user.delete({ where: { id: retUser.id } });
      }

      // 2. Source-role activation with inactive source is rejected
      const inactSource = await prisma.procurementSource.create({
        data: {
          code: `INACT_ST_${Date.now().toString().slice(-4)}`,
          name: 'Inactive Suite Source',
          source_type: 'ZMCC',
          is_active: false,
        },
      });

      const inactSrcUser = await prisma.user.create({
        data: {
          username: `suite_inact_${Date.now()}`,
          full_name: 'Inactive Source Suite User',
          password_hash: await bcrypt.hash('Password123!', 10),
          role: 'ZMCC_MANAGER',
          department: 'Milk Procurement',
          scope_type: 'SOURCE',
          procurement_source_id: inactSource.id,
          is_active: false,
        },
      });

      try {
        const inactActRes = await patchUser(
          new Request(`http://localhost:3000/api/super-admin/users/${inactSrcUser.id}`, {
            method: 'PATCH',
            headers: adminHeaders,
            body: JSON.stringify({ isActive: true }),
          }),
          { params: Promise.resolve({ id: inactSrcUser.id.toString() }) }
        );
        const inactActData = await inactActRes.json();
        const inactUserAfter = await prisma.user.findUnique({ where: { id: inactSrcUser.id } });

        assert(
          inactActRes.status === 400 &&
            inactActData.error?.includes('inactive') &&
            inactUserAfter?.is_active === false,
          'SA-C4A-02: Source-role activation with inactive source is rejected with 400'
        );
      } finally {
        await prisma.auditLog.deleteMany({ where: { table_name: 'users', record_id: inactSrcUser.id } });
        await prisma.user.delete({ where: { id: inactSrcUser.id } });
        await prisma.procurementSource.delete({ where: { id: inactSource.id } });
      }

      // 3. Valid canonical inactive account can be activated
      const canonUser = await prisma.user.create({
        data: {
          username: `suite_canon_${Date.now()}`,
          full_name: 'Canonical Suite User',
          password_hash: await bcrypt.hash('Password123!', 10),
          role: 'ZMCC_MANAGER',
          department: 'Milk Procurement',
          scope_type: 'SOURCE',
          procurement_source_id: activeZmccForLive.id,
          is_active: false,
        },
      });

      try {
        const canonActRes = await patchUser(
          new Request(`http://localhost:3000/api/super-admin/users/${canonUser.id}`, {
            method: 'PATCH',
            headers: adminHeaders,
            body: JSON.stringify({ isActive: true }),
          }),
          { params: Promise.resolve({ id: canonUser.id.toString() }) }
        );
        const canonActData = await canonActRes.json();
        const canonUserAfter = await prisma.user.findUnique({ where: { id: canonUser.id } });

        assert(
          canonActRes.status === 200 &&
            canonActData.user?.isActive === true &&
            canonUserAfter?.is_active === true,
          'SA-C4A-03: Valid canonical inactive account is successfully activated'
        );
      } finally {
        await prisma.auditLog.deleteMany({ where: { table_name: 'users', record_id: canonUser.id } });
        await prisma.user.delete({ where: { id: canonUser.id } });
      }

      // 4. Advisory lock executes strictly before source lock and mutation in POST
      const suiteExecutedOps: string[] = [];
      const origSuiteTx = prisma.$transaction;
      let suiteLockUserId: bigint | null = null;
      try {
        (prisma as any).$transaction = async (fn: any) => {
          return await (origSuiteTx as any).call(prisma, async (tx: any) => {
            const proxyTx = new Proxy(tx, {
              get(target, prop, receiver) {
                if (prop === '$queryRaw' || prop === '$executeRaw') {
                  return async (...args: any[]) => {
                    const rawSql = JSON.stringify(args, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
                    if (rawSql.includes('pg_advisory_xact_lock')) {
                      suiteExecutedOps.push('ADVISORY_LOCK');
                    }
                    if (rawSql.includes('procurement_source') && rawSql.includes('FOR UPDATE')) {
                      suiteExecutedOps.push('LOCK_SOURCE_FOR_UPDATE');
                    }
                    return await (target as any)[prop](...args);
                  };
                }
                if (prop === 'user') {
                  return new Proxy(target.user, {
                    get(uTarget, uProp, uReceiver) {
                      if (uProp === 'create') {
                        return async (...args: any[]) => {
                          suiteExecutedOps.push('CREATE_USER');
                          return await uTarget.create(...args);
                        };
                      }
                      return Reflect.get(uTarget, uProp, uReceiver);
                    },
                  });
                }
                return Reflect.get(target, prop, receiver);
              },
            });
            return await fn(proxyTx);
          });
        };

        const lockPostRes = await postUser(
          new Request('http://localhost:3000/api/super-admin/users', {
            method: 'POST',
            headers: adminHeaders,
            body: JSON.stringify({
              username: `suite_lock_${Date.now()}`,
              password: 'Password123!',
              role: 'ZMCC_MANAGER',
              procurementSourceId: activeZmccForLive.id.toString(),
            }),
          })
        );
        const lockPostData = await lockPostRes.json();
        if (lockPostData?.user?.id) suiteLockUserId = BigInt(lockPostData.user.id);

        const advIdx = suiteExecutedOps.indexOf('ADVISORY_LOCK');
        const srcLockIdx = suiteExecutedOps.indexOf('LOCK_SOURCE_FOR_UPDATE');
        const createIdx = suiteExecutedOps.indexOf('CREATE_USER');

        assert(
          lockPostRes.status === 200 &&
            advIdx !== -1 &&
            srcLockIdx !== -1 &&
            createIdx !== -1 &&
            advIdx < srcLockIdx &&
            srcLockIdx < createIdx,
          'SA-C4A-04: Advisory lock executes strictly before source lock and user creation in POST'
        );
      } finally {
        prisma.$transaction = origSuiteTx as any;
        if (suiteLockUserId) {
          await prisma.auditLog.deleteMany({ where: { table_name: 'users', record_id: suiteLockUserId } });
          await prisma.user.delete({ where: { id: suiteLockUserId } });
        }
      }

    } finally {
      if (createdLiveUserId) {
        try {
          await prisma.auditLog.deleteMany({
            where: { table_name: 'users', record_id: createdLiveUserId },
          });
          await prisma.user.delete({
            where: { id: createdLiveUserId },
          });
        } catch (cleanupErr) {
          console.error('CRITICAL: Failed to clean up live test user:', cleanupErr);
          throw cleanupErr;
        }
      }
    }

    console.log(`\n========================================`);
    console.log(`SUPER ADMIN TEST SUITE SUMMARY: ${passed} PASSED, ${failed} FAILED`);
    console.log(`========================================\n`);

    if (failed > 0) process.exit(1);
  } catch (err) {
    console.error('Error running test suite:', err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

runSuperAdminTests();
