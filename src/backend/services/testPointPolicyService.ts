// Test point policy matrix: per (test, testing point) test/rule/photo modes, versioned with effective dates.
// Records started before a change keep the version that was effective at their start (pass `at`).
import type { ActingContext } from '@/types/acting';
import { TEST_POINT_CODES, TEST_POINT_LABELS, normalizeTestMode } from '@/types/test-point-policy';
import type { TestPointCode, TestPointPolicyCell } from '@/types/test-point-policy';
import { writeAuditLog, type AuditDb } from '@/backend/core/audit';
import { isInputRole, roleOf, pickRoleTest, lockedReason, findReplacementTest } from '@/lib/lab-test-roles';

type TestMode = TestPointPolicyCell['testMode'];
type RuleMode = TestPointPolicyCell['ruleMode'];
type PhotoMode = TestPointPolicyCell['photoMode'];

export const LAB_REPORT_TEST_CODE = 'LAB_REPORT_HANDWRITTEN';
export const LAB_REPORT_TEST_NAME = 'Lab report (hand-written)';
export const MIN_REASON_LENGTH = 5;

const DISPATCH_POINTS = new Set<TestPointCode>(['ZMCC_DISPATCH', 'CONTRACTOR_DISPATCH']);
const EPOCH_ISO = new Date(0).toISOString();

const TEST_MODES: readonly TestMode[] = ['COMPULSORY', 'OPTIONAL', 'OFF', 'APPLIED', 'NOT_APPLIED', 'AUTO'];
const RULE_MODES: readonly RuleMode[] = ['APPLY', 'WARN'];
const PHOTO_MODES: readonly PhotoMode[] = ['REQUIRED', 'OPTIONAL', 'NONE'];

export class PolicyValidationError extends Error {
  readonly status = 400;
  constructor(message: string) {
    super(message);
    this.name = 'PolicyValidationError';
  }
}

/** Stage name for messages (the same labels the matrix screen shows). */
function stageLabel(point: string): string {
  return (TEST_POINT_LABELS as Record<string, string>)[point] ?? point;
}

export interface PolicyRow {
  id: bigint;
  lab_test_id: bigint;
  testing_point: string;
  test_mode: string;
  rule_mode: string;
  photo_mode: string;
  version: number;
  effective_from: Date;
  effective_to: Date | null;
}

export interface PolicyLabTest {
  id: bigint;
  testCode: string;
  testName: string;
  displayOrder?: number;
}

// Minimal prisma surface used here (a transaction client satisfies it too).
export interface PolicyDb {
  testPointPolicy: {
    findMany(args: unknown): Promise<PolicyRow[]>;
    updateMany(args: unknown): Promise<unknown>;
    create(args: unknown): Promise<unknown>;
  };
  labTest: { findMany(args: unknown): Promise<PolicyLabTest[]> };
  configChangeLog: { create(args: unknown): Promise<{ id: bigint }> };
  auditLog: { create(args: never): Promise<{ id: bigint }> };
  milkTestPolicyAssignment: {
    findUnique(args: unknown): Promise<{ id: bigint; display_order: number; is_active: boolean; is_required: boolean } | null>;
    aggregate(args: unknown): Promise<{ _max: { display_order: number | null } }>;
    create(args: unknown): Promise<{ id: bigint }>;
    update(args: unknown): Promise<{ id: bigint }>;
  };
  $transaction<T>(fn: (tx: PolicyDb) => Promise<T>): Promise<T>;
}

async function defaultDb(): Promise<PolicyDb> {
  const { prisma } = await import('@core/db');
  return prisma as unknown as PolicyDb;
}

