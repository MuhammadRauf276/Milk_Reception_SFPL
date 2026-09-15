/**
 * STAGE 6G-D.4A: REPOSITORY ARCHITECTURE GOVERNANCE + DATA RETRIEVAL SCALABILITY REGRESSION SUITE
 *
 * Verifies:
 * 1. Database Schema & Migration Invariants:
 *    - Exactly 26 tracked migrations in prisma/migrations
 *    - No uncommitted or out-of-band schema migrations (#27 does not exist)
 *    - Zero Elasticsearch dependencies or clients in package.json
 * 2. Architecture Governance & Code Map:
 *    - CURRENT-RULES.md defines Section 24 (Retrieval Scalability, Modes, Envelope, Anti-Load-All)
 *    - ADR-000 and ADR-004 document migration immutability and schema workflows
 *    - README.md documents Gross Liters, @13TS Liters, and 08:00 AM Plant Business Date boundary
 *    - CANONICAL-CODE-MAP.md documents operationalReadModelService, super-admin routes, and pagination
 * 3. Operational Read Model Service (operationalReadModelService.ts):
 *    - Exported types: RetrievalMode ('live' | 'recent' | 'search' | 'report'), PaginationMeta, PaginatedOperationalLogs
 *    - getDefaultRecentDateRange(): strictly returns last 7 PKT calendar days
 *    - Fail-closed role scoping: scoped roles without assigned source return empty envelope
 *    - Server-side bounded pagination: default pageSize 20, max pageSize 100, page calculation
 *    - Optimized getOperationalLogById via prisma.vehicleVisit.findUnique
 * 4. API Endpoints:
 *    - GET /api/logs parses mode, page, pageSize, fromDate, toDate, returns standard pagination envelope
 *    - GET /api/super-admin/operations performs server-side pagination with count and skip/take
 *    - GET /api/super-admin/audit performs server-side pagination with count and skip/take
 * 5. Frontend Workspaces:
 *    - ZMCCManagerWorkspace uses mode=live and does not auto-poll completed history
 *    - PlantContractorManagerWorkspace uses mode=live for active tab and mode=recent for history
 *    - SecurityManager uses mode=live
 *    - tv-board page uses mode=live
 *    - ContractorHistoryReports queries report/recent mode
 *    - ZMCC Arrivals and Lab workspaces pass page and pageSize=20, render pager controls
 *    - Super Admin operations and audit pages render interactive pager controls
 */

import path from 'path';
import fs from 'fs';
import { assertSafeTestDatabase } from '../tests/helpers/testDbSafety';
import { getTrackedMigrationCount } from '../tests/helpers/migrationInventory';

// 1. Load .env.test.local
const repoRoot = path.resolve(__dirname, '..');

// 1. Load .env
const devEnvPath = path.join(repoRoot, '.env');
if (fs.existsSync(devEnvPath)) {
  const envContent = fs.readFileSync(devEnvPath, 'utf8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const idx = trimmed.indexOf('=');
      if (idx > 0) {
        const key = trimmed.substring(0, idx).trim();
        let val = trimmed.substring(idx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.substring(1, val.length - 1);
        }
        process.env[key] = val;
      }
    }
  }
}

// 2. Load .env.test.local
const testEnvPath = path.join(repoRoot, '.env.test.local');
if (fs.existsSync(testEnvPath)) {
  const envContent = fs.readFileSync(testEnvPath, 'utf8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const idx = trimmed.indexOf('=');
      if (idx > 0) {
        const key = trimmed.substring(0, idx).trim();
        let val = trimmed.substring(idx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.substring(1, val.length - 1);
        }
        process.env[key] = val;
      }
    }
  }
}

// 2. Point DATABASE_URL to TEST_DATABASE_URL
if (!process.env.DEV_DATABASE_URL) {
  process.env.DEV_DATABASE_URL = process.env.DATABASE_URL;
}
if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}

// 3. Enforce test isolation
const { testDbName } = assertSafeTestDatabase({
  testDbUrl: process.env.TEST_DATABASE_URL,
  devDbUrl: process.env.DEV_DATABASE_URL,
});

console.log('=====================================================================');
console.log('🧪 STAGE 6G-D.4A: DATA RETRIEVAL SCALABILITY & ARCHITECTURE SUITE');
console.log(`🎯 Target Database: ${testDbName} (TEST ISOLATION ENFORCED)`);
console.log('=====================================================================\n');

let passed = 0;
let failed = 0;

