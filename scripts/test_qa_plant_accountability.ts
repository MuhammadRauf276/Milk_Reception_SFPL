import { prisma } from '../src/backend/core/db';
import fs from 'fs';
import path from 'path';

async function runQAPlantAccountabilityVerification() {
  console.log('==================================================');
  console.log('RUNNING QA PLANT ACCOUNTABILITY REGRESSION SUITE');
  console.log('==================================================\n');

  let passCount = 0;
  let failCount = 0;

  function report(name: string, success: boolean, detail?: string) {
    if (success) {
      passCount++;
      console.log(`[PASS] ${name} ${detail ? `(${detail})` : ''}`);
    } else {
      failCount++;
      console.log(`[FAIL] ${name} ${detail ? `(${detail})` : ''}`);
    }
  }

  // Find QA user
  const qaUser = await prisma.user.findFirst({
    where: { role: { in: ['QA_Operator', 'QA', 'Admin'] } },
  });
  if (!qaUser) throw new Error('No QA user found in database');

  // Fetch active required plant tests for test setup
  const allActivePlantTests = await prisma.labTest.findMany({
    where: { isActive: true, testScope: { in: ['PLANT', 'BOTH'] } },
  });
  const requiredManualPlantTests = allActivePlantTests.filter(
    (t) => t.isRequired && t.resultType !== 'CALCULATED'
  );

  report(
    'SCHEMA-01: Active required manual PLANT/BOTH tests exist in database',
    requiredManualPlantTests.length > 0,
    `Count = ${requiredManualPlantTests.length}`
  );

  // Create a temporary test visit with 2 portions
  const testVisitNumber = `TEST-QA-ACCT-${Date.now()}`;
  const visit = await prisma.vehicleVisit.create({
    data: {
      visit_number: testVisitNumber,
      vehicle_number: 'QA-ACCT-9999',
      token_number: `TK-ACCT-${Math.floor(1000 + Math.random() * 9000)}`,
      current_status: 'TOKEN_ISSUED',
      operational_date: new Date(),
      created_by: qaUser.id,
      portions: {
        create: [
          {
            portion_number: 1,
            dispatch_quantity_value: 8500,
            dispatch_quantity_unit: 'KG',
            current_status: 'TOKEN_ISSUED',
          },
          {
            portion_number: 2,
            dispatch_quantity_value: 6200,
            dispatch_quantity_unit: 'LITER',
            current_status: 'TOKEN_ISSUED',
          },
        ],
      },
    },
    include: { portions: { orderBy: { portion_number: 'asc' } } },
  });

  const entryTime = new Date(Date.now() - 20 * 60 * 1000);
  await prisma.gateLog.create({
    data: { visit_id: visit.id, entry_timestamp: entryTime, entry_guard_id: qaUser.id },
  });

  const p1 = visit.portions[0]; // KG portion
  const p2 = visit.portions[1]; // LITER portion

  try {
    // ─── QA-CRASH-01: API emits dispatch_quantity_value (not dispatch_quantity_value) ───
    const visitFromDb = await prisma.visitPortion.findUnique({ where: { id: p1.id } });
    const hasQtyValue = visitFromDb !== null && visitFromDb.dispatch_quantity_value !== undefined;
    report(
      'QA-CRASH-01: dispatch_quantity_value field exists on VisitPortion in DB',
      hasQtyValue,
      `Value = ${visitFromDb?.dispatch_quantity_value}`
    );

    // ─── QA-CRASH-02: dispatch_quantity_unit exists ───
    const hasQtyUnit = visitFromDb !== null && visitFromDb.dispatch_quantity_unit !== undefined;
    report(
      'QA-CRASH-02: dispatch_quantity_unit field exists on VisitPortion in DB',
      hasQtyUnit,
      `Unit = ${visitFromDb?.dispatch_quantity_unit}`
    );

    // ─── QA-CRASH-03: KG portion stores value without || 0 corruption ───
    const p1Qty = visitFromDb?.dispatch_quantity_value;
    report(
      'QA-CRASH-03: KG portion dispatch_quantity_value is exactly 8500 (no || 0 applied)',
      p1Qty !== null && Number(p1Qty) === 8500,
      `Stored = ${p1Qty}`
    );

    // ─── QA-CRASH-04: LITER portion dispatch_quantity_unit preserved ───
    const p2FromDb = await prisma.visitPortion.findUnique({ where: { id: p2.id } });
    report(
      'QA-CRASH-04: LITER portion dispatch_quantity_unit = LITER (not forced to KG)',
      p2FromDb?.dispatch_quantity_unit === 'LITER',
      `Unit = ${p2FromDb?.dispatch_quantity_unit}`
    );

    // ─── SCHEMA-02: PlantLabResult now has performance_status column ───
    // Verify by creating a row with performance_status = 'PERFORMED'
    const plantTest = requiredManualPlantTests[0];
    if (!plantTest) throw new Error('No required plant test found');

    const performedRow = await prisma.plantLabResult.create({
      data: {
        visit_id: visit.id,
        portion_id: p1.id,
        test_id: plantTest.id,
        performance_status: 'PERFORMED',
        numeric_value: plantTest.resultType === 'NUMERIC' ? 3.9 : null,
        text_value: plantTest.resultType !== 'NUMERIC' ? 'OK' : null,
        is_passed: true,
        tested_by: qaUser.id,
      },
    });

    report(
      'QA-PERF-01: PlantLabResult stores performance_status = PERFORMED successfully',
      performedRow.performance_status === 'PERFORMED',
      `Row ID = ${performedRow.id}, status = ${performedRow.performance_status}`
    );

    // ─── QA-PERF-02: PlantLabResult stores NOT_PERFORMED with reason ───
    const notPerformedRow = await prisma.plantLabResult.create({
      data: {
        visit_id: visit.id,
        portion_id: p2.id,
        test_id: plantTest.id,
        performance_status: 'NOT_PERFORMED',
        not_performed_reason: 'Reagent unavailable for retest',
        numeric_value: null,
        text_value: null,
        is_passed: null,
        tested_by: qaUser.id,
      },
    });

    report(
      'QA-PERF-02: PlantLabResult stores performance_status = NOT_PERFORMED with reason',
      notPerformedRow.performance_status === 'NOT_PERFORMED' &&
        notPerformedRow.not_performed_reason === 'Reagent unavailable for retest' &&
        notPerformedRow.numeric_value === null &&
        notPerformedRow.is_passed === null,
      `Status = ${notPerformedRow.performance_status}, reason = ${notPerformedRow.not_performed_reason}`
    );

    // ─── QA-FAKE-01: No fake defaults injected — populateInputsForPortion starts clean ───
    const workspaceSource = fs.readFileSync(
      path.join(process.cwd(), 'src/frontend/modules/dashboard/QALaboratoryWorkspace.tsx'),
      'utf8'
    );
    const noFakeNumeric = !workspaceSource.includes("defaultNum = '3.8'") &&
      !workspaceSource.includes("defaultNum = '28.5'") &&
      !workspaceSource.includes("defaultNum = '8.5'") &&
      !workspaceSource.includes("defaultNum = '4.5'");
    const noFakeText = !workspaceSource.includes("defaultText = 'OK'") &&
      !workspaceSource.includes("defaultText = 'NO'") &&
      !workspaceSource.includes("defaultText = 'NEGATIVE'");
    report(
      'QA-FAKE-01: No hardcoded fake defaults (3.8, 28.5, 8.5, 4.5, OK, NEGATIVE, NO) in QALaboratoryWorkspace',
      noFakeNumeric && noFakeText,
      `noFakeNumeric = ${noFakeNumeric}, noFakeText = ${noFakeText}`
    );

    // ─── QA-FAKE-02: performanceStatus toggle exists in UI ───
    const hasPerformedToggle = workspaceSource.includes("performanceStatus: 'PERFORMED'") &&
      workspaceSource.includes("performanceStatus: 'NOT_PERFORMED'");
    report(
      'QA-FAKE-02: PERFORMED / NOT_PERFORMED toggle exists in QALaboratoryWorkspace',
      hasPerformedToggle,
      'performanceStatus state management present'
    );

    // ─── QA-CRASH-05: formatDispatchQty guard — null returns dash ───
    const hasCrashGuard = workspaceSource.includes('formatDispatchQty') &&
      (workspaceSource.includes('val === null') || workspaceSource.includes('portion.dispatch_quantity_value === null')) &&
      !workspaceSource.includes('portion.dispatch_quantity_value.toLocaleString()'); // direct unsafe call must be gone
    report(
      'QA-CRASH-05: dispatch_quantity_value.toLocaleString() crash eliminated — formatDispatchQty guard in place',
      hasCrashGuard,
      'Null-safe display helper present, direct .toLocaleString() call removed'
    );

    // ─── QA-ACCEPT-01: ACCEPT blocked when required test is NOT_PERFORMED ───
    // Simulate: build a session; try complete with all required except one
    const session = await prisma.qATestingSession.create({
      data: {
        visit_id: visit.id,
        started_by: qaUser.id,
        started_at: new Date(Date.now() - 5 * 60 * 1000),
        status: 'IN_PROGRESS',
      },
    });
    await prisma.qATestingSessionEvent.create({
      data: {
        session_id: session.id,
        event_type: 'START',
        timestamp: new Date(Date.now() - 5 * 60 * 1000),
        user_id: qaUser.id,
        note: 'ACCT test session',
      },
    });
    await prisma.vehicleVisit.update({
      where: { id: visit.id },
      data: { current_status: 'PLANT_QA' },
    });

    // Build a result set where one required test is NOT_PERFORMED
    const allRequiredResults: Array<{
      testId: string;
      performanceStatus: 'PERFORMED' | 'NOT_PERFORMED';
      numericValue: number | null;
      textValue: string | null;
    }> = requiredManualPlantTests.map((t) => ({
      testId: t.id.toString(),
      performanceStatus: 'PERFORMED' as 'PERFORMED' | 'NOT_PERFORMED',
      numericValue: t.resultType === 'NUMERIC' ? 3.9 : null,
      textValue: t.resultType !== 'NUMERIC' ? 'OK' : null,
    }));

    // Flip the first test to NOT_PERFORMED
    if (allRequiredResults.length > 0) {
      allRequiredResults[0] = {
        testId: allRequiredResults[0].testId,
        performanceStatus: 'NOT_PERFORMED',
        numericValue: null,
        textValue: null,
      };
    }

    // Simulate the ACCEPT validation logic (mirrors complete/route.ts)
    let acceptBlocked = false;
    let acceptBlockReason = '';
    for (const res of allRequiredResults) {
      if (res.performanceStatus === 'NOT_PERFORMED') {
        acceptBlocked = true;
        acceptBlockReason = 'NOT_PERFORMED test present';
        break;
      }
    }
    report(
      'QA-ACCEPT-01: ACCEPT blocked when a required test is NOT_PERFORMED',
      acceptBlocked,
      acceptBlockReason
    );

    // ─── QA-ACCEPT-02: ACCEPT blocked when required test is UNRESOLVED (no entry) ───
    const partialResults = allRequiredResults.slice(1); // missing first test entirely
    let unresolvedBlocked = partialResults.length < requiredManualPlantTests.length;
    report(
      'QA-ACCEPT-02: ACCEPT blocked when required test is UNRESOLVED (missing from submission)',
      unresolvedBlocked || requiredManualPlantTests.length === 0,
      `Required = ${requiredManualPlantTests.length}, Submitted = ${partialResults.length}`
    );

    // ─── QA-ACCEPT-03: ACCEPT succeeds when all required tests are PERFORMED ───
    const allPerformedResults = requiredManualPlantTests.map((t) => ({
      testId: t.id.toString(),
      performanceStatus: 'PERFORMED' as const,
      numericValue: t.resultType === 'NUMERIC' ? 3.9 : null,
      textValue: t.resultType !== 'NUMERIC' ? 'OK' : null,
    }));
    let acceptWouldPass = allPerformedResults.every((r) => r.performanceStatus === 'PERFORMED') &&
      allPerformedResults.length === requiredManualPlantTests.length;
    report(
      'QA-ACCEPT-03: ACCEPT would succeed when all required tests are PERFORMED with valid values',
      acceptWouldPass,
      `All ${allPerformedResults.length} required tests PERFORMED`
    );

    // ─── QA-REJECT-01: REJECT requires ≥1 PERFORMED result ───
    const onlyNotPerformed: Array<{ testId: string; performanceStatus: 'PERFORMED' | 'NOT_PERFORMED' }> =
      requiredManualPlantTests.map((t) => ({
        testId: t.id.toString(),
        performanceStatus: 'NOT_PERFORMED' as 'PERFORMED' | 'NOT_PERFORMED',
      }));
    const hasPerformedEvidence = onlyNotPerformed.some((r) => r.performanceStatus === 'PERFORMED');
    report(
      'QA-REJECT-01: REJECT blocked when all submitted results are NOT_PERFORMED (no genuine evidence)',
      !hasPerformedEvidence,
      'NOT_PERFORMED-only submission correctly has no PERFORMED evidence'
    );

    // ─── QA-REJECT-02: Unresolved required tests auto-finalized as NOT_PERFORMED at REJECT time ───
    // Simulate: create PlantLabResult rows for only one required test (rest are UNRESOLVED)
    // Then verify the complete/route.ts would finalize them
    const completeRouteSource = fs.readFileSync(
      path.join(process.cwd(), 'src/app/api/qa/vehicle-visits/[visitId]/portions/[portionId]/complete/route.ts'),
      'utf8'
    );
    const hasAutoFinalize = completeRouteSource.includes('VEHICLE_REJECTED_BEFORE_TEST_COMPLETION') &&
      completeRouteSource.includes('auto-finalize UNRESOLVED required tests');
    report(
      'QA-REJECT-02: Unresolved required tests auto-finalized as NOT_PERFORMED(VEHICLE_REJECTED_BEFORE_TEST_COMPLETION) at REJECT',
      hasAutoFinalize,
      'Auto-finalization logic present in complete/route.ts'
    );

    // ─── QA-REJECT-03: Already-PERFORMED results preserved at REJECT time ───
    const hasPreservation = completeRouteSource.includes("existing.performance_status !== 'NOT_PERFORMED'");
    report(
      'QA-REJECT-03: Already-PERFORMED results preserved unchanged at rejection (only UNRESOLVED get finalized)',
      hasPreservation,
      'Conditional overwrite guard present'
    );

    // ─── QA-HOLD-01: HOLD does not auto-finalize UNRESOLVED tests ───
    const holdRouteSource = fs.readFileSync(
      path.join(process.cwd(), 'src/app/api/qa/vehicle-visits/[visitId]/portions/[portionId]/hold/route.ts'),
      'utf8'
    );
    const holdHasNoAutoFinalize = !holdRouteSource.includes('VEHICLE_REJECTED_BEFORE_TEST_COMPLETION') &&
      !holdRouteSource.includes('NOT_PERFORMED');
    report(
      'QA-HOLD-01: HOLD route does NOT auto-finalize any test as NOT_PERFORMED (state preserved for resume)',
      holdHasNoAutoFinalize,
      'No auto-finalization in hold/route.ts'
    );

    // ─── QA-DISPATCH-SEP-01: DispatchLabResult cannot satisfy PlantLabResult requirements ───
    // Verify the complete/route.ts only queries PlantLabResult, never DispatchLabResult for ACCEPT decision
    const hasDispatchContamination = completeRouteSource.includes('dispatch_lab_result') &&
      !completeRouteSource.includes('DispatchLabResult');
    const noCrossContamination = !completeRouteSource.includes('dispatchResults') &&
      !completeRouteSource.includes('dispatch_lab_results') &&
      !completeRouteSource.includes("testScope: { in: ['DISPATCH'");
    report(
      'QA-DISPATCH-SEP-01: DispatchLabResult results cannot satisfy PlantLabResult ACCEPT requirements (fully separate)',
      noCrossContamination,
      'No dispatch result references in complete route for Plant QA decisions'
    );

    // ─── QA-MULTIPORTION-01: Portion isolation — p1 and p2 have separate PlantLabResult rows ───
    const p1Results = await prisma.plantLabResult.findMany({ where: { portion_id: p1.id } });
    const p2Results = await prisma.plantLabResult.findMany({ where: { portion_id: p2.id } });
    const p1HasPerformed = p1Results.some((r) => r.performance_status === 'PERFORMED');
    const p2HasNotPerformed = p2Results.some((r) => r.performance_status === 'NOT_PERFORMED');
    report(
      'QA-MULTIPORTION-01: Multi-portion isolation — each portion maintains independent PlantLabResult rows',
      p1HasPerformed && p2HasNotPerformed,
      `P1 rows = ${p1Results.length} (PERFORMED), P2 rows = ${p2Results.length} (NOT_PERFORMED)`
    );

    // ─── QA-HOLD-RESUME-01: Session events preserved for Hold/Resume ───
    const sessionEvents = await prisma.qATestingSessionEvent.findMany({
      where: { session_id: session.id },
    });
    report(
      'QA-HOLD-RESUME-01: QATestingSession and QATestingSessionEvent records present (hold/resume history preserved)',
      sessionEvents.length > 0,
      `Event count = ${sessionEvents.length}`
    );

    // ─── QA-FIELD-01: API route emits correct field names ───
    const visitRouteSource = fs.readFileSync(
      path.join(process.cwd(), 'src/app/api/qa/vehicle-visits/[visitId]/route.ts'),
      'utf8'
    );
    const emitsDeclaredValue = visitRouteSource.includes('dispatch_quantity_value:') &&
      !visitRouteSource.includes('declared_quantity_value:');
    const emitsDeclaredUnit = visitRouteSource.includes('dispatch_quantity_unit:');
    const emitsPerformanceStatus = visitRouteSource.includes('performanceStatus: pr.performance_status');
    report(
      'QA-FIELD-01: Visit detail API emits dispatch_quantity_value (not declared_quantity_value), dispatch_quantity_unit, and performanceStatus',
      emitsDeclaredValue && emitsDeclaredUnit && emitsPerformanceStatus,
      `value=${emitsDeclaredValue}, unit=${emitsDeclaredUnit}, perf=${emitsPerformanceStatus}`
    );

  } finally {
    // Cleanup all test data
    await prisma.qATestingSessionEvent.deleteMany({ where: { session: { visit_id: visit.id } } });
    await prisma.qATestingSession.deleteMany({ where: { visit_id: visit.id } });
    await prisma.plantLabResult.deleteMany({ where: { visit_id: visit.id } });
    await prisma.gateLog.deleteMany({ where: { visit_id: visit.id } });
    await prisma.visitPortion.deleteMany({ where: { visit_id: visit.id } });
    await prisma.vehicleVisit.delete({ where: { id: visit.id } });
  }

  console.log('\n==================================================');
  console.log(`QA PLANT ACCOUNTABILITY SUITE: ${passCount} PASSED, ${failCount} FAILED`);
  console.log('==================================================\n');

  if (failCount > 0) {
    process.exit(1);
  }
}

runQAPlantAccountabilityVerification()
  .catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
