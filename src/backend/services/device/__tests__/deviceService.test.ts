import test from 'node:test';
import assert from 'node:assert/strict';
import type { ActingContext } from '@/types/acting';
import { hashDeviceKey } from '@/backend/core/device-auth';
import {
  assignDevice,
  blockDevice,
  DeviceServiceError,
  getDeviceDiary,
  registerDevice,
  releaseDevice,
  rotateKey,
  type DeviceRecord,
  type DeviceServiceDb,
  type DiaryRecord,
} from '../deviceService';

const ctx: ActingContext = {
  userId: BigInt(1),
  actorRole: 'SUPER_ADMIN',
  actingAs: 'SUPER_ADMIN',
  isDelegated: false,
  scope: { kind: 'SYSTEM' },
};

function makeDb() {
  const devices: DeviceRecord[] = [];
  const diary: DiaryRecord[] = [];
  const audits: Array<Record<string, unknown>> = [];
  let seq = 0;
  const db: DeviceServiceDb = {
    device: {
      async findMany() { return devices; },
      async findUnique({ where }) {
        if ('id' in where) return devices.find((d) => d.id === where.id) ?? null;
        return devices.find((d) => d.device_uid === where.device_uid) ?? null;
      },
      async create({ data }) {
        const row = {
          id: BigInt(++seq), platform: 'OTHER', assigned_user_id: null, procurement_source_id: null, blocked_by: null,
          blocked_at: null, block_reason: null, last_seen_at: null, last_app_version: null, last_unsent_count: 0,
          last_oldest_unsent_at: null, last_free_storage_mb: null, last_clock_drift_seconds: null, registered_at: new Date(),
          ...data,
        } as unknown as DeviceRecord;
        devices.push(row);
        return row;
      },
      async update({ where, data }) {
        const row = devices.find((d) => d.id === where.id)!;
        Object.assign(row, data);
        return row;
      },
    },
    deviceActivityEvent: {
      async create({ data }) {
        diary.push({ id: BigInt(diary.length + 1), payload: null, entity_type: null, entity_id: null, user_id: null, performed_as_role: null,
          is_delegated: false, server_received_at: new Date(), ...data } as unknown as DiaryRecord);
        return {};
      },
      async findMany() { return [...diary].reverse(); },
    },
    auditLog: {
      async create({ data }: { data: Record<string, unknown> }) { audits.push(data); return { id: BigInt(audits.length) }; },
    } as unknown as DeviceServiceDb['auditLog'],
  };
  return { db, devices, diary, audits };
}

test('register returns the key once and stores only its sha256', async () => {
  const { db, devices, audits, diary } = makeDb();
  const { device, syncKey } = await registerDevice(ctx, { deviceUid: 'uid-1', label: 'Phone 1', isSharedStation: false }, db);
  assert.ok(syncKey.length >= 32);
  assert.equal(devices[0].sync_key_hash, hashDeviceKey(syncKey));
  assert.notEqual(devices[0].sync_key_hash, syncKey);
  assert.equal(JSON.stringify(device).includes(syncKey), false);
  assert.equal(JSON.stringify(device).includes(devices[0].sync_key_hash), false);
  assert.equal(audits.length, 1);
  assert.equal(diary.length, 1);
  assert.equal(diary[0].event_type, 'REGISTERED');
});

test('register rejects duplicate ids and empty labels', async () => {
  const { db } = makeDb();
  await registerDevice(ctx, { deviceUid: 'uid-1', label: 'A', isSharedStation: false }, db);
  await assert.rejects(registerDevice(ctx, { deviceUid: 'uid-1', label: 'B', isSharedStation: false }, db), { code: 'CONFLICT' });
  await assert.rejects(registerDevice(ctx, { deviceUid: 'uid-2', label: ' ', isSharedStation: false }, db), { code: 'INVALID' });
});

test('assign then release clears the assignment and key', async () => {
  const { db, devices, audits, diary } = makeDb();
  const { device, syncKey } = await registerDevice(ctx, { deviceUid: 'uid-1', label: 'A', isSharedStation: false }, db);
  const id = BigInt(device.id);
  const assigned = await assignDevice(ctx, id, BigInt(7), db);
  assert.equal(assigned.assignedUserId, '7');
  const released = await releaseDevice(ctx, id, db);
  assert.equal(released.status, 'RELEASED');
  assert.equal(released.assignedUserId, null);
  assert.equal(devices[0].assigned_user_id, null);
  assert.notEqual(devices[0].sync_key_hash, hashDeviceKey(syncKey));
  assert.equal(audits.length, 3);
  assert.deepEqual(diary.map((d) => d.event_type), ['REGISTERED', 'ASSIGNED', 'RELEASED']);
});

test('block sets BLOCKED with reason; rotate then refuses', async () => {
  const { db, devices, audits, diary } = makeDb();
  const { device } = await registerDevice(ctx, { deviceUid: 'uid-1', label: 'A', isSharedStation: false }, db);
  const id = BigInt(device.id);
  const blocked = await blockDevice(ctx, id, 'Lost phone', db);
  assert.equal(blocked.status, 'BLOCKED');
  assert.equal(devices[0].block_reason, 'Lost phone');
  assert.equal(devices[0].blocked_by, ctx.userId);
  await assert.rejects(blockDevice(ctx, id, '  ', db), { code: 'INVALID' });
  await assert.rejects(rotateKey(ctx, id, db), { code: 'CONFLICT' });
  assert.equal(audits.length, 2);
  assert.equal(diary[1].event_type, 'BLOCKED');
});

test('rotateKey replaces the hash, audits and writes diary', async () => {
  const { db, devices, audits, diary } = makeDb();
  const { device, syncKey } = await registerDevice(ctx, { deviceUid: 'uid-1', label: 'A', isSharedStation: false }, db);
  const rotated = await rotateKey(ctx, BigInt(device.id), db);
  assert.notEqual(rotated.syncKey, syncKey);
  assert.equal(devices[0].sync_key_hash, hashDeviceKey(rotated.syncKey));
  assert.equal(audits.length, 2);
  assert.equal(diary[1].event_type, 'KEY_ROTATED');
});

test('unknown device errors NOT_FOUND', async () => {
  const { db } = makeDb();
  const missing = BigInt(99);
  for (const run of [
    () => assignDevice(ctx, missing, BigInt(1), db),
    () => releaseDevice(ctx, missing, db),
    () => blockDevice(ctx, missing, 'x', db),
    () => rotateKey(ctx, missing, db),
    () => getDeviceDiary(missing, {}, db),
  ]) {
    await assert.rejects(run(), (e: unknown) => e instanceof DeviceServiceError && e.code === 'NOT_FOUND');
  }
});

test('diary returns newest first with a cursor', async () => {
  const { db } = makeDb();
  const { device } = await registerDevice(ctx, { deviceUid: 'uid-1', label: 'A', isSharedStation: false }, db);
  await assignDevice(ctx, BigInt(device.id), BigInt(2), db);
  const page = await getDeviceDiary(BigInt(device.id), { limit: 1 }, db);
  assert.equal(page.entries.length, 1);
  assert.equal(page.entries[0].eventType, 'ASSIGNED');
  assert.ok(page.nextCursor);
});
