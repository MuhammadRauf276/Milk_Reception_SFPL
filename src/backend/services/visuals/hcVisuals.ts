/**
 * HC suppliers tab. Same definitions as zmccStageDrillService.hcRows: arrivals = zmcc_local_supplier_arrival,
 * decision = zmcc_lab_session.final_decision, received = zmcc_tank_receipt litres and litres @13 TS.
 */
import { Prisma } from '@prisma/client';
import { pkLocal } from '@/backend/core/sqlTime';
import type { VisualsQuery } from '@/backend/modules/management-reporting/visuals/common';
import type { HcDay, HcSupplierRow, HcTotals, HcVisuals } from '@/backend/modules/management-reporting/visuals/hcContracts';
import { VISUALS_TOP_N, allDays, dayKey, num, qty, round2, type VisualsDb } from './visualsCommon';

const LEFT_EARLY = Prisma.sql`('PARTLY_RECEIVED', 'ACCEPTED_NOT_RECEIVED', 'NOT_RECEIVED')`;

const shiftDay = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

/** Totals are taken from every supplier; the supplier list is capped at `keep` (by arrivals) and the rest added up as "Others". Pure. */
export function buildHcVisuals(
  suppliers: HcSupplierRow[],
  daily: HcDay[],
  options: HcVisuals['supplierOptions'],
  rejectionReasons: HcVisuals['rejectionReasons'],
  keep = VISUALS_TOP_N
): HcVisuals {
  const sum = (f: (r: HcSupplierRow) => number) => suppliers.reduce((s, r) => s + f(r), 0);
  const received = { liters: round2(sum((r) => r.received.liters)), at13ts: round2(sum((r) => r.received.at13ts)) };
  const top5 = [...suppliers]
    .sort((a, b) => b.received.at13ts - a.received.at13ts)
    .slice(0, 5)
    .reduce((s, r) => s + r.received.at13ts, 0);
  const totals: HcTotals = {
    arrivals: sum((r) => r.arrivals),
    accepted: sum((r) => r.accepted),
    rejected: sum((r) => r.rejected),
    leftEarly: sum((r) => r.leftEarly),
    received,
    activeSuppliers: suppliers.filter((r) => r.arrivals > 0).length,
    top5Share: received.at13ts > 0 ? round2((top5 / received.at13ts) * 100) : null,
  };
  const sorted = [...suppliers].sort((a, b) => b.arrivals - a.arrivals || b.received.at13ts - a.received.at13ts);
  const head = sorted.slice(0, keep);
  const rest = sorted.slice(keep);
  if (rest.length) {
    const r = (f: (x: HcSupplierRow) => number) => rest.reduce((s, x) => s + f(x), 0);
    head.push({
      id: '__others',
      name: 'Others',
      code: null,
      zmccName: '',
      arrivals: r((x) => x.arrivals),
      accepted: r((x) => x.accepted),
      rejected: r((x) => x.rejected),
      leftEarly: r((x) => x.leftEarly),
      received: { liters: round2(r((x) => x.received.liters)), at13ts: round2(r((x) => x.received.at13ts)) },
      daysSupplied: Math.max(...rest.map((x) => x.daysSupplied)),
    });
  }
  return { supplierOptions: options, totals, daily, suppliers: head, rejectionReasons };
}

