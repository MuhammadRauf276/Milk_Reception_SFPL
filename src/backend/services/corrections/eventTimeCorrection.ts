// Corrects recorded event times: plant gate entry and exit, and ZMCC exit. Times only, so no stock or loss figure moves.
import { prisma } from '@/backend/core/db';
import { writeAuditLog, auditActorFromUser } from '@/backend/core/audit';
import type { User } from '@/backend/core/types';
import { toJsonInput } from '@/lib/json';
import { getErrorMessage } from '@/lib/errors';
import { z } from 'zod';
import { moveUnloadingSiloTx } from '@/backend/services/siloInventoryService';
import type { CorrectionResponse } from './dispatchCorrection';

const respond = (body: unknown, init?: { status?: number }): CorrectionResponse => ({ status: init?.status ?? 200, body });

const when = z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'Enter a valid date and time.');

const schema = z.object({
  entity: z.enum(['GATE_LOG', 'ZMCC_EXIT', 'UNLOADING']),
  recordId: z.string().regex(/^((MC|HC):)?\d{1,18}$/, 'Record ID is required.'),
  reason: z.string().trim().min(5, 'Please write the reason (at least 5 letters).'),
  changes: z.object({
    entry_timestamp: when.optional(),
    exit_timestamp: when.optional(),
    pump_start_timestamp: when.optional(),
    pump_end_timestamp: when.optional(),
    silo_id: z.string().regex(/^\d{1,18}$/).optional(),
  }),
});

export async function correctEventTimes(user: User, payload: unknown): Promise<CorrectionResponse> {
  try {
    const { entity, recordId, reason, changes } = schema.parse(payload);
    const actor = auditActorFromUser(user);
    const userId = BigInt(user.id);

    if (entity === 'GATE_LOG') {
      const visitId = BigInt(recordId);
      await prisma.$transaction(async (tx) => {
        const gate = await tx.gateLog.findUnique({ where: { visit_id: visitId } });
        if (!gate) throw new Error('Gate record not found.');
        const entry = changes.entry_timestamp ? new Date(changes.entry_timestamp) : gate.entry_timestamp;
        const exit = changes.exit_timestamp ? new Date(changes.exit_timestamp) : gate.exit_timestamp;
        if (entry && exit && exit < entry) throw new Error('Exit time cannot be before entry time.');
        await tx.gateLog.update({ where: { id: gate.id }, data: { entry_timestamp: entry, exit_timestamp: exit } });
        await tx.vehicleVisit.update({
          where: { id: visitId },
          data: { correction_count: { increment: 1 }, last_corrected_by_user_id: userId, last_corrected_at: new Date() },
        });
        await writeAuditLog(tx, {
          tableName: 'gate_log',
          recordId: gate.id,
          action: 'GATE_TIMES_CORRECTED',
          oldValues: toJsonInput({ entry_timestamp: gate.entry_timestamp, exit_timestamp: gate.exit_timestamp }),
          newValues: toJsonInput({ entry_timestamp: entry, exit_timestamp: exit, reason }),
          actor,
        });
      });
      return respond({ success: true });
    }

    if (entity === 'UNLOADING') {
      const portionId = BigInt(recordId);
      await prisma.$transaction(async (tx) => {
        const log = await tx.unloadingLog.findUnique({ where: { portion_id: portionId }, include: { portion: { select: { visit_id: true } } } });
        if (!log) throw new Error('Unloading record not found.');
        const start = changes.pump_start_timestamp ? new Date(changes.pump_start_timestamp) : log.pump_start_timestamp;
        const end = changes.pump_end_timestamp ? new Date(changes.pump_end_timestamp) : log.pump_end_timestamp;
        if (start && end && end < start) throw new Error('Pump end time cannot be before pump start time.');
        await tx.unloadingLog.update({ where: { id: log.id }, data: { pump_start_timestamp: start, pump_end_timestamp: end } });

        const siloChange = changes.silo_id && BigInt(changes.silo_id) !== log.silo_id ? BigInt(changes.silo_id) : null;
        if (siloChange !== null) await moveUnloadingSiloTx(tx, log.portion.visit_id, portionId, siloChange);
        await writeAuditLog(tx, {
          tableName: 'unloading_log',
          recordId: log.id,
          action: 'UNLOADING_CORRECTED',
          oldValues: toJsonInput({ pump_start_timestamp: log.pump_start_timestamp, pump_end_timestamp: log.pump_end_timestamp, silo_id: log.silo_id }),
          newValues: toJsonInput({ pump_start_timestamp: start, pump_end_timestamp: end, silo_id: siloChange ?? log.silo_id, reason }),
          actor,
        });
      });
      return respond({ success: true });
    }

    const [kind, rawId] = recordId.split(':');
    if (!rawId || !changes.exit_timestamp) return respond({ error: 'Enter the exit time.' }, { status: 400 });
    const id = BigInt(rawId);
    const exit = new Date(changes.exit_timestamp);
    await prisma.$transaction(async (tx) => {
      const row =
        kind === 'MC'
          ? await tx.zmccMotArrival.findUnique({ where: { id }, select: { id: true, arrival_timestamp: true, exit_timestamp: true } })
          : await tx.zmccLocalSupplierArrival.findUnique({ where: { id }, select: { id: true, arrival_timestamp: true, exit_timestamp: true } });
      if (!row) throw new Error('Arrival record not found.');
      if (exit < row.arrival_timestamp) throw new Error('Exit time cannot be before arrival time.');
      const data = {
        exit_timestamp: exit,
        exit_correction_count: { increment: 1 },
        exit_last_corrected_by_user_id: userId,
        exit_last_corrected_at: new Date(),
      };
      if (kind === 'MC') await tx.zmccMotArrival.update({ where: { id }, data });
      else await tx.zmccLocalSupplierArrival.update({ where: { id }, data });
      await writeAuditLog(tx, {
        tableName: kind === 'MC' ? 'zmcc_mot_arrival' : 'zmcc_local_supplier_arrival',
        recordId: id,
        action: 'ZMCC_EXIT_TIME_CORRECTED',
        oldValues: toJsonInput({ exit_timestamp: row.exit_timestamp }),
        newValues: toJsonInput({ exit_timestamp: exit, reason }),
        actor,
      });
    });
    return respond({ success: true });
  } catch (err) {
    if (err instanceof z.ZodError) return respond({ error: err.issues[0]?.message || 'Validation error' }, { status: 400 });
    return respond({ error: getErrorMessage(err) || 'Could not save the correction.' }, { status: 400 });
  }
}
