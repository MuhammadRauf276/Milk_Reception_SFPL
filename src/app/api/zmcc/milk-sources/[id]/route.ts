import { NextResponse } from 'next/server';
import { resolveZmccAuth, getMilkSourceById, updateMilkSource } from '@/backend/services/zmccMasterDataService';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { auth, errorResponse } = await resolveZmccAuth(req, 'READ');
  if (errorResponse) {
    return NextResponse.json({ error: errorResponse.error }, { status: errorResponse.status });
  }

  const { id } = await params;
  if (!id || !/^\d+$/.test(id)) {
    return NextResponse.json({ error: 'Invalid milk source ID.' }, { status: 400 });
  }

  try {
    const milk_source = await getMilkSourceById(auth!, BigInt(id));
    if (!milk_source) {
      return NextResponse.json({ error: 'Milk source not found.' }, { status: 404 });
    }

    return NextResponse.json({ milk_source });
  } catch (_err) {
    return NextResponse.json({ error: 'An unexpected error occurred while fetching milk source.' }, { status: 500 });
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { auth, errorResponse } = await resolveZmccAuth(req, 'WRITE_MILK_SOURCE');
  if (errorResponse) {
    return NextResponse.json({ error: errorResponse.error }, { status: errorResponse.status });
  }

  const { id } = await params;
  if (!id || !/^\d+$/.test(id)) {
    return NextResponse.json({ error: 'Invalid milk source ID.' }, { status: 400 });
  }

  try {
    const body = await req.json();
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
    }

    const result = await updateMilkSource(auth!, BigInt(id), body);
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({ milk_source: result.data }, { status: result.status });
  } catch (_err) {
    return NextResponse.json({ error: 'An unexpected error occurred while updating milk source.' }, { status: 500 });
  }
}
