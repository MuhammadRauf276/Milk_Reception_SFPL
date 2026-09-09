import { NextResponse } from 'next/server';
import { getCurrentUser } from '@core/auth';
import { prisma } from '@core/db';
import bcrypt from 'bcryptjs';
import { getRoleAssignmentPolicy } from '@/lib/user-assignment-policy';

export async function GET(req: Request) {
  const authUser = await getCurrentUser(req);
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
    console.error('[API_SUPER_ADMIN_USERS_GET_ERROR]', err);
    return NextResponse.json({ error: 'Failed to retrieve users.' }, { status: 500 });
  }
}

const ALLOWED_POST_FIELDS = new Set([
  'username',
  'name',
  'fullName',
  'password',
  'role',
  'procurementSourceId',
]);

export async function POST(req: Request) {
  const authUser = await getCurrentUser(req);
  if (!authUser || (authUser.role !== 'SUPER_ADMIN' && authUser.role !== 'Admin')) {
    return NextResponse.json({ error: 'Unauthorized. Super Admin authorization required.' }, { status: 403 });
  }

  try {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON request body.' }, { status: 400 });
    }

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'Request body must be a plain object.' }, { status: 400 });
    }

    const payload = body as Record<string, unknown>;

    if (
      'scopeType' in payload ||
      'scope_type' in payload ||
      'department' in payload
    ) {
      return NextResponse.json(
        { error: 'Client-supplied scopeType and department are not permitted. Both values are derived strictly from role policy.' },
        { status: 400 }
      );
    }

    for (const key of Object.keys(payload)) {
      if (!ALLOWED_POST_FIELDS.has(key)) {
        return NextResponse.json({ error: `Unknown or disallowed field: ${key}` }, { status: 400 });
      }
    }

    if (typeof payload.username !== 'string' || !payload.username.trim()) {
      return NextResponse.json({ error: 'Username is required and must be a non-empty string.' }, { status: 400 });
    }
    const username = payload.username.trim();

    if (typeof payload.password !== 'string' || payload.password.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters long.' }, { status: 400 });
    }
    const password = payload.password;

    if (typeof payload.role !== 'string' || !payload.role.trim()) {
      return NextResponse.json({ error: 'Role is required.' }, { status: 400 });
    }
    const role = payload.role.trim();

    const policy = getRoleAssignmentPolicy(role);
    if (!policy) {
      return NextResponse.json(
        { error: `Role "${role}" is not a creatable role. Legacy, retired, or invalid roles are rejected.` },
        { status: 400 }
      );
    }

    let fullName = username;
    if (payload.name !== undefined) {
      if (typeof payload.name !== 'string') {
        return NextResponse.json({ error: 'Name must be a string.' }, { status: 400 });
      }
      fullName = payload.name.trim() || username;
    } else if (payload.fullName !== undefined) {
      if (typeof payload.fullName !== 'string') {
        return NextResponse.json({ error: 'Full name must be a string.' }, { status: 400 });
      }
      fullName = payload.fullName.trim() || username;
    }

    let psId: bigint | null = null;
    const rawPsId = payload.procurementSourceId;

    if (policy.requiresSource) {
      if (rawPsId === undefined || rawPsId === null || rawPsId === '') {
        return NextResponse.json(
          { error: `Role ${policy.role} requires an active ${policy.allowedSourceType} procurement source assignment.` },
          { status: 400 }
        );
      }
      let parsedId: bigint;
      try {
        parsedId = BigInt(String(rawPsId).trim());
      } catch {
        return NextResponse.json({ error: 'Invalid procurementSourceId format.' }, { status: 400 });
      }

      const ps = await prisma.procurementSource.findUnique({ where: { id: parsedId } });
      if (!ps) {
        return NextResponse.json({ error: 'Assigned Procurement Source not found.' }, { status: 400 });
      }
      if (!ps.is_active) {
        return NextResponse.json({ error: `Assigned Procurement Source "${ps.name}" is inactive. Active source is required.` }, { status: 400 });
      }
      if (ps.source_type !== policy.allowedSourceType) {
        return NextResponse.json(
          { error: `Role ${policy.role} cannot be assigned to ${ps.source_type} source "${ps.name}". Expected ${policy.allowedSourceType}.` },
          { status: 400 }
        );
      }
      psId = ps.id;
    } else {
      if (rawPsId !== undefined && rawPsId !== null && rawPsId !== '') {
        return NextResponse.json(
          { error: `Role ${policy.role} is not a source role and cannot be assigned a procurement source.` },
          { status: 400 }
        );
      }
      psId = null;
    }

    // Check duplicate username
    const existing = await prisma.user.findFirst({ where: { username } });
    if (existing) {
      return NextResponse.json({ error: `Username "${username}" is already taken.` }, { status: 400 });
    }

    const passHash = await bcrypt.hash(password, 10);
    const adminUser = await prisma.user.findFirst({ where: { username: authUser.username } });

    const newUser = await prisma.$transaction(async (tx) => {
      const createdUser = await tx.user.create({
        data: {
          username,
          full_name: fullName,
          password_hash: passHash,
          role: policy.role,
          department: policy.department,
          scope_type: policy.scopeType,
          procurement_source_id: psId,
          is_active: true,
        },
      });

      // Create AuditLog entry without password
      await tx.auditLog.create({
        data: {
          table_name: 'users',
          record_id: createdUser.id,
          action: 'USER_CREATED',
          new_values: {
            username,
            role: policy.role,
            department: policy.department,
            scope_type: policy.scopeType,
            procurement_source_id: psId ? psId.toString() : null,
          },
          user_id: adminUser?.id || null,
        },
      });

      return createdUser;
    });

    return NextResponse.json({
      success: true,
      user: {
        id: newUser.id.toString(),
        username: newUser.username,
        name: newUser.full_name,
        role: newUser.role,
        department: newUser.department,
        scopeType: newUser.scope_type,
        procurementSourceId: newUser.procurement_source_id ? newUser.procurement_source_id.toString() : null,
      },
    });
  } catch (err: any) {
    console.error('[API_SUPER_ADMIN_USERS_POST_ERROR]', err);
    return NextResponse.json({ error: 'Failed to create user record.' }, { status: 500 });
  }
}
