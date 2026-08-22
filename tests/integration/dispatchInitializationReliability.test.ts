import '../helpers/testEnv';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { getTestPrisma, disconnectTestPrisma } from '../helpers/testPrisma';
import { clearTestDatabase, seedStandardTestLabCatalog, createTestZmccSource, createTestContractorSource } from '../fixtures/testFixtures';
import { POST as startDispatchPost } from '@/app/api/dispatches/start/route';
import { POST as createDispatchPost } from '@/app/api/dispatches/route';
import { getOrAssignDispatchTests, serializeAssignment } from '@/backend/services/labTestAssignmentService';

import { createSessionToken } from '@/backend/core/auth';

describe('Stage 4C-2: Dispatch Initialization Reliability (Integration)', () => {
  const prisma = getTestPrisma();
  let sourceA: any;
  let sourceB: any;
  let boundOperatorA: any;
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

    sourceA = await createTestZmccSource(prisma, 'ZMCC_INIT_A');
    sourceB = await createTestContractorSource(prisma, 'CONT_INIT_B');

    // Create a source-bound operator for Source A
    boundOperatorA = await prisma.user.create({
      data: {
        username: `mpd_op_${Date.now()}_a`,
        password_hash: 'hashed_pw_test',
        role: 'MPD_Operator',
        full_name: 'MPD Bound Operator A',
        is_active: true,
        procurement_source_id: sourceA.id,
      },
      include: { procurement_source: true },
    });

    // Create an unscoped Super Admin
    unscopedAdmin = await prisma.user.create({
      data: {
        username: `admin_${Date.now()}_b`,
        password_hash: 'hashed_pw_test',
        role: 'SUPER_ADMIN',
        full_name: 'Unscoped Admin',
        is_active: true,
      },
    });
  });

  // Helper to create mock authenticated Request with genuine JWT Bearer token
  const createMockRequest = async (user: any, body: any = {}) => {

    const token = await createSessionToken({
      id: user.id.toString(),
      username: user.username,
      name: user.full_name || 'Test User',
      role: user.role,
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


  it('[TEST-A] Source-bound operator + no body source -> bound source is authoritatively used', async () => {
    const req = await createMockRequest(boundOperatorA, {});
    const res = await startDispatchPost(req);
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.success).toBe(true);
    expect(json.visitId).toBeDefined();

    // Verify DB record
    const visit = await prisma.vehicleVisit.findUnique({
      where: { id: BigInt(json.visitId) },
    });
    expect(visit).toBeDefined();
    expect(visit?.procurement_source_id?.toString()).toBe(sourceA.id.toString());
    expect(visit?.current_status).toBe('DRAFT_DISPATCH');
  });

  it('[TEST-B] Source-bound operator + foreign source -> strictly rejected (403 FORBIDDEN_SOURCE)', async () => {
    const req = await createMockRequest(boundOperatorA, {
      procurementSourceId: sourceB.id.toString(),
    });
    const res = await startDispatchPost(req);
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.code).toBe('FORBIDDEN_SOURCE');
  });

  it('[TEST-C] Unscoped admin + no explicit source -> rejected (400 PROCUREMENT_SOURCE_REQUIRED, no first-active fallback)', async () => {
    const req = await createMockRequest(unscopedAdmin, {});
    const res = await startDispatchPost(req);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.code).toBe('PROCUREMENT_SOURCE_REQUIRED');
  });

  it('[TEST-D] Explicit valid source supplied by unscoped admin -> accepted', async () => {
    const req = await createMockRequest(unscopedAdmin, {
      procurementSourceId: sourceB.id.toString(),
    });
    const res = await startDispatchPost(req);
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.success).toBe(true);

    const visit = await prisma.vehicleVisit.findUnique({
      where: { id: BigInt(json.visitId) },
    });
    expect(visit?.procurement_source_id?.toString()).toBe(sourceB.id.toString());
  });

  it('[TEST-E] Existing valid draft + same user/source -> reused idempotently without duplicating visit', async () => {
    // 1. Create initial draft
    const startReq1 = await createMockRequest(boundOperatorA, {});
    const res1 = await startDispatchPost(startReq1);
    const json1 = await res1.json();
    const draftVisitId = json1.visitId;

    // 2. Start request with existing visitId
    const startReq2 = await createMockRequest(boundOperatorA, { visitId: draftVisitId });
    const res2 = await startDispatchPost(startReq2);
    const json2 = await res2.json();

    expect(res2.status).toBe(200);
    expect(json2.visitId).toBe(draftVisitId);
    expect(json2.visitNumber).toBe(json1.visitNumber);
  });

  it('[TEST-F] Existing draft + wrong source -> rejected (403 FORBIDDEN_SOURCE / 400 DRAFT_SOURCE_MISMATCH)', async () => {
    // Unscoped admin creates draft under Source A
    const startReq = await createMockRequest(unscopedAdmin, {
      procurementSourceId: sourceA.id.toString(),
    });
    const res = await startDispatchPost(startReq);
    const json = await res.json();
    const draftVisitId = json.visitId;

    // Same admin attempts to load draft A while selecting Source B
    const adminReq = await createMockRequest(unscopedAdmin, {
      visitId: draftVisitId,
      procurementSourceId: sourceB.id.toString(),
    });
    const adminRes = await startDispatchPost(adminReq);
    const adminJson = await adminRes.json();

    expect(adminRes.status).toBe(400);
    expect(adminJson.code).toBe('DRAFT_SOURCE_MISMATCH');
  });


  it('[TEST-G] Draft in progressed/non-draft state (DISPATCHED) -> not reused (400 DRAFT_ALREADY_PROGRESSED)', async () => {
    // Create draft
    const startReq = await createMockRequest(boundOperatorA, {});
    const res = await startDispatchPost(startReq);
    const json = await res.json();
    const draftVisitId = json.visitId;

    // Progress the visit to DISPATCHED
    await prisma.vehicleVisit.update({
      where: { id: BigInt(draftVisitId) },
      data: { current_status: 'DISPATCHED' },
    });

    // Attempt to re-open via start endpoint
    const reloadReq = await createMockRequest(boundOperatorA, { visitId: draftVisitId });
    const reloadRes = await startDispatchPost(reloadReq);
    const reloadJson = await reloadRes.json();

    expect(reloadRes.status).toBe(400);
    expect(reloadJson.code).toBe('DRAFT_ALREADY_PROGRESSED');
  });

  it('[TEST-H] Lab assignment count remains unchanged on draft reload', async () => {
    const startReq1 = await createMockRequest(boundOperatorA, {});
    const res1 = await startDispatchPost(startReq1);
    const json1 = await res1.json();
    const initialTestCount = json1.assignedTests.length;

    // Add another master test in the background
    await prisma.labTest.create({
      data: {
        testCode: 'LT-000095',
        testName: 'Post Draft Addition Test',
        testScope: 'DISPATCH',
        resultType: 'NUMERIC',
        isRequired: true,
        displayOrder: 95,
        isActive: true,
      },
    });

    // Reload the existing draft
    const startReq2 = await createMockRequest(boundOperatorA, { visitId: json1.visitId });
    const res2 = await startDispatchPost(startReq2);
    const json2 = await res2.json();

    expect(json2.assignedTests.length).toBe(initialTestCount);
    expect(json2.assignedTests.some((t: any) => t.testCode === 'LT-000095')).toBe(false);
  });


  it('[TEST-I] Same-source different-operator draft cannot be hijacked (403 DRAFT_OWNER_MISMATCH)', async () => {


    // 1. Create a second operator also bound to Source A
    const boundOperatorA2 = await prisma.user.create({
      data: {
        username: `mpd_op2_${Date.now()}_a2`,
        password_hash: 'hashed_pw_test',
        role: 'MPD_Operator',
        full_name: 'MPD Bound Operator A2',
        is_active: true,
        procurement_source_id: sourceA.id,
      },
    });

    // 2. Operator A creates a draft
    const startReq1 = await createMockRequest(boundOperatorA, {});
    const res1 = await startDispatchPost(startReq1);
    const json1 = await res1.json();
    const draftVisitId = json1.visitId;

    // 3. Operator A2 attempts to load Operator A's draft
    const startReq2 = await createMockRequest(boundOperatorA2, { visitId: draftVisitId });
    const res2 = await startDispatchPost(startReq2);
    const json2 = await res2.json();

    expect(res2.status).toBe(403);
    expect(json2.code).toBe('DRAFT_OWNER_MISMATCH');
  });

  it('[TEST-J] Final submission POST /api/dispatches rejects draft created by another user (403 DRAFT_OWNER_MISMATCH)', async () => {
    const boundOperatorA2 = await prisma.user.create({
      data: {
        username: `mpd_op3_${Date.now()}_a3`,
        password_hash: 'hashed_pw_test',
        role: 'MPD_Operator',
        full_name: 'MPD Bound Operator A3',
        is_active: true,
        procurement_source_id: sourceA.id,
      },
    });

    // Operator A creates draft
    const startReq = await createMockRequest(boundOperatorA, {});
    const startRes = await startDispatchPost(startReq);
    const startJson = await startRes.json();
    const draftVisitId = startJson.visitId;

    // Operator A2 attempts to submit Operator A's draft
    const token = await createSessionToken({
      id: boundOperatorA2.id.toString(),
      username: boundOperatorA2.username,
      name: boundOperatorA2.full_name || 'Operator A2',
      role: boundOperatorA2.role as any,
      department: 'MPD',

      procurement_source_id: sourceA.id.toString(),
    });

    const submitReq = new Request('http://localhost:3000/api/dispatches', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        visitId: draftVisitId,
        vehicleNumber: 'KBL-9999',
        operationalDate: '2026-08-22',
        procurementSourceId: sourceA.id.toString(),
        vehicleQuantity: {
          value: '5000',
          unit: 'KG',
          basis: 'MEASURED',
          method: 'WEIGHING',
        },
        portions: [
          {
            portionNumber: 1,
            quantity: {
              value: '5000',
              unit: 'KG',
              basis: 'MEASURED',
              method: 'WEIGHING',
            },
            results: [],
          },
        ],
      }),
    });

    const submitRes = await createDispatchPost(submitReq);
    const submitJson = await submitRes.json();

    expect(submitRes.status).toBe(403);
    expect(submitJson.code).toBe('DRAFT_OWNER_MISMATCH');
  });

  it('[TEST-K] Final submission POST /api/dispatches rejects draft with mismatched procurement source (400 DRAFT_SOURCE_MISMATCH)', async () => {
    // Unscoped admin creates draft under Source A
    const startReq = await createMockRequest(unscopedAdmin, { procurementSourceId: sourceA.id.toString() });
    const startRes = await startDispatchPost(startReq);
    const startJson = await startRes.json();
    const draftVisitId = startJson.visitId;

    // Admin attempts to submit that draft under Source B
    const token = await createSessionToken({
      id: unscopedAdmin.id.toString(),
      username: unscopedAdmin.username,
      name: unscopedAdmin.full_name || 'Admin',
      role: unscopedAdmin.role,
      department: 'MPD',
    });

    const submitReq = new Request('http://localhost:3000/api/dispatches', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        visitId: draftVisitId,
        vehicleNumber: 'KBL-8888',
        operationalDate: '2026-08-22',
        procurementSourceId: sourceB.id.toString(),
        vehicleQuantity: {
          value: '5000',
          unit: 'KG',
          basis: 'MEASURED',
          method: 'WEIGHING',
        },
        portions: [
          {
            portionNumber: 1,
            quantity: {
              value: '5000',
              unit: 'KG',
              basis: 'MEASURED',
              method: 'WEIGHING',
            },
            results: [],
          },
        ],
      }),
    });

    const submitRes = await createDispatchPost(submitReq);
    const submitJson = await submitRes.json();

    expect(submitRes.status).toBe(400);
    expect(submitJson.code).toBe('DRAFT_SOURCE_MISMATCH');
  });

  it('[TEST-L] Final submission POST /api/dispatches with valid creator and source succeeds', async () => {
    // Operator A creates draft
    const startReq = await createMockRequest(boundOperatorA, {});
    const startRes = await startDispatchPost(startReq);
    const startJson = await startRes.json();
    const draftVisitId = startJson.visitId;

    const token = await createSessionToken({
      id: boundOperatorA.id.toString(),
      username: boundOperatorA.username,
      name: boundOperatorA.full_name || 'Operator A',
      role: boundOperatorA.role,
      department: 'MPD',
      procurement_source_id: sourceA.id.toString(),
    });

    const portionResults = (startJson.assignedTests || []).map((t: any) => ({
      testId: t.testId,
      numericValue: t.resultType === 'NUMERIC' ? (t.testCode.includes('000008') ? 28.0 : 4.0) : null,
      textValue: t.resultType !== 'NUMERIC' ? (t.resultOptions?.[0]?.value || (t.resultType === 'POSITIVE_NEGATIVE' ? 'NEGATIVE' : 'OK')) : null,
      performanceStatus: 'PERFORMED',
    }));

    const submitReq = new Request('http://localhost:3000/api/dispatches', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        visitId: draftVisitId,
        vehicleNumber: 'KBL-7777',
        operationalDate: '2026-08-22',
        procurementSourceId: sourceA.id.toString(),
        vehicleQuantity: {
          value: '6000',
          unit: 'KG',
          basis: 'MEASURED',
          method: 'WEIGHING',
        },
        portions: [
          {
            portionNumber: 1,
            quantity: {
              value: '6000',
              unit: 'KG',
              basis: 'MEASURED',
              method: 'WEIGHING',
            },
            results: portionResults,
          },
        ],
      }),
    });

    const submitRes = await createDispatchPost(submitReq);
    const submitJson = await submitRes.json();

    expect(submitRes.status).toBe(201);
    expect(submitJson.success).toBe(true);

    const visit = await prisma.vehicleVisit.findUnique({
      where: { id: BigInt(draftVisitId) },
    });
    expect(visit?.current_status).toBe('DISPATCHED');
  });
});



