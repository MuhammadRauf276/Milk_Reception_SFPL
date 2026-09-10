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

    // Additional users for linked user consistency testing:
    // 1. MOT user assigned to ZMCC B (cross-ZMCC for ZMCC A)
    const motUserB = await prisma.user.create({
      data: {
        username: `mot_b_${runId}`,
        password_hash: 'hashed',
        full_name: 'MOT Driver Beta',
        role: 'MOT',
        department: 'Milk Procurement',
        scope_type: 'SOURCE',
        procurement_source_id: zmccB.id,
        is_active: true,
      },
    });
    cleanupUserIds.push(motUserB.id);

    // 2. Inactive MOT user
    const inactiveMotUser = await prisma.user.create({
      data: {
        username: `mot_inact_${runId}`,
        password_hash: 'hashed',
        full_name: 'Inactive MOT Driver',
        role: 'MOT',
        department: 'Milk Procurement',
        scope_type: 'SOURCE',
        procurement_source_id: zmccA.id,
        is_active: false,
      },
    });
    cleanupUserIds.push(inactiveMotUser.id);

    // 3. User with incorrect role (Security_Operator)
    const wrongRoleUser = await prisma.user.create({
      data: {
        username: `sec_${runId}`,
        password_hash: 'hashed',
        full_name: 'Security User',
        role: 'Security_Operator',
        department: 'Security',
        scope_type: 'SOURCE',
        procurement_source_id: zmccA.id,
        is_active: true,
      },
    });
    cleanupUserIds.push(wrongRoleUser.id);

    // 4. User without procurement source (SYSTEM scope)
    const missingSourceUser = await prisma.user.create({
      data: {
        username: `nosrc_${runId}`,
        password_hash: 'hashed',
        full_name: 'No Source User',
        role: 'MOT',
        department: 'Milk Procurement',
        scope_type: 'SYSTEM',
        is_active: true,
      },
    });
    cleanupUserIds.push(missingSourceUser.id);

    // Multi-area route on ZMCC B for STOP ORDERING test
    const routeB = await prisma.zmccRoute.create({
      data: {
        route_code: `RT-B-${runId}`,
        name: `Route Beta ${runId}`,
        origin: 'ZMCC Beta',
        destination: 'Processing Plant',
        zmcc_id: zmccB.id,
        is_active: true,
        created_by: zmccManagerB.id,
      },
    });

    const areaB1 = await prisma.zmccArea.create({
      data: {
        area_code: `01-AR-B-${runId}`,
        name: `Area B1 ${runId}`,
        route_id: routeB.id,
        zmcc_id: zmccB.id,
        is_active: true,
        created_by: zmccManagerB.id,
      },
    });

    const areaB2 = await prisma.zmccArea.create({
      data: {
        area_code: `02-AR-B-${runId}`,
        name: `Area B2 ${runId}`,
        route_id: routeB.id,
        zmcc_id: zmccB.id,
        is_active: true,
        created_by: zmccManagerB.id,
      },
    });

    const milkSourceB = await prisma.zmccMilkSource.create({
      data: {
        erp_code: `MS-B-${runId}`,
        name: `Milk Source Beta ${runId}`,
        zmcc_id: zmccB.id,
        is_active: true,
        created_by: zmccManagerB.id,
      },
    });

    // In Area B1 (01-AR-B), shop code is ZZZ (alphabetically last)
    const shopB1 = await prisma.zmccShop.create({
      data: {
        shop_code: `SHP-ZZ-${runId}`,
        shop_name: `Shop ZZ in Area 1 ${runId}`,
        owner_name: 'Owner ZZ',
        phone_number: '0300-9999999',
        cnic: '35201-9999999-9',
        area_id: areaB1.id,
        route_id: routeB.id,
        zmcc_id: zmccB.id,
        milk_source_id: milkSourceB.id,
        chiller_ownership_id: chillerOwnership.id,
        is_active: true,
        created_by: zmccManagerB.id,
      },
    });

    // In Area B2 (02-AR-B), shop code is AAA (alphabetically first)
    const shopB2 = await prisma.zmccShop.create({
      data: {
        shop_code: `SHP-AA-${runId}`,
        shop_name: `Shop AA in Area 2 ${runId}`,
        owner_name: 'Owner AA',
        phone_number: '0300-8888888',
        cnic: '35201-8888888-8',
        area_id: areaB2.id,
        route_id: routeB.id,
        zmcc_id: zmccB.id,
        milk_source_id: milkSourceB.id,
        chiller_ownership_id: chillerOwnership.id,
        is_active: true,
        created_by: zmccManagerB.id,
      },
    });

    // MOT Profile and Vehicle on ZMCC B for Stop Ordering & Cross-ZMCC test
    const profileB = await prisma.motProfile.create({
      data: {
        mot_code: `MOT-B1-${runId}`,
        name: 'Profile Beta',
        phone_number: '0300-5555555',
        cnic: '35201-5555555-5',
        zmcc_id: zmccB.id,
        user_id: motUserB.id,
        is_active: true,
        created_by: zmccManagerB.id,
      },
    });

    const vehicleB = await prisma.motVehicle.create({
      data: {
        vehicle_number: `VEH-B-${runId}`,
        zmcc_id: zmccB.id,
        is_active: true,
        created_by: zmccManagerB.id,
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

    // 4.3.1 Linked User Consistency: Rejection of cross-ZMCC linked user
    const crossUserCreateReq = await makeReq('http://localhost/api/zmcc/mot/profiles', 'POST', zmccManagerA, {
      mot_code: `MOT-FAIL-1-${runId}`,
      name: 'Fail User 1',
      phone_number: '0300-1234567',
      cnic: '35201-1234567-1',
      user_id: motUserB.id.toString(), // Belongs to ZMCC B!
    });
    const crossUserCreateRes = await postProfiles(crossUserCreateReq);
    assert(
      crossUserCreateRes.status === 400,
      'USER-LINK-REJECT-CROSS-ZMCC',
      `Profile creation rejected cross-ZMCC user (HTTP ${crossUserCreateRes.status})`
    );

    // 4.3.2 Linked User Consistency: Rejection of inactive linked user
    const inactUserCreateReq = await makeReq('http://localhost/api/zmcc/mot/profiles', 'POST', zmccManagerA, {
      mot_code: `MOT-FAIL-2-${runId}`,
      name: 'Fail User 2',
      phone_number: '0300-1234567',
      cnic: '35201-1234567-1',
      user_id: inactiveMotUser.id.toString(),
    });
    const inactUserCreateRes = await postProfiles(inactUserCreateReq);
    assert(
      inactUserCreateRes.status === 400,
      'USER-LINK-REJECT-INACTIVE',
      `Profile creation rejected inactive user (HTTP ${inactUserCreateRes.status})`
    );

    // 4.3.3 Linked User Consistency: Rejection of non-MOT role
    const wrongRoleCreateReq = await makeReq('http://localhost/api/zmcc/mot/profiles', 'POST', zmccManagerA, {
      mot_code: `MOT-FAIL-3-${runId}`,
      name: 'Fail User 3',
      phone_number: '0300-1234567',
      cnic: '35201-1234567-1',
      user_id: wrongRoleUser.id.toString(),
    });
    const wrongRoleCreateRes = await postProfiles(wrongRoleCreateReq);
    assert(
      wrongRoleCreateRes.status === 400,
      'USER-LINK-REJECT-WRONG-ROLE',
      `Profile creation rejected non-MOT user (HTTP ${wrongRoleCreateRes.status})`
    );

    // 4.3.4 Linked User Consistency: Rejection of user with missing procurement source
    const missingSrcCreateReq = await makeReq('http://localhost/api/zmcc/mot/profiles', 'POST', zmccManagerA, {
      mot_code: `MOT-FAIL-4-${runId}`,
      name: 'Fail User 4',
      phone_number: '0300-1234567',
      cnic: '35201-1234567-1',
      user_id: missingSourceUser.id.toString(),
    });
    const missingSrcCreateRes = await postProfiles(missingSrcCreateReq);
    assert(
      missingSrcCreateRes.status === 400,
      'USER-LINK-REJECT-MISSING-SOURCE',
      `Profile creation rejected user without ZMCC source (HTTP ${missingSrcCreateRes.status})`
    );

    // 4.4 ZMCC Manager A creates MOT Profile on ZMCC A with valid linked user motUserA
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

    // 4.4.1 Update Profile: Rejection of cross-ZMCC user link update
    const updateCrossUserReq = await makeReq(
      `http://localhost/api/zmcc/mot/profiles/${createdProfileA.id}`,
      'PATCH',
      zmccManagerA,
      { user_id: motUserB.id.toString() }
    );
    const updateCrossUserRes = await patchProfile(updateCrossUserReq, {
      params: Promise.resolve({ id: createdProfileA.id }),
    });
    assert(
      updateCrossUserRes.status === 400,
      'USER-LINK-UPDATE-REJECT-CROSS-ZMCC',
      `Profile update rejected cross-ZMCC user link (HTTP ${updateCrossUserRes.status})`
    );

    // 4.4.2 Super Admin Profile Transfer: Rejected if linked user still belongs to current ZMCC
    const transferWithOldUserReq = await makeReq(
      `http://localhost/api/zmcc/mot/profiles/${createdProfileA.id}`,
      'PATCH',
      superAdminUser,
      { zmcc_id: zmccB.id.toString() }
    );
    const transferWithOldUserRes = await patchProfile(transferWithOldUserReq, {
      params: Promise.resolve({ id: createdProfileA.id }),
    });
    assert(
      transferWithOldUserRes.status === 400,
      'TRANSFER-REJECT-LINKED-USER-MISMATCH',
      `Super Admin transfer rejected when linked user belongs to old ZMCC (HTTP ${transferWithOldUserRes.status})`
    );

    // 4.4.3 ZMCC Manager must never transfer a profile (403)
    const zmccMgrTransferProfileReq = await makeReq(
      `http://localhost/api/zmcc/mot/profiles/${createdProfileA.id}`,
      'PATCH',
      zmccManagerA,
      { zmcc_id: zmccB.id.toString() }
    );
    const zmccMgrTransferProfileRes = await patchProfile(zmccMgrTransferProfileReq, {
      params: Promise.resolve({ id: createdProfileA.id }),
    });
    assert(
      zmccMgrTransferProfileRes.status === 403,
      'TRANSFER-PROFILE-ZMCC-MGR-BLOCKED',
      `ZMCC Manager blocked from transferring profile across ZMCCs (HTTP ${zmccMgrTransferProfileRes.status})`
    );

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

    // 5.0.1 Rejection of missing idempotency_key (400)
    const missingKeyReq = await makeReq(
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
    const missingKeyRes = await assignAndDispatch(missingKeyReq);
    assert(
      missingKeyRes.status === 400,
      'DISPATCH-REJECT-MISSING-IDEMPOTENCY-KEY',
      `Dispatch rejected missing idempotency key with HTTP ${missingKeyRes.status}`
    );

    // 5.0.2 Rejection of blank idempotency_key (400)
    const blankKeyReq = await makeReq(
      'http://localhost/api/zmcc/mot/journeys/assign-and-dispatch',
      'POST',
      zmccManagerA,
      {
        route_id: routeA.id.toString(),
        mot_profile_id: createdProfileA.id,
        mot_vehicle_id: createdVehicleA.id,
        latitude: 31.5204,
        longitude: 74.3587,
        idempotency_key: '   ',
      }
    );
    const blankKeyRes = await assignAndDispatch(blankKeyReq);
    assert(
      blankKeyRes.status === 400,
      'DISPATCH-REJECT-BLANK-IDEMPOTENCY-KEY',
      `Dispatch rejected blank idempotency key with HTTP ${blankKeyRes.status}`
    );

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
        idempotency_key: `DISP-DATE-${runId}`,
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
        idempotency_key: `DISP-GPS-${runId}`,
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
        idempotency_key: `DISP-EMPTY-${runId}`,
      }
    );
    const emptyRouteRes = await assignAndDispatch(emptyRouteReq);
    assert(
      emptyRouteRes.status === 400,
      'DISPATCH-REJECT-EMPTY-SHOPS-ROUTE',
      `Dispatch rejected route with zero active shops with HTTP ${emptyRouteRes.status}`
    );

    // 5.4 SUCCESSFUL DISPATCH by PHE Operator A with client idempotency key
    const primaryIdempotencyKey = `IDEMP-ALPHA-${runId}`;
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
        idempotency_key: primaryIdempotencyKey,
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

    // 5.4.1 IDEMPOTENT RETRY: Identical retry returns 200 with same journey and creates NO duplicates
    const retryDispatchReq = await makeReq(
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
        idempotency_key: primaryIdempotencyKey,
      }
    );
    const retryDispatchRes = await assignAndDispatch(retryDispatchReq);
    assert(
      retryDispatchRes.status === 200,
      'IDEMPOTENT-RETRY-HTTP-200',
      `Identical dispatch retry returned HTTP ${retryDispatchRes.status}`
    );
    const retryJourneyData = (await retryDispatchRes.json()).journey;
    assert(
      retryJourneyData.id === journeyData.id,
      'IDEMPOTENT-RETRY-SAME-JOURNEY',
      `Retry returned exact same journey #${retryJourneyData.journey_number}`
    );

    // Verify in database: stops count is still 3, location count is still 1
    const dbStopsCount = await prisma.motJourneyStop.count({
      where: { journey_id: BigInt(journeyData.id) },
    });
    assert(
      dbStopsCount === 3,
      'IDEMPOTENT-RETRY-NO-DUPLICATE-STOPS',
      `Database stops count remained strictly ${dbStopsCount} without duplicates`
    );
    const dbLocCount = await prisma.motJourneyLocation.count({
      where: { journey_id: BigInt(journeyData.id) },
    });
    assert(
      dbLocCount === 1,
      'IDEMPOTENT-RETRY-NO-DUPLICATE-LOCATIONS',
      `Database locations count remained strictly ${dbLocCount} without duplicates`
    );
    const dbAuditCount = await prisma.auditLog.count({
      where: {
        table_name: 'mot_journey',
        record_id: BigInt(journeyData.id),
        action: 'MOT_JOURNEY_ASSIGN_AND_DISPATCH',
      },
    });
    assert(
      dbAuditCount === 1,
      'IDEMPOTENT-RETRY-EXACTLY-ONE-AUDIT-ROW',
      `Database audit log count for journey dispatch remained strictly ${dbAuditCount}`
    );

    // 5.4.2 Same idempotency key with CHANGED parameters returns 409
    const alteredKeyReq = await makeReq(
      'http://localhost/api/zmcc/mot/journeys/assign-and-dispatch',
      'POST',
      zmccManagerA,
      {
        route_id: emptyRouteA.id.toString(), // Changed route!
        mot_profile_id: createdProfileA.id,
        mot_vehicle_id: createdVehicleA.id,
        latitude: 31.5204,
        longitude: 74.3587,
        idempotency_key: primaryIdempotencyKey,
      }
    );
    const alteredKeyRes = await assignAndDispatch(alteredKeyReq);
    assert(
      alteredKeyRes.status === 409,
      'IDEMPOTENT-REJECT-ALTERED-PARAMETERS',
      `Reusing idempotency key with different parameters rejected with HTTP ${alteredKeyRes.status}`
    );

    // 5.4.3 Another ZMCC cannot retrieve or reuse this journey's idempotency key (409)
    const crossZmccKeyReq = await makeReq(
      'http://localhost/api/zmcc/mot/journeys/assign-and-dispatch',
      'POST',
      zmccManagerB,
      {
        route_id: routeB.id.toString(),
        mot_profile_id: profileB.id.toString(),
        mot_vehicle_id: vehicleB.id.toString(),
        latitude: 31.5204,
        longitude: 74.3587,
        idempotency_key: primaryIdempotencyKey, // Key from ZMCC A!
      }
    );
    const crossZmccKeyRes = await assignAndDispatch(crossZmccKeyReq);
    assert(
      crossZmccKeyRes.status === 409,
      'IDEMPOTENT-REJECT-CROSS-ZMCC-REUSE',
      `Cross-ZMCC key reuse rejected with HTTP ${crossZmccKeyRes.status}`
    );

    // 5.4.4 STOP ORDERING VERIFICATION (Route B on ZMCC B)
    // Area 1 (01-AR-B) has SHP-ZZ; Area 2 (02-AR-B) has SHP-AA.
    // Order must be area_code ASC, then shop_code ASC: SHP-ZZ must come before SHP-AA!
    const routeBDispatchReq = await makeReq(
      'http://localhost/api/zmcc/mot/journeys/assign-and-dispatch',
      'POST',
      zmccManagerB,
      {
        route_id: routeB.id.toString(),
        mot_profile_id: profileB.id.toString(),
        mot_vehicle_id: vehicleB.id.toString(),
        latitude: 31.5204,
        longitude: 74.3587,
        idempotency_key: `IDEMP-BETA-${runId}`,
      }
    );
    const routeBDispatchRes = await assignAndDispatch(routeBDispatchReq);
    assert(
      routeBDispatchRes.status === 201,
      'ROUTE-B-DISPATCH-SUCCESS',
      `Route B dispatched successfully with HTTP ${routeBDispatchRes.status}`
    );
    const routeBJourney = (await routeBDispatchRes.json()).journey;
    assert(
      routeBJourney.stops.length === 2,
      'ROUTE-B-STOPS-COUNT',
      `Route B has 2 stops`
    );
    assert(
      routeBJourney.stops[0].shop.shop_code === `SHP-ZZ-${runId}`,
      'STOP-ORDER-AREA-PRECEDENCE-1',
      `Stop 1 is ${routeBJourney.stops[0].shop.shop_code} (Area 01-AR-B takes precedence over shop code alphabetical)`
    );
    assert(
      routeBJourney.stops[1].shop.shop_code === `SHP-AA-${runId}`,
      'STOP-ORDER-AREA-PRECEDENCE-2',
      `Stop 2 is ${routeBJourney.stops[1].shop.shop_code} (Area 02-AR-B)`
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
        idempotency_key: `IDEMP-DUP-${runId}`,
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

    // 7.4.1 Concurrency Safety: Duplicate cancellation on already cancelled journey fails closed
    const repeatCancelReq = await makeReq(
      `http://localhost/api/zmcc/mot/journeys/${journeyData.id}/cancel`,
      'POST',
      zmccManagerA,
      { reason: 'Second cancellation attempt' }
    );
    const repeatCancelRes = await cancelJourney(repeatCancelReq, {
      params: Promise.resolve({ id: journeyData.id }),
    });
    assert(
      repeatCancelRes.status === 400,
      'CANCEL-CONCURRENCY-SAFE-ALREADY-CANCELLED',
      `Repeat cancellation rejected with HTTP ${repeatCancelRes.status} (only active COLLECTING journeys can be cancelled)`
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
        idempotency_key: `IDEMP-REDISP-${runId}`,
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

    // ---------------------------------------------------------------
    // 9. IMMUTABLE AUDITLOG INTEGRITY
    // ---------------------------------------------------------------
    console.log('\n--- 9. IMMUTABLE AUDITLOG INTEGRITY ---');

    // 9.1 MotProfile Audit Logs
    const profileAudit = await prisma.auditLog.findFirst({
      where: {
        table_name: 'mot_profile',
        record_id: BigInt(createdProfileA.id),
        action: 'MOT_PROFILE_CREATED',
      },
    });
    assert(
      profileAudit !== null && profileAudit.user_id === zmccManagerA.id,
      'AUDIT-MOT-PROFILE-CREATED',
      `Verified AuditLog record for MOT_PROFILE_CREATED (actor user: ${profileAudit?.user_id})`
    );

    // 9.2 MotVehicle Audit Logs
    const vehicleAudit = await prisma.auditLog.findFirst({
      where: {
        table_name: 'mot_vehicle',
        record_id: BigInt(createdVehicleA.id),
        action: 'MOT_VEHICLE_CREATED',
      },
    });
    assert(
      vehicleAudit !== null && vehicleAudit.user_id === zmccManagerA.id,
      'AUDIT-MOT-VEHICLE-CREATED',
      `Verified AuditLog record for MOT_VEHICLE_CREATED (actor user: ${vehicleAudit?.user_id})`
    );

    // 9.3 Vehicle Transfer Audit Log
    const vehicleTransferAudit = await prisma.auditLog.findFirst({
      where: {
        table_name: 'mot_vehicle',
        record_id: BigInt(transferVeh.id),
        action: 'MOT_VEHICLE_TRANSFERRED',
      },
    });
    assert(
      vehicleTransferAudit !== null && vehicleTransferAudit.user_id === superAdminUser.id,
      'AUDIT-MOT-VEHICLE-TRANSFERRED',
      `Verified AuditLog record for MOT_VEHICLE_TRANSFERRED by Super Admin`
    );

    // 9.4 MotJourney Assign & Dispatch Audit Log
    const journeyDispatchAudit = await prisma.auditLog.findFirst({
      where: {
        table_name: 'mot_journey',
        record_id: BigInt(journeyData.id),
        action: 'MOT_JOURNEY_ASSIGN_AND_DISPATCH',
      },
    });
    assert(
      journeyDispatchAudit !== null && journeyDispatchAudit.user_id === pheOperatorA.id,
      'AUDIT-MOT-JOURNEY-DISPATCHED',
      `Verified AuditLog record for MOT_JOURNEY_ASSIGN_AND_DISPATCH (actor user: ${journeyDispatchAudit?.user_id})`
    );

    // 9.5 MotJourney Cancel Audit Log
    const journeyCancelAudit = await prisma.auditLog.findFirst({
      where: {
        table_name: 'mot_journey',
        record_id: BigInt(journeyData.id),
        action: 'MOT_JOURNEY_CANCEL',
      },
    });
    assert(
      journeyCancelAudit !== null && journeyCancelAudit.user_id === zmccManagerA.id,
      'AUDIT-MOT-JOURNEY-CANCELLED',
      `Verified AuditLog record for MOT_JOURNEY_CANCEL (actor user: ${journeyCancelAudit?.user_id})`
    );

    // ---------------------------------------------------------------
    // 10. CONCURRENCY REGRESSION TESTS (Promise.all)
    // ---------------------------------------------------------------
    console.log('\n--- 10. CONCURRENCY REGRESSION TESTS ---');

    // 10.1 Two identical dispatch requests with the same idempotency key arriving concurrently
    // Create new dedicated MOT and Vehicle for this test
    const cMotUser1 = await prisma.user.create({
      data: {
        username: `cmot1_${runId}`,
        role: 'MOT',
        scope_type: 'SOURCE',
        procurement_source_id: zmccA.id,
        is_active: true,
      },
    });
    cleanupUserIds.push(cMotUser1.id);

    const cProfile1 = await prisma.motProfile.create({
      data: {
        mot_code: `MOT-C1-${runId}`,
        name: 'Concurrent Profile 1',
        phone_number: '0300-9111111',
        cnic: '35201-9111111-1',
        zmcc_id: zmccA.id,
        user_id: cMotUser1.id,
        is_active: true,
        created_by: zmccManagerA.id,
      },
    });

    const cVehicle1 = await prisma.motVehicle.create({
      data: {
        vehicle_number: `VEH-C1-${runId}`,
        zmcc_id: zmccA.id,
        is_active: true,
        created_by: zmccManagerA.id,
      },
    });

    const sameKeyConcurrent = `IDEMP-CONC-SAME-${runId}`;
    const dispatchPayloadSameKey = {
      route_id: routeA.id.toString(),
      mot_profile_id: cProfile1.id.toString(),
      mot_vehicle_id: cVehicle1.id.toString(),
      latitude: 31.5204,
      longitude: 74.3587,
      accuracy: 10,
      idempotency_key: sameKeyConcurrent,
    };

    const [resSame1, resSame2] = await Promise.all([
      assignAndDispatch(await makeReq('http://localhost:3000/api/zmcc/mot/journeys/assign-and-dispatch', 'POST', zmccManagerA, dispatchPayloadSameKey)),
      assignAndDispatch(await makeReq('http://localhost:3000/api/zmcc/mot/journeys/assign-and-dispatch', 'POST', zmccManagerA, dispatchPayloadSameKey)),
    ]);

    const jsonSame1 = await resSame1.json();
    const jsonSame2 = await resSame2.json();

    // Both should succeed (one 201 created, one 200 idempotent retry, or both 200/201)
    const sameSuccess = (resSame1.status === 201 || resSame1.status === 200) && (resSame2.status === 201 || resSame2.status === 200);
    assert(sameSuccess, 'CONC-SAME-KEY-BOTH-SUCCEED', `Concurrent same-key dispatches succeeded (${resSame1.status}, ${resSame2.status})`);

    const journeyId1 = jsonSame1.journey?.id;
    const journeyId2 = jsonSame2.journey?.id;
    assert(journeyId1 === journeyId2 && journeyId1 != null, 'CONC-SAME-KEY-SAME-JOURNEY', `Both requests returned same journey ID: ${journeyId1}`);

    // Verify exactly one journey, stops set, location set, and audit row
    const dbJourneysCount = await prisma.motJourney.count({
      where: { idempotency_key: sameKeyConcurrent },
    });
    assert(dbJourneysCount === 1, 'CONC-SAME-KEY-EXACTLY-ONE-JOURNEY', `Exactly 1 MotJourney created in DB: ${dbJourneysCount}`);

    const dbConcStopsCount = await prisma.motJourneyStop.count({
      where: { journey_id: BigInt(journeyId1) },
    });
    assert(dbConcStopsCount === 3, 'CONC-SAME-KEY-EXACTLY-ONE-STOPS-SET', `Stops snapshotted strictly once (count: ${dbConcStopsCount})`);

    const dbConcLocCount = await prisma.motJourneyLocation.count({
      where: { journey_id: BigInt(journeyId1) },
    });
    assert(dbConcLocCount === 1, 'CONC-SAME-KEY-EXACTLY-ONE-LOCATION', `Initial location recorded strictly once (count: ${dbConcLocCount})`);

    const dbConcAuditCount = await prisma.auditLog.count({
      where: {
        table_name: 'mot_journey',
        record_id: BigInt(journeyId1),
        action: 'MOT_JOURNEY_ASSIGN_AND_DISPATCH',
      },
    });
    assert(dbConcAuditCount === 1, 'CONC-SAME-KEY-EXACTLY-ONE-AUDIT-ROW', `Audit log recorded strictly once (count: ${dbConcAuditCount})`);

    // 10.2 Two simultaneous DIFFERENT valid dispatches with different MOTs and vehicles
    const cMotUser2A = await prisma.user.create({
      data: {
        username: `cmot2a_${runId}`,
        role: 'MOT',
        scope_type: 'SOURCE',
        procurement_source_id: zmccA.id,
        is_active: true,
      },
    });
    const cMotUser2B = await prisma.user.create({
      data: {
        username: `cmot2b_${runId}`,
        role: 'MOT',
        scope_type: 'SOURCE',
        procurement_source_id: zmccA.id,
        is_active: true,
      },
    });
    cleanupUserIds.push(cMotUser2A.id, cMotUser2B.id);

    const cProfile2A = await prisma.motProfile.create({
      data: {
        mot_code: `MOT-C2A-${runId}`,
        name: 'Concurrent Profile 2A',
        phone_number: '0300-9222221',
        cnic: '35201-9222221-1',
        zmcc_id: zmccA.id,
        user_id: cMotUser2A.id,
        is_active: true,
        created_by: zmccManagerA.id,
      },
    });
    const cProfile2B = await prisma.motProfile.create({
      data: {
        mot_code: `MOT-C2B-${runId}`,
        name: 'Concurrent Profile 2B',
        phone_number: '0300-9222222',
        cnic: '35201-9222222-2',
        zmcc_id: zmccA.id,
        user_id: cMotUser2B.id,
        is_active: true,
        created_by: zmccManagerA.id,
      },
    });

    const cVehicle2A = await prisma.motVehicle.create({
      data: {
        vehicle_number: `VEH-C2A-${runId}`,
        zmcc_id: zmccA.id,
        is_active: true,
        created_by: zmccManagerA.id,
      },
    });
    const cVehicle2B = await prisma.motVehicle.create({
      data: {
        vehicle_number: `VEH-C2B-${runId}`,
        zmcc_id: zmccA.id,
        is_active: true,
        created_by: zmccManagerA.id,
      },
    });

    const payloadDiffA = {
      route_id: routeA.id.toString(),
      mot_profile_id: cProfile2A.id.toString(),
      mot_vehicle_id: cVehicle2A.id.toString(),
      latitude: 31.5204,
      longitude: 74.3587,
      accuracy: 10,
      idempotency_key: `IDEMP-DIFF-A-${runId}`,
    };
    const payloadDiffB = {
      route_id: routeA.id.toString(),
      mot_profile_id: cProfile2B.id.toString(),
      mot_vehicle_id: cVehicle2B.id.toString(),
      latitude: 31.5204,
      longitude: 74.3587,
      accuracy: 10,
      idempotency_key: `IDEMP-DIFF-B-${runId}`,
    };

    const [resDiffA, resDiffB] = await Promise.all([
      assignAndDispatch(await makeReq('http://localhost:3000/api/zmcc/mot/journeys/assign-and-dispatch', 'POST', zmccManagerA, payloadDiffA)),
      assignAndDispatch(await makeReq('http://localhost:3000/api/zmcc/mot/journeys/assign-and-dispatch', 'POST', zmccManagerA, payloadDiffB)),
    ]);

    const jsonDiffA = await resDiffA.json();
    const jsonDiffB = await resDiffB.json();

    assert(resDiffA.status === 201 && resDiffB.status === 201, 'CONC-DIFF-BOTH-201', `Both concurrent different dispatches succeeded with 201`);
    assert(jsonDiffA.journey?.journey_number !== jsonDiffB.journey?.journey_number, 'CONC-DIFF-UNIQUE-JOURNEY-NUMBERS', `Journey numbers are distinct: ${jsonDiffA.journey?.journey_number} vs ${jsonDiffB.journey?.journey_number}`);

    // 10.3 Concurrent same-MOT conflict (two dispatches trying to use the same MOT profile concurrently)
    const cVehicleSameMot = await prisma.motVehicle.create({
      data: {
        vehicle_number: `VEH-CSM-${runId}`,
        zmcc_id: zmccA.id,
        is_active: true,
        created_by: zmccManagerA.id,
      },
    });

    const payloadSameMot1 = {
      route_id: routeA.id.toString(),
      mot_profile_id: cProfile2A.id.toString(), // Already assigned to active journey in 10.2!
      mot_vehicle_id: cVehicleSameMot.id.toString(),
      latitude: 31.5204,
      longitude: 74.3587,
      accuracy: 10,
      idempotency_key: `IDEMP-SMOT-1-${runId}`,
    };
    const payloadSameMot2 = {
      route_id: routeA.id.toString(),
      mot_profile_id: cProfile2A.id.toString(),
      mot_vehicle_id: cVehicleSameMot.id.toString(),
      latitude: 31.5204,
      longitude: 74.3587,
      accuracy: 10,
      idempotency_key: `IDEMP-SMOT-2-${runId}`,
    };

    const [resSameMot1, resSameMot2] = await Promise.all([
      assignAndDispatch(await makeReq('http://localhost:3000/api/zmcc/mot/journeys/assign-and-dispatch', 'POST', zmccManagerA, payloadSameMot1)),
      assignAndDispatch(await makeReq('http://localhost:3000/api/zmcc/mot/journeys/assign-and-dispatch', 'POST', zmccManagerA, payloadSameMot2)),
    ]);

    const jsonSameMot1 = await resSameMot1.json();
    const jsonSameMot2 = await resSameMot2.json();

    assert(resSameMot1.status === 409 && resSameMot2.status === 409, 'CONC-SAME-MOT-409-CONFLICT', `Both conflicting same-MOT dispatches rejected with 409 (${resSameMot1.status}, ${resSameMot2.status})`);
    assert(
      (jsonSameMot1.error || '').toLowerCase().includes('profile') || (jsonSameMot1.error || '').toLowerCase().includes('active'),
      'CONC-SAME-MOT-ERROR-DIFFERENTIATED-1',
      `Error 1 correctly specifies profile conflict: ${jsonSameMot1.error}`
    );
    assert(
      (jsonSameMot2.error || '').toLowerCase().includes('profile') || (jsonSameMot2.error || '').toLowerCase().includes('active'),
      'CONC-SAME-MOT-ERROR-DIFFERENTIATED-2',
      `Error 2 correctly specifies profile conflict: ${jsonSameMot2.error}`
    );

    // 10.4 Concurrent same-vehicle conflict (two dispatches trying to use the same vehicle concurrently)
    const cMotUserSameVeh = await prisma.user.create({
      data: {
        username: `cmotsv_${runId}`,
        role: 'MOT',
        scope_type: 'SOURCE',
        procurement_source_id: zmccA.id,
        is_active: true,
      },
    });
    cleanupUserIds.push(cMotUserSameVeh.id);

    const cProfileSameVeh = await prisma.motProfile.create({
      data: {
        mot_code: `MOT-CSV-${runId}`,
        name: 'Profile Same Veh',
        phone_number: '0300-9333333',
        cnic: '35201-9333333-3',
        zmcc_id: zmccA.id,
        user_id: cMotUserSameVeh.id,
        is_active: true,
        created_by: zmccManagerA.id,
      },
    });

    const payloadSameVeh1 = {
      route_id: routeA.id.toString(),
      mot_profile_id: cProfileSameVeh.id.toString(),
      mot_vehicle_id: cVehicle2A.id.toString(), // Already assigned to active journey in 10.2!
      latitude: 31.5204,
      longitude: 74.3587,
      accuracy: 10,
      idempotency_key: `IDEMP-SVEH-1-${runId}`,
    };
    const payloadSameVeh2 = {
      route_id: routeA.id.toString(),
      mot_profile_id: cProfileSameVeh.id.toString(),
      mot_vehicle_id: cVehicle2A.id.toString(),
      latitude: 31.5204,
      longitude: 74.3587,
      accuracy: 10,
      idempotency_key: `IDEMP-SVEH-2-${runId}`,
    };

    const [resSameVeh1, resSameVeh2] = await Promise.all([
      assignAndDispatch(await makeReq('http://localhost:3000/api/zmcc/mot/journeys/assign-and-dispatch', 'POST', zmccManagerA, payloadSameVeh1)),
      assignAndDispatch(await makeReq('http://localhost:3000/api/zmcc/mot/journeys/assign-and-dispatch', 'POST', zmccManagerA, payloadSameVeh2)),
    ]);

    const jsonSameVeh1 = await resSameVeh1.json();
    const jsonSameVeh2 = await resSameVeh2.json();

    assert(resSameVeh1.status === 409 && resSameVeh2.status === 409, 'CONC-SAME-VEH-409-CONFLICT', `Both conflicting same-vehicle dispatches rejected with 409 (${resSameVeh1.status}, ${resSameVeh2.status})`);
    assert(
      (jsonSameVeh1.error || '').toLowerCase().includes('vehicle') || (jsonSameVeh1.error || '').toLowerCase().includes('active'),
      'CONC-SAME-VEH-ERROR-DIFFERENTIATED-1',
      `Error 1 correctly specifies vehicle conflict: ${jsonSameVeh1.error}`
    );
    assert(
      (jsonSameVeh2.error || '').toLowerCase().includes('vehicle') || (jsonSameVeh2.error || '').toLowerCase().includes('active'),
      'CONC-SAME-VEH-ERROR-DIFFERENTIATED-2',
      `Error 2 correctly specifies vehicle conflict: ${jsonSameVeh2.error}`
    );

    // 10.5 Safely parse optional payload.zmcc_id for scoped users (malformed returns HTTP 400 without BigInt exception)
    const malformedPayload1 = {
      zmcc_id: 'not-a-number',
      route_id: routeA.id.toString(),
      mot_profile_id: cProfileSameVeh.id.toString(),
      mot_vehicle_id: cVehicleSameMot.id.toString(),
      latitude: 31.5204,
      longitude: 74.3587,
      accuracy: 10,
      idempotency_key: `IDEMP-MALF-1-${runId}`,
    };
    const resMalf1 = await assignAndDispatch(
      await makeReq('http://localhost:3000/api/zmcc/mot/journeys/assign-and-dispatch', 'POST', zmccManagerA, malformedPayload1)
    );
    const jsonMalf1 = await resMalf1.json();
    assert(resMalf1.status === 400, 'SCOPED-ZMCC-MALFORMED-NAN-400', `Malformed string zmcc_id returned 400 (Status: ${resMalf1.status})`);
    assert(jsonMalf1.error === 'Invalid ZMCC ID format.', 'SCOPED-ZMCC-MALFORMED-ERROR-MSG', `Expected 'Invalid ZMCC ID format.', got: ${jsonMalf1.error}`);

    const malformedPayload2 = {
      zmcc_id: '1234abc',
      route_id: routeA.id.toString(),
      mot_profile_id: cProfileSameVeh.id.toString(),
      mot_vehicle_id: cVehicleSameMot.id.toString(),
      latitude: 31.5204,
      longitude: 74.3587,
      accuracy: 10,
      idempotency_key: `IDEMP-MALF-2-${runId}`,
    };
    const resMalf2 = await assignAndDispatch(
      await makeReq('http://localhost:3000/api/zmcc/mot/journeys/assign-and-dispatch', 'POST', pheOperatorA, malformedPayload2)
    );
    assert(resMalf2.status === 400, 'PHE-ZMCC-MALFORMED-400', `PHE Operator with malformed zmcc_id returned 400 (Status: ${resMalf2.status})`);

    // Valid matching zmcc_id string for scoped user should pass validation
    const validMatchingPayload = {
      zmcc_id: zmccA.id.toString(),
      route_id: routeA.id.toString(),
      mot_profile_id: cProfileSameVeh.id.toString(),
      mot_vehicle_id: cVehicleSameMot.id.toString(),
      latitude: 31.5204,
      longitude: 74.3587,
      accuracy: 10,
      idempotency_key: `IDEMP-MATCHING-ZMCC-${runId}`,
    };
    const resMatching = await assignAndDispatch(
      await makeReq('http://localhost:3000/api/zmcc/mot/journeys/assign-and-dispatch', 'POST', zmccManagerA, validMatchingPayload)
    );
    assert(resMatching.status === 201, 'SCOPED-ZMCC-VALID-MATCHING-201', `Matching zmcc_id string passed validation and dispatched (Status: ${resMatching.status})`);

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
        await prisma.auditLog.deleteMany({
          where: {
            user_id: {
              in: cleanupUserIds,
            },
          },
        });
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
