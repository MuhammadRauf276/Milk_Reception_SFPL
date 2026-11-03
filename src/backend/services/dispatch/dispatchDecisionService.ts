// Stage 3 (ZMCC / Contractor dispatch): policy, server totals, decision rule, tank issue, approver queue and approver decision.
import { Prisma } from '@prisma/client';
import { prisma } from '@core/db';
import { assertResourceInScope, asRoleFields, resolveActingContext } from '@/backend/core/acting-context';
import { writeAuditLog, type AuditActor } from '@/backend/core/audit';
import type { User } from '@/backend/core/types';
import { evaluateDecision } from '@/backend/services/decision/decisionRule';
import { isLr, isFat } from '@/lib/lab-test-roles';
import { applyAssignmentToCell, withFormulaInputs, lockFormulaInput, getEffectivePolicy, LAB_REPORT_TEST_CODE, LAB_REPORT_TEST_NAME, type PolicyDb } from '@/backend/services/testPointPolicyService';
import { QualityRuleService } from '@/backend/services/qualityRuleService';
import { getTankPhysicalStock } from '@/backend/services/zmccTankService';
import { calculateDensity, calculateGrossLiters, computeCanonicalMilkMetrics } from '@/backend/utils/milkFormulas';
import {
  canDecideDispatch,
  dispatchApproverRoleFor,
  type DispatchApproverRole,
  type DispatchPoint,
} from '@/backend/services/dispatchScope';
import type { ActingContext } from '@/types/acting';
import type { DecisionResult, PersonDecision } from '@/types/stage1-decision';
import type { TestPointPolicyCell } from '@/types/test-point-policy';

type Tx = Prisma.TransactionClient;
type Db = Tx | typeof prisma;

export type DispatchTestMode = 'COMPOSITE' | 'PORTION_WISE';
export type DispatchTestOutcome = 'PASS' | 'FAIL' | 'WARN' | 'NOT_TESTED';

/** Photo entity types used by the dispatch form (POST /api/photos). */
export const DISPATCH_PORTION_PHOTO_ENTITY = 'dispatch_portion';
export const DISPATCH_INFO_PHOTO_ENTITY = 'dispatch_info';
export const DISPATCH_APPROVAL_EVENT_KEY = 'DISPATCH_APPROVAL_PENDING';

/** Visit statuses of the Stage 3 flow. */
export const DISPATCH_STATUS = {
  DRAFT: 'DRAFT_DISPATCH',
  PENDING_APPROVAL: 'PENDING_APPROVAL',
  REOPENED: 'REOPENED',
  DISPATCHED: 'DISPATCHED',
  REJECTED: 'DISPATCH_REJECTED',
} as const;

/** Statuses a dispatch form may be (re)submitted from. */
export const DISPATCH_EDITABLE_STATUSES: readonly string[] = [DISPATCH_STATUS.DRAFT, DISPATCH_STATUS.REOPENED];

export class DispatchFlowError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'DispatchFlowError';
  }
}

// ---------------------------------------------------------------------------------------------
// Policy
// ---------------------------------------------------------------------------------------------

export interface DispatchPolicyTest extends TestPointPolicyCell {
  resultType: string;
  unit: string | null;
  isLr: boolean;
  isFat: boolean;
  isLabReport: boolean;
  options: string[] | null;
  rule: { min: number | null; max: number | null; allowed?: string[] | null } | null;
}

export interface DispatchPolicySnapshot {
  point: DispatchPoint;
  version: number;
  fetchedAt: string;
  tests: DispatchPolicyTest[];
}

function optionValues(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const out: string[] = [];
  for (const o of raw) {
    if (typeof o === 'string') out.push(o);
    else if (o && typeof o === 'object' && typeof (o as { value?: unknown }).value === 'string') out.push((o as { value: string }).value);
  }
  return out.length > 0 ? out : null;
}

