import { NextResponse } from 'next/server';
import { resolveZmccAuth, listAreas, createArea } from '@/backend/services/zmccMasterDataService';

export async function GET(req: Request) {
  const { auth, errorResponse } = await resolveZmccAuth(req, 'READ');
  if (errorResponse) {
    return NextResponse.json({ error: errorResponse.error }, { status: errorResponse.status });
  }

  const { searchParams } = new URL(req.url);
  const route_id = searchParams.get('route_id') || undefined;
  const is_active = searchParams.get('is_active') || undefined;
  const search = searchParams.get('search') || undefined;
  const zmcc_id = searchParams.get('zmcc_id') || undefined;

  try {
    const areas = await listAreas(auth!, { route_id, is_active, search, zmcc_id });
    return NextResponse.json({ areas });
  } catch (_err) {
    return NextResponse.json({ error: 'An unexpected error occurred while fetching areas.' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const { auth, errorResponse } = await resolveZmccAuth(req, 'WRITE_AREA');
  if (errorResponse) {
    return NextResponse.json({ error: errorResponse.error }, { status: errorResponse.status });
  }

  try {
    const body = await req.json();
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
    }

    const result = await createArea(auth!, body);
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({ area: result.data }, { status: result.status });
  } catch (_err) {
    return NextResponse.json({ error: 'An unexpected error occurred while creating area.' }, { status: 500 });
  }
}
