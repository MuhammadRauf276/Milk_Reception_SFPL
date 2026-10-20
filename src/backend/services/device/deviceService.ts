// Phone (device) administration: register, assign, release, block, rotate key, diary. Super Admin + Data Executive only (route layer).
import { randomUUID } from 'node:crypto';
import type { ActingContext } from '@/types/acting';
import type { DeviceStatus } from '@/types/device';
import { generateDeviceKey, hashDeviceKey } from '@/backend/core/device-auth';
import { writeAuditLog, type AuditDb } from '@/backend/core/audit';

export type DeviceServiceErrorCode = 'NOT_FOUND' | 'INVALID' | 'CONFLICT';

export class DeviceServiceError extends Error {
  constructor(public code: DeviceServiceErrorCode, message: string) {
    super(message);
    this.name = 'DeviceServiceError';
  }
}

/** Maps any error to an HTTP status + safe message for the API routes. */
export function deviceErrorInfo(err: unknown): { status: number; body: { error: string; code?: string } } {
  if (err instanceof DeviceServiceError) {
    const status = err.code === 'NOT_FOUND' ? 404 : err.code === 'CONFLICT' ? 409 : 400;
    return { status, body: { error: err.message, code: err.code } };
  }
  console.error('[API_DEVICES_ERROR]', err);
  return { status: 500, body: { error: 'Something went wrong. Please try again.' } };
}

export interface DeviceRecord {
  id: bigint;
  device_uid: string;
  sync_key_hash: string;
  label: string | null;
  platform: string;
  assigned_user_id: bigint | null;
  procurement_source_id: bigint | null;
  is_shared_station: boolean;
  status: string;
  registered_by: bigint;
  registered_at: Date;
  blocked_by: bigint | null;
  blocked_at: Date | null;
  block_reason: string | null;
  last_seen_at: Date | null;
  last_app_version: string | null;
  last_unsent_count: number;
  last_oldest_unsent_at: Date | null;
  last_free_storage_mb: number | null;
  last_clock_drift_seconds: number | null;
}

export interface DiaryRecord {
  id: bigint;
  device_id: bigint;
  user_id: bigint | null;
  performed_as_role: string | null;
  is_delegated: boolean;
  event_type: string;
  entity_type: string | null;
  entity_id: bigint | null;
  client_event_id: string;
  payload: unknown;
  device_occurred_at: Date;
  server_received_at: Date;
}

// Minimal structural slice of the Prisma client used here (so tests can inject a fake).
export interface DeviceServiceDb {
  device: {
    findMany(args: Record<string, unknown>): Promise<DeviceRecord[]>;
    findUnique(args: { where: { id: bigint } | { device_uid: string } }): Promise<DeviceRecord | null>;
    create(args: { data: Record<string, unknown> }): Promise<DeviceRecord>;
    update(args: { where: { id: bigint }; data: Record<string, unknown> }): Promise<DeviceRecord>;
  };
  deviceActivityEvent: {
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
    findMany(args: Record<string, unknown>): Promise<DiaryRecord[]>;
  };
  auditLog: AuditDb['auditLog'];
  user?: {
    findUnique(args: { where: { id: bigint } }): Promise<{ id: bigint; is_active: boolean; role: string } | null>;
    findMany(args: Record<string, unknown>): Promise<unknown[]>;
  };
  procurementSource?: {
    findUnique(args: { where: { id: bigint } }): Promise<{ id: bigint } | null>;
    findMany(args: Record<string, unknown>): Promise<unknown[]>;
  };
}

async function resolveDb(db?: DeviceServiceDb): Promise<DeviceServiceDb> {
  if (db) return db;
  return (await import('@core/db')).prisma as unknown as DeviceServiceDb;
}

