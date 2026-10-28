import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  handleDeviceEvent,
  handleHeartbeat,
  processSyncBatch,
  type SyncAuth,
  type SyncBatchDeps,
  type SyncDb,
  type SyncHandler,
  type SyncHandlerRegistry,
  type SyncLedgerCreateData,
  type SyncLedgerRow,
} from '../syncBatchService';
import type { User } from '../../../core/types';
import type { AuthenticatedDevice, DeviceStatus } from '../../../../types/device';
import type { SyncBatchResponse, SyncItem } from '../../../../types/sync';

const OWNER: User = {
  id: '5',
  username: 'mot.one',
  name: 'MOT One',
  role: 'MOT',
  department: 'MPD',
  procurement_source_id: '9',
  procurement_source: { id: '9', code: 'Z9', name: 'ZMCC 9', source_type: 'ZMCC', is_active: true },
};
const STRANGER: User = { ...OWNER, id: '77', username: 'other' };

function device(status: DeviceStatus = 'ACTIVE', assignedUserId: bigint | null = BigInt(5)): AuthenticatedDevice {
  return { id: BigInt(1), deviceUid: 'dev-1', status, assignedUserId, procurementSourceId: BigInt(9), isSharedStation: false };
}

interface FakeDb extends SyncDb {
  ledger: Map<string, SyncLedgerRow>;
  /** Every ledger insert as sent (incl. performed_as_role / device_occurred_at). */
  creates: SyncLedgerCreateData[];
  deviceUpdates: unknown[];
  /** When set, the next ledger insert loses a race: a competing row appears and P2002 is thrown. */
  raceNextInsert: boolean;
}

function fakeDb(): FakeDb {
  const ledger = new Map<string, SyncLedgerRow>();
  const deviceUpdates: unknown[] = [];
  let nextId = 100;
  const key = (deviceId: bigint, clientEventId: string) => `${deviceId}|${clientEventId}`;
  const toRow = (data: SyncLedgerCreateData): SyncLedgerRow => ({
    id: BigInt(nextId++),
    device_id: data.device_id,
    user_id: data.user_id,
    event_type: data.event_type,
    entity_type: data.entity_type,
    entity_id: data.entity_id,
    client_event_id: data.client_event_id,
    payload: JSON.parse(JSON.stringify(data.payload)),
  });
  const creates: SyncLedgerCreateData[] = [];
  const db: FakeDb = {
    ledger,
    creates,
    deviceUpdates,
    raceNextInsert: false,
    deviceActivityEvent: {
      async findUnique({ where }) {
        const w = where.device_id_client_event_id;
        return ledger.get(key(w.device_id, w.client_event_id)) ?? null;
      },
      async create({ data }) {
        creates.push(data);
        const k = key(data.device_id, data.client_event_id);
        if (db.raceNextInsert) {
          db.raceNextInsert = false;
          ledger.set(k, toRow({ ...data, payload: { ...data.payload, result: { ...data.payload.result, receipt: 'WINNER-1' } } }));
          throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
        }
        if (ledger.has(k)) throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
        const row = toRow(data);
        ledger.set(k, row);
        return { id: row.id };
      },
    },
    device: {
      async update(args) {
        deviceUpdates.push(args);
        return {};
      },
    },
  };
  return db;
}

function deps(db: FakeDb, handlers: SyncHandlerRegistry): SyncBatchDeps {
  const users = new Map([
    ['5', OWNER],
    ['77', STRANGER],
  ]);
  return { db, handlers, loadUser: async (id) => users.get(id.toString()) ?? null };
}

function item(overrides: Partial<SyncItem> = {}): SyncItem {
  return {
    clientUuid: randomUUID(),
    kind: 'DEVICE_EVENT',
    ownerUserId: '5',
    capturedAt: '2026-10-20T08:00:00.000Z',
    payload: { eventType: 'APP_OPENED' },
    ...overrides,
  };
}

function batch(items: unknown[]) {
  return { deviceUid: 'dev-1', appVersion: '3.0.0', deviceSentAt: new Date().toISOString(), items };
}

function counting(outcome: Awaited<ReturnType<SyncHandler>>): { handler: SyncHandler; calls: () => number } {
  let n = 0;
  return {
    handler: async () => {
      n++;
      return outcome;
    },
    calls: () => n,
  };
}

const deviceAuth = (status: DeviceStatus = 'ACTIVE'): SyncAuth => ({ mode: 'DEVICE', device: device(status) });

async function run(db: FakeDb, handlers: SyncHandlerRegistry, items: unknown[], auth: SyncAuth = deviceAuth()) {
  const out = await processSyncBatch(batch(items), auth, deps(db, handlers));
  return out;
}