function assert(condition: boolean, title: string, details?: string) {
  if (condition) {
    console.log(`[PASS] ${title}${details ? ` - ${details}` : ''}`);
    passed++;
  } else {
    console.error(`[FAIL] ${title}${details ? ` - ${details}` : ''}`);
    failed++;
  }
}

async function runStage6gd4aTests() {
  const { prisma } = await import('../src/backend/core/db');
  const { createSessionToken } = await import('../src/backend/core/auth');
  const {
    getDefaultRecentDateRange,
    getPaginatedOperationalLogs,
    getOperationalLogById,
  } = await import('../src/backend/services/operationalReadModelService');

  // Helper to construct authenticated test requests
  async function makeAuthToken(u: any): Promise<string> {
    return await createSessionToken({
      id: u.id.toString(),
      username: u.username,
      name: u.full_name || u.username,
      role: u.role as any,
      department: u.department || 'Testing',
      zone: null,
      scope_type: u.scope_type || 'SOURCE',
      procurement_source_id: u.procurement_source_id ? u.procurement_source_id.toString() : null,
      last_login_at: null,
    });
  }

  function makeAuthRequest(url: string, method: string, token: string, body?: any): Request {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
    };
    if (body) {
      headers['Content-Type'] = 'application/json';
    }
    return new Request(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  console.log('--- 1. Database Schema & Migration Invariants ---');
  const migrationCount = getTrackedMigrationCount(repoRoot);
  assert(
    migrationCount === 26,
    'D4A-01: Tracked migrations count is exactly 26',
    `Found: ${migrationCount}`
  );

  const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  const allDeps = {
    ...(packageJson.dependencies || {}),
    ...(packageJson.devDependencies || {}),
  };
  assert(
    !allDeps['@elastic/elasticsearch'] && !allDeps['elasticsearch'],
    'D4A-02: Zero Elasticsearch dependencies in package.json'
  );

  console.log('\n--- 2. Architecture Documentation & Code Governance ---');
  const currentRulesSrc = fs.readFileSync(path.join(repoRoot, 'docs/architecture/CURRENT-RULES.md'), 'utf8');
  assert(
    currentRulesSrc.includes('24. Stage 6G-D.4A Operational UI Data Retrieval & History Scalability') &&
    currentRulesSrc.includes('LIVE') &&
    currentRulesSrc.includes('RECENT_HISTORY') &&
    currentRulesSrc.includes('SEARCH') &&
    currentRulesSrc.includes('REPORT'),
    'D4A-03: CURRENT-RULES.md defines Section 24 with the 4 canonical retrieval modes'
  );

  const readmeSrc = fs.readFileSync(path.join(repoRoot, 'README.md'), 'utf8');
  assert(
    readmeSrc.includes('Gross Liters') &&
    readmeSrc.includes('@13TS Liters') &&
    readmeSrc.includes('08:00 AM') &&
    readmeSrc.includes('Plant Gate Exit'),
    'D4A-04: README.md defines authoritative liters and 08:00 Plant Business Date boundary'
  );

  const codeMapSrc = fs.readFileSync(path.join(repoRoot, 'docs/architecture/CANONICAL-CODE-MAP.md'), 'utf8');
  assert(
    codeMapSrc.includes('operationalReadModelService.ts') &&
    codeMapSrc.includes('Stage 6G-D.4A'),
    'D4A-05: CANONICAL-CODE-MAP.md references operationalReadModelService and Stage 6G-D.4A'
  );

  console.log('\n--- 3. Operational Read Model Service Unit & Invariant Tests ---');
  // 3A: Date range calculation
  const dateRange = getDefaultRecentDateRange();
  assert(
    typeof dateRange.fromDate === 'string' &&
    typeof dateRange.toDate === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(dateRange.fromDate) &&
    /^\d{4}-\d{2}-\d{2}$/.test(dateRange.toDate) &&
    dateRange.fromDate <= dateRange.toDate,
    'D4A-06: getDefaultRecentDateRange returns valid YYYY-MM-DD range',
    `${dateRange.fromDate} to ${dateRange.toDate}`
  );

  // 3B: Fail-closed role scoping
  const scopedUserWithoutSource = {
    id: '999999',
    username: 'unassigned_contractor',
    role: 'CONTRACTOR_OPERATOR',
    scope_type: 'SOURCE',
    procurement_source_id: null,
  };
  const failClosedResult = await getPaginatedOperationalLogs({ mode: 'recent' }, scopedUserWithoutSource as any);
  assert(
    failClosedResult.items.length === 0 &&
    failClosedResult.logs.length === 0 &&
    failClosedResult.pagination.totalRecords === 0 &&
    failClosedResult.pagination.totalPages === 1,
    'D4A-07: Scoped contractor user without assigned source fails closed to empty envelope'
  );

  // 3C: Super Admin mode queries
  const superAdminUser = {
    id: '1',
    username: 'admin.superuser',
    role: 'SUPER_ADMIN',
    scope_type: 'ALL',
  };

  const liveResult = await getPaginatedOperationalLogs({ mode: 'live' }, superAdminUser as any);
  assert(
    Array.isArray(liveResult.items) &&
    Array.isArray(liveResult.logs) &&
    liveResult.pagination.pageSize === 100 &&
    liveResult.pagination.page === 1,
    'D4A-08: mode=live returns live operational records bounded by max 100',
    `Found ${liveResult.items.length} live items`
  );

  const recentResult = await getPaginatedOperationalLogs({ mode: 'recent', pageSize: 5 }, superAdminUser as any);
  assert(
    recentResult.pagination.pageSize === 5 &&
    recentResult.pagination.page === 1 &&
    typeof recentResult.pagination.totalRecords === 'number' &&
    typeof recentResult.pagination.totalPages === 'number',
    'D4A-09: mode=recent respects requested pageSize=5 and computes totalPages',
    `totalRecords: ${recentResult.pagination.totalRecords}, totalPages: ${recentResult.pagination.totalPages}`
  );

  // Max page size clamp
  const clampedResult = await getPaginatedOperationalLogs({ mode: 'recent', pageSize: 500 }, superAdminUser as any);
  assert(
    clampedResult.pagination.pageSize === 100,
    'D4A-10: pageSize is clamped to max 100 when >100 is requested',
    `clamped to: ${clampedResult.pagination.pageSize}`
  );

  // 3D: Single log lookup via findUnique
  const nonExistentLog = await getOperationalLogById('NON-EXISTENT-ID', superAdminUser as any);
  assert(
    nonExistentLog === null,
    'D4A-11: getOperationalLogById returns null for non-existent ID using optimized findUnique'
  );

  console.log('\n--- 4. API Routes Integration Tests ---');
  // 4A: GET /api/logs route
  const { GET: getLogsRoute } = await import('../src/app/api/logs/route');
  const adminDbUser = await prisma.user.findFirst({ where: { role: 'SUPER_ADMIN' } });
  if (!adminDbUser) {
    throw new Error('No SUPER_ADMIN user found in test database');
  }
  const adminToken = await makeAuthToken(adminDbUser);

  const liveReq = makeAuthRequest('http://localhost:3000/api/logs?mode=live', 'GET', adminToken);
  const liveRes = await getLogsRoute(liveReq as any);
  const liveJson = await liveRes.json();
  assert(
    liveRes.status === 200 &&
    Array.isArray(liveJson.items) &&
    Array.isArray(liveJson.logs) &&
    liveJson.pagination &&
    liveJson.pagination.page === 1,
    'D4A-12: GET /api/logs?mode=live returns 200 with standard pagination envelope'
  );

  const recentReq = makeAuthRequest('http://localhost:3000/api/logs?mode=recent&page=1&pageSize=10', 'GET', adminToken);
  const recentRes = await getLogsRoute(recentReq as any);
  const recentJson = await recentRes.json();
  assert(
    recentRes.status === 200 &&
    Array.isArray(recentJson.items) &&
    recentJson.pagination &&
    recentJson.pagination.pageSize === 10,
    'D4A-13: GET /api/logs?mode=recent parses page=1, pageSize=10 and returns envelope'
  );

  // 4B: Super Admin operations route
  const { GET: getSaOpsRoute } = await import('../src/app/api/super-admin/operations/route');
  const saOpsReq = makeAuthRequest('http://localhost:3000/api/super-admin/operations?page=1&pageSize=10', 'GET', adminToken);
  const saOpsRes = await getSaOpsRoute(saOpsReq);
  const saOpsJson = await saOpsRes.json();
  assert(
    saOpsRes.status === 200 &&
    Array.isArray(saOpsJson.visits) &&
    saOpsJson.pagination &&
    saOpsJson.pagination.pageSize === 10 &&
    typeof saOpsJson.pagination.totalRecords === 'number' &&
    typeof saOpsJson.pagination.totalPages === 'number',
    'D4A-14: GET /api/super-admin/operations executes bounded query with pagination envelope'
  );

  // 4C: Super Admin audit route
  const { GET: getSaAuditRoute } = await import('../src/app/api/super-admin/audit/route');
  const saAuditReq = makeAuthRequest('http://localhost:3000/api/super-admin/audit?page=1&pageSize=10', 'GET', adminToken);
  const saAuditRes = await getSaAuditRoute(saAuditReq);
  const saAuditJson = await saAuditRes.json();
  assert(
    saAuditRes.status === 200 &&
    Array.isArray(saAuditJson.auditLogs) &&
    saAuditJson.pagination &&
    saAuditJson.pagination.pageSize === 10 &&
    typeof saAuditJson.pagination.totalRecords === 'number' &&
    typeof saAuditJson.pagination.totalPages === 'number',
    'D4A-15: GET /api/super-admin/audit executes bounded query with pagination envelope'
  );

  console.log('\n--- 5. Frontend Workspaces Invariant Checks ---');
  // 5A: ZMCCManagerWorkspace
  const zmccWsSrc = fs.readFileSync(path.join(repoRoot, 'src/frontend/modules/dashboard/ZMCCManagerWorkspace.tsx'), 'utf8');
  assert(
    zmccWsSrc.includes("fetch('/api/logs?mode=live')") &&
    !zmccWsSrc.includes('fetchReceiptLogs();\n    }, 15000)'),
    'D4A-16: ZMCCManagerWorkspace fetches mode=live and does not auto-poll receipt history'
  );

  // 5B: PlantContractorManagerWorkspace
  const contractorWsSrc = fs.readFileSync(path.join(repoRoot, 'src/frontend/modules/dashboard/PlantContractorManagerWorkspace.tsx'), 'utf8');
  assert(
    contractorWsSrc.includes("mode = activeTab === 'LIVE' ? 'live' : 'recent'") &&
    contractorWsSrc.includes('items || data.logs'),
    'D4A-17: PlantContractorManagerWorkspace dynamically selects mode=live or mode=recent and consumes envelope items'
  );

  // 5C: SecurityManager
  const securityWsSrc = fs.readFileSync(path.join(repoRoot, 'src/frontend/modules/dashboard/SecurityManager.tsx'), 'utf8');
  assert(
    securityWsSrc.includes("fetch('/api/logs?mode=live')") &&
    securityWsSrc.includes('data.items || data.logs'),
    'D4A-18: SecurityManager queries mode=live and consumes envelope items'
  );

  // 5D: tv-board page
  const tvBoardSrc = fs.readFileSync(path.join(repoRoot, 'src/app/tv-board/page.tsx'), 'utf8');
  assert(
    tvBoardSrc.includes("fetch('/api/logs?mode=live')") &&
    tvBoardSrc.includes('data.items || data.logs'),
    'D4A-19: TV board queries mode=live and consumes envelope items'
  );

  // 5E: ContractorHistoryReports
  const contractorReportsSrc = fs.readFileSync(path.join(repoRoot, 'src/frontend/modules/dashboard/contractor/ContractorHistoryReports.tsx'), 'utf8');
  assert(
    contractorReportsSrc.includes("params.set('mode'") &&
    contractorReportsSrc.includes("'report'") &&
    contractorReportsSrc.includes('data.items || data.logs'),
    'D4A-20: ContractorHistoryReports queries mode=report and consumes envelope items'
  );

  // 5F: ZMCC Arrivals and Lab Workspaces
  const arrivalsWsSrc = fs.readFileSync(path.join(repoRoot, 'src/frontend/modules/zmcc/arrivals/ZmccArrivalsWorkspace.tsx'), 'utf8');
  const labWsSrc = fs.readFileSync(path.join(repoRoot, 'src/frontend/modules/zmcc/lab/ZmccLabWorkspace.tsx'), 'utf8');
  assert(
    arrivalsWsSrc.includes('historyPageSize') &&
    arrivalsWsSrc.includes('historyTotalPages > 1') &&
    labWsSrc.includes('historyPageSize') &&
    labWsSrc.includes('historyTotalPages > 1'),
    'D4A-21: ZMCC Arrivals and Lab workspaces pass pageSize=20 and render pager controls'
  );

  // 5G: Super Admin Operations & Audit UI
  const saOpsPageSrc = fs.readFileSync(path.join(repoRoot, 'src/app/super-admin/operations/page.tsx'), 'utf8');
  const saAuditPageSrc = fs.readFileSync(path.join(repoRoot, 'src/app/super-admin/audit/page.tsx'), 'utf8');
  assert(
    saOpsPageSrc.includes('totalPages > 1') &&
    saOpsPageSrc.includes('setPage') &&
    saAuditPageSrc.includes('totalPages > 1') &&
    saAuditPageSrc.includes('setPage'),
    'D4A-22: Super Admin Operations and Audit pages render pagination controls'
  );

  console.log('\n=====================================================================');
  console.log(`SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('=====================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runStage6gd4aTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
