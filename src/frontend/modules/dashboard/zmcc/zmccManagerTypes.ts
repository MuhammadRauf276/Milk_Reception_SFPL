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
  eventTimestampEnd?: string | null;
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
  finalReceiptBusinessDate: string | null;
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

export interface CompletedReceiptQuantityComparison {
  comparableVisitCount: number;
  dispatchGrossLiters: number | null;
  finalPhysicalReceivedLiters: number | null;
  quantityDifferenceLiters: number | null;
  differenceLiters: number | null;
  dispatch13TsLiters: number | null;
  plant13TsLiters: number | null;
  tsDifferenceLiters: number | null;
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

export type CrossVerificationFilter =
  | 'ALL'
  | 'COMPLETED'
  | 'RECEIPT_PENDING'
  | 'HAS_QUANTITY_DIFF'
  | 'HAS_QUALITY_DIFF'
  | 'HAS_REJECTION';

export interface PortionQualityReconciliation {
  portionNumber: string;
  log: MilkProcessLog;
  dispatchLr: number | null;
  plantLr: number | null;
  lrDiff: number | null;
  lrDiffText: string;
  dispatchFat: number | null;
  plantFat: number | null;
  fatDiff: number | null;
  fatDiffText: string;
  qaDecision: 'ACCEPTED' | 'REJECTED' | 'HOLD' | 'PENDING';
  qaDecisionRemarks?: string | null;
}

export interface VehicleReconciliationItem {
  group: VehicleVisitGroup;
  visitId: number;
  vehicleNumber: string;
  tokenNumber: string | null;
  businessDate: string;
  portionCount: number;
  lifecycleStatus: string;
  isCompletedReceipt: boolean;
  isReceiptPending: boolean;

  // Quantities
  dispatchGrossLiters: number | null;
  dispatch13TsLiters: number | null;
  netMilkWeightKg: number | null;
  physicalReceivedLiters: number | null;
  plant13TsLiters: number | null;
  quantityDifferenceLiters: number | null;
  quantityDifferenceText: string;
  hasQuantityDifference: boolean;

  // Silo & Receipt Event
  destinationSilo: string | null;
  finalReceiptTimestamp: string | null;

  // Weighbridge timestamps & Weights
  firstWeightTimestamp: string | null;
  secondWeightTimestamp: string | null;
  firstWeightKg: number | null;
  secondWeightKg: number | null;

  // Portion Quality
  portions: PortionQualityReconciliation[];
  hasQualityDifference: boolean;
  hasRejection: boolean;
  hasHold: boolean;
}

export type QualityRejectionFilter =
  | 'ALL'
  | 'ACCEPTED'
  | 'REJECTED'
  | 'HOLD'
  | 'PENDING'
  | 'HAS_QUALITY_DIFF';

export interface QualityRejectionItem {
  visitId: number;
  vehicleNumber: string;
  tokenNumber: string | null;
  businessDate: string;
  portionNumber: string;
  log: MilkProcessLog;

  // QA Decisions
  qaDecision: 'ACCEPTED' | 'REJECTED' | 'HOLD' | 'PENDING';
  qaDecisionRemarks: string | null;
  rejectionReasons: string | null;

  // Lab Tests & Differences
  dispatchLr: number | null;
  plantLr: number | null;
  lrDiff: number | null;
  lrDiffText: string;

  dispatchFat: number | null;
  plantFat: number | null;
  fatDiff: number | null;
  fatDiffText: string;

  hasQualityDifference: boolean;

  // Authoritative QA Event Timestamp
  qaEventTimestamp: string | null;
}

export interface QualityRejectionSummary {
  totalPortions: number;
  acceptedCount: number;
  rejectedCount: number;
  holdCount: number;
  pendingCount: number;
  vehiclesWithRejectionsCount: number;
  qualityDiffCount: number;
}

export type ReceiptsPerformanceFilter =
  | 'ALL'
  | 'COMPLETED'
  | 'RECEIPT_PENDING'
  | 'HAS_QUANTITY_DIFF'
  | 'HAS_TS_DIFF';

export interface ReceiptPerformanceItem {
  group: VehicleVisitGroup;
  visitId: number;
  vehicleNumber: string;
  tokenNumber: string | null;
  dispatchBusinessDate: string;
  finalReceiptBusinessDate: string | null;
  finalReceiptTimestamp: string | null;
  lifecycleStatus: string;
  isCompletedReceipt: boolean;
  isReceiptPending: boolean;

  // Quantities
  dispatchGrossLiters: number | null;
  physicalReceivedLiters: number | null;
  quantityDifferenceLiters: number | null;
  quantityDifferenceText: string;
  hasQuantityDifference: boolean;

  // 13% TS
  dispatch13TsLiters: number | null;
  plant13TsLiters: number | null;
  tsDifferenceLiters: number | null;
  tsDifferenceText: string;
  hasTsDifference: boolean;

  // Scale & Storage
  firstWeightKg: number | null;
  secondWeightKg: number | null;
  netMilkWeightKg: number | null;
  destinationSilo: string | null;
  receiptTransactionId: number | null;
}

export interface ReceiptsPerformanceSummary {
  completedReceiptCount: number;
  receiptPendingCount: number;
  pairedComparison: CompletedReceiptQuantityComparison;
}
