import { Prisma } from '@prisma/client';
import type { VisualsQuery } from '@/backend/modules/management-reporting/visuals/common';
import type { TesterRow, TestersDayRow, TestersVisuals } from '@/backend/modules/management-reporting/visuals/testersContracts';
import { VISUALS_TOP_N, allDays, dayKey, num, qty, type VisualsDb } from './visualsCommon';

type Row = Record<string, unknown>;
const ZERO = { liters: 0, at13ts: 0 };

/**
 * Mobile Testers. Same definitions as the Stage drill (zmccStageDrillService motRows): journey day = operational date,
 * cancelled out; received = tank receipts of the journey's arrival; trip loss/gain over journeys that arrived only.
 */
export async function loadTestersVisuals(q: VisualsQuery, db: VisualsDb): Promise<TestersVisuals> {
  const pickedIds = q.ids.filter((s) => /^\d{1,18}$/.test(s));
  const ids = pickedIds.map((s) => BigInt(s));
  const testerFilter = ids.length ? Prisma.sql`AND j.mot_profile_id IN (${Prisma.join(ids)})` : Prisma.empty;
  const js = Prisma.sql`
    SELECT j.id, j.operational_date AS day, j.mot_profile_id AS tester_id, j.zmcc_id,
           EXISTS (SELECT 1 FROM zmcc_mot_arrival a WHERE a.journey_id = j.id) AS arrived
    FROM mot_journey j
    WHERE j.zmcc_id IN (${Prisma.join(q.zmccIds)}) AND j.operational_date BETWEEN ${q.from}::date AND ${q.to}::date
      AND j.status <> 'CANCELLED' ${testerFilter}`;

  const dayRows = await db.$queryRaw<Row[]>`
    WITH js AS (${js}),
    col AS (
      SELECT js.day,
             COUNT(*) FILTER (WHERE c.final_decision = 'ACCEPTED') AS shops,
             COUNT(*) FILTER (WHERE c.final_decision = 'REJECTED') AS rej,
             SUM(c.gross_liters) FILTER (WHERE c.final_decision = 'ACCEPTED') AS l,
             SUM(c.at_13ts_liters) FILTER (WHERE c.final_decision = 'ACCEPTED') AS a13,
             SUM(c.gross_liters) FILTER (WHERE c.final_decision = 'ACCEPTED' AND js.arrived) AS l_arr,
             SUM(c.at_13ts_liters) FILTER (WHERE c.final_decision = 'ACCEPTED' AND js.arrived) AS a13_arr
      FROM js JOIN mot_shop_collection c ON c.journey_id = js.id GROUP BY js.day
    ),
    rec AS (
      SELECT js.day, SUM(tr.gross_liters) AS l, SUM(tr.gross_liters * tr.ts / 13) AS a13
      FROM js JOIN zmcc_mot_arrival a ON a.journey_id = js.id
      JOIN zmcc_lab_session ls ON ls.mot_arrival_id = a.id
      JOIN zmcc_tank_receipt tr ON tr.lab_session_id = ls.id GROUP BY js.day
    ),
    cnt AS (SELECT day, COUNT(*) AS journeys, COUNT(*) FILTER (WHERE NOT arrived) AS open FROM js GROUP BY day)
    SELECT cnt.day::text AS day, cnt.journeys::int AS journeys, cnt.open::int AS open,
           COALESCE(col.shops, 0)::int AS shops, COALESCE(col.rej, 0)::int AS rej,
           col.l::float8 AS col_l, col.a13::float8 AS col_a13, col.l_arr::float8 AS arr_l, col.a13_arr::float8 AS arr_a13,
           rec.l::float8 AS rec_l, rec.a13::float8 AS rec_a13
    FROM cnt LEFT JOIN col ON col.day = cnt.day LEFT JOIN rec ON rec.day = cnt.day`;

  const testerRows = await db.$queryRaw<Row[]>`
    WITH js AS (${js}),
    col AS (
      SELECT js.tester_id,
             COUNT(*) FILTER (WHERE c.final_decision = 'ACCEPTED') AS shops,
             COUNT(*) FILTER (WHERE c.final_decision = 'REJECTED') AS rej,
             SUM(c.gross_liters) FILTER (WHERE c.final_decision = 'ACCEPTED') AS l,
             SUM(c.at_13ts_liters) FILTER (WHERE c.final_decision = 'ACCEPTED') AS a13,
             SUM(c.gross_liters) FILTER (WHERE c.final_decision = 'ACCEPTED' AND js.arrived) AS l_arr,
             SUM(c.at_13ts_liters) FILTER (WHERE c.final_decision = 'ACCEPTED' AND js.arrived) AS a13_arr
      FROM js JOIN mot_shop_collection c ON c.journey_id = js.id GROUP BY js.tester_id
    ),
    rec AS (
      SELECT js.tester_id, SUM(tr.gross_liters) AS l, SUM(tr.gross_liters * tr.ts / 13) AS a13
      FROM js JOIN zmcc_mot_arrival a ON a.journey_id = js.id
      JOIN zmcc_lab_session ls ON ls.mot_arrival_id = a.id
      JOIN zmcc_tank_receipt tr ON tr.lab_session_id = ls.id GROUP BY js.tester_id
    ),
    cnt AS (SELECT tester_id, COUNT(*) AS journeys, COUNT(*) FILTER (WHERE NOT arrived) AS open, MIN(zmcc_id) AS zmcc_id FROM js GROUP BY tester_id)
    SELECT cnt.tester_id::text AS id, p.name, p.mot_code AS code, ps.name AS zmcc_name, cnt.journeys::int AS journeys, cnt.open::int AS open,
           COALESCE(col.shops, 0)::int AS shops, COALESCE(col.rej, 0)::int AS rej,
           col.l::float8 AS col_l, col.a13::float8 AS col_a13, col.l_arr::float8 AS arr_l, col.a13_arr::float8 AS arr_a13,
           rec.l::float8 AS rec_l, rec.a13::float8 AS rec_a13
    FROM cnt LEFT JOIN col ON col.tester_id = cnt.tester_id LEFT JOIN rec ON rec.tester_id = cnt.tester_id
    LEFT JOIN mot_profile p ON p.id = cnt.tester_id LEFT JOIN procurement_source ps ON ps.id = cnt.zmcc_id`;

  const testers: TesterRow[] = testerRows
    .map((r) => ({
      id: String(r.id),
      name: String(r.name ?? 'Unknown tester'),
      code: String(r.code ?? ''),
      zmccName: String(r.zmcc_name ?? ''),
      journeys: num(r.journeys),
      notArrived: num(r.open),
      shops: num(r.shops),
      rejected: num(r.rej),
      collected: qty(r.col_l, r.col_a13),
      collectedArrived: qty(r.arr_l, r.arr_a13),
      received: qty(r.rec_l, r.rec_a13),
    }))
    .sort((a, b) => b.collected.at13ts - a.collected.at13ts)
    .slice(0, VISUALS_TOP_N);

  const options = await db.$queryRaw<Row[]>`
    SELECT p.id::text AS id, p.name, p.mot_code AS code, ps.name AS zmcc_name
    FROM mot_profile p JOIN procurement_source ps ON ps.id = p.zmcc_id
    WHERE p.zmcc_id IN (${Prisma.join(q.zmccIds)}) AND p.is_active ORDER BY ps.name, p.name`;
  const testerOptions = options.map((o) => ({ id: String(o.id), name: `${String(o.name)} (${String(o.code)})`, group: String(o.zmcc_name ?? '') }));

  // One line per Mobile Tester when 2 to 5 are picked.
  const lineTesters =
    pickedIds.length >= 2 && pickedIds.length <= 5
      ? pickedIds.map((id) => ({ id, name: testerOptions.find((o) => o.id === id)?.name ?? `Tester ${id}` }))
      : [];
  const byTesterDay = new Map<string, Record<string, { liters: number; at13ts: number }>>();
  if (lineTesters.length) {
    const rows = await db.$queryRaw<Row[]>`
      WITH js AS (${js})
      SELECT js.day::text AS day, js.tester_id::text AS tester_id, SUM(c.gross_liters)::float8 AS l, SUM(c.at_13ts_liters)::float8 AS a13
      FROM js JOIN mot_shop_collection c ON c.journey_id = js.id
      WHERE c.final_decision = 'ACCEPTED' GROUP BY js.day, js.tester_id`;
    for (const r of rows) {
      const d = dayKey(r.day);
      const m = byTesterDay.get(d) ?? {};
      m[`t${String(r.tester_id)}`] = qty(r.l, r.a13);
      byTesterDay.set(d, m);
    }
  }

  const dayMap = new Map(dayRows.map((r) => [dayKey(r.day), r]));
  const days: TestersDayRow[] = allDays(q.from, q.to).map((day) => {
    const r = dayMap.get(day);
    return {
      day,
      collected: r ? qty(r.col_l, r.col_a13) : { ...ZERO },
      collectedArrived: r ? qty(r.arr_l, r.arr_a13) : { ...ZERO },
      received: r ? qty(r.rec_l, r.rec_a13) : { ...ZERO },
      journeys: num(r?.journeys),
      notArrived: num(r?.open),
      shops: num(r?.shops),
      rejected: num(r?.rej),
      byTester: byTesterDay.get(day) ?? {},
    };
  });

  return { days, testers, lineTesters, testerOptions };
}
