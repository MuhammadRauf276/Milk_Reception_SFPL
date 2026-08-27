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

  // D14: /fleet-tracking route is retired and deleted
  const fleetTrackingPath = path.join(__dirname, '../src/app/fleet-tracking/page.tsx');
  assert(
    !fs.existsSync(fleetTrackingPath),
    'D14: /fleet-tracking route file is absent on disk'
  );

  // D15: Super Admin audit API preserved
  const auditApiPath = path.join(__dirname, '../src/app/api/super-admin/audit/route.ts');
  assert(
    fs.existsSync(auditApiPath),
    'D15: Super Admin audit API remains preserved'
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

  // D17: Retained candidate operationalCalculations exists
  const opCalcPath = path.join(__dirname, '../src/backend/services/operationalCalculations.ts');
  assert(
    fs.existsSync(opCalcPath),
    'D17: Retained candidate dependency operationalCalculations.ts remains on disk'
  );

  // D20: SecurityManager does NOT import LogDetailModal
  const secMgrSrc = fs.readFileSync(path.join(__dirname, '../src/frontend/modules/dashboard/SecurityManager.tsx'), 'utf8');
  assert(
    !secMgrSrc.includes('LogDetailModal'),
    'D20: SecurityManager does NOT import LogDetailModal'
  );

  // D21: SecurityManager does NOT render/reference LogDetailModal
  assert(
    !secMgrSrc.includes('<LogDetailModal') && !secMgrSrc.includes('selectedDetailLog'),
    'D21: SecurityManager does NOT render or reference LogDetailModal'
  );

  // D22: operationalReadModelService does NOT import operationalCalculations
  const readModelSrc = fs.readFileSync(path.join(__dirname, '../src/backend/services/operationalReadModelService.ts'), 'utf8');
  assert(
    !readModelSrc.includes('operationalCalculations'),
    'D22: operationalReadModelService does NOT import operationalCalculations'
  );

  // D23: operationalReadModelService does NOT re-export operationalCalculations symbols
  assert(
    !readModelSrc.includes('computeRuntimeMetrics') &&
    !readModelSrc.includes('computeVehicleDecisionSummary') &&
    !readModelSrc.includes('computeAuthoritativeZonalAnalytics'),
    'D23: operationalReadModelService does NOT re-export operationalCalculations symbols'
  );

  // D24: Retained legacy calculation scripts import legacy calculation helpers directly
  const dateFilterScriptSrc = fs.readFileSync(path.join(__dirname, '../scripts/test_date_filters_and_decisions.ts'), 'utf8');
  const legacyCalcScriptSrc = fs.readFileSync(path.join(__dirname, '../scripts/test_legacy_calculation_migration.ts'), 'utf8');
  assert(
    dateFilterScriptSrc.includes("from '../src/backend/services/operationalCalculations'") &&
    !dateFilterScriptSrc.includes("computeVehicleDecisionSummary } from '../src/backend/services/operationalReadModelService'"),
    'D24.1: test_date_filters_and_decisions imports calculations directly from operationalCalculations'
  );
  assert(
    legacyCalcScriptSrc.includes("from '../src/backend/services/operationalCalculations'") &&
    !legacyCalcScriptSrc.includes("computeVehicleDecisionSummary,\n  computeAuthoritativeZonalAnalytics,\n} from '../src/backend/services/operationalReadModelService'"),
    'D24.2: test_legacy_calculation_migration imports calculations directly from operationalCalculations'
  );

  // D25: test_stage4_radio_and_terminology.ts does NOT read/reference retired AdaptiveVehicleCard.tsx
  const stage4ScriptSrc = fs.readFileSync(path.join(__dirname, '../scripts/test_stage4_radio_and_terminology.ts'), 'utf8');
  assert(
    !stage4ScriptSrc.includes('AdaptiveVehicleCard.tsx'),
    'D25: test_stage4_radio_and_terminology.ts does NOT read or reference retired AdaptiveVehicleCard.tsx'
  );

  // D26: test_stage4_radio_and_terminology.ts does NOT read/reference retired ZonalHistoryTable.tsx
  assert(
    !stage4ScriptSrc.includes('ZonalHistoryTable.tsx'),
    'D26: test_stage4_radio_and_terminology.ts does NOT read or reference retired ZonalHistoryTable.tsx'
  );

  // D27: Super Admin audit page remains present on disk
  assert(
    fs.existsSync(path.join(__dirname, '../src/app/super-admin/audit/page.tsx')),
    'D27: Super Admin audit page remains present on disk'
  );

  // D28: Canonical SecurityManager.tsx remains present on disk
  assert(
    fs.existsSync(path.join(__dirname, '../src/frontend/modules/dashboard/SecurityManager.tsx')),
    'D28: Canonical SecurityManager.tsx remains present on disk'
  );

  // D29: operationalReadModelService contains no silent invalid-date filter deletion
  assert(
    !readModelSrc.includes('delete whereClause.operational_date') &&
    readModelSrc.includes("throw new Error('Invalid fromDate parameter')") &&
    readModelSrc.includes("throw new Error('Invalid toDate parameter')"),
    'D29: operationalReadModelService contains no silent invalid-date filter deletion and throws deterministic errors'
  );

  // D30: api/logs/route.ts contains explicit invalid fromDate/toDate 400 validation
  const apiLogsSrc = fs.readFileSync(path.join(__dirname, '../src/app/api/logs/route.ts'), 'utf8');
  assert(
    apiLogsSrc.includes('Invalid fromDate parameter') &&
    apiLogsSrc.includes('Invalid toDate parameter') &&
    apiLogsSrc.includes('isValidDateOnly'),
    'D30: api/logs/route.ts explicitly rejects malformed fromDate and toDate with HTTP 400 using isValidDateOnly'
  );

  // D31: test_date_filters_and_decisions.ts asserts dispatch_date (Business Date)
  assert(
    dateFilterScriptSrc.includes("sampleDate = baseLogs[0]?.dispatch_date") &&
    dateFilterScriptSrc.includes("l.dispatch_date === sampleDate"),
    'D31: test_date_filters_and_decisions asserts dispatch_date (Business Date)'
  );

  // D32: test_stage4_radio_and_terminology.ts maintains strict Contractor LITER authority assertion
  assert(
    stage4ScriptSrc.includes("calculateGrossLiters(10000, 'LITER', null) === 10000") &&
    !stage4ScriptSrc.includes('isContractorSource || calculatePhysicalLiters'),
    'D32: test_stage4_radio_and_terminology maintains strict Contractor LITER authority contract'
  );

  // D33: Shared isValidDateOnly rejects rollover/malformed dates and accepts valid calendar dates
  const { isValidDateOnly } = require('../src/lib/datetime-utils');
  assert(
    isValidDateOnly('2024-02-29') === true &&
    isValidDateOnly('2026-08-01') === true &&
    isValidDateOnly('2026-02-30') === false &&
    isValidDateOnly('2026-04-31') === false &&
    isValidDateOnly('2025-02-29') === false &&
    isValidDateOnly('1') === false &&
    isValidDateOnly('') === false &&
    isValidDateOnly(' ') === false &&
    isValidDateOnly('2026-2-03') === false,
    'D33: Shared isValidDateOnly rejects calendar rollover, noncanonical strings, and empty/whitespace inputs'
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