export interface DeviceView {
  id: string;
  deviceUid: string;
  label: string | null;
  platform: string;
  status: DeviceStatus;
  isSharedStation: boolean;
  assignedUserId: string | null;
  assignedUserName: string | null;
  procurementSourceId: string | null;
  procurementSourceName: string | null;
  registeredAt: string;
  blockedAt: string | null;
  blockReason: string | null;
  lastSeenAt: string | null;
  lastAppVersion: string | null;
  lastUnsentCount: number;
  lastOldestUnsentAt: string | null;
  lastFreeStorageMb: number | null;
  lastClockDriftSeconds: number | null;
}

type DeviceWithRelations = DeviceRecord & {
  assigned_user?: { full_name: string | null; username: string } | null;
  procurement_source?: { name: string } | null;
};

function iso(d: Date | null): string | null {
  return d ? d.toISOString() : null;
}

export function toDeviceView(d: DeviceWithRelations): DeviceView {
  return {
    id: d.id.toString(),
    deviceUid: d.device_uid,
    label: d.label,
    platform: d.platform,
    status: d.status as DeviceStatus,
    isSharedStation: d.is_shared_station,
    assignedUserId: d.assigned_user_id === null ? null : d.assigned_user_id.toString(),
    assignedUserName: d.assigned_user ? d.assigned_user.full_name || d.assigned_user.username : null,
    procurementSourceId: d.procurement_source_id === null ? null : d.procurement_source_id.toString(),
    procurementSourceName: d.procurement_source?.name ?? null,
    registeredAt: d.registered_at.toISOString(),
    blockedAt: iso(d.blocked_at),
    blockReason: d.block_reason,
    lastSeenAt: iso(d.last_seen_at),
    lastAppVersion: d.last_app_version,
    lastUnsentCount: d.last_unsent_count,
    lastOldestUnsentAt: iso(d.last_oldest_unsent_at),
    lastFreeStorageMb: d.last_free_storage_mb,
    lastClockDriftSeconds: d.last_clock_drift_seconds,
  };
}

export interface ListDevicesFilter {
  status?: DeviceStatus;
  assignedUserId?: bigint;
  procurementSourceId?: bigint;
}

export async function listDevices(filter: ListDevicesFilter = {}, db?: DeviceServiceDb): Promise<DeviceView[]> {
  const client = await resolveDb(db);
  const where: Record<string, unknown> = {};
  if (filter.status) where.status = filter.status;
  if (filter.assignedUserId !== undefined) where.assigned_user_id = filter.assignedUserId;
  if (filter.procurementSourceId !== undefined) where.procurement_source_id = filter.procurementSourceId;
  const rows = await client.device.findMany({
    where,
    orderBy: [{ registered_at: 'desc' }],
    include: {
      assigned_user: { select: { full_name: true, username: true } },
      procurement_source: { select: { name: true } },
    },
  });
  return rows.map((r) => toDeviceView(r as DeviceWithRelations));
}

async function getDeviceOrThrow(client: DeviceServiceDb, id: bigint): Promise<DeviceRecord> {
  const device = await client.device.findUnique({ where: { id } });
  if (!device) throw new DeviceServiceError('NOT_FOUND', 'Phone not found.');
  return device;
}

type Facts = Record<string, string | number | boolean | null>;

async function record(
  client: DeviceServiceDb,
  ctx: ActingContext,
  device: DeviceRecord,
  eventType: string,
  action: string,
  oldValues: Facts,
  newValues: Facts
): Promise<void> {
  await writeAuditLog(client, {
    tableName: 'device',
    recordId: device.id,
    action,
    oldValues,
    newValues,
    actor: ctx,
    deviceId: device.id,
  });
  await client.deviceActivityEvent.create({
    data: {
      device_id: device.id,
      user_id: ctx.userId,
      performed_as_role: ctx.actingAs,
      is_delegated: ctx.isDelegated,
      event_type: eventType,
      entity_type: 'device',
      entity_id: device.id,
      client_event_id: `admin:${randomUUID()}`,
      payload: newValues,
      device_occurred_at: new Date(),
    },
  });
}

export interface RegisterDeviceInput {
  deviceUid: string;
  label: string;
  isSharedStation: boolean;
  procurementSourceId?: bigint | null;
}

