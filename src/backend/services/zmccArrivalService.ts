import { prisma } from '@core/db';
import { Prisma, PaperReferenceType } from '@prisma/client';
import { getCurrentUser } from '@core/auth';
import { User, Role } from '@core/types';
import { getPakistanCalendarDate } from '@core/business-day';
import {
  createInitialMotJourneySummaryTx,
  serializeMotJourneySummary,
} from './motJourneySummaryService';
import { PaperReferenceService } from '@/backend/services/paperReferenceService';

export interface ZmccArrivalAuthContext {
  user: User;
  actorUserId: bigint;
  role: Role;
  isSuperAdmin: boolean;
  isZmccManager: boolean;
  isPheOperator: boolean;
  effectiveZmccId: bigint | null;
}

export type ZmccArrivalAction =
  | 'SUBMIT_ARRIVAL'
  | 'CORRECT_ARRIVAL'
  | 'READ_ARRIVAL'
  | 'RECORD_EXIT'
  | 'CORRECT_EXIT';

export interface ServiceResult<T> {
  status: number;
  data?: T;
  error?: string;
  message?: string;
}

export interface SubmitMotArrivalPayload {
  journey_id: string | number | bigint;
  route_milk_token?: string | null;
  raw_milk_token_number?: string | null;
  arrival_timestamp: string | Date;
  client_event_id: string;
  phe_latitude?: number | null;
  phe_longitude?: number | null;
  phe_gps_accuracy?: number | null;
  zmcc_id?: string | number | bigint;
}

export interface CorrectMotArrivalPayload {
  reason: string;
  route_milk_token?: string;
  raw_milk_token_number?: string | null;
  arrival_timestamp?: string | Date;
  phe_latitude?: number | null;
  phe_longitude?: number | null;
  phe_gps_accuracy?: number | null;
}

export interface SubmitContractorArrivalPayload {
  contractor_source_id: string | number | bigint;
  rmr_number: string;
  vehicle_number: string;
  arrival_timestamp: string | Date;
  client_event_id: string;
  phe_latitude?: number | null;
  phe_longitude?: number | null;
  phe_gps_accuracy?: number | null;
  zmcc_id?: string | number | bigint;
  target_zmcc_id?: string | number | bigint;
}

export interface CorrectContractorArrivalPayload {
  reason: string;
  rmr_number?: string;
  vehicle_number?: string;
  arrival_timestamp?: string | Date;
  phe_latitude?: number | null;
  phe_longitude?: number | null;
  phe_gps_accuracy?: number | null;
}

export interface SubmitLocalSupplierArrivalPayload {
  local_supplier_id: string | number | bigint;
  rmr_number: string;
  vehicle_number: string;
  arrival_timestamp?: string | Date;
  client_event_id: string;
  phe_latitude?: number | null;
  phe_longitude?: number | null;
  phe_gps_accuracy?: number | null;
  zmcc_id?: string | number | bigint;
  target_zmcc_id?: string | number | bigint;
}

export interface CorrectLocalSupplierArrivalPayload {
  reason: string;
  local_supplier_id?: string | number | bigint;
  rmr_number?: string;
  vehicle_number?: string;
  arrival_timestamp?: string | Date;
  phe_latitude?: number | null;
  phe_longitude?: number | null;
  phe_gps_accuracy?: number | null;
}

export interface RecordGateExitPayload {
  exit_timestamp: string | Date;
  client_event_id?: string;
  exit_client_event_id?: string;
}

export interface CorrectGateExitPayload {
  exit_timestamp: string | Date;
  reason?: string;
  supervisor_reason?: string;
}

export async function resolveZmccArrivalAuth(
  reqOrUser?: Request | User,
  action: ZmccArrivalAction = 'READ_ARRIVAL'
): Promise<{ auth?: ZmccArrivalAuthContext; errorResponse?: { error: string; status: number } }> {
  let authUser: User | null = null;
  if (reqOrUser && 'role' in reqOrUser && 'id' in reqOrUser) {
    authUser = reqOrUser as User;
  } else {
    authUser = await getCurrentUser(reqOrUser as Request);
  }

  if (!authUser) {
    return { errorResponse: { error: 'Unauthorized. Authentication required.', status: 401 } };
  }

  let actorUserId: bigint;
  try {
    actorUserId = BigInt(String(authUser.id).trim());
  } catch {
    return { errorResponse: { error: 'Unauthorized. Invalid user ID format.', status: 401 } };
  }

  const dbUser = await prisma.user.findUnique({
    where: { id: actorUserId },
    include: {
      procurement_source: true,
    },
  });

  if (!dbUser || !dbUser.is_active) {
    return { errorResponse: { error: 'Unauthorized. Account is inactive or unverified.', status: 403 } };
  }

  const role = dbUser.role as Role;
  const isSuperAdmin = role === 'SUPER_ADMIN';
  const isZmccManager = role === 'ZMCC_MANAGER';
  const isPheOperator = role === 'PHE_OPERATOR';

  if (action === 'SUBMIT_ARRIVAL') {
    if (!isPheOperator && !isSuperAdmin) {
      return {
        errorResponse: {
          error: 'Forbidden. Only PHE Operators or Super Admins may record arrivals.',
          status: 403,
        },
      };
    }
  } else if (action === 'CORRECT_ARRIVAL') {
    if (!isZmccManager && !isSuperAdmin) {
      return {
        errorResponse: {
          error: 'Forbidden. Only ZMCC Managers or Super Admins may correct arrival records.',
          status: 403,
        },
      };
    }
  } else if (action === 'READ_ARRIVAL') {
    if (!isSuperAdmin && !isZmccManager && !isPheOperator) {
      return {
        errorResponse: {
          error: 'Forbidden. You do not have permission to view ZMCC arrivals.',
          status: 403,
        },
      };
    }
  } else if (action === 'RECORD_EXIT') {
    if (!isPheOperator && !isSuperAdmin) {
      return {
        errorResponse: {
          error: 'Forbidden. Only PHE Operators or Super Admins may record gate exit.',
          status: 403,
        },
      };
    }
  } else if (action === 'CORRECT_EXIT') {
    if (!isZmccManager && !isSuperAdmin) {
      return {
        errorResponse: {
          error: 'Forbidden. Only ZMCC Managers or Super Admins may correct gate exit records.',
          status: 403,
        },
      };
    }
  }

  let effectiveZmccId: bigint | null = null;
  if (!isSuperAdmin) {
    if (!dbUser.procurement_source_id || !dbUser.procurement_source) {
      return {
        errorResponse: {
          error: 'Forbidden. Scoped user must be assigned to an active ZMCC procurement source.',
          status: 403,
        },
      };
    }
    if (!dbUser.procurement_source.is_active) {
      return {
        errorResponse: {
          error: 'Forbidden. Assigned procurement source is inactive.',
          status: 403,
        },
      };
    }
    if (dbUser.procurement_source.source_type !== 'ZMCC') {
      return {
        errorResponse: {
          error: 'Forbidden. Assigned procurement source is not a ZMCC.',
          status: 403,
        },
      };
    }
    effectiveZmccId = dbUser.procurement_source_id;
  }

  return {
    auth: {
      user: {
        id: dbUser.id.toString(),
        username: dbUser.username,
        name: dbUser.full_name || dbUser.username,
        role: dbUser.role as Role,
        department: dbUser.department || '',
        scope_type: dbUser.scope_type,
        procurement_source_id: dbUser.procurement_source_id ? dbUser.procurement_source_id.toString() : null,
        procurement_source: dbUser.procurement_source
          ? {
              id: dbUser.procurement_source.id.toString(),
              code: dbUser.procurement_source.code,
              name: dbUser.procurement_source.name,
              source_type: dbUser.procurement_source.source_type,
              is_active: dbUser.procurement_source.is_active,
            }
          : null,
      },
      actorUserId,
      role,
      isSuperAdmin,
      isZmccManager,
      isPheOperator,
      effectiveZmccId,
    },
  };
}

function validateGpsCoords(
  latitude?: number | null,
  longitude?: number | null,
  gpsAccuracy?: number | null
): { lat: number | null; lng: number | null; acc: number | null; error?: string } {
  const hasLat = latitude !== undefined && latitude !== null;
  const hasLng = longitude !== undefined && longitude !== null;
  const hasAcc = gpsAccuracy !== undefined && gpsAccuracy !== null;

  if (!hasLat && !hasLng) {
    if (hasAcc) {
      return { lat: null, lng: null, acc: null, error: 'GPS accuracy cannot be provided without latitude and longitude.' };
    }
    return { lat: null, lng: null, acc: null };
  }

  if (!hasLat || !hasLng) {
    return { lat: null, lng: null, acc: null, error: 'Both latitude and longitude must be provided together.' };
  }

  const lat = Number(latitude);
  const lng = Number(longitude);
  if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180 || (lat === 0 && lng === 0)) {
    return { lat: null, lng: null, acc: null, error: 'Invalid GPS coordinates provided.' };
  }

  let acc: number | null = null;
  if (hasAcc) {
    acc = Number(gpsAccuracy);
    if (isNaN(acc) || acc < 0) {
      return { lat: null, lng: null, acc: null, error: 'GPS accuracy must be a non-negative number.' };
    }
  }

  return { lat, lng, acc };
}

interface MotArrivalReplayComparison {
  journey_id: bigint;
  route_milk_token?: string | null;
  raw_milk_token_number?: string | null;
  arrival_timestamp: Date;
  phe_latitude: number | null;
  phe_longitude: number | null;
  phe_gps_accuracy: number | null;
}

function isExactMotArrivalReplay(
  existing: {
    journey_id: bigint;
    route_milk_token?: string | null;
    raw_milk_token_number?: string | null;
    arrival_timestamp: Date | string;
    phe_latitude: any;
    phe_longitude: any;
    phe_gps_accuracy: any;
  },
  expected: MotArrivalReplayComparison
): boolean {
  if (existing.journey_id !== expected.journey_id) return false;
  if ((existing.route_milk_token || '').trim() !== (expected.route_milk_token || '').trim()) return false;
  if ((existing.raw_milk_token_number || '').trim() !== (expected.raw_milk_token_number || '').trim()) return false;

  const existingTime = new Date(existing.arrival_timestamp).getTime();
  const expectedTime = expected.arrival_timestamp.getTime();
  if (Math.abs(existingTime - expectedTime) >= 1000) return false;

  const existingLat = existing.phe_latitude != null ? Number(existing.phe_latitude) : null;
  const existingLng = existing.phe_longitude != null ? Number(existing.phe_longitude) : null;
  const existingAcc = existing.phe_gps_accuracy != null ? Number(existing.phe_gps_accuracy) : null;

  if (expected.phe_latitude == null) {
    if (existingLat != null) return false;
  } else {
    if (existingLat == null || Math.abs(expected.phe_latitude - existingLat) >= 0.0001) return false;
  }

  if (expected.phe_longitude == null) {
    if (existingLng != null) return false;
  } else {
    if (existingLng == null || Math.abs(expected.phe_longitude - existingLng) >= 0.0001) return false;
  }

  if (expected.phe_gps_accuracy == null) {
    if (existingAcc != null) return false;
  } else {
    if (existingAcc == null || Math.abs(expected.phe_gps_accuracy - existingAcc) >= 0.01) return false;
  }

  return true;
}

interface ContractorArrivalReplayComparison {
  zmcc_id: bigint;
  contractor_source_id: bigint;
  rmr_number: string;
  vehicle_number: string;
  arrival_timestamp: Date;
  phe_latitude: number | null;
  phe_longitude: number | null;
  phe_gps_accuracy: number | null;
}

function isExactContractorArrivalReplay(
  existing: {
    zmcc_id: bigint;
    contractor_source_id: bigint;
    rmr_number: string | null;
    vehicle_number: string;
    arrival_timestamp: Date | string;
    phe_latitude: any;
    phe_longitude: any;
    phe_gps_accuracy: any;
  },
  expected: ContractorArrivalReplayComparison
): boolean {
  if (existing.zmcc_id !== expected.zmcc_id) return false;
  if (existing.contractor_source_id !== expected.contractor_source_id) return false;
  if ((existing.rmr_number || '').trim() !== (expected.rmr_number || '').trim()) return false;
  if (existing.vehicle_number.trim().toUpperCase() !== expected.vehicle_number.trim().toUpperCase()) return false;

  const existingTime = new Date(existing.arrival_timestamp).getTime();
  const expectedTime = expected.arrival_timestamp.getTime();
  if (Math.abs(existingTime - expectedTime) >= 1000) return false;

  const existingLat = existing.phe_latitude != null ? Number(existing.phe_latitude) : null;
  const existingLng = existing.phe_longitude != null ? Number(existing.phe_longitude) : null;
  const existingAcc = existing.phe_gps_accuracy != null ? Number(existing.phe_gps_accuracy) : null;

  if (expected.phe_latitude == null) {
    if (existingLat != null) return false;
  } else {
    if (existingLat == null || Math.abs(expected.phe_latitude - existingLat) >= 0.0001) return false;
  }

  if (expected.phe_longitude == null) {
    if (existingLng != null) return false;
  } else {
    if (existingLng == null || Math.abs(expected.phe_longitude - existingLng) >= 0.0001) return false;
  }

  if (expected.phe_gps_accuracy == null) {
    if (existingAcc != null) return false;
  } else {
    if (existingAcc == null || Math.abs(expected.phe_gps_accuracy - existingAcc) >= 0.01) return false;
  }

  return true;
}

interface LocalSupplierArrivalReplayComparison {
  zmcc_id: bigint;
  local_supplier_id: bigint;
  rmr_number: string;
  vehicle_number: string;
  arrival_timestamp: Date;
  phe_latitude: number | null;
  phe_longitude: number | null;
  phe_gps_accuracy: number | null;
}

