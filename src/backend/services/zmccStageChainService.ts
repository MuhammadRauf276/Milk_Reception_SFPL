/**
 * Stage by stage loss/gain for senior management: shops -> ZMCC intake -> tank -> dispatch slip -> plant.
 *
 * A ZMCC tank is emptied at each dispatch, so the ledger is read as cycles: the milk taken in since the last dispatch,
 * then the dispatch(es). The quality (TS) of the milk in the tank is known from the intake tests, so the dispatched
 * litres can be valued at that quality ("true" @13 TS) and set against what the dispatch slip claims and what the plant
 * measured. That separates a dispatch slip written too high from a real loss on the road.
 *
 * Corrected values are used: receipts and dispatches as they are now (their correction rows in the ledger are skipped),
 * and plant litres from the weighbridge ticket with the plant test, so a receipt saved before a weight correction cannot
 * distort the figures. Nothing is stored; everything is read live.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '@core/db';
import { pkLocal } from '@/backend/core/sqlTime';
import type { StageChainReport, StageCycle, StageDay, StagePair, StageTotal, StageZmccRow } from '@/backend/modules/management-reporting/stageChainContracts';

export interface StageLedgerRow {
  tankId: string;
  tankCode: string;
  zmccId: string;
  type: 'RECEIPT' | 'ISSUE' | 'ADJUSTMENT_IN' | 'ADJUSTMENT_OUT';
  referenceType: string | null;
  day: string;
  quantityLiters: number;
  at13tsLiters: number | null;
  /** Receipt as it is now. */
  receiptLiters: number | null;
  receiptTs: number | null;
  receiptKind: string | null;
  /** Dispatch as it is now. */
  visitId: string | null;
  visitNumber: string | null;
  vehicleNumber: string | null;
  dispatchLiters: number | null;
  dispatchAt13ts: number | null;
  /** Plant: weighbridge net and the plant test. */
  plantNetKg: number | null;
  plantLr: number | null;
  plantTs: number | null;
}

const pair = (liters = 0, at13ts = 0): StagePair => ({ liters, at13ts });
const add = (a: StagePair, b: StagePair): StagePair => pair(a.liters + b.liters, a.at13ts + b.at13ts);
const tsOf = (p: StagePair): number | null => (p.liters > 0 ? (p.at13ts * 13) / p.liters : null);
const round = (p: StagePair): StagePair => pair(Math.round(p.liters * 100) / 100, Math.round(p.at13ts * 100) / 100);
const r2 = (v: number | null) => (v == null ? null : Math.round(v * 100) / 100);

/** Corrections are already in the receipt and dispatch values, so their ledger rows are not counted again. */
function isCorrectionRow(referenceType: string | null): boolean {
  return referenceType === 'ZMCC_LAB_SESSION_CORRECTION' || /DISPATCH_CORRECTION/.test(referenceType ?? '');
}

type WorkCycle = StageCycle & { mot: StagePair; hc: StagePair; other: StagePair; plantComplete: boolean };

