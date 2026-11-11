import { NextResponse } from 'next/server';
import { correctShopCollection } from '@/backend/services/motService';
import { requireDirectEditAuthority } from '@/backend/core/route-guards';

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireDirectEditAuthority(req);
  if ('response' in guard) return guard.response;
  try {
    const { id } = await params;
    const body = await req.json();
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
    }

    const result = await correctShopCollection(req, id, body);
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json(result.data, { status: result.status });
  } catch (err) {
    console.error('PATCH /api/zmcc/mot/collections/[id]/correction error:', err);
    return NextResponse.json({ error: 'Failed to correct shop collection.' }, { status: 500 });
  }
}

export async function POST(
  req: Request,
  props: { params: Promise<{ id: string }> }
) {
  return PATCH(req, props);
}
