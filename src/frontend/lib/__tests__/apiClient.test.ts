import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiError, apiClient } from '../apiClient';

test('apiClient: ApiError handles error classification flags accurately', () => {
  const timeoutErr = new ApiError('Timed out', 408, 'REQUEST_TIMEOUT', { isTimeout: true });
  assert.equal(timeoutErr.isTimeout, true);
  assert.equal(timeoutErr.status, 408);
  assert.equal(timeoutErr.code, 'REQUEST_TIMEOUT');
  assert.equal(timeoutErr.isNetworkError, false);

  const netErr = new ApiError('Offline', 0, 'NETWORK_FAILURE', { isNetworkError: true });
  assert.equal(netErr.isNetworkError, true);
  assert.equal(netErr.status, 0);

  const authErr = new ApiError('Expired', 401, 'SESSION_EXPIRED', { isAuthExpired: true });
  assert.equal(authErr.isAuthExpired, true);
  assert.equal(authErr.status, 401);
});

test('apiClient: exports get, post, put, delete methods', () => {
  assert.equal(typeof apiClient.get, 'function');
  assert.equal(typeof apiClient.post, 'function');
  assert.equal(typeof apiClient.put, 'function');
  assert.equal(typeof apiClient.delete, 'function');
});
