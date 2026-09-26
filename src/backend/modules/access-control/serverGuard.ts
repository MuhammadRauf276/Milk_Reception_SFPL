import { getCurrentUser } from '@/backend/core/auth';
import type { User } from '@/backend/core/types';
import type { Capability } from './capabilities';
import { evaluateAccess, type AccessActor, type AccessDecisionReason } from './policy';
import { createAccessActor, type TrustedActorScopeContext } from './rolePolicies';
import type { ResourceScope } from './scopes';

export type AccessFailureCode =
  | 'AUTHENTICATION_REQUIRED'
  | 'UNSUPPORTED_ROLE'
  | 'MISSING_CAPABILITY'
  | 'OUTSIDE_SCOPE';

export type ServerAccessResult =
  | { allowed: true; user: User; actor: AccessActor }
  | {
      allowed: false;
      status: 401 | 403;
      code: AccessFailureCode;
      reason?: AccessDecisionReason;
    };

/**
 * Shared authorization entry point for route handlers and server components.
 * Callers remain responsible for loading trusted route/supplier assignments
 * before passing them as context.
 */
export async function requireCapability(
  capability: Capability,
  resourceScope: ResourceScope,
  options: {
    request?: Request;
    trustedScopeContext?: TrustedActorScopeContext;
  } = {}
): Promise<ServerAccessResult> {
  const user = await getCurrentUser(options.request);
  if (!user) {
    return { allowed: false, status: 401, code: 'AUTHENTICATION_REQUIRED' };
  }

  const actor = createAccessActor(user, options.trustedScopeContext);
  if (!actor) {
    return { allowed: false, status: 403, code: 'UNSUPPORTED_ROLE' };
  }

  const decision = evaluateAccess(actor, capability, resourceScope);
  if (!decision.allowed) {
    const code: AccessFailureCode =
      decision.reason === 'MISSING_CAPABILITY'
        ? 'MISSING_CAPABILITY'
        : 'OUTSIDE_SCOPE';
    return {
      allowed: false,
      status: 403,
      code,
      reason: decision.reason,
    };
  }

  return { allowed: true, user, actor };
}
