export type NotificationEventKey = 'ZMCC_LAB_EXCEPTION_PENDING' | 'PLANT_QA_EXCEPTION_PENDING' | 'CORRECTION_ESCALATED' | 'FINANCE_TARGET_CHANGED' | 'SYSTEM_ALERT' | 'ERP_VENDOR_MAPPING_REQUIRED' | 'MOT_SHOP_EXCEPTION_PENDING' | 'HIGH_TRANSIT_LOSS_ALERT';
export type NotificationRecipientRole = 'ZMCC_MANAGER' | 'QA_MANAGER' | 'HEAD_OF_MPD' | 'FINANCE_ACCOUNTS' | 'SUPER_ADMIN' | 'DATA_EXECUTIVE';
export interface NotificationEventDefinition { recipients: NotificationRecipientRole[]; priority: 'NORMAL' | 'HIGH' | 'CRITICAL'; sourceType: string; }
export const notificationEventCatalog: Record<NotificationEventKey, NotificationEventDefinition> = {
  ZMCC_LAB_EXCEPTION_PENDING: { recipients: ['ZMCC_MANAGER'], priority: 'HIGH', sourceType: 'ZMCC_LAB_SESSION' },
  PLANT_QA_EXCEPTION_PENDING: { recipients: ['QA_MANAGER'], priority: 'HIGH', sourceType: 'PLANT_QA_PORTION' },
  CORRECTION_ESCALATED: { recipients: ['HEAD_OF_MPD'], priority: 'HIGH', sourceType: 'CORRECTION_REQUEST' },
  FINANCE_TARGET_CHANGED: { recipients: ['HEAD_OF_MPD', 'FINANCE_ACCOUNTS'], priority: 'NORMAL', sourceType: 'FINANCE_LOSS_TARGET' },
  SYSTEM_ALERT: { recipients: ['SUPER_ADMIN'], priority: 'CRITICAL', sourceType: 'SYSTEM' },
  ERP_VENDOR_MAPPING_REQUIRED: { recipients: ['FINANCE_ACCOUNTS', 'ZMCC_MANAGER', 'DATA_EXECUTIVE'], priority: 'HIGH', sourceType: 'LOCAL_SUPPLIER' },
  MOT_SHOP_EXCEPTION_PENDING: { recipients: ['ZMCC_MANAGER'], priority: 'HIGH', sourceType: 'MOT_SHOP_COLLECTION' },
  HIGH_TRANSIT_LOSS_ALERT: { recipients: ['ZMCC_MANAGER', 'SUPER_ADMIN', 'HEAD_OF_MPD'], priority: 'HIGH', sourceType: 'ROAD_TRANSIT' },
};
