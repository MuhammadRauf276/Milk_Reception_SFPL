import { NextResponse } from 'next/server';
import { listZmccTanks, createZmccTank } from '@/backend/services/zmccTankService';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const zmccId = searchParams.get('zmcc_id') || undefined;
    const activeOnly = searchParams.get('active_only') === 'true';

    const result = await listZmccTanks(req, zmccId, activeOnly);
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json(result.data, { status: result.status });
  } catch (err: any) {
    console.error('GET /api/zmcc/tanks error:', err);
    return NextResponse.json({ error: 'Failed to fetch ZMCC tanks.' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
    }

    const result = await createZmccTank(req, body);
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json(result.data, { status: result.status });
  } catch (err: any) {
    console.error('POST /api/zmcc/tanks error:', err);
    return NextResponse.json({ error: 'Failed to create ZMCC tank.' }, { status: 500 });
  }
}
