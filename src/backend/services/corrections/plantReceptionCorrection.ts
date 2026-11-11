// Corrects a plant reception: token, vehicle, and weights until the final receipt is posted.
// The direct route and correction tickets both come through here; each checks its own permission first.
import { prisma } from '@/backend/core/db';
import { writeAuditLog, auditActorFromUser } from '@/backend/core/audit';
import { isCorrectionAuthority, isDirectEditAuthority } from '@/backend/core/roles/capabilities';
import { recomputeFinalReceiptTx } from '@/backend/services/siloInventoryService';
import type { User } from '@/backend/core/types';
import { getOperationalBusinessDate } from '@/backend/core/business-day';
import { Prisma } from '@prisma/client';
import { toJsonInput } from '@/lib/json';
import { getErrorMessage } from '@/lib/errors';
import { z } from 'zod';
import type { CorrectionResponse } from './dispatchCorrection';

const respond = (body: unknown, init?: { status?: number }): CorrectionResponse => ({ status: init?.status ?? 200, body });

const patchSchema = z.object({
  recordId: z.string().regex(/^\d{1,18}$/, 'Record ID is required.'),
  reason: z.string().trim().min(5, 'Please write the reason (at least 5 letters).'),
  changes: z.object({
    token_number: z.string().nullable().optional(),
    vehicle_number: z.string().trim().min(1).optional(),
    gross_weight_kg: z.number().positive().optional(),
    tare_weight_kg: z.number().positive().optional(),
    gross_timestamp: z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'Enter a valid date and time.').optional(),
    tare_timestamp: z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'Enter a valid date and time.').optional(),
  }),
});

export async function correctPlantReception(user: User, payload: unknown): Promise<CorrectionResponse> {
  if (!isCorrectionAuthority(user.role)) return respond({ error: 'Forbidden.' }, { status: 403 });

  try {
    const { recordId, reason, changes } = patchSchema.parse(payload);
    const visitId = BigInt(recordId);

    const result = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT id FROM vehicle_visit WHERE id = ${visitId} FOR UPDATE`;
      const visit = await tx.vehicleVisit.findUnique({
        where: { id: visitId },
        include: { weight_ticket: true, dual_reconciliation: { select: { id: true } } },
      });
      if (!visit) throw new Error('Plant reception record not found.');

      const weightsChange = changes.gross_weight_kg !== undefined || changes.tare_weight_kg !== undefined;
      // Silo stock and reconciliation were posted from these weights, so only the Super Admin may reopen them.
      if (weightsChange && visit.dual_reconciliation && !isDirectEditAuthority(user.role)) {
        throw new Error('Final plant receipt is done, so only the Super Admin can change the weights. Nothing was changed.');
      }
      const wt = visit.weight_ticket;
      if (weightsChange && !wt) throw new Error('This vehicle has not been weighed at the plant yet.');

      const oldGross = wt?.gross_weight_kg != null ? Number(wt.gross_weight_kg) : null;
      const oldTare = wt?.tare_weight_kg != null ? Number(wt.tare_weight_kg) : null;
      const gross = changes.gross_weight_kg ?? oldGross;
      const tare = changes.tare_weight_kg ?? oldTare;
      const net = gross !== null && tare !== null ? Number((gross - tare).toFixed(2)) : null;
      if (weightsChange && net !== null && net <= 0) throw new Error('Gross weight must be more than tare weight.');

      const token = changes.token_number !== undefined ? changes.token_number?.trim() || null : visit.token_number;
      const vehicle = changes.vehicle_number?.trim().toUpperCase() ?? visit.vehicle_number;

      await tx.vehicleVisit.update({
        where: { id: visit.id },
        data: {
          token_number: token,
          vehicle_number: vehicle,
          correction_count: { increment: 1 },
          last_corrected_by_user_id: BigInt(user.id),
          last_corrected_at: new Date(),
        },
      });
      if (weightsChange && wt) {
        await tx.weightTicket.update({
          where: { id: wt.id },
          data: {
            gross_weight_kg: gross !== null ? new Prisma.Decimal(gross.toFixed(2)) : undefined,
            tare_weight_kg: tare !== null ? new Prisma.Decimal(tare.toFixed(2)) : undefined,
            net_weight_kg: net !== null ? new Prisma.Decimal(net.toFixed(2)) : undefined,
          },
        });
      }
      if (weightsChange && visit.dual_reconciliation) await recomputeFinalReceiptTx(tx, visit.id);

      if ((changes.gross_timestamp || changes.tare_timestamp) && !wt) throw new Error('This vehicle has not been weighed at the plant yet.');
      if (wt && (changes.gross_timestamp || changes.tare_timestamp)) {
        const grossAt = changes.gross_timestamp ? new Date(changes.gross_timestamp) : wt.gross_timestamp;
        const tareAt = changes.tare_timestamp ? new Date(changes.tare_timestamp) : wt.tare_timestamp;
        if (grossAt && tareAt && tareAt < grossAt) throw new Error('Second weight time cannot be before first weight time.');
        await tx.weightTicket.update({ where: { id: wt.id }, data: { gross_timestamp: grossAt, tare_timestamp: tareAt } });
        // The business date is fixed by the first weight, unless a full QA rejection set it.
        if (changes.gross_timestamp && grossAt && visit.business_date_source !== 'LAST_QA_REJECTION') {
          await tx.vehicleVisit.update({ where: { id: visit.id }, data: { operational_date: new Date(`${getOperationalBusinessDate(grossAt)}T00:00:00.000Z`) } });
        }
        // The silo receipt is dated by the second weight.
        if (changes.tare_timestamp && tareAt) {
          await tx.siloInventoryTransaction.updateMany({ where: { visit_id: visit.id, transaction_type: 'RECEIPT' }, data: { operational_timestamp: tareAt } });
        }
      }
      await writeAuditLog(tx, {
        tableName: 'vehicle_visit',
        recordId: visit.id,
        action: 'PLANT_RECEPTION_CORRECTED',
        oldValues: toJsonInput({
          token_number: visit.token_number,
          vehicle_number: visit.vehicle_number,
          gross_weight_kg: oldGross,
          tare_weight_kg: oldTare,
          net_weight_kg: wt?.net_weight_kg != null ? Number(wt.net_weight_kg) : null,
        }),
        newValues: toJsonInput({ token_number: token, vehicle_number: vehicle, gross_weight_kg: gross, tare_weight_kg: tare, net_weight_kg: net, gross_timestamp: changes.gross_timestamp, tare_timestamp: changes.tare_timestamp, reason }),
        actor: auditActorFromUser(user),
      });
      return { id: visit.id.toString(), visit_number: visit.visit_number };
    });

    return respond({ success: true, data: result });
  } catch (err: unknown) {
    if (err instanceof z.ZodError) {
      return respond({ error: err.issues[0]?.message || 'Validation error' }, { status: 400 });
    }
    console.error('PATCH /api/corrections/records error:', err);
    return respond({ error: getErrorMessage(err) || 'Could not save the correction.' }, { status: 400 });
  }
}
