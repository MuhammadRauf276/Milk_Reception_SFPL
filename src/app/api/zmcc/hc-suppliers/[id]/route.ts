import { NextResponse } from 'next/server';
import {
  getHcSupplierById,
  updateHcSupplier,
} from '@/backend/services/zmccLocalSupplierService';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(req: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const result = await getHcSupplierById(req, id);
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json({ supplier: result.data });
  } catch (err: unknown) {
    console.error('GET /api/zmcc/hc-suppliers/[id] error:', err);
    return NextResponse.json(
      { error: 'An unexpected error occurred while fetching HC supplier.' },
      { status: 500 }
    );
  }
}

export async function PATCH(req: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const body = await req.json();
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
    }

    const result = await updateHcSupplier(req, id, body);
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({ supplier: result.data }, { status: result.status });
  } catch (err: unknown) {
    console.error('PATCH /api/zmcc/hc-suppliers/[id] error:', err);
    return NextResponse.json(
      { error: 'An unexpected error occurred while updating HC supplier.' },
      { status: 500 }
    );
  }
}
