export interface StopDetail {
  id: string;
  planned_sequence: number;
  status: string;
  shop_code?: string;
  shop_name?: string;
  owner_name?: string;
  phone_number?: string;
  area_code?: string;
  area_name?: string;
  planned_latitude_snapshot?: number | null;
  planned_longitude_snapshot?: number | null;
  planned_latitude?: number | null;
  planned_longitude?: number | null;
  skipped_at?: string | null;
  skip_reason?: string | null;
  distanceKm?: number | null;
  hasCoordinates?: boolean;
  geofence_radius_m?: number | null;
  shop?: {
    id: string;
    shop_code: string;
    shop_name: string;
    owner_name: string;
    contact_number: string;
    geofence_radius_m?: number | null;
  } | null;
  collection?: {
    id?: string;
    collection_number?: string;
    gross_liters: number;
    unit: string;
    lr: number;
    fat: number;
    at_13ts_liters: number;
    created_at?: string;
    final_decision?: string | null;
  } | null;
}

export interface CoverJourneyOption {
  id: string;
  journey_number: string;
  route?: { name?: string; route_code?: string } | null;
  mot_profile?: { name?: string; mot_code?: string } | null;
  mot_vehicle?: { vehicle_number?: string } | null;
}

/** Header a superior sends to cover MOT work (the server checks it). */
export const COVER_HEADERS: Record<string, string> = { 'x-acting-as': 'MOT' };
export const EMPTY_COVER: CoverJourneyOption[] = [];

/** Final decision text for receipts. */
export function decisionWord(finalDecision: string | null | undefined): string {
  if (finalDecision === 'REJECTED') return 'Rejected';
  if (finalDecision === 'PENDING') return 'Waiting for Zonal Manager';
  return 'Accepted';
}

export function computeHaversineDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export function formatDistance(distKm: number): string {
  if (distKm < 1) {
    const meters = Math.round(distKm * 1000);
    return `${meters}m away`;
  }
  return `${distKm.toFixed(1)}km away`;
}

export interface CurrentJourney {
  id: string;
  journey_number: string;
  operational_date: string;
  zmcc?: { id: string; code?: string; name?: string } | null;
  route: { id: string; route_code: string; name: string } | null;
  mot_vehicle: { id: string; vehicle_number: string } | null;
  status: string;
  assigned_by_name: string | null;
  assigned_at: string;
  stops: StopDetail[];
  /** Set once the vehicle has reached the ZMCC. */
  arrival?: { zmcc_token: string; lab_status: string | null } | null;
}
