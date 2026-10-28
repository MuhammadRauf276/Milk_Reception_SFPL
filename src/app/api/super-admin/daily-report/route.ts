import { NextResponse } from 'next/server';
import { getCurrentUser } from '@core/auth';
import { getSuperAdminDailyReportData } from '@/backend/services/superAdminDailyReportService';
import { getErrorMessage } from '@/lib/errors';

export async function GET(req: Request) {
  const user = await getCurrentUser(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Allowed for Super Admin, Data Executive, Head of MPD, QA Head
  const allowedRoles = ['SUPER_ADMIN', 'DATA_EXECUTIVE', 'HEAD_OF_MPD', 'QA_HEAD', 'ADMIN_HEAD'];
  if (!allowedRoles.includes(user.role)) {
    return NextResponse.json({ error: 'Forbidden: Insufficient permissions for Daily Report' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const date = searchParams.get('date') || new Date().toISOString().slice(0, 10);
  const zmccId = searchParams.get('zmccId') || undefined;

  try {
    const data = await getSuperAdminDailyReportData({ date, zmccId });
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error) || 'Failed to generate daily operations report' },
      { status: 500 }
    );
  }
}
