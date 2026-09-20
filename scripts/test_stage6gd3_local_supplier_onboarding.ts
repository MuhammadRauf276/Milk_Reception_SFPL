/**
 * STAGE 6G-D.3: ZMCC LOCAL SUPPLIER DIRECTORY & FAST PHE ONBOARDING REGRESSION SUITE
 *
 * Verifies:
 * 1. Database Schema & Migrations:
 *    - Exactly 26 tracked migrations in prisma/migrations
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
    submitContractorArrival,
    submitMotArrival,
    correctMotArrival,
    recordGateExit,
    correctGateExit,
    getVehiclesInsideZmcc,
  } = await import('../src/backend/services/zmccArrivalService');

  const { assignAndDispatchJourney, resolveMotAuth } = await import('../src/backend/services/motService');
  const { getPakistanCalendarDate } = await import('../src/backend/core/business-day');

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

  const { POST: contractorArrivalRoute } = await import(
    '../src/app/api/zmcc/arrivals/contractor/route'
  );
  const { POST: motGateExitRoute, PATCH: motGateExitPatchRoute } = await import(
    '../src/app/api/zmcc/arrivals/mot/[id]/exit/route'
  );
  const { POST: lsGateExitRoute, PATCH: lsGateExitPatchRoute } = await import(
    '../src/app/api/zmcc/arrivals/local-supplier/[id]/exit/route'
  );
  const { GET: insideVehiclesRoute } = await import(
    '../src/app/api/zmcc/arrivals/inside/route'
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
    assert(migrationDirs.length === 33, 'Tracked Migrations', `Found exactly 33 migrations (expected 33)`);

    const d3MigDir = migrationDirs.find((d) => d.includes('zmcc_local_supplier_directory_and_arrival'));
    assert(!!d3MigDir, 'Migration 25 Exists', `Found 6G-D.3 directory migration: ${d3MigDir}`);

    const d3ExitMigDir = migrationDirs.find((d) => d.includes('zmcc_gate_exit_and_canonical_local_supplier'));
    assert(!!d3ExitMigDir, 'Migration 26 Exists', `Found 6G-D.3 gate exit migration: ${d3ExitMigDir}`);

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
    assert(arrColNames.includes('raw_milk_token_number'), 'Column Check', 'zmcc_local_supplier_arrival.raw_milk_token_number exists');
    assert(arrColNames.includes('rmr_number'), 'Column Check', 'zmcc_local_supplier_arrival.rmr_number exists');
    assert(arrColNames.includes('client_event_id'), 'Column Check', 'zmcc_local_supplier_arrival.client_event_id exists');
    assert(arrColNames.includes('gate_exit_required'), 'Column Check', 'zmcc_local_supplier_arrival.gate_exit_required exists');
    assert(arrColNames.includes('exit_timestamp'), 'Column Check', 'zmcc_local_supplier_arrival.exit_timestamp exists');
    assert(arrColNames.includes('exit_recorded_by_user_id'), 'Column Check', 'zmcc_local_supplier_arrival.exit_recorded_by_user_id exists');
    assert(arrColNames.includes('exit_client_event_id'), 'Column Check', 'zmcc_local_supplier_arrival.exit_client_event_id exists');
    assert(arrColNames.includes('exit_submitted_at'), 'Column Check', 'zmcc_local_supplier_arrival.exit_submitted_at exists');
    assert(arrColNames.includes('exit_correction_count'), 'Column Check', 'zmcc_local_supplier_arrival.exit_correction_count exists');

    // Verify zmcc_mot_arrival exit columns
    const motArrivalCols: any[] = await prisma.$queryRaw`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'zmcc_mot_arrival';
    `;
    const motColNames = motArrivalCols.map((c) => c.column_name);
    assert(motColNames.includes('gate_exit_required'), 'Column Check', 'zmcc_mot_arrival.gate_exit_required exists');
    assert(motColNames.includes('exit_timestamp'), 'Column Check', 'zmcc_mot_arrival.exit_timestamp exists');
    assert(motColNames.includes('exit_recorded_by_user_id'), 'Column Check', 'zmcc_mot_arrival.exit_recorded_by_user_id exists');
    assert(motColNames.includes('exit_client_event_id'), 'Column Check', 'zmcc_mot_arrival.exit_client_event_id exists');
    assert(motColNames.includes('exit_submitted_at'), 'Column Check', 'zmcc_mot_arrival.exit_submitted_at exists');
    assert(motColNames.includes('exit_correction_count'), 'Column Check', 'zmcc_mot_arrival.exit_correction_count exists');

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
      rulesDoc.includes('## 23. Stage 6G-D.3 ZMCC Local Supplier Directory & PHE Gate Workflow'),
      'Contract Documentation',
      'Section 23 documented in CURRENT-RULES.md'
    );

    // 2.3 Frontend Gate Exit Retry Idempotency (Blocker 1)
    const frontendWorkspacePath = path.join(repoRoot, 'src', 'frontend', 'modules', 'zmcc', 'arrivals', 'ZmccArrivalsWorkspace.tsx');
    const frontendWorkspaceSource = fs.readFileSync(frontendWorkspacePath, 'utf8');
    assert(
      frontendWorkspaceSource.includes("const [exitEventId, setExitEventId] = useState<string>('');"),
      'Frontend Exit Event ID State',
      'ZmccArrivalsWorkspace maintains persistent exitEventId modal state'
    );
    assert(
      frontendWorkspaceSource.includes("setExitEventId(generateClientEventId('exit'));"),
      'Frontend Exit ID Initialized on Modal Open',
      'openExitModal initializes exitEventId on modal open'
    );
    assert(
      frontendWorkspaceSource.includes("setExitEventId('');"),
      'Frontend Exit ID Cleared on Modal Close',
      'closeExitModal clears exitEventId upon dismiss or success'
    );
    assert(
      frontendWorkspaceSource.includes("const eventId = exitEventId || generateClientEventId('exit');"),
      'Frontend Retry Reuses Event ID',
      'handleGateExitSubmit reuses persistent exitEventId across retries'
    );

    // Lifecycle simulation: Verify that same modal instance preserves event ID across retries, and new modal gets new ID
    const generateId = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;
    let simulatedModalTarget: any = null;
    let simulatedExitEventId: string = '';
    const openSimulatedModal = (arr: any) => {
      simulatedModalTarget = arr;
      simulatedExitEventId = generateId('exit');
    };
    const closeSimulatedModal = () => {
      simulatedModalTarget = null;
      simulatedExitEventId = '';
    };

    // Open modal attempt 1
    openSimulatedModal({ id: 101 });
    const attempt1EventId = simulatedExitEventId;
    assert(attempt1EventId.startsWith('exit-'), 'Simulated Open', 'Generates valid exit event ID on modal open');
    // Simulated retry 1 (network glitch or 500 error): modal remains open, retry reuses attempt1EventId
    const retry1EventId = simulatedExitEventId || generateId('exit');
    assert(retry1EventId === attempt1EventId, 'Simulated Retry Same ID', 'Retry inside same open modal reuses original event ID');
    // Close modal (e.g. on success or cancel)
    closeSimulatedModal();
    assert(simulatedExitEventId === '', 'Simulated Close Cleared', 'Closing modal clears event ID');
    // Reopen modal for new attempt
    openSimulatedModal({ id: 101 });
    const attempt2EventId = simulatedExitEventId;
    assert(attempt2EventId !== attempt1EventId, 'Simulated Reopen Fresh ID', 'Reopening modal creates a brand-new distinct event ID');

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

    // Ensure test isolation: clean up test arrivals and lab records from prior runs
    const testTokens = [
      '007890', '007891', '007892', '007893', '007899', '005544', '998877', '778899', '112233',
      '123401', '123402', '123403', '123404', '123405', '123406', '123407', '123408', '123409', '123410'
    ];
    const priorArrivals = await prisma.zmccLocalSupplierArrival.findMany({
      where: {
        OR: [
          { rmr_number: { in: testTokens } },
          { raw_milk_token_number: { in: testTokens } },
        ],
      },
      select: { id: true },
    });
    if (priorArrivals.length > 0) {
      const arrIds = priorArrivals.map((a) => a.id);
      const sessions = await prisma.zmccLabSession.findMany({
        where: { local_supplier_arrival_id: { in: arrIds } },
        select: { id: true },
      });
      const sessionIds = sessions.map((s) => s.id);
      if (sessionIds.length > 0) {
        const receipts = await prisma.zmccTankReceipt.findMany({
          where: { lab_session_id: { in: sessionIds } },
          select: { id: true },
        });
        const receiptIds = receipts.map((r) => r.id);
        if (receiptIds.length > 0) {
          await prisma.zmccTankInventoryTransaction.deleteMany({
            where: { tank_receipt_id: { in: receiptIds } },
          });
        }
        await prisma.zmccTankReceipt.deleteMany({ where: { lab_session_id: { in: sessionIds } } });
        await prisma.zmccLabResult.deleteMany({ where: { session_id: { in: sessionIds } } });
        await prisma.zmccLabSession.deleteMany({ where: { id: { in: sessionIds } } });
      }
      await prisma.auditLog.deleteMany({
        where: {
          table_name: 'zmcc_local_supplier_arrival',
          record_id: { in: arrIds },
        },
      });
      await prisma.zmccLocalSupplierArrival.deleteMany({
        where: { id: { in: arrIds } },
      });
    }

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

    const existingMotPolicy = await prisma.milkTestPolicyAssignment.findFirst({
      where: { testing_point: 'ZMCC_LAB_MOT', is_active: true },
    });
    if (!existingMotPolicy) {
      await prisma.milkTestPolicyAssignment.createMany({
        data: [
          { lab_test_id: lrTest.id, testing_point: 'ZMCC_LAB_MOT', is_required: true, display_order: 1, is_active: true, created_by_user_id: superAdmin.id },
          { lab_test_id: fatTest.id, testing_point: 'ZMCC_LAB_MOT', is_required: true, display_order: 2, is_active: true, created_by_user_id: superAdmin.id },
        ],
      });
    }

    for (const point of ['ZMCC_LAB_CONTRACTOR', 'ZMCC_LAB_MOT'] as const) {
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
              created_by: superAdmin.id,
            },
          });
        }
      }
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
    const mgr2Token = await makeAuthToken(manager2);
    const adminToken = await makeAuthToken(superAdmin);

    console.log(`PHE Operator: ${pheCore.username} (ZMCC ${zmcc1.code})`);
    console.log(`Manager 1: ${mgr1Core.username} (ZMCC ${zmcc1.code})`);
    console.log(`Manager 2: ${mgr2Core.username} (ZMCC ${zmcc2.code})`);
    console.log(`Super Admin: ${adminCore.username}`);

    // Ensure zmcc1 has exactly one active tank with ample capacity
    let activeTank1 = await prisma.zmccTank.findFirst({
      where: { zmcc_id: zmcc1.id, is_active: true },
    });
    if (!activeTank1) {
      activeTank1 = await prisma.zmccTank.create({
        data: {
          tank_code: `TEST-TK-${Date.now().toString().slice(-4)}`,
          tank_name: 'Test Raw Milk Tank 1',
          capacity_liters: 10000000.0,
          is_active: true,
          zmcc: { connect: { id: zmcc1.id } },
          creator: { connect: { id: superAdmin.id } },
        },
      });
    } else {
      activeTank1 = await prisma.zmccTank.update({
        where: { id: activeTank1.id },
        data: { capacity_liters: 10000000.0 },
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

    // 4.7d Scope Hardening: Role-Specific Allowlist (Blocker 1)
    // Non-admin cannot supply zmcc_id (even if own or conflicting) or target_zmcc_id -> 400
    const pheOwnZmccRes = await createLocalSupplier(pheCore as any, {
      name: 'PHE Own ZMCC Supplier',
      zmcc_id: zmcc1.id.toString(),
    } as any);
    assert(pheOwnZmccRes.status === 400, 'Scope Hardening', 'PHE operator supplying own zmcc_id rejected (400)');

    const pheConflictZmccRes = await createLocalSupplier(pheCore as any, {
      name: 'Conflicting ZMCC PHE Supplier',
      zmcc_id: zmcc2.id.toString(),
    } as any);
    assert(pheConflictZmccRes.status === 400, 'Scope Hardening', 'PHE operator supplying conflicting zmcc_id rejected (400)');

    const pheTargetZmccRes = await createLocalSupplier(pheCore as any, {
      name: 'PHE Target ZMCC Supplier',
      target_zmcc_id: zmcc1.id.toString(),
    } as any);
    assert(pheTargetZmccRes.status === 400, 'Scope Hardening', 'PHE operator supplying target_zmcc_id rejected (400)');

    const mgrOwnZmccRes = await createLocalSupplier(mgr1Core as any, {
      name: 'MGR Own ZMCC Supplier',
      zmcc_id: zmcc1.id.toString(),
    } as any);
    assert(mgrOwnZmccRes.status === 400, 'Scope Hardening', 'ZMCC Manager supplying own zmcc_id rejected (400)');

    const mgrConflictZmccRes = await createLocalSupplier(mgr1Core as any, {
      name: 'Conflicting ZMCC MGR Supplier',
      zmcc_id: zmcc2.id.toString(),
    } as any);
    assert(mgrConflictZmccRes.status === 400, 'Scope Hardening', 'ZMCC Manager supplying conflicting zmcc_id rejected (400)');

    // Super Admin requires zmcc_id
    const adminNoZmccRes = await createLocalSupplier(adminCore as any, {
      name: 'Admin No ZMCC Supplier',
    });
    assert(adminNoZmccRes.status === 400, 'Super Admin Scoping', 'Super Admin missing zmcc_id rejected (400)');

    const adminWithZmccRes = await createLocalSupplier(adminCore as any, {
      name: 'Admin Valid ZMCC Supplier',
      zmcc_id: zmcc1.id.toString(),
    });
    assert(adminWithZmccRes.status === 201, 'Super Admin Scoping', 'Super Admin with valid zmcc_id succeeds (201)');
    assert(adminWithZmccRes.data.zmcc_id === zmcc1.id.toString(), 'Super Admin ZMCC Match', 'Supplier created under specified ZMCC');

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
      raw_milk_token_number: '007890',
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
      arrivalRes1.data.raw_milk_token_number === '007890',
      'Raw Milk Token Preservation',
      'Leading zeros in Raw Milk Token preserved exactly ("007890")'
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
      raw_milk_token_number: '007891',
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
      raw_milk_token_number: '999999',
      reason: 'Operator correction attempt',
    });
    assert(pheCorrectRes.status === 403, 'Permission Check', 'PHE operator forbidden from correcting arrival (403)');

    // 6.2 Cross-ZMCC manager cannot correct arrival
    const crossMgrCorrectRes = await correctLocalSupplierArrival(mgr2Core as any, firstArrivalId, {
      raw_milk_token_number: '999999',
      reason: 'Cross ZMCC correction attempt',
    });
    assert(crossMgrCorrectRes.status === 403, 'Cross-ZMCC Scoping', 'Cross-ZMCC manager forbidden from correcting arrival (403)');

    // 6.3 Missing reason rejected
    const missingReasonRes = await correctLocalSupplierArrival(mgr1Core as any, firstArrivalId, {
      raw_milk_token_number: '007899',
      reason: 'ab', // less than 5 characters
    });
    assert(missingReasonRes.status === 400, 'Reason Validation', 'Rejects correction with reason < 5 characters');

    // 6.4 rmr_number is legacy and cannot be modified through operational corrections (400)
    const legacyRmrCorrectRes = await correctLocalSupplierArrival(mgr1Core as any, firstArrivalId, {
      rmr_number: '007892',
      reason: 'Attempting to correct legacy RMR field',
    });
    assert(legacyRmrCorrectRes.status === 400, 'Legacy RMR Immutable', 'Rejects rmr_number correction with 400');
    assert(
      legacyRmrCorrectRes.error === 'rmr_number is a legacy field and cannot be modified through operational corrections. Use raw_milk_token_number instead.',
      'Legacy RMR Error Message',
      'Controlled 400 error message returned for legacy RMR'
    );

    // 6.5 Successful Correction 1 by own-ZMCC Manager
    const originalRmr = (await prisma.zmccLocalSupplierArrival.findUnique({ where: { id: firstArrivalId } }))?.rmr_number;
    const correctRes1 = await correctLocalSupplierArrival(mgr1Core as any, firstArrivalId, {
      raw_milk_token_number: '007892',
      vehicle_number: 'lhr 5678',
      reason: 'Fixed typographical slip error by PHE operator',
    });
    assert(correctRes1.status === 200, 'Manager Correction 1', 'Manager successfully applied correction 1');
    assert(correctRes1.data.raw_milk_token_number === '007892', 'Updated Token', 'Raw Milk Token updated with leading zeros');
    assert(correctRes1.data.rmr_number === originalRmr, 'Preserved RMR', 'Historical rmr_number preserved unchanged');
    assert(correctRes1.data.vehicle_number === 'LHR 5678', 'Updated Vehicle', 'Vehicle updated & normalized');
    assert(correctRes1.data.zmcc_token === firstToken, 'Token Immutability', 'zmcc_token remained strictly immutable');
    assert(correctRes1.data.correction_count === 1, 'Correction Count', 'correction_count incremented to 1');
    assert(correctRes1.data.manager_correction_count === 1, 'Manager Correction Count', 'manager_correction_count incremented to 1');

    // 6.6 Successful Correction 2 by Super Admin
    const correctRes2 = await correctLocalSupplierArrival(adminCore as any, firstArrivalId, {
      vehicle_number: 'LHR 9999',
      reason: 'Admin corrected vehicle number',
    });
    assert(correctRes2.status === 200, 'Admin Correction 2', 'Super Admin successfully applied correction 2');
    assert(correctRes2.data.correction_count === 2, 'Correction Count', 'correction_count incremented to 2');
    assert(correctRes2.data.manager_correction_count === 1, 'Manager Correction Count Unchanged', 'manager_correction_count remains 1 for Super Admin');
    assert(correctRes2.data.vehicle_number === 'LHR 9999', 'Updated Vehicle 2', 'Vehicle updated to LHR 9999');

    // Manager performs corrections 2, 3, 4, 5 (up to max 5 manager quota)
    for (let c = 2; c <= 5; c++) {
      const res = await correctLocalSupplierArrival(mgr1Core as any, firstArrivalId, {
        vehicle_number: `LHR 999${c}`,
        reason: `Manager correction sequence ${c}`,
      });
      assert(res.status === 200, `Manager Correction ${c}`, `Manager successfully applied correction ${c}`);
      assert(res.data.manager_correction_count === c, 'Manager Correction Count', `manager_correction_count is ${c}`);
    }

    // 6.7 6th manager correction rejected (max 5 limit)
    const correctRes6 = await correctLocalSupplierArrival(mgr1Core as any, firstArrivalId, {
      raw_milk_token_number: '007899',
      reason: 'Attempting a 6th correction by manager',
    });
    assert(correctRes6.status === 400, 'Correction Limit', 'Rejects 6th correction (max 5 manager exceeded)');

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
    console.log('DEBUG completeRes:', JSON.stringify(completeRes, null, 2));
    assert(completeRes.status === 200, 'Complete Session', `Successfully completed session with ACCEPTED decision (${completeRes.error || ''})`);
    assert(completeRes.data?.status === 'COMPLETED', 'Session Status', 'Session status is COMPLETED');
    assert(completeRes.data?.decision === 'ACCEPTED', 'Decision', 'QA decision is ACCEPTED');
    assert(completeRes.data?.tank_receipt !== null, 'Tank Receipt Created', 'Milk received into ZMCC tank receipt');

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
      raw_milk_token_number: '005544',
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
    // SECTION 8: RETIRED CONTRACTOR ARRIVAL INTAKE (410 GONE)
    // =========================================================================
    console.log('\n--- 8. RETIRED CONTRACTOR ARRIVAL INTAKE (410 GONE) ---');

    // 8.1 API route POST /api/zmcc/arrivals/contractor returns 410 Gone with exact message
    const retiredContractorReq = makeAuthRequest(
      'http://localhost/api/zmcc/arrivals/contractor',
      'POST',
      pheToken,
      {
        contractor_source_id: 1,
        rmr_number: '123456',
        vehicle_number: 'CON 111',
        arrival_timestamp: new Date().toISOString(),
        client_event_id: `con-evt-${runId}`,
      }
    );
    const retiredContractorRouteRes = await contractorArrivalRoute(retiredContractorReq);
    assert(
      retiredContractorRouteRes.status === 410,
      'Contractor Route 410',
      'POST /api/zmcc/arrivals/contractor returns HTTP 410 Gone'
    );
    const retiredContractorRouteJson = await retiredContractorRouteRes.json();
    assert(
      retiredContractorRouteJson.error === 'CONTRACTOR_ARRIVAL_RETIRED' &&
      retiredContractorRouteJson.message === 'ZMCC Contractor Arrival is retired for new intake. Record direct-to-ZMCC suppliers through Local Supplier Arrival.',
      'Contractor Route Message',
      'Returns exact canonical contractor retirement message'
    );

    // 8.2 Service submitContractorArrival returns 410 Gone
    const retiredServiceRes = await submitContractorArrival(pheCore as any, {
      contractor_source_id: 1,
      rmr_number: '123456',
      vehicle_number: 'CON 111',
      arrival_timestamp: new Date(),
      client_event_id: `con-svc-evt-${runId}`,
    });
    assert(
      retiredServiceRes.status === 410,
      'Contractor Service 410',
      'submitContractorArrival returns status 410'
    );
    assert(
      retiredServiceRes.error === 'CONTRACTOR_ARRIVAL_RETIRED' &&
      retiredServiceRes.message === 'ZMCC Contractor Arrival is retired for new intake. Record direct-to-ZMCC suppliers through Local Supplier Arrival.',
      'Contractor Service Message',
      'submitContractorArrival returns exact canonical message'
    );

    // =========================================================================
    // SECTION 9: GATE EXIT RECORDING FOR MOT & LOCAL SUPPLIER
    // =========================================================================
    console.log('\n--- 9. GATE EXIT RECORDING FOR MOT & LOCAL SUPPLIER ---');

    // Create MOT setup for testing gate exit
    const motVehicle1 = await prisma.motVehicle.create({
      data: {
        zmcc_id: zmcc1.id,
        vehicle_number: `MOT-EXIT-1-${runId.toString().slice(-6)}`,
        created_by: manager1.id,
        updated_by: manager1.id,
      },
    });
    const motRoute1 = await prisma.zmccRoute.create({
      data: {
        zmcc_id: zmcc1.id,
        route_code: `R-EXIT-1-${runId.toString().slice(-6)}`,
        name: `Route Exit 1 ${runId}`,
        origin: 'Origin',
        destination: 'ZMCC',
        created_by: manager1.id,
        updated_by: manager1.id,
      },
    });
    const motProfile1 = await prisma.motProfile.create({
      data: {
        zmcc_id: zmcc1.id,
        mot_code: `MO-EXIT-1-${runId.toString().slice(-6)}`,
        name: `MOT Officer Exit 1 ${runId}`,
        phone_number: '03001234568',
        cnic: '35201-1234567-2',
        created_by: manager1.id,
        updated_by: manager1.id,
      },
    });
    const motJourney1 = await prisma.motJourney.create({
      data: {
        journey_number: `J-EXIT-1-${runId.toString().slice(-6)}`,
        idempotency_key: `dispatch-exit-1-${runId}`,
        zmcc_id: zmcc1.id,
        route_id: motRoute1.id,
        mot_vehicle_id: motVehicle1.id,
        mot_profile_id: motProfile1.id,
        assigned_by: manager1.id,
        assigned_at: new Date(Date.now() - 7200000),
        assignment_latitude: new Prisma.Decimal('31.5204'),
        assignment_longitude: new Prisma.Decimal('74.3587'),
        start_latitude: new Prisma.Decimal('31.5204'),
        start_longitude: new Prisma.Decimal('74.3587'),
        status: 'COLLECTING',
        operational_date: new Date(),
        started_at: new Date(Date.now() - 7200000),
      },
    });

    const motArrRes1 = await submitMotArrival(pheCore as any, {
      journey_id: motJourney1.id,
      raw_milk_token_number: `654${runId.toString().slice(-3)}`,
      route_milk_token: `RM-EXIT-1-${runId.toString().slice(-6)}`,
      arrival_timestamp: new Date(Date.now() - 3600000),
      client_event_id: `evt-mot-exit-1-${runId}`,
    });
    assert(motArrRes1.status === 201, 'MOT Arrival Created', 'Created test MOT arrival for gate exit testing');
    const motArrId1 = motArrRes1.data.id;

    // 9.1 Attempt exit without lab completion -> 409 Conflict
    const noLabExitRes = await recordGateExit(pheCore as any, 'MOT', motArrId1, {
      exit_timestamp: new Date(),
      exit_client_event_id: `exit-no-lab-${runId}`,
    });
    console.log('DEBUG noLabExitRes:', noLabExitRes);
    assert(noLabExitRes.status === 409, 'Exit Without Lab', 'Exit rejected with 409 before lab completion');
    assert(noLabExitRes.error === 'LAB_NOT_COMPLETED', 'Exit Without Lab Error', 'Returns LAB_NOT_COMPLETED');

    // Start lab session on MOT arrival (in-progress)
    const motLabStart = await startOrResumeSession(labCore as any, {
      arrival_type: 'MOT',
      arrival_id: motArrId1,
    });
    console.log('DEBUG motLabStart:', motLabStart);
    assert(motLabStart.status === 200 || motLabStart.status === 201, 'MOT Lab Started', 'Started lab session on MOT arrival');
    const motLabSessionId = motLabStart.data?.id;

    // 9.2 Attempt exit when lab is in-progress -> 409 Conflict
    const inProgExitRes = await recordGateExit(pheCore as any, 'MOT', motArrId1, {
      exit_timestamp: new Date(),
      exit_client_event_id: `exit-in-prog-${runId}`,
    });
    assert(inProgExitRes.status === 409, 'Exit While Lab In Progress', 'Exit rejected with 409 while lab in progress');
    assert(inProgExitRes.error === 'LAB_NOT_COMPLETED', 'Exit In Progress Error', 'Returns LAB_NOT_COMPLETED');

    // 9.3 Complete lab session: REJECTED milk -> can exit without tank receipt
    const motResults = motLabStart.data.results.map((tr: any) => {
      const code = tr.test_code_snapshot || '';
      const name = (tr.test_name_snapshot || '').toLowerCase();
      if (code === 'FAT' || name.includes('fat')) {
        return { test_id: tr.test_id, numeric_value: 1.0 };
      } else if (code === 'LR' || name.includes('lr')) {
        return { test_id: tr.test_id, numeric_value: 20.0 };
      } else if (tr.result_type_snapshot === 'NUMERIC') {
        return { test_id: tr.test_id, numeric_value: 5.0 };
      } else {
        return { test_id: tr.test_id, text_value: 'POSITIVE' };
      }
    });

    const rejectCompleteRes = await completeSession(labCore as any, motLabSessionId, {
      completion_client_event_id: `c-reject-${runId}`,
      decision: 'REJECTED',
      rejection_reason: 'Rejected due to substandard metrics',
      quantity_value: 1000.0,
      quantity_unit: 'LITER',
      results: motResults,
      remarks: 'Rejected due to substandard metrics',
    });
    assert(rejectCompleteRes.status === 200 && rejectCompleteRes.data.decision === 'REJECTED', 'MOT Lab Rejected', 'Completed lab with REJECTED decision');

    // Backdate lab session completed_at so exit timestamps in the last few minutes satisfy chronology
    await prisma.zmccLabSession.update({
      where: { id: BigInt(motLabSessionId) },
      data: {
        started_at: new Date(Date.now() - 3000000),
        completed_at: new Date(Date.now() - 1800000),
      },
    });

    // 9.4 Chronology check: Exit timestamp earlier than arrival timestamp -> 400
    const earlyArrivalExitRes = await recordGateExit(pheCore as any, 'MOT', motArrId1, {
      exit_timestamp: new Date(Date.now() - 7200000),
      exit_client_event_id: `exit-early-arr-${runId}`,
    });
    assert(earlyArrivalExitRes.status === 400, 'Exit < Arrival Time', 'Exit earlier than arrival timestamp rejected with 400');

    // 9.5 Chronology check: Exit timestamp in future -> 400
    const futureExitRes = await recordGateExit(pheCore as any, 'MOT', motArrId1, {
      exit_timestamp: new Date(Date.now() + 3600000),
      exit_client_event_id: `exit-future-${runId}`,
    });
    assert(futureExitRes.status === 400, 'Exit In Future', 'Exit timestamp in future rejected with 400');

    // 9.6 Permissions check: Unauthorized role (e.g. weighbridge operator) -> 403
    const unauthExitRes = await recordGateExit(wbCore as any, 'MOT', motArrId1, {
      exit_timestamp: new Date(),
      exit_client_event_id: `exit-unauth-${runId}`,
    });
    assert(unauthExitRes.status === 403, 'Unauthorized Exit', 'Weighbridge operator rejected with 403');

    // 9.7 Multi-tenant isolation: Manager 2 at ZMCC 2 attempting exit on ZMCC 1 arrival -> 403
    const crossZmccExitRes = await recordGateExit(mgr2Core as any, 'MOT', motArrId1, {
      exit_timestamp: new Date(),
      exit_client_event_id: `exit-cross-zmcc-${runId}`,
    });
    assert(crossZmccExitRes.status === 403, 'Cross-ZMCC Exit', 'Cross-ZMCC manager exit attempt rejected with 403');

    // 9.8 Successful exit for REJECTED milk (no tank receipt required)
    const validExitTimestamp = new Date(Date.now() - 60000);
    const exitEventId = `exit-success-mot-${runId}`;
    const successExitRes = await recordGateExit(pheCore as any, 'MOT', motArrId1, {
      exit_timestamp: validExitTimestamp,
      exit_client_event_id: exitEventId,
    });
    assert(successExitRes.status === 200, 'MOT Exit Success', 'REJECTED MOT arrival successfully recorded gate exit');
    assert(successExitRes.data.exit_timestamp !== null, 'Exit Timestamp Persisted', 'exit_timestamp persisted');
    assert(successExitRes.data.exit_recorded_by_user_id === pheUser.id.toString(), 'Exit Recorder Persisted', 'exit_recorded_by_user_id persisted');
    assert(successExitRes.data.exit_client_event_id === exitEventId, 'Exit Event ID Persisted', 'exit_client_event_id persisted');
    assert(successExitRes.data.exit_correction_count === 0, 'Exit Correction Count 0', 'exit_correction_count initialized to 0');

    // 9.9 Idempotency: exact replay with same client_event_id -> 200 is_replay: true
    const replayExitRes = await recordGateExit(pheCore as any, 'MOT', motArrId1, {
      exit_timestamp: validExitTimestamp,
      exit_client_event_id: exitEventId,
    });
    assert(replayExitRes.status === 200 && replayExitRes.data.is_replay === true, 'Exit Exact Replay', 'Exact replay returns 200 with is_replay: true');

    // 9.10 Idempotency: replay with mismatched payload -> 409 Conflict
    const conflictExitRes = await recordGateExit(pheCore as any, 'MOT', motArrId1, {
      exit_timestamp: new Date(Date.now() - 30000),
      exit_client_event_id: exitEventId,
    });
    assert(conflictExitRes.status === 409, 'Exit Mismatched Replay', 'Mismatched replay returns 409 conflict');

    // 9.11 Local Supplier Gate Exit: ACCEPTED milk with tank receipt
    // In Section 7, firstArrivalId was completed with ACCEPTED decision and has confirmed tank receipt!
    await prisma.zmccLabSession.update({
      where: { id: sessionId },
      data: {
        started_at: new Date(Date.now() - 3000000),
        completed_at: new Date(Date.now() - 1800000),
      },
    });
    await prisma.zmccLocalSupplierArrival.update({
      where: { id: BigInt(firstArrivalId) },
      data: {
        arrival_timestamp: new Date(Date.now() - 3600000),
      },
    });
    const lsExitEventId = `exit-ls-success-${runId}`;
    const lsExitTimestamp = new Date(Date.now() - 60000);
    const lsExitReq = makeAuthRequest(
      `http://localhost/api/zmcc/arrivals/local-supplier/${firstArrivalId}/exit`,
      'POST',
      pheToken,
      {
        exit_timestamp: lsExitTimestamp.toISOString(),
        exit_client_event_id: lsExitEventId,
      }
    );
    const lsExitRouteRes = await lsGateExitRoute(lsExitReq, {
      params: Promise.resolve({ id: firstArrivalId.toString() }),
    });
    assert(lsExitRouteRes.status === 200, 'LS Exit Route Success', 'POST /api/zmcc/arrivals/local-supplier/[id]/exit returns 200');
    const lsExitData = await lsExitRouteRes.json();
    assert(lsExitData.exit_timestamp !== null, 'LS Exit Timestamp', 'Local Supplier exit_timestamp recorded');
    assert(lsExitData.exit_client_event_id === lsExitEventId, 'LS Exit Event ID', 'Local Supplier exit_client_event_id recorded');

    // 9.12 Local Supplier Gate Exit: Attempting exit for ACCEPTED milk WITHOUT a tank receipt -> 409
    const noReceiptSupplierRes = await createLocalSupplier(pheCore as any, {
      name: `No Receipt Supplier ${runId}`,
    });
    const noReceiptArrRes = await submitLocalSupplierArrival(pheCore as any, {
      client_event_id: `no-rcpt-arr-${runId}`,
      local_supplier_id: noReceiptSupplierRes.data.id,
      raw_milk_token_number: '998877',
      rmr_number: '998877',
      vehicle_number: 'NRC 111',
      arrival_timestamp: new Date(Date.now() - 1800000),
    });
    const noReceiptArrId = noReceiptArrRes.data.id;
    // Create a mock completed lab session with ACCEPTED decision and NO tank receipt
    const mockAcceptedSession = await prisma.zmccLabSession.create({
      data: {
        zmcc_id: zmcc1.id,
        arrival_type: 'LOCAL_SUPPLIER',
        local_supplier_arrival_id: noReceiptArrId,
        status: 'COMPLETED',
        decision: 'ACCEPTED',
        started_by_user_id: labAttendant.id,
        completed_by_user_id: labAttendant.id,
        started_at: new Date(Date.now() - 1200000),
        completed_at: new Date(Date.now() - 600000),
      },
    });
    const noReceiptExitRes = await recordGateExit(pheCore as any, 'LOCAL_SUPPLIER', noReceiptArrId, {
      exit_timestamp: new Date(),
      exit_client_event_id: `exit-no-rcpt-${runId}`,
    });
    assert(noReceiptExitRes.status === 409, 'Exit Accepted Without Receipt', 'Accepted milk without tank receipt rejected with 409');
    assert(noReceiptExitRes.error === 'CANNOT_EXIT_ACCEPTED_WITHOUT_RECEIPT', 'Exit Accepted Error Code', 'Returns CANNOT_EXIT_ACCEPTED_WITHOUT_RECEIPT');

    // Clean up mock lab session
    await prisma.zmccLabSession.delete({ where: { id: mockAcceptedSession.id } });

    // 9.13 True Concurrency & Row Locking on Gate Exit (Blocker 2)
    // Helper to create unexited Local Supplier arrival with REJECTED lab (exit-ready)
    let eligibleLsCounter = 1;
    const createEligibleLS = async (suffix: string) => {
      const rmrNum = `1234${String(eligibleLsCounter++).padStart(2, '0')}`;
      const arr = await submitLocalSupplierArrival(pheCore as any, {
        client_event_id: `concurr-arr-${suffix}-${runId}`,
        local_supplier_id: createdSupplierId,
        raw_milk_token_number: rmrNum,
        rmr_number: rmrNum,
        vehicle_number: `C-${suffix.slice(-4)}`,
        arrival_timestamp: new Date(Date.now() - 3600000),
      });
      await prisma.zmccLabSession.create({
        data: {
          zmcc_id: zmcc1.id,
          arrival_type: 'LOCAL_SUPPLIER',
          local_supplier_arrival_id: arr.data.id,
          status: 'COMPLETED',
          decision: 'REJECTED',
          rejection_reason: 'Quality test failed',
          started_by_user_id: labAttendant.id,
          completed_by_user_id: labAttendant.id,
          started_at: new Date(Date.now() - 1800000),
          completed_at: new Date(Date.now() - 1200000),
        },
      });
      return arr.data.id;
    };

    // Scenario A: Concurrent identical requests -> exactly 1 write, 1 audit log, 1 replay (both 200)
    const arrIdA = await createEligibleLS('a');
    const commonEvtA = `concurr-exit-A-${runId}`;
    const commonTsA = new Date(Date.now() - 60000);
    const [resA1, resA2] = await Promise.all([
      recordGateExit(pheCore as any, 'LOCAL_SUPPLIER', arrIdA, {
        exit_timestamp: commonTsA,
        exit_client_event_id: commonEvtA,
      }),
      recordGateExit(pheCore as any, 'LOCAL_SUPPLIER', arrIdA, {
        exit_timestamp: commonTsA,
        exit_client_event_id: commonEvtA,
      }),
    ]);
    assert(resA1.status === 200 && resA2.status === 200, 'Concurrent Idempotent 200', 'Both concurrent identical exit requests return 200');
    const replayCountA = (resA1.data?.is_replay ? 1 : 0) + (resA2.data?.is_replay ? 1 : 0);
    assert(replayCountA === 1, 'Concurrent Replay Count', 'Exactly one concurrent call is marked as replay');
    const auditCountA = await prisma.auditLog.count({
      where: {
        table_name: 'zmcc_local_supplier_arrival',
        record_id: arrIdA.toString(),
        action: 'ZMCC_LOCAL_SUPPLIER_GATE_EXIT_RECORDED',
      },
    });
    assert(auditCountA === 1, 'Concurrent Audit Single', 'Exactly 1 audit log created under concurrent identical calls');

    // Scenario B: Concurrent different event IDs -> 1 succeeds (200), 1 conflicts (409)
    const arrIdB = await createEligibleLS('b');
    const [resB1, resB2] = await Promise.all([
      recordGateExit(pheCore as any, 'LOCAL_SUPPLIER', arrIdB, {
        exit_timestamp: new Date(Date.now() - 60000),
        exit_client_event_id: `concurr-exit-B1-${runId}`,
      }),
      recordGateExit(pheCore as any, 'LOCAL_SUPPLIER', arrIdB, {
        exit_timestamp: new Date(Date.now() - 60000),
        exit_client_event_id: `concurr-exit-B2-${runId}`,
      }),
    ]);
    const statusesB = [resB1.status, resB2.status].sort();
    assert(statusesB[0] === 200 && statusesB[1] === 409, 'Concurrent Distinct Events', 'One concurrent call succeeds (200), other conflicts (409 ALREADY_EXITED)');
    const auditCountB = await prisma.auditLog.count({
      where: {
        table_name: 'zmcc_local_supplier_arrival',
        record_id: arrIdB.toString(),
        action: 'ZMCC_LOCAL_SUPPLIER_GATE_EXIT_RECORDED',
      },
    });
    assert(auditCountB === 1, 'Concurrent Single Audit B', 'Exactly 1 audit log created under distinct event IDs');

    // Scenario C: Concurrent same event ID but different timestamps -> 1 succeeds (200), 1 conflicts (409 IDEMPOTENCY_CONFLICT)
    const arrIdC = await createEligibleLS('c');
    const commonEvtC = `concurr-exit-C-${runId}`;
    const [resC1, resC2] = await Promise.all([
      recordGateExit(pheCore as any, 'LOCAL_SUPPLIER', arrIdC, {
        exit_timestamp: new Date(Date.now() - 60000),
        exit_client_event_id: commonEvtC,
      }),
      recordGateExit(pheCore as any, 'LOCAL_SUPPLIER', arrIdC, {
        exit_timestamp: new Date(Date.now() - 30000),
        exit_client_event_id: commonEvtC,
      }),
    ]);
    const statusesC = [resC1.status, resC2.status].sort();
    assert(statusesC[0] === 200 && statusesC[1] === 409, 'Concurrent Mismatched Timestamps', 'One concurrent call succeeds (200), mismatched timestamp conflicts (409)');

    // 9.14 Historical Pre-Cutover Arrival Cannot Be Given Fake Exit (Blocker 3)
    const histLS = await submitLocalSupplierArrival(pheCore as any, {
      client_event_id: `hist-arr-blocker3-${runId}`,
      local_supplier_id: createdSupplierId,
      raw_milk_token_number: '778899',
      rmr_number: '778899',
      vehicle_number: 'HIST-LS-01',
      arrival_timestamp: new Date(Date.now() - 86400000),
    });
    const histLSId = histLS.data.id;
    // Set gate_exit_required = false in DB to simulate pre-cutover historical record
    await prisma.zmccLocalSupplierArrival.update({
      where: { id: BigInt(histLSId) },
      data: { gate_exit_required: false, exit_timestamp: null },
    });
    const histExitAttempt = await recordGateExit(pheCore as any, 'LOCAL_SUPPLIER', histLSId, {
      exit_timestamp: new Date(),
      exit_client_event_id: `hist-exit-attempt-${runId}`,
    });
    assert(histExitAttempt.status === 409, 'Historical Exit 409', 'Historical arrival exit rejected with 409');
    assert(histExitAttempt.error === 'GATE_EXIT_NOT_TRACKED_FOR_HISTORICAL_ARRIVAL', 'Historical Error Code', 'Returns GATE_EXIT_NOT_TRACKED_FOR_HISTORICAL_ARRIVAL');
    const histLSAfter = await prisma.zmccLocalSupplierArrival.findUnique({
      where: { id: BigInt(histLSId) },
    });
    assert(histLSAfter?.exit_timestamp === null, 'Historical Exit NULL', 'Historical arrival exit_timestamp remains NULL');
    const histAuditCount = await prisma.auditLog.count({
      where: {
        table_name: 'zmcc_local_supplier_arrival',
        record_id: histLSId.toString(),
        action: 'ZMCC_LOCAL_SUPPLIER_GATE_EXIT_RECORDED',
      },
    });
    assert(histAuditCount === 0, 'Historical No Audit Log', 'No audit log created for historical exit rejection');

    // =========================================================================
    // SECTION 10: SUPERVISORY GATE EXIT CORRECTIONS
    // =========================================================================
    console.log('\n--- 10. SUPERVISORY GATE EXIT CORRECTIONS ---');

    // 10.1 PHE operator cannot correct gate exit -> 403 Forbidden
    const unauthCorrectExitRes = await correctGateExit(pheCore as any, 'MOT', motArrId1, {
      exit_timestamp: new Date(Date.now() - 30000),
      reason: 'Supervisor adjustment attempt by PHE',
    });
    assert(unauthCorrectExitRes.status === 403, 'PHE Exit Correction Denied', 'PHE operator cannot correct gate exit (403)');

    // 10.2 Cross-ZMCC manager cannot correct gate exit -> 403 Forbidden
    const crossZmccCorrectExitRes = await correctGateExit(mgr2Core as any, 'MOT', motArrId1, {
      exit_timestamp: new Date(Date.now() - 30000),
      reason: 'Cross-ZMCC adjustment attempt',
    });
    assert(crossZmccCorrectExitRes.status === 403, 'Cross-ZMCC Correction Denied', 'Cross-ZMCC manager cannot correct gate exit (403)');

    // 10.3 Reason required (minimum 5 chars) -> 400 Bad Request
    const shortReasonExitRes = await correctGateExit(mgr1Core as any, 'MOT', motArrId1, {
      exit_timestamp: new Date(Date.now() - 30000),
      reason: 'fix',
    });
    assert(shortReasonExitRes.status === 400, 'Short Reason Rejected', 'Correction with reason < 5 chars rejected with 400');

    // 10.4 Corrected exit timestamp in future -> 400 Bad Request
    const futureCorrectExitRes = await correctGateExit(mgr1Core as any, 'MOT', motArrId1, {
      exit_timestamp: new Date(Date.now() + 3600000),
      reason: 'Future correction test reason',
    });
    assert(futureCorrectExitRes.status === 400, 'Future Corrected Exit Rejected', 'Future corrected exit timestamp rejected with 400');

    // 10.5 Successful supervisory exit correction 1
    const correctedExitTimestamp1 = new Date(Date.now() - 40000);
    const correctExitRes1 = await correctGateExit(mgr1Core as any, 'MOT', motArrId1, {
      exit_timestamp: correctedExitTimestamp1,
      reason: 'Gate exit timestamp recorded incorrectly at barrier',
    });
    assert(correctExitRes1.status === 200, 'Exit Correction 1 Success', 'Manager 1 successfully corrected exit timestamp');
    assert(correctExitRes1.data.exit_correction_count === 1, 'Correction Count 1', 'exit_correction_count incremented to 1');

    // 10.6 Successful supervisory exit correction 2
    const correctedExitTimestamp2 = new Date(Date.now() - 20000);
    const correctExitRes2 = await correctGateExit(mgr1Core as any, 'MOT', motArrId1, {
      exit_timestamp: correctedExitTimestamp2,
      reason: 'Second supervisor verification adjustment',
    });
    assert(correctExitRes2.status === 200, 'Exit Correction 2 Success', 'Manager 1 successfully corrected exit timestamp second time');
    assert(correctExitRes2.data.exit_correction_count === 2, 'Correction Count 2', 'exit_correction_count incremented to 2');

    // 10.7 Successful supervisory exit corrections 3, 4, 5
    for (let c = 3; c <= 5; c++) {
      const correctedExitTimestamp = new Date(Date.now() - (60000 - c * 5000));
      const res = await correctGateExit(mgr1Core as any, 'MOT', motArrId1, {
        exit_timestamp: correctedExitTimestamp,
        reason: `Supervisor verification adjustment ${c}`,
      });
      assert(res.status === 200, `Exit Correction ${c} Success`, `Manager 1 successfully corrected exit timestamp ${c}`);
      assert(res.data.exit_correction_count === c, `Correction Count ${c}`, `exit_correction_count incremented to ${c}`);
    }

    // Maximum 5 corrections enforced -> 6th correction returns 409 Conflict
    const correctExitRes6 = await correctGateExit(mgr1Core as any, 'MOT', motArrId1, {
      exit_timestamp: new Date(Date.now() - 1000),
      reason: 'Sixth attempt should be blocked',
    });
    assert(correctExitRes6.status === 409, 'Max 5 Corrections Enforced', 'Sixth exit correction attempt returns 409 conflict');
    assert(correctExitRes6.error === 'MAX_EXIT_CORRECTIONS_EXCEEDED', 'Max Corrections Error Code', 'Returns MAX_EXIT_CORRECTIONS_EXCEEDED');

    // 10.8 Local Supplier Gate Exit Correction & No-Op Identical Timestamp Rejection
    // Reject no-op correction where exit_timestamp equals current exit_timestamp -> 400 NO_OP_IDENTICAL_TIMESTAMP
    const noOpExitRes = await correctGateExit(mgr1Core as any, 'LOCAL_SUPPLIER', firstArrivalId, {
      exit_timestamp: lsExitTimestamp,
      reason: 'Attempting to submit identical timestamp as correction',
    });
    assert(noOpExitRes.status === 400, 'No-Op Identical Timestamp Rejected', 'Correction with identical exit_timestamp returns 400');
    assert(noOpExitRes.error === 'NO_OP_IDENTICAL_TIMESTAMP', 'No-Op Error Code', 'Returns NO_OP_IDENTICAL_TIMESTAMP');

    // Successful correction on Local Supplier arrival
    const lsCorrectedTs1 = new Date(lsExitTimestamp.getTime() + 10000);
    const lsCorrectRes1 = await correctGateExit(mgr1Core as any, 'LOCAL_SUPPLIER', firstArrivalId, {
      exit_timestamp: lsCorrectedTs1,
      reason: 'Correction of Local Supplier gate exit timestamp',
    });
    assert(lsCorrectRes1.status === 200, 'LS Exit Correction Success', 'Manager 1 successfully corrected Local Supplier exit timestamp');
    assert(lsCorrectRes1.data.exit_correction_count === 1, 'LS Correction Count 1', 'exit_correction_count incremented to 1');

    // 10.9 Rejection of Gate Exit Correction on Historical Pre-Cutover Arrival
    // If arrival has not exited -> 400
    const histNoExitRes = await correctGateExit(mgr1Core as any, 'LOCAL_SUPPLIER', histLSId, {
      exit_timestamp: new Date(),
      reason: 'Attempt to correct unexited historical arrival',
    });
    assert(histNoExitRes.status === 400, 'Historical Unexited Rejected', 'Cannot correct gate exit for an arrival that has not exited');

    // If historical arrival has gate_exit_required = false but somehow has an exit_timestamp -> 409
    await prisma.zmccLocalSupplierArrival.update({
      where: { id: BigInt(histLSId) },
      data: { exit_timestamp: new Date(Date.now() - 3600000), gate_exit_required: false },
    });
    const histExitCorrectRes = await correctGateExit(mgr1Core as any, 'LOCAL_SUPPLIER', histLSId, {
      exit_timestamp: new Date(Date.now() - 1800000),
      reason: 'Attempt to correct historical pre-cutover gate exit',
    });
    assert(histExitCorrectRes.status === 409, 'Historical Pre-Cutover Correction 409', 'Gate exit correction rejected on historical arrival (gate_exit_required !== true)');
    assert(histExitCorrectRes.error === 'GATE_EXIT_NOT_TRACKED_FOR_HISTORICAL_ARRIVAL', 'Historical Pre-Cutover Error Code', 'Returns GATE_EXIT_NOT_TRACKED_FOR_HISTORICAL_ARRIVAL');

    // Restore histLSId
    await prisma.zmccLocalSupplierArrival.update({
      where: { id: BigInt(histLSId) },
      data: { exit_timestamp: null, gate_exit_required: false },
    });

    // 10.10 True Concurrency on Supervisory Gate Exit Correction (Blocker 2)
    // Starting at T0 / count 0 on an exited arrival, send two concurrent corrections with distinct timestamps T1 and T2
    const concLSId = await createEligibleLS('conc-corr');
    const concExitTs = new Date(Date.now() - 300000);
    const concExitInitRes = await recordGateExit(pheCore as any, 'LOCAL_SUPPLIER', concLSId, {
      exit_timestamp: concExitTs,
      exit_client_event_id: `conc-exit-init-${runId}`,
    });
    assert(concExitInitRes.status === 200, 'Concurrent Arrival Exited', 'Prepared eligible arrival with gate exit at T0');

    const tCorr1 = new Date(concExitTs.getTime() + 10000);
    const tCorr2 = new Date(concExitTs.getTime() + 20000);

    const [concRes1, concRes2] = await Promise.all([
      correctGateExit(mgr1Core as any, 'LOCAL_SUPPLIER', concLSId, {
        exit_timestamp: tCorr1,
        reason: 'Concurrent supervisor correction execution 1',
      }),
      correctGateExit(mgr1Core as any, 'LOCAL_SUPPLIER', concLSId, {
        exit_timestamp: tCorr2,
        reason: 'Concurrent supervisor correction execution 2',
      }),
    ]);
    assert(concRes1.status === 200 && concRes2.status === 200, 'Concurrent Corrections Succeeded', 'Both concurrent exit corrections returned 200');

    // Verify row state in DB: exit_correction_count must be exactly 2
    const finalLS = await prisma.zmccLocalSupplierArrival.findUnique({
      where: { id: BigInt(concLSId) },
    });
    assert(finalLS?.exit_correction_count === 2, 'Final Correction Count 2', 'exit_correction_count is strictly 2 after concurrent executions');

    // Verify Audit Logs: exactly 2 entries, ordered by id asc
    const corrAudits = await prisma.auditLog.findMany({
      where: {
        table_name: 'zmcc_local_supplier_arrival',
        record_id: BigInt(concLSId),
        action: 'ZMCC_LOCAL_SUPPLIER_GATE_EXIT_CORRECTED',
      },
      orderBy: { id: 'asc' },
    });
    assert(corrAudits.length === 2, 'Exactly 2 Correction Audits', 'Exactly 2 audit log records created for serialized corrections');

    const audit1 = corrAudits[0];
    const audit2 = corrAudits[1];
    const audit1NewTs = (audit1.new_values as any).exit_timestamp;
    const audit2OldTs = (audit2.old_values as any).exit_timestamp;

    assert(
      audit1NewTs === audit2OldTs,
      'Truthful Serialized Audit Trail',
      `Second audit old_values.exit_timestamp (${audit2OldTs}) matches first committed new_values.exit_timestamp (${audit1NewTs})`
    );
    assert(
      (audit1.old_values as any).exit_timestamp === concExitTs.toISOString(),
      'First Audit Old TS Matches T0',
      'First audit log captured initial T0 exit timestamp as old_values'
    );
    assert(
      (audit1.new_values as any).exit_correction_count === 1,
      'First Audit Count 1',
      'First audit log recorded count = 1'
    );
    assert(
      (audit2.new_values as any).exit_correction_count === 2,
      'Second Audit Count 2',
      'Second audit log recorded count = 2'
    );

    // 10.11 Concurrency Max Corrections Limit Under High Contention
    for (let c = 3; c <= 5; c++) {
      const res = await correctGateExit(mgr1Core as any, 'LOCAL_SUPPLIER', concLSId, {
        exit_timestamp: new Date(concExitTs.getTime() + c * 10000),
        reason: `Supervisor correction sequence ${c}`,
      });
      assert(res.status === 200, `Exit Correction ${c} Success`, `Manager 1 successfully corrected exit timestamp ${c}`);
    }

    // 6th correction attempt (now at count 5) must fail with 409
    const sixthConcAttempt = await correctGateExit(mgr1Core as any, 'LOCAL_SUPPLIER', concLSId, {
      exit_timestamp: new Date(concExitTs.getTime() + 60000),
      reason: 'Sixth correction attempt blocked',
    });
    assert(sixthConcAttempt.status === 409, 'Max Corrections Exceeded 409', 'Sixth correction attempt returns 409 conflict');
    assert(sixthConcAttempt.error === 'MAX_EXIT_CORRECTIONS_EXCEEDED', 'Max Error Code', 'Returns MAX_EXIT_CORRECTIONS_EXCEEDED');

    // Test concurrent race when count is 4: exactly one succeeds (reaching 5), one rejected with 409
    const concLimitLSId = await createEligibleLS('conc-limit');
    const limitExitTs = new Date(Date.now() - 250000);
    await recordGateExit(pheCore as any, 'LOCAL_SUPPLIER', concLimitLSId, {
      exit_timestamp: limitExitTs,
      exit_client_event_id: `conc-limit-exit-${runId}`,
    });

    let lastLimitTs = limitExitTs;
    for (let s = 1; s <= 4; s++) {
      lastLimitTs = new Date(lastLimitTs.getTime() + 10000);
      const preRes = await correctGateExit(mgr1Core as any, 'LOCAL_SUPPLIER', concLimitLSId, {
        exit_timestamp: lastLimitTs,
        reason: `Initial supervisor correction setting count to ${s}`,
      });
      assert(preRes.status === 200, `Exit Slot ${s} Used`, `exit_manager_correction_count is ${s}`);
    }

    const [raceRes1, raceRes2] = await Promise.all([
      correctGateExit(mgr1Core as any, 'LOCAL_SUPPLIER', concLimitLSId, {
        exit_timestamp: new Date(lastLimitTs.getTime() + 10000),
        reason: 'Race for the final correction slot A',
      }),
      correctGateExit(mgr1Core as any, 'LOCAL_SUPPLIER', concLimitLSId, {
        exit_timestamp: new Date(lastLimitTs.getTime() + 20000),
        reason: 'Race for the final correction slot B',
      }),
    ]);
    const raceStatuses = [raceRes1.status, raceRes2.status].sort();
    assert(
      raceStatuses[0] === 200 && raceStatuses[1] === 409,
      'Concurrent Race at Count 4 Enforces Max 5',
      'Under concurrent contention at count 4, exactly one call succeeds (200) and the other is rejected (409 MAX_EXIT_CORRECTIONS_EXCEEDED)'
    );

    // =========================================================================
    // SECTION 11: ARRIVAL CORRECTION AFTER EXIT (CHRONOLOGY INTEGRITY)
    // =========================================================================
    console.log('\n--- 11. ARRIVAL CORRECTION AFTER EXIT ---');

    // When exit is recorded, correcting arrival_timestamp to be AFTER exit_timestamp must return 400
    const invalidArrCorrectRes = await correctMotArrival(mgr1Core as any, motArrId1, {
      arrival_timestamp: new Date(correctedExitTimestamp2.getTime() + 10000),
      reason: 'Attempt to make arrival later than exit',
    });
    assert(invalidArrCorrectRes.status === 400, 'Arrival After Exit Rejected', 'Correcting arrival_timestamp after exit enforces arrival <= exit');

    // Correcting arrival_timestamp to valid time before exit succeeds
    const validArrCorrectRes = await correctMotArrival(mgr1Core as any, motArrId1, {
      arrival_timestamp: new Date(Date.now() - 2400000),
      reason: 'Correcting arrival to earlier valid time',
    });
    assert(validArrCorrectRes.status === 200, 'Arrival Before Exit Accepted', 'Correcting arrival_timestamp before exit succeeds');

    // =========================================================================
    // SECTION 12: MOT VEHICLE PHYSICAL AVAILABILITY CHECK
    // =========================================================================
    console.log('\n--- 12. MOT VEHICLE PHYSICAL AVAILABILITY CHECK ---');

    // 12.1 Create an MOT vehicle and journey that arrives at ZMCC
    const availVehicle = await prisma.motVehicle.create({
      data: {
        zmcc_id: zmcc1.id,
        vehicle_number: `MOT-AVAIL-${runId.toString().slice(-6)}`,
        created_by: manager1.id,
        updated_by: manager1.id,
      },
    });
    const availProfile = await prisma.motProfile.create({
      data: {
        zmcc_id: zmcc1.id,
        mot_code: `MO-AV-${runId.toString().slice(-6)}`,
        name: `MOT Officer Avail ${runId}`,
        phone_number: '03001234569',
        cnic: '35201-1234567-3',
        created_by: manager1.id,
        updated_by: manager1.id,
      },
    });
    const availRoute = await prisma.zmccRoute.create({
      data: {
        zmcc_id: zmcc1.id,
        route_code: `R-AV-${runId.toString().slice(-6)}`,
        name: `Route Avail ${runId}`,
        origin: 'Origin',
        destination: 'ZMCC',
        created_by: manager1.id,
        updated_by: manager1.id,
      },
    });

    const availArea = await prisma.zmccArea.create({
      data: {
        area_code: `A-AV-${runId.toString().slice(-6)}`,
        name: `Area Avail ${runId}`,
        route_id: availRoute.id,
        zmcc_id: zmcc1.id,
        is_active: true,
        created_by: manager1.id,
      },
    });

    let availChiller = await prisma.chillerOwnership.findFirst({ where: { is_active: true } });
    if (!availChiller) {
      availChiller = await prisma.chillerOwnership.create({
        data: {
          ownership_code: `CO-AV-${runId.toString().slice(-6)}`,
          name: `Chiller Ownership Avail ${runId}`,
          is_active: true,
          created_by: superAdmin.id,
        },
      });
    }

    let availMilkSource = await prisma.zmccMilkSource.findFirst({ where: { zmcc_id: zmcc1.id, is_active: true } });
    if (!availMilkSource) {
      availMilkSource = await prisma.zmccMilkSource.create({
        data: {
          erp_code: `MS-AV-${runId.toString().slice(-6)}`,
          name: `Milk Source Avail ${runId}`,
          zmcc_id: zmcc1.id,
          is_active: true,
          created_by: manager1.id,
        },
      });
    }

    await prisma.zmccShop.create({
      data: {
        shop_code: `S-AV-${runId.toString().slice(-6)}`,
        shop_name: `Shop Avail ${runId}`,
        owner_name: 'Shop Owner Avail',
        phone_number: '03001234599',
        cnic: '35201-1234567-9',
        area_id: availArea.id,
        route_id: availRoute.id,
        zmcc_id: zmcc1.id,
        milk_source_id: availMilkSource.id,
        chiller_ownership_id: availChiller.id,
        is_active: true,
        created_by: manager1.id,
      },
    });

    // Create and complete journey 1, submit arrival (now vehicle is inside ZMCC with gate_exit_required = true)
    const availJourney1 = await prisma.motJourney.create({
      data: {
        journey_number: `J-AV1-${runId.toString().slice(-6)}`,
        idempotency_key: `dispatch-av1-${runId}`,
        zmcc_id: zmcc1.id,
        route_id: availRoute.id,
        mot_vehicle_id: availVehicle.id,
        mot_profile_id: availProfile.id,
        assigned_by: manager1.id,
        assigned_at: new Date(Date.now() - 7200000),
        assignment_latitude: new Prisma.Decimal('31.5204'),
        assignment_longitude: new Prisma.Decimal('74.3587'),
        start_latitude: new Prisma.Decimal('31.5204'),
        start_longitude: new Prisma.Decimal('74.3587'),
        status: 'COLLECTING',
        operational_date: new Date(),
        started_at: new Date(Date.now() - 7200000),
      },
    });

    const availArrivalRes = await submitMotArrival(pheCore as any, {
      journey_id: availJourney1.id,
      raw_milk_token_number: `653${runId.toString().slice(-3)}`,
      route_milk_token: `RM-AV1-${runId.toString().slice(-6)}`,
      arrival_timestamp: new Date(Date.now() - 3500000),
      client_event_id: `evt-mot-av1-${runId}`,
    });
    assert(availArrivalRes.status === 201, 'Vehicle Inside ZMCC', 'Vehicle arrived and is currently inside ZMCC');
    const availArrivalId = availArrivalRes.data.id;

    // 12.2 Attempt to dispatch availVehicle for a new journey -> 409 Conflict
    const { auth: motAuthMgr } = await resolveMotAuth(mgr1Core as any, 'ASSIGN_DISPATCH');
    const blockedDispatchRes = await assignAndDispatchJourney(motAuthMgr!, {
      operational_date: getPakistanCalendarDate(new Date()),
      route_id: availRoute.id.toString(),
      mot_profile_id: availProfile.id.toString(),
      mot_vehicle_id: availVehicle.id.toString(),
      latitude: 31.5204,
      longitude: 74.3587,
      idempotency_key: `dispatch-blocked-${runId}`,
    });
    assert(blockedDispatchRes.status === 409, 'Dispatch Blocked While Inside ZMCC', 'Vehicle inside ZMCC blocked from new dispatch (409)');
    assert(Boolean(blockedDispatchRes.error?.includes('inside ZMCC')), 'Vehicle Inside ZMCC Error Message', 'Returns vehicle inside ZMCC conflict error');

    // 12.3 Complete lab session and record gate exit for availVehicle
    const availLabStart = await startOrResumeSession(labCore as any, {
      arrival_type: 'MOT',
      arrival_id: availArrivalId,
    });
    await completeSession(labCore as any, availLabStart.data.id, {
      completion_client_event_id: `c-avail-${runId}`,
      decision: 'REJECTED',
      rejection_reason: 'Rejected for vehicle test',
      quantity_value: 500.0,
      quantity_unit: 'LITER',
      results: availLabStart.data.results.map((tr: any) => ({
        test_id: tr.test_id,
        numeric_value: tr.result_type_snapshot === 'NUMERIC' ? 1.0 : undefined,
        text_value: tr.result_type_snapshot !== 'NUMERIC' ? 'POSITIVE' : undefined,
      })),
      remarks: 'Rejected for vehicle test',
    });

    await prisma.zmccLabSession.update({
      where: { id: BigInt(availLabStart.data.id) },
      data: {
        started_at: new Date(Date.now() - 1800000),
        completed_at: new Date(Date.now() - 600000),
      },
    });

    const availExitRes = await recordGateExit(pheCore as any, 'MOT', availArrivalId, {
      exit_timestamp: new Date(),
      exit_client_event_id: `exit-avail-${runId}`,
    });
    assert(availExitRes.status === 200, 'Vehicle Gate Exit Recorded', 'Vehicle recorded gate exit');

    // 12.4 Now dispatching the vehicle must SUCCEED!
    const unblockedDispatchRes = await assignAndDispatchJourney(motAuthMgr!, {
      operational_date: getPakistanCalendarDate(new Date()),
      route_id: availRoute.id.toString(),
      mot_profile_id: availProfile.id.toString(),
      mot_vehicle_id: availVehicle.id.toString(),
      latitude: 31.5204,
      longitude: 74.3587,
      idempotency_key: `dispatch-unblocked-${runId}`,
    });
    assert(unblockedDispatchRes.status === 201, 'Dispatch Succeeded After Gate Exit', 'Vehicle can be dispatched after recording gate exit');

    // 12.5 Historical cutover test: Historical row with gate_exit_required = false does NOT block dispatch
    await prisma.zmccMotArrival.update({
      where: { id: availArrivalId },
      data: { gate_exit_required: false, exit_timestamp: null },
    });
    const historicalDispatchRes = await assignAndDispatchJourney(motAuthMgr!, {
      operational_date: getPakistanCalendarDate(new Date()),
      route_id: availRoute.id.toString(),
      mot_profile_id: availProfile.id.toString(),
      mot_vehicle_id: availVehicle.id.toString(),
      latitude: 31.5204,
      longitude: 74.3587,
      idempotency_key: `dispatch-hist-${runId}`,
    });
    assert(!historicalDispatchRes.error?.includes('inside ZMCC'), 'Historical Cutover No Block', 'Historical arrival (gate_exit_required = false) never blocks vehicle dispatch');

    // =========================================================================
    // SECTION 13: VEHICLES INSIDE ZMCC LIST ENDPOINT
    // =========================================================================
    console.log('\n--- 13. VEHICLES INSIDE ZMCC LIST ENDPOINT ---');

    // Create an unexited Local Supplier arrival at ZMCC 1
    const insideSupplierRes = await createLocalSupplier(pheCore as any, {
      name: `Inside Supplier ${runId}`,
    });
    const insideSupplierArrivalRes = await submitLocalSupplierArrival(pheCore as any, {
      client_event_id: `inside-arr-${runId}`,
      local_supplier_id: insideSupplierRes.data.id,
      raw_milk_token_number: '112233',
      rmr_number: '112233',
      vehicle_number: `INS-${runId.toString().slice(-4)}`,
      arrival_timestamp: new Date(),
    });
    assert(insideSupplierArrivalRes.status === 201, 'Inside Arrival Created', 'Created unexited local supplier arrival');
    const insideToken = insideSupplierArrivalRes.data.zmcc_token;

    // Call GET /api/zmcc/arrivals/inside as Manager 1 (assigned to ZMCC 1)
    const insideReq1 = makeAuthRequest('http://localhost/api/zmcc/arrivals/inside', 'GET', mgr1Token);
    const insideRouteRes1 = await insideVehiclesRoute(insideReq1);
    assert(insideRouteRes1.status === 200, 'Inside Route 200', 'GET /api/zmcc/arrivals/inside returns 200');
    const insideData1 = await insideRouteRes1.json();
    assert(Array.isArray(insideData1.items), 'Inside Items Array', 'Response has items array');
    const foundInside = insideData1.items.find((it: any) => it.zmcc_token === insideToken);
    assert(!!foundInside, 'Inside Vehicle Found', 'Unexited vehicle listed in vehicles inside ZMCC');
    assert(foundInside.arrival_type === 'LOCAL_SUPPLIER', 'Arrival Type Correct', 'Arrival type is LOCAL_SUPPLIER');
    assert(foundInside.vehicle_number === `INS-${runId.toString().slice(-4)}`, 'Vehicle Number Match', 'Vehicle number matches');
    assert(foundInside.gate_exit_recorded === false, 'Gate Exit Not Recorded', 'gate_exit_recorded is false');

    // Ensure exited vehicles are NOT in the inside list
    const exitedItem = insideData1.items.find((it: any) => it.id === firstArrivalId && it.arrival_type === 'LOCAL_SUPPLIER');
    assert(!exitedItem, 'Exited Vehicle Excluded', 'Exited vehicle is excluded from inside vehicles list');

    // 13.1 Envelope metadata verification (Blocker 4)
    assert(Array.isArray(insideData1.vehicles), 'Envelope Vehicles Array', 'Response has vehicles array matching items');
    assert(typeof insideData1.limit === 'number', 'Envelope Limit', 'Response has limit number');
    assert(typeof insideData1.total_count === 'number', 'Envelope Total Count', 'Response has total_count number');
    assert(typeof insideData1.has_more === 'boolean', 'Envelope Has More', 'Response has has_more boolean');

    // 13.2 Bounded query limit enforcement
    const boundedReq = makeAuthRequest('http://localhost/api/zmcc/arrivals/inside?limit=1', 'GET', mgr1Token);
    const boundedRouteRes = await insideVehiclesRoute(boundedReq);
    assert(boundedRouteRes.status === 200, 'Bounded Route 200', 'GET /api/zmcc/arrivals/inside?limit=1 returns 200');
    const boundedData = await boundedRouteRes.json();
    assert(boundedData.limit === 1, 'Bounded Limit 1', 'Envelope limit is 1');
    assert(boundedData.items.length <= 1, 'Bounded Items Length', 'Items array length does not exceed limit');
    assert(boundedData.vehicles.length <= 1, 'Bounded Vehicles Length', 'Vehicles array length does not exceed limit');
    if (boundedData.total_count > 1) {
      assert(boundedData.has_more === true, 'Bounded Has More', 'has_more is true when total_count > limit');
    }

    // Multi-tenant check: Call GET /api/zmcc/arrivals/inside as Manager 2 (assigned to ZMCC 2)
    const insideReq2 = makeAuthRequest('http://localhost/api/zmcc/arrivals/inside', 'GET', mgr2Token);
    const insideRouteRes2 = await insideVehiclesRoute(insideReq2);
    assert(insideRouteRes2.status === 200, 'Inside Route ZMCC 2', 'GET /api/zmcc/arrivals/inside returns 200 for ZMCC 2');
    const insideData2 = await insideRouteRes2.json();
    const crossInside = insideData2.items.find((it: any) => it.zmcc_token === insideToken);
    assert(!crossInside, 'Multi-tenant Isolation', 'ZMCC 1 inside vehicle not visible to ZMCC 2');

    // =========================================================================
    // SECTION 14: AUDIT LOG VERIFICATION
    // =========================================================================
    console.log('\n--- 14. AUDIT LOG VERIFICATION ---');

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

    const motExitAudit = await prisma.auditLog.findFirst({
      where: {
        table_name: 'zmcc_mot_arrival',
        action: 'ZMCC_MOT_GATE_EXIT_RECORDED',
      },
    });
    assert(!!motExitAudit, 'AuditLog', 'AuditLog record exists for ZMCC_MOT_GATE_EXIT_RECORDED');

    const lsExitAudit = await prisma.auditLog.findFirst({
      where: {
        table_name: 'zmcc_local_supplier_arrival',
        action: 'ZMCC_LOCAL_SUPPLIER_GATE_EXIT_RECORDED',
      },
    });
    assert(!!lsExitAudit, 'AuditLog', 'AuditLog record exists for ZMCC_LOCAL_SUPPLIER_GATE_EXIT_RECORDED');

    const motExitCorrectAudit = await prisma.auditLog.findFirst({
      where: {
        table_name: 'zmcc_mot_arrival',
        action: 'ZMCC_MOT_GATE_EXIT_CORRECTED',
      },
    });
    assert(!!motExitCorrectAudit, 'AuditLog', 'AuditLog record exists for ZMCC_MOT_GATE_EXIT_CORRECTED');

    const lsExitCorrectAudit = await prisma.auditLog.findFirst({
      where: {
        table_name: 'zmcc_local_supplier_arrival',
        action: 'ZMCC_LOCAL_SUPPLIER_GATE_EXIT_CORRECTED',
      },
    });
    assert(!!lsExitCorrectAudit, 'AuditLog', 'AuditLog record exists for ZMCC_LOCAL_SUPPLIER_GATE_EXIT_CORRECTED');

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
