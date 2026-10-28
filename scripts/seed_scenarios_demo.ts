/**
 * ADDITIVE, idempotent real-life ZMCC scenario seed (DEVELOPMENT ONLY).
 *
 * Adds lab / weighing / tank / exit scenarios for ZMCC Hasilpur (and two at ZMCC Jhang) on top of whatever
 * is already in the database. Nothing is deleted. Every row it creates carries a "DEMO-SCN-" prefix in its
 * code, token or vehicle number (HC supplier names use the existing "DEMO - " prefix), so
 * scripts/reset_demo_operational_data.ts removes all of it. Running it twice skips scenarios that exist.
 *
 * Run:  ALLOW_DEMO_RESET=true npx tsx scripts/seed_scenarios_demo.ts
 *       (PowerShell:  $env:ALLOW_DEMO_RESET='true'; npx tsx scripts/seed_scenarios_demo.ts)
 *
 * Business rules mirrored from the services (not re-derived): tank receipts follow
 * zmccTankService.unloadSessionToTank (net-weight weighted LR/Fat/SNF/TS, gross litres = net kg / density,
 * @13TS litres from the portion TS, one stock transaction per accepted portion); weights follow the N+1 chain;
 * exit outcomes follow computeExitOutcome; HC milk source is set only on the tank receipt (and mirrored to the
 * arrival); MC milk takes its source from every shop collection; lab decisions follow evaluateDecision.
 */
import 'dotenv/config';
import { Prisma } from '@prisma/client';
import type { ProcurementSource, User, ZmccTank, ZmccLocalSupplier } from '@prisma/client';
import { prisma } from '../src/backend/core/db';
import { computeCanonicalMilkMetrics, MOT_CALCULATION_VERSION } from '../src/backend/utils/milkFormulas';
import {
  calculatePortionReceived,
  calculateTier1RouteLoss,
  computeAndStoreAreaLossTx,
  weightedAverageByNetWeight,
} from '../src/backend/services/lossCalculationService';
import { computeExitOutcome, getTankPhysicalStock } from '../src/backend/services/zmccTankService';
import { loadLabPolicy } from '../src/backend/services/zmcc/labPortionReviewService';
import {
  buildLabPortionDecision,
  type LabPolicySnapshot,
  type LabPolicyTest,
  type LabPortionDecisionDetails,
} from '../src/backend/services/zmcc/labPortionDecision';
import { evaluateDecision } from '../src/backend/services/decision/decisionRule';
import { createInitialMotJourneySummaryTx } from '../src/backend/services/motJourneySummaryService';
import { getPakistanCalendarDate } from '../src/backend/core/business-day';
import { parseStrictDateOnly } from '../src/lib/datetime-utils';
import type { ActingContext } from '../src/types/acting';

// ------------------------------------------------------------------------------------------------
// Types and small helpers
// ------------------------------------------------------------------------------------------------

type SourceRef = { id: bigint; erp_code: string; name: string };
type FailKind = 'LR' | 'FAT' | 'ACIDITY' | 'SOUR' | 'ADULTERATION' | 'TEMP';
type PortionState = 'DECIDED' | 'PENDING_REVIEW' | 'OKAY' | 'NO' | 'TESTING';

interface PortionSpec {
  qtyKg: number;
  lr: number;
  fat: number;
  person?: 'ACCEPT' | 'REJECT';
  /** Makes the system outcome FAIL (the listed tests are out of the allowed range). */
  fail?: FailKind[];
  remarks?: string;
  state?: PortionState;
  reviewRemarks?: string;
  /** MANUAL net entry for this accepted portion (instead of the weight chain). */
  manualNet?: { value: number; unit: 'KG' | 'LITER' };
}

interface Zctx {
  tag: 'HAS' | 'JHG';
  src: ProcurementSource;
  tank: ZmccTank;
  manager: User;
  lab: User;
  phe: User;
  sources: SourceRef[];
}

interface SessionOpts {
  kind: 'HC' | 'MOT';
  arrivalId: bigint;
  arrivalAt: Date;
  key: string;
  mode: 'COMPOSITE' | 'PORTION_WISE';
  portions: PortionSpec[];
  /** WEIGHT mode: w0..wN (N accepted portions). MANUAL mode when omitted and portions carry manualNet. */
  weights?: number[];
  unload?: { source?: SourceRef; onlyPortionNumbers?: number[] };
  /** HC gate exit (outcome computed). */
  hcExit?: { afterMin?: number; reasonCode?: string; remarks?: string };
  /** PHE requested "close without unloading" and (optionally) the manager approved. */
  closeRequest?: { reasonCode: string; remarks: string; approved: boolean };
}

const MIN = 60000;
const now = new Date();
const at = (base: Date, minutes: number) => new Date(base.getTime() + minutes * MIN);
const minsAgo = (m: number) => new Date(now.getTime() - m * MIN);
const daysAgoAt = (d: number, hhmm: string) =>
  new Date(`${getPakistanCalendarDate(new Date(now.getTime() - d * 86400000))}T${hhmm}:00+05:00`);
const dateOnlyOf = (d: Date): Date => {
  const v = parseStrictDateOnly(getPakistanCalendarDate(d));
  if (!v) throw new Error('Could not derive a Pakistan calendar date.');
  return v;
};
const round = (n: number, p: number) => Number(n.toFixed(p));
const json = (v: unknown) => v as Prisma.InputJsonValue;

const counters = { created: 0, skipped: 0 };
const summary: string[] = [];

const numFor = (s: string) => '9' + [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 99999999, 7).toString().padStart(8, '0');
function actingOf(user: User, role: string): ActingContext {
  return {
    userId: user.id,
    actorRole: role,
    actingAs: role,
    isDelegated: false,
    scope: { kind: 'SYSTEM' },
  } as unknown as ActingContext;
}

// ------------------------------------------------------------------------------------------------
// Lab test values (realistic values through the existing lab test codes / active ZMCC policy)
// ------------------------------------------------------------------------------------------------

function pickTestInput(t: LabPolicyTest, spec: PortionSpec): { value: number | null; textValue: string | null } {
  const label = `${t.testCode} ${t.testName}`.toUpperCase();
  const fails = new Set<FailKind>(spec.fail ?? []);
  if (t.resultType === 'NUMERIC') {
    if (t.isLr) return { value: spec.lr, textValue: null };
    if (t.isFat) return { value: spec.fat, textValue: null };
    if (/TEMP/.test(label)) return { value: fails.has('TEMP') ? 13.5 : 5.5, textValue: null };
    if (/ACID|TITRAT/.test(label)) {
      return { value: fails.has('ACIDITY') || fails.has('SOUR') ? 0.21 : 0.14, textValue: null };
    }
    if (/\bPH\b/.test(label)) return { value: fails.has('SOUR') ? 6.2 : 6.65, textValue: null };
    const r = t.rule;
    if (r && r.min !== null && r.max !== null) return { value: round((r.min + r.max) / 2, 2), textValue: null };
    if (r && r.min !== null) return { value: round(r.min + 1, 2), textValue: null };
    if (r && r.max !== null) return { value: round(Math.max(0, r.max - 1), 2), textValue: null };
    return { value: null, textValue: null };
  }
  const opts = t.options ?? [];
  const allowed = t.rule?.allowed && t.rule.allowed.length > 0 ? t.rule.allowed : null;
  const wantBad =
    (/BOIL|COB/.test(label) && (fails.has('SOUR') || fails.has('ACIDITY'))) ||
    (/ADULTER|NEUTRAL|STARCH|UREA|FORMALIN|ALKAL|SALT|SUGAR|SOAP|PEROX/.test(label) && fails.has('ADULTERATION'));
  const good =
    allowed?.[0] ?? opts.find((o) => /^(NEG|OK|PASS|NORMAL|ABSENT|CLEAN)/i.test(o)) ?? opts[0] ?? 'OK';
  if (wantBad) {
    const okSet = (allowed ?? [good]).map((a) => a.toUpperCase());
    const bad = opts.find((o) => !okSet.includes(o.toUpperCase()));
    if (bad) return { value: null, textValue: bad };
  }
  return { value: null, textValue: good };
}

function forceFail(details: LabPortionDecisionDetails, policy: LabPolicySnapshot, spec: PortionSpec) {
  const wantFat = (spec.fail ?? []).includes('FAT') && !(spec.fail ?? []).includes('LR');
  const pol = policy.tests.find((p) => (wantFat ? p.isFat : p.isLr));
  const row = pol ? details.tests.find((t) => t.labTestId === pol.labTestId) : undefined;
  if (row) {
    row.outcome = 'FAIL';
    return;
  }
  details.tests.push({
    labTestId: '0',
    testCode: wantFat ? 'LT-000026' : 'LT-000008',
    testName: wantFat ? 'Fat' : 'Lactometer Reading (LR)',
    unit: null,
    value: wantFat ? spec.fat : spec.lr,
    textValue: null,
    testMode: 'COMPULSORY',
    ruleMode: 'APPLY',
    photoMode: 'OFF',
    outcome: 'FAIL',
    photoCaptureId: null,
  });
}