/** Maps a stored (possibly legacy) testing point code to the current TestPointCode, or null if unknown. */
export function mapLegacyTestPoint(code: string, sourceType?: string | null): TestPointCode | null {
  const c = (code || '').trim().toUpperCase();
  if ((TEST_POINT_CODES as readonly string[]).includes(c)) return c as TestPointCode;
  switch (c) {
    case 'ZMCC_LAB_MOT':
      return 'ZMCC_LAB_MC';
    case 'ZMCC_LAB_LOCAL_SUPPLIER':
    case 'ZMCC_LAB_CONTRACTOR':
      return 'ZMCC_LAB_HC';
    case 'DISPATCH':
      return (sourceType || '').toUpperCase() === 'CONTRACTOR' ? 'CONTRACTOR_DISPATCH' : 'ZMCC_DISPATCH';
    default:
      return null;
  }
}

/** Points a stored row applies to. Legacy DISPATCH rows had no source distinction, so they apply to both dispatch points. */
export function pointsForStoredCode(code: string): TestPointCode[] {
  if ((code || '').trim().toUpperCase() === 'DISPATCH') return ['ZMCC_DISPATCH', 'CONTRACTOR_DISPATCH'];
  const p = mapLegacyTestPoint(code);
  return p ? [p] : [];
}

export class PolicyConflictError extends Error {
  readonly status = 409;
  constructor() {
    super('Someone else just changed this cell. Reload and try again.');
    this.name = 'PolicyConflictError';
  }
}

function isCurrentCode(code: string): boolean {
  return (TEST_POINT_CODES as readonly string[]).includes(code);
}

/** Default modes when no DB row exists for the cell. */
export function defaultModes(testCode: string, point: TestPointCode, systemRole?: string | null): { testMode: TestMode; ruleMode: RuleMode; photoMode: PhotoMode } {
  const code = testCode.toUpperCase();
  if (code === LAB_REPORT_TEST_CODE) {
    return DISPATCH_POINTS.has(point)
      ? { testMode: 'COMPULSORY', ruleMode: 'APPLY', photoMode: 'REQUIRED' }
      : { testMode: 'OFF', ruleMode: 'APPLY', photoMode: 'NONE' };
  }
  if (isInputRole({ testCode, testName: '', systemRole })) {
    const isContractor = point === 'CONTRACTOR_DISPATCH';
    return { testMode: 'OPTIONAL', ruleMode: 'APPLY', photoMode: isContractor ? 'OPTIONAL' : 'REQUIRED' };
  }
  return { testMode: 'OPTIONAL', ruleMode: 'APPLY', photoMode: 'NONE' };
}

/**
 * The Super Admin stage-policy screen saves "required" and "photo required" on the test assignment.
 * Use them for the cell unless a saved matrix row (source DB) already decides it.
 */
export function applyAssignmentToCell<T extends Pick<TestPointPolicyCell, 'testMode' | 'photoMode' | 'source' | 'displayOrder'>>(
  cell: T,
  assignment?: { is_required: boolean; is_photo_required: boolean | null; display_order?: number | null } | null
): T {
  if (!assignment) return cell;
  return {
    ...cell,
    testMode: assignment.is_required ? 'COMPULSORY' : 'OPTIONAL',
    photoMode: assignment.is_photo_required ? 'REQUIRED' : 'NONE',
    ...(assignment.display_order != null ? { displayOrder: assignment.display_order } : {}),
  };
}

/** The parts of a stage assignment row the resolver needs (older Super Admin screens still write these). */
export interface StageAssignmentLike {
  is_required: boolean;
  is_photo_required?: boolean | null;
  display_order?: number | null;
}

export interface StageTestSelection {
  cell: TestPointPolicyCell;
  isRequired: boolean;
  isPhotoRequired: boolean;
  displayOrder: number;
  origin: 'MATRIX' | 'ASSIGNMENT';
}

/**
 * Which tests a stage shows, and how. One rule for every stage form:
 * 1. A saved matrix row (source DB) decides: OFF / NOT_APPLIED hides the test, COMPULSORY makes it required, anything else is optional.
 * 2. A test with no saved matrix row falls back to its ACTIVE stage assignment (older screens wrote only that).
 * 3. A cell nobody ever configured (source DEFAULT, no assignment) is hidden.
 * 4. Order is always the master test order (LabTest.displayOrder); a stage assignment never reorders the form.
 * `activeAssignments` must contain only is_active rows, keyed by labTestId.
 */
