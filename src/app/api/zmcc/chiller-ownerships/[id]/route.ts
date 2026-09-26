import { NextResponse } from 'next/server';
import { resolveZmccAuth, getChillerOwnershipById, updateChillerOwnership } from '@/backend/services/zmccMasterDataService';

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
    return NextResponse.json({ error: 'Invalid chiller ownership ID.' }, { status: 400 });
  }

  try {
    const chiller_ownership = await getChillerOwnershipById(auth!, BigInt(id));
    if (!chiller_ownership) {
      return NextResponse.json({ error: 'Chiller ownership not found.' }, { status: 404 });
    }

    return NextResponse.json({ chiller_ownership });
  } catch (_err) {
    return NextResponse.json({ error: 'An unexpected error occurred while fetching chiller ownership.' }, { status: 500 });
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { auth, errorResponse } = await resolveZmccAuth(req, 'WRITE_CHILLER_OWNERSHIP');
  if (errorResponse) {
    return NextResponse.json({ error: errorResponse.error }, { status: errorResponse.status });
  }

  const { id } = await params;
  if (!id || !/^\d+$/.test(id)) {
    return NextResponse.json({ error: 'Invalid chiller ownership ID.' }, { status: 400 });
  }

  try {
    const body = await req.json();
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
    }

    const result = await updateChillerOwnership(auth!, BigInt(id), body);
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({ chiller_ownership: result.data }, { status: result.status });
  } catch (_err) {
    return NextResponse.json({ error: 'An unexpected error occurred while updating chiller ownership.' }, { status: 500 });
  }
}
