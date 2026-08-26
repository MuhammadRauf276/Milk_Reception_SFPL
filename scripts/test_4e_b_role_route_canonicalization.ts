import fs from 'fs';
import path from 'path';
import { resolveRoleHome } from '../src/lib/role-routing';

async function run4EBTests() {
  console.log('================================================================================');
  console.log('STAGE 4E-B: ROLE & ROUTE CANONICALIZATION TEST SUITE');
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

  // B1: ZMCC_MANAGER -> /mpd/zmcc-manager
  assert(
    resolveRoleHome('ZMCC_MANAGER') === '/mpd/zmcc-manager',
    'B1: ZMCC_MANAGER routes to /mpd/zmcc-manager'
  );

  // B2: MPD_Operator -> /department/mpd
  assert(
    resolveRoleHome('MPD_Operator') === '/department/mpd',
    'B2: MPD_Operator routes to /department/mpd'
  );

  // B3: Security_Operator -> /department/security
  assert(
    resolveRoleHome('Security_Operator') === '/department/security',
    'B3: Security_Operator routes to /department/security'
  );

  // B4: Security_Manager -> /department/security-manager
  assert(
    resolveRoleHome('Security_Manager') === '/department/security-manager',
    'B4: Security_Manager routes to /department/security-manager'
  );

  // B5: QA_Operator and QA -> /department/qa, Lab_Chemist -> /workspace-unavailable
  assert(
    resolveRoleHome('QA_Operator') === '/department/qa' &&
    resolveRoleHome('QA') === '/department/qa',
    'B5: QA_Operator and QA route to /department/qa'
  );
  assert(
    resolveRoleHome('Lab_Chemist') === '/workspace-unavailable',
    'B5.1: Lab_Chemist is not a supported role and fails closed to /workspace-unavailable'
  );

  // B6: WEIGHBRIDGE_OPERATOR -> /department/weighbridge
  assert(
    resolveRoleHome('WEIGHBRIDGE_OPERATOR') === '/department/weighbridge',
    'B6: WEIGHBRIDGE_OPERATOR routes to /department/weighbridge'
  );

  // B7: Production_Operator -> /department/production
  assert(
    resolveRoleHome('Production_Operator') === '/department/production',
    'B7: Production_Operator routes to /department/production'
  );

  // B8: SUPER_ADMIN -> /super-admin
  assert(
    resolveRoleHome('SUPER_ADMIN') === '/super-admin',
    'B8: SUPER_ADMIN routes to /super-admin'
  );

  // B9: Supported aliases resolve to the same canonical workspace
  const aliasAdmin = resolveRoleHome('Admin') === '/super-admin';
  const aliasMpd = resolveRoleHome('MPD') === '/department/mpd';
  const aliasSec = resolveRoleHome('Security_Weight') === '/department/security';
  const aliasQa = resolveRoleHome('QA') === '/department/qa';
  const aliasWb = resolveRoleHome('Weighbridge_Operator') === '/department/weighbridge';
  const aliasProd = resolveRoleHome('Production') === '/department/production';
  assert(
    aliasAdmin && aliasMpd && aliasSec && aliasQa && aliasWb && aliasProd,
    'B9: Supported aliases (Admin, MPD, Security_Weight, QA, Weighbridge_Operator, Production) resolve to canonical workspaces'
  );

  // B10 & B11: CONTRACTOR_MANAGER does NOT route to Kanban or Production
  const contractorDest = resolveRoleHome('CONTRACTOR_MANAGER');
  assert(
    contractorDest !== '/management/dashboard' &&
    contractorDest !== '/' &&
    contractorDest !== '/department/production' &&
    contractorDest === '/workspace-unavailable',
    'B10 & B11: CONTRACTOR_MANAGER does NOT route to Kanban or Production (routes to /workspace-unavailable)'
  );

  // B12 & B13: EXECUTIVE_MANAGEMENT does NOT route to Kanban or operator workspace
  const execDest = resolveRoleHome('EXECUTIVE_MANAGEMENT');
  assert(
    execDest !== '/management/dashboard' &&
    execDest !== '/' &&
    !execDest.startsWith('/department') &&
    execDest === '/workspace-unavailable',
    'B12 & B13: EXECUTIVE_MANAGEMENT does NOT route to Kanban or operator workspace (routes to /workspace-unavailable)'
  );

  // B14: All invalid, null, undefined, whitespace, non-string, or unknown roles fail closed to /workspace-unavailable
  const unknown1 = resolveRoleHome('UNKNOWN_ROLE_XYZ');
  const unknown2 = resolveRoleHome('SuperHacker');
  const unknownNull = resolveRoleHome(null);
  const unknownUndefined = resolveRoleHome(undefined);
  const unknownEmpty = resolveRoleHome('');
  const unknownWhitespace = resolveRoleHome('   ');
  const unknownNumber = resolveRoleHome(12345 as any);
  const unknownObject = resolveRoleHome({ role: 'Admin' } as any);
  assert(
    unknown1 === '/workspace-unavailable' &&
    unknown2 === '/workspace-unavailable' &&
    unknownNull === '/workspace-unavailable' &&
    unknownUndefined === '/workspace-unavailable' &&
    unknownEmpty === '/workspace-unavailable' &&
    unknownWhitespace === '/workspace-unavailable' &&
    unknownNumber === '/workspace-unavailable' &&
    unknownObject === '/workspace-unavailable',
    'B14: All invalid, null, undefined, whitespace, non-string, and unknown inputs fail closed to /workspace-unavailable'
  );

  // B15: Root page contains no KanbanBoard import or render fallback
  const rootSrc = fs.readFileSync(path.join(__dirname, '../src/app/page.tsx'), 'utf8');
  assert(
    !rootSrc.includes('KanbanBoard') &&
    !rootSrc.includes('CrossVerification') &&
    !rootSrc.includes('ZonalHistoryTable') &&
    !rootSrc.includes('LogDetailModal') &&
    !rootSrc.includes('AdaptiveVehicleCard') &&
    !rootSrc.includes('operationalCalculations') &&
    rootSrc.includes('resolveRoleHome'),
    'B15: Root page (src/app/page.tsx) contains no legacy imports and uses resolveRoleHome'
  );

  // B16: Login page uses resolveRoleHome
  const loginSrc = fs.readFileSync(path.join(__dirname, '../src/frontend/modules/auth/LoginPage.tsx'), 'utf8');
  assert(
    loginSrc.includes('resolveRoleHome') &&
    loginSrc.includes('resolveRoleHome(data.user?.role)'),
    'B16: Login page uses canonical resolveRoleHome policy'
  );

  // B17: Future roles receive unavailable destination
  assert(
    resolveRoleHome('CONTRACTOR_MANAGER') === '/workspace-unavailable' &&
    resolveRoleHome('EXECUTIVE_MANAGEMENT') === '/workspace-unavailable',
    'B17: Future roles receive /workspace-unavailable'
  );

  // B18: Genuine legacy roles are explicitly mapped
  const legacyMpd = resolveRoleHome('MPD_Zone_Manager') === '/management/dashboard';
  const legacyMgmt = resolveRoleHome('Management') === '/management/dashboard';
  const legacyGpm = resolveRoleHome('General_Plant_Manager') === '/management/dashboard';
  const legacyQaM = resolveRoleHome('QA_Manager') === '/management/dashboard';
  const legacyProdM = resolveRoleHome('Production_Manager') === '/management/dashboard';
  const legacyCorr = resolveRoleHome('Correction_Officer') === '/management/dashboard';
  assert(
    legacyMpd && legacyMgmt && legacyGpm && legacyQaM && legacyProdM && legacyCorr,
    'B18: Genuine legacy roles explicitly map to /management/dashboard'
  );

  // B19: Sidebar does not give future roles legacy management navigation
  const sidebarSrc = fs.readFileSync(path.join(__dirname, '../src/frontend/modules/shared/Sidebar.tsx'), 'utf8');
  assert(
    sidebarSrc.includes("currentUser?.role || ''") &&
    !sidebarSrc.includes('CONTRACTOR_MANAGER') &&
    !sidebarSrc.includes('EXECUTIVE_MANAGEMENT'),
    'B19: Sidebar has safe empty fallback and does not grant future roles legacy navigation'
  );

  // B20: CANONICAL-CODE-MAP documents role home ownership and no default business fallback
  const mapSrc = fs.readFileSync(path.join(__dirname, '../docs/architecture/CANONICAL-CODE-MAP.md'), 'utf8');
  assert(
    mapSrc.includes('Role Home Ownership Matrix') &&
    mapSrc.includes('NO DEFAULT BUSINESS WORKSPACE FALLBACK') &&
    mapSrc.includes('/workspace-unavailable') &&
    mapSrc.includes('CONTRACTOR_MANAGER') &&
    mapSrc.includes('EXECUTIVE_MANAGEMENT'),
    'B20: CANONICAL-CODE-MAP documents role home ownership and fail-closed policy'
  );

  console.log('\n================================================================================');
  console.log(`SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

run4EBTests().catch((err) => {
  console.error('Test runner fatal error:', err);
  process.exit(1);
});
