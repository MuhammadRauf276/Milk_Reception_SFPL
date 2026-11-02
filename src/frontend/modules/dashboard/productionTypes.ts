export interface SiloOption {
  id: string;
  silo_code: string;
  silo_name: string;
  capacity_liters: number | null;
  current_stock_liters: number | null;
  current_stock_at_13ts?: number | null;
  composite_ts_percent?: number | null;
  active_reserved_liters: number | null;
  provisional_available_liters: number | null;
  is_active: boolean;
}

export interface PortionDef {
  id: string;
  portion_number: number;
  dispatch_quantity_value?: number | null;
  dispatch_quantity_unit?: string;
  dispatch_quantity_basis?: string;
  plant_decision: 'ACCEPTED' | 'REJECTED' | 'PENDING';
  plant_rejection_reason: string | null;
  current_status: string;
  first_weight_kg?: number | null;
  first_weight_at?: string | null;
  second_weight_kg?: number | null;
  second_weight_at?: string | null;
  net_weight_kg?: number | null;
  lr: number | null;
  fat: number | null;
  snf?: number | null;
  ts?: number | null;
  expected_physical_liters: number | null;
  expected_at13_ts_liters: number | null;
  unloading_log?: {
    id: string;
    silo_id: string | null;
    silo_number: string | null;
    silo_code?: string;
    silo_name?: string | null;
    pump_start_timestamp: string | null;
    pump_end_timestamp?: string | null;
    started_by_name?: string | null;
  } | null;
}

export interface ReadyVisitDef {
  id: string;
  visit_number: string;
  vehicle_number: string;
  token_number: string | null;
  current_status: string;
  gross_weight_kg: number | null;
  gross_timestamp: string | null;
  portion_count: number;
  accepted_portion_count: number;
  rejected_portion_count: number;
  vehicle_dispatch_quantity_value?: number | null;
  vehicle_dispatch_quantity_unit?: string | null;
  total_accepted_dispatch_value: number | null;
  total_accepted_dispatch_unit: string | null;
  total_accepted_physical_liters: number | null;
  total_accepted_at13_ts_liters: number | null;
  waiting_minutes: number;
  test_mode?: string;
  is_portion_wise?: boolean;
  active_portion_number?: number;
  active_portion_id?: string;
  portions: PortionDef[];
}

export interface UnloadingVisitDef {
  id: string;
  visit_number: string;
  vehicle_number: string;
  token_number: string | null;
  current_status: string;
  gross_weight_kg: number | null;
  portion_count: number;
  accepted_portion_count: number;
  rejected_portion_count: number;
  vehicle_dispatch_quantity_value?: number | null;
  vehicle_dispatch_quantity_unit?: string | null;
  total_accepted_dispatch_value: number | null;
  total_accepted_dispatch_unit: string | null;
  total_accepted_physical_liters: number | null;
  total_accepted_at13_ts_liters: number | null;
  started_at: string | null;
  started_by_name: string;
  elapsed_minutes: number;
  test_mode?: string;
  is_portion_wise?: boolean;
  active_portion_number?: number;
  portions: PortionDef[];
}

export interface SiloIssueHistoryDef {
  id: string;
  time_formatted: string;
  quantity_liters: number;
  purpose: string;
  flow_meter_reference: string | null;
  operator_name: string;
}

export type ProductionTab = 'READY' | 'UNLOADING' | 'SILO_ISSUE';

/** Idempotency key for one silo-issue submission. */
export function newClientRequestId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}