function okBody(out: Awaited<ReturnType<typeof processSyncBatch>>): SyncBatchResponse {
  assert.equal(out.httpStatus, 200);
  return out.body as SyncBatchResponse;
}

test('same clientUuid twice in one batch: handler runs once, SAVED then DUPLICATE', async () => {
  const db = fakeDb();
  const h = counting({ status: 'SAVED', entityType: 'mot_shop_collection', entityId: '42', receipt: 'C-42' });
  const it = item({ kind: 'MOT_COLLECTION', payload: {} });
  const body = okBody(await run(db, { MOT_COLLECTION: h.handler }, [it, it]));
  assert.equal(h.calls(), 1);
  assert.deepEqual(body.results.map((r) => r.status), ['SAVED', 'DUPLICATE']);
  assert.equal(body.results[1].receipt, 'C-42');
  assert.equal(body.results[1].entityId, '42');
  assert.equal(db.ledger.size, 1);
  const row = [...db.ledger.values()][0];
  assert.equal(row.client_event_id, 'sync:' + it.clientUuid);
  assert.equal(row.event_type, 'SYNC_MOT_COLLECTION');
});

test('same clientUuid across two batches: second is DUPLICATE with stored receipt', async () => {
  const db = fakeDb();
  const h = counting({ status: 'SAVED', entityType: 'zmcc_mot_arrival', entityId: '7', receipt: 'ZT-7' });
  const it = item();
  const first = okBody(await run(db, { DEVICE_EVENT: h.handler }, [it]));
  const second = okBody(await run(db, { DEVICE_EVENT: h.handler }, [it]));
  assert.equal(h.calls(), 1);
  assert.equal(first.results[0].status, 'SAVED');
  assert.equal(second.results[0].status, 'DUPLICATE');
  assert.equal(second.results[0].receipt, 'ZT-7');
  assert.equal(second.results[0].entityType, 'zmcc_mot_arrival');
});

test('ledger unique-violation race -> DUPLICATE with the winner result', async () => {
  const db = fakeDb();
  db.raceNextInsert = true;
  const h = counting({ status: 'SAVED', entityType: 'x', entityId: '1', receipt: 'MINE' });
  const body = okBody(await run(db, { DEVICE_EVENT: h.handler }, [item()]));
  assert.equal(body.results[0].status, 'DUPLICATE');
  assert.equal(body.results[0].receipt, 'WINNER-1');
});

test('blocked or released device -> 403, nothing written', async () => {
  for (const status of ['BLOCKED', 'RELEASED'] as const) {
    const db = fakeDb();
    const h = counting({ status: 'SAVED' });
    const out = await run(db, { DEVICE_EVENT: h.handler }, [item()], deviceAuth(status));
    assert.equal(out.httpStatus, 403);
    assert.equal((out.body as { deviceStatus?: string }).deviceStatus, status);
    assert.equal(h.calls(), 0);
    assert.equal(db.ledger.size, 0);
    assert.equal(db.deviceUpdates.length, 0);
  }
});

test('mixed batch: one REJECTED does not stop the others', async () => {
  const db = fakeDb();
  const handlers: SyncHandlerRegistry = {
    DEVICE_EVENT: async () => ({ status: 'SAVED' }),
    MOT_COLLECTION: async () => ({ status: 'REJECTED', code: 'QUALITY_REJECTED', message: 'Milk out of spec' }),
  };
  const items = [item(), item({ kind: 'MOT_COLLECTION' }), { clientUuid: 'not-a-uuid', kind: 'DEVICE_EVENT', ownerUserId: '5' }, item({ kind: 'NOPE' as never }), item()];
  const body = okBody(await run(db, handlers, items));
  assert.deepEqual(body.results.map((r) => r.status), ['SAVED', 'REJECTED', 'REJECTED', 'REJECTED', 'SAVED']);
  assert.equal(body.results[1].code, 'QUALITY_REJECTED');
  assert.equal(body.results[2].code, 'INVALID_CLIENT_UUID');
  assert.equal(body.results[3].code, 'UNKNOWN_KIND');
  assert.equal(body.results[0].entityType, 'device_activity_event');
  // Only successful items are in the ledger; a rejected item can be fixed and resent.
  assert.equal(db.ledger.size, 2);
  assert.equal(body.deviceStatus, 'ACTIVE');
  assert.equal(db.deviceUpdates.length, 1);
});

test('more than 50 items -> 400', async () => {
  const db = fakeDb();
  const h = counting({ status: 'SAVED' });
  const items = Array.from({ length: 51 }, () => item());
  const out = await run(db, { DEVICE_EVENT: h.handler }, items);
  assert.equal(out.httpStatus, 400);
  assert.equal(h.calls(), 0);
  assert.equal(db.ledger.size, 0);
});

