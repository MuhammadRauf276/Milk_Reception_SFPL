/**
 * Stage by stage, per ZMCC: shops -> ZMCC intake -> tank -> dispatch slip -> plant.
 * Litres and @13 TS at each stage, the milk quality (TS) at each stage, and loss/gain between stages.
 * Every difference is later stage minus earlier stage: negative = loss, positive = gain.
 */

export interface StagePair {
  liters: number;
  at13ts: number;
}

/** One tanker of a tank fill: what the ZMCC dispatch says and what the plant measured. */
export interface StageTanker {
  visitId: string;
  visitNumber: string | null;
  vehicleNumber: string | null;
  dispatch: StagePair;
  /** The dispatched litres at the quality of the milk that was in the tank. */
  dispatchTrue13ts: number;
  /** Null until the plant receipt exists. */
  plant: StagePair | null;
  ts: { dispatch: number | null; plant: number | null };
  /** Dispatch @13 TS minus dispatchTrue13ts. */
  overstated13ts: number;
  /** Plant minus the true dispatch (litres: plant minus dispatched). */
  road: StagePair | null;
}

/** One tank cycle: the milk taken in since the last dispatch, and the dispatch(es) that followed. */
export interface StageCycle {
  day: string;
  tankCode: string;
  tankers: StageTanker[];
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
  daily: StageDay[];
}

/** One day of a stage chain: by the day of the dispatch (shops by their own day). */
export interface StageDay {
  day: string;
  shops: StagePair;
  /** Received into ZMCC tanks that day: all, and from Mobile Testers (MC), HC suppliers and other receipts. */
  intake: StagePair;
  intakeMc: StagePair;
  intakeHc: StagePair;
  intakeOther: StagePair;
  dispatchSlip: StagePair;
  plant: StagePair;
  slipOver13ts: number;
  road: StagePair;
  ts: { intake: number | null; slip: number | null; plant: number | null };
}

export type StageTotal = Omit<StageZmccRow, 'zmccId' | 'zmccName' | 'cycles' | 'tankStart' | 'tankEnd' | 'daily'>;

export interface StageChainReport {
  from: string;
  to: string;
  /** Calendar day (midnight to midnight) or business day (08:00 to 08:00). */
  basis: 'calendar' | 'business';
  /** Days in the period: LPD = a total divided by this. */
  days: number;
  zmccs: StageZmccRow[];
  total: StageTotal;
  /** Every day of the period, all ZMCCs together. */
  daily: StageDay[];
  /** The same number of days just before this period, for comparison. */
  previous: { from: string; to: string; total: StageTotal };
}

/* ------------------------------ Drill-down ------------------------------ */

export type StageDrillLevel = 'TESTER' | 'ROUTE' | 'HC';

/** A Mobile Tester or a route: what was collected from shops vs what reached the ZMCC tank, by journey date. */
export interface StageMotRow {
  id: string;
  name: string;
  code: string | null;
  zmccName: string;
  journeys: number;
  /** Journeys not yet arrived at the ZMCC: their milk is left out of the trip. */
  notArrived: number;
  shops: number;
  rejectedShops: number;
  collected: StagePair;
  received: StagePair;
  ts: { collected: number | null; received: number | null };
  /** Received minus collected, for journeys that arrived. */
  trip: StagePair;
}

/** An HC supplier: arrivals and what went into the ZMCC tank. */
export interface StageHcRow {
  id: string;
  name: string;
  code: string | null;
  zmccName: string;
  arrivals: number;
  accepted: number;
  rejected: number;
  /** Left without full unloading (partly or not received). */
  leftEarly: number;
  received: StagePair;
  ts: number | null;
}

export interface StageDrillReport {
  level: StageDrillLevel;
  from: string;
  to: string;
  days: number;
  testers?: StageMotRow[];
  routes?: StageMotRow[];
  hcSuppliers?: StageHcRow[];
}
