/** Immutable identities used to reconcile MOT collection to ZMCC and plant receipt. */
export interface MotZmccReconciliationIdentity {
  motJourneyId: string;
  motVehicleId: string;
  zmccId: string;
  zmccMotArrivalId: string;
  finalZmccLabSessionId: string;
  tankReceiptId: string | null;
}

export interface ReconciliationVariance {
  origin: number;
  destination: number;
  signedVariance: number;
  loss: number;
  gain: number;
  lossPercent: number | null;
}

/** Physical disposition is deliberately separate from measured variance. */
export interface MilkDispositionSummary {
  acceptedQuantity: number | null;
  rejectedQuantity: number | null;
  allocationEvidence: 'PHYSICAL_ALLOCATION' | 'WHOLE_ARRIVAL_DECISION' | 'UNRESOLVED';
}

export interface DispatchPlantReconciliationIdentity {
  dispatchId: string;
  vehicleVisitId: string;
  plantReceiptId: string | null;
  sourceId: string;
  routeId: string | null;
}

/** Read-only MOT-to-ZMCC reconciliation row. Unresolved arrivals remain visible but are excluded from finalized totals. */
export interface ZmccAreaReconciliationRow {
  journeyId: string;
  journeyNumber: string;
  operationalDate: string;
  source: { id: string; code: string; name: string };
  route: { id: string; code: string; name: string };
  vehicleNumber: string;
  originGrossLiters: number;
  originAt13tsLiters: number;
  destinationGrossLiters: number | null;
  destinationAt13tsLiters: number | null;
  finalDecision: 'ACCEPTED' | 'REJECTED' | null;
  isResolved: boolean;
  gross: ReconciliationVariance | null;
  at13ts: ReconciliationVariance | null;
}

export interface ZmccReconciliationSummary {
  finalizedJourneys: number;
  unresolvedJourneys: number;
  grossLossLiters: number;
  grossGainLiters: number;
  at13tsLossLiters: number;
  at13tsGainLiters: number;
  unresolvedOriginAt13tsLiters: number;
}
