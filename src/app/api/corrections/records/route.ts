import { NextResponse } from 'next/server';
import { requireDirectEditAuthority } from '@/backend/core/route-guards';
import { listRecordGroups, RECORD_STAGE_FILTERS } from '@/backend/services/recordEditorService';
import { correctPlantReception } from '@/backend/services/corrections/plantReceptionCorrection';

/** Every saved transaction, newest first, with filters. Super Admin only. */
export async function GET(req: Request) {
  const guard = await requireDirectEditAuthority(req);
  if ('response' in guard) return guard.response;

  const q = new URL(req.url).searchParams;
  const date = q.get('date') || undefined;
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ error: 'Invalid date.' }, { status: 400 });
  const rawStage = q.get('stage');
  const stage = RECORD_STAGE_FILTERS.find((x) => x === rawStage) ?? 'ALL';

  try {
    return NextResponse.json(
      await listRecordGroups({
        date,
        stage,
        enteredBy: q.get('enteredBy')?.trim() || undefined,
        search: q.get('search')?.trim() || undefined,
        page: Math.max(1, Number(q.get('page')) || 1),
        pageSize: Math.min(50, Math.max(5, Number(q.get('pageSize')) || 25)),
      })
    );
  } catch (err) {
    console.error('GET /api/corrections/records error:', err);
    return NextResponse.json({ error: 'Could not load records.' }, { status: 500 });
  }
}

/** Correct a plant reception. Super Admin only here; a Data Executive does it through a ticket. */
export async function PATCH(req: Request) {
  const guard = await requireDirectEditAuthority(req);
  if ('response' in guard) return guard.response;
  const result = await correctPlantReception(guard.user, await req.json().catch(() => null));
  return NextResponse.json(result.body, { status: result.status });
}
