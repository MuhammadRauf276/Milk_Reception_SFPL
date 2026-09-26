/** Restricted read model for Admin Head supervision. No supplier, milk, lab, rate, payment, or correction fields belong here. */
export interface AdminHeadVehicleBoardRow {
  visitId: string;
  vehicleNumber: string;
  stage: string;
  enteredPlantAt: string | null;
  stageChangedAt: string | null;
}

export interface AdminHeadSecurityActivity {
  vehiclesInsidePlant: number;
  pendingGateExit: number;
  latestEntryAt: string | null;
  latestExitAt: string | null;
}

export interface AdminHeadDashboard {
  security: AdminHeadSecurityActivity;
  vehicles: AdminHeadVehicleBoardRow[];
}
