import { NextResponse } from 'next/server';
import { prisma } from '@core/db';
import { requireRoles } from '@/backend/core/route-guards';

/** The ZMCCs and contractors a report can be narrowed to. */
export async function GET(req: Request) {
  const guard = await requireRoles(req, ['EXECUTIVE_MANAGEMENT', 'QA_HEAD'], { delegation: 'none' });
  if ('response' in guard) return guard.response;

  const sources = await prisma.procurementSource.findMany({
    where: { source_type: { in: ['ZMCC', 'CONTRACTOR'] } },
    select: { id: true, name: true, code: true, source_type: true, is_active: true },
    orderBy: [{ source_type: 'desc' }, { name: 'asc' }],
  });
  return NextResponse.json(
    {
      items: sources.map((s) => ({ id: s.id.toString(), name: s.name, code: s.code, type: s.source_type, active: s.is_active })),
    },
    { headers: { 'Cache-Control': 'private, max-age=300' } }
  );
}
