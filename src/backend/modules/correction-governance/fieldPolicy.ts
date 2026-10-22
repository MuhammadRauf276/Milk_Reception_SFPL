import type { CorrectionImpact, CorrectionModule, RecordLifecycle } from './domain';

export interface CorrectionFieldRule {
  field: string;
  impact: CorrectionImpact;
  directEditUntil: readonly RecordLifecycle[];
  requiresHeadApproval: boolean;
  recalculationRequired: boolean;
}

export const CORRECTION_FIELD_POLICY: Readonly<Record<CorrectionModule, readonly CorrectionFieldRule[]>> = {
  ZMCC_LAB_SESSION: [
    { field: 'remarks', impact: 'LOW', directEditUntil: ['DRAFT'], requiresHeadApproval: false, recalculationRequired: false },
    { field: 'rejection_reason', impact: 'MEDIUM', directEditUntil: ['DRAFT'], requiresHeadApproval: false, recalculationRequired: false },
    { field: 'numeric_value', impact: 'HIGH', directEditUntil: ['DRAFT'], requiresHeadApproval: true, recalculationRequired: true },
    { field: 'text_value', impact: 'HIGH', directEditUntil: ['DRAFT'], requiresHeadApproval: true, recalculationRequired: true },
    { field: 'decision', impact: 'HIGH', directEditUntil: ['DRAFT'], requiresHeadApproval: true, recalculationRequired: true },
  ],
  MOT_SHOP_COLLECTION: [
    { field: 'remarks', impact: 'LOW', directEditUntil: ['DRAFT'], requiresHeadApproval: false, recalculationRequired: false },
    { field: 'quantity_value', impact: 'HIGH', directEditUntil: ['DRAFT'], requiresHeadApproval: true, recalculationRequired: true },
    { field: 'lab_result', impact: 'HIGH', directEditUntil: ['DRAFT'], requiresHeadApproval: true, recalculationRequired: true },
  ],
  ZMCC_MC_ARRIVAL: [
    { field: 'exit_timestamp', impact: 'MEDIUM', directEditUntil: ['DRAFT', 'SUBMITTED'], requiresHeadApproval: false, recalculationRequired: false },
    { field: 'raw_milk_token_number', impact: 'MEDIUM', directEditUntil: ['DRAFT', 'SUBMITTED'], requiresHeadApproval: false, recalculationRequired: false },
  ],
  ZMCC_HC_ARRIVAL: [
    { field: 'exit_timestamp', impact: 'MEDIUM', directEditUntil: ['DRAFT', 'SUBMITTED'], requiresHeadApproval: false, recalculationRequired: false },
    { field: 'raw_milk_token_number', impact: 'MEDIUM', directEditUntil: ['DRAFT', 'SUBMITTED'], requiresHeadApproval: false, recalculationRequired: false },
  ],
  ZMCC_WEIGHING: [
    { field: 'net_weight_kg', impact: 'HIGH', directEditUntil: ['DRAFT'], requiresHeadApproval: true, recalculationRequired: true },
  ],
  ZMCC_EXIT: [
    { field: 'exit_timestamp', impact: 'MEDIUM', directEditUntil: ['DRAFT', 'SUBMITTED'], requiresHeadApproval: false, recalculationRequired: false },
  ],
  VEHICLE_VISIT: [
    { field: 'raw_milk_dispatch_note_number', impact: 'MEDIUM', directEditUntil: ['DRAFT', 'SUBMITTED'], requiresHeadApproval: false, recalculationRequired: false },
    { field: 'vehicle_dispatch_quantity_value', impact: 'HIGH', directEditUntil: ['DRAFT'], requiresHeadApproval: true, recalculationRequired: true },
  ],
  HC_RMR_ISSUANCE: [
    { field: 'status', impact: 'HIGH', directEditUntil: [], requiresHeadApproval: true, recalculationRequired: false },
  ],
};

export function correctionRule(module: CorrectionModule, field: string): CorrectionFieldRule | undefined {
  return CORRECTION_FIELD_POLICY[module].find((rule) => rule.field === field);
}