/** Effective dispatch policy: matrix cells (not OFF) + active RELEASE rules + lab test metadata. */
export async function loadDispatchPolicy(point: DispatchPoint, at: Date = new Date(), db: Db = prisma): Promise<DispatchPolicySnapshot> {
  const policy = await getEffectivePolicy(point, at, db as unknown as PolicyDb);

  // Check stage assignments configured by Super Admin for DISPATCH
  const dispatchAssignments = await db.milkTestPolicyAssignment.findMany({
      where: { testing_point: 'DISPATCH' },
      select: { lab_test_id: true, is_active: true, is_required: true, is_photo_required: true },
    });

  const assignmentMap = new Map(dispatchAssignments.map((a) => [a.lab_test_id.toString(), a]));

  // Only tests Super Admin assigned (and switched on) for this point are shown. LR and Fat are always carried
  // (exactly one of each, locked compulsory) because the milk formulas need them.
  const matrixOrAssignment = policy.cells.filter((c) => {
    if (c.testCode.toUpperCase() === LAB_REPORT_TEST_CODE) return c.testMode !== 'OFF';
    const assignment = assignmentMap.get(c.labTestId);
    return assignment ? assignment.is_active : false;
  });
  const cells = withFormulaInputs(matrixOrAssignment, policy.cells)
    .map((c) => applyAssignmentToCell(c, assignmentMap.get(c.labTestId)))
    .map(lockFormulaInput)
    // Workflow document (Stage 3): tests are not compulsory for a Contractor, whatever Super Admin sets
    // (the DISPATCH assignment is shared with ZMCC dispatch). Pictures and the lab report become optional too.
    .map((c) =>
      point === 'CONTRACTOR_DISPATCH'
        ? {
            ...c,
            testMode: c.testMode === 'COMPULSORY' ? ('OPTIONAL' as const) : c.testMode,
            photoMode: c.photoMode === 'REQUIRED' ? ('OPTIONAL' as const) : c.photoMode,
          }
        : c
    );

  const ids = cells.map((c) => BigInt(c.labTestId));
  const [labTests, pointRules, legacyRules] = await Promise.all([
    ids.length > 0
      ? db.labTest.findMany({
          where: { id: { in: ids } },
          select: { id: true, resultType: true, resultOptions: true, unit: true, displayOrder: true },
        })
      : Promise.resolve([]),
    QualityRuleService.resolveActiveRulesForTestingPoint(point, at, db),
    // Release rules are still stored under the legacy DISPATCH testing point.
    QualityRuleService.resolveActiveRulesForTestingPoint('DISPATCH', at, db),
  ]);
  const meta = new Map(labTests.map((t) => [String(t.id), t]));

  const tests: DispatchPolicyTest[] = cells.map((c) => {
    const lt = meta.get(c.labTestId);
    const code = c.testCode.toUpperCase();
    const specific = pointRules.get(c.labTestId);
    const r = specific && specific.testing_point === point ? specific : legacyRules.get(c.labTestId) ?? specific;

    const opts = (lt?.resultOptions && Array.isArray(lt.resultOptions))
      ? (lt.resultOptions as Array<{ value: string; isPassing?: boolean | null; outcome?: string }>)
      : [];
    const passOpts = opts
      .filter((o) => o.outcome === 'PASS' || o.isPassing === true)
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
          }
        : allowed
        ? { min: null, max: null, allowed }
        : null;

    return {
      ...c,
      resultType: lt?.resultType ?? 'NUMERIC',
      unit: lt?.unit ?? null,
      isLr: isLr(c),
      isFat: isFat(c),
      isLabReport: code === LAB_REPORT_TEST_CODE,
      options: optionValues(lt?.resultOptions),
      rule,
    };
  });
  tests.sort((a, b) => (meta.get(a.labTestId)?.displayOrder ?? 0) - (meta.get(b.labTestId)?.displayOrder ?? 0));

  return { point, version: policy.version, fetchedAt: new Date().toISOString(), tests };
}

/** Hand-written lab report photo: required unless the matrix turned it off (owner default: required at both dispatch points). */
export function labReportRequired(p: DispatchPolicySnapshot): boolean {
  const cell = p.tests.find((t) => t.isLabReport);
  if (!cell) return true;
  return cell.photoMode === 'REQUIRED';
}

// ---------------------------------------------------------------------------------------------
// Totals (server only — payload totals are never trusted)
// ---------------------------------------------------------------------------------------------

export interface DispatchTotals {
  grossLiters: number;
  weightedLr: number;
  weightedFat: number;
  /** @13TS litres of the whole vehicle, from gross litres and the quantity-weighted LR and Fat. */
  weightedTs13: number;
  /** TS % from the weighted LR and Fat. */
  weightedTs: number;
  /** true when every portion has gross litres and LR + Fat were found. */
  complete: boolean;
}

export interface DispatchTotalsDetail extends DispatchTotals {
  portionGrossLiters: Array<number | null>;
  density: number | null;
  snf: number | null;
  calculationVersion: string | null;
}

const round = (n: number, d: number) => Number(n.toFixed(d));