/** The plain key is returned once; only its sha256 is stored. */
export async function registerDevice(
  ctx: ActingContext,
  input: RegisterDeviceInput,
  db?: DeviceServiceDb
): Promise<{ device: DeviceView; syncKey: string }> {
  const client = await resolveDb(db);
  const deviceUid = input.deviceUid.trim();
  const label = input.label.trim();
  if (!deviceUid || deviceUid.length > 64) throw new DeviceServiceError('INVALID', 'Phone ID is required (up to 64 characters).');
  if (!label) throw new DeviceServiceError('INVALID', 'A name for this phone is required.');
  if (await client.device.findUnique({ where: { device_uid: deviceUid } })) {
    throw new DeviceServiceError('CONFLICT', 'This phone ID is already registered.');
  }
  const sourceId = input.procurementSourceId ?? null;
  if (sourceId !== null && client.procurementSource && !(await client.procurementSource.findUnique({ where: { id: sourceId } }))) {
    throw new DeviceServiceError('INVALID', 'ZMCC / source not found.');
  }
  const syncKey = generateDeviceKey();
  const created = await client.device.create({
    data: {
      device_uid: deviceUid,
      sync_key_hash: hashDeviceKey(syncKey),
      label,
      is_shared_station: input.isSharedStation,
      procurement_source_id: sourceId,
      status: 'ACTIVE',
      registered_by: ctx.userId,
    },
  });
  await record(client, ctx, created, 'REGISTERED', 'DEVICE_REGISTERED', {}, {
    device_uid: created.device_uid,
    label,
    is_shared_station: input.isSharedStation,
    procurement_source_id: sourceId === null ? null : sourceId.toString(),
  });
  return { device: toDeviceView(created), syncKey };
}

export async function assignDevice(ctx: ActingContext, id: bigint, userId: bigint, db?: DeviceServiceDb): Promise<DeviceView> {
  const client = await resolveDb(db);
  const device = await getDeviceOrThrow(client, id);
  if (device.status === 'BLOCKED') throw new DeviceServiceError('CONFLICT', 'This phone is blocked.');
  if (client.user) {
    const user = await client.user.findUnique({ where: { id: userId } });
    if (!user || !user.is_active) throw new DeviceServiceError('INVALID', 'User not found or not active.');
  }
  const updated = await client.device.update({
    where: { id },
    data: { assigned_user_id: userId, status: 'ACTIVE' },
  });
  await record(client, ctx, updated, 'ASSIGNED', 'DEVICE_ASSIGNED',
    { assigned_user_id: device.assigned_user_id === null ? null : device.assigned_user_id.toString(), status: device.status },
    { assigned_user_id: userId.toString(), status: 'ACTIVE' });
  return toDeviceView(updated);
}

/** Phone goes back to the office: no user, status RELEASED, and its key is replaced by one nobody knows. */
export async function releaseDevice(ctx: ActingContext, id: bigint, db?: DeviceServiceDb): Promise<DeviceView> {
  const client = await resolveDb(db);
  const device = await getDeviceOrThrow(client, id);
  const updated = await client.device.update({
    where: { id },
    data: { status: 'RELEASED', assigned_user_id: null, sync_key_hash: hashDeviceKey(generateDeviceKey()) },
  });
  await record(client, ctx, updated, 'RELEASED', 'DEVICE_RELEASED',
    { assigned_user_id: device.assigned_user_id === null ? null : device.assigned_user_id.toString(), status: device.status },
    { assigned_user_id: null, status: 'RELEASED' });
  return toDeviceView(updated);
}

export async function blockDevice(ctx: ActingContext, id: bigint, reason: string, db?: DeviceServiceDb): Promise<DeviceView> {
  const client = await resolveDb(db);
  const text = reason.trim();
  if (!text) throw new DeviceServiceError('INVALID', 'Please write the reason for blocking.');
  const device = await getDeviceOrThrow(client, id);
  const updated = await client.device.update({
    where: { id },
    data: { status: 'BLOCKED', blocked_by: ctx.userId, blocked_at: new Date(), block_reason: text },
  });
  await record(client, ctx, updated, 'BLOCKED', 'DEVICE_BLOCKED', { status: device.status }, { status: 'BLOCKED', block_reason: text });
  return toDeviceView(updated);
}

