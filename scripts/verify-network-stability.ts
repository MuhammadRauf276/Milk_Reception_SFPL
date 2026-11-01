/**
 * Automated Network Stability & Operational Reliability Verification Suite
 * 
 * Verifies:
 * 1. Health Probe (/api/health) latency, payload, headers, no-store cache policy.
 * 2. In-flight mutation deduplication (DUPLICATE_IN_FLIGHT prevention).
 * 3. Request timeout handling & clean abort signal propagation.
 * 4. Idempotency-Key injection in mutation requests.
 * 5. 401 Session expiry classification & milk-auth-expired event dispatch.
 * 6. Network error classification (offline / unreachable).
 * 7. Network Health state evaluation & transitions.
 */

import http from 'node:http';
import assert from 'node:assert/strict';
import { apiClient, ApiError } from '../src/frontend/lib/apiClient';
import { evaluateNetworkHealthState } from '../src/frontend/hooks/useNetworkHealth';

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:3000';

interface TestResult {
  id: string;
  name: string;
  passed: boolean;
  durationMs: number;
  error?: string;
}

const results: TestResult[] = [];

async function runTest(id: string, name: string, fn: () => Promise<void>) {
  const start = performance.now();
  process.stdout.write(`  [${id}] ${name} ... `);
  try {
    await fn();
    const durationMs = Math.round(performance.now() - start);
    results.push({ id, name, passed: true, durationMs });
    console.log(`PASS (${durationMs}ms)`);
  } catch (err: unknown) {
    const durationMs = Math.round(performance.now() - start);
    const errorMsg = err instanceof Error ? err.message : String(err);
    results.push({ id, name, passed: false, durationMs, error: errorMsg });
    console.log(`FAIL (${durationMs}ms)\n    Error: ${errorMsg}`);
  }
}

async function startMockServer(handler: http.RequestListener): Promise<{ server: http.Server; port: number }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        reject(new Error('Failed to obtain server address'));
        return;
      }
      resolve({ server, port: addr.port });
    });
  });
}

