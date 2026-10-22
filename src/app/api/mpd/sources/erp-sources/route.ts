import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/backend/core/auth';
import { prisma } from '@/backend/core/db';
import { SOURCE_OWNER_ROLES } from '@/backend/services/milkSourceService';
import { listErpSources, createErpSource } from '@/backend/services/financeMasterDataService';

/** Only MPD Head, Super Admin and Data Executive own milk sources and contractor ERP codes. */
const ALLOWED_ROLES: string[] = [...SOURCE_OWNER_ROLES];

export async function GET(req: Request) {
  const user = await getCurrentUser(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }
  if (!ALLOWED_ROLES.includes(user.role)) {
    return NextResponse.json({ error: 'Forbidden. Milk source owner access required.' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const is_active_param = searchParams.get('is_active');
  const search = searchParams.get('search') || undefined;
  const zmcc_id = searchParams.get('zmcc_id') || undefined;

  const is_active = is_active_param !== null ? is_active_param === 'true' : undefined;

  try {
    const erp_sources = await listErpSources({ is_active, search, zmcc_id });
    return NextResponse.json({ erp_sources }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to list ERP sources.';
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
    return NextResponse.json({ error: 'Forbidden. Milk source owner access required.' }, { status: 403 });
  }

  try {
    const body = await req.json();
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
    }

    const { erp_code, name, zmcc_ids } = body;
    if (!erp_code || !name) {
      return NextResponse.json({ error: 'erp_code and name are required.' }, { status: 400 });
    }
    if (!Array.isArray(zmcc_ids) || zmcc_ids.length === 0) {
      return NextResponse.json({ error: 'zmcc_ids array with at least one ZMCC is required.' }, { status: 400 });
    }

    const created = await createErpSource(actor.id, {
      erp_code,
      name,
      zmcc_ids,
    }, actor.role);

    return NextResponse.json({
      erp_source: {
        id: created.id.toString(),
        erp_code: created.erp_code,
        name: created.name,
        is_active: created.is_active,
      },
    }, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to create ERP source.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
