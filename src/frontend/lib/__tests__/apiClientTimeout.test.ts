import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { apiClient, ApiError } from '../apiClient';

async function startMockServer(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void | Promise<void>
): Promise<{ server: http.Server; url: string }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        reject(new Error('Failed to obtain server address'));
        return;
      }
      resolve({ server, url: `http://127.0.0.1:${addr.port}` });
    });
  });
}

test('apiClient: Stalled response body triggers timeout (status 408, isTimeout=true)', async () => {
  const { server, url } = await startMockServer((_req, res) => {
    // Send headers immediately, but stall the body indefinitely
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.write('{"partial":');
    // Never finish res.end()
  });

  try {
    let timeoutCaught = false;
    try {
      await apiClient.get(`${url}/stalled-body`, { timeoutMs: 150, retries: 0 });
    } catch (err) {
      if (err instanceof ApiError && err.isTimeout && err.status === 408) {
        timeoutCaught = true;
      } else {
        throw err;
      }
    }
    assert.ok(timeoutCaught, 'Expected stalled response body to trigger 408 REQUEST_TIMEOUT');
  } finally {
    server.close();
  }
});

test('apiClient: External AbortController cancellation throws REQUEST_ABORTED (not 408 timeout)', async () => {
  const { server, url } = await startMockServer((_req, res) => {
    // Server takes 500ms
    setTimeout(() => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    }, 500);
  });

  try {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 50);

    let abortCaught = false;
    try {
      await apiClient.get(`${url}/abort-test`, {
        signal: controller.signal,
        timeoutMs: 2000,
        retries: 0,
      });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'REQUEST_ABORTED' && !err.isTimeout) {
        abortCaught = true;
      } else {
        throw err;
      }
    }
    assert.ok(abortCaught, 'Expected user abort to throw REQUEST_ABORTED rather than timeout');
  } finally {
    server.close();
  }
});

test('apiClient: GET requests retry on transient failure up to configured retry count', async () => {
  let attempts = 0;
  const { server, url } = await startMockServer((_req, res) => {
    attempts++;
    if (attempts === 1) {
      // First attempt destroys socket abruptly
      res.destroy();
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ attempt: attempts, success: true }));
    }
  });

  try {
    const data = await apiClient.get<{ attempt: number; success: boolean }>(`${url}/retry-get`, {
      retries: 2,
      timeoutMs: 2000,
    });
    assert.equal(data.success, true);
    assert.equal(attempts, 2, 'Expected exactly 2 attempts (1 failure + 1 retry)');
  } finally {
    server.close();
  }
});

test('apiClient: Mutation requests (POST, PUT, DELETE) are never retried automatically', async () => {
  let postAttempts = 0;
  let putAttempts = 0;
  let deleteAttempts = 0;

  const { server, url } = await startMockServer((req, res) => {
    if (req.method === 'POST') {
      postAttempts++;
      res.destroy();
    } else if (req.method === 'PUT') {
      putAttempts++;
      res.destroy();
    } else if (req.method === 'DELETE') {
      deleteAttempts++;
      res.destroy();
    }
  });

  try {
    await assert.rejects(
      async () => apiClient.post(`${url}/mutation`, { data: 1 }, { retries: 3 as unknown as number }),
      (err: unknown) => err instanceof ApiError && err.isNetworkError
    );
    assert.equal(postAttempts, 1, 'POST mutation must not be retried');

    await assert.rejects(
      async () => apiClient.put(`${url}/mutation`, { data: 1 }, { retries: 3 as unknown as number }),
      (err: unknown) => err instanceof ApiError && err.isNetworkError
    );
    assert.equal(putAttempts, 1, 'PUT mutation must not be retried');

    await assert.rejects(
      async () => apiClient.delete(`${url}/mutation`, { retries: 3 as unknown as number }),
      (err: unknown) => err instanceof ApiError && err.isNetworkError
    );
    assert.equal(deleteAttempts, 1, 'DELETE mutation must not be retried');
  } finally {
    server.close();
  }
});

test('apiClient: Rapid double-tap mutation deduplication throws 429 DUPLICATE_IN_FLIGHT', async () => {
  const { server, url } = await startMockServer((_req, res) => {
    setTimeout(() => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
    }, 100);
  });

  try {
    const dedupKey = 'user-action-button-double-tap';
    const req1 = apiClient.post(`${url}/action`, { value: 1 }, { dedupKey });

    await assert.rejects(
      async () => apiClient.post(`${url}/action`, { value: 2 }, { dedupKey }),
      (err: unknown) => err instanceof ApiError && err.status === 429 && err.code === 'DUPLICATE_IN_FLIGHT'
    );

    await req1;
  } finally {
    server.close();
  }
});

test('apiClient: Custom stable idempotency key is preserved across client retries', async () => {
  const receivedKeys: string[] = [];
  const { server, url } = await startMockServer((req, res) => {
    receivedKeys.push(req.headers['idempotency-key'] as string);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  });

  try {
    const stableOpId = 'stable-op-' + Date.now();
    await apiClient.post(`${url}/idemp-test`, { count: 1 }, { idempotencyKey: stableOpId });
    await apiClient.post(`${url}/idemp-test`, { count: 2 }, { idempotencyKey: stableOpId });

    assert.equal(receivedKeys.length, 2);
    assert.equal(receivedKeys[0], stableOpId);
    assert.equal(receivedKeys[1], stableOpId);
  } finally {
    server.close();
  }
});
