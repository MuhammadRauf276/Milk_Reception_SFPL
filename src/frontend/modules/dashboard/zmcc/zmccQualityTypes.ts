export interface ZmccLabResultItem {
  id: string;
  test_id: string;
  test_code_snapshot: string;
  test_name_snapshot: string;
  result_type_snapshot: string;
  unit_snapshot?: string | null;
  numeric_value: number | null;
  text_value: string | null;
  evaluation_status: string | null;
  is_passed: boolean | null;
  applied_rule_id: string | null;
  applied_rule_version: number | null;
}

export interface ZmccLabSessionItem {
  id: string;
  zmcc_id: string;
  /** MOT = MC (company vehicle collection), HC = everything else delivered to the ZMCC. */
  arrival_type: 'MOT' | 'HC';
  status: string;
  decision: string | null;
  system_quality_outcome: string | null;
  manager_review_status: string | null;
  manager_requested_decision: string | null;
  manager_reviewed_by_user_id: string | null;
  manager_reviewed_at: string | null;
  manager_review_reason: string | null;
  original_decision: string | null;
  corrected_decision: string | null;
  rejection_reason: string | null;
  remarks: string | null;
  quantity_value: number | null;
  quantity_unit: string | null;
  gross_liters: number | null;
  completed_at: string | null;
  mot_arrival?: {
    id: string;
    zmcc_token: string;
    route_milk_token?: string | null;
    exit_timestamp?: string | null;
    journey?: {
      route?: { name: string; route_code?: string } | null;
      mot_vehicle?: { vehicle_number: string } | null;
    } | null;
  } | null;
  local_supplier_arrival?: {
    id: string;
    zmcc_token: string;
    rmr_number: string;
    vehicle_number: string;
    exit_timestamp?: string | null;
    local_supplier?: { name: string } | null;
  } | null;
  exit_outcome?: string | null;
  exit_reason_code?: string | null;
  exit_remarks?: string | null;
  tank_receipt?: {
    id: string;
    gross_liters: number;
    quantity_value?: number | null;
    at_13ts_liters?: number | null;
    lr?: number | null;
    fat?: number | null;
    snf?: number | null;
    ts?: number | null;
    milk_source_name_snapshot?: string | null;
    milk_source_code_snapshot?: string | null;
    tank?: { tank_code: string; name: string } | null;
  } | null;
  results?: ZmccLabResultItem[];
}
