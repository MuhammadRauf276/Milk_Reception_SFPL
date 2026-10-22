export type MotWorkspaceTab =
  | 'DISPATCH'
  | 'ACTIVE_JOURNEYS'
  | 'JOURNEY_HISTORY'
  | 'JOURNEY_MAP'
  | 'SMS_OUTBOX'
  | 'PROFILES'
  | 'VEHICLES'
  | 'APPROVALS';

export interface ZmccSource {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
}

export interface MotProfileItem {
  id: string;
  mot_code: string;
  name: string;
  phone_number: string;
  cnic: string;
  zmcc_id: string;
  zmcc: { id: string; code: string; name: string };
  user_id: string | null;
  user: { id: string; username: string; full_name: string | null } | null;
  is_active: boolean;
  has_active_journey: boolean;
  active_journey?: { id: string; journey_number: string; status: string } | null;
  creator_name: string;
  updater_name: string | null;
  created_at: string;
}

export interface MotVehicleItem {
  id: string;
  vehicle_number: string;
  zmcc_id: string;
  zmcc: { id: string; code: string; name: string };
  is_active: boolean;
  has_active_journey: boolean;
  /** Last arrival not finished yet (waiting for lab / unloading). */
  at_zmcc_waiting_unload?: boolean;
  /** Active, no journey out, and last arrival finished. */
  is_available?: boolean;
  active_journey?: { id: string; journey_number: string; status: string } | null;
  creator_name: string;
  updater_name: string | null;
  created_at: string;
}

export interface RouteOption {
  id: string;
  route_code: string;
  name: string;
  zmcc_id: string;
  is_active: boolean;
  _count?: { areas: number };
}

export interface JourneyItem {
  id: string;
  journey_number: string;
  operational_date: string;
  zmcc_id: string;
  zmcc: { id: string; code: string; name: string };
  route_id: string;
  route: { id: string; route_code: string; name: string };
  mot_profile_id: string;
  mot_profile: { id: string; mot_code: string; name: string; phone_number: string };
  mot_vehicle_id: string;
  mot_vehicle: { id: string; vehicle_number: string };
  status: string;
  assigned_by_name: string;
  assigned_at: string;
  assignment_latitude: number;
  assignment_longitude: number;
  assignment_gps_accuracy: number | null;
  started_at: string;
  ended_at: string | null;
  cancelled_by_name: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  total_stops?: number;
  stops?: Array<{
    id: string;
    planned_sequence: number;
    status: string;
    skip_reason?: string | null;
    shop?: {
      id: string;
      shop_code: string;
      shop_name: string;
      owner_name: string;
      contact_number: string;
    } | null;
    collection?: {
      gross_liters: number;
      at_13ts_liters?: number;
    } | null;
  }>;
  locations?: Array<{
    id: string;
    source_type: string;
    latitude: number;
    longitude: number;
    device_recorded_at: string;
  }>;
  summary?: {
    id: string;
    journey_id: string;
    journey_ended_at: string;
    assigned_shop_count: number;
    collected_shop_count: number;
    skipped_shop_count: number;
    pending_shop_count: number;
    total_gross_liters: number;
    total_at_13ts_liters: number;
    weighted_avg_lr: number | null;
    weighted_avg_fat: number | null;
    weighted_avg_snf: number | null;
    weighted_avg_ts: number | null;
    summary_version: string;
    source_calculation_versions: string[];
    revision: number;
    generated_at: string;
    last_recomputed_at: string | null;
  } | null;
}

export const EMPTY_ROUTES: RouteOption[] = [];
export const EMPTY_PROFILES: MotProfileItem[] = [];
export const EMPTY_VEHICLES: MotVehicleItem[] = [];
export const EMPTY_JOURNEYS: JourneyItem[] = [];

/** Query key prefix for every MOT operations list; invalidate this after any mutation. */
export const MOT_TAB_DATA_KEY = ['mot', 'tab-data'] as const;
