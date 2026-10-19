import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { getCurrentUser } from '@/backend/core/auth';
import type { User } from '@/backend/core/types';

/**
 * Returns true when the request carries `Authorization: Bearer <value of env var>`.
 * Always false if the env var is unset/empty (fail closed). Constant-time compare.
 */
export function hasValidBearerSecret(req: Request, envName: string): boolean {
  const secret = process.env[envName]?.trim();
  if (!secret) return false;
  const header = req.headers.get('authorization') || '';
  const provided = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

export type RoleGuardResult = { user: User } | { response: NextResponse };

/** Requires an authenticated, active user whose DB-resolved role is in `roles`. */
export async function requireRoles(req: Request, roles: readonly string[]): Promise<RoleGuardResult> {
  const user = await getCurrentUser(req);
  if (!user) {
    return { response: NextResponse.json({ error: 'Unauthorized.' }, { status: 401 }) };
  }
  if (!roles.includes(user.role)) {
    return { response: NextResponse.json({ error: 'Forbidden.' }, { status: 403 }) };
  }
  return { user };
}
