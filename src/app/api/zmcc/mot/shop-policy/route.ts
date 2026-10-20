import { NextResponse } from 'next/server';
import { requireRoles } from '@/backend/core/route-guards';
import { loadMotShopPolicy } from '@/backend/services/mot/motShopPolicy';
import { getErrorMessage } from '@/lib/errors';

export async function GET(req: Request) {
  const guard = await requireRoles(req, ['MOT', 'DATA_EXECUTIVE']);
  if ('response' in guard) return guard.response;

  try {
    const snapshot = await loadMotShopPolicy();
    return NextResponse.json(snapshot, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (err) {
    return NextResponse.json({ error: getErrorMessage(err) || 'Could not load the shop test policy.' }, { status: 500 });
  }
}
