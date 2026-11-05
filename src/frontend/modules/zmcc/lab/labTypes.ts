import type { serializeLabSession } from '@/backend/services/zmccLabService';

export type MainTab = 'QUEUE' | 'TESTING' | 'HISTORY' | 'RECEIPTS' | 'REQUESTS';

export type LabSession = ReturnType<typeof serializeLabSession>;
export type LabResult = LabSession['results'][number];
export type ResultDraft = { numeric_value: number | string; text_value: string };
export type ResultDrafts = Record<string, ResultDraft>;
export type ActiveTank = { id: string; tank_code: string; tank_name: string; capacity_liters: number; available_capacity: number };

/** Row shape of GET /api/zmcc/lab/queue (see getArrivalsQueue). */
export type LabQueueItem = {
  queue_type: 'MOT' | 'HC';
  arrival_id: string;
  zmcc_id: string;
  zmcc_code: string;
  zmcc_name: string;
  zmcc_token: string | null;
  arrival_timestamp: string;
  arrival_date: string;
  vehicle_number: string | null;
  lab_session_id: string | null;
  lab_session_status: string | null;
  route_milk_token?: string | null;
  journey_id?: string;
  journey_number?: string;
  route_code?: string | null;
  route_name?: string | null;
  mot_code?: string | null;
  mot_name?: string | null;
  local_supplier_id?: string;
  local_supplier_code?: string;
  local_supplier_name?: string;
  rmr_number?: string | null;
};
