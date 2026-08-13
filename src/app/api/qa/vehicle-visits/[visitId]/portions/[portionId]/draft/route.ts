import { NextResponse } from 'next/server';
import { getCurrentUser } from '@core/auth';
import { prisma } from '@core/db';
import { saveQADraftSchema } from '@/lib/validations/qa';
import { evaluateLabResult } from '@/lib/lab-rules';

export async function PUT(
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

    // Fetch lab test definitions for evaluation
    const testIds = validated.results.map((r) => BigInt(r.testId));
    const testDefs = await prisma.labTest.findMany({
      where: { id: { in: testIds } },
    });
    const testDefMap = new Map(testDefs.map((t) => [t.id.toString(), t]));

    const now = new Date();

    // Prisma Transaction for saving draft
    await prisma.$transaction(async (tx) => {
      // 1. Update portion status
      await tx.visitPortion.update({
        where: { id: portionId },
        data: {
          plant_decision: 'PENDING',
          current_status: 'UNDER_TEST',
        },
      });

      // Update visit current status if Dispatched or Token Issued
      await tx.vehicleVisit.update({
        where: { id: visitId },
        data: { current_status: 'LAB' },
      });

      // 2. Upsert draft PlantLabResult rows
      for (const res of validated.results) {
        const testDef = testDefMap.get(res.testId);
        if (!testDef) continue;

        const numVal = res.numericValue !== undefined && res.numericValue !== null ? res.numericValue : null;
        const textVal = res.textValue ? res.textValue.trim() : null;

        const evalRes = evaluateLabResult(testDef.testCode, numVal, textVal, 'PLANT');

        // Check if existing record
        const existing = await tx.plantLabResult.findFirst({
          where: { portion_id: portionId, test_id: BigInt(res.testId) },
        });

        if (existing) {
          await tx.plantLabResult.update({
            where: { id: existing.id },
            data: {
              result_timestamp: now,
              numeric_value: numVal,
              text_value: textVal,
              is_passed: evalRes.isPassed,
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
              numeric_value: numVal,
              text_value: textVal,
              is_passed: evalRes.isPassed,
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
