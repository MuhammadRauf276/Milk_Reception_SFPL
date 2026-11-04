import { NextResponse } from 'next/server';
import { decideVehicleChange } from '@/backend/services/motService';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await req.json().catch(() => null);
    const result = await decideVehicleChange(req, id, body ?? {});
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json(result.data, { status: result.status });
  } catch (err) {
    console.error('POST /api/zmcc/mot/vehicle-requests/[id] error:', err);
    return NextResponse.json({ error: 'Failed to save the decision.' }, { status: 500 });
  }
}