export function computeDispatchTotals(
  portions: Array<{ quantityValue: number; quantityUnit: string; lr: number | null; fat: number | null }>
): DispatchTotalsDetail {
  const portionGrossLiters = portions.map((p) => calculateGrossLiters(p.quantityValue, p.quantityUnit, p.lr));
  let gross = 0;
  let lrSum = 0;
  let lrQty = 0;
  let fatSum = 0;
  let fatQty = 0;
  portions.forEach((p, i) => {
    const g = portionGrossLiters[i];
    if (g === null) return;
    gross += g;
    if (p.lr !== null && p.lr > 0) {
      lrSum += p.lr * g;
      lrQty += g;
    }
    if (p.fat !== null && p.fat >= 0) {
      fatSum += p.fat * g;
      fatQty += g;
    }
  });
  const grossLiters = round(gross, 2);
  const weightedLr = lrQty > 0 ? round(lrSum / lrQty, 2) : 0;
  const weightedFat = fatQty > 0 ? round(fatSum / fatQty, 2) : 0;
  const hasQuality = lrQty > 0 && fatQty > 0 && grossLiters > 0;
  const metrics = hasQuality ? computeCanonicalMilkMetrics(grossLiters, 'LITER', weightedLr, weightedFat) : null;
  return {
    grossLiters,
    weightedLr,
    weightedFat,
    weightedTs13: metrics?.at13tsLiters ?? 0,
    weightedTs: metrics?.ts ?? 0,
    complete: portionGrossLiters.every((g) => g !== null) && lrQty === gross && fatQty === gross && hasQuality,
    portionGrossLiters,
    density: metrics?.density ?? (weightedLr > 0 ? round(calculateDensity(weightedLr), 4) : null),
    snf: metrics?.snf ?? null,
    calculationVersion: metrics?.calculationVersion ?? null,
  };
}

// ---------------------------------------------------------------------------------------------
// Decision
// ---------------------------------------------------------------------------------------------

export interface DispatchPortionInput {
  portionNumber: number;
  sealNumber: string;
  quantityValue: number;
  quantityUnit: string;
  tests: Array<{ labTestId: string; value?: number | null; textValue?: string | null }>;
  photos: Array<{ labTestId: string; captureId: string }>;
}

export interface DispatchPortionDetails {
  portionNumber: number;
  sealNumber: string;
  quantityValue: number;
  quantityUnit: string;
  grossLiters: number | null;
  lr: number | null;
  fat: number | null;
  tests: Array<{
    labTestId: string;
    testCode: string;
    testName: string;
    unit: string | null;
    value: number | null;
    textValue: string | null;
    testMode: string;
    ruleMode: string;
    photoMode: string;
    outcome: DispatchTestOutcome;
    photoCaptureId: string | null;
  }>;
  photos: Array<{ labTestId: string; captureId: string }>;
}

export interface DispatchDecisionDetails {
  point: DispatchPoint;
  policyVersion: number;
  testMode: DispatchTestMode;
  portions: DispatchPortionDetails[];
  labReport: { required: boolean; captureId: string | null };
  missingCompulsory: string[];
  missingPhotos: string[];
  ruleFailures: string[];
  warnings: string[];
  totals: DispatchTotals;
}

function cleanNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function outcomeOf(t: DispatchPolicyTest, value: number | null, textValue: string | null): 'PASS' | 'FAIL' {
  const rule = t.rule;
  if (!rule) return 'PASS';
  if (value !== null) {
    if (rule.min !== null && value < rule.min) return 'FAIL';
    if (rule.max !== null && value > rule.max) return 'FAIL';
  }
  if (textValue !== null && rule.allowed && rule.allowed.length > 0) {
    const v = textValue.toUpperCase();
    if (!rule.allowed.some((a) => a.trim().toUpperCase() === v)) return 'FAIL';
  }
  return 'PASS';
}

export interface BuildDispatchDecisionInput {
  testMode: DispatchTestMode;
  portions: DispatchPortionInput[];
  labReportCaptureId: string | null;
  personDecision: PersonDecision;
  remarks?: string | null;
  deciderCanApprove: boolean;
}

