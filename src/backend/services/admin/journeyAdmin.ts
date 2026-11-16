/**
 * Super Admin: remove a Mobile Tester journey that was assigned by mistake (for example the same journey assigned
 * twice). Only a journey that never carried milk can be removed: no shop collection and no arrival at the ZMCC.
 * A journey with milk on it is never deleted; it is cancelled or corrected instead, so the milk record stays.
 *
 * What goes with it: its planned stops, GPS points, vehicle change requests and summary. A full copy of the journey
 * is written to the audit log first, so the removal can always be traced.
 */
import { prisma } from '@core/db';
import { writeAuditLog, type AuditActor } from '@/backend/core/audit';

export class JourneyDeleteError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

const DELETABLE_STATUSES = new Set(['COLLECTING', 'CANCELLED']);

export interface JourneyDeleteResult {
  journeyNumber: string;
  removed: { stops: number; gpsPoints: number; vehicleRequests: number; summaries: number };
}

/** Why a journey cannot be removed, or null when it can. Pure on the counts, so the rule is tested on its own. */
export function journeyDeleteProblem(j: { status: string; collections: number; arrival: boolean }): string | null {
  if (j.collections > 0) {
    return `This journey has ${j.collections} shop collection${j.collections === 1 ? '' : 's'}. Milk records are never deleted: cancel the journey or correct the records instead.`;
  }
  if (j.arrival) return 'This journey has arrived at the ZMCC. Milk records are never deleted: correct the records instead.';
  if (!DELETABLE_STATUSES.has(j.status.toUpperCase())) return `A journey that is ${j.status.toLowerCase()} cannot be removed.`;
  return null;
}

export async function deleteMotJourney(actor: AuditActor, journeyId: bigint, reason: string): Promise<JourneyDeleteResult> {
  const cleanReason = reason.trim();
  if (cleanReason.length < 3) throw new JourneyDeleteError(400, 'Write why this journey is being removed (at least 3 characters).');

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT id FROM mot_journey WHERE id = ${journeyId} FOR UPDATE`;
    const journey = await tx.motJourney.findUnique({ where: { id: journeyId } });
    if (!journey) throw new JourneyDeleteError(404, 'Journey not found.');

    const [collections, arrival, stops, gpsPoints, vehicleRequests, summaries] = await Promise.all([
      tx.motShopCollection.count({ where: { journey_id: journeyId } }),
      tx.zmccMotArrival.count({ where: { journey_id: journeyId } }),
      tx.motJourneyStop.count({ where: { journey_id: journeyId } }),
      tx.motJourneyLocation.count({ where: { journey_id: journeyId } }),
      tx.motVehicleChangeRequest.count({ where: { journey_id: journeyId } }),
      tx.motJourneySummary.count({ where: { journey_id: journeyId } }),
    ]);
    const problem = journeyDeleteProblem({ status: journey.status, collections, arrival: arrival > 0 });
    if (problem) throw new JourneyDeleteError(409, problem);

    // The copy first: the audit row keeps every field of the journey and what was removed with it.
    await writeAuditLog(tx, {
      tableName: 'mot_journey',
      recordId: journeyId,
      action: 'MOT_JOURNEY_DELETED',
      oldValues: JSON.parse(JSON.stringify(journey, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))),
      newValues: { reason: cleanReason, removed: { stops, gpsPoints, vehicleRequests, summaries } },
      actor,
    });

    await tx.motJourneySummary.deleteMany({ where: { journey_id: journeyId } });
    await tx.motVehicleChangeRequest.deleteMany({ where: { journey_id: journeyId } });
    await tx.motJourneyLocation.deleteMany({ where: { journey_id: journeyId } });
    await tx.motJourneyStop.deleteMany({ where: { journey_id: journeyId } });
    await tx.motJourney.delete({ where: { id: journeyId } });

    return { journeyNumber: journey.journey_number, removed: { stops, gpsPoints, vehicleRequests, summaries } };
  });
}
