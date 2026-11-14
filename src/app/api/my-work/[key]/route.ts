import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/backend/core/auth';
import { getRequestableGroup } from '@/backend/services/recordEditorService';
import { requestableEntities } from '@/lib/recordEditor';

/** One record in full, loaded only when its row is opened. */
export async function GET(req: Request, { params }: { params: Promise<{ key: string }> }) {
  const user = await getCurrentUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });

  const entities = requestableEntities(user.role);
  if (entities.length === 0) return NextResponse.json({ error: 'Your role has no work list here.' }, { status: 403 });

  const { key } = await params;
  try {
    const group = await getRequestableGroup(key, entities, user.procurement_source_id ? BigInt(user.procurement_source_id) : undefined);
    if (!group) return NextResponse.json({ error: 'Record not found.' }, { status: 404 });
    return NextResponse.json({ group }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (err) {
    console.error('GET /api/my-work/[key] error:', err);
    return NextResponse.json({ error: 'Could not load the record.' }, { status: 500 });
  }
}
