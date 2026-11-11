import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/backend/core/auth';
import { searchRequestableGroups } from '@/backend/services/recordEditorService';
import { requestableEntities } from '@/lib/recordEditor';

/** Records the signed-in person may ask to correct: their role's stages, within their own ZMCC or contractor. */
export async function GET(req: Request) {
  const user = await getCurrentUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });

  const entities = requestableEntities(user.role);
  if (entities.length === 0) return NextResponse.json({ error: 'Your role does not raise correction requests here.' }, { status: 403 });

  const search = (new URL(req.url).searchParams.get('search') || '').trim();
  if (search.length < 2) return NextResponse.json({ groups: [] });

  try {
    const sourceId = user.procurement_source_id ? BigInt(user.procurement_source_id) : undefined;
    return NextResponse.json({ groups: await searchRequestableGroups(search, entities, sourceId) });
  } catch (err) {
    console.error('GET /api/corrections/requestable error:', err);
    return NextResponse.json({ error: 'Could not search records.' }, { status: 500 });
  }
}
