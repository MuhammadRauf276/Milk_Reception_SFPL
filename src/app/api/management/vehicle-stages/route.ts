import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/backend/core/auth';
import { prisma } from '@/backend/core/db';
import { getCurrentVehicleStages } from '@/backend/services/managementVehicleStageProjectionService';
import type { ManagementFilters, ManagementScope } from '@/backend/modules/management-reporting';

export async function GET(req: Request) {
  const startedAt = performance.now();
  const current = await getCurrentUser(req);
  if (!current) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  const user = await prisma.user.findUnique({ where: { id: BigInt(current.id) } });
  if (!user?.is_active) return NextResponse.json({ error: 'Unauthorized.' }, { status: 403 });

  let scope: ManagementScope;
  if (user.role === 'SUPER_ADMIN' || user.role === 'HEAD_OF_MPD' || user.role === 'EXECUTIVE_MANAGEMENT') {
    scope = { kind: 'SYSTEM' };
  } else if (user.role === 'ZMCC_MANAGER' && user.procurement_source_id) {
    scope = { kind: 'ZMCC', zmccId: user.procurement_source_id.toString() };
  } else {
    return NextResponse.json({ error: 'Forbidden. Management vehicle-stage access is not assigned to this role.' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const filters: ManagementFilters = {
    from: searchParams.get('from') || undefined, to: searchParams.get('to') || undefined,
    sourceId: searchParams.get('sourceId') || undefined, vehicleNumber: searchParams.get('vehicleNumber') || undefined,
    exceptionOnly: searchParams.get('exceptionOnly') === 'true',
    page: searchParams.get('page') ? Number(searchParams.get('page')) : undefined,
    pageSize: searchParams.get('pageSize') ? Number(searchParams.get('pageSize')) : undefined,
  };
  try {
    const result = await getCurrentVehicleStages(scope, filters);
    const durationMs = performance.now() - startedAt;
    return NextResponse.json({ ...result, scope: scope.kind, filters, queryDurationMs: Math.round(durationMs) }, {
      headers: { 'Cache-Control': 'private, no-store', 'Server-Timing': `management-vehicle-stages;dur=${durationMs.toFixed(1)}` },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Unable to load vehicle stages.' }, { status: 400 });
  }
}
