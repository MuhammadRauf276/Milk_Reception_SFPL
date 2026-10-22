import { NextResponse } from 'next/server';
import { listPendingHcSuppliers } from '@/backend/services/zmccLocalSupplierService';

export async function GET(req: Request) {
  try {
    const result = await listPendingHcSuppliers(req);
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json({ suppliers: result.data });
  } catch (err: unknown) {
    console.error('GET /api/zmcc/hc-suppliers/pending error:', err);
    return NextResponse.json({ error: 'Could not load HCs waiting for approval.' }, { status: 500 });
  }
}
