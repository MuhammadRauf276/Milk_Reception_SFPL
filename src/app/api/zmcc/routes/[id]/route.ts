import { NextResponse } from 'next/server';
import { resolveZmccAuth, getRouteById, updateRoute } from '@/backend/services/zmccMasterDataService';

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
    return NextResponse.json({ error: 'Invalid route ID.' }, { status: 400 });
  }

  try {
    const route = await getRouteById(auth!, BigInt(id));
    if (!route) {
      return NextResponse.json({ error: 'Route not found.' }, { status: 404 });
    }

    return NextResponse.json({ route });
  } catch (_err) {
    return NextResponse.json({ error: 'An unexpected error occurred while fetching route.' }, { status: 500 });
  }
}

export async function PATCH(
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
    const body = await req.json();
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
    }

    const result = await updateRoute(auth!, BigInt(id), body);
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({ route: result.data }, { status: result.status });
  } catch (_err) {
    return NextResponse.json({ error: 'An unexpected error occurred while updating route.' }, { status: 500 });
  }
}
