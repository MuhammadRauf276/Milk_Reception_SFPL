import { NextResponse } from 'next/server';
import { prisma } from '@core/db';

function serializeLabTest(test: any) {
  return {
    id: test.id.toString(),
    testCode: test.testCode,
    testName: test.testName,
    resultType: test.resultType,
    unit: test.unit,
    testScope: test.testScope,
    isRequired: test.isRequired,
    displayOrder: test.displayOrder,
  };
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const scope = searchParams.get('scope') || 'DISPATCH';

  try {
    const scopeFilter =
      scope === 'DISPATCH'
        ? { in: ['DISPATCH', 'BOTH'] }
        : scope === 'PLANT'
        ? { in: ['PLANT', 'BOTH'] }
        : { in: ['DISPATCH', 'PLANT', 'BOTH'] };

    const tests = await prisma.labTest.findMany({
      where: {
        isActive: true,
        testScope: scopeFilter,
      },
      orderBy: [
        { displayOrder: 'asc' },
        { testName: 'asc' },
      ],
    });

    return NextResponse.json({ tests: tests.map(serializeLabTest) });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Failed to fetch lab tests' }, { status: 500 });
  }
}
