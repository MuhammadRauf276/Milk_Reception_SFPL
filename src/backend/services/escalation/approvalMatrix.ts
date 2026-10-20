/**
 * Centralized Approval Matrix & Segregation of Duties Engine
 * WORKFLOW_ALIGNMENT_PLAN.md (§2.2, §4.4, §8, §14)
 *
 * Single source of truth for:
 * - Authoritative approver roles per approval type across Stages 1–4.
 * - Supervisor auto-escalation (one level up when superior performs subordinate work).
 * - Segregation of duties (strict prohibition of self-approval, except Super Admin with >=20 char justification).
 * - Read-only auditing permissions (e.g. Data Executive).
 */

import type { CanonicalRole } from '@/backend/core/types';
import {
  canActAs,
  getParentRole,
  isCanonicalRole,
} from '@/backend/core/roles/hierarchy';
import { getRoleLabel } from '@/backend/core/roles/labels';

export type OperationalStage = 'STAGE_1' | 'STAGE_2' | 'STAGE_3' | 'STAGE_4';

export type ApprovalType =
  | 'STAGE_1_SHOP_EXCEPTION'
  | 'STAGE_1_NEW_SHOP'
  | 'STAGE_1_NEW_ROUTE'
  | 'STAGE_2_PORTION_EXCEPTION'
  | 'STAGE_2_NEW_HC'
  | 'STAGE_3_ZMCC_DISPATCH_EXCEPTION'
  | 'STAGE_3_CONTRACTOR_DISPATCH_EXCEPTION'
  | 'STAGE_4_PORTION_EXCEPTION'
  | 'NEW_SOURCE'
  | 'SOURCE_ALLOCATION'
  | 'REJECTED_MILK_REMARKS';

export type ScopeKind = 'ZMCC' | 'CONTRACTOR' | 'SYSTEM';

export interface ApprovalTypeDefinition {
  type: ApprovalType;
  stage: OperationalStage;
  label: string;
  defaultApproverRole: CanonicalRole;
  scopeKind: ScopeKind;
  autoApproveRoles?: readonly CanonicalRole[];
}

export const APPROVAL_TYPE_DEFINITIONS: Record<ApprovalType, ApprovalTypeDefinition> = {
  STAGE_1_SHOP_EXCEPTION: {
    type: 'STAGE_1_SHOP_EXCEPTION',
    stage: 'STAGE_1',
    label: 'Stage 1 Shop Exception',
    defaultApproverRole: 'ZMCC_MANAGER',
    scopeKind: 'ZMCC',
  },
  STAGE_1_NEW_SHOP: {
    type: 'STAGE_1_NEW_SHOP',
    stage: 'STAGE_1',
    label: 'Stage 1 New Shop Request',
    defaultApproverRole: 'MDO',
    scopeKind: 'ZMCC',
  },
  STAGE_1_NEW_ROUTE: {
    type: 'STAGE_1_NEW_ROUTE',
    stage: 'STAGE_1',
    label: 'Stage 1 New Route Request',
    defaultApproverRole: 'ZMCC_MANAGER',
    scopeKind: 'ZMCC',
    autoApproveRoles: ['ZMCC_MANAGER', 'HEAD_OF_MPD', 'SUPER_ADMIN'],
  },
  STAGE_2_PORTION_EXCEPTION: {
    type: 'STAGE_2_PORTION_EXCEPTION',
    stage: 'STAGE_2',
    label: 'Stage 2 Lab Portion Exception',
    defaultApproverRole: 'ZMCC_MANAGER',
    scopeKind: 'ZMCC',
  },
  STAGE_2_NEW_HC: {
    type: 'STAGE_2_NEW_HC',
    stage: 'STAGE_2',
    label: 'Stage 2 New HC Request',
    defaultApproverRole: 'ZMCC_MANAGER',
    scopeKind: 'ZMCC',
    autoApproveRoles: ['ZMCC_MANAGER', 'HEAD_OF_MPD', 'SUPER_ADMIN'],
  },
  STAGE_3_ZMCC_DISPATCH_EXCEPTION: {
    type: 'STAGE_3_ZMCC_DISPATCH_EXCEPTION',
    stage: 'STAGE_3',
    label: 'Stage 3 ZMCC Dispatch Exception',
    defaultApproverRole: 'ZMCC_MANAGER',
    scopeKind: 'ZMCC',
  },
  STAGE_3_CONTRACTOR_DISPATCH_EXCEPTION: {
    type: 'STAGE_3_CONTRACTOR_DISPATCH_EXCEPTION',
    stage: 'STAGE_3',
    label: 'Stage 3 Contractor Dispatch Exception',
    defaultApproverRole: 'CONTRACTOR_MANAGER',
    scopeKind: 'CONTRACTOR',
  },
  STAGE_4_PORTION_EXCEPTION: {
    type: 'STAGE_4_PORTION_EXCEPTION',
    stage: 'STAGE_4',
    label: 'Stage 4 Plant Portion Exception',
    defaultApproverRole: 'QA_HEAD',
    scopeKind: 'SYSTEM',
  },
  NEW_SOURCE: {
    type: 'NEW_SOURCE',
    stage: 'STAGE_1',
    label: 'New Source Request',
    defaultApproverRole: 'HEAD_OF_MPD',
    scopeKind: 'SYSTEM',
  },
  SOURCE_ALLOCATION: {
    type: 'SOURCE_ALLOCATION',
    stage: 'STAGE_2',
    label: 'Source Allocation',
    defaultApproverRole: 'HEAD_OF_MPD',
    scopeKind: 'SYSTEM',
  },
  REJECTED_MILK_REMARKS: {
    type: 'REJECTED_MILK_REMARKS',
    stage: 'STAGE_2',
    label: 'Rejected Milk Remarks',
    defaultApproverRole: 'HEAD_OF_MPD',
    scopeKind: 'SYSTEM',
  },
};

