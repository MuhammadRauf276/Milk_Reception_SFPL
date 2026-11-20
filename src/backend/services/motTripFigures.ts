/**
 * One rule for a Mobile Tester journey's trip: milk accepted at the shops versus milk received into the ZMCC tank.
 * Used by the MOT Loss / Gain card and the Stage by stage panel, so both always show the same trip figure.
 * Only completed journeys count (the vehicle reached the ZMCC); milk still on a vehicle is not a loss.
 */
import { prisma } from '@core/db';
import { collectionFinalDecision } from './motJourneySummaryService';

type Num = { toString(): string } | number | string | null | undefined;
const n = (v: Num) => (v == null ? 0 : Number(v));

export interface TripJourneyRecord {
  summary: { total_gross_liters: Num; total_at_13ts_liters: Num } | null;
  collections: Array<{ gross_liters: Num; at_13ts_liters: Num; final_decision: string | null }>;
  area_received_liters: Num;
  area_received_at_13ts_liters: Num;
  mot_arrival: { lab_session: { tank_receipt: { gross_liters: Num; at_13ts_liters: Num } | null } | null } | null;
}

export interface TripFigures {
  shopGross: number;
  shop13ts: number;
  receivedGross: number;
  /** Null when milk was received but its @13 TS figure is missing. */
  received13ts: number | null;
}

/** Shop milk from the journey summary (or its accepted collections); received milk from the stored ZMCC figure (or the tank receipt). */
export function journeyTripFigures(j: TripJourneyRecord): TripFigures {
  const accepted = j.collections.filter((c) => collectionFinalDecision(c) === 'ACCEPTED');
  const shopGross = j.summary ? n(j.summary.total_gross_liters) : Number(accepted.reduce((t, c) => t + n(c.gross_liters), 0).toFixed(2));
  const shop13ts = j.summary ? n(j.summary.total_at_13ts_liters) : Number(accepted.reduce((t, c) => t + n(c.at_13ts_liters), 0).toFixed(2));
  const receipt = j.mot_arrival?.lab_session?.tank_receipt ?? null;
  const receivedGross = j.area_received_liters != null ? n(j.area_received_liters) : receipt ? n(receipt.gross_liters) : 0;
  const received13Raw =
    j.area_received_at_13ts_liters != null ? n(j.area_received_at_13ts_liters) : receipt?.at_13ts_liters != null ? n(receipt.at_13ts_liters) : null;
  return { shopGross, shop13ts, receivedGross, received13ts: received13Raw ?? (receivedGross > 0 ? null : 0) };
}

export const TRIP_JOURNEY_SELECT = {
  summary: { select: { total_gross_liters: true, total_at_13ts_liters: true } },
  collections: { select: { gross_liters: true, at_13ts_liters: true, final_decision: true } },
  area_received_liters: true,
  area_received_at_13ts_liters: true,
  mot_arrival: { select: { lab_session: { select: { tank_receipt: { select: { gross_liters: true, at_13ts_liters: true } } } } } },
} as const;

export interface TripDayRow {
  zmccId: string;
  /** Journey date, YYYY-MM-DD. */
  day: string;
  shop: { liters: number; at13ts: number };
  received: { liters: number; at13ts: number };
}

/** Completed journeys of these ZMCCs whose journey date falls in the range, one row per journey. */
export async function loadCompletedJourneyTrips(input: { from: string; to: string; zmccIds: bigint[] }): Promise<TripDayRow[]> {
  if (!input.zmccIds.length) return [];
  const rows = await prisma.motJourney.findMany({
    where: {
      zmcc_id: { in: input.zmccIds },
      status: 'COMPLETED',
      operational_date: { gte: new Date(`${input.from}T00:00:00.000Z`), lte: new Date(`${input.to}T00:00:00.000Z`) },
    },
    select: { zmcc_id: true, operational_date: true, ...TRIP_JOURNEY_SELECT },
  });
  return rows.map((j) => {
    const f = journeyTripFigures(j);
    return {
      zmccId: j.zmcc_id.toString(),
      day: j.operational_date.toISOString().slice(0, 10),
      shop: { liters: f.shopGross, at13ts: f.shop13ts },
      received: { liters: f.receivedGross, at13ts: f.received13ts ?? 0 },
    };
  });
}
