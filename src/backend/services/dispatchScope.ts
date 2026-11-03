/**
 * Dispatch source scope (Phase 3): which procurement source a dispatch may be
 * started / submitted / listed for, and which operational logs a user may read.
 *
 * Pure logic (no Prisma / Next imports) so it can be unit tested. Routes load
 * the source row and pass it in.
 */
import type { User } from '../core/types';
import type { ActingContext, ActingScope, ScopeFailure } from '../../types/acting';
import { resolveActingContext, targetSourceTypeFor, type ActingContextResult } from '../core/acting-context';
import { canActAs, isCanonicalRole } from '../core/roles/hierarchy';

/** Roles whose work is starting / submitting a dispatch. Roles above them pass through delegation. */
export const DISPATCH_WRITE_ROLES = ['ZMCC_LAB_ATTENDANT', 'CONTRACTOR_OPERATOR'] as const;

/** Roles that may list dispatches: dispatch roles (and above) plus system-wide readers. */
export const DISPATCH_READ_ROLES = [
  ...DISPATCH_WRITE_ROLES,
  'DATA_EXECUTIVE',
  'EXECUTIVE_MANAGEMENT',
  'FINANCE_ACCOUNTS',
] as const;

export type DispatchSourceFailure = ScopeFailure | 'SOURCE_REQUIRED' | 'SOURCE_INVALID' | 'SOURCE_NOT_FOUND' | 'SOURCE_INACTIVE';

export type DispatchSourceCheck =
  | { ok: true; sourceId: bigint; sourceType: 'ZMCC' | 'CONTRACTOR' }
  | { ok: false; code: DispatchSourceFailure };

/** The source row a route loads for the check. */
export interface DispatchSourceRow {
  id: bigint;
  source_type: string | null;
  is_active: boolean;
}

export const DISPATCH_SOURCE_FAILURE_MESSAGES: Record<Exclude<DispatchSourceFailure, ScopeFailure>, string> = {
  SOURCE_REQUIRED: 'Please choose the procurement source.',
  SOURCE_INVALID: 'The procurement source is not valid.',
  SOURCE_NOT_FOUND: 'The procurement source does not exist.',
  SOURCE_INACTIVE: 'The procurement source is inactive.',
};

const SCOPE_FAILURES: readonly string[] = ['OUTSIDE_SCOPE', 'SOURCE_TYPE_MISMATCH', 'NO_SCOPE_BOUND', 'CANNOT_ACT_AS'];

export function isScopeFailure(code: string): code is ScopeFailure {
  return SCOPE_FAILURES.includes(code);
}

function parseSourceId(value: string | bigint | null | undefined): bigint | null | 'INVALID' {
  if (value === null || value === undefined) return null;
  if (typeof value === 'bigint') return value;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^\d+$/.test(trimmed)) return 'INVALID';
  return BigInt(trimmed);
}

function normalizeSourceType(value: string | null | undefined): string | null {
  const trimmed = typeof value === 'string' ? value.trim().toUpperCase() : '';
  return trimmed || null;
}

/**
 * Which source row the route must load. SOURCE scope: always the bound
 * source (another requested id is OUTSIDE_SCOPE). SYSTEM scope: the requested
 * id (required). DEPARTMENT scope never dispatches.
 */
export function dispatchSourceIdToLoad(
  scope: ActingScope,
  requestedSourceId: string | bigint | null | undefined
): { ok: true; sourceId: bigint } | { ok: false; code: DispatchSourceFailure } {
  const requested = parseSourceId(requestedSourceId);
  if (requested === 'INVALID') return { ok: false, code: 'SOURCE_INVALID' };
  if (scope.kind === 'SOURCE') {
    if (requested !== null && requested !== scope.sourceId) return { ok: false, code: 'OUTSIDE_SCOPE' };
    return { ok: true, sourceId: scope.sourceId };
  }
  if (scope.kind === 'SYSTEM') {
    if (requested === null) return { ok: false, code: 'SOURCE_REQUIRED' };
    return { ok: true, sourceId: requested };
  }
  return { ok: false, code: 'OUTSIDE_SCOPE' };
}

/**
 * Checks the source a dispatch is for against the acting context.
 * - SOURCE scope: forced to the bound source; a different requested id is OUTSIDE_SCOPE.
 * - SYSTEM scope (Super Admin included): a requested source is required.
 * - The source must exist, be active, and its type must be the acting role's
 *   target type (ZMCC_LAB_ATTENDANT → ZMCC, CONTRACTOR_OPERATOR → CONTRACTOR).
 */
