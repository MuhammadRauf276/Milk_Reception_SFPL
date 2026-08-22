import '../helpers/testEnv';
import { describe, it, expect, beforeEach, afterAll, beforeAll } from 'vitest';
import { getTestPrisma, disconnectTestPrisma } from '../helpers/testPrisma';
import { POST as startDispatchPost } from '@/app/api/dispatches/start/route';
import { POST as createDispatchPost, GET as getDispatches } from '@/app/api/dispatches/route';
import { createSessionToken } from '@/backend/core/auth';
import { clearTestDatabase, seedStandardTestLabCatalog } from '../fixtures/testFixtures';

describe('Stage 4C-4: Dispatch Quantity Capture & Persistence (Integration)', () => {
  const prisma = getTestPrisma();
  let testOperator: any;
  let testSource: any;
  let testAdmin: any;

  beforeAll(async () => {
    await clearTestDatabase(prisma);
  });

  beforeEach(async () => {
    await clearTestDatabase(prisma);
    await seedStandardTestLabCatalog(prisma);

    const uid = Date.now();
    testSource = await prisma.procurementSource.create({
      data: {
        name: `Source QTY ${uid}`,
        code: `SRC_QTY_${uid}`,
        source_type: 'ZMCC',
        is_active: true,
        dispatch_quantity_policy: {
          version: 1,
          vehicleRules: {
            allowedMeasurements: [
              { unit: 'KG', basis: 'MEASURED', methods: ['WEIGHING'] },
              { unit: 'LITER', basis: 'MEASURED', methods: ['FLOW_METER'] },
            ],
            default: { unit: 'KG', basis: 'MEASURED', method: 'WEIGHING' },
          },
          portionRules: {
            allowedMeasurements: [
              { unit: 'KG', basis: 'MEASURED', methods: ['WEIGHING'] },
              { unit: 'LITER', basis: 'ESTIMATED', methods: ['MANUAL_ESTIMATE', 'FLOW_METER'] },
            ],
            default: { unit: 'LITER', basis: 'ESTIMATED', method: 'MANUAL_ESTIMATE' },
          },
          allowSameUnitPortionPrefill: false,
        },
      },
    });

    testOperator = await prisma.user.create({
      data: {
        username: `op_qty_${uid}`,
        password_hash: 'hash',
        role: 'MPD_Operator',
        department: 'MPD',
        is_active: true,
        procurement_source_id: testSource.id,
      },
      include: { procurement_source: true },
    });

    testAdmin = await prisma.user.create({
      data: {
        username: `admin_qty_${uid}`,
        password_hash: 'hash',
        role: 'SUPER_ADMIN',
        department: 'MANAGEMENT',
        is_active: true,
      },
    });
  });

  afterAll(async () => {
    await clearTestDatabase(prisma);
    await disconnectTestPrisma();
  });

  it('[TEST-M]: Atomically persists VehicleVisit, DispatchInfo, VisitPortions with independent vehicle and portion facts', async () => {
    // 1. Start draft
    const token = await createSessionToken({
      id: testOperator.id.toString(),
      username: testOperator.username,
      name: testOperator.username,
      role: testOperator.role,
      department: 'MPD',
      procurement_source_id: testSource.id.toString(),
    });

    const startReq = new Request('http://localhost:3000/api/dispatches/start', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({}),
    });

    const startRes = await startDispatchPost(startReq);
    const startJson = await startRes.json();
    expect(startRes.status).toBe(201);
    const draftVisitId = startJson.visitId;
    expect(draftVisitId).toBeDefined();

    // 2. Submit dispatch with Vehicle = KG MEASURED WEIGHING (19,500), Portion 1 = LITER ESTIMATED MANUAL_ESTIMATE (9,800), Portion 2 = LITER ESTIMATED MANUAL_ESTIMATE (9,150)
    const assignedTests = startJson.assignedTests || [];
    const makeResults = () =>
      assignedTests.map((t: any) => ({
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
        vehicleNumber: 'KBL-4C40',
        operationalDate: '2026-08-22',
        procurementSourceId: testSource.id.toString(),
        vehicleQuantity: {
          value: '19500.00',
          unit: 'KG',
          basis: 'MEASURED',
          method: 'WEIGHING',
        },
        portions: [
          {
            portionNumber: 1,
            quantity: {
              value: '9800.00',
              unit: 'LITER',
              basis: 'ESTIMATED',
              method: 'MANUAL_ESTIMATE',
            },
            results: makeResults(),
          },
          {
            portionNumber: 2,
            quantity: {
              value: '9150.00',
              unit: 'LITER',
              basis: 'ESTIMATED',
              method: 'MANUAL_ESTIMATE',
            },
            results: makeResults(),
          },
        ],
      }),
    });

    const submitRes = await createDispatchPost(submitReq);
    const submitJson = await submitRes.json();
    expect(submitRes.status).toBe(201);
    expect(submitJson.success).toBe(true);

    // 3. Database verification
    const savedVisit = await prisma.vehicleVisit.findUnique({
      where: { id: BigInt(draftVisitId) },
      include: {
        portions: {
          include: { dispatch_info: true, dispatch_lab_results: true },
          orderBy: { portion_number: 'asc' },
        },
      },
    });

    expect(savedVisit).toBeDefined();
    expect(savedVisit?.current_status).toBe('DISPATCHED');

    // Vehicle facts on VehicleVisit
    expect(Number(savedVisit?.vehicle_dispatch_quantity_value)).toBe(19500);
    expect(savedVisit?.vehicle_dispatch_quantity_unit).toBe('KG');
    expect(savedVisit?.vehicle_dispatch_quantity_basis).toBe('MEASURED');
    expect(savedVisit?.vehicle_dispatch_measurement_method).toBe('WEIGHING');

    // Portion facts in VisitPortions
    expect(savedVisit?.portions.length).toBe(2);
    expect(Number(savedVisit?.portions[0].dispatch_quantity_value)).toBe(9800);
    expect(savedVisit?.portions[0].dispatch_quantity_unit).toBe('LITER');
    expect(savedVisit?.portions[0].dispatch_quantity_basis).toBe('ESTIMATED');
    expect(savedVisit?.portions[0].dispatch_measurement_method).toBe('MANUAL_ESTIMATE');

    expect(Number(savedVisit?.portions[1].dispatch_quantity_value)).toBe(9150);
    expect(savedVisit?.portions[1].dispatch_quantity_unit).toBe('LITER');
    expect(savedVisit?.portions[1].dispatch_quantity_basis).toBe('ESTIMATED');
    expect(savedVisit?.portions[1].dispatch_measurement_method).toBe('MANUAL_ESTIMATE');
  });

  it('Rejects submission when vehicle measurement combination is not permitted by frozen policy', async () => {
    const token = await createSessionToken({
      id: testOperator.id.toString(),
      username: testOperator.username,
      name: testOperator.username,
      role: testOperator.role,
      department: 'MPD',
      procurement_source_id: testSource.id.toString(),
    });

    const startReq = new Request('http://localhost:3000/api/dispatches/start', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({}),
    });

    const startRes = await startDispatchPost(startReq);
    const startJson = await startRes.json();
    expect(startRes.status).toBe(201);
    const draftVisitId = startJson.visitId;

    const assignedTests = startJson.assignedTests || [];
    const makeResults = () =>
      assignedTests.map((t: any) => ({
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
        vehicleNumber: 'KBL-4C41',
        operationalDate: '2026-08-22',
        procurementSourceId: testSource.id.toString(),
        vehicleQuantity: {
          value: '19500.00',
          unit: 'KG',
          basis: 'ESTIMATED', // Not in vehicleRules
          method: 'MANUAL_ESTIMATE',
        },
        portions: [
          {
            portionNumber: 1,
            quantity: {
              value: '9800.00',
              unit: 'KG',
              basis: 'MEASURED',
              method: 'WEIGHING',
            },
            results: makeResults(),
          },
        ],
      }),
    });

    const submitRes = await createDispatchPost(submitReq);
    expect(submitRes.status).toBe(400);
  });
});
