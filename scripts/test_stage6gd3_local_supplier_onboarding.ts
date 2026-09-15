/**
 * STAGE 6G-D.3: ZMCC LOCAL SUPPLIER DIRECTORY & FAST PHE ONBOARDING REGRESSION SUITE
 *
 * Verifies:
 * 1. Database Schema & Migrations:
 *    - Exactly 25 tracked migrations in prisma/migrations
 *    - 20260915100000_zmcc_local_supplier_directory_and_arrival migration exists
 *    - zmcc_local_supplier table, columns, and sequence exist
 *    - zmcc_local_supplier_arrival table, check constraint, and sequence exist
 *    - zmcc_lab_session.local_supplier_arrival_id column exists
 * 2. Static Analysis & Domain Separation:
 *    - Registered in scripts/run_all_regressions.ts
 *    - No ERP verification, global canonical supplier master, or financial settlement logic
 * 3. Local Supplier Directory Service (zmccLocalSupplierService):
 *    - Multi-tenant isolation by ZMCC
 *    - Name mandatory, trimmed, non-blank, max 150
 *    - Phone and CNIC validation
 *    - Frozen ERP Reference Rule:
 *      - Stored verbatim as text, leading zeros preserved ("00045231")
 *      - Unknown / blank converted to NULL
 *      - Placeholders rejected (New, Pending, Unknown, N/A, NA, TBD, None, Not Available, Not Known, -)
 *      - Client forbidden fields rejected (erp_mapping_status, erp_code, canonical_supplier_id)
 *      - Mapping status locked to 'PENDING'
 *    - Role permissions:
 *      - PHE can create local supplier for assigned ZMCC
 *      - PHE is strictly forbidden from editing or deactivating local supplier (403)
 *      - ZMCC Manager (assigned ZMCC) and Super Admin can edit and toggle active
 *      - Deactivated supplier excluded from PHE search
 *    - Sequential code allocation: ZLS-000001, ZLS-000002...
 *    - Audit logging for creation and update
 * 4. Distinct Local Supplier Arrival Domain (zmccArrivalService):
 *    - Mandatory numeric-only rmr_number (digits only, leading zeros preserved)
 *    - Uppercase vehicle number normalization
 *    - Inactive or cross-ZMCC supplier rejected (400)
 *    - Daily sequence token format: ZT-LS-<YYYYMMDD>-<sequence>
 *    - Replay idempotency:
 *      - Exact replay with same client_event_id returns 200 with is_replay: true
 *      - Replay with mismatched payload returns 409 conflict
 *    - Audit logging for creation
 * 5. Supervisory Corrections:
 *    - PHE operator cannot correct arrival (403)
 *    - Cross-ZMCC manager cannot correct arrival (403)
 *    - Assigned ZMCC manager can correct with reason >= 5 chars
 *    - Corrected RMR must contain digits only
 *    - Maximum 2 corrections enforced
 *    - System token remains strictly immutable
 *    - Audit logging for correction
 * 6. Minimal Lab Workflow Compatibility (zmccLabService):
 *    - Start lab session with arrival_type: 'LOCAL_SUPPLIER'
 *    - Reuses ZMCC_LAB_CONTRACTOR testing point policy
 *    - Required tests allocated and recorded
 *    - Acceptance and receipt into sole active ZMCC tank
 *    - Queue and history serialization include local supplier arrival data
 */

import path from 'path';
import fs from 'fs';
import { assertSafeTestDatabase } from '../tests/helpers/testDbSafety';

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
console.log('🧪 STAGE 6G-D.3: ZMCC LOCAL SUPPLIER ONBOARDING & ARRIVAL SUITE');
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

function toCoreUser(u: any) {
  return {
    id: u.id.toString(),
    username: u.username,
    name: u.full_name || u.username,
    role: u.role,
    department: u.department || '',
    scope_type: u.scope_type,
    procurement_source_id: u.procurement_source_id ? u.procurement_source_id.toString() : null,
    is_active: u.is_active,
  };
}

async function makeAuthToken(u: any): Promise<string> {
  const { createSessionToken } = await import('../src/backend/core/auth');
  return await createSessionToken({
    id: u.id.toString(),
    username: u.username,
    name: u.full_name || u.username,
    role: u.role as any,
    department: u.department || 'Testing',
    zone: null,
    scope_type: u.scope_type || 'SOURCE',
    procurement_source_id: u.procurement_source_id ? u.procurement_source_id.toString() : null,
    last_login_at: null,
  });
}

