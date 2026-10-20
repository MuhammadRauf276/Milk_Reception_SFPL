import { NextResponse } from 'next/server';
import { requestNewLabSource } from '@/backend/services/zmccLabService';

/** Body: { source_name, phone?, notes?, arrival_id? } - lab attendant asks the Zonal Manager to add a new source. */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
    const result = await requestNewLabSource(req, body);
    if (result.error) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result.data, { status: result.status });
  } catch (err) {
    console.error('POST /api/zmcc/lab/source-requests error:', err);
    return NextResponse.json({ error: 'Failed to send the request.' }, { status: 500 });
  }
}
