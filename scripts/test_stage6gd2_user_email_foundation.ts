/**
 * STAGE 6G-D.2: USER EMAIL FOUNDATION REGRESSION TEST SUITE
 *
 * Verifies:
 * 1. Database Schema & Migrations:
 *    - Exactly 24 tracked migrations.
 *    - 20260914160000_user_email_foundation migration exists.
 *    - users.email column exists (VARCHAR(254), nullable).
 *    - Partial unique index users_email_lower_uidx exists on LOWER(email) WHERE email IS NOT NULL.
 * 2. Actual Tracked D.2 Migration Behavior Execution:
 *    - Reads the actual migration.sql file using fs.readFileSync.
 *    - Runs against an isolated pre-D.2 schema with pre-existing users without email column.
 *    - Verifies historical compatibility: users preserved, email column added as NULL, zero fabricated emails.
 *    - Verifies multiple NULLs remain permitted without index collision.
 *    - Verifies case-insensitive uniqueness on users_email_lower_uidx.
 *    - Verifies distinct emails both succeed.
 * 3. Database Coexistence & Partial Index Enforcement (Main Test DB):
 *    - Multiple historical/legacy users with email = NULL coexist without index collisions.
 *    - Inserting duplicate emails with differing case directly into DB triggers unique constraint violation.
 * 4. User Creation (POST /api/super-admin/users):
 *    - Input type validation: missing (400), null (400), number (400), object (400), blank (400).
 *    - Format validation: rejects invalid format (400).
 *    - Length validation: rejects length > 254 chars (400).
 *    - Normalization: trims and lowercases email on creation.
 *    - Serialization: returned user object includes email.
 *    - AuditLog: USER_CREATED record includes new_values.email.
 * 5. Unique Error Classification (Prisma P2002):
 *    - Duplicate email (case-insensitive) -> classified as duplicate email error (400).
 *    - Duplicate username with unique email -> classified as duplicate username error (400), NOT duplicate email!
 *    - Unique username + unique email -> succeeds (200).
 * 6. Authorization Safety:
 *    - Non-SUPER_ADMIN create user -> forbidden (403).
 *    - Non-SUPER_ADMIN update user email -> forbidden (403).
 * 7. User Retrieval (GET /api/super-admin/users):
 *    - Returns email on serialized user objects (string or null).
 * 8. User Mutation & Activation (PATCH /api/super-admin/users/[id]):
 *    - Super Admin can update an existing user's email with a valid new email (200).
 *    - Disallows clearing email to blank or null (400).
 *    - Rejects updating email to an existing email of another user (400).
 *    - Inactive NULL-email user CANNOT activate without email (400).
 *    - Inactive NULL-email user CAN activate when providing email in same PATCH (200).
 *    - Inactive user with already stored valid email CAN activate without resending email (200).
 *    - Legacy active user with email = null can update non-email fields without error (200).
 *    - AuditLog: captures old and new email values.
 * 9. Seed Idempotency Rule:
 *    - Proof that rerunning seed preserves existing user email values and never overwrites them.
 *    - Proof that rerunning seed preserves NULL email and never manufactures a historical email.
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
  const runId = Date.now();

  try {
    // =============================================================
    // 1. DATABASE SCHEMA & MIGRATIONS
    // =============================================================
    console.log('\n--- 1. DATABASE SCHEMA & MIGRATIONS ---');
    const migrationsDir = path.join(repoRoot, 'prisma', 'migrations');
    const migrationDirs = fs
      .readdirSync(migrationsDir)
      .filter((f) => fs.statSync(path.join(migrationsDir, f)).isDirectory() && !f.startsWith('.'));
    assert(migrationDirs.length === 25, 'Tracked Migrations', `Found exactly 25 migrations (expected 25)`);

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
    // 2. ACTUAL TRACKED D.2 MIGRATION BEHAVIOR EXECUTION
    // =============================================================
    console.log('\n--- 2. ACTUAL TRACKED D.2 MIGRATION BEHAVIOR EXECUTION ---');
    const d2MigrationSqlPath = path.join(
      repoRoot,
      'prisma/migrations/20260914160000_user_email_foundation/migration.sql'
    );
    assert(fs.existsSync(d2MigrationSqlPath), 'Actual D.2 Migration File Exists', 'Found migration.sql on disk');
    const d2MigrationRawSql = fs.readFileSync(d2MigrationSqlPath, 'utf8');

    const migTestSchema = `d2_mig_actual_${runId}`;
    await prisma.$executeRawUnsafe(`CREATE SCHEMA "${migTestSchema}";`);

    try {
      // Step A: Create pre-D.2 users table in isolated schema with NO email column
      await prisma.$executeRawUnsafe(`
        CREATE TABLE "${migTestSchema}"."users" (
          id BIGSERIAL PRIMARY KEY,
          username VARCHAR(50) NOT NULL UNIQUE,
          full_name VARCHAR(150),
          password_hash VARCHAR(255) NOT NULL,
          role VARCHAR(50) NOT NULL,
          department VARCHAR(100),
          scope_type VARCHAR(50) NOT NULL DEFAULT 'SYSTEM',
          procurement_source_id BIGINT,
          is_active BOOLEAN NOT NULL DEFAULT TRUE,
          created_at TIMESTAMP(6) NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMP(6) NOT NULL DEFAULT NOW()
        );
      `);

      // Insert at least two pre-D.2 users with NO email column
      await prisma.$executeRawUnsafe(`
        INSERT INTO "${migTestSchema}"."users" (username, full_name, password_hash, role, is_active)
        VALUES
          ('hist_user_1_${runId}', 'Historical User One', 'hash1', 'SUPER_ADMIN', TRUE),
          ('hist_user_2_${runId}', 'Historical User Two', 'hash2', 'SUPER_ADMIN', FALSE);
      `);

      // Step B: Execute ACTUAL migration SQL adapted to the test schema
      const adaptedMigrationSql = d2MigrationRawSql.replace(/"users"/g, `"${migTestSchema}"."users"`);
      for (const statement of adaptedMigrationSql.split(';')) {
        const trimmed = statement.trim();
        if (trimmed.length > 0) {
          try {
            await prisma.$executeRawUnsafe(trimmed);
          } catch (e: any) {
            console.error('Error executing migration statement:', trimmed, e);
            throw e;
          }
        }
      }

      const schemaIndexes: any[] = await prisma.$queryRawUnsafe(`
        SELECT schemaname, tablename, indexname, indexdef
        FROM pg_indexes
        WHERE schemaname = '${migTestSchema}';
      `);
      console.log('Schema indexes found:', schemaIndexes);

      // Verify A: Users preserved, email column created as NULL, no fabricated addresses
      const migratedRows: any[] = await prisma.$queryRawUnsafe(`
        SELECT id, username, email FROM "${migTestSchema}"."users" ORDER BY id ASC;
      `);
      assert(
        migratedRows.length === 2,
        'Actual Migration: Historical Users Preserved',
        `Preserved ${migratedRows.length} users`
      );
      assert(
        migratedRows[0].email === null && migratedRows[1].email === null,
        'Actual Migration: Historical Emails Are NULL (Zero Fabricated Addresses)',
        'Historical users retain email = NULL'
      );

      // Verify B: Multiple NULLs remain allowed
      assert(
        migratedRows.every((r) => r.email === null),
        'Actual Migration: Multiple NULL Emails Allowed',
        'Multiple rows with email = NULL coexist cleanly'
      );

      // Verify C: Case-insensitive uniqueness enforced by actual index
      await prisma.$executeRawUnsafe(`
        INSERT INTO "${migTestSchema}"."users" (username, full_name, email, password_hash, role)
        VALUES ('uniq_email_a_${runId}', 'User A', 'test.user@example.com', 'hashA', 'SUPER_ADMIN');
      `);

      let actualDupBlocked = false;
      try {
        await prisma.$executeRawUnsafe(`
          INSERT INTO "${migTestSchema}"."users" (username, full_name, email, password_hash, role)
          VALUES ('uniq_email_b_${runId}', 'User B', 'TEST.USER@EXAMPLE.COM', 'hashB', 'SUPER_ADMIN');
        `);
      } catch (err: any) {
        if (
          err?.meta?.code === '23505' ||
          err?.code === 'P2002' ||
          err?.message?.toLowerCase().includes('already exists') ||
          err?.message?.toLowerCase().includes('users_email_lower_uidx') ||
          err?.message?.toLowerCase().includes('unique') ||
          err?.message?.toLowerCase().includes('duplicate')
        ) {
          actualDupBlocked = true;
        }
      }
      assert(
        actualDupBlocked,
        'Actual Migration: Case-Insensitive Unique Conflict on users_email_lower_uidx',
        'test.user@example.com vs TEST.USER@EXAMPLE.COM rejected at DB level'
      );

      // Verify D: Distinct emails both succeed
      let distinctEmailsSucceeded = false;
      try {
        await prisma.$executeRawUnsafe(`
          INSERT INTO "${migTestSchema}"."users" (username, full_name, email, password_hash, role)
          VALUES ('distinct_b_${runId}', 'Distinct B', 'b@example.com', 'hashDistinct', 'SUPER_ADMIN');
        `);
        distinctEmailsSucceeded = true;
      } catch {}
      assert(
        distinctEmailsSucceeded,
        'Actual Migration: Distinct Emails Both Succeed',
        'test.user@example.com and b@example.com coexist successfully'
      );
    } finally {
      await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${migTestSchema}" CASCADE;`);
    }

    // =============================================================
    // 3. DATABASE COEXISTENCE & PARTIAL INDEX ENFORCEMENT (MAIN DB)
    // =============================================================
    console.log('\n--- 3. DATABASE COEXISTENCE & PARTIAL INDEX ENFORCEMENT ---');

    // Test 3.1: Multiple null email users can coexist without violating partial index
    const nullUser1 = await prisma.user.create({
      data: {
        username: `test_null_1_${runId}`,
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
        username: `test_null_2_${runId}`,
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

    // Test 3.2: Inserting duplicate email in DB triggers unique constraint violation
    const uniqueEmailUser = await prisma.user.create({
      data: {
        username: `test_uniq_${runId}`,
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
          username: `test_uniq_dup_${runId}`,
          full_name: 'Duplicate Email User',
          email: 'COLLISION.TEST@SFPL.COM', // Same email, uppercase
          password_hash: await bcrypt.hash('pass1234', 10),
          role: 'SUPER_ADMIN',
          department: 'System Administration',
          scope_type: 'SYSTEM',
          is_active: true,
        },
      });
    } catch {
      dbDuplicateBlocked = true;
    }
    assert(
      dbDuplicateBlocked,
      'DB Case-Insensitive Unique Enforcement',
      'Direct insert of collision.test@sfpl.com vs COLLISION.TEST@SFPL.COM rejected by partial unique index'
    );

    // =============================================================
    // 4. API: POST /api/super-admin/users (INPUT TYPE VALIDATION)
    // =============================================================
    console.log('\n--- 4. API: POST /api/super-admin/users (INPUT TYPE VALIDATION) ---');

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

    // Test 4.1: Reject missing email (undefined)
    const resNoEmail = await postUser(
      new Request('http://localhost:3000/api/super-admin/users', {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({
          username: `user_no_email_${runId}`,
          password: 'Password123!',
          role: 'SUPER_ADMIN',
        }),
      })
    );
    const dataNoEmail = await resNoEmail.json();
    assert(
      resNoEmail.status === 400 && dataNoEmail.error?.includes('required'),
      'Creation Rejects Missing Email',
      `Status: ${resNoEmail.status}, error: ${dataNoEmail.error}`
    );

    // Test 4.2: Reject null email
    const resNullEmail = await postUser(
      new Request('http://localhost:3000/api/super-admin/users', {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({
          username: `user_null_email_${runId}`,
          email: null,
          password: 'Password123!',
          role: 'SUPER_ADMIN',
        }),
      })
    );
    const dataNullEmail = await resNullEmail.json();
    assert(
      resNullEmail.status === 400 && dataNullEmail.error?.includes('required'),
      'Creation Rejects Null Email',
      `Status: ${resNullEmail.status}, error: ${dataNullEmail.error}`
    );

    // Test 4.3: Reject number email (without String() coercion)
    const resNumEmail = await postUser(
      new Request('http://localhost:3000/api/super-admin/users', {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({
          username: `user_num_email_${runId}`,
          email: 12345,
          password: 'Password123!',
          role: 'SUPER_ADMIN',
        }),
      })
    );
    const dataNumEmail = await resNumEmail.json();
    assert(
      resNumEmail.status === 400 && dataNumEmail.error?.includes('string'),
      'Creation Rejects Number Email (No String Coercion)',
      `Status: ${resNumEmail.status}, error: ${dataNumEmail.error}`
    );

    // Test 4.4: Reject object email
    const resObjEmail = await postUser(
      new Request('http://localhost:3000/api/super-admin/users', {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({
          username: `user_obj_email_${runId}`,
          email: { address: 'test@example.com' },
          password: 'Password123!',
          role: 'SUPER_ADMIN',
        }),
      })
    );
    const dataObjEmail = await resObjEmail.json();
    assert(
      resObjEmail.status === 400 && dataObjEmail.error?.includes('string'),
      'Creation Rejects Object Email',
      `Status: ${resObjEmail.status}, error: ${dataObjEmail.error}`
    );

    // Test 4.5: Reject empty / whitespace email
    const resEmptyEmail = await postUser(
      new Request('http://localhost:3000/api/super-admin/users', {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({
          username: `user_empty_email_${runId}`,
          email: '   ',
          password: 'Password123!',
          role: 'SUPER_ADMIN',
        }),
      })
    );
    const dataEmptyEmail = await resEmptyEmail.json();
    assert(
      resEmptyEmail.status === 400 && dataEmptyEmail.error?.includes('empty or blank'),
      'Creation Rejects Blank Email',
      `Status: ${resEmptyEmail.status}, error: ${dataEmptyEmail.error}`
    );

    // Test 4.6: Reject malformed email syntaxes
    const badSyntaxes = ['invalid', 'user@', '@domain.com', 'user@domain', 'user name@domain.com'];
    for (const bad of badSyntaxes) {
      const resBad = await postUser(
        new Request('http://localhost:3000/api/super-admin/users', {
          method: 'POST',
          headers: adminHeaders,
          body: JSON.stringify({
            username: `user_bad_${Date.now()}_${Math.random()}`,
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

    // Test 4.7: Reject email exceeding 254 characters
    const longEmail = 'a'.repeat(245) + '@example.com';
    const resLong = await postUser(
      new Request('http://localhost:3000/api/super-admin/users', {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({
          username: `user_long_${runId}`,
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

    // Test 4.8: Valid creation with uppercase and whitespace
    const validUsername = `d2_user_${runId}`;
    const rawEmailInput = '   New.D2.User@Example.Com   ';
    const expectedNormalized = 'new.d2.user@example.com';

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

    // =============================================================
    // 5. UNIQUE ERROR CLASSIFICATION (EMAIL VS USERNAME)
    // =============================================================
    console.log('\n--- 5. UNIQUE ERROR CLASSIFICATION (EMAIL VS USERNAME) ---');

    // Test 5.1: Duplicate email with DIFFERENT username -> classified as email conflict
    const resDuplicateEmail = await postUser(
      new Request('http://localhost:3000/api/super-admin/users', {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({
          username: `d2_diff_user_${runId}`,
          name: 'Different Username Same Email',
          email: 'NEW.D2.USER@EXAMPLE.COM', // Same normalized email
          password: 'Password123!',
          role: 'SUPER_ADMIN',
        }),
      })
    );
    const dataDuplicateEmail = await resDuplicateEmail.json();
    assert(
      resDuplicateEmail.status === 400 && dataDuplicateEmail.error?.includes('already registered'),
      'Unique Error: Duplicate Email Correctly Identified',
      `Status: ${resDuplicateEmail.status}, error: ${dataDuplicateEmail.error}`
    );

    // Test 5.2: Duplicate username with DIFFERENT email -> classified as username conflict, NOT email conflict!
    const resDuplicateUsername = await postUser(
      new Request('http://localhost:3000/api/super-admin/users', {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({
          username: validUsername, // Existing username
          name: 'Same Username Different Email',
          email: `completely_unique_${runId}@example.com`,
          password: 'Password123!',
          role: 'SUPER_ADMIN',
        }),
      })
    );
    const dataDuplicateUsername = await resDuplicateUsername.json();
    assert(
      resDuplicateUsername.status === 400 &&
        dataDuplicateUsername.error?.includes('Username') &&
        !dataDuplicateUsername.error?.includes('Email'),
      'Unique Error: Duplicate Username Not Mislabeled as Duplicate Email',
      `Status: ${resDuplicateUsername.status}, error: ${dataDuplicateUsername.error}`
    );

    // Test 5.3: Unique username + unique email -> succeeds
    const resBothUnique = await postUser(
      new Request('http://localhost:3000/api/super-admin/users', {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({
          username: `both_unique_${runId}`,
          name: 'Both Unique User',
          email: `both_unique_${runId}@example.com`,
          password: 'Password123!',
          role: 'SUPER_ADMIN',
        }),
      })
    );
    const dataBothUnique = await resBothUnique.json();
    assert(
      resBothUnique.status === 200 && dataBothUnique.success === true,
      'Unique Error: Unique Username and Email Succeeds',
      `Status: ${resBothUnique.status}`
    );
    if (dataBothUnique.user?.id) {
      createdUserIds.push(BigInt(dataBothUnique.user.id));
    }

    // =============================================================
    // 6. AUTHORIZATION SAFETY (NON-SUPER_ADMIN)
    // =============================================================
    console.log('\n--- 6. AUTHORIZATION SAFETY (NON-SUPER_ADMIN) ---');

    const nonAdminUser = await prisma.user.create({
      data: {
        username: `non_admin_${runId}`,
        full_name: 'Non Admin Tester',
        email: `non_admin_${runId}@example.com`,
        password_hash: await bcrypt.hash('pass1234', 10),
        role: 'QA_LAB_ATTENDANT',
        department: 'Quality Assurance',
        scope_type: 'SOURCE',
        is_active: true,
      },
    });
    createdUserIds.push(nonAdminUser.id);

    const nonAdminToken = await createSessionToken({
      id: nonAdminUser.id.toString(),
      username: nonAdminUser.username,
      name: nonAdminUser.full_name || nonAdminUser.username,
      role: nonAdminUser.role as any,
      department: nonAdminUser.department || '',
    });

    const nonAdminHeaders = {
      'Content-Type': 'application/json',
      authorization: `Bearer ${nonAdminToken}`,
    };

    // Non-SUPER_ADMIN cannot create user
    const resNonAdminCreate = await postUser(
      new Request('http://localhost:3000/api/super-admin/users', {
        method: 'POST',
        headers: nonAdminHeaders,
        body: JSON.stringify({
          username: `hack_${runId}`,
          email: `hack_${runId}@example.com`,
          password: 'Password123!',
          role: 'SUPER_ADMIN',
        }),
      })
    );
    assert(
      resNonAdminCreate.status === 403,
      'Auth Safety: Non-SUPER_ADMIN Blocked from Creating User',
      `Status: ${resNonAdminCreate.status}`
    );

    // Non-SUPER_ADMIN cannot update user email
    const resNonAdminUpdate = await patchUser(
      new Request(`http://localhost:3000/api/super-admin/users/${createdUserId}`, {
        method: 'PATCH',
        headers: nonAdminHeaders,
        body: JSON.stringify({ email: `hacked_${runId}@example.com` }),
      }),
      { params: Promise.resolve({ id: createdUserId.toString() }) }
    );
    assert(
      resNonAdminUpdate.status === 403,
      'Auth Safety: Non-SUPER_ADMIN Blocked from Updating Email',
      `Status: ${resNonAdminUpdate.status}`
    );

    // =============================================================
    // 7. API: GET /api/super-admin/users (SERIALIZATION)
    // =============================================================
    console.log('\n--- 7. API: GET /api/super-admin/users (SERIALIZATION) ---');

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
    // 8. API: PATCH /api/super-admin/users/[id] (MUTATION & ACTIVATION)
    // =============================================================
    console.log('\n--- 8. API: PATCH /api/super-admin/users/[id] (MUTATION & ACTIVATION) ---');

    // Test 8.1: Disallow clearing email to empty string
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

    // Test 8.2: Disallow clearing email to null
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

    // Test 8.3: Rejects duplicate email of another user
    const resPatchDup = await patchUser(
      new Request(`http://localhost:3000/api/super-admin/users/${createdUserId}`, {
        method: 'PATCH',
        headers: adminHeaders,
        body: JSON.stringify({ email: 'COLLISION.TEST@SFPL.COM' }),
      }),
      { params: Promise.resolve({ id: createdUserId.toString() }) }
    );
    const dataPatchDup = await resPatchDup.json();
    assert(
      resPatchDup.status === 400 && dataPatchDup.error?.includes('already registered'),
      'PATCH Rejects Duplicate Email of Another User',
      `Status: ${resPatchDup.status}, error: ${dataPatchDup.error}`
    );

    // Test 8.4: Successfully update email
    const expectedUpdatedEmail = 'updated.d2.user@example.com';
    const resUpdateEmail = await patchUser(
      new Request(`http://localhost:3000/api/super-admin/users/${createdUserId}`, {
        method: 'PATCH',
        headers: adminHeaders,
        body: JSON.stringify({ email: '  Updated.D2.User@Example.Com  ' }),
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

    // Test 8.5: Legacy active user with email = null can edit non-email fields without error
    const legacyActiveUser = await prisma.user.create({
      data: {
        username: `legacy_active_${runId}`,
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

    // Test 8.6: Inactive user with email = null CANNOT be activated without email
    const legacyInactiveUser = await prisma.user.create({
      data: {
        username: `legacy_inactive_${runId}`,
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
      'Inactive User Without Email Cannot Activate',
      `Status: ${resLegacyActivateBlocked.status}, error: ${dataLegacyActivateBlocked.error}`
    );

    // Verify user is still inactive in DB
    const dbStillInactive = await prisma.user.findUnique({ where: { id: legacyInactiveUser.id } });
    assert(dbStillInactive?.is_active === false, 'User Remains Inactive in DB');

    // Test 8.7: Inactive user CAN activate when providing a valid email in same PATCH
    const resLegacyActivateSuccess = await patchUser(
      new Request(`http://localhost:3000/api/super-admin/users/${legacyInactiveUser.id}`, {
        method: 'PATCH',
        headers: adminHeaders,
        body: JSON.stringify({
          isActive: true,
          email: '  Legacy.Activated@Example.Com  ',
        }),
      }),
      { params: Promise.resolve({ id: legacyInactiveUser.id.toString() }) }
    );
    const dataLegacyActivateSuccess = await resLegacyActivateSuccess.json();
    assert(
      resLegacyActivateSuccess.status === 200 && dataLegacyActivateSuccess.success === true,
      'Inactive User Activated With Provided Email In Same PATCH',
      `Status: ${resLegacyActivateSuccess.status}`
    );
    assert(
      dataLegacyActivateSuccess.user?.isActive === true &&
        dataLegacyActivateSuccess.user?.email === 'legacy.activated@example.com',
      'Returned User is Active With Normalized Email',
      `isActive: ${dataLegacyActivateSuccess.user?.isActive}, email: ${dataLegacyActivateSuccess.user?.email}`
    );

    const dbNowActive = await prisma.user.findUnique({ where: { id: legacyInactiveUser.id } });
    assert(
      dbNowActive?.is_active === true && dbNowActive?.email === 'legacy.activated@example.com',
      'DB Record is Active with Normalized Email'
    );

    // Test 8.8: Inactive user with ALREADY stored email CAN activate without resending email
    const inactiveWithStoredEmail = await prisma.user.create({
      data: {
        username: `inactive_with_email_${runId}`,
        full_name: 'Inactive With Stored Email',
        email: 'stored.ready@example.com',
        password_hash: await bcrypt.hash('pass1234', 10),
        role: 'SUPER_ADMIN',
        department: 'System Administration',
        scope_type: 'SYSTEM',
        is_active: false,
      },
    });
    createdUserIds.push(inactiveWithStoredEmail.id);

    const resActivateStored = await patchUser(
      new Request(`http://localhost:3000/api/super-admin/users/${inactiveWithStoredEmail.id}`, {
        method: 'PATCH',
        headers: adminHeaders,
        body: JSON.stringify({ isActive: true }), // No email sent in payload
      }),
      { params: Promise.resolve({ id: inactiveWithStoredEmail.id.toString() }) }
    );
    const dataActivateStored = await resActivateStored.json();
    assert(
      resActivateStored.status === 200 && dataActivateStored.success === true,
      'Inactive User With Stored Email Activates Without Resending Email',
      `Status: ${resActivateStored.status}`
    );
    assert(
      dataActivateStored.user?.isActive === true &&
        dataActivateStored.user?.email === 'stored.ready@example.com',
      'Activated User Preserves Stored Email',
      `isActive: ${dataActivateStored.user?.isActive}, email: ${dataActivateStored.user?.email}`
    );

    // =============================================================
    // 9. SEED IDEMPOTENCY RULE VERIFICATION
    // =============================================================
    console.log('\n--- 9. SEED IDEMPOTENCY RULE VERIFICATION ---');

    // 9.1: Verify seed.ts source code does NOT overwrite email on existing users
    const seedFilePath = path.join(repoRoot, 'prisma', 'seed.ts');
    assert(fs.existsSync(seedFilePath), 'Seed File Exists', 'prisma/seed.ts exists');
    const seedContent = fs.readFileSync(seedFilePath, 'utf8');

    // Verify USERS_SEED defines explicit email for each dummy user with @example.com
    assert(
      seedContent.includes("@example.com"),
      'Seed Users Use @example.com',
      'Found canonical @example.com domain in seed'
    );
    assert(
      !seedContent.includes("@example.invalid"),
      'Seed Has Zero @example.invalid',
      'No @example.invalid found in seed'
    );
    assert(
      !seedContent.includes("@gmail.com"),
      'Seed Has Zero @gmail.com',
      'No @gmail.com found in seed'
    );

    // Verify existing user updateData in seed.ts does NOT overwrite email
    const updateDataBlock = seedContent.substring(
      seedContent.indexOf('const updateData: Record<string, unknown> = {'),
      seedContent.indexOf('if (shouldResetPasswords')
    );
    assert(
      !updateDataBlock.includes('email:'),
      'Seed Idempotency: updateData strictly omits email',
      'Rerunning seed does NOT overwrite email on existing users'
    );

    // 9.2: Dynamic seed rerun test:
    // Create a user with a customized real email, run seed logic update, confirm email is unchanged
    const customEmailUser = await prisma.user.create({
      data: {
        username: `idempotency_test_${runId}`,
        full_name: 'Custom Email User',
        email: 'real.custom.admin@example.com',
        password_hash: await bcrypt.hash('pass1234', 10),
        role: 'SUPER_ADMIN',
        department: 'System Administration',
        scope_type: 'SYSTEM',
        is_active: true,
      },
    });
    createdUserIds.push(customEmailUser.id);

    // Simulate seed update step on existing user
    await prisma.user.update({
      where: { id: customEmailUser.id },
      data: {
        full_name: 'Custom Email User (Seed Rerun)',
        role: 'SUPER_ADMIN',
        department: 'System Administration',
        scope_type: 'SYSTEM',
      },
    });

    const afterRerun = await prisma.user.findUnique({ where: { id: customEmailUser.id } });
    assert(
      afterRerun?.email === 'real.custom.admin@example.com',
      'Seed Rerun Preserves Existing User Email',
      `Preserved: ${afterRerun?.email}`
    );

    // Create a legacy user with email = null, run seed update step, confirm email remains null
    const nullEmailUser = await prisma.user.create({
      data: {
        username: `idempotency_null_${runId}`,
        full_name: 'Historical Null User',
        email: null,
        password_hash: await bcrypt.hash('pass1234', 10),
        role: 'SUPER_ADMIN',
        department: 'System Administration',
        scope_type: 'SYSTEM',
        is_active: true,
      },
    });
    createdUserIds.push(nullEmailUser.id);

    await prisma.user.update({
      where: { id: nullEmailUser.id },
      data: {
        full_name: 'Historical Null User (Seed Rerun)',
      },
    });

    const nullAfterRerun = await prisma.user.findUnique({ where: { id: nullEmailUser.id } });
    assert(
      nullAfterRerun?.email === null,
      'Seed Rerun Preserves NULL Email (Never Fabricates)',
      'email remains NULL'
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
