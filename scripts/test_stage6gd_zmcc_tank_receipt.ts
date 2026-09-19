/**
 * STAGE 6G-D: ZMCC TANK RECEIPT + IMMUTABLE INVENTORY LEDGER REGRESSION TEST SUITE
 *
 * Verifies:
 * 1. Database Schema & Migrations:
 *    - Exactly 22 tracked migrations
 *    - 20260913120000_zmcc_tank_receipt_and_ledger migration exists
 *    - zmcc_tank, zmcc_tank_receipt, zmcc_tank_inventory_transaction tables and columns
 *    - PostgreSQL CHECK constraints and UNIQUE constraints
 * 2. Static Analysis & Domain Separation:
 *    - Registered in scripts/run_all_regressions.ts
 *    - Zero reuse of Plant Silo / SiloInventoryTransaction / UnloadingLog / VehicleVisit
 *    - Strictly gross liters physical inventory ledger
 *    - Dynamic stock calculation (no mutable stock column on ZmccTank)
 *    - Zero Stage 6G-E dispatch logic
 * 3. Tank Master CRUD & Role Permissions:
 *    - SUPER_ADMIN full CRUD and active toggle
 *    - Capacity > 0 validation
 *    - Unique tank_code per ZMCC
 *    - ZMCC_MANAGER and ZMCC_LAB_ATTENDANT read-only visibility
 *    - Cross-ZMCC scoping enforcement
 *    - Non-ZMCC or inactive users blocked (403)
 * 4. Session Completion "Accept & Receive" Workflow:
 *    - Decision = REJECTED creates NO tank receipt and NO inventory transaction
 *    - Decision = ACCEPTED with 0 active tanks fails closed (400)
 *    - Decision = ACCEPTED with 1 active tank auto-selects tank
 *    - Decision = ACCEPTED with >1 active tanks requires tank_id
 *    - Valid tank selected creates ZMCC Tank Receipt + RECEIPT transaction atomically
 *    - Capacity validation: overfilling fails closed (400)
 *    - Idempotency: exact replay returns existing session & receipt, no duplicate ledger row
 *    - Replay with altered tank_id returns conflict (409)
 * 5. Concurrency & Row-level Locking:
 *    - Tank row locked FOR UPDATE during receipt and adjustment
 * 6. Supervisory Corrections & Ledger Adjustments:
 *    - Delta > 0 creates ADJUSTMENT_IN and enforces capacity
 *    - Delta < 0 creates ADJUSTMENT_OUT and enforces non-negative stock
 *    - Delta == 0 creates NO inventory transaction
 *    - Operator cannot correct completed session
 *    - Manager 5 correction limit enforced, Super Admin unlimited
 * 7. Controlled Historical Pre-6G-D Receipt Creation:
 *    - Pre-6G-D ACCEPTED session can be receipted via POST /api/zmcc/lab/sessions/[id]/receive
 *    - Pre-6G-D REJECTED session cannot be receipted
 *    - Already receipted session rejected
 *    - Operator blocked from historical receipt (403)
 * 8. Dynamic Gross Liters Stock & Immutability:
 *    - Physical stock is dynamically aggregated from immutable ledger
 *    - Full audit log entries for all operations
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
console.log('🧪 STAGE 6G-D: ZMCC TANK RECEIPT & IMMUTABLE LEDGER REGRESSION SUITE');
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

async function runStage6gdTests() {
  const { Prisma } = await import('@prisma/client');
  const { prisma } = await import('../src/backend/core/db');

  const {
    createZmccTank,
    updateZmccTank,
    toggleZmccTankActive,
    listZmccTanks,
    getZmccTankById,
    receiveHistoricalSession,
  } = await import('../src/backend/services/zmccTankService');

  const {
    startOrResumeSession,
    updateDraftResults,
    completeSession,
    correctCompletedSession,
    getSessionById,
    getLabHistory,
  } = await import('../src/backend/services/zmccLabService');

  const {
    submitMotArrival,
    submitContractorArrival,
  } = await import('../src/backend/services/zmccArrivalService');

  // =============================================================
  // 1. DATABASE SCHEMA & MIGRATIONS
  // =============================================================
  console.log('\n--- 1. DATABASE SCHEMA & MIGRATIONS ---');
  const migrationsDir = path.join(repoRoot, 'prisma', 'migrations');
  const migrationDirs = fs
    .readdirSync(migrationsDir)
    .filter((f) => fs.statSync(path.join(migrationsDir, f)).isDirectory() && !f.startsWith('.'));
  assert(migrationDirs.length === 31, 'Tracked Migrations', `Found exactly 31 migrations (expected 31)`);

  const tankMigDir = migrationDirs.find((d) => d.includes('zmcc_tank_receipt_and_ledger'));
  assert(!!tankMigDir, 'Migration Exists', `Found 6G-D migration: ${tankMigDir}`);

  // Verify zmcc_tank columns
  const tankCols = await prisma.$queryRaw<Array<{ column_name: string }>>`
    SELECT column_name FROM information_schema.columns WHERE table_name = 'zmcc_tank'
  `;
  const tankColNames = tankCols.map((c) => c.column_name);
  assert(tankColNames.includes('id'), 'zmcc_tank columns', 'id exists');
  assert(tankColNames.includes('zmcc_id'), 'zmcc_tank columns', 'zmcc_id exists');
  assert(tankColNames.includes('tank_code'), 'zmcc_tank columns', 'tank_code exists');
  assert(tankColNames.includes('tank_name'), 'zmcc_tank columns', 'tank_name exists');
  assert(tankColNames.includes('capacity_liters'), 'zmcc_tank columns', 'capacity_liters exists');
  assert(tankColNames.includes('is_active'), 'zmcc_tank columns', 'is_active exists');
  assert(tankColNames.includes('created_by_user_id'), 'zmcc_tank columns', 'created_by_user_id exists');
  assert(tankColNames.includes('updated_by_user_id'), 'zmcc_tank columns', 'updated_by_user_id exists');

  // Verify zmcc_tank_receipt columns
  const receiptCols = await prisma.$queryRaw<Array<{ column_name: string }>>`
    SELECT column_name FROM information_schema.columns WHERE table_name = 'zmcc_tank_receipt'
  `;
  const receiptColNames = receiptCols.map((c) => c.column_name);
  assert(receiptColNames.includes('id'), 'zmcc_tank_receipt columns', 'id exists');
  assert(receiptColNames.includes('lab_session_id'), 'zmcc_tank_receipt columns', 'lab_session_id exists');
  assert(receiptColNames.includes('zmcc_id'), 'zmcc_tank_receipt columns', 'zmcc_id exists');
  assert(receiptColNames.includes('tank_id'), 'zmcc_tank_receipt columns', 'tank_id exists');
  assert(receiptColNames.includes('arrival_type'), 'zmcc_tank_receipt columns', 'arrival_type exists');
  assert(receiptColNames.includes('gross_liters'), 'zmcc_tank_receipt columns', 'gross_liters exists');
  assert(receiptColNames.includes('at_13ts_liters'), 'zmcc_tank_receipt columns', 'at_13ts_liters exists');
  assert(receiptColNames.includes('received_by_user_id'), 'zmcc_tank_receipt columns', 'received_by_user_id exists');

  // Verify zmcc_tank_inventory_transaction columns
  const txCols = await prisma.$queryRaw<Array<{ column_name: string }>>`
    SELECT column_name FROM information_schema.columns WHERE table_name = 'zmcc_tank_inventory_transaction'
  `;
  const txColNames = txCols.map((c) => c.column_name);
  assert(txColNames.includes('id'), 'zmcc_tank_inventory_transaction columns', 'id exists');
  assert(txColNames.includes('tank_id'), 'zmcc_tank_inventory_transaction columns', 'tank_id exists');
  assert(txColNames.includes('zmcc_id'), 'zmcc_tank_inventory_transaction columns', 'zmcc_id exists');
  assert(txColNames.includes('transaction_type'), 'zmcc_tank_inventory_transaction columns', 'transaction_type exists');
  assert(txColNames.includes('quantity_liters'), 'zmcc_tank_inventory_transaction columns', 'quantity_liters exists');
  assert(txColNames.includes('tank_receipt_id'), 'zmcc_tank_inventory_transaction columns', 'tank_receipt_id exists');
  assert(txColNames.includes('reference_type'), 'zmcc_tank_inventory_transaction columns', 'reference_type exists');
  assert(txColNames.includes('reference_id'), 'zmcc_tank_inventory_transaction columns', 'reference_id exists');
  assert(txColNames.includes('idempotency_key'), 'zmcc_tank_inventory_transaction columns', 'idempotency_key exists');

  // Check DB check constraints
  const dbConstraints = await prisma.$queryRaw<Array<{ conname: string }>>`
    SELECT conname FROM pg_constraint
    WHERE conname IN (
      'zmcc_tank_capacity_liters_check',
      'zmcc_tank_receipt_gross_liters_check',
      'zmcc_tank_inv_tx_quantity_liters_check'
    )
  `;
  const conNames = dbConstraints.map((c) => c.conname);
  assert(conNames.includes('zmcc_tank_capacity_liters_check'), 'DB Check Constraint', 'zmcc_tank_capacity_liters_check exists');
  assert(conNames.includes('zmcc_tank_receipt_gross_liters_check'), 'DB Check Constraint', 'zmcc_tank_receipt_gross_liters_check exists');
  assert(conNames.includes('zmcc_tank_inv_tx_quantity_liters_check'), 'DB Check Constraint', 'zmcc_tank_inv_tx_quantity_liters_check exists');

  // =============================================================
  // 2. STATIC CODE & ARCHITECTURAL CHECKS
  // =============================================================
  console.log('\n--- 2. STATIC CODE & ARCHITECTURAL CHECKS ---');
  const regressionRunnerPath = path.join(repoRoot, 'scripts', 'run_all_regressions.ts');
  const regressionRunnerContent = fs.readFileSync(regressionRunnerPath, 'utf8');
  assert(
    regressionRunnerContent.includes('test_stage6gd_zmcc_tank_receipt.ts'),
    'Architecture',
    'Suite registered in run_all_regressions.ts'
  );

  const zmccTankServicePath = path.join(repoRoot, 'src', 'backend', 'services', 'zmccTankService.ts');
  const zmccTankServiceContent = fs.readFileSync(zmccTankServicePath, 'utf8');
  assert(
    !zmccTankServiceContent.includes('SiloInventoryTransaction') &&
    !zmccTankServiceContent.includes('UnloadingLog') &&
    !zmccTankServiceContent.includes('VehicleVisit'),
    'Domain Separation',
    'No Plant Silo / Unloading / VehicleVisit reuse in ZMCC tank service'
  );

  assert(
    zmccTankServiceContent.includes('getTankPhysicalStock'),
    'Architecture',
    'Dynamic stock aggregation exists'
  );

  // =============================================================
  // 3. SETUP TEST FIXTURES
  // =============================================================
  console.log('\n--- 3. SETUP TEST FIXTURES ---');
  const runId = Date.now().toString().slice(-6);

  // Super Admin
  const superAdmin = await prisma.user.create({
    data: {
      username: `superadmin_6gd_${runId}`,
      password_hash: 'hash',
      role: 'SUPER_ADMIN',
      full_name: `Super Admin 6GD ${runId}`,
      is_active: true,
      scope_type: 'GLOBAL',
    },
  });

  // ZMCC Source 1
  const zmcc1 = await prisma.procurementSource.create({
    data: {
      code: `Z6GD1-${runId}`,
      name: `Stage 6GD ZMCC 1 ${runId}`,
      source_type: 'ZMCC',
      is_active: true,
    },
  });

  // ZMCC Source 2
  const zmcc2 = await prisma.procurementSource.create({
    data: {
      code: `Z6GD2-${runId}`,
      name: `Stage 6GD ZMCC 2 ${runId}`,
      source_type: 'ZMCC',
      is_active: true,
    },
  });

  // Contractor Source
  const contractor = await prisma.procurementSource.create({
    data: {
      code: `CON-6GD-${runId}`,
      name: `Contractor 6GD ${runId}`,
      source_type: 'CONTRACTOR',
      is_active: true,
    },
  });

  // Users for ZMCC 1
  const manager1 = await prisma.user.create({
    data: {
      username: `manager_6gd1_${runId}`,
      password_hash: 'hash',
      role: 'ZMCC_MANAGER',
      full_name: `ZMCC 1 Manager 6GD ${runId}`,
      is_active: true,
      procurement_source_id: zmcc1.id,
      scope_type: 'SOURCE',
    },
  });

  const attendant1 = await prisma.user.create({
    data: {
      username: `attendant_6gd1_${runId}`,
      password_hash: 'hash',
      role: 'ZMCC_LAB_ATTENDANT',
      full_name: `ZMCC 1 Attendant 6GD ${runId}`,
      is_active: true,
      procurement_source_id: zmcc1.id,
      scope_type: 'SOURCE',
    },
  });

  const phe1 = await prisma.user.create({
    data: {
      username: `phe_6gd1_${runId}`,
      password_hash: 'hash',
      role: 'PHE_OPERATOR',
      full_name: `PHE 1 6GD ${runId}`,
      is_active: true,
      procurement_source_id: zmcc1.id,
      scope_type: 'SOURCE',
    },
  });

  // User for ZMCC 2
  const manager2 = await prisma.user.create({
    data: {
      username: `manager_6gd2_${runId}`,
      password_hash: 'hash',
      role: 'ZMCC_MANAGER',
      full_name: `ZMCC 2 Manager 6GD ${runId}`,
      is_active: true,
      procurement_source_id: zmcc2.id,
      scope_type: 'SOURCE',
    },
  });

  // Inactive User
  const inactiveUser = await prisma.user.create({
    data: {
      username: `inactive_6gd_${runId}`,
      password_hash: 'hash',
      role: 'ZMCC_MANAGER',
      full_name: `Inactive User ${runId}`,
      is_active: false,
      procurement_source_id: zmcc1.id,
      scope_type: 'SOURCE',
    },
  });

  // Setup canonical Lab Tests: LR and FAT
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
  } else if (!lrTest.isActive) {
    lrTest = await prisma.labTest.update({ where: { id: lrTest.id }, data: { isActive: true } });
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
  } else if (!fatTest.isActive) {
    fatTest = await prisma.labTest.update({ where: { id: fatTest.id }, data: { isActive: true } });
  }

  // Setup MilkTestPolicyAssignment fixtures
  await prisma.milkTestPolicyAssignment.deleteMany({
    where: { testing_point: { in: ['ZMCC_LAB_MOT', 'ZMCC_LAB_CONTRACTOR'] } },
  });

  await prisma.milkTestPolicyAssignment.createMany({
    data: [
      { lab_test_id: lrTest.id, testing_point: 'ZMCC_LAB_MOT', is_required: true, display_order: 1, is_active: true, created_by_user_id: manager1.id },
      { lab_test_id: fatTest.id, testing_point: 'ZMCC_LAB_MOT', is_required: true, display_order: 2, is_active: true, created_by_user_id: manager1.id },
      { lab_test_id: lrTest.id, testing_point: 'ZMCC_LAB_CONTRACTOR', is_required: true, display_order: 1, is_active: true, created_by_user_id: manager1.id },
      { lab_test_id: fatTest.id, testing_point: 'ZMCC_LAB_CONTRACTOR', is_required: true, display_order: 2, is_active: true, created_by_user_id: manager1.id },
    ],
  });

  // Ensure active rules exist for lrTest and fatTest under ZMCC_LAB_MOT and ZMCC_LAB_CONTRACTOR
  for (const point of ['ZMCC_LAB_MOT', 'ZMCC_LAB_CONTRACTOR']) {
    for (const [testObj, minVal, maxVal] of [
      [lrTest, 26.0, 32.0],
      [fatTest, 3.5, 5.5],
    ] as const) {
      const existingRule = await prisma.labTestRule.findFirst({
        where: { lab_test_id: testObj.id, testing_point: point, is_active: true },
      });
      if (!existingRule) {
        await prisma.labTestRule.create({
          data: {
            lab_test_id: testObj.id,
            testing_point: point,
            version: 1,
            rule_category: 'RELEASE',
            min_value: minVal,
            max_value: maxVal,
            decision_consequence: 'REJECT',
            is_active: true,
            created_by: manager1.id,
          },
        });
      }
    }
  }

  // =============================================================
  // 4. TANK MASTER CRUD & ROLE PERMISSIONS & AUTH HARDENING
  // =============================================================
  console.log('\n--- 4. TANK MASTER CRUD & ROLE PERMISSIONS ---');

  // Auth Hardening: Request with forged x-user-id header but no signed cookie/session must return 401 Unauthorized
  console.log('\n--- 4A. AUTH HARDENING: FORGED x-user-id SPOOF TESTS ---');
  for (const [targetRole, targetUser] of [
    ['SUPER_ADMIN', superAdmin],
    ['ZMCC_MANAGER', manager1],
    ['ZMCC_LAB_ATTENDANT', attendant1],
  ] as const) {
    const forgedReadReq = new Request('http://localhost/api/zmcc/tanks', {
      headers: { 'x-user-id': targetUser.id.toString() },
    });
    const forgedReadRes = await listZmccTanks(forgedReadReq);
    assert(forgedReadRes.status === 401, `Spoof ${targetRole} Read`, `Forged x-user-id rejected with 401`);

    const forgedCreateReq = new Request('http://localhost/api/zmcc/tanks', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-user-id': targetUser.id.toString(),
      },
      body: JSON.stringify({
        tank_code: `FORGE-${targetRole}`,
        tank_name: 'Forged Tank',
        capacity_liters: 1000,
        zmcc_id: zmcc1.id.toString(),
      }),
    });
    const forgedCreateRes = await createZmccTank(forgedCreateReq, {
      tank_code: `FORGE-${targetRole}`,
      tank_name: 'Forged Tank',
      capacity_liters: 1000,
      zmcc_id: zmcc1.id.toString(),
    });
    assert(forgedCreateRes.status === 401, `Spoof ${targetRole} Create`, `Forged x-user-id rejected with 401`);

    const forgedHistReq = new Request('http://localhost/api/zmcc/lab/sessions/1/receive', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-user-id': targetUser.id.toString(),
      },
      body: JSON.stringify({ tank_id: '1' }),
    });
    const forgedHistRes = await receiveHistoricalSession(forgedHistReq, '1', { tank_id: '1' });
    assert(forgedHistRes.status === 401, `Spoof ${targetRole} Historical Receive`, `Forged x-user-id rejected with 401`);
  }

  // Attempt to create tank as ZMCC_MANAGER (must fail 403)
  const mgrCreateRes = await createZmccTank(toCoreUser(manager1) as any, {
    tank_code: `TKMGR-${runId}`,
    tank_name: 'Manager Attempt Tank',
    capacity_liters: 10000,
    zmcc_id: zmcc1.id.toString(),
  });
  assert(mgrCreateRes.status === 403, 'RBAC Create Tank', 'ZMCC Manager blocked from creating tank (403)');

  // Attempt to create tank as Inactive user (must fail 403)
  const inactCreateRes = await createZmccTank(toCoreUser(inactiveUser) as any, {
    tank_code: `TKINACT-${runId}`,
    tank_name: 'Inactive Attempt Tank',
    capacity_liters: 10000,
    zmcc_id: zmcc1.id.toString(),
  });
  assert(inactCreateRes.status === 403, 'RBAC Inactive User', 'Inactive user blocked from creating tank (403)');

  // Super Admin creates tank with capacity <= 0 (must fail 400)
  const zeroCapRes = await createZmccTank(toCoreUser(superAdmin) as any, {
    tank_code: `TKZERO-${runId}`,
    tank_name: 'Zero Cap Tank',
    capacity_liters: 0,
    zmcc_id: zmcc1.id.toString(),
  });
  assert(zeroCapRes.status === 400, 'Validation Zero Capacity', 'Zero capacity tank rejected (400)');

  // Super Admin creates valid Tank A for ZMCC 1
  const tankARes = await createZmccTank(toCoreUser(superAdmin) as any, {
    tank_code: `TK-A-${runId}`,
    tank_name: `Chilled Milk Tank A ${runId}`,
    capacity_liters: 10000,
    zmcc_id: zmcc1.id.toString(),
  });
  assert(tankARes.status === 201, 'Tank A Created', `Created Tank A with 10,000 L capacity (status 201)`);
  const tankAId = tankARes.data!.tank.id;

  // Attempt duplicate tank code in same ZMCC (must fail 400)
  const dupTankRes = await createZmccTank(toCoreUser(superAdmin) as any, {
    tank_code: `TK-A-${runId}`,
    tank_name: 'Duplicate Tank Code',
    capacity_liters: 5000,
    zmcc_id: zmcc1.id.toString(),
  });
  assert(dupTankRes.status === 400, 'Validation Duplicate Code', 'Duplicate tank code in same ZMCC rejected (400)');

  // Update Tank A capacity to 12,000 L
  const updateCapRes = await updateZmccTank(toCoreUser(superAdmin) as any, tankAId, {
    capacity_liters: 12000,
  });
  assert(updateCapRes.status === 200, 'Tank A Updated', 'Updated capacity to 12,000 L');
  assert(updateCapRes.data!.tank.capacity_liters === 12000, 'Tank A Capacity', 'New capacity is 12,000 L');

  // Read Tank A via ZMCC_MANAGER 1
  const mgrListRes = await listZmccTanks(toCoreUser(manager1) as any, undefined, false);
  assert(mgrListRes.status === 200, 'Manager 1 Read Tanks', 'Manager 1 can read tanks');
  assert(mgrListRes.data!.tanks.some((t: any) => t.id === tankAId), 'Manager 1 Scope', 'Tank A is visible to Manager 1');

  // Manager 2 cannot see Tank A (cross-ZMCC isolation)
  const mgr2ListRes = await listZmccTanks(toCoreUser(manager2) as any, undefined, false);
  assert(mgr2ListRes.status === 200, 'Manager 2 Read Tanks', 'Manager 2 can read tanks');
  assert(!mgr2ListRes.data!.tanks.some((t: any) => t.id === tankAId), 'Cross-ZMCC Isolation', 'Tank A is NOT visible to Manager 2');

  // Attendant 1 can view Tank A
  const att1ListRes = await listZmccTanks(toCoreUser(attendant1) as any, undefined, false);
  assert(att1ListRes.status === 200, 'Attendant 1 Read Tanks', 'Attendant 1 can read tanks');
  assert(att1ListRes.data!.tanks.some((t: any) => t.id === tankAId), 'Attendant 1 Scope', 'Tank A is visible to Attendant 1');

  // =============================================================
  // 5. SESSION COMPLETION "ACCEPT & RECEIVE" WORKFLOW
  // =============================================================
  console.log('\n--- 5. SESSION COMPLETION "ACCEPT & RECEIVE" WORKFLOW ---');

  // Helper to create completed MOT Journey and Arrival
  async function createCompletedMotArrival(tokenSuffix: string) {
    const route = await prisma.zmccRoute.create({
      data: {
        zmcc_id: zmcc1.id,
        route_code: `R-6GD-${tokenSuffix}`,
        name: `Route 6GD ${tokenSuffix}`,
        origin: 'Origin',
        destination: 'ZMCC',
        created_by: manager1.id,
        updated_by: manager1.id,
      },
    });
    const vehicle = await prisma.motVehicle.create({
      data: {
        zmcc_id: zmcc1.id,
        vehicle_number: `MOT-6GD-${tokenSuffix}`,
        created_by: manager1.id,
        updated_by: manager1.id,
      },
    });
    const motProfile = await prisma.motProfile.create({
      data: {
        zmcc_id: zmcc1.id,
        mot_code: `MOT6GD-${tokenSuffix}`,
        name: `MOT Officer 6GD ${tokenSuffix}`,
        phone_number: '03001234567',
        cnic: '35201-1234567-1',
        created_by: manager1.id,
        updated_by: manager1.id,
      },
    });
    const journey = await prisma.motJourney.create({
      data: {
        journey_number: `J6GD-${tokenSuffix}`,
        idempotency_key: `dispatch-j6gd-${tokenSuffix}`,
        zmcc_id: zmcc1.id,
        route_id: route.id,
        mot_vehicle_id: vehicle.id,
        mot_profile_id: motProfile.id,
        assigned_by: manager1.id,
        assigned_at: new Date(Date.now() - 3600000),
        assignment_latitude: new Prisma.Decimal('31.5204'),
        assignment_longitude: new Prisma.Decimal('74.3587'),
        start_latitude: new Prisma.Decimal('31.5204'),
        start_longitude: new Prisma.Decimal('74.3587'),
        status: 'COLLECTING',
        operational_date: new Date(),
        started_at: new Date(Date.now() - 3600000),
      },
    });

    const arrivalRes = await submitMotArrival(
      toCoreUser(phe1) as any,
      {
        journey_id: journey.id,
        route_milk_token: `RM-${tokenSuffix}`,
        arrival_timestamp: new Date(Date.now() - 1800000),
        client_event_id: `evt-mot-arr-${tokenSuffix}`,
      }
    );

    return { arrival: arrivalRes.data, journey };
  }

  // Deactivate Tank A temporarily to test 0 active tanks fail-closed
  await toggleZmccTankActive(toCoreUser(superAdmin) as any, tankAId, false);

  // Start Session 1
  const { arrival: arr1 } = await createCompletedMotArrival(`01-${runId}`);
  const s1Start = await startOrResumeSession(
    toCoreUser(attendant1) as any,
    { arrival_type: 'MOT', arrival_id: BigInt(arr1.id) }
  );
  assert(s1Start.status === 201, 'Session 1 Started', 'Status 201');
  const s1Id = BigInt(s1Start.data!.id);

  // Complete Session 1 with REJECTED -> should succeed without tank
  const s1RejRes = await completeSession(
    toCoreUser(attendant1) as any,
    s1Id,
    {
      completion_client_event_id: `evt-c-s1-${runId}`,
      quantity_value: 5000,
      quantity_unit: 'LITER',
      decision: 'REJECTED',
      rejection_reason: 'High acidity',
      results: [
        { test_id: lrTest.id, numeric_value: 28, text_value: null },
        { test_id: fatTest.id, numeric_value: 3.5, text_value: null },
      ],
    }
  );
  assert(s1RejRes.status === 200, 'Session 1 Finalized Rejected', 'Status 200');
  assert(s1RejRes.data!.decision === 'REJECTED', 'Decision Rejected', 'Decision is REJECTED');
  assert(!s1RejRes.data!.tank_receipt, 'No Tank Receipt for Rejected', 'tank_receipt is null for REJECTED');

  // Start Session 2 (test 0 active tanks when decision = ACCEPTED)
  const { arrival: arr2 } = await createCompletedMotArrival(`02-${runId}`);
  const s2Start = await startOrResumeSession(
    toCoreUser(attendant1) as any,
    { arrival_type: 'MOT', arrival_id: BigInt(arr2.id) }
  );
  const s2Id = BigInt(s2Start.data!.id);

  const s2ZeroTanksRes = await completeSession(
    toCoreUser(attendant1) as any,
    s2Id,
    {
      completion_client_event_id: `evt-c-s2-${runId}`,
      quantity_value: 5000,
      quantity_unit: 'LITER',
      decision: 'ACCEPTED',
      results: [
        { test_id: lrTest.id, numeric_value: 30, text_value: null },
        { test_id: fatTest.id, numeric_value: 4.0, text_value: null },
      ],
    }
  );
  assert(s2ZeroTanksRes.status === 400, 'Zero Active Tanks Blocked', 'Fails closed when 0 active tanks configured');
  assert(Boolean(s2ZeroTanksRes.error?.includes('No active ZMCC tank is configured.')), 'Zero Tank Error Message', s2ZeroTanksRes.error);

  // Attempt completion specifying the deactivated Tank A explicitly -> must fail closed 400
  const s2InactExplicitRes = await completeSession(
    toCoreUser(attendant1) as any,
    s2Id,
    {
      completion_client_event_id: `evt-c-s2-inact-${runId}`,
      tank_id: tankAId,
      quantity_value: 5000,
      quantity_unit: 'LITER',
      decision: 'ACCEPTED',
      results: [
        { test_id: lrTest.id, numeric_value: 30, text_value: null },
        { test_id: fatTest.id, numeric_value: 4.0, text_value: null },
      ],
    }
  );
  assert(s2InactExplicitRes.status === 400, 'Inactive Destination Tank Blocked', 'Fails closed when destination tank is inactive (400)');
  assert(Boolean(s2InactExplicitRes.error?.includes('Destination ZMCC tank is inactive.')), 'Inactive Tank Error Message', s2InactExplicitRes.error);

  // Reactivate Tank A (now exactly 1 active tank exists for ZMCC 1: 12,000 L capacity)
  await toggleZmccTankActive(toCoreUser(superAdmin) as any, tankAId, true);

  // Complete Session 2 with 1 active tank -> auto-selects Tank A!
  const s2AccRes = await completeSession(
    toCoreUser(attendant1) as any,
    s2Id,
    {
      completion_client_event_id: `evt-c-s2-${runId}`,
      quantity_value: 5000,
      quantity_unit: 'LITER',
      decision: 'ACCEPTED',
      results: [
        { test_id: lrTest.id, numeric_value: 30, text_value: null },
        { test_id: fatTest.id, numeric_value: 4.0, text_value: null },
      ],
    }
  );
  assert(s2AccRes.status === 200, 'Session 2 Finalized Accepted', 'Status 200 with auto-selected single tank');
  assert(!!s2AccRes.data!.tank_receipt, 'Tank Receipt Created', 'tank_receipt exists');
  assert(s2AccRes.data!.tank_receipt.tank_id === tankAId, 'Auto-selected Tank A', 'Receipt belongs to Tank A');
  assert(s2AccRes.data!.tank_receipt.gross_liters === 5000.00, 'Receipt Gross Liters', 'Receipt gross liters = 5000.00');

  // Verify inventory transaction created for Session 2
  const txS2 = await prisma.zmccTankInventoryTransaction.findFirst({
    where: { tank_receipt_id: BigInt(s2AccRes.data!.tank_receipt.id) },
  });
  assert(!!txS2, 'Inventory Transaction Created', 'Found inventory transaction row');
  assert(txS2?.transaction_type === 'RECEIPT', 'Transaction Type', 'Transaction type is RECEIPT');
  assert(Number(txS2?.quantity_liters) === 5000.00, 'Transaction Quantity', 'Transaction quantity is 5000.00 L');

  // Check Tank A current stock
  const tankAAfterS2 = await getZmccTankById(toCoreUser(manager1) as any, tankAId);
  assert(tankAAfterS2.data!.tank.current_stock === 5000.00, 'Tank A Stock', `Current stock = ${tankAAfterS2.data!.tank.current_stock} L (expected 5000.00)`);
  assert(tankAAfterS2.data!.tank.available_capacity === 7000.00, 'Tank A Available', `Available = ${tankAAfterS2.data!.tank.available_capacity} L (expected 7000.00)`);

  // Idempotent exact completion replay
  const s2ReplayRes = await completeSession(
    toCoreUser(attendant1) as any,
    s2Id,
    {
      completion_client_event_id: `evt-c-s2-${runId}`,
      quantity_value: 5000,
      quantity_unit: 'LITER',
      decision: 'ACCEPTED',
      results: [
        { test_id: lrTest.id, numeric_value: 30, text_value: null },
        { test_id: fatTest.id, numeric_value: 4.0, text_value: null },
      ],
    }
  );
  assert(s2ReplayRes.status === 200, 'Idempotent Replay', 'Status 200 on exact replay');
  const txCountS2 = await prisma.zmccTankInventoryTransaction.count({
    where: { tank_receipt_id: BigInt(s2AccRes.data!.tank_receipt.id) },
  });
  assert(txCountS2 === 1, 'Zero Duplicate Ledger Rows', 'Exactly 1 ledger transaction exists after replay');

  // Attempt to create Tank B while Tank A is active (Stage 6G-D.1: exactly 1 active tank per ZMCC)
  const tankBConflictRes = await createZmccTank(toCoreUser(superAdmin) as any, {
    tank_code: `TK-B-${runId}`,
    tank_name: `Chilled Milk Tank B ${runId}`,
    capacity_liters: 8000,
    zmcc_id: zmcc1.id.toString(),
  });
  assert(tankBConflictRes.status === 400, 'Single Active Tank Enforced', 'Creating 2nd active tank rejected (400)');
  assert(
    Boolean(tankBConflictRes.error?.includes('Only one active tank is permitted per ZMCC')),
    'Single Active Tank Error Message',
    tankBConflictRes.error
  );

  // Deactivate Tank A to allow activating Tank B as sole active tank
  await toggleZmccTankActive(toCoreUser(superAdmin) as any, tankAId, false);

  // Create Tank B for ZMCC 1
  const tankBRes = await createZmccTank(toCoreUser(superAdmin) as any, {
    tank_code: `TK-B-${runId}`,
    tank_name: `Chilled Milk Tank B ${runId}`,
    capacity_liters: 8000,
    zmcc_id: zmcc1.id.toString(),
  });
  assert(tankBRes.status === 201, 'Tank B Created', 'Created Tank B as sole active tank');
  const tankBId = tankBRes.data!.tank.id;

  // Start Session 3
  const { arrival: arr3 } = await createCompletedMotArrival(`03-${runId}`);
  const s3Start = await startOrResumeSession(
    toCoreUser(attendant1) as any,
    { arrival_type: 'MOT', arrival_id: BigInt(arr3.id) }
  );
  const s3Id = BigInt(s3Start.data!.id);

  // Complete Session 3 specifying inactive Tank A (must fail 400)
  const s3InactiveTankRes = await completeSession(
    toCoreUser(attendant1) as any,
    s3Id,
    {
      completion_client_event_id: `evt-c-s3-inact-${runId}`,
      tank_id: tankAId,
      quantity_value: 4000,
      quantity_unit: 'LITER',
      decision: 'ACCEPTED',
      results: [
        { test_id: lrTest.id, numeric_value: 30, text_value: null },
        { test_id: fatTest.id, numeric_value: 4.0, text_value: null },
      ],
    }
  );
  assert(s3InactiveTankRes.status === 400, 'Inactive Tank Selection Blocked', 'Fails closed when destination tank is inactive (400)');
  assert(Boolean(s3InactiveTankRes.error?.includes('inactive')), 'Inactive Tank Error Message', s3InactiveTankRes.error);

  // Complete Session 3 specifying Tank B with quantity exceeding Tank B capacity (e.g. 9,000 L into 8,000 L capacity)
  const s3OverfillRes = await completeSession(
    toCoreUser(attendant1) as any,
    s3Id,
    {
      completion_client_event_id: `evt-c-s3-${runId}`,
      tank_id: tankBId,
      quantity_value: 9000,
      quantity_unit: 'LITER',
      decision: 'ACCEPTED',
      results: [
        { test_id: lrTest.id, numeric_value: 30, text_value: null },
        { test_id: fatTest.id, numeric_value: 4.0, text_value: null },
      ],
    }
  );
  assert(s3OverfillRes.status === 400, 'Capacity Overfill Guard', 'Fails closed when milk quantity exceeds tank capacity');
  assert(Boolean(s3OverfillRes.error?.includes('Tank capacity is insufficient')), 'Capacity Error Message', s3OverfillRes.error);

  // Complete Session 3 successfully into Tank B (3,000 L)
  const s3AccRes = await completeSession(
    toCoreUser(attendant1) as any,
    s3Id,
    {
      completion_client_event_id: `evt-c-s3-${runId}`,
      tank_id: tankBId,
      quantity_value: 3000,
      quantity_unit: 'LITER',
      decision: 'ACCEPTED',
      results: [
        { test_id: lrTest.id, numeric_value: 30, text_value: null },
        { test_id: fatTest.id, numeric_value: 4.0, text_value: null },
      ],
    }
  );
  assert(s3AccRes.status === 200, 'Session 3 Completed Tank B', 'Status 200');
  assert(s3AccRes.data!.tank_receipt.tank_id === tankBId, 'Receipt Assigned Tank B', 'Receipt is assigned to Tank B');

  // Verify Tank B stock
  const tankBAfterS3 = await getZmccTankById(toCoreUser(manager1) as any, tankBId);
  assert(tankBAfterS3.data!.tank.current_stock === 3000.00, 'Tank B Stock', `Tank B stock = ${tankBAfterS3.data!.tank.current_stock} L (expected 3000.00)`);

  // =============================================================
  // 6. SUPERVISORY CORRECTIONS & LEDGER ADJUSTMENTS
  // =============================================================
  console.log('\n--- 6. SUPERVISORY CORRECTIONS & LEDGER ADJUSTMENTS ---');

  // Attendant cannot correct Session 3 (403)
  const attCorrRes = await correctCompletedSession(
    toCoreUser(attendant1) as any,
    s3Id,
    {
      correction_reason: 'Attendant correction attempt',
      quantity_value: 3200,
      quantity_unit: 'LITER',
      decision: 'ACCEPTED',
      results: [
        { test_id: lrTest.id, numeric_value: 30, text_value: null },
        { test_id: fatTest.id, numeric_value: 4.0, text_value: null },
      ],
    }
  );
  assert(attCorrRes.status === 403, 'RBAC Operator Correction Blocked', 'Attendant blocked from correcting completed session (403)');

  // =============================================================
  // 6A. DECISION SAFETY GUARDS (Stage 6G-D Physical Inventory Protection)
  // =============================================================
  console.log('\n--- 6A. DECISION SAFETY GUARDS ---');

  // A. Attempt ACCEPTED -> REJECTED on Session 3 (which has a tank receipt)
  const txCountBeforeFlipped = await prisma.zmccTankInventoryTransaction.count({
    where: { receipt: { lab_session_id: s3Id } },
  });
  const receiptBeforeFlipped = await prisma.zmccTankReceipt.findUnique({
    where: { lab_session_id: s3Id },
  });
  const sessionBeforeFlipped = await prisma.zmccLabSession.findUnique({
    where: { id: s3Id },
  });

  const flipAccToRejRes = await correctCompletedSession(
    toCoreUser(manager1) as any,
    s3Id,
    {
      correction_reason: 'Attempting to change decision to REJECTED',
      quantity_value: 3000,
      quantity_unit: 'LITER',
      decision: 'REJECTED',
      rejection_reason: 'Should fail closed',
      results: [
        { test_id: lrTest.id, numeric_value: 30, text_value: null },
        { test_id: fatTest.id, numeric_value: 4.0, text_value: null },
      ],
    }
  );
  assert(flipAccToRejRes.status === 400, 'Decision Guard: ACCEPTED -> REJECTED Blocked', 'Cannot change decision after tank receipt (400)');
  assert(
    Boolean(flipAccToRejRes.error?.includes('Decision cannot be changed after milk has been received into a ZMCC tank.')),
    'Decision Guard Error Message',
    flipAccToRejRes.error
  );

  const receiptAfterFlipped = await prisma.zmccTankReceipt.findUnique({
    where: { lab_session_id: s3Id },
  });
  const txCountAfterFlipped = await prisma.zmccTankInventoryTransaction.count({
    where: { receipt: { lab_session_id: s3Id } },
  });
  const sessionAfterFlipped = await prisma.zmccLabSession.findUnique({
    where: { id: s3Id },
  });

  assert(receiptAfterFlipped?.id === receiptBeforeFlipped?.id, 'Receipt Unchanged After Blocked Flip', 'Receipt row intact');
  assert(txCountAfterFlipped === txCountBeforeFlipped, 'Ledger Unchanged After Blocked Flip', 'No new ledger transactions');
  assert(sessionAfterFlipped?.correction_count === sessionBeforeFlipped?.correction_count, 'Correction Count Not Consumed', 'Correction count unchanged');

  // B. Attempt REJECTED -> ACCEPTED on Session 1 (which was REJECTED)
  const session1Before = await prisma.zmccLabSession.findUnique({ where: { id: s1Id } });
  const flipRejToAccRes = await correctCompletedSession(
    toCoreUser(manager1) as any,
    s1Id,
    {
      correction_reason: 'Attempting to change rejected session to ACCEPTED',
      quantity_value: 5000,
      quantity_unit: 'LITER',
      decision: 'ACCEPTED',
      results: [
        { test_id: lrTest.id, numeric_value: 28, text_value: null },
        { test_id: fatTest.id, numeric_value: 3.5, text_value: null },
      ],
    }
  );
  assert(flipRejToAccRes.status === 400, 'Decision Guard: REJECTED -> ACCEPTED Blocked', 'Cannot change REJECTED to ACCEPTED in correction (400)');
  assert(
    Boolean(flipRejToAccRes.error?.includes('Decision cannot be changed from REJECTED to ACCEPTED in correction.')),
    'Decision Guard Error Message',
    flipRejToAccRes.error
  );

  const receiptS1 = await prisma.zmccTankReceipt.findUnique({ where: { lab_session_id: s1Id } });
  const session1After = await prisma.zmccLabSession.findUnique({ where: { id: s1Id } });
  assert(!receiptS1, 'No Receipt for Rejected Session', 'No receipt created');
  assert(session1After?.correction_count === session1Before?.correction_count, 'Correction Count Not Consumed (Rejected)', 'Correction count unchanged');

  // Positive delta correction: 3,000 L -> 3,500 L (+500 L)
  // Tank B has 8,000 capacity, stock was 3,000 -> remaining capacity is 5,000 L -> +500 fits!
  const posCorrRes = await correctCompletedSession(
    toCoreUser(manager1) as any,
    s3Id,
    {
      correction_reason: 'Dipstick scale recalibration (+500 L)',
      quantity_value: 3500,
      quantity_unit: 'LITER',
      decision: 'ACCEPTED',
      results: [
        { test_id: lrTest.id, numeric_value: 30, text_value: null },
        { test_id: fatTest.id, numeric_value: 4.0, text_value: null },
      ],
    }
  );
  assert(posCorrRes.status === 200, 'Positive Correction Status', 'Correction saved successfully');
  assert(posCorrRes.data!.tank_receipt.gross_liters === 3500.00, 'Receipt Updated Gross', 'Receipt gross liters updated to 3500.00');

  // Verify ADJUSTMENT_IN transaction created
  const adjInTx = await prisma.zmccTankInventoryTransaction.findFirst({
    where: {
      tank_receipt_id: BigInt(posCorrRes.data!.tank_receipt.id),
      transaction_type: 'ADJUSTMENT_IN',
    },
  });
  assert(!!adjInTx, 'ADJUSTMENT_IN Created', 'Found ADJUSTMENT_IN transaction row');
  assert(Number(adjInTx?.quantity_liters) === 500.00, 'ADJUSTMENT_IN Quantity', 'Quantity is +500.00 L');

  // Verify Tank B stock is now 3,500 L
  const tankBAfterPos = await getZmccTankById(toCoreUser(manager1) as any, tankBId);
  assert(tankBAfterPos.data!.tank.current_stock === 3500.00, 'Tank B Stock After Adjustment In', `Tank B stock = ${tankBAfterPos.data!.tank.current_stock} L (expected 3500.00)`);

  // Negative delta correction: 3,500 L -> 3,100 L (-400 L)
  const negCorrRes = await correctCompletedSession(
    toCoreUser(manager1) as any,
    s3Id,
    {
      correction_reason: 'Correction downwards (-400 L)',
      quantity_value: 3100,
      quantity_unit: 'LITER',
      decision: 'ACCEPTED',
      results: [
        { test_id: lrTest.id, numeric_value: 30, text_value: null },
        { test_id: fatTest.id, numeric_value: 4.0, text_value: null },
      ],
    }
  );
  assert(negCorrRes.status === 200, 'Negative Correction Status', 'Correction saved successfully');
  assert(negCorrRes.data!.tank_receipt.gross_liters === 3100.00, 'Receipt Updated Gross', 'Receipt gross liters updated to 3100.00');

  // Verify ADJUSTMENT_OUT transaction created
  const adjOutTx = await prisma.zmccTankInventoryTransaction.findFirst({
    where: {
      tank_receipt_id: BigInt(negCorrRes.data!.tank_receipt.id),
      transaction_type: 'ADJUSTMENT_OUT',
    },
  });
  assert(!!adjOutTx, 'ADJUSTMENT_OUT Created', 'Found ADJUSTMENT_OUT transaction row');
  assert(Number(adjOutTx?.quantity_liters) === 400.00, 'ADJUSTMENT_OUT Quantity', 'Quantity is 400.00 L');

  // Verify Tank B stock is now 3,100 L
  const tankBAfterNeg = await getZmccTankById(toCoreUser(manager1) as any, tankBId);
  assert(tankBAfterNeg.data!.tank.current_stock === 3100.00, 'Tank B Stock After Adjustment Out', `Tank B stock = ${tankBAfterNeg.data!.tank.current_stock} L (expected 3100.00)`);

  // Zero delta correction: change remarks only, quantity remains 3,100 L
  const txCountBeforeZero = await prisma.zmccTankInventoryTransaction.count({
    where: { tank_receipt_id: BigInt(negCorrRes.data!.tank_receipt.id) },
  });
  const zeroCorrRes = await correctCompletedSession(
    toCoreUser(manager1) as any,
    s3Id,
    {
      correction_reason: 'Updated remarks only',
      quantity_value: 3100,
      quantity_unit: 'LITER',
      decision: 'ACCEPTED',
      remarks: 'Revised remarks with no volume change',
      results: [
        { test_id: lrTest.id, numeric_value: 30, text_value: null },
        { test_id: fatTest.id, numeric_value: 4.0, text_value: null },
      ],
    }
  );
  assert(zeroCorrRes.status === 200, 'Zero Delta Correction Status', 'Correction saved successfully');
  const txCountAfterZero = await prisma.zmccTankInventoryTransaction.count({
    where: { tank_receipt_id: BigInt(negCorrRes.data!.tank_receipt.id) },
  });
  assert(txCountAfterZero === txCountBeforeZero, 'Zero Delta No Transaction', 'No new inventory transaction created for zero delta');

  // Negative stock guard: attempting a correction that would deduct more than the tank's current physical stock
  // Deactivate Tank B to allow activating Tank C as sole active tank
  await toggleZmccTankActive(toCoreUser(superAdmin) as any, tankBId, false);

  const tankCRes = await createZmccTank(toCoreUser(superAdmin) as any, {
    tank_code: `TK-C-${runId}`,
    tank_name: `Small Tank C ${runId}`,
    capacity_liters: 1000,
    zmcc_id: zmcc1.id.toString(),
  });
  const tankCId = tankCRes.data!.tank.id;

  const { arrival: arr4 } = await createCompletedMotArrival(`04-${runId}`);
  const s4Start = await startOrResumeSession(
    toCoreUser(attendant1) as any,
    { arrival_type: 'MOT', arrival_id: BigInt(arr4.id) }
  );
  const s4Id = BigInt(s4Start.data!.id);

  await completeSession(
    toCoreUser(attendant1) as any,
    s4Id,
    {
      completion_client_event_id: `evt-c-s4-${runId}`,
      tank_id: tankCId,
      quantity_value: 500,
      quantity_unit: 'LITER',
      decision: 'ACCEPTED',
      results: [
        { test_id: lrTest.id, numeric_value: 30, text_value: null },
        { test_id: fatTest.id, numeric_value: 4.0, text_value: null },
      ],
    }
  );

  // Artificially simulate an ISSUE transaction that lowered Tank C stock to 50 L
  await prisma.zmccTankInventoryTransaction.create({
    data: {
      tank_id: BigInt(tankCId),
      zmcc_id: zmcc1.id,
      transaction_type: 'ISSUE',
      quantity_liters: new Prisma.Decimal('450.00'),
      reference_type: 'DISPATCH',
      reference_id: 'test-disp-01',
      idempotency_key: `sim-issue-${runId}`,
      operational_timestamp: new Date(),
      performed_by_user_id: manager1.id,
      notes: 'Simulated dispatch',
    },
  });

  // Current stock of Tank C is now 50 L (500 - 450)
  const tankCAfterIssue = await getZmccTankById(toCoreUser(manager1) as any, tankCId);
  assert(tankCAfterIssue.data!.tank.current_stock === 50.00, 'Simulated Low Stock', 'Tank C stock is 50 L');

  // Now attempt to correct Session 4 from 500 L down to 400 L (delta = -100 L)
  // Since Tank C physical stock is only 50 L, deducting 100 L would yield -50 L stock!
  const negStockRes = await correctCompletedSession(
    toCoreUser(manager1) as any,
    s4Id,
    {
      correction_reason: 'Correction exceeding physical stock',
      quantity_value: 400,
      quantity_unit: 'LITER',
      decision: 'ACCEPTED',
      results: [
        { test_id: lrTest.id, numeric_value: 30, text_value: null },
        { test_id: fatTest.id, numeric_value: 4.0, text_value: null },
      ],
    }
  );
  assert(negStockRes.status === 400, 'Negative Stock Guard', 'Correction blocked when deduction exceeds physical stock (400)');
  assert(Boolean(negStockRes.error?.includes('NEGATIVE_STOCK')), 'Negative Stock Error Format', negStockRes.error);

  // Deactivate Tank C and reactivate Tank A for historical receipt testing
  await toggleZmccTankActive(toCoreUser(superAdmin) as any, tankCId, false);
  await toggleZmccTankActive(toCoreUser(superAdmin) as any, tankAId, true);

  // =============================================================
  // 7. CONTROLLED HISTORICAL PRE-6G-D RECEIPT CREATION & HARDENING
  // =============================================================
  console.log('\n--- 7. CONTROLLED HISTORICAL PRE-6G-D RECEIPT CREATION & HARDENING ---');

  // Create a synthetic historical session (status = COMPLETED, decision = ACCEPTED, complete 6G-C metrics, authoritative LR/Fat results)
  const { arrival: histArrival } = await createCompletedMotArrival(`hist-${runId}`);
  const histSession = await prisma.zmccLabSession.create({
    data: {
      zmcc_id: zmcc1.id,
      arrival_type: 'MOT',
      mot_arrival_id: BigInt(histArrival.id),
      status: 'COMPLETED',
      started_at: new Date(),
      started_by_user_id: attendant1.id,
      completed_at: new Date(),
      completed_by_user_id: attendant1.id,
      decision: 'ACCEPTED',
      quantity_value: new Prisma.Decimal('4000.00'),
      quantity_unit: 'LITER',
      density: new Prisma.Decimal('1.0300'),
      gross_liters: new Prisma.Decimal('4000.00'),
      snf: new Prisma.Decimal('9.10'),
      ts: new Prisma.Decimal('13.10'),
      at_13ts_liters: new Prisma.Decimal('4030.77'),
      calculation_version: '1.0',
      results: {
        create: [
          {
            test_id: lrTest.id,
            test_code_snapshot: 'LR',
            test_name_snapshot: 'Lactometer Reading',
            result_type_snapshot: 'NUMERIC',
            unit_snapshot: 'LR',
            is_required_snapshot: true,
            display_order_snapshot: 1,
            numeric_value: new Prisma.Decimal('30.00'),
            evaluation_status: 'PASSED',
            is_passed: true,
            recorded_at: new Date(),
          },
          {
            test_id: fatTest.id,
            test_code_snapshot: 'FAT',
            test_name_snapshot: 'Fat Content',
            result_type_snapshot: 'NUMERIC',
            unit_snapshot: '%',
            is_required_snapshot: true,
            display_order_snapshot: 2,
            numeric_value: new Prisma.Decimal('4.00'),
            evaluation_status: 'PASSED',
            is_passed: true,
            recorded_at: new Date(),
          },
        ],
      },
    },
  });

  // 7A. RBAC & Historical Authority Checks
  // Attempt historical receipt as Inactive user (must fail 403)
  const inactHistRes = await receiveHistoricalSession(toCoreUser(inactiveUser) as any, histSession.id.toString(), {
    tank_id: tankAId,
  });
  assert(inactHistRes.status === 403, 'Inactive User Historical Receipt Blocked', 'Inactive user blocked from historical receipt (403)');

  // Attempt historical receipt as ZMCC_MANAGER (must fail 403: only ZMCC_LAB_ATTENDANT or SUPER_ADMIN permitted)
  const mgrHistRes = await receiveHistoricalSession(toCoreUser(manager1) as any, histSession.id.toString(), {
    tank_id: tankAId,
  });
  assert(mgrHistRes.status === 403, 'ZMCC Manager Historical Receipt Blocked', 'Manager blocked from historical receipt (403)');
  assert(
    Boolean(mgrHistRes.error?.includes('Only ZMCC Lab Attendant or Super Admin can receive milk into tank.')),
    'Manager 403 Error Message',
    mgrHistRes.error
  );

  // Attempt historical receipt for non-existent session (404)
  const nonExistHistRes = await receiveHistoricalSession(toCoreUser(attendant1) as any, '99999999', {
    tank_id: tankAId,
  });
  assert(nonExistHistRes.status === 404, 'Non-existent Historical Session', 'Status 404 for missing session');

  // Attempt historical receipt on Session 1 (which was REJECTED) -> must fail 400
  const rejHistRes = await receiveHistoricalSession(toCoreUser(attendant1) as any, s1Id.toString(), {
    tank_id: tankAId,
  });
  assert(rejHistRes.status === 400, 'Rejected Historical Session Blocked', 'Historical receipt blocked on REJECTED session (400)');

  // 7B. No Fake Quality & Fail-Closed Snapshot Validation
  // Historical session missing LR/Fat results
  const { arrival: noQArrival } = await createCompletedMotArrival(`noq-${runId}`);
  const noQHistSession = await prisma.zmccLabSession.create({
    data: {
      zmcc_id: zmcc1.id,
      arrival_type: 'MOT',
      mot_arrival_id: BigInt(noQArrival.id),
      status: 'COMPLETED',
      started_at: new Date(),
      started_by_user_id: attendant1.id,
      completed_at: new Date(),
      completed_by_user_id: attendant1.id,
      decision: 'ACCEPTED',
      quantity_value: new Prisma.Decimal('3000.00'),
      quantity_unit: 'LITER',
      density: new Prisma.Decimal('1.0300'),
      gross_liters: new Prisma.Decimal('3000.00'),
      snf: new Prisma.Decimal('9.10'),
      ts: new Prisma.Decimal('13.10'),
      at_13ts_liters: new Prisma.Decimal('3023.08'),
      calculation_version: '1.0',
    },
  });
  const noQHistRes = await receiveHistoricalSession(toCoreUser(attendant1) as any, noQHistSession.id.toString(), {
    tank_id: tankAId,
  });
  assert(noQHistRes.status === 400, 'Missing LR/Fat Fail-Closed', 'Fails closed when historical session lacks LR/Fat results (400)');
  assert(
    noQHistRes.error === 'Historical session does not contain authoritative LR/Fat values required for tank receipt.',
    'No Fake Quality Error Message',
    noQHistRes.error
  );

  // Historical session missing calculation_version
  const { arrival: noCalcArrival } = await createCompletedMotArrival(`nocalc-${runId}`);
  const noCalcHistSession = await prisma.zmccLabSession.create({
    data: {
      zmcc_id: zmcc1.id,
      arrival_type: 'MOT',
      mot_arrival_id: BigInt(noCalcArrival.id),
      status: 'COMPLETED',
      started_at: new Date(),
      started_by_user_id: attendant1.id,
      completed_at: new Date(),
      completed_by_user_id: attendant1.id,
      decision: 'ACCEPTED',
      quantity_value: new Prisma.Decimal('3000.00'),
      quantity_unit: 'LITER',
      density: new Prisma.Decimal('1.0300'),
      gross_liters: new Prisma.Decimal('3000.00'),
      snf: new Prisma.Decimal('9.10'),
      ts: new Prisma.Decimal('13.10'),
      at_13ts_liters: new Prisma.Decimal('3023.08'),
      calculation_version: null, // missing calculation version
      results: {
        create: [
          {
            test_id: lrTest.id,
            test_code_snapshot: 'LR',
            test_name_snapshot: 'Lactometer Reading',
            result_type_snapshot: 'NUMERIC',
            unit_snapshot: 'LR',
            is_required_snapshot: true,
            display_order_snapshot: 1,
            numeric_value: new Prisma.Decimal('30.00'),
            evaluation_status: 'PASSED',
            is_passed: true,
            recorded_at: new Date(),
          },
          {
            test_id: fatTest.id,
            test_code_snapshot: 'FAT',
            test_name_snapshot: 'Fat Content',
            result_type_snapshot: 'NUMERIC',
            unit_snapshot: '%',
            is_required_snapshot: true,
            display_order_snapshot: 2,
            numeric_value: new Prisma.Decimal('4.00'),
            evaluation_status: 'PASSED',
            is_passed: true,
            recorded_at: new Date(),
          },
        ],
      },
    },
  });
  const noCalcHistRes = await receiveHistoricalSession(toCoreUser(attendant1) as any, noCalcHistSession.id.toString(), {
    tank_id: tankAId,
  });
  assert(noCalcHistRes.status === 400, 'Missing Calculation Version Fail-Closed', 'Fails closed when calculation_version is missing (400)');
  assert(
    Boolean(noCalcHistRes.error?.includes('Stage 6G-C metrics required for tank receipt.')),
    'Missing Calc Version Error Message',
    noCalcHistRes.error
  );

  // Historical session missing gross_liters
  const { arrival: noGrossArrival } = await createCompletedMotArrival(`nogross-${runId}`);
  const noGrossHistSession = await prisma.zmccLabSession.create({
    data: {
      zmcc_id: zmcc1.id,
      arrival_type: 'MOT',
      mot_arrival_id: BigInt(noGrossArrival.id),
      status: 'COMPLETED',
      started_at: new Date(),
      started_by_user_id: attendant1.id,
      completed_at: new Date(),
      completed_by_user_id: attendant1.id,
      decision: 'ACCEPTED',
      quantity_value: new Prisma.Decimal('3000.00'),
      quantity_unit: 'LITER',
      density: new Prisma.Decimal('1.0300'),
      gross_liters: null, // missing gross liters
      snf: new Prisma.Decimal('9.10'),
      ts: new Prisma.Decimal('13.10'),
      at_13ts_liters: new Prisma.Decimal('3023.08'),
      calculation_version: '1.0',
    },
  });
  const noGrossHistRes = await receiveHistoricalSession(toCoreUser(attendant1) as any, noGrossHistSession.id.toString(), {
    tank_id: tankAId,
  });
  assert(noGrossHistRes.status === 400, 'Missing Gross Liters Fail-Closed', 'Fails closed when gross_liters is null (400)');

  // 7C. Destination Tank Active State Under Lock
  // Create an inactive tank to test explicit inactive tank selection rejection
  const inactTankRes = await createZmccTank(toCoreUser(superAdmin) as any, {
    tank_code: `TKINACT2-${runId}`,
    tank_name: 'Inactive Historical Destination Tank',
    capacity_liters: 10000,
    zmcc_id: zmcc1.id.toString(),
    is_active: false,
  });
  const inactTankId = inactTankRes.data!.tank.id;

  const histInactRes = await receiveHistoricalSession(toCoreUser(attendant1) as any, histSession.id.toString(), {
    tank_id: inactTankId,
  });
  assert(histInactRes.status === 400, 'Inactive Tank Historical Receipt Blocked', 'Fails closed when destination tank is inactive (400)');
  assert(histInactRes.error === 'Destination ZMCC tank is inactive.', 'Inactive Tank Historical Error Message', histInactRes.error);

  // Simulate concurrent deactivation under row lock for historical receipt:
  const { arrival: raceArrival } = await createCompletedMotArrival(`hist-race-${runId}`);
  const raceHistSession = await prisma.zmccLabSession.create({
    data: {
      zmcc_id: zmcc1.id,
      arrival_type: 'MOT',
      mot_arrival_id: BigInt(raceArrival.id),
      status: 'COMPLETED',
      started_at: new Date(),
      started_by_user_id: attendant1.id,
      completed_at: new Date(),
      completed_by_user_id: attendant1.id,
      decision: 'ACCEPTED',
      quantity_value: new Prisma.Decimal('1000.00'),
      quantity_unit: 'LITER',
      density: new Prisma.Decimal('1.0300'),
      gross_liters: new Prisma.Decimal('1000.00'),
      snf: new Prisma.Decimal('9.10'),
      ts: new Prisma.Decimal('13.10'),
      at_13ts_liters: new Prisma.Decimal('1007.69'),
      calculation_version: '1.0',
      results: {
        create: [
          {
            test_id: lrTest.id,
            test_code_snapshot: 'LR',
            test_name_snapshot: 'Lactometer Reading',
            result_type_snapshot: 'NUMERIC',
            unit_snapshot: 'LR',
            is_required_snapshot: true,
            display_order_snapshot: 1,
            numeric_value: new Prisma.Decimal('30.00'),
            evaluation_status: 'PASSED',
            is_passed: true,
            recorded_at: new Date(),
          },
          {
            test_id: fatTest.id,
            test_code_snapshot: 'FAT',
            test_name_snapshot: 'Fat Content',
            result_type_snapshot: 'NUMERIC',
            unit_snapshot: '%',
            is_required_snapshot: true,
            display_order_snapshot: 2,
            numeric_value: new Prisma.Decimal('4.00'),
            evaluation_status: 'PASSED',
            is_passed: true,
            recorded_at: new Date(),
          },
        ],
      },
    },
  });

  // Temporarily deactivate Tank A and re-activate inactTankId so pre-tx query sees it as active
  await toggleZmccTankActive(toCoreUser(superAdmin) as any, tankAId, false);
  await toggleZmccTankActive(toCoreUser(superAdmin) as any, inactTankId, true);

  // Hook prisma.zmccTank.findMany so that right after pre-tx query completes, we deactivate inactTankId in DB
  const origFindManyHist = prisma.zmccTank.findMany;
  let histManyHooked = false;
  (prisma.zmccTank as any).findMany = async (args: any) => {
    const res = await origFindManyHist.call(prisma.zmccTank, args);
    if (!histManyHooked && args?.where?.is_active === true) {
      histManyHooked = true;
      await prisma.zmccTank.update({
        where: { id: BigInt(inactTankId) },
        data: { is_active: false },
      });
    }
    return res;
  };

  const concurrentHistRes = await receiveHistoricalSession(toCoreUser(attendant1) as any, raceHistSession.id.toString(), {
    tank_id: inactTankId,
  });
  (prisma.zmccTank as any).findMany = origFindManyHist;
  assert(concurrentHistRes.status === 400, 'Concurrent Deactivation Under Lock (Historical)', 'Fails closed under lock when tank deactivated concurrently (400)');
  assert(concurrentHistRes.error === 'Destination ZMCC tank is inactive.', 'Concurrent Deactivation Error Message', concurrentHistRes.error);

  // Reactivate Tank A for subsequent tests
  await toggleZmccTankActive(toCoreUser(superAdmin) as any, tankAId, true);

  // 7D. Successful Historical Receipt by ZMCC_LAB_ATTENDANT
  // Tank A capacity: 12,000 L, current stock: 5,000 L -> 7,000 L available -> 4,000 L fits!
  const histRecRes = await receiveHistoricalSession(toCoreUser(attendant1) as any, histSession.id.toString(), {
    tank_id: tankAId,
  });
  assert(histRecRes.status === 201, 'Historical Receipt Created by Attendant', 'Historical receipt created with status 201');
  assert(histRecRes.data!.tank_receipt.tank_id === tankAId, 'Historical Receipt Tank A', 'Assigned to Tank A');
  assert(histRecRes.data!.tank_receipt.gross_liters === 4000.00, 'Historical Gross Liters', 'Gross liters = 4000.00');
  assert(histRecRes.data!.tank_receipt.lr === 30.00, 'Historical Authoritative LR', 'LR = 30.00');
  assert(histRecRes.data!.tank_receipt.fat === 4.00, 'Historical Authoritative Fat', 'Fat = 4.00');
  assert(histRecRes.data!.tank_receipt.calculation_version === '1.0', 'Historical Calculation Version', 'calculation_version = 1.0');

  // Verify Tank A stock updated: 5,000 + 4,000 = 9,000 L
  const tankAAfterHist = await getZmccTankById(toCoreUser(manager1) as any, tankAId);
  assert(tankAAfterHist.data!.tank.current_stock === 9000.00, 'Tank A Stock After Historical Receipt', `Tank A stock = ${tankAAfterHist.data!.tank.current_stock} L (expected 9000.00)`);

  // 7E. Successful Historical Receipt by SUPER_ADMIN (Global Override)
  const { arrival: superArrival } = await createCompletedMotArrival(`super-${runId}`);
  const histSessionSuper = await prisma.zmccLabSession.create({
    data: {
      zmcc_id: zmcc1.id,
      arrival_type: 'MOT',
      mot_arrival_id: BigInt(superArrival.id),
      status: 'COMPLETED',
      started_at: new Date(),
      started_by_user_id: attendant1.id,
      completed_at: new Date(),
      completed_by_user_id: attendant1.id,
      decision: 'ACCEPTED',
      quantity_value: new Prisma.Decimal('2000.00'),
      quantity_unit: 'LITER',
      density: new Prisma.Decimal('1.0310'),
      gross_liters: new Prisma.Decimal('2000.00'),
      snf: new Prisma.Decimal('9.20'),
      ts: new Prisma.Decimal('13.40'),
      at_13ts_liters: new Prisma.Decimal('2061.54'),
      calculation_version: '1.0',
      results: {
        create: [
          {
            test_id: lrTest.id,
            test_code_snapshot: 'LR',
            test_name_snapshot: 'Lactometer Reading',
            result_type_snapshot: 'NUMERIC',
            unit_snapshot: 'LR',
            is_required_snapshot: true,
            display_order_snapshot: 1,
            numeric_value: new Prisma.Decimal('31.00'),
            evaluation_status: 'PASSED',
            is_passed: true,
            recorded_at: new Date(),
          },
          {
            test_id: fatTest.id,
            test_code_snapshot: 'FAT',
            test_name_snapshot: 'Fat Content',
            result_type_snapshot: 'NUMERIC',
            unit_snapshot: '%',
            is_required_snapshot: true,
            display_order_snapshot: 2,
            numeric_value: new Prisma.Decimal('4.20'),
            evaluation_status: 'PASSED',
            is_passed: true,
            recorded_at: new Date(),
          },
        ],
      },
    },
  });

  const superHistRes = await receiveHistoricalSession(toCoreUser(superAdmin) as any, histSessionSuper.id.toString(), {
    tank_id: tankAId,
  });
  assert(superHistRes.status === 201, 'Super Admin Historical Receipt Allowed', 'Super Admin historical receipt status 201');
  assert(superHistRes.data!.tank_receipt.tank_id === tankAId, 'Super Admin Receipt Tank A', 'Assigned to Tank A');

  // 7F. Attempting historical receipt again on same session returns existing (idempotent)
  const dupHistRes = await receiveHistoricalSession(toCoreUser(attendant1) as any, histSession.id.toString(), {
    tank_id: tankAId,
  });
  assert(dupHistRes.status === 200, 'Already Receipted Historical Idempotent', 'Returns existing receipt on replay (200)');

  // =============================================================
  // 8. AUDIT LOG & IMMUTABILITY
  // =============================================================
  console.log('\n--- 8. AUDIT LOG & IMMUTABILITY ---');

  // Check audit logs exist for tank creation, receipts, and inventory adjustments
  const tankAudit = await prisma.auditLog.findFirst({
    where: { table_name: 'zmcc_tank', action: 'ZMCC_TANK_CREATED' },
  });
  assert(!!tankAudit, 'Audit Log ZMCC_TANK_CREATED', 'Audit log exists for tank creation');

  const receiptAudit = await prisma.auditLog.findFirst({
    where: { table_name: 'zmcc_tank_receipt', action: 'ZMCC_TANK_RECEIPT_CREATED' },
  });
  assert(!!receiptAudit, 'Audit Log ZMCC_TANK_RECEIPT_CREATED', 'Audit log exists for tank receipt');

  const adjInAudit = await prisma.auditLog.findFirst({
    where: { table_name: 'zmcc_tank_inventory_transaction', action: 'ZMCC_TANK_INVENTORY_ADJUSTMENT_IN' },
  });
  assert(!!adjInAudit, 'Audit Log ADJUSTMENT_IN', 'Audit log exists for inventory adjustment in');

  const adjOutAudit = await prisma.auditLog.findFirst({
    where: { table_name: 'zmcc_tank_inventory_transaction', action: 'ZMCC_TANK_INVENTORY_ADJUSTMENT_OUT' },
  });
  assert(!!adjOutAudit, 'Audit Log ADJUSTMENT_OUT', 'Audit log exists for inventory adjustment out');

  // =============================================================
  // 9. SUMMARY & CLEANUP
  // =============================================================
  console.log('\n=====================================================================');
  console.log(`📊 STAGE 6G-D REGRESSION SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('=====================================================================\n');

  await prisma.$disconnect();

  if (failed > 0) {
    process.exit(1);
  }
}

runStage6gdTests().catch((err) => {
  console.error('Unhandled error in test suite:', err);
  process.exit(1);
});
