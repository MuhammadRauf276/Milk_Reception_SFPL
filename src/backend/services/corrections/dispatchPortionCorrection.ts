// Corrects one dispatch portion's saved test values. If its LR or Fat changes, the vehicle's weighted figures,
// tank ledger and reconciliation move with it in the same transaction.
import { prisma } from '@/backend/core/db';
import { writeAuditLog, auditActorFromUser } from '@/backend/core/audit';
import type { User } from '@/backend/core/types';
import { isDirectEditAuthority } from '@/backend/core/roles/capabilities';
import { Prisma, type LabTest } from '@prisma/client';
import { z } from 'zod';
import {
  buildDispatchDecision,
  computeDispatchTotals,
  DISPATCH_STATUS,
  loadDispatchPolicy,
  type DispatchDecisionDetails,
} from '@/backend/services/dispatch/dispatchDecisionService';
import { isPlantFatTest, isPlantLrTest } from '@/backend/services/vehicleQuantityService';
import type { PersonDecision } from '@/types/stage1-decision';
import { toJsonInput } from '@/lib/json';
import { getErrorMessage } from '@/lib/errors';
import { correctDispatchVisit, type CorrectionResponse } from './dispatchCorrection';

const schema = z.object({
  visitId: z.string().regex(/^\d{1,18}$/),
  portionId: z.string().regex(/^\d{1,18}$/),
  reason: z.string().trim().min(5, 'Please write the reason (at least 5 letters).'),
  results: z
    .array(z.object({ test_id: z.string().regex(/^\d{1,18}$/), numeric_value: z.number().nullable().optional(), text_value: z.string().nullable().optional() }))
    .min(1, 'Change at least one test.'),
});

/** A saved dispatch test result, or one the Super Admin is filling in for the first time (no row yet, `id` null). */
interface SavedTest {
  id: bigint | null;
  test_id: bigint;
  numeric_value: Prisma.Decimal | null;
  text_value: string | null;
  performance_status: string;
  lab_test: LabTest | null;
}

