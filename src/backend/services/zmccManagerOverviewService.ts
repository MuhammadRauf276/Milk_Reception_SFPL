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
  exceptions: { pendingManagerReview: number; leftWithoutFullUnloading: number; pendingCloseRequests: number };
  exits: { leftWithoutFullUnloading: ZmccExitOutcomeRow[]; pendingCloseRequests: ZmccExitOutcomeRow[] };
  activeStations: Array<{ recordType: 'MOT_JOURNEY' | 'ZMCC_ARRIVAL'; id: string; label: string; station: string; responsibleRole: string; waitingMinutes: number; journeyTotals?: { shopsCollected: number; quantity: number } }>;
}

export interface ZmccExitOutcomeRow {
  sessionId: string;
  zmccId: string;
  /** MC (company vehicle collection) or HC. */
  arrivalLabel: 'MC' | 'HC';
  reference: string;
  vehicleNumber: string | null;
  /** Source name (HC receipts / owner-visible reporting; name only). */
  sourceName: string | null;
  exitOutcome: string | null;
  reasonCode: string | null;
  remarks: string | null;
  recordedBy: string | null;
  recordedAt: string | null;
  requestedBy: string | null;
  requestedAt: string | null;
  acceptedNotReceivedKg: number;
  acceptedNotReceivedLiters: number;
}

const EXIT_WINDOW_DAYS = 30;

function personLabel(u?: { full_name: string | null; username: string } | null): string | null {
  return u ? (u.full_name || u.username) : null;
}

/**
 * Sessions that left or were closed without full unloading, plus pending close-without-unloading requests.
 * `zmccId` omitted = every ZMCC (executive reporting).
 */
export async function listZmccExitOutcomes(zmccId?: bigint, now: Date = new Date()): Promise<{
  left: ZmccExitOutcomeRow[];
  pending: ZmccExitOutcomeRow[];
}> {
  const since = new Date(now.getTime() - EXIT_WINDOW_DAYS * 86400000);
  const zmccWhere = zmccId ? { zmcc_id: zmccId } : {};
  const include = {
    portions: { select: { final_decision: true, status: true, net_weight_kg: true, gross_liters: true } },
    mot_arrival: { select: { zmcc_token: true, exit_recorded_by: { select: { full_name: true, username: true } }, journey: { select: { journey_number: true, mot_vehicle: { select: { vehicle_number: true } } } } } },
    local_supplier_arrival: { select: { zmcc_token: true, vehicle_number: true, milk_source_name_snapshot: true, exit_recorded_by: { select: { full_name: true, username: true } } } },
    tank_receipt: { select: { milk_source_name_snapshot: true } },
  } as const;
  const [leftSessions, pendingSessions] = await Promise.all([
    prisma.zmccLabSession.findMany({
      where: { ...zmccWhere, exit_outcome: { in: ['PARTLY_RECEIVED', 'ACCEPTED_NOT_RECEIVED'] }, updated_at: { gte: since } },
      include,
      orderBy: { updated_at: 'desc' },
      take: 200,
    }),
    prisma.zmccLabSession.findMany({
      where: { ...zmccWhere, close_requested_at: { not: null }, close_approved_at: null, journey_closed_at: null, unloaded_at: null },
      include,
      orderBy: { close_requested_at: 'asc' },
      take: 100,
    }),
  ]);
  const userIds = new Set<bigint>();
  for (const x of [...leftSessions, ...pendingSessions]) {
    if (x.close_approved_by_user_id) userIds.add(x.close_approved_by_user_id);
    if (x.close_requested_by_user_id) userIds.add(x.close_requested_by_user_id);
  }
  const users = userIds.size
    ? await prisma.user.findMany({ where: { id: { in: [...userIds] } }, select: { id: true, full_name: true, username: true } })
    : [];
  const userMap = new Map(users.map((u) => [u.id.toString(), u]));

  const toRow = (x: (typeof leftSessions)[number]): ZmccExitOutcomeRow => {
    const isHc = x.arrival_type === 'HC';
    const notReceived = x.portions.filter((p) => p.final_decision === 'ACCEPTED' && p.status !== 'WEIGHED' && p.status !== 'LOADED');
    const exitBy = isHc ? x.local_supplier_arrival?.exit_recorded_by : x.mot_arrival?.exit_recorded_by;
    const approver = x.close_approved_by_user_id ? userMap.get(x.close_approved_by_user_id.toString()) : null;
    const requester = x.close_requested_by_user_id ? userMap.get(x.close_requested_by_user_id.toString()) : null;
    return {
      sessionId: x.id.toString(),
      zmccId: x.zmcc_id.toString(),
      arrivalLabel: isHc ? 'HC' : 'MC',
      reference: (isHc ? x.local_supplier_arrival?.zmcc_token : x.mot_arrival?.zmcc_token) ?? `Session #${x.id}`,
      vehicleNumber: isHc ? x.local_supplier_arrival?.vehicle_number ?? null : x.mot_arrival?.journey?.mot_vehicle?.vehicle_number ?? null,
      sourceName: isHc ? x.tank_receipt?.milk_source_name_snapshot ?? x.local_supplier_arrival?.milk_source_name_snapshot ?? null : null,
      exitOutcome: x.exit_outcome,
      reasonCode: x.exit_reason_code,
      remarks: x.exit_remarks,
      recordedBy: personLabel(exitBy) ?? personLabel(approver),
      recordedAt: (x.close_approved_at ?? x.updated_at).toISOString(),
      requestedBy: personLabel(requester),
      requestedAt: x.close_requested_at ? x.close_requested_at.toISOString() : null,
      acceptedNotReceivedKg: Number(notReceived.reduce((t, p) => t + Number(p.net_weight_kg ?? 0), 0).toFixed(3)),
      acceptedNotReceivedLiters: Number(notReceived.reduce((t, p) => t + Number(p.gross_liters ?? 0), 0).toFixed(2)),
    };
  };
  return { left: leftSessions.map(toRow), pending: pendingSessions.map(toRow) };
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
    exitData,
    activeJourneys,
  ] = await Promise.all([
    prisma.motJourney.count({ where: { zmcc_id: zmccId, status: { in: ['ASSIGNED', 'IN_PROGRESS'] } } }),
    prisma.zmccMotArrival.count({ where: { zmcc_id: zmccId, arrival_date: { gte: todayStart, lt: tomorrowStart } } }),
    prisma.zmccLocalSupplierArrival.count({ where: { zmcc_id: zmccId, arrival_date: { gte: todayStart, lt: tomorrowStart } } }),
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
    listZmccExitOutcomes(zmccId),
    prisma.motJourney.findMany({
      where: { zmcc_id: zmccId, status: { in: ['ASSIGNED', 'IN_PROGRESS', 'COLLECTING'] } },
      include: { collections: { select: { quantity_value: true } } },
      orderBy: { started_at: 'asc' },
      take: 10,
    }),
  ]);

  const arrived = motArrived + localSupplierArrived;
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
    exceptions: { pendingManagerReview, leftWithoutFullUnloading: exitData.left.length, pendingCloseRequests: exitData.pending.length },
    exits: { leftWithoutFullUnloading: exitData.left, pendingCloseRequests: exitData.pending },
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
