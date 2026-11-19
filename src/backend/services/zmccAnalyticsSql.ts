import { Prisma } from '@prisma/client';
import { withReportTimeout } from '@/backend/core/reportQuery';
import { pkLocal } from '@/backend/core/sqlTime';

/**
 * Database-side sums for the ZMCC analytics report. The report used to read every collection row of the date range
 * and add them up in the server; now PostgreSQL returns one row per day, hour and route. Nothing is stored.
 */

export interface CollectionScope {
  /** First and last Pakistan operational day, as YYYY-MM-DD. */
  from: string;
  to: string;
  zmccId?: bigint;
  routeId?: bigint;
  shift?: string;
}

export interface CollectionDayHourRoute {
  date: string;
  hour: number;
  routeId: string;
  liters: number;
  at13ts: number;
  fatWeighted: number;
  snfWeighted: number;
  lrWeighted: number;
  count: number;
}

export interface CollectionRouteTotals {
  routeId: string;
  routeCode: string;
  routeName: string;
  liters: number;
  at13ts: number;
  fatWeighted: number;
  snfWeighted: number;
  lrWeighted: number;
  shopCount: number;
}

export interface CollectionJourneyTotals {
  journeyId: string;
  /** Every accepted collection of the journey, whichever shift is shown. */
  shopLiters: number;
  /** The journey has an accepted collection in the shown shift. */
  inShift: boolean;
}

export interface CollectionScatterRow {
  id: string;
  collectionNumber: string;
  routeCode: string;
  fat: number;
  snf: number;
  lr: number;
  liters: number;
}

export interface CollectionAggregates {
  byDayHourRoute: CollectionDayHourRoute[];
  byRoute: CollectionRouteTotals[];
  byJourney: CollectionJourneyTotals[];
  scatter: CollectionScatterRow[];
}

export interface HcDayHour {
  date: string;
  hour: number;
  liters: number;
  at13ts: number;
  fatWeighted: number;
  snfWeighted: number;
  lrWeighted: number;
  count: number;
}

const PK_HOUR = Prisma.sql`EXTRACT(HOUR FROM ${pkLocal('c.device_collected_at')})::int`;

function shiftCondition(shift: string | undefined): Prisma.Sql {
  if (shift === 'MORNING') return Prisma.sql`AND ${PK_HOUR} < 13`;
  if (shift === 'EVENING') return Prisma.sql`AND ${PK_HOUR} >= 13`;
  return Prisma.empty;
}

function scopeCondition(scope: CollectionScope): Prisma.Sql {
  return Prisma.sql`c.operational_date >= ${scope.from}::date AND c.operational_date <= ${scope.to}::date
    ${scope.zmccId ? Prisma.sql`AND c.zmcc_id = ${scope.zmccId}` : Prisma.empty}
    ${scope.routeId ? Prisma.sql`AND c.route_id = ${scope.routeId}` : Prisma.empty}`;
}

// A collection that is not rejected counts as procured; a missing decision is not a rejection.
const NOT_REJECTED = Prisma.sql`c.final_decision IS DISTINCT FROM 'REJECTED'`;