/**
 * Resolves the authoritative approver role for an item.
 *
 * Supervisor Auto-Escalation Rule:
 * If a superior performed the subordinate work (e.g., Zonal Manager performed lab/dispatch
 * work and triggered an exception), route the exception ONE LEVEL UP in the hierarchy.
 *
 * - Normal MOT exception: submitter is MOT -> approver is ZMCC_MANAGER.
 * - Zonal Manager performed lab work: submitter is ZMCC_MANAGER
 *   -> routes one level up: ROLE_PARENT['ZMCC_MANAGER'] = 'HEAD_OF_MPD'.
 * - Contractor Manager performed dispatch work: submitter is CONTRACTOR_MANAGER
 *   -> routes one level up: ROLE_PARENT['CONTRACTOR_MANAGER'] = 'HEAD_OF_MPD'.
 * - AVP-QA performed QAE work: submitter is QA_HEAD
 *   -> routes one level up: ROLE_PARENT['QA_HEAD'] = 'SUPER_ADMIN'.
 * - MPD Head performed work -> routes to 'SUPER_ADMIN'.
 */
export function resolveAuthoritativeApproverRole(
  approvalType: ApprovalType,
  submitterRole?: string | null
): { approverRole: CanonicalRole; isEscalated: boolean; originalApproverRole: CanonicalRole } {
  const def = APPROVAL_TYPE_DEFINITIONS[approvalType];
  const originalApproverRole = def.defaultApproverRole;

  if (!submitterRole || !isCanonicalRole(submitterRole)) {
    return { approverRole: originalApproverRole, isEscalated: false, originalApproverRole };
  }

  // If submitter can act as (is at or above) the default approver role,
  // they cannot approve their own level, so escalate one level up from submitter's role.
  if (canActAs(submitterRole, originalApproverRole)) {
    const parent = getParentRole(submitterRole);
    const escalatedRole: CanonicalRole = parent ?? 'SUPER_ADMIN';
    return {
      approverRole: escalatedRole,
      isEscalated: escalatedRole !== originalApproverRole,
      originalApproverRole,
    };
  }

  return { approverRole: originalApproverRole, isEscalated: false, originalApproverRole };
}

/**
 * True if item is auto-approved upon creation by this role (e.g. routes/HCs created by ZM or higher).
 */
export function isAutoApproved(approvalType: ApprovalType, creatorRole?: string | null): boolean {
  if (!creatorRole || !isCanonicalRole(creatorRole)) return false;
  const def = APPROVAL_TYPE_DEFINITIONS[approvalType];
  if (!def.autoApproveRoles) return false;
  return def.autoApproveRoles.some((r) => canActAs(creatorRole, r));
}

export interface ApprovalActor {
  userId: bigint | string;
  role: CanonicalRole | string;
  procurementSourceId?: bigint | string | null;
  contractorId?: bigint | string | null;
}

export interface ApprovalItemContext {
  approvalType: ApprovalType;
  submittedByUserId?: bigint | string | null;
  submitterRole?: string | null;
  zmccId?: bigint | string | null;
  contractorId?: bigint | string | null;
}

