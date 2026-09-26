export {
  ALL_CAPABILITIES,
  CAPABILITIES,
  type Capability,
} from './capabilities';
export {
  isWithinScope,
  type ActorScope,
  type ResourceScope,
} from './scopes';
export {
  can,
  evaluateAccess,
  type AccessActor,
  type AccessDecision,
  type AccessDecisionReason,
} from './policy';
export {
  ROLE_ACCESS_POLICIES,
  createAccessActor,
  type ActorScopeKind,
  type RoleAccessPolicy,
  type TrustedActorScopeContext,
} from './rolePolicies';
export {
  requireCapability,
  type AccessFailureCode,
  type ServerAccessResult,
} from './serverGuard';
