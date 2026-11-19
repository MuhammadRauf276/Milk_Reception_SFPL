import { prisma } from '@/backend/core/db';
import { getPakistanDayWindow } from '@/backend/core/business-day';
import { createTtlCache } from '@/backend/services/ttlCache';
import { resolveApproverNames, type ApprovalWait } from '@/backend/services/tvBoardApprovals';

/** One step of a journey on the yard board. Quantities only, never lab values. */
export type TvStepState = 'done' | 'current' | 'waiting' | 'rejected' | 'upcoming';

export interface TvJourneyStep {
  key: string;
  label: string;
  state: TvStepState;
  /** ISO time the step happened. */
  at?: string | null;
  /** Main figure under the step, e.g. "3 / 7 shops" or "412 L @13 TS". */
  metric?: string | null;
  /** Second line, e.g. "Gross 420 L". */
  note?: string | null;
  /** Set while the step waits for someone's approval. */
  approval?: ApprovalWait | null;
}

export interface TvZmccJourney {
  id: string;
  kind: 'MOT' | 'HC';
  title: string;
  vehicleNumber: string;
  subtitle: string;
  finished: boolean;
  /** When it finished: journey end (Mobile Tester) or gate exit (HC). */
  finishedAt: string | null;
  /** Collected @13 TS (MOT) and received into the ZMCC tank @13 TS; null until known. */
  collectedAt13Ts: number | null;
  receivedAt13Ts: number | null;
  steps: TvJourneyStep[];
}

export interface TvZmccSection {
  id: string;
  name: string;
  testers: { total: number; rows: TvZmccJourney[] };
  hc: { total: number; rows: TvZmccJourney[] };
}

export interface TvZmccBoard {
  updatedAt: string;
  zmccs: TvZmccSection[];
}

export const TV_ZMCC_MAX_ROWS = 6;
const ACTIVE_JOURNEY = ['COLLECTING', 'RETURNING', 'ARRIVED'];
/** An HC vehicle that has not left the gate stays on the board this long. */
const HC_OPEN_DAYS = 3;
/** A finished card (journey ended, vehicle left the gate) stays on the yard board this long, then drops off. */
export const TV_FINISHED_KEEP_MS = 4 * 60 * 60 * 1000;

/** A received vehicle that never gets a gate exit leaves the board this long after its receipt. */
const NO_EXIT_KEEP_MS = 24 * 60 * 60 * 1000;

/** Plant yard board: still shown when not left the gate yet (a received one at most a day), or left within the last few hours. */
export function staysOnTvBoard(
  p: { gate_exit_timestamp?: string | null; final_receipt_timestamp?: string | null } | undefined,
  now: number
): boolean {
  if (!p) return true;
  if (p.gate_exit_timestamp) return now - new Date(p.gate_exit_timestamp).getTime() <= TV_FINISHED_KEEP_MS;
  if (p.final_receipt_timestamp) return now - new Date(p.final_receipt_timestamp).getTime() <= NO_EXIT_KEEP_MS;
  return true;
}

const n = (v: unknown) => (v == null ? 0 : Number(v));
const r2 = (v: number) => Number(v.toFixed(2));
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const lit = (v: number) => `${v.toLocaleString('en-US', { maximumFractionDigits: 0 })} L`;

interface LabInfo {
  status: string;
  final_decision: string | null;
  decision: string | null;
  manager_review_status: string;
  started_at: Date;
  completed_at: Date | null;
  close_requested_at: Date | null;
  close_approved_at: Date | null;
  journey_closed_at: Date | null;
  tank_receipt: { at_13ts_liters: unknown; gross_liters: unknown; received_at: Date } | null;
  _count: { portions: number };
}

const LAB_SELECT = {
  status: true,
  final_decision: true,
  decision: true,
  manager_review_status: true,
  started_at: true,
  completed_at: true,
  close_requested_at: true,
  close_approved_at: true,
  journey_closed_at: true,
  tank_receipt: { select: { at_13ts_liters: true, gross_liters: true, received_at: true } },
  _count: { select: { portions: { where: { review_status: 'PENDING' } } } },
} as const;

