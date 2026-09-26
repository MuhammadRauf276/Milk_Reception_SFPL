import type { CorrectionActor, CorrectionChange, CorrectionRecord, CorrectionRequest, CorrectionResolution } from './domain';

export interface CreateCorrectionRequestInput {
  record: CorrectionRecord;
  actor: CorrectionActor;
  reason: string;
  changes: CorrectionChange[];
  correlationId: string;
}

export interface CorrectionGovernanceService {
  request(input: CreateCorrectionRequestInput): Promise<CorrectionRequest>;
  approve(requestId: string, actor: CorrectionActor, reason: string): Promise<CorrectionRequest>;
  reject(requestId: string, actor: CorrectionActor, reason: string): Promise<CorrectionRequest>;
  cancel(requestId: string, actor: CorrectionActor, reason: string): Promise<CorrectionRequest>;
  apply(requestId: string, actor: CorrectionActor): Promise<{ request: CorrectionRequest; resolution: CorrectionResolution }>;
}

/**
 * Each implementation must use one database transaction for the record mutation,
 * correction state change, and immutable audit event. It intentionally accepts a
 * callback so feature modules keep their domain-specific persistence rules.
 */
export interface CorrectionTransactionRunner<TTransaction> {
  run<TResult>(work: (tx: TTransaction) => Promise<TResult>): Promise<TResult>;
}
