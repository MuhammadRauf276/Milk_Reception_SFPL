import { NextResponse } from 'next/server';
import { getRequestableGroup } from '@/backend/services/recordEditorService';
import { resolveWorkListOwner } from '@/backend/services/myWorkOwner';

/** One record in full, loaded only when its row is opened. */
export async function GET(req: Request, { params }: { params: Promise<{ key: string }> }) {
  const owner = await resolveWorkListOwner(req);
  if ('response' in owner) return owner.response;

  const { key } = await params;
  try {
    const group = await getRequestableGroup(key, owner.entities, owner.sourceId);
    if (!group) return NextResponse.json({ error: 'Record not found.' }, { status: 404 });
    return NextResponse.json({ group }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (err) {
    console.error('GET /api/my-work/[key] error:', err);
    return NextResponse.json({ error: 'Could not load the record.' }, { status: 500 });
  }
}