function evaluatePortion(policy: LabPolicySnapshot, spec: PortionSpec) {
  const person = spec.person ?? 'ACCEPT';
  const inputs = policy.tests
    .filter((t) => t.testMode !== 'OFF')
    .map((t) => ({ labTestId: t.labTestId, ...pickTestInput(t, spec) }));
  const { details } = buildLabPortionDecision(policy, {
    tests: inputs,
    photos: [],
    personDecision: person,
    remarks: spec.remarks ?? '',
    deciderCanApprove: false,
  });
  const wantFail = (spec.fail?.length ?? 0) > 0;
  if (wantFail && !details.tests.some((t) => t.outcome === 'FAIL')) forceFail(details, policy, spec);
  if (details.lr === null) details.lr = spec.lr;
  if (details.fat === null) details.fat = spec.fat;
  // Photos are not seeded: the decision is evaluated as if the live photos were saved.
  const decision = evaluateDecision({
    ruleFailures: details.tests.filter((t) => t.outcome === 'FAIL').map((t) => t.testCode),
    missingCompulsory: [],
    missingPhotos: [],
    personDecision: person,
    remarks: spec.remarks ?? '',
    deciderCanApprove: false,
  });
  return { details, decision, person };
}

// ------------------------------------------------------------------------------------------------
// Session builder (lab session + portions + weighing + unload + exit / close), HC and MC
// ------------------------------------------------------------------------------------------------

async function createLegacySessionResults(
  sessionId: bigint,
  portionId: bigint,
  point: 'ZMCC_LAB_HC' | 'ZMCC_LAB_MC',
  details: LabPortionDecisionDetails,
  recordedAt: Date
) {
  const rows = details.tests.filter((t) => t.labTestId !== '0');
  if (rows.length === 0) return;
  const labTests = await prisma.labTest.findMany({ where: { id: { in: rows.map((r) => BigInt(r.labTestId)) } } });
  const byId = new Map(labTests.map((l) => [String(l.id), l]));
  let order = 1;
  for (const r of rows) {
    const lt = byId.get(r.labTestId);
    if (!lt) continue;
    const rule = await prisma.labTestRule.findFirst({
      where: { lab_test_id: lt.id, testing_point: point, is_active: true },
    });
    const failed = r.outcome === 'FAIL';
    await prisma.zmccLabResult.create({
      data: {
        session_id: sessionId,
        portion_id: portionId,
        test_id: lt.id,
        test_code_snapshot: lt.testCode,
        test_name_snapshot: lt.testName,
        result_type_snapshot: lt.resultType,
        unit_snapshot: lt.unit,
        is_required_snapshot: true,
        display_order_snapshot: order++,
        numeric_value: r.value,
        text_value: r.textValue,
        applied_rule_id: rule?.id ?? null,
        applied_rule_version: rule?.version ?? null,
        evaluation_status: failed ? 'OUT_OF_SPEC' : 'PASS',
        is_passed: !failed,
        recorded_at: recordedAt,
      },
    });
  }
}

/** Mirrors zmccTankService.unloadSessionToTank (one receipt, one stock transaction per accepted portion). */
async function performUnload(
  ctx: Zctx,
  sessionId: bigint,
  o: { at: Date; source: SourceRef | null; only?: number[] }
) {
  const actor = actingOf(ctx.phe, ctx.phe.role);
  await prisma.$transaction(
    async (tx) => {
      const session = await tx.zmccLabSession.findUniqueOrThrow({
        where: { id: sessionId },
        include: { portions: { orderBy: { portion_number: 'asc' } } },
      });
      const accepted = session.portions.filter(
        (p) =>
          p.final_decision === 'ACCEPTED' &&
          p.net_weight_kg !== null &&
          (!o.only || o.only.includes(p.portion_number))
      );
      const rows = accepted.map((p) => {
        const net = Number(p.net_weight_kg);
        const m = calculatePortionReceived({
          netWeightKg: net,
          density: p.density !== null ? Number(p.density) : null,
          lr: p.lr !== null ? Number(p.lr) : null,
          ts: Number(p.ts ?? 0),
        });
        return {
          portion: p,
          net,
          gross: m.grossLiters,
          at13: m.at13tsLiters,
          density: m.density,
          lr: Number(p.lr ?? 0),
          fat: Number(p.fat ?? 0),
          snf: Number(p.snf ?? 0),
          ts: Number(p.ts ?? 0),
        };
      });
      const totalGross = Number(rows.reduce((a, r) => a + r.gross, 0).toFixed(2));

      // Capacity: keep demo receipts inside the tank (raise the demo capacity if the stock would not fit).
      const stock = await getTankPhysicalStock(ctx.tank.id, tx);
      const capacity = Number(ctx.tank.capacity_liters);
      if (stock + totalGross > capacity) {
        const newCapacity = Math.ceil((stock + totalGross) / 10000) * 10000 + 20000;
        ctx.tank = await tx.zmccTank.update({
          where: { id: ctx.tank.id },
          data: { capacity_liters: new Prisma.Decimal(newCapacity) },
        });
        console.log(`  (tank ${ctx.tank.tank_code} capacity raised to ${newCapacity} L for the demo)`);
      }

      const totalNet = rows.reduce((a, r) => a + r.net, 0);
      const wavg = (pick: (r: (typeof rows)[number]) => number) =>
        weightedAverageByNetWeight(rows.map((r) => ({ netWeightKg: r.net, value: pick(r) })));
      const receipt = await tx.zmccTankReceipt.create({
        data: {
          lab_session_id: sessionId,
          zmcc_id: ctx.src.id,
          tank_id: ctx.tank.id,
          arrival_type: session.arrival_type,
          quantity_unit: 'KG',
          calculation_version: MOT_CALCULATION_VERSION,
          received_at: o.at,
          received_by_user_id: ctx.phe.id,
          portion_id: rows.length === 1 ? rows[0].portion.id : null,
          quantity_value: new Prisma.Decimal(totalNet.toFixed(2)),
          density: new Prisma.Decimal(wavg((r) => r.density).toFixed(4)),
          gross_liters: new Prisma.Decimal(totalGross.toFixed(2)),
          lr: new Prisma.Decimal(wavg((r) => r.lr).toFixed(2)),
          fat: new Prisma.Decimal(wavg((r) => r.fat).toFixed(2)),
          snf: new Prisma.Decimal(wavg((r) => r.snf).toFixed(2)),
          ts: new Prisma.Decimal(wavg((r) => r.ts).toFixed(2)),
          at_13ts_liters: new Prisma.Decimal(rows.reduce((a, r) => a + r.at13, 0).toFixed(2)),
          ...(o.source
            ? {
                milk_source_id: o.source.id,
                milk_source_code_snapshot: o.source.erp_code,
                milk_source_name_snapshot: o.source.name,
              }
            : {}),
        },
      });
      for (const r of rows) {
        await tx.zmccTankInventoryTransaction.create({
          data: {
            tank_id: ctx.tank.id,
            zmcc_id: ctx.src.id,
            transaction_type: 'RECEIPT',
            quantity_liters: new Prisma.Decimal(r.gross.toFixed(2)),
            at_13ts_liters: new Prisma.Decimal(r.at13.toFixed(2)),
            tank_receipt_id: receipt.id,
            reference_type: 'ZMCC_LAB_PORTION',
            reference_id: r.portion.id.toString(),
            idempotency_key: `ZMCC_TANK_RECEIPT:PORTION:${r.portion.id}`,
            operational_timestamp: o.at,
            performed_by_user_id: ctx.phe.id,
            notes: `Tank receipt for ${session.arrival_type} portion (Session #${sessionId}, portion #${r.portion.id})`,
          },
        });
        await tx.zmccLabPortion.update({
          where: { id: r.portion.id },
          data: { status: 'WEIGHED', tank_id: ctx.tank.id },
        });
      }
      await tx.zmccLabSession.update({
        where: { id: sessionId },
        data: { unloaded_at: o.at, unloaded_by_user_id: ctx.phe.id, close_requested_by_user_id: null, close_requested_at: null },
      });
      if (o.source && session.local_supplier_arrival_id) {
        await tx.zmccLocalSupplierArrival.update({
          where: { id: session.local_supplier_arrival_id },
          data: {
            milk_source_id: o.source.id,
            milk_source_code_snapshot: o.source.erp_code,
            milk_source_name_snapshot: o.source.name,
          },
        });
      }

      // Journey close (same rule as closeJourneyIfDoneTx): every portion rejected or weighed.
      const after = await tx.zmccLabPortion.findMany({ where: { lab_session_id: sessionId } });
      const allDone = after.every(
        (x) => x.final_decision === 'REJECTED' || (x.final_decision === 'ACCEPTED' && x.status === 'WEIGHED')
      );
      const weighedCount = after.filter((x) => x.final_decision === 'ACCEPTED' && x.status === 'WEIGHED').length;
      if (session.status === 'COMPLETED' && allDone && weighedCount > 0) {
        await tx.zmccLabSession.update({
          where: { id: sessionId },
          data: { journey_closed_at: o.at, closed_reason: 'ALL_PORTIONS_WEIGHED' },
        });
        if (session.mot_arrival_id) {
          const arr = await tx.zmccMotArrival.findUniqueOrThrow({ where: { id: session.mot_arrival_id } });
          await computeAndStoreAreaLossTx(tx, { journeyId: arr.journey_id, sessionId, actor });
          // MC has no gate exit: the outcome is final once the milk is unloaded.
          await tx.zmccLabSession.update({
            where: { id: sessionId },
            data: {
              exit_outcome: computeExitOutcome(
                after.map((p) => ({ final_decision: p.final_decision, status: p.status }))
              ),
            },
          });
        }
      }
    },
    { timeout: 60000, maxWait: 20000 }
  );
}

