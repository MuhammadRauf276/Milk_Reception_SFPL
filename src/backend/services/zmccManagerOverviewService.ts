import { prisma } from '@/backend/core/db';

export interface ZmccManagerOverview {
  source: { id: string; code: string; name: string };
  pipeline: {
    expected: number;
    arrived: number;
    waiting: number;
    testing: number;
    accepted: number;
    rejected: number;
    unloaded: number;
    dispatched: number;
  };
  tank: { grossLiters: number; at13TsLiters: number | null; activeTankCount: number };
  dispatch: { ready: number; activeAtPlant: number };
  exceptions: { pendingManagerReview: number; correctionEventsToday: number };
  activeStations: Array<{ recordType: 'MOT_JOURNEY' | 'ZMCC_ARRIVAL'; id: string; label: string; station: string; responsibleRole: string; waitingMinutes: number; journeyTotals?: { shopsCollected: number; quantity: number } }>;
}

/** Builds one manager-safe snapshot. The caller supplies only a trusted ZMCC ID. */
export async function getZmccManagerOverview(zmccId: bigint): Promise<ZmccManagerOverview> {
  const source = await prisma.procurementSource.findFirst({
    where: { id: zmccId, source_type: 'ZMCC', is_active: true },
    select: { id: true, code: true, name: true },
  });
  if (!source) throw new Error('Assigned active ZMCC source was not found.');

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const tomorrowStart = new Date(todayStart);
  tomorrowStart.setDate(tomorrowStart.getDate() + 1);

  const [
    expected,
    motArrived,
    localSupplierArrived,
    contractorArrived,
    testing,
    accepted,
    rejected,
    unloaded,
    dispatched,
    activeAtPlant,
    dispatchReady,
    tanks,
    tankTransactions,
    pendingManagerReview,
    correctionEventsToday,
    activeJourneys,
  ] = await Promise.all([
    prisma.motJourney.count({ where: { zmcc_id: zmccId, status: { in: ['ASSIGNED', 'IN_PROGRESS'] } } }),
    prisma.zmccMotArrival.count({ where: { zmcc_id: zmccId, arrival_date: { gte: todayStart, lt: tomorrowStart } } }),
    prisma.zmccLocalSupplierArrival.count({ where: { zmcc_id: zmccId, arrival_date: { gte: todayStart, lt: tomorrowStart } } }),
    prisma.zmccContractorArrival.count({ where: { zmcc_id: zmccId, arrival_date: { gte: todayStart, lt: tomorrowStart } } }),
    prisma.zmccLabSession.count({ where: { zmcc_id: zmccId, status: 'IN_PROGRESS' } }),
    prisma.zmccLabSession.count({ where: { zmcc_id: zmccId, status: 'COMPLETED', decision: 'ACCEPTED' } }),
    prisma.zmccLabSession.count({ where: { zmcc_id: zmccId, status: 'COMPLETED', decision: 'REJECTED' } }),
    prisma.vehicleVisit.count({ where: { procurement_source_id: zmccId, current_status: { in: ['READY_FOR_TARE', 'READY_FOR_GATE_EXIT', 'COMPLETED'] } } }),
    prisma.vehicleVisit.count({ where: { procurement_source_id: zmccId, current_status: { in: ['DISPATCHED', 'TOKEN_ISSUED', 'PLANT_QA', 'READY_FOR_GROSS', 'READY_FOR_UNLOADING', 'UNLOADING', 'READY_FOR_TARE', 'READY_FOR_GATE_EXIT'] } } }),
    prisma.vehicleVisit.count({ where: { procurement_source_id: zmccId, gate_log: { is: { entry_timestamp: { not: null }, exit_timestamp: null } } } }),
    prisma.vehicleVisit.count({ where: { procurement_source_id: zmccId, current_status: { in: ['DISPATCHED', 'TOKEN_ISSUED'] } } }),
    prisma.zmccTank.count({ where: { zmcc_id: zmccId, is_active: true } }),
    prisma.zmccTankInventoryTransaction.aggregate({ where: { zmcc_id: zmccId }, _sum: { quantity_liters: true, at_13ts_liters: true } }),
    prisma.zmccLabSession.count({ where: { zmcc_id: zmccId, manager_review_status: 'PENDING' } }),
    prisma.auditLog.count({
      where: {
        created_at: { gte: todayStart, lt: tomorrowStart },
        action: { contains: 'CORRECTED' },
        OR: [
          { table_name: { in: ['zmcc_lab_session', 'zmcc_mot_arrival', 'zmcc_local_supplier_arrival', 'mot_shop_collection'] } },
        ],
      },
    }),
    prisma.motJourney.findMany({
      where: { zmcc_id: zmccId, status: { in: ['ASSIGNED', 'IN_PROGRESS', 'COLLECTING'] } },
      include: { collections: { select: { quantity_value: true } } },
      orderBy: { started_at: 'asc' },
      take: 10,
    }),
  ]);

  const arrived = motArrived + localSupplierArrived + contractorArrived;
  const now = Date.now();
  return {
    source: { id: source.id.toString(), code: source.code, name: source.name },
    pipeline: {
      expected,
      arrived,
      waiting: Math.max(0, arrived - testing - accepted - rejected),
      testing,
      accepted,
      rejected,
      unloaded,
      dispatched,
    },
    tank: {
      grossLiters: Number(tankTransactions._sum.quantity_liters ?? 0),
      at13TsLiters: tankTransactions._sum.at_13ts_liters === null ? null : Number(tankTransactions._sum.at_13ts_liters),
      activeTankCount: tanks,
    },
    dispatch: { ready: dispatchReady, activeAtPlant },
    exceptions: { pendingManagerReview, correctionEventsToday },
    activeStations: activeJourneys.map((journey) => ({
      recordType: 'MOT_JOURNEY' as const,
      id: journey.id.toString(),
      label: journey.journey_number,
      station: journey.status === 'COLLECTING' ? 'Shop collection' : 'Journey assigned',
      responsibleRole: 'MOT',
      waitingMinutes: Math.max(0, Math.floor((now - journey.started_at.getTime()) / 60000)),
      journeyTotals: {
        shopsCollected: journey.collections.length,
        quantity: journey.collections.reduce((total, collection) => total + Number(collection.quantity_value), 0),
      },
    })),
  };
}
