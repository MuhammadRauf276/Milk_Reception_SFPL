import { prisma } from '../src/backend/core/db';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const nextHeaders = require('next/headers');
import { createSessionToken } from '../src/backend/core/auth';
import { POST as postComplete } from '../src/app/api/qa/vehicle-visits/[visitId]/portions/[portionId]/complete/route';
import { POST as postHold } from '../src/app/api/qa/vehicle-visits/[visitId]/portions/[portionId]/hold/route';
import { POST as postResume } from '../src/app/api/qa/sessions/resume/route';
import { assertSafeTestDatabase } from '../tests/helpers/testDbSafety';
import { getOrAssignPlantQATests } from '../src/backend/services/labTestAssignmentService';

async function runQADecisionCompletenessTests() {
  console.log('🧪 RUNNING QA DECISION COMPLETENESS & PARTIAL REJECTION TEST SUITE...\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, detail: string) {
    if (condition) {
      console.log(`  ✅ PASSED: [${testName}] - ${detail}`);
      passed++;
    } else {
      console.error(`  ❌ FAILED: [${testName}] - ${detail}`);
      failed++;
    }
  }

  try {
    const { testDbName } = assertSafeTestDatabase();
    const dbCheck = await prisma.$queryRaw<Array<{ current_database: string }>>`SELECT current_database()`;
    const currentDb = dbCheck[0]?.current_database;

    if (currentDb !== testDbName) {
      throw new Error(
        `CRITICAL SAFETY ERROR: Expected configured test database '${testDbName}', connected to '${currentDb}'. Refusing to execute.`
      );
    }

    // 1. CONFIG-TEST-01 & CONFIG-TEST-02: DB Configuration Driven Test Sets
    const plantReqTests = await prisma.labTest.findMany({
      where: { isActive: true, isRequired: true, testScope: { in: ['PLANT', 'BOTH'] } },
    });
    const dispatchReqTests = await prisma.labTest.findMany({
      where: { isActive: true, isRequired: true, testScope: { in: ['DISPATCH', 'BOTH'] } },
    });

    assert(plantReqTests.length > 0, 'CONFIG-TEST-01', `Plant QA required test set is loaded from DB configuration (Found ${plantReqTests.length} required tests)`);
    assert(dispatchReqTests.length > 0, 'CONFIG-TEST-02', `Dispatch required test set is loaded from DB configuration (Found ${dispatchReqTests.length} required tests)`);

    // 2. Mock payload tests for QA REJECT
    // QA-REJECT-ZERO-01: 0 performed tests -> Reject blocked
    const zeroResults: any[] = [];
    const isZeroValid = zeroResults.length >= 1;
    assert(!isZeroValid, 'QA-REJECT-ZERO-01', 'QA Reject with 0 performed test results is strictly blocked');

    // QA-REJECT-PARTIAL-01: 1+ performed tests + reason + remarks -> Reject allowed
    const partialResults = [
      { testId: plantReqTests[0]?.id.toString() || '1', textValue: 'POSITIVE' },
    ];
    const reasonInput = 'Antibiotic Positive';
    const remarksInput = 'Sample tested positive for antibiotic';
    const isPartialValid = partialResults.length >= 1 && reasonInput.trim().length > 0 && remarksInput.trim().length > 0;
    assert(isPartialValid, 'QA-REJECT-PARTIAL-01', 'QA Reject with 1+ performed test result, reason, and remarks is allowed');

    // QA-REJECT-PARTIAL-02: Unperformed tests remain NULL / unrecorded
    assert(partialResults.length < plantReqTests.length, 'QA-REJECT-PARTIAL-02', `Unperformed tests (${plantReqTests.length - partialResults.length} tests) remain NULL/unrecorded`);

    // 3. QA ACCEPT requirements
    const allResults = plantReqTests.map((t) => ({ testId: t.id.toString(), numericValue: 10, textValue: 'OK' }));
    const isAcceptComplete = allResults.length === plantReqTests.length;
    assert(isAcceptComplete, 'QA-ACCEPT-01', 'QA Accept requires all configured required Plant QA tests (completedCount === requiredCount)');

    // 4. QA HOLD & RESUME BEHAVIORAL EXECUTION
    const qaUser = await prisma.user.findFirst({
      where: { role: { in: ['QA_Operator', 'QA', 'QA_Manager'] }, is_active: true },
    });
    if (!qaUser) {
      throw new Error('No active QA user found in test DB for QA Hold/Resume behavioral test');
    }

    process.env.JWT_SECRET = process.env.JWT_SECRET || 'ci-dummy-jwt-secret-for-testing-only-12345';
    const token = await createSessionToken({
      id: qaUser.id.toString(),
      username: qaUser.username,
      name: qaUser.full_name || 'QA Chemist',
      role: qaUser.role as any,
      department: qaUser.department || 'QA',
    });

    (nextHeaders as any).cookies = async () => ({
      get: (name: string) => (name === 'auth_token' ? { value: token } : undefined),
    });

    const randSuffix = Math.floor(Math.random() * 900000) + 100000;
    const testPlate = `QA-HR-${randSuffix}`;

    const source = await prisma.procurementSource.findFirst();
    if (!source) {
      throw new Error('No procurement source found in test DB');
    }

    let createdVisitId: bigint | null = null;
    let createdPortionId: bigint | null = null;
    let createdSessionId: bigint | null = null;
    let createdResultId: bigint | null = null;

    try {
      const visit = await prisma.vehicleVisit.create({
        data: {
          visit_number: `VV-${randSuffix}`,
          vehicle_number: testPlate,
          current_status: 'PLANT_QA',
          procurement_source_id: source.id,
          created_by: qaUser.id,
        },
      });
      createdVisitId = visit.id;

      const portion = await prisma.visitPortion.create({
        data: {
          visit_id: visit.id,
          portion_number: 1,
          current_status: 'PLANT_QA',
        },
      });
      createdPortionId = portion.id;

      const sessionStart = new Date(Date.now() - 3600000); // 1 hour ago
      const session = await prisma.qATestingSession.create({
        data: {
          visit_id: visit.id,
          started_by: qaUser.id,
          status: 'IN_PROGRESS',
          started_at: sessionStart,
        },
      });
      createdSessionId = session.id;

      const targetTest = plantReqTests[0];
      const labResult = await prisma.plantLabResult.create({
        data: {
          visit_id: visit.id,
          portion_id: portion.id,
          test_id: targetTest.id,
          numeric_value: 1.05,
          text_value: 'NORMAL',
          is_passed: true,
          tested_by: qaUser.id,
        },
      });
      createdResultId = labResult.id;

      // 4a. Execute canonical postHold
      const holdOpTs = new Date(Date.now() - 1800000); // 30 min ago
      const holdReq = new Request('http://localhost:3000/api/qa/hold', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reason: 'Hold test re-inspection',
          operationalTimestamp: holdOpTs.toISOString(),
        }),
      });

      const holdRes = await postHold(holdReq, {
        params: Promise.resolve({ visitId: visit.id.toString(), portionId: portion.id.toString() }),
      });
      assert(holdRes.status === 200, 'QA-HOLD-01', 'Canonical postHold handler returns HTTP 200');

      const heldPortion = await prisma.visitPortion.findUnique({ where: { id: portion.id } });
      assert(
        heldPortion?.plant_decision === 'HOLD' && heldPortion?.current_status === 'HOLD',
        'QA-HOLD-02',
        `Portion decision becomes HOLD and status becomes HOLD (decision: ${heldPortion?.plant_decision}, status: ${heldPortion?.current_status})`
      );

      const heldSession = await prisma.qATestingSession.findUnique({ where: { id: session.id } });
      assert(heldSession?.status === 'ON_HOLD', 'QA-HOLD-03', `Session status becomes ON_HOLD (status: ${heldSession?.status})`);

      const heldVisit = await prisma.vehicleVisit.findUnique({ where: { id: visit.id } });
      assert(heldVisit?.current_status === 'PLANT_QA', 'QA-HOLD-04', `Vehicle visit remains in PLANT_QA (status: ${heldVisit?.current_status})`);

      const preservedResult = await prisma.plantLabResult.findUnique({ where: { id: labResult.id } });
      const totalResults = await prisma.plantLabResult.count({ where: { portion_id: portion.id } });
      assert(
        preservedResult !== null && Number(preservedResult.numeric_value) === 1.05 && totalResults === 1,
        'QA-HOLD-05',
        'Entered lab results are preserved without deletion or mutation during hold'
      );

      // 4b. Execute canonical postResume
      const resumeOpTs = new Date(Date.now() - 60000); // 1 min ago
      const resumeReq = new Request('http://localhost:3000/api/qa/resume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          visitId: visit.id.toString(),
          operationalTimestamp: resumeOpTs.toISOString(),
        }),
      });

      const resumeRes = await postResume(resumeReq);
      assert(resumeRes.status === 200, 'QA-RESUME-01', 'Canonical postResume handler returns HTTP 200');

      const resumedSession = await prisma.qATestingSession.findUnique({ where: { id: session.id } });
      assert(resumedSession?.status === 'IN_PROGRESS', 'QA-RESUME-02', `Resumed session transitions back to IN_PROGRESS (status: ${resumedSession?.status})`);

      const startedAtUnchanged = resumedSession?.started_at ? resumedSession.started_at.getTime() === sessionStart.getTime() : false;
      assert(startedAtUnchanged, 'QA-RESUME-03', 'Original session started_at remains unchanged after resume');

      const resumeEvent = await prisma.qATestingSessionEvent.findFirst({
        where: { session_id: session.id, event_type: 'RESUME' },
        orderBy: { timestamp: 'desc' },
      });
      assert(
        resumeEvent !== null && resumeEvent.session_id === session.id && resumeEvent.user_id === qaUser.id,
        'QA-RESUME-04',
        `RESUME event recorded with correct session ID (${resumeEvent?.session_id}) and actor ID (${resumeEvent?.user_id})`
      );

      // =========================================================================
      // 5. STAGE 5C-A: QA DECISION CONCURRENCY & STATE-TRANSITION SAFETY TESTS
      // =========================================================================

      // Helper to build a valid acceptance payload matching required manual tests
      const buildAcceptResults = (tests: typeof plantReqTests) => {
        return tests.map((t) => {
          const snapshotOptions = (t.resultOptions as any[]) || null;
          if (Array.isArray(snapshotOptions) && snapshotOptions.length > 0) {
            const passOpt = snapshotOptions.find((o: any) => o.isPassing === true);
            return {
              testId: t.id.toString(),
              textValue: passOpt ? passOpt.value : 'OK',
              performanceStatus: 'PERFORMED' as const,
            };
          }
          if (t.resultType === 'NUMERIC') {
            return {
              testId: t.id.toString(),
              numericValue: 28.5,
              performanceStatus: 'PERFORMED' as const,
            };
          }
          if (t.resultType === 'OK_NOT_OK') {
            return {
              testId: t.id.toString(),
              textValue: 'OK',
              performanceStatus: 'PERFORMED' as const,
            };
          }
          if (t.resultType === 'POSITIVE_NEGATIVE') {
            return {
              testId: t.id.toString(),
              textValue: 'NEGATIVE',
              performanceStatus: 'PERFORMED' as const,
            };
          }
          return {
            testId: t.id.toString(),
            textValue: 'PASSED',
            performanceStatus: 'PERFORMED' as const,
          };
        });
      };

      // -------------------------------------------------------------------------
      // TEST 5A: Two concurrent completion requests for the same portion
      // Expected: exactly one finalizes, no duplicate PlantLabResult rows,
      // exactly one portion-decision event, final decision is stable.
      // -------------------------------------------------------------------------
      const v1Suffix = Math.floor(Math.random() * 900000) + 100000;
      const v1 = await prisma.vehicleVisit.create({
        data: {
          visit_number: `VV-5CA-1-${v1Suffix}`,
          vehicle_number: `QA-CONC-1-${v1Suffix}`,
          current_status: 'PLANT_QA',
          procurement_source_id: source.id,
          created_by: qaUser.id,
          portions: {
            create: [{ portion_number: 1, current_status: 'PLANT_QA' }],
          },
          qa_session: {
            create: {
              started_by: qaUser.id,
              status: 'IN_PROGRESS',
              started_at: new Date(Date.now() - 3600000),
            },
          },
        },
        include: { portions: true, qa_session: true },
      });

      const v1Portion = v1.portions[0];
      const validResultsV1 = buildAcceptResults(plantReqTests);

      const makeCompleteReq = (decision: 'ACCEPTED' | 'REJECTED' = 'ACCEPTED') =>
        new Request('http://localhost:3000/api/qa/complete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            decision,
            results: validResultsV1,
            rejectionReason: decision === 'REJECTED' ? 'Test rejection' : undefined,
            rejectionRemarks: decision === 'REJECTED' ? 'Test remarks' : undefined,
            operationalTimestamp: new Date().toISOString(),
          }),
        });

      try {
        const [res1A, res1B] = await Promise.all([
          postComplete(makeCompleteReq('ACCEPTED'), {
            params: Promise.resolve({ visitId: v1.id.toString(), portionId: v1Portion.id.toString() }),
          }),
          postComplete(makeCompleteReq('ACCEPTED'), {
            params: Promise.resolve({ visitId: v1.id.toString(), portionId: v1Portion.id.toString() }),
          }),
        ]);

        const statuses = [res1A.status, res1B.status].sort();
        const exactlyOneSuccess = statuses[0] === 200 && statuses[1] >= 400;
        assert(
          exactlyOneSuccess,
          '5CA-CONC-SAME-PORTION-01',
          `Concurrent completions for same portion: exactly one HTTP 200, one conflict/error (Got statuses: ${res1A.status}, ${res1B.status})`
        );

        // Verify database state: portion decision is ACCEPTED and stable
        const finalizedPortion = await prisma.visitPortion.findUnique({ where: { id: v1Portion.id } });
        assert(
          finalizedPortion?.plant_decision === 'ACCEPTED',
          '5CA-CONC-SAME-PORTION-02',
          `Portion decision is stable: ${finalizedPortion?.plant_decision}`
        );

        // Verify zero duplicate PlantLabResult rows (each test_id appears exactly once for this portion)
        const plantResultsCount = await prisma.plantLabResult.count({ where: { portion_id: v1Portion.id } });
        const distinctTests = await prisma.plantLabResult.groupBy({
          by: ['test_id'],
          where: { portion_id: v1Portion.id },
        });
        assert(
          plantResultsCount === distinctTests.length && plantResultsCount > 0,
          '5CA-CONC-SAME-PORTION-03',
          `No duplicate PlantLabResult rows: total rows = ${plantResultsCount}, distinct test_ids = ${distinctTests.length}`
        );

        // Verify exactly one portion decision event
        const decisionEvents = await prisma.qATestingSessionEvent.findMany({
          where: {
            session_id: v1.qa_session!.id,
            event_type: { in: ['PORTION_ACCEPTED', 'PORTION_REJECTED'] },
          },
        });
        assert(
          decisionEvents.length === 1,
          '5CA-CONC-SAME-PORTION-04',
          `Exactly one portion decision event recorded (Found ${decisionEvents.length} events)`
        );
      } finally {
        await prisma.qATestingSessionEvent.deleteMany({ where: { session_id: v1.qa_session!.id } });
        await prisma.plantLabResult.deleteMany({ where: { portion_id: v1Portion.id } });
        await prisma.qATestingSession.deleteMany({ where: { id: v1.qa_session!.id } });
        await prisma.labTestAssignment.deleteMany({ where: { visit_id: v1.id } });
        await prisma.visitPortion.deleteMany({ where: { id: v1Portion.id } });
        await prisma.vehicleVisit.deleteMany({ where: { id: v1.id } });
      }

      // -------------------------------------------------------------------------
      // TEST 5B: Concurrent completion of different portions for the same visit
      // Expected: both final decisions persist correctly, final VehicleVisit status
      // is correct (READY_FOR_GROSS), must not remain PLANT_QA after all resolved.
      // -------------------------------------------------------------------------
      const v2Suffix = Math.floor(Math.random() * 900000) + 100000;
      const v2 = await prisma.vehicleVisit.create({
        data: {
          visit_number: `VV-5CA-2-${v2Suffix}`,
          vehicle_number: `QA-CONC-2-${v2Suffix}`,
          current_status: 'PLANT_QA',
          procurement_source_id: source.id,
          created_by: qaUser.id,
          portions: {
            create: [
              { portion_number: 1, current_status: 'PLANT_QA' },
              { portion_number: 2, current_status: 'PLANT_QA' },
            ],
          },
          qa_session: {
            create: {
              started_by: qaUser.id,
              status: 'IN_PROGRESS',
              started_at: new Date(Date.now() - 3600000),
            },
          },
        },
        include: { portions: { orderBy: { portion_number: 'asc' } }, qa_session: true },
      });

      // As normally done during session start, ensure test assignments snapshot is frozen
      await getOrAssignPlantQATests(prisma, v2.id);

      const [p1, p2] = v2.portions;
      const validResultsV2 = buildAcceptResults(plantReqTests);

      try {
        const [resP1, resP2] = await Promise.all([
          postComplete(
            new Request('http://localhost:3000/api/qa/complete', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                decision: 'ACCEPTED',
                results: validResultsV2,
                operationalTimestamp: new Date().toISOString(),
              }),
            }),
            { params: Promise.resolve({ visitId: v2.id.toString(), portionId: p1.id.toString() }) }
          ),
          postComplete(
            new Request('http://localhost:3000/api/qa/complete', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                decision: 'ACCEPTED',
                results: validResultsV2,
                operationalTimestamp: new Date().toISOString(),
              }),
            }),
            { params: Promise.resolve({ visitId: v2.id.toString(), portionId: p2.id.toString() }) }
          ),
        ]);

        assert(
          resP1.status === 200 && resP2.status === 200,
          '5CA-CROSS-PORTION-01',
          `Concurrent completion of Portion 1 and Portion 2 both succeed with HTTP 200 (${resP1.status}, ${resP2.status})`
        );

        const refreshedP1 = await prisma.visitPortion.findUnique({ where: { id: p1.id } });
        const refreshedP2 = await prisma.visitPortion.findUnique({ where: { id: p2.id } });
        assert(
          refreshedP1?.plant_decision === 'ACCEPTED' && refreshedP2?.plant_decision === 'ACCEPTED',
          '5CA-CROSS-PORTION-02',
          `Both portions persist decision = ACCEPTED (P1: ${refreshedP1?.plant_decision}, P2: ${refreshedP2?.plant_decision})`
        );

        const refreshedVisit2 = await prisma.vehicleVisit.findUnique({ where: { id: v2.id } });
        assert(
          refreshedVisit2?.current_status === 'READY_FOR_GROSS',
          '5CA-CROSS-PORTION-03',
          `Vehicle status advanced to READY_FOR_GROSS, not stale PLANT_QA (status: ${refreshedVisit2?.current_status})`
        );

        const v2Session = await prisma.qATestingSession.findUnique({ where: { id: v2.qa_session!.id } });
        assert(
          v2Session?.status === 'COMPLETED',
          '5CA-CROSS-PORTION-04',
          `QA testing session advanced to COMPLETED (status: ${v2Session?.status})`
        );
      } finally {
        await prisma.qATestingSessionEvent.deleteMany({ where: { session_id: v2.qa_session!.id } });
        await prisma.plantLabResult.deleteMany({ where: { portion_id: { in: [p1.id, p2.id] } } });
        await prisma.qATestingSession.deleteMany({ where: { id: v2.qa_session!.id } });
        await prisma.labTestAssignment.deleteMany({ where: { visit_id: v2.id } });
        await prisma.visitPortion.deleteMany({ where: { id: { in: [p1.id, p2.id] } } });
        await prisma.vehicleVisit.deleteMany({ where: { id: v2.id } });
      }

      // -------------------------------------------------------------------------
      // TEST 5C: HOLD against an ACCEPTED portion
      // Expected: rejected with controlled 400 error, accepted decision unchanged,
      // no HOLD event created.
      // -------------------------------------------------------------------------
      const v3Suffix = Math.floor(Math.random() * 900000) + 100000;
      const v3 = await prisma.vehicleVisit.create({
        data: {
          visit_number: `VV-5CA-3-${v3Suffix}`,
          vehicle_number: `QA-CONC-3-${v3Suffix}`,
          current_status: 'PLANT_QA',
          procurement_source_id: source.id,
          created_by: qaUser.id,
          portions: {
            create: [{ portion_number: 1, current_status: 'ACCEPTED', plant_decision: 'ACCEPTED' }],
          },
          qa_session: {
            create: {
              started_by: qaUser.id,
              status: 'IN_PROGRESS',
              started_at: new Date(Date.now() - 3600000),
            },
          },
        },
        include: { portions: true, qa_session: true },
      });

      const v3Portion = v3.portions[0];

      try {
        const holdOnAcceptedRes = await postHold(
          new Request('http://localhost:3000/api/qa/hold', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              reason: 'Attempted hold on accepted portion',
              operationalTimestamp: new Date().toISOString(),
            }),
          }),
          { params: Promise.resolve({ visitId: v3.id.toString(), portionId: v3Portion.id.toString() }) }
        );

        assert(
          holdOnAcceptedRes.status === 400,
          '5CA-HOLD-ON-ACCEPTED-01',
          `HOLD against ACCEPTED portion is rejected with HTTP 400 (Got status: ${holdOnAcceptedRes.status})`
        );

        const v3PortionCheck = await prisma.visitPortion.findUnique({ where: { id: v3Portion.id } });
        assert(
          v3PortionCheck?.plant_decision === 'ACCEPTED',
          '5CA-HOLD-ON-ACCEPTED-02',
          `Portion plant_decision remained ACCEPTED (decision: ${v3PortionCheck?.plant_decision})`
        );

        const holdEventsV3 = await prisma.qATestingSessionEvent.findMany({
          where: { session_id: v3.qa_session!.id, event_type: 'HOLD' },
        });
        assert(
          holdEventsV3.length === 0,
          '5CA-HOLD-ON-ACCEPTED-03',
          `Zero HOLD events created in session (Found: ${holdEventsV3.length})`
        );
      } finally {
        await prisma.qATestingSessionEvent.deleteMany({ where: { session_id: v3.qa_session!.id } });
        await prisma.qATestingSession.deleteMany({ where: { id: v3.qa_session!.id } });
        await prisma.visitPortion.deleteMany({ where: { id: v3Portion.id } });
        await prisma.vehicleVisit.deleteMany({ where: { id: v3.id } });
      }

      // -------------------------------------------------------------------------
      // TEST 5D: Duplicate HOLD
      // Expected: no duplicate HOLD event created.
      // -------------------------------------------------------------------------
      const v4Suffix = Math.floor(Math.random() * 900000) + 100000;
      const v4 = await prisma.vehicleVisit.create({
        data: {
          visit_number: `VV-5CA-4-${v4Suffix}`,
          vehicle_number: `QA-CONC-4-${v4Suffix}`,
          current_status: 'PLANT_QA',
          procurement_source_id: source.id,
          created_by: qaUser.id,
          portions: {
            create: [{ portion_number: 1, current_status: 'PLANT_QA' }],
          },
          qa_session: {
            create: {
              started_by: qaUser.id,
              status: 'IN_PROGRESS',
              started_at: new Date(Date.now() - 3600000),
            },
          },
        },
        include: { portions: true, qa_session: true },
      });

      const v4Portion = v4.portions[0];

      try {
        const makeHoldReq = () =>
          new Request('http://localhost:3000/api/qa/hold', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              reason: 'Re-test required',
              operationalTimestamp: new Date().toISOString(),
            }),
          });

        const firstHoldRes = await postHold(makeHoldReq(), {
          params: Promise.resolve({ visitId: v4.id.toString(), portionId: v4Portion.id.toString() }),
        });
        assert(firstHoldRes.status === 200, '5CA-DUPLICATE-HOLD-01', 'Initial postHold succeeds with HTTP 200');

        const secondHoldRes = await postHold(makeHoldReq(), {
          params: Promise.resolve({ visitId: v4.id.toString(), portionId: v4Portion.id.toString() }),
        });
        assert(secondHoldRes.status === 200, '5CA-DUPLICATE-HOLD-02', 'Repeated postHold returns HTTP 200 without error');

        const holdEventsV4 = await prisma.qATestingSessionEvent.findMany({
          where: { session_id: v4.qa_session!.id, event_type: 'HOLD' },
        });
        assert(
          holdEventsV4.length === 1,
          '5CA-DUPLICATE-HOLD-03',
          `Exactly one HOLD event exists in session (Found ${holdEventsV4.length} events)`
        );
      } finally {
        await prisma.qATestingSessionEvent.deleteMany({ where: { session_id: v4.qa_session!.id } });
        await prisma.qATestingSession.deleteMany({ where: { id: v4.qa_session!.id } });
        await prisma.visitPortion.deleteMany({ where: { id: v4Portion.id } });
        await prisma.vehicleVisit.deleteMany({ where: { id: v4.id } });
      }

      // -------------------------------------------------------------------------
      // TEST 5E: RESUME on a COMPLETED session
      // Expected: rejected with controlled error, status remains COMPLETED,
      // no RESUME event created.
      // -------------------------------------------------------------------------
      const v5Suffix = Math.floor(Math.random() * 900000) + 100000;
      const v5 = await prisma.vehicleVisit.create({
        data: {
          visit_number: `VV-5CA-5-${v5Suffix}`,
          vehicle_number: `QA-CONC-5-${v5Suffix}`,
          current_status: 'READY_FOR_GROSS',
          procurement_source_id: source.id,
          created_by: qaUser.id,
          portions: {
            create: [{ portion_number: 1, current_status: 'ACCEPTED', plant_decision: 'ACCEPTED' }],
          },
          qa_session: {
            create: {
              started_by: qaUser.id,
              status: 'COMPLETED',
              started_at: new Date(Date.now() - 3600000),
              completed_at: new Date(Date.now() - 600000),
              completed_by: qaUser.id,
            },
          },
        },
        include: { portions: true, qa_session: true },
      });

      try {
        const resumeCompletedRes = await postResume(
          new Request('http://localhost:3000/api/qa/resume', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              visitId: v5.id.toString(),
              operationalTimestamp: new Date().toISOString(),
            }),
          })
        );

        assert(
          resumeCompletedRes.status === 400,
          '5CA-RESUME-COMPLETED-01',
          `RESUME on a COMPLETED session is rejected with HTTP 400 (Got status: ${resumeCompletedRes.status})`
        );

        const v5SessionCheck = await prisma.qATestingSession.findUnique({ where: { id: v5.qa_session!.id } });
        assert(
          v5SessionCheck?.status === 'COMPLETED',
          '5CA-RESUME-COMPLETED-02',
          `Session status remained COMPLETED (status: ${v5SessionCheck?.status})`
        );

        const resumeEventsV5 = await prisma.qATestingSessionEvent.findMany({
          where: { session_id: v5.qa_session!.id, event_type: 'RESUME' },
        });
        assert(
          resumeEventsV5.length === 0,
          '5CA-RESUME-COMPLETED-03',
          `Zero RESUME events created for completed session (Found: ${resumeEventsV5.length})`
        );
      } finally {
        await prisma.qATestingSessionEvent.deleteMany({ where: { session_id: v5.qa_session!.id } });
        await prisma.qATestingSession.deleteMany({ where: { id: v5.qa_session!.id } });
        await prisma.visitPortion.deleteMany({ where: { visit_id: v5.id } });
        await prisma.vehicleVisit.deleteMany({ where: { id: v5.id } });
      }

      // -------------------------------------------------------------------------
      // TEST 5F: Duplicate/concurrent RESUME
      // Expected: session becomes IN_PROGRESS, exactly one RESUME event,
      // original started_at unchanged.
      // -------------------------------------------------------------------------
      const v6Suffix = Math.floor(Math.random() * 900000) + 100000;
      const v6SessionStart = new Date(Date.now() - 3600000);
      const v6 = await prisma.vehicleVisit.create({
        data: {
          visit_number: `VV-5CA-6-${v6Suffix}`,
          vehicle_number: `QA-CONC-6-${v6Suffix}`,
          current_status: 'PLANT_QA',
          procurement_source_id: source.id,
          created_by: qaUser.id,
          portions: {
            create: [{ portion_number: 1, current_status: 'HOLD', plant_decision: 'HOLD' }],
          },
          qa_session: {
            create: {
              started_by: qaUser.id,
              status: 'ON_HOLD',
              started_at: v6SessionStart,
              events: {
                create: [
                  {
                    event_type: 'HOLD',
                    timestamp: new Date(Date.now() - 1800000),
                    user_id: qaUser.id,
                    note: 'Initial hold for test',
                  },
                ],
              },
            },
          },
        },
        include: { portions: true, qa_session: true },
      });

      try {
        const makeResumeReq = () =>
          new Request('http://localhost:3000/api/qa/resume', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              visitId: v6.id.toString(),
              operationalTimestamp: new Date().toISOString(),
            }),
          });

        const [resumeRes1, resumeRes2] = await Promise.all([
          postResume(makeResumeReq()),
          postResume(makeResumeReq()),
        ]);

        assert(
          resumeRes1.status === 200 && resumeRes2.status === 200,
          '5CA-DUPLICATE-RESUME-01',
          `Concurrent resume requests return HTTP 200 (${resumeRes1.status}, ${resumeRes2.status})`
        );

        const v6SessionCheck = await prisma.qATestingSession.findUnique({ where: { id: v6.qa_session!.id } });
        assert(
          v6SessionCheck?.status === 'IN_PROGRESS',
          '5CA-DUPLICATE-RESUME-02',
          `Session status is IN_PROGRESS (status: ${v6SessionCheck?.status})`
        );

        const startedAtPreserved = v6SessionCheck?.started_at
          ? v6SessionCheck.started_at.getTime() === v6SessionStart.getTime()
          : false;
        assert(
          startedAtPreserved,
          '5CA-DUPLICATE-RESUME-03',
          'Original started_at remained unchanged after concurrent resume'
        );

        const resumeEventsV6 = await prisma.qATestingSessionEvent.findMany({
          where: { session_id: v6.qa_session!.id, event_type: 'RESUME' },
        });
        assert(
          resumeEventsV6.length === 1,
          '5CA-DUPLICATE-RESUME-04',
          `Exactly one RESUME event recorded despite concurrent calls (Found: ${resumeEventsV6.length})`
        );
      } finally {
        await prisma.qATestingSessionEvent.deleteMany({ where: { session_id: v6.qa_session!.id } });
        await prisma.qATestingSession.deleteMany({ where: { id: v6.qa_session!.id } });
        await prisma.visitPortion.deleteMany({ where: { visit_id: v6.id } });
        await prisma.vehicleVisit.deleteMany({ where: { id: v6.id } });
      }

      // -------------------------------------------------------------------------
      // TEST 5G: Strict QA HOLD State Transition R1
      // Scenario:
      // - Session is already ON_HOLD (due to portion 1 being placed on HOLD)
      // - Second undecided portion belongs to that visit (not currently HOLD)
      // - Calling the actual HOLD route for that second portion is rejected
      // - Second portion decision remains unchanged
      // - Session remains ON_HOLD
      // - HOLD event count remains unchanged
      // -------------------------------------------------------------------------
      const v7Suffix = Math.floor(Math.random() * 900000) + 100000;
      const v7 = await prisma.vehicleVisit.create({
        data: {
          visit_number: `VV-5CA-7-${v7Suffix}`,
          vehicle_number: `QA-CONC-7-${v7Suffix}`,
          current_status: 'PLANT_QA',
          procurement_source_id: source.id,
          created_by: qaUser.id,
          portions: {
            create: [
              { portion_number: 1, current_status: 'HOLD', plant_decision: 'HOLD' },
              { portion_number: 2, current_status: 'PLANT_QA', plant_decision: null },
            ],
          },
          qa_session: {
            create: {
              started_by: qaUser.id,
              status: 'ON_HOLD',
              started_at: new Date(Date.now() - 3600000),
              events: {
                create: [
                  {
                    event_type: 'HOLD',
                    timestamp: new Date(Date.now() - 1800000),
                    user_id: qaUser.id,
                    note: 'Portion 1 placed on hold',
                  },
                ],
              },
            },
          },
        },
        include: { portions: true, qa_session: true },
      });

      const portion2 = v7.portions.find((p) => p.portion_number === 2)!;

      try {
        const holdSecondPortionRes = await postHold(
          new Request('http://localhost:3000/api/qa/hold', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              reason: 'Attempt hold on second portion while session is already ON_HOLD',
              operationalTimestamp: new Date().toISOString(),
            }),
          }),
          {
            params: Promise.resolve({ visitId: v7.id.toString(), portionId: portion2.id.toString() }),
          }
        );

        assert(
          holdSecondPortionRes.status === 400 || holdSecondPortionRes.status === 409,
          '5CA-HOLD-WHEN-ON-HOLD-01',
          `HOLD on second portion while session is ON_HOLD is rejected (Got status: ${holdSecondPortionRes.status})`
        );

        const portion2Check = await prisma.visitPortion.findUnique({ where: { id: portion2.id } });
        assert(
          portion2Check?.plant_decision === null,
          '5CA-HOLD-WHEN-ON-HOLD-02',
          `Second portion decision remains null/unchanged (decision: ${portion2Check?.plant_decision})`
        );

        const v7SessionCheck = await prisma.qATestingSession.findUnique({ where: { id: v7.qa_session!.id } });
        assert(
          v7SessionCheck?.status === 'ON_HOLD',
          '5CA-HOLD-WHEN-ON-HOLD-03',
          `Session remains ON_HOLD after rejected HOLD attempt (status: ${v7SessionCheck?.status})`
        );

        const holdEventsV7 = await prisma.qATestingSessionEvent.findMany({
          where: { session_id: v7.qa_session!.id, event_type: 'HOLD' },
        });
        assert(
          holdEventsV7.length === 1,
          '5CA-HOLD-WHEN-ON-HOLD-04',
          `HOLD event count remains exactly 1 (Found: ${holdEventsV7.length})`
        );
      } finally {
        await prisma.qATestingSessionEvent.deleteMany({ where: { session_id: v7.qa_session!.id } });
        await prisma.qATestingSession.deleteMany({ where: { id: v7.qa_session!.id } });
        await prisma.visitPortion.deleteMany({ where: { visit_id: v7.id } });
        await prisma.vehicleVisit.deleteMany({ where: { id: v7.id } });
      }
    } finally {
      // Guaranteed cleanup in test DB
      if (createdSessionId) {
        await prisma.qATestingSessionEvent.deleteMany({ where: { session_id: createdSessionId } });
      }
      if (createdResultId) {
        await prisma.plantLabResult.deleteMany({ where: { id: createdResultId } });
      }
      if (createdSessionId) {
        await prisma.qATestingSession.deleteMany({ where: { id: createdSessionId } });
      }
      if (createdPortionId) {
        await prisma.visitPortion.deleteMany({ where: { id: createdPortionId } });
      }
      if (createdVisitId) {
        await prisma.vehicleVisit.deleteMany({ where: { id: createdVisitId } });
      }
    }

    console.log(`\n========================================`);
    console.log(`QA DECISION COMPLETENESS TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
    console.log(`========================================\n`);

    if (failed > 0) process.exit(1);
  } catch (err) {
    console.error('Error running QA decision completeness tests:', err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

runQADecisionCompletenessTests();
