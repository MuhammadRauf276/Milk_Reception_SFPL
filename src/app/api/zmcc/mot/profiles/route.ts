import { NextResponse } from 'next/server';
import { resolveMotAuth, listMotProfiles, createMotProfile } from '@/backend/services/motService';

export async function GET(req: Request) {
  const { auth, errorResponse } = await resolveMotAuth(req, 'READ');
  if (errorResponse) {
    return NextResponse.json({ error: errorResponse.error }, { status: errorResponse.status });
  }

  const { searchParams } = new URL(req.url);
  const is_active = searchParams.get('is_active') || undefined;
  const search = searchParams.get('search') || undefined;
  const zmcc_id = searchParams.get('zmcc_id') || undefined;

  try {
    const profiles = await listMotProfiles(auth!, { is_active, search, zmcc_id });
    return NextResponse.json({ profiles });
  } catch (_err) {
    return NextResponse.json({ error: 'An unexpected error occurred while fetching MOT profiles.' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const { auth, errorResponse } = await resolveMotAuth(req, 'WRITE_PROFILE');
  if (errorResponse) {
    return NextResponse.json({ error: errorResponse.error }, { status: errorResponse.status });
  }

  try {
    const body = await req.json();
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
    }

    const result = await createMotProfile(auth!, body);
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({ profile: result.data }, { status: result.status });
  } catch (_err) {
    return NextResponse.json({ error: 'An unexpected error occurred while creating MOT profile.' }, { status: 500 });
  }
}
