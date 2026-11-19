/**
 * Drill-down below a ZMCC for the Stage by stage report: Mobile Testers, routes and HC suppliers.
 * Mobile Tester and route figures follow the journey date (a journey belongs to one day); HC follows the arrival
 * day (calendar or business day). Received figures come from the ZMCC tank receipts with their lab tests, as they
 * are now (corrections included). Read live; nothing is stored.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '@core/db';
import { pkLocal } from '@/backend/core/sqlTime';
import type { StageDrillLevel, StageDrillReport, StageHcRow, StageMotRow, StagePair } from '@/backend/modules/management-reporting/stageChainContracts';

const pair = (liters: unknown, at13: unknown): StagePair => ({
  liters: Math.round(Number(liters ?? 0) * 100) / 100,
  at13ts: Math.round(Number(at13 ?? 0) * 100) / 100,
});
const tsOf = (p: StagePair) => (p.liters > 0 ? Math.round(((p.at13ts * 13) / p.liters) * 100) / 100 : null);
const dayCount = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) + 1;

async function zmccIdsFor(zmccIds: string[] | undefined): Promise<bigint[]> {
  const ids = (zmccIds ?? []).filter((id) => /^\d{1,18}$/.test(id)).map((id) => BigInt(id));
  const rows = await prisma.procurementSource.findMany({
    where: { source_type: 'ZMCC', ...(ids.length ? { id: { in: ids } } : {}) },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

async function motRows(groupBy: 'TESTER' | 'ROUTE', from: string, to: string, zmccIds: bigint[]): Promise<StageMotRow[]> {
  if (!zmccIds.length) return [];
  const key = groupBy === 'TESTER' ? Prisma.sql`j.mot_profile_id` : Prisma.sql`j.route_id`;
  const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    WITH js AS (
      SELECT j.id, ${key} AS key, j.zmcc_id,
             EXISTS (SELECT 1 FROM zmcc_mot_arrival a WHERE a.journey_id = j.id) AS arrived
      FROM mot_journey j
      WHERE j.zmcc_id IN (${Prisma.join(zmccIds)}) AND j.operational_date BETWEEN ${from}::date AND ${to}::date
        AND j.status <> 'CANCELLED'
    ),
    col AS (
      SELECT js.key,
             COUNT(*) FILTER (WHERE c.final_decision = 'ACCEPTED') AS shops,
             COUNT(*) FILTER (WHERE c.final_decision = 'REJECTED') AS rejected,
             SUM(c.gross_liters) FILTER (WHERE c.final_decision = 'ACCEPTED') AS l,
             SUM(c.at_13ts_liters) FILTER (WHERE c.final_decision = 'ACCEPTED') AS a13,
             SUM(c.gross_liters) FILTER (WHERE c.final_decision = 'ACCEPTED' AND js.arrived) AS l_arr,
             SUM(c.at_13ts_liters) FILTER (WHERE c.final_decision = 'ACCEPTED' AND js.arrived) AS a13_arr
      FROM js JOIN mot_shop_collection c ON c.journey_id = js.id
      GROUP BY js.key
    ),
    rec AS (
      SELECT js.key, SUM(tr.gross_liters) AS l, SUM(tr.gross_liters * tr.ts / 13) AS a13
      FROM js
      JOIN zmcc_mot_arrival a ON a.journey_id = js.id
      JOIN zmcc_lab_session ls ON ls.mot_arrival_id = a.id
      JOIN zmcc_tank_receipt tr ON tr.lab_session_id = ls.id
      GROUP BY js.key
    ),
    cnt AS (SELECT key, COUNT(*) AS journeys, COUNT(*) FILTER (WHERE NOT arrived) AS open, MIN(zmcc_id) AS zmcc_id FROM js GROUP BY key)
    SELECT cnt.key::text AS key, cnt.journeys::int AS journeys, cnt.open::int AS open, ps.name AS zmcc_name,
           col.l_arr::float8 AS arr_l, col.a13_arr::float8 AS arr_a13,
           COALESCE(col.shops, 0)::int AS shops, COALESCE(col.rejected, 0)::int AS rejected,
           col.l::float8 AS col_l, col.a13::float8 AS col_a13, rec.l::float8 AS rec_l, rec.a13::float8 AS rec_a13
    FROM cnt
    LEFT JOIN col ON col.key IS NOT DISTINCT FROM cnt.key
    LEFT JOIN rec ON rec.key IS NOT DISTINCT FROM cnt.key
    LEFT JOIN procurement_source ps ON ps.id = cnt.zmcc_id`;

  const keys = rows.map((r) => r.key).filter((k): k is string => typeof k === 'string').map((k) => BigInt(k));
  const names = new Map<string, { name: string; code: string | null }>();
  if (keys.length) {
    if (groupBy === 'TESTER') {
      for (const p of await prisma.motProfile.findMany({ where: { id: { in: keys } }, select: { id: true, name: true, mot_code: true } })) {
        names.set(p.id.toString(), { name: p.name, code: p.mot_code });
      }
    } else {
      for (const r of await prisma.zmccRoute.findMany({ where: { id: { in: keys } }, select: { id: true, name: true, route_code: true } })) {
        names.set(r.id.toString(), { name: r.name, code: r.route_code });
      }
    }
  }
  return rows
    .map((r) => {
      const id = r.key == null ? '' : String(r.key);
      const collected = pair(r.col_l, r.col_a13);
      const collectedArrived = pair(r.arr_l, r.arr_a13);
      const received = pair(r.rec_l, r.rec_a13);
      const n = names.get(id);
      return {
        id: id || 'none',
        name: n?.name ?? (groupBy === 'ROUTE' ? 'No route' : 'Unknown tester'),
        code: n?.code ?? null,
        zmccName: String(r.zmcc_name ?? ''),
        journeys: Number(r.journeys ?? 0),
        notArrived: Number(r.open ?? 0),
        shops: Number(r.shops ?? 0),
        rejectedShops: Number(r.rejected ?? 0),
        collected,
        received,
        ts: { collected: tsOf(collected), received: tsOf(received) },
        trip: pair(received.liters - collectedArrived.liters, received.at13ts - collectedArrived.at13ts),
      };
    })
    .sort((a, b) => b.collected.at13ts - a.collected.at13ts);
}

async function hcRows(from: string, to: string, zmccIds: bigint[], basis: 'calendar' | 'business'): Promise<StageHcRow[]> {
  if (!zmccIds.length) return [];
  const day =
    basis === 'business' ? Prisma.sql`(${pkLocal('a.arrival_timestamp')} - interval '8 hours')::date` : Prisma.sql`a.arrival_date`;
  const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT s.id::text AS id, s.name, s.local_supplier_code AS code, ps.name AS zmcc_name,
           COUNT(*)::int AS arrivals,
           COUNT(*) FILTER (WHERE ls.final_decision = 'ACCEPTED')::int AS accepted,
           COUNT(*) FILTER (WHERE ls.final_decision = 'REJECTED')::int AS rejected,
           COUNT(*) FILTER (WHERE ls.exit_outcome IN ('PARTLY_RECEIVED', 'ACCEPTED_NOT_RECEIVED', 'NOT_RECEIVED'))::int AS left_early,
           SUM(r.l)::float8 AS l, SUM(r.a13)::float8 AS a13
    FROM zmcc_local_supplier_arrival a
    JOIN zmcc_local_supplier s ON s.id = a.local_supplier_id
    JOIN procurement_source ps ON ps.id = a.zmcc_id
    LEFT JOIN zmcc_lab_session ls ON ls.local_supplier_arrival_id = a.id
    LEFT JOIN LATERAL (
      SELECT SUM(tr.gross_liters) AS l, SUM(tr.gross_liters * tr.ts / 13) AS a13
      FROM zmcc_tank_receipt tr WHERE tr.lab_session_id = ls.id
    ) r ON true
    WHERE a.zmcc_id IN (${Prisma.join(zmccIds)}) AND ${day} BETWEEN ${from}::date AND ${to}::date
    GROUP BY s.id, s.name, s.local_supplier_code, ps.name`;
  return rows
    .map((r) => {
      const received = pair(r.l, r.a13);
      return {
        id: String(r.id),
        name: String(r.name ?? ''),
        code: (r.code as string | null) ?? null,
        zmccName: String(r.zmcc_name ?? ''),
        arrivals: Number(r.arrivals ?? 0),
        accepted: Number(r.accepted ?? 0),
        rejected: Number(r.rejected ?? 0),
        leftEarly: Number(r.left_early ?? 0),
        received,
        ts: tsOf(received),
      };
    })
    .sort((a, b) => b.received.at13ts - a.received.at13ts);
}

export async function getStageDrill(input: {
  level: StageDrillLevel;
  from: string;
  to: string;
  zmccIds?: string[];
  basis?: 'calendar' | 'business';
}): Promise<StageDrillReport> {
  const zmccIds = await zmccIdsFor(input.zmccIds);
  const base = { level: input.level, from: input.from, to: input.to, days: dayCount(input.from, input.to) };
  if (input.level === 'TESTER') return { ...base, testers: await motRows('TESTER', input.from, input.to, zmccIds) };
  if (input.level === 'ROUTE') return { ...base, routes: await motRows('ROUTE', input.from, input.to, zmccIds) };
  return { ...base, hcSuppliers: await hcRows(input.from, input.to, zmccIds, input.basis === 'business' ? 'business' : 'calendar') };
}
