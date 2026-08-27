import fs from 'fs';
import path from 'path';
import { resolveRoleHome } from '../src/lib/role-routing';
import { isValidDateOnly } from '../src/lib/datetime-utils';

async function runCanonicalArchitectureTests() {
  console.log('================================================================================');
  console.log('CANONICAL ARCHITECTURE & REPOSITORY INVARIANTS REGRESSION SUITE');
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

  function walk(dir: string): string[] {
    let results: string[] = [];
    const list = fs.readdirSync(dir, { withFileTypes: true });
    for (const item of list) {
      const full = path.join(dir, item.name);
      if (item.isDirectory()) {
        if (item.name !== 'node_modules' && item.name !== '.next' && item.name !== '.git') {
          results = results.concat(walk(full));
        }
      } else if (item.name.endsWith('.ts') || item.name.endsWith('.tsx') || item.name.endsWith('.js')) {
        results.push(full);
      }
    }
    return results;
  }

  const srcFiles = walk(path.join(__dirname, '../src'));

  // 1. Role-Home Resolution Policy (Canonical Gateway)
  const canonicalRoleMap: Record<string, string> = {
    SUPER_ADMIN: '/super-admin',
    Admin: '/super-admin',
    ZMCC_MANAGER: '/mpd/zmcc-manager',
    MPD_Operator: '/department/mpd',
    MPD: '/department/mpd',
    Security_Operator: '/department/security',
    Security_Weight: '/department/security',
    Security_Manager: '/department/security-manager',
    QA_Operator: '/department/qa',
    QA: '/department/qa',
    WEIGHBRIDGE_OPERATOR: '/department/weighbridge',
    Weighbridge_Operator: '/department/weighbridge',
    Production_Operator: '/department/production',
    Production: '/department/production',
  };

  let allRolesMatch = true;
  for (const [role, expectedHome] of Object.entries(canonicalRoleMap)) {
    const actual = resolveRoleHome(role);
    if (actual !== expectedHome) {
      allRolesMatch = false;
      console.error(`Role ${role} mapped to ${actual}, expected ${expectedHome}`);
    }
  }
  assert(allRolesMatch, 'ARCH-1: All canonical roles and supported aliases resolve to dedicated workspaces');

  // 2. Fail-Closed Policy for Invalid, Future, and Retired Legacy Roles
  const failClosedRoles = [
    '',
    ' ',
    null,
    undefined,
    'UNKNOWN_ROLE',
    'CONTRACTOR_MANAGER',
    'EXECUTIVE_MANAGEMENT',
    'MPD_Zone_Manager',
    'Management',
    'General_Plant_Manager',
    'QA_Manager',
    'Production_Manager',
    'Correction_Officer',
  ];
  const allFailClosed = failClosedRoles.every((r) => resolveRoleHome(r as any) === '/workspace-unavailable');
  assert(allFailClosed, 'ARCH-2: Unknown, unmapped, future, and retired legacy roles fail closed to /workspace-unavailable');

  // 3. Root Gateway Page
  const rootPagePath = path.join(__dirname, '../src/app/page.tsx');
  const rootPageSrc = fs.readFileSync(rootPagePath, 'utf8');
  assert(
    rootPageSrc.includes('resolveRoleHome') && !rootPageSrc.includes('KanbanBoard') && !rootPageSrc.includes('CrossVerification'),
    'ARCH-3: Root page (src/app/page.tsx) uses resolveRoleHome gateway policy with no legacy dependencies'
  );

  // 4. Current ZMCC Workspace Isolation
  const zmccWorkspacePath = path.join(__dirname, '../src/frontend/modules/dashboard/ZMCCManagerWorkspace.tsx');
  const zmccSrc = fs.readFileSync(zmccWorkspacePath, 'utf8');
  assert(
    !zmccSrc.includes('LogDetailModal') &&
    !zmccSrc.includes('ZonalHistoryTable') &&
    !zmccSrc.includes('KanbanBoard') &&
    !zmccSrc.includes('AdaptiveVehicleCard') &&
    !zmccSrc.includes('operationalCalculations'),
    'ARCH-4: ZMCCManagerWorkspace.tsx is fully detached from retired legacy modals and calculations'
  );

  // 5. Zero Current Sources Import Retired Calculation or Management Subsystems
  const legacyConsumers = srcFiles.filter((f) => {
    const content = fs.readFileSync(f, 'utf8');
    return (
      content.includes('operationalCalculations') ||
      content.includes('LogDetailModal') ||
      content.includes('AuditRevertModal') ||
      content.includes('DynamicQALabForm') ||
      content.includes('StageTimeline') ||
      content.includes('auditController') ||
      content.includes('SecurityWorkforceTable')
    );
  });
  assert(
    legacyConsumers.length === 0,
    'ARCH-5: Zero runtime sources in src/ import retired calculation or legacy management modules'
  );

  // 6. Retired Route Segments Physically Absent on Disk
  const retiredRoutes = [
    path.join(__dirname, '../src/app/fleet-tracking/page.tsx'),
    path.join(__dirname, '../src/app/cross-verification/page.tsx'),
    path.join(__dirname, '../src/app/management/dashboard/page.tsx'),
    path.join(__dirname, '../src/app/api/admin/lab-tests/route.ts'),
    path.join(__dirname, '../src/app/api/admin/lab-tests/[id]/route.ts'),
    path.join(__dirname, '../src/app/api/logs/[id]/audit/route.ts'),
  ];
  const allRetiredAbsent = retiredRoutes.every((r) => !fs.existsSync(r));
  assert(allRetiredAbsent, 'ARCH-6: Retired route files (/fleet-tracking, /cross-verification, /management, /api/admin, /api/logs/[id]/audit) are physically absent');

  // 7. Canonical Super Admin Lab Test Master Data Management
  const saLabTestsRoute = path.join(__dirname, '../src/app/api/super-admin/lab-tests/route.ts');
  const saLabTestsIdRoute = path.join(__dirname, '../src/app/api/super-admin/lab-tests/[id]/route.ts');
  const saLabTestsPage = path.join(__dirname, '../src/app/super-admin/lab-tests/page.tsx');
  assert(
    fs.existsSync(saLabTestsRoute) && fs.existsSync(saLabTestsIdRoute) && fs.existsSync(saLabTestsPage),
    'ARCH-7: Canonical Super Admin Lab Test Master Data API and UI exist on disk'
  );

  // 8. Canonical Super Admin Audit is Read-Only
  const saAuditRoute = path.join(__dirname, '../src/app/api/super-admin/audit/route.ts');
  const saAuditPage = path.join(__dirname, '../src/app/super-admin/audit/page.tsx');
  const saAuditRouteSrc = fs.existsSync(saAuditRoute) ? fs.readFileSync(saAuditRoute, 'utf8') : '';
  assert(
    fs.existsSync(saAuditRoute) &&
    fs.existsSync(saAuditPage) &&
    saAuditRouteSrc.includes('export async function GET') &&
    !saAuditRouteSrc.includes('export async function POST') &&
    !saAuditRouteSrc.includes('export async function PATCH') &&
    !saAuditRouteSrc.includes('export async function DELETE'),
    'ARCH-8: Canonical Super Admin Audit API is strictly read-only (GET only)'
  );

  // 9. Compatibility Routes Preserved
  const compatAdminLabTests = path.join(__dirname, '../src/app/admin/lab-tests/page.tsx');
  const compatWeighbridge = path.join(__dirname, '../src/app/weighbridge/page.tsx');
  assert(
    fs.existsSync(compatAdminLabTests) && fs.existsSync(compatWeighbridge),
    'ARCH-9: Required compatibility routes (/admin/lab-tests and /weighbridge) exist on disk'
  );

  // 10. Strict Calendar Date Validation (YYYY-MM-DD)
  assert(
    isValidDateOnly('2026-08-25') === true &&
    isValidDateOnly('2024-02-29') === true &&
    isValidDateOnly('2026-02-30') === false &&
    isValidDateOnly('2026-04-31') === false &&
    isValidDateOnly('2025-02-29') === false &&
    isValidDateOnly('') === false &&
    isValidDateOnly('1') === false &&
    isValidDateOnly('2026-8-5') === false,
    'ARCH-10: Shared isValidDateOnly strictly enforces valid YYYY-MM-DD calendar dates and rejects invalid/rollover strings'
  );

  // 11. Authoritative Physical Quantities & Constants
  const vehicleQtyPath = path.join(__dirname, '../src/backend/services/vehicleQuantityService.ts');
  const vehicleQtySrc = fs.existsSync(vehicleQtyPath) ? fs.readFileSync(vehicleQtyPath, 'utf8') : '';
  const zmccHelpersPath = path.join(__dirname, '../src/frontend/modules/dashboard/zmcc/zmccManagerHelpers.ts');
  const zmccHelpersSrc = fs.existsSync(zmccHelpersPath) ? fs.readFileSync(zmccHelpersPath, 'utf8') : '';
  assert(
    vehicleQtySrc.includes('LT-000008') &&
    vehicleQtySrc.includes('LT-000026') &&
    zmccHelpersSrc.includes('authoritative_final_liters') &&
    zmccHelpersSrc.includes('vehicle_dispatch_gross_liters'),
    'ARCH-11: Authoritative quantities (vehicle dispatch gross, final received liters, Plant LR LT-000008, Plant Fat LT-000026) are strictly preserved'
  );

  // 12. Canonical Code Map Exists & Documents Governance
  const mapPath = path.join(__dirname, '../docs/architecture/CANONICAL-CODE-MAP.md');
  const mapContent = fs.existsSync(mapPath) ? fs.readFileSync(mapPath, 'utf8') : '';
  assert(
    mapContent.includes('Canonical Code Map & Architecture Ownership') &&
    mapContent.includes('Role Home Ownership Matrix') &&
    mapContent.includes('API Ownership Map'),
    'ARCH-12: CANONICAL-CODE-MAP.md exists and defines authoritative role, route, and API governance'
  );

  console.log('\n================================================================================');
  console.log(`SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runCanonicalArchitectureTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