function isExactLocalSupplierArrivalReplay(
  existing: {
    zmcc_id: bigint;
    local_supplier_id: bigint;
    rmr_number: string | null;
    vehicle_number: string;
    arrival_timestamp: Date | string;
    phe_latitude: any;
    phe_longitude: any;
    phe_gps_accuracy: any;
  },
  expected: LocalSupplierArrivalReplayComparison
): boolean {
  if (existing.zmcc_id !== expected.zmcc_id) return false;
  if (existing.local_supplier_id !== expected.local_supplier_id) return false;
  if ((existing.rmr_number || '').trim() !== (expected.rmr_number || '').trim()) return false;
  if (existing.vehicle_number.trim().toUpperCase() !== expected.vehicle_number.trim().toUpperCase()) return false;

  const existingTime = new Date(existing.arrival_timestamp).getTime();
  const expectedTime = expected.arrival_timestamp.getTime();
  if (Math.abs(existingTime - expectedTime) >= 1000) return false;

  const existingLat = existing.phe_latitude != null ? Number(existing.phe_latitude) : null;
  const existingLng = existing.phe_longitude != null ? Number(existing.phe_longitude) : null;
  const existingAcc = existing.phe_gps_accuracy != null ? Number(existing.phe_gps_accuracy) : null;

  if (expected.phe_latitude == null) {
    if (existingLat != null) return false;
  } else {
    if (existingLat == null || Math.abs(expected.phe_latitude - existingLat) >= 0.0001) return false;
  }

  if (expected.phe_longitude == null) {
    if (existingLng != null) return false;
  } else {
    if (existingLng == null || Math.abs(expected.phe_longitude - existingLng) >= 0.0001) return false;
  }

  if (expected.phe_gps_accuracy == null) {
    if (existingAcc != null) return false;
  } else {
    if (existingAcc == null || Math.abs(expected.phe_gps_accuracy - existingAcc) >= 0.01) return false;
  }

  return true;
}

function validateRmrNumber(
  rawRmr: unknown,
  fieldRequired: boolean = true
): { value: string | null; error?: string } {
  if (rawRmr === undefined) {
    if (fieldRequired) {
      return { value: null, error: 'rmr_number is required.' };
    }
    return { value: null };
  }
  if (rawRmr === null) {
    return { value: null, error: fieldRequired ? 'rmr_number is required.' : 'rmr_number cannot be blank.' };
  }
  if (typeof rawRmr !== 'string') {
    return { value: null, error: 'rmr_number must be a string.' };
  }
  const trimmed = rawRmr.trim();
  if (!trimmed) {
    return { value: null, error: fieldRequired ? 'rmr_number is required.' : 'rmr_number cannot be blank.' };
  }
  if (!/^[0-9]+$/.test(trimmed)) {
    return { value: null, error: 'rmr_number must contain digits only.' };
  }
  if (trimmed.length > 100) {
    return { value: null, error: 'rmr_number cannot exceed 100 characters.' };
  }
  return { value: trimmed };
}

export function serializeMotArrival(arrival: any) {
  return {
    id: arrival.id.toString(),
    journey_id: arrival.journey_id.toString(),
    zmcc_id: arrival.zmcc_id.toString(),
    route_milk_token: arrival.route_milk_token,
    raw_milk_token_number: arrival.raw_milk_token_number || null,
    zmcc_token: arrival.zmcc_token,
    arrival_timestamp: arrival.arrival_timestamp instanceof Date ? arrival.arrival_timestamp.toISOString() : arrival.arrival_timestamp,
    arrival_date: arrival.arrival_date instanceof Date ? arrival.arrival_date.toISOString().split('T')[0] : arrival.arrival_date,
    phe_latitude: arrival.phe_latitude != null ? Number(arrival.phe_latitude) : null,
    phe_longitude: arrival.phe_longitude != null ? Number(arrival.phe_longitude) : null,
    phe_gps_accuracy: arrival.phe_gps_accuracy != null ? Number(arrival.phe_gps_accuracy) : null,
    client_event_id: arrival.client_event_id,
    recorded_by_user_id: arrival.recorded_by_user_id.toString(),
    recorded_by: arrival.recorded_by
      ? {
          id: arrival.recorded_by.id.toString(),
          username: arrival.recorded_by.username,
          full_name: arrival.recorded_by.full_name,
        }
      : undefined,
    submitted_at: arrival.submitted_at instanceof Date ? arrival.submitted_at.toISOString() : arrival.submitted_at,
    correction_count: arrival.correction_count,
    gate_exit_required: Boolean(arrival.gate_exit_required),
    exit_timestamp: arrival.exit_timestamp instanceof Date ? arrival.exit_timestamp.toISOString() : (arrival.exit_timestamp ?? null),
    exit_recorded_by_user_id: arrival.exit_recorded_by_user_id ? arrival.exit_recorded_by_user_id.toString() : null,
    exit_recorded_by: arrival.exit_recorded_by
      ? {
          id: arrival.exit_recorded_by.id.toString(),
          username: arrival.exit_recorded_by.username,
          full_name: arrival.exit_recorded_by.full_name,
        }
      : (arrival.exit_recorded_by_user_id ? undefined : null),
    exit_client_event_id: arrival.exit_client_event_id ?? null,
    exit_submitted_at: arrival.exit_submitted_at instanceof Date ? arrival.exit_submitted_at.toISOString() : (arrival.exit_submitted_at ?? null),
    exit_correction_count: arrival.exit_correction_count ?? 0,
    created_at: arrival.created_at instanceof Date ? arrival.created_at.toISOString() : arrival.created_at,
    updated_at: arrival.updated_at instanceof Date ? arrival.updated_at.toISOString() : arrival.updated_at,
    journey: arrival.journey
      ? {
          id: arrival.journey.id.toString(),
          journey_number: arrival.journey.journey_number,
          status: arrival.journey.status,
          route_code: arrival.journey.route?.route_code,
          route_name: arrival.journey.route?.name,
          vehicle_number: arrival.journey.mot_vehicle?.vehicle_number,
          mot_name: arrival.journey.mot_profile?.name,
          mot_code: arrival.journey.mot_profile?.mot_code,
          ended_at: arrival.journey.ended_at ? arrival.journey.ended_at.toISOString() : null,
          final_mot_gps: arrival.journey.final_mot_gps_at ? {
            timestamp: arrival.journey.final_mot_gps_at.toISOString(),
            latitude: arrival.journey.final_mot_latitude != null ? Number(arrival.journey.final_mot_latitude) : null,
            longitude: arrival.journey.final_mot_longitude != null ? Number(arrival.journey.final_mot_longitude) : null,
            gps_accuracy: arrival.journey.final_mot_gps_accuracy != null ? Number(arrival.journey.final_mot_gps_accuracy) : null,
          } : null,
          summary: arrival.journey.summary ? serializeMotJourneySummary(arrival.journey.summary) : null,
        }
      : undefined,
    zmcc: arrival.zmcc
      ? {
          id: arrival.zmcc.id.toString(),
          code: arrival.zmcc.code,
          name: arrival.zmcc.name,
        }
      : undefined,
  };
}

export function serializeContractorArrival(arrival: any) {
  return {
    id: arrival.id.toString(),
    zmcc_id: arrival.zmcc_id.toString(),
    contractor_source_id: arrival.contractor_source_id.toString(),
    rmr_number: arrival.rmr_number,
    vehicle_number: arrival.vehicle_number,
    arrival_timestamp: arrival.arrival_timestamp instanceof Date ? arrival.arrival_timestamp.toISOString() : arrival.arrival_timestamp,
    arrival_date: arrival.arrival_date instanceof Date ? arrival.arrival_date.toISOString().split('T')[0] : arrival.arrival_date,
    zmcc_token: arrival.zmcc_token,
    phe_latitude: arrival.phe_latitude != null ? Number(arrival.phe_latitude) : null,
    phe_longitude: arrival.phe_longitude != null ? Number(arrival.phe_longitude) : null,
    phe_gps_accuracy: arrival.phe_gps_accuracy != null ? Number(arrival.phe_gps_accuracy) : null,
    client_event_id: arrival.client_event_id,
    recorded_by_user_id: arrival.recorded_by_user_id.toString(),
    recorded_by: arrival.recorded_by
      ? {
          id: arrival.recorded_by.id.toString(),
          username: arrival.recorded_by.username,
          full_name: arrival.recorded_by.full_name,
        }
      : undefined,
    submitted_at: arrival.submitted_at instanceof Date ? arrival.submitted_at.toISOString() : arrival.submitted_at,
    correction_count: arrival.correction_count,
    created_at: arrival.created_at instanceof Date ? arrival.created_at.toISOString() : arrival.created_at,
    updated_at: arrival.updated_at instanceof Date ? arrival.updated_at.toISOString() : arrival.updated_at,
    contractor_source: arrival.contractor_source
      ? {
          id: arrival.contractor_source.id.toString(),
          code: arrival.contractor_source.code,
          name: arrival.contractor_source.name,
          source_type: arrival.contractor_source.source_type,
        }
      : undefined,
    zmcc: arrival.zmcc
      ? {
          id: arrival.zmcc.id.toString(),
          code: arrival.zmcc.code,
          name: arrival.zmcc.name,
        }
      : undefined,
  };
}

export function serializeLocalSupplierArrival(arrival: any) {
  return {
    id: arrival.id.toString(),
    zmcc_id: arrival.zmcc_id.toString(),
    local_supplier_id: arrival.local_supplier_id.toString(),
    rmr_number: arrival.rmr_number,
    vehicle_number: arrival.vehicle_number,
    arrival_timestamp: arrival.arrival_timestamp instanceof Date ? arrival.arrival_timestamp.toISOString() : arrival.arrival_timestamp,
    arrival_date: arrival.arrival_date instanceof Date ? arrival.arrival_date.toISOString().split('T')[0] : arrival.arrival_date,
    zmcc_token: arrival.zmcc_token,
    phe_latitude: arrival.phe_latitude != null ? Number(arrival.phe_latitude) : null,
    phe_longitude: arrival.phe_longitude != null ? Number(arrival.phe_longitude) : null,
    phe_gps_accuracy: arrival.phe_gps_accuracy != null ? Number(arrival.phe_gps_accuracy) : null,
    client_event_id: arrival.client_event_id,
    recorded_by_user_id: arrival.recorded_by_user_id.toString(),
    recorded_by: arrival.recorded_by
      ? {
          id: arrival.recorded_by.id.toString(),
          username: arrival.recorded_by.username,
          full_name: arrival.recorded_by.full_name,
        }
      : undefined,
    submitted_at: arrival.submitted_at instanceof Date ? arrival.submitted_at.toISOString() : arrival.submitted_at,
    correction_count: arrival.correction_count,
    gate_exit_required: Boolean(arrival.gate_exit_required),
    exit_timestamp: arrival.exit_timestamp instanceof Date ? arrival.exit_timestamp.toISOString() : (arrival.exit_timestamp ?? null),
    exit_recorded_by_user_id: arrival.exit_recorded_by_user_id ? arrival.exit_recorded_by_user_id.toString() : null,
    exit_recorded_by: arrival.exit_recorded_by
      ? {
          id: arrival.exit_recorded_by.id.toString(),
          username: arrival.exit_recorded_by.username,
          full_name: arrival.exit_recorded_by.full_name,
        }
      : (arrival.exit_recorded_by_user_id ? undefined : null),
    exit_client_event_id: arrival.exit_client_event_id ?? null,
    exit_submitted_at: arrival.exit_submitted_at instanceof Date ? arrival.exit_submitted_at.toISOString() : (arrival.exit_submitted_at ?? null),
    exit_correction_count: arrival.exit_correction_count ?? 0,
    created_at: arrival.created_at instanceof Date ? arrival.created_at.toISOString() : arrival.created_at,
    updated_at: arrival.updated_at instanceof Date ? arrival.updated_at.toISOString() : arrival.updated_at,
    local_supplier: arrival.local_supplier
      ? {
          id: arrival.local_supplier.id.toString(),
          local_supplier_code: arrival.local_supplier.local_supplier_code,
          name: arrival.local_supplier.name,
          phone: arrival.local_supplier.phone ?? null,
          cnic: arrival.local_supplier.cnic ?? null,
          erp_reference: arrival.local_supplier.erp_reference ?? null,
          erp_mapping_status: arrival.local_supplier.erp_mapping_status,
          is_active: arrival.local_supplier.is_active,
        }
      : undefined,
    zmcc: arrival.zmcc
      ? {
          id: arrival.zmcc.id.toString(),
          code: arrival.zmcc.code,
          name: arrival.zmcc.name,
        }
      : undefined,
  };
}

