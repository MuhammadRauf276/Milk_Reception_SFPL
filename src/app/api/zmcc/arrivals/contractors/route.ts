import { NextResponse } from 'next/server';
import { getActiveContractors } from '@/backend/services/zmccArrivalService';

export async function GET(req: Request) {
  try {
    const result = await getActiveContractors(req);
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json(result.data, { status: result.status });
  } catch (err: any) {
    console.error('GET /api/zmcc/arrivals/contractors error:', err);
    return NextResponse.json({ error: 'Failed to fetch active contractors.' }, { status: 500 });
  }
}
