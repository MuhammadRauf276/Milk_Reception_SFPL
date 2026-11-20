/** Shared shapes for the Visuals page (see docs/VISUALS_BRIEF.md). Each tab has its own contract file next to this one. */

export const VISUAL_TABS = ['SHOPS', 'TESTERS', 'HC', 'ZMCC', 'PLANT'] as const;
export type VisualTab = (typeof VISUAL_TABS)[number];

/** Who opens the Visuals page: the Command Center roles. */
export const VISUALS_ROLES = ['SUPER_ADMIN', 'EXECUTIVE_MANAGEMENT', 'HEAD_OF_MPD', 'DATA_EXECUTIVE'] as const;

export type DayBasis = 'calendar' | 'business';

/** What every tab loader receives. Ids are already checked; an empty zmccIds list never reaches a loader. */
export interface VisualsQuery {
  from: string;
  to: string;
  basis: DayBasis;
  /** The ZMCCs in view: the ones picked, or every ZMCC when none is picked. */
  zmccIds: bigint[];
  /** True when the user picked ZMCCs (false = all ZMCCs). */
  zmccPicked: boolean;
  /** Contractor sources picked (Plant tab). Empty = all. */
  contractorIds: bigint[];
  /** Tab-specific picks, e.g. Mobile Tester, route or HC supplier ids. Empty = all. */
  ids: string[];
}

export interface VisualsMeta {
  tab: VisualTab;
  from: string;
  to: string;
  /** The period of the same length just before, used for the comparison. */
  prevFrom: string;
  prevTo: string;
  basis: DayBasis;
  days: number;
  /** When the figures were worked out (the server keeps them up to a minute). */
  computedAt: string;
}

export interface VisualsResponse<T> {
  meta: VisualsMeta;
  current: T;
  previous: T;
}

/** A pair of quantities: plain litres and litres @13 TS. */
export interface QtyPair {
  liters: number;
  at13ts: number;
}
