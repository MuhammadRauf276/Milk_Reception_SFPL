// Seeds the default test point matrix (version 1 rows) and the document test LAB_REPORT_HANDWRITTEN.
// Idempotent: a cell that already has any row (current or legacy code) is left alone.
// Dry-run by default. Writes only with --apply. Refuses to run with NODE_ENV=production unless --apply is given.
//   npx tsx scripts/seed-test-point-policy.ts            (dry-run)
//   npx tsx scripts/seed-test-point-policy.ts --apply
import 'dotenv/config';
import { TEST_POINT_CODES } from '../src/types/test-point-policy';
import {
  LAB_REPORT_TEST_CODE,
  LAB_REPORT_TEST_NAME,
  defaultModes,
  mapLegacyTestPoint,
} from '../src/backend/services/testPointPolicyService';

async function main() {
  const apply = process.argv.includes('--apply');
  if (process.env.NODE_ENV === 'production' && !apply) {
    console.error('Refusing to run with NODE_ENV=production without --apply.');
    process.exit(1);
  }
  const { prisma } = await import('../src/backend/core/db');
  console.log(apply ? 'APPLY mode: writing changes.' : 'DRY-RUN: nothing will be written (use --apply to write).');

  let docTest = await prisma.labTest.findUnique({ where: { testCode: LAB_REPORT_TEST_CODE } });
  if (docTest) {
    console.log(`Document test ${LAB_REPORT_TEST_CODE} already exists (id ${docTest.id}).`);
  } else {
    console.log(`Would create document test ${LAB_REPORT_TEST_CODE} "${LAB_REPORT_TEST_NAME}".`);
    if (apply) {
      docTest = await prisma.labTest.create({
        data: {
          testCode: LAB_REPORT_TEST_CODE,
          testName: LAB_REPORT_TEST_NAME,
          resultType: 'DOCUMENT',
          unit: null,
          testScope: 'DOCUMENT',
          isRequired: false,
          isActive: true,
          displayOrder: 900,
          isPhotoRequired: true,
        },
      });
    }
  }

  const admin = await prisma.user.findFirst({ where: { role: 'SUPER_ADMIN' }, orderBy: { id: 'asc' } });
  if (!admin) {
    console.error('No SUPER_ADMIN user found; cannot set changed_by.');
    process.exit(1);
  }

  const tests = await prisma.labTest.findMany({ where: { isActive: true }, orderBy: { id: 'asc' } });
  const existing = await prisma.testPointPolicy.findMany({ select: { lab_test_id: true, testing_point: true } });
  const have = new Set<string>();
  for (const r of existing) {
    const p = mapLegacyTestPoint(r.testing_point);
    if (p) have.add(`${r.lab_test_id}|${p}`);
  }

  let toCreate = 0;
  for (const t of tests) {
    for (const point of TEST_POINT_CODES) {
      if (have.has(`${t.id}|${point}`)) continue;
      const m = defaultModes(t.testCode, point);
      toCreate += 1;
      if (apply) {
        await prisma.testPointPolicy.create({
          data: {
            lab_test_id: t.id,
            testing_point: point,
            test_mode: m.testMode,
            rule_mode: m.ruleMode,
            photo_mode: m.photoMode,
            version: 1,
            changed_by: admin.id,
            change_reason: 'Default matrix seed',
          },
        });
      }
    }
  }
  console.log(`${apply ? 'Created' : 'Would create'} ${toCreate} default matrix row(s).`);
  if (apply && !tests.some((t) => t.testCode === LAB_REPORT_TEST_CODE) && docTest) {
    console.log('Document test was created in this run; run again to seed its matrix rows.');
  }
}

main()
  .catch((e) => {
    console.error('Seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    const { prisma } = await import('../src/backend/core/db');
    await prisma.$disconnect();
  });
