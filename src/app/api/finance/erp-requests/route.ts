import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/backend/core/auth';
import { prisma } from '@/backend/core/db';
import { listErpCodeRequests, reviewErpCodeRequest } from '@/backend/services/financeMasterDataService';

const ALLOWED_ROLES = ['FINANCE_ACCOUNTS', 'SUPER_ADMIN', 'DATA_EXECUTIVE', 'HEAD_OF_MPD', 'EXECUTIVE_MANAGEMENT'];

export async function GET(req: Request) {
  const user = await getCurrentUser(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const status = searchParams.get('status') || undefined;

  try {
    const requests = await listErpCodeRequests(status);
    return NextResponse.json({ requests }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to list ERP requests.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const user = await getCurrentUser(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  const actor = await prisma.user.findUnique({ where: { id: BigInt(user.id) } });
  if (!actor || !ALLOWED_ROLES.includes(actor.role)) {
    return NextResponse.json({ error: 'Forbidden. Finance or Admin access required.' }, { status: 403 });
  }

  try {
    const body = await req.json();
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
    }

    const { request_id, action, notes, erp_code, zmcc_ids } = body;
    if (!request_id) {
      return NextResponse.json({ error: 'request_id is required.' }, { status: 400 });
    }
    if (action !== 'APPROVE' && action !== 'REJECT') {
      return NextResponse.json({ error: 'action must be APPROVE or REJECT.' }, { status: 400 });
    }

    const result = await reviewErpCodeRequest(actor.id, request_id, {
      action,
      notes,
      erp_code,
      zmcc_ids,
    });

    return NextResponse.json({ result });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to review ERP request.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
