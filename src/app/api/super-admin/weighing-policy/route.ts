import { NextResponse } from 'next/server';
import { requireRoles } from '@/backend/core/route-guards';
import { getWeighingPolicy, updateWeighingPolicy } from '@/backend/services/zmccWeighingPolicyService';

export async function GET(req: Request) {
  try {
    const guard = await requireRoles(req, ['SUPER_ADMIN', 'DATA_EXECUTIVE'], { delegation: 'none', requestedAs: null });
    if ('response' in guard) return guard.response;
    return NextResponse.json({ policy: await getWeighingPolicy() });
  } catch (err) {
    console.error('GET /api/super-admin/weighing-policy error:', err);
    return NextResponse.json({ error: 'Failed to load the weighing policy.' }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const guard = await requireRoles(req, ['SUPER_ADMIN'], { delegation: 'none', requestedAs: null });
    if ('response' in guard) return guard.response;
    let body: Record<string, unknown> = {};
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
    }
    const result = await updateWeighingPolicy(guard.acting, body);
    if (result.error) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ policy: result.data });
  } catch (err) {
    console.error('PUT /api/super-admin/weighing-policy error:', err);
    return NextResponse.json({ error: 'Failed to save the weighing policy.' }, { status: 500 });
  }
}
