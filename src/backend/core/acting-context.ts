/**
 * Acting context (Phase 3): who is doing the work, which role's work it is,
 * and which records they may touch.
 *
 * Owner rule: a superior can do all the work of every role below them, in
 * their own scope only (Zonal Manager = own ZMCC). Super Admin and Data
 * Executive are outside the delegation rules and are never "delegated".
 *
 * Pure logic: takes the live User (from getCurrentUser) as input and never
 * touches the database, so it can be unit tested.
 */
import type { CanonicalRole, User } from './types';
import type { ActingContext, ActingScope, DelegationMode, ResourceRef, ScopeFailure } from '../../types/acting';
import {
  canActAs,
  expandToAncestors,
  getAncestorRoles,
  getDescendantRoles,
  isCanonicalRole,
  isOutsideDelegationRules,
  pickActingRole,
} from './roles/hierarchy';

export type ActingContextResult = { ok: true; ctx: ActingContext } | { ok: false; code: ScopeFailure | 'FORBIDDEN' };

export interface ResolveActingContextOptions {
  /** 'ancestors' (default): every role above an allowed role is also allowed. 'none': exact role match (plus SUPER_ADMIN). */
  delegation?: DelegationMode;
  /** Role the client asks to act as (e.g. the `x-acting-as` header). Only a request: validated with canActAs. */
  requestedAs?: string | null;
  /** When given, the resource must be inside the resolved scope. */
  resource?: ResourceRef;
}

/** Roles that see the whole system (scope SYSTEM). */
const SYSTEM_SCOPE_ROLES: readonly CanonicalRole[] = [
  'SUPER_ADMIN',
  'DATA_EXECUTIVE',
  'HEAD_OF_MPD',
  'EXECUTIVE_MANAGEMENT',
  'FINANCE_ACCOUNTS',
];

/** Department heads: they and every role below them are department scoped. */
const DEPARTMENT_HEAD_ROLES: readonly CanonicalRole[] = ['ADMIN_HEAD', 'QA_HEAD', 'PRODUCTION_HEAD'];

/**
 * Home department of each department-scoped role. Strings match the
 * department values stored on users and used by the route scopes
 * (e.g. Security routes use 'Security', weighbridge routes use
 * 'Production & Weighbridge').
 */
export const ROLE_HOME_DEPARTMENT: Partial<Record<CanonicalRole, string>> = {
  ADMIN_HEAD: 'Administration',
  SECURITY_OPERATOR: 'Security',
  QA_HEAD: 'Quality Assurance',
  QA_LAB_ATTENDANT: 'Quality Assurance',
  PRODUCTION_HEAD: 'Production',
  WEIGHBRIDGE_OPERATOR: 'Production & Weighbridge',
  PRODUCTION_RECEPTION_OPERATOR: 'Production',
};

function isSelfOrBelow(role: CanonicalRole, top: CanonicalRole): boolean {
  return role === top || getAncestorRoles(role).includes(top);
}

function normalizeSourceType(value: string | null | undefined): string | null {
  const trimmed = typeof value === 'string' ? value.trim().toUpperCase() : '';
  return trimmed || null;
}

/** Source type a role works on: ZMCC for Zonal Manager and below, CONTRACTOR for Contractor Manager and below. */
export function targetSourceTypeFor(role: string): 'ZMCC' | 'CONTRACTOR' | null {
  if (!isCanonicalRole(role)) return null;
  if (isSelfOrBelow(role, 'ZMCC_MANAGER')) return 'ZMCC';
  if (isSelfOrBelow(role, 'CONTRACTOR_MANAGER')) return 'CONTRACTOR';
  return null;
}

/** Departments a department-scoped role covers: its own, plus every role below it. */
export function departmentsForRole(role: CanonicalRole, userDepartment?: string | null): string[] {
  const result = new Set<string>();
  if (userDepartment && userDepartment.trim()) result.add(userDepartment.trim());
  for (const r of [role, ...getDescendantRoles(role)]) {
    const department = ROLE_HOME_DEPARTMENT[r];
    if (department) result.add(department);
  }
  return [...result];
}

function parseBigIntId(value: string | bigint | null | undefined): bigint | null {
  if (typeof value === 'bigint') return value;
  if (typeof value !== 'string' || !/^\d+$/.test(value.trim())) return null;
  return BigInt(value.trim());
}

function resolveScope(user: User, actorRole: CanonicalRole): { ok: true; scope: ActingScope } | { ok: false; code: ScopeFailure | 'FORBIDDEN' } {
  if (SYSTEM_SCOPE_ROLES.includes(actorRole)) return { ok: true, scope: { kind: 'SYSTEM' } };

  const sourceType = targetSourceTypeFor(actorRole);
  if (sourceType) {
    const source = user.procurement_source;
    const sourceId = parseBigIntId(source?.id);
    if (
      !source ||
      sourceId === null ||
      normalizeSourceType(source.source_type) !== sourceType ||
      source.is_active === false
    ) {
      return { ok: false, code: 'NO_SCOPE_BOUND' };
    }
    return { ok: true, scope: { kind: 'SOURCE', sourceId, sourceType } };
  }

  if (DEPARTMENT_HEAD_ROLES.some((head) => isSelfOrBelow(actorRole, head))) {
    return { ok: true, scope: { kind: 'DEPARTMENT', departments: departmentsForRole(actorRole, user.department) } };
  }

  // Every canonical role is covered above; fail closed for anything new.
  return { ok: false, code: 'FORBIDDEN' };
}

