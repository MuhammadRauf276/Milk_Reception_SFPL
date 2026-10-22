// Phase 4a Stage 1 (MOT shop) decision contract: shared by server and client (no runtime imports).
import type { TestPointCode, TestPointPolicyCell } from '@/types/test-point-policy';

export type PersonDecision = 'ACCEPT' | 'REJECT';
export type SystemOutcome = 'PASS' | 'FAIL';
export type ExceptionReason = 'MISMATCH' | 'PICTURE_MISSING' | 'MISSING_FIELD' | 'AWAY_FROM_SHOP' | `RULE_FAIL:${string}`;
export type DecisionRoute = 'PROCEED' | 'REJECT' | 'SEND_TO_APPROVER' | 'DECIDE_NOW';
export type FinalDecision = 'ACCEPTED' | 'REJECTED' | 'PENDING';
export type ReviewStatus = 'NONE' | 'PENDING' | 'APPROVED' | 'REJECTED';

export interface DecisionInput {
  ruleFailures: string[]; // APPLY-mode failures (test codes); WARN failures go in warnings only
  missingCompulsory: string[];
  missingPhotos: string[];
  extraReasons?: ExceptionReason[]; // e.g. AWAY_FROM_SHOP
  personDecision: PersonDecision;
  remarks?: string | null;
  deciderCanApprove: boolean; // canActAs(actor,'ZMCC_MANAGER') && actor !== DATA_EXECUTIVE
}

export interface DecisionResult {
  route: DecisionRoute;
  systemOutcome: SystemOutcome;
  exceptionReasons: ExceptionReason[];
  remarksRequired: boolean;
  remarksOk: boolean;
  finalDecision: FinalDecision;
  reviewStatus: ReviewStatus;
}

export interface GeofenceInput {
  shopLat: number | null;
  shopLng: number | null;
  radiusM: number | null;
  lat: number;
  lng: number;
  accuracyM: number | null;
  approximate?: boolean;
}

export interface GeofenceResult {
  status: 'INSIDE' | 'OUTSIDE' | 'NO_SHOP_GPS' | 'WEAK_GPS';
  distanceM: number | null;
  radiusM: number;
}

export interface MotShopPolicyTest extends TestPointPolicyCell {
  resultType: string;
  isLr: boolean;
  isFat: boolean;
  options?: string[] | null;
  rule: { min: number | null; max: number | null; allowed?: string[] | null; warningOptions?: string[] | null } | null;
}

export interface MotShopPolicySnapshot {
  point: Extract<TestPointCode, 'MOT_SHOP'>;
  version: number;
  fetchedAt: string;
  tests: MotShopPolicyTest[];
}

export interface MotShopTestInput {
  labTestId: string;
  value?: number | null;
  textValue?: string | null;
  photoCaptureId?: string | null;
}

export interface MotShopDecisionDetails {
  policyVersion: number;
  tests: Array<{
    labTestId: string;
    testCode: string;
    testName: string;
    value: number | null;
    textValue: string | null;
    testMode: string;
    ruleMode: string;
    photoMode: string;
    outcome: 'PASS' | 'FAIL' | 'WARN' | 'NOT_TESTED';
    photoCaptureId: string | null;
  }>;
  geofence: GeofenceResult & { accuracyM: number | null; approximate: boolean };
  warnings: string[];
}
