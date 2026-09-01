import { prisma } from '../src/backend/core/db';
import { resolveRoleHome } from '../src/lib/role-routing';
import { GET as getLogs } from '../src/app/api/logs/route';
import { createSessionToken } from '../src/backend/core/auth';
import { User, Role } from '../src/backend/core/types';
import fs from 'fs';
import path from 'path';

async function run4FATests() {
  console.log('================================================================================');
  console.log('STAGE 4F-A: PLANT CONTRACTOR MANAGER ROUTING & FOUNDATION CONTRACT SUITE');
  console.log('================================================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, title: string, detail?: string) {
    if (condition) {
      console.log(`[PASS] ${title}${detail ? ` (${detail})` : ''}`);
      passed++;
    } else {
      console.error(`[FAIL] ${title}${detail ? ` (${detail})` : ''}`);
      failed++;
    }
  }

  // Helper to create Request with Auth Cookie
  async function createAuthRequest(urlStr: string, method: string = 'GET', bodyObj?: any, u?: any) {
    const headers: Record<string, string> = {};
    if (u) {
      const userObj: User = {
        id: u.id.toString(),
        username: u.username,
        name: u.full_name || u.username,
        role: u.role as Role,
        department: u.department || '',
        zone: u.zone || null,
        scope_type: u.scope_type || 'SOURCE',
        procurement_source_id: u.procurement_source_id ? u.procurement_source_id.toString() : null,
      };
      const token = await createSessionToken(userObj);
      headers['cookie'] = `auth_token=${token}`;
      headers['authorization'] = `Bearer ${token}`;
    }

    if (bodyObj) {
      headers['content-type'] = 'application/json';
    }

    return new Request(urlStr, {
      method,
      headers,
      body: bodyObj ? JSON.stringify(bodyObj) : undefined,
    });
  }

  let tempAssignedManager: any = null;
  let tempUnboundManager: any = null;

  try {
    // --- SECTION A: ROLE ROUTING POLICY ---
    console.log('--- SECTION A: Canonical Role Routing ---');

    // A1: CONTRACTOR_MANAGER routes to /contractor/manager
    const contractorRoute = resolveRoleHome('CONTRACTOR_MANAGER');
    assert(
      contractorRoute === '/contractor/manager',
      'TEST-A1: CONTRACTOR_MANAGER resolves exactly to /contractor/manager',
      `Resolved: ${contractorRoute}`
    );

    // A2: Unrelated canonical roles resolve correctly
    assert(
      resolveRoleHome('SUPER_ADMIN') === '/super-admin',
      'TEST-A2.1: SUPER_ADMIN routes to /super-admin'
    );
    assert(
      resolveRoleHome('ZMCC_MANAGER') === '/mpd/zmcc-manager',
      'TEST-A2.2: ZMCC_MANAGER routes to /mpd/zmcc-manager'
    );
    assert(
      resolveRoleHome('MPD_Operator') === '/department/mpd',
      'TEST-A2.3: MPD_Operator routes to /department/mpd'
    );
    assert(
      resolveRoleHome('Security_Operator') === '/department/security',
      'TEST-A2.4: Security_Operator routes to /department/security'
    );
    assert(
      resolveRoleHome('Security_Manager') === '/department/security-manager',
      'TEST-A2.5: Security_Manager routes to /department/security-manager'
    );
    assert(
      resolveRoleHome('QA_Operator') === '/department/qa',
      'TEST-A2.6: QA_Operator routes to /department/qa'
    );
    assert(
      resolveRoleHome('WEIGHBRIDGE_OPERATOR') === '/department/weighbridge',
      'TEST-A2.7: WEIGHBRIDGE_OPERATOR routes to /department/weighbridge'
    );
    assert(
      resolveRoleHome('Production_Operator') === '/department/production',
      'TEST-A2.8: Production_Operator routes to /department/production'
    );

    // A3: Retired legacy & future roles remain fail-closed to /workspace-unavailable
    assert(
      resolveRoleHome('MPD_Zone_Manager') === '/workspace-unavailable',
      'TEST-A3.1: Legacy MPD_Zone_Manager fails closed to /workspace-unavailable'
    );
    assert(
      resolveRoleHome('Management') === '/workspace-unavailable',
      'TEST-A3.2: Legacy Management fails closed to /workspace-unavailable'
    );
    assert(
      resolveRoleHome('General_Plant_Manager') === '/workspace-unavailable',
      'TEST-A3.3: Legacy General_Plant_Manager fails closed to /workspace-unavailable'
    );
    assert(
      resolveRoleHome('QA_Manager') === '/workspace-unavailable',
      'TEST-A3.4: Legacy QA_Manager fails closed to /workspace-unavailable'
    );
    assert(
      resolveRoleHome('Production_Manager') === '/workspace-unavailable',
      'TEST-A3.5: Legacy Production_Manager fails closed to /workspace-unavailable'
    );
    assert(
      resolveRoleHome('Correction_Officer') === '/workspace-unavailable',
      'TEST-A3.6: Legacy Correction_Officer fails closed to /workspace-unavailable'
    );
    assert(
      resolveRoleHome('EXECUTIVE_MANAGEMENT') === '/workspace-unavailable',
      'TEST-A3.7: Future EXECUTIVE_MANAGEMENT fails closed to /workspace-unavailable'
    );
    assert(
      resolveRoleHome('UNKNOWN_ROLE_TEST') === '/workspace-unavailable',
      'TEST-A3.8: Unknown role fails closed to /workspace-unavailable'
    );

    // --- SECTION B: FILESYSTEM & WORKSPACE FOUNDATION ---
    console.log('\n--- SECTION B: Filesystem & Workspace Structure ---');

    const pagePath = path.join(__dirname, '../src/app/contractor/manager/page.tsx');
    assert(fs.existsSync(pagePath), 'TEST-B1: src/app/contractor/manager/page.tsx exists');

    const workspacePath = path.join(
      __dirname,
      '../src/frontend/modules/dashboard/PlantContractorManagerWorkspace.tsx'
    );
    assert(
      fs.existsSync(workspacePath),
      'TEST-B2: src/frontend/modules/dashboard/PlantContractorManagerWorkspace.tsx exists'
    );

    const workspaceSource = fs.readFileSync(workspacePath, 'utf-8');
    assert(
      workspaceSource.includes('Plant Contractor Manager'),
      'TEST-B3: Workspace contains business-facing name "Plant Contractor Manager"'
    );
    assert(
      workspaceSource.includes('OVERVIEW') &&
        workspaceSource.includes('LIVE') &&
        workspaceSource.includes('QUALITY') &&
        workspaceSource.includes('RECEIPTS') &&
        workspaceSource.includes('HISTORY'),
      'TEST-B4: Workspace defines all 5 planned tabs (OVERVIEW, LIVE, QUALITY, RECEIPTS, HISTORY)'
    );
    assert(
      !workspaceSource.includes('<select') && !workspaceSource.includes('setProcurementSource'),
      'TEST-B5: Workspace contains NO client-side contractor source selector or dropdown'
    );

    // Check Sidebar navigation
    const sidebarSource = fs.readFileSync(
      path.join(__dirname, '../src/frontend/modules/shared/Sidebar.tsx'),
      'utf-8'
    );
    assert(
      sidebarSource.includes('isContractorManager') && sidebarSource.includes('/contractor/manager'),
      'TEST-B6: Sidebar.tsx contains dedicated /contractor/manager link for CONTRACTOR_MANAGER'
    );

    // TEST-B7: Exact Seed Profile definition for contractor.manager.alkhair
    const seedSource = fs.readFileSync(path.join(__dirname, '../prisma/seed.ts'), 'utf-8');
    const seedMatches = seedSource.match(/\{\s*username:\s*['"]contractor\.manager\.alkhair['"][\s\S]*?\}/g);
    const exactSeedEntry = seedMatches && seedMatches.length === 1 ? seedMatches[0] : '';
    const hasCanonicalSeed =
      seedMatches?.length === 1 &&
      exactSeedEntry.includes("role: 'CONTRACTOR_MANAGER'") &&
      exactSeedEntry.includes("scopeType: 'SOURCE'") &&
      exactSeedEntry.includes("sourceCode: 'CONT-ALKHAIR'");
    assert(
      hasCanonicalSeed,
      'TEST-B7: prisma/seed.ts defines exact contractor.manager.alkhair entry with role CONTRACTOR_MANAGER, scopeType SOURCE, and sourceCode CONT-ALKHAIR'
    );

    // TEST-B8: Fixtures & DEFAULT_USERS for CONTRACTOR_MANAGER
    const { FIXTURE_USER_PROFILES, DEFAULT_USERS } = require('../src/backend/core/types');
    const contFixture = FIXTURE_USER_PROFILES['contractor.manager.alkhair'];
    const hasCanonicalFixture =
      contFixture?.role === 'CONTRACTOR_MANAGER' &&
      contFixture?.scope_type === 'SOURCE' &&
      DEFAULT_USERS['CONTRACTOR_MANAGER']?.username === 'contractor.manager.alkhair';
    assert(
      hasCanonicalFixture,
      'TEST-B8: FIXTURE_USER_PROFILES and DEFAULT_USERS map contractor.manager.alkhair to canonical CONTRACTOR_MANAGER'
    );

    // TEST-B9: DEV profiles route includes exact Al Khair Contractor Manager card
    const devProfilesSource = fs.readFileSync(
      path.join(__dirname, '../src/app/api/auth/dev-profiles/route.ts'),
      'utf-8'
    );
    const cardMatches = devProfilesSource.match(/\{\s*label:\s*['"]Plant Contractor Manager — Al Khair['"][\s\S]*?\}/g);
    const exactCard = cardMatches && cardMatches.length === 1 ? cardMatches[0] : '';
    const hasDevCard =
      cardMatches?.length === 1 &&
      exactCard.includes("username: 'contractor.manager.alkhair'") &&
      exactCard.includes("department: 'Milk Procurement (Al Khair)'");
    assert(
      hasDevCard,
      'TEST-B9: /api/auth/dev-profiles route includes exact Plant Contractor Manager — Al Khair card in MANAGERS group'
    );

    // --- SECTION C: BACKEND SOURCE ISOLATION CONTRACT ---
    console.log('\n--- SECTION C: Backend Source Isolation & Security ---');

    const contAlkhair = await prisma.procurementSource.findFirst({
      where: { code: 'CONT-ALKHAIR', source_type: 'CONTRACTOR' },
    });
    const contImran = await prisma.procurementSource.findFirst({
      where: { code: 'CONT-IMRAN', source_type: 'CONTRACTOR' },
    });

    assert(
      !!contAlkhair,
      'TEST-C0: Contractor source CONT-ALKHAIR exists in DB'
    );

    if (contAlkhair) {
      // Create DB user fixtures
      const ts = Date.now();
      tempAssignedManager = await prisma.user.create({
        data: {
          username: `test.mgr.alkhair.${ts}`,
          full_name: 'Test Al Khair Manager',
          role: 'CONTRACTOR_MANAGER',
          scope_type: 'SOURCE',
          procurement_source_id: contAlkhair.id,
          is_active: true,
        },
      });

      tempUnboundManager = await prisma.user.create({
        data: {
          username: `test.mgr.unbound.${ts}`,
          full_name: 'Test Unbound Manager',
          role: 'CONTRACTOR_MANAGER',
          scope_type: 'SOURCE',
          procurement_source_id: null,
          is_active: true,
        },
      });

      // C1: Assigned CONTRACTOR_MANAGER GET /api/logs returns only its own source records
      const reqLogs = await createAuthRequest(
        'http://localhost:3000/api/logs',
        'GET',
        undefined,
        tempAssignedManager
      );
      const resLogs = await getLogs(reqLogs as any);
      assert(resLogs.ok, 'TEST-C1.1: Assigned CONTRACTOR_MANAGER GET /api/logs responds with HTTP 200');

      const jsonLogs = await resLogs.json();
      const foreignLogs = (jsonLogs.logs || []).filter(
        (l: any) => l.procurement_source_id && l.procurement_source_id !== contAlkhair.id.toString()
      );
      assert(
        foreignLogs.length === 0,
        'TEST-C1.2: Assigned CONTRACTOR_MANAGER receives ZERO foreign contractor records',
        `Foreign count: ${foreignLogs.length}`
      );

      // C2: Unbound CONTRACTOR_MANAGER GET /api/logs fails closed with 0 records
      const reqUnbound = await createAuthRequest(
        'http://localhost:3000/api/logs',
        'GET',
        undefined,
        tempUnboundManager
      );
      const resUnbound = await getLogs(reqUnbound as any);
      assert(resUnbound.ok, 'TEST-C2.1: Unbound CONTRACTOR_MANAGER GET /api/logs responds');
      const jsonUnbound = await resUnbound.json();
      assert(
        (jsonUnbound.logs || []).length === 0,
        'TEST-C2.2: Unbound CONTRACTOR_MANAGER fails closed with 0 records',
        `Records: ${(jsonUnbound.logs || []).length}`
      );

      // C3: Client query param tampering (?procurement_source_id=...) cannot bypass assigned source
      if (contImran) {
        const reqTamper = await createAuthRequest(
          `http://localhost:3000/api/logs?procurementSourceId=${contImran.id}&contractor=${contImran.code}`,
          'GET',
          undefined,
          tempAssignedManager
        );
        const resTamper = await getLogs(reqTamper as any);
        const jsonTamper = await resTamper.json();
        const foreignTamperLogs = (jsonTamper.logs || []).filter(
          (l: any) => l.procurement_source_id && l.procurement_source_id !== contAlkhair.id.toString()
        );
        assert(
          foreignTamperLogs.length === 0,
          'TEST-C3: Client query param tampering receives ZERO foreign contractor records',
          `Tampered foreign count: ${foreignTamperLogs.length}`
        );
      }
    }
  } finally {
    // Cleanup temporary test users
    if (tempAssignedManager) {
      await prisma.user.delete({ where: { id: tempAssignedManager.id } }).catch(() => {});
    }
    if (tempUnboundManager) {
      await prisma.user.delete({ where: { id: tempUnboundManager.id } }).catch(() => {});
    }
  }

  // --- SUMMARY ---
  console.log('\n================================================================================');
  console.log(`STAGE 4F-A RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

run4FATests()
  .catch((err) => {
    console.error('Fatal error in Stage 4F-A test suite:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