/** Evaluates every portion against the policy and runs the shared decision rule once for the vehicle. */
export function buildDispatchDecision(
  p: DispatchPolicySnapshot,
  i: BuildDispatchDecisionInput
): { decision: DecisionResult; details: DispatchDecisionDetails; totals: DispatchTotalsDetail } {
  const ruleFailures: string[] = [];
  const missingCompulsory: string[] = [];
  const missingPhotos: string[] = [];
  const warnings: string[] = [];
  const multi = i.portions.length > 1;
  const label = (n: number, name: string) => (multi ? `Portion ${n}: ${name}` : name);
  const portionTests = p.tests.filter((t) => !t.isLabReport && t.testMode !== 'OFF');

  const portions: DispatchPortionDetails[] = i.portions.map((portion) => {
    let lr: number | null = null;
    let fat: number | null = null;
    const rows: DispatchPortionDetails['tests'] = [];
    for (const t of portionTests) {
      const input = portion.tests.find((x) => x.labTestId === t.labTestId);
      const value = t.resultType === 'NUMERIC' ? cleanNumber(input?.value) : null;
      const text = t.resultType === 'NUMERIC' ? '' : (input?.textValue ?? '').trim();
      const textValue = text ? text : null;
      const tested = value !== null || textValue !== null;
      const photoCaptureId = portion.photos.find((x) => x.labTestId === t.labTestId)?.captureId ?? null;
      if (t.isLr && value !== null) lr = value;
      if (t.isFat && value !== null) fat = value;

      let outcome: DispatchTestOutcome = 'NOT_TESTED';
      if (!tested) {
        if (t.testMode === 'COMPULSORY') missingCompulsory.push(label(portion.portionNumber, t.testName));
      } else {
        if (outcomeOf(t, value, textValue) === 'FAIL') {
          if (t.ruleMode === 'APPLY') {
            outcome = 'FAIL';
            if (!ruleFailures.includes(t.testCode)) ruleFailures.push(t.testCode);
          } else {
            outcome = 'WARN';
            warnings.push(`${label(portion.portionNumber, t.testName)} is outside the allowed range.`);
          }
        } else {
          outcome = 'PASS';
        }
        if (t.photoMode === 'REQUIRED' && !photoCaptureId) missingPhotos.push(label(portion.portionNumber, t.testName));
      }
      rows.push({
        labTestId: t.labTestId,
        testCode: t.testCode,
        testName: t.testName,
        unit: t.unit,
        value,
        textValue,
        testMode: t.testMode,
        ruleMode: t.ruleMode,
        photoMode: t.photoMode,
        outcome,
        photoCaptureId,
      });
    }
    return {
      portionNumber: portion.portionNumber,
      sealNumber: portion.sealNumber,
      quantityValue: portion.quantityValue,
      quantityUnit: portion.quantityUnit,
      grossLiters: null,
      lr,
      fat,
      tests: rows,
      photos: portion.photos,
    };
  });

  const reportRequired = labReportRequired(p);
  const labReportCaptureId = i.labReportCaptureId?.trim() || null;
  if (reportRequired && !labReportCaptureId) missingPhotos.push(LAB_REPORT_TEST_NAME);

  const totals = computeDispatchTotals(portions);
  portions.forEach((x, idx) => {
    const g = totals.portionGrossLiters[idx];
    x.grossLiters = g === null ? null : round(g, 2);
  });

  const decision = evaluateDecision({
    ruleFailures,
    missingCompulsory,
    missingPhotos,
    personDecision: i.personDecision,
    remarks: i.remarks,
    deciderCanApprove: i.deciderCanApprove,
  });

  const { grossLiters, weightedLr, weightedFat, weightedTs13, weightedTs, complete } = totals;
  return {
    decision,
    totals,
    details: {
      point: p.point,
      policyVersion: p.version,
      testMode: i.testMode,
      portions,
      labReport: { required: reportRequired, captureId: labReportCaptureId },
      missingCompulsory,
      missingPhotos,
      ruleFailures,
      warnings,
      totals: { grossLiters, weightedLr, weightedFat, weightedTs13, weightedTs, complete },
    },
  };
}

// ---------------------------------------------------------------------------------------------
// ZMCC tank
// ---------------------------------------------------------------------------------------------

export function auditActorOf(ctx: ActingContext): AuditActor {
  return { userId: ctx.userId, actorRole: ctx.actorRole, performedAsRole: ctx.actingAs, isDelegated: ctx.isDelegated };
}

async function activeTankId(db: Db, zmccId: bigint): Promise<bigint> {
  const activeTanks = await db.zmccTank.findMany({ where: { zmcc_id: zmccId, is_active: true }, orderBy: { id: 'asc' } });
  if (activeTanks.length === 0) {
    throw new DispatchFlowError(400, 'ZMCC_TANK_CONFIGURATION_ERROR', 'No active ZMCC tank configured for this procurement source.');
  }
  if (activeTanks.length > 1) {
    throw new DispatchFlowError(400, 'ZMCC_TANK_CONFIGURATION_ERROR', 'Multiple active tanks exist for this ZMCC. Exactly one active tank is permitted.');
  }
  return activeTanks[0].id;
}

/** Physical litres left in the ZMCC's active tank, or null when it cannot be read. */
export async function zmccTankRemainingLiters(zmccId: bigint, tx?: Tx): Promise<number | null> {
  try {
    const tankId = await activeTankId(tx ?? prisma, zmccId);
    return round(await getTankPhysicalStock(tankId, tx), 2);
  } catch {
    return null;
  }
}