export async function loadCollectionAggregates(scope: CollectionScope): Promise<CollectionAggregates> {
  const base = scopeCondition(scope);
  const shift = shiftCondition(scope.shift);

  return withReportTimeout(async (tx) => {
    // Sequential: one transaction connection runs one statement at a time.
    const dayHourRoute = await tx.$queryRaw<Array<Omit<CollectionDayHourRoute, 'routeId'> & { route_id: bigint }>>`
        SELECT to_char(c.operational_date, 'YYYY-MM-DD') AS date, ${PK_HOUR} AS hour, c.route_id,
               COALESCE(SUM(c.gross_liters), 0)::float8 AS liters,
               COALESCE(SUM(c.at_13ts_liters), 0)::float8 AS "at13ts",
               COALESCE(SUM(c.fat * c.gross_liters), 0)::float8 AS "fatWeighted",
               COALESCE(SUM(c.snf * c.gross_liters), 0)::float8 AS "snfWeighted",
               COALESCE(SUM(c.lr * c.gross_liters), 0)::float8 AS "lrWeighted",
               COUNT(*)::int AS count
        FROM mot_shop_collection c
        WHERE ${base} AND ${NOT_REJECTED} ${shift}
        GROUP BY c.operational_date, ${PK_HOUR}, c.route_id`;
    const route = await tx.$queryRaw<Array<{
      route_id: bigint; route_code: string | null; route_name: string | null;
      liters: number; at13ts: number; fatWeighted: number; snfWeighted: number; lrWeighted: number; shopCount: number;
    }>>`
        SELECT c.route_id, r.route_code, r.name AS route_name,
               COALESCE(SUM(c.gross_liters), 0)::float8 AS liters,
               COALESCE(SUM(c.at_13ts_liters), 0)::float8 AS "at13ts",
               COALESCE(SUM(c.fat * c.gross_liters), 0)::float8 AS "fatWeighted",
               COALESCE(SUM(c.snf * c.gross_liters), 0)::float8 AS "snfWeighted",
               COALESCE(SUM(c.lr * c.gross_liters), 0)::float8 AS "lrWeighted",
               COUNT(DISTINCT c.shop_id)::int AS "shopCount"
        FROM mot_shop_collection c
        LEFT JOIN zmcc_route r ON r.id = c.route_id
        WHERE ${base} AND ${NOT_REJECTED} ${shift}
        GROUP BY c.route_id, r.route_code, r.name
        ORDER BY MIN(c.device_collected_at) ASC, MIN(c.id) ASC`;
    const journey = await tx.$queryRaw<Array<{ journey_id: bigint; shopLiters: number; inShift: boolean }>>`
        SELECT c.journey_id,
               COALESCE(SUM(c.gross_liters), 0)::float8 AS "shopLiters",
               BOOL_OR(TRUE ${shift}) AS "inShift"
        FROM mot_shop_collection c
        WHERE ${base} AND ${NOT_REJECTED}
        GROUP BY c.journey_id`;
    const scatter = await tx.$queryRaw<Array<{
      id: bigint; collection_number: string; route_code: string | null;
      fat: number; snf: number; lr: number; liters: number;
    }>>`
        SELECT c.id, c.collection_number, r.route_code,
               COALESCE(c.fat, 0)::float8 AS fat, COALESCE(c.snf, 0)::float8 AS snf, COALESCE(c.lr, 0)::float8 AS lr,
               COALESCE(c.gross_liters, 0)::float8 AS liters
        FROM mot_shop_collection c
        LEFT JOIN zmcc_route r ON r.id = c.route_id
        WHERE ${base} AND ${NOT_REJECTED} ${shift}
        ORDER BY c.device_collected_at ASC, c.id ASC
        LIMIT 150`;

    return {
      byDayHourRoute: dayHourRoute.map(({ route_id, ...rest }) => ({ ...rest, routeId: route_id.toString() })),
      byRoute: route.map((r) => ({
        routeId: r.route_id.toString(),
        routeCode: r.route_code ?? '',
        routeName: r.route_name ?? '',
        liters: r.liters, at13ts: r.at13ts, fatWeighted: r.fatWeighted, snfWeighted: r.snfWeighted, lrWeighted: r.lrWeighted,
        shopCount: r.shopCount,
      })),
      byJourney: journey.map((j) => ({ journeyId: j.journey_id.toString(), shopLiters: j.shopLiters, inShift: j.inShift })),
      scatter: scatter.map((s) => ({
        id: s.id.toString(), collectionNumber: s.collection_number, routeCode: s.route_code ?? '',
        fat: s.fat, snf: s.snf, lr: s.lr, liters: s.liters,
      })),
    };
  });
}

/** HC milk straight into the tank (no route), summed per Pakistan day and hour. */
export async function loadHcReceiptAggregates(params: { windowStart: Date; windowEnd: Date; zmccId?: bigint }): Promise<HcDayHour[]> {
  return withReportTimeout((tx) =>
    tx.$queryRaw<HcDayHour[]>`
      SELECT to_char(${pkLocal('t.received_at')}, 'YYYY-MM-DD') AS date,
             EXTRACT(HOUR FROM ${pkLocal('t.received_at')})::int AS hour,
             COALESCE(SUM(t.gross_liters), 0)::float8 AS liters,
             COALESCE(SUM(t.at_13ts_liters), 0)::float8 AS "at13ts",
             COALESCE(SUM(t.fat * t.gross_liters), 0)::float8 AS "fatWeighted",
             COALESCE(SUM(t.snf * t.gross_liters), 0)::float8 AS "snfWeighted",
             COALESCE(SUM(t.lr * t.gross_liters), 0)::float8 AS "lrWeighted",
             COUNT(*)::int AS count
      FROM zmcc_tank_receipt t
      WHERE t.arrival_type = 'HC'
        AND t.received_at >= ${params.windowStart} AND t.received_at <= ${params.windowEnd}
        ${params.zmccId ? Prisma.sql`AND t.zmcc_id = ${params.zmccId}` : Prisma.empty}
      GROUP BY 1, 2`
  );
}
