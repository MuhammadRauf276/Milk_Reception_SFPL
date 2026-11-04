export type NotificationEventKey =
  | 'MOT_RETURNING_TO_ZMCC'
  | 'MOT_VEHICLE_PROBLEM_PENDING'
  | 'ZMCC_LAB_EXCEPTION_PENDING'
  | 'ZMCC_EXIT_WITHOUT_UNLOADING'
  | 'ZMCC_CLOSE_REQUEST_PENDING'
  | 'PLANT_QA_EXCEPTION_PENDING'
  | 'CORRECTION_ESCALATED'
  | 'FINANCE_TARGET_CHANGED'
  | 'SYSTEM_ALERT'
  | 'MOT_SHOP_EXCEPTION_PENDING'
  | 'HIGH_TRANSIT_LOSS_ALERT'
  | 'DISPATCH_APPROVAL_PENDING'
  | 'REJECTED_MILK_REMARKS_PENDING'
  | 'SELF_APPROVAL_REVIEW'
  | 'NEW_ROUTE_PENDING'
  | 'NEW_SHOP_PENDING'
  | 'NEW_HC_PENDING'
  | 'MOT_SHOP_WARNING_LOGGED'
  | 'ZMCC_LAB_WARNING_LOGGED'
  | 'PLANT_QA_WARNING_LOGGED';

export type NotificationRecipientRole =
  | 'PHE_OPERATOR'
  | 'ZMCC_MANAGER'
  | 'CONTRACTOR_MANAGER'
  | 'MDO'
  | 'QA_HEAD'
  | 'HEAD_OF_MPD'
  | 'FINANCE_ACCOUNTS'
  | 'SUPER_ADMIN'
  | 'DATA_EXECUTIVE';

export interface NotificationEventDefinition {
  recipients: NotificationRecipientRole[];
  priority: 'NORMAL' | 'HIGH' | 'CRITICAL';
  sourceType: string;
}

export const notificationEventCatalog: Record<NotificationEventKey, NotificationEventDefinition> = {
  MOT_RETURNING_TO_ZMCC: { recipients: ['PHE_OPERATOR', 'MDO', 'ZMCC_MANAGER'], priority: 'NORMAL', sourceType: 'MOT_JOURNEY' },
  MOT_VEHICLE_PROBLEM_PENDING: { recipients: ['ZMCC_MANAGER'], priority: 'HIGH', sourceType: 'MOT_VEHICLE_CHANGE_REQUEST' },
  ZMCC_LAB_EXCEPTION_PENDING: { recipients: ['ZMCC_MANAGER'], priority: 'HIGH', sourceType: 'ZMCC_LAB_SESSION' },
  ZMCC_EXIT_WITHOUT_UNLOADING: { recipients: ['ZMCC_MANAGER'], priority: 'HIGH', sourceType: 'ZMCC_LAB_SESSION' },
  ZMCC_CLOSE_REQUEST_PENDING: { recipients: ['ZMCC_MANAGER'], priority: 'HIGH', sourceType: 'ZMCC_LAB_SESSION' },
  PLANT_QA_EXCEPTION_PENDING: { recipients: ['QA_HEAD'], priority: 'HIGH', sourceType: 'PLANT_QA_PORTION' },
  CORRECTION_ESCALATED: { recipients: ['HEAD_OF_MPD'], priority: 'HIGH', sourceType: 'CORRECTION_REQUEST' },
  FINANCE_TARGET_CHANGED: { recipients: ['HEAD_OF_MPD', 'FINANCE_ACCOUNTS'], priority: 'NORMAL', sourceType: 'FINANCE_LOSS_TARGET' },
  SYSTEM_ALERT: { recipients: ['SUPER_ADMIN'], priority: 'CRITICAL', sourceType: 'SYSTEM' },
  MOT_SHOP_EXCEPTION_PENDING: { recipients: ['ZMCC_MANAGER'], priority: 'HIGH', sourceType: 'MOT_SHOP_COLLECTION' },
  HIGH_TRANSIT_LOSS_ALERT: { recipients: ['ZMCC_MANAGER', 'SUPER_ADMIN', 'HEAD_OF_MPD'], priority: 'HIGH', sourceType: 'ROAD_TRANSIT' },
  DISPATCH_APPROVAL_PENDING: { recipients: ['ZMCC_MANAGER', 'CONTRACTOR_MANAGER', 'HEAD_OF_MPD'], priority: 'HIGH', sourceType: 'VEHICLE_VISIT' },
  REJECTED_MILK_REMARKS_PENDING: { recipients: ['HEAD_OF_MPD'], priority: 'HIGH', sourceType: 'REJECTED_MILK' },
  SELF_APPROVAL_REVIEW: { recipients: ['DATA_EXECUTIVE', 'SUPER_ADMIN'], priority: 'HIGH', sourceType: 'APPROVAL_DECISION' },
  NEW_ROUTE_PENDING: { recipients: ['ZMCC_MANAGER'], priority: 'NORMAL', sourceType: 'ZMCC_ROUTE' },
  NEW_SHOP_PENDING: { recipients: ['MDO', 'ZMCC_MANAGER'], priority: 'NORMAL', sourceType: 'ZMCC_SHOP' },
  NEW_HC_PENDING: { recipients: ['ZMCC_MANAGER'], priority: 'NORMAL', sourceType: 'ZMCC_LOCAL_SUPPLIER' },
  MOT_SHOP_WARNING_LOGGED: { recipients: ['ZMCC_MANAGER', 'HEAD_OF_MPD'], priority: 'NORMAL', sourceType: 'MOT_SHOP_COLLECTION' },
  ZMCC_LAB_WARNING_LOGGED: { recipients: ['ZMCC_MANAGER', 'HEAD_OF_MPD'], priority: 'NORMAL', sourceType: 'ZMCC_LAB_SESSION' },
  PLANT_QA_WARNING_LOGGED: { recipients: ['QA_HEAD'], priority: 'HIGH', sourceType: 'PLANT_QA_PORTION' },
};
