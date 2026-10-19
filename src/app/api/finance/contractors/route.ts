import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/backend/core/auth';
import { prisma } from '@/backend/core/db';
import { listContractors, updateContractorErpCode } from '@/backend/services/financeMasterDataService';

const ALLOWED_ROLES = ['FINANCE_ACCOUNTS', 'SUPER_ADMIN', 'DATA_EXECUTIVE', 'HEAD_OF_MPD', 'EXECUTIVE_MANAGEMENT'];

export async function GET(req: Request) {
  const user = await getCurrentUser(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  try {
    const contractors = await listContractors();
    return NextResponse.json({ contractors }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to list contractors.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
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

    const { contractor_source_id, erp_code } = body;
    if (!contractor_source_id) {
      return NextResponse.json({ error: 'contractor_source_id is required.' }, { status: 400 });
    }
    if (erp_code === undefined || erp_code === null) {
      return NextResponse.json({ error: 'erp_code is required.' }, { status: 400 });
    }

    const updated = await updateContractorErpCode(
      actor.id,
      contractor_source_id,
      String(erp_code)
    );

    return NextResponse.json({ contractor: updated });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to update contractor ERP code.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
