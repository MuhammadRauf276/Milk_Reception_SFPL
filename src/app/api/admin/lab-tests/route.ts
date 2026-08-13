import { NextResponse } from 'next/server';
import { getCurrentUser } from '@core/auth';
import { prisma } from '@core/db';
import { createLabTestSchema } from '@/lib/validations/labTest';

function serializeLabTest(test: any) {
  return {
    ...test,
    id: test.id.toString(),
  };
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user || (user.role !== 'Admin' && user.role !== 'Management')) {
    return NextResponse.json({ error: 'Unauthorized. Admin or Management role required.' }, { status: 403 });
  }

  try {
    const tests = await prisma.labTest.findMany({
      orderBy: [
        { displayOrder: 'asc' },
        { testName: 'asc' },
      ],
    });

    return NextResponse.json({ tests: tests.map(serializeLabTest) });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Database query failed' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user || (user.role !== 'Admin' && user.role !== 'Management')) {
    return NextResponse.json({ error: 'Unauthorized. Admin or Management role required.' }, { status: 403 });
  }

  try {
    const body = await req.json();
    const validated = createLabTestSchema.parse(body);

    // Concurrency-safe automatic testCode generation using database sequence
    const nextSeqResult = await prisma.$queryRaw<{ nextval: bigint }[]>`SELECT nextval('lab_test_code_seq') as nextval`;
    const nextSeq = nextSeqResult[0]?.nextval ? Number(nextSeqResult[0].nextval) : 100;
    let finalTestCode = `LT-${String(nextSeq).padStart(6, '0')}`;

    // Extra safety check against collisions
    let collision = await prisma.labTest.findUnique({ where: { testCode: finalTestCode } });
    while (collision) {
      const retrySeqResult = await prisma.$queryRaw<{ nextval: bigint }[]>`SELECT nextval('lab_test_code_seq') as nextval`;
      const retrySeq = retrySeqResult[0]?.nextval ? Number(retrySeqResult[0].nextval) : Date.now();
      finalTestCode = `LT-${String(retrySeq).padStart(6, '0')}`;
      collision = await prisma.labTest.findUnique({ where: { testCode: finalTestCode } });
    }

    const created = await prisma.labTest.create({
      data: {
        testCode: finalTestCode,
        testName: validated.testName,
        resultType: validated.resultType,
        unit: validated.unit || null,
        testScope: validated.testScope,
        isRequired: validated.isRequired,
        isActive: validated.isActive,
        displayOrder: validated.displayOrder,
      },
    });

    return NextResponse.json({ test: serializeLabTest(created) }, { status: 201 });
  } catch (error: any) {
    if (error?.name === 'ZodError') {
      return NextResponse.json({ error: error.errors[0]?.message || 'Validation failed' }, { status: 400 });
    }
    return NextResponse.json({ error: error?.message || 'Failed to create lab test' }, { status: 500 });
  }
}