const isRejected = (lab: LabInfo | null) => (lab?.final_decision ?? lab?.decision) === 'REJECTED';

/** Lab and Receipt steps, shared by Mobile Tester and HC journeys. `reached` is true once the vehicle is at the ZMCC. */
export function labAndReceiptSteps(lab: LabInfo | null, reached: boolean, zmccManager: ApprovalWait): TvJourneyStep[] {
  const labWaiting = !!lab && (lab.manager_review_status === 'PENDING' || lab._count.portions > 0);
  const labDone = !!lab && lab.status === 'COMPLETED' && !labWaiting;
  // The manager let the vehicle leave before the lab finished (it did not give milk).
  const labStopped = !!lab && !!lab.journey_closed_at && lab.status !== 'COMPLETED';
  const labStep: TvJourneyStep = {
    key: 'lab',
    label: 'Lab',
    at: iso(lab?.completed_at ?? lab?.started_at),
    state: !lab
      ? reached ? 'current' : 'upcoming'
      : labStopped ? 'rejected' : labWaiting ? 'waiting' : labDone ? (isRejected(lab) ? 'rejected' : 'done') : 'current',
    metric: labStopped ? 'Stopped' : labDone ? (isRejected(lab) ? 'Rejected' : 'Accepted') : null,
    approval: labWaiting ? zmccManager : null,
  };

  const receipt = lab?.tank_receipt ?? null;
  const closeWaiting = !!lab?.close_requested_at && !lab.close_approved_at;
  let receiptState: TvStepState = 'upcoming';
  if (receipt) receiptState = 'done';
  else if (closeWaiting) receiptState = 'waiting';
  else if (labDone && isRejected(lab)) receiptState = 'rejected';
  else if (lab?.journey_closed_at) receiptState = 'rejected';
  else if (labDone) receiptState = 'current';
  const receiptStep: TvJourneyStep = {
    key: 'receipt',
    label: 'Receipt',
    state: receiptState,
    at: iso(receipt?.received_at ?? lab?.journey_closed_at),
    metric: receipt ? `${lit(n(receipt.at_13ts_liters))} @13 TS` : receiptState === 'rejected' ? 'Not received' : null,
    note: receipt ? `Gross ${lit(n(receipt.gross_liters))}` : null,
    approval: closeWaiting ? zmccManager : null,
  };
  return [labStep, receiptStep];
}

const stateFor = (done: boolean, current: boolean): TvStepState => (done ? 'done' : current ? 'current' : 'upcoming');

