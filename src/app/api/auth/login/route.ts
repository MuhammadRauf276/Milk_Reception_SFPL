import { NextRequest, NextResponse } from 'next/server';
import { createSessionToken, NORMAL_SESSION_TTL, REMEMBERED_SESSION_TTL } from '@core/auth';
import { Role, User } from '@core/types';
import { prisma } from '@core/db';
import bcrypt from 'bcryptjs';
import { z } from 'zod';

const loginSchema = z.object({
  username: z.string().trim().min(1, 'Username is required').max(100, 'Username too long'),
  password: z.string().min(1, 'Password is required').max(100, 'Password too long'),
  rememberMe: z.boolean().optional().default(false),
});

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.json();
    
    // STRICT ZOD VALIDATION: Block Prototype Pollution & Type Juggling
    const parseResult = loginSchema.safeParse(rawBody);
    if (!parseResult.success) {
      return NextResponse.json({ error: 'Invalid input format' }, { status: 400 });
    }
    
    const { username, password, rememberMe } = parseResult.data;

    let authenticatedUser: User | null = null;

    // 1. Check PostgreSQL users table
    const dbUser = await prisma.user.findFirst({
      where: { username },
    });

    if (!dbUser) {
      return NextResponse.json({ error: 'Invalid username or password' }, { status: 401 });
    }

    // 2. Strict Deactivation Lock
    if (!dbUser.is_active) {
      return NextResponse.json({ error: 'Account is deactivated. Access denied.' }, { status: 401 });
    }

    // 3. Verify password hash using bcrypt
    if (!dbUser.password_hash) {
      return NextResponse.json({ error: 'Invalid username or password' }, { status: 401 });
    }

    const isPassValid = await bcrypt.compare(password, dbUser.password_hash);
    if (!isPassValid) {
      return NextResponse.json({ error: 'Invalid username or password' }, { status: 401 });
    }

    // Update last_login_at
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
