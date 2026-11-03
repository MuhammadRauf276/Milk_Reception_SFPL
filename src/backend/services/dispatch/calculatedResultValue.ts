/**
 * The value a calculated lab test (SNF, Total Solids, SNF/Fat ratio) is stored with when a portion's results are saved.
 *
 * Each calculated test gets ITS OWN value, worked out on the server from the portion's LR and Fat. The test is found by
 * its stored system role (lab-test-roles.ts); a client-sent value is never used. Pure module: no Prisma.
 */
import { evaluateAllCalculatedTests } from '@/lib/calculated-tests';
import { calculatedValueFor, isCalculatedTest, type CalcSubject } from '@/lib/lab-test-roles';

/**
 * `null` when `test` is not a calculated test (the caller stores the submitted value as usual).
 * Otherwise `{ value }`, where value is null when LR or Fat is missing/invalid (never 0, never another test's value).
 */
export function storedCalculatedValue(
  test: CalcSubject,
  lr: number | null | undefined,
  fat: number | null | undefined
): { value: number | null } | null {
  if (!isCalculatedTest(test)) return null;
  const calcs = evaluateAllCalculatedTests({ LR: lr ?? null, FAT: fat ?? null });
  return { value: calculatedValueFor(test, calcs) };
}