export async function buildTvZmccBoard(now: Date = new Date(), opts: { names?: boolean } = {}): Promise<TvZmccBoard> {
  const day = getPakistanDayWindow();
  const hcSince = new Date(day.start.getTime() - HC_OPEN_DAYS * 24 * 3600 * 1000);
  const keepSince = new Date(now.getTime() - TV_FINISHED_KEEP_MS);

  const zmccs = await prisma.procurementSource.findMany({
    where: { source_type: 'ZMCC', is_active: true },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });
  const zmccIds = zmccs.map((z) => z.id);
  if (zmccIds.length === 0) return { updatedAt: now.toISOString(), zmccs: [] };

  const [journeys, hcArrivals] = await Promise.all([
    prisma.motJourney.findMany({
      where: {
        zmcc_id: { in: zmccIds },
        OR: [{ status: { in: ACTIVE_JOURNEY } }, { status: 'COMPLETED', ended_at: { gte: keepSince } }],
      },
      orderBy: { started_at: 'asc' },
      select: {
        id: true,
        zmcc_id: true,
        status: true,
        assigned_at: true,
        started_at: true,
        ended_at: true,
        mot_profile: { select: { name: true } },
        mot_vehicle: { select: { vehicle_number: true } },
        route: { select: { name: true } },
        mot_arrival: { select: { arrival_timestamp: true, exit_timestamp: true, lab_session: { select: LAB_SELECT } } },
      },
    }),
    prisma.zmccLocalSupplierArrival.findMany({
      where: {
        zmcc_id: { in: zmccIds },
        OR: [
          { exit_timestamp: { gte: keepSince } },
          { exit_timestamp: null, arrival_timestamp: { gte: hcSince } },
        ],
      },
      orderBy: { arrival_timestamp: 'asc' },
      select: {
        id: true,
        zmcc_id: true,
        vehicle_number: true,
        zmcc_token: true,
        arrival_timestamp: true,
        exit_timestamp: true,
        local_supplier: { select: { name: true, approval_status: true } },
        lab_session: { select: LAB_SELECT },
      },
    }),
  ]);

  const journeyIds = journeys.map((j) => j.id);
  const [stopGroups, collectionGroups, pendingCollections] = journeyIds.length
    ? await Promise.all([
        prisma.motJourneyStop.groupBy({ by: ['journey_id', 'status'], where: { journey_id: { in: journeyIds } }, _count: { _all: true } }),
        prisma.motShopCollection.groupBy({
          by: ['journey_id'],
          where: { journey_id: { in: journeyIds }, final_decision: 'ACCEPTED' },
          _sum: { at_13ts_liters: true, gross_liters: true },
        }),
        prisma.motShopCollection.groupBy({
          by: ['journey_id'],
          where: { journey_id: { in: journeyIds }, review_status: 'PENDING' },
          _count: { _all: true },
        }),
      ])
    : [[], [], []];

  const stopsByJourney = new Map<string, { done: number; total: number }>();
  for (const g of stopGroups) {
    const key = g.journey_id.toString();
    const cur = stopsByJourney.get(key) ?? { done: 0, total: 0 };
    cur.total += g._count._all;
    if (g.status === 'COMPLETED') cur.done += g._count._all;
    stopsByJourney.set(key, cur);
  }
  const collectedByJourney = new Map(collectionGroups.map((g) => [g.journey_id.toString(), g._sum]));
  const pendingByJourney = new Set(pendingCollections.map((g) => g.journey_id.toString()));

  const names = opts.names ? await resolveApproverNames(zmccIds.map((id) => ({ role: 'ZMCC_MANAGER', sourceId: id }))) : null;
  const managerOf = (zmccId: bigint): ApprovalWait => ({
    role: 'ZMCC_MANAGER',
    name: names?.get(`ZMCC_MANAGER:${zmccId}`) ?? null,
  });

  const motRow = (j: (typeof journeys)[number]): TvZmccJourney => {
    const key = j.id.toString();
    const arrival = j.mot_arrival;
    const lab = (arrival?.lab_session ?? null) as LabInfo | null;
    const stops = stopsByJourney.get(key) ?? { done: 0, total: 0 };
    const sums = collectedByJourney.get(key);
    const collected = sums ? r2(n(sums.at_13ts_liters)) : 0;
    const returning = j.status === 'RETURNING' || !!arrival || j.status === 'ARRIVED' || j.status === 'COMPLETED';
    const atZmcc = !!arrival || j.status === 'ARRIVED' || j.status === 'COMPLETED';
    const collectWaiting = pendingByJourney.has(key);
    const [labStep, receiptStep] = labAndReceiptSteps(lab, atZmcc, managerOf(j.zmcc_id));
    const ended = j.status === 'COMPLETED';
    const settled = receiptStep.state === 'done' || receiptStep.state === 'rejected';
    const steps: TvJourneyStep[] = [
      { key: 'assigned', label: 'Assigned', state: 'done', at: iso(j.assigned_at) },
      {
        key: 'collecting',
        label: 'Collecting',
        state: collectWaiting ? 'waiting' : stateFor(returning, true),
        metric: `${stops.done} / ${stops.total} shops`,
        approval: collectWaiting ? managerOf(j.zmcc_id) : null,
      },
      { key: 'returning', label: 'Returning', state: stateFor(atZmcc, returning) },
      { key: 'arrived', label: 'At ZMCC', state: stateFor(!!lab, atZmcc), at: iso(arrival?.arrival_timestamp) },
      labStep,
      receiptStep,
      {
        key: 'end',
        label: 'Journey end',
        state: stateFor(ended, settled),
        at: iso(j.ended_at ?? arrival?.exit_timestamp),
      },
    ];
    return {
      id: `mot-${key}`,
      kind: 'MOT',
      title: j.mot_profile.name,
      vehicleNumber: j.mot_vehicle.vehicle_number,
      subtitle: j.route.name,
      finished: ended,
      finishedAt: ended ? iso(j.ended_at ?? arrival?.exit_timestamp) : null,
      collectedAt13Ts: collected,
      receivedAt13Ts: lab?.tank_receipt ? r2(n(lab.tank_receipt.at_13ts_liters)) : null,
      steps,
    };
  };

  const hcRow = (h: (typeof hcArrivals)[number]): TvZmccJourney => {
    const lab = (h.lab_session ?? null) as LabInfo | null;
    const supplierWaiting = h.local_supplier.approval_status === 'PENDING' || h.local_supplier.approval_status === 'PENDING_APPROVAL';
    const [labStep, receiptStep] = labAndReceiptSteps(lab, true, managerOf(h.zmcc_id));
    const exited = !!h.exit_timestamp;
    const settled = receiptStep.state === 'done' || receiptStep.state === 'rejected';
    // An HC vehicle always leaves through a recorded gate exit; it is finished only once it has left.
    const finished = exited;
    const steps: TvJourneyStep[] = [
      {
        key: 'gate-in',
        label: 'Gate entry',
        state: supplierWaiting ? 'waiting' : 'done',
        at: iso(h.arrival_timestamp),
        approval: supplierWaiting ? managerOf(h.zmcc_id) : null,
      },
      labStep,
      receiptStep,
    ];
    steps.push({ key: 'gate-out', label: 'Gate exit', state: stateFor(exited, settled), at: iso(h.exit_timestamp) });
    return {
      id: `hc-${h.id}`,
      kind: 'HC',
      title: h.local_supplier.name,
      vehicleNumber: h.vehicle_number,
      subtitle: `Token ${h.zmcc_token}`,
      finished,
      finishedAt: iso(h.exit_timestamp),
      collectedAt13Ts: null,
      receivedAt13Ts: lab?.tank_receipt ? r2(n(lab.tank_receipt.at_13ts_liters)) : null,
      steps,
    };
  };

  // Working vehicles first, finished ones after; each group keeps its time order.
  const byWork = (a: TvZmccJourney, b: TvZmccJourney) => Number(a.finished) - Number(b.finished);
  // A finished card stays for TV_FINISHED_KEEP_MS after it finished, then leaves the board.
  const onBoard = (r: TvZmccJourney) => !r.finished || !r.finishedAt || new Date(r.finishedAt) >= keepSince;
  const sections: TvZmccSection[] = zmccs.map((z) => {
    const testers = journeys.filter((j) => j.zmcc_id === z.id).map(motRow).filter(onBoard).sort(byWork);
    const hc = hcArrivals.filter((h) => h.zmcc_id === z.id).map(hcRow).filter(onBoard).sort(byWork);
    return {
      id: z.id.toString(),
      name: z.name,
      testers: { total: testers.length, rows: testers.slice(0, TV_ZMCC_MAX_ROWS) },
      hc: { total: hc.length, rows: hc.slice(0, TV_ZMCC_MAX_ROWS) },
    };
  });

  return { updatedAt: now.toISOString(), zmccs: sections };
}

const cache = createTtlCache<TvZmccBoard>({ ttlMs: 20_000 });

/** The board is the same for every signed-in viewer, so one computation serves all of them for 20 seconds. */
export function getTvZmccBoard(): Promise<TvZmccBoard> {
  return cache.get('board', () => buildTvZmccBoard(new Date(), { names: true }));
}
