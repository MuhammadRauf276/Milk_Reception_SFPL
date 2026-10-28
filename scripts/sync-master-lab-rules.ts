import 'dotenv/config';
import { prisma } from '../src/backend/core/db';
import { MASTER_30_LAB_TESTS } from '../src/lib/master-lab-tests-data';

function parseRange(passRange: string): { min: number | null; max: number | null; opt: string | null } {
  const p = passRange.trim();
  if (p === 'OK' || p === 'Negative' || p === 'PASS') {
    return { min: null, max: null, opt: p };
  }
  if (p.includes('–') || p.includes('-')) {
    const parts = (p.includes('–') ? p.split('–') : p.split('-')).map((s) => s.trim());
    const min = parseFloat(parts[0]);
    const max = parseFloat(parts[1]);
    return { min: isNaN(min) ? null : min, max: isNaN(max) ? null : max, opt: null };
  }
  if (p.startsWith('≥') || p.startsWith('>=')) {
    const num = parseFloat(p.replace(/[^0-9.]/g, ''));
    return { min: isNaN(num) ? null : num, max: null, opt: null };
  }
  if (p.startsWith('≤') || p.startsWith('<=')) {
    const num = parseFloat(p.replace(/[^0-9.]/g, ''));
    return { min: null, max: isNaN(num) ? null : num, opt: null };
  }
  const directNum = parseFloat(p);
  if (!isNaN(directNum)) {
    return { min: directNum, max: null, opt: null };
  }
  return { min: null, max: null, opt: p };
}

async function main() {
  console.log('Synchronizing master lab test rules across database...');
  let updatedCount = 0;
  let deletedDuplicates = 0;

  for (const spec of MASTER_30_LAB_TESTS) {
    const labTest = await prisma.labTest.findUnique({
      where: { testCode: spec.testCode },
    });

    if (!labTest) {
      console.warn(`Test not found in DB: ${spec.testCode}`);
      continue;
    }

    const { min, max, opt } = parseRange(spec.passRange);
    const stages = ['MOT_SHOP', 'ZMCC_LAB_MC', 'ZMCC_LAB_HC', 'DISPATCH', 'PLANT_QA'];

    for (const stage of stages) {
      const allRules = await prisma.labTestRule.findMany({
        where: {
          lab_test_id: labTest.id,
          testing_point: stage,
        },
        orderBy: { id: 'desc' },
      });

      // Keep the newest, delete any duplicate older ones
      if (allRules.length > 1) {
        const toDelete = allRules.slice(1).map((r) => r.id);
        await prisma.labTestRule.deleteMany({
          where: { id: { in: toDelete } },
        });
        deletedDuplicates += toDelete.length;
      }

      const ruleToUpdate = allRules[0];
      if (ruleToUpdate) {
        await prisma.labTestRule.update({
          where: { id: ruleToUpdate.id },
          data: {
            min_value: min,
            max_value: max,
            acceptable_option: opt,
            warning_trigger: spec.warningHold && spec.warningHold !== '—' ? spec.warningHold : null,
            decision_consequence: spec.failReject && spec.failReject !== '—' ? spec.failReject : null,
            rule_category: spec.category,
            is_active: true,
          },
        });
        updatedCount++;
      } else {
        await prisma.labTestRule.create({
          data: {
            lab_test_id: labTest.id,
            testing_point: stage,
            version: 1,
            rule_category: spec.category,
            min_value: min,
            max_value: max,
            acceptable_option: opt,
            warning_trigger: spec.warningHold && spec.warningHold !== '—' ? spec.warningHold : null,
            decision_consequence: spec.failReject && spec.failReject !== '—' ? spec.failReject : null,
            is_active: true,
          },
        });
        updatedCount++;
      }
    }
  }

  console.log(`Sync completed! Synced rules: ${updatedCount}, Removed duplicates: ${deletedDuplicates}`);
}

main()
  .catch((e) => {
    console.error('Sync failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
