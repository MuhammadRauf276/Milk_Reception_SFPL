import fs from 'fs';
import path from 'path';

async function run4EETests() {
  console.log('================================================================================');
  console.log('STAGE 4E-E: FLEET TRACKING + AUDIT/REVERT LEGACY CLEANUP TEST SUITE');
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

  // E1: SecurityManager does not reference LogDetailModal
  const secMgrPath = path.join(__dirname, '../src/frontend/modules/dashboard/SecurityManager.tsx');
  const secMgrSrc = fs.readFileSync(secMgrPath, 'utf8');
  assert(
    !secMgrSrc.includes('LogDetailModal'),
    'E1: SecurityManager does not import or reference LogDetailModal'
  );

  // E2: SecurityManager does not reference AuditRevertModal
  assert(
    !secMgrSrc.includes('AuditRevertModal'),
    'E2: SecurityManager does not import or reference AuditRevertModal'
  );

  // E3: Current ZMCC has no fleet or legacy audit imports
  const zmccDir = path.join(__dirname, '../src/frontend/modules/dashboard/zmcc');
  const zmccFiles = fs.readdirSync(zmccDir).filter((f) => f.endsWith('.tsx') || f.endsWith('.ts'));
  const zmccLegacyRefs = zmccFiles.some((f) => {
    const content = fs.readFileSync(path.join(zmccDir, f), 'utf8');
    return (
      content.includes('LogDetailModal') ||
      content.includes('AuditRevertModal') ||
      content.includes('fleet-tracking') ||
      content.includes('revertLogField')
    );
  });
  assert(
    !zmccLegacyRefs,
    'E3: Current ZMCC workspace has zero fleet or legacy audit/revert imports'
  );

  // E4: Generic user-accessible revert mutation is absent
  const apiAuditPath = path.join(__dirname, '../src/app/api/logs/[id]/audit/route.ts');
  const dbSrc = fs.readFileSync(path.join(__dirname, '../src/backend/core/db.ts'), 'utf8');
  assert(
    !fs.existsSync(apiAuditPath) && !dbSrc.includes('revertLogField'),
    'E4: Generic user-accessible revert mutation endpoint and db helper are completely absent'
  );

  // E5: Super Admin audit read surface still exists
  const superAdminAuditPage = path.join(__dirname, '../src/app/super-admin/audit/page.tsx');
  assert(
    fs.existsSync(superAdminAuditPage),
    'E5: Canonical Super Admin audit read UI page exists on disk'
  );

  // E6: /api/super-admin/audit remains present and functional
  const superAdminAuditApi = path.join(__dirname, '../src/app/api/super-admin/audit/route.ts');
  assert(
    fs.existsSync(superAdminAuditApi),
    'E6: Canonical /api/super-admin/audit endpoint remains present on disk'
  );

  // E7: Correction_Officer role definition was not silently deleted from types
  const typesSrc = fs.readFileSync(path.join(__dirname, '../src/backend/core/types.ts'), 'utf8');
  assert(
    typesSrc.includes("'Correction_Officer'"),
    'E7: Correction_Officer role definition is preserved in domain types'
  );

  // E8: fleet-tracking page is absent (retired)
  const fleetTrackingPage = path.join(__dirname, '../src/app/fleet-tracking/page.tsx');
  assert(
    !fs.existsSync(fleetTrackingPage),
    'E8: /fleet-tracking route page has been retired and deleted'
  );

  // E9: Sidebar has no /fleet-tracking link
  const sidebarSrc = fs.readFileSync(path.join(__dirname, '../src/frontend/modules/shared/Sidebar.tsx'), 'utf8');
  assert(
    !sidebarSrc.includes('href="/fleet-tracking"') && !sidebarSrc.includes("href='/fleet-tracking'"),
    'E9: Sidebar contains no links to retired /fleet-tracking'
  );

  // E10: LogDetailModal is absent (zero owner)
  const logDetailModalPath = path.join(__dirname, '../src/frontend/modules/dashboard/LogDetailModal.tsx');
  assert(
    !fs.existsSync(logDetailModalPath),
    'E10: LogDetailModal.tsx has been retired and deleted as ownerless dead code'
  );

  // E11: AuditRevertModal is absent (zero owner)
  const auditModalPath = path.join(__dirname, '../src/frontend/modules/shared/AuditRevertModal.tsx');
  assert(
    !fs.existsSync(auditModalPath),
    'E11: AuditRevertModal.tsx has been retired and deleted as ownerless dead code'
  );

  // E12: revertLogField is absent from db.ts
  assert(
    !dbSrc.includes('revertLogField') && !dbSrc.includes('getAuditLogsForLog'),
    'E12: Unused and misleading audit revert helpers removed from db.ts'
  );

  // E13: CANONICAL-CODE-MAP reflects exact 4E-E retirements
  const mapSrc = fs.readFileSync(path.join(__dirname, '../docs/architecture/CANONICAL-CODE-MAP.md'), 'utf8');
  assert(
    mapSrc.includes('Stage 4E-E Retired Fleet Tracking & Generic Revert Subsystem') &&
    mapSrc.includes('/fleet-tracking') &&
    mapSrc.includes('RETIRED (4E-E)'),
    'E13: CANONICAL-CODE-MAP accurately documents Stage 4E-E retirements and canonical audit authority'
  );

  console.log('\n================================================================================');
  console.log(`SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

run4EETests().catch((err) => {
  console.error(err);
  process.exit(1);
});
