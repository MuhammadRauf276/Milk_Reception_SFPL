import '../helpers/testEnv';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { getTestPrisma, disconnectTestPrisma } from '../helpers/testPrisma';
import { clearTestDatabase, seedStandardTestLabCatalog, createTestZmccSource, createTestContractorSource } from '../fixtures/testFixtures';
import { POST as startDispatchPost } from '@/app/api/dispatches/start/route';
import {
  resolveSourceQuantityPolicy,
  updateSourceQuantityPolicy,
  getOrFreezeDispatchQuantityPolicy,
  DispatchQuantityPolicyInvalidError,
  SnapshotSourceMismatchError,
} from '@/backend/modules/dispatch/quantity-policy/quantityPolicyService';
import { DEFAULT_DISPATCH_QUANTITY_POLICY } from '@/backend/modules/dispatch/quantity-policy/types';
import { createSessionToken } from '@/backend/core/auth';

describe('Stage 4C-3A: Dispatch Quantity Policy Snapshot Hardening (Integration)', () => {
  const prisma = getTestPrisma();
  let zmccSource: any;
  let contractorSource: any;
  let operatorZmcc: any;
  let unscopedAdmin: any;

  beforeAll(async () => {
    await clearTestDatabase(prisma);
  });

  afterAll(async () => {
    await clearTestDatabase(prisma);
    await disconnectTestPrisma();
  });

  beforeEach(async () => {
    await clearTestDatabase(prisma);
    await seedStandardTestLabCatalog(prisma);

    zmccSource = await createTestZmccSource(prisma, 'ZMCC_QP_01');
    contractorSource = await createTestContractorSource(prisma, 'CONT_QP_01');

    operatorZmcc = await prisma.user.create({
      data: {
        username: `mpd_op_qp_${Date.now()}`,
        password_hash: 'hashed_pw_test',
        role: 'MPD_Operator',
        full_name: 'MPD QP Operator',
        is_active: true,
        procurement_source_id: zmccSource.id,
      },
      include: { procurement_source: true },
    });

    unscopedAdmin = await prisma.user.create({
      data: {
        username: `admin_qp_${Date.now()}`,
        password_hash: 'hashed_pw_test',
        role: 'SUPER_ADMIN',
        full_name: 'Super Admin QP',
        is_active: true,
      },
    });
  });

  const createMockRequest = async (user: any, body: any = {}) => {
    const token = await createSessionToken({
      id: user.id.toString(),
      username: user.username,
      name: user.full_name || 'Test User',
      role: user.role as any,
      department: 'MPD',
      procurement_source_id: user.procurement_source_id ? user.procurement_source_id.toString() : null,
    });

    return new Request('http://localhost:3000/api/dispatches/start', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
  };

  it('[TEST-A & I] Both ZMCC and Contractor sources resolve policy through the SAME engine and receive default', async () => {
    const zmccPolicy = await resolveSourceQuantityPolicy(prisma, zmccSource.id);
    const contractorPolicy = await resolveSourceQuantityPolicy(prisma, contractorSource.id);

    expect(zmccPolicy).toEqual(DEFAULT_DISPATCH_QUANTITY_POLICY);
    expect(contractorPolicy).toEqual(DEFAULT_DISPATCH_QUANTITY_POLICY);
  });

  it('[TEST-C] New draft creation freezes quantity policy snapshot in database', async () => {
    const req = await createMockRequest(operatorZmcc, {});
    const res = await startDispatchPost(req);
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.quantityPolicy).toBeDefined();
    expect(json.quantityPolicy.policyVersion).toBe(1);
    expect(json.quantityPolicy.policy.vehicleRules.default.unit).toBe('KG');
    expect(json.quantityPolicy.policy.vehicleRules.default.basis).toBe('ESTIMATED');
    expect(json.quantityPolicy.policy.vehicleRules.default.method).toBe('MANUAL_ESTIMATE');

    // Verify DB snapshot record
    const snapshot = await prisma.dispatchQuantityPolicySnapshot.findUnique({
      where: { visit_id: BigInt(json.visitId) },
    });
    expect(snapshot).toBeDefined();
    expect(snapshot?.source_id.toString()).toBe(zmccSource.id.toString());
    expect(snapshot?.policy_version).toBe(1);
  });

  it('[TEST-D] Draft reload returns identical frozen snapshot', async () => {
    // 1. Create initial draft
    const startReq1 = await createMockRequest(operatorZmcc, {});
    const res1 = await startDispatchPost(startReq1);
    const json1 = await res1.json();
    const draftVisitId = json1.visitId;

    // 2. Reload draft
    const startReq2 = await createMockRequest(operatorZmcc, { visitId: draftVisitId });
    const res2 = await startDispatchPost(startReq2);
    const json2 = await res2.json();

    expect(res2.status).toBe(200);
    expect(json2.visitId).toBe(draftVisitId);
    expect(json2.quantityPolicy).toBeDefined();
    expect(json2.quantityPolicy.policyVersion).toBe(json1.quantityPolicy.policyVersion);
    expect(json2.quantityPolicy.policy).toEqual(json1.quantityPolicy.policy);
  });

  it('[TEST-E & F] Policy mutation V1 -> V2 preserves Draft A on V1 and assigns V2 to new Draft B', async () => {
    // 1. Start Draft A under V1 default policy
    const reqA = await createMockRequest(operatorZmcc, {});
    const resA = await startDispatchPost(reqA);
    const jsonA = await resA.json();
    const draftAId = jsonA.visitId;
    expect(jsonA.quantityPolicy.policyVersion).toBe(1);
    expect(jsonA.quantityPolicy.policy.vehicleRules.default.unit).toBe('KG');

    // 2. Super Admin updates source quantity policy to V2 (default: LITER, MEASURED, FLOW_METER)
    const customPolicyV2 = {
      version: 2,
      vehicleRules: {
        allowedMeasurements: [
          { unit: 'KG', basis: 'MEASURED', methods: ['WEIGHING'] },
          { unit: 'LITER', basis: 'MEASURED', methods: ['FLOW_METER'] },
        ],
        default: {
          unit: 'LITER',
          basis: 'MEASURED',
          method: 'FLOW_METER',
        },
      },
      portionRules: {
        allowedMeasurements: [
          { unit: 'LITER', basis: 'MEASURED', methods: ['FLOW_METER'] },
        ],
        default: {
          unit: 'LITER',
          basis: 'MEASURED',
          method: 'FLOW_METER',
        },
      },
      allowSameUnitPortionPrefill: false,
    };

    await updateSourceQuantityPolicy(prisma, zmccSource.id, customPolicyV2);

    // 3. Reload Draft A -> must still return frozen V1
    const reloadReqA = await createMockRequest(operatorZmcc, { visitId: draftAId });
    const reloadResA = await startDispatchPost(reloadReqA);
    const reloadJsonA = await reloadResA.json();

    expect(reloadJsonA.quantityPolicy.policyVersion).toBe(1);
    expect(reloadJsonA.quantityPolicy.policy.vehicleRules.default.unit).toBe('KG');
    expect(reloadJsonA.quantityPolicy.policy.allowSameUnitPortionPrefill).toBe(true);

    // 4. Start Draft B -> must receive newly configured V2
    const reqB = await createMockRequest(operatorZmcc, {});
    const resB = await startDispatchPost(reqB);
    const jsonB = await resB.json();

    expect(jsonB.quantityPolicy.policyVersion).toBe(2);
    expect(jsonB.quantityPolicy.policy.vehicleRules.default.unit).toBe('LITER');
    expect(jsonB.quantityPolicy.policy.vehicleRules.default.method).toBe('FLOW_METER');
    expect(jsonB.quantityPolicy.policy.allowSameUnitPortionPrefill).toBe(false);
  });

  it('[TEST-F2] Source with malformed configured policy fails explicitly (DISPATCH_QUANTITY_POLICY_INVALID)', async () => {
    // 1. Corrupt source policy directly in DB (e.g. invalid json / missing default)
    await prisma.procurementSource.update({
      where: { id: zmccSource.id },
      data: {
        dispatch_quantity_policy: {
          version: 1,
          vehicleRules: {
            allowedMeasurements: [],
            default: { unit: 'KG', basis: 'ESTIMATED', method: 'MANUAL_ESTIMATE' },
          },
        } as any,
      },
    });

    // 2. Direct service call must throw DispatchQuantityPolicyInvalidError
    await expect(
      resolveSourceQuantityPolicy(prisma, zmccSource.id)
    ).rejects.toThrowError(DispatchQuantityPolicyInvalidError);

    // 3. /api/dispatches/start must return HTTP 400 with DISPATCH_QUANTITY_POLICY_INVALID
    const req = await createMockRequest(operatorZmcc, {});
    const res = await startDispatchPost(req);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.code).toBe('DISPATCH_QUANTITY_POLICY_INVALID');
    expect(json.error).toBe('Configured dispatch quantity policy for this procurement source is invalid.');
  });

  it('[TEST-G] Snapshot source protection rejects existing snapshot with wrong source', async () => {
    // 1. Create a visit under zmccSource
    const req = await createMockRequest(operatorZmcc, {});
    const res = await startDispatchPost(req);
    const json = await res.json();
    const visitId = BigInt(json.visitId);

    // 2. Calling getOrFreezeDispatchQuantityPolicy for the same visit but supplying contractorSource.id must fail
    await expect(
      getOrFreezeDispatchQuantityPolicy(prisma, visitId, contractorSource.id)
    ).rejects.toThrow();
  });

  it('[TEST-H] Lab assignment count is independent from quantity policy snapshotting', async () => {
    const req = await createMockRequest(operatorZmcc, {});
    const res = await startDispatchPost(req);
    const json = await res.json();

    expect(json.assignedTests).toBeDefined();
    expect(json.assignedTests.length).toBeGreaterThan(0);
    expect(json.quantityPolicy).toBeDefined();
  });
});

