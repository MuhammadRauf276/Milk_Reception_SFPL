// Live-camera photo contract: capture metadata sent with uploads, upload result, stamp band content and camera result (client-safe).
import type { TestPointCode } from './test-point-policy';

export interface CapturedPhotoMeta {
  captureId: string;
  sha256: string;
  testingPoint: TestPointCode;
  entityType: string;
  entityId: string;
  labTestId?: string | null;
  portionNumber?: number | null;
  photoKind: 'TEST_RESULT' | 'LAB_REPORT' | 'TANKER_WASH' | 'OTHER';
  deviceCapturedAt: string;
  latitude?: number | null;
  longitude?: number | null;
  gpsAccuracyM?: number | null;
  wasOffline: boolean;
  width: number;
  height: number;
  policyVersion?: number | null;
  requestedAs?: string | null;
}

export interface CapturedPhotoUploadResult {
  captureId: string;
  photoId: string;
  status: 'SAVED' | 'DUPLICATE';
  hashReusedOnOtherRecord: boolean;
  clockDriftSeconds: number;
  clockMismatch: boolean;
}

// Text shown in the stamp band BELOW the photo (never over the image).
export interface StampInfo {
  employeeCode: string;
  roleLabel: string;
  actingAsLabel?: string | null;
  pointLabel: string;
  vehicleNo?: string | null;
  tokenNo?: string | null;
  captureId: string;
  offline: boolean;
}

export interface LiveCameraResult {
  captureId: string;
  blob: Blob;
  sha256: string;
  width: number;
  height: number;
  capturedAt: string;
  gps: { lat: number; lng: number; accuracyM: number } | null;
  /** Local object URL for the captured image, used as a fallback when the upload API is unavailable. */
  previewUrl?: string;
}
