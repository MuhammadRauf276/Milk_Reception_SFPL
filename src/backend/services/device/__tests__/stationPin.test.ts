import test from 'node:test';
import assert from 'node:assert/strict';
import type { ActingContext } from '@/types/acting';
import {
  removeStationPin,
  setStationPin,
  verifyStationPin,
  listStationUsers,
  type StationPinDb,
  type StationPinRecord,
  type StationUserRecord,
  type StationDeviceRecord,
} from '../stationPinService';

const ctx: ActingContext = {
  userId: BigInt(1), actorRole: 'SUPER_ADMIN', actingAs: 'SUPER_ADMIN', isDelegated: false, scope: { kind: 'SYSTEM' },
};

function makeDb(device: Partial<StationDeviceRecord> = {}) {
  const devices: StationDeviceRecord[] = [{ id: BigInt(10), device_uid: 'pc-1', status: 'ACTIVE', is_shared_station: true, ...device }];
  const users: StationUserRecord[] = [
    { id: BigInt(6), username: 'sa', full_name: 'Admin', role: 'SUPER_ADMIN', department: null, scope_type: null, procurement_source_id: null, is_active: true },
    { id: BigInt(7), username: 'de', full_name: 'Data Exec', role: 'DATA_EXECUTIVE', department: null, scope_type: null, procurement_source_id: null, is_active: true },
    { id: BigInt(5), username: 'op5', full_name: 'Operator Five', role: 'WEIGHBRIDGE', department: null, scope_type: null, procurement_source_id: null, is_active: true },
  ];
  const pins: StationPinRecord[] = [];
  const diary: Array<Record<string, unknown>> = [];
  const audits: Array<Record<string, unknown>> = [];
  const find = (k: { user_id: bigint; device_id: bigint }) => pins.find((p) => p.user_id === k.user_id && p.device_id === k.device_id);
  const db: StationPinDb = {
    device: { async findUnique({ where }) { return devices.find((d) => ('id' in where ? d.id === where.id : d.device_uid === where.device_uid)) ?? null; } },
    user: { async findUnique({ where }) { return users.find((u) => u.id === where.id) ?? null; } },
    stationPin: {
      async findUnique({ where }) { return find(where.user_id_device_id) ?? null; },
      async findMany({ where }) { return pins.filter((p) => p.device_id === where.device_id); },
      async create({ data }) {
        const row = { id: BigInt(pins.length + 1), failed_attempts: 0, locked_until: null, created_at: new Date(), updated_at: new Date(), ...data };
        pins.push(row);
        return row;
      },
      async update({ where, data }) { const row = find(where.user_id_device_id)!; Object.assign(row, data); return row; },
      // Synchronous check+mutate = atomic, like a single SQL UPDATE.
      async updateMany({ where, data }) {
        const hits = pins.filter((p) => p.user_id === where.user_id && p.device_id === where.device_id
          && (where.locked_until !== null || p.locked_until === null)
          && (where.failed_attempts?.lt === undefined || p.failed_attempts < where.failed_attempts.lt)
          && (where.failed_attempts?.gte === undefined || p.failed_attempts >= where.failed_attempts.gte));
        for (const p of hits) {
          if (data.failed_attempts) p.failed_attempts += data.failed_attempts.increment;
          if (data.locked_until) p.locked_until = data.locked_until;
        }
        return { count: hits.length };
      },
      async delete({ where }) { pins.splice(pins.indexOf(find(where.user_id_device_id)!), 1); return {}; },
    },
    deviceActivityEvent: { async create({ data }) { diary.push(data); return {}; } },
    auditLog: { async create(args: { data: unknown }) { audits.push(args.data as Record<string, unknown>); return { id: BigInt(audits.length) }; } } as unknown as StationPinDb['auditLog'],
  };
  return { db, pins, diary, audits, devices };
}

const json = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x));
const U = BigInt(5);
const D = BigInt(10);

test('valid PIN logs in and resets failures', async () => {
  const { db, pins } = makeDb();
  await setStationPin(ctx, D, U, '1234', db);
  await verifyStationPin('pc-1', U, '0000', db);
  assert.equal(pins[0].failed_attempts, 1);
  const r = await verifyStationPin('pc-1', U, '1234', db);
  assert.equal(r.ok, true);
  assert.equal(pins[0].failed_attempts, 0);
});

