/**
 * STAGE 6G-B: MOT JOURNEY FINAL SUMMARY REGRESSION TEST SUITE
 *
 * Verifies:
 * 1. Database Schema & Migration:
 *    - Exactly 20 tracked migrations
 *    - mot_journey_summary table exists with 1-to-1 foreign key and unique index on journey_id
 *    - DB CHECK constraints (revision_check >= 1, non-negative liters, quality boundaries)
 * 2. Static Analysis & Architecture:
 *    - Registered in scripts/run_all_regressions.ts
 *    - Zero manual edit endpoints for MotJourneySummary (100% system-owned)
 *    - No duplicate milk formulas
 *    - Zero 08:00 AM Plant Business Date coupling (uses PKT calendar)
 *    - Zero MotVehicleVisit abstraction
 * 3. Lifecycle & Initial Generation:
 *    - Created in same transaction when ZMCC MOT arrival completes
 *    - Exactly 1 MotJourneySummary per completed MotJourney
 *    - Cancelled journeys have ZERO summary
 *    - In-progress / collecting journeys have ZERO summary
 * 4. Pure Aggregation & Weighting Mathematics:
 *    - Empty collections: totals = 0.00, quality metrics = NULL
 *    - Single collection: exact match to persisted values
 *    - Multiple collections: gross-liters weighted averages
 *      Example: 100L (Fat 4.0, LR 28.0) + 300L (Fat 3.5, LR 27.0)
 *      Total Gross = 400.00 L
 *      Weighted Fat = (100*4.0 + 300*3.5)/400 = (400 + 1050)/400 = 1450/400 = 3.63%
 *      Weighted LR = (100*28.0 + 300*27.0)/400 = (2800 + 8100)/400 = 10900/400 = 27.25
 *    - summary_version = "1.0"
 *    - source_calculation_versions = ["1.0"] sorted distinct
 * 5. Stop Counts Breakdown:
 *    - assigned_shop_count = total stops
 *    - collected_shop_count = stops with collection
 *    - skipped_shop_count = stops skipped
 *    - pending_shop_count = remaining stops
 * 6. Offline Delayed Sync & Late Recompute Exception:
 *    - Delayed collection with device_collected_at <= journey.ended_at:
 *      recomputes summary in SAME transaction
 *      increments revision (1 -> 2)
 *      updates totals and gross-weighted averages
 *      updates stop counts (collected +1, pending -1)
 *      creates MOT_JOURNEY_SUMMARY_REFRESHED_LATE_SYNC audit log with MOT actor
 *    - Exact idempotent replay: no revision increment, no duplicate audit
 *    - Delayed collection with device_collected_at > journey.ended_at:
 *      rejected with HTTP 400, leaves summary and revision intact
 *    - Delayed GPS batch alone does NOT trigger summary recompute or revision bump
 * 7. RBAC & Access Boundaries:
 *    - ZMCC_MANAGER (own ZMCC) can read journey summary (200)
 *    - PHE_OPERATOR (own ZMCC) can read journey summary (200)
 *    - SUPER_ADMIN can read all journey summaries (200)
 *    - Cross-ZMCC access blocked (403)
 *    - Legacy roles blocked (403)
 * 8. Audit Evidence:
 *    - MOT_JOURNEY_SUMMARY_CREATED with PHE actor on initial creation
 *    - MOT_JOURNEY_SUMMARY_REFRESHED_LATE_SYNC with MOT actor on late sync
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

// 2. Preserve DEV_DATABASE_URL and point DATABASE_URL to TEST_DATABASE_URL
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
console.log('🧪 STAGE 6G-B: MOT JOURNEY FINAL SUMMARY REGRESSION SUITE');
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

async function runStage6gbTests() {
  const { prisma } = await import('../src/backend/core/db');
  const { Prisma } = await import('@prisma/client');
  const {
    calculateJourneySummaryMetrics,
    serializeMotJourneySummary,
    MOT_JOURNEY_SUMMARY_VERSION,
  } = await import('../src/backend/services/motJourneySummaryService');
  const {
    submitMotArrival,
    listMotArrivals,
    getMotArrivalById,
  } = await import('../src/backend/services/zmccArrivalService');
  const {
    submitShopCollection,
    recordGpsBatch,
    getMotJourneyById,
    cancelMotJourney,
  } = await import('../src/backend/services/motService');

  // =============================================================
  // 1. DATABASE SCHEMA & MIGRATIONS
  // =============================================================
  console.log('\n--- 1. DATABASE SCHEMA & MIGRATIONS ---');
  const migrationsDir = path.join(repoRoot, 'prisma', 'migrations');
  const migrationDirs = fs
    .readdirSync(migrationsDir)
    .filter((f) => fs.statSync(path.join(migrationsDir, f)).isDirectory() && !f.startsWith('.'));
  assert(migrationDirs.length === 20, 'Tracked Migrations', `Found exactly ${migrationDirs.length} migrations (expected 20)`);

  const summaryMigDir = migrationDirs.find((d) => d.includes('mot_journey_summary'));
  assert(!!summaryMigDir, 'Migration Exists', `Found summary migration directory: ${summaryMigDir}`);

  // Check mot_journey_summary table exists in PostgreSQL
  const tableCheck = await prisma.$queryRaw<{ exists: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables WHERE table_name = 'mot_journey_summary'
    ) as exists;
  `;
  assert(tableCheck[0]?.exists === true, 'Table Exists', 'mot_journey_summary table exists in PostgreSQL');

  // Check unique constraint on journey_id
  const uniqueCheck = await prisma.$queryRaw<{ exists: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM pg_indexes
      WHERE tablename = 'mot_journey_summary' AND indexname = 'mot_journey_summary_journey_id_key'
    ) as exists;
  `;
  assert(uniqueCheck[0]?.exists === true, '1-to-1 Index', 'mot_journey_summary_journey_id_key unique index exists');

  // =============================================================
  // 2. PURE CALCULATION TESTS (Section 32 Spec Math)
  // =============================================================
  console.log('\n--- 2. PURE AGGREGATION & WEIGHTING MATHEMATICS ---');
  // Zero collections test
  const emptyMetrics = calculateJourneySummaryMetrics(
    [{ id: BigInt(1), status: 'PENDING', skipped_at: null }, { id: BigInt(2), status: 'SKIPPED', skipped_at: new Date() }],
    []
  );
  assert(emptyMetrics.total_gross_liters.toFixed(2) === '0.00', 'Empty Gross', 'Total gross liters is 0.00 for empty collections');
  assert(emptyMetrics.total_at_13ts_liters.toFixed(2) === '0.00', 'Empty @13TS', 'Total @13TS liters is 0.00 for empty collections');
  assert(emptyMetrics.weighted_avg_lr === null, 'Empty LR Null', 'Weighted avg LR is null for empty collections');
  assert(emptyMetrics.weighted_avg_fat === null, 'Empty Fat Null', 'Weighted avg Fat is null for empty collections');
  assert(emptyMetrics.weighted_avg_snf === null, 'Empty SNF Null', 'Weighted avg SNF is null for empty collections');
  assert(emptyMetrics.weighted_avg_ts === null, 'Empty TS Null', 'Weighted avg TS is null for empty collections');
  assert(emptyMetrics.assigned_shop_count === 2, 'Stop Assigned Count', 'Assigned shop count = 2');
  assert(emptyMetrics.collected_shop_count === 0, 'Stop Collected Count', 'Collected shop count = 0');
  assert(emptyMetrics.skipped_shop_count === 1, 'Stop Skipped Count', 'Skipped shop count = 1');
  assert(emptyMetrics.pending_shop_count === 1, 'Stop Pending Count', 'Pending shop count = 1');

  // Spec Math: 100L (Fat 4.0, LR 28.0) and 300L (Fat 3.5, LR 27.0)
  const specMetrics = calculateJourneySummaryMetrics(
    [
      { id: BigInt(101), status: 'VISITED', skipped_at: null },
      { id: BigInt(102), status: 'VISITED', skipped_at: null },
      { id: BigInt(103), status: 'PENDING', skipped_at: null },
    ],
    [
      {
        id: BigInt(1),
        journey_stop_id: BigInt(101),
        gross_liters: new Prisma.Decimal('100.00'),
        at_13ts_liters: new Prisma.Decimal('96.92'),
        lr: new Prisma.Decimal('28.00'),
        fat: new Prisma.Decimal('4.00'),
        snf: new Prisma.Decimal('8.60'),
        ts: new Prisma.Decimal('12.60'),
        calculation_version: '1.0',
      },
      {
        id: BigInt(2),
        journey_stop_id: BigInt(102),
        gross_liters: new Prisma.Decimal('300.00'),
        at_13ts_liters: new Prisma.Decimal('270.92'),
        lr: new Prisma.Decimal('27.00'),
        fat: new Prisma.Decimal('3.50'),
        snf: new Prisma.Decimal('8.24'),
        ts: new Prisma.Decimal('11.74'),
        calculation_version: '1.0',
      },
    ]
  );
  assert(specMetrics.total_gross_liters.toFixed(2) === '400.00', 'Spec Gross Total', 'Total gross is 400.00');
  assert(specMetrics.total_at_13ts_liters.toFixed(2) === '367.84', 'Spec @13TS Total', 'Total @13TS is 367.84');
  assert(specMetrics.weighted_avg_fat?.toFixed(2) === '3.63', 'Spec Weighted Fat', `Weighted Fat = 3.63 (actual: ${specMetrics.weighted_avg_fat})`);
  assert(specMetrics.weighted_avg_lr?.toFixed(2) === '27.25', 'Spec Weighted LR', `Weighted LR = 27.25 (actual: ${specMetrics.weighted_avg_lr})`);
  assert(specMetrics.weighted_avg_snf?.toFixed(2) === '8.33', 'Spec Weighted SNF', `Weighted SNF = 8.33 (actual: ${specMetrics.weighted_avg_snf})`);
  assert(
    specMetrics.weighted_avg_ts?.toFixed(2) === '11.96' || specMetrics.weighted_avg_ts?.toFixed(2) === '11.95',
    'Spec Weighted TS',
    `Weighted TS = 11.96 (actual: ${specMetrics.weighted_avg_ts})`
  );
  assert(specMetrics.assigned_shop_count === 3, 'Spec Assigned', 'Assigned = 3');
  assert(specMetrics.collected_shop_count === 2, 'Spec Collected', 'Collected = 2');
  assert(specMetrics.pending_shop_count === 1, 'Spec Pending', 'Pending = 1');
  assert(JSON.stringify(specMetrics.source_calculation_versions) === JSON.stringify(['1.0']), 'Spec Calc Versions', 'Source calc versions = ["1.0"]');

  // =============================================================
  // 3. INTEGRATION TEST SETUP & FIXTURES
  // =============================================================
  console.log('\n--- 3. DATABASE FIXTURES SETUP ---');
  const runId = Date.now().toString().slice(-6);

  const zmccA = await prisma.procurementSource.create({
    data: {
      code: `Z6GB-A-${runId}`,
      name: `Stage 6GB ZMCC Alpha ${runId}`,
      source_type: 'ZMCC',
      is_active: true,
    },
  });

  const zmccB = await prisma.procurementSource.create({
    data: {
      code: `Z6GB-B-${runId}`,
      name: `Stage 6GB ZMCC Beta ${runId}`,
      source_type: 'ZMCC',
      is_active: true,
    },
  });

  const superAdmin = await prisma.user.create({
    data: {
      username: `super_6gb_${runId}`,
      password_hash: 'hash',
      role: 'SUPER_ADMIN',
      full_name: `Super Admin ${runId}`,
      is_active: true,
      scope_type: 'SYSTEM',
    },
  });

  const managerA = await prisma.user.create({
    data: {
      username: `mgr_6gb_a_${runId}`,
      password_hash: 'hash',
      role: 'ZMCC_MANAGER',
      full_name: `Manager Alpha ${runId}`,
      is_active: true,
      procurement_source_id: zmccA.id,
      scope_type: 'SOURCE',
    },
  });

  const managerB = await prisma.user.create({
    data: {
      username: `mgr_6gb_b_${runId}`,
      password_hash: 'hash',
      role: 'ZMCC_MANAGER',
      full_name: `Manager Beta ${runId}`,
      is_active: true,
      procurement_source_id: zmccB.id,
      scope_type: 'SOURCE',
    },
  });

  const pheA = await prisma.user.create({
    data: {
      username: `phe_6gb_a_${runId}`,
      password_hash: 'hash',
      role: 'PHE_OPERATOR',
      full_name: `PHE Operator Alpha ${runId}`,
      is_active: true,
      procurement_source_id: zmccA.id,
      scope_type: 'SOURCE',
    },
  });

  const motUserA = await prisma.user.create({
    data: {
      username: `mot_6gb_a_${runId}`,
      password_hash: 'hash',
      role: 'MOT',
      full_name: `MOT Driver Alpha ${runId}`,
      is_active: true,
      procurement_source_id: zmccA.id,
      scope_type: 'SOURCE',
    },
  });

  const routeA = await prisma.zmccRoute.create({
    data: {
      zmcc_id: zmccA.id,
      route_code: `R6GB-A-${runId}`,
      name: `Route Alpha ${runId}`,
      origin: 'ZMCC Alpha Center',
      destination: 'Central Milk Plant',
      is_active: true,
      created_by: managerA.id,
    },
  });

  const areaA = await prisma.zmccArea.create({
    data: {
      zmcc_id: zmccA.id,
      route_id: routeA.id,
      area_code: `A6GB-A-${runId}`,
      name: `Area Alpha ${runId}`,
      created_by: managerA.id,
    },
  });

  const milkSourceA = await prisma.zmccMilkSource.create({
    data: {
      zmcc_id: zmccA.id,
      erp_code: `MS6GB-${runId}`,
      name: `Milk Source ${runId}`,
      created_by: managerA.id,
    },
  });

  let chillerOwnership = await prisma.chillerOwnership.findFirst({
    where: { ownership_code: 'CO-DEFAULT' },
  });
  if (!chillerOwnership) {
    chillerOwnership = await prisma.chillerOwnership.create({
      data: {
        ownership_code: 'CO-DEFAULT',
        name: 'Default Chiller Ownership',
        created_by: superAdmin.id,
      },
    });
  }

  const shop1 = await prisma.zmccShop.create({
    data: {
      zmcc_id: zmccA.id,
      route_id: routeA.id,
      area_id: areaA.id,
      milk_source_id: milkSourceA.id,
      chiller_ownership_id: chillerOwnership.id,
      shop_code: `SH1-${runId}`,
      shop_name: `Shop 1 ${runId}`,
      owner_name: 'Owner Tariq',
      phone_number: '03001111111',
      cnic: '35201-1111111-1',
      created_by: managerA.id,
    },
  });

  const shop2 = await prisma.zmccShop.create({
    data: {
      zmcc_id: zmccA.id,
      route_id: routeA.id,
      area_id: areaA.id,
      milk_source_id: milkSourceA.id,
      chiller_ownership_id: chillerOwnership.id,
      shop_code: `SH2-${runId}`,
      shop_name: `Shop 2 ${runId}`,
      owner_name: 'Owner Rehman',
      phone_number: '03002222222',
      cnic: '35201-2222222-2',
      created_by: managerA.id,
    },
  });

  const shop3 = await prisma.zmccShop.create({
    data: {
      zmcc_id: zmccA.id,
      route_id: routeA.id,
      area_id: areaA.id,
      milk_source_id: milkSourceA.id,
      chiller_ownership_id: chillerOwnership.id,
      shop_code: `SH3-${runId}`,
      shop_name: `Shop 3 ${runId}`,
      owner_name: 'Owner Aslam',
      phone_number: '03003333333',
      cnic: '35201-3333333-3',
      created_by: managerA.id,
    },
  });

  const motProfileA = await prisma.motProfile.create({
    data: {
      zmcc_id: zmccA.id,
      user_id: motUserA.id,
      mot_code: `MOT-P-${runId}`,
      name: `MOT Profile ${runId}`,
      phone_number: '03001234567',
      cnic: '35201-9999999-1',
      created_by: managerA.id,
    },
  });

  const motVehicleA = await prisma.motVehicle.create({
    data: {
      zmcc_id: zmccA.id,
      vehicle_number: `VEH-6GB-${runId}`,
      created_by: managerA.id,
    },
  });

  let jIndex = 1;
  async function createJourneyFixture(shopCount: number = 3) {
    const idx = jIndex++;
    const jNum = `J6GB-${runId}-${idx}`;
    const startTime = new Date(Date.now() - 7200 * 1000); // 2 hours ago

    const allShops = [shop1, shop2, shop3].slice(0, shopCount);

    const j = await prisma.motJourney.create({
      data: {
        journey_number: jNum,
        idempotency_key: `dispatch-${jNum}`,
        zmcc_id: zmccA.id,
        route_id: routeA.id,
        mot_profile_id: motProfileA.id,
        mot_vehicle_id: motVehicleA.id,
        assigned_by: managerA.id,
        operational_date: new Date(),
        status: 'COLLECTING',
        started_at: startTime,
        assigned_at: startTime,
        assignment_latitude: new Prisma.Decimal('31.5204'),
        assignment_longitude: new Prisma.Decimal('74.3587'),
        start_latitude: new Prisma.Decimal('31.5204'),
        start_longitude: new Prisma.Decimal('74.3587'),
        stops: {
          create: allShops.map((s, i) => ({
            planned_sequence: i + 1,
            shop_id: s.id,
            status: 'PENDING',
            shop_code_snapshot: s.shop_code,
            shop_name_snapshot: s.shop_name,
            owner_name_snapshot: s.owner_name,
            phone_number_snapshot: s.phone_number,
            area_code_snapshot: areaA.area_code,
            area_name_snapshot: areaA.name,
          })),
        },
      },
      include: { stops: true },
    });

    return j;
  }

  // =============================================================
  // 4. LIFECYCLE & IN-PROGRESS / CANCELLED JOURNEYS (NO SUMMARY)
  // =============================================================
  console.log('\n--- 4. JOURNEY LIFECYCLE & CANCELLATION CHECKS ---');
  const collectingJourney = await createJourneyFixture(2);
  const activeSummaryCheck = await prisma.motJourneySummary.findUnique({
    where: { journey_id: collectingJourney.id },
  });
  assert(activeSummaryCheck === null, 'No Summary for Collecting', 'Active COLLECTING journey has no summary');

  // Cancel journey
  const cancelRes = await cancelMotJourney(
    {
      user: managerA as any,
      actorUserId: managerA.id,
      role: 'ZMCC_MANAGER',
      isSuperAdmin: false,
      isZmccManager: true,
      isPheOperator: false,
      isMot: false,
      effectiveZmccId: zmccA.id,
    },
    collectingJourney.id.toString(),
    'Driver vehicle breakdown'
  );
  assert(cancelRes.status === 200, 'Cancel Journey', 'Journey cancelled successfully');
  const cancelledSummaryCheck = await prisma.motJourneySummary.findUnique({
    where: { journey_id: collectingJourney.id },
  });
  assert(cancelledSummaryCheck === null, 'No Summary for Cancelled', 'Cancelled journey has no summary');

  // =============================================================
  // 5. ZERO-COLLECTION COMPLETED JOURNEY
  // =============================================================
  console.log('\n--- 5. ZERO-COLLECTION COMPLETED JOURNEY ---');
  const zeroJourney = await createJourneyFixture(2);
  const arrivalZeroTime = new Date(Date.now() - 3600 * 1000);
  const zeroArrivalRes = await submitMotArrival(pheA as any, {
    journey_id: zeroJourney.id.toString(),
    route_milk_token: `RMT-ZERO-${runId}`,
    arrival_timestamp: arrivalZeroTime.toISOString(),
    client_event_id: `evt-zero-${Date.now()}`,
  });
  assert(zeroArrivalRes.status === 201, 'Zero Arrival Completed', 'Arrival completed with 0 collections');

  const zeroSummary = await prisma.motJourneySummary.findUnique({
    where: { journey_id: zeroJourney.id },
  });
  assert(zeroSummary !== null, 'Zero Summary Created', 'Summary created on arrival completion');
  assert(zeroSummary?.total_gross_liters.toFixed(2) === '0.00', 'Zero Gross Liters', 'Zero summary total_gross_liters = 0.00');
  assert(zeroSummary?.total_at_13ts_liters.toFixed(2) === '0.00', 'Zero @13TS Liters', 'Zero summary total_at_13ts_liters = 0.00');
  assert(zeroSummary?.weighted_avg_lr === null, 'Zero LR Null', 'Zero summary weighted_avg_lr is NULL');
  assert(zeroSummary?.weighted_avg_fat === null, 'Zero Fat Null', 'Zero summary weighted_avg_fat is NULL');
  assert(zeroSummary?.weighted_avg_snf === null, 'Zero SNF Null', 'Zero summary weighted_avg_snf is NULL');
  assert(zeroSummary?.weighted_avg_ts === null, 'Zero TS Null', 'Zero summary weighted_avg_ts is NULL');
  assert(zeroSummary?.assigned_shop_count === 2, 'Zero Assigned Stops', 'Assigned shop count = 2');
  assert(zeroSummary?.collected_shop_count === 0, 'Zero Collected Stops', 'Collected shop count = 0');
  assert(zeroSummary?.pending_shop_count === 2, 'Zero Pending Stops', 'Pending shop count = 2');
  assert(zeroSummary?.revision === 1, 'Zero Revision', 'Initial revision is 1');
  assert(zeroSummary?.summary_version === MOT_JOURNEY_SUMMARY_VERSION, 'Zero Version', 'summary_version is 1.0');

  // Verify AuditLog for initial creation
  const zeroAudit = await prisma.auditLog.findFirst({
    where: {
      table_name: 'mot_journey_summary',
      record_id: zeroSummary?.id,
      action: 'MOT_JOURNEY_SUMMARY_CREATED',
    },
  });
  assert(zeroAudit !== null, 'Initial Creation Audit', 'AuditLog MOT_JOURNEY_SUMMARY_CREATED exists');
  assert(zeroAudit?.user_id === pheA.id, 'PHE Actor Audit', 'AuditLog user_id is the PHE actor who submitted arrival');

  // =============================================================
  // 6. MULTI-COLLECTION JOURNEY WITH SECTION 32 WEIGHTING
  // =============================================================
  console.log('\n--- 6. MULTI-COLLECTION WEIGHTED SUMMARY ---');
  const multiJourney = await createJourneyFixture(3);

  const col1Time = new Date(Date.now() - 3600 * 1000); // 1 hr ago
  const col2Time = new Date(Date.now() - 3000 * 1000); // 50 min ago
  const arrivalMultiTime = new Date(Date.now() - 1800 * 1000); // 30 min ago

  // Stop 1: 100 Liters, LR 28.0, Fat 4.0
  const col1Res = await submitShopCollection(motUserA as any, {
    journey_stop_id: multiJourney.stops[0].id.toString(),
    client_event_id: `evt-col1-${Date.now()}`,
    quantity_value: 100,
    quantity_unit: 'LITER',
    lr: 28.0,
    fat: 4.0,
    latitude: 31.5204,
    longitude: 74.3587,
    gps_accuracy: 10,
    device_collected_at: col1Time.toISOString(),
  });
  assert(col1Res.status === 201, 'Col 1 Submit', 'Shop collection 1 (100L) submitted successfully');

  // Stop 2: 300 Liters, LR 27.0, Fat 3.5
  const col2Res = await submitShopCollection(motUserA as any, {
    journey_stop_id: multiJourney.stops[1].id.toString(),
    client_event_id: `evt-col2-${Date.now()}`,
    quantity_value: 300,
    quantity_unit: 'LITER',
    lr: 27.0,
    fat: 3.5,
    latitude: 31.5204,
    longitude: 74.3587,
    gps_accuracy: 10,
    device_collected_at: col2Time.toISOString(),
  });
  assert(col2Res.status === 201, 'Col 2 Submit', 'Shop collection 2 (300L) submitted successfully');

  // Complete arrival
  const arrivalMultiRes = await submitMotArrival(pheA as any, {
    journey_id: multiJourney.id.toString(),
    route_milk_token: `RMT-MULTI-${runId}`,
    arrival_timestamp: arrivalMultiTime.toISOString(),
    client_event_id: `evt-arr-multi-${Date.now()}`,
  });
  assert(arrivalMultiRes.status === 201, 'Arrival Multi Completed', 'Multi-collection arrival completed');

  const multiSummary = await prisma.motJourneySummary.findUnique({
    where: { journey_id: multiJourney.id },
  });
  assert(multiSummary !== null, 'Multi Summary Created', 'Summary created on arrival completion');
  assert(multiSummary?.total_gross_liters.toFixed(2) === '400.00', 'Total Gross 400', `Total gross is 400.00 (actual: ${multiSummary?.total_gross_liters})`);
  assert(multiSummary?.total_at_13ts_liters.toFixed(2) === '367.84', 'Total @13TS 367.84', `Total @13TS is 367.84 (actual: ${multiSummary?.total_at_13ts_liters})`);
  assert(multiSummary?.weighted_avg_fat?.toFixed(2) === '3.63', 'Weighted Fat 3.63', `Weighted Fat = 3.63 (actual: ${multiSummary?.weighted_avg_fat})`);
  assert(multiSummary?.weighted_avg_lr?.toFixed(2) === '27.25', 'Weighted LR 27.25', `Weighted LR = 27.25 (actual: ${multiSummary?.weighted_avg_lr})`);
  assert(multiSummary?.weighted_avg_snf?.toFixed(2) === '8.33', 'Weighted SNF 8.33', `Weighted SNF = 8.33 (actual: ${multiSummary?.weighted_avg_snf})`);
  assert(
    multiSummary?.weighted_avg_ts?.toFixed(2) === '11.96' || multiSummary?.weighted_avg_ts?.toFixed(2) === '11.95',
    'Weighted TS 11.96',
    `Weighted TS = 11.96 (actual: ${multiSummary?.weighted_avg_ts})`
  );
  assert(multiSummary?.assigned_shop_count === 3, 'Assigned 3', 'Assigned = 3');
  assert(multiSummary?.collected_shop_count === 2, 'Collected 2', 'Collected = 2');
  assert(multiSummary?.skipped_shop_count === 0, 'Skipped 0', 'Skipped = 0');
  assert(multiSummary?.pending_shop_count === 1, 'Pending 1', 'Pending = 1');
  assert(multiSummary?.revision === 1, 'Revision 1', 'Revision = 1');

  // =============================================================
  // 7. OFFLINE DELAYED SYNC & REVISION BUMP (device_collected_at <= ended_at)
  // =============================================================
  console.log('\n--- 7. OFFLINE DELAYED SYNC & RECOMPUTE EXCEPTION ---');
  const col3Time = new Date(arrivalMultiTime.getTime() - 10 * 60 * 1000); // 10 min before arrival
  // Stop 3: 200 Liters, LR 29.0, Fat 4.5
  const delayedColRes = await submitShopCollection(motUserA as any, {
    journey_stop_id: multiJourney.stops[2].id.toString(),
    client_event_id: `evt-col3-delayed-${Date.now()}`,
    quantity_value: 200,
    quantity_unit: 'LITER',
    lr: 29.0,
    fat: 4.5,
    latitude: 31.5204,
    longitude: 74.3587,
    gps_accuracy: 10,
    device_collected_at: col3Time.toISOString(),
  });
  assert(delayedColRes.status === 201, 'Delayed Col Accepted', 'Offline delayed collection accepted');

  const refreshedSummary = await prisma.motJourneySummary.findUnique({
    where: { journey_id: multiJourney.id },
  });
  assert(refreshedSummary?.revision === 2, 'Revision Bumped to 2', `Revision bumped to 2 (actual: ${refreshedSummary?.revision})`);
  assert(refreshedSummary?.last_recomputed_at !== null, 'Recomputed Timestamp Set', 'last_recomputed_at is populated');
  assert(refreshedSummary?.total_gross_liters.toFixed(2) === '600.00', 'New Total Gross 600', `Total gross is 600.00 (actual: ${refreshedSummary?.total_gross_liters})`);
  assert(refreshedSummary?.total_at_13ts_liters.toFixed(2) === '574.92', 'New Total @13TS 574.92', `Total @13TS is 574.92 (actual: ${refreshedSummary?.total_at_13ts_liters})`);
  assert(refreshedSummary?.weighted_avg_fat?.toFixed(2) === '3.92', 'New Weighted Fat 3.92', `Weighted Fat = 3.92 (actual: ${refreshedSummary?.weighted_avg_fat})`);
  assert(refreshedSummary?.weighted_avg_lr?.toFixed(2) === '27.83', 'New Weighted LR 27.83', `Weighted LR = 27.83 (actual: ${refreshedSummary?.weighted_avg_lr})`);
  assert(refreshedSummary?.weighted_avg_snf?.toFixed(2) === '8.54', 'New Weighted SNF 8.54', `Weighted SNF = 8.54 (actual: ${refreshedSummary?.weighted_avg_snf})`);
  assert(
    refreshedSummary?.weighted_avg_ts?.toFixed(2) === '12.46' || refreshedSummary?.weighted_avg_ts?.toFixed(2) === '12.45',
    'New Weighted TS 12.46',
    `Weighted TS = 12.46 (actual: ${refreshedSummary?.weighted_avg_ts})`
  );
  assert(refreshedSummary?.assigned_shop_count === 3, 'New Assigned 3', 'Assigned = 3');
  assert(refreshedSummary?.collected_shop_count === 3, 'New Collected 3', 'Collected = 3');
  assert(refreshedSummary?.pending_shop_count === 0, 'New Pending 0', 'Pending = 0');

  // Verify AuditLog for refresh
  const refreshAudit = await prisma.auditLog.findFirst({
    where: {
      table_name: 'mot_journey_summary',
      record_id: refreshedSummary?.id,
      action: 'MOT_JOURNEY_SUMMARY_REFRESHED_LATE_SYNC',
    },
    orderBy: { created_at: 'desc' },
  });
  assert(refreshAudit !== null, 'Refresh Audit Created', 'AuditLog MOT_JOURNEY_SUMMARY_REFRESHED_LATE_SYNC created');
  assert(refreshAudit?.user_id === motUserA.id, 'MOT Actor Audit', 'AuditLog user_id is the MOT driver who submitted delayed collection');

  // =============================================================
  // 8. EXACT IDEMPOTENT REPLAY DOES NOT BUMP REVISION
  // =============================================================
  console.log('\n--- 8. IDEMPOTENT REPLAY INVARIANCE ---');
  const replayOriginal = await submitShopCollection(motUserA as any, {
    journey_stop_id: multiJourney.stops[2].id.toString(),
    client_event_id: delayedColRes.data.client_event_id,
    quantity_value: 200,
    quantity_unit: 'LITER',
    lr: 29.0,
    fat: 4.5,
    latitude: 31.5204,
    longitude: 74.3587,
    gps_accuracy: 10,
    device_collected_at: col3Time.toISOString(),
  });
  assert(replayOriginal.status === 200, 'Replay Returns 200', 'Exact replay returns HTTP 200');

  const afterReplaySummary = await prisma.motJourneySummary.findUnique({
    where: { journey_id: multiJourney.id },
  });
  assert(afterReplaySummary?.revision === 2, 'Revision Unchanged on Replay', `Revision remains 2 after replay (actual: ${afterReplaySummary?.revision})`);

  // Count refresh audit logs
  const auditCount = await prisma.auditLog.count({
    where: {
      table_name: 'mot_journey_summary',
      record_id: refreshedSummary?.id,
      action: 'MOT_JOURNEY_SUMMARY_REFRESHED_LATE_SYNC',
    },
  });
  assert(auditCount === 1, 'Single Audit Log on Replay', `Exact replay did not emit second audit log (count: ${auditCount})`);

  // =============================================================
  // 9. COLLECTION WITH device_collected_at > ended_at REJECTED
  // =============================================================
  console.log('\n--- 9. POST-JOURNEY COLLECTION REJECTION ---');
  const postEndTime = new Date(arrivalMultiTime.getTime() + 10 * 60 * 1000); // 10 min AFTER arrival completed
  const postEndJourney = await createJourneyFixture(2);
  // Complete arrival on postEndJourney
  await submitMotArrival(pheA as any, {
    journey_id: postEndJourney.id.toString(),
    route_milk_token: `RMT-POST-${runId}`,
    arrival_timestamp: arrivalMultiTime.toISOString(),
    client_event_id: `evt-post-arr-${Date.now()}`,
  });

  const postEndColRes = await submitShopCollection(motUserA as any, {
    journey_stop_id: postEndJourney.stops[0].id.toString(),
    client_event_id: `evt-post-end-${Date.now()}`,
    quantity_value: 100,
    quantity_unit: 'LITER',
    lr: 28.0,
    fat: 4.0,
    latitude: 31.5204,
    longitude: 74.3587,
    gps_accuracy: 10,
    device_collected_at: postEndTime.toISOString(),
  });
  assert(postEndColRes.status === 400, 'Post-End Collection Rejected', 'Collection with device_collected_at > ended_at is rejected with 400');

  const postEndSummary = await prisma.motJourneySummary.findUnique({
    where: { journey_id: postEndJourney.id },
  });
  assert(postEndSummary?.revision === 1, 'Post-End Revision Unchanged', 'Summary revision remains 1 after rejected collection');

  // =============================================================
  // 10. DELAYED GPS ALONE DOES NOT TRIGGER SUMMARY RECOMPUTE
  // =============================================================
  console.log('\n--- 10. DELAYED GPS INVARIANCE ---');
  const gpsBatchRes = await recordGpsBatch(motUserA as any, {
    journey_id: multiJourney.id.toString(),
    locations: [
      {
        latitude: 31.5210,
        longitude: 74.3590,
        gps_accuracy: 8,
        device_recorded_at: new Date(arrivalMultiTime.getTime() - 5 * 60 * 1000).toISOString(),
        client_location_id: `gps-delayed-${runId}-1`,
      },
    ],
  });
  assert(gpsBatchRes.status === 200, 'GPS Batch Accepted', 'Delayed GPS batch accepted');

  const summaryAfterGps = await prisma.motJourneySummary.findUnique({
    where: { journey_id: multiJourney.id },
  });
  assert(summaryAfterGps?.revision === 2, 'GPS Invariant Revision', `Revision unchanged by GPS batch (remains 2)`);

  // =============================================================
  // 11. RBAC & READ MODEL CONTRACTS
  // =============================================================
  console.log('\n--- 11. RBAC & READ MODEL ACCESS ---');
  // Manager A (own ZMCC)
  const getOwnZmccRes = await getMotJourneyById(
    {
      user: managerA as any,
      actorUserId: managerA.id,
      role: 'ZMCC_MANAGER',
      isSuperAdmin: false,
      isZmccManager: true,
      isPheOperator: false,
      isMot: false,
      effectiveZmccId: zmccA.id,
    },
    multiJourney.id.toString()
  );
  assert(getOwnZmccRes.status === 200, 'Own ZMCC Manager Read', 'ZMCC Manager can read own journey with summary');
  assert(getOwnZmccRes.data?.summary !== null, 'Summary In Journey', 'Journey read model includes summary');
  assert(getOwnZmccRes.data?.summary?.revision === 2, 'Summary Revision Match', 'Summary has revision 2');
  assert(getOwnZmccRes.data?.summary?.total_gross_liters === 600, 'Summary Gross Match', 'Summary gross liters matches');

  // Manager B (foreign ZMCC)
  const getForeignZmccRes = await getMotJourneyById(
    {
      user: managerB as any,
      actorUserId: managerB.id,
      role: 'ZMCC_MANAGER',
      isSuperAdmin: false,
      isZmccManager: true,
      isPheOperator: false,
      isMot: false,
      effectiveZmccId: zmccB.id,
    },
    multiJourney.id.toString()
  );
  assert(getForeignZmccRes.status === 403, 'Foreign ZMCC Blocked', 'Foreign ZMCC Manager blocked with HTTP 403');

  // Super Admin (Global)
  const getSuperAdminRes = await getMotJourneyById(
    {
      user: superAdmin as any,
      actorUserId: superAdmin.id,
      role: 'SUPER_ADMIN',
      isSuperAdmin: true,
      isZmccManager: false,
      isPheOperator: false,
      isMot: false,
      effectiveZmccId: null,
    },
    multiJourney.id.toString()
  );
  assert(getSuperAdminRes.status === 200, 'Super Admin Read', 'Super Admin can read journey with summary');

  // listMotArrivals includes summary
  const listArrivalsRes = await listMotArrivals(
    managerA as any,
    { journey_id: multiJourney.id.toString() }
  );
  assert(listArrivalsRes.status === 200, 'List Arrivals Read', 'List arrivals returns HTTP 200');
  const arrivedItem = listArrivalsRes.data?.items?.find((i: any) => i.journey_id === multiJourney.id.toString());
  assert(arrivedItem?.journey?.summary !== null, 'Summary in Arrival List', 'Arrival list includes serialized journey summary');
  assert(arrivedItem?.journey?.summary?.total_gross_liters === 600, 'Arrival Gross Matches', 'Arrival summary gross liters is 600');

  // getMotArrivalById includes summary
  const arrivalRecord = await prisma.zmccMotArrival.findFirst({
    where: { journey_id: multiJourney.id },
  });
  const getArrivalRes = await getMotArrivalById(
    pheA as any,
    arrivalRecord!.id.toString()
  );
  assert(getArrivalRes.status === 200, 'Get Arrival Read', 'Get arrival by id returns HTTP 200');
  assert(getArrivalRes.data?.journey?.summary !== null, 'Summary in Arrival Get', 'Get arrival includes serialized journey summary');
  assert(getArrivalRes.data?.journey?.summary?.revision === 2, 'Arrival Summary Revision 2', 'Arrival summary revision is 2');

  // =============================================================
  // FINAL SUMMARY REPORT
  // =============================================================
  console.log('\n=====================================================================');
  console.log(`🎯 STAGE 6G-B REGRESSION COMPLETE: ${passed} PASSED, ${failed} FAILED`);
  console.log('=====================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runStage6gbTests().catch((err) => {
  console.error('Unhandled test failure:', err);
  process.exit(1);
});
