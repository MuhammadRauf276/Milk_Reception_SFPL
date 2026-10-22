import { NextResponse } from 'next/server';
import { getCurrentUser } from '@core/auth';
import { prisma } from '@core/db';
import { Prisma } from '@prisma/client';
import { writeAuditLog, auditActorFromUser } from '@core/audit';

const NO_STORE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
};

export async function GET(req: Request) {
  const authUser = await getCurrentUser(req);
  if (!authUser || authUser.role !== 'SUPER_ADMIN') {
    return NextResponse.json(
      { error: 'Unauthorized. Super Admin authorization required.' },
      { status: 403, headers: NO_STORE_HEADERS }
    );
  }

  try {
    const sp = new URL(req.url).searchParams;
    const paged = sp.has('page') || sp.has('pageSize');
    const page = Math.max(1, Number(sp.get('page')) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(sp.get('pageSize')) || 25));
    const q = (sp.get('q') || '').trim();
    const type = sp.get('type');
    const status = sp.get('status');

    const where: Prisma.ProcurementSourceWhereInput = {};
    if (q) {
      where.OR = [
        { code: { contains: q, mode: 'insensitive' } },
        { name: { contains: q, mode: 'insensitive' } },
      ];
    }
    if (type === 'ZMCC' || type === 'CONTRACTOR') where.source_type = type;
    if (status === 'active') where.is_active = true;
    if (status === 'inactive') where.is_active = false;

    const [totalRecords, sources] = await Promise.all([
      paged ? prisma.procurementSource.count({ where }) : Promise.resolve(0),
      prisma.procurementSource.findMany({
        where,
        orderBy: { created_at: 'asc' },
        ...(paged ? { skip: (page - 1) * pageSize, take: pageSize } : {}),
        select: { id: true, code: true, name: true, erp_code: true, source_type: true, is_active: true, created_at: true },
      }),
    ]);

    const serialized = sources.map((s) => ({
      id: s.id.toString(),
      code: s.code,
      name: s.name,
      erpCode: s.erp_code,
      sourceType: s.source_type,
      isActive: s.is_active,
      createdAt: s.created_at.toISOString(),
    }));

    return NextResponse.json(
      {
        sources: serialized,
        ...(paged
          ? {
              pagination: {
                page,
                pageSize,
                totalRecords,
                totalPages: totalRecords === 0 ? 1 : Math.ceil(totalRecords / pageSize),
              },
            }
          : {}),
      },
      { headers: NO_STORE_HEADERS }
    );
  } catch (err) {
    console.error('Unexpected error in GET /api/super-admin/procurement-sources:', err);
    return NextResponse.json(
      { error: 'Failed to fetch procurement sources.' },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}

export async function POST(req: Request) {
  const authUser = await getCurrentUser(req);
  if (!authUser || authUser.role !== 'SUPER_ADMIN') {
    return NextResponse.json({ error: 'Unauthorized. Super Admin authorization required.' }, { status: 403 });
  }

  try {
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON request body.' }, { status: 400 });
    }

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'Request body must be a valid JSON object.' }, { status: 400 });
    }

    const code = typeof body.code === 'string' ? body.code.trim().toUpperCase() : '';
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const sourceType = typeof body.sourceType === 'string' ? body.sourceType.trim().toUpperCase() : '';

    if (!code || !name || !sourceType) {
      return NextResponse.json({ error: 'Code, Name, and Source Type (ZMCC or CONTRACTOR) are required.' }, { status: 400 });
    }

    if (!['ZMCC', 'CONTRACTOR'].includes(sourceType)) {
      return NextResponse.json({ error: 'Source Type must be strictly ZMCC or CONTRACTOR.' }, { status: 400 });
    }

    const erpCodeRaw = typeof body.erpCode === 'string' ? body.erpCode.trim() : '';
    if (sourceType === 'CONTRACTOR' && !erpCodeRaw) {
      return NextResponse.json({ error: 'ERP code is required for a contractor.' }, { status: 400 });
    }
    if (sourceType === 'ZMCC' && erpCodeRaw) {
      return NextResponse.json({ error: 'ERP code is not used for a ZMCC.' }, { status: 400 });
    }
    if (erpCodeRaw.length > 50) {
      return NextResponse.json({ error: 'ERP code cannot exceed 50 characters.' }, { status: 400 });
    }

    const existing = await prisma.procurementSource.findUnique({ where: { code } });
    if (existing) {
      return NextResponse.json({ error: `Procurement Source Code "${code}" already exists.` }, { status: 400 });
    }

    const adminUser = await prisma.user.findFirst({ where: { username: authUser.username } });

    const newSource = await prisma.$transaction(async (tx) => {
      const createdSource = await tx.procurementSource.create({
        data: {
          code,
          name,
          source_type: sourceType,
          erp_code: sourceType === 'CONTRACTOR' ? erpCodeRaw : null,
          is_active: true,
        },
      });

      await writeAuditLog(tx, {
        tableName: 'procurement_source',
        recordId: createdSource.id,
        action: 'PROCUREMENT_SOURCE_CREATED',
        newValues: { code, name, source_type: sourceType, erp_code: sourceType === 'CONTRACTOR' ? erpCodeRaw : null },
        actor: { ...auditActorFromUser(authUser), userId: adminUser?.id ?? null },
      });

      return createdSource;
    });

    return NextResponse.json(
      {
        success: true,
        source: {
          id: newSource.id.toString(),
          code: newSource.code,
          name: newSource.name,
          erpCode: newSource.erp_code,
          sourceType: newSource.source_type,
          isActive: newSource.is_active,
        },
      },
      { status: 201 }
    );
  } catch (err) {
    console.error('Unexpected error in POST /api/super-admin/procurement-sources:', err);
    return NextResponse.json({ error: 'Failed to create procurement source.' }, { status: 500 });
  }
}
