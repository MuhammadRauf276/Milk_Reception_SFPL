/**
 * Role hierarchy — single source of truth for "who sits above whom".
 *
 * Owner rule (plan §2): a user higher in the tree can do the work of any
 * user below them. The tree is stored as child → parent, so a cycle cannot
 * be written by accident and every role has at most one parent.
 *
 * This module is pure TypeScript (no Prisma / Next imports) so it can be
 * used on both server and client.
 *
 * NOTE (phase 1): nothing in the API guards uses this module yet. Wiring
 * `canActAs` into guards is phase 3. Scope checks (own ZMCC, own contractor,
 * own department) are NOT part of this module — callers must still apply them.
 */
import type { CanonicalRole } from '../types';

/**
 * Parent of each canonical role. `null` marks the root (Super Admin).
 *
 * Super Admin ─┬─ Senior Exec Mgmt
 *              ├─ Data Executive
 *              ├─ Finance & Accounts
 *              ├─ MPD Head ─┬─ Contractor Manager ── Contractor Operator
 *              │            └─ Zonal Manager ─┬─ PHE Operator
 *              │                              ├─ MDO
 *              │                              ├─ Zonal Lab Attendant
 *              │                              └─ Mobile Tester
 *              ├─ Admin Head ── Admin Operator
 *              ├─ AVP-QA ─┬─ QAE Reception Lab
 *              │          └─ QA Manager (retiring, see TODO)
 *              └─ Production Head ─┬─ Weighbridge Operator
 *                                  └─ Production Reception Operator
 */
export const ROLE_PARENT = {
  SUPER_ADMIN: null,

  EXECUTIVE_MANAGEMENT: 'SUPER_ADMIN',
  DATA_EXECUTIVE: 'SUPER_ADMIN',
  FINANCE_ACCOUNTS: 'SUPER_ADMIN',
  HEAD_OF_MPD: 'SUPER_ADMIN',
  ADMIN_HEAD: 'SUPER_ADMIN',
  QA_HEAD: 'SUPER_ADMIN',
  PRODUCTION_HEAD: 'SUPER_ADMIN',

  CONTRACTOR_MANAGER: 'HEAD_OF_MPD',
  ZMCC_MANAGER: 'HEAD_OF_MPD',

  CONTRACTOR_OPERATOR: 'CONTRACTOR_MANAGER',

  PHE_OPERATOR: 'ZMCC_MANAGER',
  MDO: 'ZMCC_MANAGER',
  ZMCC_LAB_ATTENDANT: 'ZMCC_MANAGER',
  MOT: 'ZMCC_MANAGER',

  SECURITY_OPERATOR: 'ADMIN_HEAD',

  QA_LAB_ATTENDANT: 'QA_HEAD',
  // TODO(phase 6): QA_MANAGER is retired in phase 6. It stays canonical until
  // then; remove this entry when the code moves to `RetiredRole`.
  QA_MANAGER: 'QA_HEAD',

  WEIGHBRIDGE_OPERATOR: 'PRODUCTION_HEAD',
  PRODUCTION_RECEPTION_OPERATOR: 'PRODUCTION_HEAD',
} as const satisfies Record<CanonicalRole, CanonicalRole | null>;

/** All canonical roles, in the declaration order of ROLE_PARENT. */
export const CANONICAL_ROLES = Object.keys(ROLE_PARENT) as CanonicalRole[];

/**
 * Field users (plan §17): people who do the physical work. Used later for
 * device-bound login and hidden logout. Not used for permission checks.
 */
export const FIELD_ROLES = [
  'MOT',
  'PHE_OPERATOR',
  'MDO',
  'ZMCC_LAB_ATTENDANT',
  'CONTRACTOR_OPERATOR',
  'SECURITY_OPERATOR',
  'QA_LAB_ATTENDANT',
  'WEIGHBRIDGE_OPERATOR',
  'PRODUCTION_RECEPTION_OPERATOR',
] as const satisfies readonly CanonicalRole[];

export type FieldRole = (typeof FIELD_ROLES)[number];

export function isCanonicalRole(role: unknown): role is CanonicalRole {
  return typeof role === 'string' && Object.prototype.hasOwnProperty.call(ROLE_PARENT, role);
}

export function isFieldRole(role: unknown): role is FieldRole {
  return typeof role === 'string' && (FIELD_ROLES as readonly string[]).includes(role);
}

/**
 * Super Admin and Data Executive are outside the delegation / exception rules
 * (plan §14): no "covered work" tags, no reports, no escalation.
 */
