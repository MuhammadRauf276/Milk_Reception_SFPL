/**
 * Lab test system roles — the ONE place that decides which test is LR, Fat, SNF, Total Solids or the SNF/Fat ratio.
 *
 * The milk formulas (SNF, Total Solids, SNF/Fat ratio) need the LR and Fat readings. Those two tests must be found
 * by what they ARE, not by test id, display order or a guessed name. Every LabTest can carry a `systemRole`
 * (stored in the database). Tests that do not have one yet (older databases before the backfill) fall back to the
 * legacy code/name match below, so nothing breaks while the data is being updated.
 *
 * Pure module: no Prisma, no Node. Safe for server and browser code.
 */

export const LAB_TEST_ROLES = ['LR', 'FAT', 'SNF', 'TOTAL_SOLIDS', 'SNF_FAT_RATIO'] as const;
export type LabTestRole = (typeof LAB_TEST_ROLES)[number];

/** Raw readings the formulas are built from. These tests are locked ON (compulsory) at every stage. */
export const INPUT_ROLES: readonly LabTestRole[] = ['LR', 'FAT'];
/** Tests worked out automatically from the input roles. */
export const CALCULATED_ROLES: readonly LabTestRole[] = ['SNF', 'TOTAL_SOLIDS', 'SNF_FAT_RATIO'];

export interface RoleSubject {
  testCode: string;
  testName: string;
  /** Stored role, when the database has one. */
  systemRole?: string | null;
}

export function isLabTestRole(value: unknown): value is LabTestRole {
  return typeof value === 'string' && (LAB_TEST_ROLES as readonly string[]).includes(value);
}

// ─── Legacy fallback (only used when a test has no stored systemRole) ───────────────────────────────────────────
const LEGACY_LR_CODES = new Set(['LT-000008', 'LT-000027', 'LR', 'LT_LR']);
const LEGACY_FAT_CODES = new Set(['LT-000026', 'FAT', 'LT_FAT']);
const NOT_AN_INPUT = /RATIO|SNF|SOLIDS|SODIUM|CLOT/i;

function legacyRole(t: RoleSubject): LabTestRole | null {
  const code = (t.testCode || '').toUpperCase();
  const name = t.testName || '';
  if (/RATIO/i.test(name) || code === 'LT-000009') return 'SNF_FAT_RATIO';
  if (/TOTAL SOLIDS/i.test(name)) return 'TOTAL_SOLIDS';
  if (/^SNF$|SOLIDS-NOT-FAT|SOLIDS NOT FAT/i.test(name.trim())) return 'SNF';
  if (NOT_AN_INPUT.test(name)) return null;
  if (LEGACY_LR_CODES.has(code) || /\bLR\b|LACTOMETER/i.test(name)) return 'LR';
  if (LEGACY_FAT_CODES.has(code) || /^FAT\b|\bFAT\b|GERBER/i.test(name)) return 'FAT';
  return null;
}

/** The role of a test: its stored role when it has one, otherwise the legacy match. */
export function roleOf(t: RoleSubject): LabTestRole | null {
  if (isLabTestRole(t.systemRole)) return t.systemRole;
  return legacyRole(t);
}

export const isLr = (t: RoleSubject) => roleOf(t) === 'LR';
export const isFat = (t: RoleSubject) => roleOf(t) === 'FAT';
export const isInputRole = (t: RoleSubject) => {
  const r = roleOf(t);
  return r !== null && (INPUT_ROLES as readonly string[]).includes(r);
};

/**
 * Picks the one test that plays `role` out of a list. A stored role beats the legacy match; among legacy matches the
 * original master test (LR at 20 = LT-000008, Fat = LT-000026) wins, then the lowest id.
 */
export function pickRoleTest<T extends RoleSubject & { id?: string | number | bigint }>(tests: readonly T[], role: LabTestRole): T | null {
  const matches = tests.filter((t) => roleOf(t) === role);
  if (matches.length === 0) return null;
  const preferredCode = role === 'LR' ? 'LT-000008' : role === 'FAT' ? 'LT-000026' : '';
  return [...matches].sort((a, b) => {
    const aStored = isLabTestRole(a.systemRole) ? 1 : 0;
    const bStored = isLabTestRole(b.systemRole) ? 1 : 0;
    if (aStored !== bStored) return bStored - aStored;
    const aPref = a.testCode.toUpperCase() === preferredCode ? 1 : 0;
    const bPref = b.testCode.toUpperCase() === preferredCode ? 1 : 0;
    if (aPref !== bPref) return bPref - aPref;
    return Number(a.id ?? 0) - Number(b.id ?? 0);
  })[0];
}

// ─── Calculated tests (SNF, Total Solids, SNF/Fat ratio) ────────────────────────────────────────────────────────
export type CalcKind = 'SNF' | 'TOTAL_SOLIDS' | 'RATIO';

export interface CalcSubject extends RoleSubject {
  resultType?: string | null;
  formulaId?: unknown;
}

const CALC_ROLE_KIND: Record<string, CalcKind> = { SNF: 'SNF', TOTAL_SOLIDS: 'TOTAL_SOLIDS', SNF_FAT_RATIO: 'RATIO' };

/**
 * Which calculated test this is. A stored role decides first; only tests with no stored calculated role use the
 * older code/name match. (The legacy name match is deliberately not shared with roleOf: "Whey Protein Ratio" is a
 * lab test, not the SNF/Fat ratio.)
 */
