import { NextResponse } from 'next/server';
import { getCurrentUser } from '@core/auth';
import { prisma } from '@core/db';
import { completeQATestSchema } from '@/lib/validations/qa';
import { evaluateLabResult } from '@/lib/lab-rules';
import { validateNonNegativeDecimal } from '@/lib/validation-helpers';
import { validateOperationalTimestamp } from '@/backend/services/chronology-validator';
import { getOrAssignPlantQATests } from '@/backend/services/labTestAssignmentService';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ visitId: string; portionId: string }> }
) {
  const authUser = await getCurrentUser(req);
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

  const allowedRoles = ['QA_Operator', 'QA', 'QA_Manager', 'Admin', 'SUPER_ADMIN', 'Correction_Officer'];
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

    // Load assigned Plant QA test snapshot for this visit
    const assignedPlantTests = await getOrAssignPlantQATests(prisma, visitId);

    // Separate manual (non-CALCULATED) from CALCULATED tests using snapshot metadata
    const manualPlantTests = assignedPlantTests.filter((t) => t.result_type_snapshot !== 'CALCULATED');
    const requiredManualTests = manualPlantTests.filter((t) => t.is_required_snapshot);

    const activeRequiredMap = new Map(requiredManualTests.map((t) => [t.test_id.toString(), t]));

    // Build submitted result map: testId → submitted result entry
    const submittedResultMap = new Map(validated.results.map((r) => [r.testId, r]));

    let isRejecting = explicitDecision === 'REJECTED';

    if (isRejecting) {
      // QA-REJECT-ZERO-01: At least ONE PERFORMED result required to reject.
      // NOT_PERFORMED alone is not rejection evidence.
      const performedResults = validated.results.filter(
        (r) => (r.performanceStatus || 'PERFORMED') === 'PERFORMED'
      );

      if (performedResults.length === 0) {
        return NextResponse.json(
          { error: 'At least 1 actual PERFORMED test result is required to reject a portion. NOT_PERFORMED alone is not sufficient rejection evidence.' },
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
      // QA-ACCEPT-STRICT: ALL assigned required manual tests must be PERFORMED with valid results.
      // NOT_PERFORMED or UNRESOLVED (no row) both block ACCEPT.
      for (const [reqId, reqTest] of Array.from(activeRequiredMap.entries())) {
        const res = submittedResultMap.get(reqId);

        // UNRESOLVED: no entry submitted at all → block ACCEPT
        if (!res) {
          return NextResponse.json(
            { error: `Required plant test "${reqTest.test_name_snapshot}" (${reqTest.test_code_snapshot}) has no result. All required tests must be PERFORMED to accept.` },
            { status: 400 }
          );
        }

        const perfStatus = res.performanceStatus || 'PERFORMED';

        // NOT_PERFORMED → block ACCEPT
        if (perfStatus === 'NOT_PERFORMED') {
          return NextResponse.json(
            { error: `Required plant test "${reqTest.test_name_snapshot}" (${reqTest.test_code_snapshot}) is marked NOT_PERFORMED. All required tests must be PERFORMED to accept.` },
            { status: 400 }
          );
        }

        // PERFORMED — validate the actual value based on result_options_snapshot / result_type_snapshot
        const options = (reqTest.result_options_snapshot as any[]) || null;
        if (Array.isArray(options) && options.length > 0) {
          const val = (res.textValue || '').trim().toUpperCase();
          const match = options.find((opt: any) => opt.value.trim().toUpperCase() === val);
          if (!match) {
            return NextResponse.json(
              { error: `Invalid option "${res.textValue}" for test "${reqTest.test_name_snapshot}". Allowed options: ${options.map((o: any) => o.label || o.value).join(', ')}.` },
              { status: 400 }
            );
          }
          if (match.isPassing === null || match.isPassing === undefined) {
            return NextResponse.json(
              { error: `"${reqTest.test_name_snapshot}" has a neutral / informational result and cannot satisfy the required passing result for acceptance.` },
              { status: 400 }
            );
          }
          if (match.isPassing === false) {
            return NextResponse.json(
              { error: `"${reqTest.test_name_snapshot}" has a failing result and cannot be accepted.` },
              { status: 400 }
            );
          }
        } else if (reqTest.result_type_snapshot === 'NUMERIC') {
          const numVal = validateNonNegativeDecimal(res.numericValue, reqTest.test_name_snapshot);
          if (!numVal.isValid) {
            return NextResponse.json({ error: numVal.error }, { status: 400 });
          }
        } else if (reqTest.result_type_snapshot === 'OK_NOT_OK') {
          const val = (res.textValue || '').trim().toUpperCase();
          if (!val || !['OK', 'NOT_OK'].includes(val)) {
            return NextResponse.json(
              { error: `Invalid option "${res.textValue}" for test "${reqTest.test_name_snapshot}". Option must be OK or NOT_OK.` },
              { status: 400 }
            );
          }
        } else if (reqTest.result_type_snapshot === 'POSITIVE_NEGATIVE') {
          const val = (res.textValue || '').trim().toUpperCase();
          if (!val || !['NEGATIVE', 'POSITIVE'].includes(val)) {
            return NextResponse.json(
              { error: `Invalid option "${res.textValue}" for test "${reqTest.test_name_snapshot}". Option must be NEGATIVE or POSITIVE.` },
              { status: 400 }
            );
          }
        }
      }
    }

    // Map of assigned test definitions by test_id
    const assignedTestMap = new Map(assignedPlantTests.map((t) => [t.test_id.toString(), t]));

    const failedTestCodes: string[] = [];
    const now = new Date();
    const targetOpTs = body.operationalTimestamp ? new Date(body.operationalTimestamp) : (body.opTimestamp ? new Date(body.opTimestamp) : now);

    // Evaluate each submitted PERFORMED result using centralized lab-rule service
    // NOT_PERFORMED results skip evaluation entirely — isPassed stays null
    const evaluatedResults = validated.results.map((res) => {
      const testDef = assignedTestMap.get(res.testId);
      const perfStatus = res.performanceStatus || 'PERFORMED';
      const notPerformedReason = perfStatus === 'NOT_PERFORMED'
        ? (res.notPerformedReason?.trim() || null)
        : null;

      if (perfStatus === 'NOT_PERFORMED') {
        return {
          testId: BigInt(res.testId),
          performanceStatus: 'NOT_PERFORMED' as const,
          notPerformedReason,
          numericValue: null,
          textValue: null,
          isPassed: null,
        };
      }

      const numVal = res.numericValue !== undefined && res.numericValue !== null ? res.numericValue : null;
      const textVal = res.textValue ? res.textValue.trim() : null;
      const snapshotOptions = (testDef?.result_options_snapshot as any[]) || null;

      const evalRes = evaluateLabResult(
        testDef?.test_code_snapshot || '',
        numVal,
        textVal,
        testDef?.result_type_snapshot || 'PLANT',
        snapshotOptions
      );

      if (evalRes.isPassed === false && testDef?.is_required_snapshot) {
        failedTestCodes.push(testDef.test_code_snapshot);
      }

      return {
        testId: BigInt(res.testId),
        performanceStatus: 'PERFORMED' as const,
        notPerformedReason: null,
        numericValue: numVal,
        textValue: textVal,
        isPassed: evalRes.isPassed,
      };
    });

    // Lab rule failures force rejection
    if (failedTestCodes.length > 0) {
      isRejecting = true;
    }

    const plantDecision = isRejecting ? 'REJECTED' : 'ACCEPTED';
    const finalRejectionReason = isRejecting
      ? rejectionReasonInput || `Failed tests: ${failedTestCodes.join(', ')}`
      : null;

    // Atomic Prisma Transaction
    await prisma.$transaction(async (tx) => {
      // Validate chronology
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

      // 1. Upsert submitted PlantLabResult rows
      for (const evalResult of evaluatedResults) {
        const existing = await tx.plantLabResult.findFirst({
          where: { portion_id: portionId, test_id: evalResult.testId },
        });

        if (existing) {
          await tx.plantLabResult.update({
            where: { id: existing.id },
            data: {
              result_timestamp: targetOpTs,
              performance_status: evalResult.performanceStatus,
              not_performed_reason: evalResult.notPerformedReason,
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
              performance_status: evalResult.performanceStatus,
              not_performed_reason: evalResult.notPerformedReason,
              numeric_value: evalResult.numericValue,
              text_value: evalResult.textValue,
              is_passed: evalResult.isPassed,
              tested_by: userIdBigInt,
            },
          });
        }
      }

      // 2. At REJECT time: auto-finalize UNRESOLVED required tests.
      //    Already-PERFORMED/NOT_PERFORMED rows are untouched.
      if (isRejecting) {
        const submittedTestIds = new Set(evaluatedResults.map((r) => r.testId.toString()));

        for (const [reqId, reqTest] of Array.from(activeRequiredMap.entries())) {
          if (!submittedTestIds.has(reqId)) {
            // UNRESOLVED — auto-finalize as NOT_PERFORMED with standard reason
            const existing = await tx.plantLabResult.findFirst({
              where: { portion_id: portionId, test_id: BigInt(reqId) },
            });

            if (existing) {
              // Only overwrite if still PERFORMED (don't double-write already-set NOT_PERFORMED)
              if (existing.performance_status !== 'NOT_PERFORMED') {
                await tx.plantLabResult.update({
                  where: { id: existing.id },
                  data: {
                    result_timestamp: targetOpTs,
                    performance_status: 'NOT_PERFORMED',
                    not_performed_reason: 'VEHICLE_REJECTED_BEFORE_TEST_COMPLETION',
                    numeric_value: null,
                    text_value: null,
                    is_passed: null,
                    tested_by: userIdBigInt,
                  },
                });
              }
            } else {
              await tx.plantLabResult.create({
                data: {
                  visit_id: visitId,
                  portion_id: portionId,
                  test_id: BigInt(reqId),
                  sample_timestamp: targetOpTs,
                  result_timestamp: targetOpTs,
                  performance_status: 'NOT_PERFORMED',
                  not_performed_reason: 'VEHICLE_REJECTED_BEFORE_TEST_COMPLETION',
                  numeric_value: null,
                  text_value: null,
                  is_passed: null,
                  tested_by: userIdBigInt,
                },
              });
            }
          }
        }
      }

      // 3. Update VisitPortion decision
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

      // 4. Log immutable portion decision event in QATestingSessionEvent
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

      // 5. Calculate visit-level workflow status
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
        newVisitStatus = 'READY_FOR_GATE_EXIT';
      } else if (hasAccepted) {
        newVisitStatus = 'READY_FOR_GROSS';
      }

      await tx.vehicleVisit.update({
        where: { id: visitId },
        data: { current_status: newVisitStatus },
      });

      // 6. Complete QA testing session if visit has advanced past PLANT_QA
      if (newVisitStatus !== 'PLANT_QA') {
        const activeSession = await tx.qATestingSession.findUnique({
          where: { visit_id: visitId },
        });

        if (activeSession) {
          await tx.qATestingSession.update({
            where: { id: activeSession.id },
            data: {
              status: 'COMPLETED',
              completed_by: userIdBigInt,
              completed_at: targetOpTs,
            },
          });

          await tx.qATestingSessionEvent.create({
            data: {
              session_id: activeSession.id,
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
    if (error?.name === 'ZodError' || error?.issues) {
      const msg = error.issues?.[0]?.message || error.errors?.[0]?.message || error.message || 'Validation failed';
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    return NextResponse.json({ error: error?.message || 'Failed to complete QA test' }, { status: 500 });
  }
}
