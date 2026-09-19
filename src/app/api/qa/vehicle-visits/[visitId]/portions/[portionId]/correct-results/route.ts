import { NextResponse } from 'next/server';
import { getCurrentUser } from '@core/auth';
import { prisma } from '@core/db';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { QualityRuleService } from '@/backend/services/qualityRuleService';
import { getOrAssignPlantQATests } from '@/backend/services/labTestAssignmentService';

const correctResultItemSchema = z.object({
  test_id: z.string().or(z.number()),
  numeric_value: z.number().nullable().optional(),
  text_value: z.string().nullable().optional(),
  performance_status: z.enum(['PERFORMED', 'NOT_PERFORMED'] as const).optional().default('PERFORMED'),
  not_performed_reason: z.string().nullable().optional(),
});

const correctResultsSchema = z.object({
  reason: z.string().trim().min(3, 'A substantive correction reason of at least 3 characters is required.'),
  results: z.array(correctResultItemSchema).min(1, 'At least one lab test result correction is required.'),
});

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

  const allowedRoles = ['QA_MANAGER', 'SUPER_ADMIN'];
  if (!dbUser || !allowedRoles.includes(dbUser.role)) {
    return NextResponse.json(
      { error: 'Unauthorized. QA Manager or Super Admin role required for QA measurement corrections.' },
      { status: 403 }
    );
  }

  const resolvedParams = await params;
  const visitIdStr = resolvedParams.visitId;
  const portionIdStr = resolvedParams.portionId;

  let visitId: bigint;
  let portionId: bigint;
  try {
    visitId = BigInt(visitIdStr);
    portionId = BigInt(portionIdStr);
  } catch {
    return NextResponse.json({ error: 'Invalid visitId or portionId format.' }, { status: 400 });
  }

  // Critical Guard: If Plant Final Receipt Dual Reconciliation exists -> fail-closed HTTP 400
  const existingRecon = await prisma.plantFinalDualReconciliation.findUnique({
    where: { visit_id: visitId },
  });

  if (existingRecon) {
    return NextResponse.json(
      {
        error: 'POST_FINAL_RECEIPT_CORRECTION_BLOCKED',
        code: 'POST_FINAL_RECEIPT_CORRECTION_BLOCKED',
        message: 'Corrections to QA measurements are strictly prohibited once plant final receipt dual reconciliation has been executed.',
      },
      { status: 400 }
    );
  }

  try {
    const body = await req.json();
    const validated = correctResultsSchema.parse(body);

    // Reject duplicate test IDs in payload
    const seenTestIds = new Set<string>();
    for (const item of validated.results) {
      const tid = String(item.test_id).trim();
      if (seenTestIds.has(tid)) {
        return NextResponse.json({ error: `Duplicate test ID ${tid} in correction payload.` }, { status: 400 });
      }
      seenTestIds.add(tid);
    }

    const result = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT id FROM vehicle_visit WHERE id = ${visitId} FOR UPDATE`;

      const portion = await tx.visitPortion.findFirst({
        where: { id: portionId, visit_id: visitId },
      });

      if (!portion) {
        throw new Error('NOT_FOUND:Portion not found for this vehicle visit.');
      }

      // 5-save limit check for QA Manager
      const isManager = dbUser.role === 'QA_MANAGER';
      const currentManagerCount = portion.manager_correction_count ?? 0;
      if (isManager && currentManagerCount >= 5) {
        throw new Error('MAX_CORRECTIONS_EXCEEDED:Maximum 5 manager corrections exceeded for this portion.');
      }

      const existingResults = await tx.plantLabResult.findMany({
        where: { portion_id: portion.id },
        include: { lab_test: true },
      });
      const existingResultMap = new Map(existingResults.map((r) => [r.test_id.toString(), r]));

      // Load frozen test assignment snapshot
      const assignedPlantTests = await getOrAssignPlantQATests(tx, visitId);
      const assignedMap = new Map(assignedPlantTests.map((t) => [t.test_id.toString(), t]));

      // Reject foreign test IDs and direct edits of CALCULATED tests
      for (const item of validated.results) {
        const tid = String(item.test_id).trim();
        const existing = existingResultMap.get(tid);
        if (!existing) {
          throw new Error(`BAD_REQUEST:Test ID ${tid} does not belong to portion.`);
        }
        const assignedDef = assignedMap.get(tid);
        const resType = assignedDef?.result_type_snapshot || existing.lab_test?.resultType;
        if (resType === 'CALCULATED') {
          throw new Error(`BAD_REQUEST:Test ID ${tid} is a CALCULATED test and cannot be directly corrected.`);
        }
      }

      // Check for real changes vs no-op
      let hasRealChanges = false;
      for (const item of validated.results) {
        const tid = String(item.test_id).trim();
        const existing = existingResultMap.get(tid)!;
        const oldNum = existing.numeric_value !== null ? Number(existing.numeric_value) : null;
        const newNum = item.numeric_value !== undefined && item.numeric_value !== null ? Number(item.numeric_value) : null;
        const oldTxt = existing.text_value ?? null;
        const newTxt = item.text_value !== undefined && item.text_value !== null ? item.text_value.trim() : null;
        const oldPerf = existing.performance_status || 'PERFORMED';
        const newPerf = item.performance_status || 'PERFORMED';
        const oldReason = existing.not_performed_reason ?? null;
        const newReason = newPerf === 'NOT_PERFORMED' ? (item.not_performed_reason?.trim() || null) : null;

        if (oldNum !== newNum || oldTxt !== newTxt || oldPerf !== newPerf || oldReason !== newReason) {
          hasRealChanges = true;
          break;
        }
      }

      if (!hasRealChanges) {
        return {
          success: true,
          count: 0,
          noOp: true,
          message: 'No changes detected. Operational record remains unaltered.',
          system_quality_outcome: portion.system_quality_outcome,
          correction_count: portion.correction_count ?? 0,
          manager_correction_count: portion.manager_correction_count ?? 0,
        };
      }

      // Resolve rule at original authoritative test/result/session timestamp
      const authoritativeTs = portion.plant_decided_at || portion.created_at || (await tx.vehicleVisit.findUnique({ where: { id: visitId } }))?.created_at || new Date();
      const activeRulesMap = await QualityRuleService.resolveActiveRulesForTestingPoint('PLANT_QA', authoritativeTs, tx);
      const correctionsMade: any[] = [];
      const oldResultsEvidence: any[] = [];

      for (const item of validated.results) {
        const testIdBigInt = BigInt(String(item.test_id));
        const existingResult = existingResultMap.get(testIdBigInt.toString())!;

        oldResultsEvidence.push({
          test_id: testIdBigInt.toString(),
          numeric_value: existingResult.numeric_value ? Number(existingResult.numeric_value) : null,
          text_value: existingResult.text_value,
          performance_status: existingResult.performance_status,
          not_performed_reason: existingResult.not_performed_reason,
          evaluation_status: existingResult.evaluation_status,
          is_passed: existingResult.is_passed,
          applied_rule_id: existingResult.applied_rule_id ? existingResult.applied_rule_id.toString() : null,
          applied_rule_version: existingResult.applied_rule_version,
          tested_by: existingResult.tested_by ? existingResult.tested_by.toString() : null,
        });

        const activeRule = activeRulesMap.get(String(testIdBigInt)) || null;
        const assignedDef = assignedMap.get(String(testIdBigInt));
        const evalRes = QualityRuleService.evaluateQualityResult({
          testId: testIdBigInt,
          resultType: assignedDef?.result_type_snapshot || (existingResult.numeric_value !== null ? 'NUMERIC' : 'QUALITATIVE'),
          numericValue: item.numeric_value ?? null,
          textValue: item.text_value ?? null,
          rule: activeRule,
          resultOptions: assignedDef?.result_options_snapshot || existingResult.lab_test?.resultOptions,
          testingPoint: 'PLANT_QA',
        });

        // Update PlantLabResult keeping original tested_by immutable
        await tx.plantLabResult.update({
          where: { id: existingResult.id },
          data: {
            numeric_value: item.numeric_value !== null && item.numeric_value !== undefined ? new Prisma.Decimal(item.numeric_value) : null,
            text_value: item.text_value ?? null,
            performance_status: item.performance_status,
            not_performed_reason: item.performance_status === 'NOT_PERFORMED' ? (item.not_performed_reason || 'Not performed') : null,
            is_passed: evalRes.isPassed,
            evaluation_status: evalRes.evaluationStatus,
            evaluation_snapshot: evalRes.evaluationSnapshot as any,
            result_timestamp: authoritativeTs,
            applied_rule_id: evalRes.appliedRuleId ?? null,
            applied_rule_version: evalRes.appliedRuleVersion ?? null,
          },
        });

        correctionsMade.push({
          test_id: testIdBigInt.toString(),
          old_numeric: existingResult.numeric_value ? Number(existingResult.numeric_value) : null,
          new_numeric: item.numeric_value ?? null,
          old_text: existingResult.text_value,
          new_text: item.text_value ?? null,
          evaluation_status: evalRes.evaluationStatus,
          is_passed: evalRes.isPassed,
          applied_rule_id: evalRes.appliedRuleId ?? null,
          applied_rule_version: evalRes.appliedRuleVersion ?? null,
        });
      }

      // Re-aggregate all required Plant QA evaluations for the portion using frozen assignment snapshot
      const updatedAllResults = await tx.plantLabResult.findMany({
        where: { portion_id: portion.id },
      });

      const allEvaluations = updatedAllResults.map((r) => ({
        evaluationStatus: r.evaluation_status || 'PENDING',
        performanceStatus: r.performance_status,
        isRequired: assignedMap.get(r.test_id.toString())?.is_required_snapshot ?? true,
      }));

      const newSystemQualityOutcome = QualityRuleService.aggregateSystemQualityOutcome(allEvaluations);

      let newPlantDecision = portion.plant_decision;
      let newManagerReviewStatus = portion.manager_review_status;

      if (portion.plant_decision === 'ACCEPTED' && newSystemQualityOutcome === 'OUT_OF_SPEC') {
        newPlantDecision = 'PENDING';
        newManagerReviewStatus = 'PENDING';
      }

      const now = new Date();
      const newTotalCount = (portion.correction_count ?? 0) + 1;
      const newManagerCount = isManager ? currentManagerCount + 1 : currentManagerCount;

      await tx.visitPortion.update({
        where: { id: portion.id },
        data: {
          system_quality_outcome: newSystemQualityOutcome,
          plant_decision: newPlantDecision,
          current_status: newPlantDecision || portion.current_status || 'PENDING',
          manager_review_status: newManagerReviewStatus,
          correction_count: newTotalCount,
          manager_correction_count: newManagerCount,
          plant_corrected_by: dbUser.id,
          plant_corrected_at: now,
          plant_correction_reason: validated.reason,
        },
      });

      await tx.auditLog.create({
        data: {
          table_name: 'visit_portion',
          record_id: portion.id,
          action: 'PLANT_QA_MEASUREMENT_CORRECTED',
          old_values: {
            portion_id: portion.id.toString(),
            plant_decision: portion.plant_decision,
            system_quality_outcome: portion.system_quality_outcome,
            correction_count: portion.correction_count ?? 0,
            manager_correction_count: portion.manager_correction_count ?? 0,
            results: oldResultsEvidence,
          },
          new_values: {
            portion_id: portion.id.toString(),
            plant_decision: newPlantDecision,
            system_quality_outcome: newSystemQualityOutcome,
            reason: validated.reason,
            results: correctionsMade,
            actor: dbUser.id.toString(),
            role: dbUser.role,
            correction_count: newTotalCount,
            manager_correction_count: newManagerCount,
            timestamp: now.toISOString(),
          },
          user_id: dbUser.id,
        },
      });

      return {
        success: true,
        count: correctionsMade.length,
        system_quality_outcome: newSystemQualityOutcome,
        correction_count: newTotalCount,
        manager_correction_count: newManagerCount,
      };
    });

    return NextResponse.json(result, { status: 200 });
  } catch (err: any) {
    if (err.message?.startsWith('NOT_FOUND:')) {
      return NextResponse.json({ error: err.message.replace('NOT_FOUND:', '') }, { status: 404 });
    }
    if (err.message?.startsWith('MAX_CORRECTIONS_EXCEEDED:')) {
      return NextResponse.json({ error: 'MAX_CORRECTIONS_EXCEEDED', message: err.message.replace('MAX_CORRECTIONS_EXCEEDED:', '') }, { status: 400 });
    }
    if (err.message?.startsWith('BAD_REQUEST:')) {
      return NextResponse.json({ error: err.message.replace('BAD_REQUEST:', '') }, { status: 400 });
    }
    if (err.name === 'ZodError') {
      return NextResponse.json({ error: err.issues?.[0]?.message || 'Validation error' }, { status: 400 });
    }
    console.error('POST /api/qa/vehicle-visits/[visitId]/portions/[portionId]/correct-results error:', err);
    return NextResponse.json({ error: err.message || 'Failed to correct QA test results.' }, { status: 500 });
  }
}

export async function PATCH(
  req: Request,
  props: { params: Promise<{ visitId: string; portionId: string }> }
) {
  return POST(req, props);
}
