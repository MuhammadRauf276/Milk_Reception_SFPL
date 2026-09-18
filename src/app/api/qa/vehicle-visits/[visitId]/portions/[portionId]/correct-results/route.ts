import { NextResponse } from 'next/server';
import { getCurrentUser } from '@core/auth';
import { prisma } from '@core/db';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { QualityRuleService } from '@/backend/services/qualityRuleService';

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

    const result = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT id FROM vehicle_visit WHERE id = ${visitId} FOR UPDATE`;

      const portion = await tx.visitPortion.findFirst({
        where: { id: portionId, visit_id: visitId },
      });

      if (!portion) {
        throw new Error('NOT_FOUND:Portion not found for this vehicle visit.');
      }

      const activeRulesMap = await QualityRuleService.resolveActiveRulesForTestingPoint('PLANT_QA', new Date(), tx);
      const correctionsMade: any[] = [];

      for (const item of validated.results) {
        const testIdBigInt = BigInt(String(item.test_id));

        const existingResult = await tx.plantLabResult.findFirst({
          where: { portion_id: portion.id, test_id: testIdBigInt },
        });

        if (!existingResult) {
          continue;
        }

        const activeRule = activeRulesMap.get(String(testIdBigInt)) || null;
        const evalRes = QualityRuleService.evaluateQualityResult({
          testId: testIdBigInt,
          resultType: existingResult.numeric_value !== null ? 'NUMERIC' : 'QUALITATIVE',
          numericValue: item.numeric_value ?? null,
          textValue: item.text_value ?? null,
          rule: activeRule,
          testingPoint: 'PLANT_QA',
        });

        const updatedResult = await tx.plantLabResult.update({
          where: { id: existingResult.id },
          data: {
            numeric_value: item.numeric_value !== null && item.numeric_value !== undefined ? new Prisma.Decimal(item.numeric_value) : null,
            text_value: item.text_value ?? null,
            performance_status: item.performance_status,
            not_performed_reason: item.performance_status === 'NOT_PERFORMED' ? (item.not_performed_reason || 'Not performed') : null,
            is_passed: evalRes.isPassed,
            tested_by: dbUser.id,
            result_timestamp: new Date(),
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
          outcome: evalRes.evaluationStatus,
        });
      }

      await tx.auditLog.create({
        data: {
          table_name: 'visit_portion',
          record_id: portion.id,
          action: 'PLANT_QA_MEASUREMENT_CORRECTED',
          old_values: { portion_id: portion.id.toString() },
          new_values: {
            reason: validated.reason,
            corrections: correctionsMade,
          },
          user_id: dbUser.id,
        },
      });

      return { success: true, count: correctionsMade.length };
    });

    return NextResponse.json(result, { status: 200 });
  } catch (err: any) {
    if (err.message?.startsWith('NOT_FOUND:')) {
      return NextResponse.json({ error: err.message.replace('NOT_FOUND:', '') }, { status: 404 });
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
