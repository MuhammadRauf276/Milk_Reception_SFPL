import type {
  serializeLocalSupplierArrival,
  serializeMotArrival,
} from '@/backend/services/zmccArrival/zmccArrivalCore';
import type { serializeLocalSupplier } from '@/backend/services/zmccLocalSupplierService';

export type MainTab = 'MC_ARRIVAL' | 'HC_ARRIVAL' | 'INSIDE_ZMCC' | 'HISTORY';

export type McArrivalRow = ReturnType<typeof serializeMotArrival>;
export type HcArrivalRow = ReturnType<typeof serializeLocalSupplierArrival>;
export type HcSupplierRow = ReturnType<typeof serializeLocalSupplier>;
export type CorrectionTarget =
  | { type: 'MC'; record: McArrivalRow }
  | { type: 'HC'; record: HcArrivalRow };

export type GpsState = { lat: number | null; lng: number | null; acc: number | null };
export type PolicyMode = 'REQUIRED' | 'OPTIONAL' | 'DISABLED';

/** Row shape of GET /api/zmcc/arrivals/arriving-journeys (see getArrivingMotJourneys). */
export type ArrivingJourney = {
  id: string;
  journey_number: string;
  operational_date: string;
  started_at: string;
  status?: string;
  route: { id: string; route_code: string; name: string } | null;
  mot_vehicle: { id: string; vehicle_number: string } | null;
  mot_profile: { id: string; mot_code: string; name: string; phone_number: string | null } | null;
  zmcc: { id: string; code: string; name: string } | null;
  total_stops: number;
  visited_stops: number;
  skipped_stops?: number;
  pending_stops?: number;
  total_gross_liters: number;
  total_at_13ts_liters: number;
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
    } | null;
    collection?: {
      gross_liters: number;
      at_13ts_liters?: number;
    } | null;
  }>;
};

export const EMPTY_GPS: GpsState = { lat: null, lng: null, acc: null };

/** Unique client_event_id used to make arrival/exit submissions idempotent. */
export function generateClientEventId(prefix: string) {
  const random = Math.random().toString(36).substring(2, 10);
  return `${prefix}-${Date.now()}-${random}`;
}
