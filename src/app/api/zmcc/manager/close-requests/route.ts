import { NextResponse } from 'next/server';
import { requireRoles } from '@/backend/core/route-guards';
import { listPendingCloseRequests } from '@/backend/services/zmccArrival/zmccExitService';

/** ZMCC Manager: pending "close without unloading" requests of the ZMCC. */
export async function GET(req: Request) {
  try {
    const guard = await requireRoles(req, ['ZMCC_MANAGER']);
    if ('response' in guard) return guard.response;
    const result = await listPendingCloseRequests(guard.acting);
    if (result.error) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result.data, { status: result.status });
  } catch (err) {
    console.error('GET /api/zmcc/manager/close-requests error:', err);
    return NextResponse.json({ error: 'Failed to load close requests.' }, { status: 500 });
  }
}
