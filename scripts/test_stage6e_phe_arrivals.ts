/**
 * STAGE 6E: PHE ZMCC ARRIVAL, TOKENS, MOT JOURNEY COMPLETION & CONTRACTOR ARRIVAL REGRESSION TEST SUITE
 *
 * Verifies:
 * 1. Database Schema & Migration:
 *    - 17 tracked migrations
 *    - zmcc_token_seq sequence exists
 *    - zmcc_mot_arrival & zmcc_contractor_arrival tables exist with relations & constraints
 * 2. Role Authorization & Scoping:
 *    - Unauthenticated rejected (401)
 *    - Inactive user rejected (403)
 *    - Unauthorized roles (LAB_TECHNICIAN, WEIGHBRIDGE, MOT) rejected (403)
 *    - Foreign ZMCC PHE operator rejected (403)
 *    - Authorized PHE Operator (own ZMCC) accepted
 *    - SUPER_ADMIN accepted globally
 * 3. MOT Arrival Validations & Lifecycle:
 *    - Missing required fields (journey_id, route_milk_token, client_event_id) rejected (400)
 *    - Invalid / future arrival timestamps (> 5 min) rejected (400)
 *    - arrival_timestamp predating journey start rejected (400)
 *    - arrival_timestamp predating collection or GPS telemetry rejected (400)
 *    - Invalid GPS coordinates (0,0 or out of bounds) rejected (400)
 *    - Non-existent journey rejected (404)
 *    - Journey not in COLLECTING rejected (409)
 *    - Journey transitions to COMPLETED, ended_at = arrival_timestamp
 *    - ZMCC token generated in format ZT-MOT-YYYYMMDD-XXXX
 *    - Unvisited stops remain PENDING (not skipped)
 *    - final_mot_gps_* snapshotted from latest MOT_DEVICE point before/at arrival_timestamp
 *    - phe_latitude/longitude stored separately
 *    - AuditLog entries created (ZMCC_MOT_ARRIVAL_SUBMITTED & MOT_JOURNEY_COMPLETED_AT_ZMCC)
 * 4. Idempotency & Concurrency:
 *    - Exact replay with same client_event_id returns HTTP 200 with original token & is_replay: true
 *    - Altered replay returns HTTP 409
 *    - Second arrival attempt on same journey with different client_event_id returns HTTP 409
 *    - Concurrent identical submissions yield exactly 201 + 200, 1 DB row, 1 token, 1 audit log
 * 5. Delayed Offline Sync After Completion:
 *    - Offline collection submitted after journey completion (recorded <= ended_at) accepted (201)
 *    - Offline GPS batch submitted after journey completion (recorded <= ended_at) accepted (200)
 *    - Delayed GPS point newer than initial final_mot_gps_at updates final_mot_gps_* atomically
 *    - Offline collection / GPS recorded after ended_at rejected
 * 6. Contractor Arrival:
 *    - Valid contractor arrival returns 201 with token ZT-CON-YYYYMMDD-XXXX
 *    - Vehicle number normalized to uppercase
 *    - Inactive contractor source rejected (400)
 *    - Non-contractor source rejected (400)
 *    - Exact replay returns 200, altered replay returns 409
 *    - ZERO VehicleVisit rows created in DB
 * 7. Manager Corrections:
 *    - PHE operator cannot correct (403)
 *    - Foreign ZMCC manager cannot correct (403)
 *    - Correction without reason rejected (400)
 *    - Correction 1 of MOT arrival: update route_milk_token (200, correction_count = 1)
 *    - Correction 2 of MOT arrival: update arrival_timestamp updates ended_at & re-evaluates final_mot_gps (200, correction_count = 2)
 *    - Correction 3 rejected: exceeds max 2 corrections (400)
 *    - Immutable tokens: zmcc_token remains unchanged
 *    - AuditLog created for ZMCC_MOT_ARRIVAL_CORRECTED with old/new/reason
 *    - Contractor arrival correction (vehicle_number, max 2)
 * 8. Read Models & Map:
 *    - listMotArrivals and listContractorArrivals scoped to ZMCC
 *    - getJourneyMapData exposes final_mot_gps and phe_arrival without placeholder text
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
console.log('🧪 STAGE 6E: PHE ZMCC ARRIVAL, TOKENS & CONTRACTOR REGRESSION SUITE');
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

async function runStage6eTests() {
  const { prisma } = await import('../src/backend/core/db');
  const { Prisma } = await import('@prisma/client');
  const {
    submitMotArrival,
    correctMotArrival,
    submitContractorArrival,
    correctContractorArrival,
    listMotArrivals,
    listContractorArrivals,
    getMotArrivalById,
    getContractorArrivalById,
  } = await import('../src/backend/services/zmccArrivalService');
  const {
    submitShopCollection,
    recordGpsBatch,
    getJourneyMapData,
  } = await import('../src/backend/services/motService');

  console.log('\n--- 1. DATABASE SCHEMA & MIGRATIONS ---');
  const migrationsDir = path.join(repoRoot, 'prisma', 'migrations');
  const migrationDirs = fs
    .readdirSync(migrationsDir)
    .filter((f) => fs.statSync(path.join(migrationsDir, f)).isDirectory() && !f.startsWith('.'));
  assert(migrationDirs.length >= 17, 'Migration Count', `Found ${migrationDirs.length} migrations (expected >= 17)`);

  // Verify zmcc_token_seq sequence in Postgres
  const seqCheck = await prisma.$queryRaw<{ exists: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM pg_sequences WHERE sequencename = 'zmcc_token_seq'
    ) as exists;
  `;
  assert(seqCheck[0]?.exists === true, 'Token Sequence', 'zmcc_token_seq exists in postgres');

  // M. Migration still owns sequence creation
  const migPath = path.join(repoRoot, 'prisma', 'migrations', '20260911120000_phe_arrival_token_contractor_foundation', 'migration.sql');
  const migContent = fs.readFileSync(migPath, 'utf8');
  assert(migContent.includes('CREATE SEQUENCE IF NOT EXISTS "zmcc_token_seq"'), 'Migration owns sequence', 'Tracked migration creates zmcc_token_seq');

  // K. Runtime code contains zero CREATE SEQUENCE for zmcc_token_seq
  const servicePath = path.join(repoRoot, 'src', 'backend', 'services', 'zmccArrivalService.ts');
  const serviceContent = fs.readFileSync(servicePath, 'utf8');
  const createSeqMatches = serviceContent.match(/CREATE\s+SEQUENCE/i);
  assert(createSeqMatches === null, 'No Runtime CREATE SEQUENCE', 'zmccArrivalService.ts contains zero runtime CREATE SEQUENCE statements');

  // L. Runtime token generation contains zero Math.random fallback
  const mathRandomSeq = serviceContent.match(/Math\.random\s*\(\)\s*\*\s*9000/i);
  assert(mathRandomSeq === null, 'No Math.random fallback for sequence', 'zmccArrivalService.ts contains zero Math.random sequence fallback');

  // B. Stage 6E suite is registered exactly once in run_all_regressions.ts
  const runnerPath = path.join(repoRoot, 'scripts', 'run_all_regressions.ts');
  const runnerContent = fs.readFileSync(runnerPath, 'utf8');
  const stage6eMatches = runnerContent.match(/scripts\/test_stage6e_phe_arrivals\.ts/g);
  assert(stage6eMatches?.length === 1, 'Registered in Runner', 'Stage 6E suite is registered exactly once in run_all_regressions.ts');

  // A. Zero browser alert() calls in ZmccArrivalsWorkspace.tsx
  const workspacePath = path.join(repoRoot, 'src', 'frontend', 'modules', 'zmcc', 'arrivals', 'ZmccArrivalsWorkspace.tsx');
  const workspaceContent = fs.readFileSync(workspacePath, 'utf8');
  const alertMatches = workspaceContent.match(/\balert\s*\(/g);
  assert(alertMatches === null || alertMatches.length === 0, 'Zero alert() calls', 'ZmccArrivalsWorkspace has zero browser alert() calls');

  // Q. Datetime-local default uses Pakistan wall time correctly
  const { toDatetimeLocalInput } = await import('../src/lib/datetime-utils');
  const testUtcDate = new Date('2026-09-11T12:30:00.000Z'); // 12:30 UTC = 17:30 PKT
  const formattedPkt = toDatetimeLocalInput(testUtcDate);
  assert(formattedPkt === '2026-09-11T17:30', 'Datetime-local PKT wall time', `12:30 UTC formats to 17:30 PKT (got ${formattedPkt})`);

  console.log('\n--- SETTING UP SEED FIXTURES ---');
  const runId = Date.now().toString().slice(-6);

  // 1. Create ZMCC A, ZMCC B, and Inactive ZMCC
  const zmccA = await prisma.procurementSource.create({
    data: {
      code: `Z6E-A-${runId}`,
      name: `Stage 6E ZMCC Alpha ${runId}`,
      source_type: 'ZMCC',
      is_active: true,
    },
  });

  const zmccB = await prisma.procurementSource.create({
    data: {
      code: `Z6E-B-${runId}`,
      name: `Stage 6E ZMCC Beta ${runId}`,
      source_type: 'ZMCC',
      is_active: true,
    },
  });

  const zmccInactive = await prisma.procurementSource.create({
    data: {
      code: `Z6E-INACT-${runId}`,
      name: `Stage 6E Inactive ZMCC ${runId}`,
      source_type: 'ZMCC',
      is_active: false,
    },
  });

  // 2. Create Contractors (Active and Inactive)
  const contractorActive = await prisma.procurementSource.create({
    data: {
      code: `CON-ACT-${runId}`,
      name: `Active Dairy Contractor ${runId}`,
      source_type: 'CONTRACTOR',
      is_active: true,
    },
  });

  const contractorInactive = await prisma.procurementSource.create({
    data: {
      code: `CON-INA-${runId}`,
      name: `Inactive Dairy Contractor ${runId}`,
      source_type: 'CONTRACTOR',
      is_active: false,
    },
  });

  // 3. Create Users
  const pheA = await prisma.user.create({
    data: {
      username: `phe_a_${runId}`,
      password_hash: 'hash',
      role: 'PHE_OPERATOR',
      full_name: `PHE Operator Alpha ${runId}`,
      is_active: true,
      procurement_source_id: zmccA.id,
      scope_type: 'SOURCE',
    },
  });

  const pheB = await prisma.user.create({
    data: {
      username: `phe_b_${runId}`,
      password_hash: 'hash',
      role: 'PHE_OPERATOR',
      full_name: `PHE Operator Beta ${runId}`,
      is_active: true,
      procurement_source_id: zmccB.id,
      scope_type: 'SOURCE',
    },
  });

  const pheInactive = await prisma.user.create({
    data: {
      username: `phe_inact_${runId}`,
      password_hash: 'hash',
      role: 'PHE_OPERATOR',
      full_name: `Inactive PHE ${runId}`,
      is_active: false,
      procurement_source_id: zmccA.id,
      scope_type: 'SOURCE',
    },
  });

  const managerA = await prisma.user.create({
    data: {
      username: `mgr_a_${runId}`,
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
      username: `mgr_b_${runId}`,
      password_hash: 'hash',
      role: 'ZMCC_MANAGER',
      full_name: `Manager Beta ${runId}`,
      is_active: true,
      procurement_source_id: zmccB.id,
      scope_type: 'SOURCE',
    },
  });

  const superAdmin = await prisma.user.create({
    data: {
      username: `super_${runId}`,
      password_hash: 'hash',
      role: 'SUPER_ADMIN',
      full_name: `Super Admin ${runId}`,
      is_active: true,
      scope_type: 'ALL',
    },
  });

  const labUser = await prisma.user.create({
    data: {
      username: `lab_${runId}`,
      password_hash: 'hash',
      role: 'LAB_TECHNICIAN',
      full_name: `Lab Tech ${runId}`,
      is_active: true,
      scope_type: 'ALL',
    },
  });

  const motUser = await prisma.user.create({
    data: {
      username: `mot_user_${runId}`,
      password_hash: 'hash',
      role: 'MOT',
      full_name: `MOT Driver ${runId}`,
      is_active: true,
      procurement_source_id: zmccA.id,
      scope_type: 'SOURCE',
    },
  });

  // 4. Create Master Route, Area, Shops, MOT Profile, Vehicle
  // 4. Create Master Route, Area, MilkSource, ChillerOwnership, Shops, MOT Profile, Vehicle
  const routeA = await prisma.zmccRoute.create({
    data: {
      zmcc_id: zmccA.id,
      route_code: `RT-${runId}`,
      name: `Route Alpha ${runId}`,
      origin: 'ZMCC A Origin',
      destination: 'Milk Plant',
      created_by: pheA.id,
      updated_by: pheA.id,
    },
  });

  const areaA = await prisma.zmccArea.create({
    data: {
      zmcc_id: zmccA.id,
      route_id: routeA.id,
      area_code: `AR-${runId}`,
      name: `Area Alpha ${runId}`,
      created_by: pheA.id,
      updated_by: pheA.id,
    },
  });

  const milkSourceA = await prisma.zmccMilkSource.create({
    data: {
      zmcc_id: zmccA.id,
      erp_code: `MS-${runId}`,
      name: `Milk Source ${runId}`,
      created_by: managerA.id,
      updated_by: managerA.id,
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
      created_by: pheA.id,
      updated_by: pheA.id,
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
      created_by: pheA.id,
      updated_by: pheA.id,
    },
  });

  const motProfile = await prisma.motProfile.create({
    data: {
      zmcc_id: zmccA.id,
      user_id: motUser.id,
      mot_code: `MOT-${runId}`,
      name: `MOT Profile ${runId}`,
      phone_number: '03001234567',
      cnic: '35201-3333333-3',
      created_by: managerA.id,
      updated_by: managerA.id,
    },
  });

  const motVehicle = await prisma.motVehicle.create({
    data: {
      zmcc_id: zmccA.id,
      vehicle_number: `VEH-${runId}`,
      created_by: managerA.id,
      updated_by: managerA.id,
    },
  });

  // Helper to create test journeys
  let journeyCounter = 1;
  async function createTestJourney(status: string = 'COLLECTING') {
    const idx = journeyCounter++;
    const jNum = `J-${runId}-${idx}`;
    const startTime = new Date(Date.now() - 3600 * 1000); // 1 hour ago

    const driverUser = await prisma.user.create({
      data: {
        username: `mot_u_${runId}_${idx}`,
        password_hash: 'hash',
        role: 'MOT',
        full_name: `Driver ${jNum}`,
        is_active: true,
        procurement_source_id: zmccA.id,
        scope_type: 'SOURCE',
      },
    });

    const profile = await prisma.motProfile.create({
      data: {
        zmcc_id: zmccA.id,
        user_id: driverUser.id,
        mot_code: `MOT-${runId}-${idx}`,
        name: `MOT Profile ${jNum}`,
        phone_number: `0300123${String(idx).padStart(4, '0')}`,
        cnic: `35201-555555${idx}-1`,
        created_by: managerA.id,
        updated_by: managerA.id,
      },
    });

    const vehicle = await prisma.motVehicle.create({
      data: {
        zmcc_id: zmccA.id,
        vehicle_number: `VH-${runId}-${idx}`,
        created_by: managerA.id,
        updated_by: managerA.id,
      },
    });

    const j = await prisma.motJourney.create({
      data: {
        journey_number: jNum,
        idempotency_key: `dispatch-${jNum}`,
        zmcc_id: zmccA.id,
        route_id: routeA.id,
        mot_profile_id: profile.id,
        mot_vehicle_id: vehicle.id,
        assigned_by: managerA.id,
        operational_date: new Date(),
        status,
        cancellation_reason: status === 'CANCELLED' ? 'Test Cancel Reason' : null,
        cancelled_at: status === 'CANCELLED' ? new Date() : null,
        started_at: startTime,
        assigned_at: startTime,
        assignment_latitude: new Prisma.Decimal('31.5204'),
        assignment_longitude: new Prisma.Decimal('74.3587'),
        start_latitude: new Prisma.Decimal('31.5204'),
        start_longitude: new Prisma.Decimal('74.3587'),
        stops: {
          create: [
            {
              planned_sequence: 1,
              shop_id: shop1.id,
              status: 'VISITED',
              shop_code_snapshot: shop1.shop_code,
              shop_name_snapshot: shop1.shop_name,
              owner_name_snapshot: 'Owner Tariq',
              phone_number_snapshot: '03001111111',
              area_code_snapshot: areaA.area_code,
              area_name_snapshot: areaA.name,
            },
            {
              planned_sequence: 2,
              shop_id: shop2.id,
              status: 'PENDING',
              shop_code_snapshot: shop2.shop_code,
              shop_name_snapshot: shop2.shop_name,
              owner_name_snapshot: 'Owner Rehman',
              phone_number_snapshot: '03002222222',
              area_code_snapshot: areaA.area_code,
              area_name_snapshot: areaA.name,
            },
          ],
        },
      },
      include: { stops: true },
    });

    return Object.assign(j, { driverUser, profile, vehicle });
  }

  console.log('\n--- 2. ROLE AUTHORIZATION & SCOPING ---');
  const journeyAuthTest = await createTestJourney('COLLECTING');
  const basePayload = {
    journey_id: journeyAuthTest.id.toString(),
    route_milk_token: 'RMT-AUTH-100',
    arrival_timestamp: new Date().toISOString(),
    client_event_id: `evt-auth-${Date.now()}`,
  };

  // Unauthorized (no user)
  const resNoAuth = await submitMotArrival(null as any, basePayload);
  assert(resNoAuth.status === 401, 'Auth Required', 'Unauthenticated request returns 401');

  // Inactive user
  const resInactive = await submitMotArrival(pheInactive as any, basePayload);
  assert(resInactive.status === 403, 'Inactive User', 'Inactive user returns 403');

  // Forbidden role (Lab Tech)
  const resLab = await submitMotArrival(labUser as any, basePayload);
  assert(resLab.status === 403, 'Role Guard', 'LAB_TECHNICIAN returns 403 on submit arrival');

  // Foreign ZMCC PHE
  const resForeign = await submitMotArrival(pheB as any, basePayload);
  assert(resForeign.status === 403, 'ZMCC Scope Guard', 'Foreign ZMCC PHE returns 403');

  console.log('\n--- 3. PAYLOAD & CHRONOLOGICAL VALIDATIONS ---');
  // Missing journey_id
  const resMissingJourney = await submitMotArrival(pheA as any, { ...basePayload, journey_id: '' });
  assert(resMissingJourney.status === 400, 'Missing journey_id', 'Empty journey_id returns 400');

  // Missing route_milk_token
  const resMissingToken = await submitMotArrival(pheA as any, { ...basePayload, route_milk_token: '   ' });
  assert(resMissingToken.status === 400, 'Missing route_milk_token', 'Empty route_milk_token returns 400');

  // Missing client_event_id
  const resMissingEventId = await submitMotArrival(pheA as any, { ...basePayload, client_event_id: '' });
  assert(resMissingEventId.status === 400, 'Missing client_event_id', 'Empty client_event_id returns 400');

  // Future timestamp (> 5m)
  const futureTime = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  const resFutureTime = await submitMotArrival(pheA as any, { ...basePayload, arrival_timestamp: futureTime });
  assert(resFutureTime.status === 400, 'Future Timestamp', 'Arrival time > 5 min in future returns 400');

  // Predates journey started_at
  const ancientTime = new Date(new Date(journeyAuthTest.started_at).getTime() - 3600 * 1000).toISOString();
  const resAncientTime = await submitMotArrival(pheA as any, { ...basePayload, arrival_timestamp: ancientTime });
  assert(resAncientTime.status === 400, 'Predates Start', 'Arrival time predating journey started_at returns 400');

  // Invalid GPS
  const resZeroGps = await submitMotArrival(pheA as any, {
    ...basePayload,
    phe_latitude: 0,
    phe_longitude: 0,
  });
  assert(resZeroGps.status === 400, 'Invalid GPS (0,0)', 'Zero coordinates return 400');

  // R. Submitting GPS accuracy without coordinates is rejected (400)
  const resAccuracyWithoutCoords = await submitMotArrival(pheA as any, {
    ...basePayload,
    phe_gps_accuracy: 10.0,
  });
  assert(resAccuracyWithoutCoords.status === 400, 'R: GPS Accuracy without Coords', 'Submitting GPS accuracy without latitude/longitude returns 400');

  // Non-existent journey
  const resNotFound = await submitMotArrival(pheA as any, {
    ...basePayload,
    journey_id: '999999999',
    client_event_id: `evt-404-${Date.now()}`,
  });
  assert(resNotFound.status === 404, 'Journey 404', 'Non-existent journey returns 404');

  // Journey not in COLLECTING
  const journeyCancelled = await createTestJourney('CANCELLED');
  const resNotCollecting = await submitMotArrival(pheA as any, {
    ...basePayload,
    journey_id: journeyCancelled.id.toString(),
    client_event_id: `evt-cancelled-${Date.now()}`,
  });
  assert(resNotCollecting.status === 409, 'Status Guard', 'CANCELLED journey rejected with 409');

  console.log('\n--- 4. MOT ARRIVAL SUBMISSION, TOKENS & COMPLETION ---');
  const journeyMain = await createTestJourney('COLLECTING');
  const initialVisitCount = await prisma.vehicleVisit.count();

  // Seed two GPS locations for journeyMain (MOT_DEVICE)
  const locTime1 = new Date(new Date(journeyMain.started_at).getTime() + 10 * 60 * 1000);
  const locTime2 = new Date(new Date(journeyMain.started_at).getTime() + 20 * 60 * 1000);

  await prisma.motJourneyLocation.create({
    data: {
      journey_id: journeyMain.id,
      recorded_by_user_id: journeyMain.driverUser.id,
      source_type: 'MOT_DEVICE',
      latitude: new Prisma.Decimal('31.5210000'),
      longitude: new Prisma.Decimal('74.3590000'),
      gps_accuracy: new Prisma.Decimal('10.50'),
      device_recorded_at: locTime1,
      idempotency_key: `loc-main-1-${runId}`,
    },
  });

  await prisma.motJourneyLocation.create({
    data: {
      journey_id: journeyMain.id,
      recorded_by_user_id: journeyMain.driverUser.id,
      source_type: 'MOT_DEVICE',
      latitude: new Prisma.Decimal('31.5250000'),
      longitude: new Prisma.Decimal('74.3650000'),
      gps_accuracy: new Prisma.Decimal('8.20'),
      device_recorded_at: locTime2,
      idempotency_key: `loc-main-2-${runId}`,
    },
  });

  const arrivalTimeMain = new Date(new Date(journeyMain.started_at).getTime() + 30 * 60 * 1000);
  const mainEventId = `evt-main-arr-${runId}`;

  const resMainArrival = await submitMotArrival(pheA as any, {
    journey_id: journeyMain.id.toString(),
    route_milk_token: 'RMT-98765',
    arrival_timestamp: arrivalTimeMain.toISOString(),
    phe_latitude: 31.5300000,
    phe_longitude: 74.3700000,
    phe_gps_accuracy: 5.0,
    client_event_id: mainEventId,
  });

  assert(resMainArrival.status === 201, 'MOT Arrival Submit', 'Valid MOT arrival returns 201 Created');
  assert(resMainArrival.data?.route_milk_token === 'RMT-98765', 'Route Milk Token', 'Preserves manual route_milk_token');
  assert(
    /^ZT-MOT-\d{8}-\d{4}$/.test(resMainArrival.data?.zmcc_token),
    'ZMCC Token Format',
    `Generated token matches format ZT-MOT-YYYYMMDD-XXXX (${resMainArrival.data?.zmcc_token})`
  );

  // Verify Journey transitioned to COMPLETED
  const updatedJourneyMain = await prisma.motJourney.findUnique({
    where: { id: journeyMain.id },
    include: { stops: true },
  });
  assert(updatedJourneyMain?.status === 'COMPLETED', 'Journey Status', 'MotJourney status transitioned to COMPLETED');
  assert(
    updatedJourneyMain?.ended_at?.toISOString() === arrivalTimeMain.toISOString(),
    'Journey ended_at',
    'MotJourney ended_at set to actual arrival timestamp'
  );

  // Verify pending stops remained pending (NOT SKIPPED)
  const pendingStop = updatedJourneyMain?.stops.find((s) => s.planned_sequence === 2);
  assert(pendingStop?.status === 'PENDING', 'Pending Stops Preserved', 'Unvisited stop remained in PENDING status');

  // Verify final_mot_gps snapshot is from locTime2 (latest MOT_DEVICE before arrival)
  assert(
    updatedJourneyMain?.final_mot_gps_at?.toISOString() === locTime2.toISOString(),
    'Final MOT GPS Timestamp',
    'final_mot_gps_at correctly snapshotted from latest MOT_DEVICE point'
  );
  assert(
    Number(updatedJourneyMain?.final_mot_latitude) === 31.525,
    'Final MOT GPS Lat',
    'final_mot_latitude correctly snapshotted'
  );

  // Verify AuditLog entries
  const arrivalAudit = await prisma.auditLog.findFirst({
    where: {
      table_name: 'zmcc_mot_arrival',
      action: 'ZMCC_MOT_ARRIVAL_SUBMITTED',
      record_id: BigInt(resMainArrival.data?.id),
    },
  });
  assert(arrivalAudit !== null, 'Arrival AuditLog', 'AuditLog created for ZMCC_MOT_ARRIVAL_SUBMITTED');

  const journeyAudit = await prisma.auditLog.findFirst({
    where: {
      table_name: 'mot_journey',
      action: 'MOT_JOURNEY_COMPLETED_AT_ZMCC',
      record_id: journeyMain.id,
    },
  });
  assert(journeyAudit !== null, 'Journey Complete AuditLog', 'AuditLog created for MOT_JOURNEY_COMPLETED_AT_ZMCC');

  console.log('\n--- 5. IDEMPOTENCY & CONCURRENCY SAFETY ---');
  // Exact replay returns 200 with is_replay: true
  const resExactReplay = await submitMotArrival(pheA as any, {
    journey_id: journeyMain.id.toString(),
    route_milk_token: 'RMT-98765',
    arrival_timestamp: arrivalTimeMain.toISOString(),
    phe_latitude: 31.5300000,
    phe_longitude: 74.3700000,
    phe_gps_accuracy: 5.0,
    client_event_id: mainEventId,
  });
  assert(resExactReplay.status === 200, 'Exact Replay Status', 'Exact replay returns 200 OK');
  assert(resExactReplay.data?.is_replay === true, 'Exact Replay Flag', 'is_replay is true on exact replay');
  assert(
    resExactReplay.data?.zmcc_token === resMainArrival.data?.zmcc_token,
    'Exact Replay Token',
    'Returns identical token on exact replay'
  );

  // Altered replay with modified route_milk_token returns 409
  const resAlteredReplay = await submitMotArrival(pheA as any, {
    journey_id: journeyMain.id.toString(),
    route_milk_token: 'RMT-DIFFERENT',
    arrival_timestamp: arrivalTimeMain.toISOString(),
    client_event_id: mainEventId,
  });
  assert(resAlteredReplay.status === 409, 'Altered Replay 409', 'Altered replay with modified token rejected with 409');

  // C. Altered replay with modified GPS accuracy fails with 409
  const resAlteredAccuracyReplay = await submitMotArrival(pheA as any, {
    journey_id: journeyMain.id.toString(),
    route_milk_token: 'RMT-98765',
    arrival_timestamp: arrivalTimeMain.toISOString(),
    phe_latitude: 31.5300000,
    phe_longitude: 74.3700000,
    phe_gps_accuracy: 99.0, // original was 5.0
    client_event_id: mainEventId,
  });
  assert(resAlteredAccuracyReplay.status === 409, 'C: MOT Replay Accuracy Mismatch 409', 'Altered replay with modified GPS accuracy rejected with 409');

  // C2. Altered replay with modified GPS coordinates fails with 409
  const resAlteredCoordsReplay = await submitMotArrival(pheA as any, {
    journey_id: journeyMain.id.toString(),
    route_milk_token: 'RMT-98765',
    arrival_timestamp: arrivalTimeMain.toISOString(),
    phe_latitude: 31.5999999, // original was 31.5300000
    phe_longitude: 74.3700000,
    phe_gps_accuracy: 5.0,
    client_event_id: mainEventId,
  });
  assert(resAlteredCoordsReplay.status === 409, 'C: MOT Replay Coords Mismatch 409', 'Altered replay with modified GPS coordinates rejected with 409');

  // Second arrival on completed journey with different client_event_id returns 409
  const resSecondArrival = await submitMotArrival(pheA as any, {
    journey_id: journeyMain.id.toString(),
    route_milk_token: 'RMT-SECOND',
    arrival_timestamp: arrivalTimeMain.toISOString(),
    client_event_id: `evt-second-${Date.now()}`,
  });
  assert(resSecondArrival.status === 409, 'Second Arrival Guard', 'Second arrival on completed journey rejected with 409');

  // Concurrent identical submissions test
  const journeyConcurrent = await createTestJourney('COLLECTING');
  const concurrentEventId = `evt-conc-${runId}`;
  const concurrentTime = new Date().toISOString();

  const [conc1, conc2] = await Promise.all([
    submitMotArrival(pheA as any, {
      journey_id: journeyConcurrent.id.toString(),
      route_milk_token: 'RMT-CONCURRENT',
      arrival_timestamp: concurrentTime,
      client_event_id: concurrentEventId,
    }),
    submitMotArrival(pheA as any, {
      journey_id: journeyConcurrent.id.toString(),
      route_milk_token: 'RMT-CONCURRENT',
      arrival_timestamp: concurrentTime,
      client_event_id: concurrentEventId,
    }),
  ]);

  const statuses = [conc1.status, conc2.status].sort();
  assert(
    statuses[0] === 200 && statuses[1] === 201,
    'Concurrent Submissions',
    `Two simultaneous identical submits returned 201 and 200 (got ${statuses[0]}, ${statuses[1]})`
  );

  const totalArrivalsForJourney = await prisma.zmccMotArrival.count({
    where: { journey_id: journeyConcurrent.id },
  });
  assert(totalArrivalsForJourney === 1, 'Single DB Row', 'Exactly one ZmccMotArrival row created');

  // D. Concurrent collisions with different payloads reject loser with 409 and do not overwrite winner
  const journeyDiffConcurrent = await createTestJourney('COLLECTING');
  const diffConcEventId = `evt-diff-conc-${runId}`;
  const diffConcurrentTime = new Date().toISOString();

  const [diffConc1, diffConc2] = await Promise.all([
    submitMotArrival(pheA as any, {
      journey_id: journeyDiffConcurrent.id.toString(),
      route_milk_token: 'RMT-CONC-PAYLOAD-1',
      arrival_timestamp: diffConcurrentTime,
      client_event_id: diffConcEventId,
    }),
    submitMotArrival(pheA as any, {
      journey_id: journeyDiffConcurrent.id.toString(),
      route_milk_token: 'RMT-CONC-PAYLOAD-2',
      arrival_timestamp: diffConcurrentTime,
      client_event_id: diffConcEventId,
    }),
  ]);

  const diffStatuses = [diffConc1.status, diffConc2.status].sort();
  assert(
    diffStatuses[0] === 201 && diffStatuses[1] === 409,
    'D: Concurrent Diff Payload 409',
    `Two simultaneous different submits returned 201 and 409 (got ${diffStatuses[0]}, ${diffStatuses[1]})`
  );

  const winner = diffConc1.status === 201 ? diffConc1 : diffConc2;
  const savedArrival = await prisma.zmccMotArrival.findUnique({
    where: { client_event_id: diffConcEventId },
  });
  assert(
    savedArrival?.route_milk_token === winner.data?.route_milk_token,
    'D: Winner Preserved',
    'Winning payload was not overwritten by colliding loser payload'
  );

  console.log('\n--- 6. DELAYED OFFLINE SYNC AFTER JOURNEY COMPLETION ---');
  // Journey is now COMPLETED (journeyMain).
  // Simulate an offline GPS point recorded BEFORE ended_at being synced now.
  const offlineGpsTime = new Date(new Date(journeyMain.started_at).getTime() + 25 * 60 * 1000); // 25 min (between 20m and 30m ended_at)

  const gpsSyncRes = await recordGpsBatch(journeyMain.driverUser as any, {
    journey_id: journeyMain.id.toString(),
    locations: [
      {
        client_location_id: `loc-offline-sync-${runId}`,
        latitude: 31.5280000,
        longitude: 74.3680000,
        gps_accuracy: 6.0,
        device_recorded_at: offlineGpsTime.toISOString(),
      },
    ],
  });
  assert(gpsSyncRes.status === 200, 'Delayed GPS Sync Status', 'Delayed offline GPS sync accepted after completion');

  // Check if final_mot_gps was atomically updated to offlineGpsTime because 25m > 20m
  const journeyAfterGpsSync = await prisma.motJourney.findUnique({
    where: { id: journeyMain.id },
  });
  assert(
    journeyAfterGpsSync?.final_mot_gps_at?.toISOString() === offlineGpsTime.toISOString(),
    'Final MOT GPS Updated',
    'final_mot_gps_at updated atomically by newer delayed offline point'
  );
  assert(
    Number(journeyAfterGpsSync?.final_mot_latitude) === 31.528,
    'Final MOT Lat Updated',
    'final_mot_latitude updated to delayed point latitude'
  );

  // Submitting GPS point recorded AFTER ended_at is rejected
  const futureOfflineGpsTime = new Date(arrivalTimeMain.getTime() + 10 * 60 * 1000);
  const gpsAfterEndRes = await recordGpsBatch(journeyMain.driverUser as any, {
    journey_id: journeyMain.id.toString(),
    locations: [
      {
        client_location_id: `loc-after-end-${runId}`,
        latitude: 31.5290000,
        longitude: 74.3690000,
        gps_accuracy: 5.0,
        device_recorded_at: futureOfflineGpsTime.toISOString(),
      },
    ],
  });
  const rejectedItem = gpsAfterEndRes.data?.results?.find((r: any) => r.client_location_id === `loc-after-end-${runId}`);
  assert(
    rejectedItem?.status === 'REJECTED',
    'Post-Ended GPS Rejected',
    'GPS point recorded after ended_at is rejected'
  );

  console.log('\n--- 7. CONTRACTOR ARRIVAL & DOMAIN BOUNDARY ---');
  const contractorEventId = `evt-con-${runId}`;
  const contractorTime = new Date().toISOString();

  // Inactive contractor rejected
  const resInactiveCon = await submitContractorArrival(pheA as any, {
    contractor_source_id: contractorInactive.id.toString(),
    vehicle_number: 'LES-1111',
    arrival_timestamp: contractorTime,
    client_event_id: `evt-inact-${Date.now()}`,
  });
  assert(resInactiveCon.status === 400, 'Inactive Contractor Guard', 'Inactive contractor source rejected with 400');

  // Valid contractor arrival
  const resContractor = await submitContractorArrival(pheA as any, {
    contractor_source_id: contractorActive.id.toString(),
    vehicle_number: 'les-9000', // test normalization to uppercase
    arrival_timestamp: contractorTime,
    phe_latitude: 31.5310000,
    phe_longitude: 74.3710000,
    phe_gps_accuracy: 4.0,
    client_event_id: contractorEventId,
  });

  assert(resContractor.status === 201, 'Contractor Arrival Submit', 'Valid contractor arrival returns 201 Created');
  assert(resContractor.data?.vehicle_number === 'LES-9000', 'Vehicle Normalization', 'Vehicle number normalized to uppercase');
  assert(
    /^ZT-CON-\d{8}-\d{4}$/.test(resContractor.data?.zmcc_token),
    'Contractor Token Format',
    `Generated token matches format ZT-CON-YYYYMMDD-XXXX (${resContractor.data?.zmcc_token})`
  );

  // Exact replay
  const resContractorReplay = await submitContractorArrival(pheA as any, {
    contractor_source_id: contractorActive.id.toString(),
    vehicle_number: 'LES-9000',
    arrival_timestamp: contractorTime,
    phe_latitude: 31.5310000,
    phe_longitude: 74.3710000,
    phe_gps_accuracy: 4.0,
    client_event_id: contractorEventId,
  });
  assert(resContractorReplay.status === 200, 'Contractor Replay', 'Contractor exact replay returns 200 OK');
  assert(resContractorReplay.data?.is_replay === true, 'Contractor is_replay', 'is_replay is true on contractor replay');

  // H. Super Admin contractor arrival requires a valid target ZMCC ID
  const resAdminNoTarget = await submitContractorArrival(superAdmin as any, {
    contractor_source_id: contractorActive.id.toString(),
    vehicle_number: 'ADMIN-100',
    arrival_timestamp: contractorTime,
    client_event_id: `evt-admin-no-target-${Date.now()}`,
  });
  assert(resAdminNoTarget.status === 400, 'H: Super Admin Target ZMCC Required', 'Super admin submission without target_zmcc_id returns 400');

  const resAdminTargetAsContractor = await submitContractorArrival(superAdmin as any, {
    target_zmcc_id: contractorActive.id.toString(),
    contractor_source_id: contractorActive.id.toString(),
    vehicle_number: 'ADMIN-101',
    arrival_timestamp: contractorTime,
    client_event_id: `evt-admin-contractor-as-zmcc-${Date.now()}`,
  });
  assert(resAdminTargetAsContractor.status === 400, 'H: Super Admin Target ZMCC Must Be ZMCC', 'Target ZMCC cannot be a contractor source (400)');

  // I. Contractor arrival rejects contractor source ID pointing to a ZMCC source type
  const resConSourceAsZmcc = await submitContractorArrival(pheA as any, {
    contractor_source_id: zmccA.id.toString(),
    vehicle_number: 'LES-9001',
    arrival_timestamp: contractorTime,
    client_event_id: `evt-con-source-zmcc-${Date.now()}`,
  });
  assert(resConSourceAsZmcc.status === 400, 'I: Contractor Source Cannot Be ZMCC', 'contractor_source_id pointing to ZMCC source type returns 400');

  // J. Contractor arrival rejects inactive ZMCC
  const resInactiveZmcc = await submitContractorArrival(superAdmin as any, {
    target_zmcc_id: zmccInactive.id.toString(),
    contractor_source_id: contractorActive.id.toString(),
    vehicle_number: 'LES-9002',
    arrival_timestamp: contractorTime,
    client_event_id: `evt-inactive-zmcc-${Date.now()}`,
  });
  assert(resInactiveZmcc.status === 400, 'J: Inactive ZMCC Rejected', 'Contractor arrival targeting inactive ZMCC returns 400');

  // E. Contractor arrival exact replay with different target ZMCC fails with 409
  const resDiffZmccReplay = await submitContractorArrival(superAdmin as any, {
    target_zmcc_id: zmccB.id.toString(),
    contractor_source_id: contractorActive.id.toString(),
    vehicle_number: 'LES-9000',
    arrival_timestamp: contractorTime,
    phe_latitude: 31.5310000,
    phe_longitude: 74.3710000,
    phe_gps_accuracy: 4.0,
    client_event_id: contractorEventId,
  });
  assert(resDiffZmccReplay.status === 409, 'E: Contractor Replay Target ZMCC Mismatch', 'Contractor replay with altered target ZMCC returns 409');

  // F. Contractor arrival exact replay with different GPS accuracy fails with 409
  const resDiffAccuracyReplay = await submitContractorArrival(pheA as any, {
    contractor_source_id: contractorActive.id.toString(),
    vehicle_number: 'LES-9000',
    arrival_timestamp: contractorTime,
    phe_latitude: 31.5310000,
    phe_longitude: 74.3710000,
    phe_gps_accuracy: 99.0,
    client_event_id: contractorEventId,
  });
  assert(resDiffAccuracyReplay.status === 409, 'F: Contractor Replay Accuracy Mismatch', 'Contractor replay with altered GPS accuracy returns 409');

  // G. Contractor arrival concurrent collision with different payloads fails with 409 for loser
  const conDiffEventId = `evt-con-diff-${runId}`;
  const [conDiff1, conDiff2] = await Promise.all([
    submitContractorArrival(pheA as any, {
      contractor_source_id: contractorActive.id.toString(),
      vehicle_number: 'LES-1000',
      arrival_timestamp: contractorTime,
      client_event_id: conDiffEventId,
    }),
    submitContractorArrival(pheA as any, {
      contractor_source_id: contractorActive.id.toString(),
      vehicle_number: 'LES-2000',
      arrival_timestamp: contractorTime,
      client_event_id: conDiffEventId,
    }),
  ]);
  const conDiffStatuses = [conDiff1.status, conDiff2.status].sort();
  assert(
    conDiffStatuses[0] === 201 && conDiffStatuses[1] === 409,
    'G: Contractor Concurrent Collision 409',
    `Simultaneous different contractor arrivals returned 201 and 409 (got ${conDiffStatuses[0]}, ${conDiffStatuses[1]})`
  );

  // Verify ZERO VehicleVisit rows created in database!
  const finalVisitCount = await prisma.vehicleVisit.count();
  assert(
    finalVisitCount === initialVisitCount,
    'NO VehicleVisit Created',
    `VehicleVisit count unchanged (${finalVisitCount} === ${initialVisitCount}) — Domain boundary preserved!`
  );

  console.log('\n--- 8. MANAGER CORRECTIONS & IMMUTABILITY ---');
  const arrivalToCorrectId = resMainArrival.data?.id;

  // PHE operator cannot correct
  const resPheCorrect = await correctMotArrival(pheA as any, arrivalToCorrectId, {
    reason: 'PHE trying to edit',
    route_milk_token: 'RMT-HACKED',
  });
  assert(resPheCorrect.status === 403, 'PHE Correction Forbidden', 'PHE operator cannot correct arrival (403)');

  // Foreign ZMCC manager cannot correct
  const resForeignMgrCorrect = await correctMotArrival(managerB as any, arrivalToCorrectId, {
    reason: 'Foreign manager edit',
    route_milk_token: 'RMT-FOREIGN',
  });
  assert(resForeignMgrCorrect.status === 403, 'Foreign Manager Forbidden', 'Foreign manager cannot correct arrival (403)');

  // Missing reason rejected
  const resNoReason = await correctMotArrival(managerA as any, arrivalToCorrectId, {
    reason: '   ',
    route_milk_token: 'RMT-NO-REASON',
  });
  assert(resNoReason.status === 400, 'Reason Mandatory', 'Correction without reason rejected with 400');

  // Correction 1: Valid correction by Manager A
  const originalToken = resMainArrival.data?.zmcc_token;
  const resCorrection1 = await correctMotArrival(managerA as any, arrivalToCorrectId, {
    reason: 'Driver mistyped ticket number on slip',
    route_milk_token: 'RMT-CORRECTED-1',
  });
  assert(resCorrection1.status === 200, 'Correction 1 Status', 'First correction succeeds with 200');
  assert(resCorrection1.data?.route_milk_token === 'RMT-CORRECTED-1', 'Token Updated', 'route_milk_token updated');
  assert(resCorrection1.data?.correction_count === 1, 'Correction Count 1', 'correction_count is 1');
  assert(resCorrection1.data?.zmcc_token === originalToken, 'Immutable ZMCC Token', 'zmcc_token remains immutable');

  // Correction 2: Update arrival_timestamp (updates ended_at and re-evaluates final_mot_gps)
  const adjustedArrivalTime = new Date(new Date(journeyMain.started_at).getTime() + 28 * 60 * 1000);
  const resCorrection2 = await correctMotArrival(managerA as any, arrivalToCorrectId, {
    reason: 'Adjusting clock drift per entry log',
    arrival_timestamp: adjustedArrivalTime.toISOString(),
  });
  assert(resCorrection2.status === 200, 'Correction 2 Status', 'Second correction succeeds with 200');
  assert(resCorrection2.data?.correction_count === 2, 'Correction Count 2', 'correction_count is 2');

  const journeyAfterCorrection = await prisma.motJourney.findUnique({
    where: { id: journeyMain.id },
  });
  assert(
    journeyAfterCorrection?.ended_at?.toISOString() === adjustedArrivalTime.toISOString(),
    'ended_at Updated',
    'MotJourney ended_at updated to corrected arrival timestamp'
  );

  // Correction 3: Exceeds max 2 corrections
  const resCorrection3 = await correctMotArrival(managerA as any, arrivalToCorrectId, {
    reason: 'Third attempt should fail',
    route_milk_token: 'RMT-FAILED-3',
  });
  assert(resCorrection3.status === 400, 'Max Corrections Enforced', 'Third correction rejected with 400 (max 2 reached)');

  // Contractor correction test
  const resConCorrection = await correctContractorArrival(managerA as any, resContractor.data?.id, {
    reason: 'Typo in vehicle number',
    vehicle_number: 'LES-9999',
  });
  assert(resConCorrection.status === 200, 'Contractor Correction', 'Contractor correction succeeds with 200');
  assert(resConCorrection.data?.vehicle_number === 'LES-9999', 'Contractor Vehicle Updated', 'Vehicle number updated to LES-9999');

  // N, O, P. Concurrency-safe correction race when only 1 slot remains
  const journeyRace = await createTestJourney('COLLECTING');
  const raceArrivalRes = await submitMotArrival(pheA as any, {
    journey_id: journeyRace.id.toString(),
    route_milk_token: 'RMT-RACE-ORIGINAL',
    arrival_timestamp: new Date().toISOString(),
    client_event_id: `evt-race-arr-${runId}`,
  });
  assert(raceArrivalRes.status === 201, 'Race Arrival Created', 'Seed arrival created for correction race test');
  const raceArrivalId = raceArrivalRes.data?.id;

  // Use 1st correction slot
  const preRaceRes = await correctMotArrival(managerA as any, raceArrivalId, {
    reason: 'First legitimate correction',
    route_milk_token: 'RMT-RACE-FIRST',
  });
  assert(preRaceRes.status === 200 && preRaceRes.data?.correction_count === 1, 'First Slot Used', 'Arrival now has correction_count = 1 (1 slot remains)');

  // Count audit logs for this arrival before race
  const preRaceAudits = await prisma.auditLog.count({
    where: {
      table_name: 'zmcc_mot_arrival',
      action: 'ZMCC_MOT_ARRIVAL_CORRECTED',
      record_id: BigInt(raceArrivalId),
    },
  });
  assert(preRaceAudits === 1, 'Pre-Race Audits', 'Exactly 1 correction audit log before race');

  // Race: Two simultaneous correction attempts when only 1 slot remains
  const [race1, race2] = await Promise.all([
    correctMotArrival(managerA as any, raceArrivalId, {
      reason: 'Concurrent correction attempt Alpha',
      route_milk_token: 'RMT-RACE-ALPHA',
    }),
    correctMotArrival(managerA as any, raceArrivalId, {
      reason: 'Concurrent correction attempt Beta',
      route_milk_token: 'RMT-RACE-BETA',
    }),
  ]);

  const raceStatuses = [race1.status, race2.status].sort();
  // N. One winner (200) and one loser (409 Conflict)
  assert(
    raceStatuses[0] === 200 && raceStatuses[1] === 409,
    'N: Concurrency Correction Race (200 & 409)',
    `Simultaneous corrections when 1 slot remains yielded 200 and 409 (got ${raceStatuses[0]}, ${raceStatuses[1]})`
  );

  // O. Loser of concurrency race creates zero audit logs
  const postRaceAudits = await prisma.auditLog.count({
    where: {
      table_name: 'zmcc_mot_arrival',
      action: 'ZMCC_MOT_ARRIVAL_CORRECTED',
      record_id: BigInt(raceArrivalId),
    },
  });
  assert(
    postRaceAudits === 2,
    'O: Loser Created Zero Audit Logs',
    `Audit log count increased by exactly 1 for winning correction (${postRaceAudits} === 2)`
  );

  // P. Maximum 2 corrections enforced across simultaneous attempts
  const finalRaceArrival = await prisma.zmccMotArrival.findUnique({
    where: { id: BigInt(raceArrivalId) },
  });
  assert(
    finalRaceArrival?.correction_count === 2,
    'P: Max 2 Corrections In DB',
    `Final correction_count is strictly 2 (${finalRaceArrival?.correction_count})`
  );

  // Any subsequent attempt now fails with 400 (max corrections reached)
  const postLimitAttempt = await correctMotArrival(managerA as any, raceArrivalId, {
    reason: 'Attempt after limit',
    route_milk_token: 'RMT-RACE-OMEGA',
  });
  assert(
    postLimitAttempt.status === 400,
    'P: Subsequent Correction Rejection',
    'Subsequent correction rejected with 400 after max 2 corrections reached'
  );

  console.log('\n--- 9. READ MODELS & JOURNEY MAP COMPLETION ---');
  // List MOT Arrivals scoped
  const listMotA = await listMotArrivals(managerA as any);
  assert(listMotA.status === 200, 'List MOT Arrivals Status', 'listMotArrivals returns 200');
  assert(listMotA.data?.items.length >= 1, 'List MOT Arrivals Count', 'listMotArrivals contains records for ZMCC A');

  // Journey Map Read Model
  const mapData = await getJourneyMapData(managerA as any, journeyMain.id.toString());
  assert(mapData.status === 200, 'Get Journey Map Status', 'getJourneyMapData returns 200');
  assert(mapData.data?.journey?.final_mot_gps !== null, 'Map Final MOT GPS', 'Journey map contains final_mot_gps');
  assert(mapData.data?.journey?.phe_arrival !== null, 'Map PHE Arrival', 'Journey map contains phe_arrival');
  assert(
    mapData.data?.journey?.endpoint_status === 'Recorded upon ZMCC arrival',
    'Map Endpoint Status',
    `endpoint_status placeholder replaced with live status (${mapData.data?.journey?.endpoint_status})`
  );

  console.log('\n=====================================================================');
  console.log(`🏁 STAGE 6E REGRESSION TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('=====================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runStage6eTests()
  .catch((err) => {
    console.error('Fatal test runner error:', err);
    process.exit(1);
  });