/** Checks a resource against an acting context's scope. */
export function assertResourceInScope(ctx: ActingContext, r: ResourceRef): { ok: true } | { ok: false; code: ScopeFailure } {
  const resourceType = normalizeSourceType(r.sourceType);
  const scope = ctx.scope;

  if (scope.kind === 'SYSTEM') {
    const target = targetSourceTypeFor(ctx.actingAs);
    if (resourceType && target && resourceType !== target) return { ok: false, code: 'SOURCE_TYPE_MISMATCH' };
    return { ok: true };
  }

  if (scope.kind === 'SOURCE') {
    if (r.sourceId !== null && r.sourceId !== undefined && r.sourceId !== scope.sourceId) {
      return { ok: false, code: 'OUTSIDE_SCOPE' };
    }
    if (resourceType && resourceType !== scope.sourceType) return { ok: false, code: 'SOURCE_TYPE_MISMATCH' };
    return { ok: true };
  }

  if (r.department && !scope.departments.includes(r.department)) return { ok: false, code: 'OUTSIDE_SCOPE' };
  return { ok: true };
}

/**
 * Resolves who is acting as which role, and in which scope.
 *
 * - `requestedAs` must be the actor's own role or a role below it (canActAs),
 *   else CANNOT_ACT_AS. It must also be allowed here, else FORBIDDEN.
 * - Without `requestedAs`: the actor's own role when allowed; otherwise the
 *   nearest allowed role below the actor (preferring one that works on
 *   `resource.sourceType`).
 * - Scope always comes from the actor's own role and binding.
 */
export function resolveActingContext(
  user: User,
  allowed: readonly string[],
  opts: ResolveActingContextOptions = {}
): ActingContextResult {
  const actorRole = user.role;
  if (!isCanonicalRole(actorRole)) return { ok: false, code: 'FORBIDDEN' };
  const userId = parseBigIntId(user.id);
  if (userId === null) return { ok: false, code: 'FORBIDDEN' };

  const delegation: DelegationMode = opts.delegation ?? 'ancestors';
  const allowedRoles = allowed.filter(isCanonicalRole);
  const effectiveAllowed: CanonicalRole[] =
    delegation === 'none'
      ? [...new Set<CanonicalRole>([...allowedRoles, 'SUPER_ADMIN'])]
      : expandToAncestors(allowedRoles);
  if (allowedRoles.length === 0) return { ok: false, code: 'FORBIDDEN' };

  const requestedAs = typeof opts.requestedAs === 'string' ? opts.requestedAs.trim() : '';
  let actingAs: CanonicalRole;

  if (requestedAs) {
    if (!isCanonicalRole(requestedAs) || !canActAs(actorRole, requestedAs)) {
      return { ok: false, code: 'CANNOT_ACT_AS' };
    }
    if (!effectiveAllowed.includes(requestedAs)) return { ok: false, code: 'FORBIDDEN' };
    if (delegation === 'none' && requestedAs !== actorRole && actorRole !== 'SUPER_ADMIN') {
      return { ok: false, code: 'FORBIDDEN' };
    }
    actingAs = requestedAs;
  } else {
    if (!effectiveAllowed.includes(actorRole)) return { ok: false, code: 'FORBIDDEN' };
    if (allowedRoles.includes(actorRole)) {
      actingAs = actorRole;
    } else {
      const resourceType = normalizeSourceType(opts.resource?.sourceType);
      const matching = resourceType ? allowedRoles.filter((role) => targetSourceTypeFor(role) === resourceType) : [];
      actingAs = pickActingRole(actorRole, matching) ?? pickActingRole(actorRole, allowedRoles) ?? actorRole;
    }
  }

  const scopeResult = resolveScope(user, actorRole);
  if (!scopeResult.ok) return scopeResult;

  const ctx: ActingContext = {
    userId,
    actorRole,
    actingAs,
    isDelegated: !isOutsideDelegationRules(actorRole) && actingAs !== actorRole,
    scope: scopeResult.scope,
  };

  if (opts.resource) {
    const check = assertResourceInScope(ctx, opts.resource);
    if (!check.ok) return check;
  }
  return { ok: true, ctx };
}

/** Fields for tables with a single performed-by actor. */
export function primaryActorFields(ctx: ActingContext): { performed_as_role: string; is_delegated: boolean } {
  return { performed_as_role: ctx.actingAs, is_delegated: ctx.isDelegated };
}

/** Fields `<stem>_as_role` and `<stem>_is_delegated` (e.g. stem 'tested_by'). */
export function asRoleFields<S extends string>(
  ctx: ActingContext,
  stem: S
): Record<`${S}_as_role`, string> & Record<`${S}_is_delegated`, boolean> {
  return {
    [`${stem}_as_role`]: ctx.actingAs,
    [`${stem}_is_delegated`]: ctx.isDelegated,
  } as Record<`${S}_as_role`, string> & Record<`${S}_is_delegated`, boolean>;
}
