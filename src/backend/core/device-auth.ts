// Device identity: key generation/hashing and request authentication (ACTIVE devices only).
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  DEVICE_KEY_HEADER,
  DEVICE_UID_HEADER,
  type AuthenticatedDevice,
  type DeviceStatus,
} from '@/types/device';

export interface DeviceRow {
  id: bigint;
  device_uid: string;
  sync_key_hash: string;
  status: string;
  assigned_user_id: bigint | null;
  procurement_source_id: bigint | null;
  is_shared_station: boolean;
}

export interface DeviceDb {
  device: {
    findUnique(args: { where: { device_uid: string } }): Promise<DeviceRow | null>;
  };
}

export interface DeviceHeartbeat {
  last_seen_at?: Date;
  last_app_version?: string | null;
  last_unsent_count?: number;
  last_oldest_unsent_at?: Date | null;
  last_free_storage_mb?: number | null;
  last_clock_drift_seconds?: number | null;
}

export interface DeviceHeartbeatDb {
  device: {
    update(args: { where: { id: bigint }; data: DeviceHeartbeat }): Promise<unknown>;
  };
}

export function generateDeviceKey(): string {
  return randomBytes(32).toString('base64url');
}

export function hashDeviceKey(key: string): string {
  return createHash('sha256').update(key, 'utf8').digest('hex');
}

export function verifyDeviceKey(key: string, storedHash: string): boolean {
  const a = Buffer.from(hashDeviceKey(key), 'utf8');
  const b = Buffer.from(storedHash, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function authenticateDevice(req: Request, db?: DeviceDb): Promise<AuthenticatedDevice | null> {
  const uid = req.headers.get(DEVICE_UID_HEADER)?.trim();
  const key = req.headers.get(DEVICE_KEY_HEADER);
  if (!uid || !key) return null;

  const client = db ?? ((await import('@core/db')).prisma as unknown as DeviceDb);
  const row = await client.device.findUnique({ where: { device_uid: uid } });
  if (!row) return null;
  if (row.status !== 'ACTIVE') return null;
  if (!verifyDeviceKey(key, row.sync_key_hash)) return null;

  return {
    id: row.id,
    deviceUid: row.device_uid,
    status: row.status as DeviceStatus,
    assignedUserId: row.assigned_user_id,
    procurementSourceId: row.procurement_source_id,
    isSharedStation: row.is_shared_station,
  };
}

export async function touchDeviceLastSeen(db: DeviceHeartbeatDb, deviceId: bigint, data: DeviceHeartbeat = {}): Promise<void> {
  await db.device.update({ where: { id: deviceId }, data: { last_seen_at: new Date(), ...data } });
}
