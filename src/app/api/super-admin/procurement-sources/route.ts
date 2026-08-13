import { NextResponse } from 'next/server';
import { getCurrentUser } from '@core/auth';
import { prisma } from '@core/db';

export async function GET() {
  const authUser = await getCurrentUser();
  if (!authUser || (authUser.role !== 'SUPER_ADMIN' && authUser.role !== 'Admin')) {
    return NextResponse.json({ error: 'Unauthorized. Super Admin authorization required.' }, { status: 403 });
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

    return NextResponse.json({ sources: serialized });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const authUser = await getCurrentUser();
  if (!authUser || (authUser.role !== 'SUPER_ADMIN' && authUser.role !== 'Admin')) {
    return NextResponse.json({ error: 'Unauthorized. Super Admin authorization required.' }, { status: 403 });
  }

  try {
    const body = await req.json();
    const code = (body.code || '').trim().toUpperCase();
    const name = (body.name || '').trim();
    const sourceType = (body.sourceType || '').trim().toUpperCase();

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

    const newSource = await prisma.procurementSource.create({
      data: {
        code,
        name,
        source_type: sourceType,
        is_active: true,
      },
    });

    const adminUser = await prisma.user.findFirst({ where: { username: authUser.username } });

    await prisma.auditLog.create({
      data: {
        table_name: 'procurement_source',
        record_id: newSource.id,
        action: 'PROCUREMENT_SOURCE_CREATED',
        new_values: { code, name, source_type: sourceType },
        user_id: adminUser?.id || null,
      },
    });

    return NextResponse.json({
      success: true,
      source: {
        id: newSource.id.toString(),
        code: newSource.code,
        name: newSource.name,
        sourceType: newSource.source_type,
        isActive: newSource.is_active,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