/** Builds the cycles of each tank from its ledger rows in the order they were entered. Pure. */
export function buildTankCycles(rows: StageLedgerRow[]): Array<WorkCycle & { zmccId: string }> {
  const out: Array<WorkCycle & { zmccId: string }> = [];
  const stock = new Map<string, StagePair>();
  let cur: (WorkCycle & { zmccId: string; tankId: string }) | null = null;

  const finish = () => {
    if (!cur || cur.tankers.length === 0) return;
    const s = stock.get(cur.tankId)!;
    cur.leftInTank = { ...s };
    cur.plant = cur.plantComplete ? cur.plant : null;
    const tankTs = tsOf(add(cur.opening, add(cur.intake, cur.adjustments)));
    cur.ts = { tank: tankTs, slip: tsOf(cur.dispatchSlip), plant: cur.plant ? tsOf(cur.plant) : null };
    cur.dispatchTrue13ts = tankTs != null ? (cur.dispatchSlip.liters * tankTs) / 13 : cur.dispatchSlip.at13ts;
    cur.slipOver13ts = cur.dispatchSlip.at13ts - cur.dispatchTrue13ts;
    cur.road = cur.plant ? pair(cur.plant.liters - cur.dispatchSlip.liters, cur.plant.at13ts - cur.dispatchTrue13ts) : null;
    for (const t of cur.tankers) {
      t.dispatchTrue13ts = tankTs != null ? (t.dispatch.liters * tankTs) / 13 : t.dispatch.at13ts;
      t.overstated13ts = t.dispatch.at13ts - t.dispatchTrue13ts;
      t.road = t.plant ? pair(t.plant.liters - t.dispatch.liters, t.plant.at13ts - t.dispatchTrue13ts) : null;
    }
    out.push(cur);
  };

  for (const r of rows) {
    const s = stock.get(r.tankId) ?? pair();
    stock.set(r.tankId, s);
    if (!cur || cur.tankId !== r.tankId || (cur.tankers.length > 0 && r.type !== 'ISSUE')) {
      finish();
      cur = {
        zmccId: r.zmccId,
        tankId: r.tankId,
        tankCode: r.tankCode,
        day: r.day,
        tankers: [],
        opening: { ...s },
        intake: pair(),
        adjustments: pair(),
        dispatchSlip: pair(),
        dispatchTrue13ts: 0,
        plant: pair(),
        plantComplete: true,
        leftInTank: pair(),
        ts: { tank: null, slip: null, plant: null },
        slipOver13ts: 0,
        road: null,
        mot: pair(),
        hc: pair(),
        other: pair(),
      };
    }
    if (r.type === 'RECEIPT') {
      const liters = r.receiptLiters ?? r.quantityLiters;
      const at13 = r.receiptLiters != null && r.receiptTs != null ? (r.receiptLiters * r.receiptTs) / 13 : (r.at13tsLiters ?? 0);
      const p = pair(liters, at13);
      cur.intake = add(cur.intake, p);
      if (r.receiptKind === 'HC') cur.hc = add(cur.hc, p);
      else if (r.receiptKind === 'MOT' || r.receiptKind === 'MC') cur.mot = add(cur.mot, p);
      else cur.other = add(cur.other, p);
      s.liters += liters;
      s.at13ts += at13;
    } else if (r.type === 'ISSUE') {
      const liters = r.dispatchLiters ?? r.quantityLiters;
      const at13 = r.dispatchAt13ts ?? r.at13tsLiters ?? 0;
      cur.dispatchSlip = add(cur.dispatchSlip, pair(liters, at13));
      s.liters -= liters;
      s.at13ts -= at13;
      let tankerPlant: StagePair | null = null;
      if (r.plantNetKg != null && r.plantLr != null && r.plantTs != null && r.plantNetKg > 0) {
        const pl = r.plantNetKg / (1 + r.plantLr / 1000);
        tankerPlant = pair(pl, (pl * r.plantTs) / 13);
        cur.plant = add(cur.plant ?? pair(), tankerPlant);
      } else {
        cur.plantComplete = false;
      }
      const tankerDispatch = pair(liters, at13);
      cur.tankers.push({
        visitId: r.visitId ?? '',
        visitNumber: r.visitNumber,
        vehicleNumber: r.vehicleNumber,
        dispatch: tankerDispatch,
        dispatchTrue13ts: 0,
        plant: tankerPlant,
        ts: { dispatch: tsOf(tankerDispatch), plant: tankerPlant ? tsOf(tankerPlant) : null },
        overstated13ts: 0,
        road: null,
      });
      cur.day = r.day;
    } else if (!isCorrectionRow(r.referenceType)) {
      const sign = r.type === 'ADJUSTMENT_IN' ? 1 : -1;
      const p = pair(sign * r.quantityLiters, sign * (r.at13tsLiters ?? 0));
      cur.adjustments = add(cur.adjustments, p);
      s.liters += p.liters;
      s.at13ts += p.at13ts;
    }
  }
  finish();
  return out;
}

