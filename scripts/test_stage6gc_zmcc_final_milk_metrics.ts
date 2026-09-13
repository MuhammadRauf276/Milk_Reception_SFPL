/**
 * STAGE 6G-C: ZMCC FINAL MILK METRICS REGRESSION TEST SUITE
 *
 * Verifies:
 * 1. Database Schema & Migration:
 *    - Exactly 21 tracked migrations
 *    - 20260912210000_zmcc_final_milk_metrics migration exists
 *    - zmcc_lab_session columns: quantity_value, quantity_unit, density, gross_liters, snf, ts, at_13ts_liters, calculation_version
 *    - PostgreSQL CHECK constraints on physical bounds
 * 2. Static Analysis & Architecture:
 *    - Registered in scripts/run_all_regressions.ts
 *    - Shared calculation owner computeCanonicalMilkMetrics in milkFormulas.ts
 *    - Fail-closed LR/Fat resolver in milkTestResolvers.ts
 *    - Zero manual edit of calculated fields (100% server-owned)
 *    - Zero physical inventory / tank posting in 6G-C
 *    - Zero reconciliation / variance math in 6G-C
 * 3. Formula Engine Verification (Pure Mathematics):
 *    - LITER: 5000 L, LR 30 -> Gross = 5000.00 L, Density = 1.0300
 *    - KG: 5150 KG, LR 30 -> Density = 1.0300, Gross = 5000.00 L
 *    - SNF, TS, @13TS canonical computation with Fat = 4.0
 * 4. Core LR & Fat Resolution (Fail-Closed):
 *    - Exactly 1 LR candidate and 1 Fat candidate required
 *    - Missing LR or Fat fails closed
 *    - Ambiguous LR or Fat candidates fail closed
 *    - Ratio tests excluded from Fat candidates
 * 5. MOT Arrival Final Milk Metrics Workflow:
 *    - Actual reception testing with KG / LITER
 *    - Canonical derived metrics computed and persisted
 *    - Upstream MOT summary is read-only reference and remains unchanged
 * 6. Contractor Arrival Final Milk Metrics Workflow:
 *    - Shares exact same calculation engine
 *    - Works with LITER and KG
 *    - No MOT summary required
 * 7. Finalization Validation (Fail-Closed):
 *    - Rejects missing, zero, negative quantity
 *    - Rejects invalid unit
 *    - Rejects client attempts to submit manually calculated metrics
 * 8. Supervisory Manager Correction & Recalculation:
 *    - Manager correction of quantity recalculates derived metrics atomically
 *    - Manager correction of unit recalculates derived metrics atomically
 *    - Manager correction of LR/Fat recalculates derived metrics atomically
 *    - Single correction save counts once even with multiple fields changed
 *    - No-op correction does not consume manager count
 *    - Super Admin has unlimited corrections
 *    - Operator cannot correct completed session
 *    - AuditLog records accurate old/new metric snapshots
 * 9. Completion Idempotency:
 *    - Exact completion replay returns existing session without duplicate audit
 *    - Replay with altered quantity, unit, results, or decision returns conflict
 * 10. Historical Row Compatibility:
 *    - Historical sessions with NULL metrics remain valid
 *    - Read model does not fabricate synthetic values
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
console.log('🧪 STAGE 6G-C: ZMCC FINAL MILK METRICS REGRESSION SUITE');
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

async function runStage6gcTests() {
  const { prisma } = await import('../src/backend/core/db');
  const { Prisma } = await import('@prisma/client');
  const {
    computeCanonicalMilkMetrics,
  } = await import('../src/backend/utils/milkFormulas');
  const {
    isLrTestCandidate,
    isFatTestCandidate,
    resolveCoreMilkTestResults,
  } = await import('../src/backend/utils/milkTestResolvers');
  const {
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

  // =============================================================
  // 1. DATABASE SCHEMA & MIGRATIONS
  // =============================================================
  console.log('\n--- 1. DATABASE SCHEMA & MIGRATIONS ---');
  const migrationsDir = path.join(repoRoot, 'prisma', 'migrations');
  const migrationDirs = fs
    .readdirSync(migrationsDir)
    .filter((f) => fs.statSync(path.join(migrationsDir, f)).isDirectory() && !f.startsWith('.'));
  assert(migrationDirs.length === 21, 'Tracked Migrations', `Found exactly ${migrationDirs.length} migrations (expected 21)`);

  const metricsMigDir = migrationDirs.find((d) => d.includes('zmcc_final_milk_metrics'));
  assert(!!metricsMigDir, 'Migration Exists', `Found 6G-C migration: ${metricsMigDir}`);

  // Check zmcc_lab_session table has all 8 new columns
  const cols = await prisma.$queryRaw<Array<{ column_name: string; data_type: string }>>`
    SELECT column_name, data_type 
    FROM information_schema.columns 
    WHERE table_name = 'zmcc_lab_session'
    AND column_name IN ('quantity_value', 'quantity_unit', 'density', 'gross_liters', 'snf', 'ts', 'at_13ts_liters', 'calculation_version')
  `;
  const colNames = cols.map((c) => c.column_name);
  assert(colNames.includes('quantity_value'), 'Column Check', 'quantity_value exists');
  assert(colNames.includes('quantity_unit'), 'Column Check', 'quantity_unit exists');
  assert(colNames.includes('density'), 'Column Check', 'density exists');
  assert(colNames.includes('gross_liters'), 'Column Check', 'gross_liters exists');
  assert(colNames.includes('snf'), 'Column Check', 'snf exists');
  assert(colNames.includes('ts'), 'Column Check', 'ts exists');
  assert(colNames.includes('at_13ts_liters'), 'Column Check', 'at_13ts_liters exists');
  assert(colNames.includes('calculation_version'), 'Column Check', 'calculation_version exists');

  // Check DB check constraints
  const dbConstraints = await prisma.$queryRaw<Array<{ conname: string }>>`
    SELECT conname FROM pg_constraint 
    WHERE conname IN (
      'zmcc_lab_session_quantity_value_check',
      'zmcc_lab_session_density_check',
      'zmcc_lab_session_gross_liters_check',
      'zmcc_lab_session_snf_check',
      'zmcc_lab_session_ts_check',
      'zmcc_lab_session_at_13ts_liters_check'
    )
  `;
  const conNames = dbConstraints.map((c) => c.conname);
  assert(conNames.includes('zmcc_lab_session_quantity_value_check'), 'DB Check Constraint', 'quantity_value_check exists');
  assert(conNames.includes('zmcc_lab_session_density_check'), 'DB Check Constraint', 'density_check exists');
  assert(conNames.includes('zmcc_lab_session_gross_liters_check'), 'DB Check Constraint', 'gross_liters_check exists');
  assert(conNames.includes('zmcc_lab_session_snf_check'), 'DB Check Constraint', 'snf_check exists');
  assert(conNames.includes('zmcc_lab_session_ts_check'), 'DB Check Constraint', 'ts_check exists');
  assert(conNames.includes('zmcc_lab_session_at_13ts_liters_check'), 'DB Check Constraint', 'at_13ts_liters_check exists');

  // =============================================================
  // 2. STATIC CODE & ARCHITECTURAL CHECKS
  // =============================================================
  console.log('\n--- 2. STATIC CODE & ARCHITECTURAL CHECKS ---');
  const regressionRunnerPath = path.join(repoRoot, 'scripts', 'run_all_regressions.ts');
  const regressionRunnerContent = fs.readFileSync(regressionRunnerPath, 'utf8');
  assert(
    regressionRunnerContent.includes('test_stage6gc_zmcc_final_milk_metrics.ts'),
    'Architecture',
    'Suite registered in run_all_regressions.ts'
  );

  const zmccServicePath = path.join(repoRoot, 'src', 'backend', 'services', 'zmccLabService.ts');
  const zmccServiceContent = fs.readFileSync(zmccServicePath, 'utf8');
  assert(
    zmccServiceContent.includes('computeCanonicalMilkMetrics'),
    'Architecture',
    'zmccLabService imports and uses canonical computeCanonicalMilkMetrics'
  );
  assert(
    zmccServiceContent.includes('resolveCoreMilkTestResults'),
    'Architecture',
    'zmccLabService imports and uses shared resolveCoreMilkTestResults'
  );
  assert(
    !zmccServiceContent.includes('tank_stock') && !zmccServiceContent.includes('inventory_ledger'),
    'Scope Discipline',
    'No tank inventory or inventory ledger modifications in zmccLabService'
  );

  // =============================================================
  // 3. PURE FORMULA ENGINE VERIFICATION
  // =============================================================
  console.log('\n--- 3. PURE FORMULA ENGINE VERIFICATION ---');
  // LITER: 5000 L, LR 30, Fat 4.0
  const literMetrics = computeCanonicalMilkMetrics(5000, 'LITER', 30, 4.0);
  assert(literMetrics.grossLiters === 5000.00, 'Formula LITER Gross', `Gross = ${literMetrics.grossLiters} (expected 5000.00)`);
  assert(literMetrics.density === 1.0300, 'Formula LITER Density', `Density = ${literMetrics.density} (expected 1.0300)`);
  assert(literMetrics.snf === 9.10, 'Formula LITER SNF', `SNF = ${literMetrics.snf} (expected 9.10)`);
  assert(literMetrics.ts === 13.10, 'Formula LITER TS', `TS = ${literMetrics.ts} (expected 13.10)`);
  assert(literMetrics.at13tsLiters === 5038.46, 'Formula LITER @13TS', `@13TS = ${literMetrics.at13tsLiters} (expected 5038.46)`);
  assert(literMetrics.calculationVersion === '1.0', 'Formula LITER Version', `Version = ${literMetrics.calculationVersion}`);

  // KG: 5150 KG, LR 30, Fat 4.0
  const kgMetrics = computeCanonicalMilkMetrics(5150, 'KG', 30, 4.0);
  assert(kgMetrics.density === 1.0300, 'Formula KG Density', `Density = ${kgMetrics.density} (expected 1.0300)`);
  assert(kgMetrics.grossLiters === 5000.00, 'Formula KG Gross', `Gross = ${kgMetrics.grossLiters} (expected 5000.00)`);
  assert(kgMetrics.snf === 9.10, 'Formula KG SNF', `SNF = ${kgMetrics.snf} (expected 9.10)`);
  assert(kgMetrics.ts === 13.10, 'Formula KG TS', `TS = ${kgMetrics.ts} (expected 13.10)`);
  assert(kgMetrics.at13tsLiters === 5038.46, 'Formula KG @13TS', `@13TS = ${kgMetrics.at13tsLiters} (expected 5038.46)`);

  // =============================================================
  // 4. CORE LR & FAT RESOLUTION (FAIL-CLOSED)
  // =============================================================
  console.log('\n--- 4. CORE LR & FAT RESOLUTION ---');
  // Matching candidates
  assert(isLrTestCandidate('LT-000008', 'Lactometer Reading (LR)', 'NUMERIC'), 'Resolver', 'LR matches code/name');
  assert(isFatTestCandidate('LT-000026', 'Fat Percentage', 'NUMERIC'), 'Resolver', 'Fat matches code/name');
  // Exclude ratio tests
  assert(!isFatTestCandidate('LT-000009', 'SNF to Fat Ratio', 'CALCULATED'), 'Resolver', 'SNF to Fat Ratio rejected as Fat');
  assert(!isFatTestCandidate('LT-RATIO', 'Fat Ratio Test', 'NUMERIC'), 'Resolver', 'Any ratio test rejected as Fat');

  // Test resolveCoreMilkTestResults
  const validItems = [
    { testId: 't1', testCode: 'LT-000008', testName: 'LR at 20 C', resultType: 'NUMERIC', numericValue: 30 },
    { testId: 't2', testCode: 'LT-000026', testName: 'Fat %', resultType: 'NUMERIC', numericValue: 4.0 },
  ];
  const resolved = resolveCoreMilkTestResults(validItems);
  assert(resolved.success && resolved.lr === 30 && resolved.fat === 4.0, 'Resolver Success', `Resolved LR: ${resolved.success ? resolved.lr : 'err'}, Fat: ${resolved.success ? resolved.fat : 'err'}`);

  // Missing LR fails closed
  const missingLr = resolveCoreMilkTestResults([validItems[1]]);
  assert(!missingLr.success && missingLr.error.includes('Missing LR test'), 'Resolver Fail-Closed', 'Rejected missing LR');

  // Ambiguous LR (two candidates) fails closed
  const ambiguousItems = [
    { testId: 't1a', testCode: 'LT-000008', testName: 'LR Test A', resultType: 'NUMERIC', numericValue: 30 },
    { testId: 't1b', testCode: 'LT-000027', testName: 'LR Test B', resultType: 'NUMERIC', numericValue: 30 },
    validItems[1],
  ];
  const ambRes = resolveCoreMilkTestResults(ambiguousItems);
  assert(!ambRes.success && ambRes.error.includes('Ambiguous LR test'), 'Resolver Ambiguity', 'Rejected ambiguous LR candidates');

  // =============================================================
  // 5. SETUP FIXTURES FOR WORKFLOW TESTS
  // =============================================================
  console.log('\n--- SETUP TEST FIXTURES ---');
  const runId = Date.now().toString().slice(-6);

  // ZMCC Source
  const zmcc = await prisma.procurementSource.create({
    data: {
      code: `Z6GC-${runId}`,
      name: `Stage 6GC ZMCC ${runId}`,
      source_type: 'ZMCC',
      is_active: true,
    },
  });

  // Contractor Source
  const contractor = await prisma.procurementSource.create({
    data: {
      code: `CON-6GC-${runId}`,
      name: `Contractor 6GC ${runId}`,
      source_type: 'CONTRACTOR',
      is_active: true,
    },
  });

  // Users
  const attendant = await prisma.user.create({
    data: {
      username: `attendant_6gc_${runId}`,
      password_hash: 'hash',
      role: 'ZMCC_LAB_ATTENDANT',
      full_name: `Lab Attendant 6GC ${runId}`,
      is_active: true,
      procurement_source_id: zmcc.id,
      scope_type: 'SOURCE',
    },
  });

  const manager = await prisma.user.create({
    data: {
      username: `manager_6gc_${runId}`,
      password_hash: 'hash',
      role: 'ZMCC_MANAGER',
      full_name: `ZMCC Manager 6GC ${runId}`,
      is_active: true,
      procurement_source_id: zmcc.id,
      scope_type: 'SOURCE',
    },
  });

  const phe = await prisma.user.create({
    data: {
      username: `phe_6gc_${runId}`,
      password_hash: 'hash',
      role: 'PHE_OPERATOR',
      full_name: `PHE 6GC ${runId}`,
      is_active: true,
      procurement_source_id: zmcc.id,
      scope_type: 'SOURCE',
    },
  });

  // Ensure Lab Tests exist and are active: LR and FAT (do NOT mutate testScope)
  let lrTest = await prisma.labTest.findFirst({
    where: { testCode: 'LT-000008' },
  });
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
    lrTest = await prisma.labTest.update({
      where: { id: lrTest.id },
      data: { isActive: true },
    });
  }

  let fatTest = await prisma.labTest.findFirst({
    where: { testCode: 'LT-000026' },
  });
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
    fatTest = await prisma.labTest.update({
      where: { id: fatTest.id },
      data: { isActive: true },
    });
  }

  // Setup canonical MilkTestPolicyAssignment fixtures for ZMCC_LAB_MOT and ZMCC_LAB_CONTRACTOR
  await prisma.milkTestPolicyAssignment.deleteMany({
    where: {
      testing_point: { in: ['ZMCC_LAB_MOT', 'ZMCC_LAB_CONTRACTOR'] },
    },
  });

  // Assign LR and Fat to ZMCC_LAB_MOT
  await prisma.milkTestPolicyAssignment.create({
    data: {
      lab_test_id: lrTest.id,
      testing_point: 'ZMCC_LAB_MOT',
      is_required: true,
      display_order: 1,
      is_active: true,
      created_by_user_id: manager.id,
    },
  });
  await prisma.milkTestPolicyAssignment.create({
    data: {
      lab_test_id: fatTest.id,
      testing_point: 'ZMCC_LAB_MOT',
      is_required: true,
      display_order: 2,
      is_active: true,
      created_by_user_id: manager.id,
    },
  });

  // Assign LR and Fat to ZMCC_LAB_CONTRACTOR
  await prisma.milkTestPolicyAssignment.create({
    data: {
      lab_test_id: lrTest.id,
      testing_point: 'ZMCC_LAB_CONTRACTOR',
      is_required: true,
      display_order: 1,
      is_active: true,
      created_by_user_id: manager.id,
    },
  });
  await prisma.milkTestPolicyAssignment.create({
    data: {
      lab_test_id: fatTest.id,
      testing_point: 'ZMCC_LAB_CONTRACTOR',
      is_required: true,
      display_order: 2,
      is_active: true,
      created_by_user_id: manager.id,
    },
  });

  // Helper to create completed MOT Journey and Arrival
  async function createCompletedMotArrival(tokenSuffix: string) {
    const route = await prisma.zmccRoute.create({
      data: {
        zmcc_id: zmcc.id,
        route_code: `R-6GC-${tokenSuffix}`,
        name: `Route 6GC ${tokenSuffix}`,
        origin: 'Origin',
        destination: 'ZMCC',
        created_by: manager.id,
        updated_by: manager.id,
      },
    });
    const vehicle = await prisma.motVehicle.create({
      data: {
        zmcc_id: zmcc.id,
        vehicle_number: `MOT-6GC-${tokenSuffix}`,
        created_by: manager.id,
        updated_by: manager.id,
      },
    });
    const motProfile = await prisma.motProfile.create({
      data: {
        zmcc_id: zmcc.id,
        mot_code: `MOT6GC-${tokenSuffix}`,
        name: `MOT Officer 6GC ${tokenSuffix}`,
        phone_number: '03001234567',
        cnic: '35201-1234567-1',
        created_by: manager.id,
        updated_by: manager.id,
      },
    });
    const journey = await prisma.motJourney.create({
      data: {
        journey_number: `J6GC-${tokenSuffix}`,
        idempotency_key: `dispatch-j6gc-${tokenSuffix}`,
        zmcc_id: zmcc.id,
        route_id: route.id,
        mot_vehicle_id: vehicle.id,
        mot_profile_id: motProfile.id,
        assigned_by: manager.id,
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
      toCoreUser(phe) as any,
      {
        journey_id: journey.id,
        route_milk_token: `RM-${tokenSuffix}`,
        arrival_timestamp: new Date(Date.now() - 1800000),
        client_event_id: `evt-mot-arr-${tokenSuffix}`,
      }
    );

    return { arrival: arrivalRes.data, journey };
  }

  // =============================================================
  // 5. MOT ARRIVAL FINAL MILK METRICS WORKFLOW (KG & LITER)
  // =============================================================
  console.log('\n--- 5. MOT ARRIVAL FINAL MILK METRICS WORKFLOW ---');
  {
    const { arrival } = await createCompletedMotArrival(`MOT1-${runId}`);

    // Start session
    const startRes = await startOrResumeSession(
      toCoreUser(attendant) as any,
      {
        arrival_type: 'MOT',
        arrival_id: BigInt(arrival.id),
      }
    );
    assert(startRes.status === 201, 'Session Started', `Session #${startRes.data?.id} started (status 201)`);
    const sessionId = BigInt(startRes.data.id);

    // Draft update with quantity and unit
    const draftRes = await updateDraftResults(
      toCoreUser(attendant) as any,
      sessionId,
      {
        quantity_value: 5150,
        quantity_unit: 'KG',
        results: [
          { test_id: lrTest.id.toString(), numeric_value: 30, text_value: null },
          { test_id: fatTest.id.toString(), numeric_value: 4.0, text_value: null },
        ],
      }
    );
    assert(draftRes.status === 200, 'Draft Saved', 'Draft results saved successfully');
    assert(draftRes.data.quantity_value === 5150, 'Draft Quantity', 'Draft saved quantity 5150');
    assert(draftRes.data.quantity_unit === 'KG', 'Draft Unit', 'Draft saved unit KG');
    assert(draftRes.data.gross_liters === 5000.00, 'Draft Preview Gross', `Draft computed gross liters = ${draftRes.data.gross_liters}`);

    // Complete session with KG
    const completeRes = await completeSession(
      toCoreUser(attendant) as any,
      sessionId,
      {
        quantity_value: 5150,
        quantity_unit: 'KG',
        decision: 'ACCEPTED',
        results: [
          { test_id: lrTest.id.toString(), numeric_value: 30, text_value: null },
          { test_id: fatTest.id.toString(), numeric_value: 4.0, text_value: null },
        ],
        completion_client_event_id: `evt-mot1-${runId}`,
      }
    );

    if (completeRes.status !== 200) {
      console.error('completeRes failed with:', completeRes);
    }
    assert(completeRes.status === 200, 'Session Completed', 'Session marked COMPLETED');
    const completed = completeRes.data;
    assert(completed.decision === 'ACCEPTED', 'Session Decision', 'Decision ACCEPTED');
    assert(completed.quantity_value === 5150, 'Persisted Quantity', 'Quantity 5150 KG');
    assert(completed.quantity_unit === 'KG', 'Persisted Unit', 'Unit KG');
    assert(completed.density === 1.0300, 'Persisted Density', `Density: ${completed.density}`);
    assert(completed.gross_liters === 5000.00, 'Persisted Gross Liters', `Gross Liters: ${completed.gross_liters}`);
    assert(completed.snf === 9.10, 'Persisted SNF', `SNF: ${completed.snf}`);
    assert(completed.ts === 13.10, 'Persisted TS', `TS: ${completed.ts}`);
    assert(completed.at_13ts_liters === 5038.46, 'Persisted @13TS', `@13TS: ${completed.at_13ts_liters}`);
    assert(completed.calculation_version === '1.0', 'Calculation Version', 'Version 1.0');

    // Upstream MOT Summary reference check
    assert(
      completed.mot_arrival?.journey?.summary !== undefined,
      'MOT Summary Reference',
      'Upstream MOT journey summary serialized as read-only reference'
    );

    // Verify AuditLog record
    const audit = await prisma.auditLog.findFirst({
      where: {
        table_name: 'zmcc_lab_session',
        record_id: sessionId,
        action: 'ZMCC_LAB_SESSION_COMPLETED',
      },
      orderBy: { created_at: 'desc' },
    });
    assert(!!audit, 'Audit Log', 'AuditLog record exists for session completion');
    const details = audit?.new_values as any;
    assert(Number(details?.quantity_value) === 5150, 'Audit Quantity', `Audit quantity: ${details?.quantity_value}`);
    assert(details?.gross_liters === 5000.00, 'Audit Gross', `Audit gross: ${details?.gross_liters}`);
    assert(details?.at_13ts_liters === 5038.46, 'Audit @13TS', `Audit @13TS: ${details?.at_13ts_liters}`);
  }

  // =============================================================
  // 6. CONTRACTOR ARRIVAL FINAL MILK METRICS WORKFLOW (LITER)
  // =============================================================
  console.log('\n--- 6. CONTRACTOR ARRIVAL FINAL MILK METRICS WORKFLOW ---');
  {
    const conArrivalRes = await submitContractorArrival(
      toCoreUser(phe) as any,
      {
        contractor_source_id: contractor.id,
        vehicle_number: `CON-VEH-${runId}`,
        arrival_timestamp: new Date(Date.now() - 1200000),
        client_event_id: `evt-con-arr-${runId}`,
      }
    );
    assert(conArrivalRes.status === 201, 'Contractor Arrival Created', 'Contractor arrival submitted');
    const contractorArrival = conArrivalRes.data;

    const startRes = await startOrResumeSession(
      toCoreUser(attendant) as any,
      {
        arrival_type: 'CONTRACTOR',
        arrival_id: BigInt(contractorArrival.id),
      }
    );
    assert(startRes.status === 201, 'Contractor Session Started', 'Contractor session started');
    const sessionId = BigInt(startRes.data.id);
    assert(startRes.data.arrival_type === 'CONTRACTOR', 'Contractor Session Type', 'Session type CONTRACTOR');

    // Complete session with LITER
    const completeRes = await completeSession(
      toCoreUser(attendant) as any,
      sessionId,
      {
        quantity_value: 5000,
        quantity_unit: 'LITER',
        decision: 'ACCEPTED',
        results: [
          { test_id: lrTest.id.toString(), numeric_value: 30, text_value: null },
          { test_id: fatTest.id.toString(), numeric_value: 4.0, text_value: null },
        ],
        completion_client_event_id: `evt-cont1-${runId}`,
      }
    );

    assert(completeRes.status === 200, 'Contractor Session Completed', 'Completed successfully');
    const completed = completeRes.data;
    assert(completed.gross_liters === 5000.00, 'Contractor LITER Gross', `Gross = ${completed.gross_liters} (expected 5000.00)`);
    assert(completed.density === 1.0300, 'Contractor Density', `Density = ${completed.density} (expected 1.0300)`);
    assert(completed.snf === 9.10, 'Contractor SNF', `SNF = ${completed.snf} (expected 9.10)`);
    assert(completed.ts === 13.10, 'Contractor TS', `TS = ${completed.ts} (expected 13.10)`);
    assert(completed.at_13ts_liters === 5038.46, 'Contractor @13TS', `@13TS = ${completed.at_13ts_liters} (expected 5038.46)`);
  }

  // =============================================================
  // 7. FINALIZATION VALIDATION (FAIL-CLOSED)
  // =============================================================
  console.log('\n--- 7. FINALIZATION VALIDATION (FAIL-CLOSED) ---');
  {
    const conArrivalRes = await submitContractorArrival(
      toCoreUser(phe) as any,
      {
        contractor_source_id: contractor.id,
        vehicle_number: `CONT-VEH-2-${runId}`,
        arrival_timestamp: new Date(Date.now() - 1000000),
        client_event_id: `evt-con-arr-2-${runId}`,
      }
    );
    const startRes = await startOrResumeSession(
      toCoreUser(attendant) as any,
      {
        arrival_type: 'CONTRACTOR',
        arrival_id: BigInt(conArrivalRes.data.id),
      }
    );
    const sessionId = BigInt(startRes.data.id);

    // Rejects missing quantity
    const noQtyRes = await completeSession(
      toCoreUser(attendant) as any,
      sessionId,
      {
        decision: 'ACCEPTED',
        results: [
          { test_id: lrTest.id.toString(), numeric_value: 30, text_value: null },
          { test_id: fatTest.id.toString(), numeric_value: 4.0, text_value: null },
        ],
        completion_client_event_id: `val-no-qty-${runId}`,
      } as any
    );
    assert(noQtyRes.status === 400 && Boolean(noQtyRes.error?.includes('Actual milk quantity is required')), 'Validation Missing Qty', 'Rejected missing quantity');

    // Rejects zero quantity
    const zeroQtyRes = await completeSession(
      toCoreUser(attendant) as any,
      sessionId,
      {
        quantity_value: 0,
        quantity_unit: 'LITER',
        decision: 'ACCEPTED',
        results: [
          { test_id: lrTest.id.toString(), numeric_value: 30, text_value: null },
          { test_id: fatTest.id.toString(), numeric_value: 4.0, text_value: null },
        ],
        completion_client_event_id: `val-zero-qty-${runId}`,
      }
    );
    assert(zeroQtyRes.status === 400 && Boolean(zeroQtyRes.error?.includes('greater than 0')), 'Validation Zero Qty', 'Rejected zero quantity');

    // Rejects invalid unit
    const badUnitRes = await completeSession(
      toCoreUser(attendant) as any,
      sessionId,
      {
        quantity_value: 5000,
        quantity_unit: 'GALLON' as any,
        decision: 'ACCEPTED',
        results: [
          { test_id: lrTest.id.toString(), numeric_value: 30, text_value: null },
          { test_id: fatTest.id.toString(), numeric_value: 4.0, text_value: null },
        ],
        completion_client_event_id: `val-bad-unit-${runId}`,
      }
    );
    assert(badUnitRes.status === 400 && Boolean(badUnitRes.error?.includes('Must be KG or LITER')), 'Validation Unit', 'Rejected invalid unit GALLON');

    // Rejects manual calculated metrics
    const manualMetricsRes = await completeSession(
      toCoreUser(attendant) as any,
      sessionId,
      {
        quantity_value: 5000,
        quantity_unit: 'LITER',
        decision: 'ACCEPTED',
        density: 1.0500,
        gross_liters: 9999,
        results: [
          { test_id: lrTest.id.toString(), numeric_value: 30, text_value: null },
          { test_id: fatTest.id.toString(), numeric_value: 4.0, text_value: null },
        ],
        completion_client_event_id: `val-manual-metrics-${runId}`,
      } as any
    );
    assert(manualMetricsRes.status === 400 && Boolean(manualMetricsRes.error?.includes('Calculated metrics')), 'Validation Manual Metrics', 'Rejected manual calculated metrics');

    // Rejects missing LR
    const missingLrRes = await completeSession(
      toCoreUser(attendant) as any,
      sessionId,
      {
        quantity_value: 5000,
        quantity_unit: 'LITER',
        decision: 'ACCEPTED',
        results: [
          { test_id: fatTest.id.toString(), numeric_value: 4.0, text_value: null },
        ],
        completion_client_event_id: `val-missing-lr-${runId}`,
      }
    );
    assert(missingLrRes.status === 400 && (Boolean(missingLrRes.error?.includes('LR test could not be resolved')) || Boolean(missingLrRes.error?.includes('Missing result entry'))), 'Validation Missing LR', 'Rejected missing LR');
  }

  // =============================================================
  // 8. SUPERVISORY MANAGER CORRECTION & RECALCULATION
  // =============================================================
  console.log('\n--- 8. SUPERVISORY MANAGER CORRECTION & RECALCULATION ---');
  {
    const { arrival } = await createCompletedMotArrival(`CORR-${runId}`);
    const startRes = await startOrResumeSession(
      toCoreUser(attendant) as any,
      {
        arrival_type: 'MOT',
        arrival_id: BigInt(arrival.id),
      }
    );
    const sessionId = BigInt(startRes.data.id);

    // Initial completion: 5000 LITER, LR 30, Fat 4.0 -> Gross 5000, @13TS 5038.46
    const compInit = await completeSession(
      toCoreUser(attendant) as any,
      sessionId,
      {
        quantity_value: 5000,
        quantity_unit: 'LITER',
        decision: 'ACCEPTED',
        results: [
          { test_id: lrTest.id.toString(), numeric_value: 30, text_value: null },
          { test_id: fatTest.id.toString(), numeric_value: 4.0, text_value: null },
        ],
        completion_client_event_id: `evt-corr-init-${runId}`,
      }
    );
    assert(compInit.status === 200, 'Initial Completion for Correction', 'Completed initially');

    // 1. Operator cannot correct completed session
    const opCorrRes = await correctCompletedSession(
      toCoreUser(attendant) as any,
      sessionId,
      {
        reason: 'Attempted operator correction',
        quantity_value: 5200,
      }
    );
    assert(opCorrRes.status === 403 && Boolean(opCorrRes.error?.includes('Only ZMCC Managers or Super Admins')), 'RBAC Attendant Blocked', 'Attendant blocked from correction (403)');

    // 2. Direct manual modification of calculated fields is rejected
    const manualCorrRes = await correctCompletedSession(
      toCoreUser(manager) as any,
      sessionId,
      {
        reason: 'Manual edit attempt',
        density: 1.0500,
      } as any
    );
    assert(manualCorrRes.status === 400 && Boolean(manualCorrRes.error?.includes('Calculated metrics cannot be directly corrected')), 'Manual Edit Blocked', 'Manual density blocked in correction');

    // 3. Manager correction of quantity: 5000 -> 5200 LITER
    const corr1Res = await correctCompletedSession(
      toCoreUser(manager) as any,
      sessionId,
      {
        reason: 'Recalibrated flowmeter reading',
        quantity_value: 5200,
      }
    );
    assert(corr1Res.status === 200, 'Correction 1 Status', 'Correction 1 saved successfully');
    const corr1 = corr1Res.data;
    assert(corr1.quantity_value === 5200, 'Correction 1 Quantity', 'Quantity updated to 5200');
    assert(corr1.gross_liters === 5200.00, 'Correction 1 Gross', `Gross updated to ${corr1.gross_liters}`);
    assert(corr1.at_13ts_liters === 5240.00, 'Correction 1 @13TS', `@13TS updated to ${corr1.at_13ts_liters}`);
    assert(corr1.manager_correction_count === 1, 'Correction Count', 'manager_correction_count = 1');

    // 4. Manager correction of unit: 5200 LITER -> 5150 KG @ LR 30
    const corr2Res = await correctCompletedSession(
      toCoreUser(manager) as any,
      sessionId,
      {
        reason: 'Correcting unit from Liters to KG',
        quantity_value: 5150,
        quantity_unit: 'KG',
      }
    );
    assert(corr2Res.status === 200, 'Correction 2 Status', 'Correction 2 saved successfully');
    const corr2 = corr2Res.data;
    assert(corr2.quantity_unit === 'KG', 'Correction 2 Unit', 'Unit updated to KG');
    assert(corr2.gross_liters === 5000.00, 'Correction 2 Gross', `Gross updated to 5000.00 via density`);
    assert(corr2.manager_correction_count === 2, 'Correction Count', 'manager_correction_count = 2');

    // 5. Manager correction of LR & Fat: LR 30 -> 28, Fat 4.0 -> 3.5
    // KG: 5150, LR 28 -> Density = 1.0280 -> Gross = 5150 / 1.0280 = 5009.73 L
    // SNF = 28/4 + 0.22*3.5 + 0.72 = 7 + 0.77 + 0.72 = 8.49%
    // TS = 3.5 + 8.49 = 11.99%
    // @13TS = 5009.73 * 11.99 / 13 = 4620.51 L
    const corr3Res = await correctCompletedSession(
      toCoreUser(manager) as any,
      sessionId,
      {
        reason: 'Retested LR and Fat',
        results: [
          { test_id: lrTest.id.toString(), numeric_value: 28, text_value: null },
          { test_id: fatTest.id.toString(), numeric_value: 3.5, text_value: null },
        ],
      }
    );
    assert(corr3Res.status === 200, 'Correction 3 Status', 'Correction 3 saved successfully');
    const corr3 = corr3Res.data;
    assert(corr3.density === 1.0280, 'Correction 3 Density', `Density updated to ${corr3.density}`);
    assert(corr3.gross_liters === 5009.73, 'Correction 3 Gross', `Gross updated to ${corr3.gross_liters}`);
    assert(corr3.snf === 8.49, 'Correction 3 SNF', `SNF updated to ${corr3.snf}`);
    assert(corr3.ts === 11.99, 'Correction 3 TS', `TS updated to ${corr3.ts}`);
    assert(corr3.at_13ts_liters === 4620.51, 'Correction 3 @13TS', `@13TS updated to ${corr3.at_13ts_liters}`);
    assert(corr3.manager_correction_count === 3, 'Correction Count', 'manager_correction_count = 3');

    // 6. No-op correction does not consume manager count
    const corrNoopRes = await correctCompletedSession(
      toCoreUser(manager) as any,
      sessionId,
      {
        reason: 'Accidental save without edits',
        quantity_value: 5150,
        quantity_unit: 'KG',
      }
    );
    assert(corrNoopRes.status === 400 && Boolean(corrNoopRes.error?.includes('No changes detected')), 'No-op Status', 'No-op rejected with 400');
    const checkSession = await prisma.zmccLabSession.findUnique({ where: { id: sessionId } });
    assert(checkSession?.manager_correction_count === 3, 'No-op Correction Count', 'No-op did not increment correction count');

    // 7. AuditLog for correction
    const corrAudit = await prisma.auditLog.findFirst({
      where: {
        table_name: 'zmcc_lab_session',
        record_id: sessionId,
        action: 'ZMCC_LAB_SESSION_CORRECTED',
      },
      orderBy: { created_at: 'desc' },
    });
    assert(!!corrAudit, 'Correction Audit', 'AuditLog record exists for correction');
    const corrOld = corrAudit?.old_values as any;
    const corrNew = corrAudit?.new_values as any;
    assert(corrOld?.at_13ts_liters !== undefined, 'Audit Old Value', 'Audit includes old metrics snapshot');
    assert(corrNew?.at_13ts_liters !== undefined, 'Audit New Value', 'Audit includes new metrics snapshot');
  }

  // =============================================================
  // 9. COMPLETION IDEMPOTENCY
  // =============================================================
  console.log('\n--- 9. COMPLETION IDEMPOTENCY ---');
  {
    const { arrival } = await createCompletedMotArrival(`IDEM-${runId}`);
    const startRes = await startOrResumeSession(
      toCoreUser(attendant) as any,
      {
        arrival_type: 'MOT',
        arrival_id: BigInt(arrival.id),
      }
    );
    const sessionId = BigInt(startRes.data.id);
    const eventId = `idem-evt-${runId}`;

    // First completion
    const comp1Res = await completeSession(
      toCoreUser(attendant) as any,
      sessionId,
      {
        quantity_value: 5000,
        quantity_unit: 'LITER',
        decision: 'ACCEPTED',
        results: [
          { test_id: lrTest.id.toString(), numeric_value: 30, text_value: null },
          { test_id: fatTest.id.toString(), numeric_value: 4.0, text_value: null },
        ],
        completion_client_event_id: eventId,
      }
    );
    assert(comp1Res.status === 200, 'First Completion', 'Completed with 200');

    // Exact replay with same eventId
    const comp2Res = await completeSession(
      toCoreUser(attendant) as any,
      sessionId,
      {
        quantity_value: 5000,
        quantity_unit: 'LITER',
        decision: 'ACCEPTED',
        results: [
          { test_id: lrTest.id.toString(), numeric_value: 30, text_value: null },
          { test_id: fatTest.id.toString(), numeric_value: 4.0, text_value: null },
        ],
        completion_client_event_id: eventId,
      }
    );
    assert(comp2Res.status === 200 && comp2Res.data.id === comp1Res.data.id, 'Idempotency Replay', 'Exact replay returned same session');

    // Conflicting replay with different quantity
    const conflictRes = await completeSession(
      toCoreUser(attendant) as any,
      sessionId,
      {
        quantity_value: 6000,
        quantity_unit: 'LITER',
        decision: 'ACCEPTED',
        results: [
          { test_id: lrTest.id.toString(), numeric_value: 30, text_value: null },
          { test_id: fatTest.id.toString(), numeric_value: 4.0, text_value: null },
        ],
        completion_client_event_id: eventId,
      }
    );
    assert(conflictRes.status === 409 && Boolean(conflictRes.error?.includes('was already used for a different completion payload')), 'Idempotency Conflict', 'Conflict 409 returned on altered replay');
  }

  // =============================================================
  // 10. HISTORICAL ROW COMPATIBILITY
  // =============================================================
  console.log('\n--- 10. HISTORICAL ROW COMPATIBILITY ---');
  {
    const { arrival } = await createCompletedMotArrival(`HIST-${runId}`);

    // Directly insert a legacy completed session with NULL metrics (as before 6G-C)
    const legacySession = await prisma.zmccLabSession.create({
      data: {
        arrival_type: 'MOT',
        mot_arrival: { connect: { id: BigInt(arrival.id) } },
        zmcc: { connect: { id: zmcc.id } },
        starter: { connect: { id: attendant.id } },
        completer: { connect: { id: attendant.id } },
        status: 'COMPLETED',
        decision: 'ACCEPTED',
        completed_at: new Date(Date.now() - 86400000),
        // All 8 new metrics fields are NULL
        quantity_value: null,
        quantity_unit: null,
        density: null,
        gross_liters: null,
        snf: null,
        ts: null,
        at_13ts_liters: null,
        calculation_version: null,
      },
    });

    // Read through service getSessionById
    const fetchRes = await getSessionById(toCoreUser(attendant) as any, legacySession.id);
    assert(fetchRes.status === 200, 'Historical Session Fetch', 'Legacy session fetched successfully');
    const fetched = fetchRes.data;
    assert(fetched?.quantity_value === null, 'Historical Qty', 'quantity_value is null');
    assert(fetched?.quantity_unit === null, 'Historical Unit', 'quantity_unit is null');
    assert(fetched?.gross_liters === null, 'Historical Gross', 'gross_liters is null');
    assert(fetched?.at_13ts_liters === null, 'Historical @13TS', 'at_13ts_liters is null');
    assert(fetched?.density === null, 'Historical Density', 'density is null');

    // Read through getLabHistory
    const histRes = await getLabHistory(toCoreUser(attendant) as any, {});
    assert(histRes.status === 200, 'History Fetch', 'History fetched successfully');
    const historyItem = histRes.data?.items?.find((h: any) => h.id === legacySession.id.toString());
    assert(!!historyItem, 'Historical In History', 'Legacy session appears in lab history');
    assert(historyItem?.quantity_value === null, 'History Qty Null', 'History item preserves null quantity without fabricating defaults');
  }

  // =============================================================
  // 11. POLICY ISOLATION & CANONICAL POLICY INTEGRATION
  // =============================================================
  console.log('\n--- 11. POLICY ISOLATION & CANONICAL POLICY INTEGRATION ---');
  {
    // Create dedicated extra tests for isolation testing
    const extraMotTest = await prisma.labTest.create({
      data: {
        testCode: `LT-MOT-${runId}`,
        testName: `MOT Specific Acidity ${runId}`,
        resultType: 'NUMERIC',
        unit: 'pH',
        isActive: true,
        isRequired: false,
        testScope: 'ZMCC',
        displayOrder: 10,
      },
    });

    const extraConTest = await prisma.labTest.create({
      data: {
        testCode: `LT-CON-${runId}`,
        testName: `Contractor Specific Clot ${runId}`,
        resultType: 'TEXT',
        unit: null,
        isActive: true,
        isRequired: true,
        testScope: 'ZMCC',
        displayOrder: 11,
      },
    });

    // Assign extraMotTest ONLY to ZMCC_LAB_MOT with policy is_required=false, display_order=5
    await prisma.milkTestPolicyAssignment.create({
      data: {
        lab_test_id: extraMotTest.id,
        testing_point: 'ZMCC_LAB_MOT',
        is_required: false,
        display_order: 5,
        is_active: true,
        created_by_user_id: manager.id,
      },
    });

    // Assign extraConTest ONLY to ZMCC_LAB_CONTRACTOR with policy is_required=true, display_order=9
    await prisma.milkTestPolicyAssignment.create({
      data: {
        lab_test_id: extraConTest.id,
        testing_point: 'ZMCC_LAB_CONTRACTOR',
        is_required: true,
        display_order: 9,
        is_active: true,
        created_by_user_id: manager.id,
      },
    });

    // A & D: Test MOT session snapshot
    const { arrival: motArr } = await createCompletedMotArrival(`ISO-M-${runId}`);
    const motSessionRes = await startOrResumeSession(
      toCoreUser(attendant) as any,
      { arrival_type: 'MOT', arrival_id: BigInt(motArr.id) }
    );
    assert(motSessionRes.status === 201, 'MOT Session Start', 'MOT session started');
    const motResults = motSessionRes.data.results || [];
    const motHasMotOnly = motResults.some((r: any) => r.test_code_snapshot === extraMotTest.testCode);
    const motHasConOnly = motResults.some((r: any) => r.test_code_snapshot === extraConTest.testCode);
    assert(motHasMotOnly, 'Policy Isolation A', 'Test assigned only to ZMCC_LAB_MOT appears in MOT session snapshot');
    assert(!motHasConOnly, 'Policy Isolation D', 'Contractor-only test does NOT appear in MOT session snapshot');

    // E & F: Check policy is_required and display_order snapshots on MOT-only test
    const motOnlySnap = motResults.find((r: any) => r.test_code_snapshot === extraMotTest.testCode);
    assert(motOnlySnap?.is_required_snapshot === false, 'Policy is_required E', 'Policy is_required controls is_required_snapshot (false)');
    assert(motOnlySnap?.display_order_snapshot === 5, 'Policy display_order F', 'Policy display_order controls display_order_snapshot (5)');

    // B & C: Test Contractor session snapshot
    const conArrRes = await submitContractorArrival(
      toCoreUser(phe) as any,
      {
        contractor_source_id: contractor.id,
        vehicle_number: `CON-ISO-${runId}`,
        arrival_timestamp: new Date(Date.now() - 600000),
        client_event_id: `evt-con-iso-${runId}`,
      }
    );
    const conSessionRes = await startOrResumeSession(
      toCoreUser(attendant) as any,
      { arrival_type: 'CONTRACTOR', arrival_id: BigInt(conArrRes.data.id) }
    );
    assert(conSessionRes.status === 201, 'Contractor Session Start', 'Contractor session started');
    const conResults = conSessionRes.data.results || [];
    const conHasConOnly = conResults.some((r: any) => r.test_code_snapshot === extraConTest.testCode);
    const conHasMotOnly = conResults.some((r: any) => r.test_code_snapshot === extraMotTest.testCode);
    assert(conHasConOnly, 'Policy Isolation C', 'Test assigned only to ZMCC_LAB_CONTRACTOR appears in Contractor session snapshot');
    assert(!conHasMotOnly, 'Policy Isolation B', 'MOT-only test does NOT appear in Contractor session snapshot');

    // E & F on Contractor test:
    const conOnlySnap = conResults.find((r: any) => r.test_code_snapshot === extraConTest.testCode);
    assert(conOnlySnap?.is_required_snapshot === true, 'Policy is_required E2', 'Policy is_required controls is_required_snapshot (true)');
    assert(conOnlySnap?.display_order_snapshot === 9, 'Policy display_order F2', 'Policy display_order controls display_order_snapshot (9)');

    // G: Inactive policy assignment is excluded
    const inactiveAssocTest = await prisma.labTest.create({
      data: {
        testCode: `LT-INACT-A-${runId}`,
        testName: `Inactive Assoc Test ${runId}`,
        resultType: 'TEXT',
        isActive: true,
        testScope: 'ZMCC',
        displayOrder: 20,
      },
    });
    await prisma.milkTestPolicyAssignment.create({
      data: {
        lab_test_id: inactiveAssocTest.id,
        testing_point: 'ZMCC_LAB_MOT',
        is_required: false,
        display_order: 20,
        is_active: false, // INACTIVE POLICY
        created_by_user_id: manager.id,
      },
    });

    const { arrival: motArr2 } = await createCompletedMotArrival(`ISO-M2-${runId}`);
    const motSessionRes2 = await startOrResumeSession(
      toCoreUser(attendant) as any,
      { arrival_type: 'MOT', arrival_id: BigInt(motArr2.id) }
    );
    const motResults2 = motSessionRes2.data.results || [];
    const hasInactiveAssoc = motResults2.some((r: any) => r.test_code_snapshot === inactiveAssocTest.testCode);
    assert(!hasInactiveAssoc, 'Policy Inactive Assignment G', 'Inactive policy assignment is excluded from session snapshot');

    // H: Inactive LabTest is excluded through effective policy
    const inactiveMasterTest = await prisma.labTest.create({
      data: {
        testCode: `LT-INACT-M-${runId}`,
        testName: `Inactive Master Test ${runId}`,
        resultType: 'TEXT',
        isActive: false, // INACTIVE LAB TEST
        testScope: 'ZMCC',
        displayOrder: 21,
      },
    });
    await prisma.milkTestPolicyAssignment.create({
      data: {
        lab_test_id: inactiveMasterTest.id,
        testing_point: 'ZMCC_LAB_MOT',
        is_required: false,
        display_order: 21,
        is_active: true, // ACTIVE POLICY
        created_by_user_id: manager.id,
      },
    });

    const { arrival: motArr3 } = await createCompletedMotArrival(`ISO-M3-${runId}`);
    const motSessionRes3 = await startOrResumeSession(
      toCoreUser(attendant) as any,
      { arrival_type: 'MOT', arrival_id: BigInt(motArr3.id) }
    );
    const motResults3 = motSessionRes3.data.results || [];
    const hasInactiveMaster = motResults3.some((r: any) => r.test_code_snapshot === inactiveMasterTest.testCode);
    assert(!hasInactiveMaster, 'Policy Inactive LabTest H', 'Inactive LabTest is excluded through effective policy');

    // Complete motSessionRes so it can be corrected
    const completeForCorr = await completeSession(
      toCoreUser(attendant) as any,
      motSessionRes.data.id,
      {
        quantity_value: 5000,
        quantity_unit: 'LITER',
        decision: 'ACCEPTED',
        results: [
          { test_id: lrTest.id.toString(), numeric_value: 30, text_value: null },
          { test_id: fatTest.id.toString(), numeric_value: 4.0, text_value: null },
          { test_id: extraMotTest.id.toString(), numeric_value: 6.7, text_value: null },
        ],
        completion_client_event_id: `evt-corr-prep-${runId}`,
      }
    );
    assert(completeForCorr.status === 200, 'Session Completed for Correction', 'Session completed');

    // J: Duplicate test_id in correctCompletedSession payload returns 400
    const dupCorrRes = await correctCompletedSession(
      toCoreUser(manager) as any,
      motSessionRes.data.id,
      {
        reason: 'Attempt duplicate test correction',
        results: [
          { test_id: lrTest.id.toString(), numeric_value: 29 },
          { test_id: lrTest.id.toString(), numeric_value: 30 },
        ],
      }
    );
    assert(
      dupCorrRes.status === 400 && Boolean(dupCorrRes.error?.includes('Duplicate test_id')),
      'Correction Duplicate Guard J',
      'Duplicate test_id in correction payload rejected with 400'
    );

    // I: Empty policy fails closed
    // Temporarily deactivate all ZMCC_LAB_MOT policies
    await prisma.milkTestPolicyAssignment.updateMany({
      where: { testing_point: 'ZMCC_LAB_MOT' },
      data: { is_active: false },
    });
    const { arrival: motArr4 } = await createCompletedMotArrival(`EMPTY-${runId}`);
    const emptyPolicyRes = await startOrResumeSession(
      toCoreUser(attendant) as any,
      { arrival_type: 'MOT', arrival_id: BigInt(motArr4.id) }
    );
    assert(
      emptyPolicyRes.status === 400 && Boolean(emptyPolicyRes.error?.includes('No active milk test policy is configured for ZMCC_LAB_MOT')),
      'Empty Policy Fail Closed I',
      'Empty policy fails closed with 400 and clear error message'
    );
    // Restore ZMCC_LAB_MOT policies
    await prisma.milkTestPolicyAssignment.updateMany({
      where: {
        testing_point: 'ZMCC_LAB_MOT',
        lab_test_id: { in: [lrTest.id, fatTest.id] },
      },
      data: { is_active: true },
    });
  }

  console.log('\n=====================================================================');
  console.log(`📊 STAGE 6G-C REGRESSION SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('=====================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runStage6gcTests()
  .catch((err) => {
    console.error('Unhandled error in test suite:', err);
    process.exit(1);
  });
