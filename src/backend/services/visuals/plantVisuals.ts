import { Prisma } from '@prisma/client';
import { pkLocal } from '@/backend/core/sqlTime';
import type { VisualsQuery } from '@/backend/modules/management-reporting/visuals/common';
import {
  HISTOGRAM_BUCKETS,
  PLANT_STAGE_KEYS,
  slowestStage,
  topReasons,
  type PlantInsideRow,
  type PlantSourceRow,
  type PlantStageKey,
  type PlantStat,
  type PlantType,
  type PlantVehicleRow,
  type PlantView,
  type PlantVisuals,
} from '@/backend/modules/management-reporting/visuals/plantContracts';
import { allDays, daySql, dayKey, num, round2, VISUALS_TOP_N, type VisualsDb } from './visualsCommon';

const DAY_MS = 86_400_000;
const TYPES: PlantType[] = ['ALL', 'ZMCC', 'CONTRACTOR'];
type SourceType = 'ZMCC' | 'CONTRACTOR' | 'UNKNOWN';
const asType = (v: unknown): SourceType => (v === 'ZMCC' || v === 'CONTRACTOR' ? v : 'UNKNOWN');
const optNum = (v: unknown): number | null => (v == null ? null : round2(num(v)));
const emptyStat = (): PlantStat => ({ n: 0, median: null, p90: null, avg: null });

/** Minutes from a to b; only when both exist and b is not before a. */
const dur = (a: string, b: string) =>
  Prisma.raw(`CASE WHEN ${a} IS NOT NULL AND ${b} IS NOT NULL AND ${b} >= ${a} THEN EXTRACT(EPOCH FROM (${b} - ${a})) / 60.0 END`);

/**
 * The vehicles in range, one row each, with stage times in minutes. Child tables are summed per visit first and
 * only for the visits in range. Neither the gate entry nor the business day is indexed, so the visits are narrowed
 * on the indexed created_at (3 days margin) and then filtered exactly.
 */
function baseSql(q: VisualsQuery): Prisma.Sql {
  const lo = new Date(Date.parse(`${q.from}T00:00:00Z`) - 3 * DAY_MS - 5 * 3_600_000);
  const hi = new Date(Date.parse(`${q.to}T00:00:00Z`) + 4 * DAY_MS);
  // Only ZMCCs picked: those ZMCCs. Only contractors picked: those contractors. Both: both. Nothing: every source.
  const ids = q.zmccPicked ? [...q.zmccIds, ...q.contractorIds] : [...q.contractorIds];
  const scope =
    q.zmccPicked || q.contractorIds.length
      ? ids.length
        ? Prisma.sql`AND vv.procurement_source_id IN (${Prisma.join(ids)})`
        : Prisma.sql`AND FALSE`
      : Prisma.empty;
  const dayExpr = q.basis === 'business' ? Prisma.sql`vv.operational_date` : daySql('g.entry_timestamp', 'calendar');
  return Prisma.sql`
    WITH v AS (
      SELECT vv.id, vv.vehicle_number, COALESCE(vv.procurement_source_id, 0) AS sid,
             COALESCE(ps.source_type, 'UNKNOWN') AS st, COALESCE(ps.name, 'No source') AS sname,
             g.entry_timestamp AS t_in, g.exit_timestamp AS t_out, ${dayExpr} AS day,
             EXTRACT(HOUR FROM ${pkLocal('g.entry_timestamp')})::int AS hr
      FROM vehicle_visit vv
      JOIN gate_log g ON g.visit_id = vv.id
      LEFT JOIN procurement_source ps ON ps.id = vv.procurement_source_id
      WHERE vv.created_at >= ${lo} AND vv.created_at < ${hi}
        AND vv.current_status <> 'CANCELLED'
        AND g.entry_timestamp IS NOT NULL
        ${scope}
    ), vr AS (
      SELECT * FROM v WHERE day BETWEEN ${q.from}::date AND ${q.to}::date
    ), qa AS (
      SELECT s.visit_id, s.started_at, s.completed_at FROM qa_testing_session s WHERE s.visit_id IN (SELECT id FROM vr)
    ), pp AS (
      SELECT p.visit_id, MAX(p.plant_decided_at) AS last_decided, MIN(p.first_weight_at) AS fw, MAX(p.second_weight_at) AS sw
      FROM visit_portion p WHERE p.visit_id IN (SELECT id FROM vr) GROUP BY p.visit_id
    ), wt AS (
      SELECT w.visit_id, MIN(w.gross_timestamp) AS g, MAX(w.tare_timestamp) AS t
      FROM weight_ticket w WHERE w.visit_id IN (SELECT id FROM vr) GROUP BY w.visit_id
    ), ul AS (
      SELECT p.visit_id, MIN(u.pump_start_timestamp) AS s, MAX(u.pump_end_timestamp) AS e
      FROM unloading_log u JOIN visit_portion p ON p.id = u.portion_id
      WHERE p.visit_id IN (SELECT id FROM vr) GROUP BY p.visit_id
    ), rc AS (
      SELECT r.visit_id, MAX(r.operational_timestamp) AS r, SUM(r.quantity_liters) AS l, SUM(r.plant_final_at_13ts_liters) AS a
      FROM silo_inventory_transaction r
      WHERE r.transaction_type = 'RECEIPT' AND r.visit_id IN (SELECT id FROM vr) GROUP BY r.visit_id
    ), t0 AS (
      SELECT vr.*, qa.started_at AS t_qs, COALESCE(qa.completed_at, pp.last_decided) AS t_qd,
             COALESCE(wt.g, pp.fw) AS t_fw, ul.s AS t_us, ul.e AS t_ue, COALESCE(wt.t, pp.sw) AS t_sw, rc.r AS t_rc,
             COALESCE(rc.l, 0) AS rec_l, COALESCE(rc.a, 0) AS rec_a
      FROM vr
      LEFT JOIN qa ON qa.visit_id = vr.id LEFT JOIN pp ON pp.visit_id = vr.id LEFT JOIN wt ON wt.visit_id = vr.id
      LEFT JOIN ul ON ul.visit_id = vr.id LEFT JOIN rc ON rc.visit_id = vr.id
    ), t AS (
      SELECT t0.*,
             ${dur('t_in', 't_qs')} AS gate_qa, ${dur('t_qs', 't_qd')} AS qa, ${dur('t_qd', 't_fw')} AS qa_weight,
             ${dur('t_fw', 't_us')} AS weight_unload, ${dur('t_us', 't_ue')} AS unloading,
             ${dur('t_ue', 't_sw')} AS unload_weight2, ${dur('t_sw', 't_rc')} AS weight2_receipt,
             ${dur('t_rc', 't_out')} AS receipt_exit, ${dur('t_in', 't_out')} AS total
      FROM t0
    )`;
}