test('owner not signed in on this device -> RETRY OWNER_SESSION_REQUIRED', async () => {
  const db = fakeDb();
  const h = counting({ status: 'SAVED' });
  const body = okBody(await run(db, { MOT_COLLECTION: h.handler }, [item({ kind: 'MOT_COLLECTION', ownerUserId: '77' })]));
  assert.equal(body.results[0].status, 'RETRY');
  assert.equal(body.results[0].code, 'OWNER_SESSION_REQUIRED');
  assert.equal(h.calls(), 0);
});

test('shared station device allows any active user without OWNER_SESSION_REQUIRED', async () => {
  const db = fakeDb();
  const h = counting({ status: 'SAVED', entityType: 'mot_shop_collection', entityId: '77' });
  const sharedDev: AuthenticatedDevice = { ...device(), isSharedStation: true };
  const auth: SyncAuth = { mode: 'DEVICE', device: sharedDev };
  const body = okBody(await run(db, { MOT_COLLECTION: h.handler }, [item({ kind: 'MOT_COLLECTION', ownerUserId: '77' })], auth));
  assert.equal(body.results[0].status, 'SAVED');
  assert.equal(body.results[0].entityId, '77');
  assert.equal(h.calls(), 1);
});

test('session auth: owner must be the session user', async () => {
  const db = fakeDb();
  const h = counting({ status: 'SAVED', entityType: 'mot_shop_collection', entityId: '3' });
  const auth: SyncAuth = { mode: 'SESSION', user: OWNER, device: null };
  const body = okBody(await run(db, { MOT_COLLECTION: h.handler }, [item({ kind: 'MOT_COLLECTION' }), item({ kind: 'MOT_COLLECTION', ownerUserId: '77' })], auth));
  assert.deepEqual(body.results.map((r) => r.status), ['SAVED', 'REJECTED']);
  assert.equal(body.results[1].code, 'OWNER_NOT_ALLOWED');
  assert.equal(db.ledger.size, 0); // no registered device -> no ledger row
});

test('acting role is resolved on the server: requestedAs above the owner is refused', async () => {
  const db = fakeDb();
  const h = counting({ status: 'SAVED' });
  const body = okBody(await run(db, { MOT_COLLECTION: h.handler }, [item({ kind: 'MOT_COLLECTION', requestedAs: 'ZMCC_MANAGER' })]));
  assert.equal(body.results[0].status, 'REJECTED');
  assert.equal(body.results[0].code, 'CANNOT_ACT_AS');
  assert.equal(h.calls(), 0);
});

test('transient error -> RETRY and no ledger row; resend then saves', async () => {
  const db = fakeDb();
  let fail = true;
  const handlers: SyncHandlerRegistry = {
    DEVICE_EVENT: async () => {
      if (fail) throw Object.assign(new Error("Can't reach database server"), { code: 'P1001' });
      return { status: 'SAVED' };
    },
  };
  const it = item();
  const first = okBody(await run(db, handlers, [it]));
  assert.equal(first.results[0].status, 'RETRY');
  assert.equal(db.ledger.size, 0);
  fail = false;
  const second = okBody(await run(db, handlers, [it]));
  assert.equal(second.results[0].status, 'SAVED');
  assert.equal(db.ledger.size, 1);
});

test('reusing a clientUuid for a different kind is REJECTED', async () => {
  const db = fakeDb();
  const handlers: SyncHandlerRegistry = { DEVICE_EVENT: async () => ({ status: 'SAVED' }), MOT_COLLECTION: async () => ({ status: 'SAVED' }) };
  const it = item();
  okBody(await run(db, handlers, [it]));
  const body = okBody(await run(db, handlers, [{ ...it, kind: 'MOT_COLLECTION' }]));
  assert.equal(body.results[0].status, 'REJECTED');
  assert.equal(body.results[0].code, 'CLIENT_UUID_REUSED');
});

// ---------------------------------------------------------------------------
// Device housekeeping without a known owner (client sends ownerUserId '')
// ---------------------------------------------------------------------------

const REAL_HOUSEKEEPING: SyncHandlerRegistry = { DEVICE_EVENT: handleDeviceEvent, HEARTBEAT: handleHeartbeat };

/** Exactly what pwa/diary.ts logDeviceEvent queues. */
function clientDiaryItem(ownerUserId: string, occurredAt = '2026-10-20T07:59:30.000Z'): SyncItem {
  return item({
    ownerUserId,
    capturedAt: occurredAt,
    payload: { eventType: 'APP_OPEN', details: null, occurredAt, online: false },
  });
}