export function selectStageCells(
  cells: TestPointPolicyCell[],
  activeAssignments: Map<string, StageAssignmentLike>
): StageTestSelection[] {
  const out: StageTestSelection[] = [];
  for (const cell of cells) {
    const assignment = activeAssignments.get(cell.labTestId);
    if (cell.source === 'DB') {
      const mode = normalizeTestMode(cell.testMode);
      if (mode === 'OFF') continue;
      out.push({
        cell,
        isRequired: mode === 'COMPULSORY',
        isPhotoRequired: cell.photoMode === 'REQUIRED',
        displayOrder: cell.displayOrder,
        origin: 'MATRIX',
      });
    } else if (assignment) {
      out.push({
        cell,
        isRequired: assignment.is_required,
        isPhotoRequired: Boolean(assignment.is_photo_required),
        displayOrder: cell.displayOrder,
        origin: 'ASSIGNMENT',
      });
    }
  }
  return out;
}

const cellSubject = (c: TestPointPolicyCell) => ({
  id: c.labTestId,
  testCode: c.testCode,
  testName: c.testName,
  systemRole: c.systemRole ?? null,
});

function selectionFromCell(cell: TestPointPolicyCell, isRequired: boolean): StageTestSelection {
  return { cell, isRequired, isPhotoRequired: cell.photoMode === 'REQUIRED', displayOrder: cell.displayOrder, origin: 'MATRIX' };
}

/**
 * The milk formulas (SNF, Total Solids, ratio) need LR and Fat, so every stage form carries exactly one LR test and one
 * Fat test, and both are locked ON and COMPULSORY: Super Admin can still change their photo setting and order, not switch
 * them off. Which test is LR / Fat comes from lab-test-roles (stored role first), never from order or id.
 * Any other lactometer / fat test is dropped as a duplicate.
 */
export function keepFormulaTests(selected: StageTestSelection[], cells: TestPointPolicyCell[]): StageTestSelection[] {
  const out = selected.filter((s) => !isInputRole(cellSubject(s.cell)));
  for (const role of ['LR', 'FAT'] as const) {
    const candidates = cells.filter((c) => roleOf(cellSubject(c)) === role);
    const chosen = pickRoleTest(candidates.map(cellSubject), role);
    if (!chosen) continue;
    const cell = candidates.find((c) => c.labTestId === chosen.id);
    if (!cell) continue;
    const picked = selected.find((s) => s.cell.labTestId === cell.labTestId);
    out.push({ ...(picked ?? selectionFromCell(cell, true)), isRequired: cell.point !== 'CONTRACTOR_DISPATCH' });
  }
  return out;
}

/** Cell-level version of keepFormulaTests for stage loaders that work on matrix cells: exactly one LR and one Fat cell. */
export function withFormulaInputs(chosen: TestPointPolicyCell[], all: TestPointPolicyCell[]): TestPointPolicyCell[] {
  const out = chosen.filter((c) => !isInputRole(cellSubject(c)));
  for (const role of ['LR', 'FAT'] as const) {
    const candidates = all.filter((c) => roleOf(cellSubject(c)) === role);
    const picked = pickRoleTest(candidates.map(cellSubject), role);
    const cell = picked ? candidates.find((c) => c.labTestId === picked.id) : undefined;
    if (cell) out.push(chosen.find((c) => c.labTestId === cell.labTestId) ?? cell);
  }
  return out.sort((a, b) => a.displayOrder - b.displayOrder || Number(a.labTestId) - Number(b.labTestId));
}

/** LR and Fat are locked compulsory (Contractor dispatch keeps its own rule: tests are never compulsory there). */
export function lockFormulaInput<T extends TestPointPolicyCell>(cell: T): T {
  if (cell.point === 'CONTRACTOR_DISPATCH' || !isInputRole(cellSubject(cell))) return cell;
  return { ...cell, testMode: 'COMPULSORY' };
}

