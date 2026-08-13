process.env.JWT_SECRET = "super-secret-jwt-key-milk-reception-app-2026";

import http from 'http';
import { createSessionToken } from '../src/backend/core/auth';
import { Role } from '../src/backend/core/types';

interface AuthBenchmarkResult {
  endpoint: string;
  status: number;
  rowsCount: number;
  payloadKb: number;
  coldMs: number;
  warmRunsMs: number[];
  avgWarmMs: number;
  medianWarmMs: number;
}

async function getAuthCookie(): Promise<string> {
  const testUser = {
    id: '1',
    username: 'superadmin',
    name: 'Super Admin',
    role: 'SUPER_ADMIN' as Role,
    department: 'Administration',
    scope_type: 'ALL',
    procurement_source_id: null,
  };
  const token = await createSessionToken(testUser, false);
  return `auth_token=${token}`;
}

function fetchTiming(url: string, cookie: string): Promise<{ ms: number; status: number; bytes: number; bodyText: string }> {
  return new Promise((resolve, reject) => {
    const start = process.hrtime.bigint();
    const parsedUrl = new URL(url);
    const req = http.request(
      {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || 3000,
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'GET',
        headers: { Cookie: cookie },
      },
      (res) => {
        let bytes = 0;
        let bodyText = '';
        res.on('data', (chunk) => {
          bytes += chunk.length;
          bodyText += chunk.toString();
        });
        res.on('end', () => {
          const end = process.hrtime.bigint();
          const durationMs = Number(end - start) / 1e6;
          resolve({ ms: durationMs, status: res.statusCode || 500, bytes, bodyText });
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

function countRows(bodyText: string): number {
  try {
    const json = JSON.parse(bodyText);
    if (Array.isArray(json)) return json.length;
    if (json.dispatches && Array.isArray(json.dispatches)) return json.dispatches.length;
    if (json.visits && Array.isArray(json.visits)) return json.visits.length;
    if (json.waitingVisits && Array.isArray(json.waitingVisits)) {
      return (json.waitingVisits.length || 0) + (json.testingVisits?.length || 0) + (json.heldVisits?.length || 0);
    }
    if (json.readyVisits && Array.isArray(json.readyVisits)) return json.readyVisits.length;
    if (json.operations && Array.isArray(json.operations)) return json.operations.length;
    if (typeof json === 'object' && json !== null) return Object.keys(json).length;
  } catch (e) {
    // Return 1 for non-json
  }
  return 1;
}

async function benchmarkAuthenticatedEndpoint(endpoint: string, cookie: string): Promise<AuthBenchmarkResult> {
  const baseUrl = 'http://localhost:3000';
  const url = `${baseUrl}${endpoint}`;

  // Cold run
  const coldRes = await fetchTiming(url, cookie);

  // Warm runs (4 runs)
  const warmRunsMs: number[] = [];
  for (let i = 0; i < 4; i++) {
    const warmRes = await fetchTiming(url, cookie);
    warmRunsMs.push(warmRes.ms);
  }

  const avgWarmMs = warmRunsMs.reduce((a, b) => a + b, 0) / warmRunsMs.length;
  const sorted = [...warmRunsMs].sort((a, b) => a - b);
  const medianWarmMs = (sorted[1] + sorted[2]) / 2;
  const rowsCount = countRows(coldRes.bodyText);
  const payloadKb = Number((coldRes.bytes / 1024).toFixed(2));

  return {
    endpoint,
    status: coldRes.status,
    rowsCount,
    payloadKb,
    coldMs: coldRes.ms,
    warmRunsMs,
    avgWarmMs,
    medianWarmMs,
  };
}

async function main() {
  console.log('==================================================');
  console.log('AUTHENTICATED API BENCHMARK (REAL HTTP 200 TIMINGS)');
  console.log('==================================================\n');

  const cookie = await getAuthCookie();

  const endpoints = [
    '/api/dispatches',
    '/api/security/dispatched-visits',
    '/api/security/active-visits',
    '/api/qa/sessions/queues',
    '/api/scale/ready-for-gross',
    '/api/scale/ready-for-tare',
    '/api/production/ready-for-unloading',
    '/api/production/unloading-queue',
    '/api/super-admin/overview',
    '/api/super-admin/operations',
  ];

  console.log(`ENDPOINT`.padEnd(38) + `STATUS`.padEnd(8) + `ROWS`.padEnd(8) + `PAYLOAD`.padEnd(10) + `COLD MS`.padEnd(10) + `WARM MEDIAN`);
  console.log('-'.repeat(88));

  for (const ep of endpoints) {
    try {
      const res = await benchmarkAuthenticatedEndpoint(ep, cookie);
      console.log(
        `${res.endpoint.padEnd(38)}${String(res.status).padEnd(8)}${String(res.rowsCount).padEnd(8)}${(res.payloadKb + ' KB').padEnd(10)}${(res.coldMs.toFixed(1) + ' ms').padEnd(10)}${res.medianWarmMs.toFixed(1)} ms`
      );
    } catch (e: any) {
      console.log(`${ep.padEnd(38)} Error: ${e.message}`);
    }
  }

  console.log('\n==================================================');
  console.log('AUTHENTICATED BENCHMARK COMPLETE');
  console.log('==================================================');
}

main();
