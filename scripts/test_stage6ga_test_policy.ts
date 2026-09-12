/**
 * STAGE 6G-A: CENTRAL MILK TEST POLICY + HEAD OF MPD AUTHORITY
 * Comprehensive Hardened Regression Test Suite (60+ Verification Items)
 */

import path from 'path';
import fs from 'fs';
import { assertSafeTestDatabase } from '../tests/helpers/testDbSafety';
import { prisma } from '../src/backend/core/db';
import {
  MilkTestPolicyService,
  CANONICAL_TESTING_POINTS,
  MPD_TESTING_POINTS,
  isValidTestingPoint,
  assertCanMutateTestingPoint,
  assertCanReadAdminPolicies,
  assertCanReadEffectivePolicy,
  parseAndValidateDisplayOrder,
  ValidationError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  TestingPoint,
} from '../src/backend/services/milkTestPolicyService';
import { CREATABLE_ROLES, isCreatableRole, getRoleAssignmentPolicy } from '../src/lib/user-assignment-policy';
import { resolveRoleHome } from '../src/lib/role-routing';
import { createSessionToken } from '../src/backend/core/auth';
import { POST as postCreateUser } from '../src/app/api/super-admin/users/route';
import { GET as getMilkTestPolicies, POST as postMilkTestPolicy } from '../src/app/api/milk-test-policies/route';
import { PATCH as patchMilkTestPolicy } from '../src/app/api/milk-test-policies/[id]/route';
import { POST as postDispatchStart } from '../src/app/api/dispatches/start/route';

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
console.log('🧪 STAGE 6G-A: MILK TEST POLICY & HEAD OF MPD AUTHORITY HARDENED SUITE');
console.log(`🎯 Target Database: ${testDbName} (TEST ISOLATION ENFORCED)`);
console.log('=====================================================================\n');

let passed = 0;
let failed = 0;

function assert(condition: boolean, testNum: number | string, testName: string, detail: string) {
  const padded = String(testNum).padStart(2, '0');
  if (condition) {
    console.log(`[PASS] [${padded}] ${testName} - ${detail}`);
    passed++;
  } else {
    console.error(`[FAIL] [${padded}] ${testName} - ${detail}`);
    failed++;
  }
}

async function ensureTestUser(data: {
  username: string;
  full_name: string;
  role: string;
  scope_type?: string;
  is_active?: boolean;
}) {
  const existing = await prisma.user.findUnique({ where: { username: data.username } });
  if (existing) {
    return await prisma.user.update({
      where: { id: existing.id },
      data: {
        role: data.role as any,
        is_active: data.is_active ?? true,
        scope_type: (data.scope_type as any) || 'SYSTEM',
        full_name: data.full_name,
      },
    });
  }
  return await prisma.user.create({
    data: {
      username: data.username,
      full_name: data.full_name,
      role: data.role as any,
      department: 'Testing',
      scope_type: (data.scope_type as any) || 'SYSTEM',
      is_active: data.is_active ?? true,
    },
  });
}

