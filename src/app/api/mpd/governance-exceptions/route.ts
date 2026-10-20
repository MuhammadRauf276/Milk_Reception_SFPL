import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/backend/core/auth';
import { prisma } from '@/backend/core/db';
import { getErrorMessage } from '@/lib/errors';
import { listGovernanceOverrides, recordGovernanceAudit } from '@/backend/services/mpdExecutiveService';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const current = await getCurrentUser(req);
    if (!current) {
      return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { id: BigInt(current.id) },
    });

    if (!user?.is_active) {
      return NextResponse.json({ error: 'User account inactive.' }, { status: 403 });
    }

    return NextResponse.json({ success: true, items: await listGovernanceOverrides() });
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error) || 'Failed to fetch governance exceptions.' },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const current = await getCurrentUser(req);
    if (!current) {
      return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { id: BigInt(current.id) },
    });

    if (!user?.is_active || (user.role !== 'HEAD_OF_MPD' && user.role !== 'SUPER_ADMIN' && user.role !== 'QA_HEAD')) {
      return NextResponse.json(
        { error: 'Forbidden. Only MPD Head, QA Head, or Super Admin can audit governance exceptions.' },
        { status: 403 }
      );
    }

    const body = await req.json();
    const { exceptionId, action, remarks } = body;

    if (!exceptionId || !['APPROVED', 'FLAGGED'].includes(action)) {
      return NextResponse.json({ error: 'Invalid action or exceptionId.' }, { status: 400 });
    }

    const trimmedRemarks = typeof remarks === 'string' && remarks.trim() ? remarks.trim() : null;
    const result = await recordGovernanceAudit({
      overrideId: String(exceptionId),
      action,
      remarks: trimmedRemarks,
      userId: user.id,
      actorRole: user.role,
    });
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({
      success: true,
      message: `Override ${exceptionId} has been marked as ${action}.`,
      auditedBy: user.username,
      auditedAt: result.auditedAt,
      remarks: trimmedRemarks ?? '',
    });
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error) || 'Failed to audit governance exception.' },
      { status: 500 }
    );
  }
}
