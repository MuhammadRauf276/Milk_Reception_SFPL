import fs from 'fs';
import path from 'path';

async function run4EFTests() {
  console.log('================================================================================');
  console.log('STAGE 4E-F: DUPLICATE API / SUPER ADMIN CONSOLIDATION TEST SUITE');
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

  // F1: Canonical /api/super-admin/lab-tests route exists
  const superAdminLabTestsRoute = path.join(__dirname, '../src/app/api/super-admin/lab-tests/route.ts');
  const superAdminLabTestsIdRoute = path.join(__dirname, '../src/app/api/super-admin/lab-tests/[id]/route.ts');
  assert(
    fs.existsSync(superAdminLabTestsRoute) && fs.existsSync(superAdminLabTestsIdRoute),
    'F1: Canonical /api/super-admin/lab-tests and /api/super-admin/lab-tests/[id] exist on disk'
  );

  // F2: Current Super Admin Lab Tests page uses canonical endpoint
  const superAdminPagePath = path.join(__dirname, '../src/app/super-admin/lab-tests/page.tsx');
  const superAdminPageSrc = fs.existsSync(superAdminPagePath) ? fs.readFileSync(superAdminPagePath, 'utf8') : '';
  assert(
    superAdminPageSrc.includes('/api/super-admin/lab-tests') &&
    !superAdminPageSrc.includes('/api/admin/lab-tests'),
    'F2: Current Super Admin Lab Tests workspace uses canonical /api/super-admin/lab-tests endpoint'
  );

  // F3: No current source imports or fetches retired duplicate Admin Lab Test API
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
  const legacyAdminApiConsumers = srcFiles.filter((f) => {
    const content = fs.readFileSync(f, 'utf8');
    return content.includes('/api/admin/lab-tests');
  });
  assert(
    legacyAdminApiConsumers.length === 0,
    'F3: Zero runtime sources in src/ import or fetch /api/admin/lab-tests'
  );

  // F4: Old duplicate API files and directory are absent
  const adminApiLabTestsRoute = path.join(__dirname, '../src/app/api/admin/lab-tests/route.ts');
  const adminApiLabTestsIdRoute = path.join(__dirname, '../src/app/api/admin/lab-tests/[id]/route.ts');
  const adminApiDir = path.join(__dirname, '../src/app/api/admin');
  assert(
    !fs.existsSync(adminApiLabTestsRoute) &&
    !fs.existsSync(adminApiLabTestsIdRoute) &&
    !fs.existsSync(adminApiDir),
    'F4: Retired duplicate /api/admin/lab-tests route files and empty directory tree are physically absent'
  );

  // F5: Compatibility page /admin/lab-tests is preserved and safely redirects to canonical /super-admin/lab-tests
  const adminPagePath = path.join(__dirname, '../src/app/admin/lab-tests/page.tsx');
  const adminPageSrc = fs.existsSync(adminPagePath) ? fs.readFileSync(adminPagePath, 'utf8') : '';
  assert(
    fs.existsSync(adminPagePath) &&
    adminPageSrc.includes('/super-admin/lab-tests') &&
    adminPageSrc.includes('router.replace'),
    'F5: Compatibility page /admin/lab-tests exists and safely redirects to /super-admin/lab-tests'
  );

  // F6: No duplicate Prisma/business implementation remains between old and new paths
  const apiTree = fs.existsSync(adminApiDir);
  assert(
    !apiTree,
    'F6: Zero duplicate Prisma or business implementations remain in src/app/api/admin'
  );

  // F7: Super Admin audit remains intact
  const auditPagePath = path.join(__dirname, '../src/app/super-admin/audit/page.tsx');
  const auditApiPath = path.join(__dirname, '../src/app/api/super-admin/audit/route.ts');
  assert(
    fs.existsSync(auditPagePath) && fs.existsSync(auditApiPath),
    'F7: Super Admin audit page and API remain present and intact'
  );

  // F8: Role routing in src/lib/role-routing.ts remains canonical and fail-closed
  const { resolveRoleHome } = require('../src/lib/role-routing');
  assert(
    resolveRoleHome('SUPER_ADMIN') === '/super-admin' &&
    resolveRoleHome('Admin') === '/super-admin' &&
    resolveRoleHome('UNKNOWN_ROLE') === '/workspace-unavailable',
    'F8: Role routing resolves SUPER_ADMIN / Admin to /super-admin and fails closed'
  );

  // F9: Plant LR identity remains LT-000008
  const vehicleQtyPath = path.join(__dirname, '../src/backend/services/vehicleQuantityService.ts');
  const vehicleQtySrc = fs.existsSync(vehicleQtyPath) ? fs.readFileSync(vehicleQtyPath, 'utf8') : '';
  assert(
    vehicleQtySrc.includes('LT-000008'),
    'F9: Plant LR identity strictly preserved as LT-000008'
  );

  // F10: Plant Fat identity remains LT-000026
  assert(
    vehicleQtySrc.includes('LT-000026'),
    'F10: Plant Fat identity strictly preserved as LT-000026'
  );

  // F11: CANONICAL-CODE-MAP reflects exact ownership and Stage 4E-F retirements
  const mapPath = path.join(__dirname, '../docs/architecture/CANONICAL-CODE-MAP.md');
  const mapSrc = fs.readFileSync(mapPath, 'utf8');
  assert(
    mapSrc.includes('Stage 4E-F Duplicate API / Super Admin Consolidation') &&
    mapSrc.includes('/api/super-admin/lab-tests') &&
    mapSrc.includes('RETIRED IN 4E-F'),
    'F11: CANONICAL-CODE-MAP documents Stage 4E-F API consolidation and canonical ownership'
  );

  console.log('\n================================================================================');
  console.log(`SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

run4EFTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
