import { Prisma } from '@prisma/client';
import { prisma } from '@core/db';
import { writeAuditLog } from '@/backend/core/audit';
import { isCorrectionAuthority, isDirectEditAuthority } from '@/backend/core/roles/capabilities';
import { getTankPhysicalStock } from '@/backend/services/zmccTankService';
import { computeAndStoreAreaLossTx } from '@/backend/services/lossCalculationService';
import { createNotificationsForEvent } from '@/backend/services/notificationService';
import { resolveZmccLabAuth } from '@/backend/services/zmccLabService';
import { planTankCorrectionRows } from '@/backend/services/tankCorrectionLedger';
import { auditActorOf, loadLabPolicy } from '@/backend/services/zmcc/labPortionReviewService';
import { buildLabPortionDecision, type LabPortionDecisionDetails } from '@/backend/services/zmcc/labPortionDecision';
import { correctedPortionFigures, receiptTotals } from '@/backend/services/zmcc/labPortionCorrectionCalc';
import type { PersonDecision } from '@/types/stage1-decision';

export interface CorrectLabPortionPayload {
  reason?: string;
  version?: number;
  lr?: number | string | null;
  fat?: number | string | null;
  net_weight_kg?: number | string | null;
  first_weight_kg?: number | string | null;
  second_weight_kg?: number | string | null;
  first_weight_at?: string | null;
  second_weight_at?: string | null;
  /** Tests other than LR and Fat, which have their own fields. */
  results?: Array<{ test_id: string | number; numeric_value?: number | null; text_value?: string | null }>;
  idempotency_key?: string;
}

class CorrectionRefused extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

const OUTSIDE_LIMITS = 'A corrected value is outside the limits. The decision was not changed.';
const optionalNumber = (v: unknown): number | undefined =>
  v === undefined || v === null || String(v).trim() === '' ? undefined : Number(v);
const toNumber = (v: Prisma.Decimal | null | undefined): number | null => (v === null || v === undefined ? null : Number(v));

/**
 * Corrects LR, Fat or net weight of one lab portion. Everything built on those readings moves with them in one
 * transaction: the portion, its decision record, the tank ledger, the tank receipt, the session totals and route loss.
 * Either all of it is saved or none of it is.
 */
