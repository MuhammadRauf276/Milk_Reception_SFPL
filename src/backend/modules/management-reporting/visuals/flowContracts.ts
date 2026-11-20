/** Loss flow tab of the Visuals page (see docs/VISUALS_BRIEF.md). */
import type { StageChainReport, StagePair, StageTotal } from '../stageChainContracts';
import type { TankDay, TankZmcc } from './zmccContracts';

export interface FlowVisuals {
  /** The same report as the stage chain: totals, per ZMCC rows (with tank cycles and tankers) and daily rows. */
  stage: StageChainReport;
  /** Tank ledger per ZMCC (litres), as on the ZMCC tab: gives the tank level change. */
  tanks: TankZmcc[];
}

export type FlowUnit = 'at13' | 'liters';

/** The fields of a stage total (or one ZMCC row) the whole-chain identity needs. */
export type FlowSource = Pick<
  StageTotal,
  'shops' | 'shopsOnWay' | 'receivedMot' | 'receivedHc' | 'receivedOther' | 'adminIn' | 'adminOut' | 'dispatchSlip' | 'plant' | 'loss'
> & {
  /** Closing minus opening tank level of the period (see tankChangeOf). */
  tankChange?: StagePair;
};

/**
 * Tank level change of the period from the ledger days (litres). The ledger has no @13 TS, so the @13 TS figure is the
 * litres at the intake TS (an estimate; pass null to repeat the litres).
 */
export function tankChangeOf(lists: TankDay[][], intakeTs: number | null): StagePair {
  const liters = lists.reduce((s, d) => s + (d.length ? d[d.length - 1].closing - d[0].opening : 0), 0);
  return { liters, at13ts: intakeTs && intakeTs > 0 ? (liters * intakeTs) / 13 : liters };
}

export interface WholePart {
  key: 'area' | 'onWay' | 'other' | 'admin' | 'tank' | 'over' | 'transit' | 'pending';
  label: string;
  /** Effect on (plant received minus purchased): plus = gain, minus = loss. */
  value: number;
  info: string;
}

export interface WholeExplained {
  purchased: number;
  plant: number;
  /** Plant received minus purchased. */
  difference: number;
  /** Difference as a percentage of purchased (null when nothing was purchased). */
  percent: number | null;
  parts: WholePart[];
  /** What the named parts do not explain: difference minus all parts. */
  unexplained: number;
  /** Tankers not at the plant yet, their dispatch slip in this unit. */
  pendingSlip: number;
}

const pick = (p: StagePair | undefined, unit: FlowUnit) => (p ? (unit === 'at13' ? p.at13ts : p.liters) : 0);
const r2 = (n: number) => Math.round(n * 100) / 100 + 0;

/**
 * Why the plant received more or less than was purchased (shops of Mobile Testers + HC), in one unit. The chain:
 *   purchased + area loss/gain - shops not yet at the ZMCC (+ other receipts + Super Admin net - tank level change)
 *   = the milk dispatched, + slip overstatement = the dispatch slip, - slips of tankers not yet at the plant,
 *   + transit loss/gain (plant minus slip) = plant received.
 * So plant - purchased = area + onWay + other + admin + tank + over + pending + transit + unexplained, where the
 * unexplained part is what is left (date differences between shops, HC and tank cycles, corrections). The parts
 * are taken from the report as they are; only the remainder is worked out here, so everything adds up exactly.
 */
