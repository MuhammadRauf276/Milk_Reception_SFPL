import { MilkProcessLog } from '@/backend/core/types';

/**
 * Authoritative Canonical VehicleVisit statuses.
 * Obsolete presentation-era or temporary test aliases are NOT permitted.
 */
export const CANONICAL_VEHICLE_STATUSES = [
  'DRAFT_DISPATCH',
  'DISPATCHED',
  'TOKEN_ISSUED',
  'PLANT_QA',
  'READY_FOR_GROSS',
  'GROSS_WEIGHED',
  'READY_FOR_UNLOADING',
  'UNLOADING',
  'READY_FOR_TARE',
  'TARE_WEIGHED',
  'READY_FOR_GATE_EXIT',
  'COMPLETED',
] as const;

export type CanonicalVehicleStatus = (typeof CANONICAL_VEHICLE_STATUSES)[number];

export function isCanonicalVehicleStatus(status: string | null | undefined): status is CanonicalVehicleStatus {
  if (!status) return false;
  return CANONICAL_VEHICLE_STATUSES.includes(status as any);
}

/**
 * Deduplicates portion rows to count distinct physical VehicleVisits.
 * Canonical identity: prefer vehicle visit id (id or visit_id), falling back to visit_number.
 */
export function getDistinctVehicleCount<
  T extends { id?: string | number | null; visit_id?: string | number | null; visit_number?: string | null }
>(items: T[]): number {
  if (!items || items.length === 0) return 0;
  const visitIds = new Set<string | number>();

  for (const item of items) {
    const key =
      item.id !== undefined && item.id !== null
        ? String(item.id)
        : item.visit_id !== undefined && item.visit_id !== null
        ? String(item.visit_id)
        : item.visit_number
        ? String(item.visit_number)
        : null;

    if (key) {
      visitIds.add(key);
    }
  }

  return visitIds.size;
}

/**
 * Deduplicates portion logs to unique VehicleVisit logs (keeping the first portion log per visit).
 */
export function getDistinctVehicleLogs<
  T extends { id?: string | number | null; visit_id?: string | number | null; visit_number?: string | null }
>(items: T[]): T[] {
  if (!items || items.length === 0) return [];
  const seen = new Set<string>();
  const result: T[] = [];

  for (const item of items) {
    const key =
      item.id !== undefined && item.id !== null
        ? String(item.id)
        : item.visit_id !== undefined && item.visit_id !== null
        ? String(item.visit_id)
        : item.visit_number
        ? String(item.visit_number)
        : null;

    if (key && !seen.has(key)) {
      seen.add(key);
      result.push(item);
    }
  }

  return result;
}

export interface DashboardStatusClassification {
  isActiveInPlant: boolean;
  isQaLabQueue: boolean;
  isWeighbridgeQueue: boolean;
  isSiloQueue: boolean;
  isCompleted: boolean;
}

/**
 * Pure helper for classifying a log's status strictly against canonical statuses.
 * Obsolete aliases reject to all-false.
 */
export function classifyDashboardStatus(status: string | null | undefined): DashboardStatusClassification {
  if (!isCanonicalVehicleStatus(status)) {
    return {
      isActiveInPlant: false,
      isQaLabQueue: false,
      isWeighbridgeQueue: false,
      isSiloQueue: false,
      isCompleted: false,
    };
  }

  return {
    isActiveInPlant: status !== 'DRAFT_DISPATCH' && status !== 'DISPATCHED' && status !== 'COMPLETED',
    isQaLabQueue: status === 'PLANT_QA' || status === 'TOKEN_ISSUED',
    isWeighbridgeQueue:
      status === 'READY_FOR_GROSS' ||
      status === 'GROSS_WEIGHED' ||
      status === 'READY_FOR_TARE' ||
      status === 'TARE_WEIGHED',
    isSiloQueue: status === 'READY_FOR_UNLOADING' || status === 'UNLOADING',
    isCompleted: status === 'COMPLETED',
  };
}

/**
 * Maps a canonical status to its Kanban lane index / status key.
 * Obsolete/legacy values return null.
 */
export function getKanbanLaneForStatus(status: string | null | undefined): string | null {
  if (!isCanonicalVehicleStatus(status)) {
    return null;
  }

  switch (status) {
    case 'DISPATCHED':
      return 'DISPATCHED';
    case 'TOKEN_ISSUED':
      return 'TOKEN_ISSUED';
    case 'PLANT_QA':
      return 'PLANT_QA';
    case 'READY_FOR_GROSS':
    case 'GROSS_WEIGHED':
    case 'READY_FOR_TARE':
    case 'TARE_WEIGHED':
      return 'READY_FOR_GROSS';
    case 'READY_FOR_UNLOADING':
    case 'UNLOADING':
      return 'READY_FOR_UNLOADING';
    default:
      return null;
  }
}
