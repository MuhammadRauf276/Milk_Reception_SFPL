import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import { Role, User, DEFAULT_USERS, AUTHENTICATED_USERS } from './types';

export { DEFAULT_USERS, AUTHENTICATED_USERS };

function getJwtSecretKey(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret || !secret.trim()) {
    throw new Error('JWT_SECRET environment variable is missing or empty. Token operations cannot be performed.');
  }
  return new TextEncoder().encode(secret.trim());
}

export const NORMAL_SESSION_TTL = 12 * 60 * 60; // 12 hours in seconds
export const REMEMBERED_SESSION_TTL = 30 * 24 * 60 * 60; // 30 days in seconds

export async function createSessionToken(user: User, rememberMe: boolean = false): Promise<string> {
  const secretKey = getJwtSecretKey();
  const expTime = rememberMe ? '30d' : '12h';

  return await new SignJWT({
    id: user.id,
    username: user.username,
    name: user.name,
    role: user.role,
    department: user.department,
    zone: user.zone || null,
    scope_type: user.scope_type || 'ALL',
    procurement_source_id: user.procurement_source_id || null,
    last_login_at: user.last_login_at || null,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(expTime)
    .sign(secretKey);
}

export async function verifySessionToken(token: string): Promise<User | null> {
  try {
    const secretKey = getJwtSecretKey();
    const verified = await jwtVerify(token, secretKey);
    const payload = verified.payload;
    return {
      id: payload.id as string,
      username: (payload.username as string) || (payload.id as string),
      name: payload.name as string,
      role: payload.role as Role,
      department: payload.department as string,
      zone: (payload.zone as string) || null,
      scope_type: (payload.scope_type as string) || 'ALL',
      procurement_source_id: (payload.procurement_source_id as string) || null,
      last_login_at: (payload.last_login_at as string) || null,
    };
  } catch (_err) {
    return null;
  }
}

/**
 * Next.js 15 Asynchronous Cookies Helper
 */
export async function getCurrentUser(): Promise<User | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get('auth_token')?.value;

  if (!token) {
    return null;
  }

  return await verifySessionToken(token);
}

/**
 * Strict Granular Column Visibility & Write Matrix
 */
const ROLE_ALLOWED_FIELDS: Record<string, string[]> = {
  SUPER_ADMIN: [], // Super Admin cannot perform direct un-audited historical operational mutations
  MPD_Operator: [
    'vehicle_number',
    'portion_number',
    'zonal_contractor_name',
    'dispatch_date',
    'dispatch_day',
    'dispatch_week',
    'dispatch_month',
    'dispatch_year',
    'zonal_contractor_dispatch_time',
    'scheduled_arrival_time',
    'dispatch_kg_gross',
    'dispatch_liters_gross',
    'dispatch_tests',
    'dispatch_fat',
    'dispatch_lr',
    'status'
  ],
  Security_Operator: [
    'token_number',
    'igp_date',
    'igp_time',
    'first_weight_time',
    'first_weight_of_vehicle',
    'second_weight_time',
    'second_weight_of_vehicle',
    'out_from_gate_time',
    'status'
  ],
  QA_Operator: [
    'igp_date',
    'igp_time',
    'sampling_date',
    'sampling_time_start',
    'sampling_time_end',
    'sampling_tests',
    'sampling_lr',
    'sampling_fat',
    'b_mbrt_minutes_test',
    'calculated_status',
    'rejection_reasons',
    'remarks',
    'parallel_override_active',
    'parallel_override_code',
    'rm_mbrt_pending',
    'status'
  ],
  WEIGHBRIDGE_OPERATOR: [
    'first_weight_time',
    'first_weight_of_vehicle',
    'second_weight_time',
    'second_weight_of_vehicle',
    'status'
  ],
  Weighbridge_Operator: [
    'first_weight_time',
    'first_weight_of_vehicle',
    'second_weight_time',
    'second_weight_of_vehicle',
    'status'
  ],
  Production_Operator: [
    'reception_date',
    'reception_start_time',
    'reception_end_time',
    'silo_storage_id',
    'first_weight_of_vehicle',
    'second_weight_of_vehicle',
    'status'
  ],
  MPD_Zone_Manager: [],
  Security_Manager: [],
  QA_Manager: [],
  Production_Manager: [],
  General_Plant_Manager: [],
  Management: [],
  Correction_Officer: [
    'vehicle_number',
    'portion_number',
    'token_number',
    'zonal_contractor_name',
    'status',
    'dispatch_date',
    'dispatch_day',
    'dispatch_week',
    'dispatch_month',
    'dispatch_year',
    'zonal_contractor_dispatch_time',
    'scheduled_arrival_time',
    'dispatch_kg_gross',
    'dispatch_liters_gross',
    'dispatch_tests',
    'dispatch_fat',
    'dispatch_lr',
    'igp_date',
    'igp_time',
    'sampling_date',
    'sampling_time_start',
    'sampling_time_end',
    'sampling_tests',
    'sampling_lr',
    'sampling_fat',
    'b_mbrt_minutes_test',
    'calculated_status',
    'rejection_reasons',
    'remarks',
    'first_weight_time',
    'first_weight_of_vehicle',
    'second_weight_time',
    'second_weight_of_vehicle',
    'out_from_gate_time',
    'reception_date',
    'reception_start_time',
    'reception_end_time',
    'silo_storage_id'
  ],
  Admin: [
    'vehicle_number',
    'portion_number',
    'token_number',
    'zonal_contractor_name',
    'status',
    'dispatch_date',
    'dispatch_day',
    'dispatch_week',
    'dispatch_month',
    'dispatch_year',
    'zonal_contractor_dispatch_time',
    'scheduled_arrival_time',
    'dispatch_kg_gross',
    'dispatch_liters_gross',
    'dispatch_tests',
    'dispatch_fat',
    'dispatch_lr',
    'igp_date',
    'igp_time',
    'sampling_date',
    'sampling_time_start',
    'sampling_time_end',
    'sampling_tests',
    'sampling_lr',
    'sampling_fat',
    'b_mbrt_minutes_test',
    'calculated_status',
    'rejection_reasons',
    'remarks',
    'first_weight_time',
    'first_weight_of_vehicle',
    'second_weight_time',
    'second_weight_of_vehicle',
    'out_from_gate_time',
    'reception_date',
    'reception_start_time',
    'reception_end_time',
    'silo_storage_id'
  ],
  MPD: ['vehicle_number', 'portion_number', 'zonal_contractor_name', 'dispatch_kg_gross', 'dispatch_liters_gross', 'dispatch_fat', 'dispatch_lr', 'status'],
  QA: ['sampling_date', 'sampling_time_start', 'sampling_time_end', 'sampling_fat', 'sampling_lr', 'b_mbrt_minutes_test', 'calculated_status', 'rejection_reasons', 'parallel_override_active', 'status'],
  Security_Weight: ['token_number', 'igp_date', 'igp_time', 'first_weight_of_vehicle', 'second_weight_of_vehicle', 'status'],
  Production: ['reception_date', 'reception_start_time', 'reception_end_time', 'silo_storage_id', 'status']
};

export function filterUpdatesByRole(role: Role, updates: Record<string, unknown>): Record<string, unknown> {
  const allowed = ROLE_ALLOWED_FIELDS[role] || [];
  const sanitized: Record<string, unknown> = {};

  for (const key of Object.keys(updates)) {
    if (allowed.includes(key)) {
      sanitized[key] = updates[key];
    }
  }

  return sanitized;
}
