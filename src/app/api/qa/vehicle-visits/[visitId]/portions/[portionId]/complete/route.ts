import { NextResponse } from 'next/server';
import { getCurrentUser } from '@core/auth';
import { prisma } from '@core/db';
import { completeQATestSchema } from '@/lib/validations/qa';
import { QualityRuleService } from '@/backend/services/qualityRuleService';
import { validateNonNegativeDecimal } from '@/lib/validation-helpers';
import { validateOperationalTimestamp } from '@/backend/services/chronology-validator';
import { getOrAssignPlantQATests } from '@/backend/services/labTestAssignmentService';

class RouteError extends Error {
  statusCode: number;
  constructor(message?: string, statusCode: number = 400) {
    super(message || 'Operation failed');
    this.statusCode = statusCode;
  }
}

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

  const allowedRoles = ['QA_LAB_ATTENDANT'];
  if (!dbUser || !allowedRoles.includes(dbUser.role)) {
    return NextResponse.json(
      { error: 'Unauthorized. QA Lab Attendant role required for testing operations.' },
      { status: 403 }
    );
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
      return NextResponse.json({ error: 'Portion testing has already been completed and finalized.' }, { status: 409 });
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
    const submittedResultMap = new Map(validated.results.map((r) => [r.testId, r]));

    const isOperatorRejecting = explicitDecision === 'REJECTED';

    if (isOperatorRejecting) {
      // QA-REJECT-ZERO-01: At least ONE PERFORMED result required to reject.
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
      // Operator is attempting to ACCEPT:
      // ALL assigned required manual tests must be PERFORMED with valid inputs.
      for (const [reqId, reqTest] of Array.from(activeRequiredMap.entries())) {
        const res = submittedResultMap.get(reqId);

        if (!res) {
          return NextResponse.json(
            { error: `Required plant test "${reqTest.test_name_snapshot}" (${reqTest.test_code_snapshot}) has no result. All required tests must be PERFORMED to accept.` },
            { status: 400 }
          );
        }

        const perfStatus = res.performanceStatus || 'PERFORMED';

        if (perfStatus === 'NOT_PERFORMED') {
          return NextResponse.json(
            { error: `Required plant test "${reqTest.test_name_snapshot}" (${reqTest.test_code_snapshot}) is marked NOT_PERFORMED. All required tests must be PERFORMED to accept.` },
            { status: 400 }
          );
        }

        // Validate value formats
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
        } else if (reqTest.result_type_snapshot === 'NUMERIC') {
          const numVal = validateNonNegativeDecimal(res.numericValue, reqTest.test_name_snapshot);
          if (!numVal.isValid) {
            return NextResponse.json({ error: numVal.error }, { status: 400 });
          }
        }
      }
    }

    const assignedTestMap = new Map(assignedPlantTests.map((t) => [t.test_id.toString(), t]));
    const now = new Date();
    const targetOpTs = body.operationalTimestamp ? new Date(body.operationalTimestamp) : (body.opTimestamp ? new Date(body.opTimestamp) : now);

    let lockedPortionRecord: any = null;
    let finalPlantDecision = 'ACCEPTED';
    let finalManagerReviewStatus = 'NONE';
    let systemQualityOutcome: string = 'PASS';

    // Atomic Prisma Transaction
    await prisma.$transaction(async (tx) => {
      // 0. Acquire PostgreSQL Row-Level Lock (FOR UPDATE) for the exact VehicleVisit
      await tx.$executeRaw`SELECT id FROM vehicle_visit WHERE id = ${visitId} FOR UPDATE`;

      // 1. Re-read the VisitPortion within the locked transaction
      const lockedPortion = await tx.visitPortion.findFirst({
        where: { id: portionId, visit_id: visitId },
      });

      if (!lockedPortion) {
        throw new RouteError('Portion record not found for this vehicle visit', 404);
      }

      if (lockedPortion.plant_decision === 'ACCEPTED' || lockedPortion.plant_decision === 'REJECTED') {
        throw new RouteError('Portion testing has already been completed and finalized.', 409);
      }

      lockedPortionRecord = lockedPortion;

      // 2. Re-read QA Session & Validate chronology
      const session = await tx.qATestingSession.findUnique({
        where: { visit_id: visitId },
      });

      if (!session) {
        throw new RouteError('QA testing session not found.', 404);
      }

      if (session.status !== 'IN_PROGRESS') {
        throw new RouteError(`QA testing session is not IN_PROGRESS (current status: ${session.status}).`, 409);
      }

      const latestEvent = await tx.qATestingSessionEvent.findFirst({
        where: { session_id: session.id },
        orderBy: { timestamp: 'desc' },
      });

      const predTs = latestEvent?.timestamp ? new Date(latestEvent.timestamp) : (session.started_at ? new Date(session.started_at) : null);
      const predLabel = latestEvent ? `QA ${latestEvent.event_type}` : 'QA Start';

      const chronoVal = validateOperationalTimestamp(targetOpTs.toISOString(), predTs, 'QA Decision', predLabel);
      if (!chronoVal.isValid) {
        throw new RouteError(chronoVal.error, 400);
      }

      // 3. Resolve active LabTestRules for PLANT_QA at targetOpTs
      const activeRulesMap = await QualityRuleService.resolveActiveRulesForTestingPoint(
        'PLANT_QA',
        targetOpTs,
        tx
      );

      // 4. Evaluate each submitted result using centralized QualityRuleService
      const evaluationEntries: Array<{
        testId: bigint;
        performanceStatus: string;
        notPerformedReason: string | null;
        numericValue: any;
        textValue: string | null;
        appliedRuleId: bigint | null;
        appliedRuleVersion: number | null;
        evaluationStatus: string;
        isPassed: boolean | null;
        evaluationSnapshot?: any;
      }> = [];

      for (const res of validated.results) {
        const testDef = assignedTestMap.get(res.testId);
        const perfStatus = res.performanceStatus || 'PERFORMED';
        const notPerfReason = perfStatus === 'NOT_PERFORMED' ? (res.notPerformedReason?.trim() || null) : null;

        if (perfStatus === 'NOT_PERFORMED') {
          evaluationEntries.push({
            testId: BigInt(res.testId),
            performanceStatus: 'NOT_PERFORMED',
            notPerformedReason: notPerfReason,
            numericValue: null,
            textValue: null,
            appliedRuleId: null,
            appliedRuleVersion: null,
            evaluationStatus: 'NO_ACTIVE_RULE',
            isPassed: null,
          });
          continue;
        }

        const numVal = res.numericValue !== undefined && res.numericValue !== null ? res.numericValue : null;
        const textVal = res.textValue ? res.textValue.trim() : null;
        const activeRule = activeRulesMap.get(res.testId) || null;
        const snapshotOptions = (testDef?.result_options_snapshot as any[]) || null;

        const evalRes = QualityRuleService.evaluateQualityResult({
          testId: res.testId,
          testCode: testDef?.test_code_snapshot,
          resultType: testDef?.result_type_snapshot || 'NUMERIC',
          numericValue: numVal,
          textValue: textVal,
          rule: activeRule,
          resultOptions: snapshotOptions,
          testingPoint: 'PLANT_QA',
        });

        evaluationEntries.push({
          testId: BigInt(res.testId),
          performanceStatus: 'PERFORMED',
          notPerformedReason: null,
          numericValue: numVal,
          textValue: textVal,
          appliedRuleId: evalRes.appliedRuleId,
          appliedRuleVersion: evalRes.appliedRuleVersion,
          evaluationStatus: evalRes.evaluationStatus,
          isPassed: evalRes.isPassed,
          evaluationSnapshot: evalRes.evaluationSnapshot,
        });
      }

      // Check if any rule has configuration error
      if (evaluationEntries.some((e) => e.evaluationStatus === 'RULE_CONFIGURATION_ERROR')) {
        throw new RouteError('Laboratory rule configuration error detected. QA completion is blocked.', 500);
      }

      // 5. Aggregate system quality outcome
      systemQualityOutcome = QualityRuleService.aggregateSystemQualityOutcome(
        evaluationEntries.map((e) => ({
          evaluationStatus: e.evaluationStatus,
          performanceStatus: e.performanceStatus,
          isRequired: activeRequiredMap.has(e.testId.toString()),
        }))
      );

      // 6. Upsert submitted PlantLabResult rows with rule linkages
      for (const entry of evaluationEntries) {
        const existing = await tx.plantLabResult.findFirst({
          where: { portion_id: portionId, test_id: entry.testId },
        });

        if (existing) {
          await tx.plantLabResult.update({
            where: { id: existing.id },
            data: {
              result_timestamp: targetOpTs,
              performance_status: entry.performanceStatus,
              not_performed_reason: entry.notPerformedReason,
              numeric_value: entry.numericValue,
              text_value: entry.textValue,
              applied_rule_id: entry.appliedRuleId,
              applied_rule_version: entry.appliedRuleVersion,
              evaluation_status: entry.evaluationStatus,
              is_passed: entry.isPassed,
              evaluation_snapshot: (entry as any).evaluationSnapshot as any,
              tested_by: userIdBigInt,
            },
          });
        } else {
          await tx.plantLabResult.create({
            data: {
              visit_id: visitId,
              portion_id: portionId,
              test_id: entry.testId,
              sample_timestamp: targetOpTs,
              result_timestamp: targetOpTs,
              performance_status: entry.performanceStatus,
              not_performed_reason: entry.notPerformedReason,
              numeric_value: entry.numericValue,
              text_value: entry.textValue,
              applied_rule_id: entry.appliedRuleId,
              applied_rule_version: entry.appliedRuleVersion,
              evaluation_status: entry.evaluationStatus,
              is_passed: entry.isPassed,
              evaluation_snapshot: (entry as any).evaluationSnapshot as any,
              tested_by: userIdBigInt,
            },
          });
        }
      }

      // 7. auto-finalize UNRESOLVED required tests when rejecting
      if (isOperatorRejecting) {
        const submittedTestIds = new Set(evaluationEntries.map((r) => r.testId.toString()));
        for (const [reqId] of Array.from(activeRequiredMap.entries())) {
          if (!submittedTestIds.has(reqId)) {
            const existing = await tx.plantLabResult.findFirst({
              where: { portion_id: portionId, test_id: BigInt(reqId) },
            });

            if (existing) {
              if (existing.performance_status !== 'NOT_PERFORMED') {
                await tx.plantLabResult.update({
                  where: { id: existing.id },
                  data: {
                    result_timestamp: targetOpTs,
                    performance_status: 'NOT_PERFORMED',
                    not_performed_reason: 'VEHICLE_REJECTED_BEFORE_TEST_COMPLETION',
                    numeric_value: null,
                    text_value: null,
                    applied_rule_id: null,
                    applied_rule_version: null,
                    evaluation_status: 'NO_ACTIVE_RULE',
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
                  applied_rule_id: null,
                  applied_rule_version: null,
                  evaluation_status: 'NO_ACTIVE_RULE',
                  is_passed: null,
                  tested_by: userIdBigInt,
                },
              });
            }
          }
        }
      }

      // 8. Determine Portion Decision & Manager Review Escalation
      // Business Rule: Lab Attendant does NOT make the final accept/reject decision when system release outcome is OUT_OF_SPEC.
      if (systemQualityOutcome === 'OUT_OF_SPEC') {
        // Automatic escalation to QA Manager Review Workflow
        finalPlantDecision = 'PENDING';
        finalManagerReviewStatus = 'PENDING';

        await tx.visitPortion.update({
          where: { id: portionId },
          data: {
            plant_decision: 'PENDING',
            current_status: 'UNDER_TEST',
            system_quality_outcome: 'OUT_OF_SPEC',
            manager_review_status: 'PENDING',
            manager_requested_decision: 'SYSTEM_OUT_OF_SPEC',
            manager_review_requested_by_user_id: userIdBigInt,
            manager_review_requested_at: targetOpTs,
            manager_review_reason: 'SYSTEM_OUT_OF_SPEC: automatic escalation for out-of-spec test results',
          },
        });

        if (session) {
          await tx.qATestingSessionEvent.create({
            data: {
              session_id: session.id,
              event_type: 'HOLD',
              timestamp: targetOpTs,
              user_id: userIdBigInt,
              note: `Portion #${lockedPortion.portion_number} quality outcome is OUT_OF_SPEC; escalated to QA Manager review.`,
            },
          });
        }
      } else if (isOperatorRejecting) {
        // Manual rejection of otherwise conforming milk
        finalPlantDecision = 'REJECTED';
        finalManagerReviewStatus = 'NONE';

        await tx.visitPortion.update({
          where: { id: portionId },
          data: {
            plant_decision: 'REJECTED',
            current_status: 'REJECTED',
            system_quality_outcome: systemQualityOutcome,
            manager_review_status: 'NONE',
            plant_rejection_reason: rejectionReasonInput,
            plant_decided_by: userIdBigInt,
            plant_decided_at: targetOpTs,
          },
        });

        if (session) {
          await tx.qATestingSessionEvent.create({
            data: {
              session_id: session.id,
              event_type: 'PORTION_REJECTED',
              timestamp: targetOpTs,
              user_id: userIdBigInt,
              note: `Portion #${lockedPortion.portion_number} REJECTED manually: ${rejectionReasonInput}`,
            },
          });
        }

        await tx.auditLog.create({
          data: {
            table_name: 'visit_portion',
            record_id: portionId,
            action: 'PLANT_QA_OPERATOR_MANUAL_REJECTION',
            old_values: {
              portion_id: portionId.toString(),
              plant_decision: lockedPortion.plant_decision,
            },
            new_values: {
              portion_id: portionId.toString(),
              plant_decision: 'REJECTED',
              rejection_reason: rejectionReasonInput,
              rejection_remarks: rejectionRemarksInput,
              system_quality_outcome: systemQualityOutcome,
            },
            user_id: userIdBigInt,
          },
        });
      } else {
        // Operator requested ACCEPTED
        if (systemQualityOutcome === 'RULE_CONFIGURATION_ERROR') {
          throw new RouteError('Laboratory rule configuration error detected. QA completion is blocked.', 422);
        }
        if (systemQualityOutcome === 'NO_ACTIVE_RULE') {
          throw new RouteError('Cannot accept milk: required laboratory release rule is missing. QA Head configuration required.', 422);
        }

        // Normal Acceptance
        finalPlantDecision = 'ACCEPTED';
        finalManagerReviewStatus = 'NONE';

        await tx.visitPortion.update({
          where: { id: portionId },
          data: {
            plant_decision: 'ACCEPTED',
            current_status: 'ACCEPTED',
            system_quality_outcome: systemQualityOutcome,
            manager_review_status: 'NONE',
            plant_decided_by: userIdBigInt,
            plant_decided_at: targetOpTs,
          },
        });

        if (session) {
          await tx.qATestingSessionEvent.create({
            data: {
              session_id: session.id,
              event_type: 'PORTION_ACCEPTED',
              timestamp: targetOpTs,
              user_id: userIdBigInt,
              note: `Portion #${lockedPortion.portion_number} ACCEPTED with quality outcome ${systemQualityOutcome}.`,
            },
          });
        }
      }

      // 9. Calculate visit-level workflow status
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

      // 10. Complete QA testing session if visit has fully departed PLANT_QA
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
      plantDecision: finalPlantDecision,
      managerReviewStatus: finalManagerReviewStatus,
      systemQualityOutcome,
      message:
        finalManagerReviewStatus === 'PENDING'
          ? `Portion #${lockedPortionRecord?.portion_number ?? portion.portion_number} submitted. Escalated to QA Manager for review due to OUT_OF_SPEC quality outcome.`
          : `Portion #${lockedPortionRecord?.portion_number ?? portion.portion_number} testing completed. Decision: ${finalPlantDecision}.`,
    });
  } catch (error: any) {
    if (error?.name === 'ZodError' || error?.issues) {
      const msg = error.issues?.[0]?.message || error.errors?.[0]?.message || error.message || 'Validation failed';
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    if (error instanceof RouteError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    console.error('Unexpected error in QA complete route:', error);
    return NextResponse.json({ error: 'Failed to complete QA test' }, { status: 500 });
  }
}
