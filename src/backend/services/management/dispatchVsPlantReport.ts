import { prisma } from '@core/db';

/** Senior management report: what each ZMCC tanker sent versus what the plant received (volume, weight, 13 TS, tests). */

export interface TestPair {
  testId: string;
  testName: string;
  unit: string | null;
  displayOrder: number;
  dispatch: number | null;
  plant: number | null;
  delta: number | null;
}

export interface DispatchVsPlantRow {
  visitId: string;
  visitNumber: string;
  vehicleNumber: string;
  zmccCode: string;
  zmccName: string;
  operationalDate: string | null;
  status: string;
  received: boolean;
  dispatch: { grossLiters: number | null; lr: number | null; fat: number | null; snf: number | null; ts: number | null; at13tsLiters: number | null };
  plant: { netKg: number | null; grossLiters: number | null; lr: number | null; fat: number | null; snf: number | null; ts: number | null; at13tsLiters: number | null };
  variance: { grossLiters: number | null; grossPercent: number | null; at13tsLiters: number | null; at13tsPercent: number | null };
  tests: TestPair[];
}

export interface TestSummaryRow {
  testId: string;
  testName: string;
  unit: string | null;
  displayOrder: number;
  vehicles: number;
  dispatchAvg: number | null;
  plantAvg: number | null;
  deltaAvg: number | null;
}

