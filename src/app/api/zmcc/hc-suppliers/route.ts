import { NextResponse } from 'next/server';
import {
  getHcSuppliers,
  createHcSupplier,
  getIncompleteHcSuppliers,
} from '@/backend/services/zmccLocalSupplierService';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const search = searchParams.get('search') || searchParams.get('query') || undefined;
    const zmcc_id = searchParams.get('zmcc_id') || undefined;
    const is_active = searchParams.get('is_active') ?? undefined;

    const pageParam = searchParams.get('page');
    const pageSizeParam = searchParams.get('page_size') || searchParams.get('pageSize');
    const page = pageParam ? Math.max(1, parseInt(pageParam, 10) || 1) : undefined;
    const page_size = pageSizeParam ? parseInt(pageSizeParam, 10) || undefined : undefined;

    const incompleteOnly = searchParams.get('incomplete') === 'true';
    const result = incompleteOnly ? await getIncompleteHcSuppliers(req) : await getHcSuppliers(req, {
      search,
      zmcc_id,
      is_active,
      approval_status: searchParams.get('approval_status') || undefined,
      page,
      page_size,
    });

    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json(
      result.pagination ? { suppliers: result.data, pagination: result.pagination } : { suppliers: result.data }
    );
  } catch (err: unknown) {
    console.error('GET /api/zmcc/hc-suppliers error:', err);
    return NextResponse.json(
      { error: 'An unexpected error occurred while fetching HC suppliers.' },
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

    const result = await createHcSupplier(req, body);
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({ supplier: result.data }, { status: result.status });
  } catch (err: unknown) {
    console.error('POST /api/zmcc/hc-suppliers error:', err);
    return NextResponse.json(
      { error: 'An unexpected error occurred while creating HC supplier.' },
      { status: 500 }
    );
  }
}
