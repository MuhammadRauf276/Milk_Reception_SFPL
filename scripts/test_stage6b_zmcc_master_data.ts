/**
 * STAGE 6B: ZMCC MASTER-DATA AUTHORIZATION, APIS, AND MANAGEMENT REGRESSION SUITE
 *
 * Verifies:
 * 1. Role-Based Authorization Matrix:
 *    - SUPER_ADMIN: Global management across all ZMCCs and global Chiller Ownership
 *    - ZMCC_MANAGER: Scoped management of Routes, Areas, Milk Sources, Shops in assigned ZMCC; blocked from Chiller Ownership
 *    - PHE_OPERATOR: Scoped management of Shops ONLY in assigned ZMCC; read-only for dependent dropdown data; blocked from Route/Area/MilkSource/Chiller writes
 *    - MOT and unrelated roles: Blocked with HTTP 403; zero proposal/approval workflows
 *    - Inactive users, inactive sources, non-ZMCC sources, legacy role aliases: fail closed (401/403)
 * 2. Cross-ZMCC Boundary Protection:
 *    - Scoped users cannot read or mutate foreign ZMCC records
 *    - Client-supplied zmcc_id cannot escape server-derived scope
 *    - Cross-ZMCC Route/Area/Source combinations rejected (400/403/409)
 * 3. Input Validation:
 *    - Non-empty codes and names
 *    - Pakistani mobile number format validation
 *    - Pakistani CNIC 13-digit format validation
 *    - GPS coordinates: both-or-neither nullability and range [-90..90, -180..180]
 * 4. Active / Inactive Lifecycle & Dependency Rules:
 *    - Route deactivation blocked if active areas or active shops exist (HTTP 409)
 *    - Area deactivation blocked if active shops exist (HTTP 409)
 *    - Milk Source deactivation blocked if active shops exist (HTTP 409)
 *    - Chiller Ownership deactivation blocked if active shops exist (HTTP 409)
 *    - Reactivation blocked if parent entity is inactive (HTTP 409)
 *    - Inactive records remain historically readable
 * 5. Audit Logging & Immutability:
 *    - Atomic transaction: mutation + audit log entry created together
 *    - created_by preserved forever; updated_by recorded as actor ID
 *    - AuditLog fields verified (table_name, record_id, action, old_values, new_values, user_id)
 *    - No physical DELETE endpoints exposed
 * 6. Test DB Safety: Strictly targets milk_reception_test; development DB untouched.
 */

import path from 'path';
import fs from 'fs';
import { assertSafeTestDatabase } from '../tests/helpers/testDbSafety';

// 1. First, load .env.test.local before importing any application modules
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
console.log('🧪 STAGE 6B: ZMCC MASTER-DATA AUTHORIZATION, APIS & MANAGEMENT SUITE');
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

