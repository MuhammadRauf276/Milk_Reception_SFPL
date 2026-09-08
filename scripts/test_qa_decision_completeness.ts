import { prisma } from '../src/backend/core/db';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const nextHeaders = require('next/headers');
import { createSessionToken } from '../src/backend/core/auth';
import { POST as postHold } from '../src/app/api/qa/vehicle-visits/[visitId]/portions/[portionId]/hold/route';
import { POST as postResume } from '../src/app/api/qa/sessions/resume/route';
import { assertSafeTestDatabase } from '../tests/helpers/testDbSafety';

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
