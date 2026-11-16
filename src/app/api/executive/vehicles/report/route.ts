import { NextResponse } from 'next/server';
import { prisma } from '@core/db';
import { requireRoles } from '@/backend/core/route-guards';
import { getVehicleVisitReport } from '@/backend/services/management/vehicleVisitReport';
import {
  ReportInputError,
  parseColumnFilters,
  parseSourceFilter,
  type VehiclePortionReportDb,
} from '@/backend/services/management/vehiclePortionReport';

/** One page of the vehicle report (one row per vehicle) for a chosen date range, source choice and column searches. */
export async function GET(req: Request) {
  const guard = await requireRoles(req, ['EXECUTIVE_MANAGEMENT', 'QA_HEAD'], { delegation: 'none' });
  if ('response' in guard) return guard.response;

  const params = new URL(req.url).searchParams;
  try {
    const report = await getVehicleVisitReport(
      {
        from: params.get('from'),
        to: params.get('to'),
        page: Number(params.get('page')) || 1,
        pageSize: Number(params.get('pageSize')) || undefined,
        filters: parseColumnFilters(params),
        source: parseSourceFilter(params),
      },
      prisma as unknown as VehiclePortionReportDb
    );
    return NextResponse.json(report, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (err: unknown) {
    if (err instanceof ReportInputError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    if (err instanceof Error && err.message.includes('statement timeout')) {
      return NextResponse.json({ error: 'This search took too long. Choose fewer days or search a column.' }, { status: 503 });
    }
    return NextResponse.json({ error: 'Failed to load the report.' }, { status: 500 });
  }
}
