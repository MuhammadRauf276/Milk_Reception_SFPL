/**
 * Calculated test values (SNF, Total Solids, SNF/Fat ratio) for ONE portion / sample, worked out from its LR and Fat
 * readings. Shared by the dispatch, ZMCC lab and MOT shop forms so they all show the same read-only numbers.
 *
 * Tests are found by their stored role (see lab-test-roles.ts), never by code or name in this file. The formulas are the
 * ones in calculated-tests.ts. Pure module: no React, no Prisma.
 */
import { evaluateAllCalculatedTests } from './calculated-tests';
import { calculatedValueFor, isCalculatedTest, pickRoleTest, type CalcSubject } from './lab-test-roles';

export interface PortionCalcTest extends CalcSubject {
  labTestId: string;
  /** Flags the server already sends on policy tests; the role helpers are the fallback. */
  isLr?: boolean;
  isFat?: boolean;
}

/** A typed reading as a usable number: empty, non-numeric and non-finite text all become null. */
export function readingToNumber(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'string' && raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * The value of every calculated test in `tests`, keyed by labTestId (null when LR or Fat is missing/invalid/zero).
 * Tests that are not calculated are not in the result. `readingOf` returns what was typed for a test.
 */
export function calculatedValuesForPortion<T extends PortionCalcTest>(
  tests: readonly T[],
  readingOf: (t: T) => unknown
): Record<string, number | null> {
  const candidates = tests.filter((t) => !isCalculatedTest(t));
  const lrTest = candidates.find((t) => t.isLr) ?? pickRoleTest(candidates, 'LR');
  const fatTest = candidates.find((t) => t.isFat) ?? pickRoleTest(candidates, 'FAT');
  const calcs = evaluateAllCalculatedTests({
    LR: lrTest ? readingToNumber(readingOf(lrTest)) : null,
    FAT: fatTest ? readingToNumber(readingOf(fatTest)) : null,
  });
  const out: Record<string, number | null> = {};
  for (const t of tests) {
    if (isCalculatedTest(t)) out[t.labTestId] = calculatedValueFor(t, calcs);
  }
  return out;
}
