import { NextRequest, NextResponse } from 'next/server';
import { createSessionToken, NORMAL_SESSION_TTL, REMEMBERED_SESSION_TTL } from '@core/auth';
import { Role, User } from '@core/types';
import { prisma } from '@core/db';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { isFieldRole } from '@/backend/core/roles/hierarchy';
import { blockedForSeconds, clearFailures, clientIp, recordFailure } from '@/lib/rate-limit';

const loginSchema = z.object({
  username: z.string().trim().min(1, 'Username is required').max(100, 'Username too long'),
  password: z.string().min(1, 'Password is required').max(100, 'Password too long'),
  rememberMe: z.boolean().optional().default(false),
  deviceUid: z.string().trim().min(1).max(64).optional(),
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

    const { username, password, rememberMe: rememberRequested, deviceUid } = parseResult.data;

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

    // 1. Check PostgreSQL users table (case-insensitive for resilient login)
    let dbUser = await prisma.user.findFirst({
      where: {
        username: { equals: username, mode: 'insensitive' },
      },
    });

    // If generic 'mdo' username requested and not found as exact match, fallback to primary MDO account
    if (!dbUser && username.trim().toLowerCase() === 'mdo') {
      dbUser = await prisma.user.findFirst({
        where: {
          username: { equals: 'mdo.hasilpur', mode: 'insensitive' },
        },
      });
    }

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

    // Phone login: a field user on their own ACTIVE assigned phone gets a long (30 day) session.
    let rememberMe = rememberRequested;
    if (deviceUid) {
      try {
        const device = await prisma.device.findUnique({ where: { device_uid: deviceUid } });
        if (device) {
          if (device.status === 'ACTIVE' && device.assigned_user_id === dbUser.id && isFieldRole(dbUser.role)) rememberMe = true;
          await prisma.deviceActivityEvent.create({
            data: {
              device_id: device.id,
              user_id: dbUser.id,
              performed_as_role: dbUser.role,
              is_delegated: false,
              event_type: 'LOGIN',
              client_event_id: `login:${randomUUID()}`,
              device_occurred_at: now,
            },
          });
        }
      } catch (deviceErr) {
        console.error('[API_AUTH_LOGIN_DEVICE_ERROR]', deviceErr);
      }
    }

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
