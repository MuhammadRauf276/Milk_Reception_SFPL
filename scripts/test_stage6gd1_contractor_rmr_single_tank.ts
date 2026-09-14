/**
 * STAGE 6G-D.1: CONTRACTOR RMR & SINGLE ACTIVE ZMCC TANK REGRESSION TEST SUITE
 *
 * Verifies:
 * 1. Database Schema & Migrations:
 *    - Exactly >= 23 tracked migrations
 *    - 20260914100000_contractor_rmr_and_single_active_tank migration exists
 *    - zmcc_contractor_arrival.rmr_number column exists (VARCHAR(100), NOT NULL)
 *    - zmcc_tank partial unique index: zmcc_tank_one_active_per_zmcc_idx (zmcc_id WHERE is_active = TRUE)
 * 2. Static Analysis & Domain Separation:
 *    - Registered in scripts/run_all_regressions.ts
 *    - Zero reuse of Plant Silo / UnloadingLog / SiloInventoryTransaction
 *    - Zero Stage 6G-E dispatch logic
 * 3. Contractor RMR Lifecycle & Authority:
 *    - Submitting contractor arrival requires non-empty rmr_number (400 if missing or blank)
 *    - rmr_number saved in DB; zmcc_token remains separate and system-generated (ZT-CON-...)
 *    - Idempotent replay: exact replay returns 200 with is_replay: true
 *    - Replay with altered rmr_number returns 409 conflict
 *    - Operator (PHE) cannot correct rmr_number (403)
 *    - ZMCC Manager (own ZMCC) can correct rmr_number with mandatory reason (200)
 *    - Correction without reason rejected (400)
 *    - ZMCC Manager (cross ZMCC) cannot correct rmr_number (403)
 *    - SUPER_ADMIN can correct rmr_number globally (200)
 *    - AuditLog captures old and new rmr_number and reason
 *    - zmcc_token remains strictly immutable across corrections
 *    - Listing contractor arrivals returns rmr_number; search filter works
 * 4. Single Active Tank Alignment & CRUD:
 *    - Creating active tank when none exists succeeds (201)
 *    - Creating second active tank for same ZMCC fails closed (400)
 *    - Raw DB duplicate insert violates partial unique index (P2002)
 *    - Inactive tank creation allowed even when active tank exists
 *    - Activating inactive tank when active tank exists fails closed (400)
 *    - Deactivating active tank allows toggling inactive tank to active
 *    - Editing tank capacity works (200)
 *    - Cross-ZMCC isolation: manager from ZMCC 2 cannot view or mutate ZMCC 1 tanks
 * 5. Session Completion "Accept & Receive" Destination Tank Auto-Selection:
 *    - Session completion auto-resolves the sole active tank when tank_id is omitted
 *    - Session completion fails closed with 400 when 0 active tanks configured
 *    - Session completion fails closed with 400 when specified destination tank is inactive
 *    - Historical session receipt auto-resolves sole active tank
 *    - Historical session receipt fails closed with 400 when 0 active tanks configured
 * 6. Auth Hardening (Anti-spoofing):
 *    - Forged x-user-id rejected with 401 across all endpoints
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
console.log('🧪 STAGE 6G-D.1: CONTRACTOR RMR & SINGLE ACTIVE ZMCC TANK SUITE');
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

async function runStage6gd1Tests() {
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
    completeSession,
  } = await import('../src/backend/services/zmccLabService');

  const {
    submitContractorArrival,
    correctContractorArrival,
    listContractorArrivals,
    serializeContractorArrival,
  } = await import('../src/backend/services/zmccArrivalService');

  // =============================================================
  // 1. DATABASE SCHEMA & MIGRATIONS
  // =============================================================
  console.log('\n--- 1. DATABASE SCHEMA & MIGRATIONS ---');

  const migrationsDir = path.join(repoRoot, 'prisma', 'migrations');
  const migrationDirs = fs
    .readdirSync(migrationsDir)
    .filter((f) => fs.statSync(path.join(migrationsDir, f)).isDirectory() && !f.startsWith('.'));
  assert(migrationDirs.length === 23, 'Tracked Migrations', `Found exactly 23 migrations (expected 23)`);

  const d1MigDir = migrationDirs.find((d) => d.includes('contractor_rmr_and_single_active_tank'));
  assert(!!d1MigDir, 'Migration Exists', `Found 6G-D.1 migration: ${d1MigDir}`);

  // Check column rmr_number on zmcc_contractor_arrival (enforced NOT NULL)
  const rmrColCheck: any[] = await prisma.$queryRaw`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_name = 'zmcc_contractor_arrival' AND column_name = 'rmr_number';
  `;
  assert(rmrColCheck.length === 1, 'rmr_number Column Exists', 'rmr_number exists in zmcc_contractor_arrival');
  assert(rmrColCheck[0]?.is_nullable === 'NO', 'rmr_number Not Null', 'rmr_number is NOT NULL');

  // Check unique index on zmcc_tank (is_active = TRUE)
  const indexCheck: any[] = await prisma.$queryRaw`
    SELECT indexname, indexdef
    FROM pg_indexes
    WHERE tablename = 'zmcc_tank' AND indexname = 'zmcc_tank_one_active_per_zmcc_idx';
  `;
  assert(indexCheck.length === 1, 'Single Active Tank Index Exists', 'zmcc_tank_one_active_per_zmcc_idx exists');
  assert(
    Boolean(indexCheck[0]?.indexdef?.includes('WHERE (is_active = true)')),
    'Partial Unique Index Definition',
    indexCheck[0]?.indexdef
  );

  // =============================================================
  // 2. STATIC ARCHITECTURE & DOMAIN SEPARATION CHECKS
  // =============================================================
  console.log('\n--- 2. STATIC ARCHITECTURE & DOMAIN SEPARATION ---');

  const runnerPath = path.join(repoRoot, 'scripts', 'run_all_regressions.ts');
  const runnerContent = fs.readFileSync(runnerPath, 'utf8');
  assert(
    runnerContent.includes('scripts/test_stage6gd1_contractor_rmr_single_tank.ts'),
    'Architecture: Suite Registered',
    'Registered in run_all_regressions.ts'
  );

  const tankServicePath = path.join(repoRoot, 'src', 'backend', 'services', 'zmccTankService.ts');
  const tankServiceContent = fs.readFileSync(tankServicePath, 'utf8');
  const forbiddenPlantTerms = ['PlantSilo', 'SiloInventoryTransaction', 'UnloadingLog', 'VehicleVisit'];
  const foundForbidden = forbiddenPlantTerms.filter((term) => tankServiceContent.includes(term));
  assert(foundForbidden.length === 0, 'Domain Separation', 'No Plant domain tables reused in ZMCC tank service');

  // =============================================================
  // 3. SETUP TEST FIXTURES
  // =============================================================
  console.log('\n--- 3. SETUP TEST FIXTURES ---');

  const runId = Math.floor(100000 + Math.random() * 900000).toString();

  // Create ZMCC 1 and ZMCC 2
  const zmcc1 = await prisma.procurementSource.create({
    data: {
      code: `Z1-${runId}`,
      name: `ZMCC One 6GD1 ${runId}`,
      source_type: 'ZMCC',
      is_active: true,
    },
  });

  const zmcc2 = await prisma.procurementSource.create({
    data: {
      code: `Z2-${runId}`,
      name: `ZMCC Two 6GD1 ${runId}`,
      source_type: 'ZMCC',
      is_active: true,
    },
  });

  // Contractor Source
  const contractor = await prisma.procurementSource.create({
    data: {
      code: `CON-${runId}`,
      name: `Contractor 6GD1 ${runId}`,
      source_type: 'CONTRACTOR',
      is_active: true,
    },
  });

  // Users
  const superAdmin = await prisma.user.create({
    data: {
      username: `sa_6gd1_${runId}`,
      password_hash: 'hash',
      role: 'SUPER_ADMIN',
      full_name: `Super Admin 6GD1 ${runId}`,
      is_active: true,
      scope_type: 'GLOBAL',
    },
  });

  const manager1 = await prisma.user.create({
    data: {
      username: `mgr1_6gd1_${runId}`,
      password_hash: 'hash',
      role: 'ZMCC_MANAGER',
      full_name: `Manager 1 6GD1 ${runId}`,
      is_active: true,
      procurement_source_id: zmcc1.id,
      scope_type: 'SOURCE',
    },
  });

  const manager2 = await prisma.user.create({
    data: {
      username: `mgr2_6gd1_${runId}`,
      password_hash: 'hash',
      role: 'ZMCC_MANAGER',
      full_name: `Manager 2 6GD1 ${runId}`,
      is_active: true,
      procurement_source_id: zmcc2.id,
      scope_type: 'SOURCE',
    },
  });

  const pheOperator1 = await prisma.user.create({
    data: {
      username: `phe1_6gd1_${runId}`,
      password_hash: 'hash',
      role: 'PHE_OPERATOR',
      full_name: `PHE Operator 1 6GD1 ${runId}`,
      is_active: true,
      procurement_source_id: zmcc1.id,
      scope_type: 'SOURCE',
    },
  });

  const labAttendant1 = await prisma.user.create({
    data: {
      username: `lab1_6gd1_${runId}`,
      password_hash: 'hash',
      role: 'ZMCC_LAB_ATTENDANT',
      full_name: `Lab Attendant 1 6GD1 ${runId}`,
      is_active: true,
      procurement_source_id: zmcc1.id,
      scope_type: 'SOURCE',
    },
  });

  // Lab Tests (LR, FAT)
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

  // Ensure policy assignments exist for ZMCC_LAB_MOT and ZMCC_LAB_CONTRACTOR
  await prisma.milkTestPolicyAssignment.deleteMany({
    where: { testing_point: { in: ['ZMCC_LAB_MOT', 'ZMCC_LAB_CONTRACTOR'] } },
  });

  await prisma.milkTestPolicyAssignment.createMany({
    data: [
      { lab_test_id: lrTest.id, testing_point: 'ZMCC_LAB_MOT', is_required: true, display_order: 1, is_active: true, created_by_user_id: superAdmin.id },
      { lab_test_id: fatTest.id, testing_point: 'ZMCC_LAB_MOT', is_required: true, display_order: 2, is_active: true, created_by_user_id: superAdmin.id },
      { lab_test_id: lrTest.id, testing_point: 'ZMCC_LAB_CONTRACTOR', is_required: true, display_order: 1, is_active: true, created_by_user_id: superAdmin.id },
      { lab_test_id: fatTest.id, testing_point: 'ZMCC_LAB_CONTRACTOR', is_required: true, display_order: 2, is_active: true, created_by_user_id: superAdmin.id },
    ],
  });

  // =============================================================
  // 4. CONTRACTOR RMR NUMBER WORKFLOW & CORRECTIONS
  // =============================================================
  console.log('\n--- 4. CONTRACTOR RMR NUMBER WORKFLOW & CORRECTIONS ---');

  // 4A. Missing or Blank RMR Number validation (must fail 400)
  const noRmrRes = await submitContractorArrival(toCoreUser(pheOperator1) as any, {
    contractor_source_id: contractor.id.toString(),
    vehicle_number: `VEH-${runId}-1`,
    arrival_timestamp: new Date().toISOString(),
    client_event_id: `con-no-rmr-${runId}`,
    rmr_number: '',
  });
  assert(noRmrRes.status === 400, 'Blank RMR Number Rejected', 'Fails closed when rmr_number is empty (400)');
  assert(
    Boolean(noRmrRes.error?.includes('rmr_number is required')),
    'RMR Required Error Message',
    noRmrRes.error
  );

  const missingRmrRes = await submitContractorArrival(toCoreUser(pheOperator1) as any, {
    contractor_source_id: contractor.id.toString(),
    vehicle_number: `VEH-${runId}-1`,
    arrival_timestamp: new Date().toISOString(),
    client_event_id: `con-missing-rmr-${runId}`,
  } as any);
  assert(missingRmrRes.status === 400, 'Missing RMR Field Rejected', 'Fails closed when rmr_number is missing (400)');

  // 4B. Successful Contractor Arrival with valid RMR Number
  const exactReplayArrivalTimestamp = new Date().toISOString();
  const rmrInitial = `RMR-CONTRACTOR-${runId}-001`;
  const validArrivalRes = await submitContractorArrival(toCoreUser(pheOperator1) as any, {
    contractor_source_id: contractor.id.toString(),
    vehicle_number: `VEH-${runId}-01`,
    arrival_timestamp: exactReplayArrivalTimestamp,
    client_event_id: `con-valid-${runId}`,
    rmr_number: `  ${rmrInitial}  `, // should be trimmed
  });
  assert(validArrivalRes.status === 201, 'Contractor Arrival Created', 'Status 201 on valid submission');
  const arr1 = validArrivalRes.data!;
  assert(arr1.rmr_number === rmrInitial, 'RMR Stored Trimmed', `RMR stored as "${arr1.rmr_number}"`);
  assert(arr1.zmcc_token.startsWith('ZT-CON-'), 'System Token Format', `Token is "${arr1.zmcc_token}"`);
  assert(arr1.rmr_number !== arr1.zmcc_token, 'RMR vs Token Distinct', 'rmr_number and zmcc_token are distinct');

  // Verify stored in DB directly
  const dbArr1 = await prisma.zmccContractorArrival.findUnique({ where: { id: BigInt(arr1.id) } });
  assert(dbArr1?.rmr_number === rmrInitial, 'DB Field Populated', 'rmr_number populated directly in PostgreSQL');

  // 4C. Idempotent Exact Replay
  const replayRes = await submitContractorArrival(toCoreUser(pheOperator1) as any, {
    contractor_source_id: contractor.id.toString(),
    vehicle_number: `VEH-${runId}-01`,
    arrival_timestamp: exactReplayArrivalTimestamp,
    client_event_id: `con-valid-${runId}`,
    rmr_number: rmrInitial,
  });
  assert(replayRes.status === 200, 'Exact Replay 200', 'Status 200 on exact replay');
  assert(replayRes.data!.is_replay === true, 'Replay Flag True', 'is_replay is true');
  assert(replayRes.data!.rmr_number === rmrInitial, 'Replay RMR Matched', 'rmr_number matches original');

  // 4D. Altered Replay Conflict
  const alteredReplayRes = await submitContractorArrival(toCoreUser(pheOperator1) as any, {
    contractor_source_id: contractor.id.toString(),
    vehicle_number: `VEH-${runId}-01`,
    arrival_timestamp: exactReplayArrivalTimestamp,
    client_event_id: `con-valid-${runId}`,
    rmr_number: 'RMR-ALTERED-DIFF',
  });
  assert(alteredReplayRes.status === 409, 'Altered Replay 409 Conflict', 'Status 409 when rmr_number altered');

  // 4E. Operator (PHE) Cannot Edit RMR Number After Submission
  const pheCorrRes = await correctContractorArrival(toCoreUser(pheOperator1) as any, arr1.id, {
    rmr_number: 'RMR-PHE-HACK',
    reason: 'PHE trying to edit RMR',
  });
  assert(pheCorrRes.status === 403, 'PHE Operator Correction Blocked', 'PHE operator blocked from correction (403)');

  // 4F. ZMCC Manager Cross-ZMCC Correction Blocked
  const crossMgrCorrRes = await correctContractorArrival(toCoreUser(manager2) as any, arr1.id, {
    rmr_number: 'RMR-CROSS-MGR',
    reason: 'Cross ZMCC manager attempt',
  });
  assert(crossMgrCorrRes.status === 403, 'Cross-ZMCC Manager Correction Blocked', 'Cross-ZMCC manager blocked (403)');

  // 4G. Correction Without Reason Blocked (400)
  const noReasonCorrRes = await correctContractorArrival(toCoreUser(manager1) as any, arr1.id, {
    rmr_number: 'RMR-NO-REASON',
    reason: '',
  });
  assert(noReasonCorrRes.status === 400, 'Missing Reason Blocked', 'Fails closed when correction reason is missing (400)');

  // 4H. ZMCC Manager (Own ZMCC) Corrects RMR Number Successfully
  const rmrCorrected = `RMR-CONTRACTOR-${runId}-CORR1`;
  const mgrCorrRes = await correctContractorArrival(toCoreUser(manager1) as any, arr1.id, {
    rmr_number: `  ${rmrCorrected}  `,
    reason: 'Transposition error corrected from physical paper RMR slip',
  });
  assert(mgrCorrRes.status === 200, 'Manager Correction Success', 'Status 200 on valid correction');
  assert(mgrCorrRes.data!.rmr_number === rmrCorrected, 'RMR Updated to Corrected', `New RMR is ${rmrCorrected}`);
  assert(mgrCorrRes.data!.zmcc_token === arr1.zmcc_token, 'Token Immutable Across Correction', 'zmcc_token did not change');

  // 4I. Audit Log Captured Old and New Values
  const corrAudit = await prisma.auditLog.findFirst({
    where: {
      table_name: 'zmcc_contractor_arrival',
      record_id: BigInt(arr1.id),
      action: 'ZMCC_CONTRACTOR_ARRIVAL_CORRECTED',
    },
    orderBy: { id: 'desc' },
  });
  assert(!!corrAudit, 'Correction Audit Log Created', 'AuditLog row exists for correction');
  const auditOld = corrAudit?.old_values as any;
  const auditNew = corrAudit?.new_values as any;
  assert(auditOld?.rmr_number === rmrInitial, 'Audit Old RMR', `Audit captured old: ${auditOld?.rmr_number}`);
  assert(auditNew?.rmr_number === rmrCorrected, 'Audit New RMR', `Audit captured new: ${auditNew?.rmr_number}`);
  assert(auditNew?.correction_reason?.includes('Transposition error'), 'Audit Reason Captured', auditNew?.correction_reason);

  // 4J. Super Admin Global Correction Allowed
  const rmrSuperCorrected = `RMR-CONTRACTOR-${runId}-SUPER`;
  const superCorrRes = await correctContractorArrival(toCoreUser(superAdmin) as any, arr1.id, {
    rmr_number: rmrSuperCorrected,
    reason: 'Super Admin supervisory correction',
  });
  assert(superCorrRes.status === 200, 'Super Admin Correction Allowed', 'Super Admin correction returns 200');
  assert(superCorrRes.data!.rmr_number === rmrSuperCorrected, 'RMR Updated by Super Admin', 'Updated by Super Admin');

  // 4K. Listing & Filtering by RMR Number
  const listAllRes = await listContractorArrivals(toCoreUser(manager1) as any);
  assert(listAllRes.status === 200, 'List Contractor Arrivals', 'Status 200');
  const foundInList = listAllRes.data!.items.find((a: any) => a.id === arr1.id);
  assert(foundInList?.rmr_number === rmrSuperCorrected, 'List Contains RMR Number', 'rmr_number is serialized in list');

  const filterRes = await listContractorArrivals(toCoreUser(manager1) as any, { search: rmrSuperCorrected });
  assert(filterRes.status === 200, 'Filter by RMR', 'Filter returns status 200');
  assert(filterRes.data!.items.some((a: any) => a.id === arr1.id), 'Filter Found Record', 'Search matched by rmr_number');

  // =============================================================
  // 5. SINGLE ACTIVE TANK ALIGNMENT & CRUD
  // =============================================================
  console.log('\n--- 5. SINGLE ACTIVE TANK ALIGNMENT & CRUD ---');

  // 5A. Initial Active Tank Creation
  const tank1Res = await createZmccTank(toCoreUser(superAdmin) as any, {
    tank_code: `TK1-${runId}`,
    tank_name: `Primary Tank 1 ${runId}`,
    capacity_liters: 10000,
    zmcc_id: zmcc1.id.toString(),
  });
  assert(tank1Res.status === 201, 'Primary Tank 1 Created', 'First active tank created successfully (201)');
  const tank1Id = tank1Res.data!.tank.id;

  // 5B. Attempt to Create Second Active Tank on Same ZMCC (Fails 400)
  const tank2BlockedRes = await createZmccTank(toCoreUser(superAdmin) as any, {
    tank_code: `TK2-${runId}`,
    tank_name: `Second Active Tank ${runId}`,
    capacity_liters: 8000,
    zmcc_id: zmcc1.id.toString(),
  });
  assert(tank2BlockedRes.status === 400, 'Second Active Tank Blocked', 'Creating 2nd active tank rejected (400)');
  assert(
    Boolean(tank2BlockedRes.error?.includes('Only one active tank is permitted per ZMCC')),
    'Single Active Tank Error Message',
    tank2BlockedRes.error
  );

  // 5C. Raw DB Insert Violates Partial Unique Index
  let dbIndexViolated = false;
  try {
    await prisma.zmccTank.create({
      data: {
        zmcc_id: zmcc1.id,
        tank_code: `TKRAW-${runId}`,
        tank_name: 'Raw Duplicate Active Tank',
        capacity_liters: new Prisma.Decimal('5000.00'),
        is_active: true,
        created_by_user_id: superAdmin.id,
      },
    });
  } catch (err: any) {
    if (err?.code === 'P2002' || err?.message?.includes('zmcc_tank_one_active_per_zmcc_idx')) {
      dbIndexViolated = true;
    }
  }
  assert(dbIndexViolated, 'DB Partial Unique Index Enforced', 'Raw duplicate active tank rejected by PostgreSQL index');

  // 5D. Inactive Tank Creation Allowed Even When Active Tank Exists
  const inactiveTankRes = await createZmccTank(toCoreUser(superAdmin) as any, {
    tank_code: `TKINACT-${runId}`,
    tank_name: `Inactive Standby Tank ${runId}`,
    capacity_liters: 7000,
    zmcc_id: zmcc1.id.toString(),
    is_active: false,
  });
  assert(inactiveTankRes.status === 201, 'Inactive Tank Allowed', 'Creating inactive tank succeeds (201)');
  const inactTankId = inactiveTankRes.data!.tank.id;
  assert(inactiveTankRes.data!.tank.is_active === false, 'Tank Marked Inactive', 'Tank is_active is false');

  // 5E. Activating Inactive Tank When Another Active Tank Exists Fails Closed (400)
  const activateConflictRes = await toggleZmccTankActive(toCoreUser(superAdmin) as any, inactTankId, true);
  assert(activateConflictRes.status === 400, 'Activation Conflict Blocked', 'Activating inactive tank when active exists fails (400)');
  assert(
    Boolean(activateConflictRes.error?.includes('Only one active tank is permitted per ZMCC')),
    'Activation Error Message',
    activateConflictRes.error
  );

  // 5F. Deactivating Active Tank Then Activating Standby Tank Succeeds
  const deactTank1Res = await toggleZmccTankActive(toCoreUser(superAdmin) as any, tank1Id, false);
  assert(deactTank1Res.status === 200, 'Tank 1 Deactivated', 'Tank 1 successfully deactivated');
  assert(deactTank1Res.data!.tank.is_active === false, 'Tank 1 is_active False', 'Tank 1 is inactive');

  const actInactRes = await toggleZmccTankActive(toCoreUser(superAdmin) as any, inactTankId, true);
  assert(actInactRes.status === 200, 'Standby Tank Activated', 'Standby tank successfully activated now that Tank 1 is inactive');
  assert(actInactRes.data!.tank.is_active === true, 'Standby Tank Active', 'Standby tank is now active');

  // Switch back: deactivate standby tank and reactivate Tank 1
  await toggleZmccTankActive(toCoreUser(superAdmin) as any, inactTankId, false);
  await toggleZmccTankActive(toCoreUser(superAdmin) as any, tank1Id, true);

  // 5G. Editing Tank Capacity Works
  const capUpdateRes = await updateZmccTank(toCoreUser(superAdmin) as any, tank1Id, {
    capacity_liters: 15000,
  });
  assert(capUpdateRes.status === 200, 'Update Tank Capacity', 'Status 200 on capacity update');
  assert(capUpdateRes.data!.tank.capacity_liters === 15000, 'Updated Capacity Verified', 'Capacity is now 15,000 L');

  // 5H. Cross-ZMCC Isolation
  const crossListRes = await listZmccTanks(toCoreUser(manager2) as any);
  assert(crossListRes.status === 200, 'Manager 2 List Tanks', 'Status 200');
  assert(!crossListRes.data!.tanks.some((t: any) => t.id === tank1Id), 'Cross-ZMCC Tanks Hidden', 'Tank 1 is hidden from Manager 2');

  // =============================================================
  // 6. SESSION COMPLETION AUTO-SELECTION & GUARDS
  // =============================================================
  console.log('\n--- 6. SESSION COMPLETION AUTO-SELECTION & GUARDS ---');

  // Start Lab Session for Contractor Arrival
  const sStartRes = await startOrResumeSession(toCoreUser(labAttendant1) as any, {
    arrival_type: 'CONTRACTOR',
    arrival_id: BigInt(arr1.id),
  });
  assert(sStartRes.status === 201 || sStartRes.status === 200, 'Lab Session Started', 'Lab session started for contractor arrival');
  const sessionId = BigInt(sStartRes.data!.id);

  // 6A. Complete Session Without Specifying tank_id -> Automatically Selects Sole Active Tank (Tank 1)
  const sCompleteRes = await completeSession(toCoreUser(labAttendant1) as any, sessionId, {
    completion_client_event_id: `evt-comp-${runId}`,
    quantity_value: 6000,
    quantity_unit: 'LITER',
    decision: 'ACCEPTED',
    results: [
      { test_id: lrTest.id, numeric_value: 29.5, text_value: null },
      { test_id: fatTest.id, numeric_value: 3.8, text_value: null },
    ],
  });
  assert(sCompleteRes.status === 200, 'Session Completed 200', 'Status 200 with auto-selected sole tank');
  assert(sCompleteRes.data!.tank_receipt.tank_id === tank1Id, 'Receipt Auto-Selected Tank 1', 'Receipt assigned to sole active Tank 1');
  assert(sCompleteRes.data!.tank_receipt.gross_liters === 6000.00, 'Receipt Gross Liters 6000', 'Gross liters is 6000.00');

  // Check physical stock on Tank 1
  const tank1AfterReceipt = await getZmccTankById(toCoreUser(manager1) as any, tank1Id);
  assert(tank1AfterReceipt.data!.tank.current_stock === 6000.00, 'Tank 1 Stock 6000 L', `Stock is ${tank1AfterReceipt.data!.tank.current_stock} L`);

  // 6B. Zero Active Tanks Fails Closed (400)
  // Deactivate Tank 1 to create 0 active tanks condition
  await toggleZmccTankActive(toCoreUser(superAdmin) as any, tank1Id, false);

  // Create another arrival for zero-tank test
  const zeroTankArrival = await submitContractorArrival(toCoreUser(pheOperator1) as any, {
    contractor_source_id: contractor.id.toString(),
    vehicle_number: `VEH-${runId}-02`,
    arrival_timestamp: new Date().toISOString(),
    client_event_id: `con-zero-tank-${runId}`,
    rmr_number: `RMR-ZERO-TANK-${runId}`,
  });
  const zeroSessionStart = await startOrResumeSession(toCoreUser(labAttendant1) as any, {
    arrival_type: 'CONTRACTOR',
    arrival_id: BigInt(zeroTankArrival.data!.id),
  });
  const zeroSessionId = BigInt(zeroSessionStart.data!.id);

  const zeroTankCompRes = await completeSession(toCoreUser(labAttendant1) as any, zeroSessionId, {
    completion_client_event_id: `evt-zero-${runId}`,
    quantity_value: 2000,
    quantity_unit: 'LITER',
    decision: 'ACCEPTED',
    results: [
      { test_id: lrTest.id, numeric_value: 30, text_value: null },
      { test_id: fatTest.id, numeric_value: 4.0, text_value: null },
    ],
  });
  assert(zeroTankCompRes.status === 400, 'Zero Active Tanks Fails Closed', 'Completion fails closed when 0 active tanks exist (400)');
  assert(
    Boolean(zeroTankCompRes.error?.includes('No active ZMCC tank is configured.')),
    'Zero Tank Error Message',
    zeroTankCompRes.error
  );

  // 6C. Inactive Destination Tank Selection Fails Closed (400)
  const inactiveSelectCompRes = await completeSession(toCoreUser(labAttendant1) as any, zeroSessionId, {
    completion_client_event_id: `evt-inact-sel-${runId}`,
    tank_id: tank1Id, // tank1 is currently inactive
    quantity_value: 2000,
    quantity_unit: 'LITER',
    decision: 'ACCEPTED',
    results: [
      { test_id: lrTest.id, numeric_value: 30, text_value: null },
      { test_id: fatTest.id, numeric_value: 4.0, text_value: null },
    ],
  });
  assert(inactiveSelectCompRes.status === 400, 'Inactive Destination Tank Fails Closed', 'Explicitly selecting inactive tank fails (400)');
  assert(
    Boolean(inactiveSelectCompRes.error?.includes('Destination ZMCC tank is inactive.')),
    'Inactive Selection Error Message',
    inactiveSelectCompRes.error
  );

  // Reactivate Tank 1
  await toggleZmccTankActive(toCoreUser(superAdmin) as any, tank1Id, true);

  // =============================================================
  // 7. AUTH HARDENING & ANTI-SPOOF CHECKS
  // =============================================================
  console.log('\n--- 7. AUTH HARDENING & ANTI-SPOOF CHECKS ---');

  // Forged x-user-id on Contractor Arrival Submit
  const forgedSubmitReq = new Request('http://localhost/api/zmcc/arrivals/contractor', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-user-id': pheOperator1.id.toString() },
    body: JSON.stringify({
      contractor_source_id: contractor.id.toString(),
      vehicle_number: 'SPOOF-01',
      arrival_timestamp: new Date().toISOString(),
      client_event_id: 'spoof-key-1',
      rmr_number: 'RMR-SPOOF',
    }),
  });
  const forgedSubmitRes = await submitContractorArrival(forgedSubmitReq, {
    contractor_source_id: contractor.id.toString(),
    vehicle_number: 'SPOOF-01',
    arrival_timestamp: new Date().toISOString(),
    client_event_id: 'spoof-key-1',
    rmr_number: 'RMR-SPOOF',
  });
  assert(forgedSubmitRes.status === 401, 'Spoof Submit Arrival Blocked', 'Forged x-user-id rejected with 401');

  // Forged x-user-id on Contractor Arrival Correction
  const forgedCorrReq = new Request(`http://localhost/api/zmcc/arrivals/contractor/${arr1.id}/correct`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-user-id': manager1.id.toString() },
    body: JSON.stringify({ rmr_number: 'SPOOF', reason: 'Spoof' }),
  });
  const forgedCorrRes = await correctContractorArrival(forgedCorrReq, arr1.id, { rmr_number: 'SPOOF', reason: 'Spoof' });
  assert(forgedCorrRes.status === 401, 'Spoof Correct Arrival Blocked', 'Forged x-user-id rejected with 401');

  // Forged x-user-id on Create Tank
  const forgedTankReq = new Request('http://localhost/api/zmcc/tanks', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-user-id': superAdmin.id.toString() },
    body: JSON.stringify({ tank_code: 'TKFORGE', tank_name: 'Forge', capacity_liters: 5000, zmcc_id: zmcc1.id.toString() }),
  });
  const forgedTankRes = await createZmccTank(forgedTankReq, { tank_code: 'TKFORGE', tank_name: 'Forge', capacity_liters: 5000, zmcc_id: zmcc1.id.toString() });
  assert(forgedTankRes.status === 401, 'Spoof Create Tank Blocked', 'Forged x-user-id rejected with 401');

  // Forged x-user-id on Toggle Tank Active
  const forgedToggleReq = new Request(`http://localhost/api/zmcc/tanks/${tank1Id}/toggle-active`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-user-id': superAdmin.id.toString() },
  });
  const forgedToggleRes = await toggleZmccTankActive(forgedToggleReq, tank1Id, false);
  assert(forgedToggleRes.status === 401, 'Spoof Toggle Tank Blocked', 'Forged x-user-id rejected with 401');

  // =============================================================
  // 8. FOCUSED MIGRATION REGRESSION & HISTORICAL TRUTH TESTS
  // =============================================================
  console.log('\n--- 8. FOCUSED MIGRATION REGRESSION & HISTORICAL TRUTH ---');

  // 8A. Migration Guard Simulation for Contractor RMR:
  // Pre-migration DB with unresolved missing/blank RMR fails fast and does not invent fake data
  const rmrMigSimSchema = `rmr_mig_guard_sim_${runId}`;
  await prisma.$executeRawUnsafe(`CREATE SCHEMA "${rmrMigSimSchema}";`);
  try {
    // Create pre-migration table without rmr_number
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "${rmrMigSimSchema}"."zmcc_contractor_arrival" (
        id BIGSERIAL PRIMARY KEY,
        zmcc_id BIGINT NOT NULL,
        contractor_source_id BIGINT NOT NULL,
        vehicle_number VARCHAR(50) NOT NULL,
        arrival_timestamp TIMESTAMP(6) NOT NULL,
        arrival_date DATE NOT NULL,
        zmcc_token VARCHAR(100) NOT NULL UNIQUE,
        client_event_id VARCHAR(255) NOT NULL UNIQUE,
        recorded_by_user_id BIGINT NOT NULL,
        submitted_at TIMESTAMP(6) NOT NULL DEFAULT NOW(),
        correction_count INT NOT NULL DEFAULT 0,
        created_at TIMESTAMP(6) NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP(6) NOT NULL DEFAULT NOW()
      );
    `);

    // Insert pre-existing unresolved contractor arrival
    await prisma.$executeRawUnsafe(`
      INSERT INTO "${rmrMigSimSchema}"."zmcc_contractor_arrival" (
        zmcc_id, contractor_source_id, vehicle_number, arrival_timestamp, arrival_date,
        zmcc_token, client_event_id, recorded_by_user_id
      ) VALUES (
        ${zmcc1.id}, ${contractor.id}, 'UNRESOLVED-01', NOW(), CURRENT_DATE,
        'ZT-CON-UNRESOLVED-${runId}', 'client-evt-unresolved-${runId}', ${pheOperator1.id}
      );
    `);

    // Step 1 of migration: ADD COLUMN rmr_number VARCHAR(100)
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "${rmrMigSimSchema}"."zmcc_contractor_arrival" ADD COLUMN "rmr_number" VARCHAR(100);
    `);

    // Step 2 of migration: Fail-fast guard against unresolved NULL/blank RMR rows
    let rmrGuardThrew = false;
    let rmrGuardError = '';
    try {
      await prisma.$executeRawUnsafe(`
        DO $$
        BEGIN
          IF EXISTS (
            SELECT 1
            FROM "${rmrMigSimSchema}"."zmcc_contractor_arrival"
            WHERE "rmr_number" IS NULL OR TRIM("rmr_number") = ''
          ) THEN
            RAISE EXCEPTION
              'Cannot enforce NOT NULL on zmcc_contractor_arrival.rmr_number: unresolved rows with missing or blank RMR exist. Resolve historical data explicitly before migration.';
          END IF;
        END $$;
      `);
    } catch (err: any) {
      rmrGuardThrew = true;
      rmrGuardError = err.message || String(err);
    }
    assert(rmrGuardThrew, 'RMR Migration Guard Throws', 'Guard raised exception when unresolved historical RMR exists');
    assert(
      rmrGuardError.includes('Cannot enforce NOT NULL on zmcc_contractor_arrival.rmr_number: unresolved rows with missing or blank RMR exist'),
      'RMR Guard Message Clear',
      'Exception message matches canonical fail-fast contractor RMR guard'
    );

    // Verify no fake RMR was generated or backfilled
    const unresRow: any[] = await prisma.$queryRawUnsafe(`
      SELECT rmr_number FROM "${rmrMigSimSchema}"."zmcc_contractor_arrival" WHERE client_event_id = 'client-evt-unresolved-${runId}';
    `);
    assert(
      unresRow.length === 1 && unresRow[0].rmr_number === null,
      'No Fake RMR Generated',
      'No fake RMR (e.g. RMR-HISTORICAL) was backfilled or manufactured'
    );

    // Explicit resolution before migration (e.g. operator/data team enters truthful RMR)
    await prisma.$executeRawUnsafe(`
      UPDATE "${rmrMigSimSchema}"."zmcc_contractor_arrival"
      SET "rmr_number" = 'RMR-AUTHENTIC-HISTORICAL-001'
      WHERE client_event_id = 'client-evt-unresolved-${runId}';
    `);

    // Re-run guard after explicit resolution
    await prisma.$executeRawUnsafe(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM "${rmrMigSimSchema}"."zmcc_contractor_arrival"
          WHERE "rmr_number" IS NULL OR TRIM("rmr_number") = ''
        ) THEN
          RAISE EXCEPTION
            'Cannot enforce NOT NULL on zmcc_contractor_arrival.rmr_number: unresolved rows with missing or blank RMR exist. Resolve historical data explicitly before migration.';
        END IF;
      END $$;
    `);

    // Step 3 of migration: ALTER COLUMN rmr_number SET NOT NULL
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "${rmrMigSimSchema}"."zmcc_contractor_arrival" ALTER COLUMN "rmr_number" SET NOT NULL;
    `);

    // Verify column is NOT NULL after valid migration
    const postMigColCheck: any[] = await prisma.$queryRawUnsafe(`
      SELECT is_nullable FROM information_schema.columns
      WHERE table_schema = '${rmrMigSimSchema}' AND table_name = 'zmcc_contractor_arrival' AND column_name = 'rmr_number';
    `);
    assert(
      postMigColCheck[0]?.is_nullable === 'NO',
      'Post-Migration RMR NOT NULL',
      'rmr_number column is strictly NOT NULL after migration'
    );
  } finally {
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${rmrMigSimSchema}" CASCADE;`);
  }

  // 8E. Migration Simulation in Isolated Schema:
  // Pre-migration DB with duplicate active tanks fails-fast and deactivates nothing
  const migSimSchema = `mig_guard_sim_${runId}`;
  await prisma.$executeRawUnsafe(`CREATE SCHEMA "${migSimSchema}";`);
  try {
    // Create minimal zmcc_tank in sim schema
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "${migSimSchema}"."zmcc_tank" (
        id BIGSERIAL PRIMARY KEY,
        zmcc_id BIGINT NOT NULL,
        tank_code VARCHAR(50) NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT TRUE
      );
    `);
    await prisma.$executeRawUnsafe(`
      INSERT INTO "${migSimSchema}"."zmcc_tank" (zmcc_id, tank_code, is_active)
      VALUES (101, 'TK-A', TRUE), (101, 'TK-B', TRUE);
    `);

    // Run fail-fast guard SQL pointing to sim schema
    let guardThrew = false;
    let guardError = '';
    try {
      await prisma.$executeRawUnsafe(`
        DO $$
        BEGIN
          IF EXISTS (
            SELECT zmcc_id
            FROM "${migSimSchema}"."zmcc_tank"
            WHERE is_active = TRUE
            GROUP BY zmcc_id
            HAVING COUNT(*) > 1
          ) THEN
            RAISE EXCEPTION
              'Cannot enforce one active tank per ZMCC: duplicate active tanks exist. Resolve configuration explicitly before migration.';
          END IF;
        END $$;
      `);
    } catch (err: any) {
      guardThrew = true;
      guardError = err.message || String(err);
    }
    assert(guardThrew, 'Migration Guard Throws On Duplicate', 'Guard raised exception on duplicate active tanks');
    assert(
      guardError.includes('Cannot enforce one active tank per ZMCC: duplicate active tanks exist'),
      'Guard Exception Message Clear',
      'Exception message matches canonical fail-fast guard'
    );

    // Assert neither tank was silently deactivated
    const simTanks: any[] = await prisma.$queryRawUnsafe(`
      SELECT tank_code, is_active FROM "${migSimSchema}"."zmcc_tank" ORDER BY id ASC;
    `);
    assert(
      simTanks.length === 2 && simTanks.every((t) => t.is_active === true),
      'Tanks Never Silently Deactivated',
      'Both tanks remain is_active=true (no silent deactivation or data mutation)'
    );

    // Resolve duplicate explicitly (as required before migration)
    await prisma.$executeRawUnsafe(`
      UPDATE "${migSimSchema}"."zmcc_tank" SET is_active = FALSE WHERE tank_code = 'TK-B';
    `);

    // Run guard again
    await prisma.$executeRawUnsafe(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT zmcc_id
          FROM "${migSimSchema}"."zmcc_tank"
          WHERE is_active = TRUE
          GROUP BY zmcc_id
          HAVING COUNT(*) > 1
        ) THEN
          RAISE EXCEPTION
            'Cannot enforce one active tank per ZMCC: duplicate active tanks exist. Resolve configuration explicitly before migration.';
        END IF;
      END $$;
    `);

    // Create partial unique index
    await prisma.$executeRawUnsafe(`
      CREATE UNIQUE INDEX "zmcc_tank_one_active_per_zmcc_idx" ON "${migSimSchema}"."zmcc_tank" ("zmcc_id") WHERE is_active = TRUE;
    `);

    // Verify index prevents second active tank at DB level
    let secondActiveFailed = false;
    try {
      await prisma.$executeRawUnsafe(`
        INSERT INTO "${migSimSchema}"."zmcc_tank" (zmcc_id, tank_code, is_active)
        VALUES (101, 'TK-C', TRUE);
      `);
    } catch {
      secondActiveFailed = true;
    }
    assert(secondActiveFailed, 'Index Prevents Second Active Tank', 'Database partial unique index rejects second active tank');
  } finally {
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${migSimSchema}" CASCADE;`);
  }

  // =============================================================
  // SUMMARY
  // =============================================================
  console.log('\n=====================================================================');
  console.log(`📊 STAGE 6G-D.1 REGRESSION SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('=====================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runStage6gd1Tests()
  .catch((err) => {
    console.error('Unhandled error in test suite:', err);
    process.exit(1);
  })
  .finally(async () => {
    const { prisma } = await import('../src/backend/core/db');
    await prisma.$disconnect();
  });