export interface DispatchVsPlantReport {
  from: string;
  to: string;
  totals: {
    vehicles: number;
    received: number;
    dispatchGrossLiters: number;
    plantGrossLiters: number;
    plantNetKg: number;
    /** Litres of tankers sent but not received at the plant yet. */
    notReceivedGrossLiters: number;
    dispatchAt13tsLiters: number;
    plantAt13tsLiters: number;
    grossVarianceLiters: number;
    at13tsVarianceLiters: number;
  };
  tests: TestSummaryRow[];
  rows: DispatchVsPlantRow[];
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const round = (n: number, d = 2) => Number(n.toFixed(d));
const avg = (xs: number[]) => (xs.length ? round(xs.reduce((a, b) => a + b, 0) / xs.length, 3) : null);

interface TestResultInput {
  testId: string;
  testName: string;
  unit: string | null;
  displayOrder: number;
  value: number | null;
}

/** One value per test (average of the performed numeric results across portions) for each side, paired by test. */
export function pairTests(dispatch: TestResultInput[], plant: TestResultInput[]): TestPair[] {
  const side = (rows: TestResultInput[]) => {
    const by = new Map<string, { meta: TestResultInput; values: number[] }>();
    for (const r of rows) {
      if (r.value === null) continue;
      const e = by.get(r.testId) ?? { meta: r, values: [] };
      e.values.push(r.value);
      by.set(r.testId, e);
    }
    return by;
  };
  const d = side(dispatch);
  const p = side(plant);
  const ids = new Set([...d.keys(), ...p.keys()]);
  const out: TestPair[] = [];
  for (const id of ids) {
    const meta = (d.get(id) ?? p.get(id))!.meta;
    const dv = d.has(id) ? avg(d.get(id)!.values) : null;
    const pv = p.has(id) ? avg(p.get(id)!.values) : null;
    out.push({
      testId: id,
      testName: meta.testName,
      unit: meta.unit,
      displayOrder: meta.displayOrder,
      dispatch: dv,
      plant: pv,
      delta: dv !== null && pv !== null ? round(pv - dv, 3) : null,
    });
  }
  return out.sort((a, b) => a.displayOrder - b.displayOrder || a.testName.localeCompare(b.testName));
}

/** Test-wise comparison across all vehicles: average dispatch vs average plant value per test (only vehicles with both sides). */
export function summariseTests(rows: Pick<DispatchVsPlantRow, 'tests'>[]): TestSummaryRow[] {
  const by = new Map<string, { meta: TestPair; d: number[]; p: number[]; vehicles: number }>();
  for (const r of rows) {
    for (const t of r.tests) {
      if (t.dispatch === null || t.plant === null) continue;
      const e = by.get(t.testId) ?? { meta: t, d: [], p: [], vehicles: 0 };
      e.d.push(t.dispatch);
      e.p.push(t.plant);
      e.vehicles += 1;
      by.set(t.testId, e);
    }
  }
  return [...by.entries()]
    .map(([testId, e]) => {
      const dispatchAvg = avg(e.d);
      const plantAvg = avg(e.p);
      return {
        testId,
        testName: e.meta.testName,
        unit: e.meta.unit,
        displayOrder: e.meta.displayOrder,
        vehicles: e.vehicles,
        dispatchAvg,
        plantAvg,
        deltaAvg: dispatchAvg !== null && plantAvg !== null ? round(plantAvg - dispatchAvg, 3) : null,
      };
    })
    .sort((a, b) => a.displayOrder - b.displayOrder || a.testName.localeCompare(b.testName));
}

function isoDay(d: Date) {
  return d.toISOString().slice(0, 10);
}

type Raw = Record<string, unknown>;

export async function getDispatchVsPlantReport(params: { from?: string; to?: string; zmccId?: string }): Promise<DispatchVsPlantReport> {
  const to = params.to && /^\d{4}-\d{2}-\d{2}$/.test(params.to) ? params.to : isoDay(new Date());
  const from =
    params.from && /^\d{4}-\d{2}-\d{2}$/.test(params.from) ? params.from : isoDay(new Date(Date.parse(`${to}T00:00:00Z`) - 6 * 86400000));

  const args: Array<string | bigint> = [from, to];
  let zmccSql = '';
  if (params.zmccId && /^\d+$/.test(params.zmccId)) {
    args.push(BigInt(params.zmccId));
    zmccSql = ' AND zmcc_id = $3';
  }

  // Both queries read the database views (vw_dispatch_vs_plant_visit / vw_dispatch_vs_plant_test).
  const visits = (await prisma.$queryRawUnsafe(
    `SELECT * FROM vw_dispatch_vs_plant_visit
     WHERE operational_date BETWEEN $1::date AND $2::date${zmccSql}
     ORDER BY operational_date DESC, visit_id DESC LIMIT 500`,
    ...args
  )) as Raw[];

  const ids = visits.map((v) => v.visit_id as bigint);
  const testRows = ids.length
    ? ((await prisma.$queryRawUnsafe(
        'SELECT * FROM vw_dispatch_vs_plant_test WHERE visit_id = ANY($1::bigint[]) ORDER BY display_order, test_name',
        ids
      )) as Raw[])
    : [];
  const testsByVisit = new Map<string, Raw[]>();
  for (const t of testRows) {
    const k = String(t.visit_id);
    (testsByVisit.get(k) ?? testsByVisit.set(k, []).get(k)!).push(t);
  }

  const rows: DispatchVsPlantRow[] = visits.map((v) => {
    const key = String(v.visit_id);
    const pairs: TestPair[] = (testsByVisit.get(key) ?? []).map((t) => {
      const dispatch = num(t.dispatch_value) === null ? null : round(num(t.dispatch_value)!, 3);
      const plant = num(t.plant_value) === null ? null : round(num(t.plant_value)!, 3);
      return {
        testId: String(t.test_id),
        testName: String(t.test_name),
        unit: (t.unit as string | null) ?? null,
        displayOrder: Number(t.display_order),
        dispatch,
        plant,
        delta: dispatch !== null && plant !== null ? round(plant - dispatch, 3) : null,
      };
    });
    const date = v.operational_date as Date | string | null;
    return {
      visitId: key,
      visitNumber: String(v.visit_number),
      vehicleNumber: String(v.vehicle_number),
      zmccCode: String(v.zmcc_code ?? ''),
      zmccName: String(v.zmcc_name ?? ''),
      operationalDate: date ? (date instanceof Date ? isoDay(date) : String(date).slice(0, 10)) : null,
      status: String(v.current_status),
      received: Boolean(v.is_received),
      dispatch: {
        grossLiters: num(v.dispatch_gross_liters),
        lr: num(v.dispatch_lr),
        fat: num(v.dispatch_fat),
        snf: num(v.dispatch_snf),
        ts: num(v.dispatch_ts),
        at13tsLiters: num(v.dispatch_at_13ts_liters),
      },
      plant: {
        netKg: num(v.plant_net_kg),
        grossLiters: num(v.plant_gross_liters),
        lr: num(v.plant_lr),
        fat: num(v.plant_fat),
        snf: num(v.plant_snf),
        ts: num(v.plant_ts),
        at13tsLiters: num(v.plant_at_13ts_liters),
      },
      variance: {
        grossLiters: num(v.gross_variance_liters),
        grossPercent: num(v.gross_variance_percent),
        at13tsLiters: num(v.at_13ts_variance_liters),
        at13tsPercent: num(v.at_13ts_variance_percent),
      },
      tests: pairs,
    };
  });

  const received = rows.filter((r) => r.received);
  const sum = (xs: Array<number | null>) => round(xs.reduce<number>((a, b) => a + (b ?? 0), 0));
  return {
    from,
    to,
    totals: {
      vehicles: rows.length,
      received: received.length,
      // The comparison covers received tankers only, so sent and received are like for like.
      dispatchGrossLiters: sum(received.map((r) => r.dispatch.grossLiters)),
      notReceivedGrossLiters: sum(rows.filter((r) => !r.received).map((r) => r.dispatch.grossLiters)),
      plantGrossLiters: sum(received.map((r) => r.plant.grossLiters)),
      plantNetKg: sum(received.map((r) => r.plant.netKg)),
      dispatchAt13tsLiters: sum(received.map((r) => r.dispatch.at13tsLiters)),
      plantAt13tsLiters: sum(received.map((r) => r.plant.at13tsLiters)),
      grossVarianceLiters: sum(received.map((r) => r.variance.grossLiters)),
      at13tsVarianceLiters: sum(received.map((r) => r.variance.at13tsLiters)),
    },
    tests: summariseTests(rows),
    rows,
  };
}
