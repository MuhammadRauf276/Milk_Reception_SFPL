import { NextResponse } from 'next/server';
import { getSmsOutbox } from '@/backend/services/motService';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const journey_id = searchParams.get('journey_id') || undefined;
    const status = searchParams.get('status') || undefined;
    const limit = searchParams.get('limit') ? Number(searchParams.get('limit')) : undefined;
    const offset = searchParams.get('offset') ? Number(searchParams.get('offset')) : undefined;

    const result = await getSmsOutbox(req, { journey_id, status, limit, offset });
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json(result.data, { status: result.status });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'An unexpected error occurred while fetching SMS outbox.' },
      { status: 500 }
    );
  }
}
