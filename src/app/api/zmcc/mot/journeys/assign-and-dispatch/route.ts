import { NextResponse } from 'next/server';
import { resolveMotAuth, assignAndDispatchJourney } from '@/backend/services/motService';

export async function POST(req: Request) {
  const { auth, errorResponse } = await resolveMotAuth(req, 'ASSIGN_DISPATCH');
  if (errorResponse) {
    return NextResponse.json({ error: errorResponse.error }, { status: errorResponse.status });
  }

  try {
    const body = await req.json();
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
    }

    const result = await assignAndDispatchJourney(auth!, body);
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({ journey: result.data }, { status: result.status });
  } catch (err: any) {
    console.error('DISPATCH ERROR:', err);
    return NextResponse.json({ error: err?.message || 'An unexpected error occurred while dispatching journey.' }, { status: 500 });
  }
}
