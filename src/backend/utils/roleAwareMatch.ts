import { isFatTestCandidate, isLrTestCandidate } from '@/backend/utils/milkTestResolvers';

type Role = 'LR' | 'FAT';
type TestFacts = { testCode?: string | null; testName?: string | null; resultType?: string | null; systemRole?: string | null };

/**
 * Role-aware LR / Fat decision. A test with a stored role is LR / Fat only when that role is the one asked for.
 * A test with no stored role falls back to the code/name match, but only while no test in the system holds the role
 * (`roleHeld`): once one does, a look-alike such as "Lactometer Reading" is no longer counted.
 */
export function isRoleTest(test: TestFacts, role: Role, roleHeld: boolean): boolean {
  if (test.systemRole) return test.systemRole === role;
  if (roleHeld) return false;
  const match = role === 'LR' ? isLrTestCandidate : isFatTestCandidate;
  return match(test.testCode, test.testName, test.resultType);
}

/** The first result produced by the test that plays `role` (see isRoleTest). */
export function findRoleResult<T extends { lab_test: TestFacts }>(results: readonly T[], role: Role, roleHeld: boolean): T | undefined {
  const stored = results.find((r) => r.lab_test.systemRole === role);
  if (stored) return stored;
  return results.find((r) => isRoleTest(r.lab_test, role, roleHeld));
}

/** SNF test: the stored SNF role decides; a test with no stored role falls back to the older code/name match. */
export function isConfiguredSnfTest(code?: string | null, name?: string | null, systemRole?: string | null): boolean {
  if (systemRole) return systemRole === 'SNF';
  const c = (code || '').trim().toUpperCase();
  const n = (name || '').trim().toUpperCase();
  if (c === 'SNF' || c === 'LT-SNF') return true;
  if (n === 'SNF' || n.includes('SOLIDS-NOT-FAT') || n.includes('SOLIDS NOT FAT')) {
    if (!n.includes('RATIO')) return true;
  }
  return false;
}
