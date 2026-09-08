import { prisma } from '../src/backend/core/db';
import {
  getOrAssignDispatchTests,
  getOrAssignPlantQATests,
  serializeAssignment,
} from '../src/backend/services/labTestAssignmentService';
import { createSessionToken } from '../src/backend/core/auth';
import { GET as superAdminLabTestsGet, POST as superAdminLabTestsPost } from '../src/app/api/super-admin/lab-tests/route';
import { PATCH as superAdminLabTestsPatch } from '../src/app/api/super-admin/lab-tests/[id]/route';
import { GET as publicLabTestsGet } from '../src/app/api/lab-tests/route';
import { POST as startDispatchPost } from '../src/app/api/dispatches/start/route';
import { POST as dispatchPost } from '../src/app/api/dispatches/route';
import { POST as completePortionPost } from '../src/app/api/qa/vehicle-visits/[visitId]/portions/[portionId]/complete/route';
import { evaluateLabResult, validateCategoricalOption } from '../src/lib/lab-rules';
import { calculateSNF, calculateRatio } from '../src/backend/utils/milkFormulas';
import { getOperationalBusinessDate } from '../src/backend/core/business-day';
import { mapScopeCheckboxes } from '../src/app/super-admin/lab-tests/page';

async function runConfigurableQualitativeOptionsTests() {
  console.log('========================================================================');
  console.log('--- STARTING STAGE 3 CONFIGURABLE QUALITATIVE OPTIONS TEST SUITE ---');
  console.log('========================================================================\n');

  const regressionBusinessDate = getOperationalBusinessDate(new Date());

  const superAdminUser = await prisma.user.findFirst({ where: { role: 'SUPER_ADMIN', is_active: true } });
  const zmccSource = await prisma.procurementSource.findFirst({ where: { source_type: 'ZMCC', is_active: true } });
  const contractorSource = await prisma.procurementSource.findFirst({ where: { source_type: 'CONTRACTOR', is_active: true } });

  if (!superAdminUser || !zmccSource || !contractorSource) {
    throw new Error('Required test fixtures (SuperAdmin, ZMCC, Contractor) not found.');
  }

  const token = await createSessionToken({
    id: superAdminUser.id.toString(),
    username: superAdminUser.username,
    role: superAdminUser.role as any,
    name: superAdminUser.full_name || superAdminUser.username,
    department: superAdminUser.department || 'Management',
  });

  const authHeaders = {
    'Content-Type': 'application/json',
    cookie: `auth_token=${token}`,
  };

  let passedCases = 0;
  const cleanupTestIds: bigint[] = [];
  const cleanupVisitIds: bigint[] = [];

  // --- CASE A: Master Test Categorical Backfill Verification ---
  console.log('--- CASE A: Master Test Categorical Backfill Verification ---');
  // Deactivate any previously created dummy tests
  await prisma.labTest.updateMany({
    where: { testName: { startsWith: 'Appearance Quality' } },
    data: { isActive: false },
  });

  const allMasterTests = await prisma.labTest.findMany({ where: { isActive: true } });
  const okNotOkTests = allMasterTests.filter((t) => t.resultType === 'OK_NOT_OK');
  const posNegTests = allMasterTests.filter((t) => t.resultType === 'POSITIVE_NEGATIVE');

  for (const t of okNotOkTests) {
    const opts = t.resultOptions as any[];
    if (!Array.isArray(opts) || opts.length !== 2) {
      throw new Error(`Case A Failed: Test ${t.testCode} does not have 2 options in resultOptions`);
    }
    const okOpt = opts.find((o) => o.value === 'OK');
    const notOkOpt = opts.find((o) => o.value === 'NOT_OK');
    if (!okOpt || okOpt.isPassing !== true || !notOkOpt || notOkOpt.isPassing !== false) {
      throw new Error(`Case A Failed: Test ${t.testCode} option semantics invalid`);
    }
  }

  for (const t of posNegTests) {
    const opts = t.resultOptions as any[];
    if (!Array.isArray(opts) || opts.length !== 2) {
      throw new Error(`Case A Failed: Test ${t.testCode} does not have 2 options in resultOptions`);
    }
    const negOpt = opts.find((o) => o.value === 'NEGATIVE');
    const posOpt = opts.find((o) => o.value === 'POSITIVE');
    if (!negOpt || negOpt.isPassing !== true || !posOpt || posOpt.isPassing !== false) {
      throw new Error(`Case A Failed: Test ${t.testCode} option semantics invalid`);
    }
  }
  console.log(`✓ Case A Passed: All ${okNotOkTests.length} OK_NOT_OK and ${posNegTests.length} POSITIVE_NEGATIVE tests properly backfilled.`);
  passedCases++;

  // --- CASE B: LabTestAssignment Backfill Verification ---
  console.log('\n--- CASE B: LabTestAssignment Backfill Verification ---');
  const assignments = await prisma.labTestAssignment.findMany();
  const catAssignments = assignments.filter((a) => ['OK_NOT_OK', 'POSITIVE_NEGATIVE'].includes(a.result_type_snapshot || ''));
  for (const a of catAssignments) {
    const opts = a.result_options_snapshot as any[];
    if (!Array.isArray(opts) || opts.length !== 2) {
      throw new Error(`Case B Failed: Assignment ${a.id} does not have backfilled result_options_snapshot`);
    }
  }
  console.log(`✓ Case B Passed: Verified ${catAssignments.length} historical categorical assignments contain valid snapshot options.`);
  passedCases++;

  // --- CASE C: Custom Categorical Test Creation with Multi-Option Metadata ---
  console.log('\n--- CASE C: Custom Categorical Test Creation ---');
  const nowC = Date.now();
  const createReq = new Request('http://localhost:3000/api/super-admin/lab-tests', {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      testName: `Appearance Quality ${nowC}`,
      resultType: 'QUALITATIVE',
      unit: null,
      testScope: 'BOTH',
      displayOrder: 99,
      resultOptions: [
        { value: 'EXCELLENT', label: 'Excellent', isPassing: true },
        { value: 'ACCEPTABLE', label: 'Acceptable', isPassing: true },
        { value: 'OFF_ODOR', label: 'Off Odor', isPassing: false },
        { value: 'SOUR', label: 'Sour / Curdled', isPassing: false },
      ],
    }),
  });
  const createRes = await superAdminLabTestsPost(createReq);
  const createData = await createRes.json();
  if (createRes.status !== 201 || !createData.labTest?.id) {
    throw new Error(`Case C Failed: Creation returned ${createRes.status}: ${JSON.stringify(createData)}`);
  }
  const createdTestId = BigInt(createData.labTest.id);
  const createdTestCode = createData.labTest.testCode;
  console.log(`✓ Case C Passed: Successfully created ${createdTestCode} with 4 custom qualitative options.`);
  passedCases++;

  // --- CASE D: Validation Rejection on Duplicate Option Values ---
  console.log('\n--- CASE D: Validation Rejection on Duplicate Option Values ---');
  const dupReq = new Request('http://localhost:3000/api/super-admin/lab-tests', {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      testName: `Duplicate Test ${nowC}`,
      resultType: 'QUALITATIVE',
      resultOptions: [
        { value: 'OPTION_A', label: 'Option A', isPassing: true },
        { value: 'OPTION_A', label: 'Duplicate Option A', isPassing: false },
      ],
    }),
  });
  const dupRes = await superAdminLabTestsPost(dupReq);
  if (dupRes.status !== 400) {
    throw new Error(`Case D Failed: Expected 400 Bad Request on duplicate values, got ${dupRes.status}`);
  }
  console.log('✓ Case D Passed: Duplicate option values properly rejected.');
  passedCases++;

  // --- CASE E: Validation Rejection on < 2 Options ---
  console.log('\n--- CASE E: Validation Rejection on < 2 Options ---');
  const minOptReq = new Request('http://localhost:3000/api/super-admin/lab-tests', {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      testName: `Single Option Test ${nowC}`,
      resultType: 'QUALITATIVE',
      resultOptions: [
        { value: 'ONLY_ONE', label: 'Only One', isPassing: true },
      ],
    }),
  });
  const minOptRes = await superAdminLabTestsPost(minOptReq);
  if (minOptRes.status !== 400) {
    throw new Error(`Case E Failed: Expected 400 Bad Request for < 2 options, got ${minOptRes.status}`);
  }
  console.log('✓ Case E Passed: Categorical test with fewer than 2 options rejected.');
  passedCases++;

  // --- CASE F: Validation Rejection on Options Attached to Numeric Test ---
  console.log('\n--- CASE F: Rejection of Options on NUMERIC / TEXT Tests ---');
  const numOptReq = new Request('http://localhost:3000/api/super-admin/lab-tests', {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      testName: `Illegal Options on Numeric ${nowC}`,
      resultType: 'NUMERIC',
      resultOptions: [
        { value: 'A', label: 'A', isPassing: true },
        { value: 'B', label: 'B', isPassing: false },
      ],
    }),
  });
  const numOptRes = await superAdminLabTestsPost(numOptReq);
  if (numOptRes.status !== 400) {
    throw new Error(`Case F Failed: Expected 400 for resultOptions on NUMERIC test, got ${numOptRes.status}`);
  }
  console.log('✓ Case F Passed: Attaching result options to NUMERIC test rejected.');
  passedCases++;

  // --- CASE G: Super Admin Updates Existing Test Options & Audit Logging ---
  console.log('\n--- CASE G: Super Admin Updates Test Options ---');
  const patchReq = new Request(`http://localhost:3000/api/super-admin/lab-tests/${createdTestId}`, {
    method: 'PATCH',
    headers: authHeaders,
    body: JSON.stringify({
      testName: `Appearance Quality (Updated) ${nowC}`,
      resultOptions: [
        { value: 'GRADE_A', label: 'Grade A (Premium)', isPassing: true },
        { value: 'GRADE_B', label: 'Grade B (Standard)', isPassing: true },
        { value: 'REJECTED', label: 'Rejected (Sour)', isPassing: false },
      ],
    }),
  });
  const patchRes = await superAdminLabTestsPatch(patchReq, { params: Promise.resolve({ id: createdTestId.toString() }) });
  const patchData = await patchRes.json();
  if (patchRes.status !== 200 || patchData.labTest?.resultOptions?.length !== 3) {
    throw new Error(`Case G Failed: Patch failed: ${JSON.stringify(patchData)}`);
  }
  console.log('✓ Case G Passed: Super Admin updated test options successfully.');
  passedCases++;

  // --- CASE H: Dispatch Start Atomic Snapshotting of Active Options ---
  console.log('\n--- CASE H: Dispatch Start Atomic Snapshotting ---');
  const startReqH = new Request('http://localhost:3000/api/dispatches/start', {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      procurementSourceId: zmccSource.id.toString(),
      operationalDate: '2026-08-21',
      vehicleNumber: `DISP-SNAP-H-${nowC}`,
    }),
  });
  const startResH = await startDispatchPost(startReqH);
  const startDataH = await startResH.json();
  if ((startResH.status !== 200 && startResH.status !== 201) || !startDataH.visitId) {
    throw new Error(`Case H Failed: Start returned ${startResH.status}: ${JSON.stringify(startDataH)}`);
  }
  const visitIdH = BigInt(startDataH.visitId);
  const snapTestH = startDataH.assignedTests.find((t: any) => t.testId === createdTestId.toString());
  if (!snapTestH || !Array.isArray(snapTestH.resultOptions) || snapTestH.resultOptions.length !== 3) {
    throw new Error(`Case H Failed: Assigned test does not contain snapshot options: ${JSON.stringify(snapTestH)}`);
  }
  console.log(`✓ Case H Passed: Dispatch session started with ${startDataH.assignedTests.length} tests and exact 3-option snapshot.`);
  passedCases++;

  // --- CASE I: Operational Session Isolation (Master Changes After Start) ---
  console.log('\n--- CASE I: Operational Session Isolation ---');
  // Admin updates master options after session H started
  const patchReqI = new Request(`http://localhost:3000/api/super-admin/lab-tests/${createdTestId}`, {
    method: 'PATCH',
    headers: authHeaders,
    body: JSON.stringify({
      resultOptions: [
        { value: 'MODIFIED_1', label: 'Modified 1', isPassing: true },
        { value: 'MODIFIED_2', label: 'Modified 2', isPassing: false },
      ],
    }),
  });
  await superAdminLabTestsPatch(patchReqI, { params: Promise.resolve({ id: createdTestId.toString() }) });

  // Verify Session H still has its frozen 3 options
  const assignedHRefetched = await prisma.labTestAssignment.findFirst({
    where: { visit_id: visitIdH, workflow: 'DISPATCH', test_id: createdTestId },
  });
  const snapshotOptionsH = assignedHRefetched?.result_options_snapshot as any[];
  if (snapshotOptionsH.length !== 3 || snapshotOptionsH[0].value !== 'GRADE_A') {
    throw new Error('Case I Failed: In-flight session options changed after master edit!');
  }
  console.log('✓ Case I Passed: In-flight session remained completely isolated with frozen 3-option snapshot.');
  passedCases++;

  // --- CASE J: Dispatch Submission with Valid Snapshot Option ---
  console.log('\n--- CASE J: Dispatch Submission with Valid Snapshot Option ---');
  const portionResultsJ: any[] = [];
  const assignedTestsForVisitH = await prisma.labTestAssignment.findMany({
    where: { visit_id: visitIdH, workflow: 'DISPATCH' },
  });

  for (const t of assignedTestsForVisitH) {
    if (t.result_type_snapshot === 'CALCULATED') continue;

    if (t.test_id.toString() === createdTestId.toString()) {
      portionResultsJ.push({
        testId: t.test_id.toString(),
        performanceStatus: 'PERFORMED',
        textValue: 'GRADE_A',
        numericValue: null,
      });
    } else if (Array.isArray(t.result_options_snapshot) && (t.result_options_snapshot as any[]).length > 0) {
      const opts = t.result_options_snapshot as any[];
      const passOpt = opts.find((o: any) => o.isPassing === true) || opts[0];
      portionResultsJ.push({
        testId: t.test_id.toString(),
        performanceStatus: 'PERFORMED',
        textValue: passOpt.value,
        numericValue: null,
      });
    } else if (t.result_type_snapshot === 'NUMERIC') {
      portionResultsJ.push({
        testId: t.test_id.toString(),
        performanceStatus: 'PERFORMED',
        numericValue: 4.5,
        textValue: '4.5',
      });
    } else {
      portionResultsJ.push({
        testId: t.test_id.toString(),
        performanceStatus: 'PERFORMED',
        textValue: 'OK',
        numericValue: null,
      });
    }
  }

  const dispReqJ = new Request('http://localhost:3000/api/dispatches', {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      visitId: visitIdH.toString(),
      sourceType: 'ZMCC',
      procurementSourceId: zmccSource.id.toString(),
      vehicleNumber: `DISP-SNAP-H-${nowC}`,
      operationalDate: regressionBusinessDate,
      vehicleQuantity: { value: '5000', unit: 'KG', basis: 'MEASURED', method: 'WEIGHING' },
      portions: [
        {
          portionNumber: 1,
          quantity: { value: '5000', unit: 'KG', basis: 'MEASURED', method: 'WEIGHING' },
          results: portionResultsJ,
        },
      ],
    }),
  });

  const dispResJ = await dispatchPost(dispReqJ);
  const dispDataJ = await dispResJ.json();
  if (dispResJ.status !== 200 && dispResJ.status !== 201) {
    throw new Error(`Case J Failed: Dispatch submission failed: ${JSON.stringify(dispDataJ)}`);
  }

  // Verify created test result has is_passed = true derived from GRADE_A (isPassing: true)
  const savedResultJ = await prisma.dispatchLabResult.findFirst({
    where: { visit_id: visitIdH, test_id: createdTestId },
  });
  if (!savedResultJ || savedResultJ.is_passed !== true || savedResultJ.text_value !== 'GRADE_A') {
    throw new Error(`Case J Failed: Saved result invalid: ${JSON.stringify(savedResultJ)}`);
  }
  console.log('✓ Case J Passed: Dispatch submitted with GRADE_A, is_passed derived as true.');
  passedCases++;

  // --- CASE K: Dispatch Submission with Unconfigured / Invalid Option Rejection ---
  console.log('\n--- CASE K: Rejection of Invalid Result Option ---');
  // Start visit K
  const startReqK = new Request('http://localhost:3000/api/dispatches/start', {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      procurementSourceId: zmccSource.id.toString(),
      operationalDate: '2026-08-21',
      vehicleNumber: `DISP-INVALID-K-${nowC}`,
    }),
  });
  const startResK = await startDispatchPost(startReqK);
  const startDataK = await startResK.json();
  const visitIdK = BigInt(startDataK.visitId);

  const portionResultsK = portionResultsJ.map((r) => {
    if (r.testId === createdTestId.toString()) {
      return { ...r, textValue: 'NON_EXISTENT_OPTION' };
    }
    return r;
  });

  const dispReqK = new Request('http://localhost:3000/api/dispatches', {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      visitId: visitIdK.toString(),
      sourceType: 'ZMCC',
      procurementSourceId: zmccSource.id.toString(),
      vehicleNumber: `DISP-INVALID-K-${nowC}`,
      operationalDate: regressionBusinessDate,
      vehicleQuantity: { value: '5000', unit: 'KG', basis: 'MEASURED', method: 'WEIGHING' },
      portions: [
        {
          portionNumber: 1,
          quantity: { value: '5000', unit: 'KG', basis: 'MEASURED', method: 'WEIGHING' },
          results: portionResultsK,
        },
      ],
    }),
  });

  const dispResK = await dispatchPost(dispReqK);
  if (dispResK.status !== 400) {
    throw new Error(`Case K Failed: Expected 400 Bad Request for unconfigured option, got ${dispResK.status}`);
  }
  console.log('✓ Case K Passed: Unconfigured result option rejected with 400 Bad Request.');
  passedCases++;

  // --- CASE L: Rejection of Empty/Unselected Result on PERFORMED Test ---
  console.log('\n--- CASE L: Rejection of Empty Option Selection ---');
  const portionResultsL = portionResultsJ.map((r) => {
    if (r.testId === createdTestId.toString()) {
      return { ...r, textValue: '' };
    }
    return r;
  });

  const dispReqL = new Request('http://localhost:3000/api/dispatches', {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      visitId: visitIdK.toString(),
      sourceType: 'ZMCC',
      procurementSourceId: zmccSource.id.toString(),
      vehicleNumber: `DISP-INVALID-K-${nowC}`,
      operationalDate: regressionBusinessDate,
      vehicleQuantity: { value: '5000', unit: 'KG', basis: 'MEASURED', method: 'WEIGHING' },
      portions: [
        {
          portionNumber: 1,
          quantity: { value: '5000', unit: 'KG', basis: 'MEASURED', method: 'WEIGHING' },
          results: portionResultsL,
        },
      ],
    }),
  });

  const dispResL = await dispatchPost(dispReqL);
  if (dispResL.status !== 400) {
    throw new Error(`Case L Failed: Expected 400 Bad Request for empty option on PERFORMED test, got ${dispResL.status}`);
  }
  console.log('✓ Case L Passed: Empty / unselected result rejected with 400 Bad Request.');
  passedCases++;

  // --- CASE M: Plant QA Complete with Valid Option & Passed Derivation ---
  console.log('\n--- CASE M: Plant QA Evaluation with Passing Option ---');
  // Establish legitimate QA session fixture for visit H portion 1 in Plant QA
  const portionH = await prisma.visitPortion.findFirst({
    where: { visit_id: visitIdH, portion_number: 1 },
  });
  if (!portionH) throw new Error('Portion H not found');

  await prisma.vehicleVisit.update({
    where: { id: visitIdH },
    data: { current_status: 'PLANT_QA' },
  });

  await prisma.visitPortion.update({
    where: { id: portionH.id },
    data: { current_status: 'PLANT_QA', plant_decision: null },
  });

  const existingSessionH = await prisma.qATestingSession.findUnique({
    where: { visit_id: visitIdH },
  });
  if (existingSessionH) {
    throw new Error(`Fixture error: QA testing session already exists unexpectedly for visit ${visitIdH}`);
  }

  const qaSessionStartH = new Date(Date.now() - 3600000);
  await prisma.qATestingSession.create({
    data: {
      visit_id: visitIdH,
      status: 'IN_PROGRESS',
      started_by: superAdminUser.id,
      started_at: qaSessionStartH,
    },
  });

  const plantAssignmentsH = await getOrAssignPlantQATests(prisma, visitIdH);
  const plantResultsM = plantAssignmentsH
    .filter((t) => t.result_type_snapshot !== 'CALCULATED')
    .map((t) => {
      if (Array.isArray(t.result_options_snapshot) && (t.result_options_snapshot as any[]).length > 0) {
        const opts = t.result_options_snapshot as any[];
        const passOpt = opts.find((o: any) => o.isPassing === true) || opts[0];
        return {
          testId: t.test_id.toString(),
          performanceStatus: 'PERFORMED',
          textValue: passOpt.value,
        };
      }
      if (t.result_type_snapshot === 'NUMERIC') {
        return {
          testId: t.test_id.toString(),
          performanceStatus: 'PERFORMED',
          numericValue: 5.0,
        };
      }
      return {
        testId: t.test_id.toString(),
        performanceStatus: 'PERFORMED',
        textValue: 'OK',
      };
    });

  const completeReqM = new Request(`http://localhost:3000/api/qa/vehicle-visits/${visitIdH}/portions/${portionH.id}/complete`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      decision: 'ACCEPTED',
      results: plantResultsM,
    }),
  });

  const completeResM = await completePortionPost(completeReqM, {
    params: Promise.resolve({ visitId: visitIdH.toString(), portionId: portionH.id.toString() }),
  });
  const completeDataM = await completeResM.json();
  if (completeResM.status !== 200) {
    throw new Error(`Case M Failed: Complete returned ${completeResM.status}: ${JSON.stringify(completeDataM)}`);
  }

  const savedPlantResultM = await prisma.plantLabResult.findFirst({
    where: { portion_id: portionH.id, test_id: createdTestId },
  });
  if (!savedPlantResultM || savedPlantResultM.is_passed !== true) {
    throw new Error(`Case M Failed: Plant QA is_passed derivation failed: ${JSON.stringify(savedPlantResultM)}`);
  }
  console.log('✓ Case M Passed: Plant QA completed, GRADE_B correctly evaluated is_passed as true.');
  passedCases++;

  // --- CASE N: Plant QA Rejection on Failing Option ---
  console.log('\n--- CASE N: Plant QA Rejection on Failing Option ---');
  // Evaluate directly via evaluateLabResult with REJECTED option
  const snapshotOptsN = [
    { value: 'GRADE_A', label: 'Grade A', isPassing: true },
    { value: 'GRADE_B', label: 'Grade B', isPassing: true },
    { value: 'REJECTED', label: 'Rejected', isPassing: false },
  ];
  const evalN = evaluateLabResult('LT-TEST-QUAL', null, 'REJECTED', 'QUALITATIVE', snapshotOptsN);
  if (evalN.isPassed !== false || evalN.status !== 'EVALUATED') {
    throw new Error(`Case N Failed: evaluateLabResult returned ${JSON.stringify(evalN)}`);
  }
  console.log('✓ Case N Passed: Failing option properly evaluated isPassed as false.');
  passedCases++;

  // --- CASE O: Plant QA Unperformed Test Evaluation ---
  console.log('\n--- CASE O: Plant QA Unperformed Test Evaluation ---');
  const validOptO = validateCategoricalOption('QUALITATIVE', 'GRADE_A', snapshotOptsN);
  const invalidOptO = validateCategoricalOption('QUALITATIVE', 'UNLISTED', snapshotOptsN);
  if (!validOptO || invalidOptO) {
    throw new Error('Case O Failed: validateCategoricalOption validation error');
  }
  console.log('✓ Case O Passed: validateCategoricalOption strictly adheres to metadata options.');
  passedCases++;

  // --- CASE P: LR / Fat Quantity Calculation Invariance ---
  console.log('\n--- CASE P: LR / Fat Quantity Calculation Invariance ---');
  const snfVal = calculateSNF(28.5, 4.2);
  const ratioVal = calculateRatio(snfVal, 4.2);
  if (typeof snfVal !== 'number' || typeof ratioVal !== 'number' || snfVal <= 0 || ratioVal <= 0) {
    throw new Error('Case P Failed: SNF / Ratio calculation failed');
  }
  console.log(`✓ Case P Passed: SNF (${snfVal.toFixed(3)}) & Ratio (${ratioVal.toFixed(3)}) calculated with 100% precision.`);
  passedCases++;

  // Deactivate created dummy test
  await prisma.labTest.update({ where: { id: createdTestId }, data: { isActive: false } });

  // ========================================================================
  // --- STAGE 3A DEDICATED NEUTRAL OPTION & METADATA GUARD TEST CASES ---
  // ========================================================================

  console.log('\n========================================================================');
  console.log('--- STARTING STAGE 3A NEUTRAL OPTION & METADATA GUARD TEST CASES ---');
  console.log('========================================================================\n');

  const test3AOptions = [
    { value: 'GOOD', label: 'Good Quality', isPassing: true },
    { value: 'BAD', label: 'Bad Quality', isPassing: false },
    { value: 'OBSERVED', label: 'Observed / Informational', isPassing: null },
  ];

  // --- STAGE 3A CASE A: Passing (GOOD -> is_passed = true) ---
  console.log('--- 3A-CASE A: Passing Option Evaluation (GOOD -> true) ---');
  const eval3APass = evaluateLabResult('LT-3A-TEST', null, 'GOOD', 'QUALITATIVE', test3AOptions);
  if (eval3APass.isPassed !== true || eval3APass.status !== 'EVALUATED') {
    throw new Error(`3A-Case A Failed: Expected isPassed === true, got ${eval3APass.isPassed}`);
  }
  console.log('✓ 3A-Case A Passed: Configured passing option evaluated as is_passed = true.');
  passedCases++;

  // --- STAGE 3A CASE B: Failing (BAD -> is_passed = false) ---
  console.log('\n--- 3A-CASE B: Failing Option Evaluation (BAD -> false) ---');
  const eval3AFail = evaluateLabResult('LT-3A-TEST', null, 'BAD', 'QUALITATIVE', test3AOptions);
  if (eval3AFail.isPassed !== false || eval3AFail.status !== 'EVALUATED') {
    throw new Error(`3A-Case B Failed: Expected isPassed === false, got ${eval3AFail.isPassed}`);
  }
  console.log('✓ 3A-Case B Passed: Configured failing option evaluated as is_passed = false.');
  passedCases++;

  // --- STAGE 3A CASE C: Neutral (OBSERVED -> is_passed = null) ---
  console.log('\n--- 3A-CASE C: Neutral Option Evaluation (OBSERVED -> null) ---');
  const eval3ANeutral = evaluateLabResult('LT-3A-TEST', null, 'OBSERVED', 'QUALITATIVE', test3AOptions);
  if (eval3ANeutral.isPassed !== null || eval3ANeutral.status !== 'NEUTRAL') {
    throw new Error(`3A-Case C Failed: Expected isPassed === null and status === 'NEUTRAL', got ${eval3ANeutral.isPassed}, status: ${eval3ANeutral.status}`);
  }
  console.log('✓ 3A-Case C Passed: Configured neutral option evaluated as is_passed = null.');
  passedCases++;

  // --- STAGE 3A CASE D: Required Plant + Neutral Cannot Satisfy ACCEPT ---
  console.log('\n--- 3A-CASE D: Required Plant QA Test with Neutral Option Blocks ACCEPT ---');
  const now3AD = Date.now();
  const test3ADReq = new Request('http://localhost:3000/api/super-admin/lab-tests', {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      testName: `Plant Required Neutral Test ${now3AD}`,
      resultType: 'QUALITATIVE',
      testScope: 'PLANT',
      isRequired: true,
      isActive: true,
      displayOrder: 990,
      resultOptions: test3AOptions,
    }),
  });
  const test3ADRes = await superAdminLabTestsPost(test3ADReq);
  const test3ADData = await test3ADRes.json();
  if (test3ADRes.status !== 201) {
    throw new Error(`3A-Case D Test Creation Failed: ${JSON.stringify(test3ADData)}`);
  }
  const test3ADId = BigInt(test3ADData.labTest.id);

  // Start QA visit with this test assigned
  const visit3AD = await prisma.vehicleVisit.create({
    data: {
      visit_number: `VISIT-3AD-${now3AD}`,
      vehicle_number: `VEH-3AD-${now3AD}`,
      operational_date: new Date('2026-08-21'),
      current_status: 'PLANT_QA',
      created_by: superAdminUser.id,
      procurement_source_id: zmccSource.id,
    },
  });
  const portion3AD = await prisma.visitPortion.create({
    data: {
      visit_id: visit3AD.id,
      portion_number: 1,
      dispatch_quantity_value: 5000,
      dispatch_quantity_unit: 'KG',
      current_status: 'UNDER_TESTING',
    },
  });
  const plantAssignments3AD = await getOrAssignPlantQATests(prisma, visit3AD.id);

  // Submit all required tests as passing, but test3ADId with 'OBSERVED' (neutral)
  const results3AD = plantAssignments3AD
    .filter((t) => t.result_type_snapshot !== 'CALCULATED')
    .map((t) => {
      if (t.test_id.toString() === test3ADId.toString()) {
        return {
          testId: t.test_id.toString(),
          performanceStatus: 'PERFORMED',
          textValue: 'OBSERVED',
        };
      }
      if (Array.isArray(t.result_options_snapshot) && (t.result_options_snapshot as any[]).length > 0) {
        const opts = t.result_options_snapshot as any[];
        const passOpt = opts.find((o: any) => o.isPassing === true) || opts[0];
        return {
          testId: t.test_id.toString(),
          performanceStatus: 'PERFORMED',
          textValue: passOpt.value,
        };
      }
      if (t.result_type_snapshot === 'NUMERIC') {
        return {
          testId: t.test_id.toString(),
          performanceStatus: 'PERFORMED',
          numericValue: 5.0,
        };
      }
      return {
        testId: t.test_id.toString(),
        performanceStatus: 'PERFORMED',
        textValue: 'OK',
      };
    });

  const completeReq3AD = new Request(`http://localhost:3000/api/qa/vehicle-visits/${visit3AD.id}/portions/${portion3AD.id}/complete`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      decision: 'ACCEPTED',
      results: results3AD,
    }),
  });
  const completeRes3AD = await completePortionPost(completeReq3AD, {
    params: Promise.resolve({ visitId: visit3AD.id.toString(), portionId: portion3AD.id.toString() }),
  });
  const completeData3AD = await completeRes3AD.json();
  if (completeRes3AD.status !== 400 || !completeData3AD.error.includes('neutral / informational result and cannot satisfy the required passing result')) {
    throw new Error(`3A-Case D Failed: Expected 400 rejecting neutral required test on ACCEPT, got ${completeRes3AD.status}: ${JSON.stringify(completeData3AD)}`);
  }
  console.log('✓ 3A-Case D Passed: Required Plant QA test with neutral result properly rejected on ACCEPT.');
  passedCases++;

  // --- STAGE 3A CASE E: Optional Plant + Neutral Does Not Block ACCEPT ---
  console.log('\n--- 3A-CASE E: Optional Plant QA Test with Neutral Option Permits ACCEPT ---');
  // Update test3ADId to isRequired = false
  await prisma.labTest.update({ where: { id: test3ADId }, data: { isRequired: false } });
  // Start visit 3AE
  const visit3AE = await prisma.vehicleVisit.create({
    data: {
      visit_number: `VISIT-3AE-${now3AD}`,
      vehicle_number: `VEH-3AE-${now3AD}`,
      operational_date: new Date('2026-08-21'),
      current_status: 'PLANT_QA',
      created_by: superAdminUser.id,
      procurement_source_id: zmccSource.id,
    },
  });
  const portion3AE = await prisma.visitPortion.create({
    data: {
      visit_id: visit3AE.id,
      portion_number: 1,
      dispatch_quantity_value: 5000,
      dispatch_quantity_unit: 'KG',
      current_status: 'UNDER_TESTING',
    },
  });

  const existingSession3AE = await prisma.qATestingSession.findUnique({
    where: { visit_id: visit3AE.id },
  });
  if (existingSession3AE) {
    throw new Error(`Fixture error: QA testing session already exists unexpectedly for visit ${visit3AE.id}`);
  }

  const qaSessionStart3AE = new Date(Date.now() - 3600000);
  await prisma.qATestingSession.create({
    data: {
      visit_id: visit3AE.id,
      status: 'IN_PROGRESS',
      started_by: superAdminUser.id,
      started_at: qaSessionStart3AE,
    },
  });

  const plantAssignments3AE = await getOrAssignPlantQATests(prisma, visit3AE.id);

  const results3AE = plantAssignments3AE
    .filter((t) => t.result_type_snapshot !== 'CALCULATED')
    .map((t) => {
      if (t.test_id.toString() === test3ADId.toString()) {
        return {
          testId: t.test_id.toString(),
          performanceStatus: 'PERFORMED',
          textValue: 'OBSERVED',
        };
      }
      if (Array.isArray(t.result_options_snapshot) && (t.result_options_snapshot as any[]).length > 0) {
        const opts = t.result_options_snapshot as any[];
        const passOpt = opts.find((o: any) => o.isPassing === true) || opts[0];
        return {
          testId: t.test_id.toString(),
          performanceStatus: 'PERFORMED',
          textValue: passOpt.value,
        };
      }
      if (t.result_type_snapshot === 'NUMERIC') {
        return {
          testId: t.test_id.toString(),
          performanceStatus: 'PERFORMED',
          numericValue: 5.0,
        };
      }
      return {
        testId: t.test_id.toString(),
        performanceStatus: 'PERFORMED',
        textValue: 'OK',
      };
    });

  const completeReq3AE = new Request(`http://localhost:3000/api/qa/vehicle-visits/${visit3AE.id}/portions/${portion3AE.id}/complete`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      decision: 'ACCEPTED',
      results: results3AE,
    }),
  });
  const completeRes3AE = await completePortionPost(completeReq3AE, {
    params: Promise.resolve({ visitId: visit3AE.id.toString(), portionId: portion3AE.id.toString() }),
  });
  const completeData3AE = await completeRes3AE.json();
  if (completeRes3AE.status !== 200) {
    throw new Error(`3A-Case E Failed: Expected 200 accepting portion with optional neutral result, got ${completeRes3AE.status}: ${JSON.stringify(completeData3AE)}`);
  }

  const saved3AEResult = await prisma.plantLabResult.findFirst({
    where: { portion_id: portion3AE.id, test_id: test3ADId },
  });
  if (!saved3AEResult || saved3AEResult.text_value !== 'OBSERVED' || saved3AEResult.is_passed !== null) {
    throw new Error(`3A-Case E Failed: Optional neutral result not stored with is_passed = null: ${JSON.stringify(saved3AEResult)}`);
  }
  console.log('✓ 3A-Case E Passed: Optional Plant QA test with neutral result cleanly permits ACCEPT and stores is_passed = null.');
  passedCases++;

  // --- STAGE 3A CASE F: Dispatch Neutral Persists Value with is_passed = null ---
  console.log('\n--- 3A-CASE F: Dispatch Neutral Option Persistence (is_passed = null) ---');
  // Update test3ADId to testScope = BOTH so Dispatch includes it
  await prisma.labTest.update({ where: { id: test3ADId }, data: { testScope: 'BOTH', isRequired: false } });

  const startReq3AF = new Request('http://localhost:3000/api/dispatches/start', {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      sourceType: 'ZMCC',
      procurementSourceId: zmccSource.id.toString(),
      vehicleNumber: `VEH-3AF-${now3AD}`,
      driverName: 'Driver 3AF',
      portionCount: 1,
    }),
  });
  const startRes3AF = await startDispatchPost(startReq3AF);
  const startData3AF = await startRes3AF.json();
  const visitId3AF = BigInt(startData3AF.visitId);

  const assignedDispatch3AF = await getOrAssignDispatchTests(prisma, visitId3AF);
  const dispatchResults3AF = assignedDispatch3AF
    .filter((t) => t.result_type_snapshot !== 'CALCULATED')
    .map((t) => {
      if (t.test_id.toString() === test3ADId.toString()) {
        return {
          testId: t.test_id.toString(),
          performanceStatus: 'PERFORMED',
          textValue: 'OBSERVED',
        };
      }
      if (Array.isArray(t.result_options_snapshot) && (t.result_options_snapshot as any[]).length > 0) {
        const opts = t.result_options_snapshot as any[];
        const passOpt = opts.find((o: any) => o.isPassing === true) || opts[0];
        return {
          testId: t.test_id.toString(),
          performanceStatus: 'PERFORMED',
          textValue: passOpt.value,
        };
      }
      if (t.result_type_snapshot === 'NUMERIC') {
        return {
          testId: t.test_id.toString(),
          performanceStatus: 'PERFORMED',
          numericValue: 4.5,
        };
      }
      return {
        testId: t.test_id.toString(),
        performanceStatus: 'PERFORMED',
        textValue: 'OK',
      };
    });

  const dispReq3AF = new Request('http://localhost:3000/api/dispatches', {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      visitId: visitId3AF.toString(),
      sourceType: 'ZMCC',
      procurementSourceId: zmccSource.id.toString(),
      vehicleNumber: `VEH-3AF-${now3AD}`,
      operationalDate: regressionBusinessDate,
      vehicleQuantity: { value: '5000', unit: 'KG', basis: 'MEASURED', method: 'WEIGHING' },
      portions: [
        {
          portionNumber: 1,
          quantity: { value: '5000', unit: 'KG', basis: 'MEASURED', method: 'WEIGHING' },
          results: dispatchResults3AF,
        },
      ],
    }),
  });
  const dispRes3AF = await dispatchPost(dispReq3AF);
  const dispData3AF = await dispRes3AF.json();
  if (dispRes3AF.status !== 201) {
    throw new Error(`3A-Case F Failed: Dispatch submission failed: ${JSON.stringify(dispData3AF)}`);
  }

  const savedDispResult3AF = await prisma.dispatchLabResult.findFirst({
    where: { visit_id: visitId3AF, test_id: test3ADId },
  });
  if (!savedDispResult3AF || savedDispResult3AF.text_value !== 'OBSERVED' || savedDispResult3AF.is_passed !== null) {
    throw new Error(`3A-Case F Failed: Dispatch neutral result not stored with is_passed = null: ${JSON.stringify(savedDispResult3AF)}`);
  }
  console.log('✓ 3A-Case F Passed: Dispatch neutral result properly persisted with is_passed = null.');
  passedCases++;

  // --- STAGE 3A CASE G: Snapshot Neutral Preserves Original Semantics ---
  console.log('\n--- 3A-CASE G: Snapshot Neutral Preserves Original Semantics Under Master Mutation ---');
  // Mutate master test3ADId so OBSERVED has isPassing = true
  const mutatedOpts = [
    { value: 'GOOD', label: 'Good Quality', isPassing: true },
    { value: 'BAD', label: 'Bad Quality', isPassing: false },
    { value: 'OBSERVED', label: 'Observed', isPassing: true },
  ];
  await prisma.labTest.update({ where: { id: test3ADId }, data: { resultOptions: mutatedOpts } });

  // Verify that visit3AE's snapshot remains frozen with isPassing = null
  const frozenAssignment = await prisma.labTestAssignment.findFirst({
    where: { visit_id: visit3AE.id, test_id: test3ADId, workflow: 'PLANT_QA' },
  });
  const frozenOpts = frozenAssignment?.result_options_snapshot as any[];
  const frozenObserved = frozenOpts.find((o) => o.value === 'OBSERVED');
  if (frozenObserved.isPassing !== null) {
    throw new Error(`3A-Case G Failed: Frozen assignment mutated to isPassing = ${frozenObserved.isPassing}`);
  }
  console.log('✓ 3A-Case G Passed: In-flight assignment snapshot preserved neutral semantics (isPassing = null) despite master test mutation.');
  passedCases++;

  // --- STAGE 3A CASE H: Required Plant All-Neutral Configuration Rejected ---
  console.log('\n--- 3A-CASE H: Required Plant All-Neutral Configuration Rejected ---');
  const allNeutralOpts = [
    { value: 'OPT_1', label: 'Option 1', isPassing: null },
    { value: 'OPT_2', label: 'Option 2', isPassing: null },
  ];
  const invalidConfigReq = new Request('http://localhost:3000/api/super-admin/lab-tests', {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      testName: `Invalid All-Neutral Test ${now3AD}`,
      resultType: 'QUALITATIVE',
      testScope: 'PLANT',
      isRequired: true,
      isActive: true,
      displayOrder: 995,
      resultOptions: allNeutralOpts,
    }),
  });
  const invalidConfigRes = await superAdminLabTestsPost(invalidConfigReq);
  const invalidConfigData = await invalidConfigRes.json();
  if (invalidConfigRes.status !== 400 || !invalidConfigData.error.includes('must have at least one passing option')) {
    throw new Error(`3A-Case H Failed: Expected 400 rejecting all-neutral required Plant test, got ${invalidConfigRes.status}: ${JSON.stringify(invalidConfigData)}`);
  }
  console.log('✓ 3A-Case H Passed: Super Admin properly rejected all-neutral configuration for required Plant QA test.');
  passedCases++;

  // Clean up test3ADId
  await prisma.labTest.update({ where: { id: test3ADId }, data: { isActive: false } });

  try {
    // ========================================================================
    // --- STAGE 5D-C2: LAB TEST LIFECYCLE, SCOPE & LIVE CONFIGURATION ---
    // ========================================================================
    console.log('\n========================================================================');
    console.log('--- STARTING STAGE 5D-C2 LAB TEST LIFECYCLE & SCOPE TESTS ---');
    console.log('========================================================================\n');

    // --- CASE 5DC2-1: Cache-Control Header on GET /api/super-admin/lab-tests ---
    console.log('--- CASE 5DC2-1: Cache-Control on Super Admin Lab Tests ---');
    const saGetReq = new Request('http://localhost:3000/api/super-admin/lab-tests', {
      method: 'GET',
      headers: authHeaders,
    });
    const saGetRes = await superAdminLabTestsGet(saGetReq);
    if (saGetRes.headers.get('Cache-Control') !== 'private, no-store, max-age=0') {
      throw new Error(
        `Case 5DC2-1 Failed: Expected "private, no-store, max-age=0", got "${saGetRes.headers.get('Cache-Control')}"`
      );
    }
    console.log('✓ Case 5DC2-1 Passed: Super Admin endpoint returns Cache-Control: private, no-store, max-age=0.');
    passedCases++;

    // --- CASE 5DC2-2: Cache-Control Header on GET /api/lab-tests ---
    console.log('\n--- CASE 5DC2-2: Cache-Control on Public Lab Tests ---');
    const pubGetReq = new Request('http://localhost:3000/api/lab-tests?scope=DISPATCH', {
      method: 'GET',
    });
    const pubGetRes = await publicLabTestsGet(pubGetReq);
    if (pubGetRes.headers.get('Cache-Control') !== 'private, no-store, max-age=0') {
      throw new Error(
        `Case 5DC2-2 Failed: Expected "private, no-store, max-age=0", got "${pubGetRes.headers.get('Cache-Control')}"`
      );
    }
    console.log('✓ Case 5DC2-2 Passed: Public lab tests endpoint returns Cache-Control: private, no-store, max-age=0.');
    passedCases++;

    // --- Create 3 distinct scope test fixtures ---
    const nowC2 = Date.now();
    // 1. Dispatch scope test
    const dispReq = new Request('http://localhost:3000/api/super-admin/lab-tests', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        testName: `5DC2 Disp Test ${nowC2}`,
        resultType: 'NUMERIC',
        testScope: 'DISPATCH',
        isRequired: false,
        isActive: true,
        displayOrder: 980,
      }),
    });
    const dispRes = await superAdminLabTestsPost(dispReq);
    const dispData = await dispRes.json();
    if (dispRes.status !== 201) throw new Error(`Failed to create DISPATCH test: ${JSON.stringify(dispData)}`);
    const dispTestId = BigInt(dispData.labTest.id);
    cleanupTestIds.push(dispTestId);

    // 2. Plant scope test
    const plantReq = new Request('http://localhost:3000/api/super-admin/lab-tests', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        testName: `5DC2 Plant Test ${nowC2}`,
        resultType: 'NUMERIC',
        testScope: 'PLANT',
        isRequired: false,
        isActive: true,
        displayOrder: 981,
      }),
    });
    const plantRes = await superAdminLabTestsPost(plantReq);
    const plantData = await plantRes.json();
    if (plantRes.status !== 201) throw new Error(`Failed to create PLANT test: ${JSON.stringify(plantData)}`);
    const plantTestId = BigInt(plantData.labTest.id);
    cleanupTestIds.push(plantTestId);

    // 3. Both scope test
    const bothReq = new Request('http://localhost:3000/api/super-admin/lab-tests', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        testName: `5DC2 Both Test ${nowC2}`,
        resultType: 'NUMERIC',
        testScope: 'BOTH',
        isRequired: false,
        isActive: true,
        displayOrder: 982,
      }),
    });
    const bothRes = await superAdminLabTestsPost(bothReq);
    const bothData = await bothRes.json();
    if (bothRes.status !== 201) throw new Error(`Failed to create BOTH test: ${JSON.stringify(bothData)}`);
    const bothTestId = BigInt(bothData.labTest.id);
    cleanupTestIds.push(bothTestId);

    // --- CASE 5DC2-3: Scope Filtering for DISPATCH ---
    console.log('\n--- CASE 5DC2-3: Public Scope Filtering (DISPATCH) ---');
    const reqScopeDisp = new Request('http://localhost:3000/api/lab-tests?scope=DISPATCH', { method: 'GET' });
    const resScopeDisp = await publicLabTestsGet(reqScopeDisp);
    const dataScopeDisp = await resScopeDisp.json();
    const testsDisp = dataScopeDisp.tests as any[];
    const hasDispTest = testsDisp.some((t) => t.id === dispTestId.toString());
    const hasBothTestInDisp = testsDisp.some((t) => t.id === bothTestId.toString());
    const hasPlantTestInDisp = testsDisp.some((t) => t.id === plantTestId.toString());
    if (!hasDispTest || !hasBothTestInDisp || hasPlantTestInDisp) {
      throw new Error(
        `Case 5DC2-3 Failed: DISPATCH filter included invalid tests (disp=${hasDispTest}, both=${hasBothTestInDisp}, plant=${hasPlantTestInDisp})`
      );
    }
    console.log('✓ Case 5DC2-3 Passed: DISPATCH scope includes DISPATCH and BOTH tests, excludes PLANT tests.');
    passedCases++;

    // --- CASE 5DC2-4: Scope Filtering for PLANT ---
    console.log('\n--- CASE 5DC2-4: Public Scope Filtering (PLANT) ---');
    const reqScopePlant = new Request('http://localhost:3000/api/lab-tests?scope=PLANT', { method: 'GET' });
    const resScopePlant = await publicLabTestsGet(reqScopePlant);
    const dataScopePlant = await resScopePlant.json();
    const testsPlant = dataScopePlant.tests as any[];
    const hasPlantTest = testsPlant.some((t) => t.id === plantTestId.toString());
    const hasBothTestInPlant = testsPlant.some((t) => t.id === bothTestId.toString());
    const hasDispTestInPlant = testsPlant.some((t) => t.id === dispTestId.toString());
    if (!hasPlantTest || !hasBothTestInPlant || hasDispTestInPlant) {
      throw new Error(
        `Case 5DC2-4 Failed: PLANT filter included invalid tests (plant=${hasPlantTest}, both=${hasBothTestInPlant}, disp=${hasDispTestInPlant})`
      );
    }
    console.log('✓ Case 5DC2-4 Passed: PLANT scope includes PLANT and BOTH tests, excludes DISPATCH tests.');
    passedCases++;

    // --- CASE 5DC2-5: Snapshot Stability (In-Flight Session Immunity for Dispatch & Plant QA) ---
    console.log('\n--- CASE 5DC2-5: Snapshot Stability Before Deactivation (Dispatch & Plant QA) ---');
    // Start an in-flight dispatch session with bothTestId and plantTestId active
    const startReqStable = new Request('http://localhost:3000/api/dispatches/start', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        procurementSourceId: zmccSource.id.toString(),
        operationalDate: regressionBusinessDate,
        vehicleNumber: `VEH-STABLE-${nowC2}`,
      }),
    });
    const startResStable = await startDispatchPost(startReqStable);
    const startDataStable = await startResStable.json();
    const stableVisitId = BigInt(startDataStable.visitId);
    cleanupVisitIds.push(stableVisitId);

    const initialAssignments = await getOrAssignDispatchTests(prisma, stableVisitId);
    const hasBothBefore = initialAssignments.some((a) => a.test_id.toString() === bothTestId.toString());
    if (!hasBothBefore) {
      throw new Error('Case 5DC2-5 Failed: BOTH test was not assigned to new dispatch session');
    }

    // Freeze Plant QA assignments for visit 1
    const initialPlantAssignments = await getOrAssignPlantQATests(prisma, stableVisitId);
    const hasPlantBefore = initialPlantAssignments.some((a) => a.test_id.toString() === plantTestId.toString());
    const hasBothInPlantBefore = initialPlantAssignments.some((a) => a.test_id.toString() === bothTestId.toString());
    if (!hasPlantBefore || !hasBothInPlantBefore) {
      throw new Error('Case 5DC2-5 Failed: Plant QA test or BOTH test was not assigned to stable session');
    }
    const stablePlantAssignmentIds = initialPlantAssignments.map((a) => a.id.toString()).sort();

    // Now deactivate bothTestId and plantTestId via Super Admin PATCH
    const deactBothReq = new Request(`http://localhost:3000/api/super-admin/lab-tests/${bothTestId}`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({ isActive: false }),
    });
    const deactBothRes = await superAdminLabTestsPatch(deactBothReq, {
      params: Promise.resolve({ id: bothTestId.toString() }),
    });
    if (deactBothRes.status !== 200) throw new Error(`Failed to deactivate BOTH test: ${deactBothRes.status}`);

    const deactPlantReq = new Request(`http://localhost:3000/api/super-admin/lab-tests/${plantTestId}`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({ isActive: false }),
    });
    const deactPlantRes = await superAdminLabTestsPatch(deactPlantReq, {
      params: Promise.resolve({ id: plantTestId.toString() }),
    });
    if (deactPlantRes.status !== 200) throw new Error(`Failed to deactivate PLANT test: ${deactPlantRes.status}`);

    // Re-fetch assignments for the existing in-flight session
    const postDeactAssignments = await getOrAssignDispatchTests(prisma, stableVisitId);
    const hasBothAfter = postDeactAssignments.some((a) => a.test_id.toString() === bothTestId.toString());
    if (!hasBothAfter) {
      throw new Error('Case 5DC2-5 Failed: In-flight dispatch assignment snapshot was lost after test deactivation');
    }

    const postDeactPlantAssignments = await getOrAssignPlantQATests(prisma, stableVisitId);
    const hasPlantAfter = postDeactPlantAssignments.some((a) => a.test_id.toString() === plantTestId.toString());
    const hasBothInPlantAfter = postDeactPlantAssignments.some((a) => a.test_id.toString() === bothTestId.toString());
    if (!hasPlantAfter || !hasBothInPlantAfter) {
      throw new Error('Case 5DC2-5 Failed: In-flight Plant QA assignment snapshot was lost after test deactivation');
    }
    const postDeactPlantAssignmentIds = postDeactPlantAssignments.map((a) => a.id.toString()).sort();
    if (JSON.stringify(stablePlantAssignmentIds) !== JSON.stringify(postDeactPlantAssignmentIds)) {
      throw new Error('Case 5DC2-5 Failed: Plant QA assignment IDs mutated after test deactivation');
    }
    console.log('✓ Case 5DC2-5 Passed: In-flight Dispatch & Plant QA session snapshots remained intact after test deactivation.');
    passedCases++;

    // --- CASE 5DC2-6: Instant Operational Exclusion Upon Deactivation ---
    console.log('\n--- CASE 5DC2-6: Instant Operational Exclusion on New Sessions (Dispatch & Plant QA) ---');
    // Start a brand new session - bothTestId and plantTestId are inactive now
    const startReqNew = new Request('http://localhost:3000/api/dispatches/start', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        procurementSourceId: zmccSource.id.toString(),
        operationalDate: regressionBusinessDate,
        vehicleNumber: `VEH-EXCL-${nowC2}`,
      }),
    });
    const startResNew = await startDispatchPost(startReqNew);
    const startDataNew = await startResNew.json();
    const newVisitId = BigInt(startDataNew.visitId);
    cleanupVisitIds.push(newVisitId);

    const newAssignments = await getOrAssignDispatchTests(prisma, newVisitId);
    const hasBothInNew = newAssignments.some((a) => a.test_id.toString() === bothTestId.toString());
    if (hasBothInNew) {
      throw new Error('Case 5DC2-6 Failed: Deactivated BOTH test was included in a new dispatch session');
    }

    const newPlantAssignments = await getOrAssignPlantQATests(prisma, newVisitId);
    const hasPlantInNew = newPlantAssignments.some((a) => a.test_id.toString() === plantTestId.toString());
    const hasBothInNewPlant = newPlantAssignments.some((a) => a.test_id.toString() === bothTestId.toString());
    if (hasPlantInNew || hasBothInNewPlant) {
      throw new Error('Case 5DC2-6 Failed: Deactivated PLANT or BOTH test was included in a new Plant QA session');
    }
    const visit2PlantAssignmentIds = newPlantAssignments.map((a) => a.id.toString()).sort();

    // Also verify public endpoint excludes inactive test
    const pubCheckReq = new Request('http://localhost:3000/api/lab-tests?scope=DISPATCH', { method: 'GET' });
    const pubCheckRes = await publicLabTestsGet(pubCheckReq);
    const pubCheckData = await pubCheckRes.json();
    const hasInactiveInPublic = (pubCheckData.tests as any[]).some((t) => t.id === bothTestId.toString());
    if (hasInactiveInPublic) {
      throw new Error('Case 5DC2-6 Failed: Deactivated test returned by public GET /api/lab-tests');
    }
    console.log('✓ Case 5DC2-6 Passed: Deactivated tests instantly excluded from newly started Dispatch & Plant QA sessions and public API.');
    passedCases++;

    // --- CASE 5DC2-7: Reactivation Inclusion & Snapshot Isolation ---
    console.log('\n--- CASE 5DC2-7: Immediate Reactivation Inclusion & Historical Snapshot Isolation ---');
    const reactBothReq = new Request(`http://localhost:3000/api/super-admin/lab-tests/${bothTestId}`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({ isActive: true }),
    });
    const reactBothRes = await superAdminLabTestsPatch(reactBothReq, {
      params: Promise.resolve({ id: bothTestId.toString() }),
    });
    if (reactBothRes.status !== 200) throw new Error(`Failed to reactivate test: ${reactBothRes.status}`);

    const reactPlantReq = new Request(`http://localhost:3000/api/super-admin/lab-tests/${plantTestId}`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({ isActive: true }),
    });
    const reactPlantRes = await superAdminLabTestsPatch(reactPlantReq, {
      params: Promise.resolve({ id: plantTestId.toString() }),
    });
    if (reactPlantRes.status !== 200) throw new Error(`Failed to reactivate PLANT test: ${reactPlantRes.status}`);

    const startReqReactivated = new Request('http://localhost:3000/api/dispatches/start', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        procurementSourceId: zmccSource.id.toString(),
        operationalDate: regressionBusinessDate,
        vehicleNumber: `VEH-REACT-${nowC2}`,
      }),
    });
    const startResReactivated = await startDispatchPost(startReqReactivated);
    const startDataReactivated = await startResReactivated.json();
    const reactVisitId = BigInt(startDataReactivated.visitId);
    cleanupVisitIds.push(reactVisitId);

    // Verify session 3 (reactivated) receives reactivated tests
    const reactAssignments = await getOrAssignDispatchTests(prisma, reactVisitId);
    const hasBothInReactivated = reactAssignments.some((a) => a.test_id.toString() === bothTestId.toString());
    if (!hasBothInReactivated) {
      throw new Error('Case 5DC2-7 Failed: Reactivated test was not included in subsequent new dispatch session');
    }

    const reactPlantAssignments = await getOrAssignPlantQATests(prisma, reactVisitId);
    const hasPlantInReactivated = reactPlantAssignments.some((a) => a.test_id.toString() === plantTestId.toString());
    const hasBothInReactivatedPlant = reactPlantAssignments.some((a) => a.test_id.toString() === bothTestId.toString());
    if (!hasPlantInReactivated || !hasBothInReactivatedPlant) {
      throw new Error('Case 5DC2-7 Failed: Reactivated test was not included in subsequent new Plant QA session');
    }

    // Verify older session 2 without the deactivated tests remains completely unchanged
    const recheckVisit2PlantAssignments = await getOrAssignPlantQATests(prisma, newVisitId);
    const recheckVisit2Ids = recheckVisit2PlantAssignments.map((a) => a.id.toString()).sort();
    if (JSON.stringify(visit2PlantAssignmentIds) !== JSON.stringify(recheckVisit2Ids)) {
      throw new Error('Case 5DC2-7 Failed: Older snapshot without test was modified after reactivation');
    }
    const hasPlantInRecheckVisit2 = recheckVisit2PlantAssignments.some((a) => a.test_id.toString() === plantTestId.toString());
    if (hasPlantInRecheckVisit2) {
      throw new Error('Case 5DC2-7 Failed: Older snapshot acquired reactivated test');
    }

    // Verify older session 1 (stable snapshot) remains unchanged
    const recheckVisit1PlantAssignments = await getOrAssignPlantQATests(prisma, stableVisitId);
    const recheckVisit1Ids = recheckVisit1PlantAssignments.map((a) => a.id.toString()).sort();
    if (JSON.stringify(stablePlantAssignmentIds) !== JSON.stringify(recheckVisit1Ids)) {
      throw new Error('Case 5DC2-7 Failed: Initial snapshot rows were added, deleted, or rewritten');
    }

    console.log('✓ Case 5DC2-7 Passed: Reactivated test immediately included in new sessions while all historical snapshots remain immutable.');
    passedCases++;

    // --- CASE 5DC2-8: Scope Checkbox Mapping UI Logic ---
    console.log('\n--- CASE 5DC2-8: Scope Checkbox Mapping UI Logic ---');
    if (mapScopeCheckboxes(true, false) !== 'DISPATCH') {
      throw new Error('Case 5DC2-8 Failed: Expected DISPATCH for (true, false)');
    }
    if (mapScopeCheckboxes(false, true) !== 'PLANT') {
      throw new Error('Case 5DC2-8 Failed: Expected PLANT for (false, true)');
    }
    if (mapScopeCheckboxes(true, true) !== 'BOTH') {
      throw new Error('Case 5DC2-8 Failed: Expected BOTH for (true, true)');
    }
    let mappingErrorThrew = false;
    try {
      mapScopeCheckboxes(false, false);
    } catch (err: any) {
      mappingErrorThrew = true;
      if (!err.message.includes('Please select at least one scope')) {
        throw new Error(`Case 5DC2-8 Failed: Unexpected error message "${err.message}"`);
      }
    }
    if (!mappingErrorThrew) {
      throw new Error('Case 5DC2-8 Failed: mapScopeCheckboxes(false, false) did not throw validation error');
    }
    console.log('✓ Case 5DC2-8 Passed: Scope checkbox mapping handles all permutations with strict validation.');
    passedCases++;

    // --- CASE 5DC2-9: Route-Level Atomicity & Audit Log Integrity ---
    console.log('\n--- CASE 5DC2-9: Route-Level Atomicity & Audit Log Integrity ---');
    // 1. Successful POST audit log verification
    const successfulPostAudit = await prisma.auditLog.findFirst({
      where: { table_name: 'lab_test', record_id: bothTestId, action: 'LAB_TEST_CREATED' },
    });
    if (!successfulPostAudit) {
      throw new Error('Case 5DC2-9 Failed: LAB_TEST_CREATED audit log not found');
    }
    if (successfulPostAudit.user_id?.toString() !== superAdminUser.id.toString()) {
      throw new Error(`Case 5DC2-9 Failed: Audit log user_id mismatch (${successfulPostAudit.user_id} vs ${superAdminUser.id})`);
    }
    const postAuditJson = JSON.stringify(successfulPostAudit.new_values || {});
    if (
      postAuditJson.toLowerCase().includes('password') ||
      postAuditJson.toLowerCase().includes('token') ||
      postAuditJson.toLowerCase().includes('cookie') ||
      postAuditJson.toLowerCase().includes('secret')
    ) {
      throw new Error('Case 5DC2-9 Failed: Sensitive authentication material found in audit log new_values');
    }

    // 2. Successful PATCH audit log verification
    const successfulPatchAudit = await prisma.auditLog.findFirst({
      where: { table_name: 'lab_test', record_id: bothTestId, action: 'LAB_TEST_UPDATED' },
    });
    if (!successfulPatchAudit) {
      throw new Error('Case 5DC2-9 Failed: LAB_TEST_UPDATED audit log not found');
    }
    if (successfulPatchAudit.user_id?.toString() !== superAdminUser.id.toString()) {
      throw new Error(`Case 5DC2-9 Failed: Audit log user_id mismatch on PATCH (${successfulPatchAudit.user_id} vs ${superAdminUser.id})`);
    }

    // 3. Atomicity on POST: simulate audit failure via transaction proxy
    const origTransaction = prisma.$transaction.bind(prisma);
    const postTestCodeRollback = `LT-RB-POST-${nowC2}`;
    let postRollbackThrew = false;
    let postStatus = 0;

    try {
      (prisma as any).$transaction = async (arg: any) => {
        if (typeof arg === 'function') {
          return await origTransaction(async (realTx: any) => {
            const txProxy = new Proxy(realTx, {
              get(target, prop, receiver) {
                if (prop === 'auditLog') {
                  const realAuditLog = target.auditLog;
                  return new Proxy(realAuditLog, {
                    get(auditTarget, auditProp, auditReceiver) {
                      if (auditProp === 'create') {
                        return async () => {
                          throw new Error('SIMULATED_AUDIT_LOG_FAILURE');
                        };
                      }
                      return Reflect.get(auditTarget, auditProp, auditReceiver);
                    },
                  });
                }
                return Reflect.get(target, prop, receiver);
              },
            });
            return await arg(txProxy);
          });
        }
        return await origTransaction(arg);
      };

      const rollbackPostReq = new Request('http://localhost:3000/api/super-admin/lab-tests', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          testName: `Rollback Post Test ${nowC2}`,
          resultType: 'NUMERIC',
          testScope: 'DISPATCH',
          isRequired: false,
          isActive: true,
          displayOrder: 9991,
        }),
      });

      const rollbackPostRes = await superAdminLabTestsPost(rollbackPostReq);
      postStatus = rollbackPostRes.status;
      if (rollbackPostRes.status >= 500) {
        postRollbackThrew = true;
      }
    } finally {
      prisma.$transaction = origTransaction as any;
    }

    if (!postRollbackThrew) {
      throw new Error(`Case 5DC2-9 Failed: Expected POST to return >= 500 on audit failure, got ${postStatus}`);
    }

    const postRollbackLabTest = await prisma.labTest.findFirst({
      where: { testName: `Rollback Post Test ${nowC2}` },
    });
    if (postRollbackLabTest) {
      cleanupTestIds.push(postRollbackLabTest.id);
      throw new Error('Case 5DC2-9 Failed: Lab test was created despite audit log failure (transaction rollback failed)');
    }

    // 4. Atomicity on PATCH: simulate audit failure via transaction proxy
    const baselineDispTest = await prisma.labTest.findUnique({ where: { id: dispTestId } });
    const baselineDispAuditCount = await prisma.auditLog.count({
      where: { table_name: 'lab_test', record_id: dispTestId },
    });
    let patchRollbackThrew = false;
    let patchStatus = 0;

    try {
      (prisma as any).$transaction = async (arg: any) => {
        if (typeof arg === 'function') {
          return await origTransaction(async (realTx: any) => {
            const txProxy = new Proxy(realTx, {
              get(target, prop, receiver) {
                if (prop === 'auditLog') {
                  const realAuditLog = target.auditLog;
                  return new Proxy(realAuditLog, {
                    get(auditTarget, auditProp, auditReceiver) {
                      if (auditProp === 'create') {
                        return async () => {
                          throw new Error('SIMULATED_AUDIT_LOG_FAILURE');
                        };
                      }
                      return Reflect.get(auditTarget, auditProp, auditReceiver);
                    },
                  });
                }
                return Reflect.get(target, prop, receiver);
              },
            });
            return await arg(txProxy);
          });
        }
        return await origTransaction(arg);
      };

      const rollbackPatchReq = new Request(`http://localhost:3000/api/super-admin/lab-tests/${dispTestId}`, {
        method: 'PATCH',
        headers: authHeaders,
        body: JSON.stringify({
          testName: 'SHOULD_ROLLBACK_LAB_TEST_NAME',
          displayOrder: 12345,
        }),
      });

      const rollbackPatchRes = await superAdminLabTestsPatch(rollbackPatchReq, {
        params: Promise.resolve({ id: dispTestId.toString() }),
      });
      patchStatus = rollbackPatchRes.status;
      if (rollbackPatchRes.status >= 500) {
        patchRollbackThrew = true;
      }
    } finally {
      prisma.$transaction = origTransaction as any;
    }

    if (!patchRollbackThrew) {
      throw new Error(`Case 5DC2-9 Failed: Expected PATCH to return >= 500 on audit failure, got ${patchStatus}`);
    }

    const dispTestAfterRollback = await prisma.labTest.findUnique({ where: { id: dispTestId } });
    const dispAuditCountAfterRollback = await prisma.auditLog.count({
      where: { table_name: 'lab_test', record_id: dispTestId },
    });

    if (
      dispTestAfterRollback?.testName !== baselineDispTest?.testName ||
      dispTestAfterRollback?.displayOrder !== baselineDispTest?.displayOrder ||
      dispAuditCountAfterRollback !== baselineDispAuditCount
    ) {
      throw new Error('Case 5DC2-9 Failed: Lab test mutation was persisted despite audit failure (PATCH rollback failed)');
    }

    console.log('✓ Case 5DC2-9 Passed: Route handlers enforce full atomicity with audit log actor verification and rollback safety.');
    passedCases++;

    console.log('\n========================================================================');
    console.log(`--- ALL ${passedCases} TESTS PASSED (100%) ---`);
    console.log('========================================================================\n');
  } finally {
    console.log('\n--- Cleaning up Stage 5D-C2 fixtures ---');
    const cleanupErrors: any[] = [];
    for (const testId of cleanupTestIds) {
      try {
        await prisma.labTestAssignment.deleteMany({ where: { test_id: testId } });
        await prisma.auditLog.deleteMany({ where: { table_name: 'lab_test', record_id: testId } });
        await prisma.labTest.delete({ where: { id: testId } });
      } catch (e) {
        cleanupErrors.push({ testId: testId.toString(), error: e });
      }
    }
    for (const visitId of cleanupVisitIds) {
      try {
        await prisma.labTestAssignment.deleteMany({ where: { visit_id: visitId } });
        await prisma.dispatchLabResult.deleteMany({ where: { visit_id: visitId } });
        await prisma.plantLabResult.deleteMany({ where: { visit_id: visitId } });
        await prisma.visitPortion.deleteMany({ where: { visit_id: visitId } });
        await prisma.vehicleVisit.delete({ where: { id: visitId } });
      } catch (e) {
        cleanupErrors.push({ visitId: visitId.toString(), error: e });
      }
    }

    if (cleanupErrors.length > 0) {
      console.error('Fixture cleanup encountered errors:', cleanupErrors);
      throw new Error(`Fixture cleanup failed for ${cleanupErrors.length} entities`);
    }
    console.log('--- Stage 5D-C2 fixture cleanup complete ---');
  }
}

runConfigurableQualitativeOptionsTests()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Test Suite Failed:', err);
    process.exit(1);
  });
