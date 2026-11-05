import { NextResponse } from 'next/server';
import { listHcReceiptWork } from '@/backend/services/zmccLabService';

export async function GET(req: Request) {
  try {
    const result = await listHcReceiptWork(req);
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json(result.data, { headers: { 'Cache-Control': 'private, no-store, max-age=0' } });
  } catch (err) {
    console.error('GET /api/zmcc/lab/hc-receipts error:', err);
    return NextResponse.json({ error: 'Failed to load HC receipts.' }, { status: 500 });
  }
}
