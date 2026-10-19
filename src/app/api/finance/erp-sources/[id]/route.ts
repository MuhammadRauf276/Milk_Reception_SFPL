import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/backend/core/auth';
import { prisma } from '@/backend/core/db';
import { updateErpSource } from '@/backend/services/financeMasterDataService';

const ALLOWED_ROLES = ['FINANCE_ACCOUNTS', 'SUPER_ADMIN', 'DATA_EXECUTIVE', 'HEAD_OF_MPD', 'EXECUTIVE_MANAGEMENT'];

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  const actor = await prisma.user.findUnique({ where: { id: BigInt(user.id) } });
  if (!actor || !ALLOWED_ROLES.includes(actor.role)) {
    return NextResponse.json({ error: 'Forbidden. Finance or Admin access required.' }, { status: 403 });
  }

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: 'ID is required.' }, { status: 400 });
  }

  try {
    const body = await req.json();
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
    }

    const updated = await updateErpSource(actor.id, id, {
      name: body.name,
      is_active: body.is_active,
      zmcc_ids: body.zmcc_ids,
    });

    return NextResponse.json({
      erp_source: {
        id: updated.id.toString(),
        erp_code: updated.erp_code,
        name: updated.name,
        is_active: updated.is_active,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to update ERP source.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