const sidOf = (v: unknown) => (v == null ? null : String(v));

function statOf(r: Record<string, unknown>): PlantStat {
  return { n: num(r.n), median: optNum(r.med), p90: optNum(r.p90), avg: optNum(r.avg) };
}

type Row = Record<string, unknown>;

/** Plant tab figures for the chosen days. */
export async function loadPlantVisuals(q: VisualsQuery, db: VisualsDb): Promise<PlantVisuals> {
  const base = baseSql(q);
  const days = allDays(q.from, q.to);

  // 1. Stage statistics: overall, per type, per source, and total per day (per type too).
  const stageRows = await db.$queryRaw<Row[]>(Prisma.sql`
    ${base}
    SELECT * FROM (
      SELECT s.stage, u.day, u.st, u.sid,
             count(*) AS n, percentile_cont(0.5) WITHIN GROUP (ORDER BY s.m) AS med,
             percentile_cont(0.9) WITHIN GROUP (ORDER BY s.m) AS p90, avg(s.m) AS avg
      FROM t u
      CROSS JOIN LATERAL (VALUES ('gate_qa', u.gate_qa), ('qa', u.qa), ('qa_weight', u.qa_weight), ('weight_unload', u.weight_unload),
        ('unloading', u.unloading), ('unload_weight2', u.unload_weight2), ('weight2_receipt', u.weight2_receipt),
        ('receipt_exit', u.receipt_exit), ('total', u.total)) AS s(stage, m)
      WHERE s.m IS NOT NULL
      GROUP BY GROUPING SETS ((s.stage), (s.stage, u.st), (s.stage, u.sid), (s.stage, u.day), (s.stage, u.day, u.st))
    ) x
    WHERE x.stage = 'total' OR x.day IS NULL`);

  // 2. Vehicle counts: per day, type, source, hour and time bucket.
  const vehRows = await db.$queryRaw<Row[]>(Prisma.sql`
    ${base}
    SELECT day, st, sid, hr, hb, count(*) AS vehicles, count(*) FILTER (WHERE t_out IS NULL) AS inside,
           SUM(rec_l) AS liters, SUM(rec_a) AS at13
    FROM (SELECT t.*, CASE WHEN total IS NULL THEN -1 ELSE LEAST(${HISTOGRAM_BUCKETS - 1}, FLOOR(total / 60.0))::int END AS hb FROM t) z
    GROUP BY GROUPING SETS ((), (st), (sid), (day), (day, st), (hr), (st, hr), (hb), (st, hb))`);

  // 3. Decisions per portion; PENDING stays out.
  const decRows = await db.$queryRaw<Row[]>(Prisma.sql`
    ${base}
    SELECT vr.day, vr.st, vr.sid, d.reason,
           count(*) FILTER (WHERE d.dec = 'ACCEPTED') AS accepted, count(*) FILTER (WHERE d.dec = 'REJECTED') AS rejected
    FROM vr
    JOIN (
      SELECT p.visit_id, p.plant_decision AS dec,
             CASE WHEN p.plant_decision = 'REJECTED'
                  THEN COALESCE(NULLIF(lower(btrim(regexp_replace(p.plant_rejection_reason, '\\s+', ' ', 'g'))), ''), '(no reason)')
                  ELSE '' END AS reason
      FROM visit_portion p
      WHERE p.visit_id IN (SELECT id FROM vr) AND p.plant_decision IN ('ACCEPTED', 'REJECTED')
    ) d ON d.visit_id = vr.id
    GROUP BY GROUPING SETS ((), (vr.st), (vr.day), (vr.day, vr.st), (vr.sid), (d.reason), (vr.st, d.reason))`);

  // 4. The slowest vehicles and the ones still inside after 12 hours.
  const slowRows = await db.$queryRaw<Row[]>(Prisma.sql`
    ${base}
    SELECT * FROM (
      SELECT t.*, row_number() OVER (ORDER BY total DESC) AS r_all, row_number() OVER (PARTITION BY st ORDER BY total DESC) AS r_st
      FROM t WHERE total IS NOT NULL
    ) k WHERE r_all <= 15 OR r_st <= 15`);
  const insideRows = await db.$queryRaw<Row[]>(Prisma.sql`
    ${base}
    SELECT id, vehicle_number, st, sname, t_in, EXTRACT(EPOCH FROM (now() - t_in)) / 3600.0 AS hours
    FROM vr WHERE t_out IS NULL AND now() - t_in > interval '12 hours' ORDER BY t_in LIMIT 15`);

  /* ------------------------------ Assemble ------------------------------ */
  const mk = (): PlantView => ({
    vehicles: 0,
    insideNow: 0,
    accepted: 0,
    rejected: 0,
    liters: 0,
    at13ts: 0,
    total: emptyStat(),
    stages: Object.fromEntries(PLANT_STAGE_KEYS.map((k) => [k, emptyStat()])) as Record<PlantStageKey, PlantStat>,
    days: days.map((day) => ({ day, vehicles: 0, accepted: 0, rejected: 0, n: 0, medW: 0, p90W: 0, liters: 0, at13ts: 0 })),
    histogram: new Array<number>(HISTOGRAM_BUCKETS).fill(0),
    hours: new Array<number>(24).fill(0),
    reasons: [],
  });
  const views = { ALL: mk(), ZMCC: mk(), CONTRACTOR: mk() } as Record<PlantType, PlantView>;
  const dayIndex = new Map(days.map((d, i) => [d, i]));
  const reasonRows: Record<PlantType, Array<{ reason: string; count: number }>> = { ALL: [], ZMCC: [], CONTRACTOR: [] };
  const sources = new Map<string, PlantSourceRow>();
  const source = (sid: string): PlantSourceRow => {
    let s = sources.get(sid);
    if (!s) {
      s = {
        id: sid,
        name: sid,
        type: 'UNKNOWN',
        vehicles: 0,
        accepted: 0,
        rejected: 0,
        total: emptyStat(),
        stages: Object.fromEntries(PLANT_STAGE_KEYS.map((k) => [k, null])) as Record<PlantStageKey, number | null>,
      };
      sources.set(sid, s);
    }
    return s;
  };
  /** A row with no type belongs to ALL; a ZMCC or contractor row to its own view. (Unknown-source vehicles are in ALL only.) */
  const viewsOf = (st: unknown): PlantView[] => (st == null ? [views.ALL] : st === 'ZMCC' || st === 'CONTRACTOR' ? [views[st]] : []);

  for (const r of stageRows) {
    const sid = sidOf(r.sid);
    const day = r.day == null ? null : dayKey(r.day);
    const stat = statOf(r);
    if (sid != null) {
      const s = source(sid);
      if (r.stage === 'total') s.total = stat;
      else s.stages[r.stage as PlantStageKey] = stat.median;
    } else if (day != null) {
      const i = dayIndex.get(day);
      if (i == null) continue;
      for (const v of viewsOf(r.st)) {
        v.days[i].n = stat.n;
        v.days[i].medW = round2((stat.median ?? 0) * stat.n);
        v.days[i].p90W = round2((stat.p90 ?? 0) * stat.n);
      }
    } else {
      for (const v of viewsOf(r.st)) {
        if (r.stage === 'total') v.total = stat;
        else v.stages[r.stage as PlantStageKey] = stat;
      }
    }
  }

  for (const r of vehRows) {
    const sid = sidOf(r.sid);
    const day = r.day == null ? null : dayKey(r.day);
    const vehicles = num(r.vehicles);
    if (sid != null) {
      source(sid).vehicles = vehicles;
      continue;
    }
    for (const v of viewsOf(r.st)) {
      if (day != null) {
        const i = dayIndex.get(day);
        if (i != null) {
          v.days[i].vehicles = vehicles;
          v.days[i].liters = round2(num(r.liters));
          v.days[i].at13ts = round2(num(r.at13));
        }
      } else if (r.hr != null) {
        v.hours[num(r.hr)] = vehicles;
      } else if (r.hb != null) {
        if (num(r.hb) >= 0) v.histogram[num(r.hb)] = vehicles;
      } else {
        v.vehicles = vehicles;
        v.insideNow = num(r.inside);
        v.liters = round2(num(r.liters));
        v.at13ts = round2(num(r.at13));
      }
    }
  }

  for (const r of decRows) {
    const sid = sidOf(r.sid);
    const day = r.day == null ? null : dayKey(r.day);
    const accepted = num(r.accepted);
    const rejected = num(r.rejected);
    if (sid != null) {
      const s = source(sid);
      s.accepted = accepted;
      s.rejected = rejected;
    } else if (r.reason != null) {
      if (r.reason === '') continue;
      const types: PlantType[] = r.st == null ? ['ALL'] : r.st === 'ZMCC' || r.st === 'CONTRACTOR' ? [r.st] : [];
      for (const t of types) reasonRows[t].push({ reason: String(r.reason), count: rejected });
    } else {
      for (const v of viewsOf(r.st)) {
        if (day != null) {
          const i = dayIndex.get(day);
          if (i != null) {
            v.days[i].accepted = accepted;
            v.days[i].rejected = rejected;
          }
        } else {
          v.accepted = accepted;
          v.rejected = rejected;
        }
      }
    }
  }
  for (const t of TYPES) views[t].reasons = topReasons(reasonRows[t], 10);

  // Names and types of the sources, then the top 50 by vehicles.
  const sourceIds = [...sources.keys()].filter((id) => id !== '0');
  const names = sourceIds.length
    ? await db.$queryRaw<Array<{ id: bigint; name: string; source_type: string }>>(Prisma.sql`
        SELECT id, name, source_type FROM procurement_source WHERE id IN (${Prisma.join(sourceIds.map((id) => BigInt(id)))})`)
    : [];
  for (const n of names) {
    const s = sources.get(String(n.id));
    if (s) {
      s.name = n.name;
      s.type = asType(n.source_type);
    }
  }
  const zero = sources.get('0');
  if (zero) zero.name = 'No source';
  const sourceList = [...sources.values()].sort((a, b) => b.vehicles - a.vehicles).slice(0, VISUALS_TOP_N);

  const slowest: PlantVehicleRow[] = slowRows
    .sort((a, b) => num(b.total) - num(a.total))
    .map((r) => {
      const med: Partial<Record<PlantStageKey, number | null>> = {};
      for (const k of PLANT_STAGE_KEYS) med[k] = r[k] == null ? null : num(r[k]);
      const longest = slowestStage(med);
      return {
        visitId: String(r.id),
        vehicle: String(r.vehicle_number),
        source: String(r.sname),
        type: asType(r.st),
        entry: new Date(r.t_in as Date).toISOString(),
        exit: new Date(r.t_out as Date).toISOString(),
        totalMin: round2(num(r.total)),
        longestStage: longest,
        longestMin: longest ? round2(num(med[longest])) : null,
      };
    });
  const longInside: PlantInsideRow[] = insideRows.map((r) => ({
    visitId: String(r.id),
    vehicle: String(r.vehicle_number),
    source: String(r.sname),
    type: asType(r.st),
    entry: new Date(r.t_in as Date).toISOString(),
    hours: round2(num(r.hours)),
  }));
  return { views, sources: sourceList, slowest, longInside };
}