export type IntakeByKind = { mot: StagePair; hc: StagePair; other: StagePair };

/**
 * One ZMCC's row. Each stage counts on its own day (shops on theirs, intake on the day it was received); the loss
 * between stages comes from the tank fills dispatched in the period.
 */
function summarize(
  zmccId: string,
  zmccName: string,
  shops: StagePair,
  intakeOwnDay: IntakeByKind,
  cycles: Array<WorkCycle & { zmccId: string }>
): StageZmccRow {
  const { mot, hc, other } = intakeOwnDay;
  let slip = pair(), plant = pair(), roadP = pair();
  let true13 = 0, slipOver = 0, pending = 0, slipHigh = 0;
  for (const c of cycles) {
    slip = add(slip, c.dispatchSlip);
    true13 += c.dispatchTrue13ts;
    slipOver += c.slipOver13ts;
    if (c.ts.slip != null && c.ts.tank != null && c.ts.slip > c.ts.tank + 0.02) slipHigh++;
    if (c.plant && c.road) {
      plant = add(plant, c.plant);
      roadP = add(roadP, c.road);
    } else {
      pending += c.tankers.length;
    }
  }
  const motTrip = pair(mot.liters - shops.liters, mot.at13ts - shops.at13ts);
  return {
    zmccId,
    zmccName,
    shops: round(shops),
    receivedMot: round(mot),
    receivedHc: round(hc),
    receivedOther: round(other),
    dispatchSlip: round(slip),
    dispatchTrue13ts: r2(true13)!,
    plant: round(plant),
    pendingTankers: pending,
    tankStart: round(cycles[0]?.opening ?? pair()),
    tankEnd: round(cycles[cycles.length - 1]?.leftInTank ?? pair()),
    ts: { intake: r2(tsOf(add(add(mot, hc), other))), slip: r2(tsOf(slip)), plant: r2(tsOf(plant)) },
    loss: {
      motTrip: round(motTrip),
      slipOver13ts: r2(slipOver)!,
      road: round(roadP),
      whole: round(add(motTrip, roadP)),
    },
    cycleCount: cycles.length,
    slipHighCycles: slipHigh,
    daily: [],
    cycles: cycles.map((c) => ({
      day: c.day,
      tankCode: c.tankCode,
      tankers: c.tankers.map((t) => ({
        ...t,
        dispatch: round(t.dispatch),
        dispatchTrue13ts: r2(t.dispatchTrue13ts)!,
        plant: t.plant ? round(t.plant) : null,
        ts: { dispatch: r2(t.ts.dispatch), plant: r2(t.ts.plant) },
        overstated13ts: r2(t.overstated13ts)!,
        road: t.road ? round(t.road) : null,
      })),
      opening: round(c.opening),
      intake: round(c.intake),
      adjustments: round(c.adjustments),
      dispatchSlip: round(c.dispatchSlip),
      dispatchTrue13ts: r2(c.dispatchTrue13ts)!,
      plant: c.plant ? round(c.plant) : null,
      leftInTank: round(c.leftInTank),
      ts: { tank: r2(c.ts.tank), slip: r2(c.ts.slip), plant: r2(c.ts.plant) },
      slipOver13ts: r2(c.slipOver13ts)!,
      road: c.road ? round(c.road) : null,
    })),
  };
}

const shiftDay = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const dayCount = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) + 1;

