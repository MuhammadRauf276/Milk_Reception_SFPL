/** ZMCC tab of the Visuals page (see docs/VISUALS_BRIEF.md). */
import type { StageChainReport } from '../stageChainContracts';

/** One ZMCC on one day, from the tank ledger (litres; the ledger has no @13 TS). */
export interface TankDay {
  day: string;
  /** Level at the start of the day (= the level at the end of the day before). */
  opening: number;
  /** Receipts and adjustments in. */
  inL: number;
  /** Dispatches and adjustments out. */
  outL: number;
  /** Level at the end of the day; a day with no movement carries the level forward. */
  closing: number;
}

export interface TankZmcc {
  zmccId: string;
  zmccName: string;
  /** Every day of the period. */
  days: TankDay[];
}

export interface ZmccVisuals {
  /** Intake MC / HC / other, dispatch, plant and road: the same report as the stage chain (daily rows included). */
  stage: StageChainReport;
  tanks: TankZmcc[];
}
