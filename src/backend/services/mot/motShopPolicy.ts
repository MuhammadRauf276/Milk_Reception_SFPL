// Server loader for the MOT_SHOP decision policy: matrix cells + active release rules + lab test metadata.
import type { Prisma } from '@prisma/client';
import { getEffectivePolicy, type PolicyDb } from '@/backend/services/testPointPolicyService';
import { QualityRuleService } from '@/backend/services/qualityRuleService';
import type { MotShopPolicySnapshot, MotShopPolicyTest } from '@/types/stage1-decision';

const LR_CODES = new Set(['LT-000008', 'LT-000027', 'LR']);
const FAT_CODES = new Set(['LT-000026', 'FAT']);

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
  const cells = policy.cells.filter((c) => c.testMode !== 'OFF');

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
    const code = c.testCode.toUpperCase();
    const r = rules.get(c.labTestId);
    // Only RELEASE rules can fail a test; monitoring rules never reject.
    const rule =
      r && r.rule_category === 'RELEASE' && !r.isConfigurationError
        ? {
            min: r.min_value !== null ? Number(r.min_value) : null,
            max: r.max_value !== null ? Number(r.max_value) : null,
            allowed: r.acceptable_option ? [r.acceptable_option] : null,
          }
        : null;
    return {
      ...c,
      resultType: lt?.resultType ?? 'NUMERIC',
      isLr: LR_CODES.has(code),
      isFat: FAT_CODES.has(code),
      options: optionValues(lt?.resultOptions),
      rule,
    };
  });

  return { point: 'MOT_SHOP', version: policy.version, fetchedAt: new Date().toISOString(), tests };
}
