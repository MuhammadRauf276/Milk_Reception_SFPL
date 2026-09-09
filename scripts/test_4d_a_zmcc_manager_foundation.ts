import { prisma } from '../src/backend/core/db';
import { GET as getDispatches } from '../src/app/api/dispatches/route';
import { GET as getLogs } from '../src/app/api/logs/route';
import { POST as postGrossWeight } from '../src/app/api/scale/gross-weight/route';
import { createSessionToken } from '../src/backend/core/auth';
import { User, Role } from '../src/backend/core/types';
import { formatOperationalDatetime, formatOperationalTime } from '../src/lib/datetime-utils';
import { getOperationalBusinessDate } from '../src/backend/core/business-day';
import fs from 'fs';
import path from 'path';

async function run4DATests() {
  console.log('================================================================================');
  console.log('STAGE 4D-A-R: ZMCC MANAGER FOUNDATION & SECURITY AUDIT REGRESSION SUITE');
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

  // 1. Fetch real DB fixtures dynamically without source-name hardcoding
  const zmccSources = await prisma.procurementSource.findMany({
    where: { source_type: 'ZMCC', is_active: true },
    orderBy: { id: 'asc' },
  });
  const contractorSources = await prisma.procurementSource.findMany({
    where: { source_type: 'CONTRACTOR', is_active: true },
    orderBy: { id: 'asc' },
  });

  assert(zmccSources.length >= 2, 'TEST-0.1: At least two distinct active ZMCC sources exist in DB');
  assert(contractorSources.length >= 1, 'TEST-0.2: At least one active Contractor source exists in DB');

  const sourceA = zmccSources[0];
  const sourceB = zmccSources[1];
  const contSource = contractorSources[0];

  const zoneManager = await prisma.user.findFirst({ where: { username: 'zmcc.manager.north' } });

  assert(!!sourceA && !!sourceB && !!contSource && !!zoneManager, 'TEST-0.3: Base fixtures exist in DB');

  // A1: ZMCC_MANAGER canonical destination is /mpd/zmcc-manager
  const loginPageSource = fs.readFileSync(path.join(__dirname, '../src/frontend/modules/auth/LoginPage.tsx'), 'utf-8');
  const rootPageSource = fs.readFileSync(path.join(__dirname, '../src/app/page.tsx'), 'utf-8');

  const { resolveRoleHome } = require('../src/lib/role-routing');
  const hasZmccManagerResolved = resolveRoleHome('ZMCC_MANAGER') === '/mpd/zmcc-manager';
  const hasZmccManagerLoginRoute =
    (loginPageSource.includes('resolveRoleHome') || loginPageSource.includes("router.push('/mpd/zmcc-manager')")) &&
    hasZmccManagerResolved;
  const hasNoOldLoginRoute = !loginPageSource.includes("router.push('/department/zmcc-manager')");
  const hasZmccManagerRootRoute =
    (rootPageSource.includes('resolveRoleHome') || rootPageSource.includes("redirect('/mpd/zmcc-manager')")) &&
    hasZmccManagerResolved;
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
  const isZmccBlock = sidebarSource.match(/\{isZmccManager && \([\s\S]*?\)\}/)?.[0] || '';
  const zmccExposesCrossVerification = isZmccBlock.includes('href="/cross-verification"');
  assert(!zmccExposesCrossVerification, 'TEST-A5: ZMCC_MANAGER sidebar does NOT expose standalone /cross-verification link');

  // A6 & A7: ZMCCManagerWorkspace has all 6 tabs including internal Cross Verification
  const workspaceSource = fs.readFileSync(path.join(__dirname, '../src/frontend/modules/dashboard/ZMCCManagerWorkspace.tsx'), 'utf-8');
  const requiredTabs = ['OVERVIEW', 'LIVE', 'CROSS_VERIFICATION', 'QUALITY', 'RECEIPTS', 'HISTORY'];
  const allTabsPresent = requiredTabs.every((tab) => workspaceSource.includes(`id: '${tab}'`));
  const hasInternalCrossVerificationTab = workspaceSource.includes("id: 'CROSS_VERIFICATION'") && workspaceSource.includes("label: 'Cross Verification'");
  assert(allTabsPresent && hasInternalCrossVerificationTab, 'TEST-A6 & A7: ZMCCManagerWorkspace contains all 6 required tabs including Cross Verification internal tab');

  let tempManagerA: any = null;
  let tempManagerB: any = null;
  let tempUnboundManager: any = null;
  let tempContractorManager: any = null;
  let tempUnboundContractorManager: any = null;
  let visitA: any = null;
  let visitB: any = null;

  try {
    // Create Manager A assigned to distinct ZMCC Source A
    tempManagerA = await prisma.user.create({
      data: {
        username: `tmp.mgr.a.${Date.now()}`,
        role: 'ZMCC_MANAGER',
        scope_type: 'SOURCE',
        procurement_source_id: sourceA.id,
        is_active: true,
      },
    });

    // Create Manager B assigned to distinct ZMCC Source B
    tempManagerB = await prisma.user.create({
      data: {
        username: `tmp.mgr.b.${Date.now()}`,
        role: 'ZMCC_MANAGER',
        scope_type: 'SOURCE',
        procurement_source_id: sourceB.id,
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
        username: `tmp.mgr.cont.${Date.now()}`,
        role: 'CONTRACTOR_MANAGER',
        scope_type: 'SOURCE',
        procurement_source_id: contSource.id,
        is_active: true,
      },
    });

    tempUnboundContractorManager = await prisma.user.create({
      data: {
        username: `tmp.mgr.unbound.cont.${Date.now()}`,
        role: 'CONTRACTOR_MANAGER',
        scope_type: 'SOURCE',
        procurement_source_id: null,
        is_active: true,
      },
    });

    // Insert disposable test records for Source A and Source B to ensure tests do NOT pass vacuously
    const isoTs = Date.now();
    visitA = await prisma.vehicleVisit.create({
      data: {
        visit_number: `VISIT-4DA-A-${isoTs}`,
        vehicle_number: `VEH-4DA-A-${isoTs}`,
        procurement_source_id: sourceA.id,
        current_status: 'DISPATCHED',
        operational_date: new Date(),
        vehicle_dispatch_quantity_value: 5000,
        vehicle_dispatch_quantity_unit: 'LITER',
        portions: {
          create: [
            {
              portion_number: 1,
              dispatch_quantity_value: 5000,
              dispatch_quantity_unit: 'LITER',
            },
          ],
        },
      },
    });

    visitB = await prisma.vehicleVisit.create({
      data: {
        visit_number: `VISIT-4DA-B-${isoTs}`,
        vehicle_number: `VEH-4DA-B-${isoTs}`,
        procurement_source_id: sourceB.id,
        current_status: 'DISPATCHED',
        operational_date: new Date(),
        vehicle_dispatch_quantity_value: 6000,
        vehicle_dispatch_quantity_unit: 'LITER',
        portions: {
          create: [
            {
              portion_number: 1,
              dispatch_quantity_value: 6000,
              dispatch_quantity_unit: 'LITER',
            },
          ],
        },
      },
    });

    // R1 & R2: GET /api/logs ZMCC_MANAGER Source Isolation (Distinct Source A)
    const reqLogsA = await createAuthRequest('http://localhost:3000/api/logs', 'GET', undefined, tempManagerA);
    const resLogsA = await getLogs(reqLogsA as any);
    const jsonLogsA = await resLogsA.json();

    assert(resLogsA.ok, 'TEST-R1.1: Scoped ZMCC_MANAGER (Source A) GET /api/logs succeeds');
    const foreignLogsA = (jsonLogsA.logs || []).filter(
      (l: any) => l.zonal_contractor_name !== sourceA.name
    );
    const sourceBLogsInA = (jsonLogsA.logs || []).filter(
      (l: any) => l.zonal_contractor_name === sourceB.name
    );
    const hasVisitAInLogsA = (jsonLogsA.logs || []).some(
      (l: any) => l.vehicle_number === visitA.vehicle_number
    );
    const hasVisitBInLogsA = (jsonLogsA.logs || []).some(
      (l: any) => l.vehicle_number === visitB.vehicle_number
    );
    assert(
      hasVisitAInLogsA && !hasVisitBInLogsA && foreignLogsA.length === 0 && sourceBLogsInA.length === 0,
      'TEST-R1.2: Manager A receives known Record A, ZERO records from Source B, and ZERO foreign source records (non-vacuous)',
      `Visit A present: ${hasVisitAInLogsA}, Visit B in A: ${hasVisitBInLogsA}, Foreign Count: ${foreignLogsA.length}`
    );

    // R2.1 & R2.2: GET /api/logs ZMCC_MANAGER Source Isolation (Distinct Source B)
    const reqLogsB = await createAuthRequest('http://localhost:3000/api/logs', 'GET', undefined, tempManagerB);
    const resLogsB = await getLogs(reqLogsB as any);
    const jsonLogsB = await resLogsB.json();

    assert(resLogsB.ok, 'TEST-R2.1: Scoped ZMCC_MANAGER (Source B) GET /api/logs succeeds');
    const foreignLogsB = (jsonLogsB.logs || []).filter(
      (l: any) => l.zonal_contractor_name !== sourceB.name
    );
    const sourceALogsInB = (jsonLogsB.logs || []).filter(
      (l: any) => l.zonal_contractor_name === sourceA.name
    );
    const hasVisitBInLogsB = (jsonLogsB.logs || []).some(
      (l: any) => l.vehicle_number === visitB.vehicle_number
    );
    const hasVisitAInLogsB = (jsonLogsB.logs || []).some(
      (l: any) => l.vehicle_number === visitA.vehicle_number
    );
    assert(
      hasVisitBInLogsB && !hasVisitAInLogsB && foreignLogsB.length === 0 && sourceALogsInB.length === 0,
      'TEST-R2.2: Manager B receives known Record B, ZERO records from Source A, and ZERO foreign source records (bidirectional isolation verified, non-vacuous)',
      `Visit B present: ${hasVisitBInLogsB}, Visit A in B: ${hasVisitAInLogsB}, Foreign Count: ${foreignLogsB.length}`
    );

    // R3: Unbound ZMCC_MANAGER GET /api/logs fails closed
    const reqLogsUnbound = await createAuthRequest('http://localhost:3000/api/logs', 'GET', undefined, tempUnboundManager);
    const resLogsUnbound = await getLogs(reqLogsUnbound as any);
    const jsonLogsUnbound = await resLogsUnbound.json();

    assert(resLogsUnbound.ok, 'TEST-R3.1: Unbound ZMCC_MANAGER GET /api/logs returns response');
    assert((jsonLogsUnbound.logs || []).length === 0, 'TEST-R3.2: Unbound ZMCC_MANAGER GET /api/logs fails closed with 0 records', `Records: ${(jsonLogsUnbound.logs || []).length}`);

    // R4: CONTRACTOR_MANAGER assigned source GET /api/logs returns its own source only
    const reqLogsCont = await createAuthRequest('http://localhost:3000/api/logs', 'GET', undefined, tempContractorManager);
    const resLogsCont = await getLogs(reqLogsCont as any);
    const jsonLogsCont = await resLogsCont.json();

    assert(resLogsCont.ok, 'TEST-R4.1: Scoped CONTRACTOR_MANAGER GET /api/logs succeeds');
    const foreignLogsCont = (jsonLogsCont.logs || []).filter(
      (l: any) => l.zonal_contractor_name !== contSource.name
    );
    assert(foreignLogsCont.length === 0, 'TEST-R4.2: Scoped CONTRACTOR_MANAGER GET /api/logs receives ZERO foreign source records', `Foreign Count: ${foreignLogsCont.length}`);

    // R5: Unbound CONTRACTOR_MANAGER GET /api/logs fails closed
    const reqLogsContUnbound = await createAuthRequest('http://localhost:3000/api/logs', 'GET', undefined, tempUnboundContractorManager);
    const resLogsContUnbound = await getLogs(reqLogsContUnbound as any);
    const jsonLogsContUnbound = await resLogsContUnbound.json();

    assert(resLogsContUnbound.ok, 'TEST-R5.1: Unbound CONTRACTOR_MANAGER GET /api/logs returns response');
    assert((jsonLogsContUnbound.logs || []).length === 0, 'TEST-R5.2: Unbound CONTRACTOR_MANAGER GET /api/logs fails closed with 0 records', `Records: ${(jsonLogsContUnbound.logs || []).length}`);

    // R6: MPD_Zone_Manager visibility semantics remain unchanged
    const reqZone = await createAuthRequest('http://localhost:3000/api/logs', 'GET', undefined, zoneManager);
    const resZone = await getLogs(reqZone as any);
    assert(resZone.ok, 'TEST-R6: MPD_Zone_Manager GET /api/logs succeeds normally');

    // R7.1 & R7.2: GET /api/dispatches source isolation between Source A and Source B
    const reqDispatchesA = await createAuthRequest('http://localhost:3000/api/dispatches?range=30d', 'GET', undefined, tempManagerA);
    const resDispatchesA = await getDispatches(reqDispatchesA);
    const jsonDispatchesA = await resDispatchesA.json();

    assert(resDispatchesA.ok, 'TEST-R7.1: Scoped ZMCC_MANAGER (Source A) GET /api/dispatches succeeds');
    const foreignDispatchesA = (jsonDispatchesA.dispatches || []).filter(
      (d: any) => d.procurement_source_id !== sourceA.id.toString()
    );
    const sourceBDispatchesInA = (jsonDispatchesA.dispatches || []).filter(
      (d: any) => d.procurement_source_id === sourceB.id.toString()
    );
    const hasVisitAInDispatchesA = (jsonDispatchesA.dispatches || []).some(
      (d: any) => d.visit_number === visitA.visit_number
    );
    const hasVisitBInDispatchesA = (jsonDispatchesA.dispatches || []).some(
      (d: any) => d.visit_number === visitB.visit_number
    );
    assert(
      hasVisitAInDispatchesA && !hasVisitBInDispatchesA && foreignDispatchesA.length === 0 && sourceBDispatchesInA.length === 0,
      'TEST-R7.2: Manager A receives known Dispatch A, ZERO dispatches from Source B, and ZERO foreign dispatches (non-vacuous)',
      `Dispatch A present: ${hasVisitAInDispatchesA}, Dispatch B in A: ${hasVisitBInDispatchesA}, Foreign Count: ${foreignDispatchesA.length}`
    );

    const reqDispatchesB = await createAuthRequest('http://localhost:3000/api/dispatches?range=30d', 'GET', undefined, tempManagerB);
    const resDispatchesB = await getDispatches(reqDispatchesB);
    const jsonDispatchesB = await resDispatchesB.json();

    assert(resDispatchesB.ok, 'TEST-R7.3: Scoped ZMCC_MANAGER (Source B) GET /api/dispatches succeeds');
    const foreignDispatchesB = (jsonDispatchesB.dispatches || []).filter(
      (d: any) => d.procurement_source_id !== sourceB.id.toString()
    );
    const sourceADispatchesInB = (jsonDispatchesB.dispatches || []).filter(
      (d: any) => d.procurement_source_id === sourceA.id.toString()
    );
    const hasVisitBInDispatchesB = (jsonDispatchesB.dispatches || []).some(
      (d: any) => d.visit_number === visitB.visit_number
    );
    const hasVisitAInDispatchesB = (jsonDispatchesB.dispatches || []).some(
      (d: any) => d.visit_number === visitA.visit_number
    );
    assert(
      hasVisitBInDispatchesB && !hasVisitAInDispatchesB && foreignDispatchesB.length === 0 && sourceADispatchesInB.length === 0,
      'TEST-R7.4: Manager B receives known Dispatch B, ZERO dispatches from Source A, and ZERO foreign dispatches (bidirectional dispatch isolation verified, non-vacuous)',
      `Dispatch B present: ${hasVisitBInDispatchesB}, Dispatch A in B: ${hasVisitAInDispatchesB}, Foreign Count: ${foreignDispatchesB.length}`
    );

    // STALE SESSION REASSIGNMENT TEST:
    // Create token with Source A, then update DB user to Source B, then call GET /api/logs
    const sessionTokenOld = await createSessionToken({
      id: tempManagerA.id.toString(),
      username: tempManagerA.username,
      name: tempManagerA.username,
      role: 'ZMCC_MANAGER',
      department: 'Milk Procurement',
      scope_type: 'SOURCE',
      procurement_source_id: sourceA.id.toString(),
    });

    // Update DB user assignment to Source B
    await prisma.user.update({
      where: { id: tempManagerA.id },
      data: { procurement_source_id: sourceB.id },
    });

    const reqStale = new Request('http://localhost:3000/api/logs', {
      method: 'GET',
      headers: { cookie: `auth_token=${sessionTokenOld}`, authorization: `Bearer ${sessionTokenOld}` },
    });
    const resStale = await getLogs(reqStale as any);
    const jsonStale = await resStale.json();

    const staleFollowsCurrentDb = (jsonStale.logs || []).every(
      (l: any) => l.zonal_contractor_name === sourceB.name
    );
    const hasVisitBInStale = (jsonStale.logs || []).some(
      (l: any) => l.vehicle_number === visitB.vehicle_number
    );
    assert(
      resStale.ok && staleFollowsCurrentDb && hasVisitBInStale,
      'TEST-STALE: GET /api/logs follows authoritative current DB assignment (Source B), receiving known Record B and ignoring stale session assignment'
    );

    // A12: ZMCC Manager workspace does not expose known plant mutation actions
    const hasGrossWeightAction = workspaceSource.includes('/api/scale/gross-weight') || workspaceSource.includes('Record Gross');
    const hasTareWeightAction = workspaceSource.includes('/api/scale/tare-weight') || workspaceSource.includes('Record Tare');
    const hasQaAcceptAction = workspaceSource.includes('/api/qa/vehicle-visits') && workspaceSource.includes('/complete');
    assert(!hasGrossWeightAction && !hasTareWeightAction && !hasQaAcceptAction, 'TEST-A12.1: ZMCCManagerWorkspace contains zero plant operational mutation actions');

    // Also verify backend blocks mutation if ZMCC_MANAGER tries to call mutation APIs
    const reqMut = await createAuthRequest('http://localhost:3000/api/scale/gross-weight', 'POST', { visitId: '1', grossWeightKg: 30000 }, tempManagerA);
    const resMut = await postGrossWeight(reqMut);
    assert(resMut.status === 403 || resMut.status === 401, 'TEST-A12.2: Backend blocks ZMCC_MANAGER from Gross Weight entry (403/401)');
  } finally {
    const cleanupErrors: any[] = [];

    // Clean up disposable vehicle visits first
    const visitsToDelete = [visitA?.id, visitB?.id].filter(Boolean);
    for (const vId of visitsToDelete) {
      try {
        await prisma.vehicleVisit.delete({ where: { id: vId } });
      } catch (err) {
        cleanupErrors.push(err);
      }
    }

    const fixturesToDelete = [
      tempManagerA?.id,
      tempManagerB?.id,
      tempUnboundManager?.id,
      tempContractorManager?.id,
      tempUnboundContractorManager?.id,
    ].filter(Boolean);

    for (const userId of fixturesToDelete) {
      try {
        await prisma.user.delete({ where: { id: userId } });
      } catch (err) {
        cleanupErrors.push(err);
      }
    }

    if (cleanupErrors.length > 0) {
      console.error('Fixture cleanup encountered failures:', cleanupErrors);
      throw new Error(`Test fixture cleanup failed: ${cleanupErrors.map((e: any) => e.message || String(e)).join('; ')}`);
    }
  }

  // R8, R9, R10: Synthetic Quality Measurements Removed (ZonalHistoryTable retired in 4E-D)
  const zonalHistoryPath = path.join(__dirname, '../src/frontend/modules/dashboard/ZonalHistoryTable.tsx');
  const zonalHistoryExists = fs.existsSync(zonalHistoryPath);
  if (zonalHistoryExists) {
    const zonalHistorySource = fs.readFileSync(zonalHistoryPath, 'utf-8');
    const hasSyntheticAcidity = zonalHistorySource.includes("value: 0.14");
    const hasSyntheticTemp1 = zonalHistorySource.includes("value: 4.5");
    const hasSyntheticTemp2 = zonalHistorySource.includes("value: 4.8");
    assert(!hasSyntheticAcidity, 'TEST-R8: No fabricated Acidity (0.14) exists in ZonalHistoryTable');
    assert(!hasSyntheticTemp1 && !hasSyntheticTemp2, 'TEST-R9 & R10: No fabricated Temperature (4.5 / 4.8) exists in ZonalHistoryTable');
    const hasFakeLr28 = zonalHistorySource.includes("|| 28.0") || zonalHistorySource.includes("|| 28");
    assert(!hasFakeLr28, 'TEST-R11: No fake LR 28.0 fallback exists in ZonalHistoryTable');
  } else {
    assert(!zonalHistoryExists, 'TEST-R8: ZonalHistoryTable is retired and physically absent from codebase (no fabricated Acidity)');
    assert(!zonalHistoryExists, 'TEST-R9 & R10: ZonalHistoryTable is retired and physically absent from codebase (no fabricated Temperature)');
    assert(!zonalHistoryExists, 'TEST-R11: ZonalHistoryTable is retired and physically absent from codebase (no fake LR 28.0 fallback)');
  }

  // R13, R14, R15: Pakistan Event Date/Time & Business Date Coexistence
  const testUtcIso = '2026-08-23T21:30:00.000Z';
  const pktFormattedDatetime = formatOperationalDatetime(testUtcIso);
  const pktFormattedTime = formatOperationalTime(testUtcIso);
  const eventBusinessDate = getOperationalBusinessDate(new Date(testUtcIso));

  // 2026-08-23 21:30 UTC = 2026-08-24 02:30 PKT (Event Date/Time: 24-Aug-2026 02:30 AM PKT, Business Date: 2026-08-23)
  const isCorrectPktTime = pktFormattedTime.includes('02:30');
  const isCorrectPktDate = pktFormattedDatetime.includes('24 Aug 2026') && pktFormattedDatetime.includes('02:30');
  const isCorrectBusinessDate = eventBusinessDate === '2026-08-23';

  assert(isCorrectPktTime && isCorrectPktDate, 'TEST-R13 & R14: UTC 2026-08-23T21:30:00Z formats to Pakistan Event Date/Time (24-Aug-2026 02:30 AM PKT)', `Got: ${pktFormattedDatetime}`);
  assert(isCorrectBusinessDate, 'TEST-R15: Business Date for 02:30 PKT event is 2026-08-23 (08:00 cutoff boundary intact)', `Got: ${eventBusinessDate}`);

  // R16: Read model time formatting does not use bare getHours/getMinutes
  const readModelSource = fs.readFileSync(path.join(__dirname, '../src/backend/services/operationalReadModelService.ts'), 'utf-8');
  const formatTimeOnlyMatch = readModelSource.match(/function formatTimeOnly[\s\S]*?\n\}/)?.[0] || '';
  const usesBareGetHours = formatTimeOnlyMatch.includes('d.getHours()') || formatTimeOnlyMatch.includes('d.getMinutes()');
  const usesPlantTimezone = formatTimeOnlyMatch.includes('PLANT_TIMEZONE') || formatTimeOnlyMatch.includes('Asia/Karachi');
  assert(!usesBareGetHours && usesPlantTimezone, 'TEST-R16: formatTimeOnly in operationalReadModelService uses explicit PLANT_TIMEZONE (Asia/Karachi) instead of bare getHours/getMinutes');

  // A13: Measurement Method does not reappear
  const hasMeasurementMethod = workspaceSource.includes('Measurement Method') || workspaceSource.includes('measurement_method');
  assert(!hasMeasurementMethod, 'TEST-A13: Measurement Method is not present in ZMCC Manager workspace');

  // A14: Save Draft does not reappear
  const hasSaveDraft = workspaceSource.includes('Save Draft') || workspaceSource.includes('saveDraft') || workspaceSource.includes('/draft');
  assert(!hasSaveDraft, 'TEST-A14: Save Draft is not present in ZMCC Manager workspace');

  // A15: ZMCC Cross Verification tab is preserved in ZMCC workspace
  const hasZmccCv = workspaceSource.includes("id: 'CROSS_VERIFICATION'") && workspaceSource.includes("label: 'Cross Verification'");
  assert(hasZmccCv, 'TEST-A15: ZMCC Cross Verification tab remains preserved in ZMCC Manager workspace');

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
