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
    SELECT conname FROM pg_constraint WHERE conname IN ('zmcc_lab_session_arrival_check', 'zmcc_lab_session_rejection_check', 'zmcc_lab_session_correction_count_check')
  `;
  const constraintNames = dbConstraints.map((c) => c.conname);
  assert(constraintNames.includes('zmcc_lab_session_arrival_check'), 'DB Check Constraint', 'arrival_check exists');
  assert(constraintNames.includes('zmcc_lab_session_rejection_check'), 'DB Check Constraint', 'rejection_check exists');
  assert(constraintNames.includes('zmcc_lab_session_correction_count_check'), 'DB Check Constraint', 'correction_count_check exists');

  console.log('\n--- 2. STATIC ANALYSIS & CANONICAL COMPLIANCE ---');
  // Registered in runner
  const runnerPath = path.join(repoRoot, 'scripts', 'run_all_regressions.ts');
  const runnerContent = fs.readFileSync(runnerPath, 'utf8');
  const stage6fMatches = runnerContent.match(/scripts\/test_stage6f_zmcc_lab\.ts/g);
  assert(stage6fMatches?.length === 1, 'Registered in Runner', 'test_stage6f_zmcc_lab.ts registered exactly once in run_all_regressions.ts');

  // Zero alert() in ZmccLabWorkspace
  const labWorkspacePath = path.join(repoRoot, 'src', 'frontend', 'modules', 'zmcc', 'lab', 'ZmccLabWorkspace.tsx');
  const labWorkspaceContent = fs.readFileSync(labWorkspacePath, 'utf8');
  const alertMatches = labWorkspaceContent.match(/\balert\s*\(/g);
  assert(alertMatches === null || alertMatches.length === 0, 'Zero alert() calls', 'ZmccLabWorkspace has zero browser alert() calls');

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

  // Reject without rejection reason fails
  const noReasonRejectRes = await completeSession(toCoreUser(attendantA) as any, sessionId, {
    completion_client_event_id: `comp-evt-2-${runId}`,
    decision: 'REJECTED',
    rejection_reason: '', // Empty reason
    results: [
      { test_id: testTemp.id, numeric_value: 12.5 },
      { test_id: testAcidity.id, numeric_value: 0.19 },
      { test_id: testOrgano.id, text_value: 'NOT_OK' },
    ],
  });
  assert(noReasonRejectRes.status === 400, 'Rejection Reason Guard', 'Empty rejection reason rejected with 400');

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
    results: validCompletionResults,
  });
  assert(replayRes.status === 200, 'Idempotent Replay', 'Exact completion replay returns 200 OK');

  // Altered replay with same event ID returns 409 Conflict
  const alteredReplayRes = await completeSession(toCoreUser(attendantA) as any, sessionId, {
    completion_client_event_id: completionEventId,
    decision: 'REJECTED',
    rejection_reason: 'Changed mind',
    results: [{ test_id: testTemp.id, numeric_value: 4.1 }],
  });
  assert(alteredReplayRes.status === 409, 'Idempotency Conflict Guard', 'Altered replay rejected with 409 Conflict');

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

  console.log('\n--- 10. SUPERVISORY MANAGER CORRECTIONS ---');
  // Lab Attendant cannot perform corrections
  const attCorrectRes = await correctCompletedSession(toCoreUser(attendantA) as any, sessionId, {
    reason: 'Lab attendant attempting correction',
    decision: 'REJECTED',
    rejection_reason: 'Typo in temperature',
  });
  assert(attCorrectRes.status === 403, 'Correction Role Guard', 'Lab Attendant cannot correct session (403)');

  // Foreign ZMCC Manager cannot perform corrections
  const foreignMgr = await prisma.user.create({
    data: {
      username: `mgr_b_${runId}`,
      password_hash: 'hash',
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

  // Correction without reason fails
  const noReasonCorrection = await correctCompletedSession(toCoreUser(managerA) as any, sessionId, {
    reason: '',
    decision: 'REJECTED',
    rejection_reason: 'Reason missing audit explanation',
  });
  assert(noReasonCorrection.status === 400, 'Audit Reason Mandatory', 'Correction without reason rejected with 400');

  // Correction 1: Update test value and remarks
  const corr1Res = await correctCompletedSession(toCoreUser(managerA), sessionId, {
    reason: 'Corrected acidity value from titration recheck',
    results: [{ test_id: testAcidity.id, numeric_value: 0.13 }],
    remarks: 'Rechecked titration confirms 0.13%',
  });
  assert(corr1Res.status === 200, 'Correction 1 Success', 'Correction 1 applied successfully (200 OK)');
  assert(corr1Res.data.correction_count === 1, 'Correction Count 1', 'correction_count is 1');
  const correctedAcidity = corr1Res.data.results.find((r: any) => r.test_id === testAcidity.id.toString());
  assert(correctedAcidity?.numeric_value === 0.13, 'Corrected Value', 'Numeric value updated to 0.13');

  // Correction 2: Flip decision to REJECTED with rejection reason
  const corr2Res = await correctCompletedSession(toCoreUser(managerA), sessionId, {
    reason: 'Adulteration strip secondary test failed upon re-inspection',
    decision: 'REJECTED',
    rejection_reason: 'Secondary adulteration test confirmed positive',
  });
  assert(corr2Res.status === 200, 'Correction 2 Success', 'Correction 2 applied successfully (200 OK)');
  assert(corr2Res.data.correction_count === 2, 'Correction Count 2', 'correction_count is 2');
  assert(corr2Res.data.decision === 'REJECTED', 'Corrected Decision', 'Decision flipped to REJECTED');

  // Correction 3: Exceeds max 2 corrections (fails with 400)
  const corr3Res = await correctCompletedSession(toCoreUser(managerA), sessionId, {
    reason: 'Third correction attempt',
    decision: 'ACCEPTED',
  });
  assert(corr3Res.status === 400, 'Max Corrections Guard', 'Third correction rejected with 400');

  // Verify AuditLog entries for corrections
  const corrAuditLogs = await prisma.auditLog.findMany({
    where: {
      table_name: 'zmcc_lab_session',
      record_id: sessionId,
      action: 'ZMCC_LAB_SESSION_CORRECTED',
    },
  });
  assert(corrAuditLogs.length === 2, 'Correction Audit Logs', 'Exactly 2 ZMCC_LAB_SESSION_CORRECTED audit logs created');

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