export function isOutsideDelegationRules(role: unknown): boolean {
  return role === 'SUPER_ADMIN' || role === 'DATA_EXECUTIVE';
}

export function getParentRole(role: string): CanonicalRole | null {
  if (!isCanonicalRole(role)) return null;
  return ROLE_PARENT[role];
}

/** Ancestors of a role, nearest first (parent, grandparent, …, root). */
export function getAncestorRoles(role: string): CanonicalRole[] {
  const ancestors: CanonicalRole[] = [];
  let current = getParentRole(role);
  // Guard against a malformed map: never loop more than the number of roles.
  while (current && ancestors.length <= CANONICAL_ROLES.length) {
    ancestors.push(current);
    current = ROLE_PARENT[current];
  }
  return ancestors;
}

const CHILDREN_BY_ROLE: ReadonlyMap<CanonicalRole, readonly CanonicalRole[]> = (() => {
  const map = new Map<CanonicalRole, CanonicalRole[]>();
  for (const role of CANONICAL_ROLES) map.set(role, []);
  for (const role of CANONICAL_ROLES) {
    const parent = ROLE_PARENT[role];
    if (parent) map.get(parent)!.push(role);
  }
  return map;
})();

/** Direct children of a role (one level down). */
export function getChildRoles(role: string): CanonicalRole[] {
  if (!isCanonicalRole(role)) return [];
  return [...(CHILDREN_BY_ROLE.get(role) ?? [])];
}

/** All roles below a role, breadth-first (nearest first). Excludes the role itself. */
export function getDescendantRoles(role: string): CanonicalRole[] {
  if (!isCanonicalRole(role)) return [];
  const result: CanonicalRole[] = [];
  const seen = new Set<CanonicalRole>([role]);
  const queue: CanonicalRole[] = [...(CHILDREN_BY_ROLE.get(role) ?? [])];
  while (queue.length > 0) {
    const next = queue.shift()!;
    if (seen.has(next)) continue;
    seen.add(next);
    result.push(next);
    queue.push(...(CHILDREN_BY_ROLE.get(next) ?? []));
  }
  return result;
}

/**
 * True when `actor` may do the work of `target`: same role, or `target` is
 * below `actor` in the tree. Unknown roles always return false.
 *
 * This is a role check only. The caller must still check scope
 * (own ZMCC / own contractor / own department).
 */
export function canActAs(actor: string, target: string): boolean {
  if (!isCanonicalRole(actor) || !isCanonicalRole(target)) return false;
  if (actor === target) return true;
  return getAncestorRoles(target).includes(actor);
}

/**
 * Widens a list of allowed roles with every ancestor of each role.
 * Result keeps input order first, then ancestors (nearest first), without
 * duplicates. Unknown roles are dropped.
 */
export function expandToAncestors(roles: readonly string[]): CanonicalRole[] {
  const result: CanonicalRole[] = [];
  const seen = new Set<CanonicalRole>();
  const add = (role: CanonicalRole) => {
    if (!seen.has(role)) {
      seen.add(role);
      result.push(role);
    }
  };
  for (const role of roles) {
    if (isCanonicalRole(role)) add(role);
  }
  for (const role of roles) {
    if (isCanonicalRole(role)) getAncestorRoles(role).forEach(add);
  }
  return result;
}

/**
 * Chooses which of `candidates` the actor is working as.
 * - The actor's own role wins when it is a candidate.
 * - Otherwise the nearest role below the actor wins (fewest levels down);
 *   ties keep the order of `candidates`.
 * - Returns null when the actor can act as none of them.
 */
export function pickActingRole(actor: string, candidates: readonly string[]): CanonicalRole | null {
  if (!isCanonicalRole(actor)) return null;
  let best: CanonicalRole | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    if (!isCanonicalRole(candidate) || !canActAs(actor, candidate)) continue;
    const distance = candidate === actor ? 0 : getAncestorRoles(candidate).indexOf(actor) + 1;
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * ZMCC field officers who share the PHE station tools (route request, shop
 * approval, MOT assign & dispatch, HC create, arrival/weighing).
 * MDO mirrors PHE_OPERATOR until phase 4 moves route/shop/MOT dispatch to MDO.
 */
export function isZmccFieldOfficer(role: unknown): role is 'PHE_OPERATOR' | 'MDO' {
  return role === 'PHE_OPERATOR' || role === 'MDO';
}