/** Idempotent ISSUE from the ZMCC tank for a dispatched vehicle (gross + @13TS litres). Returns litres left. */
export async function issueDispatchFromZmccTankTx(
  tx: Tx,
  i: { zmccId: bigint; visitId: bigint; visitNumber: string; vehicleNumber: string; grossLiters: number; at13tsLiters: number; at: Date; userId: bigint }
): Promise<number> {
  if (!(i.grossLiters > 0)) {
    throw new DispatchFlowError(400, 'INVALID_GROSS_LITERS', 'Gross litres must be more than zero for a ZMCC dispatch.');
  }
  if (!(i.at13tsLiters > 0)) {
    throw new DispatchFlowError(400, 'INVALID_COMMERCIAL_AT_13TS', 'LR and Fat are needed to work out @13TS litres for a ZMCC dispatch.');
  }
  const tankId = await activeTankId(tx, i.zmccId);
  const locked: Array<{ id: bigint; is_active: boolean }> = await tx.$queryRaw`
    SELECT id, is_active FROM zmcc_tank WHERE id = ${tankId} FOR UPDATE
  `;
  if (!locked || locked.length === 0) throw new DispatchFlowError(400, 'ZMCC_TANK_NOT_FOUND', 'Active ZMCC tank could not be found.');
  if (!locked[0].is_active) throw new DispatchFlowError(400, 'ZMCC_TANK_INACTIVE', 'Active ZMCC tank is inactive or unavailable.');

  const idempotencyKey = `ZMCC_TANK_ISSUE:DISPATCH:${i.visitId}`;
  const existing = await tx.zmccTankInventoryTransaction.findUnique({ where: { idempotency_key: idempotencyKey } });
  const stock = await getTankPhysicalStock(tankId, tx);
  if (!existing) {
    if (i.grossLiters > stock) {
      const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      throw new DispatchFlowError(
        400,
        'INSUFFICIENT_TANK_STOCK',
        `Not enough milk in the tank (${fmt(stock)} L available, ${fmt(i.grossLiters)} L needed).`
      );
    }
    await tx.zmccTankInventoryTransaction.create({
      data: {
        tank_id: tankId,
        zmcc_id: i.zmccId,
        transaction_type: 'ISSUE',
        quantity_liters: new Prisma.Decimal(i.grossLiters.toFixed(2)),
        at_13ts_liters: new Prisma.Decimal(i.at13tsLiters.toFixed(2)),
        dispatch_id: i.visitId,
        reference_type: 'DISPATCH',
        reference_id: i.visitId.toString(),
        idempotency_key: idempotencyKey,
        operational_timestamp: i.at,
        performed_by_user_id: i.userId,
        notes: `Whole-vehicle dispatch issue for visit ${i.visitNumber} (${i.vehicleNumber})`,
      },
    });
    return round(stock - i.grossLiters, 2);
  }
  return round(stock, 2);
}

// ---------------------------------------------------------------------------------------------
// Notification to the approver
// ---------------------------------------------------------------------------------------------

function approverDeepLink(role: DispatchApproverRole): string {
  return role === 'CONTRACTOR_MANAGER' ? '/contractor/manager' : '/mpd/zmcc-manager';
}

/** Tells the Zonal Manager / Contractor Manager of this source that a dispatch request is waiting. */
export async function notifyDispatchApproversTx(
  tx: Tx,
  i: { visitId: bigint; version: number; sourceId: bigint; approverRole: DispatchApproverRole; dispatchNumber: string; vehicleNumber: string; sourceName: string }
): Promise<number> {
  const users = await tx.user.findMany({
    where: { is_active: true, role: i.approverRole, procurement_source_id: i.sourceId },
    select: { id: true },
  });
  for (const u of users) {
    const dedupeKey = `${DISPATCH_APPROVAL_EVENT_KEY}:${i.visitId}:${i.version}:${u.id}`;
    const n = await tx.notification.upsert({
      where: { dedupe_key: dedupeKey },
      create: {
        recipient_user_id: u.id,
        event_key: DISPATCH_APPROVAL_EVENT_KEY,
        priority: 'HIGH',
        title: 'Dispatch needs your decision',
        body: `${i.sourceName}: dispatch ${i.dispatchNumber} (vehicle ${i.vehicleNumber}) is waiting for OKAY or NO.`,
        deep_link: approverDeepLink(i.approverRole),
        source_type: 'VEHICLE_DISPATCH',
        source_id: i.visitId.toString(),
        dedupe_key: dedupeKey,
      },
      update: {},
    });
    await tx.notificationDelivery.upsert({
      where: { notification_id_channel: { notification_id: n.id, channel: 'IN_APP' } },
      create: { notification_id: n.id, channel: 'IN_APP' },
      update: {},
    });
  }
  return users.length;
}

// ---------------------------------------------------------------------------------------------
// Approver queue
// ---------------------------------------------------------------------------------------------