export async function submitMotArrival(
  reqOrUser: Request | User,
  payload: SubmitMotArrivalPayload
): Promise<ServiceResult<any>> {
  const { auth, errorResponse } = await resolveZmccArrivalAuth(reqOrUser, 'SUBMIT_ARRIVAL');
  if (errorResponse) return errorResponse;
  if (!auth) return { status: 401, error: 'Unauthorized.' };

  if (!payload || typeof payload !== 'object') {
    return { status: 400, error: 'Missing request payload.' };
  }

  const rawJourneyId = payload.journey_id;
  if (rawJourneyId === undefined || rawJourneyId === null || String(rawJourneyId).trim() === '') {
    return { status: 400, error: 'journey_id is required.' };
  }
  let journeyId: bigint;
  try {
    journeyId = BigInt(String(rawJourneyId).trim());
  } catch {
    return { status: 400, error: 'Invalid journey_id format.' };
  }

  const routeMilkToken = typeof payload.route_milk_token === 'string' && payload.route_milk_token.trim().length > 0
    ? payload.route_milk_token.trim()
    : null;

  const clientEventId = typeof payload.client_event_id === 'string' ? payload.client_event_id.trim() : '';
  if (!clientEventId) {
    return { status: 400, error: 'client_event_id is required.' };
  }

  const arrivalDate = new Date(payload.arrival_timestamp);
  if (isNaN(arrivalDate.getTime())) {
    return { status: 400, error: 'Invalid arrival_timestamp.' };
  }

  const now = new Date();
  if (arrivalDate.getTime() > now.getTime() + 5 * 60 * 1000) {
    return { status: 400, error: 'arrival_timestamp cannot be in the future.' };
  }

  const gpsValidation = validateGpsCoords(payload.phe_latitude, payload.phe_longitude, payload.phe_gps_accuracy);
  if (gpsValidation.error) {
    return { status: 400, error: gpsValidation.error };
  }

  const rawMilkTokenCandidate = payload.raw_milk_token_number !== undefined && payload.raw_milk_token_number !== null
    ? String(payload.raw_milk_token_number).trim()
    : null;

  const expectedMotPayload: MotArrivalReplayComparison = {
    journey_id: journeyId,
    route_milk_token: routeMilkToken,
    raw_milk_token_number: rawMilkTokenCandidate,
    arrival_timestamp: arrivalDate,
    phe_latitude: gpsValidation.lat,
    phe_longitude: gpsValidation.lng,
    phe_gps_accuracy: gpsValidation.acc,
  };

  const existingByEventId = await prisma.zmccMotArrival.findUnique({
    where: { client_event_id: clientEventId },
    include: {
      journey: {
        include: {
          route: true,
          mot_vehicle: true,
          mot_profile: true,
          summary: true,
        },
      },
      zmcc: true,
      recorded_by: true,
    },
  });

  if (existingByEventId) {
    if (isExactMotArrivalReplay(existingByEventId, expectedMotPayload)) {
      return {
        status: 200,
        data: {
          ...serializeMotArrival(existingByEventId),
          is_replay: true,
        },
      };
    } else {
      return {
        status: 409,
        error: 'Conflict: Reused client_event_id with differing payload.',
      };
    }
  }

  const journey = await prisma.motJourney.findUnique({
    where: { id: journeyId },
    include: {
      zmcc: true,
      route: true,
      mot_vehicle: true,
      mot_profile: true,
      mot_arrival: true,
      stops: {
        select: {
          collection: {
            select: { device_collected_at: true },
          },
        },
      },
      locations: {
        select: { device_recorded_at: true },
        orderBy: { device_recorded_at: 'desc' },
        take: 1,
      },
    },
  });

  if (!journey) {
    return { status: 404, error: 'Journey not found.' };
  }

  if (!auth.isSuperAdmin && journey.zmcc_id !== auth.effectiveZmccId!) {
    return { status: 403, error: 'Forbidden. Journey belongs to a different ZMCC.' };
  }

  if (journey.mot_arrival) {
    return {
      status: 409,
      error: `Conflict: Journey ${journey.journey_number} already has an arrival recorded (ZMCC Token: ${journey.mot_arrival.zmcc_token}).`,
    };
  }

  if (journey.status !== 'COLLECTING') {
    return {
      status: 409,
      error: `Conflict: Journey ${journey.journey_number} is in ${journey.status} status and cannot accept arrival. Must be COLLECTING.`,
    };
  }

  if (arrivalDate.getTime() < new Date(journey.started_at).getTime()) {
    return {
      status: 400,
      error: `arrival_timestamp cannot predate journey start time (${journey.started_at.toISOString()}).`,
    };
  }

  for (const stop of journey.stops) {
    if (stop.collection && arrivalDate.getTime() < new Date(stop.collection.device_collected_at).getTime()) {
      return {
        status: 400,
        error: `arrival_timestamp cannot predate collection recorded at ${stop.collection.device_collected_at.toISOString()}.`,
      };
    }
  }

  if (journey.locations.length > 0) {
    const latestLocTime = new Date(journey.locations[0].device_recorded_at).getTime();
    if (arrivalDate.getTime() < latestLocTime) {
      return {
        status: 400,
        error: `arrival_timestamp cannot predate latest GPS point recorded at ${journey.locations[0].device_recorded_at.toISOString()}.`,
      };
    }
  }

  const pktDateStr = getPakistanCalendarDate(arrivalDate);
  const dateCode = pktDateStr.replace(/-/g, '');
  const arrivalDatePkt = new Date(`${pktDateStr}T00:00:00.000Z`);

  let cleanRawMilkToken: string | null = null;
  try {
    cleanRawMilkToken = await PaperReferenceService.validateAndVerify(
      PaperReferenceType.RAW_MILK_TOKEN,
      payload.raw_milk_token_number,
      { scopeEntityId: journey.zmcc_id }
    );
  } catch (err: any) {
    return { status: 400, error: err.message || 'Invalid Raw Milk Token number.' };
  }

  try {
    const createdArrival = await prisma.$transaction(async (tx) => {
      // Concurrency lock: Acquire exclusive row lock on mot_journey
      await tx.$executeRaw`SELECT id FROM mot_journey WHERE id = ${journeyId} FOR UPDATE`;

      const checkJourney = await tx.motJourney.findUnique({
        where: { id: journeyId },
        select: { status: true, mot_arrival: { select: { id: true } } },
      });
      if (!checkJourney || checkJourney.status !== 'COLLECTING' || checkJourney.mot_arrival) {
        throw new Error('JOURNEY_ALREADY_COMPLETED');
      }

      const seqResult = await tx.$queryRaw<{ nextval: bigint }[]>`SELECT nextval('zmcc_token_seq') as nextval`;
      if (!seqResult || seqResult.length === 0 || seqResult[0].nextval === undefined || seqResult[0].nextval === null) {
        throw new Error('FAILED_TO_ALLOCATE_ZMCC_TOKEN_SEQUENCE');
      }
      const seqNum = Number(seqResult[0].nextval);
      const zmccToken = `ZT-MOT-${dateCode}-${String(seqNum).padStart(4, '0')}`;

      const latestDeviceLoc = await tx.motJourneyLocation.findFirst({
        where: {
          journey_id: journey.id,
          source_type: 'MOT_DEVICE',
          device_recorded_at: { lte: arrivalDate },
        },
        orderBy: { device_recorded_at: 'desc' },
      });

      const arrival = await tx.zmccMotArrival.create({
        data: {
          journey_id: journey.id,
          zmcc_id: journey.zmcc_id,
          route_milk_token: routeMilkToken || null,
          raw_milk_token_number: cleanRawMilkToken,
          zmcc_token: zmccToken,
          arrival_timestamp: arrivalDate,
          arrival_date: arrivalDatePkt,
          phe_latitude: gpsValidation.lat != null ? new Prisma.Decimal(gpsValidation.lat.toFixed(7)) : null,
          phe_longitude: gpsValidation.lng != null ? new Prisma.Decimal(gpsValidation.lng.toFixed(7)) : null,
          phe_gps_accuracy: gpsValidation.acc != null ? new Prisma.Decimal(gpsValidation.acc.toFixed(2)) : null,
          client_event_id: clientEventId,
          recorded_by_user_id: auth.actorUserId,
          submitted_at: now,
          correction_count: 0,
        },
        include: {
          journey: {
            include: {
              route: true,
              mot_vehicle: true,
              mot_profile: true,
            },
          },
          zmcc: true,
          recorded_by: true,
        },
      });

      await tx.motJourney.update({
        where: { id: journey.id },
        data: {
          status: 'COMPLETED',
          ended_at: arrivalDate,
          final_mot_gps_at: latestDeviceLoc ? latestDeviceLoc.device_recorded_at : null,
          final_mot_latitude: latestDeviceLoc ? latestDeviceLoc.latitude : null,
          final_mot_longitude: latestDeviceLoc ? latestDeviceLoc.longitude : null,
          final_mot_gps_accuracy: latestDeviceLoc ? latestDeviceLoc.gps_accuracy : null,
        },
      });

      const summary = await createInitialMotJourneySummaryTx(tx, journey.id, arrivalDate, auth.actorUserId);

      await tx.auditLog.create({
        data: {
          table_name: 'zmcc_mot_arrival',
          record_id: arrival.id,
          action: 'ZMCC_MOT_ARRIVAL_SUBMITTED',
          old_values: Prisma.DbNull,
          new_values: {
            journey_id: journey.id.toString(),
            journey_number: journey.journey_number,
            route_milk_token: routeMilkToken || null,
            raw_milk_token_number: cleanRawMilkToken,
            zmcc_token: zmccToken,
            arrival_timestamp: arrivalDate.toISOString(),
            arrival_date: pktDateStr,
            client_event_id: clientEventId,
          },
          user_id: auth.actorUserId,
        },
      });

      await tx.auditLog.create({
        data: {
          table_name: 'mot_journey',
          record_id: journey.id,
          action: 'MOT_JOURNEY_COMPLETED_AT_ZMCC',
          old_values: { status: 'COLLECTING' },
          new_values: {
            journey_number: journey.journey_number,
            status: 'COMPLETED',
            ended_at: arrivalDate.toISOString(),
            zmcc_token: zmccToken,
            arrival_id: arrival.id.toString(),
          },
          user_id: auth.actorUserId,
        },
      });

      return {
        ...arrival,
        journey: {
          ...arrival.journey,
          status: 'COMPLETED',
          ended_at: arrivalDate,
          summary,
        },
      };
    });

    return {
      status: 201,
      data: serializeMotArrival(createdArrival),
    };
  } catch (err: any) {
    if (err.message === 'JOURNEY_ALREADY_COMPLETED' || err.code === 'P2002') {
      const existingAfterCollision = await prisma.zmccMotArrival.findUnique({
        where: { client_event_id: clientEventId },
        include: {
          journey: {
            include: {
              route: true,
              mot_vehicle: true,
              mot_profile: true,
              summary: true,
            },
          },
          zmcc: true,
          recorded_by: true,
        },
      });
      if (existingAfterCollision) {
        if (isExactMotArrivalReplay(existingAfterCollision, expectedMotPayload)) {
          return {
            status: 200,
            data: {
              ...serializeMotArrival(existingAfterCollision),
              is_replay: true,
            },
          };
        } else {
          return {
            status: 409,
            error: 'Conflict: Concurrent arrival submission collision or duplicate client_event_id with differing payload.',
          };
        }
      }
      return {
        status: 409,
        error: 'Conflict: Journey has already been completed or an arrival was recorded concurrently.',
      };
    }
    console.error('submitMotArrival unexpected error:', err);
    return { status: 500, error: 'Internal server error while recording MOT arrival.' };
  }
}

export async function correctMotArrival(
  reqOrUser: Request | User,
  arrivalIdParam: string | number | bigint,
  payload: CorrectMotArrivalPayload
): Promise<ServiceResult<any>> {
  const { auth, errorResponse } = await resolveZmccArrivalAuth(reqOrUser, 'CORRECT_ARRIVAL');
  if (errorResponse) return errorResponse;
  if (!auth) return { status: 401, error: 'Unauthorized.' };

  let arrivalId: bigint;
  try {
    arrivalId = BigInt(String(arrivalIdParam).trim());
  } catch {
    return { status: 400, error: 'Invalid arrival ID format.' };
  }

  if (!payload || typeof payload !== 'object') {
    return { status: 400, error: 'Missing correction payload.' };
  }

  const reason = typeof payload.reason === 'string' ? payload.reason.trim() : '';
  if (!reason) {
    return { status: 400, error: 'reason is mandatory for arrival corrections.' };
  }

  const arrival = await prisma.zmccMotArrival.findUnique({
    where: { id: arrivalId },
    include: {
      journey: {
        include: {
          stops: {
            select: { collection: { select: { device_collected_at: true } } },
          },
          locations: {
            select: { device_recorded_at: true },
            orderBy: { device_recorded_at: 'desc' },
            take: 1,
          },
        },
      },
      zmcc: true,
      recorded_by: true,
      lab_session: {
        select: { completed_at: true },
      },
    },
  });

  if (!arrival) {
    return { status: 404, error: 'MOT Arrival record not found.' };
  }

  if (!auth.isSuperAdmin && arrival.zmcc_id !== auth.effectiveZmccId!) {
    return { status: 403, error: 'Forbidden. Arrival record belongs to another ZMCC.' };
  }

  if (arrival.correction_count >= 2) {
    return {
      status: 400,
      error: 'Maximum number of corrections (2) has been reached for this arrival record.',
    };
  }

  const updateData: Prisma.ZmccMotArrivalUpdateInput = {};

  const oldValues: Record<string, any> = {};
  const newValues: Record<string, any> = {};
  let newArrivalDate: Date | null = null;

  if (payload.route_milk_token !== undefined) {
    const trimmedToken = String(payload.route_milk_token).trim();
    if (!trimmedToken) {
      return { status: 400, error: 'route_milk_token cannot be blank.' };
    }
    if (trimmedToken !== arrival.route_milk_token) {
      oldValues.route_milk_token = arrival.route_milk_token;
      newValues.route_milk_token = trimmedToken;
      updateData.route_milk_token = trimmedToken;
    }
  }

  if (payload.raw_milk_token_number !== undefined) {
    try {
      const cleanRawMilkToken = await PaperReferenceService.validateAndVerify(
        PaperReferenceType.RAW_MILK_TOKEN,
        payload.raw_milk_token_number,
        { excludeEntityId: arrival.id, scopeEntityId: arrival.zmcc_id }
      );
      if (cleanRawMilkToken !== arrival.raw_milk_token_number) {
        oldValues.raw_milk_token_number = arrival.raw_milk_token_number;
        newValues.raw_milk_token_number = cleanRawMilkToken;
        updateData.raw_milk_token_number = cleanRawMilkToken;
      }
    } catch (err: any) {
      return { status: 400, error: err.message || 'Invalid Raw Milk Token number.' };
    }
  }

  if (payload.arrival_timestamp !== undefined) {
    const parsedTime = new Date(payload.arrival_timestamp);
    if (isNaN(parsedTime.getTime())) {
      return { status: 400, error: 'Invalid arrival_timestamp format.' };
    }
    const now = new Date();
    if (parsedTime.getTime() > now.getTime() + 5 * 60 * 1000) {
      return { status: 400, error: 'arrival_timestamp cannot be in the future.' };
    }
    if (parsedTime.getTime() < new Date(arrival.journey.started_at).getTime()) {
      return {
        status: 400,
        error: `arrival_timestamp cannot predate journey start time (${arrival.journey.started_at.toISOString()}).`,
      };
    }
    for (const stop of arrival.journey.stops) {
      if (stop.collection && parsedTime.getTime() < new Date(stop.collection.device_collected_at).getTime()) {
        return {
          status: 400,
          error: `arrival_timestamp cannot predate collection recorded at ${stop.collection.device_collected_at.toISOString()}.`,
        };
      }
    }
    if (arrival.journey.locations.length > 0) {
      const latestLocTime = new Date(arrival.journey.locations[0].device_recorded_at).getTime();
      if (parsedTime.getTime() < latestLocTime) {
        return {
          status: 400,
          error: `arrival_timestamp cannot predate latest GPS point recorded at ${arrival.journey.locations[0].device_recorded_at.toISOString()}.`,
        };
      }
    }

    if (arrival.exit_timestamp && parsedTime.getTime() > new Date(arrival.exit_timestamp).getTime()) {
      return {
        status: 400,
        error: `arrival_timestamp cannot be after exit_timestamp (${arrival.exit_timestamp.toISOString()}).`,
      };
    }
    if (arrival.lab_session?.completed_at && parsedTime.getTime() > new Date(arrival.lab_session.completed_at).getTime()) {
      return {
        status: 400,
        error: `arrival_timestamp cannot be after lab completion timestamp (${arrival.lab_session.completed_at.toISOString()}).`,
      };
    }

    if (parsedTime.getTime() !== arrival.arrival_timestamp.getTime()) {
      oldValues.arrival_timestamp = arrival.arrival_timestamp.toISOString();
      newValues.arrival_timestamp = parsedTime.toISOString();
      updateData.arrival_timestamp = parsedTime;
      newArrivalDate = parsedTime;

      const pktDateStr = getPakistanCalendarDate(parsedTime);
      updateData.arrival_date = new Date(`${pktDateStr}T00:00:00.000Z`);
    }
  }

  if (payload.phe_latitude !== undefined || payload.phe_longitude !== undefined) {
    const gpsValidation = validateGpsCoords(payload.phe_latitude, payload.phe_longitude, payload.phe_gps_accuracy);
    if (gpsValidation.error) {
      return { status: 400, error: gpsValidation.error };
    }
    oldValues.phe_latitude = arrival.phe_latitude != null ? Number(arrival.phe_latitude) : null;
    oldValues.phe_longitude = arrival.phe_longitude != null ? Number(arrival.phe_longitude) : null;
    oldValues.phe_gps_accuracy = arrival.phe_gps_accuracy != null ? Number(arrival.phe_gps_accuracy) : null;

    newValues.phe_latitude = gpsValidation.lat;
    newValues.phe_longitude = gpsValidation.lng;
    newValues.phe_gps_accuracy = gpsValidation.acc;

    updateData.phe_latitude = gpsValidation.lat != null ? new Prisma.Decimal(gpsValidation.lat.toFixed(7)) : null;
    updateData.phe_longitude = gpsValidation.lng != null ? new Prisma.Decimal(gpsValidation.lng.toFixed(7)) : null;
    updateData.phe_gps_accuracy = gpsValidation.acc != null ? new Prisma.Decimal(gpsValidation.acc.toFixed(2)) : null;
  }

  if (Object.keys(newValues).length === 0) {
    return { status: 400, error: 'No values were modified in this correction request.' };
  }

  try {
    const updated = await prisma.$transaction(async (tx) => {
      // Concurrency safety: acquire row-level lock on the arrival record
      const lockedRows = await tx.$queryRaw<{ id: bigint; correction_count: number }[]>`
        SELECT id, correction_count FROM zmcc_mot_arrival WHERE id = ${arrivalId} FOR UPDATE
      `;
      if (!lockedRows || lockedRows.length === 0) {
        throw new Error('ARRIVAL_NOT_FOUND');
      }
      const currentCount = lockedRows[0].correction_count;
      if (currentCount >= 2) {
        throw new Error('MAX_CORRECTIONS_REACHED');
      }

      const nextCorrectionCount = currentCount + 1;
      const updatedRecord = await tx.zmccMotArrival.update({
        where: { id: arrivalId },
        data: {
          ...updateData,
          correction_count: nextCorrectionCount,
        },
        include: {
          journey: {
            include: {
              route: true,
              mot_vehicle: true,
              mot_profile: true,
            },
          },
          zmcc: true,
          recorded_by: true,
        },
      });

      if (newArrivalDate) {
        const latestDeviceLoc = await tx.motJourneyLocation.findFirst({
          where: {
            journey_id: arrival.journey_id,
            source_type: 'MOT_DEVICE',
            device_recorded_at: { lte: newArrivalDate },
          },
          orderBy: { device_recorded_at: 'desc' },
        });

        await tx.motJourney.update({
          where: { id: arrival.journey_id },
          data: {
            ended_at: newArrivalDate,
            final_mot_gps_at: latestDeviceLoc ? latestDeviceLoc.device_recorded_at : null,
            final_mot_latitude: latestDeviceLoc ? latestDeviceLoc.latitude : null,
            final_mot_longitude: latestDeviceLoc ? latestDeviceLoc.longitude : null,
            final_mot_gps_accuracy: latestDeviceLoc ? latestDeviceLoc.gps_accuracy : null,
          },
        });
      }

      if (oldValues.raw_milk_token_number !== undefined) {
        await tx.auditLog.create({
          data: {
            table_name: 'zmcc_mot_arrival',
            record_id: arrivalId,
            action: 'PHE_RAW_MILK_TOKEN_CORRECTED',
            old_values: { raw_milk_token_number: oldValues.raw_milk_token_number },
            new_values: { raw_milk_token_number: newValues.raw_milk_token_number, reason },
            user_id: auth.actorUserId,
          },
        });
      }

      await tx.auditLog.create({
        data: {
          table_name: 'zmcc_mot_arrival',
          record_id: arrivalId,
          action: 'ZMCC_MOT_ARRIVAL_CORRECTED',
          old_values: oldValues,
          new_values: {
            ...newValues,
            correction_reason: reason,
            correction_count: nextCorrectionCount,
          },
          user_id: auth.actorUserId,
        },
      });

      return updatedRecord;
    });

    return {
      status: 200,
      data: serializeMotArrival(updated),
    };
  } catch (err: any) {
    if (err.message === 'MAX_CORRECTIONS_REACHED') {
      return {
        status: 409,
        error: 'Conflict: Maximum number of corrections (2) has been reached or another correction was committed concurrently.',
      };
    }
    if (err.message === 'ARRIVAL_NOT_FOUND') {
      return { status: 404, error: 'MOT Arrival record not found.' };
    }
    console.error('correctMotArrival error:', err);
    return { status: 500, error: 'Internal server error while correcting MOT arrival.' };
  }
}

