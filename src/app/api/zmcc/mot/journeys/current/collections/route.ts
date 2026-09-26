import { NextResponse } from 'next/server';
import { submitShopCollection } from '@/backend/services/motService';

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const result = await submitShopCollection(req, body);
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json({ ...result.data, collection: result.data }, { status: result.status });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'An unexpected error occurred while submitting collection.' },
      { status: 500 }
    );
  }
}
