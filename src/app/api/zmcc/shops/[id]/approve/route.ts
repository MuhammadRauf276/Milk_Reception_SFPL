import { NextResponse } from 'next/server';
import { resolveZmccAuth, approveShop } from '@/backend/services/zmccMasterDataService';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  // Dual approval: authorized for BOTH PHE_OPERATOR and ZMCC_MANAGER (and SUPER_ADMIN)
  const { auth, errorResponse } = await resolveZmccAuth(req, 'WRITE_SHOP');
  if (errorResponse) {
    return NextResponse.json({ error: errorResponse.error }, { status: errorResponse.status });
  }

  const { id } = await params;
  if (!id || !/^\d+$/.test(id)) {
    return NextResponse.json({ error: 'Invalid shop ID.' }, { status: 400 });
  }

  try {
    const result = await approveShop(auth!, BigInt(id));
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({ shop: result.data }, { status: result.status });
  } catch (_err) {
    return NextResponse.json({ error: 'An unexpected error occurred while approving shop.' }, { status: 500 });
  }
}
