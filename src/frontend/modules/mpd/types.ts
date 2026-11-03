import type { MpdExecutiveTelemetry } from '@/backend/services/mpdExecutiveService';

export type MpdTabId =
  | 'FLEET_RADAR'
  | 'HIERARCHY'
  | 'MOT_JOURNEYS'
  | 'REPORTS'
  | 'DISPATCH_VS_PLANT'
  | 'SOURCES'
  | 'QUALITY_FUNNEL'
  | 'LOSS_DIAGNOSTICS'
  | 'GOVERNANCE'
  | 'POLICIES';

// The dashboard renders exactly what GET /api/mpd/executive-overview returns.
export type MpdExecutiveTelemetryData = MpdExecutiveTelemetry;
export type MpdSummary = MpdExecutiveTelemetry['summary'];
export type MpdLossTiers = MpdExecutiveTelemetry['lossTiers'];
export type MotRouteTelemetry = MpdExecutiveTelemetry['motRoutes'][number];
export type InTransitTankerTelemetry = MpdExecutiveTelemetry['inTransitTankers'][number];
export type ZmccCenterTelemetry = MpdExecutiveTelemetry['zmccCenters'][number];
export type PlantContractorTelemetry = MpdExecutiveTelemetry['plantContractors'][number];
export type QualityFunnelTelemetry = MpdExecutiveTelemetry['qualityFunnel'];
export type GovernanceOverrideTelemetry = MpdExecutiveTelemetry['governanceOverrides'][number];
export type EmergencySubstituteTelemetry = MpdExecutiveTelemetry['emergencySubstitutes'][number];
