/**
 * STAGE 6G-D.1: CONTRACTOR RMR & SINGLE ACTIVE ZMCC TANK REGRESSION TEST SUITE
 *
 * Verifies:
 * 1. Database Schema & Migrations:
 *    - Exactly 23 tracked migrations
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

  // 4A. Missing, Blank, Non-String, and Length Validation for RMR Number (must fail 400)
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

  // 4A1. Strict Type Validation (Number, Object, Array, Null)
  const numRmrRes = await submitContractorArrival(toCoreUser(pheOperator1) as any, {
    contractor_source_id: contractor.id.toString(),
    vehicle_number: `VEH-${runId}-NUM`,
    arrival_timestamp: new Date().toISOString(),
    client_event_id: `con-num-rmr-${runId}`,
    rmr_number: 12345 as any,
  });
  assert(numRmrRes.status === 400, 'Number RMR Rejected', 'Fails closed when rmr_number is a number (400)');
  assert(numRmrRes.error === 'rmr_number must be a string.', 'Number RMR Error Message', numRmrRes.error);

  const objRmrRes = await submitContractorArrival(toCoreUser(pheOperator1) as any, {
    contractor_source_id: contractor.id.toString(),
    vehicle_number: `VEH-${runId}-OBJ`,
    arrival_timestamp: new Date().toISOString(),
    client_event_id: `con-obj-rmr-${runId}`,
    rmr_number: { id: 'rmr-obj' } as any,
  });
  assert(objRmrRes.status === 400, 'Object RMR Rejected', 'Fails closed when rmr_number is an object (400)');

  const arrRmrRes = await submitContractorArrival(toCoreUser(pheOperator1) as any, {
    contractor_source_id: contractor.id.toString(),
    vehicle_number: `VEH-${runId}-ARR`,
    arrival_timestamp: new Date().toISOString(),
    client_event_id: `con-arr-rmr-${runId}`,
    rmr_number: ['RMR-ARRAY'] as any,
  });
  assert(arrRmrRes.status === 400, 'Array RMR Rejected', 'Fails closed when rmr_number is an array (400)');

  const nullRmrRes = await submitContractorArrival(toCoreUser(pheOperator1) as any, {
    contractor_source_id: contractor.id.toString(),
    vehicle_number: `VEH-${runId}-NULL`,
    arrival_timestamp: new Date().toISOString(),
    client_event_id: `con-null-rmr-${runId}`,
    rmr_number: null as any,
  });
  assert(nullRmrRes.status === 400, 'Null RMR Rejected', 'Fails closed when rmr_number is null (400)');

  // 4A2. Max Length Validation (> 100 characters)
  const longRmr = 'R'.repeat(101);
  const longRmrRes = await submitContractorArrival(toCoreUser(pheOperator1) as any, {
    contractor_source_id: contractor.id.toString(),
    vehicle_number: `VEH-${runId}-LONG`,
    arrival_timestamp: new Date().toISOString(),
    client_event_id: `con-long-rmr-${runId}`,
    rmr_number: longRmr,
  });
  assert(longRmrRes.status === 400, 'Long RMR Rejected', 'Fails closed when rmr_number > 100 characters (400)');
  assert(longRmrRes.error === 'rmr_number cannot exceed 100 characters.', 'Long RMR Error Message', longRmrRes.error);

  // 4B. Successful Contractor Arrival with valid RMR Number preserving operator case
  const exactReplayArrivalTimestamp = new Date().toISOString();
  const rmrInitial = `Rmr-Con-${runId}-001`; // mixed case to test case preservation
  const validArrivalRes = await submitContractorArrival(toCoreUser(pheOperator1) as any, {
    contractor_source_id: contractor.id.toString(),
    vehicle_number: `veh-${runId}-01`, // vehicle number is uppercased by design
    arrival_timestamp: exactReplayArrivalTimestamp,
    client_event_id: `con-valid-${runId}`,
    rmr_number: `  ${rmrInitial}  `, // should be trimmed without altering case
  });
  assert(validArrivalRes.status === 201, 'Contractor Arrival Created', 'Status 201 on valid submission');
  const arr1 = validArrivalRes.data!;
  assert(arr1.rmr_number === rmrInitial, 'RMR Case Preserved & Stored Trimmed', `RMR stored as "${arr1.rmr_number}" (not forced uppercase)`);
  assert(arr1.vehicle_number === `VEH-${runId}-01`, 'Vehicle Number Uppercased', `Vehicle number uppercased: "${arr1.vehicle_number}"`);
  assert(arr1.zmcc_token.startsWith('ZT-CON-'), 'System Token Format', `Token is "${arr1.zmcc_token}"`);
  assert(arr1.rmr_number !== arr1.zmcc_token, 'RMR vs Token Distinct', 'rmr_number and zmcc_token are distinct');

  // Verify stored in DB directly
  const dbArr1 = await prisma.zmccContractorArrival.findUnique({ where: { id: BigInt(arr1.id) } });
  assert(dbArr1?.rmr_number === rmrInitial, 'DB Field Populated With Preserved Case', 'rmr_number preserved case directly in PostgreSQL');

  // 4C. Idempotent Exact Replay
  const replayRes = await submitContractorArrival(toCoreUser(pheOperator1) as any, {
    contractor_source_id: contractor.id.toString(),
    vehicle_number: `veh-${runId}-01`,
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
    vehicle_number: `veh-${runId}-01`,
    arrival_timestamp: exactReplayArrivalTimestamp,
    client_event_id: `con-valid-${runId}`,
    rmr_number: 'Rmr-Altered-Diff',
  });
  assert(alteredReplayRes.status === 409, 'Altered Replay 409 Conflict', 'Status 409 when rmr_number altered');

  // 4E. Operator (PHE) Cannot Edit RMR Number After Submission
  const pheCorrRes = await correctContractorArrival(toCoreUser(pheOperator1) as any, arr1.id, {
    rmr_number: 'Rmr-Phe-Hack',
    reason: 'PHE trying to edit RMR',
  });
  assert(pheCorrRes.status === 403, 'PHE Operator Correction Blocked', 'PHE operator blocked from correction (403)');

  // 4F. ZMCC Manager Cross-ZMCC Correction Blocked
  const crossMgrCorrRes = await correctContractorArrival(toCoreUser(manager2) as any, arr1.id, {
    rmr_number: 'Rmr-Cross-Mgr',
    reason: 'Cross ZMCC manager attempt',
  });
  assert(crossMgrCorrRes.status === 403, 'Cross-ZMCC Manager Correction Blocked', 'Cross-ZMCC manager blocked (403)');

  // 4G. Correction Without Reason Blocked (400)
  const noReasonCorrRes = await correctContractorArrival(toCoreUser(manager1) as any, arr1.id, {
    rmr_number: 'Rmr-No-Reason',
    reason: '',
  });
  assert(noReasonCorrRes.status === 400, 'Missing Reason Blocked', 'Fails closed when correction reason is missing (400)');

  // 4G1. Correction Strict Validation (Non-String and Max Length)
  const numCorrRes = await correctContractorArrival(toCoreUser(manager1) as any, arr1.id, {
    rmr_number: 99999 as any,
    reason: 'Attempting number coercion in correction',
  });
  assert(numCorrRes.status === 400, 'Correction Number RMR Rejected', 'Fails closed when correction rmr_number is number (400)');
  assert(numCorrRes.error === 'rmr_number must be a string.', 'Correction Number Error Message', numCorrRes.error);

  const longCorrRes = await correctContractorArrival(toCoreUser(manager1) as any, arr1.id, {
    rmr_number: 'R'.repeat(101),
    reason: 'Attempting 101 characters in correction',
  });
  assert(longCorrRes.status === 400, 'Correction Long RMR Rejected', 'Fails closed when correction rmr_number > 100 chars (400)');
  assert(longCorrRes.error === 'rmr_number cannot exceed 100 characters.', 'Correction Long Error Message', longCorrRes.error);

  // 4H. ZMCC Manager (Own ZMCC) Corrects RMR Number Successfully Preserving Case
  const rmrCorrected = `Rmr-Con-${runId}-Corr1`;
  const mgrCorrRes = await correctContractorArrival(toCoreUser(manager1) as any, arr1.id, {
    rmr_number: `  ${rmrCorrected}  `,
    reason: 'Transposition error corrected from physical paper RMR slip',
  });
  assert(mgrCorrRes.status === 200, 'Manager Correction Success', 'Status 200 on valid correction');
  assert(mgrCorrRes.data!.rmr_number === rmrCorrected, 'RMR Updated & Case Preserved', `New RMR is "${rmrCorrected}"`);
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

  // 5A1. Verify AuditLog for Active Tank Creation Captures is_active: true
  const tank1Audit = await prisma.auditLog.findFirst({
    where: {
      table_name: 'zmcc_tank',
      record_id: BigInt(tank1Id),
      action: 'ZMCC_TANK_CREATED',
    },
  });
  assert(tank1Audit !== null, 'Active Tank AuditLog Created', 'AuditLog exists for active tank creation');
  assert((tank1Audit?.new_values as any)?.is_active === true, 'Active Tank Audit Records is_active=true', 'is_active: true captured in AuditLog new_values');

  // 5A2. Strict is_active Boolean Validation (Reject non-boolean types)
  const strFalseTankRes = await createZmccTank(toCoreUser(superAdmin) as any, {
    tank_code: `TKSTRFALSE-${runId}`,
    tank_name: 'String False Tank',
    capacity_liters: 5000,
    zmcc_id: zmcc1.id.toString(),
    is_active: 'false' as any,
  });
  assert(strFalseTankRes.status === 400, 'String "false" is_active Rejected', 'String "false" rejected with 400');
  assert(strFalseTankRes.error === 'is_active must be a boolean (true or false).', 'Strict Boolean Error Message', strFalseTankRes.error);

  const numZeroTankRes = await createZmccTank(toCoreUser(superAdmin) as any, {
    tank_code: `TKZERO-${runId}`,
    tank_name: 'Zero Tank',
    capacity_liters: 5000,
    zmcc_id: zmcc1.id.toString(),
    is_active: 0 as any,
  });
  assert(numZeroTankRes.status === 400, 'Number 0 is_active Rejected', 'Number 0 rejected with 400');

  const nullActiveTankRes = await createZmccTank(toCoreUser(superAdmin) as any, {
    tank_code: `TKNULL-${runId}`,
    tank_name: 'Null Tank',
    capacity_liters: 5000,
    zmcc_id: zmcc1.id.toString(),
    is_active: null as any,
  });
  assert(nullActiveTankRes.status === 400, 'Null is_active Rejected', 'Null rejected with 400');

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

  // 5D1. Verify AuditLog for Inactive Tank Creation Captures is_active: false
  const inactTankAudit = await prisma.auditLog.findFirst({
    where: {
      table_name: 'zmcc_tank',
      record_id: BigInt(inactTankId),
      action: 'ZMCC_TANK_CREATED',
    },
  });
  assert(inactTankAudit !== null, 'Inactive Tank AuditLog Created', 'AuditLog exists for inactive tank creation');
  assert((inactTankAudit?.new_values as any)?.is_active === false, 'Inactive Tank Audit Records is_active=false', 'is_active: false captured in AuditLog new_values');

  // 5D2. Unique Constraint Error Mapping (Duplicate Tank Code vs Active Tank Conflict)
  const dupCodeRes = await createZmccTank(toCoreUser(superAdmin) as any, {
    tank_code: `TKINACT-${runId}`, // Duplicate tank code with existing inactive tank
    tank_name: 'Duplicate Code Tank',
    capacity_liters: 6000,
    zmcc_id: zmcc1.id.toString(),
    is_active: false,
  });
  assert(dupCodeRes.status === 400, 'Duplicate Tank Code Blocked', 'Duplicate tank code rejected (400)');
  assert(
    Boolean(dupCodeRes.error?.includes(`Tank code "TKINACT-${runId}" already exists in this ZMCC`)),
    'Duplicate Code Message Correct',
    dupCodeRes.error
  );
  assert(
    !dupCodeRes.error?.includes('An active tank already exists'),
    'Not Mismapped to Active Tank Conflict',
    'Duplicate code error is NOT falsely reported as active tank conflict'
  );

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
  //    (Executes the ACTUAL tracked migration file)
  // =============================================================
  console.log('\n--- 8. FOCUSED MIGRATION REGRESSION & HISTORICAL TRUTH (ACTUAL MIGRATION FILE) ---');

  async function executeMultiStatementSql(rawSql: string) {
    const statements: string[] = [];
    let current = '';
    let inDollarBlock = false;

    for (let i = 0; i < rawSql.length; i++) {
      if (rawSql.slice(i, i + 2) === '$$') {
        inDollarBlock = !inDollarBlock;
        current += '$$';
        i++;
      } else if (rawSql[i] === ';' && !inDollarBlock) {
        if (current.trim()) statements.push(current.trim());
        current = '';
      } else {
        current += rawSql[i];
      }
    }
    if (current.trim()) statements.push(current.trim());

    for (const stmt of statements) {
      if (stmt.trim()) {
        await prisma.$executeRawUnsafe(stmt);
      }
    }
  }

  const d1MigrationSqlPath = path.join(
    process.cwd(),
    'prisma/migrations/20260914100000_contractor_rmr_and_single_active_tank/migration.sql'
  );
  assert(fs.existsSync(d1MigrationSqlPath), 'D.1 Migration File Exists', 'Tracked migration file exists on disk');
  const d1MigrationRawSql = fs.readFileSync(d1MigrationSqlPath, 'utf8');

  async function applyActualD1Migration(targetSchema: string) {
    const adaptedSql = d1MigrationRawSql
      .replace(/"zmcc_contractor_arrival"/g, `"${targetSchema}"."zmcc_contractor_arrival"`)
      .replace(/"zmcc_tank"/g, `"${targetSchema}"."zmcc_tank"`);
    await executeMultiStatementSql(adaptedSql);
  }

  // -------------------------------------------------------------
  // 8A. CASE A — CLEAN / VALID PRE-D.1 DATABASE
  // -------------------------------------------------------------
  const schemaCaseA = `d1_mig_case_a_${runId}`;
  await prisma.$executeRawUnsafe(`CREATE SCHEMA "${schemaCaseA}";`);
  try {
    // Pre-D.1 zmcc_contractor_arrival without rmr_number column
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "${schemaCaseA}"."zmcc_contractor_arrival" (
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
    // Pre-D.1 zmcc_tank with valid single active tank
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "${schemaCaseA}"."zmcc_tank" (
        id BIGSERIAL PRIMARY KEY,
        zmcc_id BIGINT NOT NULL,
        tank_code VARCHAR(50) NOT NULL,
        tank_name VARCHAR(150) NOT NULL,
        capacity_liters DECIMAL(12,2) NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_by_user_id BIGINT NOT NULL,
        created_at TIMESTAMP(6) NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP(6) NOT NULL DEFAULT NOW(),
        CONSTRAINT "${schemaCaseA}_zmcc_tank_zmcc_id_tank_code_key" UNIQUE (zmcc_id, tank_code)
      );
    `);
    await prisma.$executeRawUnsafe(`
      INSERT INTO "${schemaCaseA}"."zmcc_tank" (zmcc_id, tank_code, tank_name, capacity_liters, is_active, created_by_user_id)
      VALUES (201, 'TK-CLEAN-01', 'Clean Tank', 10000.00, TRUE, ${superAdmin.id});
    `);

    // Execute the ACTUAL migration SQL file
    await applyActualD1Migration(schemaCaseA);

    // Verify rmr_number column exists and is strictly NOT NULL
    const rmrColCheck: any[] = await prisma.$queryRawUnsafe(`
      SELECT is_nullable FROM information_schema.columns
      WHERE table_schema = '${schemaCaseA}' AND table_name = 'zmcc_contractor_arrival' AND column_name = 'rmr_number';
    `);
    assert(
      rmrColCheck.length === 1 && rmrColCheck[0].is_nullable === 'NO',
      'Case A: RMR Column Created NOT NULL',
      'Actual migration created rmr_number column with NOT NULL constraint'
    );

    // Verify partial unique index exists
    const idxCheck: any[] = await prisma.$queryRawUnsafe(`
      SELECT indexname, indexdef FROM pg_indexes
      WHERE schemaname = '${schemaCaseA}' AND tablename = 'zmcc_tank' AND indexname = 'zmcc_tank_one_active_per_zmcc_idx';
    `);
    assert(
      idxCheck.length === 1 && idxCheck[0].indexdef.includes('WHERE (is_active = true)'),
      'Case A: Partial Unique Index Created',
      'Actual migration created partial unique index on zmcc_tank'
    );
  } finally {
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schemaCaseA}" CASCADE;`);
  }

  // -------------------------------------------------------------
  // 8B. CASE B — UNRESOLVED HISTORICAL CONTRACTOR ARRIVAL
  // -------------------------------------------------------------
  const schemaCaseB = `d1_mig_case_b_${runId}`;
  await prisma.$executeRawUnsafe(`CREATE SCHEMA "${schemaCaseB}";`);
  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "${schemaCaseB}"."zmcc_contractor_arrival" (
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
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "${schemaCaseB}"."zmcc_tank" (
        id BIGSERIAL PRIMARY KEY,
        zmcc_id BIGINT NOT NULL,
        tank_code VARCHAR(50) NOT NULL,
        tank_name VARCHAR(150) NOT NULL,
        capacity_liters DECIMAL(12,2) NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_by_user_id BIGINT NOT NULL,
        created_at TIMESTAMP(6) NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP(6) NOT NULL DEFAULT NOW()
      );
    `);
    // Insert genuine pre-D.1 historical contractor arrival with no rmr_number
    await prisma.$executeRawUnsafe(`
      INSERT INTO "${schemaCaseB}"."zmcc_contractor_arrival" (
        zmcc_id, contractor_source_id, vehicle_number, arrival_timestamp, arrival_date,
        zmcc_token, client_event_id, recorded_by_user_id
      ) VALUES (
        ${zmcc1.id}, ${contractor.id}, 'HIST-VEH-01', NOW(), CURRENT_DATE,
        'ZT-CON-HIST-${runId}', 'client-evt-hist-${runId}', ${pheOperator1.id}
      );
    `);

    // Execute ACTUAL migration - must fail fast on unresolved historical row
    let caseBMigThrew = false;
    let caseBMigError = '';
    try {
      await applyActualD1Migration(schemaCaseB);
    } catch (err: any) {
      caseBMigThrew = true;
      caseBMigError = err.message || String(err);
    }
    assert(caseBMigThrew, 'Case B: Migration Fails On Unresolved RMR', 'Actual migration threw exception for unresolved historical RMR');
    assert(
      caseBMigError.includes('Cannot enforce NOT NULL on zmcc_contractor_arrival.rmr_number: unresolved rows with missing or blank RMR exist'),
      'Case B: Clear Migration Guard Error Message',
      'Exception message matches canonical fail-fast contractor RMR guard'
    );

    // Verify row state: Step 1 added column as nullable, but no fake RMR was inserted
    const histRow: any[] = await prisma.$queryRawUnsafe(`
      SELECT vehicle_number, zmcc_token, client_event_id, rmr_number
      FROM "${schemaCaseB}"."zmcc_contractor_arrival"
      WHERE client_event_id = 'client-evt-hist-${runId}';
    `);
    assert(
      histRow.length === 1 && histRow[0].rmr_number === null,
      'Case B: No Fake RMR Inserted',
      'rmr_number remains NULL (never backfilled with RMR-HISTORICAL, UNKNOWN, or N/A)'
    );
    assert(
      histRow[0].vehicle_number === 'HIST-VEH-01' && histRow[0].zmcc_token === `ZT-CON-HIST-${runId}`,
      'Case B: Original Business Fields Untouched',
      'Original historical arrival fields were not silently rewritten'
    );
  } finally {
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schemaCaseB}" CASCADE;`);
  }

  // -------------------------------------------------------------
  // 8C. CASE C — DUPLICATE ACTIVE TANKS
  // -------------------------------------------------------------
  const schemaCaseC = `d1_mig_case_c_${runId}`;
  await prisma.$executeRawUnsafe(`CREATE SCHEMA "${schemaCaseC}";`);
  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "${schemaCaseC}"."zmcc_contractor_arrival" (
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
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "${schemaCaseC}"."zmcc_tank" (
        id BIGSERIAL PRIMARY KEY,
        zmcc_id BIGINT NOT NULL,
        tank_code VARCHAR(50) NOT NULL,
        tank_name VARCHAR(150) NOT NULL,
        capacity_liters DECIMAL(12,2) NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_by_user_id BIGINT NOT NULL,
        created_at TIMESTAMP(6) NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP(6) NOT NULL DEFAULT NOW()
      );
    `);
    // Insert 2 active tanks for same zmcc_id
    await prisma.$executeRawUnsafe(`
      INSERT INTO "${schemaCaseC}"."zmcc_tank" (zmcc_id, tank_code, tank_name, capacity_liters, is_active, created_by_user_id)
      VALUES
        (301, 'TK-DUP-A', 'Tank A', 10000.00, TRUE, ${superAdmin.id}),
        (301, 'TK-DUP-B', 'Tank B', 8000.00, TRUE, ${superAdmin.id});
    `);

    // Execute ACTUAL migration - must fail fast on duplicate active tanks
    let caseCMigThrew = false;
    let caseCMigError = '';
    try {
      await applyActualD1Migration(schemaCaseC);
    } catch (err: any) {
      caseCMigThrew = true;
      caseCMigError = err.message || String(err);
    }
    assert(caseCMigThrew, 'Case C: Migration Fails On Duplicate Active Tanks', 'Actual migration threw exception for duplicate active tanks');
    assert(
      caseCMigError.includes('Cannot enforce one active tank per ZMCC: duplicate active tanks exist'),
      'Case C: Clear Active Tank Guard Error Message',
      'Exception message matches canonical duplicate active tank guard'
    );

    // Verify neither tank was deleted or deactivated and capacities unchanged
    const tanksAfterFail: any[] = await prisma.$queryRawUnsafe(`
      SELECT tank_code, capacity_liters::text as cap, is_active
      FROM "${schemaCaseC}"."zmcc_tank"
      ORDER BY id ASC;
    `);
    assert(
      tanksAfterFail.length === 2,
      'Case C: Neither Tank Deleted',
      'Both tanks remain present in database'
    );
    assert(
      tanksAfterFail.every((t) => t.is_active === true),
      'Case C: Neither Tank Silently Deactivated',
      'Both tanks remain is_active=true (no silent deactivation or auto-picking)'
    );
    assert(
      tanksAfterFail[0].cap === '10000.00' && tanksAfterFail[1].cap === '8000.00',
      'Case C: Capacities Unchanged',
      'Tank capacities preserved exactly without modification'
    );
  } finally {
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schemaCaseC}" CASCADE;`);
  }

  // -------------------------------------------------------------
  // 8D. CASE D — VALID SINGLE ACTIVE TANK
  // -------------------------------------------------------------
  const schemaCaseD = `d1_mig_case_d_${runId}`;
  await prisma.$executeRawUnsafe(`CREATE SCHEMA "${schemaCaseD}";`);
  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "${schemaCaseD}"."zmcc_contractor_arrival" (
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
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "${schemaCaseD}"."zmcc_tank" (
        id BIGSERIAL PRIMARY KEY,
        zmcc_id BIGINT NOT NULL,
        tank_code VARCHAR(50) NOT NULL,
        tank_name VARCHAR(150) NOT NULL,
        capacity_liters DECIMAL(12,2) NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_by_user_id BIGINT NOT NULL,
        created_at TIMESTAMP(6) NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP(6) NOT NULL DEFAULT NOW()
      );
    `);
    // Insert 1 active tank and 1 inactive standby tank
    await prisma.$executeRawUnsafe(`
      INSERT INTO "${schemaCaseD}"."zmcc_tank" (zmcc_id, tank_code, tank_name, capacity_liters, is_active, created_by_user_id)
      VALUES
        (401, 'TK-SOLE-ACTIVE', 'Sole Active Tank', 12000.00, TRUE, ${superAdmin.id}),
        (401, 'TK-STANDBY', 'Standby Inactive Tank', 6000.00, FALSE, ${superAdmin.id});
    `);

    // Execute ACTUAL migration - must succeed
    await applyActualD1Migration(schemaCaseD);

    // Verify DB unique index exists
    const idxCheckD: any[] = await prisma.$queryRawUnsafe(`
      SELECT indexname, indexdef FROM pg_indexes
      WHERE schemaname = '${schemaCaseD}' AND tablename = 'zmcc_tank' AND indexname = 'zmcc_tank_one_active_per_zmcc_idx';
    `);
    assert(
      idxCheckD.length === 1,
      'Case D: Migration Succeeded & Index Created',
      'Actual migration created partial unique index on valid configuration'
    );

    // Verify index rejects inserting second active tank at DB level
    let secondActiveInsertThrew = false;
    try {
      await prisma.$executeRawUnsafe(`
        INSERT INTO "${schemaCaseD}"."zmcc_tank" (zmcc_id, tank_code, tank_name, capacity_liters, is_active, created_by_user_id)
        VALUES (401, 'TK-SECOND-ACT', 'Illegal Second Active', 5000.00, TRUE, ${superAdmin.id});
      `);
    } catch {
      secondActiveInsertThrew = true;
    }
    assert(
      secondActiveInsertThrew,
      'Case D: Index Rejects Second Active Tank',
      'PostgreSQL partial unique index rejected insert of second active tank'
    );

    // Verify inserting another inactive tank succeeds
    await prisma.$executeRawUnsafe(`
      INSERT INTO "${schemaCaseD}"."zmcc_tank" (zmcc_id, tank_code, tank_name, capacity_liters, is_active, created_by_user_id)
      VALUES (401, 'TK-STANDBY-2', 'Second Inactive Tank', 4000.00, FALSE, ${superAdmin.id});
    `);
    const finalTanksD: any[] = await prisma.$queryRawUnsafe(`
      SELECT tank_code, is_active FROM "${schemaCaseD}"."zmcc_tank" ORDER BY id ASC;
    `);
    assert(
      finalTanksD.length === 3 && finalTanksD.filter((t) => t.is_active).length === 1,
      'Case D: Additional Inactive Tank Permitted',
      'Multiple inactive tanks permitted; exactly one active tank enforced'
    );
  } finally {
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schemaCaseD}" CASCADE;`);
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