export interface StageAssignmentRow {
  is_active: boolean;
  is_required: boolean;
  is_photo_required?: boolean | null;
}

/**
 * The one loader rule for the ZMCC lab, MOT shop and dispatch forms (Plant QA uses selectStageCells, same rule):
 * 1. A saved Master Matrix row (source DB) decides everything: OFF / NOT_APPLIED hides the test, and the matrix
 *    test mode, rule mode, photo mode and order are used as they are. A stage assignment never overrides them.
 * 2. Only a cell nobody saved in the matrix falls back to its stage assignment (inactive hides it, active uses the
 *    assignment's required / photo flags), or, when `showUnconfigured` allows it, to the default cell.
 * 3. LR and Fat (found by stored role) are always carried exactly once and locked compulsory.
 * Order is never taken from the assignment.
 */
export function resolveStageCells(
  all: TestPointPolicyCell[],
  assignments: Map<string, StageAssignmentRow>,
  showUnconfigured: (cell: TestPointPolicyCell) => boolean = () => true
): TestPointPolicyCell[] {
  const chosen: TestPointPolicyCell[] = [];
  for (const cell of all) {
    const mode = normalizeTestMode(cell.testMode);
    if (cell.source === 'DB') {
      if (mode !== 'OFF') chosen.push(cell);
      continue;
    }
    const assignment = assignments.get(cell.labTestId);
    if (assignment) {
      if (assignment.is_active) {
        chosen.push({ ...cell, testMode: assignment.is_required ? 'COMPULSORY' : 'OPTIONAL', photoMode: assignment.is_photo_required ? 'REQUIRED' : 'NONE' });
      }
      continue;
    }
    if (mode !== 'OFF' && showUnconfigured(cell)) chosen.push(cell);
  }
  return withFormulaInputs(chosen, all).map(lockFormulaInput);
}

/**
 * Contractor vehicles going to the plant keep their relaxation: a Contractor cell Super Admin never saved
 * (source DEFAULT) is optional with an optional photo, so a contract vehicle with no tests and no lab-report photo can
 * still be submitted. A saved matrix row (source DB) always wins and stays enforced. Other points are never relaxed.
 */
export function relaxContractorDefaults(point: TestPointCode, cells: TestPointPolicyCell[]): TestPointPolicyCell[] {
  if (point !== 'CONTRACTOR_DISPATCH') return cells;
  return cells.map((c) =>
    c.source === 'DEFAULT' && (c.testMode === 'COMPULSORY' || c.photoMode === 'REQUIRED')
      ? { ...c, testMode: 'OPTIONAL' as const, photoMode: 'OPTIONAL' as const }
      : c
  );
}

function asTestMode(v: string): TestMode {
  return (TEST_MODES as readonly string[]).includes(v) ? (v as TestMode) : 'OPTIONAL';
}
function asRuleMode(v: string): RuleMode {
  return (RULE_MODES as readonly string[]).includes(v) ? (v as RuleMode) : 'APPLY';
}
function asPhotoMode(v: string): PhotoMode {
  return (PHOTO_MODES as readonly string[]).includes(v) ? (v as PhotoMode) : 'NONE';
}

function isEffective(row: PolicyRow, at: Date): boolean {
  return row.effective_from.getTime() <= at.getTime() && (row.effective_to === null || at.getTime() < row.effective_to.getTime());
}

// Better candidate: higher version, then newest effective_from, then current code over legacy code.
function isBetter(a: PolicyRow, b: PolicyRow): boolean {
  if (a.version !== b.version) return a.version > b.version;
  if (a.effective_from.getTime() !== b.effective_from.getTime()) return a.effective_from > b.effective_from;
  return isCurrentCode(a.testing_point) && !isCurrentCode(b.testing_point);
}

