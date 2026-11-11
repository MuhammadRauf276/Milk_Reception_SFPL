import { NextResponse } from 'next/server';
import { requireDirectEditAuthority } from '@core/route-guards';
import { correctDispatchVisit } from '@/backend/services/corrections/dispatchCorrection';

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  // Changing a saved record directly is for the Super Admin only (never delegated). A Data Executive works from tickets.
  const guard = await requireDirectEditAuthority(req);
  if ('response' in guard) return guard.response;

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const headerKey = req.headers.get('Idempotency-Key') || req.headers.get('idempotency-key');
  const result = await correctDispatchVisit(guard.user, id, body, headerKey);
  return NextResponse.json(result.body, { status: result.status });
}

export async function POST(
  req: Request,
  props: { params: Promise<{ id: string }> }
) {
  return PATCH(req, props);
}
