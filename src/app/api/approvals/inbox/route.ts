import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/backend/core/auth';
import { prisma } from '@/backend/core/db';
import {
  getApprovalInbox,
  type ApprovalInboxQueryOptions,
} from '@/backend/services/approvals/approvalInboxService';
import type { OperationalStage, ApprovalType } from '@/backend/services/escalation/approvalMatrix';

export async function GET(req: Request) {
  const authUser = await getCurrentUser(req);
  if (!authUser) {
    return NextResponse.json({ error: 'Unauthorized. Authentication required.' }, { status: 401 });
  }

  const dbUser = await prisma.user.findFirst({
    where: {
      OR: [
        { id: authUser.id ? BigInt(authUser.id) : undefined },
        { username: authUser.username },
      ],
      is_active: true,
    },
  });

  if (!dbUser) {
    return NextResponse.json({ error: 'User account not found or inactive.' }, { status: 403 });
  }

  const url = new URL(req.url);
  const statusParam = url.searchParams.get('status')?.toUpperCase();
  const stageParam = url.searchParams.get('stage')?.toUpperCase();
  const typeParam = url.searchParams.get('type');
  const sourceTypeParam = url.searchParams.get('sourceType')?.toUpperCase();
  const limitParam = url.searchParams.get('limit');

  const options: ApprovalInboxQueryOptions = {
    status:
      statusParam === 'DECIDED' || statusParam === 'ALL'
        ? (statusParam as 'DECIDED' | 'ALL')
        : 'PENDING',
    stage:
      stageParam === 'STAGE_1' || stageParam === 'STAGE_2' || stageParam === 'STAGE_3' || stageParam === 'STAGE_4'
        ? (stageParam as OperationalStage)
        : 'ALL',
    type: typeParam ? (typeParam as ApprovalType) : undefined,
    sourceType:
      sourceTypeParam === 'ZMCC' || sourceTypeParam === 'CONTRACTOR' || sourceTypeParam === 'PLANT'
        ? (sourceTypeParam as 'ZMCC' | 'CONTRACTOR' | 'PLANT')
        : undefined,
    limit: limitParam ? parseInt(limitParam, 10) : 50,
  };

  try {
    const inbox = await getApprovalInbox(
      {
        id: dbUser.id,
        role: dbUser.role,
        procurementSourceId: dbUser.procurement_source_id,
      },
      options
    );

    return NextResponse.json(inbox, { status: 200 });
  } catch (err: unknown) {
    console.error('GET /api/approvals/inbox error:', err);
    const errorMessage = err instanceof Error ? err.message : 'Failed to fetch approval inbox.';
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}
