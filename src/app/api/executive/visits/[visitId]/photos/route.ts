import { NextResponse } from 'next/server';
import { prisma } from '@core/db';
import { requireRoles } from '@/backend/core/route-guards';
import { getVisitPhotos, type VisitPhotoDb } from '@/backend/services/photo/visitPhotoService';

/** Photos attached to one vehicle visit, for Senior Executive Management's Inspect view. */
export async function GET(req: Request, ctx: { params: Promise<{ visitId: string }> }) {
  const guard = await requireRoles(req, ['EXECUTIVE_MANAGEMENT'], { delegation: 'none' });
  if ('response' in guard) return guard.response;

  const { visitId } = await ctx.params;
  if (!/^\d+$/.test(visitId)) {
    return NextResponse.json({ error: 'Visit not found.' }, { status: 404 });
  }

  const photos = await getVisitPhotos(BigInt(visitId), prisma as unknown as VisitPhotoDb);
  return NextResponse.json({ photos });
}
