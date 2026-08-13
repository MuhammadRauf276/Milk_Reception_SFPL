import { NextResponse } from 'next/server';
import { getCurrentUser } from '@core/auth';
import { prisma } from '@core/db';
import bcrypt from 'bcryptjs';

export async function GET() {
  const authUser = await getCurrentUser();
  if (!authUser || (authUser.role !== 'SUPER_ADMIN' && authUser.role !== 'Admin')) {
    return NextResponse.json({ error: 'Unauthorized. Super Admin authorization required.' }, { status: 403 });
  }

  try {
    const users = await prisma.user.findMany({
      orderBy: { created_at: 'desc' },
      include: {
        procurement_source: {
          select: { id: true, code: true, name: true, source_type: true },
        },
      },
    });

    const serialized = users.map((u) => ({
      id: u.id.toString(),
      username: u.username,
      name: u.full_name || u.username,
      role: u.role,
      department: u.department || '-',
      scopeType: u.scope_type,
      procurementSourceId: u.procurement_source_id ? u.procurement_source_id.toString() : null,
      procurementSource: u.procurement_source
        ? {
            id: u.procurement_source.id.toString(),
            code: u.procurement_source.code,
            name: u.procurement_source.name,
            sourceType: u.procurement_source.source_type,
          }
        : null,
      isActive: u.is_active,
      lastLoginAt: u.last_login_at ? u.last_login_at.toISOString() : null,
      createdAt: u.created_at.toISOString(),
    }));

    return NextResponse.json({ users: serialized });
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
    const username = (body.username || '').trim();
    const password = (body.password || '').trim();
    const fullName = (body.name || '').trim();
    const role = (body.role || '').trim();
    const department = (body.department || '').trim();
    const scopeType = (body.scopeType || 'ALL').trim();
    const procurementSourceIdStr = body.procurementSourceId ? String(body.procurementSourceId).trim() : null;

    if (!username || !password || !role) {
      return NextResponse.json({ error: 'Username, password, and role are required.' }, { status: 400 });
    }

    // Check duplicate username
    const existing = await prisma.user.findFirst({ where: { username } });
    if (existing) {
      return NextResponse.json({ error: `Username "${username}" is already taken.` }, { status: 400 });
    }

    let psId: bigint | null = null;
    if (procurementSourceIdStr) {
      const ps = await prisma.procurementSource.findUnique({ where: { id: BigInt(procurementSourceIdStr) } });
      if (!ps) {
        return NextResponse.json({ error: 'Invalid Procurement Source assignment.' }, { status: 400 });
      }
      psId = ps.id;

      // Role and Source Type Consistency Enforcement
      if (role === 'ZMCC_MANAGER' && ps.source_type !== 'ZMCC') {
        return NextResponse.json({ error: `Role ZMCC_MANAGER cannot be assigned to Contractor source "${ps.name}".` }, { status: 400 });
      }
      if (role === 'CONTRACTOR_MANAGER' && ps.source_type !== 'CONTRACTOR') {
        return NextResponse.json({ error: `Role CONTRACTOR_MANAGER cannot be assigned to ZMCC source "${ps.name}".` }, { status: 400 });
      }
    }

    const passHash = await bcrypt.hash(password, 10);
    const adminUser = await prisma.user.findFirst({ where: { username: authUser.username } });

    const newUser = await prisma.user.create({
      data: {
        username,
        full_name: fullName || username,
        password_hash: passHash,
        role,
        department,
        scope_type: scopeType,
        procurement_source_id: psId,
        is_active: true,
      },
    });

    // Create AuditLog entry without password
    await prisma.auditLog.create({
      data: {
        table_name: 'users',
        record_id: newUser.id,
        action: 'USER_CREATED',
        new_values: { username, role, department, scope_type: scopeType },
        user_id: adminUser?.id || null,
      },
    });

    return NextResponse.json({
      success: true,
      user: {
        id: newUser.id.toString(),
        username: newUser.username,
        name: newUser.full_name,
        role: newUser.role,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
