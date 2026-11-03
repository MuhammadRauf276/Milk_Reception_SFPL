// Stage 2 (ZMCC lab) portions: policy loader, portion view, vehicle roll-up / auto-close, and the Zonal Manager exception review.
import type { Prisma } from '@prisma/client';
import { prisma } from '@core/db';
import { assertResourceInScope, asRoleFields } from '@/backend/core/acting-context';
import { writeAuditLog, type AuditActor } from '@/backend/core/audit';
import { isLr, isFat } from '@/lib/lab-test-roles';
import { resolveStageCells, getEffectivePolicy, type PolicyDb } from '@/backend/services/testPointPolicyService';
import { QualityRuleService } from '@/backend/services/qualityRuleService';
import { recordRejectedMilkForDisposition } from '@/backend/services/rejectedMilkDispositionService';
import {
  summarizePortions,
  type LabPoint,
  type LabPolicySnapshot,
  type LabPolicyTest,
  type LabPortionDecisionDetails,
  type LabPortionView,
} from '@/backend/services/zmcc/labPortionDecision';
import type { ActingContext } from '@/types/acting';
import type { ExceptionReason, FinalDecision, PersonDecision, ReviewStatus } from '@/types/stage1-decision';

interface ServiceResult<T> {
  status: number;
  data?: T;
  error?: string;
}

export const LAB_PORTION_PHOTO_ENTITY = 'zmcc_lab_portion';


type Tx = Prisma.TransactionClient;
type Db = Tx | typeof prisma;

export function auditActorOf(ctx: ActingContext): AuditActor {
  return { userId: ctx.userId, actorRole: ctx.actorRole, performedAsRole: ctx.actingAs, isDelegated: ctx.isDelegated };
}

