// Offline sync batch contract between the field device app and the server (client-safe, no DB imports).
import type { DeviceStatus } from './device';

// Maximum number of items accepted in one sync batch request.
export const SYNC_BATCH_MAX_ITEMS = 50;

export type SyncItemKind =
  | 'DEVICE_EVENT'
  | 'HEARTBEAT'
  | 'MOT_COLLECTION'
  | 'MOT_GPS_BATCH'
  | 'MOT_STOP_SKIP'
  | 'ZMCC_MOT_ARRIVAL'
  | 'ZMCC_LOCAL_SUPPLIER_ARRIVAL'; // P4 adds ZMCC_LAB_PORTION, DISPATCH

export interface SyncItem {
  clientUuid: string;
  kind: SyncItemKind;
  ownerUserId: string;
  requestedAs?: string | null;
  capturedAt: string;
  payload: unknown;
}

export interface SyncBatchRequest {
  deviceUid: string;
  appVersion: string;
  deviceSentAt: string;
  items: SyncItem[]; // at most SYNC_BATCH_MAX_ITEMS
}

export type SyncItemStatus = 'SAVED' | 'DUPLICATE' | 'REJECTED' | 'RETRY';

export interface SyncItemResult {
  clientUuid: string;
  status: SyncItemStatus;
  receipt?: string;
  entityType?: string;
  entityId?: string;
  code?: string;
  message?: string;
}

export interface SyncBatchResponse {
  serverTime: string;
  deviceStatus: DeviceStatus;
  results: SyncItemResult[];
}
