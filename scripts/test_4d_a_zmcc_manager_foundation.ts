import { prisma } from '../src/backend/core/db';
import { GET as getDispatches } from '../src/app/api/dispatches/route';
import { POST as postGrossWeight } from '../src/app/api/scale/gross-weight/route';
import { createSessionToken } from '../src/backend/core/auth';
import { User, Role } from '../src/backend/core/types';
import fs from 'fs';
import path from 'path';

async function run4DATests() {
  console.log('================================================================================');
  console.log('STAGE 4D-A: ZMCC MANAGER FOUNDATION & MPD HIERARCHY REGRESSION SUITE');
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
  const contOpAlkhair = await prisma.user.findFirst({ where: { username: 'contractor.operator.alkhair' } });
  const zoneManager = await prisma.user.findFirst({ where: { username: 'zmcc.manager.north' } });

  assert(!!zmccHasilpur && !!zmccJhang && !!contAlkhair && !!zmccOpHasilpur && !!zoneManager, 'TEST-0: Base fixtures exist in DB');

  // A1: ZMCC_MANAGER canonical destination is /mpd/zmcc-manager
  const loginPageSource = fs.readFileSync(path.join(__dirname, '../src/frontend/modules/auth/LoginPage.tsx'), 'utf-8');
  const rootPageSource = fs.readFileSync(path.join(__dirname, '../src/app/page.tsx'), 'utf-8');

  const hasZmccManagerLoginRoute = loginPageSource.includes("role === 'ZMCC_MANAGER'") && loginPageSource.includes("router.push('/mpd/zmcc-manager')");
  const hasNoOldLoginRoute = !loginPageSource.includes("router.push('/department/zmcc-manager')");
  const hasZmccManagerRootRoute = rootPageSource.includes("role === 'ZMCC_MANAGER'") && rootPageSource.includes("redirect('/mpd/zmcc-manager')");
  const hasNoOldRootRoute = !rootPageSource.includes("redirect('/department/zmcc-manager')");

  assert(hasZmccManagerLoginRoute && hasNoOldLoginRoute && hasZmccManagerRootRoute && hasNoOldRootRoute, 'TEST-A1: ZMCC_MANAGER canonical destination is /mpd/zmcc-manager in LoginPage and root page');

  // A2: src/app/mpd/zmcc-manager/page.tsx exists
  const newPageExists = fs.existsSync(path.join(__dirname, '../src/app/mpd/zmcc-manager/page.tsx'));
  assert(newPageExists, 'TEST-A2: src/app/mpd/zmcc-manager/page.tsx exists');

  // A3: old src/app/department/zmcc-manager/page.tsx does NOT exist
  const oldPageExists = fs.existsSync(path.join(__dirname, '../src/app/department/zmcc-manager/page.tsx'));
  assert(!oldPageExists, 'TEST-A3: Old route src/app/department/zmcc-manager/page.tsx is completely removed');

  // A4: ZMCC_MANAGER sidebar includes /mpd/zmcc-manager
  const sidebarSource = fs.readFileSync(path.join(__dirname, '../src/frontend/modules/shared/Sidebar.tsx'), 'utf-8');
  const hasSidebarMpdZmccLink = sidebarSource.includes("isZmccManager") && sidebarSource.includes("href=\"/mpd/zmcc-manager\"");
  assert(hasSidebarMpdZmccLink, 'TEST-A4: Sidebar.tsx contains dedicated /mpd/zmcc-manager link for ZMCC_MANAGER');

  // A5: ZMCC_MANAGER sidebar does NOT expose standalone /cross-verification
  // In isZmccManager block, verify only /mpd/zmcc-manager is present
  const isZmccBlock = sidebarSource.match(/\{isZmccManager && \([\s\S]*?\)\}/)?.[0] || '';
  const zmccExposesCrossVerification = isZmccBlock.includes('href="/cross-verification"');
  assert(!zmccExposesCrossVerification, 'TEST-A5: ZMCC_MANAGER sidebar does NOT expose standalone /cross-verification link');

  // A6 & A7: ZMCCManagerWorkspace has all 6 tabs including internal Cross Verification
  const workspaceSource = fs.readFileSync(path.join(__dirname, '../src/frontend/modules/dashboard/ZMCCManagerWorkspace.tsx'), 'utf-8');
  const requiredTabs = ['OVERVIEW', 'LIVE', 'CROSS_VERIFICATION', 'QUALITY', 'RECEIPTS', 'HISTORY'];
  const allTabsPresent = requiredTabs.every((tab) => workspaceSource.includes(`id: '${tab}'`));
  const hasInternalCrossVerificationTab = workspaceSource.includes("id: 'CROSS_VERIFICATION'") && workspaceSource.includes("label: 'Cross Verification'");
  assert(allTabsPresent && hasInternalCrossVerificationTab, 'TEST-A6 & A7: ZMCCManagerWorkspace contains all 6 required tabs including Cross Verification internal tab');

  let tempManagerHasilpur: any = null;
  let tempUnboundManager: any = null;
  let tempContractorManager: any = null;

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

    tempContractorManager = await prisma.user.create({
      data: {
        username: `tmp.mgr.alkhair.${Date.now()}`,
        role: 'CONTRACTOR_MANAGER',
        scope_type: 'SOURCE',
        procurement_source_id: contAlkhair!.id,
        is_active: true,
      },
    });

    // A8: ZMCC_MANAGER GET /api/dispatches returns ONLY assigned procurement_source_id records
    const reqScoped = await createAuthRequest('http://localhost:3000/api/dispatches?range=30d', 'GET', undefined, tempManagerHasilpur);
    const resScoped = await getDispatches(reqScoped);
    const jsonScoped = await resScoped.json();

    assert(resScoped.ok, 'TEST-A8.1: Scoped ZMCC_MANAGER GET /api/dispatches succeeds');
    const foreignDispatches = (jsonScoped.dispatches || []).filter(
      (d: any) => d.procurement_source_id !== zmccHasilpur!.id.toString()
    );
    assert(foreignDispatches.length === 0, 'TEST-A8.2: Scoped ZMCC_MANAGER receives ZERO foreign dispatches', `Count: ${foreignDispatches.length}`);

    // A9: ZMCC_MANAGER with no source assignment fails closed (returns 0 dispatches)
    const reqUnbound = await createAuthRequest('http://localhost:3000/api/dispatches?range=30d', 'GET', undefined, tempUnboundManager);
    const resUnbound = await getDispatches(reqUnbound);
    const jsonUnbound = await resUnbound.json();

    assert(resUnbound.ok, 'TEST-A9.1: Unbound ZMCC_MANAGER GET /api/dispatches returns response');
    assert((jsonUnbound.dispatches || []).length === 0, 'TEST-A9.2: Unbound ZMCC_MANAGER fails closed with 0 records', `Records: ${(jsonUnbound.dispatches || []).length}`);

    // A10: CONTRACTOR_MANAGER source-scoping behavior intact
    const reqCont = await createAuthRequest('http://localhost:3000/api/dispatches?range=30d', 'GET', undefined, tempContractorManager);
    const resCont = await getDispatches(reqCont);
    const jsonCont = await resCont.json();

    assert(resCont.ok, 'TEST-A10.1: Scoped CONTRACTOR_MANAGER GET /api/dispatches succeeds');
    const contForeignDispatches = (jsonCont.dispatches || []).filter(
      (d: any) => d.procurement_source_id !== contAlkhair!.id.toString()
    );
    assert(contForeignDispatches.length === 0, 'TEST-A10.2: Scoped CONTRACTOR_MANAGER receives ZERO foreign dispatches', `Count: ${contForeignDispatches.length}`);

    // A11: Ordinary MPD operator and MPD_Zone_Manager source-scoping behavior remains unchanged
    const reqMpd = await createAuthRequest('http://localhost:3000/api/dispatches?range=30d', 'GET', undefined, zmccOpHasilpur);
    const resMpd = await getDispatches(reqMpd);
    const jsonMpd = await resMpd.json();
    const mpdForeign = (jsonMpd.dispatches || []).filter(
      (d: any) => d.procurement_source_id !== zmccOpHasilpur!.procurement_source_id?.toString()
    );
    assert(mpdForeign.length === 0, 'TEST-A11.1: MPD Operator source-scoping unchanged (0 foreign dispatches)');

    const reqZone = await createAuthRequest('http://localhost:3000/api/dispatches?range=30d', 'GET', undefined, zoneManager);
    const resZone = await getDispatches(reqZone);
    assert(resZone.ok, 'TEST-A11.2: MPD_Zone_Manager GET /api/dispatches succeeds normally');

    // A12: ZMCC Manager workspace does not expose known plant mutation actions
    const hasGrossWeightAction = workspaceSource.includes('/api/scale/gross-weight') || workspaceSource.includes('Record Gross');
    const hasTareWeightAction = workspaceSource.includes('/api/scale/tare-weight') || workspaceSource.includes('Record Tare');
    const hasQaAcceptAction = workspaceSource.includes('/api/qa/vehicle-visits') && workspaceSource.includes('/complete');
    assert(!hasGrossWeightAction && !hasTareWeightAction && !hasQaAcceptAction, 'TEST-A12.1: ZMCCManagerWorkspace contains zero plant operational mutation actions');

    // Also verify backend blocks mutation if ZMCC_MANAGER tries to call mutation APIs
    const reqMut = await createAuthRequest('http://localhost:3000/api/scale/gross-weight', 'POST', { visitId: '1', grossWeightKg: 30000 }, tempManagerHasilpur);
    const resMut = await postGrossWeight(reqMut);
    assert(resMut.status === 403 || resMut.status === 401, 'TEST-A12.2: Backend blocks ZMCC_MANAGER from Gross Weight entry (403/401)');
  } finally {
    if (tempManagerHasilpur?.id) {
      await prisma.user.delete({ where: { id: tempManagerHasilpur.id } }).catch(() => {});
    }
    if (tempUnboundManager?.id) {
      await prisma.user.delete({ where: { id: tempUnboundManager.id } }).catch(() => {});
    }
    if (tempContractorManager?.id) {
      await prisma.user.delete({ where: { id: tempContractorManager.id } }).catch(() => {});
    }
  }

  // A13: Measurement Method does not reappear
  const hasMeasurementMethod = workspaceSource.includes('Measurement Method') || workspaceSource.includes('measurement_method');
  assert(!hasMeasurementMethod, 'TEST-A13: Measurement Method is not present in ZMCC Manager workspace');

  // A14: Save Draft does not reappear
  const hasSaveDraft = workspaceSource.includes('Save Draft') || workspaceSource.includes('saveDraft') || workspaceSource.includes('/draft');
  assert(!hasSaveDraft, 'TEST-A14: Save Draft is not present in ZMCC Manager workspace');

  // A15: Standalone /cross-verification route remains preserved for other roles
  const crossVerificationRouteExists = fs.existsSync(path.join(__dirname, '../src/app/cross-verification/page.tsx'));
  assert(crossVerificationRouteExists, 'TEST-A15: Standalone /cross-verification route remains preserved for other roles');

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
