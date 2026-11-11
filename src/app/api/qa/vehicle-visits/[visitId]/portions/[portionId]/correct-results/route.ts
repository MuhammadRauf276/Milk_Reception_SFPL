import { NextResponse } from 'next/server';
import { requireDirectEditAuthority } from '@core/route-guards';
import { correctPlantQaResults } from '@/backend/services/corrections/plantQaCorrection';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ visitId: string; portionId: string }> }
) {
  // Changing a saved record directly is for the Super Admin only (never delegated). A Data Executive works from tickets.
  const guard = await requireDirectEditAuthority(req);
  if ('response' in guard) return guard.response;

  const { visitId, portionId } = await params;
  const body = await req.json().catch(() => null);
  const result = await correctPlantQaResults(guard.user, visitId, portionId, body);
  return NextResponse.json(result.body, { status: result.status });
}

export async function PATCH(
  req: Request,
  props: { params: Promise<{ visitId: string; portionId: string }> }
) {
  return POST(req, props);
}
