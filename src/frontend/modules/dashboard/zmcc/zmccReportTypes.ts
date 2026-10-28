export interface ZmccShopHierarchyNode {
  id: string;
  shopCode: string;
  shopName: string;
  ownerName: string;
  phoneNumber: string;
  chillerOwnership: string;
  geotagStatus: string;
  latitude: number | null;
  longitude: number | null;
  isActive: boolean;
  todayLiters: number;
  todayFat: number | null;
  todayLr: number | null;
  todaySnf: number | null;
  lastCollectionAt: string | null;
}

export interface ZmccAreaHierarchyNode {
  id: string;
  areaCode: string;
  name: string;
  routeId: string;
  isActive: boolean;
  totalShops: number;
  activeShops: number;
  verifiedGpsShops: number;
  todayLiters: number;
  shops: ZmccShopHierarchyNode[];
}

export interface ZmccRouteHierarchyNode {
  id: string;
  routeCode: string;
  name: string;
  origin: string;
  destination: string;
  zmccId: string;
  isActive: boolean;
  totalAreas: number;
  totalShops: number;
  activeShops: number;
  verifiedGpsShops: number;
  todayLiters: number;
  todayAvgFat: number | null;
  todayAvgLr: number | null;
  todayShopCount: number;
  routeLossLiters: number | null;
  routeLossPct: number | null;
  assignedMot: {
    motCode: string;
    name: string;
    phoneNumber: string;
    vehicleNumber: string;
    journeyNumber?: string;
    journeyStatus?: string;
  } | null;
  areas: ZmccAreaHierarchyNode[];
}

export interface ZmccLocalSupplierNode {
  id: string;
  supplierCode: string;
  name: string;
  contactPerson: string | null;
  phoneNumber: string | null;
  zmccId: string;
  isActive: boolean;
  todayArrivalsCount: number;
  todayLiters: number;
  lastArrivalAt: string | null;
}

export interface ZmccHierarchyReport {
  zmcc: {
    id: string;
    code: string;
    name: string;
    sourceType: string;
  };
  summary: {
    totalRoutes: number;
    totalAreas: number;
    totalShops: number;
    activeShops: number;
    dormantShops: number;
    gpsVerifiedRate: number;
    todayIntakeLiters: number;
    activeMotCount: number;
    activeHcSupplierCount: number;
  };
  routes: ZmccRouteHierarchyNode[];
  hcSuppliers: ZmccLocalSupplierNode[];
}

export interface DailyIntakeTrendPoint {
  date: string;
  grossLiters: number;
  at13TsLiters: number;
  morningLiters: number;
  eveningLiters: number;
  collectionCount: number;
  avgFat: number;
  avgLr: number;
  avgSnf: number;
}

export interface QualityScatterPoint {
  collectionId: string;
  collectionNumber: string;
  routeCode: string;
  fat: number;
  snf: number;
  lr: number;
  grossLiters: number;
  tier: 'PREMIUM' | 'STANDARD' | 'WARNING' | 'REJECTED';
}

export interface RoutePerformanceRanking {
  routeId: string;
  routeCode: string;
  name: string;
  totalLiters: number;
  at13TsLiters: number;
  avgFat: number;
  avgLr: number;
  avgSnf: number;
  shopCount: number;
  completionRatePct: number;
  routeLossLiters: number;
  routeLossPct: number;
}

export interface HourlyThroughputPoint {
  hour: number;
  label: string;
  liters: number;
  count: number;
}

export interface ZmccBIAnalyticsData {
  timeHorizon: {
    fromDate: string;
    toDate: string;
    totalDays: number;
  };
  summaryKpis: {
    totalProcuredLiters: number;
    standardized13TsLiters: number;
    intakeVarianceVsPriorPct: number;
    weightedFatPct: number;
    weightedSnfPct: number;
    weightedLr: number;
    avgTemperatureC: number;
    tier1RouteLossLiters: number;
    tier1RouteLossPct: number;
    tier2StorageLossLiters: number;
    tier2StorageLossPct: number;
    shopCollectionRatePct: number;
    onTimeArrivalRatePct: number;
  };
  trends: DailyIntakeTrendPoint[];
  qualityScatter: QualityScatterPoint[];
  routeRankings: RoutePerformanceRanking[];
  hourlyFlow: HourlyThroughputPoint[];
  shiftComparison: {
    morningLiters: number;
    morningPct: number;
    eveningLiters: number;
    eveningPct: number;
  };
}

export interface RouteLedgerRow {
  id: string;
  journeyNumber: string;
  operationalDate: string;
  routeCode: string;
  routeName: string;
  motName: string;
  vehicleNumber: string;
  status: string;
  dispatchedAt: string;
  returnedAt: string | null;
  plannedStops: number;
  visitedStops: number;
  skippedStops: number;
  shopLitersCollected: number;
  zmccArrivalLiters: number;
  routeLossLiters: number;
  routeLossPct: number;
  avgFat: number;
  avgLr: number;
  avgSnf: number;
  at13TsLiters: number;
}

export interface HcSupplierLedgerRow {
  id: string;
  zmccToken: string;
  arrivalDate: string;
  arrivalTimestamp: string;
  supplierCode: string;
  supplierName: string;
  vehicleNumber: string;
  rmrNumber: string | null;
  grossLiters: number;
  density: number | null;
  fat: number | null;
  snf: number | null;
  lr: number | null;
  temperatureC: number | null;
  labStatus: string;
  decision: string;
  rmrStatus: string;
}

export interface TankStorageRow {
  id: string;
  tankCode: string;
  name: string;
  capacityLiters: number;
  currentStock: number;
  currentTempC: number | null;
  lastCipAt: string | null;
  todayReceiptsLiters: number;
  todayDispatchesLiters: number;
  holdingHours: number;
  fillPercentage: number;
}
