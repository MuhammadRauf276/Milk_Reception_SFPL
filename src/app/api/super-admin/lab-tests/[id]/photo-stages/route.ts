import { NextResponse } from 'next/server';
import { requireRoles } from '@/backend/core/route-guards';
import { getTestPhotoStages, setStagePhotoRequired, PolicyValidationError, PolicyConflictError } from '@/backend/services/testPointPolicyService';

export const dynamic = 'force-dynamic';

function failure(error: unknown, method: string) {
  if (error instanceof PolicyValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
  if (error instanceof PolicyConflictError) return NextResponse.json({ error: error.message }, { status: 409 });
  console.error(`[lab-tests/photo-stages] ${method} failed`, error);
  return NextResponse.json({ error: 'Could not read or save the photo rule.' }, { status: 500 });
}

// GET: which stages the test is on at, and each stage's photo mode, as of now.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireRoles(req, ['SUPER_ADMIN', 'DATA_EXECUTIVE'], { delegation: 'none', requestedAs: null });
  if ('response' in guard) return guard.response;
  const { id } = await params;
  try {
    return NextResponse.json(await getTestPhotoStages(id), { headers: { 'Cache-Control': 'private, no-store, max-age=0' } });
  } catch (error) {
    return failure(error, 'GET');
  }
}

// PUT: same roles as the test edit screen. Body: { changes: Array<{ point, photoRequired }> }, only the stages the user changed.
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireRoles(req, ['SUPER_ADMIN', 'DATA_EXECUTIVE'], { delegation: 'none', requestedAs: null });
  if ('response' in guard) return guard.response;
  const { id } = await params;
  let body: { changes?: unknown } | null;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }
  try {
    const result = await setStagePhotoRequired(guard.acting, id, body?.changes as Parameters<typeof setStagePhotoRequired>[2]);
    return NextResponse.json(result);
  } catch (error) {
    return failure(error, 'PUT');
  }
}
