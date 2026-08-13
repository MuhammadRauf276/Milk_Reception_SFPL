import { NextResponse } from 'next/server';
import { getCurrentUser } from '@core/auth';
import { prisma } from '@core/db';
import { completeQATestSchema } from '@/lib/validations/qa';
import { evaluateLabResult } from '@/lib/lab-rules';
import { validateNonNegativeDecimal } from '@/lib/validation-helpers';
import { validateOperationalTimestamp } from '@/backend/services/chronology-validator';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ visitId: string; portionId: string }> }
) {
  const authUser = await getCurrentUser();
  if (!authUser) {
    return NextResponse.json({ error: 'Unauthorized. Authentication required.' }, { status: 401 });
  }

  const dbUser = await prisma.user.findFirst({
    where: {
      OR: [
        { username: authUser.username },
        { username: authUser.id },
      ],
      is_active: true,
    },
  });

  const allowedRoles = ['QA_Operator', 'QA', 'QA_Manager', 'Admin', 'Correction_Officer'];
  if (!dbUser || !allowedRoles.includes(dbUser.role)) {
    return NextResponse.json({ error: 'Unauthorized. QA Chemist or QA Manager role required.' }, { status: 403 });
  }

  const resolvedParams = await params;
  const visitIdStr = resolvedParams.visitId;
  const portionIdStr = resolvedParams.portionId;

  try {
    const visitId = BigInt(visitIdStr);
    const portionId = BigInt(portionIdStr);
    const userIdBigInt = dbUser.id;

    const body = await req.json();
    const validated = completeQATestSchema.parse(body);

    const portion = await prisma.visitPortion.findFirst({
      where: { id: portionId, visit_id: visitId },
    });

    if (!portion) {
      return NextResponse.json({ error: 'Portion record not found for this vehicle visit' }, { status: 404 });
    }

    if (portion.plant_decision === 'ACCEPTED' || portion.plant_decision === 'REJECTED') {
      return NextResponse.json({ error: 'Portion testing has already been completed and finalized.' }, { status: 400 });
    }

    const explicitDecision = validated.decision;
    const rejectionReasonInput = (validated.rejectionReason || '').trim();
    const rejectionRemarksInput = (validated.rejectionRemarks || '').trim();

    // Load active required PLANT and BOTH tests from database configuration
    const activeRequiredTests = await prisma.labTest.findMany({
      where: {
        isActive: true,
        isRequired: true,
        testScope: { in: ['PLANT', 'BOTH'] },
      },
    });

    const activeRequiredMap = new Map(activeRequiredTests.map((t) => [t.id.toString(), t]));
    const submittedResultMap = new Map(validated.results.map((r) => [r.testId, r]));

    // Determine target decision
    let isRejecting = explicitDecision === 'REJECTED';

    if (isRejecting) {
      // Rule QA-REJECT-ZERO-01: At least ONE actual recorded test result is required to reject
      if (validated.results.length === 0) {
        return NextResponse.json(
          { error: 'At least 1 actual test result is required to reject a portion.' },
          { status: 400 }
        );
      }

      if (!rejectionReasonInput) {
        return NextResponse.json({ error: 'Rejection reason is required.' }, { status: 400 });
      }

      if (!rejectionRemarksInput) {
        return NextResponse.json({ error: 'Rejection remarks are required.' }, { status: 400 });
      }
    } else {
      // For ACCEPT decision: MUST have all configured required Plant QA tests submitted (CONFIG-TEST-01)
      for (const [reqId, reqTest] of Array.from(activeRequiredMap.entries())) {
        const res = submittedResultMap.get(reqId);
        if (!res) {
          return NextResponse.json(
            { error: `Required plant test "${reqTest.testName}" (${reqTest.testCode}) is missing a result.` },
            { status: 400 }
          );
        }

        if (reqTest.resultType === 'NUMERIC') {
          const numVal = validateNonNegativeDecimal(res.numericValue, reqTest.testName);
          if (!numVal.isValid) {
            return NextResponse.json({ error: numVal.error }, { status: 400 });
          }
        } else if (reqTest.resultType === 'OK_NOT_OK') {
          const val = (res.textValue || '').trim().toUpperCase();
          if (!val || !['OK', 'NOT_OK'].includes(val)) {
            return NextResponse.json(
              { error: `Invalid option "${res.textValue}" for test "${reqTest.testName}". Option must be OK or NOT_OK.` },
              { status: 400 }
            );
          }
        } else if (reqTest.resultType === 'POSITIVE_NEGATIVE') {
          const val = (res.textValue || '').trim().toUpperCase();
          if (!val || !['NEGATIVE', 'POSITIVE'].includes(val)) {
            return NextResponse.json(
              { error: `Invalid option "${res.textValue}" for test "${reqTest.testName}". Option must be NEGATIVE or POSITIVE.` },
              { status: 400 }
            );
          }
        }
      }
    }

    // Fetch all test definitions for submitted results
    const allTestIds = validated.results.map((r) => BigInt(r.testId));
    const allTestDefs = await prisma.labTest.findMany({
      where: { id: { in: allTestIds } },
    });
    const allTestDefMap = new Map(allTestDefs.map((t) => [t.id.toString(), t]));

    const failedTestCodes: string[] = [];
    const now = new Date();
    const targetOpTs = body.operationalTimestamp ? new Date(body.operationalTimestamp) : (body.opTimestamp ? new Date(body.opTimestamp) : now);

    // Evaluate each submitted test result using centralized lab-rule service
    const evaluatedResults = validated.results.map((res) => {
      const testDef = allTestDefMap.get(res.testId);
      const numVal = res.numericValue !== undefined && res.numericValue !== null ? res.numericValue : null;
      const textVal = res.textValue ? res.textValue.trim() : null;

      const evalRes = evaluateLabResult(testDef?.testCode || '', numVal, textVal, 'PLANT');

      if (!evalRes.isPassed && testDef?.isRequired) {
        failedTestCodes.push(testDef.testCode);
      }

      return {
        testId: BigInt(res.testId),
        numericValue: numVal,
        textValue: textVal,
        isPassed: evalRes.isPassed,
      };
    });

    if (failedTestCodes.length > 0) {
      isRejecting = true;
    }

    const plantDecision = isRejecting ? 'REJECTED' : 'ACCEPTED';
    const finalRejectionReason = isRejecting
      ? rejectionReasonInput || `Failed tests: ${failedTestCodes.join(', ')}`
      : null;

    // Atomic Prisma Transaction to complete testing
    await prisma.$transaction(async (tx) => {
      // Validate chronology against session start or latest QA event
      const session = await tx.qATestingSession.findUnique({
        where: { visit_id: visitId },
      });

      const latestEvent = session ? await tx.qATestingSessionEvent.findFirst({
        where: { session_id: session.id },
        orderBy: { timestamp: 'desc' },
      }) : null;

      const predTs = latestEvent?.timestamp ? new Date(latestEvent.timestamp) : (session?.started_at ? new Date(session.started_at) : null);
      const predLabel = latestEvent ? `QA ${latestEvent.event_type}` : 'QA Start';

      const chronoVal = validateOperationalTimestamp(targetOpTs.toISOString(), predTs, 'QA Decision', predLabel);
      if (!chronoVal.isValid) {
        throw new Error(chronoVal.error);
      }

      // 1. Upsert PlantLabResult rows with validated targetOpTs
      for (const evalResult of evaluatedResults) {
        const existing = await tx.plantLabResult.findFirst({
          where: { portion_id: portionId, test_id: evalResult.testId },
        });

        if (existing) {
          await tx.plantLabResult.update({
            where: { id: existing.id },
            data: {
              result_timestamp: targetOpTs,
              numeric_value: evalResult.numericValue,
              text_value: evalResult.textValue,
              is_passed: evalResult.isPassed,
              tested_by: userIdBigInt,
            },
          });
        } else {
          await tx.plantLabResult.create({
            data: {
              visit_id: visitId,
              portion_id: portionId,
              test_id: evalResult.testId,
              sample_timestamp: targetOpTs,
              result_timestamp: targetOpTs,
              numeric_value: evalResult.numericValue,
              text_value: evalResult.textValue,
              is_passed: evalResult.isPassed,
              tested_by: userIdBigInt,
            },
          });
        }
      }

      // 2. Update VisitPortion decision
      await tx.visitPortion.update({
        where: { id: portionId },
        data: {
          plant_decision: plantDecision,
          current_status: plantDecision,
          plant_rejection_reason: finalRejectionReason,
          plant_decided_by: userIdBigInt,
          plant_decided_at: targetOpTs,
        },
      });

      // Log immutable portion decision event in QATestingSessionEvent
      if (session) {
        await tx.qATestingSessionEvent.create({
          data: {
            session_id: session.id,
            event_type: plantDecision === 'ACCEPTED' ? 'PORTION_ACCEPTED' : 'PORTION_REJECTED',
            timestamp: targetOpTs,
            user_id: userIdBigInt,
            note: `Portion #${portion.portion_number} ${plantDecision}${finalRejectionReason ? `: ${finalRejectionReason}` : ''}`,
          },
        });
      }

      // 3. Calculate visit-level workflow status across all portions
      const allPortions = await tx.visitPortion.findMany({
        where: { visit_id: visitId },
      });

      const decisions = allPortions.map((p) => p.plant_decision);
      const hasUnresolved = decisions.some(
        (d) => !d || d === 'PENDING' || d === 'HOLD' || d === 'UNDER_TEST'
      );
      const allRejected = decisions.length > 0 && decisions.every((d) => d === 'REJECTED');
      const hasAccepted = decisions.some((d) => d === 'ACCEPTED');

      let newVisitStatus = 'PLANT_QA';
      if (hasUnresolved) {
        newVisitStatus = 'PLANT_QA';
      } else if (allRejected) {
        // Case 2: ALL portions REJECTED -> Direct return exit path
        newVisitStatus = 'READY_FOR_GATE_EXIT';
      } else if (hasAccepted) {
        // Case 1: At least one portion ACCEPTED and no unresolved HOLD -> Continue to gross weighing
        newVisitStatus = 'READY_FOR_GROSS';
      }

      await tx.vehicleVisit.update({
        where: { id: visitId },
        data: { current_status: newVisitStatus },
      });

      // Complete QA testing session if vehicle has left PLANT_QA
      if (newVisitStatus !== 'PLANT_QA') {
        const session = await tx.qATestingSession.findUnique({
          where: { visit_id: visitId },
        });

        if (session) {
          await tx.qATestingSession.update({
            where: { id: session.id },
            data: {
              status: 'COMPLETED',
              completed_by: userIdBigInt,
              completed_at: targetOpTs,
            },
          });

          await tx.qATestingSessionEvent.create({
            data: {
              session_id: session.id,
              event_type: 'COMPLETE',
              timestamp: targetOpTs,
              user_id: userIdBigInt,
              note: `QA session completed with outcome: ${newVisitStatus}`,
            },
          });
        }
      }
    });

    return NextResponse.json({
      success: true,
      portionId: portionIdStr,
      plantDecision,
      rejectionReason: finalRejectionReason,
      message: `Portion #${portion.portion_number} testing completed. Decision: ${plantDecision}.`,
    });
  } catch (error: any) {
    if (error?.name === 'ZodError') {
      return NextResponse.json({ error: error.errors[0]?.message || 'Validation failed' }, { status: 400 });
    }
    return NextResponse.json({ error: error?.message || 'Failed to complete QA test' }, { status: 500 });
  }
}
