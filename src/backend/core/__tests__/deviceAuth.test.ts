import test from 'node:test';
import assert from 'node:assert/strict';
import {
  authenticateDevice,
  generateDeviceKey,
  hashDeviceKey,
  verifyDeviceKey,
  type DeviceDb,
  type DeviceRow,
} from '../device-auth';

const key = generateDeviceKey();

function fakeDb(status: string): DeviceDb {
  const row: DeviceRow = {
    id: BigInt(1),
    device_uid: 'dev-1',
    sync_key_hash: hashDeviceKey(key),
    status,
    assigned_user_id: BigInt(5),
    procurement_source_id: null,
    is_shared_station: true,
  };
  return { device: { findUnique: async ({ where }) => (where.device_uid === 'dev-1' ? row : null) } };
}

function req(uid: string | null, k: string | null): Request {
  const headers = new Headers();
  if (uid) headers.set('x-device-uid', uid);
  if (k) headers.set('x-device-key', k);
  return new Request('http://localhost/api/x', { headers });
}

test('device key round trip', () => {
  assert.match(key, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(hashDeviceKey(key).length, 64);
  assert.equal(verifyDeviceKey(key, hashDeviceKey(key)), true);
  assert.equal(verifyDeviceKey('wrong', hashDeviceKey(key)), false);
  assert.equal(verifyDeviceKey(key, 'short'), false);
  assert.notEqual(generateDeviceKey(), key);
});

test('ACTIVE device with correct key authenticates', async () => {
  const d = await authenticateDevice(req('dev-1', key), fakeDb('ACTIVE'));
  assert.deepEqual(d, {
    id: BigInt(1),
    deviceUid: 'dev-1',
    status: 'ACTIVE',
    assignedUserId: BigInt(5),
    procurementSourceId: null,
    isSharedStation: true,
  });
});

test('wrong key, unknown uid and missing headers return null', async () => {
  assert.equal(await authenticateDevice(req('dev-1', 'nope'), fakeDb('ACTIVE')), null);
  assert.equal(await authenticateDevice(req('other', key), fakeDb('ACTIVE')), null);
  assert.equal(await authenticateDevice(req(null, key), fakeDb('ACTIVE')), null);
  assert.equal(await authenticateDevice(req('dev-1', null), fakeDb('ACTIVE')), null);
});

test('non-ACTIVE statuses return null', async () => {
  for (const s of ['BLOCKED', 'RELEASED', 'PENDING']) {
    assert.equal(await authenticateDevice(req('dev-1', key), fakeDb(s)), null, s);
  }
});
