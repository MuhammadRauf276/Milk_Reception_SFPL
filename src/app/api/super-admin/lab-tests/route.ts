import { NextResponse } from 'next/server';
import { getCurrentUser } from '@core/auth';
import { prisma } from '@core/db';

export async function GET() {
  const authUser = await getCurrentUser();
  if (!authUser || (authUser.role !== 'SUPER_ADMIN' && authUser.role !== 'Admin')) {
    return NextResponse.json({ error: 'Unauthorized. Super Admin authorization required.' }, { status: 403 });
  }

  try {
    const tests = await prisma.labTest.findMany({
      orderBy: { displayOrder: 'asc' },
    });

    const serialized = await Promise.all(
      tests.map(async (t) => {
        const dispatchCount = await prisma.dispatchLabResult.count({ where: { test_id: t.id } });
        const plantCount = await prisma.plantLabResult.count({ where: { test_id: t.id } });
        const totalHistoricalResults = dispatchCount + plantCount;

        return {
          id: t.id.toString(),
          testCode: t.testCode,
          testName: t.testName,
          resultType: t.resultType,
          unit: t.unit,
          testScope: t.testScope,
          isRequired: t.isRequired,
          isActive: t.isActive,
          displayOrder: t.displayOrder,
          historicalResultsCount: totalHistoricalResults,
        };
      })
    );

    return NextResponse.json({ labTests: serialized });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