/**
 * Stored roles (LR, FAT, …) by lab test id. Read on its own and tolerant of an older database, so a missing
 * system_role column just means "no stored roles yet" and the legacy code/name match in lab-test-roles takes over.
 */
export async function loadSystemRoles(db: PolicyDb): Promise<Map<string, string>> {
  try {
    const rows = (await db.labTest.findMany({
      where: { systemRole: { not: null } },
      select: { id: true, systemRole: true },
    })) as unknown as Array<{ id: bigint; systemRole: string | null }>;
    return new Map(rows.filter((r) => r.systemRole).map((r) => [String(r.id), r.systemRole as string]));
  } catch (err) {
    // A missing system_role column (older database) is expected and silent. Anything else is logged, but the legacy
    // code/name fallback still serves the request, so nothing starts failing.
    if (!isMissingSystemRoleColumn(err)) {
      console.error(`[loadSystemRoles] could not read stored lab test roles, using legacy matching: ${err instanceof Error ? err.message : String(err)}`);
    }
    return new Map();
  }
}

/** Postgres 42703 (undefined_column), Prisma P2022 (column missing), or an error text naming system_role. */
export function isMissingSystemRoleColumn(err: unknown): boolean {
  const e = err as { code?: unknown; message?: unknown } | null;
  const code = typeof e?.code === 'string' ? e.code : '';
  const message = typeof e?.message === 'string' ? e.message : '';
  return code === '42703' || code === 'P2022' || message.includes('system_role');
}

async function loadMatrix(db: PolicyDb, at: Date, onlyPoint?: TestPointCode) {
  const tests = await db.labTest.findMany({
    where: { isActive: true },
    orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }],
    select: { id: true, testCode: true, testName: true, displayOrder: true },
  });
  const rows = await db.testPointPolicy.findMany({ orderBy: [{ version: 'asc' }] });
  const roles = await loadSystemRoles(db);
  const best = new Map<string, PolicyRow>();
  for (const row of rows) {
    if (!isEffective(row, at)) continue;
    for (const point of pointsForStoredCode(row.testing_point)) {
      if (onlyPoint && point !== onlyPoint) continue;
      const key = `${row.lab_test_id}|${point}`;
      const cur = best.get(key);
      if (!cur || isBetter(row, cur)) best.set(key, row);
    }
  }
  const points = onlyPoint ? [onlyPoint] : [...TEST_POINT_CODES];
  const cells: TestPointPolicyCell[] = [];
  for (const t of tests) {
    for (const point of points) {
      const row = best.get(`${t.id}|${point}`);
      if (row) {
        cells.push({
          labTestId: String(t.id),
          testCode: t.testCode,
          testName: t.testName,
          displayOrder: t.displayOrder ?? 999,
          systemRole: roles.get(String(t.id)) ?? null,
          point,
          testMode: asTestMode(row.test_mode),
          ruleMode: asRuleMode(row.rule_mode),
          photoMode: asPhotoMode(row.photo_mode),
          version: row.version,
          effectiveFrom: row.effective_from.toISOString(),
          source: 'DB',
        });
      } else {
        cells.push({
          labTestId: String(t.id),
          testCode: t.testCode,
          testName: t.testName,
          displayOrder: t.displayOrder ?? 999,
          systemRole: roles.get(String(t.id)) ?? null,
          point,
          ...defaultModes(t.testCode, point, roles.get(String(t.id)) ?? null),
          version: 0,
          effectiveFrom: EPOCH_ISO,
          source: 'DEFAULT',
        });
      }
    }
  }
  return { points: [...TEST_POINT_CODES], cells };
}

export async function getPolicyMatrix(at: Date = new Date(), db?: PolicyDb) {
  return loadMatrix(db ?? (await defaultDb()), at);
}

export async function getEffectivePolicy(point: TestPointCode, at: Date = new Date(), db?: PolicyDb) {
  const { cells } = await loadMatrix(db ?? (await defaultDb()), at, point);
  const version = cells.reduce((m, c) => Math.max(m, c.version), 0);
  return { point, version, cells };
}