export async function submitContractorArrival(
  _reqOrUser?: Request | User,
  _payload?: SubmitContractorArrivalPayload
): Promise<ServiceResult<any>> {
  return {
    status: 410,
    error: 'CONTRACTOR_ARRIVAL_RETIRED',
    message: 'ZMCC Contractor Arrival is retired for new intake. Record direct-to-ZMCC suppliers through Local Supplier Arrival.',
  };
}

export async function correctContractorArrival(
  reqOrUser: Request | User,
  arrivalIdParam: string | number | bigint,
  payload: CorrectContractorArrivalPayload
): Promise<ServiceResult<any>> {
  const { auth, errorResponse } = await resolveZmccArrivalAuth(reqOrUser, 'CORRECT_ARRIVAL');
  if (errorResponse) return errorResponse;
  if (!auth) return { status: 401, error: 'Unauthorized.' };

  let arrivalId: bigint;
  try {
    arrivalId = BigInt(String(arrivalIdParam).trim());
  } catch {
    return { status: 400, error: 'Invalid arrival ID format.' };
  }

  if (!payload || typeof payload !== 'object') {
    return { status: 400, error: 'Missing correction payload.' };
  }

  const reason = typeof payload.reason === 'string' ? payload.reason.trim() : '';
  if (!reason) {
    return { status: 400, error: 'reason is mandatory for arrival corrections.' };
  }

  const arrival = await prisma.zmccContractorArrival.findUnique({
    where: { id: arrivalId },
    include: {
      contractor_source: true,
      zmcc: true,
      recorded_by: true,
    },
  });

  if (!arrival) {
    return { status: 404, error: 'Contractor Arrival record not found.' };
  }

  if (!auth.isSuperAdmin && arrival.zmcc_id !== auth.effectiveZmccId!) {
    return { status: 403, error: 'Forbidden. Arrival record belongs to another ZMCC.' };
  }

  if (arrival.correction_count >= 2) {
    return {
      status: 400,
      error: 'Maximum number of corrections (2) has been reached for this arrival record.',
    };
  }

  const updateData: Prisma.ZmccContractorArrivalUpdateInput = {};

  const oldValues: Record<string, any> = {};
  const newValues: Record<string, any> = {};

  if (payload.rmr_number !== undefined) {
    const rmrValidation = validateRmrNumber(payload.rmr_number, false);
    if (rmrValidation.error) {
      return { status: 400, error: rmrValidation.error };
    }
    const trimmedRmr = rmrValidation.value!;
    if (trimmedRmr !== arrival.rmr_number) {
      oldValues.rmr_number = arrival.rmr_number;
      newValues.rmr_number = trimmedRmr;
      updateData.rmr_number = trimmedRmr;
    }
  }

  if (payload.vehicle_number !== undefined) {
    const trimmedVeh = String(payload.vehicle_number).trim().toUpperCase();
    if (!trimmedVeh) {
      return { status: 400, error: 'vehicle_number cannot be blank.' };
    }
    if (trimmedVeh !== arrival.vehicle_number) {
      oldValues.vehicle_number = arrival.vehicle_number;
      newValues.vehicle_number = trimmedVeh;
      updateData.vehicle_number = trimmedVeh;
    }
  }

  if (payload.arrival_timestamp !== undefined) {
    const parsedTime = new Date(payload.arrival_timestamp);
    if (isNaN(parsedTime.getTime())) {
      return { status: 400, error: 'Invalid arrival_timestamp format.' };
    }
    const now = new Date();
    if (parsedTime.getTime() > now.getTime() + 5 * 60 * 1000) {
      return { status: 400, error: 'arrival_timestamp cannot be in the future.' };
    }
    if (parsedTime.getTime() !== arrival.arrival_timestamp.getTime()) {
      oldValues.arrival_timestamp = arrival.arrival_timestamp.toISOString();
      newValues.arrival_timestamp = parsedTime.toISOString();
      updateData.arrival_timestamp = parsedTime;

      const pktDateStr = getPakistanCalendarDate(parsedTime);
      updateData.arrival_date = new Date(`${pktDateStr}T00:00:00.000Z`);
    }
  }

  if (payload.phe_latitude !== undefined || payload.phe_longitude !== undefined) {
    const gpsValidation = validateGpsCoords(payload.phe_latitude, payload.phe_longitude, payload.phe_gps_accuracy);
    if (gpsValidation.error) {
      return { status: 400, error: gpsValidation.error };
    }
    oldValues.phe_latitude = arrival.phe_latitude != null ? Number(arrival.phe_latitude) : null;
    oldValues.phe_longitude = arrival.phe_longitude != null ? Number(arrival.phe_longitude) : null;
    oldValues.phe_gps_accuracy = arrival.phe_gps_accuracy != null ? Number(arrival.phe_gps_accuracy) : null;

    newValues.phe_latitude = gpsValidation.lat;
    newValues.phe_longitude = gpsValidation.lng;
    newValues.phe_gps_accuracy = gpsValidation.acc;

    updateData.phe_latitude = gpsValidation.lat != null ? new Prisma.Decimal(gpsValidation.lat.toFixed(7)) : null;
    updateData.phe_longitude = gpsValidation.lng != null ? new Prisma.Decimal(gpsValidation.lng.toFixed(7)) : null;
    updateData.phe_gps_accuracy = gpsValidation.acc != null ? new Prisma.Decimal(gpsValidation.acc.toFixed(2)) : null;
  }

  if (Object.keys(newValues).length === 0) {
    return { status: 400, error: 'No values were modified in this correction request.' };
  }

  try {
    const updated = await prisma.$transaction(async (tx) => {
      // Concurrency safety: acquire row-level lock on the arrival record
      const lockedRows = await tx.$queryRaw<{ id: bigint; correction_count: number }[]>`
        SELECT id, correction_count FROM zmcc_contractor_arrival WHERE id = ${arrivalId} FOR UPDATE
      `;
      if (!lockedRows || lockedRows.length === 0) {
        throw new Error('ARRIVAL_NOT_FOUND');
      }
      const currentCount = lockedRows[0].correction_count;
      if (currentCount >= 2) {
        throw new Error('MAX_CORRECTIONS_REACHED');
      }

      const nextCorrectionCount = currentCount + 1;
      const updatedRecord = await tx.zmccContractorArrival.update({
        where: { id: arrivalId },
        data: {
          ...updateData,
          correction_count: nextCorrectionCount,
        },
        include: {
          contractor_source: true,
          zmcc: true,
          recorded_by: true,
        },
      });

      await tx.auditLog.create({
        data: {
          table_name: 'zmcc_contractor_arrival',
          record_id: arrivalId,
          action: 'ZMCC_CONTRACTOR_ARRIVAL_CORRECTED',
          old_values: oldValues,
          new_values: {
            ...newValues,
            correction_reason: reason,
            correction_count: nextCorrectionCount,
          },
          user_id: auth.actorUserId,
        },
      });

      return updatedRecord;
    });

    return {
      status: 200,
      data: serializeContractorArrival(updated),
    };
  } catch (err: any) {
    if (err.message === 'MAX_CORRECTIONS_REACHED') {
      return {
        status: 409,
        error: 'Conflict: Maximum number of corrections (2) has been reached or another correction was committed concurrently.',
      };
    }
    if (err.message === 'ARRIVAL_NOT_FOUND') {
      return { status: 404, error: 'Contractor Arrival record not found.' };
    }
    console.error('correctContractorArrival error:', err);
    return { status: 500, error: 'Internal server error while correcting contractor arrival.' };
  }
}

export async function listMotArrivals(
  reqOrUser: Request | User,
  filters: {
    date?: string;
    journey_id?: string | number | bigint;
    search?: string;
    page?: number;
    pageSize?: number;
  } = {}
): Promise<ServiceResult<any>> {
  const { auth, errorResponse } = await resolveZmccArrivalAuth(reqOrUser, 'READ_ARRIVAL');
  if (errorResponse) return errorResponse;
  if (!auth) return { status: 401, error: 'Unauthorized.' };

  const where: Prisma.ZmccMotArrivalWhereInput = {};

  if (!auth.isSuperAdmin) {
    where.zmcc_id = auth.effectiveZmccId!;
  }

  if (filters.journey_id) {
    try {
      where.journey_id = BigInt(String(filters.journey_id).trim());
    } catch {
      return { status: 400, error: 'Invalid journey_id filter format.' };
    }
  }

  if (filters.date) {
    const dateStr = filters.date.trim();
    where.arrival_date = new Date(`${dateStr}T00:00:00.000Z`);
  }

  if (filters.search && filters.search.trim()) {
    const term = filters.search.trim();
    where.OR = [
      { route_milk_token: { contains: term, mode: 'insensitive' } },
      { raw_milk_token_number: { contains: term, mode: 'insensitive' } },
      { zmcc_token: { contains: term, mode: 'insensitive' } },
      { journey: { journey_number: { contains: term, mode: 'insensitive' } } },
      { journey: { mot_vehicle: { vehicle_number: { contains: term, mode: 'insensitive' } } } },
      { journey: { mot_profile: { name: { contains: term, mode: 'insensitive' } } } },
    ];
  }

  const page = Math.max(1, Number(filters.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(filters.pageSize) || 50));
  const skip = (page - 1) * pageSize;

  const [total, items] = await Promise.all([
    prisma.zmccMotArrival.count({ where }),
    prisma.zmccMotArrival.findMany({
      where,
      include: {
        journey: {
          include: {
            route: true,
            mot_vehicle: true,
            mot_profile: true,
            summary: true,
          },
        },
        zmcc: true,
        recorded_by: true,
      },
      orderBy: { arrival_timestamp: 'desc' },
      skip,
      take: pageSize,
    }),
  ]);

  return {
    status: 200,
    data: {
      items: items.map(serializeMotArrival),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    },
  };
}

