import { NextResponse } from 'next/server';
import { getArrivalsQueue } from '@/backend/services/zmccLabService';

export async function GET(req: Request) {
  try {
    const result = await getArrivalsQueue(req);
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json(result.data, {
      status: result.status,
      headers: {
        'Cache-Control': 'private, no-store, max-age=0',
      },
    });
  } catch (err: any) {
    console.error('GET /api/zmcc/lab/queue error:', err);
    return NextResponse.json({ error: 'Failed to fetch arrivals queue.' }, { status: 500 });
  }
}
