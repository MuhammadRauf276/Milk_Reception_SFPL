import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { getCurrentUser } from '@/backend/core/auth';
import type { User } from '@/backend/core/types';
import type { ActingContext, DelegationMode, ScopeFailure } from '@/types/acting';
import { resolveActingContext } from '@/backend/core/acting-context';
import { isCorrectionAuthority, isDeviceAdministrator } from '@/backend/core/roles/capabilities';

/** Header a client may send to ask to act as a role below its own. Validated server side. */
export const ACTING_AS_HEADER = 'x-acting-as';

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

export type RoleGuardResult = { user: User; acting: ActingContext } | { response: NextResponse };

export interface RequireRolesOptions {
  /** 'ancestors' (default): roles above an allowed role also pass. 'none': exact role (plus SUPER_ADMIN). */
  delegation?: DelegationMode;
  /** Role the client asks to act as. When undefined, read from the `x-acting-as` header. */
  requestedAs?: string | null;
}

const SCOPE_FAILURE_MESSAGES: Record<ScopeFailure, string> = {
  OUTSIDE_SCOPE: 'This record is outside your area.',
  SOURCE_TYPE_MISMATCH: 'This record is for a different kind of source.',
  NO_SCOPE_BOUND: 'Your account is not linked to an active source.',
  CANNOT_ACT_AS: 'You cannot work as this role.',
};

/** 403 response for a scope / acting-as failure: `{ error, code }`. */
export function scopeFailureResponse(code: ScopeFailure): NextResponse {
  return NextResponse.json({ error: SCOPE_FAILURE_MESSAGES[code], code }, { status: 403 });
}

function forbidden(): NextResponse {
  return NextResponse.json({ error: 'Forbidden.' }, { status: 403 });
}

/**
 * Requires an authenticated, active user whose DB-resolved role is in `roles`
 * or (by default) above one of them in the role tree. Returns the user and
 * the resolved acting context.
 */
export async function requireRoles(
  req: Request,
  roles: readonly string[],
  options: RequireRolesOptions = {}
): Promise<RoleGuardResult> {
  const user = await getCurrentUser(req);
  if (!user) {
    return { response: NextResponse.json({ error: 'Unauthorized.' }, { status: 401 }) };
  }
  const requestedAs = options.requestedAs !== undefined ? options.requestedAs : req.headers.get(ACTING_AS_HEADER);
  const resolved = resolveActingContext(user, roles, { delegation: options.delegation ?? 'ancestors', requestedAs });
  if (!resolved.ok) {
    return { response: resolved.code === 'FORBIDDEN' ? forbidden() : scopeFailureResponse(resolved.code) };
  }
  return { user, acting: resolved.ctx };
}

/**
 * Correct / edit saved records: SUPER_ADMIN and DATA_EXECUTIVE only.
 * Non-delegable, so the acting-as header is ignored and the result is never delegated.
 */
export async function requireCorrectionAuthority(req: Request): Promise<RoleGuardResult> {
  const guard = await requireRoles(req, ['SUPER_ADMIN', 'DATA_EXECUTIVE'], { delegation: 'none', requestedAs: null });
  if ('response' in guard) return guard;
  if (!isCorrectionAuthority(guard.acting.actorRole)) return { response: forbidden() };
  return guard;
}

/**
 * Control devices (register, release, block, diary, alerts): SUPER_ADMIN and
 * DATA_EXECUTIVE only (ADMINISTER). Non-delegable.
 */
export async function requireDeviceAdmin(req: Request): Promise<RoleGuardResult> {
  const guard = await requireRoles(req, ['SUPER_ADMIN', 'DATA_EXECUTIVE'], { delegation: 'none', requestedAs: null });
  if ('response' in guard) return guard;
  if (!isDeviceAdministrator(guard.acting.actorRole)) return { response: forbidden() };
  return guard;
}
