import { prisma } from '@/backend/core/db';
import type { ManagementFilters, ManagementScope, Page, ReconciliationVariance, ZmccAreaReconciliationRow, ZmccReconciliationSummary } from '@/backend/modules/management-reporting';
import { assertManagementFiltersWithinScope, normalizeManagementPage } from '@/backend/modules/management-reporting';
import { signedPercent } from '@/lib/lossGain';
import { calculateAreaDualVariance, serializeMotJourneyOrigin, serializeZmccMeasuredDestination, splitFinalizedAndUnresolved } from './reconciliationService';

function toVariance(origin: number, destination: number | null): ReconciliationVariance | null {
  if (destination == null || origin <= 0) return null;
  const signedVariance = Number((destination - origin).toFixed(2));
  return {
    origin,
    destination,
    signedVariance,
    loss: signedVariance < 0 ? Math.abs(signedVariance) : 0,
    gain: signedVariance > 0 ? signedVariance : 0,
    lossPercent: Number((((origin - destination) / origin) * 100).toFixed(4)),
    signedPercent: Number(((signedVariance / origin) * 100).toFixed(4)),
  };
}

export async function getZmccAreaReconciliation(scope: ManagementScope, filters: ManagementFilters): Promise<Page<ZmccAreaReconciliationRow> & { summary: ZmccReconciliationSummary }> {
  assertManagementFiltersWithinScope(scope, filters);
  const { page, pageSize } = normalizeManagementPage(filters);
  const from = filters.from ? new Date(`${filters.from}T00:00:00.000Z`) : undefined;
  const to = filters.to ? new Date(`${filters.to}T23:59:59.999Z`) : undefined;
  if ((from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime()))) throw new Error('Invalid report date filter.');

  const where = {
    ...(scope.kind === 'ZMCC' ? { zmcc_id: BigInt(scope.zmccId) } : {}),
    ...(filters.sourceId ? { zmcc_id: BigInt(filters.sourceId) } : {}),
    ...(filters.routeId ? { route_id: BigInt(filters.routeId) } : {}),
    ...(from || to ? { operational_date: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
    summary: { isNot: null },
  };
  const journeys = await prisma.motJourney.findMany({
    where,
    include: { zmcc: true, route: true, mot_vehicle: true, summary: true, mot_arrival: { include: { lab_session: true } } },
    orderBy: [{ operational_date: 'desc' }, { id: 'desc' }],
  });
  const rows = journeys.map((journey): ZmccAreaReconciliationRow => {
    const origin = serializeMotJourneyOrigin(journey.summary!);
    const session = journey.mot_arrival?.lab_session;
    const destination = session ? serializeZmccMeasuredDestination(session) : null;
    const isResolved = Boolean(session?.final_decision && destination?.grossLiters != null && destination.at13tsLiters != null);
    const calculated = destination ? calculateAreaDualVariance(origin, destination) : null;
    return {
      journeyId: journey.id.toString(), journeyNumber: journey.journey_number, operationalDate: journey.operational_date.toISOString(),
      source: { id: journey.zmcc.id.toString(), code: journey.zmcc.code, name: journey.zmcc.name },
      route: { id: journey.route.id.toString(), code: journey.route.route_code, name: journey.route.name },
      vehicleNumber: journey.mot_vehicle.vehicle_number, originGrossLiters: origin.grossLiters, originAt13tsLiters: origin.at13tsLiters,
      destinationGrossLiters: destination?.grossLiters ?? null, destinationAt13tsLiters: destination?.at13tsLiters ?? null,
      finalDecision: session?.final_decision === 'ACCEPTED' || session?.final_decision === 'REJECTED' ? session.final_decision : null,
      isResolved,
      gross: calculated ? toVariance(origin.grossLiters, destination!.grossLiters) : null,
      at13ts: calculated ? toVariance(origin.at13tsLiters, destination!.at13tsLiters) : null,
    };
  });
  const visible = filters.exceptionOnly ? rows.filter((row) => !row.isResolved || (row.at13ts?.loss ?? 0) > 0) : rows;
  const groups = splitFinalizedAndUnresolved(visible);
  const summary = groups.finalized.reduce<ZmccReconciliationSummary>((total, row) => ({
    ...total, finalizedJourneys: total.finalizedJourneys + 1,
    grossLossLiters: total.grossLossLiters + (row.gross?.loss ?? 0), grossGainLiters: total.grossGainLiters + (row.gross?.gain ?? 0),
    at13tsLossLiters: total.at13tsLossLiters + (row.at13ts?.loss ?? 0), at13tsGainLiters: total.at13tsGainLiters + (row.at13ts?.gain ?? 0),
    grossOriginLiters: total.grossOriginLiters + (row.gross ? row.gross.origin : 0), at13tsOriginLiters: total.at13tsOriginLiters + (row.at13ts ? row.at13ts.origin : 0),
  }), { finalizedJourneys: 0, unresolvedJourneys: groups.unresolved.length, grossLossLiters: 0, grossGainLiters: 0, at13tsLossLiters: 0, at13tsGainLiters: 0, grossNetLiters: 0, at13tsNetLiters: 0, grossOriginLiters: 0, at13tsOriginLiters: 0, grossNetPercent: null, at13tsNetPercent: null, unresolvedOriginAt13tsLiters: groups.unresolved.reduce((sum, row) => sum + row.originAt13tsLiters, 0) });
  // Totals are the NET of the signed differences: gains offset losses. Percent is net over the total sent.
  summary.grossNetLiters = Number((summary.grossGainLiters - summary.grossLossLiters).toFixed(2));
  summary.at13tsNetLiters = Number((summary.at13tsGainLiters - summary.at13tsLossLiters).toFixed(2));
  summary.grossNetPercent = signedPercent(summary.grossNetLiters, summary.grossOriginLiters);
  summary.at13tsNetPercent = signedPercent(summary.at13tsNetLiters, summary.at13tsOriginLiters);
  const total = visible.length;
  return { items: visible.slice((page - 1) * pageSize, page * pageSize), page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)), summary };
}
