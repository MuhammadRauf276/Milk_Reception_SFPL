import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/backend/core/auth';
import { listMyWork, MY_WORK_MAX_DAYS } from '@/backend/services/myWorkService';
import { requestableEntities } from '@/lib/recordEditor';

/** The signed-in person's previous work as light table rows: their own stages, last 15 days at most, paged. */
export async function GET(req: Request) {
  const user = await getCurrentUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });

  const entities = requestableEntities(user.role);
  if (entities.length === 0) return NextResponse.json({ error: 'Your role has no work list here.' }, { status: 403 });

  const q = new URL(req.url).searchParams;
  try {
    return NextResponse.json(
      await listMyWork({
        userId: BigInt(user.id),
        role: user.role,
        entities,
        sourceId: user.procurement_source_id ? BigInt(user.procurement_source_id) : undefined,
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