export async function loadHcVisuals(q: VisualsQuery, db: VisualsDb): Promise<HcVisuals> {
  const zmccs = Prisma.join(q.zmccIds);
  const picked = q.ids.length ? Prisma.sql`AND a.local_supplier_id IN (${Prisma.join(q.ids.map((i) => BigInt(i)))})` : Prisma.empty;
  // Business day: narrow on the indexed arrival_date by a day each side, then filter exactly.
  const day = q.basis === 'business' ? Prisma.sql`((${pkLocal('a.arrival_timestamp')}) - interval '8 hours')::date` : Prisma.sql`a.arrival_date`;
  const narrow =
    q.basis === 'business'
      ? Prisma.sql`a.arrival_date BETWEEN ${shiftDay(q.from, -1)}::date AND ${shiftDay(q.to, 1)}::date AND ${day} BETWEEN ${q.from}::date AND ${q.to}::date`
      : Prisma.sql`a.arrival_date BETWEEN ${q.from}::date AND ${q.to}::date`;
  const joins = Prisma.sql`
    FROM zmcc_local_supplier_arrival a
    JOIN zmcc_local_supplier s ON s.id = a.local_supplier_id
    JOIN procurement_source ps ON ps.id = a.zmcc_id
    LEFT JOIN zmcc_lab_session ls ON ls.local_supplier_arrival_id = a.id
    LEFT JOIN LATERAL (
      SELECT SUM(tr.gross_liters) AS l, SUM(tr.gross_liters * tr.ts / 13) AS a13
      FROM zmcc_tank_receipt tr WHERE tr.lab_session_id = ls.id
    ) r ON true
    WHERE a.zmcc_id IN (${zmccs}) AND ${narrow} ${picked}`;

  const [optionRows, supplierRows, dayRows, reasonRows] = await Promise.all([
    db.$queryRaw<Array<Record<string, unknown>>>`
      SELECT s.id::text AS id, s.name, s.local_supplier_code AS code, ps.name AS zmcc_name
      FROM zmcc_local_supplier s JOIN procurement_source ps ON ps.id = s.zmcc_id
      WHERE s.zmcc_id IN (${zmccs}) AND s.is_active
      ORDER BY ps.name, s.name`,
    db.$queryRaw<Array<Record<string, unknown>>>`
      SELECT s.id::text AS id, s.name, s.local_supplier_code AS code, ps.name AS zmcc_name,
             COUNT(*)::int AS arrivals,
             COUNT(*) FILTER (WHERE ls.final_decision = 'ACCEPTED')::int AS accepted,
             COUNT(*) FILTER (WHERE ls.final_decision = 'REJECTED')::int AS rejected,
             COUNT(*) FILTER (WHERE ls.exit_outcome IN ${LEFT_EARLY})::int AS left_early,
             COUNT(DISTINCT ${day})::int AS days_supplied,
             SUM(r.l)::float8 AS l, SUM(r.a13)::float8 AS a13
      ${joins}
      GROUP BY s.id, s.name, s.local_supplier_code, ps.name`,
    db.$queryRaw<Array<Record<string, unknown>>>`
      SELECT ${day} AS day, COUNT(*)::int AS arrivals,
             COUNT(*) FILTER (WHERE ls.final_decision = 'ACCEPTED')::int AS accepted,
             COUNT(*) FILTER (WHERE ls.final_decision = 'REJECTED')::int AS rejected,
             COUNT(*) FILTER (WHERE ls.exit_outcome IN ${LEFT_EARLY})::int AS left_early,
             SUM(r.l)::float8 AS l, SUM(r.a13)::float8 AS a13
      ${joins}
      GROUP BY 1`,
    db.$queryRaw<Array<Record<string, unknown>>>`
      SELECT LEFT(COALESCE(NULLIF(btrim(ls.rejection_reason), ''), NULLIF(btrim(ls.final_decision_reason), ''), 'No reason typed'), 80) AS reason,
             COUNT(*)::int AS n
      ${joins}
      AND ls.final_decision = 'REJECTED'
      GROUP BY 1 ORDER BY n DESC LIMIT 10`,
  ]);

  const suppliers: HcSupplierRow[] = supplierRows.map((r) => ({
    id: String(r.id),
    name: String(r.name ?? ''),
    code: (r.code as string | null) ?? null,
    zmccName: String(r.zmcc_name ?? ''),
    arrivals: num(r.arrivals),
    accepted: num(r.accepted),
    rejected: num(r.rejected),
    leftEarly: num(r.left_early),
    received: qty(r.l, r.a13),
    daysSupplied: num(r.days_supplied),
  }));
  const byDay = new Map(dayRows.map((r) => [dayKey(r.day), r]));
  const daily: HcDay[] = allDays(q.from, q.to).map((d) => {
    const r = byDay.get(d);
    return {
      day: d,
      arrivals: num(r?.arrivals),
      accepted: num(r?.accepted),
      rejected: num(r?.rejected),
      leftEarly: num(r?.left_early),
      received: qty(r?.l, r?.a13),
    };
  });
  const options = optionRows.map((r) => ({ id: String(r.id), name: String(r.name ?? ''), code: (r.code as string | null) ?? null, group: String(r.zmcc_name ?? '') }));
  const reasons = reasonRows.map((r) => ({ reason: String(r.reason), count: num(r.n) }));
  return buildHcVisuals(suppliers, daily, options, reasons);
}