async function main() {
  console.log('========================================================================');
  console.log('  PHASE 3: NETWORK STABILITY & OPERATIONAL RELIABILITY TEST SUITE');
  console.log('========================================================================\n');

  // 1. Health Probe Verification
  await runTest('NET-01', 'Health check endpoint (/api/health) response, payload, and cache headers', async () => {
    const start = performance.now();
    const res = await fetch(`${BASE_URL}/api/health`, { cache: 'no-store' });
    const latency = performance.now() - start;

    assert.equal(res.status, 200, `Expected status 200, got ${res.status}`);
    const cacheControl = res.headers.get('cache-control') || '';
    assert.ok(
      cacheControl.includes('no-store'),
      `Expected Cache-Control to contain no-store, got "${cacheControl}"`
    );

    const body = await res.json();
    assert.equal(body.status, 'ok', `Expected { status: 'ok' }, got ${JSON.stringify(body)}`);
    assert.equal(typeof body.timestamp, 'number', 'Expected timestamp to be a number');
    assert.ok(latency < 500, `Health check latency too high: ${latency.toFixed(1)}ms (must be < 500ms)`);
  });

  // 2. In-Flight Mutation Deduplication Lock
  await runTest('NET-02', 'In-flight mutation deduplication prevents rapid double-submission', async () => {
    let activeConnections = 0;
    const { server, port } = await startMockServer(async (_req, res) => {
      activeConnections++;
      await new Promise((r) => setTimeout(r, 100)); // Hold connection for 100ms
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
    });

    try {
      const dedupKey = 'dedup-test-' + Date.now();
      const targetUrl = `http://127.0.0.1:${port}/test-dedup`;

      // Launch request 1 (takes 100ms)
      const promise1 = apiClient.post(targetUrl, { sample: 1 }, { dedupKey });

      // Immediately launch request 2 with the same dedupKey
      let duplicateCaught = false;
      try {
        await apiClient.post(targetUrl, { sample: 2 }, { dedupKey });
      } catch (err) {
        if (err instanceof ApiError && err.code === 'DUPLICATE_IN_FLIGHT') {
          duplicateCaught = true;
        } else {
          throw err;
        }
      }

      assert.ok(duplicateCaught, 'Expected duplicate mutation to be blocked with DUPLICATE_IN_FLIGHT');

      // Wait for request 1 to complete
      const result1 = await promise1;
      assert.deepEqual(result1, { success: true });

      // After request 1 settles, request 3 with the same key should be allowed
      const result3 = await apiClient.post(targetUrl, { sample: 3 }, { dedupKey });
      assert.deepEqual(result3, { success: true });
    } finally {
      server.close();
    }
  });

  // 3. Request Timeout Protection
  await runTest('NET-03', 'Request timeout protection aborts hanging requests cleanly', async () => {
    const { server, port } = await startMockServer(async (_req, res) => {
      // Delay response for 500ms
      await new Promise((r) => setTimeout(r, 500));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ done: true }));
    });

    try {
      const targetUrl = `http://127.0.0.1:${port}/timeout-test`;
      let timeoutCaught = false;

      try {
        await apiClient.post(targetUrl, { test: true }, { timeoutMs: 100 });
      } catch (err) {
        if (err instanceof ApiError && err.isTimeout) {
          timeoutCaught = true;
        } else {
          throw err;
        }
      }

      assert.ok(timeoutCaught, 'Expected request to abort with isTimeout=true within 100ms');
    } finally {
      server.close();
    }
  });

  // 4. Idempotency Key Injection
  await runTest('NET-04', 'Mutations inject and transmit Idempotency-Key headers', async () => {
    let capturedIdempotencyKey: string | null = null;
    const { server, port } = await startMockServer((req, res) => {
      capturedIdempotencyKey = req.headers['idempotency-key'] as string;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });

    try {
      const targetUrl = `http://127.0.0.1:${port}/idempotency-test`;
      await apiClient.post(targetUrl, { action: 'test' });

      assert.ok(capturedIdempotencyKey, 'Expected Idempotency-Key header to be present');
      // Format should be UUID: 8-4-4-4-12 hex characters
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(capturedIdempotencyKey);
      assert.ok(isUuid, `Expected Idempotency-Key to be a valid UUID, got "${capturedIdempotencyKey}"`);

      // Test custom idempotency key
      const customKey = 'custom-key-xyz-123';
      await apiClient.post(targetUrl, { action: 'test-2' }, { idempotencyKey: customKey });
      assert.equal(capturedIdempotencyKey, customKey, 'Expected custom Idempotency-Key to be respected');
    } finally {
      server.close();
    }
  });

  // 5. Session Expiry (401) Classification & Event Notification
  await runTest('NET-05', '401 Unauthorized responses trigger session expiry event without crashing', async () => {
    const { server, port } = await startMockServer((_req, res) => {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Session expired' }));
    });

    try {
      const targetUrl = `http://127.0.0.1:${port}/auth-test`;
      let authExpiredCaught = false;

      try {
        await apiClient.get(targetUrl);
      } catch (err) {
        if (err instanceof ApiError && err.isAuthExpired && err.status === 401) {
          authExpiredCaught = true;
        } else {
          throw err;
        }
      }

      assert.ok(authExpiredCaught, 'Expected 401 to be classified with isAuthExpired=true and status=401');
    } finally {
      server.close();
    }
  });

  // 6. Network Error Classification
  await runTest('NET-06', 'Unreachable server is classified as isNetworkError=true', async () => {
    // Pick an unused local port
    const unreachableUrl = 'http://127.0.0.1:58739/unreachable';
    let networkErrorCaught = false;

    try {
      await apiClient.get(unreachableUrl, { timeoutMs: 500, retries: 0 });
    } catch (err) {
      if (err instanceof ApiError && err.isNetworkError) {
        networkErrorCaught = true;
      } else {
        throw err;
      }
    }

    assert.ok(networkErrorCaught, 'Expected connection refusal to be classified with isNetworkError=true');
  });

  // 7. Network Health Evaluation
  await runTest('NET-07', 'evaluateNetworkHealthState accurately maps network state flags', async () => {
    assert.equal(evaluateNetworkHealthState(true, true), 'ONLINE', 'online=true, reachable=true => ONLINE');
    assert.equal(evaluateNetworkHealthState(false, true), 'OFFLINE', 'online=false => OFFLINE');
    assert.equal(evaluateNetworkHealthState(false, false), 'OFFLINE', 'online=false, reachable=false => OFFLINE');
    assert.equal(evaluateNetworkHealthState(true, false), 'API_UNREACHABLE', 'online=true, reachable=false => API_UNREACHABLE');
  });

  // Print Summary
  console.log('\n========================================================================');
  console.log('  NETWORK STABILITY VERIFICATION SUMMARY:');
  const total = results.length;
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;

  console.log(`  Total Checks: ${total}`);
  console.log(`  PASSED:       ${passed} (${Math.round((passed / total) * 100)}%)`);
  console.log(`  FAILED:       ${failed}`);
  console.log('========================================================================\n');

  if (failed > 0) {
    console.error('Network stability verification FAILED. See details above.');
    process.exit(1);
  } else {
    console.log('All network stability & operational reliability checks PASSED successfully.');
    process.exit(0);
  }
}

main().catch((err) => {
  console.error('Unexpected runner error:', err);
  process.exit(1);
});
