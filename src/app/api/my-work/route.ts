import { NextResponse } from 'next/server';
import { listMyWork, MY_WORK_MAX_DAYS } from '@/backend/services/myWorkService';
import { resolveWorkListOwner } from '@/backend/services/myWorkOwner';

/** Previous work as light table rows (own stages, last 15 days at most, paged); while covering, the covered role's stages. */
export async function GET(req: Request) {
  const owner = await resolveWorkListOwner(req);
  if ('response' in owner) return owner.response;

  const q = new URL(req.url).searchParams;
  try {
    return NextResponse.json(
      await listMyWork({
        userId: owner.userId,
        role: owner.role,
        entities: owner.entities,
        sourceId: owner.sourceId,
        days: Number(q.get('days')) || MY_WORK_MAX_DAYS,
        search: q.get('search')?.trim() || undefined,
        page: Math.max(1, Number(q.get('page')) || 1),
        pageSize: Math.min(50, Math.max(5, Number(q.get('pageSize')) || 25)),
      }),
      { headers: { 'Cache-Control': 'private, no-store' } }
    );
  } catch (err) {
    console.error('GET /api/my-work error:', err);
    return NextResponse.json({ error: 'Could not load your work.' }, { status: 500 });
  }
}
