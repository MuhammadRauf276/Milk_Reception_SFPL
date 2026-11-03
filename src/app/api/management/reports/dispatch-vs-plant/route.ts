import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/backend/core/auth';
import { prisma } from '@/backend/core/db';
import { getDispatchVsPlantReport } from '@/backend/services/management/dispatchVsPlantReport';

const ALLOWED_ROLES = ['HEAD_OF_MPD', 'SUPER_ADMIN', 'EXECUTIVE_MANAGEMENT', 'DATA_EXECUTIVE', 'ZMCC_MANAGER', 'QA_HEAD'];

/** Read-only: what each ZMCC tanker sent vs what the plant received (volume, weight, 13 TS, test-wise). */
export async function GET(req: Request) {
  const current = await getCurrentUser(req);
  if (!current) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  const user = await prisma.user.findUnique({ where: { id: BigInt(current.id) } });
  if (!user || !ALLOWED_ROLES.includes(user.role)) return NextResponse.json({ error: 'Forbidden.' }, { status: 403 });

  const q = new URL(req.url).searchParams;
  let zmccId = q.get('zmccId') || undefined;
  if (user.role === 'ZMCC_MANAGER') {
    if (!user.procurement_source_id) {
      return NextResponse.json({ error: 'ZMCC Manager has no assigned procurement source.' }, { status: 400 });
    }
    zmccId = user.procurement_source_id.toString();
  }

  try {
    const report = await getDispatchVsPlantReport({ from: q.get('from') || undefined, to: q.get('to') || undefined, zmccId });
    return NextResponse.json({ success: true, data: report }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to build the report.' }, { status: 500 });
  }
}
