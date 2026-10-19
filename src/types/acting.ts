// Shared types for acting-as (delegation) context: who is acting, for which role, and within which scope.
import type { CanonicalRole } from '@/backend/core/types';

export type DelegationMode = 'ancestors' | 'none';

export type ScopeFailure = 'OUTSIDE_SCOPE' | 'SOURCE_TYPE_MISMATCH' | 'NO_SCOPE_BOUND' | 'CANNOT_ACT_AS';

export type ActingScope =
  | { kind: 'SYSTEM' }
  | { kind: 'SOURCE'; sourceId: bigint; sourceType: 'ZMCC' | 'CONTRACTOR' }
  | { kind: 'DEPARTMENT'; departments: readonly string[] };

export interface ActingContext {
  userId: bigint;
  actorRole: CanonicalRole;
  actingAs: CanonicalRole;
  // false when actingAs === actorRole, or when the actor is SUPER_ADMIN / DATA_EXECUTIVE
  isDelegated: boolean;
  scope: ActingScope;
}

export interface ResourceRef {
  sourceId?: bigint | null;
  sourceType?: string | null;
  department?: string | null;
}
