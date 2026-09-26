import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/backend/core/auth';
import { prisma } from '@/backend/core/db';
import type { ManagementFilters, ManagementScope } from '@/backend/modules/management-reporting';
import { getZmccAreaReconciliation } from '@/backend/services/zmccReconciliationReadModelService';

export async function GET(req: Request) {
  const current = await getCurrentUser(req);
  if (!current) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  const user = await prisma.user.findUnique({ where: { id: BigInt(current.id) } });
  let scope: ManagementScope;
  if (user?.role === 'ZMCC_MANAGER' && user.procurement_source_id) scope = { kind: 'ZMCC', zmccId: user.procurement_source_id.toString() };
  else if (user?.role === 'HEAD_OF_MPD' || user?.role === 'SUPER_ADMIN' || user?.role === 'FINANCE_ACCOUNTS' || user?.role === 'EXECUTIVE_MANAGEMENT') scope = { kind: 'SYSTEM' };
  else return NextResponse.json({ error: 'Forbidden.' }, { status: 403 });
  const params = new URL(req.url).searchParams;
  const filters: ManagementFilters = {
    from: params.get('from') || undefined, to: params.get('to') || undefined, sourceId: params.get('sourceId') || undefined,
    routeId: params.get('routeId') || undefined, exceptionOnly: params.get('exceptionOnly') === 'true',
    page: params.get('page') ? Number(params.get('page')) : undefined, pageSize: params.get('pageSize') ? Number(params.get('pageSize')) : undefined,
  };
  try { return NextResponse.json({ ...(await getZmccAreaReconciliation(scope, filters)), scope: scope.kind, filters }, { headers: { 'Cache-Control': 'private, no-store' } }); }
  catch (error: any) { return NextResponse.json({ error: error.message || 'Unable to load reconciliation report.' }, { status: 400 }); }
}
