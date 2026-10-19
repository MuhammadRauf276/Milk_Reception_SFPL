// Device identity contract: request header names, lifecycle status and the authenticated device shape (client-safe).
// Status values mirror the Device.status column in prisma/schema.prisma (stored as a string).
export const DEVICE_UID_HEADER = 'x-device-uid';
export const DEVICE_KEY_HEADER = 'x-device-key';

export type DeviceStatus = 'PENDING' | 'ACTIVE' | 'BLOCKED' | 'RELEASED';

export interface AuthenticatedDevice {
  id: bigint;
  deviceUid: string;
  status: DeviceStatus;
  assignedUserId: bigint | null;
  procurementSourceId: bigint | null;
  isSharedStation: boolean;
}
