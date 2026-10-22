import { NextResponse } from 'next/server';
import { requireRoles } from '@/backend/core/route-guards';
import { saveWeighingValues, WEIGHING_ROLES } from '@/backend/services/zmccTankService';

export async function PUT(req: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  try {
    const guard = await requireRoles(req, WEIGHING_ROLES);
    if ('response' in guard) return guard.response;
    const { sessionId } = await params;
    let body: Record<string, unknown> = {};
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
    }
    const result = await saveWeighingValues(guard.acting, sessionId, body);
    if (result.error) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result.data, { status: result.status });
  } catch (err) {
    console.error('PUT /api/zmcc/weighing/sessions/[sessionId]/values error:', err);
    return NextResponse.json({ error: 'Could not save. Please try again.' }, { status: 500 });
  }
}
