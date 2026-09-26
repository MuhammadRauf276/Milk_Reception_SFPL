import { NextResponse } from 'next/server';
import { receiveHistoricalSession } from '@/backend/services/zmccTankService';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    let body: any = {};
    try {
      body = await req.json();
    } catch {
      // Empty body allowed
    }

    const result = await receiveHistoricalSession(req, id, body);
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json(result.data, { status: result.status });
  } catch (err: any) {
    console.error('POST /api/zmcc/lab/sessions/[id]/receive error:', err);
    return NextResponse.json({ error: 'Failed to receive historical session into ZMCC tank.' }, { status: 500 });
  }
}
