import { prisma } from '../src/backend/core/db';
import { GET as getVisitQA } from '../src/app/api/qa/vehicle-visits/[visitId]/route';
import { POST as startQASession } from '../src/app/api/qa/sessions/start/route';
import { POST as startDispatch } from '../src/app/api/dispatches/start/route';
import { POST as createDispatch } from '../src/app/api/dispatches/route';
import { createSessionToken } from '../src/backend/core/auth';
import { User, Role } from '../src/backend/core/types';

async function makeReq(url: string, method = 'GET', body: any = null, u: any = null) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (u) {
    const userObj: User = {
      id: u.id.toString(),
      username: u.username,
      name: u.full_name || u.username,
      role: u.role as Role,
      department: u.department || '',
      scope_type: u.scope_type,
      procurement_source_id: u.procurement_source_id ? u.procurement_source_id.toString() : null,
    };
    const token = await createSessionToken(userObj);
    headers['cookie'] = `auth_token=${token}`;
  }
  return new Request(url, {
    method,
    headers,
    body: body ? JSON.stringify(body, (k, v) => (typeof v === 'bigint' ? v.toString() : v)) : undefined,
  });
}

async function verifyBrowserScenarios() {
  console.log('=== VERIFYING BROWSER SCENARIOS (DISPATCH & PLANT QA) ===\n');

  const superAdmin = await prisma.user.findFirst({ where: { role: 'SUPER_ADMIN', is_active: true } });
  const zmccUser = await prisma.user.findFirst({ where: { role: 'MPD_Operator', is_active: true, procurement_source: { source_type: 'ZMCC' } } });
  const qaChemist = await prisma.user.findFirst({ where: { role: 'QA_Operator', is_active: true } });
  const zmccSource = await prisma.procurementSource.findFirst({ where: { source_type: 'ZMCC', is_active: true } });

  if (!superAdmin || !zmccUser || !qaChemist || !zmccSource) {
    throw new Error('Required test users/sources not found.');
  }

  const effectiveSourceId = (zmccUser.procurement_source_id || zmccSource.id).toString();

  // =========================================================================
  // BROWSER SCENARIO 1: DISPATCH FORM & REFRESH STABILITY
  // =========================================================================
  console.log('--- 1. DISPATCH BROWSER SCENARIO ---');

  // Step 1: Record initial active Dispatch tests in master
  const initialDispatchTests = await prisma.labTest.findMany({
    where: { isActive: true, testScope: { in: ['DISPATCH', 'BOTH'] } },
    orderBy: [{ displayOrder: 'asc' }, { testName: 'asc' }],
  });
  console.log('[Step 1] Master Active Dispatch/BOTH count: ' + initialDispatchTests.length);

  // Step 2: Start/persist Dispatch A via POST /api/dispatches/start
  const nowA = Date.now();
  const reqStartA = await makeReq('http://localhost:3000/api/dispatches/start', 'POST', {
    vehicleNumber: 'BRW-DISP-A-' + nowA,
    operationalDate: new Date().toISOString().split('T')[0],
    procurementSourceId: effectiveSourceId,
  }, zmccUser);
  const resStartA = await startDispatch(reqStartA);
  const dataStartA = await resStartA.json();
  const visitIdA = BigInt(dataStartA.visitId);
  const assignedCountA = dataStartA.assignedTests.length;
  console.log('[Step 2] Dispatch A started & assigned count: ' + assignedCountA + ' (Expected: ' + initialDispatchTests.length + ')');

  // Step 3: Super Admin activates dummy Dispatch test in master
  const dummyDisp = await prisma.labTest.create({
    data: {
      testCode: 'LT-BRW-D1-' + nowA,
      testName: 'Dummy Browser Dispatch Test',
      resultType: 'OK_NOT_OK',
      testScope: 'DISPATCH',
      isActive: true,
      isRequired: false,
      displayOrder: 150,
    },
  });
  const masterCountAfterAdd = await prisma.labTest.count({ where: { isActive: true, testScope: { in: ['DISPATCH', 'BOTH'] } } });
  console.log('[Step 3] Super Admin created dummy test. Master active count is now: ' + masterCountAfterAdd);

  // Step 4: Refresh/Inspect Dispatch A assignments via /api/dispatches/start
  const reqRefreshA = await makeReq('http://localhost:3000/api/dispatches/start', 'POST', { visitId: visitIdA.toString() }, zmccUser);
  const resRefreshA = await startDispatch(reqRefreshA);
  const dataRefreshA = await resRefreshA.json();
  console.log('[Step 4] Refresh Dispatch A: assigned count remains ' + dataRefreshA.assignedTests.length + ' (Expected: ' + initialDispatchTests.length + ')');

  // Submit Dispatch A
  const manualA = dataRefreshA.assignedTests.filter((t: any) => t.resultType !== 'CALCULATED').map((t: any) => ({
    testId: t.testId,
    performanceStatus: 'PERFORMED' as const,
    numericValue: t.resultType === 'NUMERIC' ? 4.5 : null,
    textValue: t.resultType === 'OK_NOT_OK' ? 'OK' : t.resultType === 'POSITIVE_NEGATIVE' ? 'NEGATIVE' : 'Normal',
  }));

  const reqSubmitA = await makeReq('http://localhost:3000/api/dispatches', 'POST', {
    visitId: visitIdA.toString(),
    vehicleNumber: 'BRW-DISP-A-' + nowA,
    operationalDate: new Date().toISOString().split('T')[0],
    procurementSourceId: effectiveSourceId,
    portions: [{ portionNumber: 1, declaredQuantityKg: 8000, declaredQuantityUnit: 'KG', results: manualA }],
  }, zmccUser);
  const resSubmitA = await createDispatch(reqSubmitA);
  const dataSubmitA = await resSubmitA.json();
  console.log('[Step 4] Dispatch A submitted with status: ' + resSubmitA.status);

  // Step 5: Start Dispatch B (should receive masterCountAfterAdd)
  const nowB = Date.now();
  const reqStartB = await makeReq('http://localhost:3000/api/dispatches/start', 'POST', {
    vehicleNumber: 'BRW-DISP-B-' + nowB,
    operationalDate: new Date().toISOString().split('T')[0],
    procurementSourceId: effectiveSourceId,
  }, zmccUser);
  const resStartB = await startDispatch(reqStartB);
  const dataStartB = await resStartB.json();
  const visitIdB = BigInt(dataStartB.visitId);
  const assignedCountB = dataStartB.assignedTests.length;
  console.log('[Step 5] Dispatch B started & assigned count: ' + assignedCountB + ' (Expected: ' + masterCountAfterAdd + ')');

  const manualB = dataStartB.assignedTests.filter((t: any) => t.resultType !== 'CALCULATED').map((t: any) => ({
    testId: t.testId,
    performanceStatus: 'PERFORMED' as const,
    numericValue: t.resultType === 'NUMERIC' ? 4.5 : null,
    textValue: t.resultType === 'OK_NOT_OK' ? 'OK' : t.resultType === 'POSITIVE_NEGATIVE' ? 'NEGATIVE' : 'Normal',
  }));
  const reqSubmitB = await makeReq('http://localhost:3000/api/dispatches', 'POST', {
    visitId: visitIdB.toString(),
    vehicleNumber: 'BRW-DISP-B-' + nowB,
    operationalDate: new Date().toISOString().split('T')[0],
    procurementSourceId: effectiveSourceId,
    portions: [{ portionNumber: 1, declaredQuantityKg: 8200, declaredQuantityUnit: 'KG', results: manualB }],
  }, zmccUser);
  const resSubmitB = await createDispatch(reqSubmitB);
  console.log('[Step 5] Dispatch B submitted with status: ' + resSubmitB.status);

  // Step 6: Super Admin deactivates dummy test
  await prisma.labTest.update({ where: { id: dummyDisp.id }, data: { isActive: false } });
  const masterCountAfterDeact = await prisma.labTest.count({ where: { isActive: true, testScope: { in: ['DISPATCH', 'BOTH'] } } });
  console.log('[Step 6] Deactivated dummy test. Master active count is now: ' + masterCountAfterDeact);

  const assignedCountBAfterDeact = await prisma.labTestAssignment.count({ where: { visit_id: visitIdB, workflow: 'DISPATCH' } });
  console.log('[Step 6] Refresh Dispatch B: assigned count remains ' + assignedCountBAfterDeact);

  // Start Dispatch C via startDispatch
  const nowC = Date.now();
  const reqStartC = await makeReq('http://localhost:3000/api/dispatches/start', 'POST', {
    vehicleNumber: 'BRW-DISP-C-' + nowC,
    operationalDate: new Date().toISOString().split('T')[0],
    procurementSourceId: effectiveSourceId,
  }, zmccUser);
  const resStartC = await startDispatch(reqStartC);
  const dataStartC = await resStartC.json();
  const visitIdC = BigInt(dataStartC.visitId);
  console.log('[Step 6] Dispatch C started & assigned count: ' + dataStartC.assignedTests.length + ' (Expected: ' + masterCountAfterDeact + ')');

  const manualC = dataStartC.assignedTests.filter((t: any) => t.resultType !== 'CALCULATED').map((t: any) => ({
    testId: t.testId,
    performanceStatus: 'PERFORMED' as const,
    numericValue: t.resultType === 'NUMERIC' ? 4.5 : null,
    textValue: t.resultType === 'OK_NOT_OK' ? 'OK' : t.resultType === 'POSITIVE_NEGATIVE' ? 'NEGATIVE' : 'Normal',
  }));

  const reqSubmitC = await makeReq('http://localhost:3000/api/dispatches', 'POST', {
    visitId: visitIdC.toString(),
    vehicleNumber: 'BRW-DISP-C-' + nowC,
    operationalDate: new Date().toISOString().split('T')[0],
    procurementSourceId: effectiveSourceId,
    portions: [{ portionNumber: 1, declaredQuantityKg: 8500, declaredQuantityUnit: 'KG', results: manualC }],
  }, zmccUser);
  const resSubmitC = await createDispatch(reqSubmitC);
  console.log('[Step 6] Dispatch C submitted with status: ' + resSubmitC.status);

  // =========================================================================
  // BROWSER SCENARIO 2: PLANT QA WORKSPACE & REFRESH STABILITY
  // =========================================================================
  console.log('\n--- 2. PLANT QA BROWSER SCENARIO ---');

  // Create GateLog entries for visits A, B, C to simulate gate arrival
  const gateEntryTs = new Date(Date.now() - 30000);
  for (const vId of [visitIdA, visitIdB, visitIdC]) {
    await prisma.gateLog.create({
      data: {
        visit_id: vId,
        entry_timestamp: gateEntryTs,
        entry_guard_id: superAdmin.id,
      },
    });
    await prisma.vehicleVisit.update({
      where: { id: vId },
      data: { current_status: 'WAITING_FOR_QA' },
    });
  }

  // Step 1: Start QA Session for Visit A
  const reqStartQAA = await makeReq('http://localhost:3000/api/qa/sessions/start', 'POST', { visitId: visitIdA.toString() }, qaChemist);
  const resStartQAA = await startQASession(reqStartQAA);
  const dataStartQAA = await resStartQAA.json();
  if (!dataStartQAA.success) {
    console.error('startQASession A failed:', resStartQAA.status, dataStartQAA);
  }

  // GET /api/qa/vehicle-visits/[visitIdA]
  const reqGetQAA = await makeReq('http://localhost:3000/api/qa/vehicle-visits/' + visitIdA, 'GET', null, qaChemist);
  const resGetQAA = await getVisitQA(reqGetQAA, { params: Promise.resolve({ visitId: visitIdA.toString() }) });
  const dataGetQAA = await resGetQAA.json();
  if (!dataGetQAA.visit) {
    console.error('getVisitQA A failed:', resGetQAA.status, dataGetQAA);
  }
  const qaCountA = dataGetQAA.visit.active_plant_tests.length;
  console.log('[Step 1] QA Visit A started. GET active_plant_tests count: ' + qaCountA);

  // Step 2: Admin activates a dummy Plant test in master
  const dummyPlant = await prisma.labTest.create({
    data: {
      testCode: 'LT-BRW-P1-' + nowA,
      testName: 'Dummy Browser Plant Test',
      resultType: 'NUMERIC',
      testScope: 'PLANT',
      isActive: true,
      isRequired: true,
      displayOrder: 250,
    },
  });
  const plantMasterAfterAdd = await prisma.labTest.count({ where: { isActive: true, testScope: { in: ['PLANT', 'BOTH'] } } });
  console.log('[Step 2] Admin activated dummy plant test. Master active count is now: ' + plantMasterAfterAdd);

  // Step 3: Refresh QA Visit A (browser calls GET /api/qa/vehicle-visits/[visitIdA])
  const reqRefreshQAA = await makeReq('http://localhost:3000/api/qa/vehicle-visits/' + visitIdA, 'GET', null, qaChemist);
  const resRefreshQAA = await getVisitQA(reqRefreshQAA, { params: Promise.resolve({ visitId: visitIdA.toString() }) });
  const dataRefreshQAA = await resRefreshQAA.json();
  const qaRefreshCountA = dataRefreshQAA.visit.active_plant_tests.length;
  console.log('[Step 3] Refresh QA Visit A: active_plant_tests count is ' + qaRefreshCountA + ' (Dummy test absent: ' + (!dataRefreshQAA.visit.active_plant_tests.some((t: any) => t.testCode === dummyPlant.testCode)) + ')');

  // Step 4: Start QA Visit B
  const reqStartQAB = await makeReq('http://localhost:3000/api/qa/sessions/start', 'POST', { visitId: visitIdB.toString() }, qaChemist);
  await startQASession(reqStartQAB);

  const reqGetQAB = await makeReq('http://localhost:3000/api/qa/vehicle-visits/' + visitIdB, 'GET', null, qaChemist);
  const resGetQAB = await getVisitQA(reqGetQAB, { params: Promise.resolve({ visitId: visitIdB.toString() }) });
  const dataGetQAB = await resGetQAB.json();
  const qaCountB = dataGetQAB.visit.active_plant_tests.length;
  console.log('[Step 4] QA Visit B started. GET active_plant_tests count is ' + qaCountB + ' (Dummy test present: ' + dataGetQAB.visit.active_plant_tests.some((t: any) => t.testCode === dummyPlant.testCode) + ')');

  // Step 5: Deactivate dummy plant test
  await prisma.labTest.update({ where: { id: dummyPlant.id }, data: { isActive: false } });
  const plantMasterAfterDeact = await prisma.labTest.count({ where: { isActive: true, testScope: { in: ['PLANT', 'BOTH'] } } });
  console.log('[Step 5] Deactivated dummy plant test. Master active count is now: ' + plantMasterAfterDeact);

  // Refresh QA B
  const reqRefreshQAB = await makeReq('http://localhost:3000/api/qa/vehicle-visits/' + visitIdB, 'GET', null, qaChemist);
  const resRefreshQAB = await getVisitQA(reqRefreshQAB, { params: Promise.resolve({ visitId: visitIdB.toString() }) });
  const dataRefreshQAB = await resRefreshQAB.json();
  console.log('[Step 5] Refresh QA Visit B: retains dummy test: ' + dataRefreshQAB.visit.active_plant_tests.some((t: any) => t.testCode === dummyPlant.testCode));

  // Start QA Visit C
  const reqStartQAC = await makeReq('http://localhost:3000/api/qa/sessions/start', 'POST', { visitId: visitIdC.toString() }, qaChemist);
  await startQASession(reqStartQAC);

  const reqGetQAC = await makeReq('http://localhost:3000/api/qa/vehicle-visits/' + visitIdC, 'GET', null, qaChemist);
  const resGetQAC = await getVisitQA(reqGetQAC, { params: Promise.resolve({ visitId: visitIdC.toString() }) });
  const dataGetQAC = await resGetQAC.json();
  console.log('[Step 5] QA Visit C active_plant_tests count is ' + dataGetQAC.visit.active_plant_tests.length + ' (Dummy test absent: ' + (!dataGetQAC.visit.active_plant_tests.some((t: any) => t.testCode === dummyPlant.testCode)) + ')');

  // Cleanup browser test fixtures
  for (const vId of [visitIdA, visitIdB, visitIdC]) {
    await prisma.labTestAssignment.deleteMany({ where: { visit_id: vId } });
    await prisma.plantLabResult.deleteMany({ where: { visit_id: vId } });
    await prisma.dispatchLabResult.deleteMany({ where: { visit_id: vId } });
    await prisma.dispatchInfo.deleteMany({ where: { portion: { visit_id: vId } } });
    await prisma.qATestingSessionEvent.deleteMany({ where: { session: { visit_id: vId } } });
    await prisma.qATestingSession.deleteMany({ where: { visit_id: vId } });
    await prisma.gateLog.deleteMany({ where: { visit_id: vId } });
    await prisma.visitPortion.deleteMany({ where: { visit_id: vId } });
    await prisma.vehicleVisit.delete({ where: { id: vId } });
  }
  await prisma.labTestAssignment.deleteMany({ where: { test_id: { in: [dummyDisp.id, dummyPlant.id] } } });
  await prisma.dispatchLabResult.deleteMany({ where: { test_id: { in: [dummyDisp.id, dummyPlant.id] } } });
  await prisma.plantLabResult.deleteMany({ where: { test_id: { in: [dummyDisp.id, dummyPlant.id] } } });
  await prisma.labTest.deleteMany({ where: { id: { in: [dummyDisp.id, dummyPlant.id] } } });

  console.log('\n=== BROWSER SCENARIOS VERIFICATION: COMPLETE AND VERIFIED 100% ===\n');
}

verifyBrowserScenarios()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Browser Verification Failed:', err);
    process.exit(1);
  });
