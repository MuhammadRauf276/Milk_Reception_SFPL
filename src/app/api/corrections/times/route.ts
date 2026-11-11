import { NextResponse } from 'next/server';
import { requireDirectEditAuthority } from '@/backend/core/route-guards';
import { correctEventTimes } from '@/backend/services/corrections/eventTimeCorrection';

/** Correct gate and ZMCC exit times. Super Admin only. */
export async function PATCH(req: Request) {
  const guard = await requireDirectEditAuthority(req);
  if ('response' in guard) return guard.response;
  const result = await correctEventTimes(guard.user, await req.json().catch(() => null));
  return NextResponse.json(result.body, { status: result.status });
}
