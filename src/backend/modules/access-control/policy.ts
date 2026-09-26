import type { CanonicalRole } from '@/backend/core/types';
import type { Capability } from './capabilities';
import { isWithinScope, type ActorScope, type ResourceScope } from './scopes';

export interface AccessActor {
  id: string;
  role: CanonicalRole;
  capabilities: ReadonlySet<Capability>;
  scope: ActorScope;
}

export type AccessDecisionReason =
  | 'ALLOWED'
  | 'MISSING_CAPABILITY'
  | 'OUTSIDE_SCOPE';

export interface AccessDecision {
  allowed: boolean;
  reason: AccessDecisionReason;
}

export function evaluateAccess(
  actor: AccessActor,
  capability: Capability,
  resourceScope: ResourceScope
): AccessDecision {
  // Super Admin still goes through this policy engine, while retaining complete
  // authority over every defined capability and resource scope.
  if (actor.role === 'SUPER_ADMIN') {
    return { allowed: true, reason: 'ALLOWED' };
  }

  if (!actor.capabilities.has(capability)) {
    return { allowed: false, reason: 'MISSING_CAPABILITY' };
  }

  if (!isWithinScope(actor.id, actor.scope, resourceScope)) {
    return { allowed: false, reason: 'OUTSIDE_SCOPE' };
  }

  return { allowed: true, reason: 'ALLOWED' };
}

export function can(
  actor: AccessActor,
  capability: Capability,
  resourceScope: ResourceScope
): boolean {
  return evaluateAccess(actor, capability, resourceScope).allowed;
}

