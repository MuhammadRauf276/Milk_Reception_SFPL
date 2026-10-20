import { NextResponse } from 'next/server';
import { getCurrentUser } from '@core/auth';
import { prisma } from '@core/db';
import { completeQATestSchema } from '@/lib/validations/qa';
import { QualityRuleService } from '@/backend/services/qualityRuleService';
import { validateNonNegativeDecimal } from '@/lib/validation-helpers';
import { validateOperationalTimestamp } from '@/backend/services/chronology-validator';
import { getOrAssignPlantQATests } from '@/backend/services/labTestAssignmentService';
import { createNotificationsForEvent } from '@/backend/services/notificationService';
import { getErrorIssues, getErrorMessage, getErrorName } from '@/lib/errors';
import type { LabTestResultOption } from '@/lib/validations/labTest';
import type { VisitPortion } from '@prisma/client';
import { Prisma } from '@prisma/client';
import type { QualityEvaluationSnapshot } from '@/backend/services/qualityRuleService';
import { toJsonInput } from '@/lib/json';
import { writeAuditLog, auditActorFromUser } from '@core/audit';
import { isPlantLrTest, isPlantFatTest } from '@/backend/services/vehicleQuantityService';
import { getOperationalBusinessDate } from '@/backend/core/business-day';
import { parseStrictDateOnly } from '@/lib/datetime-utils';
import { recordRejectedMilkForDisposition } from '@/backend/services/rejectedMilkDispositionService';

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

  const allowedRoles = ['QA_LAB_ATTENDANT', 'QA_HEAD', 'SUPER_ADMIN'];
  if (!dbUser || !allowedRoles.includes(dbUser.role)) {
    return NextResponse.json(
      { error: 'Unauthorized. QAE Reception Lab, QA Head (AVP-QA), or Super Admin role required.' },
      { status: 403 }
    );
  }

  const isSuperior = ['QA_HEAD', 'SUPER_ADMIN'].includes(dbUser.role);

  const resolvedParams = await params;
  const visitIdStr = resolvedParams.visitId;
  const portionIdStr = resolvedParams.portionId;

  try {
    const visitId = BigInt(visitIdStr);
    const portionId = BigInt(portionIdStr);
    const userIdBigInt = dbUser.id;

    const body = await req.json();
    const validated = completeQATestSchema.parse(body);
    const completionEventId = validated.completionClientEventId || `plant-qa-${visitIdStr}-${portionIdStr}-${Date.now()}`;

    const portion = await prisma.visitPortion.findFirst({
      where: { id: portionId, visit_id: visitId },
      include: { visit: true },
    });

    if (!portion) {
      return NextResponse.json({ error: 'Portion record not found for this vehicle visit' }, { status: 404 });
    }

    if (portion.plant_decision === 'ACCEPTED' || portion.plant_decision === 'REJECTED') {
      if (portion.completion_client_event_id === completionEventId) {
        return NextResponse.json({ success: true, idempotent: true, portionId: portionIdStr, plantDecision: portion.plant_decision });
      }
      return NextResponse.json({ error: 'Portion testing has already been completed and finalized.' }, { status: 409 });
    }

    // Seal Verification (Phase 4d Stage 4)
    const enteredSeal = (validated.sealNumber || validated.seal_number || (body as { plantSealNumberEntered?: string }).plantSealNumberEntered || '').trim();
    let sealMatch: boolean | null = null;
    let sealMismatchException = false;

    if (portion.seal_number) {
      if (!enteredSeal) {
        sealMismatchException = true;
        sealMatch = false;
      } else {
        sealMatch = portion.seal_number.trim().toUpperCase() === enteredSeal.toUpperCase();
        if (!sealMatch) {
          sealMismatchException = true;
        }
      }
    }

    // Photo extraction per test
    const resPhotoMap = new Map<string, string>();
    for (const r of validated.results) {
      const pUrl = (r.photoUrl || r.photo_url || (r as { photo_url?: string; photoUrl?: string }).photo_url || (r as { photo_url?: string; photoUrl?: string }).photoUrl || '').trim();
      if (pUrl) {
        resPhotoMap.set(r.testId, pUrl);
      }
    }

    const explicitDecision = validated.decision;
    const rejectionReasonInput = (validated.exceptionReason || validated.exception_reason || validated.rejectionReason || validated.decisionReason || '').trim();
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

      if (performedResults.length === 0 && !sealMismatchException) {
        return NextResponse.json(
          { error: 'At least 1 actual PERFORMED test result (or seal mismatch) is required to reject a portion.' },
          { status: 400 }
        );
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
        const options = (reqTest.result_options_snapshot as LabTestResultOption[] | null) || null;
        if (Array.isArray(options) && options.length > 0) {
          const val = (res.textValue || '').trim().toUpperCase();
          const match = options.find((opt) => opt.value.trim().toUpperCase() === val);
          if (!match) {
            return NextResponse.json(
              { error: `Invalid option "${res.textValue}" for test "${reqTest.test_name_snapshot}". Allowed options: ${options.map((o) => o.label || o.value).join(', ')}.` },
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

    let lockedPortionRecord = null as VisitPortion | null;
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
        if (lockedPortion.completion_client_event_id === completionEventId) return;
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
        numericValue: number | null;
        textValue: string | null;
        appliedRuleId: bigint | null;
        appliedRuleVersion: number | null;
        evaluationStatus: string;
        isPassed: boolean | null;
        photoUrl?: string | null;
        evaluationSnapshot?: QualityEvaluationSnapshot | null;
      }> = [];

      for (const res of validated.results) {
        const testDef = assignedTestMap.get(res.testId);
        const perfStatus = res.performanceStatus || 'PERFORMED';
        const notPerfReason = perfStatus === 'NOT_PERFORMED' ? (res.notPerformedReason?.trim() || null) : null;
        const photoUrl = resPhotoMap.get(res.testId) || null;

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
            photoUrl: null,
          });
          continue;
        }

        const numVal = res.numericValue !== undefined && res.numericValue !== null ? res.numericValue : null;
        const textVal = res.textValue ? res.textValue.trim() : null;
        const activeRule = activeRulesMap.get(res.testId) || null;
        const snapshotOptions = (testDef?.result_options_snapshot as LabTestResultOption[] | null) || null;

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
          photoUrl,
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

      if (['RULE_CONFIGURATION_ERROR', 'NO_ACTIVE_RULE'].includes(systemQualityOutcome)) {
        throw new RouteError('Laboratory rule configuration is incomplete or invalid. QA completion is blocked.', 422);
      }

      // Collect all exception reasons (Rule failure, Seal mismatch, Missing Photos for LR / Fat)
      const exceptionReasonsList: string[] = [];
      if (sealMismatchException) {
        exceptionReasonsList.push('SEAL_MISMATCH');
      }

      for (const entry of evaluationEntries) {
        const testDef = assignedTestMap.get(entry.testId.toString());
        if (entry.evaluationStatus === 'OUT_OF_SPEC' || entry.isPassed === false) {
          exceptionReasonsList.push(`RULE_FAIL:${testDef?.test_code_snapshot || entry.testId}`);
        }
        if (entry.performanceStatus === 'PERFORMED') {
          const photo = resPhotoMap.get(entry.testId.toString());
          if (isPlantLrTest(testDef?.test_code_snapshot, testDef?.test_name_snapshot) && !photo) {
            exceptionReasonsList.push('PICTURE_MISSING:LR');
          }
          if (isPlantFatTest(testDef?.test_code_snapshot, testDef?.test_name_snapshot) && !photo) {
            exceptionReasonsList.push('PICTURE_MISSING:FAT');
          }
        }
      }

      const systemRecommendation = ['PASS', 'WARNING', 'NEUTRAL'].includes(systemQualityOutcome) && !sealMismatchException
        ? 'ACCEPTED'
        : 'REJECTED';
      const isAttendantException = explicitDecision !== systemRecommendation;

      // 6. Upsert submitted PlantLabResult rows with rule linkages, photo_url, and seal_verified
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
              evaluation_snapshot: entry.evaluationSnapshot ? toJsonInput(entry.evaluationSnapshot) : undefined,
              tested_by: userIdBigInt,
              photo_url: entry.photoUrl || (existing as { photo_url?: string | null })?.photo_url || null,
              seal_verified: sealMatch ?? undefined,
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
              evaluation_snapshot: entry.evaluationSnapshot ? toJsonInput(entry.evaluationSnapshot) : undefined,
              tested_by: userIdBigInt,
              photo_url: entry.photoUrl || null,
              seal_verified: sealMatch ?? undefined,
            },
          });
        }
      }

      // 7. Auto-finalize UNRESOLVED required tests when rejecting
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

      // 8. Determine Portion Decision & AVP-QA Review Escalation
      const hasException = exceptionReasonsList.length > 0 || isAttendantException;
      const isDecideNow = isSuperior || validated.action === 'DECIDE_NOW';

      if (hasException && !isDecideNow) {
        // Normal QAE: Exception routes directly to AVP-QA (QA_HEAD)
        finalPlantDecision = 'PENDING';
        finalManagerReviewStatus = 'PENDING';

        await tx.visitPortion.update({
          where: { id: portionId },
          data: {
            plant_decision: 'PENDING',
            current_status: 'UNDER_TEST',
            system_quality_outcome: systemQualityOutcome,
            manager_review_status: 'PENDING',
            manager_requested_decision: explicitDecision,
            manager_review_requested_by_user_id: userIdBigInt,
            manager_review_requested_at: targetOpTs,
            manager_review_reason: rejectionReasonInput || exceptionReasonsList.join(', '),
            plant_seal_number_entered: enteredSeal || null,
            seal_match: sealMatch,
            seal_checked_by: userIdBigInt,
            seal_checked_at: targetOpTs,
            exception_reasons: exceptionReasonsList.length > 0 ? exceptionReasonsList : Prisma.DbNull,
            completion_client_event_id: completionEventId,
          },
        });

        if (session) {
          await tx.qATestingSessionEvent.create({
            data: {
              session_id: session.id,
              event_type: 'HOLD',
              timestamp: targetOpTs,
              user_id: userIdBigInt,
              note: `Portion #${lockedPortion.portion_number} exception (${exceptionReasonsList.join(', ') || 'attendant disagreement'}); escalated to AVP-QA review.`,
            },
          });
        }

        await createNotificationsForEvent(tx, {
          eventKey: 'PLANT_QA_EXCEPTION_PENDING',
          sourceId: portionId.toString(),
          title: 'Plant QA exception needs review',
          body: `Vehicle visit ${lockedPortion.visit_id.toString()} portion ${lockedPortion.portion_number} has an exception (${exceptionReasonsList.join(', ') || 'Attendant Disagreement'}) and requires AVP-QA review.`,
          deepLink: '/department/qa-head',
          dedupeSuffix: `${portionId}:${completionEventId}`,
        });
      } else {
        // Decide Now (Superior or Normal Non-Exception Case)
        finalPlantDecision = explicitDecision || (systemRecommendation === 'ACCEPTED' && !sealMismatchException ? 'ACCEPTED' : 'REJECTED');
        finalManagerReviewStatus = 'NONE';

        await tx.visitPortion.update({
          where: { id: portionId },
          data: {
            plant_decision: finalPlantDecision,
            current_status: finalPlantDecision,
            system_quality_outcome: systemQualityOutcome,
            manager_review_status: 'NONE',
            plant_rejection_reason: finalPlantDecision === 'REJECTED' ? (rejectionReasonInput || exceptionReasonsList.join(', ')) : null,
            plant_decided_by: userIdBigInt,
            plant_decided_at: targetOpTs,
            plant_decided_as_role: dbUser.role,
            plant_seal_number_entered: enteredSeal || null,
            seal_match: sealMatch,
            seal_checked_by: userIdBigInt,
            seal_checked_at: targetOpTs,
            exception_reasons: exceptionReasonsList.length > 0 ? exceptionReasonsList : Prisma.DbNull,
            completion_client_event_id: completionEventId,
          },
        });

        if (session) {
          await tx.qATestingSessionEvent.create({
            data: {
              session_id: session.id,
              event_type: finalPlantDecision === 'ACCEPTED' ? 'PORTION_ACCEPTED' : 'PORTION_REJECTED',
              timestamp: targetOpTs,
              user_id: userIdBigInt,
              note: `Portion #${lockedPortion.portion_number} ${finalPlantDecision}: ${rejectionReasonInput || exceptionReasonsList.join(', ') || systemQualityOutcome}`,
            },
          });
        }

        await writeAuditLog(tx, {
          tableName: 'visit_portion',
          recordId: portionId,
          action: finalPlantDecision === 'ACCEPTED' ? 'PLANT_QA_PORTION_ACCEPTED' : 'PLANT_QA_PORTION_REJECTED',
          oldValues: {
            portion_id: portionId.toString(),
            plant_decision: lockedPortion.plant_decision,
          },
          newValues: {
            portion_id: portionId.toString(),
            plant_decision: finalPlantDecision,
            rejection_reason: rejectionReasonInput || null,
            exception_reasons: exceptionReasonsList,
            seal_match: sealMatch,
            system_quality_outcome: systemQualityOutcome,
          },
          actor: auditActorFromUser(dbUser),
        });

        // If rejected, hook to MPD disposition remarks
        if (finalPlantDecision === 'REJECTED') {
          await recordRejectedMilkForDisposition(tx, {
            portionId,
            sourceId: portion.visit.procurement_source_id ? portion.visit.procurement_source_id : undefined,
            entityType: 'PLANT_PORTION',
            summary: `Vehicle ${portion.visit.vehicle_number} / Portion #${lockedPortion.portion_number}`,
            actor: auditActorFromUser(dbUser),
          });
        }
      }

      // 8b. Composite rejection rule:
      // If testMode is COMPOSITE and portion was rejected, reject ALL portions on this vehicle.
      const isComposite = portion.visit.test_mode === 'COMPOSITE';
      if (isComposite && finalPlantDecision === 'REJECTED') {
        await tx.visitPortion.updateMany({
          where: { visit_id: visitId },
          data: {
            plant_decision: 'REJECTED',
            current_status: 'REJECTED',
            plant_rejection_reason: rejectionReasonInput || 'Composite testing failed - entire vehicle load rejected',
            plant_decided_by: userIdBigInt,
            plant_decided_at: targetOpTs,
            plant_decided_as_role: dbUser.role,
          },
        });
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
      } else if (allRejected || (isComposite && finalPlantDecision === 'REJECTED')) {
        newVisitStatus = 'READY_FOR_GATE_EXIT';
      } else if (hasAccepted) {
        newVisitStatus = 'READY_FOR_GROSS';
      }

      // Authoritative Business Date Rule:
      // Fully rejected vehicle business date = timestamp of final QA rejection.
      if (allRejected || (isComposite && finalPlantDecision === 'REJECTED')) {
        const rejectDateStr = getOperationalBusinessDate(targetOpTs);
        const rejectDate = parseStrictDateOnly(rejectDateStr);
        await tx.vehicleVisit.update({
          where: { id: visitId },
          data: {
            current_status: newVisitStatus,
            operational_date: rejectDate,
            business_date_source: 'LAST_QA_REJECTION',
            business_date_set_at: targetOpTs,
          },
        });
      } else {
        await tx.vehicleVisit.update({
          where: { id: visitId },
          data: { current_status: newVisitStatus },
        });
      }

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
      sealMatch,
      message:
        finalManagerReviewStatus === 'PENDING'
          ? `Portion #${lockedPortionRecord?.portion_number ?? portion.portion_number} submitted. Escalated to AVP-QA (QA Head) for exception review.`
          : `Portion #${lockedPortionRecord?.portion_number ?? portion.portion_number} testing completed. Decision: ${finalPlantDecision}.`,
    });
  } catch (error) {
    if (getErrorName(error) === 'ZodError' || getErrorIssues(error)) {
      const msg = getErrorIssues(error)?.[0]?.message || getErrorMessage(error) || 'Validation failed';
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    if (error instanceof RouteError) {
      return NextResponse.json({ error: getErrorMessage(error) }, { status: error.statusCode });
    }
    console.error('Unexpected error in QA complete route:', error);
    return NextResponse.json({ error: 'Failed to complete QA test' }, { status: 500 });
  }
}