/** Day totals of a set of cycles and shop days, every day of the range present (empty days are zero). */
function dailySeries(
  from: string,
  to: string,
  cycles: Array<WorkCycle & { zmccId: string }>,
  shopDays: Map<string, StagePair>,
  intakeDays: Map<string, IntakeByKind>
): StageDay[] {
  const byDay = new Map<string, Array<WorkCycle & { zmccId: string }>>();
  for (const c of cycles) byDay.set(c.day, [...(byDay.get(c.day) ?? []), c]);
  const out: StageDay[] = [];
  for (let d = from; d <= to; d = shiftDay(d, 1)) {
    const kinds = intakeDays.get(d) ?? { mot: pair(), hc: pair(), other: pair() };
    const intake = add(add(kinds.mot, kinds.hc), kinds.other);
    let slip = pair(), plant = pair(), road = pair(), over = 0;
    for (const c of byDay.get(d) ?? []) {
      slip = add(slip, c.dispatchSlip);
      over += c.slipOver13ts;
      if (c.plant && c.road) {
        plant = add(plant, c.plant);
        road = add(road, c.road);
      }
    }
    out.push({
      day: d,
      shops: round(shopDays.get(d) ?? pair()),
      intake: round(intake),
      intakeMc: round(kinds.mot),
      intakeHc: round(kinds.hc),
      intakeOther: round(kinds.other),
      dispatchSlip: round(slip),
      plant: round(plant),
      slipOver13ts: r2(over)!,
      road: round(road),
      ts: { intake: r2(tsOf(intake)), slip: r2(tsOf(slip)), plant: r2(tsOf(plant)) },
    });
  }
  return out;
}

