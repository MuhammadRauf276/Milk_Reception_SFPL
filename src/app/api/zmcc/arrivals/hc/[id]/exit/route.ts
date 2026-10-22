import { NextResponse } from 'next/server';
import { requireRoles } from '@/backend/core/route-guards';
import { recordHcGateExit } from '@/backend/services/zmccArrival/zmccExitService';

/** HC gate exit: last step, done by the PHE Operator (and superiors). MC has no gate exit. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const guard = await requireRoles(req, ['PHE_OPERATOR']);
    if ('response' in guard) return guard.response;
    const { id } = await params;
    let body: Record<string, unknown> = {};
    try {
      body = await req.json();
    } catch {
      // empty body is allowed: the exit time defaults to now
    }
    const result = await recordHcGateExit(guard.acting, id, body);
    if (result.error) {
      return NextResponse.json({ error: result.error, message: result.message || result.error }, { status: result.status });
    }
    return NextResponse.json({ exit: result.data, ...result.data }, { status: result.status });
  } catch (err) {
    console.error('POST /api/zmcc/arrivals/hc/[id]/exit error:', err);
    return NextResponse.json({ error: 'Failed to record the exit.', message: 'Failed to record the exit.' }, { status: 500 });
  }
}
