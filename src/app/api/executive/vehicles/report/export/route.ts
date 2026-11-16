import { NextResponse } from 'next/server';
import { prisma } from '@core/db';
import { requireRoles } from '@/backend/core/route-guards';
import {
  ReportInputError,
  parseColumnFilters,
  parseSourceFilter,
  type VehiclePortionReportDb,
} from '@/backend/services/management/vehiclePortionReport';
import { buildVehicleReportExcel, exportOncePerUser, parseExportGroups } from '@/backend/services/management/vehicleReportExport';

/** The vehicle report as an Excel file, for the same dates, source choice and column searches as the screen. */
export async function GET(req: Request) {
  const guard = await requireRoles(req, ['EXECUTIVE_MANAGEMENT', 'QA_HEAD'], { delegation: 'none' });
  if ('response' in guard) return guard.response;

  const params = new URL(req.url).searchParams;
  const from = params.get('from');
  const to = params.get('to');
  try {
    const file = await exportOncePerUser(String(guard.user.id), () =>
      buildVehicleReportExcel(
        { from, to, filters: parseColumnFilters(params), source: parseSourceFilter(params), groups: parseExportGroups(params) },
        prisma as unknown as VehiclePortionReportDb
      )
    );
    return new NextResponse(new Uint8Array(file), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="vehicle-report-${from}-to-${to}.xlsx"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (err: unknown) {
    if (err instanceof ReportInputError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    if (err instanceof Error && err.message.includes('statement timeout')) {
      return NextResponse.json({ error: 'This report took too long. Choose fewer days or one source.' }, { status: 503 });
    }
    console.error('Vehicle report export failed:', err);
    return NextResponse.json({ error: 'The Excel file could not be made.' }, { status: 500 });
  }
}