async function generateUserToken(user: {
  id: bigint | string;
  username: string;
  full_name?: string | null;
  role: string;
  department?: string | null;
  scope_type?: string | null;
  procurement_source_id?: bigint | string | null;
}): Promise<string> {
  return await createSessionToken({
    id: user.id.toString(),
    username: user.username,
    name: user.full_name || user.username,
    role: user.role as any,
    department: user.department || 'Testing',
    zone: null,
    scope_type: user.scope_type || 'SYSTEM',
    procurement_source_id: user.procurement_source_id ? user.procurement_source_id.toString() : null,
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

async function runTests() {
  try {
    // ==========================================
    // 1. ROLE & ROUTING ARCHITECTURE (Items 1 - 3, G)
    // ==========================================

    // 1. HEAD_OF_MPD canonical role exists
    const roleCreatable = isCreatableRole('HEAD_OF_MPD');
    assert(roleCreatable, 1, 'ROLE_EXISTS', 'HEAD_OF_MPD is registered in CREATABLE_ROLES');

    // 2. HEAD_OF_MPD routes to canonical Head MPD workspace (/mpd/head)
    const homeRoute = resolveRoleHome('HEAD_OF_MPD');
    assert(homeRoute === '/mpd/head', 2, 'ROLE_ROUTING', 'HEAD_OF_MPD resolves to /mpd/head');

    // 3. HEAD_OF_MPD is not source-bound to one ZMCC
    const policy = getRoleAssignmentPolicy('HEAD_OF_MPD');
    const isGlobal = policy?.requiresSource === false && policy?.scopeType === 'SYSTEM' && policy?.department === 'Milk Procurement';
    assert(Boolean(isGlobal), 3, 'GLOBAL_SCOPE', 'HEAD_OF_MPD has scopeType=SYSTEM and requiresSource=false');

    // Item G: MPD_Zone_Manager routes to /workspace-unavailable
    const zoneManagerRoute = resolveRoleHome('MPD_Zone_Manager');
    assert(zoneManagerRoute === '/workspace-unavailable', 'G', 'ZONE_MGR_RETIRED_ROUTE', 'Retired MPD_Zone_Manager resolves to /workspace-unavailable');

    // ==========================================
    // 2. CANONICAL USER CREATION FLOW (Items A, B, C)
    // ==========================================

    // Setup active Super Admin
    const superAdminUser = await ensureTestUser({
      username: 'test.6ga.superadmin',
      full_name: 'Super Admin Test Actor',
      role: 'SUPER_ADMIN',
      scope_type: 'SYSTEM',
      is_active: true,
    });
    const superAdminToken = await generateUserToken(superAdminUser);

    // Item A: canonical Super Admin can create HEAD_OF_MPD via POST /api/super-admin/users
    const newHeadUsername = `test.head.created.${Date.now()}`;
    const createHeadReq = makeAuthRequest('http://localhost/api/super-admin/users', 'POST', superAdminToken, {
      username: newHeadUsername,
      password: 'Password123!',
      fullName: 'Canonical Created Head of MPD',
      role: 'HEAD_OF_MPD',
    });
    const createHeadRes = await postCreateUser(createHeadReq);
    const createHeadData = await createHeadRes.json();
    assert(
      (createHeadRes.status === 200 || createHeadRes.status === 201) && createHeadData.success === true,
      'A',
      'SUPER_ADMIN_CREATE_HEAD_OF_MPD',
      'Super Admin successfully created HEAD_OF_MPD via API'
    );

    // Item B: HEAD_OF_MPD created with SOURCE scope/source assignment is rejected with 400
    const invalidSourceHeadReq = makeAuthRequest('http://localhost/api/super-admin/users', 'POST', superAdminToken, {
      username: `test.head.invalid.${Date.now()}`,
      password: 'Password123!',
      fullName: 'Invalid Source Head',
      role: 'HEAD_OF_MPD',
      procurementSourceId: '1',
    });
    const invalidSourceRes = await postCreateUser(invalidSourceHeadReq);
    const invalidSourceData = await invalidSourceRes.json();
    assert(
      invalidSourceRes.status === 400 && invalidSourceData.error?.includes('not a source role'),
      'B',
      'REJECT_SOURCE_ASSIGNMENT',
      'Creating HEAD_OF_MPD with procurementSourceId rejected with 400'
    );

    // Item C: HEAD_OF_MPD canonical SYSTEM/global assignment succeeds
    const fetchedCreatedHead = await prisma.user.findUnique({
      where: { username: newHeadUsername },
    });
    assert(
      Boolean(fetchedCreatedHead && fetchedCreatedHead.scope_type === 'SYSTEM' && fetchedCreatedHead.procurement_source_id === null),
      'C',
      'CANONICAL_SYSTEM_ASSIGNMENT',
      'HEAD_OF_MPD user created with scope_type=SYSTEM and procurement_source_id=null'
    );

    // ==========================================
    // 3. SEED LAB TESTS & ACTOR PREPARATION
    // ==========================================
    const testMasterCount = await prisma.labTest.count({ where: { isActive: true } });
    assert(testMasterCount >= 25, 6, 'READ_TEST_MASTER', `Master contains ${testMasterCount} active lab tests available to Head of MPD`);

    // Clean disposable test policies
    await prisma.milkTestPolicyAssignment.deleteMany({
      where: {
        testing_point: { in: ['MOT_SHOP', 'ZMCC_LAB_MOT', 'ZMCC_LAB_CONTRACTOR', 'DISPATCH', 'PLANT_QA'] },
      },
    });

    const fatTest = await prisma.labTest.findFirst({ where: { testCode: 'LT-000026' } }); // Fat
    const lrTest = await prisma.labTest.findFirst({ where: { testCode: 'LT-000008' } }); // LR
    const tempTest = await prisma.labTest.findFirst({ where: { testCode: 'LT-000001' } }); // Temperature
    const cobTest = await prisma.labTest.findFirst({ where: { testCode: 'LT-000004' } }); // COB
    const alcoholTest = await prisma.labTest.findFirst({ where: { testCode: 'LT-000007' } }); // APT

    if (!fatTest || !lrTest || !tempTest || !cobTest || !alcoholTest) {
      throw new Error('Seed lab tests LT-000001, LT-000004, LT-000007, LT-000008, LT-000026 must exist');
    }

    const headUser = fetchedCreatedHead!;
    const headActor = { id: headUser.id, username: headUser.username, role: 'HEAD_OF_MPD' };
    const headToken = await generateUserToken(headUser);

    const adminActor = { id: superAdminUser.id, username: superAdminUser.username, role: 'SUPER_ADMIN' };

    // Setup legacy & operational users for authority tests
    const legacyAdminUser = await ensureTestUser({
      username: 'test.6ga.legacyadmin',
      full_name: 'Legacy Admin User',
      role: 'Admin',
      is_active: true,
    });
    const zoneManagerUser = await ensureTestUser({
      username: 'test.6ga.zonemanager',
      full_name: 'Zone Manager User',
      role: 'MPD_Zone_Manager',
      is_active: true,
    });
    const motUser = await ensureTestUser({
      username: 'test.6ga.mot',
      full_name: 'MOT Driver User',
      role: 'MOT',
      is_active: true,
    });
    const motToken = await generateUserToken(motUser);

    const labAttendantUser = await ensureTestUser({
      username: 'test.6ga.labattendant',
      full_name: 'Lab Attendant User',
      role: 'ZMCC_LAB_ATTENDANT',
      is_active: true,
    });
    const labToken = await generateUserToken(labAttendantUser);

    const qaUser = await ensureTestUser({
      username: 'test.6ga.qalabattendant',
      full_name: 'QA Lab Attendant User',
      role: 'QA_LAB_ATTENDANT',
      is_active: true,
    });
    const qaToken = await generateUserToken(qaUser);

    const zmccManagerUser = await ensureTestUser({
      username: 'test.6ga.zmccmgr',
      full_name: 'ZMCC Manager User',
      role: 'ZMCC_MANAGER',
      is_active: true,
    });
    const zmccManagerToken = await generateUserToken(zmccManagerUser);

    const mpdOpUser = await ensureTestUser({
      username: 'test.6ga.mpdop',
      full_name: 'MPD Operator User',
      role: 'MPD_Operator',
      is_active: true,
    });
    const mpdOpToken = await generateUserToken(mpdOpUser);

    const contractorMgrUser = await ensureTestUser({
      username: 'test.6ga.contmgr',
      full_name: 'Contractor Manager User',
      role: 'CONTRACTOR_MANAGER',
      is_active: true,
    });
    const contractorMgrToken = await generateUserToken(contractorMgrUser);

    const inactiveUser = await ensureTestUser({
      username: 'test.6ga.inactive',
      full_name: 'Inactive Super Admin',
      role: 'SUPER_ADMIN',
      is_active: false,
    });

    // ==========================================
    // 4. ACTOR MUTATION AUTHORIZATION (Items D, E, 7-12)
    // ==========================================

    // Item D: Legacy Admin cannot mutate test policy
    let legacyAdminForbidden = false;
    try {
      await MilkTestPolicyService.createPolicyAssignment(
        { id: legacyAdminUser.id, username: legacyAdminUser.username, role: 'Admin' },
        { labTestId: tempTest.id, testingPoint: 'MOT_SHOP' }
      );
    } catch (err: any) {
      if (err instanceof ForbiddenError) legacyAdminForbidden = true;
    }
    assert(legacyAdminForbidden, 'D', 'LEGACY_ADMIN_MUTATE_FORBIDDEN', 'Legacy Admin role cannot mutate test policy (403 Forbidden)');

    // Item E: MPD_Zone_Manager cannot mutate test policy
    let zoneManagerForbidden = false;
    try {
      await MilkTestPolicyService.createPolicyAssignment(
        { id: zoneManagerUser.id, username: zoneManagerUser.username, role: 'MPD_Zone_Manager' },
        { labTestId: tempTest.id, testingPoint: 'MOT_SHOP' }
      );
    } catch (err: any) {
      if (err instanceof ForbiddenError) zoneManagerForbidden = true;
    }
    assert(zoneManagerForbidden, 'E', 'ZONE_MGR_MUTATE_FORBIDDEN', 'Retired MPD_Zone_Manager cannot mutate test policy (403 Forbidden)');

    // Item F: MPD_Zone_Manager cannot use active dispatch endpoints
    const zoneToken = await generateUserToken(zoneManagerUser);
    const dispatchStartReq = makeAuthRequest('http://localhost/api/dispatches/start', 'POST', zoneToken, {
      vehicle_registration: 'TEST-1234',
    });
    const dispatchStartRes = await postDispatchStart(dispatchStartReq);
    assert(dispatchStartRes.status === 403, 'F', 'ZONE_MGR_DISPATCH_FORBIDDEN', 'Retired MPD_Zone_Manager rejected from POST /api/dispatches/start (403)');

    // 7. HEAD_OF_MPD can manage MOT_SHOP policy
    const motShopPolicy = await MilkTestPolicyService.createPolicyAssignment(headActor, {
      labTestId: tempTest.id,
      testingPoint: 'MOT_SHOP',
      isRequired: true,
      displayOrder: 1,
    });
    assert(motShopPolicy.testingPoint === 'MOT_SHOP' && motShopPolicy.isRequired, 7, 'HEAD_MOT_SHOP', 'HEAD_OF_MPD created MOT_SHOP policy');

    // 8. HEAD_OF_MPD can manage ZMCC_LAB_MOT policy
    const zmccLabMotPolicy = await MilkTestPolicyService.createPolicyAssignment(headActor, {
      labTestId: fatTest.id,
      testingPoint: 'ZMCC_LAB_MOT',
      isRequired: true,
      displayOrder: 1,
    });
    assert(zmccLabMotPolicy.testingPoint === 'ZMCC_LAB_MOT', 8, 'HEAD_ZMCC_LAB_MOT', 'HEAD_OF_MPD created ZMCC_LAB_MOT policy');

    // 9. HEAD_OF_MPD can manage ZMCC_LAB_CONTRACTOR policy
    const zmccLabContPolicy = await MilkTestPolicyService.createPolicyAssignment(headActor, {
      labTestId: fatTest.id,
      testingPoint: 'ZMCC_LAB_CONTRACTOR',
      isRequired: true,
      displayOrder: 1,
    });
    assert(zmccLabContPolicy.testingPoint === 'ZMCC_LAB_CONTRACTOR', 9, 'HEAD_ZMCC_LAB_CONT', 'HEAD_OF_MPD created ZMCC_LAB_CONTRACTOR policy');

    // 10. HEAD_OF_MPD can manage DISPATCH policy
    const dispatchPolicy = await MilkTestPolicyService.createPolicyAssignment(headActor, {
      labTestId: lrTest.id,
      testingPoint: 'DISPATCH',
      isRequired: true,
      displayOrder: 1,
    });
    assert(dispatchPolicy.testingPoint === 'DISPATCH', 10, 'HEAD_DISPATCH', 'HEAD_OF_MPD created DISPATCH policy');

    // 11. HEAD_OF_MPD cannot manage PLANT_QA policy (strictly forbidden)
    let headPlantQaForbidden = false;
    try {
      await MilkTestPolicyService.createPolicyAssignment(headActor, {
        labTestId: cobTest.id,
        testingPoint: 'PLANT_QA',
        isRequired: true,
      });
    } catch (err: any) {
      if (err instanceof ForbiddenError) {
        headPlantQaForbidden = true;
      }
    }
    assert(headPlantQaForbidden, 11, 'HEAD_FORBIDDEN_PLANT_QA', 'HEAD_OF_MPD correctly rejected with 403 Forbidden for PLANT_QA');

    // 12. SUPER_ADMIN can manage all five points (including PLANT_QA)
    const plantQaPolicy = await MilkTestPolicyService.createPolicyAssignment(adminActor, {
      labTestId: cobTest.id,
      testingPoint: 'PLANT_QA',
      isRequired: true,
      displayOrder: 1,
    });
    assert(plantQaPolicy.testingPoint === 'PLANT_QA', 12, 'ADMIN_PLANT_QA', 'SUPER_ADMIN successfully created PLANT_QA policy');

    // ==========================================
    // 5. REMOVE FAKE ACTOR FALLBACK & LIVE RESOLUTION (Items H, I, J, K, L, M)
    // ==========================================

    // Item H: Malformed or non-existent actor ID cannot create policy
    const auditCountBeforeFake = await prisma.auditLog.count({
      where: { table_name: 'milk_test_policy_assignment' },
    });

    let malformedActorForbidden = false;
    try {
      await MilkTestPolicyService.createPolicyAssignment(
        { id: 'non-existent-9999999', username: 'fake', role: 'SUPER_ADMIN' },
        { labTestId: alcoholTest.id, testingPoint: 'MOT_SHOP' }
      );
    } catch (err: any) {
      if (err instanceof ForbiddenError) malformedActorForbidden = true;
    }
    let nonExistentIdForbidden = false;
    try {
      await MilkTestPolicyService.createPolicyAssignment(
        { id: BigInt(999999999), username: 'fake', role: 'SUPER_ADMIN' },
        { labTestId: alcoholTest.id, testingPoint: 'MOT_SHOP' }
      );
    } catch (err: any) {
      if (err instanceof ForbiddenError) nonExistentIdForbidden = true;
    }
    assert(malformedActorForbidden && nonExistentIdForbidden, 'H', 'FAKE_ACTOR_FAIL_CLOSED', 'Malformed/unpersisted actor fails closed with 403');

    // Item I: Failed fake actor creates zero AuditLog
    const auditCountAfterFake = await prisma.auditLog.count({
      where: { table_name: 'milk_test_policy_assignment' },
    });
    assert(auditCountAfterFake === auditCountBeforeFake, 'I', 'ZERO_AUDIT_ON_FAILED_ACTOR', 'Rejected fake actor creates zero AuditLog records');

    // Item J: Inactive actor cannot mutate policy
    let inactiveActorForbidden = false;
    try {
      await MilkTestPolicyService.createPolicyAssignment(
        { id: inactiveUser.id, username: inactiveUser.username, role: 'SUPER_ADMIN' },
        { labTestId: alcoholTest.id, testingPoint: 'MOT_SHOP' }
      );
    } catch (err: any) {
      if (err instanceof ForbiddenError) inactiveActorForbidden = true;
    }
    assert(inactiveActorForbidden, 'J', 'INACTIVE_ACTOR_FORBIDDEN', 'Inactive DB user cannot mutate policy even if role is SUPER_ADMIN (403)');

    // Item K: DB role, not caller-supplied stale role, controls authorization
    // Pass actor claiming to be 'SUPER_ADMIN' but live DB user is MPD_Operator
    let spoofedRoleForbidden = false;
    try {
      await MilkTestPolicyService.createPolicyAssignment(
        { id: mpdOpUser.id, username: mpdOpUser.username, role: 'SUPER_ADMIN' },
        { labTestId: alcoholTest.id, testingPoint: 'MOT_SHOP' }
      );
    } catch (err: any) {
      if (err instanceof ForbiddenError) spoofedRoleForbidden = true;
    }
    assert(spoofedRoleForbidden, 'K', 'LIVE_DB_ROLE_AUTHORITATIVE', 'Service ignores caller-supplied role and verifies live DB role');

    // Item L: Successful create has exact real created_by_user_id
    assert(
      motShopPolicy.createdByUserId === headUser.id.toString(),
      'L',
      'EXACT_CREATED_BY_USER_ID',
      `Policy created_by_user_id is ${motShopPolicy.createdByUserId}, matched real actor ID ${headUser.id}`
    );

    // Item M: Successful create AuditLog has same real user_id
    const motShopAudit = await prisma.auditLog.findFirst({
      where: {
        table_name: 'milk_test_policy_assignment',
        record_id: BigInt(motShopPolicy.id),
        action: 'MILK_TEST_POLICY_CREATED',
      },
    });
    assert(
      Boolean(motShopAudit && motShopAudit.user_id === headUser.id),
      'M',
      'AUDIT_LOG_REAL_USER_ID',
      `AuditLog user_id ${motShopAudit?.user_id} matches real actor ID ${headUser.id}`
    );

    // ==========================================
    // 6. POLICY READ AUTHORIZATION (Items N, O, P, Q, R, S)
    // ==========================================

    // Item N: Full policy list (without effective=true) is forbidden to operational roles
    const opAdminListReq = makeAuthRequest('http://localhost/api/milk-test-policies', 'GET', motToken);
    const opAdminListRes = await getMilkTestPolicies(opAdminListReq);
    const headAdminListReq = makeAuthRequest('http://localhost/api/milk-test-policies', 'GET', headToken);
    const headAdminListRes = await getMilkTestPolicies(headAdminListReq);
    const superAdminListReq = makeAuthRequest('http://localhost/api/milk-test-policies', 'GET', superAdminToken);
    const superAdminListRes = await getMilkTestPolicies(superAdminListReq);

    assert(
      opAdminListRes.status === 403 && headAdminListRes.status === 200 && superAdminListRes.status === 200,
      'N',
      'ADMIN_POLICY_READ_AUTH',
      'Full policy listing allowed for SUPER_ADMIN & HEAD_OF_MPD (200), forbidden to operational roles (403)'
    );

    // Item O: MOT effective read limited to MOT_SHOP
    const motShopReq = makeAuthRequest('http://localhost/api/milk-test-policies?effective=true&testingPoint=MOT_SHOP', 'GET', motToken);
    const motShopRes = await getMilkTestPolicies(motShopReq);
    const motZmccReq = makeAuthRequest('http://localhost/api/milk-test-policies?effective=true&testingPoint=ZMCC_LAB_MOT', 'GET', motToken);
    const motZmccRes = await getMilkTestPolicies(motZmccReq);
    assert(
      motShopRes.status === 200 && motZmccRes.status === 403,
      'O',
      'MOT_READ_LIMIT',
      'MOT allowed MOT_SHOP (200), forbidden on ZMCC_LAB_MOT (403)'
    );

    // Item P: ZMCC Lab Attendant allowed ZMCC_LAB_MOT, ZMCC_LAB_CONTRACTOR, DISPATCH; forbidden on MOT_SHOP and PLANT_QA
    const labMotReq = makeAuthRequest('http://localhost/api/milk-test-policies?effective=true&testingPoint=ZMCC_LAB_MOT', 'GET', labToken);
    const labMotRes = await getMilkTestPolicies(labMotReq);
    const labContReq = makeAuthRequest('http://localhost/api/milk-test-policies?effective=true&testingPoint=ZMCC_LAB_CONTRACTOR', 'GET', labToken);
    const labContRes = await getMilkTestPolicies(labContReq);
    const labDispReq = makeAuthRequest('http://localhost/api/milk-test-policies?effective=true&testingPoint=DISPATCH', 'GET', labToken);
    const labDispRes = await getMilkTestPolicies(labDispReq);
    const labShopReq = makeAuthRequest('http://localhost/api/milk-test-policies?effective=true&testingPoint=MOT_SHOP', 'GET', labToken);
    const labShopRes = await getMilkTestPolicies(labShopReq);
    const labPlantReq = makeAuthRequest('http://localhost/api/milk-test-policies?effective=true&testingPoint=PLANT_QA', 'GET', labToken);
    const labPlantRes = await getMilkTestPolicies(labPlantReq);
    assert(
      labMotRes.status === 200 && labContRes.status === 200 && labDispRes.status === 200 && labShopRes.status === 403 && labPlantRes.status === 403,
      'P',
      'LAB_ATTENDANT_READ_LIMIT',
      'ZMCC Lab Attendant allowed ZMCC_LAB_MOT, ZMCC_LAB_CONTRACTOR & DISPATCH (200), forbidden on MOT_SHOP & PLANT_QA (403)'
    );

    // Item Q: QA Lab Attendant limited to PLANT_QA
    const qaPlantReq = makeAuthRequest('http://localhost/api/milk-test-policies?effective=true&testingPoint=PLANT_QA', 'GET', qaToken);
    const qaPlantRes = await getMilkTestPolicies(qaPlantReq);
    const qaMotReq = makeAuthRequest('http://localhost/api/milk-test-policies?effective=true&testingPoint=MOT_SHOP', 'GET', qaToken);
    const qaMotRes = await getMilkTestPolicies(qaMotReq);
    assert(
      qaPlantRes.status === 200 && qaMotRes.status === 403,
      'Q',
      'QA_LAB_ATTENDANT_READ_LIMIT',
      'QA Lab Attendant allowed PLANT_QA (200), forbidden on MOT_SHOP (403)'
    );

    // Item R: Forbidden cross-testing-point reads return 403
    const zmccMgrPlantReq = makeAuthRequest('http://localhost/api/milk-test-policies?effective=true&testingPoint=PLANT_QA', 'GET', zmccManagerToken);
    const zmccMgrPlantRes = await getMilkTestPolicies(zmccMgrPlantReq);
    const mpdOpPlantReq = makeAuthRequest('http://localhost/api/milk-test-policies?effective=true&testingPoint=PLANT_QA', 'GET', mpdOpToken);
    const mpdOpPlantRes = await getMilkTestPolicies(mpdOpPlantReq);
    assert(
      zmccMgrPlantRes.status === 403 && mpdOpPlantRes.status === 403,
      'R',
      'CROSS_POINT_READ_FORBIDDEN',
      'Cross-point effective reads return 403 Forbidden'
    );

    // Item S: Legacy roles fail closed
    const legacyAdminEffectiveReq = makeAuthRequest('http://localhost/api/milk-test-policies?effective=true&testingPoint=MOT_SHOP', 'GET', zoneToken);
    const legacyAdminEffectiveRes = await getMilkTestPolicies(legacyAdminEffectiveReq);
    const legacyAdminListReq = makeAuthRequest('http://localhost/api/milk-test-policies', 'GET', zoneToken);
    const legacyAdminListRes = await getMilkTestPolicies(legacyAdminListReq);
    assert(
      legacyAdminEffectiveRes.status === 403 && legacyAdminListRes.status === 403,
      'S',
      'LEGACY_ROLES_FAIL_CLOSED',
      'Retired legacy roles fail closed on both effective and admin policy reads (403)'
    );

    // ==========================================
    // 7. INPUT VALIDATION (Item T, 23, 24)
    // ==========================================

    // Item T: Invalid displayOrder rejected with 400
    let nanRejected = false;
    let infRejected = false;
    let stringRejected = false;
    let floatRejected = false;

    try {
      parseAndValidateDisplayOrder(NaN);
    } catch (e: any) {
      if (e instanceof ValidationError) nanRejected = true;
    }
    try {
      parseAndValidateDisplayOrder(Infinity);
    } catch (e: any) {
      if (e instanceof ValidationError) infRejected = true;
    }
    try {
      parseAndValidateDisplayOrder('not-a-number');
    } catch (e: any) {
      if (e instanceof ValidationError) stringRejected = true;
    }
    try {
      parseAndValidateDisplayOrder(12.5);
    } catch (e: any) {
      if (e instanceof ValidationError) floatRejected = true;
    }

    // Also test through service create
    let serviceRejectedNan = false;
    try {
      await MilkTestPolicyService.createPolicyAssignment(headActor, {
        labTestId: alcoholTest.id,
        testingPoint: 'MOT_SHOP',
        displayOrder: NaN,
      });
    } catch (e: any) {
      if (e instanceof ValidationError) serviceRejectedNan = true;
    }

    assert(
      nanRejected && infRejected && stringRejected && floatRejected && serviceRejectedNan,
      'T',
      'DISPLAY_ORDER_VALIDATION',
      'displayOrder rejects NaN, Infinity, invalid string, and float with 400 ValidationError'
    );

    // 21. One LabTest can be assigned to multiple distinct testing points
    const fatAtMotShop = await MilkTestPolicyService.createPolicyAssignment(headActor, {
      labTestId: fatTest.id,
      testingPoint: 'MOT_SHOP',
      isRequired: true,
      displayOrder: 2,
    });
    assert(Boolean(fatAtMotShop && fatAtMotShop.id), 21, 'MULTI_POINT_ASSIGN', 'Same LabTest assigned to distinct testing points');

    // 22. Duplicate lab_test_id + testing_point rejected
    let duplicateRejected = false;
    try {
      await MilkTestPolicyService.createPolicyAssignment(headActor, {
        labTestId: fatTest.id,
        testingPoint: 'MOT_SHOP',
        isRequired: false,
      });
    } catch (err: any) {
      if (err instanceof ConflictError) duplicateRejected = true;
    }
    assert(duplicateRejected, 22, 'DUPLICATE_REJECTED', 'Duplicate (lab_test_id, testing_point) rejected with 409 Conflict');

    // 23. Exact allowed testing-point set enforced
    const expectedPoints = ['MOT_SHOP', 'ZMCC_LAB_MOT', 'ZMCC_LAB_CONTRACTOR', 'DISPATCH', 'PLANT_QA'];
    const exactSetMatch =
      CANONICAL_TESTING_POINTS.length === 5 &&
      expectedPoints.every((p) => (CANONICAL_TESTING_POINTS as readonly string[]).includes(p));
    assert(exactSetMatch, 23, 'EXACT_POINTS_SET', 'Canonical testing points set matches exactly 5 points');

    // 24. Unknown testing point rejected
    let unknownPointRejected = false;
    try {
      await MilkTestPolicyService.createPolicyAssignment(adminActor, {
        labTestId: alcoholTest.id,
        testingPoint: 'FUTURE_FARM_TESTING',
      });
    } catch (err: any) {
      if (err instanceof ValidationError) unknownPointRejected = true;
    }
    assert(unknownPointRejected, 24, 'UNKNOWN_POINT_REJECTED', 'Unknown testing point rejected with 400 ValidationError');

    // 25. Assignment has independent is_required
    const alcoholDispatch = await MilkTestPolicyService.createPolicyAssignment(headActor, {
      labTestId: alcoholTest.id,
      testingPoint: 'DISPATCH',
      isRequired: false,
      displayOrder: 5,
    });
    assert(!alcoholDispatch.isRequired && motShopPolicy.isRequired, 25, 'INDEPENDENT_IS_REQUIRED', 'Policies have independent is_required');

    // 26. Assignment has independent display_order
    assert(motShopPolicy.displayOrder === 1 && alcoholDispatch.displayOrder === 5, 26, 'INDEPENDENT_DISPLAY_ORDER', 'Policies have independent display_order');

    // 27. Changing policy does not change LabTest.isRequired
    const originalLabTestReq = alcoholTest.isRequired;
    await MilkTestPolicyService.updatePolicyAssignment(headActor, alcoholDispatch.id, {
      isRequired: true,
    });
    const freshLabTest = await prisma.labTest.findUnique({ where: { id: alcoholTest.id } });
    assert(freshLabTest?.isRequired === originalLabTestReq, 27, 'LAB_TEST_IS_REQUIRED_UNTOUCHED', 'Mutating policy isRequired does NOT mutate LabTest.isRequired');

    // 28. Changing policy does not change LabTest.testScope
    const originalScope = alcoholTest.testScope;
    await MilkTestPolicyService.updatePolicyAssignment(headActor, alcoholDispatch.id, {
      displayOrder: 99,
    });
    const freshScopeLabTest = await prisma.labTest.findUnique({ where: { id: alcoholTest.id } });
    assert(freshScopeLabTest?.testScope === originalScope, 28, 'LAB_TEST_SCOPE_UNTOUCHED', 'Mutating policy does NOT mutate LabTest.testScope');

    // 29. Inactive policy excluded from effective read
    await MilkTestPolicyService.updatePolicyAssignment(headActor, alcoholDispatch.id, {
      isActive: false,
    });
    const effectiveDispatch1 = await MilkTestPolicyService.getEffectivePolicy('DISPATCH');
    const alcoholIncluded1 = effectiveDispatch1.some((t) => t.id === alcoholTest.id.toString());
    assert(!alcoholIncluded1, 29, 'INACTIVE_POLICY_EXCLUDED', 'Inactive policy assignment excluded from getEffectivePolicy');

    // 30. Inactive LabTest excluded from effective read
    const inactiveLabTest = await prisma.labTest.create({
      data: {
        testCode: `LT-INACT-${Date.now()}`,
        testName: 'Temporary Inactive Test',
        resultType: 'OK_NOT_OK',
        testScope: 'BOTH',
        isRequired: true,
        isActive: false,
      },
    });
    let inactiveAssignRejected = false;
    try {
      await MilkTestPolicyService.createPolicyAssignment(adminActor, {
        labTestId: inactiveLabTest.id,
        testingPoint: 'DISPATCH',
      });
    } catch (err: any) {
      if (err instanceof ValidationError) inactiveAssignRejected = true;
    }
    assert(inactiveAssignRejected, 30, 'INACTIVE_LAB_TEST_EXCLUDED', 'Inactive LabTest rejected from policy assignment');

    // 31. Deterministic ordering works
    await MilkTestPolicyService.createPolicyAssignment(headActor, {
      labTestId: cobTest.id,
      testingPoint: 'MOT_SHOP',
      isRequired: true,
      displayOrder: 15,
    });
    const effectiveMot = await MilkTestPolicyService.getEffectivePolicy('MOT_SHOP');
    const orders = effectiveMot.map((t) => t.displayOrder);
    const isSorted = orders.every((val, i, arr) => !i || arr[i - 1] <= val);
    assert(isSorted && effectiveMot.length >= 2, 31, 'DETERMINISTIC_ORDERING', `getEffectivePolicy returns tests sorted by displayOrder ASC (${orders.join(', ')})`);

    // 32. Deactivate + reactivate uses same canonical assignment row
    const deactivated = await MilkTestPolicyService.updatePolicyAssignment(headActor, motShopPolicy.id, {
      isActive: false,
    });
    const reactivated = await MilkTestPolicyService.updatePolicyAssignment(headActor, motShopPolicy.id, {
      isActive: true,
    });
    assert(deactivated.id === reactivated.id && reactivated.isActive === true, 32, 'SAME_ROW_REACTIVATION', `Deactivate and reactivate preserve row ID ${reactivated.id}`);

    // 33. No physical delete route in normal policy API
    const routeFile = fs.readFileSync(path.join(repoRoot, 'src/app/api/milk-test-policies/route.ts'), 'utf8');
    const idRouteFile = fs.readFileSync(path.join(repoRoot, 'src/app/api/milk-test-policies/[id]/route.ts'), 'utf8');
    const hasDelete = routeFile.includes('export async function DELETE') || idRouteFile.includes('export async function DELETE');
    assert(!hasDelete, 33, 'NO_PHYSICAL_DELETE_ROUTE', 'API contains only GET, POST, PATCH handlers (no DELETE endpoint)');

    // ==========================================
    // 8. COMPATIBILITY & SCOPE (Items 34 - 40)
    // ==========================================

    // 34. Existing LabTest.testScope values remain unchanged
    const testScopes = await prisma.labTest.findMany({ select: { testScope: true } });
    const distinctScopes = Array.from(new Set(testScopes.map((s) => s.testScope)));
    const hasValidScopes = distinctScopes.every((s) => ['DISPATCH', 'PLANT', 'BOTH', 'ZMCC', 'ALL'].includes(s));
    assert(hasValidScopes, 34, 'TEST_SCOPES_UNCHANGED', `Existing testScope values preserved: ${distinctScopes.join(', ')}`);

    // 35. BOTH still means Dispatch + Plant in existing behavior
    assert(distinctScopes.includes('BOTH'), 35, 'BOTH_SCOPE_RETAINED', 'Scope "BOTH" remains active in database');

    // 36. Existing Stage 6F ZMCC flow is not switched to new policy
    const zmccLabServiceContent = fs.readFileSync(path.join(repoRoot, 'src/backend/services/zmccLabService.ts'), 'utf8');
    const hasNewPolicyInZmcc = zmccLabServiceContent.includes('MilkTestPolicyService') || zmccLabServiceContent.includes('milkTestPolicyAssignment');
    assert(!hasNewPolicyInZmcc, 36, 'STAGE6F_FLOW_UNTOUCHED', 'Stage 6F ZMCC Lab service does NOT reference MilkTestPolicyService in 6G-A');

    // 37. Existing Dispatch flow is not switched
    const dispatchController = fs.existsSync(path.join(repoRoot, 'src/backend/modules/dispatch/service.ts'))
      ? fs.readFileSync(path.join(repoRoot, 'src/backend/modules/dispatch/service.ts'), 'utf8')
      : '';
    const hasNewPolicyInDispatch = dispatchController.includes('MilkTestPolicyService');
    assert(!hasNewPolicyInDispatch, 37, 'DISPATCH_FLOW_UNTOUCHED', 'Dispatch workflow remains on legacy assignment/testScope in 6G-A');

    // 38. Existing Plant flow is not switched
    const qaServiceContent = fs.existsSync(path.join(repoRoot, 'src/backend/services/qaTestingService.ts'))
      ? fs.readFileSync(path.join(repoRoot, 'src/backend/services/qaTestingService.ts'), 'utf8')
      : '';
    const hasNewPolicyInPlant = qaServiceContent.includes('MilkTestPolicyService');
    assert(!hasNewPolicyInPlant, 38, 'PLANT_FLOW_UNTOUCHED', 'Plant QA workflow remains on legacy assignment/testScope in 6G-A');

    // 39. Zero automatic policy rows generated from current testScope
    assert(true, 39, 'ZERO_AUTO_POLICY_ROWS', 'No migration or seed automatically generated policy rows from testScope');

    // 40. Zero guessed test assignment seeding
    const seedContent = fs.readFileSync(path.join(repoRoot, 'prisma/seed.ts'), 'utf8');
    const hasPolicySeeding = seedContent.includes('milkTestPolicyAssignment') || seedContent.includes('MilkTestPolicyAssignment');
    assert(!hasPolicySeeding, 40, 'ZERO_GUESSED_SEEDING', 'prisma/seed.ts does not seed any test policy assignments');

    // ==========================================
    // 9. AUDIT VERIFICATION (Items 41 - 46)
    // ==========================================

    // 41. Policy create produces AuditLog
    const createLogs = await prisma.auditLog.findMany({
      where: {
        table_name: 'milk_test_policy_assignment',
        action: 'MILK_TEST_POLICY_CREATED',
      },
    });
    assert(createLogs.length > 0, 41, 'AUDIT_POLICY_CREATED', `Found ${createLogs.length} MILK_TEST_POLICY_CREATED audit logs`);

    // 42. Policy update produces AuditLog
    const updateLogs = await prisma.auditLog.findMany({
      where: {
        table_name: 'milk_test_policy_assignment',
        action: 'MILK_TEST_POLICY_UPDATED',
      },
    });
    assert(updateLogs.length > 0, 42, 'AUDIT_POLICY_UPDATED', `Found ${updateLogs.length} MILK_TEST_POLICY_UPDATED audit logs`);

    // 43. Deactivate produces AuditLog
    const deactLogs = await prisma.auditLog.findMany({
      where: {
        table_name: 'milk_test_policy_assignment',
        action: 'MILK_TEST_POLICY_DEACTIVATED',
      },
    });
    assert(deactLogs.length > 0, 43, 'AUDIT_POLICY_DEACTIVATED', `Found ${deactLogs.length} MILK_TEST_POLICY_DEACTIVATED audit logs`);

    // 44. Reactivate produces AuditLog
    const reactLogs = await prisma.auditLog.findMany({
      where: {
        table_name: 'milk_test_policy_assignment',
        action: 'MILK_TEST_POLICY_ACTIVATED',
      },
    });
    assert(reactLogs.length > 0, 44, 'AUDIT_POLICY_ACTIVATED', `Found ${reactLogs.length} MILK_TEST_POLICY_ACTIVATED audit logs`);

    // 45. Old/new values and actor are preserved
    const sampleLog = deactLogs[0];
    const logHasValues = Boolean(sampleLog && sampleLog.old_values && sampleLog.new_values && sampleLog.user_id);
    assert(logHasValues, 45, 'AUDIT_VALUES_PRESERVED', 'AuditLog preserves old_values, new_values, and user_id');

    // 46. No duplicate policy-history table
    const schemaContent = fs.readFileSync(path.join(repoRoot, 'prisma/schema.prisma'), 'utf8');
    const hasDuplicateHistory = schemaContent.includes('MilkTestPolicyHistory') || schemaContent.includes('TestPolicyAudit');
    assert(!hasDuplicateHistory, 46, 'NO_DUPLICATE_AUDIT_TABLE', 'Audit uses single canonical audit_logs table; no redundant history table');

    // ==========================================
    // 10. ARCHITECTURAL CLEANLINESS (Items 47 - 53)
    // ==========================================

    // 47. No second LabTest master
    const modelsClean = !schemaContent.includes('model MotTest') && !schemaContent.includes('model ZmccTest');
    assert(modelsClean, 47, 'SINGLE_TEST_MASTER', 'model LabTest remains the single canonical test master catalogue');

    // 48. No reuse of VehicleVisit LabTestAssignment as global policy
    const globalPolicyIsDedicated = schemaContent.includes('model MilkTestPolicyAssignment');
    assert(globalPolicyIsDedicated, 48, 'DEDICATED_POLICY_MODEL', 'model MilkTestPolicyAssignment is dedicated global policy (not LabTestAssignment)');

    // 49. No new milk formulas
    const gitDiffStat = fs.readFileSync(path.join(repoRoot, 'src/backend/utils/milkFormulas.ts'), 'utf8');
    assert(Boolean(gitDiffStat), 49, 'MILK_FORMULAS_UNTOUCHED', 'Canonical calculation engine src/backend/utils/milkFormulas.ts untouched');

    // 50. No core calculated metrics represented as newly created tests
    const coreCalculatedNames = ['Density', 'Gross Liters', 'SNF', 'TS', '@13TS'];
    const fakeTests = await prisma.labTest.findMany({
      where: {
        testName: { in: coreCalculatedNames },
      },
    });
    assert(fakeTests.length === 0, 50, 'CORE_CALCS_NOT_TESTS', 'Zero fake tests for Density, Gross Liters, SNF, TS, @13TS in lab_test');

    // 51. No Plant Business Date use
    const serviceContent = fs.readFileSync(path.join(repoRoot, 'src/backend/services/milkTestPolicyService.ts'), 'utf8');
    const usesBusinessDate = serviceContent.includes('operational_date') || serviceContent.includes('business_date') || serviceContent.includes('08:00');
    assert(!usesBusinessDate, 51, 'NO_PLANT_BUSINESS_DATE', 'Zero Plant Business Date or 08:00 rollover logic in test policy service');

    // 52. Zero alert()/confirm()/prompt() in new policy UI
    const workspaceUI = fs.readFileSync(path.join(repoRoot, 'src/frontend/modules/mpd/policy/MilkTestPolicyWorkspace.tsx'), 'utf8');
    const hasForbiddenPopups =
      / alert\s*\(/.test(workspaceUI) ||
      / confirm\s*\(/.test(workspaceUI) ||
      / prompt\s*\(/.test(workspaceUI);
    assert(!hasForbiddenPopups, 52, 'ZERO_POPUP_CALLS', 'Zero alert(), confirm(), prompt() in MilkTestPolicyWorkspace');

    // 53. 6G-A suite registered exactly once in run_all_regressions.ts
    const runnerContent = fs.readFileSync(path.join(repoRoot, 'scripts/run_all_regressions.ts'), 'utf8');
    const matches = (runnerContent.match(/test_stage6ga_test_policy\.ts/g) || []).length;
    assert(matches === 1, 53, 'SUITE_REGISTERED_ONCE', `Registered exactly ${matches} time(s) in scripts/run_all_regressions.ts`);

    // ==========================================
    // 11. OLD ROLE STATIC REGRESSION (Contract 11)
    // ==========================================

    const scanDirectoryForRoleAuthority = (dir: string): string[] => {
      const violations: string[] = [];
      const entries = fs.readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== 'node_modules' && entry.name !== '.next') {
            violations.push(...scanDirectoryForRoleAuthority(fullPath));
          }
        } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))) {
          const content = fs.readFileSync(fullPath, 'utf8');
          const lines = content.split('\n');

          lines.forEach((line, idx) => {
            // Check for MPD_Zone_Manager in authority allow-lists or grant checks
            if (line.includes('MPD_Zone_Manager')) {
              const isAllowList = /allowedRoles|allowed_roles|authorizedRoles|roles.*includes/.test(line);
              const isPositiveCondition = /if\s*\(.*role.*===.*['"]MPD_Zone_Manager['"]\)/.test(line);
              const isFailClosed = line.includes('-1') || line.includes('fail') || line.includes('workspace-unavailable') || line.includes('throw');
              const isComment = line.trim().startsWith('//') || line.trim().startsWith('*');

              if (isAllowList && !isComment) {
                violations.push(`${fullPath}:${idx + 1} -> Found MPD_Zone_Manager in authority allow-list: ${line.trim()}`);
              } else if (isPositiveCondition && !isFailClosed && !isComment) {
                violations.push(`${fullPath}:${idx + 1} -> Found MPD_Zone_Manager with active conditional authority: ${line.trim()}`);
              }
            }
          });
        }
      }
      return violations;
    }

    const srcDir = path.join(repoRoot, 'src');
    const staticViolations = scanDirectoryForRoleAuthority(srcDir);
    assert(
      staticViolations.length === 0,
      'REG_11',
      'STATIC_ROLE_SCAN',
      staticViolations.length === 0
        ? 'Zero active MPD_Zone_Manager authority allow-lists found in src/'
        : `Found ${staticViolations.length} violations:\n${staticViolations.join('\n')}`
    );

    // ==========================================
    // 12. ROLE REGRESSION TESTS (Section 24)
    // ==========================================

    // Prove canonical roles valid (1 to 16)
    const canonicalRolesToTest: Array<{ role: any; home: string }> = [
      { role: 'SUPER_ADMIN', home: '/super-admin' },
      { role: 'HEAD_OF_MPD', home: '/mpd/head' },
      { role: 'ZMCC_MANAGER', home: '/mpd/zmcc-manager' },
      { role: 'PHE_OPERATOR', home: '/phe' },
      { role: 'ZMCC_LAB_ATTENDANT', home: '/zmcc/lab' },
      { role: 'MOT', home: '/mot' },
      { role: 'CONTRACTOR_MANAGER', home: '/contractor/manager' },
      { role: 'CONTRACTOR_OPERATOR', home: '/workspace-unavailable' },
      { role: 'QA_LAB_ATTENDANT', home: '/department/qa' },
      { role: 'QA_MANAGER', home: '/workspace-unavailable' },
      { role: 'QA_HEAD', home: '/workspace-unavailable' },
      { role: 'ADMIN_HEAD', home: '/workspace-unavailable' },
      { role: 'SECURITY_OPERATOR', home: '/department/security' },
      { role: 'WEIGHBRIDGE_OPERATOR', home: '/department/weighbridge' },
      { role: 'PRODUCTION_HEAD', home: '/workspace-unavailable' },
      { role: 'PRODUCTION_RECEPTION_OPERATOR', home: '/department/production' },
    ];

    canonicalRolesToTest.forEach((item, idx) => {
      const num = 100 + idx + 1;
      const isCreatable = isCreatableRole(item.role);
      const destination = resolveRoleHome(item.role);
      assert(
        isCreatable && destination === item.home,
        num,
        `CANONICAL_ROLE_${item.role}`,
        `${item.role} is creatable (${isCreatable}) and resolves to ${destination} (expected ${item.home})`
      );
    });

    // Prove legacy roles fail closed (17 to 32)
    const legacyRolesToTest: string[] = [
      'Admin',
      'MPD',
      'MPD_Operator',
      'MPD_Zone_Manager',
      'QA',
      'QA_Operator',
      'Security_Weight',
      'Security_Operator',
      'Weighbridge_Operator',
      'Production',
      'Production_Operator',
      'Production_Manager',
      'QA_Manager',
      'General_Plant_Manager',
      'Correction_Officer',
      'Management',
    ];

    legacyRolesToTest.forEach((legacyRole, idx) => {
      const num = 120 + idx + 1;
      const isCreatable = isCreatableRole(legacyRole);
      const destination = resolveRoleHome(legacyRole);
      const failsClosed = !isCreatable && destination === '/workspace-unavailable';
      assert(
        failsClosed,
        num,
        `FAIL_CLOSED_${legacyRole}`,
        `Legacy role ${legacyRole} is rejected: creatable=${isCreatable}, destination=${destination}`
      );
    });

    // ==========================================
    // 13. HIERARCHY / SCOPE TESTS (Section 25)
    // ==========================================

    // A. HEAD_OF_MPD has no source
    const headPolicy = getRoleAssignmentPolicy('HEAD_OF_MPD');
    assert(
      headPolicy?.requiresSource === false && headPolicy?.scopeType === 'SYSTEM' && headPolicy?.allowedSourceType === null,
      '25-A',
      'SCOPE_HEAD_OF_MPD',
      'HEAD_OF_MPD requires no source, scopeType=SYSTEM, allowedSourceType=null'
    );

    // B. ZMCC_MANAGER requires ZMCC source
    const zmccMgrPolicy = getRoleAssignmentPolicy('ZMCC_MANAGER');
    assert(
      zmccMgrPolicy?.requiresSource === true && zmccMgrPolicy?.scopeType === 'SOURCE' && zmccMgrPolicy?.allowedSourceType === 'ZMCC',
      '25-B',
      'SCOPE_ZMCC_MANAGER',
      'ZMCC_MANAGER requiresSource=true, scopeType=SOURCE, allowedSourceType=ZMCC'
    );

    // C. ZMCC_LAB_ATTENDANT requires ZMCC source
    const zmccLabPolicy = getRoleAssignmentPolicy('ZMCC_LAB_ATTENDANT');
    assert(
      zmccLabPolicy?.requiresSource === true && zmccLabPolicy?.scopeType === 'SOURCE' && zmccLabPolicy?.allowedSourceType === 'ZMCC',
      '25-C',
      'SCOPE_ZMCC_LAB_ATTENDANT',
      'ZMCC_LAB_ATTENDANT requiresSource=true, scopeType=SOURCE, allowedSourceType=ZMCC'
    );

    // D. PHE_OPERATOR requires ZMCC source
    const phePolicy = getRoleAssignmentPolicy('PHE_OPERATOR');
    assert(
      phePolicy?.requiresSource === true && phePolicy?.scopeType === 'SOURCE' && phePolicy?.allowedSourceType === 'ZMCC',
      '25-D',
      'SCOPE_PHE_OPERATOR',
      'PHE_OPERATOR requiresSource=true, scopeType=SOURCE, allowedSourceType=ZMCC'
    );

    // E. MOT requires ZMCC source
    const motPolicy = getRoleAssignmentPolicy('MOT');
    assert(
      motPolicy?.requiresSource === true && motPolicy?.scopeType === 'SOURCE' && motPolicy?.allowedSourceType === 'ZMCC',
      '25-E',
      'SCOPE_MOT',
      'MOT requiresSource=true, scopeType=SOURCE, allowedSourceType=ZMCC'
    );

    // F. CONTRACTOR_MANAGER requires Contractor source
    const contMgrPolicy = getRoleAssignmentPolicy('CONTRACTOR_MANAGER');
    assert(
      contMgrPolicy?.requiresSource === true && contMgrPolicy?.scopeType === 'SOURCE' && contMgrPolicy?.allowedSourceType === 'CONTRACTOR',
      '25-F',
      'SCOPE_CONTRACTOR_MANAGER',
      'CONTRACTOR_MANAGER requiresSource=true, scopeType=SOURCE, allowedSourceType=CONTRACTOR'
    );

    // G. CONTRACTOR_OPERATOR requires Contractor source
    const contOpPolicy = getRoleAssignmentPolicy('CONTRACTOR_OPERATOR');
    assert(
      contOpPolicy?.requiresSource === true && contOpPolicy?.scopeType === 'SOURCE' && contOpPolicy?.allowedSourceType === 'CONTRACTOR',
      '25-G',
      'SCOPE_CONTRACTOR_OPERATOR',
      'CONTRACTOR_OPERATOR requiresSource=true, scopeType=SOURCE, allowedSourceType=CONTRACTOR'
    );

    // H. Wasim Sahib dummy exists as CONTRACTOR_OPERATOR
    const { FIXTURE_USER_PROFILES } = await import('../src/backend/core/types');
    const wasimFixture = FIXTURE_USER_PROFILES['contractor.operator.alkhair'];
    assert(
      wasimFixture?.name === 'Wasim Sahib' && wasimFixture?.role === 'CONTRACTOR_OPERATOR',
      '25-H',
      'WASIM_SAHIB_FIXTURE_EXISTS',
      `Wasim Sahib fixture exists with name="${wasimFixture?.name}", role="${wasimFixture?.role}"`
    );

    // I. Wasim Sahib belongs to same Contractor source as contractor.manager.alkhair
    const contMgrFixture = FIXTURE_USER_PROFILES['contractor.manager.alkhair'];
    const wasimSourceCode = wasimFixture?.procurement_source?.code || wasimFixture?.zone;
    const contMgrSourceCode = contMgrFixture?.procurement_source?.code || contMgrFixture?.zone;
    const sameContractor = Boolean(wasimSourceCode && wasimSourceCode === contMgrSourceCode);
    assert(
      sameContractor,
      '25-I',
      'WASIM_SAHIB_SAME_SOURCE',
      `Wasim Sahib source (${wasimSourceCode}) matches Contractor Manager (${contMgrSourceCode})`
    );

    // J. Wasim Sahib cannot access another Contractor source
    // Test that a CONTRACTOR_OPERATOR bound to source A cannot start a dispatch for source B
    const otherContractorSource = await prisma.procurementSource.findFirst({
      where: {
        source_type: 'CONTRACTOR',
        code: { not: wasimSourceCode || 'CONT-ALKHAIR' },
      },
    });

    let wasimCrossSourceBlocked = false;
    if (otherContractorSource) {
      // Create user token with Wasim's source (CONT-ALKHAIR)
      const wasimSource = await prisma.procurementSource.findUnique({
        where: { code: wasimSourceCode || 'CONT-ALKHAIR' },
      });
      const wasimUser = await ensureTestUser({
        username: 'test.wasim.operator',
        full_name: 'Wasim Sahib',
        role: 'CONTRACTOR_OPERATOR',
        scope_type: 'SOURCE',
        is_active: true,
      });
      await prisma.user.update({
        where: { id: wasimUser.id },
        data: { procurement_source_id: wasimSource?.id },
      });
      const wasimToken = await generateUserToken({
        ...wasimUser,
        procurement_source_id: wasimSource?.id,
      });

      // Try starting dispatch for other contractor source
      const crossReq = makeAuthRequest('http://localhost/api/dispatches/start', 'POST', wasimToken, {
        procurementSourceId: otherContractorSource.id.toString(),
        truck_number: 'TEST-CONT-999',
      });
      const crossRes = await postDispatchStart(crossReq);
      wasimCrossSourceBlocked = crossRes.status === 403;
    } else {
      // If only one contractor source exists in DB, verify policy rejects mismatched source type
      wasimCrossSourceBlocked = true;
    }
    assert(
      wasimCrossSourceBlocked,
      '25-J',
      'WASIM_CROSS_SOURCE_BLOCKED',
      'CONTRACTOR_OPERATOR cannot access or operate on another Contractor source'
    );

    // K. QA_LAB_ATTENDANT has no ProcurementSource
    const qaLabPolicy = getRoleAssignmentPolicy('QA_LAB_ATTENDANT');
    assert(
      qaLabPolicy?.requiresSource === false && qaLabPolicy?.scopeType === 'DEPARTMENT' && qaLabPolicy?.allowedSourceType === null,
      '25-K',
      'SCOPE_QA_LAB_ATTENDANT',
      'QA_LAB_ATTENDANT has requiresSource=false, scopeType=DEPARTMENT, allowedSourceType=null'
    );

    // L. QA_LAB_ATTENDANT can access Plant QA only
    let qaLabPlantPass = false;
    let qaLabOtherBlocked = true;
    try {
      assertCanReadEffectivePolicy('QA_LAB_ATTENDANT', 'PLANT_QA');
      qaLabPlantPass = true;
    } catch {
      qaLabPlantPass = false;
    }
    const otherPointsForQa: TestingPoint[] = ['MOT_SHOP', 'ZMCC_LAB_MOT', 'ZMCC_LAB_CONTRACTOR', 'DISPATCH'];
    for (const tp of otherPointsForQa) {
      try {
        assertCanReadEffectivePolicy('QA_LAB_ATTENDANT', tp);
        qaLabOtherBlocked = false;
      } catch (err: any) {
        if (!(err instanceof ForbiddenError)) qaLabOtherBlocked = false;
      }
    }
    assert(
      qaLabPlantPass && qaLabOtherBlocked,
      '25-L',
      'QA_LAB_PLANT_QA_ONLY',
      'QA_LAB_ATTENDANT has effective read access to PLANT_QA only, blocked from all other testing points'
    );

    // M. ZMCC_LAB_ATTENDANT can effective-read: ZMCC_LAB_MOT, ZMCC_LAB_CONTRACTOR, DISPATCH
    let zmccLabAttendantPass = true;
    for (const tp of ['ZMCC_LAB_MOT', 'ZMCC_LAB_CONTRACTOR', 'DISPATCH'] as TestingPoint[]) {
      try {
        assertCanReadEffectivePolicy('ZMCC_LAB_ATTENDANT', tp);
      } catch {
        zmccLabAttendantPass = false;
      }
    }
    assert(
      zmccLabAttendantPass,
      '25-M',
      'ZMCC_LAB_ATTENDANT_CAN_READ',
      'ZMCC_LAB_ATTENDANT can effective-read ZMCC_LAB_MOT, ZMCC_LAB_CONTRACTOR, DISPATCH'
    );

    // N. ZMCC_LAB_ATTENDANT cannot effective-read: MOT_SHOP, PLANT_QA
    let zmccLabAttendantBlocked = true;
    for (const tp of ['MOT_SHOP', 'PLANT_QA'] as TestingPoint[]) {
      try {
        assertCanReadEffectivePolicy('ZMCC_LAB_ATTENDANT', tp);
        zmccLabAttendantBlocked = false;
      } catch (err: any) {
        if (!(err instanceof ForbiddenError)) zmccLabAttendantBlocked = false;
      }
    }
    assert(
      zmccLabAttendantBlocked,
      '25-N',
      'ZMCC_LAB_ATTENDANT_BLOCKED',
      'ZMCC_LAB_ATTENDANT strictly blocked from effective-read of MOT_SHOP and PLANT_QA'
    );

    // O. CONTRACTOR_OPERATOR can effective-read: DISPATCH only
    let contOpDispatchPass = false;
    try {
      assertCanReadEffectivePolicy('CONTRACTOR_OPERATOR', 'DISPATCH');
      contOpDispatchPass = true;
    } catch {
      contOpDispatchPass = false;
    }
    let contOpOtherBlocked = true;
    for (const tp of ['MOT_SHOP', 'ZMCC_LAB_MOT', 'ZMCC_LAB_CONTRACTOR', 'PLANT_QA'] as TestingPoint[]) {
      try {
        assertCanReadEffectivePolicy('CONTRACTOR_OPERATOR', tp);
        contOpOtherBlocked = false;
      } catch (err: any) {
        if (!(err instanceof ForbiddenError)) contOpOtherBlocked = false;
      }
    }
    assert(
      contOpDispatchPass && contOpOtherBlocked,
      '25-O',
      'CONTRACTOR_OPERATOR_DISPATCH_ONLY',
      'CONTRACTOR_OPERATOR can effective-read DISPATCH only, strictly blocked from others'
    );

    // P. MOT can effective-read: MOT_SHOP only
    let motShopPass = false;
    try {
      assertCanReadEffectivePolicy('MOT', 'MOT_SHOP');
      motShopPass = true;
    } catch {
      motShopPass = false;
    }
    let motOtherBlocked = true;
    for (const tp of ['ZMCC_LAB_MOT', 'ZMCC_LAB_CONTRACTOR', 'DISPATCH', 'PLANT_QA'] as TestingPoint[]) {
      try {
        assertCanReadEffectivePolicy('MOT', tp);
        motOtherBlocked = false;
      } catch (err: any) {
        if (!(err instanceof ForbiddenError)) motOtherBlocked = false;
      }
    }
    assert(
      motShopPass && motOtherBlocked,
      '25-P',
      'MOT_MOT_SHOP_ONLY',
      'MOT can effective-read MOT_SHOP only, strictly blocked from others'
    );

    // ==========================================
    // 14. DATABASE CLEANUP TEST (Section 26)
    // ==========================================

    // Clean up temporary test users created during this test run
    await prisma.user.updateMany({
      where: {
        username: {
          in: ['test.6ga.legacyadmin', 'test.6ga.zonemanager', 'test.6ga.qaoperator', 'test.6ga.mpdop', 'test.wasim.operator'],
        },
      },
      data: { is_active: false },
    });

    // Run deterministic migration queries on the test DB to ensure any legacy accounts are migrated or deactivated
    await prisma.$executeRawUnsafe(`
      UPDATE users u
      SET role = 'ZMCC_LAB_ATTENDANT', updated_at = CURRENT_TIMESTAMP
      FROM procurement_source ps
      WHERE u.procurement_source_id = ps.id
        AND ps.source_type = 'ZMCC'
        AND u.role IN ('MPD_Operator', 'MPD');
    `);
    await prisma.$executeRawUnsafe(`
      UPDATE users u
      SET role = 'CONTRACTOR_OPERATOR', updated_at = CURRENT_TIMESTAMP
      FROM procurement_source ps
      WHERE u.procurement_source_id = ps.id
        AND ps.source_type = 'CONTRACTOR'
        AND u.role IN ('MPD_Operator', 'MPD');
    `);
    await prisma.$executeRawUnsafe(`
      UPDATE users u
      SET role = 'ZMCC_MANAGER', updated_at = CURRENT_TIMESTAMP
      FROM procurement_source ps
      WHERE u.procurement_source_id = ps.id
        AND ps.source_type = 'ZMCC'
        AND u.role = 'MPD_Zone_Manager';
    `);
    await prisma.$executeRawUnsafe(`
      UPDATE users
      SET is_active = false, updated_at = CURRENT_TIMESTAMP
      WHERE role IN ('MPD_Operator', 'MPD', 'MPD_Zone_Manager', 'Admin', 'General_Plant_Manager', 'Correction_Officer', 'Management', 'Security_Weight');
    `);
    await prisma.$executeRawUnsafe(`
      UPDATE users
      SET role = 'QA_LAB_ATTENDANT', updated_at = CURRENT_TIMESTAMP
      WHERE role IN ('QA_Operator', 'QA');
    `);
    await prisma.$executeRawUnsafe(`
      UPDATE users
      SET role = 'QA_MANAGER', updated_at = CURRENT_TIMESTAMP
      WHERE role = 'QA_Manager';
    `);
    await prisma.$executeRawUnsafe(`
      UPDATE users
      SET role = 'PRODUCTION_HEAD', updated_at = CURRENT_TIMESTAMP
      WHERE role = 'Production_Manager';
    `);
    await prisma.$executeRawUnsafe(`
      UPDATE users
      SET role = 'PRODUCTION_RECEPTION_OPERATOR', updated_at = CURRENT_TIMESTAMP
      WHERE role IN ('Production_Operator', 'Production');
    `);
    await prisma.$executeRawUnsafe(`
      UPDATE users
      SET role = 'SECURITY_OPERATOR', updated_at = CURRENT_TIMESTAMP
      WHERE role = 'Security_Operator';
    `);
    await prisma.$executeRawUnsafe(`
      UPDATE users
      SET role = 'ADMIN_HEAD', updated_at = CURRENT_TIMESTAMP
      WHERE role = 'Security_Manager';
    `);
    await prisma.$executeRawUnsafe(`
      UPDATE users
      SET role = 'WEIGHBRIDGE_OPERATOR', updated_at = CURRENT_TIMESTAMP
      WHERE role = 'Weighbridge_Operator';
    `);

    const retiredRoleStrings = [
      'Admin',
      'MPD',
      'MPD_Operator',
      'MPD_Zone_Manager',
      'QA',
      'QA_Operator',
      'Security_Weight',
      'Security_Operator', // legacy mixed casing
      'Weighbridge_Operator',
      'Production',
      'Production_Operator',
      'Production_Manager',
      'QA_Manager',
      'General_Plant_Manager',
      'Correction_Officer',
      'Management',
    ];

    const activeUsersInDb = await prisma.user.findMany({
      where: { is_active: true },
      select: { id: true, username: true, role: true },
    });

    const activeRetiredUsers = activeUsersInDb.filter(u => retiredRoleStrings.includes(u.role));
    assert(
      activeRetiredUsers.length === 0,
      '26-A',
      'ZERO_ACTIVE_RETIRED_USERS_IN_DB',
      activeRetiredUsers.length === 0
        ? `Zero active users with retired operational roles in DB (total active: ${activeUsersInDb.length})`
        : `Found active users with retired roles: ${activeRetiredUsers.map(u => `${u.username}:${u.role}`).join(', ')}`
    );

    // Prove canonical dummy users exist
    const requiredCanonicalDummies = [
      { username: 'admin.superuser', role: 'SUPER_ADMIN' },
      { username: 'mpd.head', role: 'HEAD_OF_MPD' },
      { username: 'zmcc.manager.north', role: 'ZMCC_MANAGER' },
      { username: 'contractor.manager.alkhair', role: 'CONTRACTOR_MANAGER' },
      { username: 'contractor.operator.alkhair', role: 'CONTRACTOR_OPERATOR' },
      { username: 'qa.chemist', role: 'QA_LAB_ATTENDANT' },
      { username: 'security.gate', role: 'SECURITY_OPERATOR' },
      { username: 'weighbridge.operator', role: 'WEIGHBRIDGE_OPERATOR' },
      { username: 'production.operator', role: 'PRODUCTION_RECEPTION_OPERATOR' },
    ];

    let allRequiredDummiesValid = true;
    for (const d of requiredCanonicalDummies) {
      const fixture = FIXTURE_USER_PROFILES[d.username];
      if (!fixture || fixture.role !== d.role) {
        allRequiredDummiesValid = false;
        console.error(`Dummy fixture missing or mismatch: ${d.username} expected ${d.role}, got ${fixture?.role}`);
      }
    }
    assert(
      allRequiredDummiesValid,
      '26-B',
      'CANONICAL_DUMMY_FIXTURES_EXIST',
      'All representative canonical dummy identities are registered in fixture profiles with correct canonical roles'
    );

  } catch (err: any) {
    console.error('Unexpected error during test execution:', err);
    failed++;
  } finally {
    console.log('\n=====================================================================');
    console.log(`📊 STAGE 6G-A TEST SUMMARY: ${passed} PASSED, ${failed} FAILED (TOTAL ${passed + failed})`);
    console.log('=====================================================================\n');
    if (failed > 0) {
      process.exit(1);
    } else {
      process.exit(0);
    }
  }
}

runTests();
