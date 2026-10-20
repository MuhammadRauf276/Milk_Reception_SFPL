import { NextResponse } from 'next/server';
import { listPendingLocalSuppliers } from '@/backend/services/zmccLocalSupplierService';

export async function GET(req: Request) {
  try {
    const result = await listPendingLocalSuppliers(req);
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json({ suppliers: result.data });
  } catch (err: unknown) {
    console.error('GET /api/zmcc/local-suppliers/pending error:', err);
    return NextResponse.json({ error: 'Could not load HCs waiting for approval.' }, { status: 500 });
  }
}