test('wrong PIN counts down tries left; 5th failure locks; locked rejects correct PIN', async () => {
  const { db, diary, audits } = makeDb();
  await setStationPin(ctx, D, U, '1234', db);
  for (let i = 1; i <= 4; i++) {
    const r = await verifyStationPin('pc-1', U, '9999', db);
    assert.deepEqual(r, { ok: false, code: 'WRONG_PIN', triesLeft: 5 - i });
  }
  const fifth = await verifyStationPin('pc-1', U, '9999', db);
  assert.equal(fifth.ok === false && fifth.code, 'LOCKED');
  const again = await verifyStationPin('pc-1', U, '1234', db);
  assert.equal(again.ok === false && again.code, 'LOCKED');
  assert.ok(diary.some((e) => e.event_type === 'STATION_PIN_LOCKED'));
  assert.ok(audits.some((a) => a.action === 'STATION_PIN_LOCKED'));
});

test('setting a new PIN unlocks', async () => {
  const { db } = makeDb();
  await setStationPin(ctx, D, U, '1234', db);
  for (let i = 0; i < 5; i++) await verifyStationPin('pc-1', U, '9999', db);
  await setStationPin(ctx, D, U, '4321', db);
  assert.equal((await verifyStationPin('pc-1', U, '4321', db)).ok, true);
});

test('non-station or non-ACTIVE device is rejected', async () => {
  const a = makeDb({ is_shared_station: false });
  await assert.rejects(setStationPin(ctx, D, U, '1234', a.db), /not a shared station/);
  const b = makeDb({ status: 'BLOCKED' });
  await assert.rejects(setStationPin(ctx, D, U, '1234', b.db));
  const c = makeDb();
  await setStationPin(ctx, D, U, '1234', c.db);
  c.devices[0].status = 'BLOCKED';
  const r = await verifyStationPin('pc-1', U, '1234', c.db);
  assert.equal(r.ok === false && r.code, 'NOT_STATION');
});

test('PIN must be exactly 4 digits', async () => {
  const { db } = makeDb();
  for (const bad of ['123', '12345', 'abcd', '12a4', '', ' 123']) {
    await assert.rejects(setStationPin(ctx, D, U, bad, db), /exactly 4 digits/);
  }
});

test('PIN hash is never returned and set/remove write audit + diary', async () => {
  const { db, pins, diary, audits } = makeDb();
  const res = await setStationPin(ctx, D, U, '1234', db);
  assert.ok(!json(res).includes(pins[0].pin_hash));
  assert.notEqual(pins[0].pin_hash, '1234');
  const list = await listStationUsers(D, db);
  assert.equal(list.length, 1);
  assert.ok(!json(list).includes(pins[0].pin_hash));
  assert.ok(!json(diary).includes(pins[0].pin_hash));
  await removeStationPin(ctx, D, U, db);
  assert.equal(pins.length, 0);
  assert.deepEqual(diary.map((e) => e.event_type), ['STATION_PIN_SET', 'STATION_PIN_REMOVED']);
  assert.deepEqual(audits.map((a) => a.action), ['STATION_PIN_SET', 'STATION_PIN_REMOVED']);
});

test('parallel wrong attempts never exceed 5 and end locked, lock written once', async () => {
  const { db, pins, audits } = makeDb();
  await setStationPin(ctx, D, U, '1234', db);
  const results = await Promise.all(Array.from({ length: 20 }, () => verifyStationPin('pc-1', U, '0000', db)));
  assert.ok(pins[0].failed_attempts <= 5);
  assert.equal(pins[0].failed_attempts, 5);
  assert.ok(pins[0].locked_until);
  assert.ok(results.every((r) => !r.ok));
  assert.equal(audits.filter((a) => a.action === 'STATION_PIN_LOCKED').length, 1);
  assert.equal((await verifyStationPin('pc-1', U, '1234', db)).ok, false);
});

test('Super Admin and Data Executive cannot get station PINs', async () => {
  const { db, pins } = makeDb();
  await assert.rejects(setStationPin(ctx, D, BigInt(6), '1234', db), /station users only/);
  await assert.rejects(setStationPin(ctx, D, BigInt(7), '1234', db), /station users only/);
  assert.equal(pins.length, 0);
});
