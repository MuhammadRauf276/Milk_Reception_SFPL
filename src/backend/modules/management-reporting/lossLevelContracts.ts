import type { LossFigure, LossPair } from '@/lib/lossGain';

/**
 * Loss / Gain levels. Every difference is received minus sent (negative = Loss, positive = Gain); a total is the NET;
 * percent = net / milk sent (or bought) x 100, never clamped. @13 TS is the main figure and gross sits beside it.
 */
export type { LossFigure, LossPair };

export const LOSS_PRESETS = ['TODAY', 'YESTERDAY', 'LAST_7', 'LAST_30', 'MTD'] as const;
export type LossPreset = (typeof LOSS_PRESETS)[number];

export interface LossFiltersEcho {
  preset: LossPreset | 'CUSTOM';
  from: string;
  to: string;
  label: string;
  /** Empty = every ZMCC. */
  zmccIds: string[];
  /** Empty = every contractor. */
  contractorIds: string[];
  /** Narrows the MOT and Area levels only. */
  motProfileId: string | null;
}

/** A litre amount with its @13 TS value beside it. */
export interface LitrePair {
  at13ts: number;
  gross: number;
}

export interface LossPersonRef {
  id: string;
  name: string;
  code: string | null;
}

export interface MotJourneyLossRow {
  journeyId: string;
  journeyNumber: string;
  date: string;
  zmccId: string;
  zmccName: string;
  zmccCode: string;
  routeCode: string | null;
  vehicleNumber: string | null;
  motProfileId: string;
  motName: string;
  /** Shops collected (non-rejected collections). */
  shop: { gross: number; at13ts: number };
  /** Received at the ZMCC; at13ts is null when it was not recorded. */
  received: { gross: number; at13ts: number | null };
  figure: LossFigure;
  /** Accepted by the lab but never unloaded; not counted in the figure. */
  acceptedNotReceivedLiters: number;
}

export interface MotTesterLossRow {
  motProfileId: string;
  name: string;
  code: string | null;
  zmccId: string;
  zmccName: string;
  total: LossFigure;
  journeys: MotJourneyLossRow[];
}

export interface AreaLossRow {
  zmccId: string;
  zmccName: string;
  zmccCode: string;
  total: LossFigure;
  journeyCount: number;
  testerCount: number;
}

export interface TransitFlows {
  motIn: LitrePair;
  hcIn: LitrePair;
  /** Received in: MOT arrivals + HC receipts. */
  totalIn: LitrePair;
  dispatched: LitrePair;
  /** Change in tank stock over the period, with admin adjustments taken out. */
  stockChange: LitrePair;
}

export interface TransitZmccRow {
  zmccId: string;
  zmccName: string;
  zmccCode: string;
  atZmcc: LossFigure;
  onRoad: LossFigure;
  net: LossFigure;
  flows: TransitFlows;
  /** Dispatched but not yet reconciled by the plant. */
  inFlight: LitrePair & { tankers: number };
}

export interface TankerLossRow {
  visitId: string;
  visitNumber: string;
  date: string;
  sourceId: string | null;
  sourceName: string;
  sourceCode: string;
  vehicleNumber: string;
  referenceNumber: string;
  status: string;
  reconciled: boolean;
  dispatched: { gross: number; at13ts: number | null };
  plantReceived: { gross: number; at13ts: number | null } | null;
  plantNetKg: number;
  /** Null until the plant has reconciled the tanker. */
  figure: LossFigure | null;
  /** Alert only: a loss over 1%. A gain never alerts. */
  isHighLoss: boolean;
}

export interface TransitLevel {
  atZmcc: LossFigure;
  onRoad: LossFigure;
  /** At ZMCC + On road. */
  net: LossFigure;
  flows: TransitFlows;
  byZmcc: TransitZmccRow[];
  tankers: TankerLossRow[];
  inFlight: LitrePair & { tankers: number };
  highLossCount: number;
}

export interface WholeLines {
  /** Shop collections (non-rejected). */
  boughtShop: LitrePair;
  /** HC receipts. */
  boughtHc: LitrePair;
  bought: LitrePair;
  /** Still in ZMCC tanks: the change in tank stock (admin adjustments taken out). */
  stockChange: LitrePair;
  /** Dispatched, not yet reconciled by the plant. */
  onRoad: LitrePair;
  plantReceived: LitrePair;
  /** Admin adjustments in the period (in minus out): its own line, never counted as bought. */
  adminAdjustment: LitrePair;
  /** Accepted by the lab, never unloaded: information only. */
  acceptedNotReceivedLiters: number;
}

export interface WholeNet {
  /** bought vs (plant received + still in tanks + on the road). Equals MOT net + Transit net. */
  net: { at13ts: LossPair; gross: LossPair };
  /** The net with the admin line added. */
  netWithAdmin: LitrePair;
}

export interface WholeZmccRow extends WholeNet {
  zmccId: string;
  zmccName: string;
  zmccCode: string;
  lines: WholeLines;
}

export interface WholeLevel extends WholeNet {
  lines: WholeLines;
  byZmcc: WholeZmccRow[];
  /** True when whole net = MOT net + Transit net (gross and @13 TS), to the hundredth. */
  reconciles: boolean;
}

export interface ContractorLossRow {
  contractorId: string;
  name: string;
  code: string;
  total: LossFigure;
  tankers: TankerLossRow[];
  /** Dispatched, not yet reconciled by the plant. */
  pendingTankers: number;
}

export interface ContractorLevel {
  total: LossFigure;
  contractors: ContractorLossRow[];
  pendingTankers: number;
}

export interface LossLevels {
  filters: LossFiltersEcho;
  mot: { total: LossFigure; testers: MotTesterLossRow[] };
  area: { total: LossFigure; zmccs: AreaLossRow[] };
  transit: TransitLevel;
  whole: WholeLevel;
  contractorTransit: ContractorLevel;
}

/** Plain pick-lists for the filter bar: active ones plus any that appear in the period. */
export interface LossFilterOptions {
  zmccs: Array<{ id: string; code: string; name: string; isActive: boolean }>;
  contractors: Array<{ id: string; code: string; name: string; isActive: boolean }>;
  mobileTesters: Array<{ id: string; code: string; name: string; zmccId: string; zmccName: string; isActive: boolean }>;
}