export function explainWhole(src: FlowSource, unit: FlowUnit): WholeExplained {
  const purchased = pick(src.shops, unit) + pick(src.receivedHc, unit);
  const plant = pick(src.plant, unit);
  const slip = pick(src.dispatchSlip, unit);
  const transit = pick(src.loss.roadVsSlip, unit);
  // Slip of the tankers the plant has received = plant - transit; the rest of the slip is still on the road.
  const pendingSlip = r2(slip - (plant - transit));
  const tankChange = pick(src.tankChange, unit);
  const parts: WholePart[] = [
    { key: 'area', label: 'Area loss/gain', value: pick(src.loss.motTrip, unit), info: 'Mobile Tester journeys that reached the ZMCC: received minus collected at their shops.' },
    { key: 'onWay', label: 'Shops not at ZMCC yet', value: -pick(src.shopsOnWay, unit), info: 'Collected at shops on journeys that have not reached the ZMCC. Not a loss.' },
    { key: 'other', label: 'Other receipts', value: pick(src.receivedOther, unit), info: 'Tank receipts that are not from a Mobile Tester or an HC arrival.' },
    { key: 'admin', label: 'Super Admin added/removed', value: pick(src.adminIn, unit) - pick(src.adminOut, unit), info: 'Stock a Super Admin added to or took out of the tanks. Not purchased milk.' },
    { key: 'tank', label: 'Tank level change', value: -tankChange, info: 'Tank level at the end minus at the start: litres from the tank ledger; in @13 TS those litres at the tank milk TS. Minus here = the tanks kept milk (not dispatched yet); plus = they gave up stock they already had.' },
    { key: 'over', label: 'Dispatch slip overstated', value: unit === 'at13' ? src.loss.slipOver13ts : 0, info: 'The slip claims more @13 TS than the tank milk held. Not milk; it is taken back by transit. Only in @13 TS.' },
    { key: 'pending', label: 'Tankers not at plant yet', value: -pendingSlip, info: 'Dispatched, but the plant has not received them yet. Not a loss.' },
    { key: 'transit', label: 'Transit loss/gain', value: transit, info: 'Plant received minus the dispatch slip of the same tankers.' },
  ].map((p) => ({ ...p, value: r2(p.value) })) as WholePart[];
  const difference = r2(plant - purchased);
  const unexplained = r2(difference - parts.reduce((s, p) => s + p.value, 0));
  return { purchased: r2(purchased), plant: r2(plant), difference, percent: purchased > 0 ? (difference / purchased) * 100 : null, parts, unexplained, pendingSlip };
}

/** What happened to the tankers dispatched on one day (the day of the tank fill's dispatch). */
export interface TransitDay {
  day: string;
  /** Slip of the tankers the plant has received, and what the plant measured for them. */
  slipReceived: number;
  plantReceived: number;
  /** Plant minus slip of the same tankers: the transit loss/gain of the day. */
  transit: number;
  /** Slip of tankers the plant has not received yet. */
  pendingSlip: number;
  pendingTankers: number;
}

/** Transit by dispatch day, from the tankers of every tank cycle of the report. Pure. */
export function transitDays(stage: StageChainReport, unit: FlowUnit): TransitDay[] {
  const byDay = new Map<string, TransitDay>();
  const get = (day: string) => {
    let d = byDay.get(day);
    if (!d) byDay.set(day, (d = { day, slipReceived: 0, plantReceived: 0, transit: 0, pendingSlip: 0, pendingTankers: 0 }));
    return d;
  };
  for (const d of stage.daily) get(d.day);
  for (const z of stage.zmccs) {
    for (const c of z.cycles) {
      for (const t of c.tankers) {
        const d = get(c.day);
        const slip = pick(t.dispatch, unit);
        if (t.plant) {
          d.slipReceived += slip;
          d.plantReceived += pick(t.plant, unit);
        } else {
          d.pendingSlip += slip;
          d.pendingTankers += 1;
        }
      }
    }
  }
  return [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day)).map((d) => ({ ...d, transit: d.plantReceived - d.slipReceived }));
}

export interface WaterfallStep {
  key: string;
  label: string;
  kind: 'total' | 'delta';
  value: number;
  /** Running level before and after this step (a total starts at zero). */
  start: number;
  end: number;
  info: string;
}

/** The steps of the "where milk is lost or gained" chart: Purchased, each non-zero part, Unexplained, Plant. `scale` = 1 / days for per day. */
export function waterfallSteps(w: WholeExplained, scale = 1): WaterfallStep[] {
  const steps: WaterfallStep[] = [];
  let level = w.purchased * scale;
  steps.push({ key: 'purchased', label: 'Purchased', kind: 'total', value: level, start: 0, end: level, info: 'Shops of Mobile Testers plus HC.' });
  const deltas = [...w.parts.map((p) => ({ key: p.key as string, label: p.label, value: p.value, info: p.info })), { key: 'unexplained', label: 'Unexplained', value: w.unexplained, info: 'What the parts above do not explain: date differences between shops, HC and tank cycles, corrections.' }];
  for (const p of deltas) {
    if (Math.abs(p.value) < 0.005) continue;
    const v = p.value * scale;
    steps.push({ key: p.key, label: p.label, kind: 'delta', value: v, start: level, end: level + v, info: p.info });
    level += v;
  }
  steps.push({ key: 'plant', label: 'Plant received', kind: 'total', value: w.plant * scale, start: 0, end: w.plant * scale, info: 'What the plant measured for the tankers it received.' });
  return steps;
}
