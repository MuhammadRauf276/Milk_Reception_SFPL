import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/backend/core/auth';
import { canActAs } from '@/backend/core/roles/hierarchy';
import { generateZmccExcelReport } from '@/backend/services/zmccReportsService';
import { getErrorMessage } from '@/lib/errors';

export async function GET(req: Request) {
  try {
    const user = await getCurrentUser(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const isSystemScope =
      user.role === 'HEAD_OF_MPD' ||
      user.role === 'SUPER_ADMIN' ||
      user.role === 'DATA_EXECUTIVE' ||
      user.role === 'EXECUTIVE_MANAGEMENT';

    const isAuthorized = canActAs(user.role, 'ZMCC_MANAGER');
    if (!isAuthorized) {
      return NextResponse.json({ error: 'Forbidden. ZMCC Manager or executive authority required.' }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const requestedSource = searchParams.get('zmccId') || searchParams.get('sourceId');
    const reportType = (searchParams.get('reportType') || 'HIERARCHY').toUpperCase() as
      | 'HIERARCHY'
      | 'ANALYTICS'
      | 'ROUTE_LEDGER'
      | 'HC_LEDGER'
      | 'TANK_STORAGE';
    const fromDate = searchParams.get('fromDate') || undefined;
    const toDate = searchParams.get('toDate') || undefined;

    let targetZmccId: bigint | undefined = undefined;
    if (isSystemScope) {
      if (requestedSource && requestedSource !== 'ALL') {
        targetZmccId = BigInt(requestedSource);
      }
    } else {
      if (!user.procurement_source_id) {
        return NextResponse.json({ error: 'Account not assigned to an active ZMCC.' }, { status: 403 });
      }
      targetZmccId = BigInt(user.procurement_source_id);
    }

    const buffer = await generateZmccExcelReport(reportType, targetZmccId, fromDate, toDate);

    const filename = `ZMCC_Report_${reportType}_${fromDate || 'current'}.xlsx`;

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    return NextResponse.json({ error: getErrorMessage(error) || 'Failed to generate Excel report' }, { status: 500 });
  }
}
