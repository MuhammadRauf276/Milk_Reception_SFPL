import { NextResponse } from 'next/server';
import { resolveZmccAuth, listShops, createShop } from '@/backend/services/zmccMasterDataService';

export async function GET(req: Request) {
  const { auth, errorResponse } = await resolveZmccAuth(req, 'READ');
  if (errorResponse) {
    return NextResponse.json({ error: errorResponse.error }, { status: errorResponse.status });
  }

  const { searchParams } = new URL(req.url);
  const route_id = searchParams.get('route_id') || undefined;
  const area_id = searchParams.get('area_id') || undefined;
  const milk_source_id = searchParams.get('milk_source_id') || undefined;
  const chiller_ownership_id = searchParams.get('chiller_ownership_id') || undefined;
  const is_active = searchParams.get('is_active') || undefined;
  const search = searchParams.get('search') || undefined;
  const zmcc_id = searchParams.get('zmcc_id') || undefined;

  try {
    const shops = await listShops(auth!, {
      route_id,
      area_id,
      milk_source_id,
      chiller_ownership_id,
      is_active,
      search,
      zmcc_id,
    });
    return NextResponse.json({ shops });
  } catch (_err) {
    return NextResponse.json({ error: 'An unexpected error occurred while fetching shops.' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const { auth, errorResponse } = await resolveZmccAuth(req, 'WRITE_SHOP');
  if (errorResponse) {
    return NextResponse.json({ error: errorResponse.error }, { status: errorResponse.status });
  }

  try {
    const body = await req.json();
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
    }

    const result = await createShop(auth!, body);
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({ shop: result.data }, { status: result.status });
  } catch (_err) {
    return NextResponse.json({ error: 'An unexpected error occurred while creating shop.' }, { status: 500 });
  }
}