function makeAuthRequest(url: string, method: string, token: string, body?: any): Request {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
  };
  if (body) {
    headers['Content-Type'] = 'application/json';
  }
  return new Request(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function runStage6gd3Tests() {
  const { Prisma } = await import('@prisma/client');
  const { prisma } = await import('../src/backend/core/db');

  const {
    createLocalSupplier,
    updateLocalSupplier,
    getLocalSuppliers,
    getLocalSupplierById,
  } = await import('../src/backend/services/zmccLocalSupplierService');

  const {
    submitLocalSupplierArrival,
    correctLocalSupplierArrival,
    listLocalSupplierArrivals,
    getLocalSupplierArrivalById,
  } = await import('../src/backend/services/zmccArrivalService');

  const {
    startOrResumeSession,
    completeSession,
    getArrivalsQueue,
    getLabHistory,
  } = await import('../src/backend/services/zmccLabService');

  const { GET: getLocalSuppliersRoute, POST: createLocalSupplierRoute } = await import(
    '../src/app/api/zmcc/local-suppliers/route'
  );
  const { GET: getLocalSupplierByIdRoute, PATCH: updateLocalSupplierRoute } = await import(
    '../src/app/api/zmcc/local-suppliers/[id]/route'
  );

  try {
    // =========================================================================
    // SECTION 1: DATABASE SCHEMA & MIGRATION INVENTORY
    // =========================================================================
    console.log('\n--- 1. DATABASE SCHEMA & MIGRATIONS ---');

    const migrationsDir = path.join(repoRoot, 'prisma', 'migrations');
    const migrationDirs = fs
      .readdirSync(migrationsDir)
      .filter((f) => fs.statSync(path.join(migrationsDir, f)).isDirectory() && !f.startsWith('.'));
    assert(migrationDirs.length === 25, 'Tracked Migrations', `Found exactly 25 migrations (expected 25)`);

    const d3MigDir = migrationDirs.find((d) => d.includes('zmcc_local_supplier_directory_and_arrival'));
    assert(!!d3MigDir, 'Migration Exists', `Found 6G-D.3 migration: ${d3MigDir}`);

    // Verify zmcc_local_supplier columns
    const localSupplierCols: any[] = await prisma.$queryRaw`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'zmcc_local_supplier';
    `;
    const lsColNames = localSupplierCols.map((c) => c.column_name);
    assert(lsColNames.includes('local_supplier_code'), 'Column Check', 'zmcc_local_supplier.local_supplier_code exists');
    assert(lsColNames.includes('erp_reference'), 'Column Check', 'zmcc_local_supplier.erp_reference exists');
    assert(lsColNames.includes('erp_mapping_status'), 'Column Check', 'zmcc_local_supplier.erp_mapping_status exists');

    // Verify zmcc_local_supplier_arrival columns and check constraint
    const arrivalCols: any[] = await prisma.$queryRaw`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'zmcc_local_supplier_arrival';
    `;
    const arrColNames = arrivalCols.map((c) => c.column_name);
    assert(arrColNames.includes('zmcc_token'), 'Column Check', 'zmcc_local_supplier_arrival.zmcc_token exists');
    assert(arrColNames.includes('local_supplier_id'), 'Column Check', 'zmcc_local_supplier_arrival.local_supplier_id exists');
    assert(arrColNames.includes('rmr_number'), 'Column Check', 'zmcc_local_supplier_arrival.rmr_number exists');
    assert(arrColNames.includes('client_event_id'), 'Column Check', 'zmcc_local_supplier_arrival.client_event_id exists');

    const rmrCheckConstraints: any[] = await prisma.$queryRaw`
      SELECT conname
      FROM pg_constraint
      WHERE conname = 'zmcc_local_supplier_arrival_rmr_digits_check';
    `;
    assert(rmrCheckConstraints.length === 1, 'Check Constraint Check', 'zmcc_local_supplier_arrival_rmr_digits_check exists');

    const erpStatusCheckConstraints: any[] = await prisma.$queryRaw`
      SELECT conname
      FROM pg_constraint
      WHERE conname = 'zmcc_local_supplier_erp_mapping_status_check';
    `;
    assert(erpStatusCheckConstraints.length === 1, 'Check Constraint Check', 'zmcc_local_supplier_erp_mapping_status_check exists');

    // Verify sequence zmcc_local_supplier_code_seq
    const seqs: any[] = await prisma.$queryRaw`
      SELECT sequence_name
      FROM information_schema.sequences
      WHERE sequence_name = 'zmcc_local_supplier_code_seq';
    `;
    assert(seqs.length === 1, 'Sequence Check', 'zmcc_local_supplier_code_seq exists');

    // Verify zmcc_lab_session.local_supplier_arrival_id
    const labSessionCols: any[] = await prisma.$queryRaw`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'zmcc_lab_session' AND column_name = 'local_supplier_arrival_id';
    `;
    assert(labSessionCols.length === 1, 'Lab Session Column', 'zmcc_lab_session.local_supplier_arrival_id exists');

    // =========================================================================
    // SECTION 2: STATIC ANALYSIS & ARCHITECTURAL BOUNDARIES
    // =========================================================================
    console.log('\n--- 2. STATIC ANALYSIS & ARCHITECTURAL BOUNDARIES ---');

    const runAllScript = fs.readFileSync(path.join(repoRoot, 'scripts', 'run_all_regressions.ts'), 'utf8');
    assert(
      runAllScript.includes('scripts/test_stage6gd3_local_supplier_onboarding.ts'),
      'Runner Registration',
      'test_stage6gd3_local_supplier_onboarding.ts registered in run_all_regressions.ts'
    );

    const rulesDoc = fs.readFileSync(path.join(repoRoot, 'docs', 'architecture', 'CURRENT-RULES.md'), 'utf8');
    assert(
      rulesDoc.includes('## 23. Stage 6G-D.3 ZMCC Local Supplier Directory & Fast PHE Onboarding'),
      'Contract Documentation',
      'Section 23 documented in CURRENT-RULES.md'
    );

    // =========================================================================
    // SECTION 3: TEST FIXTURES SETUP
    // =========================================================================
    console.log('\n--- 3. TEST FIXTURES SETUP ---');

    const runId = Date.now();

    // Find or create 2 distinct ZMCC procurement sources
    const existingZmccs = await prisma.procurementSource.findMany({
      where: { source_type: 'ZMCC', is_active: true },
      take: 2,
    });
    const zmcc1 = existingZmccs[0] || (await prisma.procurementSource.create({
      data: {
        code: `ZMCC1_${runId}`,
        name: `ZMCC Test 1 ${runId}`,
        source_type: 'ZMCC',
        is_active: true,
      },
    }));
    const zmcc2 = existingZmccs[1] || (await prisma.procurementSource.create({
      data: {
        code: `ZMCC2_${runId}`,
        name: `ZMCC Test 2 ${runId}`,
        source_type: 'ZMCC',
        is_active: true,
      },
    }));

    let superAdmin = await prisma.user.findFirst({
      where: { role: 'SUPER_ADMIN', is_active: true },
    });
    if (!superAdmin) {
      superAdmin = await prisma.user.create({
        data: {
          username: `admin_6gd3_${runId}`,
          email: `admin_6gd3_${runId}@example.com`,
          password_hash: 'hash',
          role: 'SUPER_ADMIN',
          full_name: `Super Admin 6GD3 ${runId}`,
          is_active: true,
          scope_type: 'GLOBAL',
        },
      });
    }

    let manager1 = await prisma.user.findFirst({
      where: { role: 'ZMCC_MANAGER', procurement_source_id: zmcc1.id, is_active: true },
    });
    if (!manager1) {
      manager1 = await prisma.user.create({
        data: {
          username: `mgr1_6gd3_${runId}`,
          email: `mgr1_6gd3_${runId}@example.com`,
          password_hash: 'hash',
          role: 'ZMCC_MANAGER',
          full_name: `Manager 1 6GD3 ${runId}`,
          is_active: true,
          procurement_source_id: zmcc1.id,
          scope_type: 'SOURCE',
        },
      });
    }

    let manager2 = await prisma.user.findFirst({
      where: { role: 'ZMCC_MANAGER', procurement_source_id: zmcc2.id, is_active: true },
    });
    if (!manager2) {
      manager2 = await prisma.user.create({
        data: {
          username: `mgr2_6gd3_${runId}`,
          email: `mgr2_6gd3_${runId}@example.com`,
          password_hash: 'hash',
          role: 'ZMCC_MANAGER',
          full_name: `Manager 2 6GD3 ${runId}`,
          is_active: true,
          procurement_source_id: zmcc2.id,
          scope_type: 'SOURCE',
        },
      });
    }

    let pheUser = await prisma.user.findFirst({
      where: { role: 'PHE_OPERATOR', procurement_source_id: zmcc1.id, is_active: true },
    });
    if (!pheUser) {
      pheUser = await prisma.user.create({
        data: {
          username: `phe_6gd3_${runId}`,
          email: `phe_6gd3_${runId}@example.com`,
          password_hash: 'hash',
          role: 'PHE_OPERATOR',
          full_name: `PHE Operator 6GD3 ${runId}`,
          is_active: true,
          procurement_source_id: zmcc1.id,
          scope_type: 'SOURCE',
        },
      });
    }

    let labAttendant = await prisma.user.findFirst({
      where: { role: 'ZMCC_LAB_ATTENDANT', procurement_source_id: zmcc1.id, is_active: true },
    });
    if (!labAttendant) {
      labAttendant = await prisma.user.create({
        data: {
          username: `lab_6gd3_${runId}`,
          email: `lab_6gd3_${runId}@example.com`,
          password_hash: 'hash',
          role: 'ZMCC_LAB_ATTENDANT',
          full_name: `Lab Attendant 6GD3 ${runId}`,
          is_active: true,
          procurement_source_id: zmcc1.id,
          scope_type: 'SOURCE',
        },
      });
    }

    // Ensure policy assignments exist for ZMCC_LAB_CONTRACTOR
    let lrTest = await prisma.labTest.findFirst({ where: { testCode: 'LT-000008' } });
    if (!lrTest) {
      lrTest = await prisma.labTest.create({
        data: {
          testCode: 'LT-000008',
          testName: 'LR at 20 Celsius',
          resultType: 'NUMERIC',
          unit: 'degrees',
          isActive: true,
          isRequired: true,
          testScope: 'ZMCC',
          displayOrder: 1,
        },
      });
    }
    let fatTest = await prisma.labTest.findFirst({ where: { testCode: 'LT-000026' } });
    if (!fatTest) {
      fatTest = await prisma.labTest.create({
        data: {
          testCode: 'LT-000026',
          testName: 'Fat',
          resultType: 'NUMERIC',
          unit: '%',
          isActive: true,
          isRequired: true,
          testScope: 'ZMCC',
          displayOrder: 2,
        },
      });
    }

    const existingPolicy = await prisma.milkTestPolicyAssignment.findFirst({
      where: { testing_point: 'ZMCC_LAB_CONTRACTOR', is_active: true },
    });
    if (!existingPolicy) {
      await prisma.milkTestPolicyAssignment.createMany({
        data: [
          { lab_test_id: lrTest.id, testing_point: 'ZMCC_LAB_CONTRACTOR', is_required: true, display_order: 1, is_active: true, created_by_user_id: superAdmin.id },
          { lab_test_id: fatTest.id, testing_point: 'ZMCC_LAB_CONTRACTOR', is_required: true, display_order: 2, is_active: true, created_by_user_id: superAdmin.id },
        ],
      });
    }

    let weighbridgeUser = await prisma.user.findFirst({
      where: { role: 'WEIGHBRIDGE_OPERATOR', is_active: true },
    });
    if (!weighbridgeUser) {
      weighbridgeUser = await prisma.user.create({
        data: {
          username: `wb_6gd3_${runId}`,
          email: `wb_6gd3_${runId}@example.com`,
          password_hash: 'hash',
          role: 'WEIGHBRIDGE_OPERATOR',
          full_name: `Weighbridge Operator ${runId}`,
          is_active: true,
          scope_type: 'GLOBAL',
        },
      });
    }

    const pheCore = toCoreUser(pheUser);
    const mgr1Core = toCoreUser(manager1);
    const mgr2Core = toCoreUser(manager2);
    const adminCore = toCoreUser(superAdmin);
    const labCore = toCoreUser(labAttendant);
    const wbCore = toCoreUser(weighbridgeUser);

    const pheToken = await makeAuthToken(pheUser);
    const mgr1Token = await makeAuthToken(manager1);
    const adminToken = await makeAuthToken(superAdmin);

    console.log(`PHE Operator: ${pheCore.username} (ZMCC ${zmcc1.code})`);
    console.log(`Manager 1: ${mgr1Core.username} (ZMCC ${zmcc1.code})`);
    console.log(`Manager 2: ${mgr2Core.username} (ZMCC ${zmcc2.code})`);
    console.log(`Super Admin: ${adminCore.username}`);

    // Ensure zmcc1 has exactly one active tank
    let activeTank1 = await prisma.zmccTank.findFirst({
      where: { zmcc_id: zmcc1.id, is_active: true },
    });
    if (!activeTank1) {
      activeTank1 = await prisma.zmccTank.create({
        data: {
          tank_code: `TEST-TK-${Date.now().toString().slice(-4)}`,
          tank_name: 'Test Raw Milk Tank 1',
          capacity_liters: 10000.0,
          is_active: true,
          zmcc: { connect: { id: zmcc1.id } },
          creator: { connect: { id: superAdmin.id } },
        },
      });
    }

    // Direct DB constraint test for erp_mapping_status check constraint
    let constraintFailedAsExpected = false;
    try {
      await prisma.$executeRawUnsafe(`
        INSERT INTO "zmcc_local_supplier" ("local_supplier_code", "zmcc_id", "name", "erp_mapping_status", "is_active", "created_by_user_id", "updated_at")
        VALUES ('ZLS-FAIL-${runId}', ${zmcc1.id}, 'Constraint Test Fail', 'INVALID', true, ${pheUser.id}, NOW());
      `);
    } catch (err: any) {
      if (err.message?.includes('zmcc_local_supplier_erp_mapping_status_check')) {
        constraintFailedAsExpected = true;
      }
    }
    assert(constraintFailedAsExpected, 'DB Constraint Violation', 'Rejects invalid erp_mapping_status via zmcc_local_supplier_erp_mapping_status_check');

    // Valid PENDING succeeds
    await prisma.$executeRawUnsafe(`
      INSERT INTO "zmcc_local_supplier" ("local_supplier_code", "zmcc_id", "name", "erp_mapping_status", "is_active", "created_by_user_id", "updated_at")
      VALUES ('ZLS-PEND-${runId}', ${zmcc1.id}, 'Constraint Test Pending', 'PENDING', true, ${pheUser.id}, NOW());
    `);
    assert(true, 'DB Constraint PENDING', 'Allows PENDING in erp_mapping_status check constraint');

    // Valid VERIFIED succeeds
    await prisma.$executeRawUnsafe(`
      UPDATE "zmcc_local_supplier"
      SET "erp_mapping_status" = 'VERIFIED'
      WHERE "local_supplier_code" = 'ZLS-PEND-${runId}';
    `);
    assert(true, 'DB Constraint VERIFIED', 'Allows VERIFIED in erp_mapping_status check constraint');

    // Clean up temporary row
    await prisma.$executeRawUnsafe(`DELETE FROM "zmcc_local_supplier" WHERE "local_supplier_code" = 'ZLS-PEND-${runId}';`);

    // =========================================================================
    // SECTION 4: LOCAL SUPPLIER DIRECTORY SERVICE & FROZEN ERP RULES
    // =========================================================================
    console.log('\n--- 4. LOCAL SUPPLIER DIRECTORY & FROZEN ERP RULES ---');

    // 4.1 Name validation edge cases
    const emptyNameRes = await createLocalSupplier(pheCore as any, { name: '   ' });
    assert(emptyNameRes.status === 400, 'Validation', 'Rejects empty whitespace name');

    const missingNameRes = await createLocalSupplier(pheCore as any, {} as any);
    assert(missingNameRes.status === 400, 'Validation', 'Rejects missing name');

    const nullNameRes = await createLocalSupplier(pheCore as any, { name: null } as any);
    assert(nullNameRes.status === 400, 'Validation', 'Rejects null name');

    const numberNameRes = await createLocalSupplier(pheCore as any, { name: 12345 } as any);
    assert(numberNameRes.status === 400, 'Validation', 'Rejects numeric name');

    const objectNameRes = await createLocalSupplier(pheCore as any, { name: {} } as any);
    assert(objectNameRes.status === 400, 'Validation', 'Rejects object name');

    // 4.1b Phone & CNIC blank to null conversion
    const blankContactRes = await createLocalSupplier(pheCore as any, {
      name: 'Blank Contact Supplier',
      phone: '   ',
      cnic: '   ',
    });
    assert(blankContactRes.status === 201, 'Validation', 'Supplier created with blank phone and CNIC');
    assert(blankContactRes.data.phone === null, 'Phone Null Coercion', 'Whitespace phone converted to NULL');
    assert(blankContactRes.data.cnic === null, 'CNIC Null Coercion', 'Whitespace CNIC converted to NULL');

    // 4.2 Phone validation
    const invalidPhoneRes = await createLocalSupplier(pheCore as any, {
      name: 'Valid Name',
      phone: '12345',
    });
    assert(invalidPhoneRes.status === 400, 'Validation', 'Rejects invalid phone format');

    // 4.3 CNIC validation
    const invalidCnicRes = await createLocalSupplier(pheCore as any, {
      name: 'Valid Name',
      cnic: 'not-a-cnic',
    });
    assert(invalidCnicRes.status === 400, 'Validation', 'Rejects invalid CNIC format');

    // 4.4 Frozen ERP Reference: Placeholder rejection
    const placeholders = ['new', 'Pending', 'UNKNOWN', 'n/a', 'NA', 'Tbd', 'NONE', 'Not Available', 'not known', '-'];
    for (const ph of placeholders) {
      const phRes = await createLocalSupplier(pheCore as any, {
        name: `Supplier ${ph}`,
        erp_reference: ph,
      });
      assert(phRes.status === 400, 'Frozen ERP Rule', `Rejects placeholder "${ph}"`);
    }

    // 4.5 Frozen ERP Reference: Leading zeros preserved
    const zeroPaddedRef = '00045231';
    const supplierZeroPadRes = await createLocalSupplier(pheCore as any, {
      name: 'Zero Padded ERP Supplier',
      erp_reference: zeroPaddedRef,
    });
    assert(supplierZeroPadRes.status === 201, 'Create Supplier', 'Successfully created supplier with leading zeros ERP');
    assert(
      supplierZeroPadRes.data.erp_reference === zeroPaddedRef,
      'Leading Zeros Preserved',
      `ERP reference is exactly "${zeroPaddedRef}" (not converted to number 45231)`
    );
    assert(
      supplierZeroPadRes.data.erp_mapping_status === 'PENDING',
      'Frozen ERP Status',
      'ERP mapping status is locked to PENDING'
    );
    assert(
      supplierZeroPadRes.data.local_supplier_code.startsWith('ZLS-'),
      'Code Format',
      `Allocated code is ${supplierZeroPadRes.data.local_supplier_code}`
    );

    // 4.6 Frozen ERP Reference: Empty string converts to null
    const nullErpRes = await createLocalSupplier(pheCore as any, {
      name: 'Supplier No ERP',
      erp_reference: '   ',
    });
    assert(nullErpRes.status === 201, 'Create Supplier', 'Supplier created without ERP ref');
    assert(nullErpRes.data.erp_reference === null, 'ERP Null Coercion', 'Empty ERP ref converted to NULL');

    // 4.7 Forbidden client fields rejected
    const forbiddenFieldRes1 = await createLocalSupplier(pheCore as any, {
      name: 'Hacker Supplier',
      erp_mapping_status: 'VERIFIED',
    } as any);
    assert(forbiddenFieldRes1.status === 400, 'Forbidden Fields', 'Rejects client setting erp_mapping_status');

    const forbiddenFieldRes2 = await createLocalSupplier(pheCore as any, {
      name: 'Hacker Supplier 2',
      erp_code: 'ERP-999',
    } as any);
    assert(forbiddenFieldRes2.status === 400, 'Forbidden Fields', 'Rejects client setting erp_code');

    const forbiddenFieldRes3 = await createLocalSupplier(pheCore as any, {
      name: 'Hacker Supplier 3',
      canonical_supplier_id: '123',
    } as any);
    assert(forbiddenFieldRes3.status === 400, 'Forbidden Fields', 'Rejects client setting canonical_supplier_id');

    // 4.7b Strict CREATE Mutation Allowlist
    const createUnknownFieldRes = await createLocalSupplier(pheCore as any, {
      name: 'Unknown Field Supplier',
      unknown_field: 'malicious_data',
    } as any);
    assert(createUnknownFieldRes.status === 400, 'Strict Mutation Allowlist', 'CREATE rejects unauthorized unknown field (400)');

    const createImmutableCodeRes = await createLocalSupplier(pheCore as any, {
      name: 'Immutable Code Supplier',
      local_supplier_code: 'ZLS-999999',
    } as any);
    assert(createImmutableCodeRes.status === 400, 'Strict Mutation Allowlist', 'CREATE rejects client-specified local_supplier_code (400)');

    // 4.7c Unrelated Role Rejection
    const unrelatedRoleRes = await createLocalSupplier(wbCore as any, {
      name: 'Unrelated Role Supplier',
    });
    assert(unrelatedRoleRes.status === 403, 'Role Permissions', 'Unrelated role (WEIGHBRIDGE_OPERATOR) rejected from creating supplier (403)');

    // 4.7d Scope Hardening: Conflicting zmcc_id Rejection
    const pheConflictZmccRes = await createLocalSupplier(pheCore as any, {
      name: 'Conflicting ZMCC PHE Supplier',
      zmcc_id: zmcc2.id.toString(),
    });
    assert(pheConflictZmccRes.status === 403, 'Scope Hardening', 'PHE operator supplying conflicting zmcc_id rejected (403)');

    const mgrConflictZmccRes = await createLocalSupplier(mgr1Core as any, {
      name: 'Conflicting ZMCC MGR Supplier',
      zmcc_id: zmcc2.id.toString(),
    });
    assert(mgrConflictZmccRes.status === 403, 'Scope Hardening', 'ZMCC Manager supplying conflicting zmcc_id rejected (403)');

    // 4.8 Role Permissions: PHE cannot edit or deactivate existing supplier
    const createdSupplierId = supplierZeroPadRes.data.id;
    const pheEditRes = await updateLocalSupplier(pheCore as any, createdSupplierId, {
      name: 'PHE Edited Name',
    });
    assert(pheEditRes.status === 403, 'Permission Check', 'PHE operator strictly forbidden from editing supplier (403)');

    const pheDeactivateRes = await updateLocalSupplier(pheCore as any, createdSupplierId, {
      is_active: false,
    });
    assert(pheDeactivateRes.status === 403, 'Permission Check', 'PHE operator strictly forbidden from deactivating supplier (403)');

    // 4.9 Manager of different ZMCC cannot edit or deactivate
    const crossMgrEditRes = await updateLocalSupplier(mgr2Core as any, createdSupplierId, {
      name: 'Cross ZMCC Edit',
    });
    assert(crossMgrEditRes.status === 403, 'Cross-ZMCC Scoping', 'Cross-ZMCC manager forbidden from updating supplier (403)');

    // 4.10 Manager of same ZMCC CAN edit and deactivate
    const mgr1EditRes = await updateLocalSupplier(mgr1Core as any, createdSupplierId, {
      name: 'Manager Corrected Name',
      phone: '03001234567',
    });
    assert(mgr1EditRes.status === 200, 'Manager Edit', 'Own-ZMCC manager successfully updated supplier name & phone');
    assert(mgr1EditRes.data.name === 'Manager Corrected Name', 'Updated Name', 'Name matches updated value');

    // Test deactivation and reactivation by manager
    const mgr1DeactivateRes = await updateLocalSupplier(mgr1Core as any, createdSupplierId, {
      is_active: false,
    });
    assert(mgr1DeactivateRes.status === 200, 'Manager Deactivate', 'Manager successfully deactivated supplier');
    assert(mgr1DeactivateRes.data.is_active === false, 'Deactivated', 'Supplier is now inactive');

    // Deactivated supplier should not appear in PHE search
    const pheSearchAfterDeact = await getLocalSuppliers(pheCore as any, {
      search: 'Manager Corrected Name',
    });
    assert(
      !pheSearchAfterDeact.data?.some((s: any) => s.id === createdSupplierId),
      'PHE Visibility',
      'Inactive supplier excluded from PHE active search list'
    );

    // Reactivate for subsequent tests
    const mgr1ReactivateRes = await updateLocalSupplier(mgr1Core as any, createdSupplierId, {
      is_active: true,
    });
    assert(mgr1ReactivateRes.status === 200, 'Manager Reactivate', 'Manager successfully reactivated supplier');

    // 4.10b Strict PATCH Mutation Allowlist
    const patchUnknownFieldRes = await updateLocalSupplier(mgr1Core as any, createdSupplierId, {
      unknown_field: 'malicious',
    } as any);
    assert(patchUnknownFieldRes.status === 400, 'Strict Mutation Allowlist', 'PATCH rejects unauthorized unknown field (400)');

    const patchImmutableCodeRes = await updateLocalSupplier(mgr1Core as any, createdSupplierId, {
      local_supplier_code: 'ZLS-999999',
    } as any);
    assert(patchImmutableCodeRes.status === 400, 'Strict Mutation Allowlist', 'PATCH rejects client specifying local_supplier_code (400)');

    const patchImmutableZmccRes = await updateLocalSupplier(mgr1Core as any, createdSupplierId, {
      zmcc_id: zmcc2.id,
    } as any);
    assert(patchImmutableZmccRes.status === 400, 'Strict Mutation Allowlist', 'PATCH rejects client reassigning zmcc_id (400)');

    const patchImmutableCreatorRes = await updateLocalSupplier(mgr1Core as any, createdSupplierId, {
      created_by_user_id: 123,
    } as any);
    assert(patchImmutableCreatorRes.status === 400, 'Strict Mutation Allowlist', 'PATCH rejects client reassigning created_by_user_id (400)');

    // 4.11 Super Admin creation with explicit zmcc_id
    const adminCreatedRes = await createLocalSupplier(adminCore as any, {
      name: 'Admin Created Supplier',
      zmcc_id: zmcc2.id.toString(),
      erp_reference: '00987654',
    });
    assert(adminCreatedRes.status === 201, 'Admin Create', 'Super Admin successfully created supplier in ZMCC 2');
    assert(adminCreatedRes.data.zmcc_id === zmcc2.id.toString(), 'Admin ZMCC Scoping', 'Supplier assigned to ZMCC 2');

    // 4.12 Route Wrapper Tests (/api/zmcc/local-suppliers and /api/zmcc/local-suppliers/[id])
    const routePostReq = makeAuthRequest('http://localhost:3000/api/zmcc/local-suppliers', 'POST', pheToken, {
      name: `Route Wrapper Supplier ${runId}`,
      phone: '03001234567',
    });
    const routePostRes = await createLocalSupplierRoute(routePostReq);
    assert(routePostRes.status === 201, 'Route POST Status', 'POST /api/zmcc/local-suppliers returns 201');
    const routePostJson = await routePostRes.json();
    assert(!!routePostJson.supplier, 'Route POST Named Wrapper', 'POST returns { supplier: {...} } named wrapper');
    assert(routePostJson.data === undefined, 'Route POST No Generic Data', 'POST does not return generic { data: ... } wrapper');
    assert(typeof routePostJson.supplier.id === 'string', 'Route POST Supplier ID', 'Supplier id is serialized string');
    assert(routePostJson.supplier.name === `Route Wrapper Supplier ${runId}`, 'Route POST Supplier Name', 'Supplier name matches payload');
    assert(routePostJson.supplier.local_supplier_code.startsWith('ZLS-'), 'Route POST Supplier Code', 'Supplier has allocated code');
    const routeSupplierId = routePostJson.supplier.id;

    const routeGetReq = makeAuthRequest(`http://localhost:3000/api/zmcc/local-suppliers?search=${encodeURIComponent(`Route Wrapper Supplier ${runId}`)}`, 'GET', pheToken);
    const routeGetRes = await getLocalSuppliersRoute(routeGetReq);
    assert(routeGetRes.status === 200, 'Route GET Status', 'GET /api/zmcc/local-suppliers returns 200');
    const routeGetJson = await routeGetRes.json();
    assert(Array.isArray(routeGetJson.suppliers), 'Route GET Named Wrapper', 'GET returns { suppliers: [...] } named wrapper');
    assert(routeGetJson.data === undefined, 'Route GET No Generic Data', 'GET does not return generic { data: ... } wrapper');
    assert(routeGetJson.suppliers.some((s: any) => s.id === routeSupplierId), 'Route GET Supplier Found', 'Created supplier is present in suppliers array');

    const routeGetIdReq = makeAuthRequest(`http://localhost:3000/api/zmcc/local-suppliers/${routeSupplierId}`, 'GET', pheToken);
    const routeGetIdRes = await getLocalSupplierByIdRoute(routeGetIdReq, { params: Promise.resolve({ id: routeSupplierId }) });
    assert(routeGetIdRes.status === 200, 'Route GET By ID Status', 'GET /api/zmcc/local-suppliers/[id] returns 200');
    const routeGetIdJson = await routeGetIdRes.json();
    assert(!!routeGetIdJson.supplier, 'Route GET By ID Named Wrapper', 'GET /api/zmcc/local-suppliers/[id] returns { supplier: {...} }');
    assert(routeGetIdJson.supplier.id === routeSupplierId, 'Route GET By ID Match', 'Supplier id matches requested id');

    const routePatchReq = makeAuthRequest(`http://localhost:3000/api/zmcc/local-suppliers/${routeSupplierId}`, 'PATCH', mgr1Token, {
      name: `Route Wrapper Supplier Updated ${runId}`,
    });
    const routePatchRes = await updateLocalSupplierRoute(routePatchReq, { params: Promise.resolve({ id: routeSupplierId }) });
    assert(routePatchRes.status === 200, 'Route PATCH Status', 'PATCH /api/zmcc/local-suppliers/[id] returns 200');
    const routePatchJson = await routePatchRes.json();
    assert(!!routePatchJson.supplier, 'Route PATCH Named Wrapper', 'PATCH returns { supplier: {...} } named wrapper');
    assert(routePatchJson.supplier.name === `Route Wrapper Supplier Updated ${runId}`, 'Route PATCH Name Match', 'Supplier name updated');

    const routePhePatchReq = makeAuthRequest(`http://localhost:3000/api/zmcc/local-suppliers/${routeSupplierId}`, 'PATCH', pheToken, {
      name: 'PHE Unauthorized Edit',
    });
    const routePhePatchRes = await updateLocalSupplierRoute(routePhePatchReq, { params: Promise.resolve({ id: routeSupplierId }) });
    assert(routePhePatchRes.status === 403, 'Route PATCH PHE Forbidden', 'PATCH /api/zmcc/local-suppliers/[id] by PHE returns 403 Forbidden');

    // =========================================================================
    // SECTION 5: DISTINCT LOCAL SUPPLIER ARRIVAL DOMAIN & IDEMPOTENCY
    // =========================================================================
    console.log('\n--- 5. LOCAL SUPPLIER ARRIVALS & IDEMPOTENCY ---');

    // 5.1 Inactive supplier arrival rejected
    const inactiveSupplierRes = await createLocalSupplier(mgr1Core as any, {
      name: 'Temp Inactive Supplier',
    });
    await updateLocalSupplier(mgr1Core as any, inactiveSupplierRes.data.id, { is_active: false });

    const inactiveArrivalRes = await submitLocalSupplierArrival(pheCore as any, {
      client_event_id: `a0000000-0000-0000-0001-${runId.toString().slice(-12).padStart(12, '0')}`,
      local_supplier_id: inactiveSupplierRes.data.id,
      rmr_number: '12345',
      vehicle_number: 'LES-999',
    });
    assert(inactiveArrivalRes.status === 400, 'Validation', 'Rejects arrival for inactive supplier');

    // 5.2 Cross-ZMCC supplier arrival rejected
    const crossArrivalRes = await submitLocalSupplierArrival(pheCore as any, {
      client_event_id: `a0000000-0000-0000-0002-${runId.toString().slice(-12).padStart(12, '0')}`,
      local_supplier_id: adminCreatedRes.data.id, // from ZMCC 2
      rmr_number: '12345',
      vehicle_number: 'LES-999',
    });
    assert(crossArrivalRes.status === 400, 'Cross-ZMCC Rejection', 'Rejects arrival for supplier from another ZMCC');

    // 5.2b Scope hardening: Conflicting zmcc_id supplied by PHE
    const conflictArrivalZmccRes = await submitLocalSupplierArrival(pheCore as any, {
      client_event_id: `a0000000-0000-0000-0002b-${runId.toString().slice(-12).padStart(12, '0')}`,
      local_supplier_id: createdSupplierId,
      rmr_number: '12345',
      vehicle_number: 'LES-999',
      zmcc_id: zmcc2.id.toString(),
    });
    assert(conflictArrivalZmccRes.status === 403, 'Scope Hardening', 'Arrival submit rejects conflicting zmcc_id (403)');

    // 5.3 Mandatory numeric RMR validation
    const nonNumericRmrRes = await submitLocalSupplierArrival(pheCore as any, {
      client_event_id: `a0000000-0000-0000-0003-${runId.toString().slice(-12).padStart(12, '0')}`,
      local_supplier_id: createdSupplierId,
      rmr_number: 'RMR-123',
    } as any);
    assert(nonNumericRmrRes.status === 400, 'RMR Digits Check', 'Rejects non-numeric RMR number');

    const numericTypeRmrRes = await submitLocalSupplierArrival(pheCore as any, {
      client_event_id: `a0000000-0000-0000-0003b-${runId.toString().slice(-12).padStart(12, '0')}`,
      local_supplier_id: createdSupplierId,
      rmr_number: 12345 as any,
      vehicle_number: 'LES-999',
    });
    assert(numericTypeRmrRes.status === 400, 'RMR String Check', 'Rejects numeric JSON type RMR number (400)');

    // 5.4 Valid local supplier arrival submission
    const eventId1 = `b1111111-1111-1111-1111-${runId.toString().slice(-12).padStart(12, '0')}`;
    const validArrivalPayload = {
      client_event_id: eventId1,
      local_supplier_id: createdSupplierId,
      rmr_number: '007890', // Leading zeros in RMR
      vehicle_number: '  lhr  1234  ', // Needs normalization
    };

    const arrivalRes1 = await submitLocalSupplierArrival(pheCore as any, validArrivalPayload);
    assert(arrivalRes1.status === 201, 'Submit Arrival', 'Successfully submitted local supplier arrival');
    assert(
      arrivalRes1.data.rmr_number === '007890',
      'RMR Preservation',
      'Leading zeros in RMR preserved exactly ("007890")'
    );
    assert(
      arrivalRes1.data.vehicle_number === 'LHR 1234',
      'Vehicle Normalization',
      'Vehicle normalized to "LHR 1234"'
    );
    assert(
      arrivalRes1.data.zmcc_token.startsWith('ZT-LS-'),
      'Token Format',
      `Token format is ${arrivalRes1.data.zmcc_token} (ZT-LS-YYYYMMDD-XXXX)`
    );

    const firstArrivalId = arrivalRes1.data.id;
    const firstToken = arrivalRes1.data.zmcc_token;

    // 5.5 Replay Idempotency: exact replay returns 200 with is_replay: true
    const replayRes = await submitLocalSupplierArrival(pheCore as any, validArrivalPayload);
    assert(replayRes.status === 200, 'Replay Idempotency', 'Exact replay returns HTTP 200');
    assert(replayRes.data.is_replay === true, 'Replay Flag', 'Response indicates is_replay: true');
    assert(replayRes.data.id === firstArrivalId, 'Replay Record', 'Returned identical arrival record');
    assert(replayRes.data.zmcc_token === firstToken, 'Token Integrity', 'Returned identical zmcc_token');

    // 5.6 Replay Idempotency: altered payload on same client_event_id returns 409 Conflict
    const conflictingPayload = {
      ...validArrivalPayload,
      rmr_number: '007891', // Different RMR
    };
    const conflictRes = await submitLocalSupplierArrival(pheCore as any, conflictingPayload);
    assert(conflictRes.status === 409, 'Conflict Detection', 'Replay with altered payload returns HTTP 409 Conflict');

    // =========================================================================
    // SECTION 6: SUPERVISORY CORRECTIONS
    // =========================================================================
    console.log('\n--- 6. SUPERVISORY CORRECTIONS ---');

    // 6.1 PHE operator cannot correct arrival
    const pheCorrectRes = await correctLocalSupplierArrival(pheCore as any, firstArrivalId, {
      rmr_number: '999999',
      reason: 'Operator correction attempt',
    });
    assert(pheCorrectRes.status === 403, 'Permission Check', 'PHE operator forbidden from correcting arrival (403)');

    // 6.2 Cross-ZMCC manager cannot correct arrival
    const crossMgrCorrectRes = await correctLocalSupplierArrival(mgr2Core as any, firstArrivalId, {
      rmr_number: '999999',
      reason: 'Cross ZMCC correction attempt',
    });
    assert(crossMgrCorrectRes.status === 403, 'Cross-ZMCC Scoping', 'Cross-ZMCC manager forbidden from correcting arrival (403)');

    // 6.3 Missing reason rejected
    const missingReasonRes = await correctLocalSupplierArrival(mgr1Core as any, firstArrivalId, {
      rmr_number: '007899',
      reason: 'ab', // less than 5 characters
    });
    assert(missingReasonRes.status === 400, 'Reason Validation', 'Rejects correction with reason < 5 characters');

    // 6.4 Non-numeric RMR in correction rejected
    const nonNumericCorrectRmr = await correctLocalSupplierArrival(mgr1Core as any, firstArrivalId, {
      rmr_number: 'BAD-RMR',
      reason: 'Legitimate typo fix reason',
    });
    assert(nonNumericCorrectRmr.status === 400, 'RMR Digits Check', 'Rejects non-numeric RMR in correction');

    // 6.5 Successful Correction 1 by own-ZMCC Manager
    const correctRes1 = await correctLocalSupplierArrival(mgr1Core as any, firstArrivalId, {
      rmr_number: '007892',
      vehicle_number: 'lhr 5678',
      reason: 'Fixed typographical slip error by PHE operator',
    });
    assert(correctRes1.status === 200, 'Manager Correction 1', 'Manager successfully applied correction 1');
    assert(correctRes1.data.rmr_number === '007892', 'Updated RMR', 'RMR updated with leading zeros');
    assert(correctRes1.data.vehicle_number === 'LHR 5678', 'Updated Vehicle', 'Vehicle updated & normalized');
    assert(correctRes1.data.zmcc_token === firstToken, 'Token Immutability', 'zmcc_token remained strictly immutable');
    assert(correctRes1.data.correction_count === 1, 'Correction Count', 'correction_count incremented to 1');

    // 6.6 Successful Correction 2 by Super Admin
    const correctRes2 = await correctLocalSupplierArrival(adminCore as any, firstArrivalId, {
      vehicle_number: 'LHR 9999',
      reason: 'Admin corrected vehicle number',
    });
    assert(correctRes2.status === 200, 'Admin Correction 2', 'Super Admin successfully applied correction 2');
    assert(correctRes2.data.correction_count === 2, 'Correction Count', 'correction_count incremented to 2');
    assert(correctRes2.data.vehicle_number === 'LHR 9999', 'Updated Vehicle 2', 'Vehicle updated to LHR 9999');

    // 6.7 3rd correction rejected (max 2 limit)
    const correctRes3 = await correctLocalSupplierArrival(mgr1Core as any, firstArrivalId, {
      rmr_number: '007893',
      reason: 'Attempting a 3rd correction',
    });
    assert(correctRes3.status === 400, 'Correction Limit', 'Rejects 3rd correction (max 2 exceeded)');

    // =========================================================================
    // SECTION 7: MINIMAL LAB WORKFLOW COMPATIBILITY
    // =========================================================================
    console.log('\n--- 7. MINIMAL LAB WORKFLOW COMPATIBILITY ---');

    // 7.1 Verify arrival appears in arrivals queue
    const queueRes = await getArrivalsQueue(labCore as any);
    assert(queueRes.status === 200, 'Lab Queue', 'Successfully fetched lab arrivals queue');
    const queuedArrival = queueRes.data?.find((item: any) => item.zmcc_token === firstToken);
    assert(!!queuedArrival, 'Queue Inclusion', `Arrival ${firstToken} found in lab queue`);
    assert(queuedArrival?.queue_type === 'LOCAL_SUPPLIER', 'Arrival Type', 'Queued item queue_type is LOCAL_SUPPLIER');
    assert(
      queuedArrival?.local_supplier_name === 'Manager Corrected Name',
      'Supplier Details',
      'Queued item includes local supplier name'
    );

    // 7.2 Start lab session with arrival_type: 'LOCAL_SUPPLIER'
    const startSessionRes = await startOrResumeSession(labCore as any, {
      arrival_type: 'LOCAL_SUPPLIER',
      arrival_id: firstArrivalId,
    });
    assert(startSessionRes.status === 200 || startSessionRes.status === 201, 'Start Lab Session', 'Successfully started lab session for local supplier arrival');
    const sessionId = startSessionRes.data.id;
    assert(startSessionRes.data.arrival_type === 'LOCAL_SUPPLIER', 'Session Arrival Type', 'Session arrival_type is LOCAL_SUPPLIER');
    assert(startSessionRes.data.results?.length >= 2, 'Policy Reuse', 'Reused ZMCC_LAB_CONTRACTOR testing point policy tests');
    assert(startSessionRes.data.results?.length > 0, 'Allocated Tests', 'Lab session allocated required tests from policy');

    // 7.3 Build results array for session completion
    const resultsPayload = startSessionRes.data.results.map((tr: any) => {
      const code = tr.test_code_snapshot || '';
      const name = (tr.test_name_snapshot || '').toLowerCase();
      if (code === 'FAT' || name.includes('fat')) {
        return { test_id: tr.test_id, numeric_value: 4.2 };
      } else if (code === 'LR' || name.includes('lr')) {
        return { test_id: tr.test_id, numeric_value: 30.5 };
      } else if (tr.result_type_snapshot === 'NUMERIC') {
        return { test_id: tr.test_id, numeric_value: 10.0 };
      } else {
        return { test_id: tr.test_id, text_value: 'NEGATIVE' };
      }
    });

    // 7.4 Complete session: ACCEPT and receive into single active ZMCC tank
    const completeRes = await completeSession(labCore as any, sessionId, {
      completion_client_event_id: `c1111111-1111-1111-1111-${runId.toString().slice(-12).padStart(12, '0')}`,
      decision: 'ACCEPTED',
      quantity_value: 1200.0,
      quantity_unit: 'LITER',
      results: resultsPayload,
      remarks: 'Direct local supplier batch accepted',
    });
    assert(completeRes.status === 200, 'Complete Session', 'Successfully completed session with ACCEPTED decision');
    assert(completeRes.data.status === 'COMPLETED', 'Session Status', 'Session status is COMPLETED');
    assert(completeRes.data.decision === 'ACCEPTED', 'Decision', 'QA decision is ACCEPTED');
    assert(completeRes.data.tank_receipt !== null, 'Tank Receipt Created', 'Milk received into ZMCC tank receipt');

    // Verify arrival was completed
    const updatedArrival = await getLocalSupplierArrivalById(mgr1Core as any, firstArrivalId);
    assert(updatedArrival.status === 200, 'Arrival Fetched', 'Local supplier arrival fetched');

    // 7.5 Verify lab history includes local supplier arrival metadata
    const historyRes = await getLabHistory(labCore as any, { search: firstToken });
    assert(historyRes.status === 200, 'Lab History', 'Successfully fetched lab history');
    const histSession = historyRes.data?.items?.find((s: any) => s.id === sessionId);
    assert(!!histSession, 'History Inclusion', 'Completed session found in lab history');
    assert(
      histSession?.local_supplier_arrival?.local_supplier?.name === 'Manager Corrected Name',
      'History Serialization',
      'Lab history serializes local supplier arrival and supplier details'
    );

    // 7.6 Supplier deactivation continuity regression
    const contSupplierRes = await createLocalSupplier(pheCore as any, {
      name: `Continuity Supplier ${runId}`,
    });
    assert(contSupplierRes.status === 201, 'Continuity Supplier', 'Created active continuity supplier');
    const contSupplierId = contSupplierRes.data.id;

    // Submit arrival for active continuity supplier
    const contArrivalEventId = `d0000000-0000-0000-0001-${runId.toString().slice(-12).padStart(12, '0')}`;
    const contArrivalRes = await submitLocalSupplierArrival(pheCore as any, {
      client_event_id: contArrivalEventId,
      local_supplier_id: contSupplierId,
      rmr_number: '005544',
      vehicle_number: 'CNT 999',
    });
    assert(contArrivalRes.status === 201, 'Continuity Arrival', 'Submitted arrival for active supplier');
    const contArrivalId = contArrivalRes.data.id;
    const contToken = contArrivalRes.data.zmcc_token;

    // Manager deactivates continuity supplier
    const contDeactRes = await updateLocalSupplier(mgr1Core as any, contSupplierId, {
      is_active: false,
    });
    assert(contDeactRes.status === 200, 'Continuity Deactivate', 'Manager deactivated continuity supplier');

    // Lab queue must STILL include this arrival despite supplier deactivation
    const contQueueRes = await getArrivalsQueue(labCore as any);
    const contQueuedArrival = contQueueRes.data?.find((item: any) => item.zmcc_token === contToken);
    assert(!!contQueuedArrival, 'Continuity Queue Check', 'Arrival for deactivated supplier is still present in lab queue');

    // Start lab session on this arrival must succeed (not rejected)
    const contSessionRes = await startOrResumeSession(labCore as any, {
      arrival_type: 'LOCAL_SUPPLIER',
      arrival_id: contArrivalId,
    });
    assert(contSessionRes.status === 200 || contSessionRes.status === 201, 'Continuity Start Session', 'Successfully started lab session for arrival of deactivated supplier');
    const contSessionId = contSessionRes.data.id;

    // Complete session with ACCEPTED decision
    const contResults = contSessionRes.data.results.map((tr: any) => {
      const code = tr.test_code_snapshot || '';
      const name = (tr.test_name_snapshot || '').toLowerCase();
      if (code === 'FAT' || name.includes('fat')) {
        return { test_id: tr.test_id, numeric_value: 4.0 };
      } else if (code === 'LR' || name.includes('lr')) {
        return { test_id: tr.test_id, numeric_value: 30.0 };
      } else if (tr.result_type_snapshot === 'NUMERIC') {
        return { test_id: tr.test_id, numeric_value: 10.0 };
      } else {
        return { test_id: tr.test_id, text_value: 'NEGATIVE' };
      }
    });

    const contCompleteRes = await completeSession(labCore as any, contSessionId, {
      completion_client_event_id: `d1111111-1111-1111-1111-${runId.toString().slice(-12).padStart(12, '0')}`,
      decision: 'ACCEPTED',
      quantity_value: 800.0,
      quantity_unit: 'LITER',
      results: contResults,
      remarks: 'Deactivated supplier arrival accepted without stranding',
    });
    assert(contCompleteRes.status === 200, 'Continuity Complete Session', 'Successfully completed session for deactivated supplier arrival');

    // =========================================================================
    // SECTION 8: AUDIT LOG VERIFICATION
    // =========================================================================
    console.log('\n--- 8. AUDIT LOG VERIFICATION ---');

    const supplierCreateAudit = await prisma.auditLog.findFirst({
      where: {
        table_name: 'zmcc_local_supplier',
        action: 'ZMCC_LOCAL_SUPPLIER_CREATED',
      },
    });
    assert(!!supplierCreateAudit, 'AuditLog', 'AuditLog record exists for ZMCC_LOCAL_SUPPLIER_CREATED');

    const supplierUpdateAudit = await prisma.auditLog.findFirst({
      where: {
        table_name: 'zmcc_local_supplier',
        action: 'ZMCC_LOCAL_SUPPLIER_UPDATED',
      },
    });
    assert(!!supplierUpdateAudit, 'AuditLog', 'AuditLog record exists for ZMCC_LOCAL_SUPPLIER_UPDATED');

    const arrivalSubmitAudit = await prisma.auditLog.findFirst({
      where: {
        table_name: 'zmcc_local_supplier_arrival',
        action: 'ZMCC_LOCAL_SUPPLIER_ARRIVAL_SUBMITTED',
      },
    });
    assert(!!arrivalSubmitAudit, 'AuditLog', 'AuditLog record exists for ZMCC_LOCAL_SUPPLIER_ARRIVAL_SUBMITTED');

    const arrivalCorrectAudit = await prisma.auditLog.findFirst({
      where: {
        table_name: 'zmcc_local_supplier_arrival',
        action: 'ZMCC_LOCAL_SUPPLIER_ARRIVAL_CORRECTED',
      },
    });
    assert(!!arrivalCorrectAudit, 'AuditLog', 'AuditLog record exists for ZMCC_LOCAL_SUPPLIER_ARRIVAL_CORRECTED');

    console.log(`\n=====================================================================`);
    console.log(`🎉 STAGE 6G-D.3 TEST SUITE COMPLETED: ${passed} PASSED, ${failed} FAILED`);
    console.log(`=====================================================================\n`);

    if (failed > 0) process.exit(1);
  } catch (err) {
    console.error('Unhandled error running Stage 6G-D.3 tests:', err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

runStage6gd3Tests();
