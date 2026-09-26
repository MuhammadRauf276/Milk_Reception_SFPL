import { NextResponse } from 'next/server';
import { getJourneyCollections } from '@/backend/services/motService';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const result = await getJourneyCollections(req, id);
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json(result.data, { status: result.status });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'An unexpected error occurred while fetching journey collections.' },
      { status: 500 }
    );
  }
}
