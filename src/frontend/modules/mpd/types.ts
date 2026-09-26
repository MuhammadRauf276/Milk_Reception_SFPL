export type MpdTabId =
  | 'FLEET_RADAR'
  | 'SOURCES'
  | 'QUALITY_FUNNEL'
  | 'LOSS_DIAGNOSTICS'
  | 'GOVERNANCE'
  | 'POLICIES';

export interface MpdSummary {
  totalIntakeLiters: number;
  weightedFatPercent: number;
  weightedLr: number;
  weightedSnfPercent: number;
  standardized13TsLiters: number;
  inTransitLiters: number;
  inTransitTankerCount: number;
  supplyChainLossPercent: number;
  supplyChainLossLiters: number;
  activeZmccCount: number;
  activeContractorCount: number;
}

export interface MotRouteTelemetry {
  id: string;
  routeCode: string;
  routeName: string;
  vehicleNumber: string;
  motName: string;
  completedShops: number;
  totalShops: number;
  grossLiters: number;
  fatPercent: number;
  lr: number;
  status: string;
  etaOrArrival: string;
}

export interface InTransitTankerTelemetry {
  id: string;
  vehicleNumber: string;
  driverName: string;
  sourceName: string;
  sourceCode: string;
  departureTime: string;
  grossLiters: number;
  at13tsLiters: number;
  temperatureCelsius: number;
  fatPercent: number;
  lr: number;
  status: string;
  etaPlant: string;
}

export interface ZmccCenterTelemetry {
  id: string;
  code: string;
  name: string;
  intakeLiters: number;
  siloStockLiters: number;
  siloCapacityPercent: number;
  avgFatPercent: number;
  avgLr: number;
  dispatchedLiters: number;
  dispatchedTankerCount: number;
  isActive: boolean;
}

export interface PlantContractorTelemetry {
  id: string;
  code: string;
  name: string;
  deliveredLiters: number;
  avgFatPercent: number;
  avgLr: number;
  qualityPassRatePercent: number;
  pricingAgreement: string;
  erpStatus: 'VERIFIED' | 'PENDING_ERP_MAPPING';
}

export interface QualityFunnelTelemetry {
  villageShopRejectedLiters: number;
  villageShopRejectionPercent: number;
  zmccGateRejectedLiters: number;
  zmccGateRejectionPercent: number;
  plantGateRejectedLiters: number;
  plantGateRejectionPercent: number;
  incidents: {
    formalinCount: number;
    ureaCount: number;
    waterLowLrCount: number;
    cobPositiveCount: number;
  };
}

export interface GovernanceOverrideTelemetry {
  id: string;
  reference: string;
  sourceName: string;
  stage: 'ZMCC_GATE' | 'PLANT_RECEPTION';
  failedParameter: string;
  failedValue: string;
  toleranceLimit: string;
  attendantNote: string;
  managerJustification: string;
  overruledBy: string;
  timestamp: string;
  status: 'PENDING_AUDIT' | 'APPROVED' | 'FLAGGED';
}

export interface EmergencySubstituteTelemetry {
  id: string;
  vehicleNumber: string;
  vehicleType: string;
  replacedVehicleNumber: string;
  zmccName: string;
  registeredBy: string;
  timestamp: string;
  status: string;
}

export interface MpdExecutiveTelemetryData {
  businessDate: string;
  calendarDate: string;
  summary: MpdSummary;
  motRoutes: MotRouteTelemetry[];
  inTransitTankers: InTransitTankerTelemetry[];
  zmccCenters: ZmccCenterTelemetry[];
  plantContractors: PlantContractorTelemetry[];
  qualityFunnel: QualityFunnelTelemetry;
  governanceOverrides: GovernanceOverrideTelemetry[];
  emergencySubstitutes: EmergencySubstituteTelemetry[];
}
