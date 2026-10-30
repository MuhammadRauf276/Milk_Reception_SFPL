import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createSessionToken, NORMAL_SESSION_TTL } from '@core/auth';
import type { Role, User } from '@core/types';
import { prisma } from '@core/db';
import { authenticateDevice } from '@/backend/core/device-auth';
import { listStationUsers, verifyStationPin } from '@/backend/services/device/stationPinService';
import { blockedForSeconds, clearFailures, recordFailure } from '@/lib/rate-limit';

const NOT_STATION = 'This computer is not set up as a station. Ask the office.';
const postSchema = z.object({ userId: z.string().regex(/^\d+$/), pin: z.string().regex(/^\d{4}$/) });

// x-forwarded-for is client-controlled unless a trusted proxy sets it, so only use it when TRUST_PROXY=1.
// The authenticated device id is always part of the key.
function throttleKey(req: Request, deviceId: bigint): string {
  const fwd = process.env.TRUST_PROXY === '1' ? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() : '';
  return `stationpin:${deviceId.toString()}:${fwd || 'direct'}`;
}

// Extra throttle on top of the per-user PIN lock: 30 bad tries per IP per 15 minutes.
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES_PER_IP = 30;

/** Name cards for this station PC. Only a registered, ACTIVE station PC may ask. */
export async function GET(req: Request) {
  try {
    const device = await authenticateDevice(req);
    if (!device || !device.isSharedStation) return NextResponse.json({ error: NOT_STATION }, { status: 403 });
    const deviceUid = new URL(req.url).searchParams.get('deviceUid');
    if (deviceUid && deviceUid !== device.deviceUid) return NextResponse.json({ error: NOT_STATION }, { status: 403 });
    const users = await listStationUsers(device.id);
    return NextResponse.json({
      users: users.map((u) => ({ id: u.userId, name: u.name, role: u.role, roleLabel: u.role.replace(/_/g, ' ').toLowerCase(), locked: u.locked })),
    });
  } catch (err) {
    console.error('[API_STATION_PIN_LIST_ERROR]', err);
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const device = await authenticateDevice(req);
    if (!device || !device.isSharedStation) return NextResponse.json({ error: NOT_STATION }, { status: 403 });

    const parsed = postSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: 'Please choose your name and enter 4 digits.' }, { status: 400 });

    const ipKey = throttleKey(req, device.id);
    const retryAfter = blockedForSeconds(ipKey, MAX_FAILURES_PER_IP);
    if (retryAfter > 0) {
      return NextResponse.json({ error: 'Too many tries. Wait a few minutes.' }, { status: 429, headers: { 'Retry-After': String(retryAfter) } });
    }

    // Count the try BEFORE checking, so parallel guesses are all counted; cleared on success.
    recordFailure(ipKey, WINDOW_MS);
    const result = await verifyStationPin(device.deviceUid, BigInt(parsed.data.userId), parsed.data.pin);
    if (!result.ok) {
      if (result.code === 'LOCKED') return NextResponse.json({ error: 'PIN locked. Ask the office.', code: 'LOCKED' }, { status: 423 });
      if (result.code === 'NOT_STATION') return NextResponse.json({ error: NOT_STATION, code: result.code }, { status: 403 });
      if (result.code === 'NO_PIN') return NextResponse.json({ error: 'No PIN for this name. Ask the office.', code: result.code }, { status: 401 });
      const left = result.triesLeft;
      return NextResponse.json(
        { error: `Wrong PIN. ${left} ${left === 1 ? 'try' : 'tries'} left.`, code: 'WRONG_PIN', triesLeft: left },
        { status: 401 }
      );
    }

    clearFailures(ipKey);
    const dbUser = result.user;
    const now = new Date();
    await prisma.user.update({ where: { id: dbUser.id }, data: { last_login_at: now } });
    await prisma.deviceActivityEvent.create({
      data: {
        device_id: device.id,
        user_id: dbUser.id,
        performed_as_role: dbUser.role,
        is_delegated: false,
        event_type: 'LOGIN',
        client_event_id: `login:${crypto.randomUUID()}`,
        device_occurred_at: now,
      },
    });

    const user: User = {
      id: dbUser.id.toString(),
      username: dbUser.username,
      name: dbUser.full_name || dbUser.username,
      role: dbUser.role as Role,
      department: dbUser.department || 'System Operations',
      scope_type: dbUser.scope_type ?? undefined,
      procurement_source_id: dbUser.procurement_source_id ? dbUser.procurement_source_id.toString() : null,
      last_login_at: now.toISOString(),
    };
    // Shared PC: normal (short) session, never "remembered".
    const token = await createSessionToken(user, false);
    const response = NextResponse.json({ success: true, user });
    response.cookies.set('auth_token', token, {
      httpOnly: true,
      secure: process.env.COOKIE_SECURE === 'true' || (req.headers.get('x-forwarded-proto') === 'https' || req.url.startsWith('https://')),
      sameSite: 'lax',
      path: '/',
      maxAge: NORMAL_SESSION_TTL,
    });
    return response;
  } catch (err) {
    console.error('[API_STATION_PIN_ERROR]', err);
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 });
  }
}