export function calcKindOf(t: RoleSubject): CalcKind | null {
  if (typeof t.systemRole === 'string' && CALC_ROLE_KIND[t.systemRole]) return CALC_ROLE_KIND[t.systemRole];
  const code = (t.testCode || '').toUpperCase();
  const name = (t.testName || '').toUpperCase();
  if (name.includes('RATIO') || code.includes('RATIO') || code === 'LT-000009') return 'RATIO';
  if (name.includes('SNF') || name.includes('SOLIDS-NOT-FAT') || code === 'SYS-SNF') return 'SNF';
  if (name.includes('SOLIDS') || name === 'TS' || code === 'SYS-TS' || code === 'LT-TOTAL-SOLIDS') return 'TOTAL_SOLIDS';
  return null;
}

/**
 * True when this is the temperature test. There is no TEMPERATURE role (and none is added): a test that holds a stored
 * role is never temperature; otherwise the name "Temperature" or a code containing TEMP identifies it. The seeded
 * LT-000001 "Temperature" is covered by the name.
 */
export function isTemperatureTest(t: RoleSubject): boolean {
  if (isLabTestRole(t.systemRole)) return false;
  const name = (t.testName || '').trim().toLowerCase();
  const code = (t.testCode || '').toUpperCase();
  return name === 'temperature' || code.includes('TEMP');
}

/** True when the form must fill this test automatically instead of asking the operator. */
export function isCalculatedTest(t: CalcSubject): boolean {
  const type = t.resultType || '';
  // Categorical tests (Starch, Sugar, Alcohol, ...) can never be calculated.
  if (type === 'POSITIVE_NEGATIVE' || type === 'OK_NOT_OK' || type === 'BOOLEAN') return false;
  if (typeof t.systemRole === 'string' && CALC_ROLE_KIND[t.systemRole]) return true;
  const code = (t.testCode || '').toUpperCase();
  const name = (t.testName || '').toUpperCase();
  return (
    type === 'CALCULATED' ||
    Boolean(t.formulaId) ||
    code === 'SYS-SNF' ||
    code === 'SYS-TS' ||
    code === 'SNF' ||
    code === 'TS' ||
    code === 'RATIO' ||
    name === 'SNF' ||
    name.includes('SOLIDS-NOT-FAT') ||
    name.includes('SNF TO FAT RATIO') ||
    name.includes('RATIO SNF/FAT') ||
    name === 'TOTAL SOLIDS'
  );
}

/** The value `evaluateAllCalculatedTests` worked out for this calculated test, or null. */
export function calculatedValueFor(
  t: RoleSubject,
  calcs: Record<string, number | null | undefined>
): number | null {
  const kind = calcKindOf(t);
  const value = kind === 'RATIO' ? calcs.RATIO_SNF_FAT : kind === 'TOTAL_SOLIDS' ? calcs.TOTAL_SOLIDS : kind === 'SNF' ? calcs.SNF_CANONICAL : null;
  return value === undefined ? null : value;
}

/** Why a test cannot be switched off / made optional, or null when it is free to change. */
export function lockedReason(t: RoleSubject): string | null {
  const r = roleOf(t);
  if (r === 'LR') return 'LR is needed to calculate SNF and Total Solids, so it stays compulsory at every stage.';
  if (r === 'FAT') return 'Fat is needed to calculate SNF and Total Solids, so it stays compulsory at every stage.';
  return null;
}

/**
 * Why a Super Admin edit of a test must be refused because of its stored role, or null when it is allowed.
 * - A test holding a role cannot be switched off (the formulas would lose it; a matrix row on an inactive test cannot be edited).
 * - A role cannot be given to an inactive test (the Master Matrix only lists active tests, so the role would be stranded).
 */
export function roleEditBlock(
  target: { testName: string; systemRole?: string | null; isActive: boolean },
  body: { isActive?: unknown; systemRole?: unknown }
): string | null {
  const storedRole = target.systemRole ?? null;
  if (storedRole && body.isActive === false) {
    return `"${target.testName}" is the ${storedRole} test the milk formulas use, so it cannot be deactivated.`;
  }
  if (typeof body.systemRole === 'string' && body.systemRole) {
    const staysInactive = body.isActive === false || (body.isActive !== true && !target.isActive);
    if (staysInactive) {
      return `"${target.testName}" is not an active test, so it cannot hold the ${body.systemRole} role. Activate it first, or give the role to an active test.`;
    }
  }
  return null;
}

/** Name without a trailing "(Updated) ..." / "(Copy)" marker, lower-cased, for matching a test with its successor. */
export function lineageName(name: string): string {
  return (name || '').replace(/\s*\((updated|copy)\b[^)]*\).*$/i, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/** The active test that took over from an inactive one (same name lineage), or null. Prefers the one holding the same role, then the newest. */
export function findReplacementTest<T extends RoleSubject & { id: string | number | bigint; isActive: boolean }>(
  inactive: T,
  all: readonly T[]
): T | null {
  const key = lineageName(inactive.testName);
  const matches = all.filter((t) => t.isActive && String(t.id) !== String(inactive.id) && lineageName(t.testName) === key);
  if (matches.length === 0) return null;
  const sameRole = inactive.systemRole ? matches.filter((t) => t.systemRole === inactive.systemRole) : [];
  const pool = sameRole.length > 0 ? sameRole : matches;
  return [...pool].sort((a, b) => Number(b.id) - Number(a.id))[0];
}
