import { NextResponse } from 'next/server';
import {
  getLocalSupplierById,
  updateLocalSupplier,
} from '@/backend/services/zmccLocalSupplierService';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(req: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const result = await getLocalSupplierById(req, id);
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json({ supplier: result.data });
  } catch (err: any) {
    console.error('GET /api/zmcc/local-suppliers/[id] error:', err);
    return NextResponse.json(
      { error: 'An unexpected error occurred while fetching local supplier.' },
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

    const result = await updateLocalSupplier(req, id, body);
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({ supplier: result.data }, { status: result.status });
  } catch (err: any) {
    console.error('PATCH /api/zmcc/local-suppliers/[id] error:', err);
    return NextResponse.json(
      { error: 'An unexpected error occurred while updating local supplier.' },
      { status: 500 }
    );
  }
}
