import { prisma } from '../src/backend/core/db';
import {
  getOrAssignDispatchTests,
  getOrAssignPlantQATests,
  getAssignedDispatchTests,
  getAssignedPlantQATests,
  serializeAssignment,
} from '../src/backend/services/labTestAssignmentService';
import { createSessionToken } from '../src/backend/core/auth';
import { POST as startDispatchPost } from '../src/app/api/dispatches/start/route';
import { POST as dispatchPost } from '../src/app/api/dispatches/route';

async function runStableAssignmentTests() {
  console.log('--- STARTING STABLE LAB TEST ASSIGNMENT TEST SUITE ---');

  const superAdminUser = await prisma.user.findFirst({ where: { role: 'SUPER_ADMIN', is_active: true } });
  const zmccSource = await prisma.procurementSource.findFirst({ where: { source_type: 'ZMCC', is_active: true } });
  const contractorSource = await prisma.procurementSource.findFirst({ where: { source_type: 'CONTRACTOR', is_active: true } });

  if (!superAdminUser || !zmccSource || !contractorSource) {
    throw new Error('Required test fixtures (SuperAdmin, ZMCC, Contractor) not found.');
  }

  const initialDispatchActive = await prisma.labTest.count({
    where: { isActive: true, testScope: { in: ['DISPATCH', 'BOTH'] } },
  });
  const initialPlantActive = await prisma.labTest.count({
    where: { isActive: true, testScope: { in: ['PLANT', 'BOTH'] } },
  });

  console.log('Baseline Active Counts: Dispatch=' + initialDispatchActive + ', Plant=' + initialPlantActive);

  // CASE A: Dispatch Snapshot (Start Visit A)
  console.log('\n--- CASE A: Dispatch Snapshot ---');
  const nowA = Date.now();
  const visitA = await prisma.vehicleVisit.create({
    data: {
      visit_number: 'VV-TEST-A-' + nowA,
      vehicle_number: 'TEST-VEH-A',
      current_status: 'DISPATCHED',
      procurement_source_id: zmccSource.id,
      created_by: superAdminUser.id,
    },
  });

  const assignedA = await getOrAssignDispatchTests(prisma, visitA.id);
  console.log('Visit A assigned tests count: ' + assignedA.length + ' (Expected: ' + initialDispatchActive + ')');
  if (assignedA.length !== initialDispatchActive) {
    throw new Error('Case A Failed: Expected ' + initialDispatchActive + ', got ' + assignedA.length);
  }

  // CASE B: Dispatch Activation (Admin activates dummy tests, start Visit B)
  console.log('\n--- CASE B: Dispatch Activation ---');
  const nowB = Date.now();
  const dummy1 = await prisma.labTest.create({
    data: {
      testCode: 'LT-TEST-D1-' + nowB,
      testName: 'Dummy Test Dispatch 1',
      resultType: 'OK_NOT_OK',
      testScope: 'DISPATCH',
      isActive: true,
      isRequired: false,
      displayOrder: 100,
    },
  });
  const dummy2 = await prisma.labTest.create({
    data: {
      testCode: 'LT-TEST-D2-' + nowB,
      testName: 'Dummy Test Dispatch 2',
      resultType: 'NUMERIC',
      testScope: 'DISPATCH',
      isActive: true,
      isRequired: false,
      displayOrder: 101,
    },
  });
  const dummy3 = await prisma.labTest.create({
    data: {
      testCode: 'LT-TEST-D3-' + nowB,
      testName: 'Dummy Test Dispatch 3',
      resultType: 'POSITIVE_NEGATIVE',
      testScope: 'BOTH',
      isActive: true,
      isRequired: false,
      displayOrder: 102,
    },
  });

  const masterCountAfterAdd = await prisma.labTest.count({
    where: { isActive: true, testScope: { in: ['DISPATCH', 'BOTH'] } },
  });
  console.log('Master Dispatch Count After Adding 3: ' + masterCountAfterAdd + ' (Expected: ' + (initialDispatchActive + 3) + ')');

  const assignedAAfterAdd = await getOrAssignDispatchTests(prisma, visitA.id);
  console.log('Visit A assigned count after master add: ' + assignedAAfterAdd.length + ' (Expected: ' + initialDispatchActive + ')');
  if (assignedAAfterAdd.length !== initialDispatchActive) {
    throw new Error('Case B Failed: Visit A count mutated to ' + assignedAAfterAdd.length);
  }

  const visitB = await prisma.vehicleVisit.create({
    data: {
      visit_number: 'VV-TEST-B-' + nowB,
      vehicle_number: 'TEST-VEH-B',
      current_status: 'DISPATCHED',
      procurement_source_id: contractorSource.id,
      created_by: superAdminUser.id,
    },
  });
  const assignedB = await getOrAssignDispatchTests(prisma, visitB.id);
  console.log('Visit B assigned count: ' + assignedB.length + ' (Expected: ' + masterCountAfterAdd + ')');
  if (assignedB.length !== masterCountAfterAdd) {
    throw new Error('Case B Failed: Visit B expected ' + masterCountAfterAdd + ', got ' + assignedB.length);
  }

  // CASE C: Dispatch Deactivation (Admin deactivates tests, start Visit C)
  console.log('\n--- CASE C: Dispatch Deactivation ---');
  await prisma.labTest.update({ where: { id: dummy1.id }, data: { isActive: false } });
  await prisma.labTest.update({ where: { id: dummy2.id }, data: { isActive: false } });
  await prisma.labTest.update({ where: { id: dummy3.id }, data: { isActive: false } });

  const extraDeactivates = await prisma.labTest.findMany({
    where: { isActive: true, isRequired: false, testScope: { in: ['DISPATCH', 'BOTH'] } },
    take: 2,
  });
  for (const t of extraDeactivates) {
    await prisma.labTest.update({ where: { id: t.id }, data: { isActive: false } });
  }

  const masterCountAfterDeactivate = await prisma.labTest.count({
    where: { isActive: true, testScope: { in: ['DISPATCH', 'BOTH'] } },
  });
  console.log('Master Dispatch Count After Deactivations: ' + masterCountAfterDeactivate);

  const assignedAAfterDeact = await getOrAssignDispatchTests(prisma, visitA.id);
  const assignedBAfterDeact = await getOrAssignDispatchTests(prisma, visitB.id);
  console.log('Visit A after deact: ' + assignedAAfterDeact.length + ' (Expected: ' + initialDispatchActive + ')');
  console.log('Visit B after deact: ' + assignedBAfterDeact.length + ' (Expected: ' + masterCountAfterAdd + ')');

  if (assignedAAfterDeact.length !== initialDispatchActive || assignedBAfterDeact.length !== masterCountAfterAdd) {
    throw new Error('Case C Failed: Prior visit assignments mutated upon master deactivation.');
  }

  const nowC = Date.now();
  const visitC = await prisma.vehicleVisit.create({
    data: {
      visit_number: 'VV-TEST-C-' + nowC,
      vehicle_number: 'TEST-VEH-C',
      current_status: 'DISPATCHED',
      procurement_source_id: zmccSource.id,
      created_by: superAdminUser.id,
    },
  });
  const assignedC = await getOrAssignDispatchTests(prisma, visitC.id);
  console.log('Visit C assigned count: ' + assignedC.length + ' (Expected: ' + masterCountAfterDeactivate + ')');
  if (assignedC.length !== masterCountAfterDeactivate) {
    throw new Error('Case C Failed: Visit C expected ' + masterCountAfterDeactivate + ', got ' + assignedC.length);
  }

  for (const t of extraDeactivates) {
    await prisma.labTest.update({ where: { id: t.id }, data: { isActive: true } });
  }

  // CASE D: ZMCC & Contractor Shared Catalog
  console.log('\n--- CASE D: ZMCC & Contractor Shared Catalog ---');
  const nowD = Date.now();
  const visitZmcc = await prisma.vehicleVisit.create({
    data: {
      visit_number: 'VV-TEST-ZMCC-' + nowD,
      vehicle_number: 'TEST-ZMCC-01',
      procurement_source_id: zmccSource.id,
      created_by: superAdminUser.id,
    },
  });
  const visitContractor = await prisma.vehicleVisit.create({
    data: {
      visit_number: 'VV-TEST-CONT-' + nowD,
      vehicle_number: 'TEST-CONT-01',
      procurement_source_id: contractorSource.id,
      created_by: superAdminUser.id,
    },
  });

  const assignedZmcc = await getOrAssignDispatchTests(prisma, visitZmcc.id);
  const assignedContractor = await getOrAssignDispatchTests(prisma, visitContractor.id);

  const zmccTestIds = assignedZmcc.map((t) => t.test_id.toString()).sort();
  const contractorTestIds = assignedContractor.map((t) => t.test_id.toString()).sort();

  console.log('ZMCC Tests: ' + zmccTestIds.length + ', Contractor Tests: ' + contractorTestIds.length);
  if (JSON.stringify(zmccTestIds) !== JSON.stringify(contractorTestIds)) {
    throw new Error('Case D Failed: ZMCC and Contractor assigned test IDs do not match.');
  }

  // CASE E: Contractor Execution Defaults
  console.log('\n--- CASE E: Contractor Execution Defaults ---');
  const serializedList = assignedContractor.map(serializeAssignment);
  console.log('Serialized ' + serializedList.length + ' test DTOs cleanly for Contractor form.');
  if (serializedList.length === 0 || !serializedList[0].testCode || !serializedList[0].testName) {
    throw new Error('Case E Failed: Serialized DTO missing testCode or testName.');
  }

  // CASE F: QA Snapshot & Mid-Session Activation
  console.log('\n--- CASE F: QA Snapshot & Mid-Session Activation ---');
  const nowF = Date.now();
  const visitQAA = await prisma.vehicleVisit.create({
    data: {
      visit_number: 'VV-QA-A-' + nowF,
      vehicle_number: 'QA-VEH-A',
      current_status: 'PLANT_QA',
      procurement_source_id: zmccSource.id,
      created_by: superAdminUser.id,
    },
  });

  const assignedQAA = await getOrAssignPlantQATests(prisma, visitQAA.id);
  const qaaCount = assignedQAA.length;
  console.log('QA Visit A initial assigned count: ' + qaaCount);

  const dummyAntibiotic = await prisma.labTest.create({
    data: {
      testCode: 'LT-QA-ANTI-' + nowF,
      testName: 'Antibiotic Residue Test',
      resultType: 'OK_NOT_OK',
      testScope: 'PLANT',
      isActive: true,
      isRequired: true,
      displayOrder: 200,
    },
  });

  const assignedQAAAfterMasterAdd = await getOrAssignPlantQATests(prisma, visitQAA.id);
  console.log('QA Visit A after master add: ' + assignedQAAAfterMasterAdd.length + ' (Expected: ' + qaaCount + ')');
  if (assignedQAAAfterMasterAdd.length !== qaaCount) {
    throw new Error('Case F Failed: Existing QA session assignment mutated after master add.');
  }

  const visitQAB = await prisma.vehicleVisit.create({
    data: {
      visit_number: 'VV-QA-B-' + nowF,
      vehicle_number: 'QA-VEH-B',
      current_status: 'PLANT_QA',
      procurement_source_id: zmccSource.id,
      created_by: superAdminUser.id,
    },
  });
  const assignedQAB = await getOrAssignPlantQATests(prisma, visitQAB.id);
  console.log('QA Visit B assigned count: ' + assignedQAB.length + ' (Expected: ' + (qaaCount + 1) + ')');
  if (assignedQAB.length !== qaaCount + 1) {
    throw new Error('Case F Failed: New QA session expected ' + (qaaCount + 1) + ', got ' + assignedQAB.length);
  }

  // CASE G: QA Deactivation
  console.log('\n--- CASE G: QA Deactivation ---');
  await prisma.labTest.update({ where: { id: dummyAntibiotic.id }, data: { isActive: false } });

  const assignedQABAfterDeact = await getOrAssignPlantQATests(prisma, visitQAB.id);
  const hasAntiInB = assignedQABAfterDeact.some((t) => t.test_id.toString() === dummyAntibiotic.id.toString());
  console.log('QA Visit B retains deactivated test: ' + hasAntiInB);
  if (!hasAntiInB) {
    throw new Error('Case G Failed: QA Visit B lost assigned test upon master deactivation.');
  }

  const nowG = Date.now();
  const visitQAC = await prisma.vehicleVisit.create({
    data: {
      visit_number: 'VV-QA-C-' + nowG,
      vehicle_number: 'QA-VEH-C',
      current_status: 'PLANT_QA',
      procurement_source_id: zmccSource.id,
      created_by: superAdminUser.id,
    },
  });
  const assignedQAC = await getOrAssignPlantQATests(prisma, visitQAC.id);
  const hasAntiInC = assignedQAC.some((t) => t.test_id.toString() === dummyAntibiotic.id.toString());
  console.log('QA Visit C has deactivated test: ' + hasAntiInC + ' (Expected: false)');
  if (hasAntiInC) {
    throw new Error('Case G Failed: New QA session C erroneously received deactivated test.');
  }

  // CASE H: isRequired Snapshot Stability
  console.log('\n--- CASE H: isRequired Snapshot Stability ---');
  const nowH = Date.now();
  const dummyToggle = await prisma.labTest.create({
    data: {
      testCode: 'LT-QA-TOGGLE-' + nowH,
      testName: 'Toggle Required Test',
      resultType: 'NUMERIC',
      testScope: 'PLANT',
      isActive: true,
      isRequired: true,
      displayOrder: 300,
    },
  });

  const visitReq1 = await prisma.vehicleVisit.create({
    data: { visit_number: 'VV-REQ-1-' + nowH, vehicle_number: 'REQ-1', procurement_source_id: zmccSource.id },
  });
  const assignedReq1 = await getOrAssignPlantQATests(prisma, visitReq1.id);
  const itemReq1 = assignedReq1.find((t) => t.test_id.toString() === dummyToggle.id.toString());
  console.log('Visit Req1 isRequiredSnapshot: ' + itemReq1?.is_required_snapshot + ' (Expected: true)');

  await prisma.labTest.update({ where: { id: dummyToggle.id }, data: { isRequired: false } });

  const assignedReq1After = await getOrAssignPlantQATests(prisma, visitReq1.id);
  const itemReq1After = assignedReq1After.find((t) => t.test_id.toString() === dummyToggle.id.toString());
  console.log('Visit Req1 after master change isRequiredSnapshot: ' + itemReq1After?.is_required_snapshot + ' (Expected: true)');
  if (!itemReq1After?.is_required_snapshot) {
    throw new Error('Case H Failed: Existing assignment isRequiredSnapshot was overwritten.');
  }

  const visitReq2 = await prisma.vehicleVisit.create({
    data: { visit_number: 'VV-REQ-2-' + nowH, vehicle_number: 'REQ-2', procurement_source_id: zmccSource.id },
  });
  const assignedReq2 = await getOrAssignPlantQATests(prisma, visitReq2.id);
  const itemReq2 = assignedReq2.find((t) => t.test_id.toString() === dummyToggle.id.toString());
  console.log('Visit Req2 isRequiredSnapshot: ' + itemReq2?.is_required_snapshot + ' (Expected: false)');
  if (itemReq2?.is_required_snapshot !== false) {
    throw new Error('Case H Failed: New assignment did not capture updated isRequired = false.');
  }
  await prisma.labTest.update({ where: { id: dummyToggle.id }, data: { isActive: false } });

  // CASE I: resultType Snapshot Stability
  console.log('\n--- CASE I: resultType Snapshot Stability ---');
  const nowI = Date.now();
  const dummyResType = await prisma.labTest.create({
    data: {
      testCode: 'LT-RES-TYPE-' + nowI,
      testName: 'Result Type Mutation Test',
      resultType: 'OK_NOT_OK',
      testScope: 'PLANT',
      isActive: true,
      isRequired: false,
      displayOrder: 400,
    },
  });

  const visitRes1 = await prisma.vehicleVisit.create({
    data: { visit_number: 'VV-RES-1-' + nowI, vehicle_number: 'RES-1', procurement_source_id: zmccSource.id },
  });
  const assignedRes1 = await getOrAssignPlantQATests(prisma, visitRes1.id);
  const itemRes1 = assignedRes1.find((t) => t.test_id.toString() === dummyResType.id.toString());
  console.log('Visit Res1 resultTypeSnapshot: ' + itemRes1?.result_type_snapshot + ' (Expected: OK_NOT_OK)');

  await prisma.labTest.update({ where: { id: dummyResType.id }, data: { resultType: 'POSITIVE_NEGATIVE' } });

  const assignedRes1After = await getOrAssignPlantQATests(prisma, visitRes1.id);
  const itemRes1After = assignedRes1After.find((t) => t.test_id.toString() === dummyResType.id.toString());
  console.log('Visit Res1 after master change: ' + itemRes1After?.result_type_snapshot + ' (Expected: OK_NOT_OK)');
  if (itemRes1After?.result_type_snapshot !== 'OK_NOT_OK') {
    throw new Error('Case I Failed: Existing assignment resultTypeSnapshot was modified.');
  }
  await prisma.labTest.update({ where: { id: dummyResType.id }, data: { isActive: false } });

  // CASE J: displayOrder Snapshot Stability
  console.log('\n--- CASE J: displayOrder Snapshot Stability ---');
  const nowJ = Date.now();
  const dummyOrder = await prisma.labTest.create({
    data: {
      testCode: 'LT-ORDER-' + nowJ,
      testName: 'Order Test',
      resultType: 'NUMERIC',
      testScope: 'PLANT',
      isActive: true,
      isRequired: false,
      displayOrder: 5,
    },
  });

  const visitOrd1 = await prisma.vehicleVisit.create({
    data: { visit_number: 'VV-ORD-1-' + nowJ, vehicle_number: 'ORD-1', procurement_source_id: zmccSource.id },
  });
  const assignedOrd1 = await getOrAssignPlantQATests(prisma, visitOrd1.id);
  const itemOrd1 = assignedOrd1.find((t) => t.test_id.toString() === dummyOrder.id.toString());
  console.log('Visit Ord1 displayOrder: ' + itemOrd1?.display_order_snapshot + ' (Expected: 5)');

  await prisma.labTest.update({ where: { id: dummyOrder.id }, data: { displayOrder: 999 } });

  const assignedOrd1After = await getOrAssignPlantQATests(prisma, visitOrd1.id);
  const itemOrd1After = assignedOrd1After.find((t) => t.test_id.toString() === dummyOrder.id.toString());
  console.log('Visit Ord1 after master change: ' + itemOrd1After?.display_order_snapshot + ' (Expected: 5)');
  if (itemOrd1After?.display_order_snapshot !== 5) {
    throw new Error('Case J Failed: Existing display_order_snapshot was modified.');
  }
  await prisma.labTest.update({ where: { id: dummyOrder.id }, data: { isActive: false } });

  // CASE K: testName Snapshot Stability
  console.log('\n--- CASE K: testName Snapshot Stability ---');
  const nowK = Date.now();
  const dummyName = await prisma.labTest.create({
    data: {
      testCode: 'LT-NAME-' + nowK,
      testName: 'Original Test Name',
      resultType: 'NUMERIC',
      testScope: 'PLANT',
      isActive: true,
      isRequired: false,
      displayOrder: 50,
    },
  });

  const visitName1 = await prisma.vehicleVisit.create({
    data: { visit_number: 'VV-NAME-1-' + nowK, vehicle_number: 'NAME-1', procurement_source_id: zmccSource.id },
  });
  const assignedName1 = await getOrAssignPlantQATests(prisma, visitName1.id);
  const itemName1 = assignedName1.find((t) => t.test_id.toString() === dummyName.id.toString());
  console.log('Visit Name1 testNameSnapshot: ' + itemName1?.test_name_snapshot + ' (Expected: Original Test Name)');

  await prisma.labTest.update({ where: { id: dummyName.id }, data: { testName: 'Renamed Test Master' } });

  const assignedName1After = await getOrAssignPlantQATests(prisma, visitName1.id);
  const itemName1After = assignedName1After.find((t) => t.test_id.toString() === dummyName.id.toString());
  console.log('Visit Name1 after rename: ' + itemName1After?.test_name_snapshot + ' (Expected: Original Test Name)');
  if (itemName1After?.test_name_snapshot !== 'Original Test Name') {
    throw new Error('Case K Failed: Existing test_name_snapshot was modified.');
  }
  await prisma.labTest.update({ where: { id: dummyName.id }, data: { isActive: false } });

  // CASE L: Idempotency & Database Uniqueness
  console.log('\n--- CASE L: Idempotency Guarantee ---');
  const countBefore = await prisma.labTestAssignment.count({ where: { visit_id: visitA.id, workflow: 'DISPATCH' } });
  await Promise.all([
    getOrAssignDispatchTests(prisma, visitA.id),
    getOrAssignDispatchTests(prisma, visitA.id),
    getOrAssignDispatchTests(prisma, visitA.id),
  ]);
  const countAfter = await prisma.labTestAssignment.count({ where: { visit_id: visitA.id, workflow: 'DISPATCH' } });
  console.log('Assignment count for Visit A: before=' + countBefore + ', after concurrent calls=' + countAfter);
  if (countBefore !== countAfter) {
    throw new Error('Case L Failed: Duplicate assignment rows created.');
  }

  // CASE M: Legacy In-Progress Bootstrap
  console.log('\n--- CASE M: Legacy In-Progress Bootstrap ---');
  const nowM = Date.now();
  const legacyVisit = await prisma.vehicleVisit.create({
    data: {
      visit_number: 'VV-LEGACY-' + nowM,
      vehicle_number: 'LEGACY-01',
      procurement_source_id: zmccSource.id,
      created_by: superAdminUser.id,
    },
  });
  const legacyPortion = await prisma.visitPortion.create({
    data: {
      visit_id: legacyVisit.id,
      portion_number: 1,
      dispatch_quantity_value: 5000,
      dispatch_quantity_unit: 'KG',
      dispatch_quantity_basis: 'MEASURED',
      dispatch_measurement_method: 'WEIGHING',
    },
  });

  const legacyInactiveTest = await prisma.labTest.create({
    data: {
      testCode: 'LT-LEGACY-INACT-' + nowM,
      testName: 'Legacy Inactive Test',
      resultType: 'NUMERIC',
      testScope: 'PLANT',
      isActive: false,
      isRequired: false,
    },
  });

  await prisma.plantLabResult.create({
    data: {
      visit_id: legacyVisit.id,
      portion_id: legacyPortion.id,
      test_id: legacyInactiveTest.id,
      numeric_value: 12.34,
      performance_status: 'PERFORMED',
      is_passed: true,
    },
  });

  const bootstrapped = await getOrAssignPlantQATests(prisma, legacyVisit.id);
  const includesLegacyInactive = bootstrapped.some((t) => t.test_id.toString() === legacyInactiveTest.id.toString());
  console.log('Bootstrapped assignment includes existing legacy result test: ' + includesLegacyInactive);
  if (!includesLegacyInactive) {
    throw new Error('Case M Failed: Legacy in-progress bootstrap did not include existing result test.');
  }

  // CASE N: Historical Result Preservation
  console.log('\n--- CASE N: Historical Result Preservation ---');
  const pastResult = await prisma.plantLabResult.findFirst({
    where: { visit_id: legacyVisit.id, test_id: legacyInactiveTest.id },
    include: { lab_test: true },
  });
  console.log('Historical Result Loaded: testName=' + pastResult?.lab_test.testName + ', value=' + pastResult?.numeric_value);
  if (!pastResult || Number(pastResult.numeric_value) !== 12.34) {
    throw new Error('Case N Failed: Historical result not preserved.');
  }

  // --- STAGE 2A CASES ---
  const mpdUser = await prisma.user.findFirst({ where: { role: 'MPD_Operator', is_active: true } });
  if (!mpdUser) throw new Error('MPD_Operator user not found.');

  // CASE O: Open Dispatch Master Activation & Submission Stability
  console.log('\n--- CASE O: Open Dispatch Master Activation & Submission Stability ---');
  const mpdSourceId = (mpdUser.procurement_source_id ? mpdUser.procurement_source_id : zmccSource.id).toString();
  const mpdUserDto: any = {
    ...mpdUser,
    id: mpdUser.id.toString(),
    procurement_source_id: mpdUser.procurement_source_id ? mpdUser.procurement_source_id.toString() : null,
  };
  const mpdToken = await createSessionToken(mpdUserDto);
  const reqStartA = new Request('http://localhost:3000/api/dispatches/start', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `auth_token=${mpdToken}`,
    },
    body: JSON.stringify({
      vehicleNumber: 'STAGE2A-VEH-A',
      procurementSourceId: mpdSourceId,
      operationalDate: '2026-08-21',
    }),
  });
  const resStartA = await startDispatchPost(reqStartA);
  const dataStartA = await resStartA.json();
  if (!resStartA.ok || !dataStartA.visitId) {
    throw new Error('Case O Failed: Could not start Dispatch A: ' + JSON.stringify(dataStartA));
  }
  const draftVisitIdA = dataStartA.visitId;
  const assignedCountA = dataStartA.assignedTests.length;
  console.log('Dispatch A started with assigned tests count: ' + assignedCountA);

  // Admin activates a new master test
  const nowO = Date.now();
  const dummyO = await prisma.labTest.create({
    data: {
      testCode: 'LT-TEST-O-' + nowO,
      testName: 'Stage 2A Dummy Activation Test',
      resultType: 'OK_NOT_OK',
      testScope: 'DISPATCH',
      isActive: true,
      isRequired: true,
      displayOrder: 150,
    },
  });

  // Operator refreshes / re-requests Dispatch A
  const reqRefreshA = new Request('http://localhost:3000/api/dispatches/start', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `auth_token=${mpdToken}`,
    },
    body: JSON.stringify({
      visitId: draftVisitIdA,
    }),
  });
  const resRefreshA = await startDispatchPost(reqRefreshA);
  const dataRefreshA = await resRefreshA.json();
  console.log('Dispatch A after master activation returned assigned count: ' + dataRefreshA.assignedTests.length + ' (Expected: ' + assignedCountA + ')');
  if (dataRefreshA.assignedTests.length !== assignedCountA) {
    throw new Error('Case O Failed: Dispatch A snapshot count mutated!');
  }
  const dummyOPresentInA = dataRefreshA.assignedTests.some((t: any) => t.testCode === dummyO.testCode);
  console.log('Dummy test present in Dispatch A snapshot: ' + dummyOPresentInA + ' (Expected: false)');
  if (dummyOPresentInA) {
    throw new Error('Case O Failed: Dummy test leaked into pre-started Dispatch A!');
  }

  // Operator submits Dispatch A using original assigned test set
  const resultsA = dataStartA.assignedTests
    .filter((t: any) => t.resultType !== 'CALCULATED')
    .map((t: any) => ({
      testId: t.testId,
      performanceStatus: 'PERFORMED',
      numericValue: t.resultType === 'NUMERIC' ? 3.5 : null,
      textValue: t.resultType === 'OK_NOT_OK' ? 'OK' : t.resultType === 'POSITIVE_NEGATIVE' ? 'NEGATIVE' : 'Pass',
    }));

  const reqSubmitA = new Request('http://localhost:3000/api/dispatches', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `auth_token=${mpdToken}`,
    },
    body: JSON.stringify({
      visitId: draftVisitIdA,
      vehicleNumber: 'STAGE2A-VEH-A',
      procurementSourceId: mpdSourceId,
      vehicleQuantity: { value: '8500', unit: 'KG', basis: 'MEASURED', method: 'WEIGHING' },
      portions: [
        {
          portionNumber: 1,
          quantity: { value: '8500', unit: 'KG', basis: 'MEASURED', method: 'WEIGHING' },
          results: resultsA,
        },
      ],
    }),
  });
  const resSubmitA = await dispatchPost(reqSubmitA);
  const dataSubmitA = await resSubmitA.json();
  console.log('Dispatch A final submission status: ' + resSubmitA.status + ' (Expected: 201)');
  if (!resSubmitA.ok) {
    throw new Error('Case O Failed: Dispatch A submission failed against old assignment: ' + JSON.stringify(dataSubmitA));
  }

  // CASE P: Open Dispatch Master Deactivation
  console.log('\n--- CASE P: Open Dispatch Master Deactivation ---');
  // Start Dispatch B (should receive dummyO)
  const reqStartB = new Request('http://localhost:3000/api/dispatches/start', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `auth_token=${mpdToken}`,
    },
    body: JSON.stringify({
      vehicleNumber: 'STAGE2A-VEH-B',
      procurementSourceId: mpdSourceId,
      operationalDate: '2026-08-21',
    }),
  });
  const resStartB = await startDispatchPost(reqStartB);
  const dataStartB = await resStartB.json();
  const draftVisitIdB = dataStartB.visitId;
  const dummyOPresentInB = dataStartB.assignedTests.some((t: any) => t.testCode === dummyO.testCode);
  console.log('Dispatch B started with dummy test: ' + dummyOPresentInB + ' (Expected: true)');
  if (!dummyOPresentInB) {
    throw new Error('Case P Failed: Dispatch B did not receive newly active test.');
  }

  // Admin deactivates dummyO on master
  await prisma.labTest.update({
    where: { id: dummyO.id },
    data: { isActive: false },
  });

  // Dispatch B still retains dummyO in assigned snapshot
  const reqRefreshB = new Request('http://localhost:3000/api/dispatches/start', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `auth_token=${mpdToken}`,
    },
    body: JSON.stringify({ visitId: draftVisitIdB }),
  });
  const resRefreshB = await startDispatchPost(reqRefreshB);
  const dataRefreshB = await resRefreshB.json();
  const dummyORetainedInB = dataRefreshB.assignedTests.some((t: any) => t.testCode === dummyO.testCode);
  console.log('Dispatch B retains deactivated dummy test in snapshot: ' + dummyORetainedInB + ' (Expected: true)');
  if (!dummyORetainedInB) {
    throw new Error('Case P Failed: Dispatch B lost test after master deactivation.');
  }

  // Submitting B without dummyO fails because dummyO is required in B's snapshot
  const resultsBWithoutDummy = dataRefreshB.assignedTests
    .filter((t: any) => t.testCode !== dummyO.testCode && t.resultType !== 'CALCULATED')
    .map((t: any) => ({
      testId: t.testId,
      performanceStatus: 'PERFORMED',
      numericValue: t.resultType === 'NUMERIC' ? 3.5 : null,
      textValue: t.resultType === 'OK_NOT_OK' ? 'OK' : t.resultType === 'POSITIVE_NEGATIVE' ? 'NEGATIVE' : 'Pass',
    }));

  const reqSubmitBIncomplete = new Request('http://localhost:3000/api/dispatches', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `auth_token=${mpdToken}`,
    },
    body: JSON.stringify({
      visitId: draftVisitIdB,
      vehicleNumber: 'STAGE2A-VEH-B',
      procurementSourceId: mpdSourceId,
      vehicleQuantity: { value: '8500', unit: 'KG', basis: 'MEASURED', method: 'WEIGHING' },
      portions: [
        {
          portionNumber: 1,
          quantity: { value: '8500', unit: 'KG', basis: 'MEASURED', method: 'WEIGHING' },
          results: resultsBWithoutDummy,
        },
      ],
    }),
  });
  const resSubmitBIncomplete = await dispatchPost(reqSubmitBIncomplete);
  console.log('Dispatch B submission without snapshot test rejected: ' + resSubmitBIncomplete.status + ' (Expected: 400)');
  if (resSubmitBIncomplete.status !== 400) {
    throw new Error('Case P Failed: Incomplete Dispatch B submission was not rejected!');
  }

  // CASE Q: New Dispatch Dynamic Master Change
  console.log('\n--- CASE Q: New Dispatch Dynamic Master Change ---');
  const reqStartC = new Request('http://localhost:3000/api/dispatches/start', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `auth_token=${mpdToken}`,
    },
    body: JSON.stringify({
      vehicleNumber: 'STAGE2A-VEH-C',
      procurementSourceId: mpdSourceId,
      operationalDate: '2026-08-21',
    }),
  });
  const resStartC = await startDispatchPost(reqStartC);
  const dataStartC = await resStartC.json();
  const dummyOPresentInC = dataStartC.assignedTests.some((t: any) => t.testCode === dummyO.testCode);
  console.log('New Dispatch C excludes deactivated test: ' + (!dummyOPresentInC) + ' (Expected: true)');
  if (dummyOPresentInC) {
    throw new Error('Case Q Failed: New Dispatch C received deactivated test.');
  }

  // CASE R: x-test-user Security Audit
  console.log('\n--- CASE R: x-test-user Security Audit ---');
  const reqSecurityAttack = new Request('http://localhost:3000/api/dispatches/start', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-test-user': 'SUPER_ADMIN',
    },
    body: JSON.stringify({
      vehicleNumber: 'HACK-VEH',
    }),
  });
  const resSecurityAttack = await startDispatchPost(reqSecurityAttack);
  console.log('Unauthenticated request with x-test-user header status: ' + resSecurityAttack.status + ' (Expected: 401)');
  if (resSecurityAttack.status !== 401) {
    throw new Error('Case R Failed: Server accepted unauthenticated request with x-test-user header!');
  }

  console.log('\n=== ALL 18 DEDICATED STABLE ASSIGNMENT TEST CASES PASSED (100%) ===\n');
}

