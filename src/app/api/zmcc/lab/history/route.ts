import { NextResponse } from 'next/server';
import { getLabHistory } from '@/backend/services/zmccLabService';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const date = searchParams.get('date') || undefined;
    const decision = searchParams.get('decision') || undefined;
    const search = searchParams.get('search') || undefined;
    const page = searchParams.get('page') ? Number(searchParams.get('page')) : undefined;
    const pageSize = searchParams.get('pageSize') ? Number(searchParams.get('pageSize')) : undefined;

    const result = await getLabHistory(req, { date, decision, search, page, pageSize });
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
    console.error('GET /api/zmcc/lab/history error:', err);
    return NextResponse.json({ error: 'Failed to fetch lab history.' }, { status: 500 });
  }
}