/** One cell change. testMode / ruleMode / photoMode are optional: a field that is not sent keeps the cell's saved value. */
export type PolicyChange = Pick<TestPointPolicyCell, 'labTestId' | 'point'> &
  Partial<Pick<TestPointPolicyCell, 'testMode' | 'ruleMode' | 'photoMode'>>;

/**
 * Maps a TestPointCode to the canonical testing_point string used in MilkTestPolicyAssignment.
 * Returns null for points that don't have a MilkTestPolicyAssignment equivalent.
 */
function canonicalTestingPoint(point: TestPointCode): string | null {
  switch (point) {
    case 'PLANT_QA':
      return 'PLANT_QA';
    case 'MOT_SHOP':
      return 'MOT_SHOP';
    case 'ZMCC_LAB_MC':
      return 'ZMCC_LAB_MC';
    case 'ZMCC_LAB_HC':
      return 'ZMCC_LAB_HC';
    case 'ZMCC_DISPATCH':
    case 'CONTRACTOR_DISPATCH':
      return 'DISPATCH';
    default:
      return null;
  }
}

/**
 * Master "Require camera photo evidence" checkbox: apply it to every stage that already has a saved matrix row
 * for the test, keeping each stage's test mode and rule mode. Stages with no saved row follow the stage
 * assignment, which the caller already updates.
 */
export async function setPhotoRequiredForTest(
  ctx: ActingContext,
  labTestId: bigint | string,
  photoRequired: boolean,
  reason = 'Photo evidence changed on the master lab test',
  db?: PolicyDb
): Promise<{ applied: number }> {
  const database = db ?? (await defaultDb());
  const { cells } = await loadMatrix(database, new Date());
  const wanted: PhotoMode = photoRequired ? 'REQUIRED' : 'NONE';
  const changes: PolicyChange[] = cells
    .filter((c) => c.labTestId === String(labTestId) && c.source === 'DB' && c.photoMode !== wanted)
    .map((c) => ({ labTestId: c.labTestId, point: c.point, testMode: c.testMode, ruleMode: c.ruleMode, photoMode: wanted }));
  if (changes.length === 0) return { applied: 0 };
  return updatePolicyCells(ctx, changes, reason, database);
}

/** Super Admin matrix change: closes the current row, inserts version+1, writes change log + audit, all in one transaction. */
export async function updatePolicyCells(
  ctx: ActingContext,
  changes: PolicyChange[],
  reason: string,
  db?: PolicyDb
): Promise<{ applied: number }> {
  const cleanReason = (reason ?? '').trim();
  if (cleanReason.length < MIN_REASON_LENGTH) {
    throw new PolicyValidationError(`Please write a reason (at least ${MIN_REASON_LENGTH} characters).`);
  }
  if (!Array.isArray(changes) || changes.length === 0) throw new PolicyValidationError('No changes to save.');
  const seen = new Set<string>();
  for (const c of changes) {
    const where = `test ${c.labTestId} at ${stageLabel(String(c.point))}`;
    if (!(TEST_POINT_CODES as readonly string[]).includes(c.point)) throw new PolicyValidationError(`Unknown testing point: ${c.point} (test ${c.labTestId}).`);
    if (c.testMode === undefined && c.ruleMode === undefined && c.photoMode === undefined) throw new PolicyValidationError(`Nothing to change for ${where}.`);
    if (c.testMode !== undefined && !(TEST_MODES as readonly string[]).includes(c.testMode)) throw new PolicyValidationError(`Invalid test mode "${c.testMode}" for ${where}.`);
    if (c.ruleMode !== undefined && !(RULE_MODES as readonly string[]).includes(c.ruleMode)) throw new PolicyValidationError(`Invalid rule mode "${c.ruleMode}" for ${where}.`);
    if (c.photoMode !== undefined && !(PHOTO_MODES as readonly string[]).includes(c.photoMode)) throw new PolicyValidationError(`Invalid photo mode "${c.photoMode}" for ${where}.`);
    if (!/^\d+$/.test(String(c.labTestId))) throw new PolicyValidationError(`Invalid test id "${c.labTestId}" at ${stageLabel(String(c.point))}.`);
    const key = `${c.labTestId}|${c.point}`;
    if (seen.has(key)) throw new PolicyValidationError(`Duplicate cell in changes: ${where}.`);
    seen.add(key);
  }

  const database = db ?? (await defaultDb());
  try {
    return await runUpdate(database, ctx, changes, cleanReason);
  } catch (e) {
    if ((e as { code?: string } | null)?.code === 'P2002') throw new PolicyConflictError();
    throw e;
  }
}

