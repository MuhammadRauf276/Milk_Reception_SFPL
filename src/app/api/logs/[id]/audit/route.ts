import { NextRequest, NextResponse } from 'next/server';
import { getAuditLogsForLog, revertLogField } from '@backend/core/db';
import { getCurrentUser } from '@backend/core/auth';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const resolvedParams = await params;
    const id = parseInt(resolvedParams.id, 10);
    if (isNaN(id)) {
      return NextResponse.json({ error: 'Invalid ID' }, { status: 400 });
    }

    const auditLogs = await getAuditLogsForLog(id);
    return NextResponse.json({ success: true, auditLogs });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch audit logs' },
      { status: 500 }
    );
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const resolvedParams = await params;
    const id = parseInt(resolvedParams.id, 10);
    if (isNaN(id)) {
      return NextResponse.json({ error: 'Invalid ID' }, { status: 400 });
    }

    const currentUser = await getCurrentUser();
    if (!currentUser || (currentUser.role !== 'Admin' && currentUser.role !== 'Correction_Officer')) {
      return NextResponse.json({ error: 'Unauthorized: Admin or Correction Officer privileges required for audit rollback' }, { status: 403 });
    }

    const body = await req.json();
    const { auditLogId } = body;

    if (!auditLogId) {
      return NextResponse.json({ error: 'auditLogId is required' }, { status: 400 });
    }

    const updatedLog = await revertLogField(id, Number(auditLogId), currentUser);

    if (!updatedLog) {
      return NextResponse.json({ error: 'Failed to revert audit log entry' }, { status: 400 });
    }

    return NextResponse.json({ success: true, log: updatedLog });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Revert failed' },
      { status: 500 }
    );
  }
}