export function checkDispatchSource(
  ctx: ActingContext,
  requestedSourceId: string | bigint | null | undefined,
  source: DispatchSourceRow | null | undefined
): DispatchSourceCheck {
  const target = dispatchSourceIdToLoad(ctx.scope, requestedSourceId);
  if (!target.ok) return target;
  if (!source) return { ok: false, code: 'SOURCE_NOT_FOUND' };
  if (source.id !== target.sourceId) return { ok: false, code: 'OUTSIDE_SCOPE' };
  if (!source.is_active) return { ok: false, code: 'SOURCE_INACTIVE' };

  const expectedType = targetSourceTypeFor(ctx.actingAs);
  const sourceType = normalizeSourceType(source.source_type);
  if (!expectedType || sourceType !== expectedType) return { ok: false, code: 'SOURCE_TYPE_MISMATCH' };
  if (ctx.scope.kind === 'SOURCE' && ctx.scope.sourceType !== expectedType) {
    return { ok: false, code: 'SOURCE_TYPE_MISMATCH' };
  }
  return { ok: true, sourceId: source.id, sourceType: expectedType };
}

/**
 * Re-resolves the acting role once the source is known, so a superior who did
 * not ask for a role (e.g. Super Admin, MPD Head) acts as the dispatch role
 * that works on this source type.
 */
export function resolveDispatchActing(
  user: User,
  requestedAs: string | null | undefined,
  sourceType: string | null | undefined
): ActingContextResult {
  return resolveActingContext(user, DISPATCH_WRITE_ROLES, {
    requestedAs: requestedAs ?? null,
    resource: sourceType ? { sourceType } : undefined,
  });
}

/** Source filter for listing dispatches. */
export type DispatchListFilter = { kind: 'ALL' } | { kind: 'SOURCE'; sourceId: bigint } | { kind: 'NONE' };

/**
 * SOURCE scope: only the bound source (query param ignored). SYSTEM scope:
 * everything, or the requested source. DEPARTMENT scope: nothing.
 */
export function dispatchListFilter(scope: ActingScope, requestedSourceId?: string | null): DispatchListFilter {
  if (scope.kind === 'SOURCE') return { kind: 'SOURCE', sourceId: scope.sourceId };
  if (scope.kind === 'SYSTEM') {
    const requested = parseSourceId(requestedSourceId);
    if (requested === 'INVALID') return { kind: 'NONE' };
    return requested === null ? { kind: 'ALL' } : { kind: 'SOURCE', sourceId: requested };
  }
  return { kind: 'NONE' };
}

/** Which operational logs a reader may see. */
export type OperationalReadScope =
  | { kind: 'ALL' }
  | { kind: 'SOURCE'; sourceId: bigint; sourceType: 'ZMCC' | 'CONTRACTOR' }
  | { kind: 'NONE' };

/** Read scope from an acting context's scope. Department users read plant-wide logs. */
export function operationalReadScopeFromActing(scope: ActingScope): OperationalReadScope {
  if (scope.kind === 'SOURCE') return { kind: 'SOURCE', sourceId: scope.sourceId, sourceType: scope.sourceType };
  return { kind: 'ALL' };
}

/**
 * Read scope for a user, failing closed:
 * - no user, or a role that is not canonical → NONE;
 * - a source-scoped role (Zonal Manager / Contractor Manager and below) → own source only, NONE when unbound;
 * - every other canonical role (system-wide and plant department roles) → ALL.
 */
export function operationalReadScopeForUser(
  user: Pick<User, 'role' | 'procurement_source_id'> | null | undefined
): OperationalReadScope {
  if (!user || !isCanonicalRole(user.role)) return { kind: 'NONE' };
  const sourceType = targetSourceTypeFor(user.role);
  if (sourceType) {
    const sourceId = parseSourceId(user.procurement_source_id);
    if (sourceId === null || sourceId === 'INVALID') return { kind: 'NONE' };
    return { kind: 'SOURCE', sourceId, sourceType };
  }
  return { kind: 'ALL' };
}

/** Phase 4c: dispatch test point for a source type (matrix column). */
export type DispatchPoint = 'ZMCC_DISPATCH' | 'CONTRACTOR_DISPATCH';

export function dispatchPointFor(sourceType: 'ZMCC' | 'CONTRACTOR'): DispatchPoint {
  return sourceType === 'CONTRACTOR' ? 'CONTRACTOR_DISPATCH' : 'ZMCC_DISPATCH';
}

/** Who answers a dispatch "Send request": Zonal Manager for ZMCC, Contractor Manager for contractor (superiors too). */
export type DispatchApproverRole = 'ZMCC_MANAGER' | 'CONTRACTOR_MANAGER';

export function dispatchApproverRoleFor(sourceType: 'ZMCC' | 'CONTRACTOR'): DispatchApproverRole {
  return sourceType === 'CONTRACTOR' ? 'CONTRACTOR_MANAGER' : 'ZMCC_MANAGER';
}

/** Roles that may open the dispatch approval queue (approvers + their superiors; Data Executive read-only). */
export const DISPATCH_APPROVAL_READ_ROLES = ['ZMCC_MANAGER', 'CONTRACTOR_MANAGER', 'DATA_EXECUTIVE'] as const;

/**
 * "If you can approve it, you can decide it": the actor may answer a dispatch request of this
 * source type. Super Admin and Data Executive (its right hand) decide everything below them.
 */
export function canDecideDispatch(actorRole: string, sourceType: 'ZMCC' | 'CONTRACTOR'): boolean {
  return canActAs(actorRole, dispatchApproverRoleFor(sourceType));
}
