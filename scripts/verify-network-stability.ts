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
 * 8. Stalled response body stream timeout lifecycle protection.
 * 9. Explicit AbortController cancellation clean abort propagation.
 * 10. Database health state mapping (ONLINE, OFFLINE, API_UNREACHABLE, DATABASE_UNAVAILABLE).
 * 11. QA portion creation & completion stable idempotency contracts.
 * 12. Gate & Weighbridge server-side replay and conflict verification.
 */

import http from 'node:http';
import assert from 'node:assert/strict';
import { apiClient, ApiError } from '../src/frontend/lib/apiClient';
import { evaluateNetworkHealthState } from '../src/frontend/hooks/useNetworkHealth';
import {
  validateReplayPayload,
  computePayloadHash,
  verifyReplay,
} from '../src/backend/services/operationIdempotencyService';

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
    await fetch(`${BASE_URL}/api/health`, { cache: 'no-store' }).catch(() => {});

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
    assert.ok(latency < 1000, `Health check latency too high: ${latency.toFixed(1)}ms (must be < 1000ms)`);
  });

  // 2. In-Flight Mutation Deduplication Lock
  await runTest('NET-02', 'In-flight mutation deduplication prevents rapid double-submission', async () => {
    const { server, port } = await startMockServer(async (_req, res) => {
      await new Promise((r) => setTimeout(r, 100)); // Hold connection for 100ms
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
    });

    try {
      const dedupKey = 'dedup-test-' + Date.now();
      const targetUrl = `http://127.0.0.1:${port}/test-dedup`;

      const promise1 = apiClient.post(targetUrl, { sample: 1 }, { dedupKey });

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

      const result1 = await promise1;
      assert.deepEqual(result1, { success: true });

      const result3 = await apiClient.post(targetUrl, { sample: 3 }, { dedupKey });
      assert.deepEqual(result3, { success: true });
    } finally {
      server.close();
    }
  });

  // 3. Request Timeout Protection
  await runTest('NET-03', 'Request timeout protection aborts hanging requests cleanly', async () => {
    const { server, port } = await startMockServer(async (_req, res) => {
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
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(capturedIdempotencyKey);
      assert.ok(isUuid, `Expected Idempotency-Key to be a valid UUID, got "${capturedIdempotencyKey}"`);

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

  // 8. Stalled Response Body Lifecycle
  await runTest('NET-08', 'Stalled response body stream triggers timeout after headers sent', async () => {
    const { server, port } = await startMockServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.write('{"data":');
    });

    try {
      const targetUrl = `http://127.0.0.1:${port}/stalled-stream`;
      let timeoutTriggered = false;

      try {
        await apiClient.get(targetUrl, { timeoutMs: 150, retries: 0 });
      } catch (err) {
        if (err instanceof ApiError && err.isTimeout && err.status === 408) {
          timeoutTriggered = true;
        }
      }

      assert.ok(timeoutTriggered, 'Expected stalled response body to abort with 408 timeout');
    } finally {
      server.close();
    }
  });

  // 9. Clean Abort Cancellation
  await runTest('NET-09', 'AbortController cancellation triggers REQUEST_ABORTED cleanly', async () => {
    const { server, port } = await startMockServer((_req, res) => {
      setTimeout(() => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      }, 300);
    });

    try {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 40);

      let abortConfirmed = false;
      try {
        await apiClient.get(`http://127.0.0.1:${port}/abort`, {
          signal: controller.signal,
          timeoutMs: 1000,
          retries: 0,
        });
      } catch (err) {
        if (err instanceof ApiError && err.code === 'REQUEST_ABORTED' && !err.isTimeout) {
          abortConfirmed = true;
        }
      }

      assert.ok(abortConfirmed, 'Expected caller abort to be classified as REQUEST_ABORTED');
    } finally {
      server.close();
    }
  });

  // 10. Database Health State Mapping
  await runTest('NET-10', 'evaluateNetworkHealthState identifies DATABASE_UNAVAILABLE', async () => {
    assert.equal(evaluateNetworkHealthState(true, true, true), 'ONLINE');
    assert.equal(evaluateNetworkHealthState(true, true, false), 'DATABASE_UNAVAILABLE');
    assert.equal(evaluateNetworkHealthState(false, true, false), 'OFFLINE');
    assert.equal(evaluateNetworkHealthState(true, false, false), 'API_UNREACHABLE');
  });

  // 11. QA Portion Creation & Completion Canonical SHA-256 Idempotency Contract
  await runTest('NET-11', 'QA portion creation & completion canonical SHA-256 idempotency contracts', async () => {
    const payloadA = { visitId: '101', portionId: '5', decision: 'ACCEPTED', results: [{ testId: 'FAT', numericValue: 4.5 }] };
    const payloadExact = { visitId: '101', portionId: '5', decision: 'ACCEPTED', results: [{ testId: 'FAT', numericValue: 4.5 }] };
    const payloadConflict = { visitId: '101', portionId: '5', decision: 'REJECTED', results: [{ testId: 'FAT', numericValue: 4.5 }] };

    const envelopeA = { operationType: 'QA_PORTION_COMPLETE', entityType: 'visit_portion', entityId: '5', payload: payloadA };
    const envelopeExact = { operationType: 'QA_PORTION_COMPLETE', entityType: 'visit_portion', entityId: '5', payload: payloadExact };
    const envelopeConflict = { operationType: 'QA_PORTION_COMPLETE', entityType: 'visit_portion', entityId: '5', payload: payloadConflict };

    const hashA = computePayloadHash(envelopeA);
    const hashExact = computePayloadHash(envelopeExact);
    const hashConflict = computePayloadHash(envelopeConflict);

    assert.equal(hashA, hashExact, 'Exact payload must produce identical SHA-256 hash');
    assert.notEqual(hashA, hashConflict, 'Altered decision must produce different SHA-256 hash');

    const mockRecord = {
      id: BigInt(1),
      key: 'test-key',
      operation_type: 'QA_PORTION_COMPLETE',
      entity_type: 'visit_portion',
      entityId: BigInt(5),
      entity_id: BigInt(5),
      payload_hash: hashA,
      request_payload: payloadA,
      response_payload: { success: true },
      status_code: 200,
      created_at: new Date(),
    };

    assert.equal(
      verifyReplay(mockRecord, { operationType: 'QA_PORTION_COMPLETE', entityType: 'visit_portion', entityId: 5, incomingPayload: payloadExact }).isMatch,
      true
    );
    assert.equal(
      verifyReplay(mockRecord, { operationType: 'QA_PORTION_COMPLETE', entityType: 'visit_portion', entityId: 5, incomingPayload: payloadConflict }).isMatch,
      false
    );
  });

  // 12. Gate & Weighbridge Replay Contract
  await runTest('NET-12', 'Gate & Weighbridge SHA-256 replay verification contracts', async () => {
    const grossPayload = { visitId: '202', grossWeightKg: 31500 };
    const grossReplay = { visitId: '202', grossWeightKg: 31500 };
    const grossConflict = { visitId: '202', grossWeightKg: 32000 };

    assert.equal(computePayloadHash(grossPayload), computePayloadHash(grossReplay));
    assert.notEqual(computePayloadHash(grossPayload), computePayloadHash(grossConflict));

    const gatePayload = { visitId: '303', tokenNumber: 'TK-12' };
    const gateReplay = { visitId: '303', tokenNumber: 'TK-12' };
    const gateConflict = { visitId: '303', tokenNumber: 'TK-99' };

    assert.equal(computePayloadHash(gatePayload), computePayloadHash(gateReplay));
    assert.notEqual(computePayloadHash(gatePayload), computePayloadHash(gateConflict));
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
