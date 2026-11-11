import { NextResponse } from 'next/server';
import { requireDirectEditAuthority } from '@/backend/core/route-guards';
import { correctDispatchPortionTests } from '@/backend/services/corrections/dispatchPortionCorrection';

/** Correct one dispatch portion's test values. Super Admin only. */
export async function PATCH(req: Request) {
  const guard = await requireDirectEditAuthority(req);
  if ('response' in guard) return guard.response;
  const result = await correctDispatchPortionTests(guard.user, await req.json().catch(() => null));
  return NextResponse.json(result.body, { status: result.status });
}