export async function getMotArrivalById(
  reqOrUser: Request | User,
  arrivalIdParam: string | number | bigint
): Promise<ServiceResult<any>> {
  const { auth, errorResponse } = await resolveZmccArrivalAuth(reqOrUser, 'READ_ARRIVAL');
  if (errorResponse) return errorResponse;
  if (!auth) return { status: 401, error: 'Unauthorized.' };

  let arrivalId: bigint;
  try {
    arrivalId = BigInt(String(arrivalIdParam).trim());
  } catch {
    return { status: 400, error: 'Invalid arrival ID format.' };
  }

  const arrival = await prisma.zmccMotArrival.findUnique({
    where: { id: arrivalId },
    include: {
      journey: {
        include: {
          route: true,
          mot_vehicle: true,
          mot_profile: true,
          summary: true,
        },
      },
      zmcc: true,
      recorded_by: true,
    },
  });

  if (!arrival) {
    return { status: 404, error: 'MOT Arrival not found.' };
  }

  if (!auth.isSuperAdmin && arrival.zmcc_id !== auth.effectiveZmccId!) {
    return { status: 403, error: 'Forbidden. Arrival record belongs to another ZMCC.' };
  }

  return {
    status: 200,
    data: serializeMotArrival(arrival),
  };
}

export async function listContractorArrivals(
  reqOrUser: Request | User,
  filters: {
    date?: string;
    contractor_source_id?: string | number | bigint;
    vehicle_number?: string;
    search?: string;
    page?: number;
    pageSize?: number;
  } = {}
): Promise<ServiceResult<any>> {
  const { auth, errorResponse } = await resolveZmccArrivalAuth(reqOrUser, 'READ_ARRIVAL');
  if (errorResponse) return errorResponse;
  if (!auth) return { status: 401, error: 'Unauthorized.' };

  const where: Prisma.ZmccContractorArrivalWhereInput = {};

  if (!auth.isSuperAdmin) {
    where.zmcc_id = auth.effectiveZmccId!;
  }

  if (filters.contractor_source_id) {
    try {
      where.contractor_source_id = BigInt(String(filters.contractor_source_id).trim());
    } catch {
      return { status: 400, error: 'Invalid contractor_source_id format.' };
    }
  }

  if (filters.vehicle_number && filters.vehicle_number.trim()) {
    where.vehicle_number = { contains: filters.vehicle_number.trim(), mode: 'insensitive' };
  }

  if (filters.date) {
    const dateStr = filters.date.trim();
    where.arrival_date = new Date(`${dateStr}T00:00:00.000Z`);
  }

  if (filters.search && filters.search.trim()) {
    const term = filters.search.trim();
    where.OR = [
      { zmcc_token: { contains: term, mode: 'insensitive' } },
      { rmr_number: { contains: term, mode: 'insensitive' } },
      { vehicle_number: { contains: term, mode: 'insensitive' } },
      { contractor_source: { name: { contains: term, mode: 'insensitive' } } },
      { contractor_source: { code: { contains: term, mode: 'insensitive' } } },
    ];
  }

  const page = Math.max(1, Number(filters.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(filters.pageSize) || 50));
  const skip = (page - 1) * pageSize;

  const [total, items] = await Promise.all([
    prisma.zmccContractorArrival.count({ where }),
    prisma.zmccContractorArrival.findMany({
      where,
      include: {
        contractor_source: true,
        zmcc: true,
        recorded_by: true,
      },
      orderBy: { arrival_timestamp: 'desc' },
      skip,
      take: pageSize,
    }),
  ]);

  return {
    status: 200,
    data: {
      items: items.map(serializeContractorArrival),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    },
  };
}

export async function getContractorArrivalById(
  reqOrUser: Request | User,
  arrivalIdParam: string | number | bigint
): Promise<ServiceResult<any>> {
  const { auth, errorResponse } = await resolveZmccArrivalAuth(reqOrUser, 'READ_ARRIVAL');
  if (errorResponse) return errorResponse;
  if (!auth) return { status: 401, error: 'Unauthorized.' };

  let arrivalId: bigint;
  try {
    arrivalId = BigInt(String(arrivalIdParam).trim());
  } catch {
    return { status: 400, error: 'Invalid arrival ID format.' };
  }

  const arrival = await prisma.zmccContractorArrival.findUnique({
    where: { id: arrivalId },
    include: {
      contractor_source: true,
      zmcc: true,
      recorded_by: true,
    },
  });

  if (!arrival) {
    return { status: 404, error: 'Contractor Arrival not found.' };
  }

  if (!auth.isSuperAdmin && arrival.zmcc_id !== auth.effectiveZmccId!) {
    return { status: 403, error: 'Forbidden. Arrival record belongs to another ZMCC.' };
  }

  return {
    status: 200,
    data: serializeContractorArrival(arrival),
  };
}

export async function getActiveContractors(
  reqOrUser: Request | User
): Promise<ServiceResult<any>> {
  const { auth, errorResponse } = await resolveZmccArrivalAuth(reqOrUser, 'READ_ARRIVAL');
  if (errorResponse) return errorResponse;
  if (!auth) return { status: 401, error: 'Unauthorized.' };

  const contractors = await prisma.procurementSource.findMany({
    where: {
      source_type: 'CONTRACTOR',
      is_active: true,
    },
    orderBy: { name: 'asc' },
    select: {
      id: true,
      code: true,
      name: true,
      source_type: true,
      is_active: true,
    },
  });

  return {
    status: 200,
    data: contractors.map((c) => ({
      id: c.id.toString(),
      code: c.code,
      name: c.name,
      source_type: c.source_type,
      is_active: c.is_active,
    })),
  };
}

export async function getArrivingMotJourneys(
  reqOrUser: Request | User
): Promise<ServiceResult<any>> {
  const { auth, errorResponse } = await resolveZmccArrivalAuth(reqOrUser, 'READ_ARRIVAL');
  if (errorResponse) return errorResponse;
  if (!auth) return { status: 401, error: 'Unauthorized.' };

  const where: Prisma.MotJourneyWhereInput = {
    status: 'COLLECTING',
    mot_arrival: null,
  };

  if (!auth.isSuperAdmin) {
    where.zmcc_id = auth.effectiveZmccId!;
  }

  const journeys = await prisma.motJourney.findMany({
    where,
    include: {
      route: { select: { id: true, route_code: true, name: true } },
      mot_vehicle: { select: { id: true, vehicle_number: true } },
      mot_profile: { select: { id: true, mot_code: true, name: true, phone_number: true } },
      zmcc: { select: { id: true, code: true, name: true } },
      stops: {
        select: {
          id: true,
          status: true,
          collection: {
            select: {
              gross_liters: true,
              at_13ts_liters: true,
            },
          },
        },
      },
    },
    orderBy: { started_at: 'desc' },
  });

  const serialized = journeys.map((j) => {
    let visitedCount = 0;
    let totalGrossLiters = 0;
    let totalAt13TsLiters = 0;

    for (const s of j.stops) {
      if (s.status === 'VISITED') visitedCount++;
      if (s.collection) {
        totalGrossLiters += Number(s.collection.gross_liters);
        totalAt13TsLiters += Number(s.collection.at_13ts_liters);
      }
    }

    return {
      id: j.id.toString(),
      journey_number: j.journey_number,
      operational_date: j.operational_date.toISOString().split('T')[0],
      started_at: j.started_at.toISOString(),
      route: j.route ? { id: j.route.id.toString(), route_code: j.route.route_code, name: j.route.name } : null,
      mot_vehicle: j.mot_vehicle ? { id: j.mot_vehicle.id.toString(), vehicle_number: j.mot_vehicle.vehicle_number } : null,
      mot_profile: j.mot_profile ? { id: j.mot_profile.id.toString(), mot_code: j.mot_profile.mot_code, name: j.mot_profile.name, phone_number: j.mot_profile.phone_number } : null,
      zmcc: j.zmcc ? { id: j.zmcc.id.toString(), code: j.zmcc.code, name: j.zmcc.name } : null,
      total_stops: j.stops.length,
      visited_stops: visitedCount,
      total_gross_liters: Number(totalGrossLiters.toFixed(2)),
      total_at_13ts_liters: Number(totalAt13TsLiters.toFixed(2)),
    };
  });

  return {
    status: 200,
    data: serialized,
  };
}

export async function submitLocalSupplierArrival(
  reqOrUser: Request | User,
  payload: SubmitLocalSupplierArrivalPayload
): Promise<ServiceResult<any>> {
  const { auth, errorResponse } = await resolveZmccArrivalAuth(reqOrUser, 'SUBMIT_ARRIVAL');
  if (errorResponse) return errorResponse;
  if (!auth) return { status: 401, error: 'Unauthorized.' };

  if (!payload || typeof payload !== 'object') {
    return { status: 400, error: 'Missing request payload.' };
  }

  const rawSupplierId = payload.local_supplier_id;
  if (rawSupplierId === undefined || rawSupplierId === null || String(rawSupplierId).trim() === '') {
    return { status: 400, error: 'local_supplier_id is required.' };
  }
  let localSupplierId: bigint;
  try {
    localSupplierId = BigInt(String(rawSupplierId).trim());
  } catch {
    return { status: 400, error: 'Invalid local_supplier_id format.' };
  }

  const rmrValidation = validateRmrNumber(payload.rmr_number, true);
  if (rmrValidation.error) {
    return { status: 400, error: rmrValidation.error };
  }
  const rmrNumber = rmrValidation.value!;

  const vehicleNumber = typeof payload.vehicle_number === 'string' ? payload.vehicle_number.trim().toUpperCase().replace(/\s+/g, ' ') : '';
  if (!vehicleNumber) {
    return { status: 400, error: 'vehicle_number is required.' };
  }

  const clientEventId = typeof payload.client_event_id === 'string' ? payload.client_event_id.trim() : '';
  if (!clientEventId) {
    return { status: 400, error: 'client_event_id is required.' };
  }

  const arrivalDate = payload.arrival_timestamp ? new Date(payload.arrival_timestamp) : new Date();
  if (isNaN(arrivalDate.getTime())) {
    return { status: 400, error: 'Invalid arrival_timestamp.' };
  }

  const now = new Date();
  if (arrivalDate.getTime() > now.getTime() + 5 * 60 * 1000) {
    return { status: 400, error: 'arrival_timestamp cannot be in the future.' };
  }

  const gpsValidation = validateGpsCoords(payload.phe_latitude, payload.phe_longitude, payload.phe_gps_accuracy);
  if (gpsValidation.error) {
    return { status: 400, error: gpsValidation.error };
  }

  let targetZmccId: bigint | null = null;
  const rawTargetZmccId = payload.zmcc_id ?? payload.target_zmcc_id;
  if (auth.isSuperAdmin) {
    if (!rawTargetZmccId || String(rawTargetZmccId).trim() === '') {
      return { status: 400, error: 'target_zmcc_id is required for Super Admin.' };
    }
    try {
      targetZmccId = BigInt(String(rawTargetZmccId).trim());
    } catch {
      return { status: 400, error: 'Invalid target_zmcc_id format.' };
    }
  } else {
    if (rawTargetZmccId !== undefined && rawTargetZmccId !== null && String(rawTargetZmccId).trim() !== '') {
      let passedZmccId: bigint;
      try {
        passedZmccId = BigInt(String(rawTargetZmccId).trim());
      } catch {
        return { status: 400, error: 'Invalid zmcc_id format.' };
      }
      if (passedZmccId !== auth.effectiveZmccId) {
        return { status: 403, error: 'Forbidden. Conflicting zmcc_id supplied.' };
      }
    }
    targetZmccId = auth.effectiveZmccId;
  }

  if (!targetZmccId) {
    return { status: 400, error: 'Target ZMCC could not be resolved.' };
  }

  // Validate target ZMCC exists, is active, and is of type 'ZMCC'
  const targetZmcc = await prisma.procurementSource.findUnique({
    where: { id: targetZmccId },
  });
  if (!targetZmcc) {
    return { status: 404, error: 'Target ZMCC procurement source not found.' };
  }
  if (targetZmcc.source_type !== 'ZMCC') {
    return { status: 400, error: `Target source is not of type ZMCC (found: ${targetZmcc.source_type}).` };
  }
  if (!targetZmcc.is_active) {
    return { status: 400, error: 'Target ZMCC procurement source is inactive.' };
  }

  // Validate Local Supplier exists, is active, and belongs to target ZMCC
  const localSupplier = await prisma.zmccLocalSupplier.findUnique({
    where: { id: localSupplierId },
  });
  if (!localSupplier) {
    return { status: 404, error: 'Local supplier not found.' };
  }
  if (localSupplier.zmcc_id !== targetZmccId) {
    return { status: 400, error: 'Selected local supplier belongs to a different ZMCC.' };
  }
  if (!localSupplier.is_active) {
    return { status: 400, error: 'Selected local supplier is inactive and cannot receive new milk arrivals.' };
  }

  const expectedSupplierPayload: LocalSupplierArrivalReplayComparison = {
    zmcc_id: targetZmccId,
    local_supplier_id: localSupplierId,
    rmr_number: rmrNumber,
    vehicle_number: vehicleNumber,
    arrival_timestamp: arrivalDate,
    phe_latitude: gpsValidation.lat,
    phe_longitude: gpsValidation.lng,
    phe_gps_accuracy: gpsValidation.acc,
  };

  const existingByEventId = await prisma.zmccLocalSupplierArrival.findUnique({
    where: { client_event_id: clientEventId },
    include: {
      local_supplier: true,
      zmcc: true,
      recorded_by: true,
    },
  });

  if (existingByEventId) {
    if (isExactLocalSupplierArrivalReplay(existingByEventId, expectedSupplierPayload)) {
      return {
        status: 200,
        data: {
          ...serializeLocalSupplierArrival(existingByEventId),
          is_replay: true,
        },
      };
    } else {
      return {
        status: 409,
        error: 'Conflict: Reused client_event_id with differing local supplier arrival payload.',
      };
    }
  }

  const pktDateStr = getPakistanCalendarDate(arrivalDate);
  const dateCode = pktDateStr.replace(/-/g, '');
  const arrivalDatePkt = new Date(`${pktDateStr}T00:00:00.000Z`);

  try {
    const createdArrival = await prisma.$transaction(async (tx) => {
      const seqResult = await tx.$queryRaw<{ nextval: bigint }[]>`SELECT nextval('zmcc_token_seq') as nextval`;
      if (!seqResult || seqResult.length === 0 || seqResult[0].nextval === undefined || seqResult[0].nextval === null) {
        throw new Error('FAILED_TO_ALLOCATE_ZMCC_TOKEN_SEQUENCE');
      }
      const seqNum = Number(seqResult[0].nextval);
      const zmccToken = `ZT-LS-${dateCode}-${String(seqNum).padStart(4, '0')}`;

      const arrival = await tx.zmccLocalSupplierArrival.create({
        data: {
          zmcc_id: targetZmccId!,
          local_supplier_id: localSupplierId,
          rmr_number: rmrNumber,
          vehicle_number: vehicleNumber,
          arrival_timestamp: arrivalDate,
          arrival_date: arrivalDatePkt,
          zmcc_token: zmccToken,
          phe_latitude: gpsValidation.lat != null ? new Prisma.Decimal(gpsValidation.lat.toFixed(7)) : null,
          phe_longitude: gpsValidation.lng != null ? new Prisma.Decimal(gpsValidation.lng.toFixed(7)) : null,
          phe_gps_accuracy: gpsValidation.acc != null ? new Prisma.Decimal(gpsValidation.acc.toFixed(2)) : null,
          client_event_id: clientEventId,
          recorded_by_user_id: auth.actorUserId,
          submitted_at: now,
          correction_count: 0,
        },
        include: {
          local_supplier: true,
          zmcc: true,
          recorded_by: true,
        },
      });

      await tx.auditLog.create({
        data: {
          table_name: 'zmcc_local_supplier_arrival',
          record_id: arrival.id,
          action: 'ZMCC_LOCAL_SUPPLIER_ARRIVAL_SUBMITTED',
          old_values: Prisma.DbNull,
          new_values: {
            local_supplier_id: localSupplierId.toString(),
            local_supplier_code: localSupplier.local_supplier_code,
            supplier_name: localSupplier.name,
            rmr_number: rmrNumber,
            vehicle_number: vehicleNumber,
            zmcc_token: zmccToken,
            arrival_timestamp: arrivalDate.toISOString(),
            arrival_date: pktDateStr,
            client_event_id: clientEventId,
          },
          user_id: auth.actorUserId,
        },
      });

      return arrival;
    });

    return {
      status: 201,
      data: serializeLocalSupplierArrival(createdArrival),
    };
  } catch (err: any) {
    if (err.code === 'P2002') {
      const existingAfterCollision = await prisma.zmccLocalSupplierArrival.findUnique({
        where: { client_event_id: clientEventId },
        include: {
          local_supplier: true,
          zmcc: true,
          recorded_by: true,
        },
      });
      if (existingAfterCollision) {
        if (isExactLocalSupplierArrivalReplay(existingAfterCollision, expectedSupplierPayload)) {
          return {
            status: 200,
            data: {
              ...serializeLocalSupplierArrival(existingAfterCollision),
              is_replay: true,
            },
          };
        } else {
          return {
            status: 409,
            error: 'Conflict: Reused client_event_id with differing local supplier arrival payload.',
          };
        }
      }
      return {
        status: 409,
        error: 'Conflict: Duplicate client_event_id collision on local supplier arrival.',
      };
    }
    console.error('submitLocalSupplierArrival error:', err);
    return { status: 500, error: 'Internal server error while recording local supplier arrival.' };
  }
}

