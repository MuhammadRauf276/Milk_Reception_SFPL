/**
 * STAGE 6G-D.2: USER EMAIL FOUNDATION REGRESSION TEST SUITE
 *
 * Verifies:
 * 1. Database Schema & Migrations:
 *    - Exactly 24 tracked migrations.
 *    - 20260914160000_user_email_foundation migration exists.
 *    - users.email column exists (VARCHAR(254), nullable).
 *    - Partial unique index users_email_lower_uidx exists on LOWER(email) WHERE email IS NOT NULL.
 * 2. Database-Level Enforcement:
 *    - Multiple historical/legacy users with email = NULL coexist without index collisions.
 *    - Inserting duplicate emails with differing case directly into DB triggers unique constraint violation.
 * 3. User Creation (POST /api/super-admin/users):
 *    - Mandatory email on creation (400 if missing or empty).
 *    - Format validation: rejects invalid format (400).
 *    - Length validation: rejects length > 254 chars (400).
 *    - Normalization: trims and lowercases email on creation.
 *    - Duplicate prevention: rejects creation if normalized email is already used (400).
 *    - Serialization: returned user object includes email.
 *    - AuditLog: USER_CREATED record includes new_values.email.
 * 4. User Retrieval (GET /api/super-admin/users):
 *    - Returns email on serialized user objects (string or null).
 * 5. User Mutation (PATCH /api/super-admin/users/[id]):
 *    - Super Admin can update an existing user's email with a valid new email (200).
 *    - Disallows clearing email to blank or null (400).
 *    - Rejects updating email to an existing email of another user (400).
 *    - Legacy active user with email = null can update non-email fields without error (200).
 *    - Legacy inactive user with email = null CANNOT be activated without email (400).
 *    - Legacy inactive user can be activated when providing a valid email in the payload (200).
 *    - AuditLog: captures old and new email values.
 */

import path from 'path';
import fs from 'fs';
import bcrypt from 'bcryptjs';
import { assertSafeTestDatabase } from '../tests/helpers/testDbSafety';
import { createSessionToken } from '../src/backend/core/auth';
import { POST as postUser, GET as getUsers } from '../src/app/api/super-admin/users/route';
import { PATCH as patchUser } from '../src/app/api/super-admin/users/[id]/route';

// 1. Load .env.test.local
const repoRoot = path.resolve(__dirname, '..');
const testEnvPath = path.join(repoRoot, '.env.test.local');
if (fs.existsSync(testEnvPath)) {
  const envContent = fs.readFileSync(testEnvPath, 'utf8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const idx = trimmed.indexOf('=');
      if (idx > 0) {
        const key = trimmed.substring(0, idx).trim();
        let val = trimmed.substring(idx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.substring(1, val.length - 1);
        }
        process.env[key] = val;
      }
    }
  }
}

// 2. Point DATABASE_URL to TEST_DATABASE_URL
if (!process.env.DEV_DATABASE_URL) {
  process.env.DEV_DATABASE_URL = process.env.DATABASE_URL;
}
if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}

// 3. Enforce test isolation
const { testDbName } = assertSafeTestDatabase({
  testDbUrl: process.env.TEST_DATABASE_URL,
  devDbUrl: process.env.DEV_DATABASE_URL,
});

console.log('=====================================================================');
console.log('🧪 STAGE 6G-D.2: USER EMAIL FOUNDATION REGRESSION SUITE');
console.log(`🎯 Target Database: ${testDbName} (TEST ISOLATION ENFORCED)`);
console.log('=====================================================================\n');

let passed = 0;
let failed = 0;

function assert(condition: boolean, title: string, details?: string) {
  if (condition) {
    console.log(`[PASS] ${title}${details ? ` - ${details}` : ''}`);
    passed++;
  } else {
    console.error(`[FAIL] ${title}${details ? ` - ${details}` : ''}`);
    failed++;
  }
}

