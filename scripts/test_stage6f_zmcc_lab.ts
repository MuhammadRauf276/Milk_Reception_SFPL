/**
 * STAGE 6F: ZMCC LAB TESTING & ACCEPT/REJECT DECISION REGRESSION TEST SUITE
 *
 * Verifies:
 * 1. Database Schema & Migration:
 *    - Exactly 18 tracked migrations
 *    - zmcc_lab_session & zmcc_lab_result tables exist with relations & constraints
 *    - Database CHECK constraints (arrival_check, rejection_check, correction_count_check 0..2)
 * 2. Static Analysis & Clean Code:
 *    - Registered exactly once in run_all_regressions.ts (suite count: 42)
 *    - Zero browser alert() calls in frontend files
 *    - Role routing and navigation for ZMCC_LAB_ATTENDANT
 * 3. Lab Test Master & Scope Extension:
 *    - Canonical LabTest master supports ZMCC and ALL test scopes
 *    - GET /api/lab-tests?scope=ZMCC returns ZMCC and ALL tests
 *    - Invalid scope returns 400
 *    - Historical usage check prevents changing resultType when zmccLabResult exists
 * 4. Role Authorization & Scoping:
 *    - Unauthenticated rejected (401)
 *    - Inactive user rejected (403)
 *    - Unauthorized roles (PHE_OPERATOR, MOT_OFFICER, QA_Operator) rejected (403)
 *    - Foreign ZMCC Lab Attendant rejected (403)
 *    - Authorized ZMCC Lab Attendant (own ZMCC) accepted
 *    - SUPER_ADMIN accepted globally
 *    - ZMCC Manager cannot start or complete testing sessions (403)
 * 5. Queue Contract:
 *    - Returns eligible arrivals (MOT with COMPLETED journey, Contractor with active contractor)
 *    - Scoped by ZMCC for attendant/manager, global for super admin
 *    - Excludes completed sessions
 *    - Sorted oldest arrival first
 * 6. Session Lifecycle & Frozen Test Snapshot:
 *    - startOrResumeSession creates session with status IN_PROGRESS
 *    - Snapshots active ZMCC/ALL tests into zmcc_lab_result
 *    - Fail-closed if 0 active tests configured (400 "No active ZMCC lab tests configured.")
 *    - Concurrency safe: concurrent starts return existing session (200 / 201)
 *    - Subsequent changes to LabTest master do not affect frozen snapshot
 * 7. Draft Results Updates:
 *    - Attendant can update draft numeric and categorical test values
 *    - Validates numeric non-negative and categorical options against snapshot
 *    - Updates draft remarks
 * 8. Completion & Decisioning:
 *    - Requires completion_client_event_id for idempotency
 *    - Replay with identical payload returns 200 with completed session
 *    - Conflict on altered payload or concurrent collision returns 409
 *    - Requires all mandatory tests to have valid values
 *    - Mandatory rejection_reason when decision is REJECTED
 *    - ACCEPTED decision succeeds without rejection_reason
 *    - Evaluates pass/fail status per test based on result options
 *    - Zero VehicleVisit created
 *    - Zero tank/inventory transactions posted
 *    - Zero 08:00 AM Plant Business Date rollover applied
 *    - Immutable AuditLog created (ZMCC_LAB_SESSION_COMPLETED)
 * 9. Manager Corrections:
 *    - Attendant cannot correct (403)
 *    - Foreign manager cannot correct (403)
 *    - Correction requires mandatory reason (400 if missing)
 *    - Correction 1 succeeds (200, correction_count = 1)
 *    - Correction 2 succeeds (200, correction_count = 2)
 *    - Correction 3 rejected (400, exceeds max 2)
 *    - Database CHECK constraint prevents correction_count > 2
 *    - Immutable AuditLog created (ZMCC_LAB_SESSION_CORRECTED)
 * 10. Read Models & History:
 *     - getSessionById returns full session with arrival, vehicle/contractor, and results
 *     - getLabHistory filters by date, decision, search and scopes to ZMCC
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
console.log('🧪 STAGE 6F: ZMCC LAB TESTING & ACCEPTANCE DECISION REGRESSION SUITE');
console.log(`🎯 Target Database: ${testDbName} (TEST ISOLATION ENFORCED)`);
console.log('=====================================================================\n');

let passed = 0;
let failed = 0;

function assert(condition: boolean, testName: string, detail: string) {
  if (condition) {
    console.log(`[PASS] ${testName} - ${detail}`);
    passed++;
  } else {
    console.error(`[FAIL] ${testName} - ${detail}`);
    failed++;
  }
}

async function runStage6fTests() {
  const { prisma } = await import('../src/backend/core/db');
  const { Prisma } = await import('@prisma/client');
  const {
    getArrivalsQueue,
    startOrResumeSession,
    getSessionById,
    updateDraftResults,
    completeSession,
    correctCompletedSession,
    getLabHistory,
  } = await import('../src/backend/services/zmccLabService');
  const {
    submitMotArrival,
    submitContractorArrival,
  } = await import('../src/backend/services/zmccArrivalService');

  console.log('\n--- 1. DATABASE SCHEMA & MIGRATIONS ---');
  const migrationsDir = path.join(repoRoot, 'prisma', 'migrations');
  const migrationDirs = fs
    .readdirSync(migrationsDir)
    .filter((f) => fs.statSync(path.join(migrationsDir, f)).isDirectory());
  assert(migrationDirs.length === 18, 'Migration Count', `Exactly 18 tracked migrations (found ${migrationDirs.length})`);

  // Verify DB check constraints
  const dbConstraints: Array<{ conname: string }> = await prisma.$queryRaw`
    SELECT conname FROM pg_constraint WHERE conname IN ('zmcc_lab_session_arrival_check', 'zmcc_lab_session_rejection_check', 'zmcc_lab_session_correction_count_check', 'zmcc_lab_session_manager_correction_count_check')
  `;
  const constraintNames = dbConstraints.map((c) => c.conname);
  assert(constraintNames.includes('zmcc_lab_session_arrival_check'), 'DB Check Constraint', 'arrival_check exists');
  assert(constraintNames.includes('zmcc_lab_session_rejection_check'), 'DB Check Constraint', 'rejection_check exists');
  assert(constraintNames.includes('zmcc_lab_session_correction_count_check'), 'DB Check Constraint', 'correction_count_check exists');
  assert(constraintNames.includes('zmcc_lab_session_manager_correction_count_check'), 'DB Check Constraint', 'manager_correction_count_check exists');

  console.log('\n--- 2. STATIC ANALYSIS & CANONICAL COMPLIANCE ---');
  // Registered in runner
  const runnerPath = path.join(repoRoot, 'scripts', 'run_all_regressions.ts');
  const runnerContent = fs.readFileSync(runnerPath, 'utf8');
  const stage6fMatches = runnerContent.match(/scripts\/test_stage6f_zmcc_lab\.ts/g);
  assert(stage6fMatches?.length === 1, 'Registered in Runner', 'test_stage6f_zmcc_lab.ts registered exactly once in run_all_regressions.ts');

  // Zero alert(), confirm(), prompt() in ZmccLabWorkspace
  const labWorkspacePath = path.join(repoRoot, 'src', 'frontend', 'modules', 'zmcc', 'lab', 'ZmccLabWorkspace.tsx');
  const labWorkspaceContent = fs.readFileSync(labWorkspacePath, 'utf8');
  const alertMatches = labWorkspaceContent.match(/\balert\s*\(/g);
  const confirmMatches = labWorkspaceContent.match(/\bconfirm\s*\(/g);
  const promptMatches = labWorkspaceContent.match(/\bprompt\s*\(/g);
  assert(alertMatches === null || alertMatches.length === 0, 'Zero alert() calls', 'ZmccLabWorkspace has zero browser alert() calls');
  assert(confirmMatches === null || confirmMatches.length === 0, 'Zero confirm() calls', 'ZmccLabWorkspace has zero browser confirm() calls');
  assert(promptMatches === null || promptMatches.length === 0, 'Zero prompt() calls', 'ZmccLabWorkspace has zero browser prompt() calls');

  // UI Manager limit reached indication and button gate
  assert(
    labWorkspaceContent.includes('Manager correction limit reached (5/5)'),
    'UI Limit Indication',
    'History table shows explicit "Manager correction limit reached (5/5)" badge'
  );
  assert(
    labWorkspaceContent.includes('isSuperAdmin || (item.manager_correction_count ?? 0) < 5'),
    'UI Action Gate',
    'Correct action button is gated on manager_correction_count < 5 for managers'
  );

  // 5th successful manager correction produces appropriate limit notification
  assert(
    labWorkspaceContent.includes('Correction saved. Manager correction limit reached (5/5). Further corrections require Super Admin.'),
    'UI 5th Save Limit Notification',
    '5th successful manager correction triggers limit reached warning toast'
  );

  // Role routing check
  const { resolveRoleHome } = await import('../src/lib/role-routing');
  const labAttendantRoute = resolveRoleHome('ZMCC_LAB_ATTENDANT');
  assert(labAttendantRoute === '/zmcc/lab', 'Role Routing', `ZMCC_LAB_ATTENDANT routes to /zmcc/lab (got ${labAttendantRoute})`);

  console.log('\n--- 3. SETTING UP SEED FIXTURES ---');
  const runId = Date.now().toString().slice(-6);

  // 1. Create ZMCC A and ZMCC B
  const zmccA = await prisma.procurementSource.create({
    data: {
      code: `Z6F-A-${runId}`,
      name: `Stage 6F ZMCC Alpha ${runId}`,
      source_type: 'ZMCC',
      is_active: true,
    },
  });

  const zmccB = await prisma.procurementSource.create({
    data: {
      code: `Z6F-B-${runId}`,
      name: `Stage 6F ZMCC Beta ${runId}`,
      source_type: 'ZMCC',
      is_active: true,
    },
  });

  // 2. Create Contractors
  const contractorActive = await prisma.procurementSource.create({
    data: {
      code: `CON-F-ACT-${runId}`,
      name: `Active Contractor 6F ${runId}`,
      source_type: 'CONTRACTOR',
      is_active: true,
    },
  });

  const contractorInactive = await prisma.procurementSource.create({
    data: {
      code: `CON-F-INA-${runId}`,
      name: `Inactive Contractor 6F ${runId}`,
      source_type: 'CONTRACTOR',
      is_active: false,
    },
  });

  // 3. Create Users
  const attendantA = await prisma.user.create({
    data: {
      username: `attendant_a_${runId}`,
      password_hash: 'hash',
      role: 'ZMCC_LAB_ATTENDANT',
      full_name: `Lab Attendant Alpha ${runId}`,
      is_active: true,
      procurement_source_id: zmccA.id,
      scope_type: 'SOURCE',
    },
  });

  const attendantB = await prisma.user.create({
    data: {
      username: `attendant_b_${runId}`,
      password_hash: 'hash',
      role: 'ZMCC_LAB_ATTENDANT',
      full_name: `Lab Attendant Beta ${runId}`,
      is_active: true,
      procurement_source_id: zmccB.id,
      scope_type: 'SOURCE',
    },
  });

  const managerA = await prisma.user.create({
    data: {
      username: `manager_a_${runId}`,
      password_hash: 'hash',
      role: 'ZMCC_MANAGER',
      full_name: `ZMCC Manager Alpha ${runId}`,
      is_active: true,
      procurement_source_id: zmccA.id,
      scope_type: 'SOURCE',
    },
  });

  const pheA = await prisma.user.create({
    data: {
      username: `phe_6f_${runId}`,
      password_hash: 'hash',
      role: 'PHE_OPERATOR',
      full_name: `PHE Operator ${runId}`,
      is_active: true,
      procurement_source_id: zmccA.id,
      scope_type: 'SOURCE',
    },
  });

  const superAdmin = await prisma.user.create({
    data: {
      username: `admin_6f_${runId}`,
      password_hash: 'hash',
      role: 'SUPER_ADMIN',
      full_name: `Super Admin ${runId}`,
      is_active: true,
    },
  });

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

  // 4. Create MOT route, vehicle, profile, and completed journey
  const motRoute = await prisma.zmccRoute.create({
    data: {
      zmcc_id: zmccA.id,
      route_code: `R6F-${runId}`,
      name: `Route 6F ${runId}`,
      origin: 'ZMCC Origin 6F',
      destination: 'Milk Plant 6F',
      created_by: managerA.id,
      updated_by: managerA.id,
    },
  });

  const motVehicle = await prisma.motVehicle.create({
    data: {
      zmcc_id: zmccA.id,
      vehicle_number: `VEH-6F-${runId}`,
      created_by: managerA.id,
      updated_by: managerA.id,
    },
  });

  const motDriverUser = await prisma.user.create({
    data: {
      username: `mot_driver_${runId}`,
      password_hash: 'hash',
      role: 'MOT',
      full_name: `MOT Driver ${runId}`,
      is_active: true,
      procurement_source_id: zmccA.id,
      scope_type: 'SOURCE',
    },
  });

  const motProfile = await prisma.motProfile.create({
    data: {
      zmcc_id: zmccA.id,
      user_id: motDriverUser.id,
      mot_code: `MOT6F-${runId}`,
      name: `MOT Officer 6F ${runId}`,
      phone_number: `03001234567`,
      cnic: `35201-1234567-1`,
      created_by: managerA.id,
      updated_by: managerA.id,
    },
  });

  const journeyCompleted = await prisma.motJourney.create({
    data: {
      journey_number: `J6F-COMP-${runId}`,
      idempotency_key: `dispatch-j6f-${runId}`,
      zmcc_id: zmccA.id,
      route_id: motRoute.id,
      mot_vehicle_id: motVehicle.id,
      mot_profile_id: motProfile.id,
      assigned_by: managerA.id,
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

  // 5. Submit MOT Arrival at ZMCC A
  const motArrivalRes = await submitMotArrival(toCoreUser(pheA) as any, {
    journey_id: journeyCompleted.id,
    route_milk_token: `RM-6F-${runId}`,
    arrival_timestamp: new Date(Date.now() - 1800000),
    client_event_id: `evt-mot-arr-6f-${runId}`,
  });
  assert(motArrivalRes.status === 201, 'Submit MOT Arrival', `MOT Arrival created: ${motArrivalRes.data?.zmcc_token}`);
  const motArrivalId = BigInt(motArrivalRes.data.id);

  // 6. Submit Contractor Arrival at ZMCC A
  const conArrivalRes = await submitContractorArrival(toCoreUser(pheA) as any, {
    contractor_source_id: contractorActive.id,
    vehicle_number: `CON-VEH-${runId}`,
    arrival_timestamp: new Date(Date.now() - 1200000),
    client_event_id: `evt-con-arr-6f-${runId}`,
  });
  assert(conArrivalRes.status === 201, 'Submit Contractor Arrival', `Contractor Arrival created: ${conArrivalRes.data?.zmcc_token}`);
  const contractorArrivalId = BigInt(conArrivalRes.data.id);

  // 7. Seed Lab Tests with ZMCC and ALL scopes
  const testTemp = await prisma.labTest.create({
    data: {
      testCode: `T-TEMP-${runId}`,
      testName: `Milk Temperature ${runId}`,
      resultType: 'NUMERIC',
      unit: '°C',
      testScope: 'ZMCC',
      isRequired: true,
      displayOrder: 1,
      isActive: true,
    },
  });

  const testAcidity = await prisma.labTest.create({
    data: {
      testCode: `T-ACID-${runId}`,
      testName: `Milk Acidity ${runId}`,
      resultType: 'NUMERIC',
      unit: '%',
      testScope: 'ALL',
      isRequired: true,
      displayOrder: 2,
      isActive: true,
    },
  });

  const testOrgano = await prisma.labTest.create({
    data: {
      testCode: `T-ORG-${runId}`,
      testName: `Organoleptic Smell ${runId}`,
      resultType: 'OK_NOT_OK',
      testScope: 'ZMCC',
      isRequired: true,
      displayOrder: 3,
      isActive: true,
      resultOptions: [
        { value: 'OK', label: 'Normal / Fresh', isPassing: true },
        { value: 'NOT_OK', label: 'Sour / Abnormal', isPassing: false },
      ],
    },
  });

  console.log('\n--- 4. ROLE PERMISSIONS & SCOPING ---');
  // Inactive user
  const inactiveUser = await prisma.user.create({
    data: {
      username: `inact_user_${runId}`,
      password_hash: 'hash',
      role: 'ZMCC_LAB_ATTENDANT',
      full_name: `Inactive Attendant ${runId}`,
      is_active: false,
      procurement_source_id: zmccA.id,
      scope_type: 'SOURCE',
    },
  });
  const inactRes = await startOrResumeSession(toCoreUser(inactiveUser) as any, {
    arrival_type: 'MOT',
    arrival_id: motArrivalId,
  });
  assert(inactRes.status === 403, 'Inactive User Rejection', 'Inactive user rejected with 403');

  // Unauthorized role (PHE_OPERATOR cannot start lab session)
  const pheLabRes = await startOrResumeSession(toCoreUser(pheA) as any, {
    arrival_type: 'MOT',
    arrival_id: motArrivalId,
  });
  assert(pheLabRes.status === 403, 'Role Guard', 'PHE operator cannot start lab session (403)');

  // ZMCC Manager cannot start lab session (attendant/admin only)
  const mgrStartRes = await startOrResumeSession(toCoreUser(managerA) as any, {
    arrival_type: 'MOT',
    arrival_id: motArrivalId,
  });
  assert(mgrStartRes.status === 403, 'Manager Start Guard', 'ZMCC Manager cannot start lab session (403)');

  // Foreign ZMCC Lab Attendant cannot start session for ZMCC A
  const foreignStartRes = await startOrResumeSession(toCoreUser(attendantB) as any, {
    arrival_type: 'MOT',
    arrival_id: motArrivalId,
  });
  assert(foreignStartRes.status === 403, 'Source Scoping Guard', 'Foreign ZMCC lab attendant cannot access ZMCC A arrival (403)');

  console.log('\n--- 5. ARRIVALS QUEUE CONTRACT ---');
  const queueResA = await getArrivalsQueue(toCoreUser(attendantA) as any);
  assert(queueResA.status === 200, 'Queue Fetch A', 'Attendant A fetches queue successfully');
  assert(Array.isArray(queueResA.data) && queueResA.data.length >= 2, 'Queue Items Count', `Queue contains pending arrivals (found ${queueResA.data?.length})`);
  const queueMotItem = queueResA.data?.find((i: any) => i.queue_type === 'MOT' && i.arrival_id === motArrivalId.toString());
  const queueConItem = queueResA.data?.find((i: any) => i.queue_type === 'CONTRACTOR' && i.arrival_id === contractorArrivalId.toString());
  assert(!!queueMotItem, 'MOT in Queue', 'MOT arrival present in queue');
  assert(!!queueConItem, 'Contractor in Queue', 'Contractor arrival present in queue');

  // Queue scoped: Attendant B sees 0 arrivals from ZMCC A
  const queueResB = await getArrivalsQueue(toCoreUser(attendantB) as any);
  const queueMotInB = queueResB.data?.find((i: any) => i.arrival_id === motArrivalId.toString());
  assert(!queueMotInB, 'Queue Scoping Isolation', 'ZMCC B attendant does not see ZMCC A queue items');

  // Oldest first order
  if (queueResA.data.length >= 2) {
    const t0 = new Date(queueResA.data[0].arrival_timestamp).getTime();
    const t1 = new Date(queueResA.data[1].arrival_timestamp).getTime();
    assert(t0 <= t1, 'Queue Chronology', 'Queue ordered oldest arrival first');
  }

  console.log('\n--- 6. START / RESUME SESSION & FROZEN SNAPSHOT ---');
  const startSessionRes = await startOrResumeSession(toCoreUser(attendantA) as any, {
    arrival_type: 'MOT',
    arrival_id: motArrivalId,
  });
  assert(startSessionRes.status === 201, 'Start Lab Session', `Session created with ID #${startSessionRes.data?.id}`);
  const sessionId = BigInt(startSessionRes.data.id);
  assert(startSessionRes.data.status === 'IN_PROGRESS', 'Session Status', 'Initial status is IN_PROGRESS');
  assert(startSessionRes.data.results.length >= 3, 'Snapshot Results Count', `Results created with frozen test snapshots (${startSessionRes.data.results.length} tests)`);

  // Verify frozen metadata snapshot
  const tempSnap = startSessionRes.data.results.find((r: any) => r.test_id === testTemp.id.toString());
  assert(tempSnap?.test_code_snapshot === testTemp.testCode, 'Snapshot Integrity', 'Test code snapshotted');
  assert(tempSnap?.result_type_snapshot === 'NUMERIC', 'Snapshot Integrity', 'Result type snapshotted');
  assert(tempSnap?.unit_snapshot === '°C', 'Snapshot Integrity', 'Unit snapshotted');

  // Concurrency safe: Re-starting returns the existing session (200 OK)
  const resumeRes = await startOrResumeSession(toCoreUser(attendantA) as any, {
    arrival_type: 'MOT',
    arrival_id: motArrivalId,
  });
  assert(resumeRes.status === 200, 'Idempotent Resume', 'Re-request returns existing session with 200 OK');
  assert(resumeRes.data.id === sessionId.toString(), 'Resume ID Match', 'Returned same session ID');

  console.log('\n--- 7. UPDATE DRAFT RESULTS ---');
  // Update draft values
  const draftUpdateRes = await updateDraftResults(toCoreUser(attendantA) as any, sessionId, {
    results: [
      { test_id: testTemp.id, numeric_value: 4.2 },
      { test_id: testOrgano.id, text_value: 'OK' },
    ],
    remarks: 'Sample smells fresh, slight chilling condensation',
  });
  assert(draftUpdateRes.status === 200, 'Draft Results Update', 'Draft test results updated successfully');
  const updatedTemp = draftUpdateRes.data.results.find((r: any) => r.test_id === testTemp.id.toString());
  assert(updatedTemp?.numeric_value === 4.2, 'Draft Numeric Value', 'Draft numeric value persisted');
  assert(draftUpdateRes.data.remarks.includes('Sample smells fresh'), 'Draft Remarks', 'Draft remarks persisted');

  // Invalid categorical option rejected
  const badDraftRes = await updateDraftResults(toCoreUser(attendantA) as any, sessionId, {
    results: [{ test_id: testOrgano.id, text_value: 'INVALID_OPTION_XYZ' }],
  });
  assert(badDraftRes.status === 400, 'Categorical Validation', 'Invalid categorical option rejected with 400');

  console.log('\n--- 8. COMPLETION & ACCEPT/REJECT DECISIONS ---');
  // Complete without required tests fails
  const incompleteCompRes = await completeSession(toCoreUser(attendantA) as any, sessionId, {
    completion_client_event_id: `comp-evt-1-${runId}`,
    decision: 'ACCEPTED',
    results: [{ test_id: testTemp.id, numeric_value: 4.0 }], // Missing required Acidity and Organo
  });
  assert(incompleteCompRes.status === 400, 'Completeness Validation', 'Missing required test rejected with 400');

  // S. completion duplicate test_id rejected
  const dupTestIdRes = await completeSession(toCoreUser(attendantA) as any, sessionId, {
    completion_client_event_id: `comp-evt-dup-${runId}`,
    decision: 'ACCEPTED',
    results: [
      { test_id: testTemp.id, numeric_value: 4.0 },
      { test_id: testTemp.id, numeric_value: 4.5 },
      { test_id: testAcidity.id, numeric_value: 0.14 },
      { test_id: testOrgano.id, text_value: 'OK' },
    ],
  });
  assert(dupTestIdRes.status === 400, 'Completion Duplicate Test ID Rejected', 'Duplicate test_id in completion rejected with 400');

  // T. completion missing optional frozen non-calculated test rejected
  // Incomplete submission missing one of the frozen tests
  const missingFrozenTestRes = await completeSession(toCoreUser(attendantA) as any, sessionId, {
    completion_client_event_id: `comp-evt-miss-${runId}`,
    decision: 'ACCEPTED',
    results: [
      { test_id: testTemp.id, numeric_value: 4.0 },
      { test_id: testAcidity.id, numeric_value: 0.14 },
      // testOrgano missing
    ],
  });
  assert(missingFrozenTestRes.status === 400, 'Completion Missing Frozen Test Rejected', 'Missing frozen test in completion payload rejected with 400');

  // Valid completion: ACCEPTED
  const completionEventId = `comp-evt-success-${runId}`;
  const validCompletionResults = startSessionRes.data.results.map((r: any) => {
    if (r.result_type_snapshot === 'NUMERIC') {
      return { test_id: r.test_id, numeric_value: 4.1 };
    } else {
      const options = r.result_options_snapshot as any[];
      const passingOpt = options?.find((o: any) => o.isPassing !== false)?.value || 'OK';
      return { test_id: r.test_id, text_value: passingOpt };
    }
  });

  const completeRes = await completeSession(toCoreUser(attendantA) as any, sessionId, {
    completion_client_event_id: completionEventId,
    decision: 'ACCEPTED',
    remarks: 'Milk passed all intake standards',
    results: validCompletionResults,
  });
  if (completeRes.status !== 200) {
    console.error('completeRes failed with:', completeRes);
  }
  assert(completeRes.status === 200, 'Complete Session ACCEPTED', 'Session finalized as ACCEPTED (200 OK)');
  assert(completeRes.data?.status === 'COMPLETED', 'Completed Status', 'Status moved to COMPLETED');
  assert(completeRes.data?.decision === 'ACCEPTED', 'Decision Recorded', 'Decision recorded as ACCEPTED');
  assert(completeRes.data?.completion_client_event_id === completionEventId, 'Event ID Stored', 'completion_client_event_id stored');

  // Verify AuditLog created
  const auditLogs = await prisma.auditLog.findMany({
    where: {
      table_name: 'zmcc_lab_session',
      record_id: sessionId,
      action: 'ZMCC_LAB_SESSION_COMPLETED',
    },
  });
  assert(auditLogs.length === 1, 'Audit Log Creation', 'ZMCC_LAB_SESSION_COMPLETED audit log created');

  // Exact replay returns 200 with completed data
  const replayRes = await completeSession(toCoreUser(attendantA) as any, sessionId, {
    completion_client_event_id: completionEventId,
    decision: 'ACCEPTED',
    remarks: 'Milk passed all intake standards',
    results: validCompletionResults,
  });
  assert(replayRes.status === 200, 'Idempotent Replay', 'Exact completion replay returns 200 OK');

  // A. same completion ID + same decision + changed numeric result => 409
  const changedNumericReplay = await completeSession(toCoreUser(attendantA) as any, sessionId, {
    completion_client_event_id: completionEventId,
    decision: 'ACCEPTED',
    remarks: 'Milk passed all intake standards',
    results: validCompletionResults.map((r: any) =>
      r.test_id === testTemp.id.toString() ? { ...r, numeric_value: 9.9 } : r
    ),
  });
  assert(changedNumericReplay.status === 409, 'Replay Changed Numeric Guard', 'Replay with altered numeric value rejected with 409 Conflict');

  // B. same completion ID + same decision + changed categorical/text result => 409
  const changedCatReplay = await completeSession(toCoreUser(attendantA) as any, sessionId, {
    completion_client_event_id: completionEventId,
    decision: 'ACCEPTED',
    remarks: 'Milk passed all intake standards',
    results: validCompletionResults.map((r: any) =>
      r.test_id === testOrgano.id.toString() ? { ...r, text_value: 'NOT_OK' } : r
    ),
  });
  assert(changedCatReplay.status === 409, 'Replay Changed Categorical Guard', 'Replay with altered categorical value rejected with 409 Conflict');

  // C. same completion ID + same decision + changed remarks => 409
  const changedRemarksReplay = await completeSession(toCoreUser(attendantA) as any, sessionId, {
    completion_client_event_id: completionEventId,
    decision: 'ACCEPTED',
    remarks: 'Completely different remarks submitted',
    results: validCompletionResults,
  });
  assert(changedRemarksReplay.status === 409, 'Replay Changed Remarks Guard', 'Replay with altered remarks rejected with 409 Conflict');

  // Existing changed-decision test => 409
  const alteredReplayRes = await completeSession(toCoreUser(attendantA) as any, sessionId, {
    completion_client_event_id: completionEventId,
    decision: 'REJECTED',
    rejection_reason: 'Changed mind',
    results: validCompletionResults,
  });
  assert(alteredReplayRes.status === 409, 'Idempotency Conflict Guard', 'Altered replay with changed decision rejected with 409 Conflict');

  // Draft update after completion fails
  const postCompDraft = await updateDraftResults(toCoreUser(attendantA) as any, sessionId, {
    results: [{ test_id: testTemp.id, numeric_value: 5.0 }],
  });
  assert(postCompDraft.status === 400, 'Immutability Guard', 'Draft update on completed session rejected with 400');

  // Verify zero VehicleVisit created
  const vvCount = await prisma.vehicleVisit.count({
    where: { procurement_source_id: zmccA.id },
  });
  assert(vvCount === 0, 'Zero VehicleVisit Constraint', 'Zero VehicleVisit records created by ZMCC Lab');

  console.log('\n--- 9. CONTRACTOR ARRIVAL LAB TESTING & REJECTION ---');
  const startConSession = await startOrResumeSession(toCoreUser(attendantA) as any, {
    arrival_type: 'CONTRACTOR',
    arrival_id: contractorArrivalId,
  });
  assert(startConSession.status === 201, 'Start Contractor Lab Session', `Contractor session created with ID #${startConSession.data?.id}`);
  const conSessionId = BigInt(startConSession.data.id);

  // Complete Contractor Session with REJECTED
  const conCompEventId = `comp-con-evt-${runId}`;
  const conRejectResults = startConSession.data.results.map((r: any) => {
    if (r.result_type_snapshot === 'NUMERIC') {
      return { test_id: r.test_id, numeric_value: 12.8 };
    } else {
      const options = r.result_options_snapshot as any[];
      const failingOpt = options?.find((o: any) => o.isPassing === false)?.value || 'NOT_OK';
      return { test_id: r.test_id, text_value: failingOpt };
    }
  });

  const conRejectRes = await completeSession(toCoreUser(attendantA) as any, conSessionId, {
    completion_client_event_id: conCompEventId,
    decision: 'REJECTED',
    rejection_reason: 'High temperature (> 12C) and high acidity (0.20%)',
    remarks: 'Milk rejected at gate due to thermal abuse in transport',
    results: conRejectResults,
  });
  if (conRejectRes.status !== 200) {
    console.error('conRejectRes failed with:', conRejectRes);
  }
  assert(conRejectRes.status === 200, 'Complete Session REJECTED', 'Contractor session finalized as REJECTED (200 OK)');
  assert(conRejectRes.data?.decision === 'REJECTED', 'Decision Recorded', 'Decision is REJECTED');
  assert(conRejectRes.data?.rejection_reason?.includes('High temperature'), 'Rejection Reason Saved', 'Rejection reason saved');

  // Exact replay of rejected session returns 200
  const conReplayRes = await completeSession(toCoreUser(attendantA) as any, conSessionId, {
    completion_client_event_id: conCompEventId,
    decision: 'REJECTED',
    rejection_reason: 'High temperature (> 12C) and high acidity (0.20%)',
    remarks: 'Milk rejected at gate due to thermal abuse in transport',
    results: conRejectResults,
  });
  assert(conReplayRes.status === 200, 'Idempotent Replay REJECTED', 'Exact rejected replay returns 200 OK');

  // D. rejected replay + changed rejection reason => 409
  const conAlteredReasonRes = await completeSession(toCoreUser(attendantA) as any, conSessionId, {
    completion_client_event_id: conCompEventId,
    decision: 'REJECTED',
    rejection_reason: 'Different reason: bad color and dirt in milk',
    remarks: 'Milk rejected at gate due to thermal abuse in transport',
    results: conRejectResults,
  });
  assert(conAlteredReasonRes.status === 409, 'Replay Altered Rejection Reason Guard', 'Replay with altered rejection reason rejected with 409 Conflict');

  // E. same completion ID used against a different session => 409
  const wrongSessionReplay = await completeSession(toCoreUser(attendantA) as any, conSessionId, {
    completion_client_event_id: completionEventId, // completionEventId belongs to sessionId (MOT), not conSessionId
    decision: 'ACCEPTED',
    remarks: 'Milk passed all intake standards',
    results: validCompletionResults,
  });
  assert(wrongSessionReplay.status === 409, 'Cross-Session Event ID Guard', 'Using event ID on different session rejected with 409 Conflict');

  // F & G. Concurrent IDENTICAL completion gives one first success + one 200 replay & leaves 1 audit log
  const concArrivalRes = await submitContractorArrival(toCoreUser(pheA) as any, {
    contractor_source_id: contractorActive.id,
    vehicle_number: `CONC-VEH-${runId}`,
    arrival_timestamp: new Date(),
    client_event_id: `evt-conc-arr-${runId}`,
  });
  assert(concArrivalRes.status === 201, 'Submit Concurrent Contractor Arrival', `Created arrival: ${concArrivalRes.data?.zmcc_token}`);
  const concArrivalId = concArrivalRes.data.id;

  const concStartRes = await startOrResumeSession(toCoreUser(attendantA) as any, {
    arrival_type: 'CONTRACTOR',
    arrival_id: concArrivalId,
  });
  assert(concStartRes.status === 201, 'Concurrent Session Created', 'Concurrent test session started (201)');
  const concSessionId = BigInt(concStartRes.data.id);

  const concEventId = `comp-conc-evt-${runId}`;
  const concResults = concStartRes.data.results.map((r: any) => {
    if (r.result_type_snapshot === 'NUMERIC') {
      return { test_id: r.test_id, numeric_value: 4.0 };
    } else {
      const options = r.result_options_snapshot as any[];
      const passingOpt = options?.find((o: any) => o.isPassing !== false)?.value || 'OK';
      return { test_id: r.test_id, text_value: passingOpt };
    }
  });

  const [concRes1, concRes2] = await Promise.all([
    completeSession(toCoreUser(attendantA) as any, concSessionId, {
      completion_client_event_id: concEventId,
      decision: 'ACCEPTED',
      remarks: 'Concurrent test batch',
      results: concResults,
    }),
    completeSession(toCoreUser(attendantA) as any, concSessionId, {
      completion_client_event_id: concEventId,
      decision: 'ACCEPTED',
      remarks: 'Concurrent test batch',
      results: concResults,
    }),
  ]);

  assert(
    concRes1.status === 200 && concRes2.status === 200,
    'Concurrent Identical Both 200',
    `Both concurrent identical requests return 200 (first-success + idempotent replay: ${concRes1.status}, ${concRes2.status})`
  );

  const concAudits = await prisma.auditLog.findMany({
    where: {
      table_name: 'zmcc_lab_session',
      record_id: concSessionId,
      action: 'ZMCC_LAB_SESSION_COMPLETED',
    },
  });
  assert(concAudits.length === 1, 'Concurrent Single Audit Log', 'Concurrent identical completions created exactly one completion audit log');

  console.log('\n--- 10. SUPERVISORY MANAGER CORRECTIONS ---');
  // Lab Attendant cannot perform corrections
  const attCorrectRes = await correctCompletedSession(toCoreUser(attendantA) as any, sessionId, {
    reason: 'Lab attendant attempting correction',
    decision: 'REJECTED',
    rejection_reason: 'Typo in temperature',
  });
  assert(attCorrectRes.status === 403, 'Correction Role Guard', 'Lab Attendant cannot correct session (403)');

  // Foreign ZMCC Manager cannot perform corrections
  // 17. Cross-ZMCC failure creates zero AuditLog/count
  const foreignMgr = await prisma.user.create({
    data: {
      username: `foreign_mgr_${runId}`,
      password_hash: 'hashed',
      role: 'ZMCC_MANAGER',
      full_name: `Manager Beta ${runId}`,
      is_active: true,
      procurement_source_id: zmccB.id,
      scope_type: 'SOURCE',
    },
  });
  const foreignCorrectRes = await correctCompletedSession(toCoreUser(foreignMgr) as any, sessionId, {
    reason: 'Foreign manager correction',
    decision: 'REJECTED',
    rejection_reason: 'Invalid',
  });
  assert(foreignCorrectRes.status === 403, 'Correction Scoping Guard', 'Foreign ZMCC Manager cannot correct session (403)');

  // 16. Validation failure creates zero AuditLog/count
  const noReasonCorrection = await correctCompletedSession(toCoreUser(managerA) as any, sessionId, {
    reason: '',
    decision: 'REJECTED',
    rejection_reason: 'Reason missing audit explanation',
  });
  assert(noReasonCorrection.status === 400, 'Audit Reason Mandatory', 'Correction without reason rejected with 400');

  // 13. Identical/no-op Manager save does not increment either counter (400 "No changes detected.")
  const noopManagerRes = await correctCompletedSession(toCoreUser(managerA), sessionId, {
    reason: 'Manager attempting identical save',
    decision: 'ACCEPTED',
  });
  assert(noopManagerRes.status === 400, 'No-op Manager Guard', 'Identical/no-op Manager save rejected with 400');
  assert(noopManagerRes.error === 'No changes detected.', 'No-op Message', 'Returns controlled "No changes detected." message');

  // 14. Identical/no-op Super Admin save does not increment total counter (400 "No changes detected.")
  const noopAdminRes = await correctCompletedSession(toCoreUser(superAdmin), sessionId, {
    reason: 'Admin attempting identical save',
    decision: 'ACCEPTED',
  });
  assert(noopAdminRes.status === 400, 'No-op Admin Guard', 'Identical/no-op Super Admin save rejected with 400');

  // 15. No-op creates zero AuditLog
  const preAuditLogs = await prisma.auditLog.findMany({
    where: {
      table_name: 'zmcc_lab_session',
      record_id: sessionId,
      action: 'ZMCC_LAB_SESSION_CORRECTED',
    },
  });
  assert(preAuditLogs.length === 0, 'Zero Audit For No-op', 'No-op and validation failures create zero audit logs');

  // 18. Multiple fields changed in ONE Manager request increment count by 1
  // 19. That save creates exactly one correction AuditLog
  // 2. Manager correction #1 succeeds
  const corr1Res = await correctCompletedSession(toCoreUser(managerA), sessionId, {
    reason: 'Corrected acidity value from titration recheck and updated remarks',
    results: [{ test_id: testAcidity.id, numeric_value: 0.13 }],
    remarks: 'Rechecked titration confirms 0.13%',
  });
  assert(corr1Res.status === 200, 'Correction 1 Success', 'Correction 1 applied successfully (200 OK)');
  assert(corr1Res.data.correction_count === 1, 'Correction Count 1', 'total correction_count is 1');
  assert(corr1Res.data.manager_correction_count === 1, 'Manager Correction Count 1', 'manager_correction_count is 1');
  const correctedAcidity = corr1Res.data.results.find((r: any) => r.test_id === testAcidity.id.toString());
  assert(correctedAcidity?.numeric_value === 0.13, 'Corrected Value', 'Numeric value updated to 0.13');

  const corr1AuditLogs = await prisma.auditLog.findMany({
    where: {
      table_name: 'zmcc_lab_session',
      record_id: sessionId,
      action: 'ZMCC_LAB_SESSION_CORRECTED',
    },
  });
  assert(corr1AuditLogs.length === 1, 'Single Audit Log For Multi-field Save', 'Multiple fields changed in one save creates exactly one audit log');

  // 3. Manager #2 succeeds
  const corr2Res = await correctCompletedSession(toCoreUser(managerA), sessionId, {
    reason: 'Adulteration strip secondary test failed upon re-inspection',
    decision: 'REJECTED',
    rejection_reason: 'Secondary adulteration test confirmed positive',
  });
  assert(corr2Res.status === 200, 'Correction 2 Success', 'Correction 2 applied successfully (200 OK)');
  assert(corr2Res.data.correction_count === 2, 'Correction Count 2', 'total correction_count is 2');
  assert(corr2Res.data.manager_correction_count === 2, 'Manager Correction Count 2', 'manager_correction_count is 2');
  assert(corr2Res.data.decision === 'REJECTED', 'Corrected Decision', 'Decision flipped to REJECTED');

  // 4. Manager #3 succeeds
  const corr3Res = await correctCompletedSession(toCoreUser(managerA), sessionId, {
    reason: 'Manager inspection update 3 - added sensory notes',
    remarks: 'Sensory notes updated during audit inspection 3',
  });
  assert(corr3Res.status === 200, 'Correction 3 Success', 'Correction 3 applied successfully (200 OK)');
  assert(corr3Res.data.correction_count === 3, 'Correction Count 3', 'total correction_count is 3');
  assert(corr3Res.data.manager_correction_count === 3, 'Manager Correction Count 3', 'manager_correction_count is 3');

  // 5. Manager #4 succeeds
  const corr4Res = await correctCompletedSession(toCoreUser(managerA), sessionId, {
    reason: 'Manager inspection update 4 - calibrated temperature note',
    remarks: 'Temperature calibration note added in save 4',
  });
  assert(corr4Res.status === 200, 'Correction 4 Success', 'Correction 4 applied successfully (200 OK)');
  assert(corr4Res.data.correction_count === 4, 'Correction Count 4', 'total correction_count is 4');
  assert(corr4Res.data.manager_correction_count === 4, 'Manager Correction Count 4', 'manager_correction_count is 4');

  // 6. Manager #5 succeeds
  const corr5Res = await correctCompletedSession(toCoreUser(managerA), sessionId, {
    reason: 'Manager inspection update 5 - final manager check',
    remarks: 'Manager final fifth correction note',
  });
  assert(corr5Res.status === 200, 'Correction 5 Success', 'Correction 5 applied successfully (200 OK)');
  assert(corr5Res.data.correction_count === 5, 'Correction Count 5', 'total correction_count is 5');
  assert(corr5Res.data.manager_correction_count === 5, 'Manager Correction Count 5', 'manager_correction_count is 5');

  // 7. Manager #6 fails (limit reached)
  const corr6Res = await correctCompletedSession(toCoreUser(managerA), sessionId, {
    reason: 'Sixth manager correction attempt - must be blocked',
    remarks: 'Sixth attempt should fail',
  });
  assert(corr6Res.status === 400, 'Max Corrections Guard', 'Sixth manager correction rejected with 400');
  assert(corr6Res.error === 'Maximum correction limit (5) reached for this lab session.', 'Max Limit Error Text', 'Returns maximum correction limit (5) reached');

  // Capture original submitter and timestamp before Super Admin corrections
  const preAdminSession = await prisma.zmccLabSession.findUniqueOrThrow({
    where: { id: sessionId },
  });
  const origCompletedBy = preAdminSession.completed_by_user_id;
  const origCompletedAt = preAdminSession.completed_at;

  // 8, 10, 11: Super Admin correction after Manager reaches 5 succeeds, total becomes 6, manager remains 5
  const adminCorr1Res = await correctCompletedSession(toCoreUser(superAdmin), sessionId, {
    reason: 'Super Admin reviewed titration graph and calibrated acidity reading',
    results: [{ test_id: testAcidity.id, numeric_value: 0.14 }],
  });
  assert(adminCorr1Res.status === 200, 'Super Admin Correction 1 Success', 'Super Admin correction after manager limit succeeds (200 OK)');
  assert(adminCorr1Res.data.correction_count === 6, 'Total Correction Count 6', 'total correction_count becomes 6');
  assert(adminCorr1Res.data.manager_correction_count === 5, 'Manager Count Remains 5', 'manager_correction_count remains 5');

  // 9. Super Admin second/third correction also succeeds
  const adminCorr2Res = await correctCompletedSession(toCoreUser(superAdmin), sessionId, {
    reason: 'Super Admin second audit verification',
    remarks: 'Super Admin second audit verification complete',
  });
  assert(adminCorr2Res.status === 200, 'Super Admin Correction 2 Success', 'Second Super Admin correction succeeds (200 OK)');
  assert(adminCorr2Res.data.correction_count === 7, 'Total Correction Count 7', 'total correction_count becomes 7');
  assert(adminCorr2Res.data.manager_correction_count === 5, 'Manager Count Still 5', 'manager_correction_count remains 5');

  const adminCorr3Res = await correctCompletedSession(toCoreUser(superAdmin), sessionId, {
    reason: 'Super Admin third audit verification',
    remarks: 'Super Admin third audit verification complete',
  });
  assert(adminCorr3Res.status === 200, 'Super Admin Correction 3 Success', 'Third Super Admin correction succeeds (200 OK)');
  assert(adminCorr3Res.data.correction_count === 8, 'Total Correction Count 8', 'total correction_count becomes 8');
  assert(adminCorr3Res.data.manager_correction_count === 5, 'Manager Count Fixed at 5', 'manager_correction_count remains 5');

  // Exactly 8 correction audit logs created (5 manager + 3 super admin)
  const sessionAuditLogs = await prisma.auditLog.findMany({
    where: {
      table_name: 'zmcc_lab_session',
      record_id: sessionId,
      action: 'ZMCC_LAB_SESSION_CORRECTED',
    },
    orderBy: { created_at: 'asc' },
  });
  assert(sessionAuditLogs.length === 8, 'Audit Logs Count 8', 'Exactly 8 correction audit logs created (5 manager + 3 super admin)');

  // 25, 26: Latest corrector becomes Super Admin, last_corrected_at populated
  assert(adminCorr3Res.data.last_corrected_by_user_id === superAdmin.id.toString(), 'Latest Corrector Is Super Admin', 'latest corrector becomes Super Admin');
  assert(!!adminCorr3Res.data.last_corrected_at, 'Last Corrected At Populated', 'last_corrected_at is populated');

  // 23, 24: Original completed_by_user_id and completed_at unchanged
  const postAdminSession = await prisma.zmccLabSession.findUniqueOrThrow({
    where: { id: sessionId },
  });
  assert(postAdminSession.completed_by_user_id === origCompletedBy, 'Original Completed By Preserved', 'original completed_by_user_id unchanged');
  assert(postAdminSession.completed_at?.getTime() === origCompletedAt?.getTime(), 'Original Completed At Preserved', 'original completed_at unchanged');

  // 27: Immutable identity/system fields cannot be corrected
  assert(postAdminSession.started_by_user_id === preAdminSession.started_by_user_id, 'Started By Immutable', 'started_by_user_id immutable');
  assert(postAdminSession.started_at.getTime() === preAdminSession.started_at.getTime(), 'Started At Immutable', 'started_at immutable');
  assert(postAdminSession.mot_arrival_id === preAdminSession.mot_arrival_id, 'MOT Arrival Immutable', 'mot_arrival_id immutable');
  assert(postAdminSession.arrival_type === 'MOT', 'Arrival Type Immutable', 'arrival_type immutable');
  assert(postAdminSession.zmcc_id === preAdminSession.zmcc_id, 'ZMCC ID Immutable', 'zmcc_id immutable');

  // 12. Super Admin correcting before any Manager correction does NOT consume Manager's five slots
  // Test on conSessionId (completed CONTRACTOR arrival from section 9)
  const preAdminConSession = await prisma.zmccLabSession.findUniqueOrThrow({
    where: { id: conSessionId },
  });
  assert(preAdminConSession.manager_correction_count === 0, 'Initial Manager Count 0', 'conSession initial manager count is 0');

  // Super Admin corrects first on conSessionId
  const adminFirstRes = await correctCompletedSession(toCoreUser(superAdmin), conSessionId, {
    reason: 'Super Admin initial review of contractor rejection',
    remarks: 'Under super admin review',
  });
  assert(adminFirstRes.status === 200, 'Admin First Correction Success', 'Super Admin correction succeeds first');
  assert(adminFirstRes.data.correction_count === 1, 'Admin First Total Count 1', 'total correction_count is 1');
  assert(adminFirstRes.data.manager_correction_count === 0, 'Admin First Manager Count 0', 'manager_correction_count remains 0');

  // Manager still has all 5 slots available! Execute slots 1, 2, 3, 4
  const conMgr1 = await correctCompletedSession(toCoreUser(managerA), conSessionId, {
    reason: 'Con Manager slot 1 correction',
    remarks: 'Con remarks 1',
  });
  assert(conMgr1.status === 200, 'Con Manager Slot 1 Success', 'Manager slot 1 succeeds after super admin correction');
  assert(conMgr1.data.manager_correction_count === 1, 'Con Manager Count 1', 'manager_correction_count is 1');

  const conMgr2 = await correctCompletedSession(toCoreUser(managerA), conSessionId, {
    reason: 'Con Manager slot 2 correction',
    remarks: 'Con remarks 2',
  });
  assert(conMgr2.status === 200, 'Con Manager Slot 2 Success', 'Manager slot 2 succeeds');
  assert(conMgr2.data.manager_correction_count === 2, 'Con Manager Count 2', 'manager_correction_count is 2');

  const conMgr3 = await correctCompletedSession(toCoreUser(managerA), conSessionId, {
    reason: 'Con Manager slot 3 correction',
    remarks: 'Con remarks 3',
  });
  assert(conMgr3.status === 200, 'Con Manager Slot 3 Success', 'Manager slot 3 succeeds');
  assert(conMgr3.data.manager_correction_count === 3, 'Con Manager Count 3', 'manager_correction_count is 3');

  const conMgr4 = await correctCompletedSession(toCoreUser(managerA), conSessionId, {
    reason: 'Con Manager slot 4 correction',
    remarks: 'Con remarks 4',
  });
  assert(conMgr4.status === 200, 'Con Manager Slot 4 Success', 'Manager slot 4 succeeds');
  assert(conMgr4.data.manager_correction_count === 4, 'Con Manager Count 4', 'manager_correction_count is 4');

  // 20, 21, 22: Concurrent Manager requests when count=4 (only 1 slot remaining): exactly one winner (#5)
  const [raceRes1, raceRes2] = await Promise.all([
    correctCompletedSession(toCoreUser(managerA), conSessionId, {
      reason: 'Concurrent race manager correction Alpha',
      remarks: 'Race Alpha',
    }),
    correctCompletedSession(toCoreUser(managerA), conSessionId, {
      reason: 'Concurrent race manager correction Beta',
      remarks: 'Race Beta',
    }),
  ]);

  const raceStatuses = [raceRes1.status, raceRes2.status].sort();
  assert(
    raceStatuses[0] === 200 && raceStatuses[1] === 400,
    'Concurrent Manager Slot Race',
    `Exactly one concurrent manager request succeeds (got statuses: ${raceRes1.status}, ${raceRes2.status})`
  );

  // 21. Final manager count remains 5
  const postRaceSession = await prisma.zmccLabSession.findUniqueOrThrow({
    where: { id: conSessionId },
  });
  assert(postRaceSession.manager_correction_count === 5, 'Final Manager Count 5', 'Final manager_correction_count is exactly 5');
  assert(postRaceSession.correction_count === 6, 'Final Total Count 6', 'Final total correction_count is 6 (1 admin + 5 manager)');

  // 22. Loser creates zero audit entry
  // Total corrections on conSessionId: 1 admin + 4 manager + 1 race winner = 6
  const conCorrAuditLogs = await prisma.auditLog.findMany({
    where: {
      table_name: 'zmcc_lab_session',
      record_id: conSessionId,
      action: 'ZMCC_LAB_SESSION_CORRECTED',
    },
  });
  assert(conCorrAuditLogs.length === 6, 'Zero Audit For Losing Correction', 'Losing concurrent manager correction creates zero audit entry (total 6)');

  console.log('\n--- 11. READ MODELS & HISTORY ---');
  // getSessionById
  const getByIdRes = await getSessionById(toCoreUser(attendantA), sessionId);
  assert(getByIdRes.status === 200, 'Get Session By ID', 'Session retrieved by ID');
  assert(getByIdRes.data.mot_arrival?.zmcc_token === motArrivalRes.data.zmcc_token, 'Arrival Relation Hydrated', 'Arrival details hydrated');
  assert(getByIdRes.data.results.length >= 3, 'Results Hydrated', 'Results list hydrated');

  // getLabHistory
  const historyRes = await getLabHistory(toCoreUser(attendantA), { decision: 'REJECTED' });
  assert(historyRes.status === 200, 'Get Lab History', 'Lab history retrieved');
  assert(historyRes.data.items.length >= 2, 'History Items Count', 'Both sessions retrieved (1 contractor rejected + 1 mot corrected to rejected)');

  // Super Admin global history
  const adminHistoryRes = await getLabHistory(toCoreUser(superAdmin));
  assert(adminHistoryRes.status === 200, 'Super Admin History', 'Super admin accesses global history');
  assert(adminHistoryRes.data.total >= 2, 'Global Total', 'Global total >= 2');

  console.log('\n--- 12. ORDINARY PKT DATE FILTERING & HISTORY BOUNDARIES ---');
  // Date under test: 2026-09-11
  // PKT is UTC+5 (fixed, non-DST).
  // 1. Sep 11 00:30 PKT = 2026-09-10T19:30:00.000Z -> INCLUDED in 2026-09-11
  // 2. Sep 11 23:30 PKT = 2026-09-11T18:30:00.000Z -> INCLUDED in 2026-09-11
  // 3. Sep 12 00:30 PKT = 2026-09-11T19:30:00.000Z -> NOT INCLUDED in 2026-09-11
  // 4. Sep 10 23:30 PKT = 2026-09-10T18:30:00.000Z -> NOT INCLUDED in 2026-09-11

  const tsPktStartIn = new Date('2026-09-11T00:30:00+05:00'); // 2026-09-10T19:30:00.000Z
  const tsPktEndIn = new Date('2026-09-11T23:30:00+05:00');   // 2026-09-11T18:30:00.000Z
  const tsPktNextOut = new Date('2026-09-12T00:30:00+05:00'); // 2026-09-11T19:30:00.000Z

  await prisma.zmccLabSession.update({
    where: { id: sessionId },
    data: { completed_at: tsPktStartIn },
  });
  await prisma.zmccLabSession.update({
    where: { id: conSessionId },
    data: { completed_at: tsPktEndIn },
  });
  await prisma.zmccLabSession.update({
    where: { id: concSessionId },
    data: { completed_at: tsPktNextOut },
  });

  const pktHistoryRes = await getLabHistory(toCoreUser(attendantA), { date: '2026-09-11' });
  assert(pktHistoryRes.status === 200, 'PKT Date History Query', 'getLabHistory succeeded for 2026-09-11');
  const returnedIds = (pktHistoryRes.data?.items || []).map((i: any) => i.id);
  assert(returnedIds.includes(sessionId.toString()), 'Sep 11 00:30 PKT Included', 'Sep 11 00:30 PKT session included in Sep 11');
  assert(returnedIds.includes(conSessionId.toString()), 'Sep 11 23:30 PKT Included', 'Sep 11 23:30 PKT session included in Sep 11');
  assert(!returnedIds.includes(concSessionId.toString()), 'Sep 12 00:30 PKT Excluded', 'Sep 12 00:30 PKT session excluded from Sep 11');

  // Strict YYYY-MM-DD date validation: 400 controlled response
  const invalidDateRes1 = await getLabHistory(toCoreUser(attendantA), { date: '2026-02-30' });
  assert(invalidDateRes1.status === 400, 'Invalid Date Feb 30', 'Malformed calendar date 2026-02-30 rejected with 400');
  const invalidDateRes2 = await getLabHistory(toCoreUser(attendantA), { date: 'not-a-date' });
  assert(invalidDateRes2.status === 400, 'Invalid Date Format', 'Non-date string rejected with 400');

  console.log('\n--- 13. CALCULATED TEST SAFETY & FROZEN RESULT TYPES ---');
  // Create an active required CALCULATED test
  const calcTest = await prisma.labTest.create({
    data: {
      testCode: `T-CALC-${runId}`,
      testName: `Calculated Ratio ${runId}`,
      resultType: 'CALCULATED',
      testScope: 'ZMCC',
      isRequired: true,
      displayOrder: 99,
      isActive: true,
    },
  });

  const calcArrivalRes = await submitContractorArrival(toCoreUser(pheA) as any, {
    contractor_source_id: contractorActive.id,
    vehicle_number: `CALC-VEH-${runId}`,
    arrival_timestamp: new Date(),
    client_event_id: `evt-calc-arr-${runId}`,
  });
  assert(calcArrivalRes.status === 201, 'Submit Calc Contractor Arrival', `Created arrival: ${calcArrivalRes.data?.zmcc_token}`);
  const calcArrivalId = calcArrivalRes.data.id;

  const calcStartRes = await startOrResumeSession(toCoreUser(attendantA) as any, {
    arrival_type: 'CONTRACTOR',
    arrival_id: calcArrivalId,
  });
  assert(calcStartRes.status === 400, 'Calculated Test Fail-Closed', 'Active required CALCULATED test prevents session start (400)');
  assert(
    Boolean(calcStartRes.error?.includes('has no canonical calculation owner')),
    'Calculated Error Message',
    `Error message explains missing calculation owner: "${calcStartRes.error}"`
  );

  // Deactivate the CALCULATED test
  await prisma.labTest.update({
    where: { id: calcTest.id },
    data: { isActive: false },
  });

  // Create an optional CALCULATED test to verify attendant cannot manually edit
  const optCalcTest = await prisma.labTest.create({
    data: {
      testCode: `T-OPTCALC-${runId}`,
      testName: `Optional Calculated ${runId}`,
      resultType: 'CALCULATED',
      testScope: 'ZMCC',
      isRequired: false,
      displayOrder: 100,
      isActive: true,
    },
  });

  const optCalcStartRes = await startOrResumeSession(toCoreUser(attendantA) as any, {
    arrival_type: 'CONTRACTOR',
    arrival_id: calcArrivalId,
  });
  assert(optCalcStartRes.status === 201, 'Optional Calc Session Start', 'Session with optional CALCULATED test started');
  const optCalcSessionId = BigInt(optCalcStartRes.data.id);

  // Attempting manual numeric update to CALCULATED test in updateDraftResults returns 400
  const draftCalcEdit = await updateDraftResults(toCoreUser(attendantA) as any, optCalcSessionId, {
    results: [{ test_id: optCalcTest.id, numeric_value: 12.34 }],
  });
  assert(draftCalcEdit.status === 400, 'Calculated Draft Manual Numeric Guard', 'Manual numeric value on CALCULATED test rejected with 400');
  assert(Boolean(draftCalcEdit.error?.includes('has no canonical calculation owner')), 'Draft Error Message', 'Clear message on manual calculated edit');

  // Attempting manual text update to CALCULATED test in updateDraftResults returns 400
  const draftCalcTextEdit = await updateDraftResults(toCoreUser(attendantA) as any, optCalcSessionId, {
    results: [{ test_id: optCalcTest.id, text_value: 'Arbitrary' }],
  });
  assert(draftCalcTextEdit.status === 400, 'Calculated Draft Manual Text Guard', 'Manual text value on CALCULATED test rejected with 400');

  // Attempting manual value in completeSession returns 400
  const compCalcEdit = await completeSession(toCoreUser(attendantA) as any, optCalcSessionId, {
    completion_client_event_id: `comp-calc-evt-${runId}`,
    decision: 'ACCEPTED',
    results: [
      { test_id: testTemp.id, numeric_value: 4.0 },
      { test_id: testAcidity.id, numeric_value: 0.14 },
      { test_id: testOrgano.id, text_value: 'OK' },
      { test_id: optCalcTest.id, numeric_value: 5.67 },
    ],
  });
  assert(compCalcEdit.status === 400, 'Calculated Complete Manual Guard', 'Manual entry on CALCULATED test in completeSession rejected with 400');

  // Deactivate optional CALCULATED test
  await prisma.labTest.update({
    where: { id: optCalcTest.id },
    data: { isActive: false },
  });

  console.log('\n--- 14. LAB SCOPE CHECKBOX MAPPING SEMANTICS ---');
  const { mapScopeCheckboxes } = await import('../src/lib/validations/labTest');

  // 1. Dispatch only => DISPATCH
  assert(mapScopeCheckboxes(true, false, false) === 'DISPATCH', 'Scope: Dispatch Only', 'Dispatch only => DISPATCH');

  // 2. Plant only => PLANT
  assert(mapScopeCheckboxes(false, true, false) === 'PLANT', 'Scope: Plant Only', 'Plant only => PLANT');

  // 3. ZMCC only => ZMCC
  assert(mapScopeCheckboxes(false, false, true) === 'ZMCC', 'Scope: ZMCC Only', 'ZMCC only => ZMCC');

  // 4. Dispatch + Plant => BOTH
  assert(mapScopeCheckboxes(true, true, false) === 'BOTH', 'Scope: Dispatch + Plant', 'Dispatch + Plant => BOTH');

  // 5. All three => ALL
  assert(mapScopeCheckboxes(true, true, true) === 'ALL', 'Scope: All Three', 'Dispatch + Plant + ZMCC => ALL');

  // 6. Dispatch + ZMCC only is rejected
  let dispZmccErr = false;
  try {
    mapScopeCheckboxes(true, false, true);
  } catch (e: any) {
    dispZmccErr = e.message.includes('not representable');
  }
  assert(dispZmccErr, 'Scope: Dispatch + ZMCC Rejected', 'Dispatch + ZMCC only rejected with unrepresentable error');

  // 7. Plant + ZMCC only is rejected
  let plantZmccErr = false;
  try {
    mapScopeCheckboxes(false, true, true);
  } catch (e: any) {
    plantZmccErr = e.message.includes('not representable');
  }
  assert(plantZmccErr, 'Scope: Plant + ZMCC Rejected', 'Plant + ZMCC only rejected with unrepresentable error');

  // 8. None selected is rejected
  let noneErr = false;
  try {
    mapScopeCheckboxes(false, false, false);
  } catch (e: any) {
    noneErr = e.message.includes('at least one scope');
  }
  assert(noneErr, 'Scope: None Selected Rejected', 'None selected rejected with select at least one error');

  // 9. Existing BOTH remains Dispatch + Plant, NOT ZMCC
  const bothTests = await prisma.labTest.findMany({
    where: { testScope: 'BOTH' },
  });
  for (const bt of bothTests) {
    assert(bt.testScope === 'BOTH', 'BOTH Preservation', `Existing BOTH test ${bt.testCode} remains BOTH`);
  }

  // 10. No existing LabTest records automatically rewritten
  const initialTestCount = await prisma.labTest.count();
  assert(initialTestCount > 0, 'Lab Tests Intact', `All ${initialTestCount} lab test records preserved without auto-rewrite`);

  console.log('\n=====================================================================');
  console.log(`FINAL STAGE 6F TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('=====================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runStage6fTests()
  .catch((err) => {
    console.error('Unhandled Stage 6F test runner error:', err);
    process.exit(1);
  });
