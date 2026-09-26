import { NextResponse } from 'next/server';
import { resolveZmccAuth, listMilkSources, createMilkSource } from '@/backend/services/zmccMasterDataService';

export async function GET(req: Request) {
  const { auth, errorResponse } = await resolveZmccAuth(req, 'READ');
  if (errorResponse) {
    return NextResponse.json({ error: errorResponse.error }, { status: errorResponse.status });
  }

  const { searchParams } = new URL(req.url);
  const is_active = searchParams.get('is_active') || undefined;
  const search = searchParams.get('search') || undefined;
  const zmcc_id = searchParams.get('zmcc_id') || undefined;

  try {
    const milk_sources = await listMilkSources(auth!, { is_active, search, zmcc_id });
    return NextResponse.json({ milk_sources });
  } catch (_err) {
    return NextResponse.json({ error: 'An unexpected error occurred while fetching milk sources.' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const { auth, errorResponse } = await resolveZmccAuth(req, 'WRITE_MILK_SOURCE');
  if (errorResponse) {
    return NextResponse.json({ error: errorResponse.error }, { status: errorResponse.status });
  }

  try {
    const body = await req.json();
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
    }

    const result = await createMilkSource(auth!, body);
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({ milk_source: result.data }, { status: result.status });
  } catch (_err) {
    return NextResponse.json({ error: 'An unexpected error occurred while creating milk source.' }, { status: 500 });
  }
}
