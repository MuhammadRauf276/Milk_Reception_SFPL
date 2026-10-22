import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/backend/core/auth';
import { prisma } from '@/backend/core/db';
import { SOURCE_OWNER_ROLES } from '@/backend/services/milkSourceService';
import { listContractors, updateContractorErpCode } from '@/backend/services/financeMasterDataService';

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
    return NextResponse.json({ error: 'Forbidden. Milk source owner access required.' }, { status: 403 });
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
      String(erp_code),
      actor.role
    );

    return NextResponse.json({ contractor: updated });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to update contractor ERP code.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function POST(req: Request) {
  const user = await getCurrentUser(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  const actor = await prisma.user.findUnique({ where: { id: BigInt(user.id) } });
  if (!actor || !ALLOWED_ROLES.includes(actor.role)) {
    return NextResponse.json({ error: 'Forbidden. MPD Head access required.' }, { status: 403 });
  }

  try {
    const body = await req.json();
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
    }

    const { name, code, erp_code } = body;
    if (!erp_code || !String(erp_code).trim()) {
      return NextResponse.json({ error: 'ERP code is required for a contractor.' }, { status: 400 });
    }
    if (!name || !code) {
      return NextResponse.json({ error: 'Contractor name and code are required.' }, { status: 400 });
    }

    const normalizedCode = String(code).trim().toUpperCase();
    const existing = await prisma.procurementSource.findUnique({ where: { code: normalizedCode } });
    if (existing) {
      return NextResponse.json({ error: `Contractor code "${normalizedCode}" already exists.` }, { status: 400 });
    }

    const created = await prisma.procurementSource.create({
      data: {
        code: normalizedCode,
        name: String(name).trim(),
        erp_code: String(erp_code).trim(),
        source_type: 'CONTRACTOR',
        is_active: true,
      },
    });

    return NextResponse.json(
      {
        contractor: {
          id: created.id.toString(),
          code: created.code,
          name: created.name,
          erp_code: created.erp_code,
          is_active: created.is_active,
        },
      },
      { status: 201 }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to create contractor.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
