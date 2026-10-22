import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/backend/core/auth';
import { prisma } from '@/backend/core/db';
import { SOURCE_OWNER_ROLES } from '@/backend/services/milkSourceService';
import { updateErpSource } from '@/backend/services/financeMasterDataService';

/** Only MPD Head, Super Admin and Data Executive own milk sources and contractor ERP codes. */
const ALLOWED_ROLES: string[] = [...SOURCE_OWNER_ROLES];

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
    return NextResponse.json({ error: 'Forbidden. Milk source owner access required.' }, { status: 403 });
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
      erp_code: typeof body.erp_code === 'string' ? body.erp_code : undefined,
      is_active: body.is_active,
      zmcc_ids: body.zmcc_ids,
    }, actor.role);

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
