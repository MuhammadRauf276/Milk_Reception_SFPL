import { NextResponse } from 'next/server';
import { getVehiclesInsideZmcc } from '@/backend/services/zmccArrivalService';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const zmcc_id = searchParams.get('zmcc_id') || undefined;
    const limit = searchParams.get('limit') || undefined;

    const result = await getVehiclesInsideZmcc(req, zmcc_id, limit);
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json(result.data, { status: result.status });
  } catch (err: any) {
    console.error('GET /api/zmcc/arrivals/inside error:', err);
    return NextResponse.json(
      { error: 'Failed to fetch vehicles inside ZMCC.' },
      { status: 500 }
    );
  }
}
