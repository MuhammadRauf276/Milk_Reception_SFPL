import { NextResponse } from 'next/server';
import { getTankTransactions } from '@/backend/services/zmccTankService';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(req.url);
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get('pageSize') || '20', 10)));

    const result = await getTankTransactions(req, id, page, pageSize);
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json(result.data, { status: result.status });
  } catch (err) {
    console.error('GET /api/super-admin/zmcc-tanks/[id]/transactions error:', err);
    return NextResponse.json({ error: 'Failed to fetch ZMCC tank transactions.' }, { status: 500 });
  }
}