export interface DispatchApprovalItem {
  id: string;
  dispatchNumber: string;
  sourceId: string;
  sourceName: string;
  sourceType: 'ZMCC' | 'CONTRACTOR';
  vehicleNumber: string;
  submittedBy: string;
  submittedById: string;
  submittedAt: string;
  performedAsRole: string | null;
  isDelegated: boolean;
  testMode: DispatchTestMode;
  totals: { grossLiters: number; weightedLr: number; weightedFat: number; weightedTs13: number };
  portions: Array<{
    portionNumber: number;
    sealNumber: string;
    quantityLiters: number;
    lr: number | null;
    fat: number | null;
    tests: Array<{ testCode: string; testName: string; value: number | null; outcome: DispatchTestOutcome }>;
    photos: Array<{ captureId: string; received: boolean }>;
  }>;
  labReportPhoto: { captureId: string; received: boolean } | null;
  personDecision: PersonDecision;
  decisionRemarks: string | null;
  exceptionReasons: string[];
  warnings: string[];
  status: string;
  approvalStatus: string;
  approverRole: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  decidedAsRole: string | null;
  decisionRemarksByApprover: string | null;
  version: number;
}

const approvalInclude = {
  procurement_source: { select: { id: true, name: true, source_type: true } },
  creator: { select: { id: true, full_name: true, username: true } },
  approval_requester: { select: { id: true, full_name: true, username: true } },
  approval_decider: { select: { id: true, full_name: true, username: true } },
  portions: { select: { id: true, portion_number: true, seal_number: true }, orderBy: { portion_number: 'asc' } },
} satisfies Prisma.VehicleVisitInclude;

type ApprovalRow = Prisma.VehicleVisitGetPayload<{ include: typeof approvalInclude }>;

const nameOf = (u: { full_name: string | null; username: string } | null | undefined) => (u ? u.full_name || u.username : '');

function asStringList(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((r): r is string => typeof r === 'string') : [];
}

function detailsOf(row: { dispatch_decision_details: Prisma.JsonValue }): DispatchDecisionDetails | null {
  const d = row.dispatch_decision_details;
  return d && typeof d === 'object' && !Array.isArray(d) ? (d as unknown as DispatchDecisionDetails) : null;
}

function captureIdsOf(rows: ApprovalRow[]): string[] {
  const ids = new Set<string>();
  for (const r of rows) {
    const d = detailsOf(r);
    if (!d) continue;
    for (const p of d.portions ?? []) for (const ph of p.photos ?? []) ids.add(ph.captureId);
    if (d.labReport?.captureId) ids.add(d.labReport.captureId);
  }
  return [...ids];
}

async function receivedCaptureIds(db: Db, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await db.capturedPhoto.findMany({ where: { capture_id: { in: ids } }, select: { capture_id: true } });
  return new Set(rows.map((r) => r.capture_id));
}

function submitterIdOf(row: { dispatch_submitted_by: bigint | null; approval_requested_by: bigint | null; created_by: bigint | null }): bigint | null {
  return row.dispatch_submitted_by ?? row.approval_requested_by ?? row.created_by;
}