async function storeAreaLossForClose(sessionId: bigint, actor: ActingContext) {
  await prisma.$transaction(async (tx) => {
    const sess = await tx.zmccLabSession.findUnique({ where: { id: sessionId } });
    if (!sess?.mot_arrival_id) return;
    const arr = await tx.zmccMotArrival.findUniqueOrThrow({ where: { id: sess.mot_arrival_id } });
    const stored = await computeAndStoreAreaLossTx(tx, { journeyId: arr.journey_id, sessionId, actor });
    if (stored) return;
    const summ = await tx.motJourneySummary.findUnique({ where: { journey_id: arr.journey_id } });
    if (!summ) return;
    // Nothing was received: the whole declared quantity shows as loss (same as the manager approval service).
    const declared = Number(summ.total_gross_liters);
    const declared13 = Number(summ.total_at_13ts_liters);
    const tier1 = calculateTier1RouteLoss({
      shopGrossLiters: declared,
      zmccArrivalGrossLiters: 0,
      shopAt13tsLiters: declared13,
      zmccArrivalAt13tsLiters: 0,
    });
    await tx.motJourney.update({
      where: { id: arr.journey_id },
      data: {
        area_received_net_kg: new Prisma.Decimal(0),
        area_received_liters: new Prisma.Decimal(0),
        area_received_at_13ts_liters: new Prisma.Decimal(0),
        area_mot_declared_liters: new Prisma.Decimal(declared.toFixed(2)),
        area_mot_declared_at_13ts_liters: new Prisma.Decimal(declared13.toFixed(2)),
        area_loss_gain_liters: new Prisma.Decimal(tier1.signedVarianceLiters.toFixed(2)),
        area_loss_gain_at_13ts_liters: new Prisma.Decimal(tier1.signedVarianceAt13tsLiters.toFixed(2)),
        area_loss_gain_pct: new Prisma.Decimal(
          declared > 0 ? ((tier1.signedVarianceLiters / declared) * 100).toFixed(4) : '0'
        ),
        area_computed_at: new Date(),
      },
    });
  });
}

async function buildSession(ctx: Zctx, policies: { HC: LabPolicySnapshot; MOT: LabPolicySnapshot }, o: SessionOpts) {
  const policy = policies[o.kind];
  const point = o.kind === 'HC' ? 'ZMCC_LAB_HC' : 'ZMCC_LAB_MC';
  const startedAt = at(o.arrivalAt, 8);

  const session = await prisma.zmccLabSession.create({
    data: {
      zmcc_id: ctx.src.id,
      arrival_type: o.kind,
      ...(o.kind === 'HC' ? { local_supplier_arrival_id: o.arrivalId } : { mot_arrival_id: o.arrivalId }),
      test_mode: o.mode,
      status: 'IN_PROGRESS',
      started_by_user_id: ctx.lab.id,
      started_at: startedAt,
      started_as_role: 'ZMCC_LAB_ATTENDANT',
      created_at: startedAt,
    },
  });

  type Made = { id: bigint; no: number; spec: PortionSpec; final: string; details: LabPortionDecisionDetails | null; decidedAt: Date; reviewedAt: Date | null };
  const made: Made[] = [];
  for (let i = 0; i < o.portions.length; i++) {
    const spec = o.portions[i];
    const no = i + 1;
    const state: PortionState = spec.state ?? 'DECIDED';
    const decidedAt = at(startedAt, 6 + 4 * i);
    if (state === 'TESTING') {
      const p = await prisma.zmccLabPortion.create({
        data: {
          lab_session_id: session.id,
          portion_number: no,
          status: 'TESTING',
          final_decision: 'PENDING',
          created_by_user_id: ctx.lab.id,
          performed_as_role: 'ZMCC_LAB_ATTENDANT',
          created_at: decidedAt,
        },
      });
      made.push({ id: p.id, no, spec, final: 'PENDING', details: null, decidedAt, reviewedAt: null });
      continue;
    }

    const { details, decision, person } = evaluatePortion(policy, spec);
    const m = computeCanonicalMilkMetrics(spec.qtyKg, 'KG', spec.lr, spec.fat);
    const systemOutcome = (spec.fail?.length ?? 0) > 0 ? 'FAIL' : 'PASS';
    const reasons: string[] = decision.exceptionReasons.length > 0 ? decision.exceptionReasons : ['MISMATCH', 'RULE_FAIL:LT-000008'];

    let status: string;
    let final: 'ACCEPTED' | 'REJECTED' | 'PENDING';
    let review: 'NONE' | 'PENDING' | 'APPROVED' | 'REJECTED';
    let exception: string[] = [];
    let reviewedAt: Date | null = null;
    if (state === 'PENDING_REVIEW') {
      status = 'PENDING_REVIEW';
      final = 'PENDING';
      review = 'PENDING';
      exception = reasons;
    } else if (state === 'OKAY') {
      final = person === 'ACCEPT' ? 'ACCEPTED' : 'REJECTED';
      status = final;
      review = 'APPROVED';
      exception = reasons;
      reviewedAt = at(decidedAt, 12);
    } else if (state === 'NO') {
      final = person === 'ACCEPT' ? 'REJECTED' : 'ACCEPTED';
      status = final;
      review = 'REJECTED';
      exception = reasons;
      reviewedAt = at(decidedAt, 12);
    } else {
      final = person === 'ACCEPT' ? 'ACCEPTED' : 'REJECTED';
      status = final;
      review = 'NONE';
    }

    const p = await prisma.zmccLabPortion.create({
      data: {
        lab_session_id: session.id,
        portion_number: no,
        status,
        quantity_value: spec.qtyKg,
        quantity_unit: 'KG',
        density: m.density,
        gross_liters: m.grossLiters,
        lr: spec.lr,
        fat: spec.fat,
        snf: m.snf,
        ts: m.ts,
        at_13ts_liters: m.at13tsLiters,
        calculation_version: m.calculationVersion,
        system_outcome: systemOutcome,
        person_decision: person,
        decision_remarks: spec.remarks ?? null,
        exception_reasons: json(exception),
        review_status: review,
        final_decision: final,
        decision_details: json(details),
        decided_at: decidedAt,
        created_by_user_id: ctx.lab.id,
        performed_as_role: 'ZMCC_LAB_ATTENDANT',
        created_at: decidedAt,
        ...(reviewedAt
          ? {
              reviewed_by_user_id: ctx.manager.id,
              reviewed_as_role: 'ZMCC_MANAGER',
              reviewed_at: reviewedAt,
              review_remarks: spec.reviewRemarks ?? null,
            }
          : {}),
      },
    });
    made.push({ id: p.id, no, spec, final, details, decidedAt, reviewedAt });
  }

  // Legacy session-level lab results (shown in session history) from the first decided portion.
  const rep = made.find((x) => x.details !== null);
  if (rep && rep.details) await createLegacySessionResults(session.id, rep.id, point, rep.details, rep.decidedAt);

  const hasTesting = made.some((x) => x.spec.state === 'TESTING');
  const hasPending = made.some((x) => x.spec.state === 'PENDING_REVIEW');
  const reviewed = made.find((x) => x.spec.state === 'OKAY' || x.spec.state === 'NO');

  // Manager exception tracking on the session (same columns the lab service fills)
  const pendingOne = made.find((x) => x.spec.state === 'PENDING_REVIEW');
  if (pendingOne) {
    await prisma.zmccLabSession.update({
      where: { id: session.id },
      data: {
        system_quality_outcome: 'FAIL',
        manager_review_status: 'PENDING',
        manager_requested_decision: 'ACCEPTED',
        manager_review_requested_by_user_id: ctx.lab.id,
        manager_review_requested_at: pendingOne.decidedAt,
        manager_review_reason: pendingOne.spec.remarks ?? null,
      },
    });
  } else if (reviewed && reviewed.reviewedAt) {
    await prisma.zmccLabSession.update({
      where: { id: session.id },
      data: {
        system_quality_outcome: 'FAIL',
        manager_review_status: reviewed.spec.state === 'OKAY' ? 'APPROVED' : 'REJECTED',
        manager_requested_decision: 'ACCEPTED',
        manager_review_requested_by_user_id: ctx.lab.id,
        manager_review_requested_at: reviewed.decidedAt,
        manager_reviewed_by_user_id: ctx.manager.id,
        manager_reviewed_at: reviewed.reviewedAt,
        manager_reviewed_as_role: 'ZMCC_MANAGER',
        manager_review_reason: reviewed.spec.reviewRemarks ?? null,
      },
    });
  }

  if (hasTesting || hasPending) return { sessionId: session.id, complete: false, portionIds: made.map((m) => m.id) };

  // All portions decided: the lab session is finished (same roll-up as rollUpLabSessionTx)
  const lastEvent = made.reduce((t, x) => Math.max(t, (x.reviewedAt ?? x.decidedAt).getTime()), 0);
  const completedAt = at(new Date(lastEvent), 2);
  const acceptedMade = made.filter((x) => x.final === 'ACCEPTED');
  const allRejected = acceptedMade.length === 0;
  const sumOf = (pick: (m: ReturnType<typeof computeCanonicalMilkMetrics>) => number) =>
    acceptedMade.reduce((s, x) => s + pick(computeCanonicalMilkMetrics(x.spec.qtyKg, 'KG', x.spec.lr, x.spec.fat)), 0);
  const finalDecision = allRejected ? 'REJECTED' : 'ACCEPTED';
  const rejectedRemarks = made
    .filter((x) => x.final === 'REJECTED')
    .map((x) => x.spec.reviewRemarks ?? x.spec.remarks)
    .filter(Boolean)
    .join(' | ');
  await prisma.zmccLabSession.update({
    where: { id: session.id },
    data: {
      status: 'COMPLETED',
      completed_by_user_id: reviewed ? ctx.manager.id : ctx.lab.id,
      completed_at: completedAt,
      completed_as_role: reviewed ? 'ZMCC_MANAGER' : 'ZMCC_LAB_ATTENDANT',
      decision: finalDecision,
      final_decision: finalDecision,
      final_decided_by_user_id: reviewed ? ctx.manager.id : ctx.lab.id,
      final_decided_at: completedAt,
      final_decided_as_role: reviewed ? 'ZMCC_MANAGER' : 'ZMCC_LAB_ATTENDANT',
      final_decision_reason: allRejected
        ? 'All portions rejected.'
        : `${acceptedMade.length} of ${made.length} portion(s) accepted.`,
      system_quality_outcome: o.portions.every((p) => (p.fail?.length ?? 0) === 0) ? 'PASS' : 'FAIL',
      completion_client_event_id: `DEMO-SCN-evt-comp-${o.kind}-${ctx.tag}-${o.key}`,
      ...(acceptedMade.length > 0
        ? {
            gross_liters: sumOf((m) => m.grossLiters).toFixed(2),
            at_13ts_liters: sumOf((m) => m.at13tsLiters).toFixed(2),
          }
        : {}),
      ...(allRejected
        ? {
            rejection_reason: rejectedRemarks || 'All portions rejected.',
            journey_closed_at: completedAt,
            closed_reason: 'ALL_PORTIONS_REJECTED',
          }
        : {}),
    },
  });

  // Weighing (vehicle level): WEIGHT chain or MANUAL net entry, accepted portions only (rejected ones are skipped)
  const weighAt = at(completedAt, 20);
  let lastAt = weighAt;
  const acceptedSorted = acceptedMade.sort((a, b) => a.no - b.no);
  if (acceptedSorted.length > 0 && (o.weights || acceptedSorted.every((x) => x.spec.manualNet))) {
    if (o.weights) {
      if (o.weights.length !== acceptedSorted.length + 1) {
        throw new Error(`Scenario ${o.key}: expected ${acceptedSorted.length + 1} weights, got ${o.weights.length}.`);
      }
      for (let i = 0; i < acceptedSorted.length; i++) {
        const first = o.weights[i];
        const second = o.weights[i + 1];
        if (!(second < first)) throw new Error(`Scenario ${o.key}: weights must strictly decrease.`);
        await prisma.zmccLabPortion.update({
          where: { id: acceptedSorted[i].id },
          data: {
            net_entry_mode: 'WEIGHT',
            first_weight_kg: new Prisma.Decimal(first.toFixed(3)),
            first_weight_at: weighAt,
            first_weight_by_user_id: ctx.phe.id,
            first_weight_as_role: ctx.phe.role,
            second_weight_kg: new Prisma.Decimal(second.toFixed(3)),
            second_weight_at: weighAt,
            second_weight_by_user_id: ctx.phe.id,
            second_weight_as_role: ctx.phe.role,
            net_weight_kg: new Prisma.Decimal((first - second).toFixed(3)),
          },
        });
      }
    } else {
      for (const x of acceptedSorted) {
        const manual = x.spec.manualNet!;
        const stored = await prisma.zmccLabPortion.findUniqueOrThrow({ where: { id: x.id } });
        let netKg = manual.value;
        if (manual.unit === 'LITER') {
          const density = calculatePortionReceived({
            netWeightKg: 1,
            density: stored.density !== null ? Number(stored.density) : null,
            lr: stored.lr !== null ? Number(stored.lr) : null,
            ts: Number(stored.ts ?? 0),
          }).density;
          netKg = Number((manual.value * density).toFixed(3));
        }
        await prisma.zmccLabPortion.update({
          where: { id: x.id },
          data: {
            net_entry_mode: 'MANUAL',
            net_entry_value: new Prisma.Decimal(manual.value.toFixed(3)),
            net_entry_unit: manual.unit,
            first_weight_kg: null,
            first_weight_at: null,
            first_weight_by_user_id: null,
            second_weight_kg: null,
            second_weight_at: null,
            second_weight_by_user_id: null,
            net_weight_kg: new Prisma.Decimal(netKg.toFixed(3)),
          },
        });
      }
    }
  }

  // Unload to ZMCC tank
  let unloadAt: Date | null = null;
  if (o.unload) {
    unloadAt = at(weighAt, 8);
    lastAt = unloadAt;
    await performUnload(ctx, session.id, {
      at: unloadAt,
      source: o.unload.source ?? null,
      only: o.unload.onlyPortionNumbers,
    });
  }

  // Close without unloading (PHE requests, ZMCC Manager approves)
  if (o.closeRequest) {
    const requestedAt = at(completedAt, 20);
    const base = {
      close_requested_by_user_id: ctx.phe.id,
      close_requested_at: requestedAt,
      exit_reason_code: o.closeRequest.reasonCode,
      exit_remarks: o.closeRequest.remarks,
    };
    if (!o.closeRequest.approved) {
      await prisma.zmccLabSession.update({ where: { id: session.id }, data: base });
    } else {
      const approvedAt = at(requestedAt, 25);
      const fresh = await prisma.zmccLabPortion.findMany({ where: { lab_session_id: session.id } });
      await prisma.zmccLabSession.update({
        where: { id: session.id },
        data: {
          ...base,
          close_approved_by_user_id: ctx.manager.id,
          close_approved_at: approvedAt,
          journey_closed_at: approvedAt,
          closed_reason: 'CLOSED_WITHOUT_UNLOADING',
          exit_outcome: computeExitOutcome(fresh.map((p) => ({ final_decision: p.final_decision, status: p.status }))),
        },
      });
      if (o.kind === 'MOT') await storeAreaLossForClose(session.id, actingOf(ctx.manager, 'ZMCC_MANAGER'));
      lastAt = approvedAt;
    }
  }

  // HC gate exit (the last step; outcome computed, never typed)
  if (o.kind === 'HC' && o.hcExit) {
    const exitAt = at(unloadAt ?? lastAt, o.hcExit.afterMin ?? 15);
    const fresh = await prisma.zmccLabPortion.findMany({ where: { lab_session_id: session.id } });
    const outcome = computeExitOutcome(fresh.map((p) => ({ final_decision: p.final_decision, status: p.status })));
    const missing = outcome === 'PARTLY_RECEIVED' || outcome === 'ACCEPTED_NOT_RECEIVED';
    await prisma.zmccLocalSupplierArrival.update({
      where: { id: o.arrivalId },
      data: {
        exit_timestamp: exitAt,
        exit_recorded_by_user_id: ctx.phe.id,
        exit_client_event_id: `DEMO-SCN-evt-exit-hc-${ctx.tag}-${o.key}`,
        exit_submitted_at: at(exitAt, 2),
      },
    });
    await prisma.zmccLabSession.update({
      where: { id: session.id },
      data: {
        exit_outcome: outcome,
        exit_reason_code: missing ? o.hcExit.reasonCode ?? null : null,
        exit_remarks: missing ? o.hcExit.remarks ?? null : null,
      },
    });
  }

  return { sessionId: session.id, complete: true, portionIds: made.map((m) => m.id) };
}

