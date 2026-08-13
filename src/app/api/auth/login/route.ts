import { NextRequest, NextResponse } from 'next/server';
import { createSessionToken, NORMAL_SESSION_TTL, REMEMBERED_SESSION_TTL } from '@core/auth';
import { AUTHENTICATED_USERS, Role, User } from '@core/types';
import { prisma } from '@core/db';
import bcrypt from 'bcryptjs';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const username = (body.username || '').trim();
    const password = (body.password || '').trim();

    if (!username || !password) {
      return NextResponse.json({ error: 'Username and password required' }, { status: 400 });
    }

    let authenticatedUser: User | null = null;

    // 1. Check PostgreSQL users table (sole runtime authority)
    const dbUser = await prisma.user.findFirst({
      where: { username },
    });

    if (!dbUser) {
      return NextResponse.json({ error: 'Invalid username or password' }, { status: 401 });
    }

    // 2. Strict Deactivation Lock: If DB user exists and is inactive, IMMEDIATELY DENY
    if (!dbUser.is_active) {
      return NextResponse.json({ error: 'Account is deactivated. Access denied.' }, { status: 401 });
    }

    // 3. Verify password hash using bcrypt (deny safely if hash missing)
    if (!dbUser.password_hash) {
      return NextResponse.json({ error: 'Invalid username or password' }, { status: 401 });
    }

    const isPassValid = await bcrypt.compare(password, dbUser.password_hash);
    if (!isPassValid) {
      return NextResponse.json({ error: 'Invalid username or password' }, { status: 401 });
    }

    // Update last_login_at in database upon successful password check
    const now = new Date();
    await prisma.user.update({
      where: { id: dbUser.id },
      data: { last_login_at: now },
    });

    authenticatedUser = {
      id: dbUser.id.toString(),
      username: dbUser.username,
      name: dbUser.full_name || dbUser.username,
      role: dbUser.role as Role,
      department: dbUser.department || 'System Operations',
      scope_type: dbUser.scope_type,
      procurement_source_id: dbUser.procurement_source_id ? dbUser.procurement_source_id.toString() : null,
      last_login_at: now.toISOString(),
    };

    const rememberMe = body.rememberMe === true;
    const sessionTtl = rememberMe ? REMEMBERED_SESSION_TTL : NORMAL_SESSION_TTL;

    const token = await createSessionToken(authenticatedUser, rememberMe);

    const response = NextResponse.json({ success: true, user: authenticatedUser });
    response.cookies.set('auth_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: sessionTtl,
    });

    return response;
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Login failed' }, { status: 500 });
  }
}
