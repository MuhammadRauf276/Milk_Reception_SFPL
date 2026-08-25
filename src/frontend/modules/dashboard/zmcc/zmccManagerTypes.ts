import { MilkProcessLog } from '@backend/core/types';

export type ZMCCManagerTab =
  | 'OVERVIEW'
  | 'LIVE'
  | 'CROSS_VERIFICATION'
  | 'QUALITY'
  | 'RECEIPTS'
  | 'HISTORY';

export type OverviewDateRange = 'TODAY' | 'YESTERDAY' | 'LAST_7' | 'LAST_15' | 'ALL';

export type LifecycleStageId =
  | 'DISPATCH'
  | 'GATE_ENTRY'
  | 'PLANT_QA'
  | 'FIRST_WEIGHT'
  | 'UNLOADING'
  | 'SECOND_WEIGHT'
  | 'FINAL_RECEIPT';

export type LifecycleStageStatus = 'COMPLETED' | 'CURRENT' | 'UPCOMING' | 'SKIPPED';

export interface LifecycleStageInfo {
  id: LifecycleStageId;
  label: string;
  shortLabel: string;
  status: LifecycleStageStatus;
  detailText?: string | null;
  eventTimestamp?: string | null;
  metricText?: string | null;
}

export interface PortionQASummary {
  totalPortions: number;
  acceptedCount: number;
  rejectedCount: number;
  holdCount: number;
  pendingCount: number;
  summaryText: string;
  badgeType: 'ALL_ACCEPTED' | 'MIXED' | 'ALL_REJECTED' | 'HAS_HOLD' | 'ALL_PENDING' | 'EMPTY';
}

export interface ManagerLifecycleSummary {
  visitId: number;
  vehicleNumber: string;
  tokenNumber: string | null;
  sourceName: string;
  overallStatus: string;
  currentStageId: LifecycleStageId;
  currentStageLabel: string;
  stages: LifecycleStageInfo[];
  portionQA: PortionQASummary;
  latestEventLabel: string;
  latestEventTimestamp: string | null;
  elapsedInPlant: string | null;
  isComplete: boolean;
  isInPlant: boolean;
}

export interface VehicleVisitGroup {
  visitId: number;
  vehicleNumber: string;
  tokenNumber: string | null;
  sourceName: string;
  procurementSourceId: string | null;
  businessDate: string;
  overallStatus: string;
  portions: MilkProcessLog[];
  primaryLog: MilkProcessLog;
  
  // Quantities
  vehicleDispatchQuantityValue: number | null;
  vehicleDispatchQuantityUnit: string | null;
  vehicleDispatchQuantityBasis: string | null;
  totalDispatchGrossLiters: number | null;
  totalDispatch13TsLiters: number | null;
  
  // Weights
  firstWeightKg: number | null;
  secondWeightKg: number | null;
  netMilkWeightKg: number | null;
  physicalReceivedLiters: number | null;
  plant13TsLiters: number | null;
  
  // Silo
  destinationSilo: string | null;

  // Lifecycle
  lifecycle: ManagerLifecycleSummary;
}

export type AttentionType =
  | 'PLANT_QA_REJECTION'
  | 'RECEIPT_PENDING'
  | 'QUANTITY_DIFFERENCE'
  | 'QUALITY_DIFFERENCE'
  | 'IN_PLANT_DURATION';

export interface ZMCCAttentionItem {
  id: string;
  type: AttentionType;
  title: string;
  description: string;
  vehicleNumber: string;
  visitId: number;
  portionNumber?: string | number | null;
  eventDate?: string | null;
  log: MilkProcessLog;
  metrics?: {
    label: string;
    value: string;
  }[];
}

export interface ZMCCManagerOverviewMetrics {
  dispatchedCount: number;
  currentlyInPlantCount: number;
  completedCount: number;
  rejectedPortionsCount: number;
  
  totalDispatchGrossLiters: number | null;
  totalPhysicalReceivedLiters: number | null;
  quantityDifferenceLiters: number | null;
  
  totalDispatch13TsLiters: number | null;
  totalPlant13TsLiters: number | null;
  tsDifferenceLiters: number | null;
}
