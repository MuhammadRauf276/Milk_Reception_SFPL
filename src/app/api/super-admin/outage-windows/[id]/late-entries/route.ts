import { NextResponse } from 'next/server';
import { requireRoles } from '@/backend/core/route-guards';
import { listLateEntries } from '@/backend/services/outageWindowService';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const guard = await requireRoles(req, ['SUPER_ADMIN', 'DATA_EXECUTIVE'], { delegation: 'none', requestedAs: null });
    if ('response' in guard) return guard.response;
    const { id } = await params;
    const result = await listLateEntries(id);
    if (result.error) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ entries: result.data });
  } catch (err) {
    console.error('GET /api/super-admin/outage-windows/[id]/late-entries error:', err);
    return NextResponse.json({ error: 'Could not load late entries.' }, { status: 500 });
  }
}
