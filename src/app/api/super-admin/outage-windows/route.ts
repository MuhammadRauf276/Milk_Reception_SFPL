import { NextResponse } from 'next/server';
import { requireRoles } from '@/backend/core/route-guards';
import { listOutageWindows, openOutageWindow } from '@/backend/services/outageWindowService';

export async function GET(req: Request) {
  try {
    const guard = await requireRoles(req, ['SUPER_ADMIN', 'DATA_EXECUTIVE'], { delegation: 'none', requestedAs: null });
    if ('response' in guard) return guard.response;
    return NextResponse.json({ windows: await listOutageWindows() });
  } catch (err) {
    console.error('GET /api/super-admin/outage-windows error:', err);
    return NextResponse.json({ error: 'Could not load outage windows.' }, { status: 500 });
  }
}

/** Only the Super Admin opens a window. */
export async function POST(req: Request) {
  try {
    const guard = await requireRoles(req, ['SUPER_ADMIN'], { delegation: 'none', requestedAs: null });
    if ('response' in guard) return guard.response;
    let body: Record<string, unknown> = {};
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
    }
    const result = await openOutageWindow(guard.acting, body);
    if (result.error) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result.data, { status: 201 });
  } catch (err) {
    console.error('POST /api/super-admin/outage-windows error:', err);
    return NextResponse.json({ error: 'Could not open the outage window.' }, { status: 500 });
  }
}
