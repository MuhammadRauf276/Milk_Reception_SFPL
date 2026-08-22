import { NextResponse } from 'next/server';
import { getCurrentUser } from '@core/auth';
import { prisma } from '@core/db';
import { saveQADraftSchema } from '@/lib/validations/qa';
import { evaluateLabResult } from '@/lib/lab-rules';
import { getOrAssignPlantQATests } from '@/backend/services/labTestAssignmentService';

export async function PUT(
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
    const validated = saveQADraftSchema.parse(body);

    const portion = await prisma.visitPortion.findFirst({
      where: { id: portionId, visit_id: visitId },
    });

    if (!portion) {
      return NextResponse.json({ error: 'Portion record not found for this vehicle visit' }, { status: 404 });
    }

    if (portion.plant_decision === 'ACCEPTED' || portion.plant_decision === 'REJECTED') {
      return NextResponse.json({ error: 'Portion testing has already been completed and finalized.' }, { status: 400 });
    }

    const now = new Date();

    // Prisma Transaction for saving draft
    await prisma.$transaction(async (tx) => {
      // Fetch or assign snapshot for this visit
      const assignedTests = await getOrAssignPlantQATests(tx, visitId);
      const testDefMap = new Map(assignedTests.map((t) => [t.test_id.toString(), t]));

      // 1. Update portion status to UNDER_TEST (does not finalize)
      await tx.visitPortion.update({
        where: { id: portionId },
        data: {
          plant_decision: 'PENDING',
          current_status: 'UNDER_TEST',
        },
      });

      // Update visit current status
      await tx.vehicleVisit.update({
        where: { id: visitId },
        data: { current_status: 'LAB' },
      });

      // 2. Upsert draft PlantLabResult rows with full performance tracking
      for (const res of validated.results) {
        const testDef = testDefMap.get(res.testId);
        if (!testDef) continue;

        const performanceStatus = res.performanceStatus || 'PERFORMED';
        const notPerformedReason = performanceStatus === 'NOT_PERFORMED'
          ? (res.notPerformedReason?.trim() || null)
          : null;

        // For NOT_PERFORMED: numeric_value and text_value are null; is_passed is null
        const numVal = performanceStatus === 'PERFORMED'
          ? (res.numericValue !== undefined && res.numericValue !== null ? res.numericValue : null)
          : null;
        const textVal = performanceStatus === 'PERFORMED'
          ? (res.textValue ? res.textValue.trim() : null)
          : null;

        let isPassed: boolean | null = null;
        if (performanceStatus === 'PERFORMED') {
          const snapshotOptions = (testDef.result_options_snapshot as any[]) || null;
          const evalRes = evaluateLabResult(
            testDef.test_code_snapshot,
            numVal,
            textVal,
            testDef.result_type_snapshot || 'PLANT',
            snapshotOptions
          );
          isPassed = evalRes.isPassed;
        }

        const existing = await tx.plantLabResult.findFirst({
          where: { portion_id: portionId, test_id: BigInt(res.testId) },
        });

        if (existing) {
          await tx.plantLabResult.update({
            where: { id: existing.id },
            data: {
              result_timestamp: now,
              performance_status: performanceStatus,
              not_performed_reason: notPerformedReason,
              numeric_value: numVal,
              text_value: textVal,
              is_passed: isPassed,
              tested_by: userIdBigInt,
            },
          });
        } else {
          await tx.plantLabResult.create({
            data: {
              visit_id: visitId,
              portion_id: portionId,
              test_id: BigInt(res.testId),
              sample_timestamp: now,
              result_timestamp: now,
              performance_status: performanceStatus,
              not_performed_reason: notPerformedReason,
              numeric_value: numVal,
              text_value: textVal,
              is_passed: isPassed,
              tested_by: userIdBigInt,
            },
          });
        }
      }
    });

    return NextResponse.json({ success: true, message: 'QA draft saved successfully.' });
  } catch (error: any) {
    if (error?.name === 'ZodError') {
      return NextResponse.json({ error: error.errors[0]?.message || 'Validation failed' }, { status: 400 });
    }
    return NextResponse.json({ error: error?.message || 'Failed to save QA draft' }, { status: 500 });
  }
}
