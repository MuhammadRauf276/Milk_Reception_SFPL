import { NextResponse } from 'next/server';
import { getCurrentUser } from '@core/auth';
import { prisma } from '@core/db';
import { resultOptionsArraySchema, validatePlantQAResultOptions } from '@/lib/validations/labTest';

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authUser = await getCurrentUser(req);
  if (!authUser || (authUser.role !== 'SUPER_ADMIN' && authUser.role !== 'Admin')) {
    return NextResponse.json({ error: 'Unauthorized. Super Admin authorization required.' }, { status: 403 });
  }

  const { id: testIdStr } = await params;
  const testId = BigInt(testIdStr);

  try {
    const body = await req.json();
    const targetTest = await prisma.labTest.findUnique({ where: { id: testId } });
    if (!targetTest) {
      return NextResponse.json({ error: 'Target Lab Test record not found.' }, { status: 404 });
    }

    // RESULT_TYPE IMMUTABILITY PROTECTION ENFORCEMENT
    if (body.resultType && body.resultType !== targetTest.resultType) {
      const dispatchCount = await prisma.dispatchLabResult.count({ where: { test_id: testId } });
      const plantCount = await prisma.plantLabResult.count({ where: { test_id: testId } });

      if (dispatchCount + plantCount > 0) {
        return NextResponse.json(
          {
            error: `Result type change rejected. Cannot change resultType from "${targetTest.resultType}" to "${body.resultType}" for Lab Test "${targetTest.testCode}" (${targetTest.testName}) because ${dispatchCount + plantCount} historical result records already exist.`,
          },
          { status: 400 }
        );
      }
    }

    // Validate resultOptions if provided
    let parsedResultOptions = targetTest.resultOptions;
    const effectiveType = body.resultType || targetTest.resultType;
    const effectiveScope = body.testScope || targetTest.testScope;
    const effectiveRequired = body.isRequired !== undefined ? Boolean(body.isRequired) : targetTest.isRequired;

    if (body.resultOptions !== undefined) {
      if (['QUALITATIVE', 'BOOLEAN', 'OK_NOT_OK', 'POSITIVE_NEGATIVE'].includes(effectiveType)) {
        if (body.resultOptions !== null) {
          const parseRes = resultOptionsArraySchema.safeParse(body.resultOptions);
          if (!parseRes.success) {
            return NextResponse.json({ error: parseRes.error.issues[0]?.message || 'Invalid result options' }, { status: 400 });
          }
          parsedResultOptions = parseRes.data as any;
        } else {
          parsedResultOptions = null;
        }
      } else {
        if (body.resultOptions && body.resultOptions.length > 0) {
          return NextResponse.json({ error: `Result options are not permitted for ${effectiveType} tests.` }, { status: 400 });
        }
        parsedResultOptions = null;
      }
    }

    // Enforce valid Plant QA options (cannot be all-neutral for required Plant test)
    const plantValidation = validatePlantQAResultOptions(
      effectiveScope,
      effectiveRequired,
      effectiveType,
      parsedResultOptions as any
    );
    if (!plantValidation.isValid) {
      return NextResponse.json({ error: plantValidation.error }, { status: 400 });
    }

    const adminUser = await prisma.user.findFirst({ where: { username: authUser.username } });

    const updatedTest = await prisma.labTest.update({
      where: { id: testId },
      data: {
        testName: body.testName !== undefined ? body.testName.trim() : targetTest.testName,
        unit: body.unit !== undefined ? (body.unit ? body.unit.trim() : null) : targetTest.unit,
        testScope: body.testScope !== undefined ? body.testScope : targetTest.testScope,
        displayOrder: body.displayOrder !== undefined ? Number(body.displayOrder) : targetTest.displayOrder,
        isActive: body.isActive !== undefined ? Boolean(body.isActive) : targetTest.isActive,
        resultOptions: parsedResultOptions !== undefined ? (parsedResultOptions as any) : undefined,
      },
    });

    await prisma.auditLog.create({
      data: {
        table_name: 'lab_test',
        record_id: testId,
        action: 'LAB_TEST_UPDATED',
        old_values: {
          testName: targetTest.testName,
          displayOrder: targetTest.displayOrder,
          isActive: targetTest.isActive,
          resultOptions: targetTest.resultOptions,
        },
        new_values: {
          testName: updatedTest.testName,
          displayOrder: updatedTest.displayOrder,
          isActive: updatedTest.isActive,
          resultOptions: updatedTest.resultOptions,
        },
        user_id: adminUser?.id || null,
      },
    });

    return NextResponse.json({
      success: true,
      labTest: {
        id: updatedTest.id.toString(),
        testCode: updatedTest.testCode,
        testName: updatedTest.testName,
        resultType: updatedTest.resultType,
        unit: updatedTest.unit,
        testScope: updatedTest.testScope,
        displayOrder: updatedTest.displayOrder,
        isActive: updatedTest.isActive,
        resultOptions: updatedTest.resultOptions || null,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