export async function correctLocalSupplierArrival(
  reqOrUser: Request | User,
  arrivalIdParam: string | number | bigint,
  payload: CorrectLocalSupplierArrivalPayload
): Promise<ServiceResult<any>> {
  const { auth, errorResponse } = await resolveZmccArrivalAuth(reqOrUser, 'CORRECT_ARRIVAL');
  if (errorResponse) return errorResponse;
  if (!auth) return { status: 401, error: 'Unauthorized.' };

  let arrivalId: bigint;
  try {
    arrivalId = BigInt(String(arrivalIdParam).trim());
  } catch {
    return { status: 400, error: 'Invalid arrival ID format.' };
  }

  if (!payload || typeof payload !== 'object') {
    return { status: 400, error: 'Missing correction payload.' };
  }

  const reason = typeof payload.reason === 'string' ? payload.reason.trim() : '';
  if (!reason || reason.length < 5) {
    return { status: 400, error: 'Correction reason is mandatory and must be at least 5 characters.' };
  }

  const arrival = await prisma.zmccLocalSupplierArrival.findUnique({
    where: { id: arrivalId },
    include: {
      local_supplier: true,
      zmcc: true,
      recorded_by: true,
      lab_session: {
        select: { completed_at: true },
      },
    },
  });

  if (!arrival) {
    return { status: 404, error: 'Local Supplier Arrival record not found.' };
  }

  if (!auth.isSuperAdmin && arrival.zmcc_id !== auth.effectiveZmccId!) {
    return { status: 403, error: 'Forbidden. Arrival record belongs to another ZMCC.' };
  }

  if (arrival.correction_count >= 2) {
    return {
      status: 400,
      error: 'Maximum number of corrections (2) has been reached for this arrival record.',
    };
  }

  const updateData: Prisma.ZmccLocalSupplierArrivalUpdateInput = {};

  const oldValues: Record<string, any> = {};
  const newValues: Record<string, any> = {};

  // Supplier correction: Must exist, be active, and stay in the same ZMCC
  if (payload.local_supplier_id !== undefined) {
    let newSupplierId: bigint;
    try {
      newSupplierId = BigInt(String(payload.local_supplier_id).trim());
    } catch {
      return { status: 400, error: 'Invalid local_supplier_id format.' };
    }
    if (newSupplierId !== arrival.local_supplier_id) {
      const newSupplier = await prisma.zmccLocalSupplier.findUnique({
        where: { id: newSupplierId },
      });
      if (!newSupplier) {
        return { status: 404, error: 'New local supplier not found.' };
      }
      if (newSupplier.zmcc_id !== arrival.zmcc_id) {
        return { status: 400, error: 'Forbidden. Supplier correction must remain in the same ZMCC.' };
      }
      if (!newSupplier.is_active) {
        return { status: 400, error: 'Cannot reassign arrival to an inactive supplier.' };
      }
      oldValues.local_supplier_id = arrival.local_supplier_id.toString();
      newValues.local_supplier_id = newSupplier.id.toString();
      updateData.local_supplier = { connect: { id: newSupplier.id } };
    }
  }

  if (payload.rmr_number !== undefined) {
    const rmrValidation = validateRmrNumber(payload.rmr_number, false);
    if (rmrValidation.error) {
      return { status: 400, error: rmrValidation.error };
    }
    const trimmedRmr = rmrValidation.value!;
    if (trimmedRmr !== arrival.rmr_number) {
      oldValues.rmr_number = arrival.rmr_number;
      newValues.rmr_number = trimmedRmr;
      updateData.rmr_number = trimmedRmr;
    }
  }

  if (payload.vehicle_number !== undefined) {
    const trimmedVeh = String(payload.vehicle_number).trim().toUpperCase().replace(/\s+/g, ' ');
    if (!trimmedVeh) {
      return { status: 400, error: 'vehicle_number cannot be blank.' };
    }
    if (trimmedVeh !== arrival.vehicle_number) {
      oldValues.vehicle_number = arrival.vehicle_number;
      newValues.vehicle_number = trimmedVeh;
      updateData.vehicle_number = trimmedVeh;
    }
  }

  if (payload.arrival_timestamp !== undefined) {
    const parsedTime = new Date(payload.arrival_timestamp);
    if (isNaN(parsedTime.getTime())) {
      return { status: 400, error: 'Invalid arrival_timestamp format.' };
    }
    const now = new Date();
    if (parsedTime.getTime() > now.getTime() + 5 * 60 * 1000) {
      return { status: 400, error: 'arrival_timestamp cannot be in the future.' };
    }
    if (arrival.exit_timestamp && parsedTime.getTime() > new Date(arrival.exit_timestamp).getTime()) {
      return {
        status: 400,
        error: `arrival_timestamp cannot be after exit_timestamp (${arrival.exit_timestamp.toISOString()}).`,
      };
    }
    if (arrival.lab_session?.completed_at && parsedTime.getTime() > new Date(arrival.lab_session.completed_at).getTime()) {
      return {
        status: 400,
        error: `arrival_timestamp cannot be after lab completion timestamp (${arrival.lab_session.completed_at.toISOString()}).`,
      };
    }
    if (parsedTime.getTime() !== arrival.arrival_timestamp.getTime()) {
      oldValues.arrival_timestamp = arrival.arrival_timestamp.toISOString();
      newValues.arrival_timestamp = parsedTime.toISOString();
      updateData.arrival_timestamp = parsedTime;

      const pktDateStr = getPakistanCalendarDate(parsedTime);
      updateData.arrival_date = new Date(`${pktDateStr}T00:00:00.000Z`);
    }
  }

  if (payload.phe_latitude !== undefined || payload.phe_longitude !== undefined) {
    const gpsValidation = validateGpsCoords(payload.phe_latitude, payload.phe_longitude, payload.phe_gps_accuracy);
    if (gpsValidation.error) {
      return { status: 400, error: gpsValidation.error };
    }
    oldValues.phe_latitude = arrival.phe_latitude != null ? Number(arrival.phe_latitude) : null;
    oldValues.phe_longitude = arrival.phe_longitude != null ? Number(arrival.phe_longitude) : null;
    oldValues.phe_gps_accuracy = arrival.phe_gps_accuracy != null ? Number(arrival.phe_gps_accuracy) : null;

    newValues.phe_latitude = gpsValidation.lat;
    newValues.phe_longitude = gpsValidation.lng;
    newValues.phe_gps_accuracy = gpsValidation.acc;

    updateData.phe_latitude = gpsValidation.lat != null ? new Prisma.Decimal(gpsValidation.lat.toFixed(7)) : null;
    updateData.phe_longitude = gpsValidation.lng != null ? new Prisma.Decimal(gpsValidation.lng.toFixed(7)) : null;
    updateData.phe_gps_accuracy = gpsValidation.acc != null ? new Prisma.Decimal(gpsValidation.acc.toFixed(2)) : null;
  }

  if (Object.keys(newValues).length === 0) {
    return { status: 400, error: 'No values were modified in this correction request.' };
  }

  try {
    const updated = await prisma.$transaction(async (tx) => {
      // Concurrency safety: acquire row-level lock on the arrival record
      const lockedRows = await tx.$queryRaw<{ id: bigint; correction_count: number }[]>`
        SELECT id, correction_count FROM zmcc_local_supplier_arrival WHERE id = ${arrivalId} FOR UPDATE
      `;
      if (!lockedRows || lockedRows.length === 0) {
        throw new Error('ARRIVAL_NOT_FOUND');
      }
      const currentCount = lockedRows[0].correction_count;
      if (currentCount >= 2) {
        throw new Error('MAX_CORRECTIONS_REACHED');
      }

      const nextCorrectionCount = currentCount + 1;
      const updatedRecord = await tx.zmccLocalSupplierArrival.update({
        where: { id: arrivalId },
        data: {
          ...updateData,
          correction_count: nextCorrectionCount,
        },
        include: {
          local_supplier: true,
          zmcc: true,
          recorded_by: true,
        },
      });

      await tx.auditLog.create({
        data: {
          table_name: 'zmcc_local_supplier_arrival',
          record_id: arrivalId,
          action: 'ZMCC_LOCAL_SUPPLIER_ARRIVAL_CORRECTED',
          old_values: oldValues,
          new_values: {
            ...newValues,
            correction_reason: reason,
            correction_count: nextCorrectionCount,
          },
          user_id: auth.actorUserId,
        },
      });

      return updatedRecord;
    });

    return {
      status: 200,
      data: serializeLocalSupplierArrival(updated),
    };
  } catch (err: any) {
    if (err.message === 'MAX_CORRECTIONS_REACHED') {
      return {
        status: 409,
        error: 'Conflict: Maximum number of corrections (2) has been reached or another correction was committed concurrently.',
      };
    }
    if (err.message === 'ARRIVAL_NOT_FOUND') {
      return { status: 404, error: 'Local Supplier Arrival record not found.' };
    }
    console.error('correctLocalSupplierArrival error:', err);
    return { status: 500, error: 'Internal server error while correcting local supplier arrival.' };
  }
}

export async function listLocalSupplierArrivals(
  reqOrUser: Request | User,
  filters: {
    date?: string;
    local_supplier_id?: string | number | bigint;
    vehicle_number?: string;
    search?: string;
    page?: number;
    pageSize?: number;
  } = {}
): Promise<ServiceResult<any>> {
  const { auth, errorResponse } = await resolveZmccArrivalAuth(reqOrUser, 'READ_ARRIVAL');
  if (errorResponse) return errorResponse;
  if (!auth) return { status: 401, error: 'Unauthorized.' };

  const where: Prisma.ZmccLocalSupplierArrivalWhereInput = {};

  if (!auth.isSuperAdmin) {
    where.zmcc_id = auth.effectiveZmccId!;
  }

  if (filters.local_supplier_id) {
    try {
      where.local_supplier_id = BigInt(String(filters.local_supplier_id).trim());
    } catch {
      return { status: 400, error: 'Invalid local_supplier_id format.' };
    }
  }

  if (filters.vehicle_number && filters.vehicle_number.trim()) {
    where.vehicle_number = { contains: filters.vehicle_number.trim(), mode: 'insensitive' };
  }

  if (filters.date) {
    const dateStr = filters.date.trim();
    where.arrival_date = new Date(`${dateStr}T00:00:00.000Z`);
  }

  if (filters.search && filters.search.trim()) {
    const term = filters.search.trim();
    where.OR = [
      { zmcc_token: { contains: term, mode: 'insensitive' } },
      { rmr_number: { contains: term, mode: 'insensitive' } },
      { vehicle_number: { contains: term, mode: 'insensitive' } },
      { local_supplier: { name: { contains: term, mode: 'insensitive' } } },
      { local_supplier: { local_supplier_code: { contains: term, mode: 'insensitive' } } },
    ];
  }

  const page = Math.max(1, Number(filters.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(filters.pageSize) || 50));
  const skip = (page - 1) * pageSize;

  const [total, items] = await Promise.all([
    prisma.zmccLocalSupplierArrival.count({ where }),
    prisma.zmccLocalSupplierArrival.findMany({
      where,
      include: {
        local_supplier: true,
        zmcc: true,
        recorded_by: true,
      },
      orderBy: { arrival_timestamp: 'desc' },
      skip,
      take: pageSize,
    }),
  ]);

  return {
    status: 200,
    data: {
      items: items.map(serializeLocalSupplierArrival),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    },
  };
}

