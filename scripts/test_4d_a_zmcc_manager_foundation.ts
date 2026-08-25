import { prisma } from '../src/backend/core/db';
import { GET as getDispatches } from '../src/app/api/dispatches/route';
import { POST as startDispatch } from '../src/app/api/dispatches/start/route';
import { POST as postGrossWeight } from '../src/app/api/scale/gross-weight/route';
import { createSessionToken } from '../src/backend/core/auth';
import { User, Role } from '../src/backend/core/types';
import fs from 'fs';
import path from 'path';

async function run4DATests() {
  console.log('================================================================================');
  console.log('STAGE 4D-A: ZMCC MANAGER FOUNDATION & SECURITY REGRESSION SUITE');
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

  // 1. Fetch real DB fixtures
  const zmccHasilpur = await prisma.procurementSource.findFirst({ where: { code: 'ZMCC-HASILPUR' } });
  const zmccJhang = await prisma.procurementSource.findFirst({ where: { code: 'ZMCC-JHANG' } });
  const contAlkhair = await prisma.procurementSource.findFirst({ where: { code: 'CONT-ALKHAIR' } });

  const zmccOpHasilpur = await prisma.user.findFirst({ where: { username: 'zmcc.operator' } });
  const zoneManager = await prisma.user.findFirst({ where: { username: 'zmcc.manager.north' } });

  assert(!!zmccHasilpur && !!zmccJhang && !!zmccOpHasilpur && !!zoneManager, 'TEST-0: Base fixtures exist in DB');

  // A1: LoginPage.tsx routing for ZMCC_MANAGER
  const loginPageSource = fs.readFileSync(path.join(__dirname, '../src/frontend/modules/auth/LoginPage.tsx'), 'utf-8');
  const hasZmccManagerRoute = loginPageSource.includes("role === 'ZMCC_MANAGER'") && loginPageSource.includes("router.push('/department/zmcc-manager')");
  assert(hasZmccManagerRoute, 'TEST-A1: ZMCC_MANAGER login destination routes to /department/zmcc-manager in LoginPage.tsx');

  // A2: Dedicated page and component exist
  const pageExists = fs.existsSync(path.join(__dirname, '../src/app/department/zmcc-manager/page.tsx'));
  const workspaceExists = fs.existsSync(path.join(__dirname, '../src/frontend/modules/dashboard/ZMCCManagerWorkspace.tsx'));
  assert(pageExists && workspaceExists, 'TEST-A2: Dedicated Next.js route and ZMCCManagerWorkspace component exist');

  const workspaceSource = fs.readFileSync(path.join(__dirname, '../src/frontend/modules/dashboard/ZMCCManagerWorkspace.tsx'), 'utf-8');

  let tempManagerHasilpur: any = null;
  let tempUnboundManager: any = null;

  try {
    tempManagerHasilpur = await prisma.user.create({
      data: {
        username: `tmp.mgr.hasilpur.${Date.now()}`,
        role: 'ZMCC_MANAGER',
        scope_type: 'SOURCE',
        procurement_source_id: zmccHasilpur!.id,
        is_active: true,
      },
    });

    tempUnboundManager = await prisma.user.create({
      data: {
        username: `tmp.mgr.unbound.${Date.now()}`,
        role: 'ZMCC_MANAGER',
        scope_type: 'SOURCE',
        procurement_source_id: null,
        is_active: true,
      },
    });

    // A3: ZMCC_MANAGER GET /api/dispatches returns ONLY assigned procurement_source_id records
    const reqScoped = await createAuthRequest('http://localhost:3000/api/dispatches?range=30d', 'GET', undefined, tempManagerHasilpur);
    const resScoped = await getDispatches(reqScoped);
    const jsonScoped = await resScoped.json();

    assert(resScoped.ok, 'TEST-A3.1: Scoped ZMCC_MANAGER GET /api/dispatches succeeds');
    const foreignDispatches = (jsonScoped.dispatches || []).filter(
      (d: any) => d.procurement_source_id !== zmccHasilpur!.id.toString()
    );
    assert(foreignDispatches.length === 0, 'TEST-A3.2: Scoped ZMCC_MANAGER receives ZERO foreign dispatches', `Count: ${foreignDispatches.length}`);

    // A4: ZMCC_MANAGER with no source assignment fails closed (returns 0 dispatches)
    const reqUnbound = await createAuthRequest('http://localhost:3000/api/dispatches?range=30d', 'GET', undefined, tempUnboundManager);
    const resUnbound = await getDispatches(reqUnbound);
    const jsonUnbound = await resUnbound.json();

    assert(resUnbound.ok, 'TEST-A4.1: Unbound ZMCC_MANAGER GET /api/dispatches returns response');
    assert((jsonUnbound.dispatches || []).length === 0, 'TEST-A4.2: Unbound ZMCC_MANAGER fails closed with 0 records', `Records: ${(jsonUnbound.dispatches || []).length}`);

    // A5: Ordinary MPD operator source-scoping behavior remains unchanged
    const reqMpd = await createAuthRequest('http://localhost:3000/api/dispatches?range=30d', 'GET', undefined, zmccOpHasilpur);
    const resMpd = await getDispatches(reqMpd);
    const jsonMpd = await resMpd.json();
    const mpdForeign = (jsonMpd.dispatches || []).filter(
      (d: any) => d.procurement_source_id !== zmccOpHasilpur!.procurement_source_id?.toString()
    );
    assert(mpdForeign.length === 0, 'TEST-A5: MPD Operator source-scoping unchanged (0 foreign dispatches)');

    // A6: MPD_Zone_Manager existing behavior is not accidentally changed
    const reqZone = await createAuthRequest('http://localhost:3000/api/dispatches?range=30d', 'GET', undefined, zoneManager);
    const resZone = await getDispatches(reqZone);
    assert(resZone.ok, 'TEST-A6: MPD_Zone_Manager GET /api/dispatches succeeds normally');

    // A7: ZMCC Manager workspace does not expose known plant mutation actions
    const workspaceSource = fs.readFileSync(path.join(__dirname, '../src/frontend/modules/dashboard/ZMCCManagerWorkspace.tsx'), 'utf-8');
    const hasGrossWeightAction = workspaceSource.includes('/api/scale/gross-weight') || workspaceSource.includes('Record Gross');
    const hasTareWeightAction = workspaceSource.includes('/api/scale/tare-weight') || workspaceSource.includes('Record Tare');
    const hasQaAcceptAction = workspaceSource.includes('/api/qa/vehicle-visits') && workspaceSource.includes('/complete');
    assert(!hasGrossWeightAction && !hasTareWeightAction && !hasQaAcceptAction, 'TEST-A7.1: ZMCCManagerWorkspace contains zero plant operational mutation actions');

    // Also verify backend blocks mutation if ZMCC_MANAGER tries to call mutation APIs
    const reqMut = await createAuthRequest('http://localhost:3000/api/scale/gross-weight', 'POST', { visitId: '1', grossWeightKg: 30000 }, tempManagerHasilpur);
    const resMut = await postGrossWeight(reqMut);
    assert(resMut.status === 403 || resMut.status === 401, 'TEST-A7.2: Backend blocks ZMCC_MANAGER from Gross Weight entry (403/401)');
  } finally {
    if (tempManagerHasilpur?.id) {
      await prisma.user.delete({ where: { id: tempManagerHasilpur.id } }).catch(() => {});
    }
    if (tempUnboundManager?.id) {
      await prisma.user.delete({ where: { id: tempUnboundManager.id } }).catch(() => {});
    }
  }

  // A8: Measurement Method does not reappear
  const hasMeasurementMethod = workspaceSource.includes('Measurement Method') || workspaceSource.includes('measurement_method');
  assert(!hasMeasurementMethod, 'TEST-A8: Measurement Method is not present in ZMCC Manager workspace');

  // A9: Save Draft does not reappear
  const hasSaveDraft = workspaceSource.includes('Save Draft') || workspaceSource.includes('saveDraft') || workspaceSource.includes('/draft');
  assert(!hasSaveDraft, 'TEST-A9: Save Draft is not present in ZMCC Manager workspace');

  // A10: Tab Architecture is complete (6 tabs)
  const requiredTabs = ['OVERVIEW', 'LIVE', 'CROSS_VERIFICATION', 'QUALITY', 'RECEIPTS', 'HISTORY'];
  const allTabsPresent = requiredTabs.every((tab) => workspaceSource.includes(`id: '${tab}'`));
  assert(allTabsPresent, 'TEST-A10: All 6 required tabs (OVERVIEW, LIVE, CROSS_VERIFICATION, QUALITY, RECEIPTS, HISTORY) are defined in ZMCCManagerWorkspace');

  // A11: Sidebar contains ZMCC_MANAGER link
  const sidebarSource = fs.readFileSync(path.join(__dirname, '../src/frontend/modules/shared/Sidebar.tsx'), 'utf-8');
  const hasSidebarZmccLink = sidebarSource.includes("role === 'ZMCC_MANAGER'") && sidebarSource.includes('/department/zmcc-manager');
  assert(hasSidebarZmccLink, 'TEST-A11: Sidebar.tsx contains dedicated /department/zmcc-manager link for ZMCC_MANAGER');

  console.log('\n================================================================================');
  console.log(`SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================================\n');

  await prisma.$disconnect();

  if (failed > 0) {
    process.exit(1);
  }
}

run4DATests().catch((err) => {
  console.error('Test runner fatal error:', err);
  process.exit(1);
});
