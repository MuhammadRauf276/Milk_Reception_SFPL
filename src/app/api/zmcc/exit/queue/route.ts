import { NextResponse } from 'next/server';
import { requireRoles } from '@/backend/core/route-guards';
import { listExitQueue } from '@/backend/services/zmccArrival/zmccExitService';

/** PHE Operator: HC vehicles waiting to leave, and vehicles that may be closed without unloading. */
export async function GET(req: Request) {
  try {
    const guard = await requireRoles(req, ['PHE_OPERATOR']);
    if ('response' in guard) return guard.response;
    const result = await listExitQueue(guard.acting);
    if (result.error) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result.data, { status: result.status });
  } catch (err) {
    console.error('GET /api/zmcc/exit/queue error:', err);
    return NextResponse.json({ error: 'Failed to load the exit list.' }, { status: 500 });
  }
}
