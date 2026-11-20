import { Prisma } from '@prisma/client';
import type { VisualsQuery } from '@/backend/modules/management-reporting/visuals/common';
import {
  TANKERS_MAX_ROWS,
  businessDate,
  pkDate,
  tankerFlags,
  type TankerRow,
  type TankersVisuals,
} from '@/backend/modules/management-reporting/visuals/tankersContracts';
import { daySql, num, round2, type VisualsDb } from './visualsCommon';

const DAY_MS = 86_400_000;
type Row = Record<string, unknown>;
const iso = (v: unknown): string | null => (v instanceof Date ? v.toISOString() : v ? new Date(String(v)).toISOString() : null);
const optNum = (v: unknown): number | null => (v == null ? null : round2(num(v)));
/** Minutes between two instants, never below zero. */
const mins = (a: string, b: string) => Prisma.raw(`CASE WHEN ${a} IS NOT NULL AND ${b} IS NOT NULL THEN GREATEST(0, EXTRACT(EPOCH FROM (${a} - ${b})) / 60.0) END`);

/**
 * ZMCC dispatches in the range, one row each, newest first (at most 500). Every table is read once through a CTE and
 * only for the visits in range. Dispatch time is not indexed, so the visits are narrowed on the indexed created_at
 * (3 days margin) and then filtered exactly on the chosen day.
 */
