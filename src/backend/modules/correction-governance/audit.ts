import type { CorrectionActor, CorrectionChange, CorrectionRecord, CorrectionResolution } from './domain';

export interface ImmutableCorrectionAuditEvent {
  eventType: 'CORRECTION_REQUESTED' | 'CORRECTION_APPROVED' | 'CORRECTION_REJECTED' | 'CORRECTION_APPLIED' | 'CORRECTION_CANCELLED';
  correlationId: string;
  occurredAt: Date;
  actor: CorrectionActor;
  record: CorrectionRecord;
  reason: string;
  resolution: CorrectionResolution;
  changes: readonly CorrectionChange[];
}

/** Maps the shared immutable audit shape onto the existing append-only AuditLog. */
export function toAuditLogCreateInput(event: ImmutableCorrectionAuditEvent) {
  return {
    table_name: event.record.module.toLowerCase(),
    record_id: BigInt(event.record.recordId),
    action: event.eventType,
    user_id: BigInt(event.actor.userId),
    old_values: {
      correction: {
        correlation_id: event.correlationId,
        actor_role: event.actor.role,
        source_id: event.actor.sourceId ?? null,
        lifecycle: event.record.lifecycle,
        resolution: event.resolution,
        reason: event.reason,
        changes: event.changes.map(({ field, before }) => ({ field, value: before })),
      },
    },
    new_values: {
      correction: {
        correlation_id: event.correlationId,
        actor_role: event.actor.role,
        source_id: event.actor.sourceId ?? null,
        changes: event.changes.map(({ field, after }) => ({ field, value: after })),
      },
    },
  };
}
