// Server loader for the MOT_SHOP decision policy: matrix cells + active release rules + lab test metadata.
import type { Prisma } from '@prisma/client';
import { applyAssignmentToCell, withFormulaInputs, lockFormulaInput, getEffectivePolicy, type PolicyDb } from '@/backend/services/testPointPolicyService';
import { isLr, isFat } from '@/lib/lab-test-roles';
import { QualityRuleService } from '@/backend/services/qualityRuleService';
import type { MotShopPolicySnapshot, MotShopPolicyTest } from '@/types/stage1-decision';

function optionValues(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const out: string[] = [];
  for (const o of raw) {
    if (typeof o === 'string') out.push(o);
    else if (o && typeof o === 'object' && typeof (o as { value?: unknown }).value === 'string') out.push((o as { value: string }).value);
  }
  return out.length > 0 ? out : null;
}

export async function loadMotShopPolicy(at: Date = new Date(), db?: unknown): Promise<MotShopPolicySnapshot> {
  const { prisma } = await import('@core/db');
  const client = (db ?? prisma) as typeof prisma;
  const policy = await getEffectivePolicy('MOT_SHOP', at, client as unknown as PolicyDb);

  // Check stage policy assignments configured by Super Admin
  const motAssignments = await client.milkTestPolicyAssignment.findMany({
      where: { testing_point: 'MOT_SHOP' },
      select: { lab_test_id: true, is_active: true, is_required: true, is_photo_required: true },
    });

  const assignmentMap = new Map(motAssignments.map((a) => [a.lab_test_id.toString(), a]));

  // 1. A test with a stage assignment follows that assignment's is_active flag.
  // 2. Otherwise the Master Test Matrix mode decides (OFF / NOT_APPLIED hides it).
  // 3. LR and Fat are always carried (exactly one of each, locked compulsory): the milk formulas depend on them.
  const matrixOrAssignment = policy.cells.filter((c) => {
    const assignment = assignmentMap.get(c.labTestId);
    if (assignment) return assignment.is_active;
    return c.testMode !== 'OFF' && c.testMode !== 'NOT_APPLIED';
  });
  const cells = withFormulaInputs(matrixOrAssignment, policy.cells)
    .map((c) => applyAssignmentToCell(c, assignmentMap.get(c.labTestId)))
    .map(lockFormulaInput);

  const ids = cells.map((c) => BigInt(c.labTestId));
  const [labTests, rules] = await Promise.all([
    ids.length > 0
      ? client.labTest.findMany({ where: { id: { in: ids } }, select: { id: true, resultType: true, resultOptions: true } })
      : Promise.resolve([]),
    QualityRuleService.resolveActiveRulesForTestingPoint('MOT_SHOP', at, client as unknown as Prisma.TransactionClient),
  ]);
  const meta = new Map(labTests.map((t) => [String(t.id), t]));

  const tests: MotShopPolicyTest[] = cells.map((c) => {
    const lt = meta.get(c.labTestId);
    const r = rules.get(c.labTestId);

    const opts = (lt?.resultOptions && Array.isArray(lt.resultOptions))
      ? (lt.resultOptions as Array<{ value: string; isPassing?: boolean | null; outcome?: string }>)
      : [];
    const passOpts = opts
      .filter((o) => o.outcome === 'PASS' || o.isPassing === true)
      .map((o) => o.value.trim().toUpperCase());
    const warnOpts = opts
      .filter((o) => o.outcome === 'WARNING')
      .map((o) => o.value.trim().toUpperCase());

    let allowed: string[] | null = null;
    if (r && r.rule_category === 'RELEASE' && !r.isConfigurationError) {
      if (r.acceptable_option && (!opts.length || opts.some((o) => o.value.trim().toUpperCase() === r.acceptable_option!.trim().toUpperCase()))) {
        allowed = [r.acceptable_option];
      } else if (passOpts.length > 0) {
        allowed = passOpts;
      } else {
        allowed = ['OK', 'PASS', 'NEGATIVE', 'NORMAL', 'CLEAN', 'TRUE', 'YES'];
      }
    } else if (passOpts.length > 0) {
      allowed = passOpts;
    }

    const rule =
      r && r.rule_category === 'RELEASE' && !r.isConfigurationError
        ? {
            min: r.min_value !== null ? Number(r.min_value) : null,
            max: r.max_value !== null ? Number(r.max_value) : null,
            allowed,
            warningOptions: warnOpts.length > 0 ? warnOpts : null,
          }
        : allowed
        ? {
            min: null,
            max: null,
            allowed,
            warningOptions: warnOpts.length > 0 ? warnOpts : null,
          }
        : null;

    return {
      ...c,
      resultType: lt?.resultType ?? 'NUMERIC',
      isLr: isLr(c),
      isFat: isFat(c),
      options: optionValues(lt?.resultOptions),
      rule,
    };
  });

  return { point: 'MOT_SHOP', version: policy.version, fetchedAt: new Date().toISOString(), tests };
}