export async function correctDispatchPortionTests(user: User, payload: unknown): Promise<CorrectionResponse> {
  try {
    const { visitId: visitIdStr, portionId: portionIdStr, reason, results } = schema.parse(payload);
    const visitId = BigInt(visitIdStr);
    const portionId = BigInt(portionIdStr);

    const visit = await prisma.vehicleVisit.findUnique({
      where: { id: visitId },
      include: { portions: { include: { dispatch_lab_results: { include: { lab_test: true } } }, orderBy: { portion_number: 'asc' } } },
    });
    if (!visit) return { status: 404, body: { error: 'Dispatch not found.' } };
    const portion = visit.portions.find((p) => p.id === portionId);
    if (!portion) return { status: 404, body: { error: 'Portion not found on this dispatch.' } };

    // Only the Super Admin can fill in a test that was assigned to the dispatch but never entered.
    const assigned = isDirectEditAuthority(user.role)
      ? await prisma.labTestAssignment.findMany({ where: { visit_id: visitId, workflow: 'DISPATCH' }, include: { lab_test: true } })
      : [];
    const changes = results
      .map((item) => {
        let saved: SavedTest | undefined = portion.dispatch_lab_results.find((r) => r.test_id.toString() === item.test_id);
        if (!saved) {
          const a = assigned.find((x) => x.test_id.toString() === item.test_id);
          if (!a) throw new Error(`Test ${item.test_id} is not part of this portion.`);
          saved = { id: null, test_id: a.test_id, numeric_value: null, text_value: null, performance_status: 'PERFORMED', lab_test: a.lab_test };
        }
        if (saved.lab_test?.resultType === 'CALCULATED') throw new Error(`${saved.lab_test.testName} is calculated and cannot be typed in.`);
        return { saved, numeric: item.numeric_value ?? null, text: item.text_value ?? null };
      })
      .filter((c) => (c.saved.numeric_value !== null ? Number(c.saved.numeric_value) : null) !== c.numeric || (c.saved.text_value ?? null) !== c.text);
    if (changes.length === 0) return { status: 400, body: { error: 'Nothing was changed.' } };
    const byTest = new Map(changes.map((c) => [c.saved.test_id.toString(), c]));

    // Re-judge against the limits that applied when the dispatch was submitted. The decision itself is not reopened.
    const oldDetails = visit.dispatch_decision_details as unknown as DispatchDecisionDetails | null;
    let rebuilt: ReturnType<typeof buildDispatchDecision> | null = null;
    if (oldDetails?.portions?.length) {
      const policy = await loadDispatchPolicy(oldDetails.point as Parameters<typeof loadDispatchPolicy>[0], visit.dispatch_submitted_at ?? visit.created_at);
      rebuilt = buildDispatchDecision(policy, {
        testMode: oldDetails.testMode,
        labReportCaptureId: oldDetails.labReport?.captureId ?? null,
        personDecision: (visit.dispatch_person_decision ?? 'ACCEPT') as PersonDecision,
        remarks: visit.dispatch_decision_remarks,
        deciderCanApprove: false,
        portions: oldDetails.portions.map((p) => ({
          portionNumber: p.portionNumber,
          sealNumber: p.sealNumber,
          quantityValue: p.quantityValue,
          quantityUnit: p.quantityUnit,
          photos: p.photos,
          tests: p.tests.map((t) => {
            const c = p.portionNumber === portion.portion_number ? byTest.get(t.labTestId) : undefined;
            return { labTestId: t.labTestId, value: c ? c.numeric : t.value, textValue: c ? c.text : t.textValue };
          }),
        })),
      });
    }

    const save = async (tx: Prisma.TransactionClient) => {
      const judged = rebuilt?.details.portions.find((p) => p.portionNumber === portion.portion_number)?.tests;
      for (const c of changes) {
        const outcome = judged?.find((t) => t.labTestId === c.saved.test_id.toString())?.outcome;
        const data = {
          numeric_value: c.numeric !== null ? new Prisma.Decimal(c.numeric) : null,
          text_value: c.text,
          ...(outcome === 'FAIL' ? { is_passed: false } : outcome === 'PASS' || outcome === 'WARN' ? { is_passed: true } : {}),
        };
        if (c.saved.id === null) {
          await tx.dispatchLabResult.create({
            data: { ...data, visit_id: visitId, portion_id: portionId, test_id: c.saved.test_id, performance_status: 'PERFORMED', sample_timestamp: new Date(), result_timestamp: new Date(), tested_by: BigInt(user.id) },
          });
        } else {
          // A test that was marked not performed becomes performed, by the Super Admin.
          const nowPerformed = c.saved.performance_status !== 'PERFORMED';
          await tx.dispatchLabResult.update({
            where: { id: c.saved.id },
            data: { ...data, ...(nowPerformed ? { performance_status: 'PERFORMED', not_performed_reason: null, tested_by: BigInt(user.id), result_timestamp: new Date() } : {}) },
          });
        }
      }
      if (rebuilt) {
        await tx.vehicleVisit.update({
          where: { id: visitId },
          data: {
            dispatch_decision_details: rebuilt.details as unknown as Prisma.InputJsonValue,
            dispatch_system_outcome: rebuilt.decision.systemOutcome,
            ...(visit.current_status === DISPATCH_STATUS.PENDING_APPROVAL
              ? { dispatch_exception_reasons: rebuilt.decision.exceptionReasons as unknown as Prisma.InputJsonValue }
              : {}),
          },
        });
      }
      await writeAuditLog(tx, {
        tableName: 'visit_portion',
        recordId: portionId,
        action: 'DISPATCH_PORTION_TESTS_CORRECTED',
        oldValues: toJsonInput({ results: changes.map((c) => ({ test_id: c.saved.test_id.toString(), numeric: c.saved.numeric_value, text: c.saved.text_value })) }),
        newValues: toJsonInput({ reason, results: changes.map((c) => ({ test_id: c.saved.test_id.toString(), numeric: c.numeric, text: c.text })) }),
        actor: auditActorFromUser(user),
      });
    };

    const isQuality = (r: SavedTest) =>
      isPlantLrTest(r.lab_test?.testCode, r.lab_test?.testName, r.lab_test?.systemRole) ||
      isPlantFatTest(r.lab_test?.testCode, r.lab_test?.testName, r.lab_test?.systemRole);

    if (changes.some((c) => isQuality(c.saved))) {
      const valueOf = (p: (typeof visit.portions)[number], test: typeof isPlantLrTest, corrected: boolean) => {
        const row = p.dispatch_lab_results.find((r) => test(r.lab_test?.testCode, r.lab_test?.testName, r.lab_test?.systemRole));
        // A value filled in for a test that had no row yet counts too.
        const filledIn = corrected && p.id === portionId ? changes.find((x) => test(x.saved.lab_test?.testCode, x.saved.lab_test?.testName, x.saved.lab_test?.systemRole)) : undefined;
        if (filledIn) return filledIn.numeric;
        if (!row) return null;
        return row.numeric_value !== null ? Number(row.numeric_value) : null;
      };
      const totalsOf = (corrected: boolean) =>
        computeDispatchTotals(
          visit.portions
            .filter((p) => p.dispatch_quantity_value !== null)
            .map((p) => ({
              quantityValue: Number(p.dispatch_quantity_value),
              quantityUnit: String(p.dispatch_quantity_unit ?? 'LITER'),
              lr: valueOf(p, isPlantLrTest, corrected),
              fat: valueOf(p, isPlantFatTest, corrected),
            }))
        );
      const before = totalsOf(false);
      const totals = totalsOf(true);
      const oldLr = visit.vehicle_dispatch_lr !== null ? Number(visit.vehicle_dispatch_lr) : null;
      const oldFat = visit.vehicle_dispatch_fat !== null ? Number(visit.vehicle_dispatch_fat) : null;
      // The vehicle follows only when its figures came from these portions. A vehicle figure measured or corrected on its own stays.
      const derivedFromPortions = before.weightedLr === oldLr && before.weightedFat === oldFat;
      if (derivedFromPortions && totals.weightedLr > 0 && (totals.weightedLr !== oldLr || totals.weightedFat !== oldFat)) {
        return correctDispatchVisit(
          user,
          visitIdStr,
          { reason, vehicle_dispatch_lr: totals.weightedLr, vehicle_dispatch_fat: totals.weightedFat },
          null,
          save
        );
      }
    }

    await prisma.$transaction(save);
    return { status: 200, body: { success: true } };
  } catch (err) {
    if (err instanceof z.ZodError) return { status: 400, body: { error: err.issues[0]?.message || 'Validation error' } };
    return { status: 400, body: { error: getErrorMessage(err) || 'Could not save the correction.' } };
  }
}
