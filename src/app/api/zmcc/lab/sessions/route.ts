import { NextResponse } from 'next/server';
import { startOrResumeSession } from '@/backend/services/zmccLabService';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
    }

    const result = await startOrResumeSession(req, body);
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json(result.data, { status: result.status });
  } catch (err: any) {
    console.error('POST /api/zmcc/lab/sessions error:', err);
    return NextResponse.json({ error: 'Failed to start or resume lab session.' }, { status: 500 });
  }
}
