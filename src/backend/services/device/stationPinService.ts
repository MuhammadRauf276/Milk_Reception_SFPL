// Station PINs: shared station PCs log in with a name card + 4-digit PIN set by Super Admin / Data Executive.
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { ActingContext } from '@/types/acting';
import { writeAuditLog, type AuditDb } from '@/backend/core/audit';
import { DeviceServiceError } from './deviceService';

export const MAX_PIN_FAILURES = 5;
// A locked PIN stays locked until the office sets a new PIN (locked_until far in the future).
const LOCK_YEARS = 100;
const BCRYPT_ROUNDS = 10;

export interface StationPinRecord {
  id: bigint;
  user_id: bigint;
  device_id: bigint;
  pin_hash: string;
  failed_attempts: number;
  locked_until: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface StationUserRecord {
  id: bigint;
  username: string;
  full_name: string | null;
  role: string;
  department: string | null;
  scope_type: string | null;
  procurement_source_id: bigint | null;
  is_active: boolean;
}

export interface StationDeviceRecord {
  id: bigint;
  device_uid: string;
  status: string;
  is_shared_station: boolean;
}

type PinKey = { user_id_device_id: { user_id: bigint; device_id: bigint } };

// Minimal structural slice of the Prisma client (tests inject a fake).
export interface StationPinDb {
  device: {
    findUnique(args: { where: { id: bigint } | { device_uid: string } }): Promise<StationDeviceRecord | null>;
  };
  user: {
    findUnique(args: { where: { id: bigint } }): Promise<StationUserRecord | null>;
  };
  stationPin: {
    findUnique(args: { where: PinKey }): Promise<StationPinRecord | null>;
    findMany(args: { where: { device_id: bigint } }): Promise<StationPinRecord[]>;
    create(args: { data: { user_id: bigint; device_id: bigint; pin_hash: string } }): Promise<StationPinRecord>;
    update(args: { where: PinKey; data: Partial<Pick<StationPinRecord, 'pin_hash' | 'failed_attempts' | 'locked_until'>> }): Promise<StationPinRecord>;
    delete(args: { where: PinKey }): Promise<unknown>;
    // Atomic conditional update (one SQL statement); used to reserve attempts and to lock exactly once.
    updateMany(args: {
      where: { user_id: bigint; device_id: bigint; locked_until?: null; failed_attempts?: { lt?: number; gte?: number } };
      data: { failed_attempts?: { increment: number }; locked_until?: Date };
    }): Promise<{ count: number }>;
  };
  deviceActivityEvent: { create(args: { data: Record<string, unknown> }): Promise<unknown> };
  auditLog: AuditDb['auditLog'];
}

async function resolveDb(db?: StationPinDb): Promise<StationPinDb> {
  if (db) return db;
  return (await import('@core/db')).prisma as unknown as StationPinDb;
}

const PIN_PATTERN = /^\d{4}$/;
export function isValidPin(pin: unknown): pin is string {
  return typeof pin === 'string' && PIN_PATTERN.test(pin);
}

function pinKey(userId: bigint, deviceId: bigint): PinKey {
  return { user_id_device_id: { user_id: userId, device_id: deviceId } };
}

async function requireStation(db: StationPinDb, where: { id: bigint } | { device_uid: string }): Promise<StationDeviceRecord> {
  const device = await db.device.findUnique({ where });
  if (!device) throw new DeviceServiceError('NOT_FOUND', 'Computer not found.');
  if (device.status !== 'ACTIVE') throw new DeviceServiceError('INVALID', 'This computer is not working. Ask the office.');
  if (!device.is_shared_station) throw new DeviceServiceError('INVALID', 'This computer is not a shared station.');
  return device;
}

async function diary(
  db: StationPinDb,
  deviceId: bigint,
  userId: bigint | null,
  eventType: string,
  ctx: ActingContext | null,
  payload: Record<string, unknown>
) {
  await db.deviceActivityEvent.create({
    data: {
      device_id: deviceId,
      user_id: userId,
      performed_as_role: ctx ? ctx.actingAs : null,
      is_delegated: ctx ? ctx.isDelegated : false,
      event_type: eventType,
      entity_type: 'station_pin',
      client_event_id: `stationpin:${randomUUID()}`,
      payload,
      device_occurred_at: new Date(),
    },
  });
}

export async function setStationPin(
  ctx: ActingContext,
  deviceId: bigint,
  userId: bigint,
  pin: string,
  db?: StationPinDb
): Promise<{ userId: string; deviceId: string }> {
  const d = await resolveDb(db);
  if (!isValidPin(pin)) throw new DeviceServiceError('INVALID', 'PIN must be exactly 4 digits.');
  await requireStation(d, { id: deviceId });
  const user = await d.user.findUnique({ where: { id: userId } });
  if (!user) throw new DeviceServiceError('NOT_FOUND', 'User not found.');
  if (!user.is_active) throw new DeviceServiceError('INVALID', 'This user is not active.');
  if (user.role === 'SUPER_ADMIN' || user.role === 'DATA_EXECUTIVE') {
    throw new DeviceServiceError('INVALID', 'Station PINs are for station users only.');
  }

  const pinHash = await bcrypt.hash(pin, BCRYPT_ROUNDS);
  const existing = await d.stationPin.findUnique({ where: pinKey(userId, deviceId) });
  const row = existing
    ? await d.stationPin.update({ where: pinKey(userId, deviceId), data: { pin_hash: pinHash, failed_attempts: 0, locked_until: null } })
    : await d.stationPin.create({ data: { user_id: userId, device_id: deviceId, pin_hash: pinHash } });

  const action = existing ? 'STATION_PIN_RESET' : 'STATION_PIN_SET';
  await writeAuditLog(d, {
    tableName: 'station_pin',
    recordId: row.id,
    action,
    newValues: { userId: userId.toString(), deviceId: deviceId.toString() },
    actor: ctx,
    deviceId,
  });
  await diary(d, deviceId, userId, action, ctx, { userId: userId.toString() });
  return { userId: userId.toString(), deviceId: deviceId.toString() };
}

export async function removeStationPin(ctx: ActingContext, deviceId: bigint, userId: bigint, db?: StationPinDb): Promise<void> {
  const d = await resolveDb(db);
  const existing = await d.stationPin.findUnique({ where: pinKey(userId, deviceId) });
  if (!existing) throw new DeviceServiceError('NOT_FOUND', 'This user has no PIN on this computer.');
  await d.stationPin.delete({ where: pinKey(userId, deviceId) });
  await writeAuditLog(d, {
    tableName: 'station_pin',
    recordId: existing.id,
    action: 'STATION_PIN_REMOVED',
    oldValues: { userId: userId.toString(), deviceId: deviceId.toString() },
    actor: ctx,
    deviceId,
  });
  await diary(d, deviceId, userId, 'STATION_PIN_REMOVED', ctx, { userId: userId.toString() });
}

export interface StationUserView {
  userId: string;
  name: string;
  username: string;
  role: string;
  locked: boolean;
}

/** Users with a PIN on this device. Never includes PIN data. */
export async function listStationUsers(deviceId: bigint, db?: StationPinDb, now: Date = new Date()): Promise<StationUserView[]> {
  const d = await resolveDb(db);
  const pins = await d.stationPin.findMany({ where: { device_id: deviceId } });
  const out: StationUserView[] = [];
  for (const p of pins) {
    const user = await d.user.findUnique({ where: { id: p.user_id } });
    if (!user || !user.is_active) continue;
    out.push({
      userId: user.id.toString(),
      name: user.full_name || user.username,
      username: user.username,
      role: user.role,
      locked: !!p.locked_until && p.locked_until > now,
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export type VerifyFailureCode = 'NOT_STATION' | 'NO_PIN' | 'WRONG_PIN' | 'LOCKED';
export type VerifyResult =
  | { ok: true; user: StationUserRecord }
  | { ok: false; code: VerifyFailureCode; triesLeft: number };

export async function verifyStationPin(
  deviceUid: string,
  userId: bigint,
  pin: string,
  db?: StationPinDb,
  now: Date = new Date()
): Promise<VerifyResult> {
  const d = await resolveDb(db);
  const device = await d.device.findUnique({ where: { device_uid: deviceUid } });
  if (!device || device.status !== 'ACTIVE' || !device.is_shared_station) return { ok: false, code: 'NOT_STATION', triesLeft: 0 };

  const row = await d.stationPin.findUnique({ where: pinKey(userId, device.id) });
  const user = row ? await d.user.findUnique({ where: { id: userId } }) : null;
  if (!row || !user || !user.is_active) return { ok: false, code: 'NO_PIN', triesLeft: 0 };
  if (row.locked_until && row.locked_until > now) return { ok: false, code: 'LOCKED', triesLeft: 0 };

  // Reserve an attempt atomically BEFORE comparing, so parallel guesses cannot all see the same count.
  const reserved = await d.stationPin.updateMany({
    where: { device_id: device.id, user_id: userId, locked_until: null, failed_attempts: { lt: MAX_PIN_FAILURES } },
    data: { failed_attempts: { increment: 1 } },
  });
  if (reserved.count === 0) return { ok: false, code: 'LOCKED', triesLeft: 0 };

  if (isValidPin(pin) && (await bcrypt.compare(pin, row.pin_hash))) {
    await d.stationPin.update({ where: pinKey(userId, device.id), data: { failed_attempts: 0, locked_until: null } });
    return { ok: true, user };
  }

  const after = await d.stationPin.findUnique({ where: pinKey(userId, device.id) });
  const failures = after ? after.failed_attempts : MAX_PIN_FAILURES;
  if (failures >= MAX_PIN_FAILURES) {
    const until = new Date(now.getTime());
    until.setFullYear(until.getFullYear() + LOCK_YEARS);
    // Conditional: only the request that actually flips the lock writes the audit/diary rows.
    const locked = await d.stationPin.updateMany({
      where: { device_id: device.id, user_id: userId, locked_until: null, failed_attempts: { gte: MAX_PIN_FAILURES } },
      data: { locked_until: until },
    });
    if (locked.count > 0) {
      const actor = { userId, actorRole: user.role, deviceId: device.id };
      await writeAuditLog(d, { tableName: 'station_pin', recordId: row.id, action: 'STATION_PIN_LOCKED', newValues: { failedAttempts: failures }, actor });
      await diary(d, device.id, userId, 'STATION_PIN_LOCKED', null, { userId: userId.toString(), failedAttempts: failures });
    }
    return { ok: false, code: 'LOCKED', triesLeft: 0 };
  }
  return { ok: false, code: 'WRONG_PIN', triesLeft: MAX_PIN_FAILURES - failures };
}
