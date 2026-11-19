import { NextResponse } from 'next/server';
import { requireRoles } from '@/backend/core/route-guards';
import { closeOutageWindow } from '@/backend/services/outageWindowService';

/** Closes catch-up early. Body: { action: 'close' }. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const guard = await requireRoles(req, ['SUPER_ADMIN'], { delegation: 'none', requestedAs: null });
    if ('response' in guard) return guard.response;
    const { id } = await params;
    let body: Record<string, unknown> = {};
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
    }
    if (body.action !== 'close') return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
    const result = await closeOutageWindow(guard.acting, id);
    if (result.error) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result.data);
  } catch (err) {
    console.error('PATCH /api/super-admin/outage-windows/[id] error:', err);
    return NextResponse.json({ error: 'Could not close the outage window.' }, { status: 500 });
  }
}
