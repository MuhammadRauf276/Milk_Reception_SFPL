import { NextResponse } from 'next/server';
import { resolveZmccAuth, approveRoute } from '@/backend/services/zmccMasterDataService';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { auth, errorResponse } = await resolveZmccAuth(req, 'WRITE_ROUTE');
  if (errorResponse) {
    return NextResponse.json({ error: errorResponse.error }, { status: errorResponse.status });
  }

  const { id } = await params;
  if (!id || !/^\d+$/.test(id)) {
    return NextResponse.json({ error: 'Invalid route ID.' }, { status: 400 });
  }

  try {
    const result = await approveRoute(auth!, BigInt(id));
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({ route: result.data }, { status: result.status });
  } catch (_err) {
    return NextResponse.json({ error: 'An unexpected error occurred while approving route.' }, { status: 500 });
  }
}
