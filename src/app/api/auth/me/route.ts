import { NextResponse } from 'next/server';
import { getCurrentUser } from '@core/auth';

export async function GET() {
  const user = await getCurrentUser();
  return NextResponse.json({ user });
}