async function cleanupFixtures() {
  const dummyTests = await prisma.labTest.findMany({
    where: {
      OR: [
        { testCode: { startsWith: 'LT-TEST-' } },
        { testCode: { startsWith: 'LT-QA-' } },
        { testCode: { startsWith: 'LT-RES-' } },
        { testCode: { startsWith: 'LT-ORDER-' } },
        { testCode: { startsWith: 'LT-NAME-' } },
        { testCode: { startsWith: 'LT-LEGACY-' } },
      ],
    },
  });
  for (const t of dummyTests) {
    await prisma.labTestAssignment.deleteMany({ where: { test_id: t.id } });
    await prisma.plantLabResult.deleteMany({ where: { test_id: t.id } });
    await prisma.dispatchLabResult.deleteMany({ where: { test_id: t.id } });
    await prisma.labTest.delete({ where: { id: t.id } });
  }

  const dummyVisits = await prisma.vehicleVisit.findMany({
    where: {
      OR: [
        { visit_number: { startsWith: 'VV-TEST-' } },
        { visit_number: { startsWith: 'VV-QA-' } },
        { visit_number: { startsWith: 'VV-REQ-' } },
        { visit_number: { startsWith: 'VV-RES-' } },
        { visit_number: { startsWith: 'VV-ORD-' } },
        { visit_number: { startsWith: 'VV-NAME-' } },
        { visit_number: { startsWith: 'VV-LEGACY-' } },
        { vehicle_number: { startsWith: 'STAGE2A-VEH-' } },
      ],
    },
  });
  for (const v of dummyVisits) {
    await prisma.labTestAssignment.deleteMany({ where: { visit_id: v.id } });
    await prisma.plantLabResult.deleteMany({ where: { visit_id: v.id } });
    await prisma.dispatchLabResult.deleteMany({ where: { visit_id: v.id } });
    await prisma.dispatchInfo.deleteMany({ where: { portion: { visit_id: v.id } } });
    await prisma.visitPortion.deleteMany({ where: { visit_id: v.id } });
    await prisma.vehicleVisit.delete({ where: { id: v.id } });
  }
}

runStableAssignmentTests()
  .then(async () => {
    await cleanupFixtures();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('Test Suite Failed:', err);
    await cleanupFixtures();
    process.exit(1);
  });
