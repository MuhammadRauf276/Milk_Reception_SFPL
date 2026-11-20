import { Prisma } from '@prisma/client';
import type { VisualsQuery } from '@/backend/modules/management-reporting/visuals/common';
import {
  shopConcentration,
  topRouteIdsOf,
  type ShopsDayRow,
  type ShopsRouteRow,
  type ShopsShopRow,
  type ShopsVisuals,
} from '@/backend/modules/management-reporting/visuals/shopsContracts';
import { VISUALS_TOP_N, allDays, dayKey, num, qty, type VisualsDb } from './visualsCommon';

type Row = Record<string, unknown>;
const ZERO = { liters: 0, at13ts: 0 };

/**
 * Shops & routes. Same definitions as the Stage drill (zmccStageDrillService): journeys of the picked ZMCCs on their
 * operational date, cancelled ones out; collected = accepted shop collections; stops done = status COMPLETED.
 */
export async function loadShopsVisuals(q: VisualsQuery, db: VisualsDb): Promise<ShopsVisuals> {
  const routeIds = q.ids.filter((s) => /^\d{1,18}$/.test(s)).map((s) => BigInt(s));
  const routeFilter = routeIds.length ? Prisma.sql`AND j.route_id IN (${Prisma.join(routeIds)})` : Prisma.empty;
  const js = Prisma.sql`
    SELECT j.id, j.operational_date AS day, j.route_id, j.zmcc_id FROM mot_journey j
    WHERE j.zmcc_id IN (${Prisma.join(q.zmccIds)}) AND j.operational_date BETWEEN ${q.from}::date AND ${q.to}::date
      AND j.status <> 'CANCELLED' ${routeFilter}`;

  const dayRows = await db.$queryRaw<Row[]>`
    WITH js AS (${js}),
    col AS (
      SELECT js.day,
             SUM(c.gross_liters) FILTER (WHERE c.final_decision = 'ACCEPTED') AS l,
             SUM(c.at_13ts_liters) FILTER (WHERE c.final_decision = 'ACCEPTED') AS a13,
             COUNT(*) FILTER (WHERE c.final_decision = 'ACCEPTED') AS acc,
             COUNT(*) FILTER (WHERE c.final_decision = 'REJECTED') AS rej
      FROM js JOIN mot_shop_collection c ON c.journey_id = js.id GROUP BY js.day
    ),
    st AS (
      SELECT js.day, COUNT(*) AS planned, COUNT(*) FILTER (WHERE s.status IN ('VISITED', 'REJECTED', 'COMPLETED')) AS done
      FROM js JOIN mot_journey_stop s ON s.journey_id = js.id GROUP BY js.day
    )
    SELECT d.day::text AS day, col.l::float8 AS l, col.a13::float8 AS a13, COALESCE(col.acc, 0)::int AS acc, COALESCE(col.rej, 0)::int AS rej,
           COALESCE(st.planned, 0)::int AS planned, COALESCE(st.done, 0)::int AS done
    FROM (SELECT day FROM col UNION SELECT day FROM st) d
    LEFT JOIN col ON col.day = d.day LEFT JOIN st ON st.day = d.day`;

  const routeRows = await db.$queryRaw<Row[]>`
    WITH js AS (${js}),
    col AS (
      SELECT js.route_id,
             SUM(c.gross_liters) FILTER (WHERE c.final_decision = 'ACCEPTED') AS l,
             SUM(c.at_13ts_liters) FILTER (WHERE c.final_decision = 'ACCEPTED') AS a13,
             COUNT(*) FILTER (WHERE c.final_decision = 'ACCEPTED') AS acc,
             COUNT(*) FILTER (WHERE c.final_decision = 'REJECTED') AS rej,
             COUNT(DISTINCT c.shop_id) FILTER (WHERE c.final_decision = 'ACCEPTED') AS shops
      FROM js JOIN mot_shop_collection c ON c.journey_id = js.id GROUP BY js.route_id
    ),
    st AS (
      SELECT js.route_id, COUNT(*) AS planned, COUNT(*) FILTER (WHERE s.status IN ('VISITED', 'REJECTED', 'COMPLETED')) AS done
      FROM js JOIN mot_journey_stop s ON s.journey_id = js.id GROUP BY js.route_id
    ),
    cnt AS (SELECT route_id, COUNT(*) AS journeys, MIN(zmcc_id) AS zmcc_id FROM js GROUP BY route_id)
    SELECT cnt.route_id::text AS id, r.name, r.route_code AS code, ps.name AS zmcc_name, cnt.journeys::int AS journeys,
           COALESCE(st.planned, 0)::int AS planned, COALESCE(st.done, 0)::int AS done,
           COALESCE(col.acc, 0)::int AS acc, COALESCE(col.rej, 0)::int AS rej, COALESCE(col.shops, 0)::int AS shops,
           col.l::float8 AS l, col.a13::float8 AS a13
    FROM cnt
    LEFT JOIN col ON col.route_id = cnt.route_id LEFT JOIN st ON st.route_id = cnt.route_id
    LEFT JOIN zmcc_route r ON r.id = cnt.route_id LEFT JOIN procurement_source ps ON ps.id = cnt.zmcc_id`;

  const routes: ShopsRouteRow[] = routeRows
    .map((r) => ({
      id: String(r.id),
      name: String(r.name ?? 'No route'),
      code: String(r.code ?? ''),
      zmccName: String(r.zmcc_name ?? ''),
      journeys: num(r.journeys),
      planned: num(r.planned),
      done: num(r.done),
      accepted: num(r.acc),
      rejected: num(r.rej),
      shops: num(r.shops),
      collected: qty(r.l, r.a13),
    }))
    .sort((a, b) => b.collected.at13ts - a.collected.at13ts)
    .slice(0, VISUALS_TOP_N);

  const topRouteIds = topRouteIdsOf(routes.map((r) => ({ id: r.id, value: r.collected.at13ts })), 5);

  const byRouteDay = new Map<string, Record<string, { liters: number; at13ts: number }>>();
  if (topRouteIds.length) {
    const rows = await db.$queryRaw<Row[]>`
      WITH js AS (${js})
      SELECT js.day::text AS day, js.route_id::text AS route_id, SUM(c.gross_liters)::float8 AS l, SUM(c.at_13ts_liters)::float8 AS a13
      FROM js JOIN mot_shop_collection c ON c.journey_id = js.id
      WHERE c.final_decision = 'ACCEPTED' AND js.route_id IN (${Prisma.join(topRouteIds.map((id) => BigInt(id)))})
      GROUP BY js.day, js.route_id`;
    for (const r of rows) {
      const d = dayKey(r.day);
      const m = byRouteDay.get(d) ?? {};
      m[`r${String(r.route_id)}`] = qty(r.l, r.a13);
      byRouteDay.set(d, m);
    }
  }

  const shopRows = await db.$queryRaw<Row[]>`
    WITH js AS (${js})
    SELECT c.shop_id::text AS id, SUM(c.gross_liters) FILTER (WHERE c.final_decision = 'ACCEPTED')::float8 AS l,
           SUM(c.at_13ts_liters) FILTER (WHERE c.final_decision = 'ACCEPTED')::float8 AS a13,
           COUNT(DISTINCT js.day) FILTER (WHERE c.final_decision = 'ACCEPTED')::int AS days,
           COUNT(*) FILTER (WHERE c.final_decision = 'REJECTED')::int AS rej
    FROM js JOIN mot_shop_collection c ON c.journey_id = js.id
    GROUP BY c.shop_id`;
  const gave = shopRows.filter((r) => num(r.a13) > 0 || num(r.l) > 0);
  const concentration = {
    liters: shopConcentration(gave.map((r) => num(r.l))),
    at13ts: shopConcentration(gave.map((r) => num(r.a13))),
  };
  const top = [...shopRows].sort((a, b) => num(b.a13) - num(a.a13)).slice(0, VISUALS_TOP_N);
  const shopMeta = new Map<string, Row>();
  if (top.length) {
    const meta = await db.$queryRaw<Row[]>`
      SELECT s.id::text AS id, s.shop_code, s.shop_name, r.name AS route_name, ps.name AS zmcc_name
      FROM zmcc_shop s LEFT JOIN zmcc_route r ON r.id = s.route_id LEFT JOIN procurement_source ps ON ps.id = s.zmcc_id
      WHERE s.id IN (${Prisma.join(top.map((r) => BigInt(String(r.id))))})`;
    for (const m of meta) shopMeta.set(String(m.id), m);
  }
  const shops: ShopsShopRow[] = top.map((r) => {
    const m = shopMeta.get(String(r.id));
    return {
      id: String(r.id),
      code: String(m?.shop_code ?? ''),
      name: String(m?.shop_name ?? 'Unknown shop'),
      routeName: String(m?.route_name ?? ''),
      zmccName: String(m?.zmcc_name ?? ''),
      daysWithMilk: num(r.days),
      rejected: num(r.rej),
      collected: qty(r.l, r.a13),
    };
  });

  const dayMap = new Map(dayRows.map((r) => [dayKey(r.day), r]));
  const days: ShopsDayRow[] = allDays(q.from, q.to).map((day) => {
    const r = dayMap.get(day);
    return {
      day,
      collected: r ? qty(r.l, r.a13) : { ...ZERO },
      byRoute: byRouteDay.get(day) ?? {},
      accepted: num(r?.acc),
      rejected: num(r?.rej),
      planned: num(r?.planned),
      done: num(r?.done),
    };
  });

  const options = await db.$queryRaw<Row[]>`
    SELECT r.id::text AS id, r.name, r.route_code AS code, ps.name AS zmcc_name
    FROM zmcc_route r JOIN procurement_source ps ON ps.id = r.zmcc_id
    WHERE r.zmcc_id IN (${Prisma.join(q.zmccIds)}) ORDER BY ps.name, r.name`;
  const routeOptions = options.map((o) => ({ id: String(o.id), name: `${String(o.name)} (${String(o.code)})`, group: String(o.zmcc_name ?? '') }));

  return { days, topRouteIds, routes, shops, shopsGave: gave.length, concentration, routeOptions };
}
