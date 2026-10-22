// Test point policy matrix: per (test, testing point) test/rule/photo modes, versioned with effective dates.
// Records started before a change keep the version that was effective at their start (pass `at`).
import type { ActingContext } from '@/types/acting';
import { TEST_POINT_CODES } from '@/types/test-point-policy';
import type { TestPointCode, TestPointPolicyCell } from '@/types/test-point-policy';
import { writeAuditLog, type AuditDb } from '@/backend/core/audit';

type TestMode = TestPointPolicyCell['testMode'];
type RuleMode = TestPointPolicyCell['ruleMode'];
type PhotoMode = TestPointPolicyCell['photoMode'];

export const LAB_REPORT_TEST_CODE = 'LAB_REPORT_HANDWRITTEN';
export const LAB_REPORT_TEST_NAME = 'Lab report (hand-written)';
export const MIN_REASON_LENGTH = 5;

// LR (lactometer) and Fat tests as identified in prisma/seed.ts and milkTestResolvers.
const LR_FAT_CODES = new Set(['LT-000008', 'LT-000027', 'LT-000026', 'LR', 'FAT']);
const DISPATCH_POINTS = new Set<TestPointCode>(['ZMCC_DISPATCH', 'CONTRACTOR_DISPATCH']);
const EPOCH_ISO = new Date(0).toISOString();

const TEST_MODES: readonly TestMode[] = ['COMPULSORY', 'OPTIONAL', 'OFF'];
const RULE_MODES: readonly RuleMode[] = ['APPLY', 'WARN'];
const PHOTO_MODES: readonly PhotoMode[] = ['REQUIRED', 'OPTIONAL', 'NONE'];

export class PolicyValidationError extends Error {
  readonly status = 400;
  constructor(message: string) {
    super(message);
    this.name = 'PolicyValidationError';
  }
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
export function defaultModes(testCode: string, point: TestPointCode): { testMode: TestMode; ruleMode: RuleMode; photoMode: PhotoMode } {
  const code = testCode.toUpperCase();
  if (code === LAB_REPORT_TEST_CODE) {
    return DISPATCH_POINTS.has(point)
      ? { testMode: 'COMPULSORY', ruleMode: 'APPLY', photoMode: 'REQUIRED' }
      : { testMode: 'OFF', ruleMode: 'APPLY', photoMode: 'NONE' };
  }
  if (LR_FAT_CODES.has(code)) {
    const isContractor = point === 'CONTRACTOR_DISPATCH';
    return { testMode: 'OPTIONAL', ruleMode: 'APPLY', photoMode: isContractor ? 'OPTIONAL' : 'REQUIRED' };
  }
  return { testMode: 'OPTIONAL', ruleMode: 'APPLY', photoMode: 'NONE' };
}

/**
 * The Super Admin stage-policy screen saves "required" and "photo required" on the test assignment.
 * Use them for the cell unless a saved matrix row (source DB) already decides it.
 */
export function applyAssignmentToCell<T extends Pick<TestPointPolicyCell, 'testMode' | 'photoMode' | 'source'>>(
  cell: T,
  assignment?: { is_required: boolean; is_photo_required: boolean | null } | null
): T {
  if (!assignment) return cell;
  return {
    ...cell,
    testMode: assignment.is_required ? 'COMPULSORY' : 'OPTIONAL',
    photoMode: assignment.is_photo_required ? 'REQUIRED' : 'NONE',
  };
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

async function loadMatrix(db: PolicyDb, at: Date, onlyPoint?: TestPointCode) {
  const tests = await db.labTest.findMany({
    where: { isActive: true },
    orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }],
    select: { id: true, testCode: true, testName: true, displayOrder: true },
  });
  const rows = await db.testPointPolicy.findMany({ orderBy: [{ version: 'asc' }] });
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
          point,
          ...defaultModes(t.testCode, point),
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

export type PolicyChange = Pick<TestPointPolicyCell, 'labTestId' | 'point' | 'testMode' | 'ruleMode' | 'photoMode'>;

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
    if (!(TEST_POINT_CODES as readonly string[]).includes(c.point)) throw new PolicyValidationError(`Unknown testing point: ${c.point}`);
    if (!(TEST_MODES as readonly string[]).includes(c.testMode)) throw new PolicyValidationError('Invalid test mode.');
    if (!(RULE_MODES as readonly string[]).includes(c.ruleMode)) throw new PolicyValidationError('Invalid rule mode.');
    if (!(PHOTO_MODES as readonly string[]).includes(c.photoMode)) throw new PolicyValidationError('Invalid photo mode.');
    if (!/^\d+$/.test(String(c.labTestId))) throw new PolicyValidationError('Invalid test id.');
    const key = `${c.labTestId}|${c.point}`;
    if (seen.has(key)) throw new PolicyValidationError('Duplicate cell in changes.');
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
      if (!current) throw new PolicyValidationError(`Test ${ch.labTestId} is not an active test.`);
      if (current.testMode === ch.testMode && current.ruleMode === ch.ruleMode && current.photoMode === ch.photoMode) continue;

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
          test_mode: ch.testMode,
          rule_mode: ch.ruleMode,
          photo_mode: ch.photoMode,
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
      const newValue = { testMode: ch.testMode, ruleMode: ch.ruleMode, photoMode: ch.photoMode, version: newVersion };
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
      applied += 1;
    }
    return { applied };
  });
}
