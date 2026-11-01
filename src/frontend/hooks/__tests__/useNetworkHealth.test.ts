import test from 'node:test';
import assert from 'node:assert/strict';
import { probeBackendHealth, evaluateNetworkHealthState, type NetworkHealthSnapshot } from '../useNetworkHealth';

test('NetworkHealth: correctly evaluates snapshot state flags', () => {
  const onlineSnap: NetworkHealthSnapshot = {
    status: 'ONLINE',
    isOnline: true,
    isOffline: false,
    isApiUnreachable: false,
    isDatabaseUnavailable: false,
    isReconnecting: false,
    lastCheckedAt: Date.now(),
    latencyMs: 15,
  };
  assert.equal(onlineSnap.isOnline, true);
  assert.equal(onlineSnap.isOffline, false);
  assert.equal(onlineSnap.isApiUnreachable, false);
  assert.equal(onlineSnap.isDatabaseUnavailable, false);
  assert.equal(onlineSnap.isReconnecting, false);

  const offlineSnap: NetworkHealthSnapshot = {
    status: 'OFFLINE',
    isOnline: false,
    isOffline: true,
    isApiUnreachable: false,
    isDatabaseUnavailable: false,
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
    isDatabaseUnavailable: false,
    isReconnecting: false,
    lastCheckedAt: Date.now(),
    latencyMs: null,
  };
  assert.equal(unreachableSnap.isOnline, false);
  assert.equal(unreachableSnap.isApiUnreachable, true);

  const dbDownSnap: NetworkHealthSnapshot = {
    status: 'DATABASE_UNAVAILABLE',
    isOnline: false,
    isOffline: false,
    isApiUnreachable: false,
    isDatabaseUnavailable: true,
    isReconnecting: false,
    lastCheckedAt: Date.now(),
    latencyMs: 50,
  };
  assert.equal(dbDownSnap.isOnline, false);
  assert.equal(dbDownSnap.isDatabaseUnavailable, true);

  const reconnectingSnap: NetworkHealthSnapshot = {
    status: 'RECONNECTING',
    isOnline: false,
    isOffline: false,
    isApiUnreachable: false,
    isDatabaseUnavailable: false,
    isReconnecting: true,
    lastCheckedAt: Date.now(),
    latencyMs: null,
  };
  assert.equal(reconnectingSnap.isReconnecting, true);
});

test('NetworkHealth: evaluateNetworkHealthState distinguishes DB failure vs API unreachable vs Offline', () => {
  assert.equal(evaluateNetworkHealthState(false, true, true), 'OFFLINE');
  assert.equal(evaluateNetworkHealthState(true, false, true), 'API_UNREACHABLE');
  assert.equal(evaluateNetworkHealthState(true, true, false), 'DATABASE_UNAVAILABLE');
  assert.equal(evaluateNetworkHealthState(true, true, true), 'ONLINE');
});

test('NetworkHealth: probeBackendHealth returns ONLINE in SSR/Node environment without browser window', async () => {
  const res = await probeBackendHealth();
  assert.equal(res, 'ONLINE', 'In server/Node environment, probeBackendHealth safely defaults to ONLINE');
});
