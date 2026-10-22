import { NextResponse } from 'next/server';
import { requireRoles } from '@/backend/core/route-guards';
import { decideCloseWithoutUnloading } from '@/backend/services/zmccArrival/zmccExitService';

/** ZMCC Manager approves (or rejects) a close-without-unloading request. Body: { decision: APPROVE or REJECT, remarks } (or { approve: boolean }). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const guard = await requireRoles(req, ['ZMCC_MANAGER']);
    if ('response' in guard) return guard.response;
    const { id } = await params;
    let body: Record<string, unknown> = {};
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
    }
    const result = await decideCloseWithoutUnloading(guard.acting, id, body);
    if (result.error) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result.data, { status: result.status });
  } catch (err) {
    console.error('POST /api/zmcc/lab/sessions/[id]/close-approve error:', err);
    return NextResponse.json({ error: 'Could not save the decision.' }, { status: 500 });
  }
}
