import { NextResponse } from 'next/server';
import { getErrorMessage } from '@/lib/errors';
import { requireRoles } from '@/backend/core/route-guards';

const GATEWAY_URL = process.env.WHATSAPP_GATEWAY_URL || 'http://127.0.0.1:3001';

function gatewayHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (process.env.WHATSAPP_GATEWAY_SECRET) headers['x-gateway-secret'] = process.env.WHATSAPP_GATEWAY_SECRET;
  return headers;
}

// Status includes the pairing QR code, so it is restricted to Super Admin.
export async function GET(req: Request) {
  const guard = await requireRoles(req, ['SUPER_ADMIN']);
  if ('response' in guard) return guard.response;

  try {
    const res = await fetch(`${GATEWAY_URL}/status`, {
      method: 'GET',
      headers: gatewayHeaders(),
      cache: 'no-store',
    });

    if (!res.ok) {
      return NextResponse.json({
        status: 'OFFLINE',
        message: 'WhatsApp gateway service is not responding.',
      });
    }

    const data = await res.json();
    return NextResponse.json(data, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (err) {
    return NextResponse.json({
      status: 'OFFLINE',
      message: 'Could not connect to WhatsApp gateway daemon on port 3001.',
      error: getErrorMessage(err),
    });
  }
}

export async function POST(req: Request) {
  const guard = await requireRoles(req, ['SUPER_ADMIN']);
  if ('response' in guard) return guard.response;

  try {
    const res = await fetch(`${GATEWAY_URL}/logout`, {
      method: 'POST',
      headers: gatewayHeaders(),
    });

    const data = await res.json();
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: getErrorMessage(err) }, { status: 500 });
  }
}