export async function getLocalSupplierArrivalById(
  reqOrUser: Request | User,
  arrivalIdParam: string | number | bigint
): Promise<ServiceResult<any>> {
  const { auth, errorResponse } = await resolveZmccArrivalAuth(reqOrUser, 'READ_ARRIVAL');
  if (errorResponse) return errorResponse;
  if (!auth) return { status: 401, error: 'Unauthorized.' };

  let arrivalId: bigint;
  try {
    arrivalId = BigInt(String(arrivalIdParam).trim());
  } catch {
    return { status: 400, error: 'Invalid arrival ID format.' };
  }

  const arrival = await prisma.zmccLocalSupplierArrival.findUnique({
    where: { id: arrivalId },
    include: {
      local_supplier: true,
      zmcc: true,
      recorded_by: true,
    },
  });

  if (!arrival) {
    return { status: 404, error: 'Local Supplier Arrival not found.' };
  }

  if (!auth.isSuperAdmin && arrival.zmcc_id !== auth.effectiveZmccId!) {
    return { status: 403, error: 'Forbidden. Arrival record belongs to another ZMCC.' };
  }

  return {
    status: 200,
    data: serializeLocalSupplierArrival(arrival),
  };
}

export async function recordGateExit(
  reqOrUser: Request | User,
  arrivalType: 'MOT' | 'LOCAL_SUPPLIER',
  arrivalIdParam: string | number | bigint,
  payload: RecordGateExitPayload
): Promise<ServiceResult<any>> {
  const { auth, errorResponse } = await resolveZmccArrivalAuth(reqOrUser, 'RECORD_EXIT');
  if (errorResponse) return errorResponse;
  if (!auth) return { status: 401, error: 'Unauthorized.' };

  let arrivalId: bigint;
  try {
    arrivalId = BigInt(String(arrivalIdParam).trim());
  } catch {
    return { status: 400, error: 'Invalid arrival ID format.' };
  }

  if (!payload || typeof payload !== 'object') {
    return { status: 400, error: 'Missing request payload.' };
  }

  const rawEventId = payload.client_event_id || (payload as any).exit_client_event_id;
  const clientEventId = typeof rawEventId === 'string' ? rawEventId.trim() : '';
  if (!clientEventId) {
    return { status: 400, error: 'client_event_id is required.' };
  }

  if (!payload.exit_timestamp) {
    return { status: 400, error: 'exit_timestamp is required.' };
  }
  const exitDate = new Date(payload.exit_timestamp);
  if (isNaN(exitDate.getTime())) {
    return { status: 400, error: 'Invalid exit_timestamp format.' };
  }

  const now = new Date();
  if (exitDate.getTime() > now.getTime() + 5 * 60 * 1000) {
    return { status: 400, error: 'exit_timestamp cannot be in the future.' };
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      // 1. Lock exact arrival row with static parameterized SELECT ... FOR UPDATE
      if (arrivalType === 'MOT') {
        const lockedRows = await tx.$queryRaw<{ id: bigint; gate_exit_required: boolean; exit_timestamp: Date | null; exit_client_event_id: string | null; arrival_timestamp: Date; zmcc_id: bigint }[]>`
          SELECT id, gate_exit_required, exit_timestamp, exit_client_event_id, arrival_timestamp, zmcc_id
          FROM zmcc_mot_arrival
          WHERE id = ${arrivalId}
          FOR UPDATE
        `;
        if (!lockedRows || lockedRows.length === 0) {
          return { status: 404, error: 'MOT Arrival record not found.' };
        }
      } else {
        const lockedRows = await tx.$queryRaw<{ id: bigint; gate_exit_required: boolean; exit_timestamp: Date | null; exit_client_event_id: string | null; arrival_timestamp: Date; zmcc_id: bigint }[]>`
          SELECT id, gate_exit_required, exit_timestamp, exit_client_event_id, arrival_timestamp, zmcc_id
          FROM zmcc_local_supplier_arrival
          WHERE id = ${arrivalId}
          FOR UPDATE
        `;
        if (!lockedRows || lockedRows.length === 0) {
          return { status: 404, error: 'Local Supplier Arrival record not found.' };
        }
      }

      // 2. Authoritative re-read within locked transaction
      let arrival: any = null;
      if (arrivalType === 'MOT') {
        arrival = await tx.zmccMotArrival.findUnique({
          where: { id: arrivalId },
          include: {
            journey: {
              include: {
                route: true,
                mot_vehicle: true,
                mot_profile: true,
                summary: true,
              },
            },
            zmcc: true,
            recorded_by: true,
            exit_recorded_by: true,
            lab_session: {
              include: {
                tank_receipt: true,
              },
            },
          },
        });
      } else {
        arrival = await tx.zmccLocalSupplierArrival.findUnique({
          where: { id: arrivalId },
          include: {
            local_supplier: true,
            zmcc: true,
            recorded_by: true,
            exit_recorded_by: true,
            lab_session: {
              include: {
                tank_receipt: true,
              },
            },
          },
        });
      }

      if (!arrival) {
        return { status: 404, error: `${arrivalType === 'MOT' ? 'MOT' : 'Local Supplier'} Arrival record not found.` };
      }

      // 3. Authorization / scope check
      if (!auth.isSuperAdmin && arrival.zmcc_id !== auth.effectiveZmccId!) {
        return { status: 403, error: 'Forbidden. Arrival record belongs to another ZMCC.' };
      }

      // 4. BLOCKER 3: Fail closed on historical pre-cutover rows (gate_exit_required !== true)
      if (arrival.gate_exit_required !== true) {
        return {
          status: 409,
          error: 'GATE_EXIT_NOT_TRACKED_FOR_HISTORICAL_ARRIVAL',
          message: 'Gate exit is not tracked for historical pre-cutover arrivals.',
        };
      }

      // 5. Existing exit / idempotency check under row lock
      if (arrival.exit_timestamp != null) {
        if (arrival.exit_client_event_id === clientEventId) {
          const isSameTimestamp = Math.abs(new Date(arrival.exit_timestamp).getTime() - exitDate.getTime()) < 1000;
          if (isSameTimestamp) {
            return {
              status: 200,
              data: arrivalType === 'MOT'
                ? { ...serializeMotArrival(arrival), is_replay: true }
                : { ...serializeLocalSupplierArrival(arrival), is_replay: true },
            };
          } else {
            return {
              status: 409,
              error: 'Conflict: client_event_id already used with different exit parameters.',
            };
          }
        } else {
          return {
            status: 409,
            error: 'Conflict: Gate exit has already been recorded for this arrival record.',
          };
        }
      }

      // 6. Exit Eligibility Rule (Lab status and decision)
      const labSession = arrival.lab_session;
      if (!labSession || labSession.status !== 'COMPLETED') {
        return {
          status: 409,
          error: 'LAB_NOT_COMPLETED',
          message: 'Gate exit requires a completed Lab session.',
        };
      }

      if (labSession.manager_review_status === 'PENDING' || labSession.decision === 'PENDING') {
        return {
          status: 409,
          error: 'MANAGER_REVIEW_PENDING',
          message: 'Gate exit is blocked while manager review of quality exception is pending.',
        };
      }

      if (labSession.decision === 'ACCEPTED') {
        if (!labSession.tank_receipt) {
          return {
            status: 409,
            error: 'CANNOT_EXIT_ACCEPTED_WITHOUT_RECEIPT',
            message: 'Gate exit for accepted milk requires a completed Tank Receipt.',
          };
        }
      } else if (labSession.decision === 'REJECTED') {
        // Eligible for exit
      } else {
        return {
          status: 409,
          error: 'INVALID_LAB_DECISION_FOR_EXIT',
          message: 'Gate exit requires an ACCEPTED or REJECTED Lab decision.',
        };
      }

      // 7. Chronology Rules
      if (exitDate.getTime() < new Date(arrival.arrival_timestamp).getTime()) {
        return {
          status: 400,
          error: `exit_timestamp cannot predate arrival_timestamp (${arrival.arrival_timestamp.toISOString()}).`,
        };
      }
      if (labSession.completed_at && exitDate.getTime() < new Date(labSession.completed_at).getTime()) {
        return {
          status: 400,
          error: `exit_timestamp cannot predate lab completion timestamp (${labSession.completed_at.toISOString()}).`,
        };
      }

      // 8. Atomically commit exit and audit log
      if (arrivalType === 'MOT') {
        const updatedRecord = await tx.zmccMotArrival.update({
          where: { id: arrivalId },
          data: {
            exit_timestamp: exitDate,
            exit_recorded_by_user_id: auth.actorUserId,
            exit_client_event_id: clientEventId,
            exit_submitted_at: now,
            exit_correction_count: 0,
          },
          include: {
            journey: {
              include: {
                route: true,
                mot_vehicle: true,
                mot_profile: true,
                summary: true,
              },
            },
            zmcc: true,
            recorded_by: true,
            exit_recorded_by: true,
            lab_session: {
              include: {
                tank_receipt: true,
              },
            },
          },
        });

        await tx.auditLog.create({
          data: {
            table_name: 'zmcc_mot_arrival',
            record_id: arrivalId,
            action: 'ZMCC_MOT_GATE_EXIT_RECORDED',
            old_values: {
              gate_exit_required: arrival.gate_exit_required,
              exit_timestamp: null,
            },
            new_values: {
              gate_exit_required: true,
              exit_timestamp: exitDate.toISOString(),
              exit_recorded_by_user_id: auth.actorUserId.toString(),
              exit_client_event_id: clientEventId,
            },
            user_id: auth.actorUserId,
          },
        });

        return {
          status: 200,
          data: serializeMotArrival(updatedRecord),
        };
      } else {
        const updatedRecord = await tx.zmccLocalSupplierArrival.update({
          where: { id: arrivalId },
          data: {
            exit_timestamp: exitDate,
            exit_recorded_by_user_id: auth.actorUserId,
            exit_client_event_id: clientEventId,
            exit_submitted_at: now,
            exit_correction_count: 0,
          },
          include: {
            local_supplier: true,
            zmcc: true,
            recorded_by: true,
            exit_recorded_by: true,
            lab_session: {
              include: {
                tank_receipt: true,
              },
            },
          },
        });

        await tx.auditLog.create({
          data: {
            table_name: 'zmcc_local_supplier_arrival',
            record_id: arrivalId,
            action: 'ZMCC_LOCAL_SUPPLIER_GATE_EXIT_RECORDED',
            old_values: {
              gate_exit_required: arrival.gate_exit_required,
              exit_timestamp: null,
            },
            new_values: {
              gate_exit_required: true,
              exit_timestamp: exitDate.toISOString(),
              exit_recorded_by_user_id: auth.actorUserId.toString(),
              exit_client_event_id: clientEventId,
            },
            user_id: auth.actorUserId,
          },
        });

        return {
          status: 200,
          data: serializeLocalSupplierArrival(updatedRecord),
        };
      }
    });

    return result;
  } catch (err: any) {
    if (err.code === 'P2002') {
      const conflictRecord = arrivalType === 'MOT'
        ? await prisma.zmccMotArrival.findUnique({
            where: { exit_client_event_id: clientEventId },
            include: {
              journey: { include: { route: true, mot_vehicle: true, mot_profile: true, summary: true } },
              zmcc: true,
              recorded_by: true,
              exit_recorded_by: true,
              lab_session: { include: { tank_receipt: true } },
            },
          })
        : await prisma.zmccLocalSupplierArrival.findUnique({
            where: { exit_client_event_id: clientEventId },
            include: {
              local_supplier: true,
              zmcc: true,
              recorded_by: true,
              exit_recorded_by: true,
              lab_session: { include: { tank_receipt: true } },
            },
          });

      if (conflictRecord && conflictRecord.id === arrivalId) {
        const isSame = Math.abs(new Date(conflictRecord.exit_timestamp!).getTime() - exitDate.getTime()) < 1000;
        if (isSame) {
          return {
            status: 200,
            data: arrivalType === 'MOT'
              ? { ...serializeMotArrival(conflictRecord), is_replay: true }
              : { ...serializeLocalSupplierArrival(conflictRecord), is_replay: true },
          };
        }
      }
      return {
        status: 409,
        error: 'Conflict: Reused client_event_id with differing exit parameters or collision.',
      };
    }
    console.error('recordGateExit error:', err);
    return { status: 500, error: 'Internal server error while recording gate exit.' };
  }
}

class ExitCorrectionError extends Error {
  status: number;
  errorPayload: { status: number; error: string; message?: string };
  constructor(status: number, error: string, message?: string) {
    super(error);
    this.status = status;
    this.errorPayload = { status, error, ...(message ? { message } : {}) };
  }
}

