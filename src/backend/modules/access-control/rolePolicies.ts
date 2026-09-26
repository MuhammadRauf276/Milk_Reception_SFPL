import type { CanonicalRole, User } from '@/backend/core/types';
import type { Capability } from './capabilities';
import type { AccessActor } from './policy';

export type ActorScopeKind = 'SYSTEM' | 'DEPARTMENT' | 'SOURCE';

export interface RoleAccessPolicy {
  capabilities: readonly Capability[];
  scopeKind: ActorScopeKind;
}

const OPERATOR_CAPABILITIES = [
  'VIEW',
  'CREATE',
  'EDIT_DRAFT',
  'SUBMIT',
  'REQUEST_CORRECTION',
] as const satisfies readonly Capability[];

const MANAGER_CAPABILITIES = [
  'VIEW',
  'REQUEST_CORRECTION',
  'CORRECT',
  'APPROVE',
  'CLOSE',
  'VIEW_AUDIT',
] as const satisfies readonly Capability[];

/**
 * Transitional role mapping for the current application.
 *
 * It is deliberately not connected to route handlers yet. Resource-specific
 * exceptions remain in their existing guards until each vertical slice is
 * characterized and migrated.
 */
export const ROLE_ACCESS_POLICIES = {
  SUPER_ADMIN: {
    capabilities: [],
    scopeKind: 'SYSTEM',
  },
  EXECUTIVE_MANAGEMENT: {
    capabilities: ['VIEW', 'VIEW_AUDIT'],
    scopeKind: 'SYSTEM',
  },
  DATA_EXECUTIVE: {
    capabilities: ['VIEW', 'CREATE', 'EDIT_DRAFT', 'SUBMIT', 'APPROVE', 'ADMINISTER'],
    scopeKind: 'SYSTEM',
  },
  HEAD_OF_MPD: {
    capabilities: ['VIEW', 'REQUEST_CORRECTION', 'CORRECT', 'APPROVE', 'CLOSE', 'ADMINISTER', 'VIEW_AUDIT'],
    scopeKind: 'SYSTEM',
  },
  ADMIN_HEAD: {
    capabilities: ['VIEW', 'CREATE', 'EDIT_DRAFT', 'SUBMIT', 'CLOSE', 'VIEW_AUDIT'],
    scopeKind: 'DEPARTMENT',
  },
  QA_HEAD: {
    capabilities: ['VIEW', 'REQUEST_CORRECTION', 'CORRECT', 'APPROVE', 'ADMINISTER', 'VIEW_AUDIT'],
    scopeKind: 'DEPARTMENT',
  },
  PRODUCTION_HEAD: {
    capabilities: ['VIEW', 'CREATE', 'EDIT_DRAFT', 'SUBMIT', 'CLOSE', 'VIEW_AUDIT'],
    scopeKind: 'DEPARTMENT',
  },
  FINANCE_ACCOUNTS: {
    capabilities: ['VIEW', 'POST', 'VIEW_AUDIT'],
    scopeKind: 'DEPARTMENT',
  },
  ZMCC_MANAGER: {
    capabilities: MANAGER_CAPABILITIES,
    scopeKind: 'SOURCE',
  },
  CONTRACTOR_MANAGER: {
    capabilities: MANAGER_CAPABILITIES,
    scopeKind: 'SOURCE',
  },
  PHE_OPERATOR: {
    capabilities: OPERATOR_CAPABILITIES,
    scopeKind: 'SOURCE',
  },
  ZMCC_LAB_ATTENDANT: {
    capabilities: OPERATOR_CAPABILITIES,
    scopeKind: 'SOURCE',
  },
  MOT: {
    capabilities: OPERATOR_CAPABILITIES,
    scopeKind: 'SOURCE',
  },
  CONTRACTOR_OPERATOR: {
    capabilities: OPERATOR_CAPABILITIES,
    scopeKind: 'SOURCE',
  },
  SECURITY_OPERATOR: {
    capabilities: [...OPERATOR_CAPABILITIES, 'CLOSE'],
    scopeKind: 'DEPARTMENT',
  },
  QA_MANAGER: {
    capabilities: MANAGER_CAPABILITIES,
    scopeKind: 'DEPARTMENT',
  },
  QA_LAB_ATTENDANT: {
    capabilities: OPERATOR_CAPABILITIES,
    scopeKind: 'DEPARTMENT',
  },
  WEIGHBRIDGE_OPERATOR: {
    capabilities: OPERATOR_CAPABILITIES,
    scopeKind: 'DEPARTMENT',
  },
  PRODUCTION_RECEPTION_OPERATOR: {
    capabilities: OPERATOR_CAPABILITIES,
    scopeKind: 'DEPARTMENT',
  },
} as const satisfies Record<CanonicalRole, RoleAccessPolicy>;

export interface TrustedActorScopeContext {
  routeIds?: readonly string[];
  supplierIds?: readonly string[];
}

function isCanonicalRole(role: string): role is CanonicalRole {
  return Object.prototype.hasOwnProperty.call(ROLE_ACCESS_POLICIES, role);
}

/**
 * Builds an access actor only from the live database-backed User returned by
 * getCurrentUser. Extra route/supplier assignments must come from a trusted
 * server-side query, never from request payloads.
 */
export function createAccessActor(
  user: User,
  context: TrustedActorScopeContext = {}
): AccessActor | null {
  if (!isCanonicalRole(user.role)) return null;

  const policy = ROLE_ACCESS_POLICIES[user.role];
  const scope: AccessActor['scope'] = {
    routeIds: context.routeIds,
    supplierIds: context.supplierIds,
  };

  if (policy.scopeKind === 'SYSTEM') {
    scope.systemWide = true;
  } else if (policy.scopeKind === 'DEPARTMENT') {
    scope.departmentIds = user.department ? [user.department] : [];
    if (user.role === 'ADMIN_HEAD') {
      scope.departmentIds = Array.from(new Set([...scope.departmentIds, 'Security']));
    }
  } else {
    scope.sourceIds = user.procurement_source_id ? [user.procurement_source_id] : [];
  }

  return {
    id: user.id,
    role: user.role,
    capabilities: new Set(policy.capabilities),
    scope,
  };
}
