import { NextResponse } from 'next/server';
import {
  getLocalSuppliers,
  createLocalSupplier,
} from '@/backend/services/zmccLocalSupplierService';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const search = searchParams.get('search') || searchParams.get('query') || undefined;
    const zmcc_id = searchParams.get('zmcc_id') || undefined;
    const is_active = searchParams.get('is_active') ?? undefined;

    const result = await getLocalSuppliers(req, {
      search,
      zmcc_id,
      is_active,
    });

    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({ suppliers: result.data });
  } catch (err: any) {
    console.error('GET /api/zmcc/local-suppliers error:', err);
    return NextResponse.json(
      { error: 'An unexpected error occurred while fetching local suppliers.' },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
    }

    const result = await createLocalSupplier(req, body);
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({ supplier: result.data }, { status: result.status });
  } catch (err: any) {
    console.error('POST /api/zmcc/local-suppliers error:', err);
    return NextResponse.json(
      { error: 'An unexpected error occurred while creating local supplier.' },
      { status: 500 }
    );
  }
}
