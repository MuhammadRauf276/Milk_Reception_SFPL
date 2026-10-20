import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/backend/core/auth';
import { authenticateDevice, verifyDeviceKey, type DeviceRow } from '@/backend/core/device-auth';
import { prisma } from '@core/db';
import { createDefaultSyncDeps, processSyncBatch, type SyncAuth } from '@/backend/services/sync/syncBatchService';
import { SYNC_HANDLERS } from '@/backend/services/sync/handlers';
import { DEVICE_KEY_HEADER, DEVICE_UID_HEADER, type AuthenticatedDevice, type DeviceStatus } from '@/types/device';

export const dynamic = 'force-dynamic';

/**
 * A device whose key is valid but whose status is not ACTIVE (blocked,
 * released, pending). authenticateDevice only returns ACTIVE devices, so
 * this lets the batch be refused with 403 + deviceStatus instead of 401.
 */
async function findInactiveDevice(req: Request): Promise<AuthenticatedDevice | null> {
  const uid = req.headers.get(DEVICE_UID_HEADER)?.trim();
  const key = req.headers.get(DEVICE_KEY_HEADER);
  if (!uid || !key) return null;
  const row = (await prisma.device.findUnique({ where: { device_uid: uid } })) as DeviceRow | null;
  if (!row || row.status === 'ACTIVE' || !verifyDeviceKey(key, row.sync_key_hash)) return null;
  return {
    id: row.id,
    deviceUid: row.device_uid,
    status: row.status as DeviceStatus,
    assignedUserId: row.assigned_user_id,
    procurementSourceId: row.procurement_source_id,
    isSharedStation: row.is_shared_station,
  };
}

/**
 * POST /api/sync/batch — offline queue upload (SyncBatchRequest -> SyncBatchResponse).
 * Auth: device headers (x-device-uid + x-device-key), plus the session cookie when someone is
 * signed in (business items: owner = assigned user or that signed-in user). Without device
 * headers, the session cookie; then every item's ownerUserId must be the session user.
 */
export async function POST(req: Request) {
  const serverTime = () => new Date().toISOString();
  try {
    let auth: SyncAuth;
    const hasDeviceHeaders = Boolean(req.headers.get(DEVICE_UID_HEADER) && req.headers.get(DEVICE_KEY_HEADER));
    if (hasDeviceHeaders) {
      const device = (await authenticateDevice(req)) ?? (await findInactiveDevice(req));
      if (!device) {
        return NextResponse.json({ error: 'Device not recognised.', code: 'DEVICE_UNAUTHORIZED', serverTime: serverTime() }, { status: 401 });
      }
      // The session cookie (if any) says who is signed in on this phone now: business items are
      // accepted only for the device's assigned user or that signed-in user.
      const sessionUser = await getCurrentUser(req).catch(() => null);
      auth = { mode: 'DEVICE', device, sessionUser };
    } else {
      const user = await getCurrentUser(req);
      if (!user) {
        return NextResponse.json({ error: 'Unauthorized.', code: 'UNAUTHORIZED', serverTime: serverTime() }, { status: 401 });
      }
      auth = { mode: 'SESSION', user, device: null };
    }

    const body: unknown = await req.json().catch(() => null);
    const deps = await createDefaultSyncDeps(SYNC_HANDLERS);
    const outcome = await processSyncBatch(body, auth, deps);
    return NextResponse.json(outcome.body, { status: outcome.httpStatus });
  } catch (err) {
    console.error('POST /api/sync/batch error:', err);
    return NextResponse.json({ error: 'Sync failed. Will try again.', code: 'SERVER_ERROR', serverTime: serverTime() }, { status: 500 });
  }
}
