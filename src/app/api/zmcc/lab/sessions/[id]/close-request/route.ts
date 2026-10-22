import { NextResponse } from 'next/server';
import { requireRoles } from '@/backend/core/route-guards';
import { requestCloseWithoutUnloading } from '@/backend/services/zmccArrival/zmccExitService';

/** PHE Operator asks the ZMCC Manager to close a vehicle (MC or HC) without unloading. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const guard = await requireRoles(req, ['PHE_OPERATOR']);
    if ('response' in guard) return guard.response;
    const { id } = await params;
    let body: Record<string, unknown> = {};
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
    }
    const result = await requestCloseWithoutUnloading(guard.acting, id, body);
    if (result.error) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result.data, { status: result.status });
  } catch (err) {
    console.error('POST /api/zmcc/lab/sessions/[id]/close-request error:', err);
    return NextResponse.json({ error: 'Could not send the request.' }, { status: 500 });
  }
}
