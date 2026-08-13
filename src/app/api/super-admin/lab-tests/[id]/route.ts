import { NextResponse } from 'next/server';
import { getCurrentUser } from '@core/auth';
import { prisma } from '@core/db';

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authUser = await getCurrentUser();
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

    const adminUser = await prisma.user.findFirst({ where: { username: authUser.username } });

    const updatedTest = await prisma.labTest.update({
      where: { id: testId },
      data: {
        testName: body.testName !== undefined ? body.testName.trim() : targetTest.testName,
        unit: body.unit !== undefined ? (body.unit ? body.unit.trim() : null) : targetTest.unit,
        testScope: body.testScope !== undefined ? body.testScope : targetTest.testScope,
        displayOrder: body.displayOrder !== undefined ? Number(body.displayOrder) : targetTest.displayOrder,
        isActive: body.isActive !== undefined ? Boolean(body.isActive) : targetTest.isActive,
      },
    });

    await prisma.auditLog.create({
      data: {
        table_name: 'lab_test',
        record_id: testId,
        action: 'LAB_TEST_UPDATED',
        old_values: { testName: targetTest.testName, displayOrder: targetTest.displayOrder, isActive: targetTest.isActive },
        new_values: { testName: updatedTest.testName, displayOrder: updatedTest.displayOrder, isActive: updatedTest.isActive },
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
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
