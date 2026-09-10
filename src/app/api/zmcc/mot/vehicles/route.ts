import { NextResponse } from 'next/server';
import { resolveMotAuth, listMotVehicles, createMotVehicle } from '@/backend/services/motService';

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
    const vehicles = await listMotVehicles(auth!, { is_active, search, zmcc_id });
    return NextResponse.json({ vehicles });
  } catch (_err) {
    return NextResponse.json({ error: 'An unexpected error occurred while fetching MOT vehicles.' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const { auth, errorResponse } = await resolveMotAuth(req, 'WRITE_VEHICLE');
  if (errorResponse) {
    return NextResponse.json({ error: errorResponse.error }, { status: errorResponse.status });
  }

  try {
    const body = await req.json();
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
    }

    const result = await createMotVehicle(auth!, body);
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({ vehicle: result.data }, { status: result.status });
  } catch (_err) {
    return NextResponse.json({ error: 'An unexpected error occurred while creating MOT vehicle.' }, { status: 500 });
  }
}