async function runUpdate(database: PolicyDb, ctx: ActingContext, changes: PolicyChange[], cleanReason: string): Promise<{ applied: number }> {
  return database.$transaction(async (tx) => {
    const now = new Date();
    const { cells } = await loadMatrix(tx, now);
    const cellByKey = new Map(cells.map((c) => [`${c.labTestId}|${c.point}`, c]));
    const allRows = await tx.testPointPolicy.findMany({ orderBy: [{ version: 'asc' }] });
    let applied = 0;

    for (const ch of changes) {
      const key = `${ch.labTestId}|${ch.point}`;
      const current = cellByKey.get(key);
      if (!current) {
        // Name the test (inactive tests are not in the matrix but still exist) and, when one exists, the active test that replaced it.
        const allTests = (await tx.labTest.findMany({ select: { id: true, testCode: true, testName: true, isActive: true, systemRole: true } })) as unknown as Array<{ id: bigint; testCode: string; testName: string; isActive: boolean; systemRole: string | null }>;
        const known = allTests.find((t) => String(t.id) === String(ch.labTestId));
        if (!known) throw new PolicyValidationError(`Test ${ch.labTestId} does not exist (${stageLabel(ch.point)}).`);
        const replacement = findReplacementTest(known, allTests);
        throw new PolicyValidationError(
          `"${known.testName}" (${known.testCode}) is not an active test, so its setting at ${stageLabel(ch.point)} cannot be changed.` +
            (replacement
              ? ` Edit the active test "${replacement.testName}" (${replacement.testCode}) instead.`
              : ' Make the test active first.') +
            (known.systemRole ? ` It still holds the ${known.systemRole} role, which must be moved to an active test.` : '')
        );
      }
      // Fields that were not sent keep the saved value of this cell.
      const next = {
        testMode: ch.testMode ?? current.testMode,
        ruleMode: ch.ruleMode ?? current.ruleMode,
        photoMode: ch.photoMode ?? current.photoMode,
      };
      if (current.testMode === next.testMode && current.ruleMode === next.ruleMode && current.photoMode === next.photoMode) continue;

      // LR and Fat feed the milk formulas, so the real LR / Fat test cannot be switched off or made optional.
      if (ch.point !== 'CONTRACTOR_DISPATCH' && current.testMode !== next.testMode && normalizeTestMode(next.testMode) !== 'COMPULSORY') {
        const reason = lockedReason(cellSubject(current));
        if (reason) {
          const atPoint = cells.filter((c) => c.point === ch.point && isInputRole(cellSubject(c))).map(cellSubject);
          const canonical = pickRoleTest(atPoint, roleOf(cellSubject(current))!);
          if (canonical && canonical.id === current.labTestId) {
            throw new PolicyValidationError(`"${current.testName}" (${current.testCode}) at ${stageLabel(ch.point)}: ${reason}`);
          }
        }
      }

      const labTestId = BigInt(ch.labTestId);
      const related = allRows.filter((r) => r.lab_test_id === labTestId && pointsForStoredCode(r.testing_point).includes(ch.point));
      const maxVersion = related.reduce((m, r) => Math.max(m, r.version), 0);
      // Legacy DISPATCH rows serve two points; leave them open (the new higher-version row wins for this point).
      const openIds = related.filter((r) => r.effective_to === null && pointsForStoredCode(r.testing_point).length === 1).map((r) => r.id);
      if (openIds.length > 0) {
        await tx.testPointPolicy.updateMany({
          where: { id: { in: openIds } },
          data: { effective_to: now, is_active: false },
        });
      }
      const newVersion = maxVersion + 1;
      await tx.testPointPolicy.create({
        data: {
          lab_test_id: labTestId,
          testing_point: ch.point,
          test_mode: next.testMode,
          rule_mode: next.ruleMode,
          photo_mode: next.photoMode,
          version: newVersion,
          effective_from: now,
          effective_to: null,
          is_active: true,
          changed_by: ctx.userId,
          change_reason: cleanReason,
        },
      });
      const oldValue = {
        testMode: current.testMode,
        ruleMode: current.ruleMode,
        photoMode: current.photoMode,
        version: current.version,
        source: current.source,
      };
      const newValue = { ...next, version: newVersion };
      const log = await tx.configChangeLog.create({
        data: {
          module: 'TEST_POINT_POLICY',
          entity_key: `${current.testCode}@${ch.point}`,
          old_value: oldValue,
          new_value: newValue,
          changed_by: ctx.userId,
          reason: cleanReason,
          status: 'APPLIED',
          applied_at: now,
        },
      });
      await writeAuditLog(tx as unknown as AuditDb, {
        tableName: 'test_point_policy',
        recordId: labTestId,
        action: 'TEST_POINT_POLICY_UPDATE',
        oldValues: { point: ch.point, testCode: current.testCode, ...oldValue },
        newValues: { point: ch.point, testCode: current.testCode, ...newValue, reason: cleanReason, configChangeLogId: String(log.id) },
        actor: ctx,
      });

      // ─── Sync MilkTestPolicyAssignment ────────────────────────────────────────
      // Keep the plant-side form connected to the super-admin matrix. Without this,
      // changes made via the matrix dropdown (PUT /api/super-admin/test-point-policies)
      // only updated TestPointPolicy but NOT MilkTestPolicyAssignment, which is the
      // table that getEffectivePolicy('PLANT_QA') reads to build the plant testing form.
      const canonicalPoint = canonicalTestingPoint(ch.point);
      if (canonicalPoint) {
        const isActive = next.testMode !== 'OFF' && next.testMode !== 'NOT_APPLIED';
        const isRequired = next.testMode === 'COMPULSORY';
        const isPhotoRequired = next.photoMode === 'REQUIRED';

        const existing = await tx.milkTestPolicyAssignment.findUnique({
          where: {
            lab_test_id_testing_point: {
              lab_test_id: labTestId,
              testing_point: canonicalPoint,
            },
          },
        });

        if (existing) {
          await tx.milkTestPolicyAssignment.update({
            where: { id: existing.id },
            data: {
              is_active: isActive,
              is_required: isRequired,
              is_photo_required: isPhotoRequired,
              updated_by_user_id: ctx.userId,
            },
          });
        } else if (isActive) {
          // Only create a new assignment when activating; don't create an inactive ghost row.
          const maxOrderResult = await tx.milkTestPolicyAssignment.aggregate({
            where: { testing_point: canonicalPoint },
            _max: { display_order: true },
          });
          const nextOrder = (maxOrderResult._max.display_order ?? 0) + 1;
          await tx.milkTestPolicyAssignment.create({
            data: {
              lab_test_id: labTestId,
              testing_point: canonicalPoint,
              is_active: true,
              is_required: isRequired,
              is_photo_required: isPhotoRequired,
              display_order: nextOrder,
              created_by_user_id: ctx.userId,
              updated_by_user_id: ctx.userId,
            },
          });
        }
      }
      // ─── End MilkTestPolicyAssignment sync ────────────────────────────────────

      applied += 1;
    }
    return { applied };
  });
}
