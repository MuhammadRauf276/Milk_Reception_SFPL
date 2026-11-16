import { NextResponse } from 'next/server';
import { prisma } from '@core/db';
import { requireRoles } from '@/backend/core/route-guards';

/** The lab tests a person can pick for the Lab tests sheet of the Excel file. */
export async function GET(req: Request) {
  const guard = await requireRoles(req, ['EXECUTIVE_MANAGEMENT', 'QA_HEAD'], { delegation: 'none' });
  if ('response' in guard) return guard.response;

  const tests = await prisma.labTest.findMany({
    where: { isActive: true, resultType: { not: 'CALCULATED' } },
    select: { id: true, testName: true, unit: true },
    orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }],
  });
  return NextResponse.json(
    { items: tests.map((t) => ({ id: t.id.toString(), name: t.testName, unit: t.unit })) },
    { headers: { 'Cache-Control': 'private, max-age=300' } }
  );
}
