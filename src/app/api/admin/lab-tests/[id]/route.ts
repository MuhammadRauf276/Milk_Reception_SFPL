import { NextResponse } from 'next/server';
import { getCurrentUser } from '@core/auth';
import { prisma } from '@core/db';
import { updateLabTestSchema } from '@/lib/validations/labTest';

function serializeLabTest(test: any) {
  return {
    ...test,
    id: test.id.toString(),
  };
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user || (user.role !== 'Admin' && user.role !== 'Management')) {
    return NextResponse.json({ error: 'Unauthorized. Admin or Management role required.' }, { status: 403 });
  }

  const resolvedParams = await params;
  const testIdStr = resolvedParams.id;

  try {
    const testId = BigInt(testIdStr);
    const body = await req.json();
    const validated = updateLabTestSchema.parse(body);

    const existing = await prisma.labTest.findUnique({
      where: { id: testId },
    });

    if (!existing) {
      return NextResponse.json({ error: 'Laboratory test record not found' }, { status: 404 });
    }

    // Enforce testCode immutability: testCode cannot be changed after creation
    if (validated.testCode && validated.testCode !== existing.testCode) {
      return NextResponse.json(
        { error: 'Lab Test reference code cannot be changed after creation.' },
        { status: 400 }
      );
    }

    // Delete testCode from update payload to ensure it is never mutated
    const updateData = { ...validated };
    delete updateData.testCode;

    const updated = await prisma.labTest.update({
      where: { id: testId },
      data: updateData as any,
    });

    return NextResponse.json({ test: serializeLabTest(updated) });
  } catch (error: any) {
    if (error?.name === 'ZodError') {
      return NextResponse.json({ error: error.errors[0]?.message || 'Validation failed' }, { status: 400 });
    }
    return NextResponse.json({ error: error?.message || 'Failed to update lab test' }, { status: 500 });
  }
}