test('diary event with empty owner on device auth: SAVED, attributed to device + assigned user, never delegated', async () => {
  const db = fakeDb();
  const body = okBody(await run(db, REAL_HOUSEKEEPING, [clientDiaryItem('')]));
  assert.equal(body.results[0].status, 'SAVED');
  assert.equal(body.results[0].entityType, 'device_activity_event');
  const data = db.creates[0];
  assert.equal(data.user_id, BigInt(5));
  assert.equal(data.performed_as_role, 'MOT');
  assert.equal(data.is_delegated, false);
  assert.equal(data.event_type, 'APP_OPEN');
  assert.equal(data.device_occurred_at.toISOString(), '2026-10-20T07:59:30.000Z');
  assert.equal(data.payload.online, false);
  assert.equal(data.payload.occurredAt, '2026-10-20T07:59:30.000Z');
  assert.equal(data.payload.attributedTo, 'DEVICE');
  assert.deepEqual(data.payload.data, {});
});

test('diary event with empty owner on an unassigned device: user_id and role are null', async () => {
  const db = fakeDb();
  const auth: SyncAuth = { mode: 'DEVICE', device: device('ACTIVE', null) };
  const body = okBody(await run(db, REAL_HOUSEKEEPING, [clientDiaryItem('')], auth));
  assert.equal(body.results[0].status, 'SAVED');
  assert.equal(db.creates[0].user_id, null);
  assert.equal(db.creates[0].performed_as_role, null);
  assert.equal(db.creates[0].is_delegated, false);
});

test('heartbeat with empty owner on device auth is SAVED and updates the device', async () => {
  const db = fakeDb();
  const hb = item({ kind: 'HEARTBEAT', ownerUserId: '', payload: { appVersion: '3.1.0', unsentCount: 2, batteryPercent: 40 } });
  const body = okBody(await run(db, REAL_HOUSEKEEPING, [hb]));
  assert.equal(body.results[0].status, 'SAVED');
  assert.equal(db.creates[0].event_type, 'HEARTBEAT');
  // One update from the heartbeat itself, one from the batch's last_seen touch.
  assert.equal(db.deviceUpdates.length, 2);
});

test('diary event from an owner the device cannot vouch for: SAVED on the device, claim kept, owner not vouched for', async () => {
  const db = fakeDb();
  const mot = counting({ status: 'SAVED', entityType: 'mot_shop_collection', entityId: '1' });
  const handlers: SyncHandlerRegistry = { ...REAL_HOUSEKEEPING, MOT_COLLECTION: mot.handler };
  const body = okBody(await run(db, handlers, [clientDiaryItem('77'), item({ kind: 'MOT_COLLECTION', ownerUserId: '77' })]));
  assert.deepEqual(body.results.map((r) => r.status), ['SAVED', 'RETRY']);
  assert.equal(body.results[1].code, 'OWNER_SESSION_REQUIRED');
  assert.equal(db.creates[0].user_id, BigInt(5));
  assert.equal(db.creates[0].payload.claimedOwnerUserId, '77');
  assert.equal(mot.calls(), 0);
});

test('empty owner is refused for business kinds and for session auth', async () => {
  const db = fakeDb();
  const mot = counting({ status: 'SAVED' });
  const handlers: SyncHandlerRegistry = { ...REAL_HOUSEKEEPING, MOT_COLLECTION: mot.handler };
  const onDevice = okBody(await run(db, handlers, [item({ kind: 'MOT_COLLECTION', ownerUserId: '' })]));
  assert.equal(onDevice.results[0].status, 'REJECTED');
  assert.equal(onDevice.results[0].code, 'INVALID_OWNER');
  const session: SyncAuth = { mode: 'SESSION', user: OWNER, device: null };
  const onSession = okBody(await run(db, handlers, [clientDiaryItem('')], session));
  assert.equal(onSession.results[0].status, 'REJECTED');
  assert.equal(onSession.results[0].code, 'INVALID_OWNER');
  assert.equal(mot.calls(), 0);
});

test('diary payload: bad occurredAt or eventType is REJECTED (client drops it)', async () => {
  const db = fakeDb();
  const bad = item({ ownerUserId: '', payload: { eventType: 'APP_OPEN', details: null, occurredAt: 'yesterday', online: true } });
  const badType = item({ ownerUserId: '', payload: { eventType: 'x', details: null } });
  const body = okBody(await run(db, REAL_HOUSEKEEPING, [bad, badType]));
  assert.deepEqual(body.results.map((r) => r.status), ['REJECTED', 'REJECTED']);
  assert.equal(body.results[0].code, 'INVALID_PAYLOAD');
});
