import { NextResponse } from 'next/server';
import { requireRoles } from '@/backend/core/route-guards';
import { listWeighingQueue, WEIGHING_ROLES } from '@/backend/services/zmccTankService';

export async function GET(req: Request) {
  try {
    const guard = await requireRoles(req, WEIGHING_ROLES);
    if ('response' in guard) return guard.response;
    const result = await listWeighingQueue(guard.acting);
    if (result.error) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result.data, { status: result.status });
  } catch (err) {
    console.error('GET /api/zmcc/weighing/queue error:', err);
    return NextResponse.json({ error: 'Failed to load the weighing list.' }, { status: 500 });
  }
}
