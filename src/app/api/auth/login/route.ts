import { NextRequest, NextResponse } from 'next/server';
import { createSessionToken, NORMAL_SESSION_TTL, REMEMBERED_SESSION_TTL } from '@core/auth';
import { Role, User } from '@core/types';
import { prisma } from '@core/db';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { blockedForSeconds, clearFailures, clientIp, recordFailure } from '@/lib/rate-limit';

const loginSchema = z.object({
  username: z.string().trim().min(1, 'Username is required').max(100, 'Username too long'),
  password: z.string().min(1, 'Password is required').max(100, 'Password too long'),
  rememberMe: z.boolean().optional().default(false),
});

// Lockout policy: 5 failed attempts per username+IP and 50 per IP, per 15 minutes.
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES_PER_USER = 5;
const MAX_FAILURES_PER_IP = 50;

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.json();

    // STRICT ZOD VALIDATION: Block Prototype Pollution & Type Juggling
    const parseResult = loginSchema.safeParse(rawBody);
    if (!parseResult.success) {
      return NextResponse.json({ error: 'Invalid input format' }, { status: 400 });
    }

    const { username, password, rememberMe } = parseResult.data;

    const ip = clientIp(req);
    const userKey = `login:user:${ip}:${username.toLowerCase()}`;
    const ipKey = `login:ip:${ip}`;

    const retryAfter = Math.max(blockedForSeconds(userKey, MAX_FAILURES_PER_USER), blockedForSeconds(ipKey, MAX_FAILURES_PER_IP));
    if (retryAfter > 0) {
      return NextResponse.json(
        { error: 'Too many failed login attempts. Please try again later.' },
        { status: 429, headers: { 'Retry-After': String(retryAfter) } }
      );
    }

    const fail = (error: string) => {
      recordFailure(userKey, WINDOW_MS);
      recordFailure(ipKey, WINDOW_MS);
      return NextResponse.json({ error }, { status: 401 });
    };

    // 1. Check PostgreSQL users table
    const dbUser = await prisma.user.findFirst({
      where: { username },
    });

    if (!dbUser) {
      return fail('Invalid username or password');
    }

    // 2. Strict Deactivation Lock
    if (!dbUser.is_active) {
      return fail('Account is deactivated. Access denied.');
    }

    // 3. Verify password hash using bcrypt
    if (!dbUser.password_hash) {
      return fail('Invalid username or password');
    }

    const isPassValid = await bcrypt.compare(password, dbUser.password_hash);
    if (!isPassValid) {
      return fail('Invalid username or password');
    }

    clearFailures(userKey);

    // Update last_login_at
    const now = new Date();
    await prisma.user.update({
      where: { id: dbUser.id },
      data: { last_login_at: now },
    });

    const authenticatedUser: User = {
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
    // Never echo internal (e.g. Prisma/DB) error text to unauthenticated callers.
    console.error('[API_AUTH_LOGIN_ERROR]', err);
    return NextResponse.json({ error: 'Login failed' }, { status: 500 });
  }
}
