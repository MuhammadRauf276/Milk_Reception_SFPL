import { NextResponse } from 'next/server';
import { resolveZmccAuth, listChillerOwnerships, createChillerOwnership } from '@/backend/services/zmccMasterDataService';

export async function GET(req: Request) {
  const { auth, errorResponse } = await resolveZmccAuth(req, 'READ');
  if (errorResponse) {
    return NextResponse.json({ error: errorResponse.error }, { status: errorResponse.status });
  }

  const { searchParams } = new URL(req.url);
  const is_active = searchParams.get('is_active') || undefined;
  const search = searchParams.get('search') || undefined;

  try {
    const chiller_ownerships = await listChillerOwnerships(auth!, { is_active, search });
    return NextResponse.json({ chiller_ownerships });
  } catch (_err) {
    return NextResponse.json({ error: 'An unexpected error occurred while fetching chiller ownerships.' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const { auth, errorResponse } = await resolveZmccAuth(req, 'WRITE_CHILLER_OWNERSHIP');
  if (errorResponse) {
    return NextResponse.json({ error: errorResponse.error }, { status: errorResponse.status });
  }

  try {
    const body = await req.json();
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
    }

    const result = await createChillerOwnership(auth!, body);
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({ chiller_ownership: result.data }, { status: result.status });
  } catch (_err) {
    return NextResponse.json({ error: 'An unexpected error occurred while creating chiller ownership.' }, { status: 500 });
  }
}
