import { MilkProcessLog, ProcessStatus } from '@backend/core/types';

export type PlantContractorTab =
  | 'OVERVIEW'
  | 'LIVE'
  | 'QUALITY'
  | 'RECEIPTS'
  | 'HISTORY';

export interface ContractorOverviewMetrics {
  totalDispatches: number;
  activeInPlantCount: number;
  completedReceiptsCount: number;
  totalReceivedLiters: number;
  totalGrossLiters: number;
}

export interface ContractorQualityMetrics {
  totalPortions: number;
  acceptedPortions: number;
  rejectedPortions: number;
  holdPortions: number;
  pendingPortions: number;
}

export type ContractorJourneyStage =
  | 'DISPATCHED'
  | 'GATE_ENTRY'
  | 'PLANT_QA'
  | 'WEIGHBRIDGE_GROSS'
  | 'UNLOADING'
  | 'RECEIPT_PENDING'
  | 'COMPLETED'
  | 'CANCELLED';

export interface ContractorPortionSummary {
  totalPortions: number;
  acceptedCount: number;
  rejectedCount: number;
  holdCount: number;
  pendingCount: number;
  summaryText: string;
  badgeType: 'ALL_ACCEPTED' | 'ALL_REJECTED' | 'ALL_PENDING' | 'HAS_HOLD' | 'MIXED' | 'EMPTY';
}

export interface ContractorVehicleVisit {
  visitId: number;
  visitNumber: string;
  receptionNumber: string;
  vehicleNumber: string;
  tokenNumber: string | null;
  procurementSourceName: string;
  operationalDate: string;
  dispatchTimestamp: string | null;
  gateEntryTimestamp: string | null;
  gateExitTimestamp: string | null;
  firstWeightTimestamp: string | null;
  secondWeightTimestamp: string | null;
  unloadingEndTimestamp: string | null;
  grossLiters: number;
  status: ProcessStatus;
  journeyStage: ContractorJourneyStage;
  journeyStageLabel: string;
  portions: MilkProcessLog[];
  qaSummary: ContractorPortionSummary;
  finalReceiptExists: boolean;
  authoritativeFinalLiters: number | null;
  finalReceiptTimestamp: string | null;
  firstWeightKg: number | null;
  secondWeightKg: number | null;
  netWeightKg: number | null;
}
