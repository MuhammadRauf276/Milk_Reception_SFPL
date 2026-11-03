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

/** Why a test cannot be switched off / made optional, or null when it is free to change. */
export function lockedReason(t: RoleSubject): string | null {
  const r = roleOf(t);
  if (r === 'LR') return 'LR is needed to calculate SNF and Total Solids, so it stays compulsory at every stage.';
  if (r === 'FAT') return 'Fat is needed to calculate SNF and Total Solids, so it stays compulsory at every stage.';
  return null;
}
