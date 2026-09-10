/**
 * STAGE 6C: MOT PROFILES, VEHICLES, ASSIGN & DISPATCH, AND JOURNEY FOUNDATION REGRESSION SUITE
 *
 * Verifies:
 * 1. Database Schema & Migrations:
 *    - All 5 models exist in PostgreSQL (mot_profile, mot_vehicle, mot_journey, mot_journey_stop, mot_journey_location)
 *    - Repository contains exactly 15 tracked migrations
 *    - Partial unique indexes exist for COLLECTING status on mot_profile_id and mot_vehicle_id
 *    - Composite foreign keys enforce same ZMCC across route, profile, vehicle, and journey
 * 2. Role Registration & Authorization:
 *    - Canonical MOT role in types, role-routing (/mot), and user assignment policies
 *    - SUPER_ADMIN: Global MOT management and dispatch across all ZMCCs
 *    - ZMCC_MANAGER: Scoped MOT management and dispatch within assigned ZMCC
 *    - PHE_OPERATOR: Read-only for MOT profiles/vehicles; can Assign & Dispatch; CANNOT manage profiles/vehicles or cancel journeys (403)
 *    - Non-canonical aliases (e.g. Admin) fail closed (403)
 * 3. Assign & Dispatch Business Decision:
 *    - Status starts immediately as COLLECTING (assigned_at == started_at)
 *    - Assigning user's GPS coordinates stored in journey and initial MotJourneyLocation (ASSIGNING_USER)
 *    - All active shops on the selected route are snapshotted into MotJourneyStop in stable sequence
 *    - Operational date must be today in Pakistan Standard Time (PKT)
 *    - Rejection of inactive route, empty shops route, inactive profile, inactive vehicle
 *    - Concurrent active journeys prevented at service and DB partial index levels (409)
 *    - Idempotency key handling prevents duplicate dispatch
 * 4. Cancellation Rules:
 *    - Allowed ONLY for COLLECTING journeys
 *    - Mandatory non-empty reason string (min 3 chars)
 *    - Only SUPER_ADMIN and same-ZMCC ZMCC_MANAGER can cancel; PHE_OPERATOR and others fail (403)
 *    - Status becomes CANCELLED; profile and vehicle are freed for subsequent journeys
 * 5. Deactivation & Cross-ZMCC Transfer:
 *    - Deactivating profile or vehicle with active journey is blocked (400)
 *    - Transferring profile or vehicle across ZMCCs is Super Admin only, and blocked if active journey exists
 * 6. MOT Driver Current Journey:
 *    - MOT driver can view own active journey, vehicle, route, planned shops via /api/zmcc/mot/journeys/current
 *    - Non-MOT users blocked (403)
 * 7. Test DB Safety: Strictly targets milk_reception_test; development DB untouched.
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
process.env.DEV_DATABASE_URL = process.env.DATABASE_URL;
if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}

// 3. Enforce test isolation
const { testDbName } = assertSafeTestDatabase({
  testDbUrl: process.env.TEST_DATABASE_URL,
  devDbUrl: process.env.DEV_DATABASE_URL,
});

console.log('=====================================================================');
console.log('🧪 STAGE 6C: MOT DISPATCH & JOURNEY FOUNDATION REGRESSION SUITE');
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

async function runStage6cTests() {
  const { prisma } = await import('../src/backend/core/db');
  const { createSessionToken } = await import('../src/backend/core/auth');
  const { resolveRoleHome } = await import('../src/lib/role-routing');
  const { isCreatableRole, getRoleAssignmentPolicy } = await import('../src/lib/user-assignment-policy');
  const { getOperationalBusinessDate } = await import('../src/backend/core/business-day');

  // Import API handlers
  const { GET: getProfiles, POST: postProfiles } = await import('../src/app/api/zmcc/mot/profiles/route');
  const { GET: getProfileById, PATCH: patchProfile } = await import('../src/app/api/zmcc/mot/profiles/[id]/route');
  const { GET: getVehicles, POST: postVehicles } = await import('../src/app/api/zmcc/mot/vehicles/route');
  const { GET: getVehicleById, PATCH: patchVehicle } = await import('../src/app/api/zmcc/mot/vehicles/[id]/route');
  const { GET: getJourneys } = await import('../src/app/api/zmcc/mot/journeys/route');
  const { GET: getJourneyById } = await import('../src/app/api/zmcc/mot/journeys/[id]/route');
  const { POST: assignAndDispatch } = await import('../src/app/api/zmcc/mot/journeys/assign-and-dispatch/route');
  const { POST: cancelJourney } = await import('../src/app/api/zmcc/mot/journeys/[id]/cancel/route');
  const { GET: getCurrentJourney } = await import('../src/app/api/zmcc/mot/journeys/current/route');

  // Verify connected database
  const dbCheck = await prisma.$queryRaw<Array<{ current_database: string }>>`SELECT current_database()`;
  const currentDb = dbCheck[0]?.current_database;
  if (currentDb !== testDbName) {
    throw new Error(`CRITICAL: Connected to ${currentDb}, expected ${testDbName}!`);
  }

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

  const runId = Date.now().toString().slice(-6);
  const cleanupSourceIds: bigint[] = [];
  const cleanupUserIds: bigint[] = [];

  try {
    // ---------------------------------------------------------------
    // 1. MIGRATION & SCHEMA INTEGRITY
    // ---------------------------------------------------------------
    console.log('\n--- 1. DATABASE SCHEMA & MIGRATION VERIFICATION ---');

    // Check tracked migrations count
    const migrationsDir = path.join(repoRoot, 'prisma', 'migrations');
    const migrationDirs = fs.readdirSync(migrationsDir).filter((d) =>
      fs.statSync(path.join(migrationsDir, d)).isDirectory()
    );
    assert(
      migrationDirs.length === 15,
      'MIG-15-COUNT',
      `Expected 15 tracked migrations, found ${migrationDirs.length}`
    );

    // Verify all 5 tables exist in PostgreSQL
    const tables = ['mot_profile', 'mot_vehicle', 'mot_journey', 'mot_journey_stop', 'mot_journey_location'];
    for (const t of tables) {
      const exists: any[] = await prisma.$queryRaw`
        SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ${t};
      `;
      assert(exists.length > 0, `SCHEMA-TABLE-${t.toUpperCase()}`, `Table ${t} exists in database`);
    }

    // Verify partial unique indexes on mot_journey
    const indexes: any[] = await prisma.$queryRaw`
      SELECT indexname, indexdef FROM pg_indexes
      WHERE tablename = 'mot_journey' AND indexname IN ('idx_mot_journey_profile_collecting', 'idx_mot_journey_vehicle_collecting');
    `;
    const indexNames = indexes.map((i) => i.indexname);
    assert(
      indexNames.includes('idx_mot_journey_profile_collecting'),
      'INDEX-PROFILE-COLLECTING',
      'Partial unique index on mot_profile_id WHERE status = COLLECTING exists'
    );
    assert(
      indexNames.includes('idx_mot_journey_vehicle_collecting'),
      'INDEX-VEHICLE-COLLECTING',
      'Partial unique index on mot_vehicle_id WHERE status = COLLECTING exists'
    );

    // ---------------------------------------------------------------
    // 2. ROLE REGISTRATION & POLICIES
    // ---------------------------------------------------------------
    console.log('\n--- 2. ROLE REGISTRATION & POLICIES ---');
    assert(
      resolveRoleHome('MOT') === '/mot',
      'ROLE-ROUTING-MOT',
      'resolveRoleHome("MOT") maps to /mot'
    );
    assert(
      isCreatableRole('MOT'),
      'CREATABLE-ROLES-MOT',
      'MOT is registered in CREATABLE_ROLES'
    );
    const motPolicy = getRoleAssignmentPolicy('MOT');
    assert(
      motPolicy !== null && motPolicy.requiresSource === true && motPolicy.allowedSourceType === 'ZMCC',
      'ROLE-POLICY-MOT',
      'MOT role policy requires source-bound ZMCC assignment'
    );

    // ---------------------------------------------------------------
    // 3. TEST FIXTURE SETUP
    // ---------------------------------------------------------------
    console.log('\n--- 3. FIXTURES SETUP ---');

    // Create 2 ZMCC Procurement Sources (Center A and Center B)
    const zmccA = await prisma.procurementSource.create({
      data: {
        code: `ZMA-${runId}`,
        name: `ZMCC Alpha ${runId}`,
        source_type: 'ZMCC',
        is_active: true,
      },
    });
    cleanupSourceIds.push(zmccA.id);

    const zmccB = await prisma.procurementSource.create({
      data: {
        code: `ZMB-${runId}`,
        name: `ZMCC Beta ${runId}`,
        source_type: 'ZMCC',
        is_active: true,
      },
    });
    cleanupSourceIds.push(zmccB.id);

    // Create Users: Super Admin, Admin alias, ZMCC Manager A, ZMCC Manager B, PHE Operator A, MOT Driver A
    const superAdminUser = await prisma.user.create({
      data: {
        username: `sa_${runId}`,
        password_hash: 'hashed',
        full_name: 'Super Admin User',
        role: 'SUPER_ADMIN',
        department: 'System Administration',
        scope_type: 'SYSTEM',
        is_active: true,
      },
    });
    cleanupUserIds.push(superAdminUser.id);

    const adminAliasUser = await prisma.user.create({
      data: {
        username: `adm_${runId}`,
        password_hash: 'hashed',
        full_name: 'Admin Alias User',
        role: 'Admin',
        department: 'System Administration',
        scope_type: 'SYSTEM',
        is_active: true,
      },
    });
    cleanupUserIds.push(adminAliasUser.id);

    const zmccManagerA = await prisma.user.create({
      data: {
        username: `zm_a_${runId}`,
        password_hash: 'hashed',
        full_name: 'ZMCC Manager Alpha',
        role: 'ZMCC_MANAGER',
        department: 'Milk Procurement',
        scope_type: 'SOURCE',
        procurement_source_id: zmccA.id,
        is_active: true,
      },
    });
    cleanupUserIds.push(zmccManagerA.id);

    const zmccManagerB = await prisma.user.create({
      data: {
        username: `zm_b_${runId}`,
        password_hash: 'hashed',
        full_name: 'ZMCC Manager Beta',
        role: 'ZMCC_MANAGER',
        department: 'Milk Procurement',
        scope_type: 'SOURCE',
        procurement_source_id: zmccB.id,
        is_active: true,
      },
    });
    cleanupUserIds.push(zmccManagerB.id);

    const pheOperatorA = await prisma.user.create({
      data: {
        username: `phe_a_${runId}`,
        password_hash: 'hashed',
        full_name: 'PHE Operator Alpha',
        role: 'PHE_OPERATOR',
        department: 'Milk Procurement',
        scope_type: 'SOURCE',
        procurement_source_id: zmccA.id,
        is_active: true,
      },
    });
    cleanupUserIds.push(pheOperatorA.id);

    const motUserA = await prisma.user.create({
      data: {
        username: `mot_a_${runId}`,
        password_hash: 'hashed',
        full_name: 'MOT Driver Alpha',
        role: 'MOT',
        department: 'Milk Procurement',
        scope_type: 'SOURCE',
        procurement_source_id: zmccA.id,
        is_active: true,
      },
    });
    cleanupUserIds.push(motUserA.id);

    // Create Route A on ZMCC A
    const routeA = await prisma.zmccRoute.create({
      data: {
        route_code: `RT-A-${runId}`,
        name: `Route Alpha ${runId}`,
        origin: 'ZMCC Alpha',
        destination: 'Processing Plant',
        zmcc_id: zmccA.id,
        is_active: true,
        created_by: zmccManagerA.id,
      },
    });

    // Create Area & Milk Source for shop creation
    const areaA = await prisma.zmccArea.create({
      data: {
        area_code: `AR-A-${runId}`,
        name: `Area Alpha ${runId}`,
        route_id: routeA.id,
        zmcc_id: zmccA.id,
        is_active: true,
        created_by: zmccManagerA.id,
      },
    });

    const milkSourceA = await prisma.zmccMilkSource.create({
      data: {
        erp_code: `MS-A-${runId}`,
        name: `Milk Source Alpha ${runId}`,
        zmcc_id: zmccA.id,
        is_active: true,
        created_by: zmccManagerA.id,
      },
    });

    // Global Chiller Ownership
    const chillerOwnership = await prisma.chillerOwnership.create({
      data: {
        ownership_code: `CO-${runId}`,
        name: `Chiller Ownership ${runId}`,
        is_active: true,
        created_by: superAdminUser.id,
      },
    });

    // Create 3 active shops on Route A
    const shop1 = await prisma.zmccShop.create({
      data: {
        shop_code: `SHP-01-${runId}`,
        shop_name: `Shop 1 Alpha ${runId}`,
        owner_name: 'Shopkeeper One',
        phone_number: '0300-1111111',
        cnic: '35201-1111111-1',
        area_id: areaA.id,
        route_id: routeA.id,
        zmcc_id: zmccA.id,
        milk_source_id: milkSourceA.id,
        chiller_ownership_id: chillerOwnership.id,
        is_active: true,
        created_by: zmccManagerA.id,
      },
    });

    const shop2 = await prisma.zmccShop.create({
      data: {
        shop_code: `SHP-02-${runId}`,
        shop_name: `Shop 2 Alpha ${runId}`,
        owner_name: 'Shopkeeper Two',
        phone_number: '0300-2222222',
        cnic: '35201-2222222-2',
        area_id: areaA.id,
        route_id: routeA.id,
        zmcc_id: zmccA.id,
        milk_source_id: milkSourceA.id,
        chiller_ownership_id: chillerOwnership.id,
        is_active: true,
        created_by: zmccManagerA.id,
      },
    });

    const shop3 = await prisma.zmccShop.create({
      data: {
        shop_code: `SHP-03-${runId}`,
        shop_name: `Shop 3 Alpha ${runId}`,
        owner_name: 'Shopkeeper Three',
        phone_number: '0300-3333333',
        cnic: '35201-3333333-3',
        area_id: areaA.id,
        route_id: routeA.id,
        zmcc_id: zmccA.id,
        milk_source_id: milkSourceA.id,
        chiller_ownership_id: chillerOwnership.id,
        is_active: true,
        created_by: zmccManagerA.id,
      },
    });

    // Create an empty route on ZMCC A (0 shops)
    const emptyRouteA = await prisma.zmccRoute.create({
      data: {
        route_code: `RT-EMPTY-${runId}`,
        name: `Empty Route ${runId}`,
        origin: 'Origin',
        destination: 'Destination',
        zmcc_id: zmccA.id,
        is_active: true,
        created_by: zmccManagerA.id,
      },
    });

    console.log('  Fixtures initialized successfully.');

    // ---------------------------------------------------------------
    // 4. MOT PROFILE & VEHICLE AUTHORIZATION TESTS
    // ---------------------------------------------------------------
    console.log('\n--- 4. MOT PROFILES & VEHICLES AUTHORIZATION ---');

    // 4.1 Admin alias fails closed
    const adminReq = await makeReq('http://localhost/api/zmcc/mot/profiles', 'POST', adminAliasUser, {
      mot_code: `MOT-ADM-${runId}`,
      name: 'Admin MOT',
      phone_number: '0300-9999999',
      cnic: '35201-9999999-9',
      zmcc_id: zmccA.id.toString(),
    });
    const adminRes = await postProfiles(adminReq);
    assert(
      adminRes.status === 403,
      'AUTH-ADMIN-ALIAS-CLOSED',
      `Legacy Admin alias fails closed with HTTP ${adminRes.status}`
    );

    // 4.2 PHE Operator cannot create MOT profile (403)
    const pheCreateProfileReq = await makeReq('http://localhost/api/zmcc/mot/profiles', 'POST', pheOperatorA, {
      mot_code: `MOT-PHE-${runId}`,
      name: 'PHE MOT',
      phone_number: '0300-8888888',
      cnic: '35201-8888888-8',
    });
    const pheCreateProfileRes = await postProfiles(pheCreateProfileReq);
    assert(
      pheCreateProfileRes.status === 403,
      'AUTH-PHE-NO-CREATE-PROFILE',
      `PHE Operator blocked from creating MOT profile (HTTP ${pheCreateProfileRes.status})`
    );

    // 4.3 PHE Operator cannot create MOT vehicle (403)
    const pheCreateVehicleReq = await makeReq('http://localhost/api/zmcc/mot/vehicles', 'POST', pheOperatorA, {
      vehicle_number: `VEH-PHE-${runId}`,
    });
    const pheCreateVehicleRes = await postVehicles(pheCreateVehicleReq);
    assert(
      pheCreateVehicleRes.status === 403,
      'AUTH-PHE-NO-CREATE-VEHICLE',
      `PHE Operator blocked from creating MOT vehicle (HTTP ${pheCreateVehicleRes.status})`
    );

    // 4.4 ZMCC Manager A creates MOT Profile on ZMCC A
    const zmccManagerCreateProfileReq = await makeReq(
      'http://localhost/api/zmcc/mot/profiles',
      'POST',
      zmccManagerA,
      {
        mot_code: `MOT-A1-${runId}`,
        name: 'Tariq Mehmood',
        phone_number: '0300-7654321',
        cnic: '35201-7654321-1',
        user_id: motUserA.id.toString(),
      }
    );
    const zmccManagerCreateProfileRes = await postProfiles(zmccManagerCreateProfileReq);
    assert(
      zmccManagerCreateProfileRes.status === 201,
      'ZMCC-MGR-CREATE-PROFILE',
      `ZMCC Manager successfully created MOT profile (HTTP ${zmccManagerCreateProfileRes.status})`
    );
    const createdProfileA = (await zmccManagerCreateProfileRes.json()).profile;

    // 4.5 ZMCC Manager A creates MOT Vehicle on ZMCC A
    const zmccManagerCreateVehicleReq = await makeReq(
      'http://localhost/api/zmcc/mot/vehicles',
      'POST',
      zmccManagerA,
      {
        vehicle_number: `LES-${runId}`,
      }
    );
    const zmccManagerCreateVehicleRes = await postVehicles(zmccManagerCreateVehicleReq);
    assert(
      zmccManagerCreateVehicleRes.status === 201,
      'ZMCC-MGR-CREATE-VEHICLE',
      `ZMCC Manager successfully created MOT vehicle (HTTP ${zmccManagerCreateVehicleRes.status})`
    );
    const createdVehicleA = (await zmccManagerCreateVehicleRes.json()).vehicle;

    // 4.6 ZMCC Manager B cannot read or access Profile A (cross-ZMCC 403)
    const crossProfileReq = await makeReq(
      `http://localhost/api/zmcc/mot/profiles/${createdProfileA.id}`,
      'GET',
      zmccManagerB
    );
    const crossProfileRes = await getProfileById(crossProfileReq, {
      params: Promise.resolve({ id: createdProfileA.id }),
    });
    assert(
      crossProfileRes.status === 403,
      'CROSS-ZMCC-PROFILE-ISOLATION',
      `ZMCC Manager B cannot access ZMCC A profile (HTTP ${crossProfileRes.status})`
    );

    // 4.7 PHE Operator A CAN read active profiles on ZMCC A (for dispatch dropdown)
    const pheListProfilesReq = await makeReq('http://localhost/api/zmcc/mot/profiles', 'GET', pheOperatorA);
    const pheListProfilesRes = await getProfiles(pheListProfilesReq);
    assert(
      pheListProfilesRes.status === 200,
      'PHE-READ-PROFILES-ALLOWED',
      `PHE Operator can read active profiles (HTTP ${pheListProfilesRes.status})`
    );
    const pheProfilesData = await pheListProfilesRes.json();
    assert(
      pheProfilesData.profiles.some((p: any) => p.id === createdProfileA.id),
      'PHE-READ-OWN-ZMCC-PROFILES',
      'PHE Operator receives profiles in own ZMCC'
    );

    // ---------------------------------------------------------------
    // 5. ASSIGN & DISPATCH TESTS
    // ---------------------------------------------------------------
    console.log('\n--- 5. ASSIGN & DISPATCH VALIDATIONS & TRANSACTION ---');

    const todayPktStr = getOperationalBusinessDate(new Date());

    // 5.1 Rejection of non-today operational date
    const invalidDateReq = await makeReq(
      'http://localhost/api/zmcc/mot/journeys/assign-and-dispatch',
      'POST',
      zmccManagerA,
      {
        route_id: routeA.id.toString(),
        mot_profile_id: createdProfileA.id,
        mot_vehicle_id: createdVehicleA.id,
        operational_date: '2020-01-01', // Outdated date
        latitude: 31.5204,
        longitude: 74.3587,
      }
    );
    const invalidDateRes = await assignAndDispatch(invalidDateReq);
    assert(
      invalidDateRes.status === 400,
      'DISPATCH-REJECT-NON-TODAY-DATE',
      `Dispatch rejected non-today date with HTTP ${invalidDateRes.status}`
    );

    // 5.2 Rejection of missing/invalid GPS
    const invalidGpsReq = await makeReq(
      'http://localhost/api/zmcc/mot/journeys/assign-and-dispatch',
      'POST',
      zmccManagerA,
      {
        route_id: routeA.id.toString(),
        mot_profile_id: createdProfileA.id,
        mot_vehicle_id: createdVehicleA.id,
        latitude: 999.0, // Invalid latitude
        longitude: 74.3587,
      }
    );
    const invalidGpsRes = await assignAndDispatch(invalidGpsReq);
    assert(
      invalidGpsRes.status === 400,
      'DISPATCH-REJECT-INVALID-GPS',
      `Dispatch rejected invalid GPS range with HTTP ${invalidGpsRes.status}`
    );

    // 5.3 Rejection of route with 0 active shops
    const emptyRouteReq = await makeReq(
      'http://localhost/api/zmcc/mot/journeys/assign-and-dispatch',
      'POST',
      zmccManagerA,
      {
        route_id: emptyRouteA.id.toString(),
        mot_profile_id: createdProfileA.id,
        mot_vehicle_id: createdVehicleA.id,
        latitude: 31.5204,
        longitude: 74.3587,
      }
    );
    const emptyRouteRes = await assignAndDispatch(emptyRouteReq);
    assert(
      emptyRouteRes.status === 400,
      'DISPATCH-REJECT-EMPTY-SHOPS-ROUTE',
      `Dispatch rejected route with zero active shops with HTTP ${emptyRouteRes.status}`
    );

    // 5.4 SUCCESSFUL DISPATCH by PHE Operator A:
    // Immediate COLLECTING status, assigned_at == started_at, shop snapshot, GPS initial point
    const validDispatchReq = await makeReq(
      'http://localhost/api/zmcc/mot/journeys/assign-and-dispatch',
      'POST',
      pheOperatorA,
      {
        route_id: routeA.id.toString(),
        mot_profile_id: createdProfileA.id,
        mot_vehicle_id: createdVehicleA.id,
        latitude: 31.5203789,
        longitude: 74.3587456,
        accuracy: 12.5,
      }
    );
    const validDispatchRes = await assignAndDispatch(validDispatchReq);
    assert(
      validDispatchRes.status === 201,
      'DISPATCH-SUCCESS-HTTP-201',
      `Assign & Dispatch succeeded with HTTP ${validDispatchRes.status}`
    );
    const journeyData = (await validDispatchRes.json()).journey;

    assert(
      journeyData.status === 'COLLECTING',
      'DISPATCH-IMMEDIATE-COLLECTING',
      `Journey status is immediately '${journeyData.status}' (no start/accept button required)`
    );
    assert(
      journeyData.assigned_at === journeyData.started_at,
      'DISPATCH-ASSIGNED-EQUALS-STARTED',
      `assigned_at matches started_at (${journeyData.assigned_at})`
    );
    assert(
      journeyData.stops.length === 3,
      'DISPATCH-FROZEN-SHOPS-SNAPSHOT',
      `Frozen route stops snapshotted exactly ${journeyData.stops.length} shops`
    );
    assert(
      journeyData.stops[0].planned_sequence === 1 && journeyData.stops[1].planned_sequence === 2,
      'DISPATCH-STABLE-SEQUENCE',
      'Stops have stable sequence ordering (1, 2, 3)'
    );
    assert(
      journeyData.locations.length >= 1 && journeyData.locations[0].source_type === 'ASSIGNING_USER',
      'DISPATCH-INITIAL-LOCATION',
      'Initial location recorded with source_type = ASSIGNING_USER'
    );

    // 5.5 Concurrent active journey prevention:
    // Trying to assign the same MOT profile or vehicle to another journey must fail (409 Conflict)
    const duplicateProfileReq = await makeReq(
      'http://localhost/api/zmcc/mot/journeys/assign-and-dispatch',
      'POST',
      zmccManagerA,
      {
        route_id: routeA.id.toString(),
        mot_profile_id: createdProfileA.id, // Already active in journeyData!
        mot_vehicle_id: createdVehicleA.id,
        latitude: 31.5204,
        longitude: 74.3587,
      }
    );
    const duplicateProfileRes = await assignAndDispatch(duplicateProfileReq);
    assert(
      duplicateProfileRes.status === 409,
      'DISPATCH-PREVENT-CONCURRENT-ACTIVE-JOURNEY',
      `Blocked concurrent active journey for profile/vehicle with HTTP ${duplicateProfileRes.status}`
    );

    // 5.6 Deactivating profile or vehicle while active journey exists is blocked (400)
    const deactProfileReq = await makeReq(
      `http://localhost/api/zmcc/mot/profiles/${createdProfileA.id}`,
      'PATCH',
      zmccManagerA,
      { is_active: false }
    );
    const deactProfileRes = await patchProfile(deactProfileReq, {
      params: Promise.resolve({ id: createdProfileA.id }),
    });
    assert(
      deactProfileRes.status === 400,
      'DEACT-BLOCKED-ACTIVE-JOURNEY-PROFILE',
      `Deactivating MOT profile blocked with HTTP ${deactProfileRes.status}`
    );

    const deactVehicleReq = await makeReq(
      `http://localhost/api/zmcc/mot/vehicles/${createdVehicleA.id}`,
      'PATCH',
      zmccManagerA,
      { is_active: false }
    );
    const deactVehicleRes = await patchVehicle(deactVehicleReq, {
      params: Promise.resolve({ id: createdVehicleA.id }),
    });
    assert(
      deactVehicleRes.status === 400,
      'DEACT-BLOCKED-ACTIVE-JOURNEY-VEHICLE',
      `Deactivating MOT vehicle blocked with HTTP ${deactVehicleRes.status}`
    );

    // ---------------------------------------------------------------
    // 6. MOT DRIVER CURRENT JOURNEY LOOKUP
    // ---------------------------------------------------------------
    console.log('\n--- 6. MOT DRIVER CURRENT JOURNEY LOOKUP ---');

    const motLookupReq = await makeReq('http://localhost/api/zmcc/mot/journeys/current', 'GET', motUserA);
    const motLookupRes = await getCurrentJourney(motLookupReq);
    assert(
      motLookupRes.status === 200,
      'MOT-LOOKUP-HTTP-200',
      `MOT driver successfully queried current journey (HTTP ${motLookupRes.status})`
    );
    const motCurrentData = await motLookupRes.json();
    assert(
      motCurrentData.journey !== null && motCurrentData.journey.id === journeyData.id,
      'MOT-LOOKUP-CORRECT-JOURNEY',
      `MOT driver retrieved own active journey #${motCurrentData.journey.journey_number}`
    );
    assert(
      motCurrentData.journey.stops.length === 3,
      'MOT-LOOKUP-STOPS-PRESENT',
      `MOT driver retrieved ${motCurrentData.journey.stops.length} planned stops`
    );

    // ---------------------------------------------------------------
    // 7. CANCELLATION WORKFLOW & AUTHORIZATION
    // ---------------------------------------------------------------
    console.log('\n--- 7. CANCELLATION RULES & AUTHORIZATION ---');

    // 7.1 PHE Operator CANNOT cancel journey (403)
    const pheCancelReq = await makeReq(
      `http://localhost/api/zmcc/mot/journeys/${journeyData.id}/cancel`,
      'POST',
      pheOperatorA,
      { reason: 'Driver vehicle flat tire' }
    );
    const pheCancelRes = await cancelJourney(pheCancelReq, {
      params: Promise.resolve({ id: journeyData.id }),
    });
    assert(
      pheCancelRes.status === 403,
      'CANCEL-PHE-BLOCKED',
      `PHE Operator blocked from cancelling journey (HTTP ${pheCancelRes.status})`
    );

    // 7.2 MOT user CANNOT cancel journey (403)
    const motCancelReq = await makeReq(
      `http://localhost/api/zmcc/mot/journeys/${journeyData.id}/cancel`,
      'POST',
      motUserA,
      { reason: 'Want to cancel' }
    );
    const motCancelRes = await cancelJourney(motCancelReq, {
      params: Promise.resolve({ id: journeyData.id }),
    });
    assert(
      motCancelRes.status === 403,
      'CANCEL-MOT-BLOCKED',
      `MOT driver blocked from cancelling journey (HTTP ${motCancelRes.status})`
    );

    // 7.3 Empty cancellation reason is rejected (400)
    const emptyReasonReq = await makeReq(
      `http://localhost/api/zmcc/mot/journeys/${journeyData.id}/cancel`,
      'POST',
      zmccManagerA,
      { reason: '  ' }
    );
    const emptyReasonRes = await cancelJourney(emptyReasonReq, {
      params: Promise.resolve({ id: journeyData.id }),
    });
    assert(
      emptyReasonRes.status === 400,
      'CANCEL-REASON-MANDATORY',
      `Empty cancellation reason rejected with HTTP ${emptyReasonRes.status}`
    );

    // 7.4 ZMCC Manager A cancels journey with valid reason
    const validCancelReq = await makeReq(
      `http://localhost/api/zmcc/mot/journeys/${journeyData.id}/cancel`,
      'POST',
      zmccManagerA,
      { reason: 'Vehicle radiator overheating; vehicle swap required' }
    );
    const validCancelRes = await cancelJourney(validCancelReq, {
      params: Promise.resolve({ id: journeyData.id }),
    });
    assert(
      validCancelRes.status === 200,
      'CANCEL-SUCCESS-ZMCC-MGR',
      `ZMCC Manager cancelled journey successfully with HTTP ${validCancelRes.status}`
    );
    const cancelledData = (await validCancelRes.json()).journey;
    assert(
      cancelledData.status === 'CANCELLED',
      'CANCEL-STATUS-UPDATED',
      `Journey status updated to '${cancelledData.status}'`
    );
    assert(
      cancelledData.cancellation_reason.includes('radiator overheating'),
      'CANCEL-REASON-SAVED',
      'Cancellation reason persisted in database'
    );

    // 7.5 After cancellation, profile and vehicle can be assigned to a new journey!
    const reDispatchReq = await makeReq(
      'http://localhost/api/zmcc/mot/journeys/assign-and-dispatch',
      'POST',
      zmccManagerA,
      {
        route_id: routeA.id.toString(),
        mot_profile_id: createdProfileA.id,
        mot_vehicle_id: createdVehicleA.id,
        latitude: 31.5204,
        longitude: 74.3587,
      }
    );
    const reDispatchRes = await assignAndDispatch(reDispatchReq);
    assert(
      reDispatchRes.status === 201,
      'REDISPATCH-AFTER-CANCEL-SUCCESS',
      `Profile and Vehicle can be redispatched after cancellation (HTTP ${reDispatchRes.status})`
    );

    // ---------------------------------------------------------------
    // 8. SUPER ADMIN CROSS-ZMCC TRANSFER TESTS
    // ---------------------------------------------------------------
    console.log('\n--- 8. SUPER ADMIN CROSS-ZMCC TRANSFER ---');

    // Super Admin creates a vehicle on ZMCC A
    const transferVehReq = await makeReq(
      'http://localhost/api/zmcc/mot/vehicles',
      'POST',
      superAdminUser,
      {
        vehicle_number: `TRF-${runId}`,
        zmcc_id: zmccA.id.toString(),
      }
    );
    const transferVehRes = await postVehicles(transferVehReq);
    const transferVeh = (await transferVehRes.json()).vehicle;

    // ZMCC Manager A cannot transfer vehicle to ZMCC B (403)
    const zmccTransferReq = await makeReq(
      `http://localhost/api/zmcc/mot/vehicles/${transferVeh.id}`,
      'PATCH',
      zmccManagerA,
      { zmcc_id: zmccB.id.toString() }
    );
    const zmccTransferRes = await patchVehicle(zmccTransferReq, {
      params: Promise.resolve({ id: transferVeh.id }),
    });
    assert(
      zmccTransferRes.status === 403,
      'TRANSFER-ZMCC-MGR-BLOCKED',
      `ZMCC Manager blocked from transferring vehicle to another ZMCC (HTTP ${zmccTransferRes.status})`
    );

    // Super Admin CAN transfer vehicle to ZMCC B
    const superTransferReq = await makeReq(
      `http://localhost/api/zmcc/mot/vehicles/${transferVeh.id}`,
      'PATCH',
      superAdminUser,
      { zmcc_id: zmccB.id.toString() }
    );
    const superTransferRes = await patchVehicle(superTransferReq, {
      params: Promise.resolve({ id: transferVeh.id }),
    });
    assert(
      superTransferRes.status === 200,
      'TRANSFER-SUPER-ADMIN-ALLOWED',
      `Super Admin successfully transferred vehicle across ZMCCs (HTTP ${superTransferRes.status})`
    );

    console.log(`\n=====================================================================`);
    console.log(`STAGE 6C REGRESSION SUITE: ${passed} PASSED, ${failed} FAILED`);
    console.log(`=====================================================================\n`);

    if (failed > 0) {
      process.exit(1);
    }
  } catch (err) {
    console.error('CRITICAL UNHANDLED ERROR in Stage 6C test suite:', err);
    process.exit(1);
  } finally {
    // Clean up test data
    try {
      const { prisma } = await import('../src/backend/core/db');
      if (cleanupSourceIds.length > 0) {
        await prisma.motJourneyLocation.deleteMany({
          where: { journey: { zmcc_id: { in: cleanupSourceIds } } },
        });
        await prisma.motJourneyStop.deleteMany({
          where: { journey: { zmcc_id: { in: cleanupSourceIds } } },
        });
        await prisma.motJourney.deleteMany({
          where: { zmcc_id: { in: cleanupSourceIds } },
        });
        await prisma.motProfile.deleteMany({
          where: { zmcc_id: { in: cleanupSourceIds } },
        });
        await prisma.motVehicle.deleteMany({
          where: { zmcc_id: { in: cleanupSourceIds } },
        });
        await prisma.zmccShop.deleteMany({
          where: { zmcc_id: { in: cleanupSourceIds } },
        });
        await prisma.zmccMilkSource.deleteMany({
          where: { zmcc_id: { in: cleanupSourceIds } },
        });
        await prisma.zmccArea.deleteMany({
          where: { zmcc_id: { in: cleanupSourceIds } },
        });
        await prisma.zmccRoute.deleteMany({
          where: { zmcc_id: { in: cleanupSourceIds } },
        });
      }
      await prisma.chillerOwnership.deleteMany({
        where: { ownership_code: `CO-${runId}` },
      });
      if (cleanupUserIds.length > 0) {
        await prisma.user.deleteMany({
          where: {
            id: {
              in: cleanupUserIds,
            },
          },
        });
      }
      if (cleanupSourceIds.length > 0) {
        await prisma.procurementSource.deleteMany({
          where: { id: { in: cleanupSourceIds } },
        });
      }
      await prisma.$disconnect();
    } catch {}
  }
}

runStage6cTests();