export async function getZmccStageChain(input: {
  from: string;
  to: string;
  zmccIds?: string[];
  basis?: 'calendar' | 'business';
}): Promise<StageChainReport> {
  const basis = input.basis === 'business' ? 'business' : 'calendar';
  const days = dayCount(input.from, input.to);
  const prevTo = shiftDay(input.from, -1);
  const prevFrom = shiftDay(input.from, -days);
  const ids = (input.zmccIds ?? []).filter((id) => /^\d{1,18}$/.test(id)).map((id) => BigInt(id));
  const zmccs = await prisma.procurementSource.findMany({
    where: { source_type: 'ZMCC', ...(ids.length ? { id: { in: ids } } : {}) },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });
  if (zmccs.length === 0) {
    return {
      from: input.from,
      to: input.to,
      basis,
      days,
      zmccs: [],
      total: emptyTotal(),
      daily: dailySeries(input.from, input.to, [], new Map(), new Map()),
      previous: { from: prevFrom, to: prevTo, total: emptyTotal() },
    };
  }
  const zmccIdList = zmccs.map((z) => z.id);

  // A business day runs 08:00 to 08:00: a time before 08:00 belongs to the day before.
  const dayOf = (col: string) =>
    basis === 'business'
      ? Prisma.sql`to_char(${pkLocal(col)} - interval '8 hours', 'YYYY-MM-DD')`
      : Prisma.sql`to_char(${pkLocal(col)}, 'YYYY-MM-DD')`;

  // The whole ledger of these tanks (a cycle's opening needs what came before the period).
  const raw = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT x.tank_id::text AS tank_id, tk.tank_code, tk.zmcc_id::text AS zmcc_id, x.transaction_type::text AS type,
           x.reference_type, ${dayOf('x.operational_timestamp')} AS day,
           x.quantity_liters::float8 AS quantity_liters, x.at_13ts_liters::float8 AS at13,
           tr.gross_liters::float8 AS r_l, tr.ts::float8 AS r_ts, tr.arrival_type AS r_kind,
           v.id::text AS visit_id, v.visit_number, v.vehicle_number,
           v.vehicle_dispatch_gross_liters::float8 AS d_l, v.vehicle_dispatch_at_13ts_liters::float8 AS d_13,
           (wt.gross_weight_kg - wt.tare_weight_kg)::float8 AS p_net_kg, sr.lr::float8 AS p_lr, sr.ts::float8 AS p_ts
    FROM zmcc_tank_inventory_transaction x
    JOIN zmcc_tank tk ON tk.id = x.tank_id
    LEFT JOIN zmcc_tank_receipt tr ON tr.id = x.tank_receipt_id
    LEFT JOIN vehicle_visit v ON x.transaction_type::text = 'ISSUE' AND x.reference_type = 'DISPATCH' AND v.id::text = x.reference_id
    LEFT JOIN weight_ticket wt ON wt.visit_id = v.id
    LEFT JOIN LATERAL (
      SELECT MAX(s.plant_composite_lr) AS lr, MAX(s.plant_ts) AS ts
      FROM silo_inventory_transaction s WHERE s.visit_id = v.id AND s.transaction_type::text = 'RECEIPT'
    ) sr ON true
    WHERE tk.zmcc_id IN (${Prisma.join(zmccIdList)})
    ORDER BY x.tank_id, x.id`;

  const num = (v: unknown) => (v == null ? null : Number(v));
  const rows: StageLedgerRow[] = raw.map((r) => ({
    tankId: String(r.tank_id),
    tankCode: String(r.tank_code),
    zmccId: String(r.zmcc_id),
    type: String(r.type) as StageLedgerRow['type'],
    referenceType: (r.reference_type as string | null) ?? null,
    day: String(r.day),
    quantityLiters: Number(r.quantity_liters ?? 0),
    at13tsLiters: num(r.at13),
    receiptLiters: num(r.r_l),
    receiptTs: num(r.r_ts),
    receiptKind: (r.r_kind as string | null) ?? null,
    visitId: (r.visit_id as string | null) ?? null,
    visitNumber: (r.visit_number as string | null) ?? null,
    vehicleNumber: (r.vehicle_number as string | null) ?? null,
    dispatchLiters: num(r.d_l),
    dispatchAt13ts: num(r.d_13),
    plantNetKg: num(r.p_net_kg),
    plantLr: num(r.p_lr),
    plantTs: num(r.p_ts),
  }));

  // Shops by day: the journey date for calendar days; the collection time for business days.
  const shopDay = basis === 'business' ? dayOf('device_collected_at') : Prisma.sql`to_char(operational_date, 'YYYY-MM-DD')`;
  const shopRows = await prisma.$queryRaw<Array<{ zmcc_id: string; day: string; l: number | null; a13: number | null }>>`
    SELECT zmcc_id::text AS zmcc_id, ${shopDay} AS day, SUM(gross_liters)::float8 AS l, SUM(at_13ts_liters)::float8 AS a13
    FROM mot_shop_collection
    WHERE zmcc_id IN (${Prisma.join(zmccIdList)}) AND final_decision = 'ACCEPTED'
      AND operational_date BETWEEN ${shiftDay(prevFrom, -1)}::date AND ${shiftDay(input.to, 1)}::date
    GROUP BY 1, 2`;
  const shopsByZmccDay = new Map<string, Map<string, StagePair>>();
  for (const sr of shopRows) {
    const m = shopsByZmccDay.get(sr.zmcc_id) ?? new Map<string, StagePair>();
    m.set(sr.day, add(m.get(sr.day) ?? pair(), pair(Number(sr.l ?? 0), Number(sr.a13 ?? 0))));
    shopsByZmccDay.set(sr.zmcc_id, m);
  }
  const shopsIn = (zmccId: string, from: string, to: string) => {
    let total = pair();
    for (const [d, v] of shopsByZmccDay.get(zmccId) ?? []) if (d >= from && d <= to) total = add(total, v);
    return total;
  };

  const receipts = new Map<string, Map<string, IntakeByKind>>();
  for (const r of rows) {
    if (r.type !== 'RECEIPT') continue;
    const liters = r.receiptLiters ?? r.quantityLiters;
    const at13 = r.receiptLiters != null && r.receiptTs != null ? (r.receiptLiters * r.receiptTs) / 13 : (r.at13tsLiters ?? 0);
    const byDay = receipts.get(r.zmccId) ?? new Map<string, IntakeByKind>();
    const k = byDay.get(r.day) ?? { mot: pair(), hc: pair(), other: pair() };
    const kind = r.receiptKind === 'HC' ? 'hc' : r.receiptKind === 'MOT' || r.receiptKind === 'MC' ? 'mot' : 'other';
    k[kind] = add(k[kind], pair(liters, at13));
    byDay.set(r.day, k);
    receipts.set(r.zmccId, byDay);
  }
  const intakeIn = (zmccId: string, from: string, to: string): IntakeByKind => {
    const out: IntakeByKind = { mot: pair(), hc: pair(), other: pair() };
    for (const [d, k] of receipts.get(zmccId) ?? []) {
      if (d < from || d > to) continue;
      out.mot = add(out.mot, k.mot);
      out.hc = add(out.hc, k.hc);
      out.other = add(out.other, k.other);
    }
    return out;
  };
  const intakeDaysOf = (zmccIds: string[]) => {
    const m = new Map<string, IntakeByKind>();
    for (const id of zmccIds) {
      for (const [d, k] of receipts.get(id) ?? []) {
        const cur = m.get(d) ?? { mot: pair(), hc: pair(), other: pair() };
        m.set(d, { mot: add(cur.mot, k.mot), hc: add(cur.hc, k.hc), other: add(cur.other, k.other) });
      }
    }
    return m;
  };

  const cycles = buildTankCycles(rows);
  const inRange = (from: string, to: string) => cycles.filter((c) => c.day >= from && c.day <= to);
  const build = (from: string, to: string, withDaily: boolean) =>
    zmccs
      .map((z) => {
        const id = z.id.toString();
        const zc = inRange(from, to).filter((c) => c.zmccId === id);
        const row = summarize(id, z.name, shopsIn(id, from, to), intakeIn(id, from, to), zc);
        if (withDaily) row.daily = dailySeries(from, to, zc, shopsByZmccDay.get(id) ?? new Map(), intakeDaysOf([id]));
        return row;
      })
      .filter((r) => r.cycleCount > 0 || r.shops.liters > 0 || r.receivedMot.liters + r.receivedHc.liters + r.receivedOther.liters > 0);

  const current = build(input.from, input.to, true);
  const previous = build(prevFrom, prevTo, false);
  const allShopDays = new Map<string, StagePair>();
  for (const m of shopsByZmccDay.values()) for (const [d, v] of m) allShopDays.set(d, add(allShopDays.get(d) ?? pair(), v));
  return {
    from: input.from,
    to: input.to,
    basis,
    days,
    zmccs: current,
    total: totalOf(current),
    daily: dailySeries(input.from, input.to, inRange(input.from, input.to), allShopDays, intakeDaysOf(zmccs.map((z) => z.id.toString()))),
    previous: { from: prevFrom, to: prevTo, total: totalOf(previous) },
  };
}

function emptyTotal(): StageTotal {
  return totalOf([]);
}

function totalOf(rows: StageZmccRow[]): StageTotal {
  const sum = (pick: (r: StageZmccRow) => StagePair) => round(rows.reduce((acc, r) => add(acc, pick(r)), pair()));
  const receivedMot = sum((r) => r.receivedMot);
  const receivedHc = sum((r) => r.receivedHc);
  const receivedOther = sum((r) => r.receivedOther);
  const dispatchSlip = sum((r) => r.dispatchSlip);
  const plant = sum((r) => r.plant);
  return {
    shops: sum((r) => r.shops),
    receivedMot,
    receivedHc,
    receivedOther,
    dispatchSlip,
    dispatchTrue13ts: r2(rows.reduce((n, r) => n + r.dispatchTrue13ts, 0))!,
    plant,
    pendingTankers: rows.reduce((n, r) => n + r.pendingTankers, 0),
    ts: { intake: r2(tsOf(add(add(receivedMot, receivedHc), receivedOther))), slip: r2(tsOf(dispatchSlip)), plant: r2(tsOf(plant)) },
    loss: {
      motTrip: sum((r) => r.loss.motTrip),
      slipOver13ts: r2(rows.reduce((n, r) => n + r.loss.slipOver13ts, 0))!,
      road: sum((r) => r.loss.road),
      whole: sum((r) => r.loss.whole),
    },
    cycleCount: rows.reduce((n, r) => n + r.cycleCount, 0),
    slipHighCycles: rows.reduce((n, r) => n + r.slipHighCycles, 0),
  };
}
