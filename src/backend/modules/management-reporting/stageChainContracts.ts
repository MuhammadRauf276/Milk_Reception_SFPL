/**
 * Stage by stage, per ZMCC: shops -> ZMCC intake -> tank -> dispatch slip -> plant.
 * Litres and @13 TS at each stage, the milk quality (TS) at each stage, and loss/gain between stages.
 * Every difference is later stage minus earlier stage: negative = loss, positive = gain.
 */

export interface StagePair {
  liters: number;
  at13ts: number;
}

/** One tank cycle: the milk taken in since the last dispatch, and the dispatch(es) that followed. */
export interface StageCycle {
  day: string;
  tankCode: string;
  tankers: Array<{ visitId: string; visitNumber: string | null; vehicleNumber: string | null }>;
  opening: StagePair;
  intake: StagePair;
  adjustments: StagePair;
  dispatchSlip: StagePair;
  /** The dispatched litres at the quality of the milk that was in the tank. */
  dispatchTrue13ts: number;
  /** Null while a tanker of the cycle has no plant receipt yet. */
  plant: StagePair | null;
  leftInTank: StagePair;
  ts: { tank: number | null; slip: number | null; plant: number | null };
  /** Slip @13 TS minus dispatchTrue13ts: positive = the slip claims more than the milk held. */
  slipOver13ts: number;
  /** Plant minus the true dispatch (litres: plant minus dispatched). Null until the plant receipt exists. */
  road: StagePair | null;
}

export interface StageZmccRow {
  zmccId: string;
  zmccName: string;
  /** Shops collected by Mobile Testers (accepted), by journey date. */
  shops: StagePair;
  /** Received into the ZMCC tank from Mobile Testers and from HC suppliers, in the cycles of the period. */
  receivedMot: StagePair;
  receivedHc: StagePair;
  /** Other tank receipts (not from a Mobile Tester or HC arrival). */
  receivedOther: StagePair;
  dispatchSlip: StagePair;
  dispatchTrue13ts: number;
  plant: StagePair;
  /** Tankers of the period the plant has not received yet: left out of plant, road and whole. */
  pendingTankers: number;
  tankStart: StagePair;
  tankEnd: StagePair;
  ts: { intake: number | null; slip: number | null; plant: number | null };
  loss: {
    /** Received from Mobile Testers minus shops collected. */
    motTrip: StagePair;
    /** Positive = dispatch slips claim more @13 TS than the milk held. Not a real loss or gain. */
    slipOver13ts: number;
    /** Plant minus the true dispatch: the real loss/gain on the road. */
    road: StagePair;
    /** Shops and HC to plant: motTrip plus road. */
    whole: StagePair;
  };
  cycleCount: number;
  /** Cycles where the dispatch slip TS is above the tank milk's TS. */
  slipHighCycles: number;
  cycles: StageCycle[];
}

export interface StageChainReport {
  from: string;
  to: string;
  zmccs: StageZmccRow[];
  total: Omit<StageZmccRow, 'zmccId' | 'zmccName' | 'cycles' | 'tankStart' | 'tankEnd'>;
}
