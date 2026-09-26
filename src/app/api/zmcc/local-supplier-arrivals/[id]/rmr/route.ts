import { NextResponse } from 'next/server';
import { issueLocalSupplierRmr } from '@/backend/services/zmccLabService';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await req.json();
    const result = await issueLocalSupplierRmr(req, id, body);
    if (result.error) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result.data, { status: result.status });
  } catch (error) {
    console.error('POST Local Supplier RMR error:', error);
    return NextResponse.json({ error: 'Failed to issue Local Supplier RMR.' }, { status: 500 });
  }
}
