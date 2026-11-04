import { NextResponse } from 'next/server';
import { listPendingVehicleChanges } from '@/backend/services/motService';

export async function GET(req: Request) {
  try {
    const zmccId = new URL(req.url).searchParams.get('zmcc_id');
    const result = await listPendingVehicleChanges(req, { zmccId });
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json(result.data, { status: result.status });
  } catch (err) {
    console.error('GET /api/zmcc/mot/vehicle-requests error:', err);
    return NextResponse.json({ error: 'Failed to load vehicle requests.' }, { status: 500 });
  }
}
