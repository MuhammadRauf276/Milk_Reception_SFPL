/** Tank flow arithmetic for the Visuals ZMCC tab. Pure, so it is tested without a database. */
import type { StageDay, StagePair } from '../stageChainContracts';
import type { TankDay } from './zmccContracts';

export interface FlowDay {
  day: string;
  mc: number;
  hc: number;
  other: number;
  adminIn: number;
  adminOut: number;
  dispatch: number;
  over: number;
  plant: number;
}

/** Stage days in one unit (@13 TS or litres as measured). The overstatement exists only in @13 TS. */
export function flowDays(days: StageDay[], unit: 'at13' | 'liters'): FlowDay[] {
  const v = (p: StagePair) => (unit === 'at13' ? p.at13ts : p.liters);
  return days.map((d) => ({
    day: d.day,
    mc: v(d.intakeMc),
    hc: v(d.intakeHc),
    other: v(d.intakeOther),
    adminIn: v(d.adminIn),
    adminOut: v(d.adminOut),
    dispatch: v(d.dispatchSlip),
    over: unit === 'at13' ? d.slipOver13ts : 0,
    plant: v(d.plant),
  }));
}

/**
 * Period totals. With the tank ledger days (litres only): opening and closing level, and the gap the flows do not
 * explain (corrections, rounding). fromStock = dispatched minus intake from arrivals.
 */
export function flowSummary(days: FlowDay[], tank: TankDay[] | null) {
  const sum = (k: keyof Omit<FlowDay, 'day'>) => days.reduce((s, d) => s + d[k], 0);
  const intake = sum('mc') + sum('hc') + sum('other');
  const ins = intake + sum('adminIn');
  const outs = sum('adminOut') + sum('dispatch');
  const opening = tank?.length ? tank[0].opening : null;
  const closing = tank?.length ? tank[tank.length - 1].closing : null;
  return {
    mc: sum('mc'),
    hc: sum('hc'),
    other: sum('other'),
    adminIn: sum('adminIn'),
    adminOut: sum('adminOut'),
    dispatch: sum('dispatch'),
    over: sum('over'),
    plant: sum('plant'),
    opening,
    closing,
    gap: opening != null && closing != null ? closing - (opening + ins - outs) : null,
    fromStock: sum('dispatch') - intake,
  };
}
