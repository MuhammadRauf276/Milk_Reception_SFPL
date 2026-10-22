import { NextResponse } from 'next/server';
import { resolveZmccAuth, listShopsPage, createShop } from '@/backend/services/zmccMasterDataService';

export async function GET(req: Request) {
  const { auth, errorResponse } = await resolveZmccAuth(req, 'READ');
  if (errorResponse) {
    return NextResponse.json({ error: errorResponse.error }, { status: errorResponse.status });
  }

  const { searchParams } = new URL(req.url);
  const route_id = searchParams.get('route_id') || undefined;
  const area_id = searchParams.get('area_id') || undefined;
  const chiller_ownership_id = searchParams.get('chiller_ownership_id') || undefined;
  const is_active = searchParams.get('is_active') || undefined;
  const search = searchParams.get('search') || undefined;
  const zmcc_id = searchParams.get('zmcc_id') || undefined;

  const pageParam = searchParams.get('page');
  const pageSizeParam = searchParams.get('page_size') || searchParams.get('pageSize');
  const page = pageParam ? Math.max(1, parseInt(pageParam, 10) || 1) : undefined;
  const page_size = pageSizeParam ? parseInt(pageSizeParam, 10) || undefined : undefined;

  try {
    const { shops, pagination } = await listShopsPage(auth!, {
      route_id,
      area_id,
      chiller_ownership_id,
      is_active,
      search,
      zmcc_id,
      page,
      page_size,
    });
    // Without `page` the response keeps its original shape.
    return NextResponse.json(pagination ? { shops, pagination } : { shops });
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
