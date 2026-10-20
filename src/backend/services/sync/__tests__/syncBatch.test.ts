import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
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

function device(status: DeviceStatus = 'ACTIVE'): AuthenticatedDevice {
  return { id: BigInt(1), deviceUid: 'dev-1', status, assignedUserId: BigInt(5), procurementSourceId: BigInt(9), isSharedStation: false };
}

interface FakeDb extends SyncDb {
  ledger: Map<string, SyncLedgerRow>;
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
  const db: FakeDb = {
    ledger,
    deviceUpdates,
    raceNextInsert: false,
    deviceActivityEvent: {
      async findUnique({ where }) {
        const w = where.device_id_client_event_id;
        return ledger.get(key(w.device_id, w.client_event_id)) ?? null;
      },
      async findFirst({ where }) {
        for (const row of ledger.values()) {
          if (row.device_id === where.device_id && row.user_id === where.user_id) return { id: row.id };
        }
        return null;
      },
      async create({ data }) {
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
    stationPin: {
      async findFirst() {
        return null;
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

test('owner not allowed on this device -> REJECTED OWNER_NOT_ALLOWED', async () => {
  const db = fakeDb();
  const h = counting({ status: 'SAVED' });
  const body = okBody(await run(db, { DEVICE_EVENT: h.handler }, [item({ ownerUserId: '77' })]));
  assert.equal(body.results[0].status, 'REJECTED');
  assert.equal(body.results[0].code, 'OWNER_NOT_ALLOWED');
  assert.equal(h.calls(), 0);
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
