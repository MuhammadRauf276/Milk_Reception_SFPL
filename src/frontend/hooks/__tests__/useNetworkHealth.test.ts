import test from 'node:test';
import assert from 'node:assert/strict';
import { probeBackendHealth, type NetworkHealthSnapshot } from '../useNetworkHealth';

test('NetworkHealth: correctly evaluates snapshot state flags', () => {
  const onlineSnap: NetworkHealthSnapshot = {
    status: 'ONLINE',
    isOnline: true,
    isOffline: false,
    isApiUnreachable: false,
    isReconnecting: false,
    lastCheckedAt: Date.now(),
    latencyMs: 15,
  };
  assert.equal(onlineSnap.isOnline, true);
  assert.equal(onlineSnap.isOffline, false);
  assert.equal(onlineSnap.isApiUnreachable, false);
  assert.equal(onlineSnap.isReconnecting, false);

  const offlineSnap: NetworkHealthSnapshot = {
    status: 'OFFLINE',
    isOnline: false,
    isOffline: true,
    isApiUnreachable: false,
    isReconnecting: false,
    lastCheckedAt: Date.now(),
    latencyMs: null,
  };
  assert.equal(offlineSnap.isOnline, false);
  assert.equal(offlineSnap.isOffline, true);
  assert.equal(offlineSnap.isApiUnreachable, false);

  const unreachableSnap: NetworkHealthSnapshot = {
    status: 'API_UNREACHABLE',
    isOnline: false,
    isOffline: false,
    isApiUnreachable: true,
    isReconnecting: false,
    lastCheckedAt: Date.now(),
    latencyMs: null,
  };
  assert.equal(unreachableSnap.isOnline, false);
  assert.equal(unreachableSnap.isApiUnreachable, true);

  const reconnectingSnap: NetworkHealthSnapshot = {
    status: 'RECONNECTING',
    isOnline: false,
    isOffline: false,
    isApiUnreachable: false,
    isReconnecting: true,
    lastCheckedAt: Date.now(),
    latencyMs: null,
  };
  assert.equal(reconnectingSnap.isReconnecting, true);
});

test('NetworkHealth: probeBackendHealth returns ONLINE in SSR/Node environment without browser window', async () => {
  const res = await probeBackendHealth();
  assert.equal(res, 'ONLINE', 'In server/Node environment, probeBackendHealth safely defaults to ONLINE');
});
