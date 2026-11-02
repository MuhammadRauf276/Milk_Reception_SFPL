import { NextResponse } from 'next/server';
import { intakeZmccTankStock } from '@/backend/services/zmccTankService';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
    }

    const tankId = body.tank_id || body.tankId;
    if (!tankId) {
      return NextResponse.json({ error: 'Tank ID is required.' }, { status: 400 });
    }

    const result = await intakeZmccTankStock(req, tankId, body);
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json(result.data, { status: result.status });
  } catch (err) {
    console.error('POST /api/super-admin/zmcc-tanks/intake error:', err);
    return NextResponse.json({ error: 'Failed to record ZMCC tank stock intake.' }, { status: 500 });
  }
}
