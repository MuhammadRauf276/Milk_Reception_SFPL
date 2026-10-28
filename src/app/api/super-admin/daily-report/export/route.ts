import { NextResponse } from 'next/server';
import { getCurrentUser } from '@core/auth';
import {
  getSuperAdminDailyReportData,
  generateDailyReportExcel,
} from '@/backend/services/superAdminDailyReportService';
import { getErrorMessage } from '@/lib/errors';

export async function GET(req: Request) {
  const user = await getCurrentUser(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const allowedRoles = ['SUPER_ADMIN', 'DATA_EXECUTIVE', 'HEAD_OF_MPD', 'QA_HEAD', 'ADMIN_HEAD'];
  if (!allowedRoles.includes(user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const date = searchParams.get('date') || new Date().toISOString().slice(0, 10);
  const zmccId = searchParams.get('zmccId') || undefined;

  try {
    const reportData = await getSuperAdminDailyReportData({ date, zmccId });
    const buffer = await generateDailyReportExcel(reportData);

    const filename = `shakarganj-daily-report-${date}.xlsx`;

    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error) || 'Failed to export daily report excel' },
      { status: 500 }
    );
  }
}
