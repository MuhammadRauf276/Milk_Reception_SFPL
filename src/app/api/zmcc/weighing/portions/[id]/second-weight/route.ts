import { NextResponse } from 'next/server';
import { requireRoles } from '@/backend/core/route-guards';
import { recordSecondWeight, WEIGHING_ROLES } from '@/backend/services/zmccTankService';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const guard = await requireRoles(req, WEIGHING_ROLES);
    if ('response' in guard) return guard.response;
    const { id } = await params;
    let body: Record<string, unknown> = {};
    try {
      body = await req.json();
    } catch {
      // empty body is allowed
    }
    const result = await recordSecondWeight(guard.acting, id, body);
    if (result.error) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result.data, { status: result.status });
  } catch (err) {
    console.error('POST /api/zmcc/weighing/portions/[id]/second-weight error:', err);
    return NextResponse.json({ error: 'Could not save. Please try again.' }, { status: 500 });
  }
}
