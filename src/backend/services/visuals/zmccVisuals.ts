/**
 * ZMCC tab. Intake, dispatch, plant and road come from getZmccStageChain (reused, never rewritten). The tank level is
 * the running sum of the tank ledger (zmcc_tank_inventory_transaction): RECEIPT and ADJUSTMENT_IN plus, ISSUE and
 * ADJUSTMENT_OUT minus. A day's closing level is the running value after all its rows, so the order of rows inside a
 * day (id order) does not change it.
 */
import { Prisma } from '@prisma/client';
import type { VisualsQuery } from '@/backend/modules/management-reporting/visuals/common';
import type { TankDay, TankZmcc, ZmccVisuals } from '@/backend/modules/management-reporting/visuals/zmccContracts';
import { getZmccStageChain } from '@/backend/services/zmccStageChainService';
import { allDays, dayKey, daySql, num, round2, type VisualsDb } from './visualsCommon';

/** What the ledger moved on one day of one ZMCC. */
export interface LedgerDayMove {
  day: string;
  inL: number;
  outL: number;
}

/**
 * Daily opening, in, out and closing level from the ledger's daily movements. `moves` may include days before `from`
 * (they only build the opening level) and are ignored after `to`. Days with no movement carry the level forward. Pure.
 */
export function buildTankDays(moves: LedgerDayMove[], from: string, to: string): TankDay[] {
  const byDay = new Map<string, LedgerDayMove>();
  let level = 0;
  for (const m of moves) {
    if (m.day < from) level += m.inL - m.outL;
    else if (m.day <= to) {
      const cur = byDay.get(m.day) ?? { day: m.day, inL: 0, outL: 0 };
      cur.inL += m.inL;
      cur.outL += m.outL;
      byDay.set(m.day, cur);
    }
  }
  return allDays(from, to).map((day) => {
    const m = byDay.get(day);
    const inL = m?.inL ?? 0;
    const outL = m?.outL ?? 0;
    const opening = level;
    level += inL - outL;
    return { day, opening: round2(opening), inL: round2(inL), outL: round2(outL), closing: round2(level) };
  });
}

const shiftDay = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

export async function loadZmccVisuals(q: VisualsQuery, db: VisualsDb): Promise<ZmccVisuals> {
  const ids = q.zmccIds.map(String);
  const stagePromise = getZmccStageChain({ from: q.from, to: q.to, zmccIds: q.zmccPicked ? ids : undefined, basis: q.basis });
  // Ledger rows of these ZMCCs up to the end of the range (+1 day margin on the indexed timestamp, then exact day filter).
  const rows = await db.$queryRaw<Array<Record<string, unknown>>>`
    SELECT x.zmcc_id::text AS zmcc_id, d.day,
           SUM(CASE WHEN x.transaction_type IN ('RECEIPT', 'ADJUSTMENT_IN') THEN x.quantity_liters ELSE 0 END)::float8 AS in_l,
           SUM(CASE WHEN x.transaction_type IN ('ISSUE', 'ADJUSTMENT_OUT') THEN x.quantity_liters ELSE 0 END)::float8 AS out_l
    FROM zmcc_tank_inventory_transaction x
    CROSS JOIN LATERAL (SELECT ${daySql('x.operational_timestamp', q.basis)} AS day) d
    WHERE x.zmcc_id IN (${Prisma.join(q.zmccIds)})
      AND x.operational_timestamp < (${shiftDay(q.to, 2)}::date)::timestamptz
      AND d.day <= ${q.to}::date
    GROUP BY x.zmcc_id, d.day
    ORDER BY x.zmcc_id, d.day`;
  const names = await db.procurementSource.findMany({ where: { id: { in: q.zmccIds } }, select: { id: true, name: true }, orderBy: { name: 'asc' } });
  const moves = new Map<string, LedgerDayMove[]>();
  for (const r of rows) {
    const list = moves.get(String(r.zmcc_id)) ?? [];
    list.push({ day: dayKey(r.day), inL: num(r.in_l), outL: num(r.out_l) });
    moves.set(String(r.zmcc_id), list);
  }
  const tanks: TankZmcc[] = names.map((z) => ({ zmccId: z.id.toString(), zmccName: z.name, days: buildTankDays(moves.get(z.id.toString()) ?? [], q.from, q.to) }));
  return { stage: await stagePromise, tanks };
}