export async function correctLabPortion(reqOrUser: Parameters<typeof resolveZmccLabAuth>[0], portionIdParam: string, payload: CorrectLabPortionPayload) {
  const { auth, errorResponse } = await resolveZmccLabAuth(reqOrUser, 'CORRECT_SESSION');
  if (errorResponse) return errorResponse;
  if (!auth) return { status: 401, error: 'Unauthorized.' };
  if (!isCorrectionAuthority(auth.role)) {
    return { status: 403, error: 'Only a Data Executive or Super Admin can correct saved records.' };
  }

  if (!/^\d{1,18}$/.test(portionIdParam)) return { status: 400, error: 'Invalid portion.' };
  const portionId = BigInt(portionIdParam);

  const reason = String(payload?.reason ?? '').trim();
  if (reason.length < 3) return { status: 400, error: 'Please write the reason (at least 3 letters).' };
  const version = Number(payload?.version);
  if (!Number.isInteger(version)) return { status: 400, error: 'Version is required.' };

  const lrInput = optionalNumber(payload?.lr);
  const fatInput = optionalNumber(payload?.fat);
  const netInput = optionalNumber(payload?.net_weight_kg);
  if (lrInput !== undefined && (!Number.isFinite(lrInput) || lrInput <= 0)) return { status: 400, error: 'LR must be more than 0.' };
  if (fatInput !== undefined && (!Number.isFinite(fatInput) || fatInput < 0)) return { status: 400, error: 'Fat cannot be below 0.' };
  if (netInput !== undefined && (!Number.isFinite(netInput) || netInput <= 0)) return { status: 400, error: 'Net weight must be more than 0.' };

  const idempotencyKey = payload?.idempotency_key ? String(payload.idempotency_key).trim() : '';
  if (idempotencyKey) {
    const prior = await prisma.auditLog.findMany({
      where: { table_name: 'zmcc_lab_portion', record_id: portionId, action: 'ZMCC_LAB_PORTION_CORRECTED' },
      orderBy: { id: 'desc' },
      take: 30,
    });
    const match = prior.find((a) => (a.new_values as { idempotency_key?: string } | null)?.idempotency_key === idempotencyKey);
    if (match) {
      const rec = match.new_values as { reason?: string; requested_lr?: number | null; requested_fat?: number | null; requested_net?: number | null };
      const same = rec.reason === reason && rec.requested_lr === (lrInput ?? null) && rec.requested_fat === (fatInput ?? null) && rec.requested_net === (netInput ?? null);
      if (!same) return { status: 409, error: 'This correction key was already used with different values.' };
      return { status: 200, data: { replayed: true, portionId: portionId.toString() } };
    }
  }

  try {
    const data = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT id FROM zmcc_lab_portion WHERE id = ${portionId} FOR UPDATE`;
      const portion = await tx.zmccLabPortion.findUnique({
        where: { id: portionId },
        include: {
          lab_session: {
            include: {
              tank_receipt: true,
              mot_arrival: { select: { journey_id: true, journey: { select: { area_received_liters: true } } } },
              local_supplier_rmr: { select: { status: true } },
            },
          },
        },
      });
      if (!portion) throw new CorrectionRefused(404, 'Portion not found.');
      const session = portion.lab_session;
      if (auth.effectiveZmccId !== null && session.zmcc_id !== auth.effectiveZmccId) {
        throw new CorrectionRefused(403, 'This record is outside your area.');
      }
      if (portion.version !== version) throw new CorrectionRefused(409, 'This portion was changed by someone else. Reload.');
      if (portion.status === 'TESTING') throw new CorrectionRefused(409, 'This portion is still being tested.');
      const waitingForDecision = portion.final_decision === 'PENDING' || portion.review_status === 'PENDING';
      if (waitingForDecision && !isDirectEditAuthority(auth.role)) {
        throw new CorrectionRefused(409, 'This portion is still waiting for a decision. Correct it after the decision.');
      }

      const oldLr = toNumber(portion.lr);
      const oldFat = toNumber(portion.fat);
      const oldNet = toNumber(portion.net_weight_kg);
      const newLr = lrInput ?? oldLr;
      const newFat = fatInput ?? oldFat;
      // Scale weights: the net follows from them.
      const firstKg = optionalNumber(payload?.first_weight_kg) ?? toNumber(portion.first_weight_kg);
      const secondKg = optionalNumber(payload?.second_weight_kg) ?? toNumber(portion.second_weight_kg);
      const weightsGiven = optionalNumber(payload?.first_weight_kg) !== undefined || optionalNumber(payload?.second_weight_kg) !== undefined;
      if (weightsGiven && (firstKg === null || secondKg === null || firstKg <= secondKg)) {
        throw new CorrectionRefused(400, 'First weight must be more than second weight.');
      }
      const firstAt = payload?.first_weight_at ? new Date(payload.first_weight_at) : portion.first_weight_at;
      const secondAt = payload?.second_weight_at ? new Date(payload.second_weight_at) : portion.second_weight_at;
      if ((firstAt && Number.isNaN(firstAt.getTime())) || (secondAt && Number.isNaN(secondAt.getTime()))) throw new CorrectionRefused(400, 'Enter a valid date and time.');
      const timesChanged = firstAt?.getTime() !== portion.first_weight_at?.getTime() || secondAt?.getTime() !== portion.second_weight_at?.getTime();
      const weightsChanged = weightsGiven && (firstKg !== toNumber(portion.first_weight_kg) || secondKg !== toNumber(portion.second_weight_kg));
      const newNet = weightsGiven ? Number((firstKg! - secondKg!).toFixed(3)) : netInput ?? oldNet;
      if (newLr === null || newFat === null) throw new CorrectionRefused(400, 'Enter both LR and Fat.');
      if (netInput !== undefined && oldNet === null) throw new CorrectionRefused(400, 'This portion has not been weighed yet.');
      const savedResults = await tx.zmccLabResult.findMany({ where: { portion_id: portionId } });
      const resultChanges = (Array.isArray(payload?.results) ? payload.results : []).map((item) => {
        const saved = savedResults.find((r) => r.test_id.toString() === String(item.test_id));
        if (!saved) throw new CorrectionRefused(400, `Test ${item.test_id} is not part of this portion.`);
        if (saved.result_type_snapshot === 'CALCULATED') throw new CorrectionRefused(400, `${saved.test_name_snapshot} is calculated and cannot be typed in.`);
        return { saved, numeric: item.numeric_value ?? null, text: item.text_value ?? null };
      }).filter((c) => (c.saved.numeric_value !== null ? Number(c.saved.numeric_value) : null) !== c.numeric || (c.saved.text_value ?? null) !== c.text);
      const changedById = new Map(resultChanges.map((c) => [c.saved.test_id.toString(), c]));
      if (newLr === oldLr && newFat === oldFat && newNet === oldNet && resultChanges.length === 0 && !timesChanged && !weightsChanged) throw new CorrectionRefused(400, 'Nothing was changed.');
      // The paper receipt already states this quantity, so the system must not move away from it.
      if (newNet !== oldNet && session.local_supplier_rmr?.status === 'ACTIVE') {
        throw new CorrectionRefused(409, 'A receipt was already issued for this milk, so its net weight cannot be changed. LR and Fat can still be corrected.');
      }

      const figures = correctedPortionFigures({ netWeightKg: newNet, lr: newLr, fat: newFat });
      if (!figures) throw new CorrectionRefused(400, 'These LR and Fat values cannot be used.');

      const receipt = session.tank_receipt;
      const inTank = !!receipt && portion.status === 'WEIGHED' && portion.final_decision === 'ACCEPTED';
      const oldGross = toNumber(portion.gross_liters) ?? 0;
      const oldAt13 = toNumber(portion.at_13ts_liters) ?? 0;
      const deltaGross = inTank ? Number(((figures.grossLiters ?? 0) - oldGross).toFixed(2)) : 0;
      const deltaAt13 = inTank ? Number(((figures.at13tsLiters ?? 0) - oldAt13).toFixed(2)) : 0;

      if (inTank && receipt) {
        const locked: Array<{ capacity_liters: Prisma.Decimal }> = await tx.$queryRaw`
          SELECT capacity_liters FROM zmcc_tank WHERE id = ${receipt.tank_id} FOR UPDATE`;
        if (locked.length === 0) throw new CorrectionRefused(404, 'Tank not found.');
        const stock = await getTankPhysicalStock(receipt.tank_id, tx);
        if (deltaGross > 0 && deltaGross > Math.max(0, Number(locked[0].capacity_liters) - stock)) {
          throw new CorrectionRefused(409, `The tank has no room for this correction. ${deltaGross.toFixed(2)} L needed.`);
        }
        if (deltaGross < 0 && Math.abs(deltaGross) > stock) {
          throw new CorrectionRefused(409, `This correction would take the tank below zero. Stock is ${stock.toFixed(2)} L.`);
        }
      }

      // Check the new readings against the limits that applied when the portion was decided.
      const oldDetails = portion.decision_details as unknown as LabPortionDecisionDetails | null;
      let newDetails: LabPortionDecisionDetails | null = oldDetails;
      let systemOutcome = portion.system_outcome;
      let nowOutside = false;
      let rejudged: unknown[] | null = null;
      if (oldDetails?.tests?.length) {
        const point = session.arrival_type === 'HC' ? 'ZMCC_LAB_HC' : 'ZMCC_LAB_MC';
        const policy = await loadLabPolicy(point, portion.decided_at ?? new Date(), tx);
        const flags = new Map(policy.tests.map((t) => [t.labTestId, t]));
        const built = buildLabPortionDecision(policy, {
          tests: oldDetails.tests.map((t) => ({
            labTestId: t.labTestId,
            value: flags.get(t.labTestId)?.isLr ? newLr : flags.get(t.labTestId)?.isFat ? newFat : changedById.has(t.labTestId) ? changedById.get(t.labTestId)!.numeric : t.value,
            textValue: changedById.has(t.labTestId) ? changedById.get(t.labTestId)!.text : t.textValue,
          })),
          photos: oldDetails.tests.filter((t) => t.photoCaptureId).map((t) => ({ labTestId: t.labTestId, captureId: t.photoCaptureId! })),
          personDecision: (portion.person_decision ?? 'ACCEPT') as PersonDecision,
          remarks: portion.decision_remarks,
          deciderCanApprove: false,
        });
        systemOutcome = built.decision.systemOutcome;
        rejudged = built.decision.exceptionReasons;
        newDetails = built.details;
        nowOutside = systemOutcome === 'FAIL' && portion.final_decision === 'ACCEPTED';
        if (nowOutside) newDetails = { ...built.details, warnings: [...built.details.warnings, OUTSIDE_LIMITS] };
      }

      const now = new Date();
      const netChanged = newNet !== oldNet;
      await tx.zmccLabPortion.update({
        where: { id: portionId },
        data: {
          lr: new Prisma.Decimal(newLr.toFixed(2)),
          fat: new Prisma.Decimal(newFat.toFixed(2)),
          density: new Prisma.Decimal(figures.density.toFixed(4)),
          snf: new Prisma.Decimal(figures.snf.toFixed(3)),
          ts: new Prisma.Decimal(figures.ts.toFixed(3)),
          system_outcome: systemOutcome,
          ...(waitingForDecision && rejudged ? { exception_reasons: rejudged as unknown as Prisma.InputJsonValue } : {}),
          ...(weightsChanged ? { first_weight_kg: new Prisma.Decimal(firstKg!.toFixed(3)), second_weight_kg: new Prisma.Decimal(secondKg!.toFixed(3)) } : {}),
          ...(timesChanged ? { first_weight_at: firstAt, second_weight_at: secondAt } : {}),
          ...(newDetails ? { decision_details: newDetails as unknown as Prisma.InputJsonValue } : {}),
          ...(figures.grossLiters !== null
            ? {
                gross_liters: new Prisma.Decimal(figures.grossLiters.toFixed(3)),
                at_13ts_liters: new Prisma.Decimal(figures.at13tsLiters!.toFixed(3)),
              }
            : {}),
          ...(netChanged && newNet !== null
            ? {
                net_weight_kg: new Prisma.Decimal(newNet.toFixed(3)),
                ...(portion.net_entry_mode === 'MANUAL' ? { net_entry_value: new Prisma.Decimal(newNet.toFixed(3)), net_entry_unit: 'KG' as const } : {}),
              }
            : {}),
          version: { increment: 1 },
        },
      });

      for (const c of resultChanges) {
        const outcome = newDetails?.tests?.find((t) => t.labTestId === c.saved.test_id.toString())?.outcome;
        await tx.zmccLabResult.update({
          where: { id: c.saved.id },
          data: {
            numeric_value: c.numeric !== null ? new Prisma.Decimal(c.numeric) : null,
            text_value: c.text,
            ...(outcome === 'FAIL' ? { is_passed: false } : outcome === 'PASS' || outcome === 'WARN' ? { is_passed: true } : {}),
          },
        });
      }

      const correctionNumber = session.correction_count + 1;
      if (inTank && receipt) {
        for (const row of planTankCorrectionRows(deltaGross, deltaAt13)) {
          await tx.zmccTankInventoryTransaction.create({
            data: {
              tank_id: receipt.tank_id,
              zmcc_id: session.zmcc_id,
              transaction_type: row.type,
              quantity_liters: new Prisma.Decimal(row.quantityLiters.toFixed(3)),
              at_13ts_liters: new Prisma.Decimal(row.at13Liters.toFixed(3)),
              tank_receipt_id: receipt.id,
              reference_type: 'ZMCC_LAB_SESSION_CORRECTION',
              reference_id: `${session.id}:P${portionId}:${correctionNumber}:${row.kind}`,
              idempotency_key: `ZMCC_TANK_ADJUSTMENT:LAB_PORTION:${portionId}:CORR:${correctionNumber}:${row.kind}`,
              operational_timestamp: now,
              performed_by_user_id: auth.actorUserId,
              notes: `Lab portion correction, session #${session.id} portion ${portion.portion_number} (${deltaGross > 0 ? '+' : ''}${deltaGross} L, @13: ${deltaAt13 > 0 ? '+' : ''}${deltaAt13} L)`,
            },
          });
        }

        // The receipt, like the session, holds the whole vehicle.
        const weighed = await tx.zmccLabPortion.findMany({ where: { lab_session_id: session.id, final_decision: 'ACCEPTED', status: 'WEIGHED' } });
        const totals = receiptTotals(
          weighed.map((p) => ({
            netWeightKg: Number(p.net_weight_kg ?? 0),
            grossLiters: Number(p.gross_liters ?? 0),
            at13tsLiters: Number(p.at_13ts_liters ?? 0),
            density: Number(p.density ?? 0),
            lr: Number(p.lr ?? 0),
            fat: Number(p.fat ?? 0),
            snf: Number(p.snf ?? 0),
            ts: Number(p.ts ?? 0),
          })),
        );
        await tx.zmccTankReceipt.update({
          where: { id: receipt.id },
          data: {
            quantity_value: new Prisma.Decimal(totals.netWeightKg.toFixed(3)),
            gross_liters: new Prisma.Decimal(totals.grossLiters.toFixed(3)),
            at_13ts_liters: new Prisma.Decimal(totals.at13tsLiters.toFixed(3)),
            density: new Prisma.Decimal(totals.density.toFixed(4)),
            lr: new Prisma.Decimal(totals.lr.toFixed(2)),
            fat: new Prisma.Decimal(totals.fat.toFixed(2)),
            snf: new Prisma.Decimal(totals.snf.toFixed(3)),
            ts: new Prisma.Decimal(totals.ts.toFixed(3)),
            correction_count: { increment: 1 },
            last_corrected_by_user_id: auth.actorUserId,
            last_corrected_at: now,
          },
        });
        await tx.zmccLabSession.update({
          where: { id: session.id },
          data: {
            gross_liters: new Prisma.Decimal(totals.grossLiters.toFixed(3)),
            at_13ts_liters: new Prisma.Decimal(totals.at13tsLiters.toFixed(3)),
            density: new Prisma.Decimal(totals.density.toFixed(4)),
            snf: new Prisma.Decimal(totals.snf.toFixed(3)),
            ts: new Prisma.Decimal(totals.ts.toFixed(3)),
          },
        });

        // Route loss was stored when the journey closed, so it moves with the received figures.
        if (session.mot_arrival?.journey?.area_received_liters != null) {
          await computeAndStoreAreaLossTx(tx, { journeyId: session.mot_arrival.journey_id, sessionId: session.id, actor: auth.acting });
        }
      }

      await tx.zmccLabSession.update({
        where: { id: session.id },
        data: { correction_count: { increment: 1 }, last_corrected_by_user_id: auth.actorUserId, last_corrected_at: now },
      });

      await writeAuditLog(tx, {
        tableName: 'zmcc_lab_portion',
        recordId: portionId,
        action: 'ZMCC_LAB_PORTION_CORRECTED',
        oldValues: { lr: oldLr, fat: oldFat, net_weight_kg: oldNet, gross_liters: oldGross, at_13ts_liters: oldAt13, system_outcome: portion.system_outcome, version },
        newValues: {
          idempotency_key: idempotencyKey || null,
          reason,
          requested_lr: lrInput ?? null,
          requested_fat: fatInput ?? null,
          requested_net: netInput ?? null,
          results: resultChanges.map((c) => ({
            test_id: c.saved.test_id.toString(),
            old_numeric: c.saved.numeric_value !== null ? Number(c.saved.numeric_value) : null,
            new_numeric: c.numeric,
            old_text: c.saved.text_value,
            new_text: c.text,
          })),
          lab_session_id: session.id.toString(),
          portion_number: portion.portion_number,
          lr: newLr,
          fat: newFat,
          net_weight_kg: newNet,
          gross_liters: figures.grossLiters,
          at_13ts_liters: figures.at13tsLiters,
          system_outcome: systemOutcome,
          correction_number: correctionNumber,
        },
        actor: auditActorOf(auth.acting),
      });

      if (nowOutside) {
        await createNotificationsForEvent(tx, {
          eventKey: 'ZMCC_LAB_WARNING_LOGGED',
          sourceId: portionId.toString(),
          sourceZmccId: session.zmcc_id,
          title: `Corrected lab value is outside limits: Portion ${portion.portion_number}`,
          body: `Session #${session.id} portion ${portion.portion_number}: LR ${newLr}, Fat ${newFat}. The decision was not changed. Reason: ${reason}`,
          deepLink: '/zmcc/lab?tab=history',
          dedupeSuffix: `portion-correction:${portionId}:${correctionNumber}`,
        });
      }

      return {
        portionId: portionId.toString(),
        lr: newLr,
        fat: newFat,
        netWeightKg: newNet,
        grossLiters: figures.grossLiters,
        at13tsLiters: figures.at13tsLiters,
        changedTank: inTank,
        outsideLimits: nowOutside,
      };
    }, { timeout: 30000 });
    return { status: 200, data };
  } catch (err) {
    if (err instanceof CorrectionRefused) return { status: err.status, error: err.message };
    console.error('correctLabPortion error:', err);
    return { status: 500, error: 'Could not save the correction. Nothing was changed.' };
  }
}
