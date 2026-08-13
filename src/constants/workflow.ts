/**
 * CANONICAL WORKFLOW STATUS MODEL
 * 
 * Milk Reception Application Official Workflow System
 */

// Official Vehicle Workflow Status Constants
export const VEHICLE_STATUS = {
  DISPATCHED: 'DISPATCHED',
  TOKEN_ISSUED: 'TOKEN_ISSUED',
  PLANT_QA: 'PLANT_QA',
  READY_FOR_GROSS: 'READY_FOR_GROSS',
  GROSS_WEIGHED: 'GROSS_WEIGHED',
  READY_FOR_UNLOADING: 'READY_FOR_UNLOADING',
  UNLOADING: 'UNLOADING',
  READY_FOR_TARE: 'READY_FOR_TARE',
  TARE_WEIGHED: 'TARE_WEIGHED',
  READY_FOR_GATE_EXIT: 'READY_FOR_GATE_EXIT',
  COMPLETED: 'COMPLETED',
} as const;

export type VehicleStatusType = keyof typeof VEHICLE_STATUS;

// Official Portion Workflow Status Constants
export const PORTION_STATUS = {
  DISPATCHED: 'DISPATCHED',
  QA_PENDING: 'QA_PENDING',
  ACCEPTED: 'ACCEPTED',
  REJECTED: 'REJECTED',
  READY_FOR_UNLOADING: 'READY_FOR_UNLOADING',
  UNLOADING: 'UNLOADING',
  UNLOADED: 'UNLOADED',
} as const;

export type PortionStatusType = keyof typeof PORTION_STATUS;

// Human-Friendly Display Labels
export const VEHICLE_STATUS_LABELS: Record<string, string> = {
  DISPATCHED: 'Dispatched from ZMCC',
  TOKEN_ISSUED: 'Token Issued / At Gate',
  PLANT_QA: 'Plant QA Sampling',
  READY_FOR_GROSS: 'Ready for First Weight',
  GROSS_WEIGHED: 'First Weight Completed',
  READY_FOR_UNLOADING: 'Ready for Unloading',
  UNLOADING: 'Unloading in Progress',
  READY_FOR_TARE: 'Ready for Second Weight',
  TARE_WEIGHED: 'Second Weight Completed',
  READY_FOR_GATE_EXIT: 'Ready for Gate Exit',
  COMPLETED: 'Visit Completed',
};

export const PORTION_STATUS_LABELS: Record<string, string> = {
  DISPATCHED: 'Dispatched',
  QA_PENDING: 'QA Pending',
  ACCEPTED: 'QA Accepted',
  REJECTED: 'QA Rejected',
  READY_FOR_UNLOADING: 'Ready for Unloading',
  UNLOADING: 'Unloading',
  UNLOADED: 'Unloaded into Silo',
};

/**
 * Valid Vehicle Workflow Transitions
 * Defines allowed next states for backend transition validation.
 */
export const ALLOWED_VEHICLE_TRANSITIONS: Record<string, string[]> = {
  DISPATCHED: [VEHICLE_STATUS.TOKEN_ISSUED],
  TOKEN_ISSUED: [VEHICLE_STATUS.PLANT_QA],
  PLANT_QA: [VEHICLE_STATUS.READY_FOR_GROSS],
  READY_FOR_GROSS: [VEHICLE_STATUS.GROSS_WEIGHED],
  GROSS_WEIGHED: [VEHICLE_STATUS.READY_FOR_UNLOADING, VEHICLE_STATUS.UNLOADING],
  READY_FOR_UNLOADING: [VEHICLE_STATUS.UNLOADING],
  UNLOADING: [VEHICLE_STATUS.UNLOADING, VEHICLE_STATUS.READY_FOR_TARE],
  READY_FOR_TARE: [VEHICLE_STATUS.TARE_WEIGHED],
  TARE_WEIGHED: [VEHICLE_STATUS.READY_FOR_GATE_EXIT],
  READY_FOR_GATE_EXIT: [VEHICLE_STATUS.COMPLETED],
  COMPLETED: [],
};

/**
 * Validates whether a vehicle transition from currentStatus to nextStatus is allowed.
 */
export function isValidVehicleTransition(currentStatus: string, nextStatus: string): boolean {
  if (currentStatus === nextStatus) return true;
  const allowed = ALLOWED_VEHICLE_TRANSITIONS[currentStatus];
  if (!allowed) return false;
  return allowed.includes(nextStatus);
}
