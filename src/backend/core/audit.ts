// Single entry point for audit log rows: real user + role + acting-as role + delegation flag + device.
import { Prisma } from '@prisma/client';
import type { ActingContext } from '@/types/acting';

export interface AuditActor {
  userId: bigint | null;
  actorRole: string | null;
  performedAsRole?: string | null;
  isDelegated?: boolean;
  deviceId?: bigint | null;
}

export interface WriteAuditLogInput {
  tableName: string;
  recordId: bigint;
  action: string;
  oldValues?: Prisma.InputJsonValue | null;
  newValues?: Prisma.InputJsonValue | null;
  actor: AuditActor | ActingContext;
  // Optional device that produced the action (ActingContext does not carry one).
  deviceId?: bigint | null;
}

export type AuditDb = { auditLog: Pick<Prisma.TransactionClient['auditLog'], 'create'> };

const NON_DELEGATED_ROLES = new Set(['SUPER_ADMIN', 'DATA_EXECUTIVE']);

function toJson(value: Prisma.InputJsonValue | null | undefined) {
  if (value === undefined) return undefined;
  if (value === null) return Prisma.DbNull;
  return value;
}

export function buildAuditLogData(i: WriteAuditLogInput): Prisma.AuditLogUncheckedCreateInput {
  const a = i.actor;
  let performedAs: string | null;
  let delegated: boolean;
  let deviceId: bigint | null;

  if ('actingAs' in a) {
    performedAs = a.actingAs;
    delegated = a.isDelegated;
    deviceId = i.deviceId ?? null;
  } else {
    performedAs = a.performedAsRole ?? a.actorRole;
    delegated = a.isDelegated ?? false;
    deviceId = a.deviceId ?? i.deviceId ?? null;
  }
  const actorRole: string | null = a.actorRole;
  if (actorRole && NON_DELEGATED_ROLES.has(actorRole)) delegated = false;

  const data: Prisma.AuditLogUncheckedCreateInput = {
    table_name: i.tableName,
    record_id: i.recordId,
    action: i.action,
    user_id: a.userId,
    actor_role: actorRole,
    performed_as_role: performedAs,
    is_delegated: delegated,
    device_id: deviceId,
  };
  const oldValues = toJson(i.oldValues);
  const newValues = toJson(i.newValues);
  if (oldValues !== undefined) data.old_values = oldValues;
  if (newValues !== undefined) data.new_values = newValues;
  return data;
}

export async function writeAuditLog(db: AuditDb, i: WriteAuditLogInput): Promise<{ id: bigint }> {
  const row = await db.auditLog.create({ data: buildAuditLogData(i), select: { id: true } });
  return { id: row.id };
}

export function auditActorFromUser(u: { id: string | bigint; role: string }, deviceId?: bigint | null): AuditActor {
  return {
    userId: typeof u.id === 'bigint' ? u.id : BigInt(u.id),
    actorRole: u.role,
    performedAsRole: u.role,
    isDelegated: false,
    deviceId: deviceId ?? null,
  };
}
