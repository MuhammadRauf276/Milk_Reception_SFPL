import { NextResponse } from 'next/server';
import { getErrorMessage } from '@/lib/errors';
import { requireRoles } from '@/backend/core/route-guards';

const GATEWAY_URL = process.env.WHATSAPP_GATEWAY_URL || 'http://127.0.0.1:3001';

export async function POST(req: Request) {
  const guard = await requireRoles(req, ['SUPER_ADMIN']);
  if ('response' in guard) return guard.response;

  try {
    const payload = await req.json();
    const to = typeof payload?.to === 'string' ? payload.to : '';
    const message = typeof payload?.message === 'string' ? payload.message : '';
    if (!to.trim() || !message.trim()) {
      return NextResponse.json({ error: 'Parameters "to" and "message" are required.' }, { status: 400 });
    }

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (process.env.WHATSAPP_GATEWAY_SECRET) headers['x-gateway-secret'] = process.env.WHATSAPP_GATEWAY_SECRET;

    // Forward only the validated fields, never the raw client payload.
    const res = await fetch(`${GATEWAY_URL}/send`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ to, message }),
    });

    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err) {
    return NextResponse.json({ error: getErrorMessage(err) }, { status: 500 });
  }
}