export interface CanDecideResult {
  allowed: boolean;
  disabledReason?: string;
  isSelfApproval: boolean;
  isEscalated: boolean;
  targetApproverRole: CanonicalRole;
  requiresExtendedRemarks?: boolean;
}

/**
 * Checks whether an actor can decide an approval item, strictly enforcing
 * segregation of duties, role authority, scope containment, and supervisor auto-escalation.
 */
export function canDecideApproval(
  actor: ApprovalActor,
  item: ApprovalItemContext,
  remarks?: string | null
): CanDecideResult {
  const def = APPROVAL_TYPE_DEFINITIONS[item.approvalType];
  if (!def) {
    return {
      allowed: false,
      disabledReason: 'Unknown approval type.',
      isSelfApproval: false,
      isEscalated: false,
      targetApproverRole: 'SUPER_ADMIN',
    };
  }

  // 1. Data Executive can view and audit all queues but can NEVER decide.
  if (actor.role === 'DATA_EXECUTIVE') {
    return {
      allowed: false,
      disabledReason: 'Data Executive can view and audit all queues but cannot decide approvals.',
      isSelfApproval: false,
      isEscalated: false,
      targetApproverRole: def.defaultApproverRole,
    };
  }

  // 2. Resolve authoritative approver role with supervisor auto-escalation.
  const { approverRole: targetApproverRole, isEscalated } = resolveAuthoritativeApproverRole(
    item.approvalType,
    item.submitterRole
  );

  // 3. Role authority check: actor must be at or above targetApproverRole.
  if (!isCanonicalRole(actor.role) || !canActAs(actor.role, targetApproverRole)) {
    const targetLabel = getRoleLabel(targetApproverRole);
    return {
      allowed: false,
      disabledReason: `Requires ${targetLabel} authority or above.`,
      isSelfApproval: false,
      isEscalated,
      targetApproverRole,
    };
  }

  // 4. Scope containment check.
  // ZMCC-scoped roles (e.g. ZMCC_MANAGER) must match the item's ZMCC.
  // Higher roles (HEAD_OF_MPD, SUPER_ADMIN) have system scope.
  if (def.scopeKind === 'ZMCC') {
    const actorRole = actor.role as CanonicalRole;
    if (actorRole === 'ZMCC_MANAGER' || actorRole === 'MDO' || actorRole === 'PHE_OPERATOR') {
      if (
        actor.procurementSourceId &&
        item.zmccId &&
        String(actor.procurementSourceId) !== String(item.zmccId)
      ) {
        return {
          allowed: false,
          disabledReason: 'This approval is outside your assigned ZMCC.',
          isSelfApproval: false,
          isEscalated,
          targetApproverRole,
        };
      }
    }
  }

  // Contractor-scoped roles (e.g. CONTRACTOR_MANAGER) must match contractor.
  if (def.scopeKind === 'CONTRACTOR') {
    const actorRole = actor.role as CanonicalRole;
    if (actorRole === 'CONTRACTOR_MANAGER' || actorRole === 'CONTRACTOR_OPERATOR') {
      const actorScope = actor.contractorId ?? actor.procurementSourceId;
      if (actorScope && item.contractorId && String(actorScope) !== String(item.contractorId)) {
        return {
          allowed: false,
          disabledReason: 'This approval is outside your assigned contractor.',
          isSelfApproval: false,
          isEscalated,
          targetApproverRole,
        };
      }
    }
  }

  // 5. Segregation of Duties Check: Submitter cannot approve their own item.
  const isSelf = Boolean(
    item.submittedByUserId &&
      String(actor.userId) === String(item.submittedByUserId)
  );

  if (isSelf) {
    // Super Admin self-approval exception:
    // Permitted ONLY with mandatory remarks >= 20 chars, flagged self_approved: true.
    if (actor.role === 'SUPER_ADMIN') {
      const trimmedRemarks = (remarks ?? '').trim();
      if (trimmedRemarks.length < 20) {
        return {
          allowed: false,
          disabledReason:
            'Super Admin self-approval requires mandatory justification remarks of at least 20 characters.',
          isSelfApproval: true,
          isEscalated,
          targetApproverRole,
          requiresExtendedRemarks: true,
        };
      }
      return {
        allowed: true,
        isSelfApproval: true,
        isEscalated,
        targetApproverRole,
        requiresExtendedRemarks: true,
      };
    }

    const supervisorLabel = getRoleLabel(targetApproverRole);
    return {
      allowed: false,
      disabledReason: `You submitted this — routed to ${supervisorLabel}`,
      isSelfApproval: true,
      isEscalated,
      targetApproverRole,
    };
  }

  return {
    allowed: true,
    isSelfApproval: false,
    isEscalated,
    targetApproverRole,
  };
}