function toApprovalItem(row: ApprovalRow, received: Set<string>): DispatchApprovalItem {
  const d = detailsOf(row);
  const sourceType = (row.procurement_source?.source_type || '').toUpperCase() === 'CONTRACTOR' ? 'CONTRACTOR' : 'ZMCC';
  const submitter = row.approval_requester ?? row.creator;
  const submittedAt = row.dispatch_submitted_at ?? row.approval_requested_at ?? row.updated_at;
  const totals = d?.totals;
  const portionSeal = new Map(row.portions.map((p) => [p.portion_number, p.seal_number]));
  return {
    id: row.id.toString(),
    dispatchNumber: row.reception_number || row.visit_number,
    sourceId: row.procurement_source_id?.toString() ?? '',
    sourceName: row.procurement_source?.name ?? 'Source unavailable',
    sourceType,
    vehicleNumber: row.vehicle_number,
    submittedBy: nameOf(submitter),
    submittedById: submitterIdOf(row)?.toString() ?? '',
    submittedAt: submittedAt.toISOString(),
    performedAsRole: row.dispatch_submitted_as_role ?? row.approval_requested_as_role ?? null,
    isDelegated: row.dispatch_submitted_is_delegated || row.approval_requested_is_delegated,
    testMode: row.test_mode === 'PORTION_WISE' ? 'PORTION_WISE' : 'COMPOSITE',
    totals: {
      grossLiters: totals?.grossLiters ?? Number(row.vehicle_dispatch_gross_liters ?? 0),
      weightedLr: totals?.weightedLr ?? Number(row.vehicle_dispatch_lr ?? 0),
      weightedFat: totals?.weightedFat ?? Number(row.vehicle_dispatch_fat ?? 0),
      weightedTs13: totals?.weightedTs13 ?? Number(row.vehicle_dispatch_at_13ts_liters ?? 0),
    },
    portions: (d?.portions ?? []).map((p) => ({
      portionNumber: p.portionNumber,
      sealNumber: portionSeal.get(p.portionNumber) ?? p.sealNumber,
      quantityLiters: p.grossLiters ?? (p.quantityUnit === 'LITER' ? p.quantityValue : 0),
      lr: p.lr,
      fat: p.fat,
      tests: p.tests.map((t) => ({ testCode: t.testCode, testName: t.testName, value: t.value, outcome: t.outcome })),
      photos: p.photos.map((ph) => ({ captureId: ph.captureId, received: received.has(ph.captureId) })),
    })),
    labReportPhoto: d?.labReport?.captureId ? { captureId: d.labReport.captureId, received: received.has(d.labReport.captureId) } : null,
    personDecision: row.dispatch_person_decision === 'REJECT' ? 'REJECT' : 'ACCEPT',
    decisionRemarks: row.dispatch_decision_remarks,
    exceptionReasons: asStringList(row.dispatch_exception_reasons),
    warnings: d?.warnings ?? [],
    status: row.current_status,
    approvalStatus: row.approval_status,
    approverRole: row.approver_role,
    decidedBy: row.approval_decider ? nameOf(row.approval_decider) : null,
    decidedAt: row.approval_decided_at ? row.approval_decided_at.toISOString() : null,
    decidedAsRole: row.approval_decided_as_role,
    decisionRemarksByApprover: row.approval_decision_remarks,
    version: row.dispatch_version,
  };
}

export async function listDispatchApprovals(
  ctx: ActingContext,
  q: { status?: 'PENDING' | 'DECIDED'; limit?: number }
): Promise<DispatchApprovalItem[]> {
  const decided = q.status === 'DECIDED';
  const limit = Math.min(Math.max(q.limit ?? 100, 1), 200);
  const where: Prisma.VehicleVisitWhereInput = decided
    ? { approval_requested_by: { not: null }, approval_decided_by: { not: null }, approval_status: { in: ['APPROVED', 'RETURNED'] } }
    : { approval_status: 'PENDING', current_status: DISPATCH_STATUS.PENDING_APPROVAL };
  if (ctx.scope.kind === 'SOURCE') where.procurement_source_id = ctx.scope.sourceId;
  else if (ctx.scope.kind !== 'SYSTEM') return [];

  const rows = await prisma.vehicleVisit.findMany({
    where,
    include: approvalInclude,
    orderBy: decided ? { approval_decided_at: 'desc' } : { approval_requested_at: 'asc' },
    take: limit,
  });
  const received = await receivedCaptureIds(prisma, captureIdsOf(rows));
  return rows.map((r) => toApprovalItem(r, received));
}

export async function loadDispatchApprovalItem(db: Db, id: bigint): Promise<DispatchApprovalItem | null> {
  const row = await db.vehicleVisit.findUnique({ where: { id }, include: approvalInclude });
  if (!row) return null;
  const received = await receivedCaptureIds(db, captureIdsOf([row]));
  return toApprovalItem(row, received);
}

interface ServiceResult<T> {
  status: number;
  data?: T;
  error?: string;
  code?: string;
}

/**
 * Zonal Manager (ZMCC) / Contractor Manager (contractor) — or a superior in scope — answers a dispatch request.
 * OKAY: the person's decision stands (ACCEPT -> DISPATCHED + tank issue for ZMCC; REJECT -> DISPATCH_REJECTED).
 * NO: the form is reopened for the operator to edit and resubmit (REOPENED).
 */
