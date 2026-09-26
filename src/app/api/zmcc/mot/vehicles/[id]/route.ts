import { NextResponse } from 'next/server';
import { resolveMotAuth, getMotVehicleById, updateMotVehicle } from '@/backend/services/motService';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { auth, errorResponse } = await resolveMotAuth(req, 'READ');
  if (errorResponse) {
    return NextResponse.json({ error: errorResponse.error }, { status: errorResponse.status });
  }

  const { id } = await params;
  try {
    const result = await getMotVehicleById(auth!, id);
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json({ vehicle: result.data });
  } catch (_err) {
    return NextResponse.json({ error: 'An unexpected error occurred while fetching MOT vehicle.' }, { status: 500 });
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { auth, errorResponse } = await resolveMotAuth(req, 'WRITE_VEHICLE');
  if (errorResponse) {
    return NextResponse.json({ error: errorResponse.error }, { status: errorResponse.status });
  }

  const { id } = await params;
  try {
    const body = await req.json();
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
    }

    const result = await updateMotVehicle(auth!, id, body);
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json({ vehicle: result.data }, { status: result.status });
  } catch (_err) {
    return NextResponse.json({ error: 'An unexpected error occurred while updating MOT vehicle.' }, { status: 500 });
  }
}
