import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/backend/core/auth';
import { getAvailableSourcesForZmcc } from '@/backend/services/milkSourceService';

export async function GET(req: Request) {
  const user = await getCurrentUser(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  // A user tied to a ZMCC only ever sees that ZMCC's list, whatever is asked for. Only system-wide users may choose.
  // A system-wide user covering a ZMCC station sends the one they picked in the acting-source header.
  const zmccIdParam =
    user.procurement_source_id || searchParams.get('zmcc_id') || req.headers.get('x-acting-source-id');

  if (!zmccIdParam) {
    return NextResponse.json({ error: 'zmcc_id is required.' }, { status: 400 });
  }

  try {
    const sources = await getAvailableSourcesForZmcc(zmccIdParam, user.role);
    return NextResponse.json({ sources }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to fetch available sources.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