async function runStage6gd2Tests() {
  const { prisma } = await import('../src/backend/core/db');

  const createdUserIds: bigint[] = [];

  try {
    // =============================================================
    // 1. DATABASE SCHEMA & MIGRATIONS
    // =============================================================
    console.log('\n--- 1. DATABASE SCHEMA & MIGRATIONS ---');
    const migrationsDir = path.join(repoRoot, 'prisma', 'migrations');
    const migrationDirs = fs
      .readdirSync(migrationsDir)
      .filter((f) => fs.statSync(path.join(migrationsDir, f)).isDirectory() && !f.startsWith('.'));
    assert(migrationDirs.length === 24, 'Tracked Migrations', `Found exactly 24 migrations (expected 24)`);

    const d2MigDir = migrationDirs.find((d) => d.includes('user_email_foundation'));
    assert(!!d2MigDir, 'Migration Exists', `Found 6G-D.2 migration: ${d2MigDir}`);

    // Check users.email column in PostgreSQL
    const emailColCheck: any[] = await prisma.$queryRaw`
      SELECT column_name, data_type, character_maximum_length, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'users' AND column_name = 'email';
    `;
    assert(emailColCheck.length === 1, 'Column Exists', 'users.email column exists in PostgreSQL');
    assert(
      emailColCheck[0]?.character_maximum_length === 254,
      'Column Length',
      `users.email max length is 254 (found ${emailColCheck[0]?.character_maximum_length})`
    );
    assert(
      emailColCheck[0]?.is_nullable === 'YES',
      'Column Nullable',
      `users.email is nullable for historical compatibility (found ${emailColCheck[0]?.is_nullable})`
    );

    // Check index users_email_lower_uidx in PostgreSQL
    const indexCheck: any[] = await prisma.$queryRaw`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE tablename = 'users' AND indexname = 'users_email_lower_uidx';
    `;
    assert(indexCheck.length === 1, 'Index Exists', 'users_email_lower_uidx index exists');
    assert(
      indexCheck[0]?.indexdef?.toLowerCase().includes('lower') &&
        indexCheck[0]?.indexdef?.toLowerCase().includes('email is not null'),
      'Index Definition',
      `Index is partial case-insensitive on lower(email) WHERE email IS NOT NULL (def: ${indexCheck[0]?.indexdef})`
    );

    // =============================================================
    // 2. DATABASE COEXISTENCE & PARTIAL INDEX ENFORCEMENT
    // =============================================================
    console.log('\n--- 2. DATABASE COEXISTENCE & PARTIAL INDEX ENFORCEMENT ---');

    // Test 2.1: Multiple null email users can coexist without violating partial index
    const nullUser1 = await prisma.user.create({
      data: {
        username: `test_null_1_${Date.now()}`,
        full_name: 'Null Email User 1',
        email: null,
        password_hash: await bcrypt.hash('pass1234', 10),
        role: 'ZMCC_LAB_ATTENDANT',
        department: 'Milk Procurement',
        scope_type: 'SOURCE',
        is_active: false,
      },
    });
    createdUserIds.push(nullUser1.id);

    const nullUser2 = await prisma.user.create({
      data: {
        username: `test_null_2_${Date.now()}`,
        full_name: 'Null Email User 2',
        email: null,
        password_hash: await bcrypt.hash('pass1234', 10),
        role: 'ZMCC_LAB_ATTENDANT',
        department: 'Milk Procurement',
        scope_type: 'SOURCE',
        is_active: false,
      },
    });
    createdUserIds.push(nullUser2.id);

    assert(
      nullUser1.email === null && nullUser2.email === null,
      'Null Email Coexistence',
      'Multiple users with email = NULL coexist without index collision'
    );

    // Test 2.2: Inserting duplicate email in DB triggers unique constraint violation
    const uniqueEmailUser = await prisma.user.create({
      data: {
        username: `test_uniq_${Date.now()}`,
        full_name: 'Unique Email User',
        email: 'collision.test@sfpl.com',
        password_hash: await bcrypt.hash('pass1234', 10),
        role: 'SUPER_ADMIN',
        department: 'System Administration',
        scope_type: 'SYSTEM',
        is_active: true,
      },
    });
    createdUserIds.push(uniqueEmailUser.id);

    let dbDuplicateBlocked = false;
    try {
      await prisma.user.create({
        data: {
          username: `test_uniq_dup_${Date.now()}`,
          full_name: 'Duplicate Email User',
          email: 'COLLISION.TEST@SFPL.COM', // Same email, uppercase
          password_hash: await bcrypt.hash('pass1234', 10),
          role: 'SUPER_ADMIN',
          department: 'System Administration',
          scope_type: 'SYSTEM',
          is_active: true,
        },
      });
    } catch (err: any) {
      dbDuplicateBlocked = true;
    }
    assert(
      dbDuplicateBlocked,
      'DB Case-Insensitive Unique Enforcement',
      'Direct insert of collision.test@sfpl.com vs COLLISION.TEST@SFPL.COM rejected by partial unique index'
    );

    // =============================================================
    // 3. API: POST /api/super-admin/users (CREATION)
    // =============================================================
    console.log('\n--- 3. API: POST /api/super-admin/users (CREATION) ---');

    // Get an active Super Admin for headers
    const adminUser = await prisma.user.findFirst({
      where: { role: 'SUPER_ADMIN', is_active: true },
    });
    if (!adminUser) throw new Error('No active SUPER_ADMIN user found in test DB');

    const adminToken = await createSessionToken({
      id: adminUser.id.toString(),
      username: adminUser.username,
      name: adminUser.full_name || adminUser.username,
      role: adminUser.role as any,
      department: adminUser.department || '',
    });

    const adminHeaders = {
      'Content-Type': 'application/json',
      authorization: `Bearer ${adminToken}`,
    };

    // Test 3.1: Reject missing email
    const resNoEmail = await postUser(
      new Request('http://localhost:3000/api/super-admin/users', {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({
          username: `user_no_email_${Date.now()}`,
          password: 'Password123!',
          role: 'SUPER_ADMIN',
        }),
      })
    );
    const dataNoEmail = await resNoEmail.json();
    assert(
      resNoEmail.status === 400 && dataNoEmail.error?.includes('Email'),
      'Creation Rejects Missing Email',
      `Status: ${resNoEmail.status}, error: ${dataNoEmail.error}`
    );

    // Test 3.2: Reject empty email
    const resEmptyEmail = await postUser(
      new Request('http://localhost:3000/api/super-admin/users', {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({
          username: `user_empty_email_${Date.now()}`,
          email: '   ',
          password: 'Password123!',
          role: 'SUPER_ADMIN',
        }),
      })
    );
    const dataEmptyEmail = await resEmptyEmail.json();
    assert(
      resEmptyEmail.status === 400 && dataEmptyEmail.error?.includes('Email'),
      'Creation Rejects Empty Email',
      `Status: ${resEmptyEmail.status}, error: ${dataEmptyEmail.error}`
    );

    // Test 3.3: Reject invalid email formats
    const invalidEmails = ['invalid', 'user@', '@domain.com', 'user@domain', 'user name@domain.com'];
    for (const bad of invalidEmails) {
      const resBad = await postUser(
        new Request('http://localhost:3000/api/super-admin/users', {
          method: 'POST',
          headers: adminHeaders,
          body: JSON.stringify({
            username: `user_bad_${Date.now()}`,
            email: bad,
            password: 'Password123!',
            role: 'SUPER_ADMIN',
          }),
        })
      );
      assert(
        resBad.status === 400,
        `Creation Rejects Invalid Format: "${bad}"`,
        `HTTP ${resBad.status}`
      );
    }

    // Test 3.4: Reject email exceeding 254 characters
    const longEmail = 'a'.repeat(245) + '@example.com'; // 257 chars
    const resLong = await postUser(
      new Request('http://localhost:3000/api/super-admin/users', {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({
          username: `user_long_${Date.now()}`,
          email: longEmail,
          password: 'Password123!',
          role: 'SUPER_ADMIN',
        }),
      })
    );
    assert(
      resLong.status === 400,
      'Creation Rejects Length > 254 Chars',
      `HTTP ${resLong.status}`
    );

    // Test 3.5: Valid creation with uppercase and whitespace
    const validUsername = `d2_user_${Date.now()}`;
    const rawEmailInput = '   New.D2.User@SFPL.Com   ';
    const expectedNormalized = 'new.d2.user@sfpl.com';

    const resCreate = await postUser(
      new Request('http://localhost:3000/api/super-admin/users', {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({
          username: validUsername,
          name: 'D2 Test User',
          email: rawEmailInput,
          password: 'Password123!',
          role: 'SUPER_ADMIN',
        }),
      })
    );
    const dataCreate = await resCreate.json();
    assert(
      resCreate.status === 200 && dataCreate.success === true,
      'Valid User Creation Succeeded',
      `Status ${resCreate.status}`
    );
    assert(
      dataCreate.user?.email === expectedNormalized,
      'Response Includes Normalized Email',
      `Returned: "${dataCreate.user?.email}", expected: "${expectedNormalized}"`
    );

    const createdUserId = BigInt(dataCreate.user.id);
    createdUserIds.push(createdUserId);

    // Verify DB record
    const dbCreated = await prisma.user.findUnique({ where: { id: createdUserId } });
    assert(
      dbCreated?.email === expectedNormalized,
      'DB Stores Normalized Email',
      `Stored: "${dbCreated?.email}"`
    );

    // Verify AuditLog record
    const auditCreated = await prisma.auditLog.findFirst({
      where: { table_name: 'users', record_id: createdUserId, action: 'USER_CREATED' },
    });
    assert(
      !!auditCreated && (auditCreated.new_values as any)?.email === expectedNormalized,
      'AuditLog Records Email on Creation',
      `AuditLog email: ${(auditCreated?.new_values as any)?.email}`
    );

    // Test 3.6: Duplicate email rejection on POST (different case)
    const resDuplicatePost = await postUser(
      new Request('http://localhost:3000/api/super-admin/users', {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({
          username: `d2_dup_${Date.now()}`,
          name: 'D2 Duplicate User',
          email: 'NEW.D2.USER@SFPL.COM', // Different case
          password: 'Password123!',
          role: 'SUPER_ADMIN',
        }),
      })
    );
    const dataDuplicatePost = await resDuplicatePost.json();
    assert(
      resDuplicatePost.status === 400 && dataDuplicatePost.error?.includes('already registered'),
      'Creation Rejects Duplicate Email (Case-Insensitive)',
      `Status: ${resDuplicatePost.status}, error: ${dataDuplicatePost.error}`
    );

    // =============================================================
    // 4. API: GET /api/super-admin/users (SERIALIZATION)
    // =============================================================
    console.log('\n--- 4. API: GET /api/super-admin/users (SERIALIZATION) ---');

    const resGet = await getUsers(
      new Request('http://localhost:3000/api/super-admin/users', {
        method: 'GET',
        headers: adminHeaders,
      })
    );
    const dataGet = await resGet.json();
    assert(resGet.status === 200 && Array.isArray(dataGet.users), 'GET Users Returns List');

    const foundCreated = dataGet.users.find((u: any) => u.id === createdUserId.toString());
    assert(
      foundCreated && foundCreated.email === expectedNormalized,
      'GET Users Returns Correct Email for Created User',
      `Found email: ${foundCreated?.email}`
    );

    const foundNull = dataGet.users.find((u: any) => u.id === nullUser1.id.toString());
    assert(
      foundNull && foundNull.email === null,
      'GET Users Returns null for Historical User without Email',
      `Found email: ${foundNull?.email}`
    );

    // =============================================================
    // 5. API: PATCH /api/super-admin/users/[id] (MUTATION)
    // =============================================================
    console.log('\n--- 5. API: PATCH /api/super-admin/users/[id] (MUTATION) ---');

    // Test 5.1: Disallow clearing email
    const resClearEmail = await patchUser(
      new Request(`http://localhost:3000/api/super-admin/users/${createdUserId}`, {
        method: 'PATCH',
        headers: adminHeaders,
        body: JSON.stringify({ email: '' }),
      }),
      { params: Promise.resolve({ id: createdUserId.toString() }) }
    );
    const dataClearEmail = await resClearEmail.json();
    assert(
      resClearEmail.status === 400 && dataClearEmail.error?.includes('cannot be empty or cleared'),
      'PATCH Rejects Clearing Email to Empty String',
      `Status: ${resClearEmail.status}, error: ${dataClearEmail.error}`
    );

    const resClearEmailNull = await patchUser(
      new Request(`http://localhost:3000/api/super-admin/users/${createdUserId}`, {
        method: 'PATCH',
        headers: adminHeaders,
        body: JSON.stringify({ email: null }),
      }),
      { params: Promise.resolve({ id: createdUserId.toString() }) }
    );
    const dataClearEmailNull = await resClearEmailNull.json();
    assert(
      resClearEmailNull.status === 400 && dataClearEmailNull.error?.includes('cannot be empty or cleared'),
      'PATCH Rejects Clearing Email to Null',
      `Status: ${resClearEmailNull.status}, error: ${dataClearEmailNull.error}`
    );

    // Test 5.2: Updating email with duplicate of another user
    const resDuplicatePatch = await patchUser(
      new Request(`http://localhost:3000/api/super-admin/users/${createdUserId}`, {
        method: 'PATCH',
        headers: adminHeaders,
        body: JSON.stringify({ email: 'collision.test@sfpl.com' }),
      }),
      { params: Promise.resolve({ id: createdUserId.toString() }) }
    );
    const dataDuplicatePatch = await resDuplicatePatch.json();
    assert(
      resDuplicatePatch.status === 400 && dataDuplicatePatch.error?.includes('already registered'),
      'PATCH Rejects Duplicate Email of Another User',
      `Status: ${resDuplicatePatch.status}, error: ${dataDuplicatePatch.error}`
    );

    // Test 5.3: Successfully updating email to new valid normalized email
    const updatedEmailRaw = '   Updated.D2.User@SFPL.Com   ';
    const expectedUpdatedEmail = 'updated.d2.user@sfpl.com';
    const resUpdateEmail = await patchUser(
      new Request(`http://localhost:3000/api/super-admin/users/${createdUserId}`, {
        method: 'PATCH',
        headers: adminHeaders,
        body: JSON.stringify({ email: updatedEmailRaw }),
      }),
      { params: Promise.resolve({ id: createdUserId.toString() }) }
    );
    const dataUpdateEmail = await resUpdateEmail.json();
    assert(
      resUpdateEmail.status === 200 && dataUpdateEmail.success === true,
      'PATCH Update Email Succeeded',
      `Status: ${resUpdateEmail.status}`
    );
    assert(
      dataUpdateEmail.user?.email === expectedUpdatedEmail,
      'PATCH Returns Updated Normalized Email',
      `Returned: ${dataUpdateEmail.user?.email}`
    );

    const dbUpdated = await prisma.user.findUnique({ where: { id: createdUserId } });
    assert(
      dbUpdated?.email === expectedUpdatedEmail,
      'DB Stores Updated Email',
      `Stored: ${dbUpdated?.email}`
    );

    // Verify AuditLog for email update
    const auditUpdated = await prisma.auditLog.findFirst({
      where: { table_name: 'users', record_id: createdUserId, action: 'USER_UPDATED' },
      orderBy: { created_at: 'desc' },
    });
    assert(
      (auditUpdated?.old_values as any)?.email === expectedNormalized &&
        (auditUpdated?.new_values as any)?.email === expectedUpdatedEmail,
      'AuditLog Records Email Change',
      `Old: ${(auditUpdated?.old_values as any)?.email}, New: ${(auditUpdated?.new_values as any)?.email}`
    );

    // Test 5.4: Legacy active user with email = null can edit non-email fields without error
    const legacyActiveUser = await prisma.user.create({
      data: {
        username: `legacy_active_${Date.now()}`,
        full_name: 'Legacy Active Null Email',
        email: null,
        password_hash: await bcrypt.hash('pass1234', 10),
        role: 'SUPER_ADMIN',
        department: 'System Administration',
        scope_type: 'SYSTEM',
        is_active: true,
      },
    });
    createdUserIds.push(legacyActiveUser.id);

    const resLegacyEdit = await patchUser(
      new Request(`http://localhost:3000/api/super-admin/users/${legacyActiveUser.id}`, {
        method: 'PATCH',
        headers: adminHeaders,
        body: JSON.stringify({ name: 'Updated Legacy Active Name' }),
      }),
      { params: Promise.resolve({ id: legacyActiveUser.id.toString() }) }
    );
    const dataLegacyEdit = await resLegacyEdit.json();
    assert(
      resLegacyEdit.status === 200 && dataLegacyEdit.success === true,
      'Legacy Active User with Null Email Can Edit Name',
      `Status: ${resLegacyEdit.status}`
    );
    assert(
      dataLegacyEdit.user?.name === 'Updated Legacy Active Name' && dataLegacyEdit.user?.email === null,
      'Legacy Active User Preserves Null Email on Name Edit',
      `Name: ${dataLegacyEdit.user?.name}, Email: ${dataLegacyEdit.user?.email}`
    );

    // Test 5.5: Legacy inactive user with email = null CANNOT be activated without email
    const legacyInactiveUser = await prisma.user.create({
      data: {
        username: `legacy_inactive_${Date.now()}`,
        full_name: 'Legacy Inactive Null Email',
        email: null,
        password_hash: await bcrypt.hash('pass1234', 10),
        role: 'SUPER_ADMIN',
        department: 'System Administration',
        scope_type: 'SYSTEM',
        is_active: false,
      },
    });
    createdUserIds.push(legacyInactiveUser.id);

    const resLegacyActivateBlocked = await patchUser(
      new Request(`http://localhost:3000/api/super-admin/users/${legacyInactiveUser.id}`, {
        method: 'PATCH',
        headers: adminHeaders,
        body: JSON.stringify({ isActive: true }),
      }),
      { params: Promise.resolve({ id: legacyInactiveUser.id.toString() }) }
    );
    const dataLegacyActivateBlocked = await resLegacyActivateBlocked.json();
    assert(
      resLegacyActivateBlocked.status === 400 && dataLegacyActivateBlocked.error?.includes('email'),
      'Legacy Inactive User Cannot Activate Without Email',
      `Status: ${resLegacyActivateBlocked.status}, error: ${dataLegacyActivateBlocked.error}`
    );

    // Verify user is still inactive in DB
    const dbStillInactive = await prisma.user.findUnique({ where: { id: legacyInactiveUser.id } });
    assert(dbStillInactive?.is_active === false, 'User Remains Inactive in DB');

    // Test 5.6: Legacy inactive user can be activated when providing a valid email in payload
    const resLegacyActivateSuccess = await patchUser(
      new Request(`http://localhost:3000/api/super-admin/users/${legacyInactiveUser.id}`, {
        method: 'PATCH',
        headers: adminHeaders,
        body: JSON.stringify({
          isActive: true,
          email: '  Legacy.Activated@SFPL.COM  ',
        }),
      }),
      { params: Promise.resolve({ id: legacyInactiveUser.id.toString() }) }
    );
    const dataLegacyActivateSuccess = await resLegacyActivateSuccess.json();
    assert(
      resLegacyActivateSuccess.status === 200 && dataLegacyActivateSuccess.success === true,
      'Legacy Inactive User Activated With Provided Email',
      `Status: ${resLegacyActivateSuccess.status}`
    );
    assert(
      dataLegacyActivateSuccess.user?.isActive === true &&
        dataLegacyActivateSuccess.user?.email === 'legacy.activated@sfpl.com',
      'Returned User is Active With Normalized Email',
      `isActive: ${dataLegacyActivateSuccess.user?.isActive}, email: ${dataLegacyActivateSuccess.user?.email}`
    );

    const dbNowActive = await prisma.user.findUnique({ where: { id: legacyInactiveUser.id } });
    assert(
      dbNowActive?.is_active === true && dbNowActive?.email === 'legacy.activated@sfpl.com',
      'DB Record is Active with Normalized Email'
    );

    // Verify AuditLog for activation with email
    const auditActivation = await prisma.auditLog.findFirst({
      where: { table_name: 'users', record_id: legacyInactiveUser.id, action: 'USER_ACTIVATED' },
      orderBy: { created_at: 'desc' },
    });
    assert(
      (auditActivation?.old_values as any)?.email === null &&
        (auditActivation?.new_values as any)?.email === 'legacy.activated@sfpl.com' &&
        (auditActivation?.new_values as any)?.is_active === true,
      'AuditLog Records USER_ACTIVATED with Email Transition',
      `Old: ${(auditActivation?.old_values as any)?.email}, New: ${(auditActivation?.new_values as any)?.email}`
    );

  } finally {
    // Clean up created test users and audit logs
    if (createdUserIds.length > 0) {
      for (const uid of createdUserIds) {
        try {
          await prisma.auditLog.deleteMany({ where: { table_name: 'users', record_id: uid } });
          await prisma.user.deleteMany({ where: { id: uid } });
        } catch {}
      }
    }
    await prisma.$disconnect();
  }

  console.log('\n=====================================================================');
  console.log(`📊 STAGE 6G-D.2 TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('=====================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runStage6gd2Tests().catch((err) => {
  console.error('Unhandled failure in runStage6gd2Tests:', err);
  process.exit(1);
});
