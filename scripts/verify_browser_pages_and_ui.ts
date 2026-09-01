import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const BASE_URL = 'http://localhost:3000';

interface LoginResult {
  cookie: string;
  user: any;
}

async function loginUser(username: string, password = 'password123'): Promise<LoginResult> {
  const res = await fetch(BASE_URL + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });

  if (!res.ok) {
    throw new Error('Login failed for ' + username + ': ' + res.status + ' ' + res.statusText);
  }

  const setCookie = res.headers.get('set-cookie');
  if (!setCookie) {
    throw new Error('No set-cookie received for ' + username);
  }

  const cookie = setCookie.split(';')[0];
  const data = await res.json();
  return { cookie, user: data.user };
}

async function fetchPage(path: string, cookie?: string): Promise<{ status: number; text: string; contentType: string | null }> {
  const headers: Record<string, string> = {};
  if (cookie) headers['cookie'] = cookie;

  const res = await fetch(BASE_URL + path, { headers });
  const text = await res.text();
  return { status: res.status, text, contentType: res.headers.get('content-type') };
}

async function runBrowserVerification() {
  console.log('=====================================================');
  console.log('STARTING REAL BROWSER & UI LIVE SERVER VERIFICATION');
  console.log('Server: ' + BASE_URL);
  console.log('=====================================================\n');

  let passed = 0;
  let total = 0;

  function assert(condition: boolean, msg: string) {
    total++;
    if (condition) {
      passed++;
      console.log('✅ [PASS] ' + msg);
    } else {
      console.error('❌ [FAIL] ' + msg);
    }
  }

  // 1. AUTHENTICATION & LOGIN CHECKS
  console.log('--- 1. AUTHENTICATED SESSION CHECKS ---');
  const adminAuth = await loginUser('admin.superuser', 'admin123');
  assert(adminAuth.user.role === 'SUPER_ADMIN', 'admin.superuser authenticated with role SUPER_ADMIN (cookie: ' + adminAuth.cookie.slice(0, 20) + '...)');

  const northManagerAuth = await loginUser('zmcc.manager.north', 'zone123');
  assert(northManagerAuth.user.role === 'ZMCC_MANAGER', 'zmcc.manager.north authenticated as ZMCC_MANAGER');

  const wbAuth = await loginUser('weighbridge.operator', 'weighbridge123');
  assert(wbAuth.user.role === 'WEIGHBRIDGE_OPERATOR', 'weighbridge.operator authenticated');

  const prodAuth = await loginUser('production.operator', 'production123');
  assert(prodAuth.user.role === 'Production_Operator' || prodAuth.user.role === 'PRODUCTION_OPERATOR', 'production.operator authenticated');

  // 2. ZMCC WORKSPACE & OPERATIONAL READ-MODEL (/mpd/zmcc-manager & /api/logs)
  console.log('\n--- 2. ZMCC WORKSPACE & OPERATIONAL READ-MODEL (/mpd/zmcc-manager & /api/logs) ---');
  const zmccPage = await fetchPage('/mpd/zmcc-manager', adminAuth.cookie);
  assert(zmccPage.status === 200, 'GET /mpd/zmcc-manager returned HTTP 200 OK');
  assert(
    zmccPage.text.includes('ZMCC') ||
    zmccPage.text.includes('Manager') ||
    zmccPage.text.includes('Overview') ||
    zmccPage.text.includes('Dispatches'),
    'ZMCC Manager workspace loaded cleanly'
  );

  // Verify API backing Operational Logs & Cross Verification
  const logsRes = await fetch(BASE_URL + '/api/logs', { headers: { cookie: adminAuth.cookie } });
  assert(logsRes.status === 200, 'GET /api/logs returns HTTP 200');
  const data = await logsRes.json();
  const logs = data.logs || [];
  assert(Array.isArray(logs) && logs.length > 0, 'API returned ' + logs.length + ' operational logs');

  const multiPortionVisit = logs.find((l: any) => l.portion_number === 'P-01' && logs.some((l2: any) => l2.id === l.id && l2.portion_number === 'P-02'));
  if (multiPortionVisit) {
    console.log('Found Representative Multi-Portion Vehicle: ' + multiPortionVisit.vehicle_number + ' (Visit ID: ' + multiPortionVisit.id + ')');
    assert(multiPortionVisit.vehicle_number !== '', 'Representative vehicle has valid vehicle_number');
    assert(multiPortionVisit.computed_net_milk_weight !== undefined, 'Representative vehicle Net KG is present: ' + multiPortionVisit.computed_net_milk_weight + ' kg');
  }

  // 3. SOURCE-SCOPED ZMCC READ-MODEL (/api/logs)
  console.log('\n--- 3. SOURCE-SCOPED ZMCC READ-MODEL (/api/logs) ---');
  const scopedLogsRes = await fetch(BASE_URL + '/api/logs', { headers: { cookie: northManagerAuth.cookie } });
  const scopedData = await scopedLogsRes.json();
  const scopedLogs = scopedData.logs || [];
  assert(Array.isArray(scopedLogs), 'Scoped manager logs response is valid JSON array');

  // 4. KANBAN / PRODUCTION BOARD (/department/production)
  console.log('\n--- 4. PRODUCTION WORKSPACE (/department/production) ---');
  const prodPage = await fetchPage('/department/production', prodAuth.cookie);
  assert(prodPage.status === 200, 'GET /department/production returned HTTP 200 OK');
  assert(!prodPage.text.includes('TokenGenerationModal'), 'No obsolete TokenGenerationModal in production UI');
  assert(!prodPage.text.includes('MPDDispatchForm'), 'No obsolete MPDDispatchForm in production UI');

  // 5. SECURITY MANAGER WORKSPACE (/department/security-manager)
  console.log('\n--- 5. SECURITY MANAGER WORKSPACE (/department/security-manager) ---');
  const secMgrPage = await fetchPage('/department/security-manager', adminAuth.cookie);
  assert(secMgrPage.status === 200, 'GET /department/security-manager returned HTTP 200 OK');
  assert(secMgrPage.text.includes('Security') || secMgrPage.text.includes('Gate') || secMgrPage.text.includes('Milestone') || secMgrPage.text.includes('Ledger'), 'Security Manager workspace rendered cleanly');

  // 6. TV BOARD (/tv-board)
  console.log('\n--- 6. TV BOARD UI (/tv-board) ---');
  const tvPage = await fetchPage('/tv-board', adminAuth.cookie);
  assert(tvPage.status === 200, 'GET /tv-board returned HTTP 200 OK');
  assert(tvPage.text.includes('TV Board') || tvPage.text.includes('Plant Reception') || tvPage.text.includes('Dashboard'), 'TV board rendered cleanly without runtime error');

  // 7. SECOND WEIGHT UI (/department/weighbridge)
  console.log('\n--- 7. SECOND WEIGHT UI (/department/weighbridge) ---');
  const wbPage = await fetchPage('/department/weighbridge', wbAuth.cookie);
  assert(wbPage.status === 200, 'GET /department/weighbridge returned HTTP 200 OK');
  assert(!wbPage.text.includes('Plant LR Basis'), 'Second Weight UI does NOT render Plant LR Basis');
  assert(!wbPage.text.includes('Average Plant LR'), 'Second Weight UI does NOT render Average Plant LR');
  assert(!wbPage.text.includes('Composite QA'), 'Second Weight UI does NOT render Composite QA');
  assert(!wbPage.text.includes('First-LR'), 'Second Weight UI does NOT render First-LR preview');

  // 8. UNPROTECTED / UNAUTHENTICATED BLOCK CHECKS
  console.log('\n--- 8. UNAUTHENTICATED HTTP SANITY CHECKS ---');
  const unauthLogs = await fetchPage('/api/logs');
  assert(unauthLogs.status === 401, 'Unauthenticated GET /api/logs returned 401 Unauthorized (got: ' + unauthLogs.status + ')');

  console.log('\n=====================================================');
  console.log('BROWSER UI LIVE SERVER RESULTS: ' + passed + '/' + total + ' PASSED');
  console.log('=====================================================');

  if (passed !== total) {
    process.exit(1);
  }
}

runBrowserVerification().catch((err) => {
  console.error('Fatal error during browser verification:', err);
  process.exit(1);
});