// -------------------------------------------------------------------------------------------------
// Legacy Escalation Matrix Compatibility
// (Maintains compatibility with any existing tests or legacy references)
// -------------------------------------------------------------------------------------------------

export interface EscalationTier {
  role: string;
  roleTitle: string;
}

export interface DepartmentEscalationChain {
  department: string;
  stageName: string;
  tiers: EscalationTier[];
}

export const DEPARTMENT_ESCALATION_CHAINS: Record<string, DepartmentEscalationChain> = {
  PLANT_QA: {
    department: 'Plant QA Division',
    stageName: 'Plant QA Reception',
    tiers: [
      { role: 'QA_LAB_ATTENDANT', roleTitle: 'QAE, Reception Lab' },
      { role: 'QA_HEAD', roleTitle: 'AVP, QA Reception Lab' },
      { role: 'SUPER_ADMIN', roleTitle: 'Super Admin' },
    ],
  },
  ZMCC_LAB: {
    department: 'Milk Procurement Division (Field & ZMCC)',
    stageName: 'ZMCC Intake Lab',
    tiers: [
      { role: 'ZMCC_LAB_ATTENDANT', roleTitle: 'ZMCC Lab Attendant' },
      { role: 'ZMCC_MANAGER', roleTitle: 'ZMCC Manager' },
      { role: 'HEAD_OF_MPD', roleTitle: 'MPD Head' },
    ],
  },
  ZMCC_PHE: {
    department: 'Milk Procurement Division (Field & ZMCC)',
    stageName: 'ZMCC Reception / Dispatch',
    tiers: [
      { role: 'PHE_OPERATOR', roleTitle: 'PHE Operator' },
      { role: 'ZMCC_MANAGER', roleTitle: 'ZMCC Manager' },
      { role: 'HEAD_OF_MPD', roleTitle: 'MPD Head' },
    ],
  },
  MOT_SHOP: {
    department: 'Milk Procurement Division (Field & ZMCC)',
    stageName: 'MOT Shop Collection',
    tiers: [
      { role: 'MOT', roleTitle: 'Mobile Tester (MOT)' },
      { role: 'ZMCC_MANAGER', roleTitle: 'ZMCC Manager' },
      { role: 'HEAD_OF_MPD', roleTitle: 'MPD Head' },
    ],
  },
  CONTRACTOR: {
    department: 'Milk Procurement Division (Field & ZMCC)',
    stageName: 'Contractor Operations',
    tiers: [
      { role: 'CONTRACTOR_OPERATOR', roleTitle: 'Contractor Operator' },
      { role: 'CONTRACTOR_MANAGER', roleTitle: 'Contractor Manager' },
      { role: 'HEAD_OF_MPD', roleTitle: 'MPD Head' },
    ],
  },
  PRODUCTION_WEIGHBRIDGE: {
    department: 'Plant Production Division',
    stageName: 'Plant Weighbridge',
    tiers: [
      { role: 'WEIGHBRIDGE_OPERATOR', roleTitle: 'Weighbridge Operator' },
      { role: 'PRODUCTION_HEAD', roleTitle: 'Production Head' },
    ],
  },
  PRODUCTION_SILOS: {
    department: 'Plant Production Division',
    stageName: 'Plant Silo Offloading',
    tiers: [
      { role: 'PRODUCTION_RECEPTION_OPERATOR', roleTitle: 'Production Reception Operator (Silos)' },
      { role: 'PRODUCTION_HEAD', roleTitle: 'Production Head' },
    ],
  },
};

export function getEscalationAuthority(originatingRole: string): {
  directDecision: EscalationTier | null;
  higherEscalation: EscalationTier | null;
} {
  for (const chain of Object.values(DEPARTMENT_ESCALATION_CHAINS)) {
    const idx = chain.tiers.findIndex((t) => t.role === originatingRole);
    if (idx !== -1) {
      const directDecision = chain.tiers[idx + 1] || null;
      const higherEscalation = chain.tiers[idx + 2] || null;
      return { directDecision, higherEscalation };
    }
  }
  return { directDecision: null, higherEscalation: null };
}
