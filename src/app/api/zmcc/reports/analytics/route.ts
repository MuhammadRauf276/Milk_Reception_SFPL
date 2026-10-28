import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/backend/core/auth';
import { canActAs } from '@/backend/core/roles/hierarchy';
import { getZmccBIAnalytics } from '@/backend/services/zmccReportsService';
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
    const fromDate = searchParams.get('fromDate') || undefined;
    const toDate = searchParams.get('toDate') || undefined;
    const routeId = searchParams.get('routeId') || undefined;
    const shift = searchParams.get('shift') || undefined;

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

    const analytics = await getZmccBIAnalytics(targetZmccId, fromDate, toDate, { routeId, shift });
    return NextResponse.json({ data: analytics });
  } catch (error) {
    return NextResponse.json({ error: getErrorMessage(error) || 'Failed to fetch BI analytics' }, { status: 500 });
  }
}
