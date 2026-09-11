import { NextResponse } from 'next/server';
import { getCurrentUser } from '@core/auth';
import {
  MilkTestPolicyService,
  ValidationError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
} from '@/backend/services/milkTestPolicyService';

export async function GET(req: Request) {
  const authUser = await getCurrentUser(req);
  if (!authUser) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const testingPoint = searchParams.get('testingPoint') || searchParams.get('testing_point') || undefined;
    const isActiveRaw = searchParams.get('isActive') || searchParams.get('is_active');
    const effective = searchParams.get('effective');

    if (effective === 'true') {
      if (!testingPoint) {
        return NextResponse.json(
          { error: 'Query parameter "testingPoint" is required when effective=true.' },
          { status: 400 }
        );
      }
      const tests = await MilkTestPolicyService.getEffectivePolicy(testingPoint);
      return NextResponse.json({ policies: tests });
    }

    const isActive = isActiveRaw === 'true' ? true : isActiveRaw === 'false' ? false : undefined;
    const assignments = await MilkTestPolicyService.getAllPolicies({
      testingPoint,
      isActive,
    });

    return NextResponse.json({ policies: assignments });
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
    console.error('[API_MILK_TEST_POLICIES_GET_ERROR]', err);
    return NextResponse.json({ error: err.message || 'Failed to retrieve milk test policies.' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const authUser = await getCurrentUser(req);
  if (!authUser) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

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

    const { labTestId, testingPoint, isRequired, displayOrder } = body;

    if (labTestId === undefined || labTestId === null || String(labTestId).trim() === '') {
      return NextResponse.json({ error: 'labTestId is required.' }, { status: 400 });
    }

    if (!testingPoint || typeof testingPoint !== 'string' || !testingPoint.trim()) {
      return NextResponse.json({ error: 'testingPoint is required.' }, { status: 400 });
    }

    const created = await MilkTestPolicyService.createPolicyAssignment(authUser, {
      labTestId,
      testingPoint: testingPoint.trim(),
      isRequired: isRequired !== undefined ? Boolean(isRequired) : undefined,
      displayOrder: displayOrder !== undefined ? Number(displayOrder) : undefined,
    });

    return NextResponse.json({ policy: created }, { status: 201 });
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
    console.error('[API_MILK_TEST_POLICIES_POST_ERROR]', err);
    return NextResponse.json({ error: err.message || 'Failed to create milk test policy.' }, { status: 500 });
  }
}
