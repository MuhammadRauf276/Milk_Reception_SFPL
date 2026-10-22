import { NextResponse } from 'next/server';
import { requireRoles } from '@/backend/core/route-guards';
import { unloadSessionToTank, WEIGHING_ROLES } from '@/backend/services/zmccTankService';

export async function POST(req: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  try {
    const guard = await requireRoles(req, WEIGHING_ROLES);
    if ('response' in guard) return guard.response;
    const { sessionId } = await params;
    let body: Record<string, unknown> = {};
    try {
      body = await req.json();
    } catch {
      // empty body is allowed (single active tank, MC milk)
    }
    const result = await unloadSessionToTank(guard.acting, sessionId, body);
    if (result.error) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result.data, { status: result.status });
  } catch (err) {
    console.error('POST /api/zmcc/weighing/sessions/[sessionId]/unload error:', err);
    return NextResponse.json({ error: 'Could not unload. Please try again.' }, { status: 500 });
  }
}
