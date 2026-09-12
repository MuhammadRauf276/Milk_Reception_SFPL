import { NextResponse } from 'next/server';
import { getCurrentUser } from '@core/auth';
import { prisma } from '@core/db';

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
    const sources = await prisma.procurementSource.findMany({
      orderBy: { created_at: 'asc' },
    });

    const serialized = sources.map((s) => ({
      id: s.id.toString(),
      code: s.code,
      name: s.name,
      sourceType: s.source_type,
      isActive: s.is_active,
      createdAt: s.created_at.toISOString(),
    }));

    return NextResponse.json({ sources: serialized }, { headers: NO_STORE_HEADERS });
  } catch (err: any) {
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
    let body: any;
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
          is_active: true,
        },
      });

      await tx.auditLog.create({
        data: {
          table_name: 'procurement_source',
          record_id: createdSource.id,
          action: 'PROCUREMENT_SOURCE_CREATED',
          new_values: { code, name, source_type: sourceType },
          user_id: adminUser?.id || null,
        },
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
          sourceType: newSource.source_type,
          isActive: newSource.is_active,
        },
      },
      { status: 201 }
    );
  } catch (err: any) {
    console.error('Unexpected error in POST /api/super-admin/procurement-sources:', err);
    return NextResponse.json({ error: 'Failed to create procurement source.' }, { status: 500 });
  }
}
