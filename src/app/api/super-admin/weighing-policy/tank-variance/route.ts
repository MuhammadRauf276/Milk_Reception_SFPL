import { NextResponse } from 'next/server';
import { requireRoles } from '@/backend/core/route-guards';
import { getTankVarianceWatch } from '@/backend/services/zmccTankVarianceWatch';

/** Over-book and blocked ZMCC dispatches of the last days, to see whether the @13 TS tank check meets real conflicts. */
export async function GET(req: Request) {
  const guard = await requireRoles(req, ['SUPER_ADMIN', 'DATA_EXECUTIVE'], { delegation: 'none', requestedAs: null });
  if ('response' in guard) return guard.response;
  const days = Number(new URL(req.url).searchParams.get('days')) || 30;
  try {
    return NextResponse.json(await getTankVarianceWatch(days), { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (err) {
    console.error('GET tank variance watch error:', err);
    return NextResponse.json({ error: 'Could not load the tank variance watch.' }, { status: 500 });
  }
}
