import { Prisma } from '@prisma/client';
import { prisma } from '@/backend/core/db';
import { getPakistanDayWindow } from '@/backend/core/business-day';
import { getBatchTankStocks } from '@/backend/services/zmccTankService';
import { createTtlCache } from '@/backend/services/ttlCache';

/** Counts and quantities only, never lab values. */
export interface TvZmccTester {
  journeyId: string;
  testerName: string;
  vehicleNumber: string;
  routeName: string;
  shopsDone: number;
  shopsTotal: number;
  collectedAt13Ts: number;
  /** 0 Assigned, 1 Collecting, 2 Returning, 3 At ZMCC, 4 Lab, 5 In tank */
  stepIndex: number;
}

export interface TvZmccSection {
  id: string;
  name: string;
  steps: { collecting: number; arrived: number; lab: number; inTank: number; dispatched: number };
  tank: { stockAt13Ts: number; stockGross: number; capacityLiters: number };
  receivedToday: { at13Ts: number; gross: number };
  dispatchedToday: { at13Ts: number; gross: number };
  testers: { total: number; rows: TvZmccTester[] };
}

export interface TvZmccBoard {
  updatedAt: string;
  zmccs: TvZmccSection[];
}

export const TV_ZMCC_MAX_TESTER_ROWS = 6;
const ACTIVE_JOURNEY = ['COLLECTING', 'RETURNING', 'ARRIVED'];

const n = (v: unknown) => (v == null ? 0 : Number(v));
const r2 = (v: number) => Number(v.toFixed(2));

/** Position of a journey on the six-step tester stepper. */
export function testerStepIndex(input: { status: string; hasArrival: boolean; hasLab: boolean; inTank: boolean }): number {
  if (input.inTank) return 5;
  if (input.hasLab) return 4;
  if (input.hasArrival || input.status === 'ARRIVED') return 3;
  if (input.status === 'RETURNING') return 2;
  return 1;
}

