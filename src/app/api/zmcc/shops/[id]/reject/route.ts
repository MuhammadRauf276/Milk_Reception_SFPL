import { NextResponse } from 'next/server';
import { resolveZmccAuth, rejectShop } from '@/backend/services/zmccMasterDataService';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { auth, errorResponse } = await resolveZmccAuth(req, 'APPROVE_SHOP');
  if (errorResponse) {
    return NextResponse.json({ error: errorResponse.error }, { status: errorResponse.status });
  }

  const { id } = await params;
  if (!id || !/^\d+$/.test(id)) {
    return NextResponse.json({ error: 'Invalid shop ID.' }, { status: 400 });
  }

  try {
    const body = await req.json();
    const reason = body?.reason;
    if (!reason || typeof reason !== 'string' || !reason.trim()) {
      return NextResponse.json({ error: 'Rejection reason is required.' }, { status: 400 });
    }

    const result = await rejectShop(auth!, BigInt(id), reason.trim());
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({ shop: result.data }, { status: result.status });
  } catch (_err) {
    return NextResponse.json({ error: 'An unexpected error occurred while rejecting shop.' }, { status: 500 });
  }
}
