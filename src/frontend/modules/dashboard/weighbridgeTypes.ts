import { formatAcceptedQuantitySummary } from '@/backend/modules/dispatch/quantity/dispatchQuantityService';

export type WeighbridgeTab = 'FIRST_WEIGHT' | 'SECOND_WEIGHT';

export interface FirstWeightPortion {
  id: string;
  portion_number: number;
  dispatch_quantity_value: number | null;
  dispatch_quantity_unit: string | null;
  dispatch_quantity_basis: string | null;
  plant_decision: string;
  plant_rejection_reason: string | null;
}

export interface FirstWeightVisit {
  id: string;
  vehicle_number: string;
  token_number: string | null;
  operational_date: string;
  current_status: string;
  portion_count: number;
  accepted_portion_count: number;
  rejected_portion_count: number;
  vehicle_dispatch_quantity_value?: number | null;
  vehicle_dispatch_quantity_unit?: string | null;
  vehicle_dispatch_quantity_basis?: string | null;
  portions?: FirstWeightPortion[];
  waiting_minutes: number;
  plant_decision_summary: string;
  min_allowed_timestamp: string;
  test_mode?: string;
  is_portion_wise?: boolean;
}

export interface SecondWeightVisit {
  id: string;
  vehicle_number: string;
  token_number: string | null;
  operational_date: string;
  current_status: string;
  portion_count: number;
  ticket_number: string | null;
  gross_weight_kg: number;
  gross_timestamp: string | null;
  gross_recorded_by_name: string;
  waiting_minutes: number;
  min_allowed_timestamp: string;
  destination_silo_text?: string;
  is_multi_silo_different?: boolean;
  test_mode?: string;
  is_portion_wise?: boolean;
  active_portion_number?: number;
  active_portion_first_weight_kg?: number;
  total_accepted_portions?: number;
  completed_accepted_portions?: number;
}

export function formatAcceptedQuantity(v: FirstWeightVisit): string {
  return formatAcceptedQuantitySummary(
    v.portions,
    v.vehicle_dispatch_quantity_value,
    v.vehicle_dispatch_quantity_unit
  );
}

// Human-readable duration formatter
export function formatDuration(minutes: number): string {
  if (minutes < 60) {
    return `${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMins = minutes % 60;
  if (hours < 24) {
    return remainingMins > 0 ? `${hours}h ${remainingMins}m` : `${hours}h`;
  }
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`;
}