export async function buildTvZmccBoard(now: Date = new Date()): Promise<TvZmccBoard> {
  const day = getPakistanDayWindow();

  const zmccs = await prisma.procurementSource.findMany({
    where: { source_type: 'ZMCC', is_active: true },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });
  const zmccIds = zmccs.map((z) => z.id);
  if (zmccIds.length === 0) return { updatedAt: now.toISOString(), zmccs: [] };

  const [tanks, journeys, hcWaiting, labGroups, receiptGroups, visitGroups, movements] = await Promise.all([
    prisma.zmccTank.findMany({
      where: { zmcc_id: { in: zmccIds }, is_active: true },
      select: { id: true, zmcc_id: true, capacity_liters: true },
    }),
    prisma.motJourney.findMany({
      where: { zmcc_id: { in: zmccIds }, status: { in: ACTIVE_JOURNEY } },
      orderBy: { started_at: 'asc' },
      select: {
        id: true,
        zmcc_id: true,
        status: true,
        mot_profile: { select: { name: true } },
        mot_vehicle: { select: { vehicle_number: true } },
        route: { select: { name: true } },
        mot_arrival: { select: { id: true, lab_session: { select: { id: true, tank_receipt: { select: { id: true } } } } } },
      },
    }),
    prisma.zmccLocalSupplierArrival.groupBy({
      by: ['zmcc_id'],
      where: { zmcc_id: { in: zmccIds }, arrival_timestamp: { gte: day.start, lte: day.end }, lab_session: { is: null } },
      _count: { _all: true },
    }),
    prisma.zmccLabSession.groupBy({
      by: ['zmcc_id'],
      // Being tested, or tested and accepted but not unloaded into the tank yet.
      where: {
        zmcc_id: { in: zmccIds },
        OR: [{ status: 'IN_PROGRESS' }, { status: 'COMPLETED', final_decision: 'ACCEPTED', tank_receipt: { is: null } }],
      },
      _count: { _all: true },
    }),
    prisma.zmccTankReceipt.groupBy({
      by: ['zmcc_id'],
      where: { zmcc_id: { in: zmccIds }, received_at: { gte: day.start, lte: day.end } },
      _count: { _all: true },
    }),
    prisma.vehicleVisit.groupBy({
      by: ['procurement_source_id'],
      where: {
        procurement_source_id: { in: zmccIds },
        current_status: { notIn: ['DRAFT_DISPATCH', 'PENDING_APPROVAL', 'REOPENED', 'CANCELLED'] },
        portions: { some: { dispatch_info: { is: { dispatch_timestamp: { gte: day.start, lte: day.end } } } } },
      },
      _count: { _all: true },
    }),
    prisma.$queryRaw<Array<{ zmcc_id: bigint; received_13: unknown; received_gross: unknown; issued_13: unknown; issued_gross: unknown }>>`
      SELECT zmcc_id,
        COALESCE(SUM(CASE WHEN transaction_type = 'RECEIPT' OR reference_type = 'SUPER_ADMIN_MANUAL_INTAKE' THEN at_13ts_liters ELSE 0 END), 0) AS received_13,
        COALESCE(SUM(CASE WHEN transaction_type = 'RECEIPT' OR reference_type = 'SUPER_ADMIN_MANUAL_INTAKE' THEN quantity_liters ELSE 0 END), 0) AS received_gross,
        COALESCE(SUM(CASE WHEN transaction_type = 'ISSUE' THEN at_13ts_liters ELSE 0 END), 0) AS issued_13,
        COALESCE(SUM(CASE WHEN transaction_type = 'ISSUE' THEN quantity_liters ELSE 0 END), 0) AS issued_gross
      FROM zmcc_tank_inventory_transaction
      WHERE zmcc_id IN (${Prisma.join(zmccIds)}) AND operational_timestamp >= ${day.start}
      GROUP BY zmcc_id
    `,
  ]);

  const journeyIds = journeys.map((j) => j.id);
  const [stopGroups, collectionGroups, stocks] = await Promise.all([
    journeyIds.length
      ? prisma.motJourneyStop.groupBy({ by: ['journey_id', 'status'], where: { journey_id: { in: journeyIds } }, _count: { _all: true } })
      : Promise.resolve([]),
    journeyIds.length
      ? prisma.motShopCollection.groupBy({
          by: ['journey_id'],
          where: { journey_id: { in: journeyIds }, final_decision: 'ACCEPTED' },
          _sum: { at_13ts_liters: true },
        })
      : Promise.resolve([]),
    getBatchTankStocks(tanks.map((t) => t.id)),
  ]);

  const stopsByJourney = new Map<string, { done: number; total: number }>();
  for (const g of stopGroups) {
    const key = g.journey_id.toString();
    const cur = stopsByJourney.get(key) ?? { done: 0, total: 0 };
    cur.total += g._count._all;
    if (g.status === 'COMPLETED') cur.done += g._count._all;
    stopsByJourney.set(key, cur);
  }
  const collectedByJourney = new Map(collectionGroups.map((g) => [g.journey_id.toString(), n(g._sum.at_13ts_liters)]));
  const hcByZmcc = new Map(hcWaiting.map((g) => [g.zmcc_id.toString(), g._count._all]));
  const labByZmcc = new Map(labGroups.map((g) => [g.zmcc_id.toString(), g._count._all]));
  const receiptByZmcc = new Map(receiptGroups.map((g) => [g.zmcc_id.toString(), g._count._all]));
  const visitByZmcc = new Map(visitGroups.map((g) => [String(g.procurement_source_id), g._count._all]));
  const moveByZmcc = new Map(movements.map((m) => [m.zmcc_id.toString(), m]));

  const sections: TvZmccSection[] = zmccs.map((z) => {
    const key = z.id.toString();
    const zTanks = tanks.filter((t) => t.zmcc_id === z.id);
    const zJourneys = journeys.filter((j) => j.zmcc_id === z.id);
    const move = moveByZmcc.get(key);

    let collecting = 0;
    let arrivedMot = 0;
    const rows: TvZmccTester[] = zJourneys.map((j) => {
      const lab = j.mot_arrival?.lab_session ?? null;
      const stepIndex = testerStepIndex({
        status: j.status,
        hasArrival: !!j.mot_arrival,
        hasLab: !!lab,
        inTank: !!lab?.tank_receipt,
      });
      if (stepIndex <= 2) collecting += 1;
      else if (stepIndex === 3) arrivedMot += 1;
      const stops = stopsByJourney.get(j.id.toString()) ?? { done: 0, total: 0 };
      return {
        journeyId: j.id.toString(),
        testerName: j.mot_profile.name,
        vehicleNumber: j.mot_vehicle.vehicle_number,
        routeName: j.route.name,
        shopsDone: stops.done,
        shopsTotal: stops.total,
        collectedAt13Ts: r2(collectedByJourney.get(j.id.toString()) ?? 0),
        stepIndex,
      };
    });

    return {
      id: key,
      name: z.name,
      steps: {
        collecting,
        arrived: arrivedMot + (hcByZmcc.get(key) ?? 0),
        lab: labByZmcc.get(key) ?? 0,
        inTank: receiptByZmcc.get(key) ?? 0,
        dispatched: visitByZmcc.get(key) ?? 0,
      },
      tank: {
        stockAt13Ts: r2(zTanks.reduce((s, t) => s + (stocks.commercial.get(t.id.toString()) ?? 0), 0)),
        stockGross: r2(zTanks.reduce((s, t) => s + (stocks.physical.get(t.id.toString()) ?? 0), 0)),
        capacityLiters: r2(zTanks.reduce((s, t) => s + n(t.capacity_liters), 0)),
      },
      receivedToday: { at13Ts: r2(n(move?.received_13)), gross: r2(n(move?.received_gross)) },
      dispatchedToday: { at13Ts: r2(n(move?.issued_13)), gross: r2(n(move?.issued_gross)) },
      testers: { total: rows.length, rows: rows.slice(0, TV_ZMCC_MAX_TESTER_ROWS) },
    };
  });

  return { updatedAt: now.toISOString(), zmccs: sections };
}

const cache = createTtlCache<TvZmccBoard>({ ttlMs: 20_000 });

/** The board is the same for every signed-in viewer, so one computation serves all of them for 20 seconds. */
export function getTvZmccBoard(): Promise<TvZmccBoard> {
  return cache.get('board', () => buildTvZmccBoard());
}
