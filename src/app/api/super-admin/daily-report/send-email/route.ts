import { NextResponse } from 'next/server';
import { getCurrentUser } from '@core/auth';
import { resolveActingContext } from '@/backend/core/acting-context';
import {
  getSuperAdminDailyReportData,
  sendSuperAdminDailyReportEmail,
} from '@/backend/services/superAdminDailyReportService';
import { getErrorMessage } from '@/lib/errors';

export async function POST(req: Request) {
  const user = await getCurrentUser(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const allowedRoles = ['SUPER_ADMIN', 'DATA_EXECUTIVE', 'HEAD_OF_MPD'];
  if (!allowedRoles.includes(user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const body = await req.json();
    const { recipients, date, note, zmccId } = body;

    if (!Array.isArray(recipients) || recipients.length === 0) {
      return NextResponse.json({ error: 'At least one recipient email address is required.' }, { status: 400 });
    }

    const reportDate = date || new Date().toISOString().slice(0, 10);
    const reportData = await getSuperAdminDailyReportData({ date: reportDate, zmccId });

    const actingResult = resolveActingContext(user, allowedRoles);
    if (!actingResult.ok) {
      return NextResponse.json({ error: `Forbidden: ${actingResult.code}` }, { status: 403 });
    }

    const result = await sendSuperAdminDailyReportEmail({
      recipients,
      date: reportDate,
      note,
      reportData,
      actingContext: actingResult.ctx,
    });

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error) || 'Failed to dispatch daily report email' },
      { status: 500 }
    );
  }
}
