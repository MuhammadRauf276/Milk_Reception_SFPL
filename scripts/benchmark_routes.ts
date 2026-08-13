import http from 'http';

interface RouteBenchmark {
  route: string;
  coldMs: number;
  warmRunsMs: number[];
  avgWarmMs: number;
  medianWarmMs: number;
  status: number;
}

function fetchTiming(url: string, cookie?: string): Promise<{ ms: number; status: number; bytes: number }> {
  return new Promise((resolve, reject) => {
    const start = process.hrtime.bigint();
    const parsedUrl = new URL(url);
    const req = http.request(
      {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || 3000,
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'GET',
        headers: cookie ? { Cookie: cookie } : {},
      },
      (res) => {
        let bytes = 0;
        res.on('data', (chunk) => {
          bytes += chunk.length;
        });
        res.on('end', () => {
          const end = process.hrtime.bigint();
          const durationMs = Number(end - start) / 1e6;
          resolve({ ms: durationMs, status: res.statusCode || 500, bytes });
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

async function benchmarkRoute(route: string, authCookie?: string): Promise<RouteBenchmark> {
  const baseUrl = 'http://localhost:3000';
  const url = `${baseUrl}${route}`;

  // Cold run (Run 1)
  const coldRes = await fetchTiming(url, authCookie);

  // Warm runs (Run 2, 3, 4, 5)
  const warmRunsMs: number[] = [];
  for (let i = 0; i < 4; i++) {
    const warmRes = await fetchTiming(url, authCookie);
    warmRunsMs.push(warmRes.ms);
  }

  const avgWarmMs = warmRunsMs.reduce((a, b) => a + b, 0) / warmRunsMs.length;
  const sorted = [...warmRunsMs].sort((a, b) => a - b);
  const medianWarmMs = (sorted[1] + sorted[2]) / 2;

  return {
    route,
    coldMs: coldRes.ms,
    warmRunsMs,
    avgWarmMs,
    medianWarmMs,
    status: coldRes.status,
  };
}

async function main() {
  console.log('==================================================');
  console.log('BENCHMARKING PRODUCTION SERVER (HTTP GET TIMINGS)');
  console.log('==================================================\n');

  const routes = [
    '/login',
    '/department/mpd',
    '/department/security',
    '/department/qa',
    '/department/weighbridge',
    '/department/production',
    '/super-admin',
    '/super-admin/operations',
    '/api/dispatches',
    '/api/security/dispatched-visits',
    '/api/qa/sessions/queues',
    '/api/scale/ready-for-gross',
    '/api/production/ready-for-unloading',
    '/api/super-admin/overview',
  ];

  const results: RouteBenchmark[] = [];
  for (const r of routes) {
    try {
      const res = await benchmarkRoute(r);
      results.push(res);
      console.log(`Route: ${r.padEnd(38)} | Cold: ${res.coldMs.toFixed(1).padStart(6)}ms | Warm Median: ${res.medianWarmMs.toFixed(1).padStart(5)}ms | Status: ${res.status}`);
    } catch (e: any) {
      console.log(`Route: ${r.padEnd(38)} | Error: ${e.message}`);
    }
  }

  console.log('\n==================================================');
  console.log('BENCHMARK COMPLETE');
  console.log('==================================================');
}

main();