async function runStage6bTests() {
  // 4. Dynamically import DB, Auth, and Route modules now that DATABASE_URL points to test DB
  const { prisma } = await import('../src/backend/core/db');
  const { createSessionToken } = await import('../src/backend/core/auth');

  const { GET: getRoutes, POST: postRoutes } = await import('../src/app/api/zmcc/routes/route');
  const { GET: getRouteById, PATCH: patchRoute } = await import('../src/app/api/zmcc/routes/[id]/route');
  const { GET: getAreas, POST: postAreas } = await import('../src/app/api/zmcc/areas/route');
  const { GET: getAreaById, PATCH: patchArea } = await import('../src/app/api/zmcc/areas/[id]/route');
  const { GET: getMilkSources, POST: postMilkSources } = await import('../src/app/api/zmcc/milk-sources/route');
  const { GET: getMilkSourceById, PATCH: patchMilkSource } = await import('../src/app/api/zmcc/milk-sources/[id]/route');
  const { GET: getChillerOwnerships, POST: postChillerOwnerships } = await import('../src/app/api/zmcc/chiller-ownerships/route');
  const { GET: getChillerOwnershipById, PATCH: patchChillerOwnership } = await import('../src/app/api/zmcc/chiller-ownerships/[id]/route');
  const { GET: getShops, POST: postShops } = await import('../src/app/api/zmcc/shops/route');
  const { GET: getShopById, PATCH: patchShop } = await import('../src/app/api/zmcc/shops/[id]/route');
  const { GET: getAuthMe } = await import('../src/app/api/auth/me/route');

  // Verify connected database
  const dbCheck = await prisma.$queryRaw<Array<{ current_database: string }>>`SELECT current_database()`;
  const currentDb = dbCheck[0]?.current_database;
  if (currentDb !== testDbName) {
    throw new Error(`CRITICAL SAFETY ERROR: Expected '${testDbName}', connected to '${currentDb}'`);
  }

  const ts = Date.now();

  // Test Entities Tracker for Cleanup
  const cleanupUserIds: bigint[] = [];
  const cleanupSourceIds: bigint[] = [];
  const cleanupRouteIds: bigint[] = [];
  const cleanupAreaIds: bigint[] = [];
  const cleanupMilkSourceIds: bigint[] = [];
  const cleanupChillerIds: bigint[] = [];
  const cleanupShopIds: bigint[] = [];

  try {
    // -------------------------------------------------------------
    // Setup Fixtures: 2 ZMCC Sources & 1 Contractor Source
    // -------------------------------------------------------------
    const zmcc1 = await prisma.procurementSource.create({
      data: {
        code: `Z1_${ts}`.slice(0, 10),
        name: `ZMCC Alpha ${ts}`,
        source_type: 'ZMCC',
        is_active: true,
      },
    });
    cleanupSourceIds.push(zmcc1.id);

    const zmcc2 = await prisma.procurementSource.create({
      data: {
        code: `Z2_${ts}`.slice(0, 10),
        name: `ZMCC Beta ${ts}`,
        source_type: 'ZMCC',
        is_active: true,
      },
    });
    cleanupSourceIds.push(zmcc2.id);

    const inactiveZmcc = await prisma.procurementSource.create({
      data: {
        code: `ZI_${ts}`.slice(0, 10),
        name: `ZMCC Inactive ${ts}`,
        source_type: 'ZMCC',
        is_active: false,
      },
    });
    cleanupSourceIds.push(inactiveZmcc.id);

    const contractorSource = await prisma.procurementSource.create({
      data: {
        code: `CT_${ts}`.slice(0, 10),
        name: `Contractor Source ${ts}`,
        source_type: 'CONTRACTOR',
        is_active: true,
      },
    });
    cleanupSourceIds.push(contractorSource.id);

    const plantSource = await prisma.procurementSource.create({
      data: {
        code: `PL_${ts}`.slice(0, 10),
        name: `Plant Source ${ts}`,
        source_type: 'PLANT',
        is_active: true,
      },
    });
    cleanupSourceIds.push(plantSource.id);

    // Setup Actors
    const superAdminUser = await prisma.user.create({
      data: {
        username: `sa_${ts}`,
        full_name: 'Super Admin Actor',
        role: 'SUPER_ADMIN',
        department: 'System Administration',
        scope_type: 'SYSTEM',
        is_active: true,
      },
    });
    cleanupUserIds.push(superAdminUser.id);

    const zmcc1ManagerUser = await prisma.user.create({
      data: {
        username: `zm1_${ts}`,
        full_name: 'ZMCC 1 Manager Actor',
        role: 'ZMCC_MANAGER',
        department: 'Milk Procurement',
        scope_type: 'SOURCE',
        procurement_source_id: zmcc1.id,
        is_active: true,
      },
    });
    cleanupUserIds.push(zmcc1ManagerUser.id);

    const zmcc2ManagerUser = await prisma.user.create({
      data: {
        username: `zm2_${ts}`,
        full_name: 'ZMCC 2 Manager Actor',
        role: 'ZMCC_MANAGER',
        department: 'Milk Procurement',
        scope_type: 'SOURCE',
        procurement_source_id: zmcc2.id,
        is_active: true,
      },
    });
    cleanupUserIds.push(zmcc2ManagerUser.id);

    const pheUser1 = await prisma.user.create({
      data: {
        username: `phe1_${ts}`,
        full_name: 'PHE Operator 1 Actor',
        role: 'PHE_OPERATOR',
        department: 'Milk Procurement',
        scope_type: 'SOURCE',
        procurement_source_id: zmcc1.id,
        is_active: true,
      },
    });
    cleanupUserIds.push(pheUser1.id);

    const motUser = await prisma.user.create({
      data: {
        username: `mot_${ts}`,
        full_name: 'MOT Operator Actor',
        role: 'MOT',
        department: 'Milk Procurement',
        scope_type: 'SOURCE',
        procurement_source_id: zmcc1.id,
        is_active: true,
      },
    });
    cleanupUserIds.push(motUser.id);

    const inactiveUser = await prisma.user.create({
      data: {
        username: `inact_${ts}`,
        full_name: 'Inactive User Actor',
        role: 'ZMCC_MANAGER',
        department: 'Milk Procurement',
        scope_type: 'SOURCE',
        procurement_source_id: zmcc1.id,
        is_active: false,
      },
    });
    cleanupUserIds.push(inactiveUser.id);

    const legacyUser = await prisma.user.create({
      data: {
        username: `leg_${ts}`,
        full_name: 'Legacy Role Actor',
        role: 'MPD_Zone_Manager',
        department: 'Milk Procurement',
        scope_type: 'ZONE',
        is_active: true,
      },
    });
    cleanupUserIds.push(legacyUser.id);

    const contractorUser = await prisma.user.create({
      data: {
        username: `cman_${ts}`,
        full_name: 'Contractor Manager Actor',
        role: 'CONTRACTOR_MANAGER',
        department: 'Milk Procurement',
        scope_type: 'SOURCE',
        procurement_source_id: contractorSource.id,
        is_active: true,
      },
    });
    cleanupUserIds.push(contractorUser.id);

    const adminAliasUser = await prisma.user.create({
      data: {
        username: `adm_al_${ts}`,
        full_name: 'Admin Alias Actor',
        role: 'Admin',
        department: 'System Administration',
        scope_type: 'SYSTEM',
        is_active: true,
      },
    });
    cleanupUserIds.push(adminAliasUser.id);

    const lowerSuperAdminUser = await prisma.user.create({
      data: {
        username: `low_sa_${ts}`,
        full_name: 'Lower Super Admin Actor',
        role: 'super_admin',
        department: 'System Administration',
        scope_type: 'SYSTEM',
        is_active: true,
      },
    });
    cleanupUserIds.push(lowerSuperAdminUser.id);

    const nullSourceUser = await prisma.user.create({
      data: {
        username: `null_src_${ts}`,
        full_name: 'Null Source Manager Actor',
        role: 'ZMCC_MANAGER',
        department: 'Milk Procurement',
        scope_type: 'SOURCE',
        procurement_source_id: null,
        is_active: true,
      },
    });
    cleanupUserIds.push(nullSourceUser.id);

    const contractorScopedUser = await prisma.user.create({
      data: {
        username: `cnt_src_${ts}`,
        full_name: 'Contractor Scoped Manager Actor',
        role: 'ZMCC_MANAGER',
        department: 'Milk Procurement',
        scope_type: 'SOURCE',
        procurement_source_id: contractorSource.id,
        is_active: true,
      },
    });
    cleanupUserIds.push(contractorScopedUser.id);

    const plantScopedUser = await prisma.user.create({
      data: {
        username: `plt_src_${ts}`,
        full_name: 'Plant Scoped PHE Actor',
        role: 'PHE_OPERATOR',
        department: 'Milk Procurement',
        scope_type: 'SOURCE',
        procurement_source_id: plantSource.id,
        is_active: true,
      },
    });
    cleanupUserIds.push(plantScopedUser.id);

    // Helper for requests with auth
    const createAuthRequest = async (urlStr: string, method: string = 'GET', bodyObj?: any, u?: any) => {
      const headers: Record<string, string> = {};
      if (u) {
        const token = await createSessionToken({
          id: u.id.toString(),
          username: u.username,
          name: u.full_name || u.username,
          role: u.role,
          department: u.department || '',
          procurement_source_id: u.procurement_source_id ? u.procurement_source_id.toString() : null,
        });
        headers['cookie'] = `auth_token=${token}`;
        headers['authorization'] = `Bearer ${token}`;
      }

      if (bodyObj) {
        headers['content-type'] = 'application/json';
      }

      return new Request(urlStr, {
        method,
        headers,
        body: bodyObj ? JSON.stringify(bodyObj) : undefined,
      });
    };

    console.log('--- SECTION 1: SUPER ADMIN GLOBAL ACCESS ---');

    // 1.1 Super Admin creates global Chiller Ownership
    const coReq = await createAuthRequest('http://localhost/api/zmcc/chiller-ownerships', 'POST', {
      ownership_code: `CO_${ts}`.slice(0, 10),
      name: `Brand Special ${ts}`,
    }, superAdminUser);
    const coRes = await postChillerOwnerships(coReq);
    const coData = await coRes.json();
    assert(coRes.status === 201 && coData.chiller_ownership?.id != null, 'SA-CHILLER-CREATE-201', 'Super Admin created global Chiller Ownership successfully');
    const createdCoId = BigInt(coData.chiller_ownership.id);
    cleanupChillerIds.push(createdCoId);

    // 1.2 Super Admin creates Route in ZMCC 1
    const r1Req = await createAuthRequest('http://localhost/api/zmcc/routes', 'POST', {
      route_code: `RT1_${ts}`.slice(0, 10),
      name: `Route Alpha 1 ${ts}`,
      origin: 'Origin Alpha',
      destination: 'Destination Alpha',
      zmcc_id: zmcc1.id.toString(),
    }, superAdminUser);
    const r1Res = await postRoutes(r1Req);
    const r1Data = await r1Res.json();
    assert(r1Res.status === 201 && r1Data.route?.id != null, 'SA-ROUTE-CREATE-ZMCC1', 'Super Admin created Route in ZMCC 1');
    const route1Id = BigInt(r1Data.route.id);
    cleanupRouteIds.push(route1Id);

    // 1.3 Super Admin creates Route in ZMCC 2
    const r2Req = await createAuthRequest('http://localhost/api/zmcc/routes', 'POST', {
      route_code: `RT2_${ts}`.slice(0, 10),
      name: `Route Beta 1 ${ts}`,
      origin: 'Origin Beta',
      destination: 'Destination Beta',
      zmcc_id: zmcc2.id.toString(),
    }, superAdminUser);
    const r2Res = await postRoutes(r2Req);
    const r2Data = await r2Res.json();
    assert(r2Res.status === 201 && r2Data.route?.id != null, 'SA-ROUTE-CREATE-ZMCC2', 'Super Admin created Route in ZMCC 2');
    const route2Id = BigInt(r2Data.route.id);
    cleanupRouteIds.push(route2Id);

    // 1.4 Super Admin creates Area in ZMCC 1 under Route 1
    const a1Req = await createAuthRequest('http://localhost/api/zmcc/areas', 'POST', {
      area_code: `AR1_${ts}`.slice(0, 10),
      name: `Area Alpha 1 ${ts}`,
      route_id: route1Id.toString(),
    }, superAdminUser);
    const a1Res = await postAreas(a1Req);
    const a1Data = await a1Res.json();
    assert(a1Res.status === 201 && a1Data.area?.id != null, 'SA-AREA-CREATE-ZMCC1', 'Super Admin created Area in ZMCC 1 under Route 1');
    const area1Id = BigInt(a1Data.area.id);
    cleanupAreaIds.push(area1Id);

    // 1.5 Super Admin creates Milk Source in ZMCC 1
    const ms1Req = await createAuthRequest('http://localhost/api/zmcc/milk-sources', 'POST', {
      erp_code: `MS1_${ts}`.slice(0, 10),
      name: `Milk Source Alpha ${ts}`,
      zmcc_id: zmcc1.id.toString(),
    }, superAdminUser);
    const ms1Res = await postMilkSources(ms1Req);
    const ms1Data = await ms1Res.json();
    assert(ms1Res.status === 201 && ms1Data.milk_source?.id != null, 'SA-MS-CREATE-ZMCC1', 'Super Admin created Milk Source in ZMCC 1');
    const milkSource1Id = BigInt(ms1Data.milk_source.id);
    cleanupMilkSourceIds.push(milkSource1Id);

    // 1.6 Super Admin creates Shop in ZMCC 1
    const s1Req = await createAuthRequest('http://localhost/api/zmcc/shops', 'POST', {
      shop_code: `SH1_${ts}`.slice(0, 10),
      shop_name: `Shop Alpha 1 ${ts}`,
      owner_name: 'Muhammad Aslam',
      phone_number: '03001234567',
      cnic: '35201-1234567-1',
      area_id: area1Id.toString(),
      milk_source_id: milkSource1Id.toString(),
      chiller_ownership_id: createdCoId.toString(),
      latitude: 31.25,
      longitude: 72.35,
    }, superAdminUser);
    const s1Res = await postShops(s1Req);
    const s1Data = await s1Res.json();
    assert(s1Res.status === 201 && s1Data.shop?.id != null, 'SA-SHOP-CREATE-ZMCC1', 'Super Admin created Shop in ZMCC 1 with valid attributes');
    const shop1Id = BigInt(s1Data.shop.id);
    cleanupShopIds.push(shop1Id);

    // Setup auxiliary fixtures for comprehensive security verification
    // Create Area 2 in ZMCC 2 under Route 2
    const a2Req = await createAuthRequest('http://localhost/api/zmcc/areas', 'POST', {
      area_code: `AR2_${ts}`.slice(0, 10),
      name: `Area Beta 1 ${ts}`,
      route_id: route2Id.toString(),
    }, superAdminUser);
    const a2Res = await postAreas(a2Req);
    const a2Data = await a2Res.json();
    const area2Id = BigInt(a2Data.area.id);
    cleanupAreaIds.push(area2Id);

    // Inactive Chiller Ownership
    const inactCo = await prisma.chillerOwnership.create({
      data: {
        ownership_code: `ICO_${ts}`.slice(0, 10),
        name: `Inactive Chiller ${ts}`,
        is_active: false,
        created_by: superAdminUser.id,
      },
    });
    cleanupChillerIds.push(inactCo.id);

    // Inactive Route in ZMCC 1
    const inactRoute = await prisma.zmccRoute.create({
      data: {
        route_code: `INR_${ts}`.slice(0, 10),
        name: `Inactive Route ${ts}`,
        origin: 'A',
        destination: 'B',
        zmcc_id: zmcc1.id,
        is_active: false,
        created_by: superAdminUser.id,
      },
    });
    cleanupRouteIds.push(inactRoute.id);

    // Inactive Area in ZMCC 1
    const inactArea = await prisma.zmccArea.create({
      data: {
        area_code: `INA_${ts}`.slice(0, 10),
        name: `Inactive Area ${ts}`,
        route_id: route1Id,
        zmcc_id: zmcc1.id,
        is_active: false,
        created_by: superAdminUser.id,
      },
    });
    cleanupAreaIds.push(inactArea.id);

    // Inactive Milk Source in ZMCC 1
    const inactMs = await prisma.zmccMilkSource.create({
      data: {
        erp_code: `INM_${ts}`.slice(0, 10),
        name: `Inactive Source ${ts}`,
        zmcc_id: zmcc1.id,
        is_active: false,
        created_by: superAdminUser.id,
      },
    });
    cleanupMilkSourceIds.push(inactMs.id);

    // Shop referencing inactive chiller ownership to verify shop-detail embedding
    const inactCoShop = await prisma.zmccShop.create({
      data: {
        shop_code: `SIC_${ts}`.slice(0, 10),
        shop_name: `Shop Inactive Chiller ${ts}`,
        owner_name: 'Inact Owner',
        phone_number: '03001234567',
        cnic: '3520112345679',
        area_id: area1Id,
        route_id: route1Id,
        zmcc_id: zmcc1.id,
        milk_source_id: milkSource1Id,
        chiller_ownership_id: inactCo.id,
        is_active: true,
        created_by: superAdminUser.id,
      },
    });
    cleanupShopIds.push(inactCoShop.id);

    // 1.7 Super Admin CANNOT create Route under non-ZMCC source (source_type = 'CONTRACTOR') -> HTTP 400
    const nonZmccReq = await createAuthRequest('http://localhost/api/zmcc/routes', 'POST', {
      route_code: `NZ_${ts}`.slice(0, 10),
      name: `Non ZMCC Route ${ts}`,
      origin: 'A',
      destination: 'B',
      zmcc_id: contractorSource.id.toString(),
    }, superAdminUser);
    const nonZmccRes = await postRoutes(nonZmccReq);
    assert(nonZmccRes.status === 400, 'SA-NON-ZMCC-SOURCE-REJECTED', 'Super Admin rejected from creating route under non-ZMCC source (HTTP 400)');

    // 1.8 Super Admin CANNOT create Route under inactive ZMCC -> HTTP 409
    const inactZmccReq = await createAuthRequest('http://localhost/api/zmcc/routes', 'POST', {
      route_code: `IZ_${ts}`.slice(0, 10),
      name: `Inactive ZMCC Route ${ts}`,
      origin: 'A',
      destination: 'B',
      zmcc_id: inactiveZmcc.id.toString(),
    }, superAdminUser);
    const inactZmccRes = await postRoutes(inactZmccReq);
    assert(inactZmccRes.status === 409, 'SA-INACTIVE-ZMCC-REJECTED', 'Super Admin rejected from creating route under inactive ZMCC (HTTP 409)');

    // 1.9 Route ZMCC ownership is IMMUTABLE across PATCH requests
    const patchRouteTransferReq = await createAuthRequest(`http://localhost/api/zmcc/routes/${route1Id}`, 'PATCH', {
      name: `Route Alpha 1 Renamed ${ts}`,
      zmcc_id: zmcc2.id.toString(), // attempted transfer
    }, superAdminUser);
    const patchRouteTransferRes = await patchRoute(patchRouteTransferReq, { params: Promise.resolve({ id: route1Id.toString() }) });
    const dbRoute1After = await prisma.zmccRoute.findUnique({ where: { id: route1Id } });
    assert(
      patchRouteTransferRes.status === 200 && dbRoute1After?.zmcc_id.toString() === zmcc1.id.toString(),
      'SA-TRANSFER-ZMCC-ROUTE-IMMUTABLE',
      'Route ZMCC ownership cannot be changed via PATCH; zmcc_id remains unchanged in database'
    );

    // 1.10 Shop cross-ZMCC transfer via Area change is strictly rejected -> HTTP 409
    const patchShopTransferReq = await createAuthRequest(`http://localhost/api/zmcc/shops/${shop1Id}`, 'PATCH', {
      area_id: area2Id.toString(), // area2 belongs to ZMCC 2
    }, superAdminUser);
    const patchShopTransferRes = await patchShop(patchShopTransferReq, { params: Promise.resolve({ id: shop1Id.toString() }) });
    assert(
      patchShopTransferRes.status === 409,
      'SA-TRANSFER-ZMCC-SHOP-REJECTED',
      'Attempting to transfer shop to an area in another ZMCC strictly rejected with HTTP 409 Conflict'
    );

    // 1.11 Shop move to inactive area strictly rejected -> HTTP 409
    const patchShopInactAreaReq = await createAuthRequest(`http://localhost/api/zmcc/shops/${shop1Id}`, 'PATCH', {
      area_id: inactArea.id.toString(),
    }, superAdminUser);
    const patchShopInactAreaRes = await patchShop(patchShopInactAreaReq, { params: Promise.resolve({ id: shop1Id.toString() }) });
    assert(
      patchShopInactAreaRes.status === 409,
      'SHOP-MOVE-INACTIVE-AREA-REJECTED-409',
      'Moving shop to an inactive area rejected with HTTP 409 Conflict'
    );

    // 1.12 Shop move to area under inactive route strictly rejected -> HTTP 409
    const areaUnderInactRoute = await prisma.zmccArea.create({
      data: {
        area_code: `ARI_${ts}`.slice(0, 10),
        name: `Area Under Inact Route ${ts}`,
        route_id: inactRoute.id,
        zmcc_id: zmcc1.id,
        is_active: true,
        created_by: superAdminUser.id,
      },
    });
    cleanupAreaIds.push(areaUnderInactRoute.id);

    const patchShopInactRouteReq = await createAuthRequest(`http://localhost/api/zmcc/shops/${shop1Id}`, 'PATCH', {
      area_id: areaUnderInactRoute.id.toString(),
    }, superAdminUser);
    const patchShopInactRouteRes = await patchShop(patchShopInactRouteReq, { params: Promise.resolve({ id: shop1Id.toString() }) });
    assert(
      patchShopInactRouteRes.status === 409,
      'SHOP-MOVE-INACTIVE-ROUTE-REJECTED-409',
      'Moving shop to an area under an inactive route rejected with HTTP 409 Conflict'
    );

    // 1.13 Shop move to nonexistent area strictly rejected -> HTTP 400
    const patchShopGhostAreaReq = await createAuthRequest(`http://localhost/api/zmcc/shops/${shop1Id}`, 'PATCH', {
      area_id: '9999999999',
    }, superAdminUser);
    const patchShopGhostAreaRes = await patchShop(patchShopGhostAreaReq, { params: Promise.resolve({ id: shop1Id.toString() }) });
    assert(
      patchShopGhostAreaRes.status === 400,
      'SHOP-MOVE-NONEXISTENT-AREA-REJECTED-400',
      'Moving shop to nonexistent area rejected with HTTP 400'
    );

    // 1.14 Shop move under inactive ZMCC strictly rejected -> HTTP 409
    const routeUnderInactZmcc = await prisma.zmccRoute.create({
      data: {
        route_code: `RIZ_${ts}`.slice(0, 10),
        name: `Route Inact ZMCC ${ts}`,
        origin: 'A',
        destination: 'B',
        zmcc_id: inactiveZmcc.id,
        is_active: true,
        created_by: superAdminUser.id,
      },
    });
    cleanupRouteIds.push(routeUnderInactZmcc.id);

    const area1UnderInactZmcc = await prisma.zmccArea.create({
      data: {
        area_code: `A1IZ_${ts}`.slice(0, 10),
        name: `Area 1 Inact ZMCC ${ts}`,
        route_id: routeUnderInactZmcc.id,
        zmcc_id: inactiveZmcc.id,
        is_active: true,
        created_by: superAdminUser.id,
      },
    });
    cleanupAreaIds.push(area1UnderInactZmcc.id);

    const area2UnderInactZmcc = await prisma.zmccArea.create({
      data: {
        area_code: `A2IZ_${ts}`.slice(0, 10),
        name: `Area 2 Inact ZMCC ${ts}`,
        route_id: routeUnderInactZmcc.id,
        zmcc_id: inactiveZmcc.id,
        is_active: true,
        created_by: superAdminUser.id,
      },
    });
    cleanupAreaIds.push(area2UnderInactZmcc.id);

    const msUnderInactZmcc = await prisma.zmccMilkSource.create({
      data: {
        erp_code: `MIZ_${ts}`.slice(0, 10),
        name: `MS Inact ZMCC ${ts}`,
        zmcc_id: inactiveZmcc.id,
        is_active: true,
        created_by: superAdminUser.id,
      },
    });
    cleanupMilkSourceIds.push(msUnderInactZmcc.id);

    const shopUnderInactZmcc = await prisma.zmccShop.create({
      data: {
        shop_code: `SIZM_${ts}`.slice(0, 10),
        shop_name: `Shop Inact ZMCC ${ts}`,
        owner_name: 'Owner',
        phone_number: '03001234567',
        cnic: '3520112345671',
        area_id: area1UnderInactZmcc.id,
        route_id: routeUnderInactZmcc.id,
        zmcc_id: inactiveZmcc.id,
        milk_source_id: msUnderInactZmcc.id,
        chiller_ownership_id: createdCoId,
        is_active: true,
        created_by: superAdminUser.id,
      },
    });
    cleanupShopIds.push(shopUnderInactZmcc.id);

    const patchShopInactZmccReq = await createAuthRequest(`http://localhost/api/zmcc/shops/${shopUnderInactZmcc.id}`, 'PATCH', {
      area_id: area2UnderInactZmcc.id.toString(),
    }, superAdminUser);
    const patchShopInactZmccRes = await patchShop(patchShopInactZmccReq, { params: Promise.resolve({ id: shopUnderInactZmcc.id.toString() }) });
    assert(
      patchShopInactZmccRes.status === 409,
      'SHOP-MOVE-INACTIVE-ZMCC-REJECTED-409',
      'Moving shop to an area under an inactive ZMCC rejected with HTTP 409 Conflict'
    );

    // 1.15 Shop move under non-ZMCC source strictly rejected -> HTTP 400
    const routeContractor = await prisma.zmccRoute.create({
      data: {
        route_code: `RC_${ts}`.slice(0, 10),
        name: `Route Contractor ${ts}`,
        origin: 'A',
        destination: 'B',
        zmcc_id: contractorSource.id,
        is_active: true,
        created_by: superAdminUser.id,
      },
    });
    cleanupRouteIds.push(routeContractor.id);

    const area1Contractor = await prisma.zmccArea.create({
      data: {
        area_code: `A1C_${ts}`.slice(0, 10),
        name: `Area 1 Contractor ${ts}`,
        route_id: routeContractor.id,
        zmcc_id: contractorSource.id,
        is_active: true,
        created_by: superAdminUser.id,
      },
    });
    cleanupAreaIds.push(area1Contractor.id);

    const area2Contractor = await prisma.zmccArea.create({
      data: {
        area_code: `A2C_${ts}`.slice(0, 10),
        name: `Area 2 Contractor ${ts}`,
        route_id: routeContractor.id,
        zmcc_id: contractorSource.id,
        is_active: true,
        created_by: superAdminUser.id,
      },
    });
    cleanupAreaIds.push(area2Contractor.id);

    const msContractor = await prisma.zmccMilkSource.create({
      data: {
        erp_code: `MSC_${ts}`.slice(0, 10),
        name: `MS Contractor ${ts}`,
        zmcc_id: contractorSource.id,
        is_active: true,
        created_by: superAdminUser.id,
      },
    });
    cleanupMilkSourceIds.push(msContractor.id);

    const shopContractor = await prisma.zmccShop.create({
      data: {
        shop_code: `SC_${ts}`.slice(0, 10),
        shop_name: `Shop Contractor ${ts}`,
        owner_name: 'Owner',
        phone_number: '03001234567',
        cnic: '3520112345671',
        area_id: area1Contractor.id,
        route_id: routeContractor.id,
        zmcc_id: contractorSource.id,
        milk_source_id: msContractor.id,
        chiller_ownership_id: createdCoId,
        is_active: true,
        created_by: superAdminUser.id,
      },
    });
    cleanupShopIds.push(shopContractor.id);

    const patchShopNonZmccReq = await createAuthRequest(`http://localhost/api/zmcc/shops/${shopContractor.id}`, 'PATCH', {
      area_id: area2Contractor.id.toString(),
    }, superAdminUser);
    const patchShopNonZmccRes = await patchShop(patchShopNonZmccReq, { params: Promise.resolve({ id: shopContractor.id.toString() }) });
    assert(
      patchShopNonZmccRes.status === 400,
      'SHOP-MOVE-NON-ZMCC-SOURCE-REJECTED-400',
      'Moving shop to an area under a non-ZMCC source rejected with HTTP 400'
    );

    console.log('\n--- SECTION 2: ZMCC MANAGER SCOPED ACCESS & CROSS-ZMCC ISOLATION ---');

    // 2.1 ZMCC 1 Manager creates Area under own Route 1
    const zm1AreaReq = await createAuthRequest('http://localhost/api/zmcc/areas', 'POST', {
      area_code: `AR1M_${ts}`.slice(0, 10),
      name: `Area Alpha 2 by Manager ${ts}`,
      route_id: route1Id.toString(),
    }, zmcc1ManagerUser);
    const zm1AreaRes = await postAreas(zm1AreaReq);
    const zm1AreaData = await zm1AreaRes.json();
    assert(zm1AreaRes.status === 201 && zm1AreaData.area?.id != null, 'ZMCC-MGR-CREATE-OWN-AREA', 'ZMCC 1 Manager created area in own ZMCC route');
    const area1ManagerId = BigInt(zm1AreaData.area.id);
    cleanupAreaIds.push(area1ManagerId);

    // 2.2 ZMCC 1 Manager attempts to create area under Route 2 (belonging to ZMCC 2) -> strictly rejected
    const crossAreaReq = await createAuthRequest('http://localhost/api/zmcc/areas', 'POST', {
      area_code: `ARX_${ts}`.slice(0, 10),
      name: `Cross Area Invalid ${ts}`,
      route_id: route2Id.toString(),
    }, zmcc1ManagerUser);
    const crossAreaRes = await postAreas(crossAreaReq);
    assert(crossAreaRes.status === 403, 'ZMCC-MGR-CROSS-ROUTE-REJECTION-403', 'ZMCC 1 Manager rejected from creating area under ZMCC 2 route (HTTP 403)');

    // 2.3 ZMCC 1 Manager attempts to view/get Route 2 -> strictly not found / denied
    const getRoute2Req = await createAuthRequest(`http://localhost/api/zmcc/routes/${route2Id}`, 'GET', undefined, zmcc1ManagerUser);
    const getRoute2Res = await getRouteById(getRoute2Req, { params: Promise.resolve({ id: route2Id.toString() }) });
    assert(getRoute2Res.status === 404, 'ZMCC-MGR-CROSS-ROUTE-READ-404', 'ZMCC 1 Manager cannot read Route 2 of another ZMCC (HTTP 404)');

    // 2.4 ZMCC 1 Manager attempts to create Chiller Ownership -> strictly forbidden
    const zmCoReq = await createAuthRequest('http://localhost/api/zmcc/chiller-ownerships', 'POST', {
      ownership_code: `COX_${ts}`.slice(0, 10),
      name: `Manager Ownership ${ts}`,
    }, zmcc1ManagerUser);
    const zmCoRes = await postChillerOwnerships(zmCoReq);
    assert(zmCoRes.status === 403, 'ZMCC-MGR-CHILLER-WRITE-FORBIDDEN-403', 'ZMCC 1 Manager rejected from creating global Chiller Ownership (HTTP 403)');

    // 2.5 ZMCC 1 Manager attempts to submit a foreign zmcc_id in route creation -> derived from session, does not escape
    const zmTamperReq = await createAuthRequest('http://localhost/api/zmcc/routes', 'POST', {
      route_code: `RTT_${ts}`.slice(0, 10),
      name: `Tamper Route ${ts}`,
      origin: 'Origin',
      destination: 'Destination',
      zmcc_id: zmcc2.id.toString(), // client tries to submit foreign zmcc_id
    }, zmcc1ManagerUser);
    const zmTamperRes = await postRoutes(zmTamperReq);
    const zmTamperData = await zmTamperRes.json();
    assert(
      zmTamperRes.status === 201 && zmTamperData.route?.zmcc_id === zmcc1.id.toString(),
      'ZMCC-MGR-CLIENT-ZMCC-OVERRIDDEN',
      'Client-submitted foreign ZMCC ID safely ignored; route created strictly under authenticated ZMCC 1'
    );
    cleanupRouteIds.push(BigInt(zmTamperData.route.id));

    // 2.6 ZMCC Manager reads active Chiller Ownership options only (inactive filtered out)
    const zmChillerReq = await createAuthRequest('http://localhost/api/zmcc/chiller-ownerships?is_active=false', 'GET', undefined, zmcc1ManagerUser);
    const zmChillerRes = await getChillerOwnerships(zmChillerReq);
    const zmChillerData = await zmChillerRes.json();
    const zmHasInactive = zmChillerData.chiller_ownerships?.some((c: any) => c.id === inactCo.id.toString());
    assert(
      zmChillerRes.status === 200 && !zmHasInactive,
      'ZMCC-MGR-CHILLER-ACTIVE-ONLY',
      'ZMCC Manager query for chiller ownerships returns active options only (inactive strictly excluded)'
    );

    // 2.7 ZMCC Manager cannot read inactive Chiller Ownership by ID -> HTTP 404
    const zmGetInactCoReq = await createAuthRequest(`http://localhost/api/zmcc/chiller-ownerships/${inactCo.id}`, 'GET', undefined, zmcc1ManagerUser);
    const zmGetInactCoRes = await getChillerOwnershipById(zmGetInactCoReq, { params: Promise.resolve({ id: inactCo.id.toString() }) });
    assert(zmGetInactCoRes.status === 404, 'ZMCC-MGR-INACTIVE-CHILLER-404', 'ZMCC Manager cannot read inactive Chiller Ownership by ID (HTTP 404)');

    // 2.8 ZMCC Manager cannot mutate/patch Chiller Ownership -> HTTP 403
    const zmPatchCoReq = await createAuthRequest(`http://localhost/api/zmcc/chiller-ownerships/${createdCoId}`, 'PATCH', {
      name: 'Manager Hack Chiller',
    }, zmcc1ManagerUser);
    const zmPatchCoRes = await patchChillerOwnership(zmPatchCoReq, { params: Promise.resolve({ id: createdCoId.toString() }) });
    assert(zmPatchCoRes.status === 403, 'ZMCC-MGR-CHILLER-PATCH-403', 'ZMCC Manager rejected from mutating Chiller Ownership (HTTP 403)');

    console.log('\n--- SECTION 3: PHE OPERATOR SHOP MANAGEMENT & WRITE RESTRICTIONS ---');

    // 3.1 PHE Operator can create Shop in assigned ZMCC 1
    const pheShopReq = await createAuthRequest('http://localhost/api/zmcc/shops', 'POST', {
      shop_code: `PHE_S_${ts}`.slice(0, 10),
      shop_name: `PHE Shop 1 ${ts}`,
      owner_name: 'Tariq Mehmood',
      phone_number: '03123456789',
      cnic: '3520112345672',
      area_id: area1Id.toString(),
      milk_source_id: milkSource1Id.toString(),
      chiller_ownership_id: createdCoId.toString(),
    }, pheUser1);
    const pheShopRes = await postShops(pheShopReq);
    const pheShopData = await pheShopRes.json();
    assert(pheShopRes.status === 201 && pheShopData.shop?.id != null, 'PHE-SHOP-CREATE-201', 'PHE Operator created shop in assigned ZMCC 1');
    const pheShopId = BigInt(pheShopData.shop.id);
    cleanupShopIds.push(pheShopId);

    // 3.2 PHE Operator can update Shop in assigned ZMCC 1
    const pheShopPatchReq = await createAuthRequest(`http://localhost/api/zmcc/shops/${pheShopId}`, 'PATCH', {
      shop_name: `PHE Shop 1 Updated ${ts}`,
    }, pheUser1);
    const pheShopPatchRes = await patchShop(pheShopPatchReq, { params: Promise.resolve({ id: pheShopId.toString() }) });
    assert(pheShopPatchRes.status === 200, 'PHE-SHOP-PATCH-200', 'PHE Operator updated shop in assigned ZMCC 1');

    // 3.3 PHE Operator CANNOT create Route -> HTTP 403
    const pheRouteReq = await createAuthRequest('http://localhost/api/zmcc/routes', 'POST', {
      route_code: `PHE_R_${ts}`.slice(0, 10),
      name: 'Forbidden Route',
      origin: 'A',
      destination: 'B',
    }, pheUser1);
    const pheRouteRes = await postRoutes(pheRouteReq);
    assert(pheRouteRes.status === 403, 'PHE-ROUTE-WRITE-403', 'PHE Operator rejected from creating Route (HTTP 403)');

    // 3.4 PHE Operator CANNOT create Area -> HTTP 403
    const pheAreaReq = await createAuthRequest('http://localhost/api/zmcc/areas', 'POST', {
      area_code: `PHE_A_${ts}`.slice(0, 10),
      name: 'Forbidden Area',
      route_id: route1Id.toString(),
    }, pheUser1);
    const pheAreaRes = await postAreas(pheAreaReq);
    assert(pheAreaRes.status === 403, 'PHE-AREA-WRITE-403', 'PHE Operator rejected from creating Area (HTTP 403)');

    // 3.5 PHE Operator CANNOT create Milk Source -> HTTP 403
    const pheMsReq = await createAuthRequest('http://localhost/api/zmcc/milk-sources', 'POST', {
      erp_code: `PHE_M_${ts}`.slice(0, 10),
      name: 'Forbidden Source',
    }, pheUser1);
    const pheMsRes = await postMilkSources(pheMsReq);
    assert(pheMsRes.status === 403, 'PHE-MS-WRITE-403', 'PHE Operator rejected from creating Milk Source (HTTP 403)');

    // 3.6 PHE Operator CANNOT create Chiller Ownership -> HTTP 403
    const pheCoReq = await createAuthRequest('http://localhost/api/zmcc/chiller-ownerships', 'POST', {
      ownership_code: `PHE_C_${ts}`.slice(0, 10),
      name: 'Forbidden Chiller',
    }, pheUser1);
    const pheCoRes = await postChillerOwnerships(pheCoReq);
    assert(pheCoRes.status === 403, 'PHE-CHILLER-WRITE-403', 'PHE Operator rejected from creating Chiller Ownership (HTTP 403)');

    // 3.7 PHE Operator read-scope: Routes collection returns active records only for assigned ZMCC
    const pheRoutesReq = await createAuthRequest('http://localhost/api/zmcc/routes?is_active=false&zmcc_id=' + zmcc2.id.toString(), 'GET', undefined, pheUser1);
    const pheRoutesRes = await getRoutes(pheRoutesReq);
    const pheRoutesData = await pheRoutesRes.json();
    const pheHasInactiveRoute = pheRoutesData.routes?.some((r: any) => r.id === inactRoute.id.toString());
    const pheHasCrossRoute = pheRoutesData.routes?.some((r: any) => r.zmcc_id !== zmcc1.id.toString());
    assert(
      pheRoutesRes.status === 200 && !pheHasInactiveRoute && !pheHasCrossRoute,
      'PHE-READ-ACTIVE-ROUTES-ONLY',
      'PHE routes collection returns active records only for assigned ZMCC (inactive and cross-ZMCC excluded)'
    );

    // 3.8 PHE Operator cannot read Route of another ZMCC by ID -> HTTP 404
    const pheGetCrossRouteReq = await createAuthRequest(`http://localhost/api/zmcc/routes/${route2Id}`, 'GET', undefined, pheUser1);
    const pheGetCrossRouteRes = await getRouteById(pheGetCrossRouteReq, { params: Promise.resolve({ id: route2Id.toString() }) });
    assert(pheGetCrossRouteRes.status === 404, 'PHE-READ-CROSS-ZMCC-ROUTE-404', 'PHE Operator cannot read Route from another ZMCC (HTTP 404)');

    // 3.9 PHE Operator cannot read inactive Route by ID -> HTTP 404
    const pheGetInactRouteReq = await createAuthRequest(`http://localhost/api/zmcc/routes/${inactRoute.id}`, 'GET', undefined, pheUser1);
    const pheGetInactRouteRes = await getRouteById(pheGetInactRouteReq, { params: Promise.resolve({ id: inactRoute.id.toString() }) });
    assert(pheGetInactRouteRes.status === 404, 'PHE-READ-INACTIVE-ROUTE-404', 'PHE Operator cannot read inactive Route by ID (HTTP 404)');

    // 3.10 PHE Operator read-scope: Areas collection returns active records only for assigned ZMCC
    const pheAreasReq = await createAuthRequest('http://localhost/api/zmcc/areas?is_active=false', 'GET', undefined, pheUser1);
    const pheAreasRes = await getAreas(pheAreasReq);
    const pheAreasData = await pheAreasRes.json();
    const pheHasInactiveArea = pheAreasData.areas?.some((a: any) => a.id === inactArea.id.toString());
    assert(
      pheAreasRes.status === 200 && !pheHasInactiveArea,
      'PHE-READ-ACTIVE-AREAS-ONLY',
      'PHE areas collection returns active records only for assigned ZMCC'
    );

    // 3.11 PHE Operator cannot read inactive Area by ID -> HTTP 404
    const pheGetInactAreaReq = await createAuthRequest(`http://localhost/api/zmcc/areas/${inactArea.id}`, 'GET', undefined, pheUser1);
    const pheGetInactAreaRes = await getAreaById(pheGetInactAreaReq, { params: Promise.resolve({ id: inactArea.id.toString() }) });
    assert(pheGetInactAreaRes.status === 404, 'PHE-READ-INACTIVE-AREA-404', 'PHE Operator cannot read inactive Area by ID (HTTP 404)');

    // 3.12 PHE Operator read-scope: Milk Sources collection returns active records only for assigned ZMCC
    const pheMsReadReq = await createAuthRequest('http://localhost/api/zmcc/milk-sources?is_active=false', 'GET', undefined, pheUser1);
    const pheMsReadRes = await getMilkSources(pheMsReadReq);
    const pheMsReadData = await pheMsReadRes.json();
    const pheHasInactiveMs = pheMsReadData.milk_sources?.some((m: any) => m.id === inactMs.id.toString());
    assert(
      pheMsReadRes.status === 200 && !pheHasInactiveMs,
      'PHE-READ-ACTIVE-MS-ONLY',
      'PHE milk sources collection returns active records only for assigned ZMCC'
    );

    // 3.13 PHE Operator cannot read inactive Milk Source by ID -> HTTP 404
    const pheGetInactMsReq = await createAuthRequest(`http://localhost/api/zmcc/milk-sources/${inactMs.id}`, 'GET', undefined, pheUser1);
    const pheGetInactMsRes = await getMilkSourceById(pheGetInactMsReq, { params: Promise.resolve({ id: inactMs.id.toString() }) });
    assert(pheGetInactMsRes.status === 404, 'PHE-READ-INACTIVE-MS-404', 'PHE Operator cannot read inactive Milk Source by ID (HTTP 404)');

    // 3.14 PHE Operator read-scope: Chiller Ownership collection returns active options only
    const pheCoReadReq = await createAuthRequest('http://localhost/api/zmcc/chiller-ownerships?is_active=false', 'GET', undefined, pheUser1);
    const pheCoReadRes = await getChillerOwnerships(pheCoReadReq);
    const pheCoReadData = await pheCoReadRes.json();
    const pheHasInactiveCo = pheCoReadData.chiller_ownerships?.some((c: any) => c.id === inactCo.id.toString());
    assert(
      pheCoReadRes.status === 200 && !pheHasInactiveCo,
      'PHE-READ-ACTIVE-CHILLER-ONLY',
      'PHE chiller ownerships collection returns active options only'
    );

    // 3.15 PHE Operator cannot read inactive Chiller Ownership by ID -> HTTP 404
    const pheGetInactCoReq = await createAuthRequest(`http://localhost/api/zmcc/chiller-ownerships/${inactCo.id}`, 'GET', undefined, pheUser1);
    const pheGetInactCoRes = await getChillerOwnershipById(pheGetInactCoReq, { params: Promise.resolve({ id: inactCo.id.toString() }) });
    assert(pheGetInactCoRes.status === 404, 'PHE-READ-INACTIVE-CHILLER-404', 'PHE Operator cannot read inactive Chiller Ownership by ID (HTTP 404)');

    // 3.16 PHE Operator CANNOT PATCH Route -> HTTP 403
    const phePatchRouteReq = await createAuthRequest(`http://localhost/api/zmcc/routes/${route1Id}`, 'PATCH', { name: 'PHE Hack' }, pheUser1);
    const phePatchRouteRes = await patchRoute(phePatchRouteReq, { params: Promise.resolve({ id: route1Id.toString() }) });
    assert(phePatchRouteRes.status === 403, 'PHE-ROUTE-PATCH-403', 'PHE Operator rejected from modifying Route (HTTP 403)');

    // 3.17 PHE Operator CANNOT PATCH Area -> HTTP 403
    const phePatchAreaReq = await createAuthRequest(`http://localhost/api/zmcc/areas/${area1Id}`, 'PATCH', { name: 'PHE Hack' }, pheUser1);
    const phePatchAreaRes = await patchArea(phePatchAreaReq, { params: Promise.resolve({ id: area1Id.toString() }) });
    assert(phePatchAreaRes.status === 403, 'PHE-AREA-PATCH-403', 'PHE Operator rejected from modifying Area (HTTP 403)');

    // 3.18 PHE Operator CANNOT PATCH Milk Source -> HTTP 403
    const phePatchMsReq = await createAuthRequest(`http://localhost/api/zmcc/milk-sources/${milkSource1Id}`, 'PATCH', { name: 'PHE Hack' }, pheUser1);
    const phePatchMsRes = await patchMilkSource(phePatchMsReq, { params: Promise.resolve({ id: milkSource1Id.toString() }) });
    assert(phePatchMsRes.status === 403, 'PHE-MS-PATCH-403', 'PHE Operator rejected from modifying Milk Source (HTTP 403)');

    // 3.19 PHE Operator CANNOT PATCH Chiller Ownership -> HTTP 403
    const phePatchCoReq = await createAuthRequest(`http://localhost/api/zmcc/chiller-ownerships/${createdCoId}`, 'PATCH', { name: 'PHE Hack' }, pheUser1);
    const phePatchCoRes = await patchChillerOwnership(phePatchCoReq, { params: Promise.resolve({ id: createdCoId.toString() }) });
    assert(phePatchCoRes.status === 403, 'PHE-CHILLER-PATCH-403', 'PHE Operator rejected from modifying Chiller Ownership (HTTP 403)');

    // 3.20 Authorized shop-detail response returns embedded inactive referenced values without exposing unrestricted master-data access
    const pheShopWithInactReq = await createAuthRequest(`http://localhost/api/zmcc/shops/${inactCoShop.id}`, 'GET', undefined, pheUser1);
    const pheShopWithInactRes = await getShopById(pheShopWithInactReq, { params: Promise.resolve({ id: inactCoShop.id.toString() }) });
    const pheShopWithInactData = await pheShopWithInactRes.json();
    assert(
      pheShopWithInactRes.status === 200 &&
        pheShopWithInactData.shop?.chiller_ownership?.id === inactCo.id.toString() &&
        pheShopWithInactData.shop?.chiller_ownership?.is_active === false,
      'PHE-SHOP-READ-INCLUDES-INACTIVE-MASTERS',
      'Authorized shop-detail response safely embeds referenced inactive master values without exposing unrestricted master-data access'
    );

    console.log('\n--- SECTION 4: UNRELATED ROLES & FAIL-CLOSED GUARDS ---');

    // 4.1 MOT Operator rejected from shop creation (no proposal/approval workflow) -> HTTP 403
    const motShopReq = await createAuthRequest('http://localhost/api/zmcc/shops', 'POST', {
      shop_code: `MOT_S_${ts}`.slice(0, 10),
      shop_name: 'MOT Proposed Shop',
      owner_name: 'MOT Driver',
      phone_number: '03001234567',
      cnic: '3520112345673',
      area_id: area1Id.toString(),
      milk_source_id: milkSource1Id.toString(),
      chiller_ownership_id: createdCoId.toString(),
    }, motUser);
    const motShopRes = await postShops(motShopReq);
    assert(motShopRes.status === 403, 'MOT-SHOP-WRITE-FORBIDDEN-403', 'MOT operator strictly denied from creating or proposing shop (HTTP 403)');

    // 4.2 Inactive user denied immediately -> HTTP 401/403
    const inactReq = await createAuthRequest('http://localhost/api/zmcc/routes', 'POST', {
      route_code: `IN_R_${ts}`.slice(0, 10),
      name: 'Inactive User Route',
      origin: 'A',
      destination: 'B',
    }, inactiveUser);
    const inactRes = await postRoutes(inactReq);
    assert(inactRes.status === 401 || inactRes.status === 403, 'INACTIVE-USER-DENIED', 'Inactive user rejected immediately (HTTP 401/403)');

    // 4.3 Scoped user with inactive source rejected -> HTTP 403
    const inactSrcUser = await prisma.user.create({
      data: {
        username: `inact_src_${ts}`,
        full_name: 'Inactive Source User',
        role: 'ZMCC_MANAGER',
        department: 'Milk Procurement',
        scope_type: 'SOURCE',
        procurement_source_id: inactiveZmcc.id,
        is_active: true,
      },
    });
    cleanupUserIds.push(inactSrcUser.id);

    const inactSrcReq = await createAuthRequest('http://localhost/api/zmcc/routes', 'POST', {
      route_code: `IS_R_${ts}`.slice(0, 10),
      name: 'Inactive Source Route',
      origin: 'A',
      destination: 'B',
    }, inactSrcUser);
    const inactSrcRes = await postRoutes(inactSrcReq);
    assert(inactSrcRes.status === 403, 'INACTIVE-SOURCE-DENIED-403', 'Scoped user assigned to inactive ZMCC source rejected (HTTP 403)');

    // 4.4 Legacy role MPD_Zone_Manager fails closed -> HTTP 403
    const legReq = await createAuthRequest('http://localhost/api/zmcc/routes', 'POST', {
      route_code: `LEG_R_${ts}`.slice(0, 10),
      name: 'Legacy Route',
      origin: 'A',
      destination: 'B',
    }, legacyUser);
    const legRes = await postRoutes(legReq);
    assert(legRes.status === 403, 'LEGACY-ROLE-FAIL-CLOSED-403', 'Deprecated legacy role fails closed (HTTP 403)');

    // 4.4 Contractor Manager denied from ZMCC master data -> HTTP 403
    const contrReq = await createAuthRequest('http://localhost/api/zmcc/routes', 'POST', {
      route_code: `CT_R_${ts}`.slice(0, 10),
      name: 'Contractor Route',
      origin: 'A',
      destination: 'B',
    }, contractorUser);
    const contrRes = await postRoutes(contrReq);
    assert(contrRes.status === 403, 'CONTRACTOR-ROLE-FORBIDDEN-403', 'Contractor Manager denied from ZMCC master data (HTTP 403)');

    // 4.5 Direct unauthenticated request to API returns HTTP 401
    const unauthReq = new Request('http://localhost/api/zmcc/routes', { method: 'GET' });
    const unauthRes = await getRoutes(unauthReq);
    assert(unauthRes.status === 401, 'DIRECT-UNAUTHENTICATED-401', 'Direct unauthenticated request to /api/zmcc/* rejected with HTTP 401');

    // 4.6 Legacy/Alias role 'Admin' fails closed -> HTTP 403
    const adminAliasReq = await createAuthRequest('http://localhost/api/zmcc/chiller-ownerships', 'POST', {
      ownership_code: `ADM_${ts}`.slice(0, 10),
      name: `Admin Alias Test ${ts}`,
    }, adminAliasUser);
    const adminAliasRes = await postChillerOwnerships(adminAliasReq);
    assert(adminAliasRes.status === 403, 'ADMIN-ALIAS-FORBIDDEN-403', "Role 'Admin' fails closed with HTTP 403 (SUPER_ADMIN required)");

    // 4.7 Lowercase role 'super_admin' fails closed -> HTTP 403
    const lowerSaReq = await createAuthRequest('http://localhost/api/zmcc/chiller-ownerships', 'POST', {
      ownership_code: `LSA_${ts}`.slice(0, 10),
      name: `Lower Super Admin Test ${ts}`,
    }, lowerSuperAdminUser);
    const lowerSaRes = await postChillerOwnerships(lowerSaReq);
    assert(lowerSaRes.status === 403, 'SUPER-ADMIN-LOWERCASE-FORBIDDEN-403', "Role 'super_admin' fails closed with HTTP 403 (exact case required)");

    // 4.8 Scoped user with null procurement_source_id fails closed -> HTTP 403
    const nullSrcReq = await createAuthRequest('http://localhost/api/zmcc/routes', 'POST', {
      route_code: `NS_${ts}`.slice(0, 10),
      name: `Null Source Route ${ts}`,
      origin: 'A',
      destination: 'B',
    }, nullSourceUser);
    const nullSrcRes = await postRoutes(nullSrcReq);
    assert(nullSrcRes.status === 403, 'SCOPED-NULL-SOURCE-FORBIDDEN-403', 'Scoped user with null procurement_source_id rejected with HTTP 403');

    // 4.9 Scoped user assigned to CONTRACTOR source fails closed -> HTTP 403
    const contrSrcReq = await createAuthRequest('http://localhost/api/zmcc/routes', 'POST', {
      route_code: `CS_${ts}`.slice(0, 10),
      name: `Contractor Source Route ${ts}`,
      origin: 'A',
      destination: 'B',
    }, contractorScopedUser);
    const contrSrcRes = await postRoutes(contrSrcReq);
    assert(contrSrcRes.status === 403, 'SCOPED-CONTRACTOR-SOURCE-FORBIDDEN-403', 'Scoped user assigned to CONTRACTOR source rejected with HTTP 403');

    // 4.10 Scoped user assigned to PLANT source fails closed -> HTTP 403
    const plantSrcReq = await createAuthRequest('http://localhost/api/zmcc/shops', 'POST', {
      shop_code: `PS_${ts}`.slice(0, 10),
      shop_name: `Plant Scoped Shop ${ts}`,
      owner_name: 'Owner',
      phone_number: '03001234567',
      cnic: '3520112345671',
      area_id: area1Id.toString(),
      milk_source_id: milkSource1Id.toString(),
      chiller_ownership_id: createdCoId.toString(),
    }, plantScopedUser);
    const plantSrcRes = await postShops(plantSrcReq);
    assert(plantSrcRes.status === 403, 'SCOPED-PLANT-SOURCE-FORBIDDEN-403', 'Scoped user assigned to PLANT source rejected with HTTP 403');

    // 4.11 Non-existent user ID in session token fails closed -> HTTP 401/403
    const fakeUserReq = await createAuthRequest('http://localhost/api/zmcc/routes', 'GET', undefined, {
      id: '99999999999',
      username: 'ghost_user',
      role: 'SUPER_ADMIN',
    });
    const fakeUserRes = await getRoutes(fakeUserReq);
    assert(fakeUserRes.status === 401 || fakeUserRes.status === 403, 'NONEXISTENT-USER-FAILS-CLOSED', 'Session token with non-existent user fails closed (HTTP 401/403)');

    console.log('\n--- SECTION 5: VALIDATION & CHECK CONSTRAINTS ---');

    // 5.1 Invalid Pakistani mobile rejected (e.g. 12345) -> HTTP 400
    const badPhoneReq = await createAuthRequest('http://localhost/api/zmcc/shops', 'POST', {
      shop_code: `BP_${ts}`.slice(0, 10),
      shop_name: 'Bad Phone Shop',
      owner_name: 'Owner',
      phone_number: '12345',
      cnic: '3520112345671',
      area_id: area1Id.toString(),
      milk_source_id: milkSource1Id.toString(),
      chiller_ownership_id: createdCoId.toString(),
    }, superAdminUser);
    const badPhoneRes = await postShops(badPhoneReq);
    assert(badPhoneRes.status === 400, 'PHONE-VALIDATION-INVALID-400', 'Invalid phone number format rejected with HTTP 400');

    // 5.2 Invalid CNIC format rejected (e.g. 1234) -> HTTP 400
    const badCnicReq = await createAuthRequest('http://localhost/api/zmcc/shops', 'POST', {
      shop_code: `BC_${ts}`.slice(0, 10),
      shop_name: 'Bad CNIC Shop',
      owner_name: 'Owner',
      phone_number: '03001234567',
      cnic: '1234',
      area_id: area1Id.toString(),
      milk_source_id: milkSource1Id.toString(),
      chiller_ownership_id: createdCoId.toString(),
    }, superAdminUser);
    const badCnicRes = await postShops(badCnicReq);
    assert(badCnicRes.status === 400, 'CNIC-VALIDATION-INVALID-400', 'Invalid CNIC format rejected with HTTP 400');

    // 5.3 GPS both-or-neither: Latitude provided but Longitude missing -> HTTP 400
    const badGpsReq = await createAuthRequest('http://localhost/api/zmcc/shops', 'POST', {
      shop_code: `BG_${ts}`.slice(0, 10),
      shop_name: 'Bad GPS Shop',
      owner_name: 'Owner',
      phone_number: '03001234567',
      cnic: '3520112345671',
      area_id: area1Id.toString(),
      milk_source_id: milkSource1Id.toString(),
      chiller_ownership_id: createdCoId.toString(),
      latitude: 31.5,
      longitude: null,
    }, superAdminUser);
    const badGpsRes = await postShops(badGpsReq);
    assert(badGpsRes.status === 400, 'GPS-BOTH-OR-NEITHER-400', 'GPS coordinate both-or-neither rule enforced with HTTP 400');

    // 5.4 GPS out of range latitude (95) -> HTTP 400
    const rangeGpsReq = await createAuthRequest('http://localhost/api/zmcc/shops', 'POST', {
      shop_code: `RG_${ts}`.slice(0, 10),
      shop_name: 'Out of Range GPS Shop',
      owner_name: 'Owner',
      phone_number: '03001234567',
      cnic: '3520112345671',
      area_id: area1Id.toString(),
      milk_source_id: milkSource1Id.toString(),
      chiller_ownership_id: createdCoId.toString(),
      latitude: 95.0,
      longitude: 72.0,
    }, superAdminUser);
    const rangeGpsRes = await postShops(rangeGpsReq);
    assert(rangeGpsRes.status === 400, 'GPS-RANGE-CHECK-400', 'GPS coordinate out-of-range latitude rejected with HTTP 400');

    console.log('\n--- SECTION 6: ACTIVE/INACTIVE LIFECYCLE & DEPENDENCY RULES ---');

    // 6.1 Route deactivation blocked if active areas or shops exist -> HTTP 409
    const deactRouteReq = await createAuthRequest(`http://localhost/api/zmcc/routes/${route1Id}`, 'PATCH', {
      is_active: false,
    }, superAdminUser);
    const deactRouteRes = await patchRoute(deactRouteReq, { params: Promise.resolve({ id: route1Id.toString() }) });
    const deactRouteData = await deactRouteRes.json();
    assert(
      deactRouteRes.status === 409 && deactRouteData.error?.includes('Cannot deactivate route'),
      'ROUTE-DEACTIVATE-BLOCKED-409',
      'Route deactivation strictly blocked when active areas/shops exist (HTTP 409 Conflict)'
    );

    // 6.2 Area deactivation blocked if active shops exist -> HTTP 409
    const deactAreaReq = await createAuthRequest(`http://localhost/api/zmcc/areas/${area1Id}`, 'PATCH', {
      is_active: false,
    }, superAdminUser);
    const deactAreaRes = await patchArea(deactAreaReq, { params: Promise.resolve({ id: area1Id.toString() }) });
    const deactAreaData = await deactAreaRes.json();
    assert(
      deactAreaRes.status === 409 && deactAreaData.error?.includes('Cannot deactivate area'),
      'AREA-DEACTIVATE-BLOCKED-409',
      'Area deactivation strictly blocked when active shops exist (HTTP 409 Conflict)'
    );

    // 6.3 Milk source deactivation blocked if active shops exist -> HTTP 409
    const deactMsReq = await createAuthRequest(`http://localhost/api/zmcc/milk-sources/${milkSource1Id}`, 'PATCH', {
      is_active: false,
    }, superAdminUser);
    const deactMsRes = await patchMilkSource(deactMsReq, { params: Promise.resolve({ id: milkSource1Id.toString() }) });
    const deactMsData = await deactMsRes.json();
    assert(
      deactMsRes.status === 409 && deactMsData.error?.includes('Cannot deactivate milk source'),
      'MS-DEACTIVATE-BLOCKED-409',
      'Milk Source deactivation strictly blocked when active shops exist (HTTP 409 Conflict)'
    );

    // 6.4 Chiller Ownership deactivation blocked if active shops exist -> HTTP 409
    const deactCoReq = await createAuthRequest(`http://localhost/api/zmcc/chiller-ownerships/${createdCoId}`, 'PATCH', {
      is_active: false,
    }, superAdminUser);
    const deactCoRes = await patchChillerOwnership(deactCoReq, { params: Promise.resolve({ id: createdCoId.toString() }) });
    const deactCoData = await deactCoRes.json();
    assert(
      deactCoRes.status === 409 && deactCoData.error?.includes('Cannot deactivate chiller ownership'),
      'CHILLER-DEACTIVATE-BLOCKED-409',
      'Chiller Ownership deactivation strictly blocked when active shops exist (HTTP 409 Conflict)'
    );

    // 6.5 Safe deactivation of a child shop with no dependents -> HTTP 200
    const deactShopReq = await createAuthRequest(`http://localhost/api/zmcc/shops/${shop1Id}`, 'PATCH', {
      is_active: false,
    }, superAdminUser);
    const deactShopRes = await patchShop(deactShopReq, { params: Promise.resolve({ id: shop1Id.toString() }) });
    assert(deactShopRes.status === 200, 'SHOP-DEACTIVATE-200', 'Shop safely deactivated when no dependents exist (HTTP 200)');

    // 6.6 Inactive shop remains readable
    const getShopReq = await createAuthRequest(`http://localhost/api/zmcc/shops/${shop1Id}`, 'GET', undefined, superAdminUser);
    const getShopRes = await getShopById(getShopReq, { params: Promise.resolve({ id: shop1Id.toString() }) });
    const getShopData = await getShopRes.json();
    assert(
      getShopRes.status === 200 && getShopData.shop?.is_active === false,
      'INACTIVE-RECORD-READABLE-200',
      'Inactive shop remains historically readable via GET by ID'
    );

    console.log('\n--- SECTION 7: AUDIT LOGGING & CREATION ATTRIBUTION ---');

    // 7.1 Verify AuditLog entries exist for shop creation and deactivation
    const shopAuditEntries = await prisma.auditLog.findMany({
      where: {
        table_name: 'zmcc_shop',
        record_id: shop1Id,
      },
      orderBy: { created_at: 'asc' },
    });
    assert(
      shopAuditEntries.length >= 2,
      'AUDIT-LOG-RECORDED',
      `AuditLog entries recorded atomically for shop mutations (found ${shopAuditEntries.length} entries)`
    );

    const createAudit = shopAuditEntries.find((a) => a.action === 'ZMCC_SHOP_CREATED');
    assert(
      createAudit != null && createAudit.user_id?.toString() === superAdminUser.id.toString(),
      'AUDIT-CREATOR-ATTRIBUTION',
      'Audit log correctly attributes shop creation to Super Admin user ID'
    );

    const deactAudit = shopAuditEntries.find((a) => a.action === 'ZMCC_SHOP_DEACTIVATED');
    assert(
      deactAudit != null &&
        (deactAudit.old_values as any)?.is_active === true &&
        (deactAudit.new_values as any)?.is_active === false,
      'AUDIT-OLD-NEW-VALUES',
      'Audit log captures old_values and new_values faithfully'
    );

    // 7.2 Verify created_by immutability and updated_by update
    const dbShop = await prisma.zmccShop.findUnique({ where: { id: shop1Id } });
    assert(
      dbShop?.created_by.toString() === superAdminUser.id.toString() &&
        dbShop?.updated_by?.toString() === superAdminUser.id.toString(),
      'CREATED-BY-PRESERVED',
      'created_by preserved forever and updated_by set to the latest mutating actor'
    );

    // 7.3 Mass-assignment forgery attempt: client tries to forge created_by, updated_by, created_at, and zmcc_id
    const forgeShopReq = await createAuthRequest('http://localhost/api/zmcc/shops', 'POST', {
      shop_code: `FRG_${ts}`.slice(0, 10),
      shop_name: `Forged Shop ${ts}`,
      owner_name: 'Attacker',
      phone_number: '03001234567',
      cnic: '3520112345674',
      area_id: area1Id.toString(),
      milk_source_id: milkSource1Id.toString(),
      chiller_ownership_id: createdCoId.toString(),
      // Attempted forgery fields:
      created_by: '9999999',
      updated_by: '9999999',
      created_at: '2020-01-01T00:00:00.000Z',
      updated_at: '2020-01-01T00:00:00.000Z',
      zmcc_id: zmcc2.id.toString(), // client tries to forge zmcc_id
    }, superAdminUser);
    const forgeShopRes = await postShops(forgeShopReq);
    const forgeShopData = await forgeShopRes.json();
    assert(forgeShopRes.status === 201, 'MASS-ASSIGNMENT-STATUS-201', 'Shop with forgery payload processed with strict field allowlist');
    const forgedShopId = BigInt(forgeShopData.shop.id);
    cleanupShopIds.push(forgedShopId);

    const dbForgedShop = await prisma.zmccShop.findUnique({ where: { id: forgedShopId } });
    const forgedAudit = await prisma.auditLog.findFirst({
      where: { table_name: 'zmcc_shop', record_id: forgedShopId, action: 'ZMCC_SHOP_CREATED' },
    });

    assert(
      dbForgedShop?.created_by.toString() === superAdminUser.id.toString() &&
        dbForgedShop?.updated_by === null &&
        dbForgedShop?.zmcc_id.toString() === zmcc1.id.toString() &&
        forgedAudit?.user_id?.toString() === superAdminUser.id.toString(),
      'MASS-ASSIGNMENT-FORGERY-PREVENTED',
      'Client cannot forge created_by, updated_by, zmcc_id, or audit user attribution through request payload'
    );

    console.log('\n--- SECTION 8: PHYSICAL DELETE ABSENCE ---');

    // 8.1 Confirm no physical delete route or export exists
    const routeModule = await import('../src/app/api/zmcc/routes/[id]/route');
    const areaModule = await import('../src/app/api/zmcc/areas/[id]/route');
    const msModule = await import('../src/app/api/zmcc/milk-sources/[id]/route');
    const coModule = await import('../src/app/api/zmcc/chiller-ownerships/[id]/route');
    const shopModule = await import('../src/app/api/zmcc/shops/[id]/route');

    assert(
      (routeModule as any).DELETE === undefined &&
        (areaModule as any).DELETE === undefined &&
        (msModule as any).DELETE === undefined &&
        (coModule as any).DELETE === undefined &&
        (shopModule as any).DELETE === undefined,
      'NO-PHYSICAL-DELETE-ENDPOINTS',
      'Zero physical DELETE handlers exported across all 5 master-data route files'
    );

    console.log('\n--- SECTION 9: /API/AUTH/ME FAIL-CLOSED VALIDATION & ROLE ENFORCEMENT ---');

    // 9.1 Active canonical SUPER_ADMIN succeeds
    const saMeReq = await createAuthRequest('http://localhost/api/auth/me', 'GET', undefined, superAdminUser);
    const saMeRes = await getAuthMe(saMeReq);
    const saMeData = await saMeRes.json();
    assert(
      saMeRes.status === 200 && saMeData.user?.role === 'SUPER_ADMIN',
      'AUTH-ME-SUPER-ADMIN-SUCCEEDS',
      'Active canonical SUPER_ADMIN succeeds with status 200 and verified role'
    );

    // 9.2 Inactive SUPER_ADMIN session fails closed -> HTTP 401 { user: null }
    const inactSaUser = await prisma.user.create({
      data: {
        username: `inact_sa_${ts}`,
        full_name: 'Inactive Super Admin',
        role: 'SUPER_ADMIN',
        department: 'System Administration',
        scope_type: 'SYSTEM',
        is_active: false,
      },
    });
    cleanupUserIds.push(inactSaUser.id);
    const inactSaMeReq = await createAuthRequest('http://localhost/api/auth/me', 'GET', undefined, inactSaUser);
    const inactSaMeRes = await getAuthMe(inactSaMeReq);
    const inactSaMeData = await inactSaMeRes.json();
    assert(
      inactSaMeRes.status === 401 && inactSaMeData.user === null,
      'AUTH-ME-INACTIVE-SUPER-ADMIN-FAILS-CLOSED',
      'Inactive SUPER_ADMIN session fails closed with HTTP 401 and user: null'
    );

    // 9.3 Deleted/missing user session fails closed -> HTTP 401 { user: null }
    const ghostMeReq = await createAuthRequest('http://localhost/api/auth/me', 'GET', undefined, {
      id: '8888888888',
      username: 'deleted_ghost_user',
      role: 'SUPER_ADMIN',
    });
    const ghostMeRes = await getAuthMe(ghostMeReq);
    const ghostMeData = await ghostMeRes.json();
    assert(
      ghostMeRes.status === 401 && ghostMeData.user === null,
      'AUTH-ME-DELETED-USER-FAILS-CLOSED',
      'Deleted or missing user session fails closed with HTTP 401 and user: null'
    );

    // 9.4 Stale / alias Admin session fails to receive SUPER_ADMIN capability
    const adminMeReq = await createAuthRequest('http://localhost/api/auth/me', 'GET', undefined, adminAliasUser);
    const adminMeRes = await getAuthMe(adminMeReq);
    const adminMeData = await adminMeRes.json();
    assert(
      adminMeRes.status === 200 && adminMeData.user?.role === 'Admin',
      'AUTH-ME-ADMIN-ALIAS-NOT-SUPER-ADMIN',
      "Role 'Admin' returned accurately from DB without SUPER_ADMIN elevation"
    );
    // And user with role 'Admin' is rejected from ZMCC Master Data
    const adminZReq = await createAuthRequest('http://localhost/api/zmcc/chiller-ownerships', 'POST', {
      ownership_code: `COA_${ts}`.slice(0, 10),
      name: `Admin Test Ownership ${ts}`,
    }, adminAliasUser);
    const adminZRes = await postChillerOwnerships(adminZReq);
    assert(
      adminZRes.status === 403,
      'ADMIN-ALIAS-DENIED-SUPER-ADMIN-APIS',
      "User with role 'Admin' strictly denied from SUPER_ADMIN APIs (HTTP 403)"
    );

    // 9.5 Active scoped PHE_OPERATOR receives verified source information
    const pheMeReq = await createAuthRequest('http://localhost/api/auth/me', 'GET', undefined, pheUser1);
    const pheMeRes = await getAuthMe(pheMeReq);
    const pheMeData = await pheMeRes.json();
    assert(
      pheMeRes.status === 200 &&
        pheMeData.user?.role === 'PHE_OPERATOR' &&
        pheMeData.user?.procurement_source?.id === zmcc1.id.toString() &&
        pheMeData.user?.procurement_source?.source_type === 'ZMCC' &&
        pheMeData.user?.procurement_source?.is_active === true,
      'AUTH-ME-PHE-VERIFIED-SOURCE',
      'Active scoped PHE_OPERATOR receives verified ZMCC source information'
    );

    // 9.6 Active scoped ZMCC_MANAGER receives verified source information
    const zmMeReq = await createAuthRequest('http://localhost/api/auth/me', 'GET', undefined, zmcc1ManagerUser);
    const zmMeRes = await getAuthMe(zmMeReq);
    const zmMeData = await zmMeRes.json();
    assert(
      zmMeRes.status === 200 &&
        zmMeData.user?.role === 'ZMCC_MANAGER' &&
        zmMeData.user?.procurement_source?.id === zmcc1.id.toString() &&
        zmMeData.user?.procurement_source?.source_type === 'ZMCC' &&
        zmMeData.user?.procurement_source?.is_active === true,
      'AUTH-ME-ZMCC-MANAGER-VERIFIED-SOURCE',
      'Active scoped ZMCC_MANAGER receives verified ZMCC source information'
    );
  } finally {
    // Clean up test fixtures in reverse relational order
    console.log('\n🧹 Cleaning up test fixtures...');
    try {
      if (cleanupShopIds.length > 0) {
        await prisma.auditLog.deleteMany({ where: { table_name: 'zmcc_shop', record_id: { in: cleanupShopIds } } });
        await prisma.zmccShop.deleteMany({ where: { id: { in: cleanupShopIds } } });
      }
      if (cleanupAreaIds.length > 0) {
        await prisma.auditLog.deleteMany({ where: { table_name: 'zmcc_area', record_id: { in: cleanupAreaIds } } });
        await prisma.zmccArea.deleteMany({ where: { id: { in: cleanupAreaIds } } });
      }
      if (cleanupRouteIds.length > 0) {
        await prisma.auditLog.deleteMany({ where: { table_name: 'zmcc_route', record_id: { in: cleanupRouteIds } } });
        await prisma.zmccRoute.deleteMany({ where: { id: { in: cleanupRouteIds } } });
      }
      if (cleanupMilkSourceIds.length > 0) {
        await prisma.auditLog.deleteMany({ where: { table_name: 'zmcc_milk_source', record_id: { in: cleanupMilkSourceIds } } });
        await prisma.zmccMilkSource.deleteMany({ where: { id: { in: cleanupMilkSourceIds } } });
      }
      if (cleanupChillerIds.length > 0) {
        await prisma.auditLog.deleteMany({ where: { table_name: 'chiller_ownership', record_id: { in: cleanupChillerIds } } });
        await prisma.chillerOwnership.deleteMany({ where: { id: { in: cleanupChillerIds } } });
      }
      if (cleanupUserIds.length > 0) {
        await prisma.user.deleteMany({ where: { id: { in: cleanupUserIds } } });
      }
      if (cleanupSourceIds.length > 0) {
        await prisma.procurementSource.deleteMany({ where: { id: { in: cleanupSourceIds } } });
      }
      console.log('✅ Cleanup completed cleanly.');
    } catch (cleanErr: any) {
      console.error('⚠️ Cleanup warning:', cleanErr.message);
    }
  }

  console.log('\n=====================================================================');
  console.log(`STAGE 6B VERIFICATION RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('=====================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runStage6bTests()
  .catch((e) => {
    console.error('Unhandled failure in Stage 6B verification suite:', e);
    process.exit(1);
  });
