import { NextResponse } from 'next/server';
import { getZmccTankById, updateZmccTank, toggleZmccTankActive } from '@/backend/services/zmccTankService';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const result = await getZmccTankById(req, id);
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json(result.data, { status: result.status });
  } catch (err: any) {
    console.error('GET /api/zmcc/tanks/[id] error:', err);
    return NextResponse.json({ error: 'Failed to fetch ZMCC tank.' }, { status: 500 });
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json();
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
    }

    if (body.is_active !== undefined && typeof body.is_active === 'boolean') {
      const result = await toggleZmccTankActive(req, id, body.is_active);
      if (result.error) {
        return NextResponse.json({ error: result.error }, { status: result.status });
      }
      return NextResponse.json(result.data, { status: result.status });
    }

    const result = await updateZmccTank(req, id, body);
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json(result.data, { status: result.status });
  } catch (err: any) {
    console.error('PATCH /api/zmcc/tanks/[id] error:', err);
    return NextResponse.json({ error: 'Failed to update ZMCC tank.' }, { status: 500 });
  }
}
