import { NextResponse } from 'next/server';
import { rejectHcSupplier } from '@/backend/services/zmccLocalSupplierService';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await req.json().catch(() => null);
    const reason = typeof body?.reason === 'string' ? body.reason : '';
    const result = await rejectHcSupplier(req, id, reason);
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json({ supplier: result.data }, { status: result.status });
  } catch (err: unknown) {
    console.error('POST /api/zmcc/hc-suppliers/[id]/reject error:', err);
    return NextResponse.json({ error: 'Could not reject this HC.' }, { status: 500 });
  }
}
