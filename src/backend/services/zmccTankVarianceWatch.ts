/**
 * ZMCC tank variance watch: shows whether the @13 TS tank check meets real conflicts.
 *  - Over-book dispatches: dispatches that took a tank's @13 TS book below zero (allowed by the testing allowance).
 *  - Blocked dispatches: dispatches the check refused (recorded in the audit log when refused).
 * Everything is read live from the tank ledger and the audit log; nothing is stored for it.
 */
import { prisma } from '@core/db';
import { TANK_DISPATCH_BLOCKED_ACTION } from '@/backend/services/dispatch/dispatchDecisionService';

export interface OverBookDispatch {
  zmcc: string;
  vehicle: string;
  at: string;
  dispatchAt13ts: number;
  dispatchGross: number;
  bookAfterAt13ts: number;
}

export interface BlockedDispatch {
  zmcc: string;
  vehicle: string;
  at: string;
  dispatchAt13ts: number | null;
  bookAt13ts: number | null;
  limitAt13ts: number | null;
  variancePercent: number | null;
}

export interface TankVarianceWatch {
  days: number;
  overBook: OverBookDispatch[];
  blocked: BlockedDispatch[];
}

const num = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number(v));
const MAX_ROWS = 200;

export async function getTankVarianceWatch(days = 30): Promise<TankVarianceWatch> {
  const span = Math.min(Math.max(Math.floor(days) || 30, 1), 366);
  const since = new Date(Date.now() - span * 86_400_000);

  const [overBookRows, blockedRows, sources] = await Promise.all([
    prisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT x.zmcc_id, x.operational_timestamp, x.quantity_liters, x.at_13ts_liters, x.balance_after, v.vehicle_number
      FROM (
        SELECT t.*,
          SUM(CASE WHEN t.transaction_type IN ('RECEIPT', 'ADJUSTMENT_IN') THEN t.at_13ts_liters ELSE -t.at_13ts_liters END)
            OVER (PARTITION BY t.tank_id ORDER BY t.operational_timestamp, t.id) AS balance_after
        FROM zmcc_tank_inventory_transaction t
      ) x
      LEFT JOIN vehicle_visit v ON v.id = x.dispatch_id
      WHERE x.transaction_type = 'ISSUE' AND x.balance_after < -0.005 AND x.operational_timestamp >= ${since}
      ORDER BY x.operational_timestamp DESC
      LIMIT ${MAX_ROWS}
    `,
    prisma.auditLog.findMany({
      where: { action: TANK_DISPATCH_BLOCKED_ACTION, created_at: { gte: since } },
      orderBy: { created_at: 'desc' },
      take: MAX_ROWS,
      select: { created_at: true, new_values: true },
    }),
    prisma.procurementSource.findMany({ where: { source_type: 'ZMCC' }, select: { id: true, name: true } }),
  ]);

  const nameOf = new Map(sources.map((s) => [s.id.toString(), s.name]));
  return {
    days: span,
    overBook: overBookRows.map((r) => ({
      zmcc: nameOf.get(String(r.zmcc_id)) ?? String(r.zmcc_id),
      vehicle: String(r.vehicle_number ?? ''),
      at: (r.operational_timestamp as Date).toISOString(),
      dispatchAt13ts: num(r.at_13ts_liters) ?? 0,
      dispatchGross: num(r.quantity_liters) ?? 0,
      bookAfterAt13ts: Number((num(r.balance_after) ?? 0).toFixed(2)),
    })),
    blocked: blockedRows.map((r) => {
      const v = (r.new_values ?? {}) as Record<string, unknown>;
      return {
        zmcc: nameOf.get(String(v.zmcc_id ?? '')) ?? String(v.zmcc_id ?? ''),
        vehicle: String(v.vehicle_number ?? ''),
        at: r.created_at.toISOString(),
        dispatchAt13ts: num(v.dispatch_at_13ts_liters),
        bookAt13ts: num(v.book_at_13ts_liters),
        limitAt13ts: num(v.limit_at_13ts_liters),
        variancePercent: num(v.variance_percent),
      };
    }),
  };
}
