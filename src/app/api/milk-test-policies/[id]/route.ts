import { NextResponse } from 'next/server';
import { getCurrentUser } from '@core/auth';
import {
  MilkTestPolicyService,
  ValidationError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
} from '@/backend/services/milkTestPolicyService';

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authUser = await getCurrentUser(req);
  if (!authUser) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  const { id } = await params;

  try {
    let body: any;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON request body.' }, { status: 400 });
    }

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'Request body must be a plain object.' }, { status: 400 });
    }

    const { isRequired, displayOrder, isActive } = body;

    const updated = await MilkTestPolicyService.updatePolicyAssignment(authUser, id, {
      isRequired: isRequired !== undefined ? Boolean(isRequired) : undefined,
      displayOrder: displayOrder !== undefined ? Number(displayOrder) : undefined,
      isActive: isActive !== undefined ? Boolean(isActive) : undefined,
    });

    return NextResponse.json({ policy: updated }, { status: 200 });
  } catch (err: any) {
    if (err instanceof ValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    if (err instanceof NotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    if (err instanceof ConflictError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    console.error('[API_MILK_TEST_POLICIES_PATCH_ERROR]', err);
    return NextResponse.json({ error: err.message || 'Failed to update milk test policy.' }, { status: 500 });
  }
}