// ------------------------------------------------------------------------------------------------
// Main
// ------------------------------------------------------------------------------------------------

async function main() {
  console.log('==================================================');
  console.log('RUNNING ZMCC SCENARIO SEED (DEVELOPMENT ONLY, ADDITIVE)');
  console.log('==================================================\n');

  if (process.env.NODE_ENV === 'production') {
    console.error('CRITICAL SAFETY ABORT: Cannot seed demo scenarios in PRODUCTION environment!');
    process.exit(1);
  }
  if ((process.env.ALLOW_DEMO_RESET || '').trim() !== 'true') {
    console.error('CRITICAL SAFETY ABORT: ALLOW_DEMO_RESET=true is required to seed demo scenarios!');
    process.exit(1);
  }

  const users = await prisma.user.findMany({ where: { is_active: true } });
  const byName = (u: string) => users.find((x) => x.username === u);
  const need = (u: string, fallbackRoles: string[] = []) => {
    const found = byName(u) ?? users.find((x) => fallbackRoles.includes(x.role));
    if (!found) throw new Error(`Required user "${u}" not found. Seed master users first.`);
    return found;
  };

  const dataExecutive = users.find((u) => u.role === 'DATA_EXECUTIVE') ?? need('admin.superuser', ['SUPER_ADMIN']);
  const hasilpurSource = await prisma.procurementSource.findUnique({ where: { code: 'ZMCC-HASILPUR' } });
  if (!hasilpurSource) throw new Error('ZMCC-HASILPUR procurement source not found. Run prisma/seed.ts first.');
  const jhangSource = await prisma.procurementSource.findUnique({ where: { code: 'ZMCC-JHANG' } });

  const hasManager = need('zmcc.manager.north', ['ZMCC_MANAGER']);
  const hasPhe = need('phe.operator', ['PHE_OPERATOR']);
  const hasLab = need('zmcc.operator', ['ZMCC_LAB_ATTENDANT']);

  // Global weighing policy exists (manual entry stays OFF: scenario 9 only stores rows, it changes no policy)
  if ((await prisma.zmccWeighingPolicy.count()) === 0) {
    await prisma.zmccWeighingPolicy.create({ data: { manual_entry_enabled: false, allowed_units: 'BOTH', version: 1 } });
  }

  const policies = {
    HC: await loadLabPolicy('ZMCC_LAB_HC'),
    MOT: await loadLabPolicy('ZMCC_LAB_MC'),
  };

  // ----- Master data -------------------------------------------------------------------------------
  const ensureTank = async (src: ProcurementSource, code: string, name: string, creator: User) => {
    const existing = await prisma.zmccTank.findFirst({ where: { zmcc_id: src.id, is_active: true } });
    if (existing) return existing;
    return prisma.zmccTank.create({
      data: { zmcc_id: src.id, tank_code: code, tank_name: name, capacity_liters: 60000, is_active: true, created_by_user_id: creator.id },
    });
  };

  const ensureMilkSource = async (code: string, name: string, zmccIds: bigint[]): Promise<SourceRef> => {
    const ms = await prisma.zmccMilkSource.upsert({
      where: { erp_code: code },
      update: { name, is_active: true, updated_by: dataExecutive.id },
      create: { erp_code: code, name, is_active: true, created_by: dataExecutive.id },
    });
    for (const zid of zmccIds) {
      await prisma.milkSourceZmccVisibility.upsert({
        where: { milk_source_id_zmcc_id: { milk_source_id: ms.id, zmcc_id: zid } },
        update: { is_active: true },
        create: { milk_source_id: ms.id, zmcc_id: zid, is_active: true },
      });
    }
    return { id: ms.id, erp_code: ms.erp_code, name: ms.name };
  };

  const allocateSupplierCode = async (): Promise<string> => {
    const r = await prisma.$queryRaw<{ nextval: bigint }[]>`SELECT nextval('zmcc_local_supplier_code_seq') as nextval`;
    return `ZLS-${String(Number(r[0].nextval)).padStart(6, '0')}`;
  };
  const ensureSupplier = async (src: ProcurementSource, name: string, phone: string, cnic: string, creator: User) => {
    const existing = await prisma.zmccLocalSupplier.findFirst({ where: { zmcc_id: src.id, name } });
    if (existing) return existing;
    return prisma.zmccLocalSupplier.create({
      data: { local_supplier_code: await allocateSupplierCode(), zmcc_id: src.id, name, phone, cnic, is_active: true, created_by_user_id: creator.id },
    });
  };

  const hasTank = await ensureTank(hasilpurSource, 'TK-HAS-01', 'Hasilpur Raw Milk Storage Tank 01', hasManager);
  const hasMs = await Promise.all([
    ensureMilkSource('DEMO-SCN-MS-01', 'Chaudhry Ghulam Mustafa Dairy', [hasilpurSource.id]),
    ensureMilkSource('DEMO-SCN-MS-02', 'Haji Abdul Qayyum Milk Account', [hasilpurSource.id]),
    ensureMilkSource('DEMO-SCN-MS-03', 'Sheikh Muhammad Rafiq Cattle Farm', [hasilpurSource.id]),
    ensureMilkSource('DEMO-SCN-MS-04', 'Mian Shabbir Ahmad Milk Account', [hasilpurSource.id]),
    ensureMilkSource('DEMO-SCN-MS-05', 'Malik Tahir Mehmood Dairy', [hasilpurSource.id]),
    ensureMilkSource('DEMO-SCN-MS-06', 'Rana Zulfiqar Ali Milk Account', [hasilpurSource.id]),
  ]);
  const has: Zctx = { tag: 'HAS', src: hasilpurSource, tank: hasTank, manager: hasManager, lab: hasLab, phe: hasPhe, sources: hasMs };

  const sup = {
    aslam: await ensureSupplier(hasilpurSource, 'DEMO - Chaudhry Aslam Dairy Farm', '03000000101', '31202-0000101-1', hasPhe),
    bashir: await ensureSupplier(hasilpurSource, 'DEMO - Haji Bashir Ahmad Milk Collection', '03000000102', '31202-0000102-3', hasManager),
    rafique: await ensureSupplier(hasilpurSource, 'DEMO - Mian Rafique Cattle Colony', '03000000103', '31202-0000103-5', hasManager),
    khalid: await ensureSupplier(hasilpurSource, 'DEMO - Rana Khalid Mehmood Dairy', '03000000104', '31202-0000104-7', hasManager),
    nadeem: await ensureSupplier(hasilpurSource, 'DEMO - Sheikh Nadeem Akhtar Milk Supply', '03000000105', '31202-0000105-9', hasManager),
    abbas: await ensureSupplier(hasilpurSource, 'DEMO - Malik Ghulam Abbas Farm', '03000000106', '31202-0000106-1', hasManager),
    waseem: await ensureSupplier(hasilpurSource, 'DEMO - Waseem Khan Milk Traders', '03000000107', '31202-0000107-3', hasManager),
    ditta: await ensureSupplier(hasilpurSource, 'DEMO - Allah Ditta Dairy Point', '03000000108', '31202-0000108-5', hasManager),
    nawaz: await ensureSupplier(hasilpurSource, 'DEMO - Nawaz Sharif Milk Collection', '03000000109', '31202-0000109-7', hasManager),
    iqbal: await ensureSupplier(hasilpurSource, 'DEMO - Muhammad Iqbal Cattle Farm', '03000000110', '31202-0000110-9', hasManager),
  };

  // MC infrastructure for Hasilpur (route, area, 4 shops, MOT, 3 company vehicles)
  const chiller = (await prisma.chillerOwnership.findFirst({ where: { ownership_code: 'SELF' } })) ?? (await prisma.chillerOwnership.findFirst());
  let route = await prisma.zmccRoute.findUnique({ where: { route_code: 'DEMO-SCN-RT-HAS-01' } });
  if (!route) {
    route = await prisma.zmccRoute.create({
      data: {
        zmcc_id: hasilpurSource.id, route_code: 'DEMO-SCN-RT-HAS-01', name: 'Hasilpur Chak Road Route (Scenarios)',
        origin: 'Chak Road, Hasilpur', destination: 'ZMCC Hasilpur', is_active: true, created_by: hasManager.id,
      },
    });
  }
  let area = await prisma.zmccArea.findUnique({ where: { area_code: 'DEMO-SCN-AR-HAS-01' } });
  if (!area) {
    area = await prisma.zmccArea.create({
      data: { area_code: 'DEMO-SCN-AR-HAS-01', name: 'Chak Road Villages', route_id: route.id, zmcc_id: hasilpurSource.id, created_by: hasManager.id },
    });
  }
  const shopSpecs = [
    { code: 'DEMO-SCN-SHP-01', name: 'Madni Milk Shop', owner: 'Haji Muhammad Aslam', phone: '03000000201', cnic: '31202-0000201-1' },
    { code: 'DEMO-SCN-SHP-02', name: 'Baba Fareed Dairy Point', owner: 'Ghulam Fareed', phone: '03000000202', cnic: '31202-0000202-3' },
    { code: 'DEMO-SCN-SHP-03', name: 'Al-Noor Milk Center', owner: 'Noor Muhammad', phone: '03000000203', cnic: '31202-0000203-5' },
    { code: 'DEMO-SCN-SHP-04', name: 'Rizwan Milk Shop', owner: 'Rizwan Ahmad', phone: '03000000204', cnic: '31202-0000204-7' },
  ];
  const shops: Prisma.ZmccShopGetPayload<object>[] = [];
  for (const s of shopSpecs) {
    let shop = await prisma.zmccShop.findUnique({ where: { shop_code: s.code } });
    if (!shop) {
      shop = await prisma.zmccShop.create({
        data: {
          shop_code: s.code, shop_name: s.name, owner_name: s.owner, phone_number: s.phone, cnic: s.cnic,
          area_id: area.id, route_id: route.id, zmcc_id: hasilpurSource.id,
          chiller_ownership_id: chiller ? chiller.id : BigInt(1), is_active: true, created_by: hasManager.id,
        },
      });
    }
    shops.push(shop);
  }
  let mot = await prisma.motProfile.findUnique({ where: { mot_code: 'DEMO-SCN-MOT-HAS-01' } });
  if (!mot) {
    mot = await prisma.motProfile.create({
      data: {
        zmcc_id: hasilpurSource.id, mot_code: 'DEMO-SCN-MOT-HAS-01', name: 'Muhammad Imran', phone_number: '03000000301',
        cnic: '31202-0000301-1', is_active: true, created_by: hasManager.id,
      },
    });
  }
  const ensureVehicle = async (num: string) =>
    (await prisma.motVehicle.findUnique({ where: { vehicle_number: num } })) ??
    prisma.motVehicle.create({ data: { zmcc_id: hasilpurSource.id, vehicle_number: num, is_active: true, created_by: dataExecutive.id } });
  const mcVehicles = [await ensureVehicle('DEMO-SCN-SGL-101'), await ensureVehicle('DEMO-SCN-SGL-102'), await ensureVehicle('DEMO-SCN-SGL-103')];

  // ----- Journey / arrival builders ----------------------------------------------------------------
  interface ShopCol {
    shop: number; // index into shops
    liters: number;
    lr: number;
    fat: number;
    source: number; // index into hasMs
    rejected?: boolean;
    rejectRemarks?: string;
    rmr: string;
  }

  async function createMcJourney(key: string, vehicleId: bigint, arrivedAt: Date, cols: ShopCol[]) {
    const dateStr = getPakistanCalendarDate(arrivedAt).replace(/-/g, '');
    const journey = await prisma.motJourney.create({
      data: {
        journey_number: `DEMO-SCN-J-HAS-${key}`,
        idempotency_key: `DEMO-SCN-mot-journey-${key}`,
        zmcc_id: hasilpurSource!.id,
        route_id: route!.id,
        mot_profile_id: mot!.id,
        mot_vehicle_id: vehicleId,
        status: 'COMPLETED',
        operational_date: dateOnlyOf(arrivedAt),
        assigned_by: hasManager.id,
        assigned_at: at(arrivedAt, -260),
        started_at: at(arrivedAt, -240),
        ended_at: at(arrivedAt, -12),
        assignment_latitude: 29.6974,
        assignment_longitude: 72.5539,
        start_latitude: 29.6974,
        start_longitude: 72.5539,
      },
    });
    let acceptedKg = 0;
    let acceptedLiters = 0;
    let wLr = 0;
    let wFat = 0;
    for (let i = 0; i < cols.length; i++) {
      const c = cols[i];
      const shop = shops[c.shop];
      const arrive = at(arrivedAt, -200 + i * 40);
      const stop = await prisma.motJourneyStop.create({
        data: {
          journey_id: journey.id, shop_id: shop.id, planned_sequence: i + 1, status: 'VISITED',
          shop_code_snapshot: shop.shop_code, shop_name_snapshot: shop.shop_name, owner_name_snapshot: shop.owner_name,
          phone_number_snapshot: shop.phone_number, area_code_snapshot: area!.area_code, area_name_snapshot: area!.name,
          arrived_at: arrive, completed_at: at(arrive, 15),
        },
      });
      const m = computeCanonicalMilkMetrics(c.liters, 'LITER', c.lr, c.fat);
      const src = hasMs[c.source];
      await prisma.motShopCollection.create({
        data: {
          collection_number: `DEMO-SCN-MC-${dateStr}-${key}-${i + 1}`,
          journey_id: journey.id, journey_stop_id: stop.id, shop_id: shop.id, zmcc_id: hasilpurSource!.id,
          route_id: route!.id, mot_profile_id: mot!.id, mot_vehicle_id: vehicleId,
          operational_date: dateOnlyOf(arrivedAt),
          client_event_id: `DEMO-SCN-evt-shop-${key}-${i + 1}`,
          quantity_value: c.liters, quantity_unit: 'LITER', gross_liters: m.grossLiters, density: m.density,
          lr: c.lr, fat: c.fat, snf: m.snf, ts: m.ts, at_13ts_liters: m.at13tsLiters, calculation_version: m.calculationVersion,
          collection_latitude: 29.6974 + i * 0.01, collection_longitude: 72.5539 + i * 0.01,
          device_collected_at: at(arrive, 10), server_received_at: at(arrive, 12),
          submitted_by_user_id: hasLab.id,
          milk_source_id: src.id, milk_source_code_snapshot: src.erp_code, milk_source_name_snapshot: src.name,
          shop_rmr_number: c.rmr,
          collection_notes: c.rejected ? 'Rejected at the shop' : null,
          system_outcome: c.rejected ? 'FAIL' : 'PASS',
          person_decision: c.rejected ? 'REJECT' : 'ACCEPT',
          decision_remarks: c.rejected ? c.rejectRemarks ?? 'Milk rejected at the shop.' : null,
          exception_reasons: json([]),
          review_status: 'NONE',
          final_decision: c.rejected ? 'REJECTED' : 'ACCEPTED',
        },
      });
      if (!c.rejected) {
        acceptedKg += c.liters * m.density;
        acceptedLiters += c.liters;
        wLr += c.lr * c.liters;
        wFat += c.fat * c.liters;
      }
    }
    await prisma.$transaction(async (tx) => {
      await createInitialMotJourneySummaryTx(tx, journey.id, at(arrivedAt, -12), hasLab.id, 'ZMCC_LAB_ATTENDANT');
    });
    return {
      journey,
      declaredKg: acceptedKg,
      avgLr: round(wLr / acceptedLiters, 2),
      avgFat: round(wFat / acceptedLiters, 2),
    };
  }

  async function createMcArrival(key: string, journeyId: bigint, arrivedAt: Date) {
    return prisma.zmccMotArrival.create({
      data: {
        journey_id: journeyId, zmcc_id: hasilpurSource!.id,
        route_milk_token: `DEMO-SCN-RM-HAS-${key}`,
        raw_milk_token_number: numFor(`RMT-HAS-${key}`),
        zmcc_token: `DEMO-SCN-TK-HAS-MC-${key}`,
        arrival_timestamp: arrivedAt, arrival_date: dateOnlyOf(arrivedAt),
        client_event_id: `DEMO-SCN-evt-arr-mot-HAS-${key}`,
        recorded_by_user_id: hasPhe.id, gate_exit_required: false,
      },
    });
  }

  async function createHcArrival(ctx: Zctx, key: string, supplier: ZmccLocalSupplier, vehicle: string, arrivedAt: Date) {
    return prisma.zmccLocalSupplierArrival.create({
      data: {
        zmcc_id: ctx.src.id, local_supplier_id: supplier.id,
        rmr_number: numFor(`RMR-${ctx.tag}-${key}`), vehicle_number: vehicle,
        arrival_timestamp: arrivedAt, arrival_date: dateOnlyOf(arrivedAt),
        zmcc_token: `DEMO-SCN-TK-${ctx.tag}-HC-${key}`,
        client_event_id: `DEMO-SCN-evt-arr-hc-${ctx.tag}-${key}`,
        recorded_by_user_id: ctx.phe.id, gate_exit_required: true, submitted_at: arrivedAt,
      },
    });
  }

  const hcExists = async (ctx: Zctx, key: string) =>
    !!(await prisma.zmccLocalSupplierArrival.findUnique({ where: { zmcc_token: `DEMO-SCN-TK-${ctx.tag}-HC-${key}` } }));
  const mcExists = async (key: string) =>
    !!(await prisma.motJourney.findUnique({ where: { journey_number: `DEMO-SCN-J-HAS-${key}` } }));

  /** Runs one scenario unless it already exists (idempotent). */
  async function scenario(label: string, exists: () => Promise<boolean>, build: () => Promise<string>) {
    if (await exists()) {
      counters.skipped++;
      console.log(`  - skipped (already seeded): ${label}`);
      return;
    }
    const line = await build();
    counters.created++;
    summary.push(`${label}: ${line}`);
    console.log(`  + ${label}: ${line}`);
  }

  // ===================================================================================================
  // Scenarios at ZMCC Hasilpur
  // ===================================================================================================
  console.log('Scenarios at ZMCC Hasilpur');

  // 1. HC composite, all tests pass, accepted, weighed (2 weights), unloaded with source, exit RECEIVED
  await scenario('S1 HC composite received', () => hcExists(has, 'S1'), async () => {
    const t0 = daysAgoAt(2, '09:10');
    const arr = await createHcArrival(has, 'S1', sup.aslam, 'DEMO-SCN-LEA-2301', t0);
    await buildSession(has, policies, {
      kind: 'HC', arrivalId: arr.id, arrivalAt: t0, key: 'S1', mode: 'COMPOSITE',
      portions: [{ qtyKg: 3200, lr: 28.6, fat: 4.1 }],
      weights: [11850, 8655],
      unload: { source: hasMs[0] },
      hcExit: { afterMin: 14 },
    });
    return `${arr.zmcc_token} / DEMO-SCN-LEA-2301 / Chaudhry Aslam; 1 portion, 2 weights (net 3195 kg), source ${hasMs[0].name}, exit RECEIVED`;
  });

  // 2. HC portion-wise: accepted, REJECTED (acidity / sour), accepted. 3 weights for the 2 accepted ones
  await scenario('S2 HC 3 portions, middle rejected', () => hcExists(has, 'S2'), async () => {
    const t0 = daysAgoAt(1, '07:40');
    const arr = await createHcArrival(has, 'S2', sup.bashir, 'DEMO-SCN-LEB-4417', t0);
    await buildSession(has, policies, {
      kind: 'HC', arrivalId: arr.id, arrivalAt: t0, key: 'S2', mode: 'PORTION_WISE',
      portions: [
        { qtyKg: 1800, lr: 28.2, fat: 3.9 },
        {
          qtyKg: 1500, lr: 27.0, fat: 3.4, person: 'REJECT', fail: ['ACIDITY', 'SOUR', 'FAT'],
          remarks: 'Sour smell, acidity 0.21% and clot on boiling positive. Milk was kept without cooling since early morning.',
        },
        { qtyKg: 2100, lr: 29.1, fat: 4.4 },
      ],
      weights: [13890, 12095, 9990],
      unload: { source: hasMs[1] },
      hcExit: { afterMin: 15 },
    });
    return `${arr.zmcc_token} / DEMO-SCN-LEB-4417 / Haji Bashir; P1 ok, P2 REJECTED (acidity 0.21), P3 ok; weights 13890>12095>9990; source ${hasMs[1].name}; exit RECEIVED`;
  });

  // 3. HC portion-wise, all three rejected -> vehicle rejected, journey closed, exit REJECTED
  await scenario('S3 HC all portions rejected', () => hcExists(has, 'S3'), async () => {
    const t0 = daysAgoAt(1, '15:10');
    const arr = await createHcArrival(has, 'S3', sup.rafique, 'DEMO-SCN-FDA-7712', t0);
    await buildSession(has, policies, {
      kind: 'HC', arrivalId: arr.id, arrivalAt: t0, key: 'S3', mode: 'PORTION_WISE',
      portions: [
        { qtyKg: 1600, lr: 22.4, fat: 2.3, person: 'REJECT', fail: ['LR', 'FAT', 'ADULTERATION'], remarks: 'Added water suspected: LR 22.4 and fat 2.3 far below the limits.' },
        { qtyKg: 1450, lr: 27.1, fat: 3.3, person: 'REJECT', fail: ['ACIDITY', 'SOUR', 'FAT'], remarks: 'High acidity 0.24%, sour smell. Not fit for chilling.' },
        { qtyKg: 1300, lr: 28.0, fat: 3.8, person: 'REJECT', fail: ['SOUR', 'TEMP', 'ACIDITY'], remarks: 'Clot on boiling positive and milk temperature 13.5 C at arrival.' },
      ],
      hcExit: { afterMin: 30 },
    });
    return `${arr.zmcc_token} / DEMO-SCN-FDA-7712 / Mian Rafique; 3 of 3 portions rejected, journey closed (ALL_PORTIONS_REJECTED), exit REJECTED`;
  });

  // 4. Lab exceptions: pending manager review, approved (OKAY), rejected by manager (NO)
  await scenario('S4a HC exception PENDING review', () => hcExists(has, 'S4A'), async () => {
    const t0 = minsAgo(150);
    const arr = await createHcArrival(has, 'S4A', sup.khalid, 'DEMO-SCN-LEC-5108', t0);
    await buildSession(has, policies, {
      kind: 'HC', arrivalId: arr.id, arrivalAt: t0, key: 'S4A', mode: 'COMPOSITE',
      portions: [{
        qtyKg: 2800, lr: 25.7, fat: 3.8, person: 'ACCEPT', fail: ['LR'], state: 'PENDING_REVIEW',
        remarks: 'LR 25.7 is slightly below 26.00. Milk is fresh and cold (6 C). Requesting manager approval.',
      }],
    });
    return `${arr.zmcc_token} / DEMO-SCN-LEC-5108 / Rana Khalid; LR 25.7 escalated, waiting for the ZMCC Manager`;
  });
  await scenario('S4b HC exception approved OKAY', () => hcExists(has, 'S4B'), async () => {
    const t0 = minsAgo(210);
    const arr = await createHcArrival(has, 'S4B', sup.nadeem, 'DEMO-SCN-LED-3329', t0);
    await buildSession(has, policies, {
      kind: 'HC', arrivalId: arr.id, arrivalAt: t0, key: 'S4B', mode: 'COMPOSITE',
      portions: [{
        qtyKg: 2500, lr: 25.8, fat: 3.9, person: 'ACCEPT', fail: ['LR'], state: 'OKAY',
        remarks: 'LR 25.8 is below 26.00 but the supplier is regular and the milk is fresh.',
        reviewRemarks: 'Checked the sample again with the lab attendant. Acceptable for this regular supplier.',
      }],
    });
    return `${arr.zmcc_token} / DEMO-SCN-LED-3329 / Sheikh Nadeem; manager OKAY, accepted, ready for weighing`;
  });
  await scenario('S4c HC exception rejected NO', () => hcExists(has, 'S4C'), async () => {
    const t0 = daysAgoAt(1, '10:20');
    const arr = await createHcArrival(has, 'S4C', sup.abbas, 'DEMO-SCN-LEE-6640', t0);
    await buildSession(has, policies, {
      kind: 'HC', arrivalId: arr.id, arrivalAt: t0, key: 'S4C', mode: 'COMPOSITE',
      portions: [{
        qtyKg: 2200, lr: 26.2, fat: 3.1, person: 'ACCEPT', fail: ['FAT'], state: 'NO',
        remarks: 'Fat 3.1 is low, supplier says the cows are on green fodder.',
        reviewRemarks: 'Fat is too low and the sample looks watery. Milk is not accepted.',
      }],
      hcExit: { afterMin: 20 },
    });
    return `${arr.zmcc_token} / DEMO-SCN-LEE-6640 / Malik Abbas; manager NO, vehicle rejected, exit REJECTED`;
  });

  // 5. MC journey, 4 shops, different sources, one shop rejected, composite accepted, weighed, unloaded
  await scenario('S5 MC 4 shops, 1 rejected at shop', () => mcExists('S5'), async () => {
    const t0 = daysAgoAt(1, '13:20');
    const j = await createMcJourney('S5', mcVehicles[0].id, t0, [
      { shop: 0, liters: 850, lr: 28.4, fat: 4.0, source: 2, rmr: '95001' },
      { shop: 1, liters: 640, lr: 27.8, fat: 3.8, source: 3, rmr: '95002' },
      { shop: 2, liters: 520, lr: 24.9, fat: 3.0, source: 4, rejected: true, rejectRemarks: 'Watered milk: LR 24.9 and fat 3.0 are below the limits. Rejected at the shop.', rmr: '95003' },
      { shop: 3, liters: 960, lr: 29.0, fat: 4.3, source: 5, rmr: '95004' },
    ]);
    const arr = await createMcArrival('S5', j.journey.id, t0);
    const net = Math.round(j.declaredKg * 1.004); // small weighbridge gain vs declared
    const tare = 5200;
    await buildSession(has, policies, {
      kind: 'MOT', arrivalId: arr.id, arrivalAt: t0, key: 'S5', mode: 'COMPOSITE',
      portions: [{ qtyKg: Math.round(j.declaredKg), lr: j.avgLr, fat: j.avgFat }],
      weights: [tare + net, tare],
      unload: {},
    });
    return `${arr.zmcc_token} / ${j.journey.journey_number} / DEMO-SCN-SGL-101; shops Madni, Baba Fareed, Al-Noor (REJECTED), Rizwan; sources MS-03..MS-06; composite, net ${net} kg unloaded`;
  });

  // 6. MC arrival portion-wise, 3 portions (1 rejected), 3-weight chain, loss vs declared
  await scenario('S6 MC portion-wise with loss', () => mcExists('S6'), async () => {
    const t0 = daysAgoAt(2, '12:40');
    const j = await createMcJourney('S6', mcVehicles[1].id, t0, [
      { shop: 0, liters: 700, lr: 28.2, fat: 3.9, source: 0, rmr: '96001' },
      { shop: 1, liters: 580, lr: 28.6, fat: 4.1, source: 1, rmr: '96002' },
      { shop: 3, liters: 1040, lr: 27.9, fat: 3.8, source: 5, rmr: '96003' },
    ]);
    const arr = await createMcArrival('S6', j.journey.id, t0);
    const total = Math.round(j.declaredKg);
    const p3 = Math.round(total * 0.1);
    const p1 = Math.round((total - p3) / 2);
    const p2 = total - p3 - p1;
    const n1 = Math.round(p1 * 0.99);
    const n2 = Math.round(p2 * 0.995);
    const tare = 4800;
    await buildSession(has, policies, {
      kind: 'MOT', arrivalId: arr.id, arrivalAt: t0, key: 'S6', mode: 'PORTION_WISE',
      portions: [
        { qtyKg: p1, lr: j.avgLr, fat: j.avgFat },
        { qtyKg: p2, lr: j.avgLr, fat: j.avgFat },
        { qtyKg: p3, lr: 27.0, fat: 3.4, person: 'REJECT', fail: ['ACIDITY', 'SOUR', 'FAT'], remarks: 'Last compartment turned sour: acidity 0.21% and clot on boiling positive.' },
      ],
      weights: [tare + n1 + n2, tare + n2, tare],
      unload: {},
    });
    return `${arr.zmcc_token} / ${j.journey.journey_number} / DEMO-SCN-SGL-102; 3 portions (P3 rejected), 3 weights, net ${n1 + n2} kg vs declared ${total} kg (loss)`;
  });

  // 7. Accepted vehicles that never unload: pending close request (HC) and approved close (MC)
  await scenario('S7a HC close-without-unloading PENDING', () => hcExists(has, 'S7A'), async () => {
    const t0 = minsAgo(240);
    const arr = await createHcArrival(has, 'S7A', sup.waseem, 'DEMO-SCN-LEF-2095', t0);
    await buildSession(has, policies, {
      kind: 'HC', arrivalId: arr.id, arrivalAt: t0, key: 'S7A', mode: 'COMPOSITE',
      portions: [{ qtyKg: 2600, lr: 28.3, fat: 3.9 }],
      closeRequest: {
        reasonCode: 'VEHICLE_PROBLEM',
        remarks: 'Unloading pump failed and the tank outlet is blocked. Vehicle is waiting for the manager decision.',
        approved: false,
      },
    });
    return `${arr.zmcc_token} / DEMO-SCN-LEF-2095 / Waseem Khan; accepted, PHE close request pending (VEHICLE_PROBLEM)`;
  });
  await scenario('S7b MC close-without-unloading APPROVED', () => mcExists('S7B'), async () => {
    const t0 = daysAgoAt(2, '16:30');
    const j = await createMcJourney('S7B', mcVehicles[2].id, t0, [
      { shop: 0, liters: 560, lr: 28.0, fat: 3.9, source: 0, rmr: '97001' },
      { shop: 1, liters: 420, lr: 28.3, fat: 4.0, source: 1, rmr: '97002' },
    ]);
    const arr = await createMcArrival('S7B', j.journey.id, t0);
    await buildSession(has, policies, {
      kind: 'MOT', arrivalId: arr.id, arrivalAt: t0, key: 'S7B', mode: 'COMPOSITE',
      portions: [{ qtyKg: Math.round(j.declaredKg), lr: j.avgLr, fat: j.avgFat }],
      closeRequest: {
        reasonCode: 'SENT_BACK',
        remarks: 'Tank was under cleaning. Manager approved sending the milk back to the shop chiller.',
        approved: true,
      },
    });
    return `${arr.zmcc_token} / ${j.journey.journey_number}; accepted, CLOSED_WITHOUT_UNLOADING approved (ACCEPTED_NOT_RECEIVED), whole declared quantity counted as area loss`;
  });

  // 8. HC partly received, HC waiting for the lab, HC mid-testing
  await scenario('S8a HC partly received (tank full)', () => hcExists(has, 'S8A'), async () => {
    const t0 = daysAgoAt(1, '11:40');
    const arr = await createHcArrival(has, 'S8A', sup.ditta, 'DEMO-SCN-LEG-8123', t0);
    await buildSession(has, policies, {
      kind: 'HC', arrivalId: arr.id, arrivalAt: t0, key: 'S8A', mode: 'PORTION_WISE',
      portions: [
        { qtyKg: 1400, lr: 28.1, fat: 3.9 },
        { qtyKg: 1300, lr: 28.4, fat: 4.0 },
      ],
      weights: [7300, 5920, 4620],
      unload: { source: hasMs[0], onlyPortionNumbers: [1] },
      hcExit: {
        afterMin: 12, reasonCode: 'TANK_FULL',
        remarks: 'Tank was full after the first portion. The driver took the second portion back.',
      },
    });
    return `${arr.zmcc_token} / DEMO-SCN-LEG-8123 / Allah Ditta; portion 1 unloaded (1380 kg), portion 2 taken back (TANK_FULL), exit PARTLY_RECEIVED`;
  });
  await scenario('S8b HC waiting for lab testing', () => hcExists(has, 'S8B'), async () => {
    const t0 = minsAgo(25);
    const arr = await createHcArrival(has, 'S8B', sup.nawaz, 'DEMO-SCN-LEH-4471', t0);
    return `${arr.zmcc_token} / DEMO-SCN-LEH-4471 / Nawaz Sharif; arrived, no lab session yet`;
  });
  await scenario('S8c HC mid-testing', () => hcExists(has, 'S8C'), async () => {
    const t0 = minsAgo(90);
    const arr = await createHcArrival(has, 'S8C', sup.iqbal, 'DEMO-SCN-LEJ-5588', t0);
    await buildSession(has, policies, {
      kind: 'HC', arrivalId: arr.id, arrivalAt: t0, key: 'S8C', mode: 'PORTION_WISE',
      portions: [
        { qtyKg: 1700, lr: 28.7, fat: 4.2 },
        { qtyKg: 0, lr: 0, fat: 0, state: 'TESTING' },
        { qtyKg: 0, lr: 0, fat: 0, state: 'TESTING' },
      ],
    });
    return `${arr.zmcc_token} / DEMO-SCN-LEJ-5588 / Muhammad Iqbal; session IN_PROGRESS, portion 1 accepted, portions 2 and 3 still testing`;
  });

  // 9. Manual net entry sessions (stored exactly as saveWeighingValues does; policy is not touched)
  await scenario('S9a HC manual net entry LITER', () => hcExists(has, 'S9A'), async () => {
    const t0 = daysAgoAt(3, '08:30');
    const arr = await createHcArrival(has, 'S9A', sup.aslam, 'DEMO-SCN-LEK-3301', t0);
    await buildSession(has, policies, {
      kind: 'HC', arrivalId: arr.id, arrivalAt: t0, key: 'S9A', mode: 'COMPOSITE',
      portions: [{ qtyKg: 2400, lr: 28.5, fat: 4.0, manualNet: { value: 2330, unit: 'LITER' } }],
      unload: { source: hasMs[2] },
      hcExit: { afterMin: 14 },
    });
    return `${arr.zmcc_token} / DEMO-SCN-LEK-3301 / Aslam; net_entry_mode MANUAL, 2330 L typed (net kg = litres x density), source ${hasMs[2].name}`;
  });
  await scenario('S9b HC manual net entry KG', () => hcExists(has, 'S9B'), async () => {
    const t0 = daysAgoAt(3, '10:50');
    const arr = await createHcArrival(has, 'S9B', sup.bashir, 'DEMO-SCN-LEL-9012', t0);
    await buildSession(has, policies, {
      kind: 'HC', arrivalId: arr.id, arrivalAt: t0, key: 'S9B', mode: 'PORTION_WISE',
      portions: [
        { qtyKg: 1250, lr: 28.0, fat: 3.8, manualNet: { value: 1250, unit: 'KG' } },
        { qtyKg: 1500, lr: 29.0, fat: 4.2, manualNet: { value: 1480, unit: 'KG' } },
      ],
      unload: { source: hasMs[3] },
      hcExit: { afterMin: 14 },
    });
    return `${arr.zmcc_token} / DEMO-SCN-LEL-9012 / Bashir; net_entry_mode MANUAL, 1250 kg + 1480 kg typed, source ${hasMs[3].name}`;
  });

  // ===================================================================================================
  // Scenario 10: ZMCC Jhang (so multi-ZMCC reports have data)
  // ===================================================================================================
  if (!jhangSource) {
    console.log('\nZMCC-JHANG procurement source not found: Jhang scenarios skipped.');
  } else {
    console.log('\nScenarios at ZMCC Jhang');
    const jManager = need('zmcc.manager.jhang', ['ZMCC_MANAGER']);
    const jLab = need('zmcc.operator.jhang', ['ZMCC_LAB_ATTENDANT']);
    const jPhe = byName('phe.operator.jhang') ?? byName('mdo.jhang') ?? hasPhe;
    const jTank = await ensureTank(jhangSource, 'DEMO-SCN-TK-JHG-01', 'Jhang Raw Milk Storage Tank 01', jManager);
    const jMs = await Promise.all([
      ensureMilkSource('DEMO-SCN-MS-07', 'Syed Kazim Hussain Shah Dairy', [jhangSource.id]),
      ensureMilkSource('DEMO-SCN-MS-08', 'Sial Cattle Farm Jhang', [jhangSource.id]),
    ]);
    const jhg: Zctx = { tag: 'JHG', src: jhangSource, tank: jTank, manager: jManager, lab: jLab, phe: jPhe, sources: jMs };
    const jSial = await ensureSupplier(jhangSource, 'DEMO - Sial Brothers Milk Supply', '03000000401', '33301-0000401-1', jManager);
    const jRaza = await ensureSupplier(jhangSource, 'DEMO - Syed Ali Raza Dairy', '03000000402', '33301-0000402-3', jManager);

    await scenario('S10a Jhang HC composite received', () => hcExists(jhg, 'J1'), async () => {
      const t0 = daysAgoAt(2, '08:20');
      const arr = await createHcArrival(jhg, 'J1', jSial, 'DEMO-SCN-JHG-1101', t0);
      await buildSession(jhg, policies, {
        kind: 'HC', arrivalId: arr.id, arrivalAt: t0, key: 'J1', mode: 'COMPOSITE',
        portions: [{ qtyKg: 3600, lr: 29.0, fat: 4.3 }],
        weights: [12950, 9360],
        unload: { source: jMs[0] },
        hcExit: { afterMin: 14 },
      });
      return `${arr.zmcc_token} / DEMO-SCN-JHG-1101 / Sial Brothers; composite, net 3590 kg, source ${jMs[0].name}, exit RECEIVED`;
    });
    await scenario('S10b Jhang HC 3 portions, 1 rejected', () => hcExists(jhg, 'J2'), async () => {
      const t0 = daysAgoAt(1, '09:35');
      const arr = await createHcArrival(jhg, 'J2', jRaza, 'DEMO-SCN-JHG-2207', t0);
      await buildSession(jhg, policies, {
        kind: 'HC', arrivalId: arr.id, arrivalAt: t0, key: 'J2', mode: 'PORTION_WISE',
        portions: [
          { qtyKg: 1900, lr: 28.8, fat: 4.1 },
          { qtyKg: 1600, lr: 22.8, fat: 2.5, person: 'REJECT', fail: ['LR', 'FAT', 'ADULTERATION'], remarks: 'Water added: LR 22.8 and fat 2.5 are far below the limits.' },
          { qtyKg: 2000, lr: 28.4, fat: 3.9 },
        ],
        weights: [14100, 12205, 10190],
        unload: { source: jMs[1] },
        hcExit: { afterMin: 15 },
      });
      return `${arr.zmcc_token} / DEMO-SCN-JHG-2207 / Syed Ali Raza; P2 rejected (water), P1 + P3 weighed (3 weights), source ${jMs[1].name}, exit RECEIVED`;
    });
  }

  console.log('\n==================================================');
  console.log(`SCENARIO SEED COMPLETE: ${counters.created} created, ${counters.skipped} skipped (already present).`);
  console.log('==================================================');
  for (const l of summary) console.log(`  * ${l}`);
  const stock = await getTankPhysicalStock(hasTank.id);
  console.log(`\nHasilpur tank ${hasTank.tank_code} physical stock ledger: ${stock.toLocaleString()} gross L`);
  console.log('Cleanup: ALLOW_DEMO_RESET=true npx tsx scripts/reset_demo_operational_data.ts removes every DEMO-SCN-* row.\n');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Fatal error during scenario seeding:', err);
    process.exit(1);
  });