/** MC = milk collection (MOT journey) milk; HC = direct supplier milk. */
export function labPointForArrival(arrivalType: string): LabPoint {
  return arrivalType === 'MOT' ? 'ZMCC_LAB_MC' : 'ZMCC_LAB_HC';
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

/** Effective test policy for a ZMCC lab point: matrix cells (not OFF) + active RELEASE rules + lab test metadata. */
export async function loadLabPolicy(point: LabPoint, at: Date = new Date(), db: Db = prisma): Promise<LabPolicySnapshot> {
  const policy = await getEffectivePolicy(point, at, db as unknown as PolicyDb);
  const assignedTestingPoint: string = point;

  const stageAssignments = await db.milkTestPolicyAssignment.findMany({
      where: { testing_point: assignedTestingPoint },
      select: { lab_test_id: true, is_active: true, is_required: true, is_photo_required: true },
    });

  const assignmentMap = new Map(stageAssignments.map((a) => [a.lab_test_id.toString(), a]));

  // One rule for every stage: the saved Master Matrix row decides; an assignment only covers cells the matrix never saved.
  const cells = resolveStageCells(policy.cells, assignmentMap);

  const ids = cells.map((c) => BigInt(c.labTestId));
  const [labTests, rules] = await Promise.all([
    ids.length > 0
      ? db.labTest.findMany({
          where: { id: { in: ids } },
          select: { id: true, resultType: true, resultOptions: true, unit: true, displayOrder: true },
        })
      : Promise.resolve([]),
    QualityRuleService.resolveActiveRulesForTestingPoint(point, at, db),
  ]);
  const meta = new Map(labTests.map((t) => [String(t.id), t]));

  const tests: LabPolicyTest[] = cells.map((c) => {
    const lt = meta.get(c.labTestId);
    const r = rules.get(c.labTestId);

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
      r && !r.isConfigurationError
        ? {
            min: r.min_value !== null ? Number(r.min_value) : null,
            max: r.max_value !== null ? Number(r.max_value) : null,
            allowed,
            warningTrigger: r.warning_trigger ?? null,
            decisionConsequence: r.decision_consequence ?? null,
            ruleCategory: r.rule_category ?? 'RELEASE',
            acceptableOption: r.acceptable_option ?? null,
          }
        : allowed
        ? { min: null, max: null, allowed, warningTrigger: null, decisionConsequence: null, ruleCategory: 'RELEASE', acceptableOption: null }
        : null;

    return {
      ...c,
      resultType: lt?.resultType ?? 'NUMERIC',
      unit: lt?.unit ?? null,
      isLr: isLr(c),
      isFat: isFat(c),
      options: optionValues(lt?.resultOptions),
      resultOptions: lt?.resultOptions as any,
      rule,
    };
  });
  tests.sort((a, b) => (meta.get(a.labTestId)?.displayOrder ?? 0) - (meta.get(b.labTestId)?.displayOrder ?? 0));

  return { point, version: policy.version, fetchedAt: new Date().toISOString(), tests };
}

export type PortionRow = Prisma.ZmccLabPortionGetPayload<object>;

function num(v: Prisma.Decimal | null | undefined): number | null {
  return v === null || v === undefined ? null : Number(v);
}

function asReasons(raw: unknown): ExceptionReason[] {
  return Array.isArray(raw) ? (raw.filter((r) => typeof r === 'string') as ExceptionReason[]) : [];
}

export function toPortionView(row: PortionRow, photos: Array<{ capture_id: string; lab_test_id: bigint | null }> = []): LabPortionView {
  return {
    id: row.id.toString(),
    sessionId: row.lab_session_id.toString(),
    portionNumber: row.portion_number,
    status: row.status,
    quantityValue: num(row.quantity_value),
    quantityUnit: row.quantity_unit ?? null,
    lr: num(row.lr),
    fat: num(row.fat),
    grossLiters: num(row.gross_liters),
    at13tsLiters: num(row.at_13ts_liters),
    systemOutcome: row.system_outcome === 'PASS' || row.system_outcome === 'FAIL' ? row.system_outcome : null,
    personDecision: row.person_decision === 'ACCEPT' || row.person_decision === 'REJECT' ? row.person_decision : null,
    decisionRemarks: row.decision_remarks,
    exceptionReasons: asReasons(row.exception_reasons),
    reviewStatus: row.review_status as ReviewStatus,
    finalDecision: row.final_decision as FinalDecision,
    details: (row.decision_details as unknown as LabPortionDecisionDetails | null) ?? null,
    photos: photos.map((p) => ({ captureId: p.capture_id, labTestId: p.lab_test_id?.toString() ?? null })),
    createdByUserId: row.created_by_user_id?.toString() ?? null,
    performedAsRole: row.performed_as_role,
    isDelegated: row.is_delegated,
    decidedAt: row.decided_at ? row.decided_at.toISOString() : null,
    reviewedAt: row.reviewed_at ? row.reviewed_at.toISOString() : null,
    reviewRemarks: row.review_remarks,
    reviewedAsRole: row.reviewed_as_role,
    version: row.version,
  };
}

/** Photos saved for each portion (live camera uploads), keyed by portion id. */
export async function loadPortionPhotos(db: Db, ids: bigint[]) {
  const byId = new Map<string, Array<{ capture_id: string; lab_test_id: bigint | null }>>();
  if (ids.length === 0) return byId;
  const rows = await db.capturedPhoto.findMany({
    where: { entity_type: LAB_PORTION_PHOTO_ENTITY, entity_id: { in: ids } },
    select: { capture_id: true, lab_test_id: true, entity_id: true },
    orderBy: { server_received_at: 'asc' },
  });
  for (const r of rows) {
    const key = r.entity_id.toString();
    const list = byId.get(key) ?? [];
    // Latest photo per test wins (a retake replaces the earlier one).
    const at = list.findIndex((x) => x.lab_test_id === r.lab_test_id && r.lab_test_id !== null);
    if (at >= 0) list.splice(at, 1);
    list.push({ capture_id: r.capture_id, lab_test_id: r.lab_test_id });
    byId.set(key, list);
  }
  return byId;
}

export interface LabSessionRollUp {
  allDecided: boolean;
  allRejected: boolean;
  accepted: number;
  rejected: number;
  pending: number;
  sessionStatus: string;
  journeyClosed: boolean;
}

/**
 * After a portion decision: when every portion has a final decision, the lab session is finished.
 * All portions rejected -> the vehicle is rejected and the MOT journey is closed automatically.
 */
export async function rollUpLabSessionTx(tx: Tx, sessionId: bigint, ctx: ActingContext): Promise<LabSessionRollUp> {
  await tx.$queryRaw`SELECT id FROM zmcc_lab_session WHERE id = ${sessionId} FOR UPDATE`;
  const session = await tx.zmccLabSession.findUniqueOrThrow({
    where: { id: sessionId },
    include: { portions: true, mot_arrival: { select: { id: true, journey_id: true } } },
  });
  const sum = summarizePortions(session.portions.map((p) => ({ finalDecision: p.final_decision })));
  const base: LabSessionRollUp = { ...sum, sessionStatus: session.status, journeyClosed: !!session.journey_closed_at };
  if (!sum.allDecided || session.status === 'COMPLETED') return base;

  const now = new Date();
  const finalDecision = sum.allRejected ? 'REJECTED' : 'ACCEPTED';
  const accepted = session.portions.filter((p) => p.final_decision === 'ACCEPTED');
  const sumOf = (pick: (p: PortionRow) => Prisma.Decimal | null) =>
    accepted.length > 0 && accepted.every((p) => pick(p) !== null)
      ? accepted.reduce((s, p) => s + Number(pick(p)), 0)
      : null;
  const gross = sumOf((p) => p.gross_liters);
  const at13 = sumOf((p) => p.at_13ts_liters);

  await tx.zmccLabSession.update({
    where: { id: sessionId },
    data: {
      status: 'COMPLETED',
      completed_by_user_id: ctx.userId,
      completed_at: now,
      ...asRoleFields(ctx, 'completed'),
      decision: finalDecision,
      final_decision: finalDecision,
      final_decided_by_user_id: ctx.userId,
      final_decided_at: now,
      ...asRoleFields(ctx, 'final_decided'),
      final_decision_reason: sum.allRejected
        ? 'All portions rejected.'
        : `${sum.accepted} of ${session.portions.length} portion(s) accepted.`,
      system_quality_outcome: session.portions.every((p) => p.system_outcome === 'PASS') ? 'PASS' : 'FAIL',
      ...(gross !== null ? { gross_liters: gross.toFixed(2) } : {}),
      ...(at13 !== null ? { at_13ts_liters: at13.toFixed(2) } : {}),
      ...(sum.allRejected ? { journey_closed_at: now, closed_reason: 'ALL_PORTIONS_REJECTED' } : {}),
    },
  });

  await writeAuditLog(tx, {
    tableName: 'zmcc_lab_session',
    recordId: sessionId,
    action: sum.allRejected ? 'ZMCC_LAB_VEHICLE_REJECTED' : 'ZMCC_LAB_PORTIONS_DECIDED',
    oldValues: { status: session.status, final_decision: session.final_decision },
    newValues: {
      status: 'COMPLETED',
      final_decision: finalDecision,
      test_mode: session.test_mode,
      portions: session.portions.length,
      accepted: sum.accepted,
      rejected: sum.rejected,
      gross_liters_accepted: gross,
      at_13ts_liters_accepted: at13,
      closed_reason: sum.allRejected ? 'ALL_PORTIONS_REJECTED' : null,
    },
    actor: auditActorOf(ctx),
  });

  if (sum.allRejected && session.mot_arrival) {
    // Stage 2 ends with "journey closed": nothing left to weigh or put in the tank.
    await writeAuditLog(tx, {
      tableName: 'mot_journey',
      recordId: session.mot_arrival.journey_id,
      action: 'MOT_JOURNEY_CLOSED',
      oldValues: null,
      newValues: { reason: 'ALL_PORTIONS_REJECTED', lab_session_id: sessionId.toString(), closed_at: now.toISOString() },
      actor: auditActorOf(ctx),
    });
  }

  return { ...sum, sessionStatus: 'COMPLETED', journeyClosed: sum.allRejected || !!session.journey_closed_at };
}

// ---------------------------------------------------------------------------------------------
// Zonal Manager queue
// ---------------------------------------------------------------------------------------------

export interface LabPortionExceptionItem extends LabPortionView {
  zmccId: string;
  zmccName: string;
  arrivalType: string;
  point: LabPoint;
  testMode: string;
  portionCount: number;
  vehicleNumber: string | null;
  token: string | null;
  sourceName: string | null;
  submittedByName: string | null;
}

const queueInclude = {
  creator: { select: { full_name: true, username: true } },
  lab_session: {
    select: {
      zmcc_id: true,
      arrival_type: true,
      test_mode: true,
      zmcc: { select: { name: true } },
      _count: { select: { portions: true } },
      mot_arrival: {
        select: {
          zmcc_token: true,
          journey: { select: { journey_number: true, mot_vehicle: { select: { vehicle_number: true } }, route: { select: { name: true } } } },
        },
      },
      local_supplier_arrival: { select: { zmcc_token: true, vehicle_number: true, local_supplier: { select: { name: true } } } },
    },
  },
} satisfies Prisma.ZmccLabPortionInclude;

type QueueRow = Prisma.ZmccLabPortionGetPayload<{ include: typeof queueInclude }>;

function toQueueItem(row: QueueRow, photos: Array<{ capture_id: string; lab_test_id: bigint | null }>): LabPortionExceptionItem {
  const s = row.lab_session;
  const mot = s.mot_arrival;
  const ls = s.local_supplier_arrival;
  return {
    ...toPortionView(row, photos),
    zmccId: s.zmcc_id.toString(),
    zmccName: s.zmcc.name,
    arrivalType: s.arrival_type,
    point: labPointForArrival(s.arrival_type),
    testMode: s.test_mode,
    portionCount: s._count.portions,
    vehicleNumber: mot?.journey?.mot_vehicle?.vehicle_number ?? ls?.vehicle_number ?? null,
    token: mot?.zmcc_token ?? ls?.zmcc_token ?? null,
    sourceName: mot
      ? [mot.journey?.journey_number, mot.journey?.route?.name].filter(Boolean).join(' · ') || null
      : ls?.local_supplier?.name ?? null,
    submittedByName: row.creator ? row.creator.full_name || row.creator.username : null,
  };
}

export async function listLabPortionExceptions(
  ctx: ActingContext,
  q: { status?: 'PENDING' | 'DECIDED'; limit?: number }
): Promise<LabPortionExceptionItem[]> {
  const decided = q.status === 'DECIDED';
  const limit = Math.min(Math.max(q.limit ?? 100, 1), 200);
  const where: Prisma.ZmccLabPortionWhereInput = decided
    ? { review_status: { in: ['APPROVED', 'REJECTED'] }, reviewed_by_user_id: { not: null } }
    : { review_status: 'PENDING' };
  if (ctx.scope.kind === 'SOURCE') where.lab_session = { zmcc_id: ctx.scope.sourceId };
  else if (ctx.scope.kind !== 'SYSTEM') return [];

  const rows = await prisma.zmccLabPortion.findMany({
    where,
    include: queueInclude,
    orderBy: decided ? { reviewed_at: 'desc' } : { decided_at: 'asc' },
    take: limit,
  });
  const photos = await loadPortionPhotos(prisma, rows.map((r) => r.id));
  return rows.map((r) => toQueueItem(r, photos.get(r.id.toString()) ?? []));
}

/** Zonal Manager (or above) says OKAY (agree with the person) or NO (the opposite) on a portion waiting for review. */
export async function reviewPortionException(
  ctx: ActingContext,
  id: bigint,
  i: {
    verdict: 'OKAY' | 'NO';
    remarks?: string | null;
    version: number;
  }
): Promise<ServiceResult<{ item: LabPortionExceptionItem; rollUp: LabSessionRollUp }>> {
  if (i.verdict !== 'OKAY' && i.verdict !== 'NO') return { status: 400, error: 'Choose OKAY or NO.' };
  if (!Number.isInteger(i.version)) return { status: 400, error: 'Version is required.' };
  const remarks = (i.remarks ?? '').trim();
  if (i.verdict === 'NO' && remarks.length < 3) return { status: 400, error: 'Please write a reason for saying NO.' };

  const existing = await prisma.zmccLabPortion.findUnique({
    where: { id },
    select: { lab_session: { select: { zmcc_id: true } } },
  });
  if (!existing) return { status: 404, error: 'Portion not found.' };
  const scope = assertResourceInScope(ctx, { sourceId: existing.lab_session.zmcc_id, sourceType: 'ZMCC' });
  if (!scope.ok) return { status: 403, error: 'This record is outside your area.' };

  return prisma.$transaction(async (tx) => {
    const row = await tx.zmccLabPortion.findUnique({ where: { id } });
    if (!row) return { status: 404, error: 'Portion not found.' };
    if (row.version !== i.version || row.review_status !== 'PENDING') {
      return { status: 409, error: 'Someone already decided this. Reload.' };
    }
    if (row.created_by_user_id !== null && row.created_by_user_id === ctx.userId) {
      return { status: 403, error: 'You cannot decide your own test.' };
    }

    const person: PersonDecision = row.person_decision === 'REJECT' ? 'REJECT' : 'ACCEPT';
    const final: FinalDecision =
      i.verdict === 'OKAY' ? (person === 'ACCEPT' ? 'ACCEPTED' : 'REJECTED') : person === 'ACCEPT' ? 'REJECTED' : 'ACCEPTED';
    const reviewStatus: ReviewStatus = i.verdict === 'OKAY' ? 'APPROVED' : 'REJECTED';
    const now = new Date();

    const upd = await tx.zmccLabPortion.updateMany({
      where: { id, version: i.version, review_status: 'PENDING' },
      data: {
        ...asRoleFields(ctx, 'reviewed'),
        reviewed_by_user_id: ctx.userId,
        reviewed_at: now,
        review_remarks: remarks || null,
        review_status: reviewStatus,
        final_decision: final,
        status: final,
        version: { increment: 1 },
      },
    });
    if (upd.count !== 1) return { status: 409, error: 'Someone already decided this. Reload.' };

    await writeAuditLog(tx, {
      tableName: 'zmcc_lab_portion',
      recordId: id,
      action: 'ZMCC_LAB_PORTION_EXCEPTION_REVIEWED',
      oldValues: { review_status: row.review_status, final_decision: row.final_decision, status: row.status, version: row.version },
      newValues: {
        verdict: i.verdict,
        review_status: reviewStatus,
        final_decision: final,
        person_decision: person,
        review_remarks: remarks || null,
        lab_session_id: row.lab_session_id.toString(),
        portion_number: row.portion_number,
      },
      actor: auditActorOf(ctx),
    });

    if (final === 'REJECTED') {
      await recordRejectedMilkForDisposition(tx, {
        portionId: id,
        zmccId: existing.lab_session.zmcc_id,
        summary: `session #${row.lab_session_id} portion ${row.portion_number}`,
        actor: auditActorOf(ctx),
      });
    }
    const rollUp = await rollUpLabSessionTx(tx, row.lab_session_id, ctx);
    const fresh = await tx.zmccLabPortion.findUniqueOrThrow({ where: { id }, include: queueInclude });
    const photos = await loadPortionPhotos(tx, [id]);
    return { status: 200, data: { item: toQueueItem(fresh, photos.get(id.toString()) ?? []), rollUp } };
  });
}