export async function decideDispatchApproval(
  user: User,
  requestedAs: string | null,
  id: bigint,
  i: { verdict: 'OKAY' | 'NO'; remarks?: string | null; version: number }
): Promise<ServiceResult<{ item: DispatchApprovalItem; tankRemainingLiters: number | null }>> {
  if (user.role === 'DATA_EXECUTIVE') return { status: 403, error: 'You cannot decide this.', code: 'FORBIDDEN' };
  if (i.verdict !== 'OKAY' && i.verdict !== 'NO') return { status: 400, error: 'Choose OKAY or NO.' };
  if (!Number.isInteger(i.version)) return { status: 400, error: 'Version is required.' };
  const remarks = (i.remarks ?? '').trim();
  if (i.verdict === 'NO' && remarks.length < 3) return { status: 400, error: 'Please write a reason for saying NO.', code: 'REMARKS_REQUIRED' };

  const head = await prisma.vehicleVisit.findUnique({
    where: { id },
    select: { procurement_source_id: true, procurement_source: { select: { source_type: true } } },
  });
  if (!head || !head.procurement_source_id) return { status: 404, error: 'Dispatch not found.' };
  const sourceType = (head.procurement_source?.source_type || '').toUpperCase() === 'CONTRACTOR' ? 'CONTRACTOR' : 'ZMCC';
  const approverRole = dispatchApproverRoleFor(sourceType);

  const acting = resolveActingContext(user, [approverRole], {
    requestedAs,
    resource: { sourceId: head.procurement_source_id, sourceType },
  });
  if (!acting.ok) {
    return acting.code === 'FORBIDDEN'
      ? { status: 403, error: 'You cannot decide this.', code: 'FORBIDDEN' }
      : { status: 403, error: 'This record is outside your area.', code: acting.code };
  }
  const ctx = acting.ctx;
  if (!canDecideDispatch(ctx.actorRole, sourceType)) return { status: 403, error: 'You cannot decide this.', code: 'FORBIDDEN' };
  const scope = assertResourceInScope(ctx, { sourceId: head.procurement_source_id, sourceType });
  if (!scope.ok) return { status: 403, error: 'This record is outside your area.', code: scope.code };

  try {
    return await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM vehicle_visit WHERE id = ${id} FOR UPDATE`;
      const row = await tx.vehicleVisit.findUnique({ where: { id } });
      if (!row) return { status: 404, error: 'Dispatch not found.' };
      if (row.dispatch_version !== i.version || row.approval_status !== 'PENDING' || row.current_status !== DISPATCH_STATUS.PENDING_APPROVAL) {
        return { status: 409, error: 'Someone already decided this. Reload.', code: 'VERSION_MISMATCH' };
      }
      const submitter = submitterIdOf(row);
      if (submitter !== null && submitter === ctx.userId) {
        return { status: 403, error: 'You cannot decide your own dispatch.', code: 'OWN_SUBMISSION' };
      }

      const now = new Date();
      const person: PersonDecision = row.dispatch_person_decision === 'REJECT' ? 'REJECT' : 'ACCEPT';
      let nextStatus: string;
      let tankRemainingLiters: number | null = null;
      if (i.verdict === 'NO') {
        nextStatus = DISPATCH_STATUS.REOPENED;
      } else if (person === 'ACCEPT') {
        nextStatus = DISPATCH_STATUS.DISPATCHED;
        if (sourceType === 'ZMCC') {
          tankRemainingLiters = await issueDispatchFromZmccTankTx(tx, {
            zmccId: head.procurement_source_id!,
            visitId: row.id,
            visitNumber: row.visit_number,
            vehicleNumber: row.vehicle_number,
            grossLiters: Number(row.vehicle_dispatch_gross_liters ?? 0),
            at13tsLiters: Number(row.vehicle_dispatch_at_13ts_liters ?? 0),
            at: now,
            userId: ctx.userId,
          });
        }
      } else {
        nextStatus = DISPATCH_STATUS.REJECTED;
      }
      if (tankRemainingLiters === null && sourceType === 'ZMCC') {
        tankRemainingLiters = await zmccTankRemainingLiters(head.procurement_source_id!, tx);
      }

      const approvalStatus = i.verdict === 'OKAY' ? 'APPROVED' : 'RETURNED';
      await tx.vehicleVisit.update({
        where: { id },
        data: {
          current_status: nextStatus,
          approval_status: approvalStatus,
          approval_decided_by: ctx.userId,
          ...asRoleFields(ctx, 'approval_decided'),
          approval_decided_at: now,
          approval_decision_remarks: remarks || null,
          dispatch_version: { increment: 1 },
        },
      });
      await tx.visitPortion.updateMany({ where: { visit_id: id }, data: { current_status: nextStatus } });

      await writeAuditLog(tx, {
        tableName: 'vehicle_visit',
        recordId: id,
        action: i.verdict === 'OKAY' ? 'DISPATCH_REQUEST_APPROVED' : 'DISPATCH_REQUEST_RETURNED',
        oldValues: { current_status: row.current_status, approval_status: row.approval_status, version: row.dispatch_version },
        newValues: {
          verdict: i.verdict,
          current_status: nextStatus,
          approval_status: approvalStatus,
          person_decision: person,
          approver_role: approverRole,
          remarks: remarks || null,
          tank_remaining_liters: tankRemainingLiters,
        },
        actor: auditActorOf(ctx),
      });

      const item = await loadDispatchApprovalItem(tx, id);
      return { status: 200, data: { item: item!, tankRemainingLiters } };
    });
  } catch (err) {
    if (err instanceof DispatchFlowError) return { status: err.status, error: err.message, code: err.code };
    throw err;
  }
}

