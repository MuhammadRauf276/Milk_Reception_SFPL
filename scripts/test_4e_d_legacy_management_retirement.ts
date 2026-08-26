import fs from 'fs';
import path from 'path';
import { resolveRoleHome } from '../src/lib/role-routing';

async function run4EDTests() {
  console.log('================================================================================');
  console.log('STAGE 4E-D: LEGACY MANAGEMENT RETIREMENT TEST SUITE');
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

  // D1: /management/dashboard route file absent
  const mgmtRoute = path.join(__dirname, '../src/app/management/dashboard/page.tsx');
  assert(!fs.existsSync(mgmtRoute), 'D1: /management/dashboard route file is absent');

  // D2: /cross-verification route file absent
  const cvRoute = path.join(__dirname, '../src/app/cross-verification/page.tsx');
  assert(!fs.existsSync(cvRoute), 'D2: /cross-verification route file is absent');

  // D3: KanbanBoard absent
  const kanbanPath = path.join(__dirname, '../src/frontend/modules/dashboard/KanbanBoard.tsx');
  assert(!fs.existsSync(kanbanPath), 'D3: KanbanBoard.tsx is absent');

  // D4: Legacy CrossVerification component absent
  const cvComponentPath = path.join(__dirname, '../src/frontend/modules/dashboard/CrossVerification.tsx');
  assert(!fs.existsSync(cvComponentPath), 'D4: Legacy CrossVerification.tsx component is absent');

  // D5: Additionally deleted legacy components absent
  const zonalPath = path.join(__dirname, '../src/frontend/modules/dashboard/ZonalHistoryTable.tsx');
  const cardPath = path.join(__dirname, '../src/frontend/modules/cards/AdaptiveVehicleCard.tsx');
  assert(!fs.existsSync(zonalPath), 'D5.1: ZonalHistoryTable.tsx is absent');
  assert(!fs.existsSync(cardPath), 'D5.2: AdaptiveVehicleCard.tsx is absent');

  // D6: No current src import references deleted legacy module paths
  const deletedModulePaths = [
    'modules/dashboard/KanbanBoard',
    'modules/dashboard/CrossVerification',
    'modules/dashboard/ZonalHistoryTable',
    'modules/cards/AdaptiveVehicleCard',
  ];

  function searchSrcForMatches(query: string): string[] {
    const matches: string[] = [];
    function walk(dir: string) {
      fs.readdirSync(dir).forEach((file) => {
        const full = path.join(dir, file);
        if (fs.statSync(full).isDirectory()) {
          if (file !== 'node_modules' && file !== '.git' && file !== '.next') walk(full);
        } else if (file.endsWith('.ts') || file.endsWith('.tsx')) {
          const content = fs.readFileSync(full, 'utf8');
          if (content.includes(query)) {
            matches.push(full.replace(/\\/g, '/'));
          }
        }
      });
    }
    walk(path.join(__dirname, '../src'));
    return matches;
  }

  deletedModulePaths.forEach((mod, idx) => {
    const matches = searchSrcForMatches(mod);
    assert(
      matches.length === 0,
      `D6.${idx + 1}: Zero imports or references to ${mod} in src/`,
      matches.length > 0 ? `Found in: ${matches.join(', ')}` : undefined
    );
  });

  // D7: Current ZMCC cross-verification still exists
  const zmccCvPath = path.join(__dirname, '../src/frontend/modules/dashboard/zmcc/ZMCCManagerCrossVerification.tsx');
  assert(fs.existsSync(zmccCvPath), 'D7: Current ZMCC Cross Verification component (ZMCCManagerCrossVerification.tsx) exists');

  // D8: ZMCC current modules contain zero legacy imports
  const zmccDir = path.join(__dirname, '../src/frontend/modules/dashboard/zmcc');
  const zmccWorkspace = path.join(__dirname, '../src/frontend/modules/dashboard/ZMCCManagerWorkspace.tsx');
  const zmccFiles = [zmccWorkspace, ...fs.readdirSync(zmccDir).map((f) => path.join(zmccDir, f))];

  let hasLegacyInZmcc = false;
  zmccFiles.forEach((f) => {
    const content = fs.readFileSync(f, 'utf8');
    if (
      content.includes('LogDetailModal') ||
      content.includes('ZonalHistoryTable') ||
      content.includes('KanbanBoard') ||
      content.includes('modules/dashboard/CrossVerification')
    ) {
      hasLegacyInZmcc = true;
    }
  });
  assert(!hasLegacyInZmcc, 'D8: ZMCC current workspace modules contain zero legacy imports');

  // D9 & D10: Legacy roles fail closed to /workspace-unavailable
  const legacyRoles = [
    'MPD_Zone_Manager',
    'Management',
    'General_Plant_Manager',
    'QA_Manager',
    'Production_Manager',
    'Correction_Officer',
  ];
  const allLegacyFailedClosed = legacyRoles.every(
    (r) => resolveRoleHome(r) === '/workspace-unavailable'
  );
  assert(
    allLegacyFailedClosed,
    'D9 & D10: Retired legacy roles fail closed to /workspace-unavailable'
  );

  // D11: Current canonical roles retain approved homes
  const canonicalChecks = [
    resolveRoleHome('SUPER_ADMIN') === '/super-admin',
    resolveRoleHome('Admin') === '/super-admin',
    resolveRoleHome('ZMCC_MANAGER') === '/mpd/zmcc-manager',
    resolveRoleHome('MPD_Operator') === '/department/mpd',
    resolveRoleHome('Security_Operator') === '/department/security',
    resolveRoleHome('Security_Manager') === '/department/security-manager',
    resolveRoleHome('QA_Operator') === '/department/qa',
    resolveRoleHome('WEIGHBRIDGE_OPERATOR') === '/department/weighbridge',
    resolveRoleHome('Production_Operator') === '/department/production',
  ];
  assert(
    canonicalChecks.every(Boolean),
    'D11: All canonical roles retain their approved workspace destinations'
  );

  // D12 & D13: Sidebar has no /management/dashboard or /cross-verification entries
  const sidebarSrc = fs.readFileSync(path.join(__dirname, '../src/frontend/modules/shared/Sidebar.tsx'), 'utf8');
  assert(
    !sidebarSrc.includes('href="/management/dashboard"') &&
    !sidebarSrc.includes("href='/management/dashboard'") &&
    !sidebarSrc.includes('href="/cross-verification"') &&
    !sidebarSrc.includes("href='/cross-verification'"),
    'D12 & D13: Sidebar contains no links to retired /management/dashboard or /cross-verification'
  );

  // D14: /fleet-tracking remains untouched
  const fleetTrackingPath = path.join(__dirname, '../src/app/fleet-tracking/page.tsx');
  assert(fs.existsSync(fleetTrackingPath), 'D14: /fleet-tracking route remains preserved for Stage 4E-E');

  // D15: Audit/revert files remain untouched
  const auditModalPath = path.join(__dirname, '../src/frontend/modules/shared/AuditRevertModal.tsx');
  const auditApiPath = path.join(__dirname, '../src/app/api/super-admin/audit/route.ts');
  assert(
    fs.existsSync(auditModalPath) && fs.existsSync(auditApiPath),
    'D15: AuditRevertModal and Super Admin audit API remain preserved'
  );

  // D16: Canonical map marks legacy management retired
  const mapSrc = fs.readFileSync(path.join(__dirname, '../docs/architecture/CANONICAL-CODE-MAP.md'), 'utf8');
  assert(
    mapSrc.includes('Stage 4E-D Retired Legacy Management Subsystem') &&
    mapSrc.includes('KanbanBoard.tsx') &&
    mapSrc.includes('CrossVerification.tsx') &&
    mapSrc.includes('ZonalHistoryTable.tsx') &&
    mapSrc.includes('AdaptiveVehicleCard.tsx'),
    'D16: CANONICAL-CODE-MAP marks legacy management subsystem as retired'
  );

  // D17: Retained candidate files exist
  const logDetailModalPath = path.join(__dirname, '../src/frontend/modules/dashboard/LogDetailModal.tsx');
  const opCalcPath = path.join(__dirname, '../src/backend/services/operationalCalculations.ts');
  assert(
    fs.existsSync(logDetailModalPath) && fs.existsSync(opCalcPath),
    'D17: Retained candidate dependencies (LogDetailModal.tsx and operationalCalculations.ts) remain on disk'
  );

  console.log('\n================================================================================');
  console.log(`SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

run4EDTests().catch((err) => {
  console.error('Test runner fatal error:', err);
  process.exit(1);
});
