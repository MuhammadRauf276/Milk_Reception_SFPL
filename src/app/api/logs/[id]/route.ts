import { NextRequest, NextResponse } from 'next/server';
import { updateLog } from '@backend/core/db';
import { getCurrentUser, filterUpdatesByRole } from '@backend/core/auth';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const resolvedParams = await params;
    const id = parseInt(resolvedParams.id, 10);
    if (isNaN(id)) {
      return NextResponse.json({ error: 'Invalid ID' }, { status: 400 });
    }

    const body = await req.json();
    const currentUser = await getCurrentUser();

    if (!currentUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const sanitizedUpdates = filterUpdatesByRole(currentUser.role, body);
    const updated = await updateLog(id, sanitizedUpdates, currentUser);

    if (!updated) {
      return NextResponse.json({ error: 'Log not found or update blocked' }, { status: 404 });
    }

    return NextResponse.json({ success: true, log: updated });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Update failed' },
      { status: 500 }
    );
  }
}