/** "Show key again": issues a new key (the old one stops working). Shown once. */
export async function rotateKey(ctx: ActingContext, id: bigint, db?: DeviceServiceDb): Promise<{ device: DeviceView; syncKey: string }> {
  const client = await resolveDb(db);
  const device = await getDeviceOrThrow(client, id);
  if (device.status === 'BLOCKED') throw new DeviceServiceError('CONFLICT', 'This phone is blocked.');
  const syncKey = generateDeviceKey();
  const updated = await client.device.update({ where: { id }, data: { sync_key_hash: hashDeviceKey(syncKey) } });
  await record(client, ctx, updated, 'KEY_ROTATED', 'DEVICE_KEY_ROTATED', { status: device.status }, { status: updated.status, key_rotated: true });
  return { device: toDeviceView(updated), syncKey };
}

export interface DiaryEntry {
  id: string;
  eventType: string;
  userId: string | null;
  performedAsRole: string | null;
  isDelegated: boolean;
  entityType: string | null;
  entityId: string | null;
  payload: unknown;
  occurredAt: string;
  receivedAt: string;
}

/** Newest first. `cursor` is the id of the last row of the previous page. */
export async function getDeviceDiary(
  id: bigint,
  opts: { cursor?: bigint | null; limit?: number } = {},
  db?: DeviceServiceDb
): Promise<{ entries: DiaryEntry[]; nextCursor: string | null }> {
  const client = await resolveDb(db);
  await getDeviceOrThrow(client, id);
  const limit = Math.min(Math.max(Math.trunc(opts.limit ?? 50), 1), 200);
  const rows = await client.deviceActivityEvent.findMany({
    where: { device_id: id, ...(opts.cursor ? { id: { lt: opts.cursor } } : {}) },
    orderBy: [{ id: 'desc' }],
    take: limit + 1,
  });
  const page = rows.slice(0, limit);
  return {
    entries: page.map((r) => ({
      id: r.id.toString(),
      eventType: r.event_type,
      userId: r.user_id === null ? null : r.user_id.toString(),
      performedAsRole: r.performed_as_role,
      isDelegated: r.is_delegated,
      entityType: r.entity_type,
      entityId: r.entity_id === null ? null : r.entity_id.toString(),
      payload: r.payload ?? null,
      occurredAt: r.device_occurred_at.toISOString(),
      receivedAt: r.server_received_at.toISOString(),
    })),
    nextCursor: rows.length > limit ? page[page.length - 1].id.toString() : null,
  };
}

/** Users and sources for the Register / Assign forms (so Data Executive does not need the user-admin API). */
export async function listFormOptions(db?: DeviceServiceDb): Promise<{
  users: Array<{ id: string; name: string; role: string }>;
  sources: Array<{ id: string; name: string; sourceType: string }>;
}> {
  const client = await resolveDb(db);
  const users = ((await client.user?.findMany({
    where: { is_active: true },
    select: { id: true, full_name: true, username: true, role: true },
    orderBy: [{ full_name: 'asc' }],
  })) ?? []) as Array<{ id: bigint; full_name: string | null; username: string; role: string }>;
  const sources = ((await client.procurementSource?.findMany({
    where: { is_active: true },
    select: { id: true, name: true, source_type: true },
    orderBy: [{ name: 'asc' }],
  })) ?? []) as Array<{ id: bigint; name: string; source_type: string }>;
  return {
    users: users.map((u) => ({ id: u.id.toString(), name: u.full_name || u.username, role: u.role })),
    sources: sources.map((s) => ({ id: s.id.toString(), name: s.name, sourceType: s.source_type })),
  };
}
