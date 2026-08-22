import { NextResponse } from 'next/server';

export async function PATCH() {
  return NextResponse.json(
    { error: 'Legacy PATCH /api/logs/[id] is deprecated. Use departmental APIs for state transitions.' },
    { status: 405 }
  );
}