export async function correctGateExit(
  reqOrUser: Request | User,
  arrivalType: 'MOT' | 'LOCAL_SUPPLIER',
  arrivalIdParam: string | number | bigint,
  payload: CorrectGateExitPayload
): Promise<ServiceResult<any>> {
  const { auth, errorResponse } = await resolveZmccArrivalAuth(reqOrUser, 'CORRECT_EXIT');
  if (errorResponse) return errorResponse;
  if (!auth) return { status: 401, error: 'Unauthorized.' };

  let arrivalId: bigint;
  try {
    arrivalId = BigInt(String(arrivalIdParam).trim());
  } catch {
    return { status: 400, error: 'Invalid arrival ID format.' };
  }

  if (!payload || typeof payload !== 'object') {
    return { status: 400, error: 'Missing correction payload.' };
  }

  const reason = typeof (payload.reason || (payload as any).supervisor_reason) === 'string'
    ? (payload.reason || (payload as any).supervisor_reason).trim()
    : '';
  if (!reason || reason.length < 5) {
    return { status: 400, error: 'Correction reason is mandatory and must be at least 5 characters.' };
  }

  if (!payload.exit_timestamp) {
    return { status: 400, error: 'exit_timestamp is required.' };
  }
  const exitDate = new Date(payload.exit_timestamp);
  if (isNaN(exitDate.getTime())) {
    return { status: 400, error: 'Invalid exit_timestamp format.' };
  }

  const now = new Date();
  if (exitDate.getTime() > now.getTime() + 5 * 60 * 1000) {
    return { status: 400, error: 'exit_timestamp cannot be in the future.' };
  }

  try {
    const updated = await prisma.$transaction(async (tx) => {
      // 1. Static parameterized row lock branches (no $queryRawUnsafe)
      if (arrivalType === 'MOT') {
        const lockRows = await tx.$queryRaw<{ id: bigint }[]>`
          SELECT id FROM zmcc_mot_arrival WHERE id = ${arrivalId} FOR UPDATE
        `;
        if (!lockRows || lockRows.length === 0) {
          throw new ExitCorrectionError(404, 'MOT Arrival record not found.');
        }
      } else if (arrivalType === 'LOCAL_SUPPLIER') {
        const lockRows = await tx.$queryRaw<{ id: bigint }[]>`
          SELECT id FROM zmcc_local_supplier_arrival WHERE id = ${arrivalId} FOR UPDATE
        `;
        if (!lockRows || lockRows.length === 0) {
          throw new ExitCorrectionError(404, 'Local Supplier Arrival record not found.');
        }
      } else {
        throw new ExitCorrectionError(400, 'Invalid arrival_type for gate exit correction.');
      }

      // 2. Authoritative re-read under the acquired row lock
      let currentArrival: any = null;
      if (arrivalType === 'MOT') {
        currentArrival = await tx.zmccMotArrival.findUnique({
          where: { id: arrivalId },
          include: {
            journey: {
              include: {
                route: true,
                mot_vehicle: true,
                mot_profile: true,
                summary: true,
              },
            },
            zmcc: true,
            recorded_by: true,
            exit_recorded_by: true,
            lab_session: true,
          },
        });
      } else {
        currentArrival = await tx.zmccLocalSupplierArrival.findUnique({
          where: { id: arrivalId },
          include: {
            local_supplier: true,
            zmcc: true,
            recorded_by: true,
            exit_recorded_by: true,
            lab_session: true,
          },
        });
      }

      if (!currentArrival) {
        throw new ExitCorrectionError(404, `${arrivalType === 'MOT' ? 'MOT' : 'Local Supplier'} Arrival record not found.`);
      }

      // 3. Multi-tenant scope check under lock
      if (!auth.isSuperAdmin && currentArrival.zmcc_id !== auth.effectiveZmccId!) {
        throw new ExitCorrectionError(403, 'Forbidden. Arrival record belongs to another ZMCC.');
      }

      // 4. Require current exit exists
      if (!currentArrival.exit_timestamp) {
        throw new ExitCorrectionError(400, 'Cannot correct gate exit for an arrival that has not exited.');
      }

      // 5. Require gate_exit_required === true
      if (currentArrival.gate_exit_required !== true) {
        throw new ExitCorrectionError(409, 'GATE_EXIT_NOT_TRACKED_FOR_HISTORICAL_ARRIVAL', 'Gate exit is not tracked for historical arrivals.');
      }

      // 6. Check current correction count under lock
      const currentCount = currentArrival.exit_correction_count ?? 0;
      if (currentCount >= 2) {
        throw new ExitCorrectionError(409, 'MAX_EXIT_CORRECTIONS_EXCEEDED', 'Maximum number of gate exit corrections (2) has been reached.');
      }

      // 7. Check if requested timestamp equals current timestamp (reject as no-op)
      const currentExitTime = new Date(currentArrival.exit_timestamp).getTime();
      if (exitDate.getTime() === currentExitTime) {
        throw new ExitCorrectionError(400, 'NO_OP_IDENTICAL_TIMESTAMP', 'New exit timestamp is identical to the current exit timestamp.');
      }

      // 8. Re-check chronology using current locked arrival_timestamp and lab.completed_at
      const arrivalTime = new Date(currentArrival.arrival_timestamp).getTime();
      if (exitDate.getTime() < arrivalTime) {
        throw new ExitCorrectionError(400, `exit_timestamp cannot predate arrival_timestamp (${currentArrival.arrival_timestamp.toISOString()}).`);
      }
      if (currentArrival.lab_session?.completed_at) {
        const labCompletedTime = new Date(currentArrival.lab_session.completed_at).getTime();
        if (exitDate.getTime() < labCompletedTime) {
          throw new ExitCorrectionError(400, `exit_timestamp cannot predate lab completion timestamp (${currentArrival.lab_session.completed_at.toISOString()}).`);
        }
      }

      // 9. Use the CURRENT locked exit timestamp as old_values.exit_timestamp
      const nextCount = currentCount + 1;
      const oldExitTs = currentArrival.exit_timestamp instanceof Date
        ? currentArrival.exit_timestamp.toISOString()
        : new Date(currentArrival.exit_timestamp).toISOString();
      const newExitTs = exitDate.toISOString();

      let updatedRecord: any;
      if (arrivalType === 'MOT') {
        updatedRecord = await tx.zmccMotArrival.update({
          where: { id: arrivalId },
          data: {
            exit_timestamp: exitDate,
            exit_correction_count: nextCount,
          },
          include: {
            journey: {
              include: {
                route: true,
                mot_vehicle: true,
                mot_profile: true,
                summary: true,
              },
            },
            zmcc: true,
            recorded_by: true,
            exit_recorded_by: true,
          },
        });
        await tx.auditLog.create({
          data: {
            table_name: 'zmcc_mot_arrival',
            record_id: arrivalId,
            action: 'ZMCC_MOT_GATE_EXIT_CORRECTED',
            old_values: {
              exit_timestamp: oldExitTs,
              exit_correction_count: currentCount,
            },
            new_values: {
              exit_timestamp: newExitTs,
              exit_correction_count: nextCount,
              correction_reason: reason,
            },
            user_id: auth.actorUserId,
          },
        });
      } else {
        updatedRecord = await tx.zmccLocalSupplierArrival.update({
          where: { id: arrivalId },
          data: {
            exit_timestamp: exitDate,
            exit_correction_count: nextCount,
          },
          include: {
            local_supplier: true,
            zmcc: true,
            recorded_by: true,
            exit_recorded_by: true,
          },
        });
        await tx.auditLog.create({
          data: {
            table_name: 'zmcc_local_supplier_arrival',
            record_id: arrivalId,
            action: 'ZMCC_LOCAL_SUPPLIER_GATE_EXIT_CORRECTED',
            old_values: {
              exit_timestamp: oldExitTs,
              exit_correction_count: currentCount,
            },
            new_values: {
              exit_timestamp: newExitTs,
              exit_correction_count: nextCount,
              correction_reason: reason,
            },
            user_id: auth.actorUserId,
          },
        });
      }

      return updatedRecord;
    });

    return {
      status: 200,
      data: arrivalType === 'MOT' ? serializeMotArrival(updated) : serializeLocalSupplierArrival(updated),
    };
  } catch (err: any) {
    if (err instanceof ExitCorrectionError) {
      return err.errorPayload;
    }
    console.error('correctGateExit error:', err);
    return { status: 500, error: 'Internal server error while correcting gate exit.' };
  }
}

export async function getVehiclesInsideZmcc(
  reqOrUser: Request | User,
  zmccIdQuery?: string,
  limitQuery?: number | string
): Promise<ServiceResult<{ vehicles: any[]; items: any[]; limit: number; total_count: number; has_more: boolean }>> {
  const { auth, errorResponse } = await resolveZmccArrivalAuth(reqOrUser, 'READ_ARRIVAL');
  if (errorResponse) return errorResponse;
  if (!auth) return { status: 401, error: 'Unauthorized.' };

  let targetZmccId: bigint | null = null;
  if (auth.isSuperAdmin) {
    if (zmccIdQuery && zmccIdQuery.trim() !== '') {
      try {
        targetZmccId = BigInt(zmccIdQuery.trim());
      } catch {
        return { status: 400, error: 'Invalid zmcc_id query parameter.' };
      }
    }
  } else {
    targetZmccId = auth.effectiveZmccId;
    if (zmccIdQuery && zmccIdQuery.trim() !== '') {
      try {
        const queryId = BigInt(zmccIdQuery.trim());
        if (queryId !== targetZmccId) {
          return { status: 403, error: 'Forbidden. Cannot view inside vehicles for another ZMCC.' };
        }
      } catch {
        return { status: 400, error: 'Invalid zmcc_id query parameter.' };
      }
    }
  }

  const DEFAULT_LIMIT = 100;
  const MAX_LIMIT = 100;
  let limit = DEFAULT_LIMIT;
  if (limitQuery !== undefined && limitQuery !== null && String(limitQuery).trim() !== '') {
    const parsed = parseInt(String(limitQuery), 10);
    if (!isNaN(parsed) && parsed > 0) {
      limit = Math.min(parsed, MAX_LIMIT);
    }
  }

  const motWhere: Prisma.ZmccMotArrivalWhereInput = {
    gate_exit_required: true,
    exit_timestamp: null,
    ...(targetZmccId ? { zmcc_id: targetZmccId } : {}),
  };

  const lsWhere: Prisma.ZmccLocalSupplierArrivalWhereInput = {
    gate_exit_required: true,
    exit_timestamp: null,
    ...(targetZmccId ? { zmcc_id: targetZmccId } : {}),
  };

  const [totalMotCount, totalLsCount, motArrivals, lsArrivals] = await Promise.all([
    prisma.zmccMotArrival.count({ where: motWhere }),
    prisma.zmccLocalSupplierArrival.count({ where: lsWhere }),
    prisma.zmccMotArrival.findMany({
      where: motWhere,
      take: limit + 1,
      include: {
        journey: {
          include: {
            route: true,
            mot_vehicle: true,
            mot_profile: true,
            summary: true,
          },
        },
        zmcc: true,
        recorded_by: true,
        exit_recorded_by: true,
        lab_session: {
          include: {
            tank_receipt: true,
          },
        },
      },
      orderBy: { arrival_timestamp: 'asc' },
    }),
    prisma.zmccLocalSupplierArrival.findMany({
      where: lsWhere,
      take: limit + 1,
      include: {
        local_supplier: true,
        zmcc: true,
        recorded_by: true,
        exit_recorded_by: true,
        lab_session: {
          include: {
            tank_receipt: true,
          },
        },
      },
      orderBy: { arrival_timestamp: 'asc' },
    }),
  ]);

  const totalCount = totalMotCount + totalLsCount;
  const vehicles: any[] = [];

  for (const a of motArrivals) {
    const lab = a.lab_session;
    const canExit = Boolean(
      lab &&
      lab.status === 'COMPLETED' &&
      ((lab.decision === 'ACCEPTED' && lab.tank_receipt) || lab.decision === 'REJECTED')
    );
    const ineligibilityReason = !lab
      ? 'Waiting for Lab'
      : lab.status !== 'COMPLETED'
      ? 'Lab In Progress'
      : lab.decision === 'ACCEPTED' && !lab.tank_receipt
      ? 'Accepted — Waiting for Tank Receipt'
      : null;

    vehicles.push({
      id: a.id.toString(),
      arrival_type: 'MOT',
      vehicle_number: a.journey?.mot_vehicle?.vehicle_number || 'UNKNOWN',
      source_name: a.journey?.route?.name
        ? `${a.journey.route.name} (${a.journey.mot_profile?.name || 'MOT'})`
        : 'MOT Route',
      local_supplier_code: null,
      zmcc_token: a.zmcc_token,
      arrival_timestamp: a.arrival_timestamp instanceof Date ? a.arrival_timestamp.toISOString() : a.arrival_timestamp,
      lab_status: lab ? lab.status : 'NOT_STARTED',
      lab_decision: lab ? lab.decision : null,
      has_tank_receipt: Boolean(lab?.tank_receipt),
      can_exit: canExit,
      exit_ineligibility_reason: ineligibilityReason,
      gate_exit_required: a.gate_exit_required,
      gate_exit_recorded: Boolean(a.exit_timestamp),
      zmcc: a.zmcc
        ? {
            id: a.zmcc.id.toString(),
            code: a.zmcc.code,
            name: a.zmcc.name,
          }
        : undefined,
      raw_arrival: serializeMotArrival(a),
    });
  }

  for (const a of lsArrivals) {
    const lab = a.lab_session;
    const canExit = Boolean(
      lab &&
      lab.status === 'COMPLETED' &&
      ((lab.decision === 'ACCEPTED' && lab.tank_receipt) || lab.decision === 'REJECTED')
    );
    const ineligibilityReason = !lab
      ? 'Waiting for Lab'
      : lab.status !== 'COMPLETED'
      ? 'Lab In Progress'
      : lab.decision === 'ACCEPTED' && !lab.tank_receipt
      ? 'Accepted — Waiting for Tank Receipt'
      : null;

    vehicles.push({
      id: a.id.toString(),
      arrival_type: 'LOCAL_SUPPLIER',
      vehicle_number: a.vehicle_number,
      source_name: a.local_supplier ? a.local_supplier.name : 'Local Supplier',
      local_supplier_code: a.local_supplier ? a.local_supplier.local_supplier_code : null,
      zmcc_token: a.zmcc_token,
      arrival_timestamp: a.arrival_timestamp instanceof Date ? a.arrival_timestamp.toISOString() : a.arrival_timestamp,
      lab_status: lab ? lab.status : 'NOT_STARTED',
      lab_decision: lab ? lab.decision : null,
      has_tank_receipt: Boolean(lab?.tank_receipt),
      can_exit: canExit,
      exit_ineligibility_reason: ineligibilityReason,
      gate_exit_required: a.gate_exit_required,
      gate_exit_recorded: Boolean(a.exit_timestamp),
      zmcc: a.zmcc
        ? {
            id: a.zmcc.id.toString(),
            code: a.zmcc.code,
            name: a.zmcc.name,
          }
        : undefined,
      raw_arrival: serializeLocalSupplierArrival(a),
    });
  }

  vehicles.sort((a, b) => new Date(a.arrival_timestamp).getTime() - new Date(b.arrival_timestamp).getTime());

  const boundedVehicles = vehicles.slice(0, limit);
  const hasMore = totalCount > limit;

  return {
    status: 200,
    data: {
      vehicles: boundedVehicles,
      items: boundedVehicles,
      limit,
      total_count: totalCount,
      has_more: hasMore,
    },
  };
}
