import { NextResponse } from 'next/server';
import { resolveMotAuth, listFleet } from '@/backend/services/motService';

/** Whole fleet with status and transfer history. Data Executive and Super Admin only. */
export async function GET(req: Request) {
  const { auth, errorResponse } = await resolveMotAuth(req, 'READ_FLEET');
  if (errorResponse) {
    return NextResponse.json({ error: errorResponse.error }, { status: errorResponse.status });
  }

  const { searchParams } = new URL(req.url);
  const zmcc_id = searchParams.get('zmcc_id') || undefined;
  const search = searchParams.get('search') || undefined;

  try {
    const vehicles = await listFleet(auth!, { zmcc_id, search });
    return NextResponse.json({ vehicles });
  } catch (_err) {
    return NextResponse.json({ error: 'An unexpected error occurred while loading the fleet.' }, { status: 500 });
  }
}
