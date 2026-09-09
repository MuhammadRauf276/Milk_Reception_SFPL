import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import { Role, User, DEFAULT_USERS, AUTHENTICATED_USERS } from './types';
import { prisma } from './db';

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
 * Next.js 15 Asynchronous Cookies Helper with Live Database Authority Resolution
 */
export async function getCurrentUser(req?: Request): Promise<User | null> {
  let token: string | undefined | null = null;

  if (req) {
    const cookieHeader = req.headers.get('cookie') || '';
    const tokenMatch = cookieHeader.match(/auth_token=([^;]+)/);
    if (tokenMatch && tokenMatch[1]) {
      token = tokenMatch[1];
    } else {
      const authHeader = req.headers.get('authorization') || '';
      if (authHeader.startsWith('Bearer ')) {
        token = authHeader.substring(7).trim();
      }
    }
  }

  if (!token) {
    try {
      const cookieStore = await cookies();
      token = cookieStore.get('auth_token')?.value;
    } catch (_err) {
      // cookies() may fail if called outside Next.js request scope
    }
  }

  if (!token) {
    return null;
  }

  const sessionUser = await verifySessionToken(token);
  if (!sessionUser) {
    return null;
  }

    // Require a valid numeric persisted database user ID from the verified JWT
    if (!sessionUser.id || !/^\d+$/.test(sessionUser.id.trim())) {
      return null;
    }

    const idBigInt = BigInt(sessionUser.id.trim());

    try {

    const dbUser = await prisma.user.findUnique({
      where: { id: idBigInt },
      select: {
        id: true,
        username: true,
        full_name: true,
        role: true,
        department: true,
        scope_type: true,
        procurement_source_id: true,
        is_active: true,
        last_login_at: true,
        procurement_source: {
          select: {
            id: true,
            code: true,
            name: true,
            source_type: true,
          },
        },
      },
    });

    // Missing database user: UNAUTHORIZED
    if (!dbUser) {
      return null;
    }

    // Inactive database user: UNAUTHORIZED IMMEDIATELY
    if (!dbUser.is_active) {
      return null;
    }

    // Current authorization strictly derived from PostgreSQL
    return {
      id: dbUser.id.toString(),
      username: dbUser.username,
      name: dbUser.full_name || dbUser.username,
      role: dbUser.role as Role,
      department: dbUser.department || '',
      zone: sessionUser.zone || null,
      scope_type: dbUser.scope_type,
      procurement_source_id: dbUser.procurement_source_id ? dbUser.procurement_source_id.toString() : null,
      procurement_source: dbUser.procurement_source
        ? {
            id: dbUser.procurement_source.id.toString(),
            code: dbUser.procurement_source.code,
            name: dbUser.procurement_source.name,
            source_type: dbUser.procurement_source.source_type,
          }
        : null,
      last_login_at: dbUser.last_login_at ? dbUser.last_login_at.toISOString() : null,
    };
  } catch (_err) {
    return null;
  }
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
