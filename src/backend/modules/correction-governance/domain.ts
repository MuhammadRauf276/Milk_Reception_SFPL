/** Shared vocabulary for every correction workflow. */
export type RecordLifecycle =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'APPROVED'
  | 'CLOSED'
  | 'FINANCIALLY_POSTED'
  | 'SETTLED'
  | 'CANCELLED';

export type CorrectionImpact = 'LOW' | 'MEDIUM' | 'HIGH';

export type CorrectionResolution =
  | 'DIRECT_CORRECTION'
  | 'ADJUSTMENT'
  | 'REVERSAL'
  | 'SUPERSEDING_VERSION';

export type CorrectionRequestStatus =
  | 'REQUESTED'
  | 'APPROVED'
  | 'REJECTED'
  | 'APPLIED'
  | 'CANCELLED';

export interface CorrectionActor {
  userId: string;
  role: string;
  sourceId?: string | null;
}

export interface CorrectionRecord {
  module: CorrectionModule;
  recordId: string;
  lifecycle: RecordLifecycle;
  sourceId?: string | null;
  financiallyPosted?: boolean;
  settled?: boolean;
}

export type CorrectionModule =
  | 'ZMCC_LAB_SESSION'
  | 'MOT_SHOP_COLLECTION'
  | 'ZMCC_MOT_ARRIVAL'
  | 'ZMCC_LOCAL_SUPPLIER_ARRIVAL'
  | 'VEHICLE_VISIT'
  | 'LOCAL_SUPPLIER_RMR_ISSUANCE';

export interface CorrectionChange {
  field: string;
  before: unknown;
  after: unknown;
}

export interface CorrectionRequest {
  id: string;
  correlationId: string;
  record: CorrectionRecord;
  requestedBy: CorrectionActor;
  reason: string;
  changes: CorrectionChange[];
  requestedAt: Date;
  status: CorrectionRequestStatus;
}

export function isFinanciallyLocked(record: CorrectionRecord): boolean {
  return record.lifecycle === 'FINANCIALLY_POSTED' || record.lifecycle === 'SETTLED' || Boolean(record.financiallyPosted || record.settled);
}

export function requiredResolution(record: CorrectionRecord, impact: CorrectionImpact): CorrectionResolution {
  if (isFinanciallyLocked(record)) return 'ADJUSTMENT';
  if (record.lifecycle === 'CLOSED' && impact === 'HIGH') return 'SUPERSEDING_VERSION';
  return 'DIRECT_CORRECTION';
}
