import { NextResponse } from 'next/server';
import { requireRoles } from '@/backend/core/route-guards';
import { getPolicyMatrix, updatePolicyCells, PolicyValidationError, PolicyConflictError } from '@/backend/services/testPointPolicyService';
import type { PolicyChange } from '@/backend/services/testPointPolicyService';
import { TEST_POINT_LABELS } from '@/types/test-point-policy';

export const dynamic = 'force-dynamic';

// GET: SUPER_ADMIN (editable) and DATA_EXECUTIVE (read-only). Never delegated.
export async function GET(req: Request) {
  const guard = await requireRoles(req, ['SUPER_ADMIN', 'DATA_EXECUTIVE'], { delegation: 'none', requestedAs: null });
  if ('response' in guard) return guard.response;
  try {
    const matrix = await getPolicyMatrix(new Date());
    return NextResponse.json({
      points: matrix.points,
      labels: TEST_POINT_LABELS,
      cells: matrix.cells,
      canEdit: guard.acting.actorRole === 'SUPER_ADMIN',
    });
  } catch (error) {
    console.error('[test-point-policies] GET failed', error);
    return NextResponse.json({ error: 'Could not load the test matrix.' }, { status: 500 });
  }
}

// PUT: SUPER_ADMIN only. Body: { reason: string, changes: PolicyChange[] }
export async function PUT(req: Request) {
  const guard = await requireRoles(req, ['SUPER_ADMIN'], { delegation: 'none', requestedAs: null });
  if ('response' in guard) return guard.response;
  let body: { reason?: unknown; changes?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }
  if (typeof body.reason !== 'string' || !Array.isArray(body.changes)) {
    return NextResponse.json({ error: 'A reason and a list of changes are required.' }, { status: 400 });
  }
  try {
    const result = await updatePolicyCells(guard.acting, body.changes as PolicyChange[], body.reason);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof PolicyValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof PolicyConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error('[test-point-policies] PUT failed', error);
    return NextResponse.json({ error: 'Could not save the test matrix.' }, { status: 500 });
  }
}