export async function loadTankersVisuals(q: VisualsQuery, db: VisualsDb): Promise<TankersVisuals> {
  const lo = new Date(Date.parse(`${q.from}T00:00:00Z`) - 3 * DAY_MS - 5 * 3_600_000);
  const hi = new Date(Date.parse(`${q.to}T00:00:00Z`) + 4 * DAY_MS);
  // The tank ledger is read a week further back, so a fill that started before the range is counted whole.
  const ledgerLo = new Date(lo.getTime() - 7 * DAY_MS);
  const dayExpr = q.basis === 'business' ? Prisma.sql`vd.operational_date` : daySql('vd.t_disp', 'calendar');

  const rows = await db.$queryRaw<Row[]>(Prisma.sql`
    WITH v AS (
      SELECT vv.id, vv.visit_number, vv.vehicle_number, vv.procurement_source_id AS zid, ps.name AS zname, vv.operational_date,
             vv.dispatch_submitted_at AS sub_at, vv.vehicle_dispatch_gross_liters AS slip_l, vv.vehicle_dispatch_at_13ts_liters AS slip_13
      FROM vehicle_visit vv
      JOIN procurement_source ps ON ps.id = vv.procurement_source_id
      WHERE vv.created_at >= ${lo} AND vv.created_at < ${hi}
        AND ps.source_type = 'ZMCC' AND vv.procurement_source_id IN (${Prisma.join(q.zmccIds)})
        AND vv.current_status NOT IN ('DRAFT_DISPATCH', 'CANCELLED')
    ), di AS (
      SELECT p.visit_id, MIN(d.dispatch_timestamp) AS t
      FROM visit_portion p JOIN dispatch_info d ON d.portion_id = p.id
      WHERE p.visit_id IN (SELECT id FROM v) GROUP BY p.visit_id
    ), vd AS (
      SELECT v.*, COALESCE(di.t, v.sub_at) AS t_disp FROM v LEFT JOIN di ON di.visit_id = v.id
    ), vr AS (
      SELECT vd.*, ${dayExpr} AS day, count(*) OVER () AS total
      FROM vd
      WHERE vd.t_disp IS NOT NULL AND ${dayExpr} BETWEEN ${q.from}::date AND ${q.to}::date
      ORDER BY vd.t_disp DESC, vd.id DESC
      LIMIT ${TANKERS_MAX_ROWS}
    ), gl AS (
      SELECT g.visit_id, g.entry_timestamp AS t_in, g.exit_timestamp AS t_out, g.entry_submitted_at AS in_sub
      FROM gate_log g WHERE g.visit_id IN (SELECT id FROM vr)
    ), wt AS (
      SELECT w.visit_id, w.gross_timestamp AS t_w, w.gross_submitted_at AS w_sub,
             (w.gross_weight_kg - w.tare_weight_kg) AS net_kg
      FROM weight_ticket w WHERE w.visit_id IN (SELECT id FROM vr)
    ), rc AS (
      SELECT s.visit_id, MAX(s.operational_timestamp) AS t_rc, MAX(s.plant_composite_lr) AS lr, MAX(s.plant_ts) AS ts
      FROM silo_inventory_transaction s
      WHERE s.transaction_type = 'RECEIPT' AND s.visit_id IN (SELECT id FROM vr) GROUP BY s.visit_id
    ), pd AS (
      SELECT p.visit_id, bool_or(p.plant_decision = 'REJECTED') AS rej, bool_or(p.plant_decision = 'ACCEPTED') AS acc
      FROM visit_portion p WHERE p.visit_id IN (SELECT id FROM vr) GROUP BY p.visit_id
    ), led AS (
      SELECT x.id, x.tank_id, x.transaction_type::text AS type, x.reference_type, x.reference_id
      FROM zmcc_tank_inventory_transaction x
      WHERE x.zmcc_id IN (${Prisma.join(q.zmccIds)}) AND x.created_at >= ${ledgerLo}
    ), seg AS (
      SELECT l.*, SUM(CASE WHEN l.type <> 'ISSUE' THEN 1 ELSE 0 END) OVER (PARTITION BY l.tank_id ORDER BY l.id) AS seg
      FROM led l
    ), iss0 AS (
      SELECT DISTINCT ON (s.tank_id, s.seg, s.reference_id) s.id, s.tank_id, s.seg, s.reference_id
      FROM seg s WHERE s.type = 'ISSUE' AND s.reference_type = 'DISPATCH'
      ORDER BY s.tank_id, s.seg, s.reference_id, s.id
    ), iss1 AS (
      SELECT i.*, ROW_NUMBER() OVER (PARTITION BY i.tank_id, i.seg ORDER BY i.id) AS pos,
             count(*) OVER (PARTITION BY i.tank_id, i.seg) AS cnt, MIN(i.id) OVER (PARTITION BY i.tank_id, i.seg) AS first_id
      FROM iss0 i
    ), iss AS (
      SELECT DISTINCT ON (i.reference_id) i.reference_id, tk.tank_code, i.first_id, i.pos, i.cnt
      FROM iss1 i JOIN zmcc_tank tk ON tk.id = i.tank_id
      WHERE i.reference_id IN (SELECT id::text FROM vr)
      ORDER BY i.reference_id, i.id
    )
    SELECT vr.id::text AS id, vr.visit_number, vr.vehicle_number, vr.zid::text AS zid, vr.zname, vr.day, vr.total,
           vr.t_disp, vr.slip_l::float8 AS slip_l, vr.slip_13::float8 AS slip_13,
           gl.t_in, gl.t_out, wt.t_w, rc.t_rc,
           wt.net_kg::float8 AS net_kg, rc.lr::float8 AS lr, rc.ts::float8 AS ts,
           pd.rej, pd.acc,
           iss.tank_code, iss.first_id::text AS first_id, iss.pos::int AS pos, iss.cnt::int AS cnt,
           ${mins('vr.sub_at', 'vr.t_disp')}::float8 AS d_dispatch,
           ${mins('gl.in_sub', 'gl.t_in')}::float8 AS d_gate,
           ${mins('wt.w_sub', 'wt.t_w')}::float8 AS d_weight
    FROM vr
    LEFT JOIN gl ON gl.visit_id = vr.id
    LEFT JOIN wt ON wt.visit_id = vr.id
    LEFT JOIN rc ON rc.visit_id = vr.id
    LEFT JOIN pd ON pd.visit_id = vr.id
    LEFT JOIN iss ON iss.reference_id = vr.id::text
    ORDER BY vr.t_disp DESC, vr.id DESC`);

  const out: TankerRow[] = rows.map((r) => {
    const dispatchAt = iso(r.t_disp);
    const gateIn = iso(r.t_in);
    const firstWeightAt = iso(r.t_w);
    const fillCount = r.cnt == null ? 0 : num(r.cnt);
    const delays = { dispatch: optNum(r.d_dispatch), gate: optNum(r.d_gate), weight: optNum(r.d_weight) };
    const netKg = r.net_kg == null ? null : num(r.net_kg);
    let plantLiters: number | null = null;
    let plant13: number | null = null;
    if (netKg != null && netKg > 0 && r.lr != null && r.ts != null) {
      const l = netKg / (1 + num(r.lr) / 1000);
      plantLiters = round2(l);
      plant13 = round2((l * num(r.ts)) / 13);
    }
    const arrival = gateIn ?? firstWeightAt;
    const dayOfArrival = q.basis === 'business' ? businessDate(arrival) : pkDate(arrival);
    return {
      visitId: String(r.id),
      visitNumber: String(r.visit_number ?? ''),
      vehicle: String(r.vehicle_number ?? ''),
      zmccId: String(r.zid),
      zmcc: String(r.zname ?? ''),
      dispatchAt,
      gateIn,
      gateOut: iso(r.t_out),
      firstWeightAt,
      receiptAt: iso(r.t_rc),
      decision: r.rej ? 'REJECTED' : r.acc ? 'ACCEPTED' : 'PENDING',
      dispatchDay: r.day instanceof Date ? r.day.toISOString().slice(0, 10) : String(r.day).slice(0, 10),
      plantDay: dayOfArrival,
      fillId: r.first_id ? `${String(r.tank_code)}-${String(r.first_id)}` : null,
      fillCount,
      fillPos: r.pos == null ? 0 : num(r.pos),
      slipLiters: optNum(r.slip_l),
      slip13: optNum(r.slip_13),
      plantLiters,
      plant13,
      delays,
      ...tankerFlags({ dispatchAt, gateIn, firstWeightAt, fillCount, delays }),
    };
  });

  const total = rows.length ? num(rows[0].total) : 0;
  return { rows: out, total, cut: total > out.length };
}
