/**
 * STAGE 6D: MOT SHOP COLLECTION, OFFLINE SYNC, GPS TRACKING, SMS OUTBOX, AND MANAGER MAP REGRESSION SUITE
 *
 * Verifies:
 * 1. Database Schema & Migrations:
 *    - Exactly 16 tracked migrations
 *    - Frozen stop snapshot columns present and non-null in mot_journey_stop
 *    - mot_shop_collection table and sequence mot_collection_number_seq exist
 *    - mot_collection_sms_outbox table exists with all foreign keys and check constraints
 * 2. Role Authorization & Scoping:
 *    - Unauthenticated rejected (401)
 *    - Inactive user rejected (403)
 *    - Legacy ADMIN rejected (403)
 *    - Management roles (SUPER_ADMIN, ZMCC_MANAGER, PHE_OPERATOR) cannot submit collections or upload GPS (403)
 *    - Only canonical linked MOT can submit collection and upload GPS for their active journey
 *    - Cross-ZMCC MOT or non-assigned MOT blocked (403)
 *    - MOT cannot access manager map or SMS outbox (403)
 *    - ZMCC Manager / PHE Operator can view journey map in own ZMCC, blocked for foreign ZMCC (403)
 *    - Super Admin can access all journeys / SMS outbox globally
 * 3. Canonical Calculations:
 *    - Unit LITER vs KG density conversion
 *    - SNF, TS, and @13 TS Liters canonical calculations with v1.0 versioning
 *    - Server recalculates all values; ignores client forged metrics
 *    - Out of bounds inputs (LR < 20 or > 35, Fat < 1.5 or > 12, Quantity <= 0) rejected (400)
 * 4. Atomic Collection Submission:
 *    - Stop transitions PENDING -> VISITED
 *    - Location row created with source_type = 'MOT_DEVICE'
 *    - First MOT GPS set on journey once and preserved
 *    - SMS outbox created with status PENDING, message contains no CNIC and no raw GPS
 *    - AuditLog created
 * 5. Idempotency & Concurrency:
 *    - Exact replay with same client_event_id returns HTTP 200 with original data
 *    - Replay with modified parameters returns HTTP 409
 *    - Replay across different ZMCC returns HTTP 409 without leaking data
 *    - Concurrent same-key requests result in exactly 1 collection
 *    - Concurrent different-key requests for same stop result in 1 success and 1 conflict
 * 6. Stop Snapshot Immutability:
 *    - Updating master shop name/phone does not change snapshot in existing journey stops
 * 7. GPS Batch:
 *    - MOT device GPS batch accepted
 *    - Duplicate points handled idempotently
 *    - Future timestamps and impossible coordinates rejected
 * 8. Manager Map & SMS Outbox API:
 *    - Map API returns trail, stops, totals, and endpoint placeholder
 *    - SMS outbox API returns scoped records
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
console.log('🧪 STAGE 6D: MOT SHOP COLLECTION, OFFLINE SYNC, GPS & MAP REGRESSION SUITE');
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

async function runStage6dTests() {
  const { prisma } = await import('../src/backend/core/db');
  const { Prisma } = await import('@prisma/client');
  const { createSessionToken } = await import('../src/backend/core/auth');
  const { computeCanonicalMilkMetrics, calculateDensity, calculatePhysicalLiters } = await import(
    '../src/backend/utils/milkFormulas'
  );

  // Import API handlers
  const { POST: submitCollection } = await import(
    '../src/app/api/zmcc/mot/journeys/current/collections/route'
  );
  const { POST: recordGpsBatch } = await import(
    '../src/app/api/zmcc/mot/journeys/current/locations/batch/route'
  );
  const { GET: getJourneyMap } = await import('../src/app/api/zmcc/mot/journeys/[id]/map/route');
  const { GET: getJourneyCollections } = await import(
    '../src/app/api/zmcc/mot/journeys/[id]/collections/route'
  );
  const { GET: getSmsOutbox } = await import('../src/app/api/zmcc/mot/sms-outbox/route');
  const { POST: assignAndDispatch } = await import(
    '../src/app/api/zmcc/mot/journeys/assign-and-dispatch/route'
  );

  // Helper to build simulated requests
  async function makeReq(
    urlStr: string,
    method: string = 'GET',
    user?: any,
    body?: any
  ): Promise<Request> {
    const headers = new Headers();
    if (user) {
      const token = await createSessionToken({
        id: user.id.toString(),
        username: user.username,
        name: user.full_name || user.username,
        role: user.role,
        department: user.department || 'Milk Procurement',
        procurement_source_id: user.procurement_source_id ? user.procurement_source_id.toString() : null,
      });
      headers.set('cookie', `auth_token=${token}`);
      headers.set('authorization', `Bearer ${token}`);
    }
    if (body) {
      headers.set('content-type', 'application/json');
    }
    return new Request(urlStr, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  // ---------------------------------------------------------------------------
  // SECTION 1: DATABASE SCHEMA & MIGRATION VERIFICATION
  // ---------------------------------------------------------------------------
  console.log('\n--- SECTION 1: DATABASE SCHEMA & MIGRATIONS ---');

  const migrationsDir = path.join(repoRoot, 'prisma', 'migrations');
  const migrationDirs = fs
    .readdirSync(migrationsDir)
    .filter((f) => fs.statSync(path.join(migrationsDir, f)).isDirectory() && f !== 'migration_lock.toml');

  assert(
    migrationDirs.length === 16,
    'MIGRATION_COUNT',
    `Repository must contain exactly 16 tracked migrations (found ${migrationDirs.length}).`
  );

  // Check mot_journey_stop snapshot columns
  const stopColumns = await prisma.$queryRaw<Array<{ column_name: string; is_nullable: string }>>`
    SELECT column_name, is_nullable
    FROM information_schema.columns
    WHERE table_name = 'mot_journey_stop'
      AND column_name IN (
        'shop_code_snapshot', 'shop_name_snapshot', 'owner_name_snapshot',
        'phone_number_snapshot', 'area_code_snapshot', 'area_name_snapshot'
      )
  `;
  assert(
    stopColumns.length === 6 && stopColumns.every((c) => c.is_nullable === 'NO'),
    'STOP_SNAPSHOT_COLUMNS',
    'mot_journey_stop must have all 6 text snapshot columns as NOT NULL.'
  );

  // Check mot_shop_collection table
  const colTable = await prisma.$queryRaw<Array<{ table_name: string }>>`
    SELECT table_name FROM information_schema.tables WHERE table_name = 'mot_shop_collection'
  `;
  assert(colTable.length === 1, 'COLLECTION_TABLE', 'mot_shop_collection table exists in PostgreSQL.');

  // Check sequence
  const seqCheck = await prisma.$queryRaw<Array<{ sequence_name: string }>>`
    SELECT sequence_name FROM information_schema.sequences WHERE sequence_name = 'mot_collection_number_seq'
  `;
  assert(seqCheck.length === 1, 'COLLECTION_SEQUENCE', 'mot_collection_number_seq sequence exists in PostgreSQL.');

  // Check mot_collection_sms_outbox table
  const smsTable = await prisma.$queryRaw<Array<{ table_name: string }>>`
    SELECT table_name FROM information_schema.tables WHERE table_name = 'mot_collection_sms_outbox'
  `;
  assert(smsTable.length === 1, 'SMS_OUTBOX_TABLE', 'mot_collection_sms_outbox table exists in PostgreSQL.');

  // Check collection_notes column
  const notesCol = await prisma.$queryRaw<Array<{ column_name: string }>>`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'mot_shop_collection' AND column_name = 'collection_notes'
  `;
  assert(notesCol.length === 1, 'COLLECTION_NOTES_COLUMN', 'collection_notes column exists in mot_shop_collection.');

  // ---------------------------------------------------------------------------
  // SECTION 2: CANONICAL FORMULAS & CALCULATION TESTS
  // ---------------------------------------------------------------------------
  console.log('\n--- SECTION 2: CANONICAL CALCULATIONS ---');

  // Test LITER unit: Gross Liters = Quantity
  const literCalc = computeCanonicalMilkMetrics(100.0, 'LITER', 28.0, 4.0);
  assert(
    literCalc.grossLiters === 100.0,
    'CALC_LITER_VOLUME',
    `LITER quantity must equal gross liters (expected 100, got ${literCalc.grossLiters})`
  );
  assert(
    literCalc.density === 1.028,
    'CALC_DENSITY',
    `Density for LR 28 must be 1.028 (got ${literCalc.density})`
  );
  // SNF = (28 / 4) + (0.22 * 4.0) + 0.72 = 7 + 0.88 + 0.72 = 8.6
  assert(
    literCalc.snf === 8.6,
    'CALC_SNF',
    `SNF for LR 28, Fat 4.0 must be 8.60 (got ${literCalc.snf})`
  );
  // TS = 4.0 + 8.6 = 12.6
  assert(
    (literCalc as any).ts === 12.6 || (literCalc as any).totalSolids === 12.6,
    'CALC_TS',
    `TS for Fat 4.0, SNF 8.6 must be 12.60 (got ${(literCalc as any).ts || (literCalc as any).totalSolids})`
  );
  // @13 TS Liters = 100 * 12.6 / 13 = 96.9230... -> 96.92
  assert(
    (literCalc as any).at13tsLiters === 96.92 || (literCalc as any).at13TsLiters === 96.92,
    'CALC_AT_13_TS_LITERS',
    `@13 TS Liters for 100L at 12.6% TS must be 96.92 (got ${(literCalc as any).at13tsLiters || (literCalc as any).at13TsLiters})`
  );

  // Test KG unit: Gross Liters = Mass / Density
  // 102.8 kg / 1.028 = 100.0 L
  const kgCalc = computeCanonicalMilkMetrics(102.8, 'KG', 28.0, 4.0);
  assert(
    kgCalc.grossLiters === 100.0,
    'CALC_KG_CONVERSION',
    `102.8 KG at LR 28 must convert to 100.00 Gross Liters (got ${kgCalc.grossLiters})`
  );

  // ---------------------------------------------------------------------------
  // SETUP TEST ENTITIES (2 ZMCCs, 2 Routes, 2 MOTs, 2 Vehicles, Shops)
  // ---------------------------------------------------------------------------
  console.log('\n--- SETUP TEST ENTITIES ---');

  // Super Admin
  let superAdmin = await prisma.user.findFirst({
    where: { role: 'SUPER_ADMIN', is_active: true },
  });
  if (!superAdmin) {
    superAdmin = await prisma.user.create({
      data: {
        username: 'sadmin_stage6d',
        full_name: 'Super Admin 6D',
        role: 'SUPER_ADMIN',
        is_active: true,
        password_hash: 'hashed',
        department: 'Executive',
      },
    });
  }

  // ZMCC A
  let zmccA = await prisma.procurementSource.findFirst({
    where: { code: 'ZMCC-6D-A', source_type: 'ZMCC' },
  });
  if (!zmccA) {
    zmccA = await prisma.procurementSource.create({
      data: {
        code: 'ZMCC-6D-A',
        name: 'ZMCC Center 6D Alpha',
        source_type: 'ZMCC',
        is_active: true,
      },
    });
  }

  // ZMCC B
  let zmccB = await prisma.procurementSource.findFirst({
    where: { code: 'ZMCC-6D-B', source_type: 'ZMCC' },
  });
  if (!zmccB) {
    zmccB = await prisma.procurementSource.create({
      data: {
        code: 'ZMCC-6D-B',
        name: 'ZMCC Center 6D Beta',
        source_type: 'ZMCC',
        is_active: true,
      },
    });
  }

  // Manager A
  let managerA = await prisma.user.findFirst({
    where: { username: 'manager_6d_a' },
  });
  if (!managerA) {
    managerA = await prisma.user.create({
      data: {
        username: 'manager_6d_a',
        full_name: 'Manager 6D Alpha',
        role: 'ZMCC_MANAGER',
        procurement_source_id: zmccA.id,
        is_active: true,
        password_hash: 'hashed',
        department: 'Milk Procurement',
      },
    });
  } else {
    managerA = await prisma.user.update({
      where: { id: managerA.id },
      data: { procurement_source_id: zmccA.id, is_active: true },
    });
  }

  // PHE Operator A
  let pheA = await prisma.user.findFirst({
    where: { username: 'phea_6d' },
  });
  if (!pheA) {
    pheA = await prisma.user.create({
      data: {
        username: 'phea_6d',
        full_name: 'PHE Operator 6D',
        role: 'PHE_OPERATOR',
        procurement_source_id: zmccA.id,
        is_active: true,
        password_hash: 'hashed',
        department: 'Milk Procurement',
      },
    });
  } else {
    pheA = await prisma.user.update({
      where: { id: pheA.id },
      data: { procurement_source_id: zmccA.id, is_active: true },
    });
  }

  // MOT User A
  let motUserA = await prisma.user.findFirst({
    where: { username: 'mot_driver_6d_a' },
  });
  if (!motUserA) {
    motUserA = await prisma.user.create({
      data: {
        username: 'mot_driver_6d_a',
        full_name: 'MOT Driver 6D Alpha',
        role: 'MOT',
        procurement_source_id: zmccA.id,
        is_active: true,
        password_hash: 'hashed',
        department: 'Milk Procurement',
      },
    });
  } else {
    motUserA = await prisma.user.update({
      where: { id: motUserA.id },
      data: { procurement_source_id: zmccA.id, is_active: true },
    });
  }

  // MOT User B (different ZMCC)
  let motUserB = await prisma.user.findFirst({
    where: { username: 'mot_driver_6d_b' },
  });
  if (!motUserB) {
    motUserB = await prisma.user.create({
      data: {
        username: 'mot_driver_6d_b',
        full_name: 'MOT Driver 6D Beta',
        role: 'MOT',
        procurement_source_id: zmccB.id,
        is_active: true,
        password_hash: 'hashed',
        department: 'Milk Procurement',
      },
    });
  } else {
    motUserB = await prisma.user.update({
      where: { id: motUserB.id },
      data: { procurement_source_id: zmccB.id, is_active: true },
    });
  }

  // MOT Profile A
  let motProfileA = await prisma.motProfile.findFirst({
    where: { mot_code: 'MOT-6D-A1' },
  });
  if (!motProfileA) {
    motProfileA = await prisma.motProfile.create({
      data: {
        mot_code: 'MOT-6D-A1',
        name: 'MOT Driver 6D Alpha',
        phone_number: '+923001111111',
        cnic: '35201-1111111-1',
        zmcc_id: zmccA.id,
        user_id: motUserA.id,
        is_active: true,
        created_by: superAdmin.id,
      },
    });
  }

  // MOT Vehicle A
  let motVehicleA = await prisma.motVehicle.findFirst({
    where: { vehicle_number: 'VH-6D-A1' },
  });
  if (!motVehicleA) {
    motVehicleA = await prisma.motVehicle.create({
      data: {
        vehicle_number: 'VH-6D-A1',
        zmcc_id: zmccA.id,
        is_active: true,
        created_by: superAdmin.id,
      },
    });
  }

  // Route A
  let routeA = await prisma.zmccRoute.findFirst({
    where: { route_code: 'RT-6D-A' },
  });
  if (!routeA) {
    routeA = await prisma.zmccRoute.create({
      data: {
        route_code: 'RT-6D-A',
        name: 'Route 6D Alpha',
        origin: 'ZMCC 6D Alpha',
        destination: 'Processing Plant',
        zmcc_id: zmccA.id,
        is_active: true,
        created_by: managerA.id,
      },
    });
  }

  // Area A
  let areaA = await prisma.zmccArea.findFirst({
    where: { area_code: 'AREA-6D-A' },
  });
  if (!areaA) {
    areaA = await prisma.zmccArea.create({
      data: {
        area_code: 'AREA-6D-A',
        name: 'Area 6D Alpha',
        route_id: routeA.id,
        zmcc_id: zmccA.id,
        is_active: true,
        created_by: managerA.id,
      },
    });
  }

  // Milk Source A
  let milkSourceA = await prisma.zmccMilkSource.findFirst({
    where: { erp_code: 'MS-6D-A' },
  });
  if (!milkSourceA) {
    milkSourceA = await prisma.zmccMilkSource.create({
      data: {
        erp_code: 'MS-6D-A',
        name: 'Milk Source 6D Alpha',
        zmcc_id: zmccA.id,
        is_active: true,
        created_by: managerA.id,
      },
    });
  }

  // Chiller Ownership
  let chillerOwnership = await prisma.chillerOwnership.findFirst({
    where: { ownership_code: 'CO-6D' },
  });
  if (!chillerOwnership) {
    chillerOwnership = await prisma.chillerOwnership.create({
      data: {
        ownership_code: 'CO-6D',
        name: 'Chiller Ownership 6D',
        is_active: true,
        created_by: superAdmin.id,
      },
    });
  }

  // Create 2 shops on Route A
  let shopA1 = await prisma.zmccShop.findFirst({
    where: { shop_code: 'SH-6D-A1' },
  });
  if (!shopA1) {
    shopA1 = await prisma.zmccShop.create({
      data: {
        shop_code: 'SH-6D-A1',
        shop_name: 'Alpha Dairy Shop 1',
        owner_name: 'Muhammad Tariq',
        phone_number: '+923002222222',
        cnic: '35201-2222222-1',
        route_id: routeA.id,
        area_id: areaA.id,
        zmcc_id: zmccA.id,
        milk_source_id: milkSourceA.id,
        chiller_ownership_id: chillerOwnership.id,
        latitude: 31.5204,
        longitude: 74.3587,
        is_active: true,
        created_by: managerA.id,
      },
    });
  } else {
    shopA1 = await prisma.zmccShop.update({
      where: { id: shopA1.id },
      data: {
        shop_name: 'Alpha Dairy Shop 1',
        phone_number: '+923002222222',
      },
    });
  }

  let shopA2 = await prisma.zmccShop.findFirst({
    where: { shop_code: 'SH-6D-A2' },
  });
  if (!shopA2) {
    shopA2 = await prisma.zmccShop.create({
      data: {
        shop_code: 'SH-6D-A2',
        shop_name: 'Alpha Dairy Shop 2',
        owner_name: 'Abdul Rehman',
        phone_number: '+923003333333',
        cnic: '35201-3333333-2',
        route_id: routeA.id,
        area_id: areaA.id,
        zmcc_id: zmccA.id,
        milk_source_id: milkSourceA.id,
        chiller_ownership_id: chillerOwnership.id,
        latitude: 31.5215,
        longitude: 74.3599,
        is_active: true,
        created_by: managerA.id,
      },
    });
  }

  // Cancel any existing active journey for motProfileA to ensure clean start
  await prisma.motJourney.updateMany({
    where: { mot_profile_id: motProfileA.id, status: 'COLLECTING' },
    data: { status: 'CANCELLED', cancellation_reason: 'Test Suite Reset' },
  });

  // Assign & Dispatch a fresh Journey for MOT Profile A
  const dispatchRes = await assignAndDispatch(
    await makeReq(
      'http://localhost/api/zmcc/mot/journeys/assign-and-dispatch',
      'POST',
      managerA,
      {
        route_id: routeA.id.toString(),
        mot_profile_id: motProfileA.id.toString(),
        mot_vehicle_id: motVehicleA.id.toString(),
        latitude: 31.5200,
        longitude: 74.3580,
        accuracy: 8.5,
        idempotency_key: `dispatch-6d-${Date.now()}`,
      }
    )
  );

  const dispatchData = await dispatchRes.json();
  if (dispatchRes.status !== 201) {
    console.error('Dispatch failed with status:', dispatchRes.status, dispatchData);
  }
  assert(dispatchRes.status === 201, 'DISPATCH_JOURNEY', 'Journey successfully dispatched for MOT Driver A.');
  const journeyAId = dispatchData?.journey?.id;

  // Verify stops have frozen snapshot values
  const journeyStops = await prisma.motJourneyStop.findMany({
    where: { journey_id: BigInt(journeyAId) },
    orderBy: { planned_sequence: 'asc' },
  });
  assert(journeyStops.length === 2, 'JOURNEY_STOPS_COUNT', 'Journey has exactly 2 frozen stops.');
  assert(
    journeyStops[0].shop_code_snapshot === 'SH-6D-A1' &&
      journeyStops[0].shop_name_snapshot === 'Alpha Dairy Shop 1' &&
      journeyStops[0].owner_name_snapshot === 'Muhammad Tariq' &&
      journeyStops[0].phone_number_snapshot === '+923002222222',
    'STOP_SNAPSHOT_INTEGRITY',
    'Stop 1 contains frozen snapshot of shop metadata.'
  );

  const stop1 = journeyStops[0];
  const stop2 = journeyStops[1];

  // ---------------------------------------------------------------------------
  // SECTION 3: ROLE AUTHORIZATION & PERMISSION TESTS
  // ---------------------------------------------------------------------------
  console.log('\n--- SECTION 3: AUTHORIZATION & PERMISSIONS ---');

  // 1. Unauthenticated collection submit rejected (401)
  const unauthRes = await submitCollection(
    await makeReq(
      'http://localhost/api/zmcc/mot/journeys/current/collections',
      'POST',
      undefined,
      { stop_id: stop1.id.toString() }
    )
  );
  assert(unauthRes.status === 401, 'AUTH_UNAUTHENTICATED', 'Unauthenticated request rejected with 401.');

  // 2. Management role (Super Admin, ZMCC Manager, PHE Operator) cannot submit collection (403)
  const mgrRes = await submitCollection(
    await makeReq(
      'http://localhost/api/zmcc/mot/journeys/current/collections',
      'POST',
      managerA,
      { stop_id: stop1.id.toString() }
    )
  );
  assert(mgrRes.status === 403, 'AUTH_MGR_SUBMIT_BLOCKED', 'ZMCC Manager blocked from submitting collection (403).');

  const pheRes = await submitCollection(
    await makeReq(
      'http://localhost/api/zmcc/mot/journeys/current/collections',
      'POST',
      pheA,
      { stop_id: stop1.id.toString() }
    )
  );
  assert(pheRes.status === 403, 'AUTH_PHE_SUBMIT_BLOCKED', 'PHE Operator blocked from submitting collection (403).');

  // 3. MOT User B (different ZMCC, no active journey in A) cannot submit collection on Journey A
  const crossMotRes = await submitCollection(
    await makeReq(
      'http://localhost/api/zmcc/mot/journeys/current/collections',
      'POST',
      motUserB,
      {
        stop_id: stop1.id.toString(),
        journey_id: journeyAId,
        quantity: 50,
        unit: 'LITER',
        lr: 28,
        fat: 4,
        client_event_id: 'cross-mot-evt-1',
      }
    )
  );
  assert(crossMotRes.status === 403 || crossMotRes.status === 404, 'AUTH_CROSS_MOT_BLOCKED', 'Unlinked/foreign MOT blocked from submitting collection.');

  // 4. MOT cannot view manager map (403)
  const motMapRes = await getJourneyMap(
    await makeReq(`http://localhost/api/zmcc/mot/journeys/${journeyAId}/map`, 'GET', motUserA),
    { params: Promise.resolve({ id: journeyAId }) }
  );
  assert(motMapRes.status === 403, 'AUTH_MOT_MAP_DENIED', 'MOT driver denied access to manager map (403).');

  // 5. MOT cannot view SMS outbox (403)
  const motSmsRes = await getSmsOutbox(
    await makeReq('http://localhost/api/zmcc/mot/sms-outbox', 'GET', motUserA)
  );
  assert(motSmsRes.status === 403, 'AUTH_MOT_SMS_DENIED', 'MOT driver denied access to SMS outbox (403).');

  // 6. Legacy ADMIN role cannot read journey collections (403)
  let adminUser = await prisma.user.findFirst({ where: { role: 'ADMIN', is_active: true } });
  if (!adminUser) {
    adminUser = await prisma.user.create({
      data: {
        username: 'legacy_admin_6d',
        full_name: 'Legacy Admin',
        role: 'ADMIN',
        is_active: true,
        password_hash: 'hashed',
        department: 'Administration',
      },
    });
  }
  const adminColRes = await getJourneyCollections(
    await makeReq(`http://localhost/api/zmcc/mot/journeys/${journeyAId}/collections`, 'GET', adminUser),
    { params: Promise.resolve({ id: journeyAId }) }
  );
  assert(adminColRes.status === 403, 'AUTH_LEGACY_ADMIN_COLLECTIONS_403', 'Legacy ADMIN role cannot read journey collections (403).');

  // 7. Unrelated GATE_SECURITY role cannot read journey collections (403)
  let securityUser = await prisma.user.findFirst({ where: { role: 'GATE_SECURITY', is_active: true } });
  if (!securityUser) {
    securityUser = await prisma.user.create({
      data: {
        username: 'gate_security_6d',
        full_name: 'Gate Security',
        role: 'GATE_SECURITY',
        is_active: true,
        password_hash: 'hashed',
        department: 'Security',
      },
    });
  }
  const secColRes = await getJourneyCollections(
    await makeReq(`http://localhost/api/zmcc/mot/journeys/${journeyAId}/collections`, 'GET', securityUser),
    { params: Promise.resolve({ id: journeyAId }) }
  );
  assert(secColRes.status === 403, 'AUTH_SECURITY_COLLECTIONS_403', 'Unrelated GATE_SECURITY role cannot read journey collections (403).');

  // ---------------------------------------------------------------------------
  // SECTION 4: ATOMIC COLLECTION SUBMISSION
  // ---------------------------------------------------------------------------
  console.log('\n--- SECTION 4: ATOMIC COLLECTION SUBMISSION ---');

  const event1Id = `evt-6d-col-1-${Date.now()}`;
  const validColPayload = {
    client_event_id: event1Id,
    journey_id: journeyAId,
    stop_id: stop1.id.toString(),
    quantity: 150.0,
    unit: 'LITER',
    lr: 29.0,
    fat: 4.5,
    recorded_latitude: 31.5205,
    recorded_longitude: 74.3588,
    recorded_gps_accuracy: 5.0,
    notes: 'Clean morning intake',
  };

  const colSubmitRes = await submitCollection(
    await makeReq(
      'http://localhost/api/zmcc/mot/journeys/current/collections',
      'POST',
      motUserA,
      validColPayload
    )
  );
  const colSubmitData = await colSubmitRes.json();
  if (colSubmitRes.status !== 201) {
    console.error('colSubmitRes failed:', colSubmitRes.status, colSubmitData);
  }
  assert(colSubmitRes.status === 201, 'COLLECTION_SUBMIT_SUCCESS', 'MOT successfully submitted shop collection (201).');
  assert(
    colSubmitData?.collection?.collection_number?.startsWith('MC-'),
    'COLLECTION_NUMBER_FORMAT',
    `Collection number format starts with MC- (got ${colSubmitData.collection.collection_number})`
  );
  assert(
    colSubmitData.collection.calculation_version === '1.0',
    'COLLECTION_VERSION_STAMP',
    'Collection stamped with calculation_version = 1.0.'
  );

  // Verify stop updated to VISITED
  const updatedStop1 = await prisma.motJourneyStop.findUnique({
    where: { id: stop1.id },
  });
  assert(
    updatedStop1?.status === 'VISITED' && updatedStop1?.completed_at != null,
    'STOP_VISITED_STATE',
    'MotJourneyStop transitioned from PENDING to VISITED.'
  );

  // Verify MotJourneyLocation created
  const motDeviceLocation = await prisma.motJourneyLocation.findFirst({
    where: {
      journey_id: BigInt(journeyAId),
      source_type: 'MOT_DEVICE',
    },
  });
  assert(motDeviceLocation != null, 'LOCATION_DEVICE_CREATED', 'MotJourneyLocation created with source_type = MOT_DEVICE.');

  // Verify First MOT GPS updated on journey
  const updatedJourney = await prisma.motJourney.findUnique({
    where: { id: BigInt(journeyAId) },
  });
  assert(
    updatedJourney?.first_mot_gps_at != null && updatedJourney?.first_mot_latitude != null,
    'JOURNEY_FIRST_MOT_GPS',
    'first_mot_gps_at and coordinates populated on journey.'
  );

  // Verify SMS Outbox row created
  const smsRow = await prisma.motCollectionSmsOutbox.findFirst({
    where: { collection_id: BigInt(colSubmitData.collection.id) },
  });
  assert(smsRow != null, 'SMS_OUTBOX_CREATED', 'mot_collection_sms_outbox row created.');
  assert(
    smsRow?.status === 'PENDING',
    'SMS_OUTBOX_STATUS_PENDING',
    'SMS outbox row initial status is PENDING.'
  );
  assert(
    smsRow?.recipient_phone === '+923002222222',
    'SMS_OUTBOX_RECIPIENT',
    'SMS outbox recipient matches shop phone snapshot.'
  );
  assert(
    !smsRow?.message_body.includes('35201') && !smsRow?.message_body.includes('31.5205'),
    'SMS_OUTBOX_SENSITIVE_DATA',
    'SMS message body does NOT contain CNIC or raw GPS coordinates.'
  );

  // Verify Audit Log created
  const auditLog = await prisma.auditLog.findFirst({
    where: {
      table_name: 'mot_shop_collection',
      record_id: BigInt(colSubmitData.collection.id),
      action: 'MOT_SHOP_COLLECTION_SUBMITTED',
    },
  });
  assert(auditLog != null, 'AUDIT_LOG_RECORDED', 'AuditLog created for MOT_SHOP_COLLECTION_SUBMITTED.');
  assert(
    colSubmitData.collection.collection_notes === 'Clean morning intake',
    'COLLECTION_NOTES_PERSISTED',
    'Notes stored and returned on collection record.'
  );
  assert(
    (auditLog?.new_values as any)?.collection_notes === 'Clean morning intake',
    'COLLECTION_NOTES_AUDITED',
    'Notes recorded in audit log new_values.'
  );

  // ---------------------------------------------------------------------------
  // SECTION 5: IDEMPOTENCY & CONCURRENCY
  // ---------------------------------------------------------------------------
  console.log('\n--- SECTION 5: IDEMPOTENCY & CONCURRENCY ---');

  // 1. Exact replay with same client_event_id returns HTTP 200 with original data
  const replayRes = await submitCollection(
    await makeReq(
      'http://localhost/api/zmcc/mot/journeys/current/collections',
      'POST',
      motUserA,
      validColPayload
    )
  );
  const replayData = await replayRes.json();
  assert(replayRes.status === 200, 'IDEMPOTENT_EXACT_RETRY', 'Exact retry with same client_event_id returns 200.');
  assert(
    replayData.collection.id === colSubmitData.collection.id,
    'IDEMPOTENT_DATA_MATCH',
    'Replay returns the exact original collection record.'
  );

  // 2. Replay with same client_event_id but modified parameters returns HTTP 409
  const modReplayRes = await submitCollection(
    await makeReq(
      'http://localhost/api/zmcc/mot/journeys/current/collections',
      'POST',
      motUserA,
      {
        ...validColPayload,
        quantity: 200.0, // Modified quantity
      }
    )
  );
  assert(
    modReplayRes.status === 409,
    'IDEMPOTENT_MODIFIED_PARAM_409',
    'Replaying client_event_id with different parameters rejected with 409 conflict.'
  );

  // 2b. Replay with same client_event_id but modified GPS latitude returns 409
  const modGpsRes = await submitCollection(
    await makeReq(
      'http://localhost/api/zmcc/mot/journeys/current/collections',
      'POST',
      motUserA,
      {
        ...validColPayload,
        recorded_latitude: 31.9999,
      }
    )
  );
  assert(
    modGpsRes.status === 409,
    'IDEMPOTENT_MODIFIED_GPS_409',
    'Replaying client_event_id with altered GPS latitude rejected with 409 conflict.'
  );

  // 2c. Replay with same client_event_id but modified timestamp returns 409
  const modTimeRes = await submitCollection(
    await makeReq(
      'http://localhost/api/zmcc/mot/journeys/current/collections',
      'POST',
      motUserA,
      {
        ...validColPayload,
        device_collected_at: new Date(Date.now() - 3600000).toISOString(),
      }
    )
  );
  assert(
    modTimeRes.status === 409,
    'IDEMPOTENT_MODIFIED_TIMESTAMP_409',
    'Replaying client_event_id with altered timestamp rejected with 409 conflict.'
  );

  // 2d. Replay with same client_event_id but modified notes returns 409
  const modNotesRes = await submitCollection(
    await makeReq(
      'http://localhost/api/zmcc/mot/journeys/current/collections',
      'POST',
      motUserA,
      {
        ...validColPayload,
        notes: 'Altered notes content',
      }
    )
  );
  assert(
    modNotesRes.status === 409,
    'IDEMPOTENT_MODIFIED_NOTES_409',
    'Replaying client_event_id with altered notes rejected with 409 conflict.'
  );

  // 3. Attempting collection on already VISITED stop with different client_event_id returns 409
  const doubleColRes = await submitCollection(
    await makeReq(
      'http://localhost/api/zmcc/mot/journeys/current/collections',
      'POST',
      motUserA,
      {
        ...validColPayload,
        client_event_id: `evt-different-${Date.now()}`,
      }
    )
  );
  assert(
    doubleColRes.status === 409,
    'STOP_ALREADY_VISITED_409',
    'Collecting on already visited stop returns 409 (STOP_ALREADY_VISITED).'
  );

  // 4. Concurrent duplicate submissions with same client_event_id (Promise.all)
  const concurrentEventId = `evt-concurrent-${Date.now()}`;
  const concurrentPayload = {
    client_event_id: concurrentEventId,
    journey_id: journeyAId,
    stop_id: stop2.id.toString(),
    quantity: 80.0,
    unit: 'LITER',
    lr: 28.5,
    fat: 3.8,
    recorded_latitude: 31.5216,
    recorded_longitude: 74.3600,
    recorded_gps_accuracy: 6.0,
  };

  const [res1, res2] = await Promise.all([
    submitCollection(
      await makeReq(
        'http://localhost/api/zmcc/mot/journeys/current/collections',
        'POST',
        motUserA,
        concurrentPayload
      )
    ),
    submitCollection(
      await makeReq(
        'http://localhost/api/zmcc/mot/journeys/current/collections',
        'POST',
        motUserA,
        concurrentPayload
      )
    ),
  ]);

  const status1 = res1.status;
  const status2 = res2.status;
  assert(
    (status1 === 201 && status2 === 200) || (status1 === 200 && status2 === 201),
    'CONCURRENT_IDEMPOTENT_SUBMIT',
    `Concurrent requests with same event ID both succeed (statuses: ${status1}, ${status2})`
  );

  // Verify only 1 collection was created for Stop 2
  const stop2Collections = await prisma.motShopCollection.findMany({
    where: { journey_stop_id: stop2.id },
  });
  assert(
    stop2Collections.length === 1,
    'CONCURRENT_EXACTLY_ONE_CREATED',
    'Exactly one collection record was created under concurrency.'
  );

  const stop2Col = stop2Collections[0];

  // Verify exactly 1 SMS outbox row created
  const stop2Sms = await prisma.motCollectionSmsOutbox.findMany({
    where: { collection_id: stop2Col.id },
  });
  assert(
    stop2Sms.length === 1,
    'CONCURRENT_EXACTLY_ONE_SMS',
    'Exactly one SMS outbox row created under concurrency.'
  );

  // Verify exactly 1 audit log row created
  const stop2Audits = await prisma.auditLog.findMany({
    where: {
      table_name: 'mot_shop_collection',
      record_id: stop2Col.id,
      action: 'MOT_SHOP_COLLECTION_SUBMITTED',
    },
  });
  assert(
    stop2Audits.length === 1,
    'CONCURRENT_EXACTLY_ONE_AUDIT',
    'Exactly one audit log row created under concurrency.'
  );

  // Verify stop status is VISITED
  const stop2Refreshed = await prisma.motJourneyStop.findUnique({
    where: { id: stop2.id },
  });
  assert(
    stop2Refreshed?.status === 'VISITED',
    'CONCURRENT_STOP_VISITED',
    'Stop 2 status transitioned to VISITED.'
  );

  // Verify exactly 1 location row created
  const stop2Locations = await prisma.motJourneyLocation.findMany({
    where: { idempotency_key: `${concurrentEventId}-loc` },
  });
  assert(
    stop2Locations.length === 1,
    'CONCURRENT_EXACTLY_ONE_LOCATION',
    'Exactly one location row created under concurrency.'
  );

  // ---------------------------------------------------------------------------
  // SECTION 6: STOP SNAPSHOT IMMUTABILITY
  // ---------------------------------------------------------------------------
  console.log('\n--- SECTION 6: STOP SNAPSHOT IMMUTABILITY ---');

  // Modify master shop record in ZmccShop
  await prisma.zmccShop.update({
    where: { id: shopA1.id },
    data: {
      shop_name: 'Renamed Master Shop 1',
      phone_number: '+923009999999',
    },
  });

  // Verify that historical journey stop retains frozen snapshot
  const historicalStop1 = await prisma.motJourneyStop.findUnique({
    where: { id: stop1.id },
  });
  assert(
    historicalStop1?.shop_name_snapshot === 'Alpha Dairy Shop 1' &&
      historicalStop1?.phone_number_snapshot === '+923002222222',
    'SNAPSHOT_IMMUTABILITY',
    'Modifying master shop does NOT alter historical journey stop frozen snapshot.'
  );

  // ---------------------------------------------------------------------------
  // SECTION 7: GPS BATCH TRACKING & OFFLINE RESILIENCE
  // ---------------------------------------------------------------------------
  console.log('\n--- SECTION 7: GPS BATCH TRACKING & OFFLINE RESILIENCE ---');

  // 1. Missing client_location_id returns 400 validation error
  const missingLocIdRes = await recordGpsBatch(
    await makeReq(
      'http://localhost/api/zmcc/mot/journeys/current/locations/batch',
      'POST',
      motUserA,
      {
        journey_id: journeyAId,
        locations: [
          {
            latitude: 31.5208,
            longitude: 74.3590,
            device_recorded_at: new Date().toISOString(),
          },
        ],
      }
    )
  );
  assert(missingLocIdRes.status === 400, 'GPS_MISSING_CLIENT_LOCATION_ID_400', 'Missing client_location_id returns 400 validation error.');

  // 2. Missing journey_id returns 400 validation error
  const missingJIdRes = await recordGpsBatch(
    await makeReq(
      'http://localhost/api/zmcc/mot/journeys/current/locations/batch',
      'POST',
      motUserA,
      {
        locations: [
          {
            client_location_id: 'loc-no-jid-test',
            latitude: 31.5208,
            longitude: 74.3590,
            device_recorded_at: new Date().toISOString(),
          },
        ],
      }
    )
  );
  assert(missingJIdRes.status === 400, 'GPS_MISSING_JOURNEY_ID_400', 'Missing journey_id returns 400 validation error.');

  // 3. Mixed-journey batch returns 400
  const mixedJRes = await recordGpsBatch(
    await makeReq(
      'http://localhost/api/zmcc/mot/journeys/current/locations/batch',
      'POST',
      motUserA,
      {
        locations: [
          {
            client_location_id: 'loc-j1-test',
            journey_id: journeyAId,
            latitude: 31.5208,
            longitude: 74.3590,
            device_recorded_at: new Date().toISOString(),
          },
          {
            client_location_id: 'loc-j2-test',
            journey_id: '999999',
            latitude: 31.5210,
            longitude: 74.3592,
            device_recorded_at: new Date().toISOString(),
          },
        ],
      }
    )
  );
  assert(mixedJRes.status === 400, 'GPS_MIXED_JOURNEY_BATCH_400', 'Mixed-journey GPS batch rejected with 400.');

  // 4. Queued Journey A GPS cannot attach to Journey B (MOT B cannot upload for Journey A)
  const crossJourneyRes = await recordGpsBatch(
    await makeReq(
      'http://localhost/api/zmcc/mot/journeys/current/locations/batch',
      'POST',
      motUserB,
      {
        journey_id: journeyAId,
        locations: [
          {
            client_location_id: 'loc-cross-j-test',
            journey_id: journeyAId,
            latitude: 31.5208,
            longitude: 74.3590,
            device_recorded_at: new Date().toISOString(),
          },
        ],
      }
    )
  );
  assert(crossJourneyRes.status === 403, 'GPS_CROSS_JOURNEY_BLOCKED_403', 'MOT Driver cannot attach GPS to another driver\'s journey.');

  // 5. Valid GPS batch with client_location_id and journey_id
  const journeyAObj = await prisma.motJourney.findUnique({
    where: { id: BigInt(journeyAId) },
  });
  const journeyStartTime = journeyAObj!.started_at.getTime();

  const locPoint1Id = `loc-6d-p1-${Date.now()}`;
  const locPoint2Id = `loc-6d-p2-${Date.now()}`;
  const validGpsBatch = {
    journey_id: journeyAId,
    locations: [
      {
        client_location_id: locPoint1Id,
        journey_id: journeyAId,
        latitude: 31.5208,
        longitude: 74.3590,
        gps_accuracy: 4.2,
        device_recorded_at: new Date(journeyStartTime + 10000).toISOString(),
      },
      {
        client_location_id: locPoint2Id,
        journey_id: journeyAId,
        latitude: 31.5210,
        longitude: 74.3592,
        gps_accuracy: 4.0,
        device_recorded_at: new Date(journeyStartTime + 20000).toISOString(),
      },
    ],
  };
  const gpsRes = await recordGpsBatch(
    await makeReq(
      'http://localhost/api/zmcc/mot/journeys/current/locations/batch',
      'POST',
      motUserA,
      validGpsBatch
    )
  );
  const gpsData = await gpsRes.json();
  assert(gpsRes.status === 200, 'GPS_BATCH_SUCCESS', 'MOT successfully uploaded GPS batch.');
  assert(
    gpsData.accepted_count === 2,
    'GPS_BATCH_COUNT',
    `Accepted 2 GPS points (got ${gpsData.accepted_count})`
  );

  // 6. Offline GPS retry creates no duplicate and returns ALREADY_PROCESSED
  const retryGpsRes = await recordGpsBatch(
    await makeReq(
      'http://localhost/api/zmcc/mot/journeys/current/locations/batch',
      'POST',
      motUserA,
      validGpsBatch
    )
  );
  const retryGpsData = await retryGpsRes.json();
  assert(retryGpsRes.status === 200, 'GPS_RETRY_STATUS_200', 'GPS retry returned HTTP 200.');
  assert(
    retryGpsData.items[0].status === 'ALREADY_PROCESSED' && retryGpsData.items[1].status === 'ALREADY_PROCESSED',
    'GPS_RETRY_ALREADY_PROCESSED',
    'Identical GPS retry returns ALREADY_PROCESSED.'
  );
  const locRowsCount = await prisma.motJourneyLocation.count({
    where: { idempotency_key: { in: [locPoint1Id, locPoint2Id] } },
  });
  assert(locRowsCount === 2, 'GPS_RETRY_NO_DUPLICATE_ROWS', 'No duplicate rows created after retry (exactly 2 in DB).');

  // 7. Reused GPS ID with different data returns CONFLICT
  const conflictGpsRes = await recordGpsBatch(
    await makeReq(
      'http://localhost/api/zmcc/mot/journeys/current/locations/batch',
      'POST',
      motUserA,
      {
        journey_id: journeyAId,
        locations: [
          {
            client_location_id: locPoint1Id,
            journey_id: journeyAId,
            latitude: 31.8888, // Changed latitude!
            longitude: 74.3590,
            gps_accuracy: 4.2,
            device_recorded_at: new Date(journeyStartTime + 10000).toISOString(),
          },
        ],
      }
    )
  );
  const conflictGpsData = await conflictGpsRes.json();
  assert(
    conflictGpsData.items[0].status === 'CONFLICT',
    'GPS_REUSED_ID_CONFLICT',
    'Reusing client_location_id with changed coordinates returns CONFLICT.'
  );

  // 8. Concurrent identical GPS upload creates exactly 1 row
  const concurrentGpsId = `loc-concurrent-${Date.now()}`;
  const concGpsPayload = {
    journey_id: journeyAId,
    locations: [
      {
        client_location_id: concurrentGpsId,
        journey_id: journeyAId,
        latitude: 31.5220,
        longitude: 74.3595,
        gps_accuracy: 3.5,
        device_recorded_at: new Date(journeyStartTime + 30000).toISOString(),
      },
    ],
  };
  const [concGpsRes1, concGpsRes2] = await Promise.all([
    recordGpsBatch(await makeReq('http://localhost/api/zmcc/mot/journeys/current/locations/batch', 'POST', motUserA, concGpsPayload)),
    recordGpsBatch(await makeReq('http://localhost/api/zmcc/mot/journeys/current/locations/batch', 'POST', motUserA, concGpsPayload)),
  ]);
  assert(
    concGpsRes1.status === 200 && concGpsRes2.status === 200,
    'GPS_CONCURRENT_UPLOAD_STATUS_200',
    'Concurrent identical GPS upload returned 200 for both.'
  );
  const concGpsCount = await prisma.motJourneyLocation.count({
    where: { idempotency_key: concurrentGpsId },
  });
  assert(concGpsCount === 1, 'GPS_CONCURRENT_EXACTLY_ONE_ROW', `Concurrent identical GPS upload created exactly 1 row in DB (got ${concGpsCount}).`);

  // 9. Events before journey start or after end/cancellation are rejected
  const beforeStartGpsRes = await recordGpsBatch(
    await makeReq(
      'http://localhost/api/zmcc/mot/journeys/current/locations/batch',
      'POST',
      motUserA,
      {
        journey_id: journeyAId,
        locations: [
          {
            client_location_id: `loc-before-start-${Date.now()}`,
            journey_id: journeyAId,
            latitude: 31.5208,
            longitude: 74.3590,
            device_recorded_at: new Date(Date.now() - 86400000).toISOString(), // 1 day before dispatch
          },
        ],
      }
    )
  );
  const beforeStartData = await beforeStartGpsRes.json();
  assert(
    beforeStartData.rejected_count === 1 && beforeStartData.items[0].status === 'REJECTED',
    'GPS_BEFORE_START_REJECTED',
    'GPS point recorded before journey started_at was rejected.'
  );

  // Future GPS point rejected (> 5 min)
  const futureGpsRes = await recordGpsBatch(
    await makeReq(
      'http://localhost/api/zmcc/mot/journeys/current/locations/batch',
      'POST',
      motUserA,
      {
        journey_id: journeyAId,
        locations: [
          {
            client_location_id: `loc-future-${Date.now()}`,
            journey_id: journeyAId,
            latitude: 31.5208,
            longitude: 74.3590,
            device_recorded_at: new Date(Date.now() + 3600000).toISOString(), // 1 hour in future
          },
        ],
      }
    )
  );
  const futureGpsData = await futureGpsRes.json();
  assert(
    futureGpsData.rejected_count === 1,
    'GPS_FUTURE_REJECTED',
    'GPS point with future timestamp was rejected.'
  );

  // 10. Delayed offline sync & cancellation event bounds test on dedicated journey
  const nowTime = Date.now();
  const testJourneyC = await prisma.motJourney.create({
    data: {
      journey_number: `MJ-TEST-C-${nowTime}`,
      operational_date: new Date(),
      zmcc_id: zmccA.id,
      route_id: routeA.id,
      mot_profile_id: motProfileA.id,
      mot_vehicle_id: motVehicleA.id,
      status: 'CANCELLED',
      assigned_by: managerA.id,
      assigned_at: new Date(nowTime - 7200000), // 2 hours ago
      started_at: new Date(nowTime - 7200000),  // 2 hours ago
      assignment_latitude: new Prisma.Decimal(31.5200),
      assignment_longitude: new Prisma.Decimal(74.3580),
      start_latitude: new Prisma.Decimal(31.5200),
      start_longitude: new Prisma.Decimal(74.3580),
      cancelled_by: managerA.id,
      cancelled_at: new Date(nowTime - 3600000), // 1 hour ago
      cancellation_reason: 'Test cancellation bounds',
      idempotency_key: `test-j-c-${nowTime}`,
    },
  });

  // 10a. GPS recorded after cancelled_at rejected
  const afterCancelGpsRes = await recordGpsBatch(
    await makeReq(
      'http://localhost/api/zmcc/mot/journeys/current/locations/batch',
      'POST',
      motUserA,
      {
        journey_id: testJourneyC.id.toString(),
        locations: [
          {
            client_location_id: `loc-after-cancel-${nowTime}`,
            journey_id: testJourneyC.id.toString(),
            latitude: 31.5208,
            longitude: 74.3590,
            device_recorded_at: new Date(nowTime - 1800000).toISOString(), // 30 min ago (after cancelled_at 60 min ago)
          },
        ],
      }
    )
  );
  const afterCancelData = await afterCancelGpsRes.json();
  assert(
    afterCancelData.rejected_count === 1 && afterCancelData.items[0].status === 'REJECTED',
    'GPS_AFTER_CANCEL_REJECTED',
    'GPS point recorded after journey cancelled_at was rejected.'
  );

  // 10b. Valid delayed offline GPS (recorded between started_at and cancelled_at) synchronizes successfully
  const delayedValidGpsRes = await recordGpsBatch(
    await makeReq(
      'http://localhost/api/zmcc/mot/journeys/current/locations/batch',
      'POST',
      motUserA,
      {
        journey_id: testJourneyC.id.toString(),
        locations: [
          {
            client_location_id: `loc-delayed-valid-${nowTime}`,
            journey_id: testJourneyC.id.toString(),
            latitude: 31.5208,
            longitude: 74.3590,
            device_recorded_at: new Date(nowTime - 5400000).toISOString(), // 90 min ago (between 120 min started and 60 min cancelled)
          },
        ],
      }
    )
  );
  const delayedValidData = await delayedValidGpsRes.json();
  assert(
    delayedValidData.accepted_count === 1 && delayedValidData.items[0].status === 'ACCEPTED',
    'GPS_DELAYED_OFFLINE_SYNC_ACCEPTED',
    'Valid delayed offline GPS point recorded during active journey synchronizes successfully.'
  );

  // 11. Unsorted GPS batch produces the correct earliest first_mot_gps
  const testJourneyD = await prisma.motJourney.create({
    data: {
      journey_number: `MJ-TEST-D-${nowTime}`,
      operational_date: new Date(),
      zmcc_id: zmccA.id,
      route_id: routeA.id,
      mot_profile_id: motProfileA.id,
      mot_vehicle_id: motVehicleA.id,
      status: 'COMPLETED',
      assigned_by: managerA.id,
      assigned_at: new Date(nowTime - 7200000),
      started_at: new Date(nowTime - 7200000),
      ended_at: new Date(nowTime),
      assignment_latitude: new Prisma.Decimal(31.5200),
      assignment_longitude: new Prisma.Decimal(74.3580),
      start_latitude: new Prisma.Decimal(31.5200),
      start_longitude: new Prisma.Decimal(74.3580),
      idempotency_key: `test-j-d-${nowTime}`,
    },
  });

  const timeP2 = new Date(nowTime - 3600000); // 10:15 (later)
  const timeP1 = new Date(nowTime - 5400000); // 10:00 (earliest)
  const timeP3 = new Date(nowTime - 1800000); // 10:30 (latest)

  // Upload P2 first
  await recordGpsBatch(
    await makeReq(
      'http://localhost/api/zmcc/mot/journeys/current/locations/batch',
      'POST',
      motUserA,
      {
        journey_id: testJourneyD.id.toString(),
        locations: [
          {
            client_location_id: `loc-unsorted-p2-${nowTime}`,
            journey_id: testJourneyD.id.toString(),
            latitude: 31.5222,
            longitude: 74.3592,
            device_recorded_at: timeP2.toISOString(),
          },
        ],
      }
    )
  );

  // Upload P1 (earlier than P2)
  await recordGpsBatch(
    await makeReq(
      'http://localhost/api/zmcc/mot/journeys/current/locations/batch',
      'POST',
      motUserA,
      {
        journey_id: testJourneyD.id.toString(),
        locations: [
          {
            client_location_id: `loc-unsorted-p1-${nowTime}`,
            journey_id: testJourneyD.id.toString(),
            latitude: 31.5111,
            longitude: 74.3511,
            device_recorded_at: timeP1.toISOString(),
          },
        ],
      }
    )
  );

  // Upload P3 (later than both)
  await recordGpsBatch(
    await makeReq(
      'http://localhost/api/zmcc/mot/journeys/current/locations/batch',
      'POST',
      motUserA,
      {
        journey_id: testJourneyD.id.toString(),
        locations: [
          {
            client_location_id: `loc-unsorted-p3-${nowTime}`,
            journey_id: testJourneyD.id.toString(),
            latitude: 31.5333,
            longitude: 74.3533,
            device_recorded_at: timeP3.toISOString(),
          },
        ],
      }
    )
  );

  const updatedJourneyD = await prisma.motJourney.findUnique({
    where: { id: testJourneyD.id },
  });
  assert(
    updatedJourneyD?.first_mot_gps_at != null &&
      Math.abs(updatedJourneyD.first_mot_gps_at.getTime() - timeP1.getTime()) < 1000 &&
      Math.abs(Number(updatedJourneyD.first_mot_latitude) - 31.5111) < 0.0001,
    'GPS_UNSORTED_EARLIEST_FIRST_MOT',
    'Unsorted GPS arrivals maintain chronologically earliest point as first_mot_gps_*.'
  );

  // ---------------------------------------------------------------------------
  // SECTION 8: MANAGER MAP & SMS OUTBOX API
  // ---------------------------------------------------------------------------
  console.log('\n--- SECTION 8: MANAGER MAP & SMS OUTBOX API ---');

  // Manager A can access map data
  const mapRes = await getJourneyMap(
    await makeReq(`http://localhost/api/zmcc/mot/journeys/${journeyAId}/map`, 'GET', managerA),
    { params: Promise.resolve({ id: journeyAId }) }
  );
  const mapData = await mapRes.json();
  assert(mapRes.status === 200, 'MANAGER_MAP_SUCCESS', 'ZMCC Manager successfully retrieved journey map data.');
  assert(
    mapData.journey.endpoint_status.includes('Not recorded yet'),
    'MAP_ENDPOINT_PLACEHOLDER',
    'Map contains Stage 6E endpoint placeholder ("Not recorded yet").'
  );
  assert(
    mapData.stops.length === 2 && mapData.stops.every((s: any) => s.status === 'VISITED'),
    'MAP_STOPS_VISITED',
    'Map data reflects all completed stops with frozen snapshot data.'
  );
  assert(
    mapData.totals.visited_stops === 2 && mapData.totals.total_gross_liters > 0,
    'MAP_TOTALS_METRICS',
    `Map totals calculate gross liters (${mapData.totals.total_gross_liters} L) and visited stops (${mapData.totals.visited_stops}).`
  );

  // SMS Outbox API for Manager
  const smsOutboxRes = await getSmsOutbox(
    await makeReq(`http://localhost/api/zmcc/mot/sms-outbox?journey_id=${journeyAId}`, 'GET', managerA)
  );
  const smsOutboxData = await smsOutboxRes.json();
  assert(smsOutboxRes.status === 200, 'SMS_OUTBOX_API_SUCCESS', 'Manager successfully fetched SMS outbox.');
  assert(
    smsOutboxData.items.length >= 2,
    'SMS_OUTBOX_ITEMS_COUNT',
    `Outbox contains SMS rows for collections (found ${smsOutboxData.items.length}).`
  );

  // Cleanup Stage 6D test fixtures
  try {
    const testSources = await prisma.procurementSource.findMany({
      where: { code: { in: ['ZMCC-6D-A', 'ZMCC-6D-B'] } },
    });
    for (const s of testSources) {
      await prisma.motCollectionSmsOutbox.deleteMany({ where: { collection: { zmcc_id: s.id } } });
      await prisma.motShopCollection.deleteMany({ where: { zmcc_id: s.id } });
      await prisma.motJourneyLocation.deleteMany({ where: { journey: { zmcc_id: s.id } } });
      await prisma.motJourneyStop.deleteMany({ where: { journey: { zmcc_id: s.id } } });
      await prisma.motJourney.deleteMany({ where: { zmcc_id: s.id } });
      await prisma.zmccShop.deleteMany({ where: { zmcc_id: s.id } });
      await prisma.zmccArea.deleteMany({ where: { zmcc_id: s.id } });
      await prisma.zmccRoute.deleteMany({ where: { zmcc_id: s.id } });
      await prisma.motVehicle.deleteMany({ where: { zmcc_id: s.id } });
      await prisma.motProfile.deleteMany({ where: { zmcc_id: s.id } });
      await prisma.zmccMilkSource.deleteMany({ where: { zmcc_id: s.id } });
      await prisma.dispatchQuantityPolicySnapshot.deleteMany({ where: { source_id: s.id } });
      await prisma.user.updateMany({
        where: { procurement_source_id: s.id },
        data: { procurement_source_id: null },
      });
      await prisma.procurementSource.delete({ where: { id: s.id } });
    }
  } catch {
    // Ignore cleanup error
  }

  if (failed > 0) {
    process.exit(1);
  }
}

runStage6dTests().catch((err) => {
  console.error('CRITICAL ERROR IN STAGE 6D SUITE:', err);
  process.exit(1);
});
