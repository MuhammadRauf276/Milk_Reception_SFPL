import { prisma } from '@core/db';
import { getCurrentUser } from '@core/auth';
import { User, Role } from '@core/types';
import { getOperationalBusinessDate } from '@core/business-day';
import { validatePhone, validateCnic } from './zmccMasterDataService';

export interface MotAuthContext {
  user: User;
  actorUserId: bigint;
  role: Role;
  isSuperAdmin: boolean;
  isZmccManager: boolean;
  isPheOperator: boolean;
  isMot: boolean;
  effectiveZmccId: bigint | null;
}

export type MotAction =
  | 'READ'
  | 'WRITE_PROFILE'
  | 'WRITE_VEHICLE'
  | 'ASSIGN_DISPATCH'
  | 'CANCEL_JOURNEY'
  | 'READ_CURRENT_JOURNEY';

export interface ServiceResult<T> {
  status: number;
  data?: T;
  error?: string;
}

/**
 * Server-side Authorization & Scope Resolver for MOT Operations
 */
export async function resolveMotAuth(
  req?: Request,
  action: MotAction = 'READ'
): Promise<{ auth?: MotAuthContext; errorResponse?: { error: string; status: number } }> {
  const authUser = await getCurrentUser(req);
  if (!authUser) {
    return { errorResponse: { error: 'Unauthorized. Authentication required.', status: 401 } };
  }

  const actorUserId = BigInt(authUser.id.trim());
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
  const isMot = role === 'MOT';

  // Role validation based on required action
  if (action === 'READ_CURRENT_JOURNEY') {
    if (!isMot && !isSuperAdmin) {
      return {
        errorResponse: {
          error: 'Forbidden. Current journey endpoint is dedicated for MOT operators.',
          status: 403,
        },
      };
    }
  } else {
    // Normal MOT management / dispatch actions
    if (!isSuperAdmin && !isZmccManager && !isPheOperator) {
      return {
        errorResponse: {
          error: 'Forbidden. You do not have permission to access MOT Operations.',
          status: 403,
        },
      };
    }
  }

  // Validate source assignment for scoped roles (ZMCC_MANAGER, PHE_OPERATOR, MOT)
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

  // Action-specific permissions
  if (action === 'WRITE_PROFILE' || action === 'WRITE_VEHICLE') {
    if (isPheOperator) {
      return {
        errorResponse: {
          error: 'Forbidden. PHE Operators cannot manage MOT Profiles or Vehicles.',
          status: 403,
        },
      };
    }
  }

  if (action === 'CANCEL_JOURNEY') {
    if (!isSuperAdmin && !isZmccManager) {
      return {
        errorResponse: {
          error: 'Forbidden. Only Super Admin or the assigned ZMCC Manager can cancel journeys.',
          status: 403,
        },
      };
    }
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
      isMot,
      effectiveZmccId,
    },
  };
}

// =============================================================
// MOT PROFILES
// =============================================================

export async function listMotProfiles(
  auth: MotAuthContext,
  filters?: { zmcc_id?: string; is_active?: string; search?: string }
) {
  const where: any = {};

  if (auth.isSuperAdmin) {
    if (filters?.zmcc_id) {
      where.zmcc_id = BigInt(filters.zmcc_id);
    }
  } else {
    where.zmcc_id = auth.effectiveZmccId;
  }

  if (auth.isPheOperator) {
    where.is_active = true;
  } else if (filters?.is_active !== undefined && filters.is_active !== 'all') {
    where.is_active = filters.is_active === 'true';
  }

  if (filters?.search) {
    const s = filters.search.trim();
    where.OR = [
      { mot_code: { contains: s, mode: 'insensitive' } },
      { name: { contains: s, mode: 'insensitive' } },
      { phone_number: { contains: s, mode: 'insensitive' } },
      { cnic: { contains: s, mode: 'insensitive' } },
    ];
  }

  const profiles = await prisma.motProfile.findMany({
    where,
    orderBy: { mot_code: 'asc' },
    include: {
      zmcc: { select: { id: true, code: true, name: true, is_active: true } },
      user: { select: { id: true, username: true, full_name: true, is_active: true } },
      creator: { select: { id: true, username: true, full_name: true } },
      updater: { select: { id: true, username: true, full_name: true } },
      journeys: {
        where: { status: 'COLLECTING' },
        select: { id: true, journey_number: true, status: true },
      },
    },
  });

  return profiles.map((p) => ({
    id: p.id.toString(),
    mot_code: p.mot_code,
    name: p.name,
    phone_number: p.phone_number,
    cnic: p.cnic,
    zmcc_id: p.zmcc_id.toString(),
    zmcc: {
      id: p.zmcc.id.toString(),
      code: p.zmcc.code,
      name: p.zmcc.name,
      is_active: p.zmcc.is_active,
    },
    user_id: p.user_id ? p.user_id.toString() : null,
    user: p.user
      ? {
          id: p.user.id.toString(),
          username: p.user.username,
          full_name: p.user.full_name,
          is_active: p.user.is_active,
        }
      : null,
    is_active: p.is_active,
    has_active_journey: p.journeys.length > 0,
    active_journey: p.journeys[0]
      ? {
          id: p.journeys[0].id.toString(),
          journey_number: p.journeys[0].journey_number,
          status: p.journeys[0].status,
        }
      : null,
    created_by: p.created_by.toString(),
    updated_by: p.updated_by ? p.updated_by.toString() : null,
    creator_name: p.creator.full_name || p.creator.username,
    updater_name: p.updater ? p.updater.full_name || p.updater.username : null,
    created_at: p.created_at.toISOString(),
    updated_at: p.updated_at.toISOString(),
  }));
}

export async function getMotProfileById(
  auth: MotAuthContext,
  idStr: string
): Promise<ServiceResult<any>> {
  let id: bigint;
  try {
    id = BigInt(idStr);
  } catch {
    return { status: 400, error: 'Invalid MOT Profile ID format.' };
  }

  const profile = await prisma.motProfile.findUnique({
    where: { id },
    include: {
      zmcc: { select: { id: true, code: true, name: true, is_active: true } },
      user: { select: { id: true, username: true, full_name: true, is_active: true } },
      creator: { select: { id: true, username: true, full_name: true } },
      updater: { select: { id: true, username: true, full_name: true } },
      journeys: {
        where: { status: 'COLLECTING' },
        select: { id: true, journey_number: true, status: true },
      },
    },
  });

  if (!profile) {
    return { status: 404, error: 'MOT Profile not found.' };
  }

  if (!auth.isSuperAdmin && profile.zmcc_id !== auth.effectiveZmccId) {
    return { status: 403, error: 'Forbidden. You cannot access an MOT profile from another ZMCC.' };
  }

  return {
    status: 200,
    data: {
      id: profile.id.toString(),
      mot_code: profile.mot_code,
      name: profile.name,
      phone_number: profile.phone_number,
      cnic: profile.cnic,
      zmcc_id: profile.zmcc_id.toString(),
      zmcc: {
        id: profile.zmcc.id.toString(),
        code: profile.zmcc.code,
        name: profile.zmcc.name,
        is_active: profile.zmcc.is_active,
      },
      user_id: profile.user_id ? profile.user_id.toString() : null,
      user: profile.user
        ? {
            id: profile.user.id.toString(),
            username: profile.user.username,
            full_name: profile.user.full_name,
            is_active: profile.user.is_active,
          }
        : null,
      is_active: profile.is_active,
      has_active_journey: profile.journeys.length > 0,
      active_journey: profile.journeys[0]
        ? {
            id: profile.journeys[0].id.toString(),
            journey_number: profile.journeys[0].journey_number,
            status: profile.journeys[0].status,
          }
        : null,
      created_by: profile.created_by.toString(),
      updated_by: profile.updated_by ? profile.updated_by.toString() : null,
      creator_name: profile.creator.full_name || profile.creator.username,
      updater_name: profile.updater ? profile.updater.full_name || profile.updater.username : null,
      created_at: profile.created_at.toISOString(),
      updated_at: profile.updated_at.toISOString(),
    },
  };
}

export async function createMotProfile(
  auth: MotAuthContext,
  payload: {
    mot_code: string;
    name: string;
    phone_number: string;
    cnic: string;
    zmcc_id?: string;
    user_id?: string | null;
  }
): Promise<ServiceResult<any>> {
  if (auth.isPheOperator) {
    return { status: 403, error: 'Forbidden. PHE Operators cannot create MOT profiles.' };
  }

  const mot_code = (payload.mot_code || '').trim().toUpperCase();
  const name = (payload.name || '').trim();
  const phone_number = (payload.phone_number || '').trim();
  const cnic = (payload.cnic || '').trim();

  if (!mot_code) return { status: 400, error: 'MOT code is required.' };
  if (!name) return { status: 400, error: 'Name is required.' };
  if (!phone_number) return { status: 400, error: 'Phone number is required.' };
  if (!validatePhone(phone_number)) return { status: 400, error: 'Invalid Pakistani phone number format.' };
  if (!cnic) return { status: 400, error: 'CNIC is required.' };
  if (!validateCnic(cnic)) return { status: 400, error: 'Invalid CNIC format (13 digits or XXXXX-XXXXXXX-X).' };

  let targetZmccId: bigint;
  if (auth.isSuperAdmin) {
    if (!payload.zmcc_id) {
      return { status: 400, error: 'ZMCC ID is required for Super Admin.' };
    }
    try {
      targetZmccId = BigInt(payload.zmcc_id);
    } catch {
      return { status: 400, error: 'Invalid ZMCC ID format.' };
    }
  } else {
    targetZmccId = auth.effectiveZmccId!;
  }

  // Verify target ZMCC exists and is active
  const zmcc = await prisma.procurementSource.findUnique({
    where: { id: targetZmccId },
  });
  if (!zmcc || !zmcc.is_active || zmcc.source_type !== 'ZMCC') {
    return { status: 400, error: 'Target ZMCC does not exist or is inactive.' };
  }

  // Check unique mot_code
  const existingCode = await prisma.motProfile.findUnique({
    where: { mot_code },
  });
  if (existingCode) {
    return { status: 409, error: `MOT Profile with code '${mot_code}' already exists.` };
  }

  let linkedUserId: bigint | null = null;
  if (payload.user_id) {
    try {
      linkedUserId = BigInt(payload.user_id);
      const targetUser = await prisma.user.findUnique({
        where: { id: linkedUserId },
      });
      if (!targetUser) {
        return { status: 400, error: 'Linked user not found.' };
      }
      if (targetUser.role !== 'MOT') {
        return { status: 400, error: "Linked user must have canonical role 'MOT'." };
      }
      if (!targetUser.is_active) {
        return { status: 400, error: 'Linked user account is inactive.' };
      }
      // Check user not already assigned to another profile
      const userAlreadyAssigned = await prisma.motProfile.findUnique({
        where: { user_id: linkedUserId },
      });
      if (userAlreadyAssigned) {
        return { status: 409, error: 'This user is already linked to another MOT profile.' };
      }
    } catch {
      return { status: 400, error: 'Invalid User ID format.' };
    }
  }

  const profile = await prisma.motProfile.create({
    data: {
      mot_code,
      name,
      phone_number,
      cnic,
      zmcc_id: targetZmccId,
      user_id: linkedUserId,
      is_active: true,
      created_by: auth.actorUserId,
    },
    include: {
      zmcc: { select: { id: true, code: true, name: true, is_active: true } },
      user: { select: { id: true, username: true, full_name: true } },
      creator: { select: { id: true, username: true, full_name: true } },
    },
  });

  return {
    status: 201,
    data: {
      id: profile.id.toString(),
      mot_code: profile.mot_code,
      name: profile.name,
      phone_number: profile.phone_number,
      cnic: profile.cnic,
      zmcc_id: profile.zmcc_id.toString(),
      zmcc: {
        id: profile.zmcc.id.toString(),
        code: profile.zmcc.code,
        name: profile.zmcc.name,
        is_active: profile.zmcc.is_active,
      },
      user_id: profile.user_id ? profile.user_id.toString() : null,
      user: profile.user
        ? {
            id: profile.user.id.toString(),
            username: profile.user.username,
            full_name: profile.user.full_name,
          }
        : null,
      is_active: profile.is_active,
      created_by: profile.created_by.toString(),
      creator_name: profile.creator.full_name || profile.creator.username,
      created_at: profile.created_at.toISOString(),
      updated_at: profile.updated_at.toISOString(),
    },
  };
}

export async function updateMotProfile(
  auth: MotAuthContext,
  idStr: string,
  payload: {
    name?: string;
    phone_number?: string;
    cnic?: string;
    zmcc_id?: string;
    user_id?: string | null;
    is_active?: boolean;
  }
): Promise<ServiceResult<any>> {
  if (auth.isPheOperator) {
    return { status: 403, error: 'Forbidden. PHE Operators cannot update MOT profiles.' };
  }

  let id: bigint;
  try {
    id = BigInt(idStr);
  } catch {
    return { status: 400, error: 'Invalid MOT Profile ID format.' };
  }

  const existing = await prisma.motProfile.findUnique({
    where: { id },
    include: {
      journeys: {
        where: { status: 'COLLECTING' },
      },
    },
  });

  if (!existing) {
    return { status: 404, error: 'MOT Profile not found.' };
  }

  if (!auth.isSuperAdmin && existing.zmcc_id !== auth.effectiveZmccId) {
    return { status: 403, error: 'Forbidden. You cannot edit an MOT profile from another ZMCC.' };
  }

  const hasActiveJourney = existing.journeys.length > 0;

  // Deactivation check: blocked if active journey exists
  if (payload.is_active === false && hasActiveJourney) {
    return {
      status: 400,
      error: 'Cannot deactivate MOT Profile while an active COLLECTING journey is in progress.',
    };
  }

  const updateData: any = {
    updated_by: auth.actorUserId,
  };

  if (payload.name !== undefined) {
    const name = payload.name.trim();
    if (!name) return { status: 400, error: 'Name cannot be empty.' };
    updateData.name = name;
  }

  if (payload.phone_number !== undefined) {
    const phone = payload.phone_number.trim();
    if (!phone) return { status: 400, error: 'Phone number cannot be empty.' };
    if (!validatePhone(phone)) return { status: 400, error: 'Invalid Pakistani phone number format.' };
    updateData.phone_number = phone;
  }

  if (payload.cnic !== undefined) {
    const cnic = payload.cnic.trim();
    if (!cnic) return { status: 400, error: 'CNIC cannot be empty.' };
    if (!validateCnic(cnic)) return { status: 400, error: 'Invalid CNIC format.' };
    updateData.cnic = cnic;
  }

  if (payload.is_active !== undefined) {
    updateData.is_active = Boolean(payload.is_active);
  }

  // Transfer ZMCC: Only Super Admin, and only if no active journey
  if (payload.zmcc_id !== undefined) {
    if (!auth.isSuperAdmin) {
      return { status: 403, error: 'Forbidden. Only Super Admin can transfer an MOT Profile to another ZMCC.' };
    }
    if (hasActiveJourney) {
      return {
        status: 400,
        error: 'Cannot transfer MOT Profile to another ZMCC while an active COLLECTING journey is in progress.',
      };
    }
    try {
      const newZmccId = BigInt(payload.zmcc_id);
      const targetZmcc = await prisma.procurementSource.findUnique({ where: { id: newZmccId } });
      if (!targetZmcc || !targetZmcc.is_active || targetZmcc.source_type !== 'ZMCC') {
        return { status: 400, error: 'Target ZMCC does not exist or is inactive.' };
      }
      updateData.zmcc_id = newZmccId;
    } catch {
      return { status: 400, error: 'Invalid target ZMCC ID format.' };
    }
  }

  if (payload.user_id !== undefined) {
    if (payload.user_id === null || payload.user_id === '') {
      updateData.user_id = null;
    } else {
      try {
        const uId = BigInt(payload.user_id);
        const user = await prisma.user.findUnique({ where: { id: uId } });
        if (!user) return { status: 400, error: 'Linked user not found.' };
        if (user.role !== 'MOT') return { status: 400, error: "Linked user must have canonical role 'MOT'." };
        if (!user.is_active) return { status: 400, error: 'Linked user account is inactive.' };
        const assigned = await prisma.motProfile.findFirst({
          where: { user_id: uId, id: { not: id } },
        });
        if (assigned) return { status: 409, error: 'This user is already linked to another MOT profile.' };
        updateData.user_id = uId;
      } catch {
        return { status: 400, error: 'Invalid User ID format.' };
      }
    }
  }

  const updated = await prisma.motProfile.update({
    where: { id },
    data: updateData,
    include: {
      zmcc: { select: { id: true, code: true, name: true, is_active: true } },
      user: { select: { id: true, username: true, full_name: true } },
      creator: { select: { id: true, username: true, full_name: true } },
      updater: { select: { id: true, username: true, full_name: true } },
    },
  });

  return {
    status: 200,
    data: {
      id: updated.id.toString(),
      mot_code: updated.mot_code,
      name: updated.name,
      phone_number: updated.phone_number,
      cnic: updated.cnic,
      zmcc_id: updated.zmcc_id.toString(),
      zmcc: {
        id: updated.zmcc.id.toString(),
        code: updated.zmcc.code,
        name: updated.zmcc.name,
        is_active: updated.zmcc.is_active,
      },
      user_id: updated.user_id ? updated.user_id.toString() : null,
      user: updated.user
        ? {
            id: updated.user.id.toString(),
            username: updated.user.username,
            full_name: updated.user.full_name,
          }
        : null,
      is_active: updated.is_active,
      updated_by: updated.updated_by ? updated.updated_by.toString() : null,
      updater_name: updated.updater ? updated.updater.full_name || updated.updater.username : null,
      created_at: updated.created_at.toISOString(),
      updated_at: updated.updated_at.toISOString(),
    },
  };
}

// =============================================================
// MOT VEHICLES
// =============================================================

export async function listMotVehicles(
  auth: MotAuthContext,
  filters?: { zmcc_id?: string; is_active?: string; search?: string }
) {
  const where: any = {};

  if (auth.isSuperAdmin) {
    if (filters?.zmcc_id) {
      where.zmcc_id = BigInt(filters.zmcc_id);
    }
  } else {
    where.zmcc_id = auth.effectiveZmccId;
  }

  if (auth.isPheOperator) {
    where.is_active = true;
  } else if (filters?.is_active !== undefined && filters.is_active !== 'all') {
    where.is_active = filters.is_active === 'true';
  }

  if (filters?.search) {
    const s = filters.search.trim();
    where.vehicle_number = { contains: s, mode: 'insensitive' };
  }

  const vehicles = await prisma.motVehicle.findMany({
    where,
    orderBy: { vehicle_number: 'asc' },
    include: {
      zmcc: { select: { id: true, code: true, name: true, is_active: true } },
      creator: { select: { id: true, username: true, full_name: true } },
      updater: { select: { id: true, username: true, full_name: true } },
      journeys: {
        where: { status: 'COLLECTING' },
        select: { id: true, journey_number: true, status: true },
      },
    },
  });

  return vehicles.map((v) => ({
    id: v.id.toString(),
    vehicle_number: v.vehicle_number,
    zmcc_id: v.zmcc_id.toString(),
    zmcc: {
      id: v.zmcc.id.toString(),
      code: v.zmcc.code,
      name: v.zmcc.name,
      is_active: v.zmcc.is_active,
    },
    is_active: v.is_active,
    has_active_journey: v.journeys.length > 0,
    active_journey: v.journeys[0]
      ? {
          id: v.journeys[0].id.toString(),
          journey_number: v.journeys[0].journey_number,
          status: v.journeys[0].status,
        }
      : null,
    created_by: v.created_by.toString(),
    updated_by: v.updated_by ? v.updated_by.toString() : null,
    creator_name: v.creator.full_name || v.creator.username,
    updater_name: v.updater ? v.updater.full_name || v.updater.username : null,
    created_at: v.created_at.toISOString(),
    updated_at: v.updated_at.toISOString(),
  }));
}

export async function getMotVehicleById(
  auth: MotAuthContext,
  idStr: string
): Promise<ServiceResult<any>> {
  let id: bigint;
  try {
    id = BigInt(idStr);
  } catch {
    return { status: 400, error: 'Invalid MOT Vehicle ID format.' };
  }

  const vehicle = await prisma.motVehicle.findUnique({
    where: { id },
    include: {
      zmcc: { select: { id: true, code: true, name: true, is_active: true } },
      creator: { select: { id: true, username: true, full_name: true } },
      updater: { select: { id: true, username: true, full_name: true } },
      journeys: {
        where: { status: 'COLLECTING' },
        select: { id: true, journey_number: true, status: true },
      },
    },
  });

  if (!vehicle) {
    return { status: 404, error: 'MOT Vehicle not found.' };
  }

  if (!auth.isSuperAdmin && vehicle.zmcc_id !== auth.effectiveZmccId) {
    return { status: 403, error: 'Forbidden. You cannot access an MOT vehicle from another ZMCC.' };
  }

  return {
    status: 200,
    data: {
      id: vehicle.id.toString(),
      vehicle_number: vehicle.vehicle_number,
      zmcc_id: vehicle.zmcc_id.toString(),
      zmcc: {
        id: vehicle.zmcc.id.toString(),
        code: vehicle.zmcc.code,
        name: vehicle.zmcc.name,
        is_active: vehicle.zmcc.is_active,
      },
      is_active: vehicle.is_active,
      has_active_journey: vehicle.journeys.length > 0,
      active_journey: vehicle.journeys[0]
        ? {
            id: vehicle.journeys[0].id.toString(),
            journey_number: vehicle.journeys[0].journey_number,
            status: vehicle.journeys[0].status,
          }
        : null,
      created_by: vehicle.created_by.toString(),
      updated_by: vehicle.updated_by ? vehicle.updated_by.toString() : null,
      creator_name: vehicle.creator.full_name || vehicle.creator.username,
      updater_name: vehicle.updater ? vehicle.updater.full_name || vehicle.updater.username : null,
      created_at: vehicle.created_at.toISOString(),
      updated_at: vehicle.updated_at.toISOString(),
    },
  };
}

export async function createMotVehicle(
  auth: MotAuthContext,
  payload: {
    vehicle_number: string;
    zmcc_id?: string;
  }
): Promise<ServiceResult<any>> {
  if (auth.isPheOperator) {
    return { status: 403, error: 'Forbidden. PHE Operators cannot create MOT vehicles.' };
  }

  const vehicle_number = (payload.vehicle_number || '').trim().toUpperCase();
  if (!vehicle_number) return { status: 400, error: 'Vehicle number is required.' };

  let targetZmccId: bigint;
  if (auth.isSuperAdmin) {
    if (!payload.zmcc_id) {
      return { status: 400, error: 'ZMCC ID is required for Super Admin.' };
    }
    try {
      targetZmccId = BigInt(payload.zmcc_id);
    } catch {
      return { status: 400, error: 'Invalid ZMCC ID format.' };
    }
  } else {
    targetZmccId = auth.effectiveZmccId!;
  }

  const zmcc = await prisma.procurementSource.findUnique({ where: { id: targetZmccId } });
  if (!zmcc || !zmcc.is_active || zmcc.source_type !== 'ZMCC') {
    return { status: 400, error: 'Target ZMCC does not exist or is inactive.' };
  }

  const existing = await prisma.motVehicle.findUnique({
    where: { vehicle_number },
  });
  if (existing) {
    return { status: 409, error: `MOT Vehicle with number '${vehicle_number}' already exists.` };
  }

  const vehicle = await prisma.motVehicle.create({
    data: {
      vehicle_number,
      zmcc_id: targetZmccId,
      is_active: true,
      created_by: auth.actorUserId,
    },
    include: {
      zmcc: { select: { id: true, code: true, name: true, is_active: true } },
      creator: { select: { id: true, username: true, full_name: true } },
    },
  });

  return {
    status: 201,
    data: {
      id: vehicle.id.toString(),
      vehicle_number: vehicle.vehicle_number,
      zmcc_id: vehicle.zmcc_id.toString(),
      zmcc: {
        id: vehicle.zmcc.id.toString(),
        code: vehicle.zmcc.code,
        name: vehicle.zmcc.name,
        is_active: vehicle.zmcc.is_active,
      },
      is_active: vehicle.is_active,
      created_by: vehicle.created_by.toString(),
      creator_name: vehicle.creator.full_name || vehicle.creator.username,
      created_at: vehicle.created_at.toISOString(),
      updated_at: vehicle.updated_at.toISOString(),
    },
  };
}

export async function updateMotVehicle(
  auth: MotAuthContext,
  idStr: string,
  payload: {
    vehicle_number?: string;
    zmcc_id?: string;
    is_active?: boolean;
  }
): Promise<ServiceResult<any>> {
  if (auth.isPheOperator) {
    return { status: 403, error: 'Forbidden. PHE Operators cannot update MOT vehicles.' };
  }

  let id: bigint;
  try {
    id = BigInt(idStr);
  } catch {
    return { status: 400, error: 'Invalid MOT Vehicle ID format.' };
  }

  const existing = await prisma.motVehicle.findUnique({
    where: { id },
    include: {
      journeys: {
        where: { status: 'COLLECTING' },
      },
    },
  });

  if (!existing) {
    return { status: 404, error: 'MOT Vehicle not found.' };
  }

  if (!auth.isSuperAdmin && existing.zmcc_id !== auth.effectiveZmccId) {
    return { status: 403, error: 'Forbidden. You cannot edit an MOT vehicle from another ZMCC.' };
  }

  const hasActiveJourney = existing.journeys.length > 0;

  if (payload.is_active === false && hasActiveJourney) {
    return {
      status: 400,
      error: 'Cannot deactivate MOT Vehicle while an active COLLECTING journey is in progress.',
    };
  }

  const updateData: any = {
    updated_by: auth.actorUserId,
  };

  if (payload.vehicle_number !== undefined) {
    const vNum = payload.vehicle_number.trim().toUpperCase();
    if (!vNum) return { status: 400, error: 'Vehicle number cannot be empty.' };
    const duplicate = await prisma.motVehicle.findFirst({
      where: { vehicle_number: vNum, id: { not: id } },
    });
    if (duplicate) {
      return { status: 409, error: `Vehicle number '${vNum}' is already in use.` };
    }
    updateData.vehicle_number = vNum;
  }

  if (payload.is_active !== undefined) {
    updateData.is_active = Boolean(payload.is_active);
  }

  if (payload.zmcc_id !== undefined) {
    if (!auth.isSuperAdmin) {
      return { status: 403, error: 'Forbidden. Only Super Admin can transfer an MOT Vehicle to another ZMCC.' };
    }
    if (hasActiveJourney) {
      return {
        status: 400,
        error: 'Cannot transfer MOT Vehicle to another ZMCC while an active COLLECTING journey is in progress.',
      };
    }
    try {
      const newZmccId = BigInt(payload.zmcc_id);
      const targetZmcc = await prisma.procurementSource.findUnique({ where: { id: newZmccId } });
      if (!targetZmcc || !targetZmcc.is_active || targetZmcc.source_type !== 'ZMCC') {
        return { status: 400, error: 'Target ZMCC does not exist or is inactive.' };
      }
      updateData.zmcc_id = newZmccId;
    } catch {
      return { status: 400, error: 'Invalid target ZMCC ID format.' };
    }
  }

  const updated = await prisma.motVehicle.update({
    where: { id },
    data: updateData,
    include: {
      zmcc: { select: { id: true, code: true, name: true, is_active: true } },
      creator: { select: { id: true, username: true, full_name: true } },
      updater: { select: { id: true, username: true, full_name: true } },
    },
  });

  return {
    status: 200,
    data: {
      id: updated.id.toString(),
      vehicle_number: updated.vehicle_number,
      zmcc_id: updated.zmcc_id.toString(),
      zmcc: {
        id: updated.zmcc.id.toString(),
        code: updated.zmcc.code,
        name: updated.zmcc.name,
        is_active: updated.zmcc.is_active,
      },
      is_active: updated.is_active,
      updated_by: updated.updated_by ? updated.updated_by.toString() : null,
      updater_name: updated.updater ? updated.updater.full_name || updated.updater.username : null,
      created_at: updated.created_at.toISOString(),
      updated_at: updated.updated_at.toISOString(),
    },
  };
}

// =============================================================
// ASSIGN & DISPATCH (ATOMIC JOURNEY CREATION)
// =============================================================

export interface AssignAndDispatchPayload {
  zmcc_id?: string;
  route_id: string;
  mot_profile_id: string;
  mot_vehicle_id: string;
  operational_date?: string;
  latitude: number;
  longitude: number;
  accuracy?: number | null;
  idempotency_key?: string;
}

export async function assignAndDispatchJourney(
  auth: MotAuthContext,
  payload: AssignAndDispatchPayload
): Promise<ServiceResult<any>> {
  // 1. Authorize: Only SUPER_ADMIN, ZMCC_MANAGER, PHE_OPERATOR
  if (!auth.isSuperAdmin && !auth.isZmccManager && !auth.isPheOperator) {
    return { status: 403, error: 'Forbidden. You do not have permission to assign & dispatch MOT journeys.' };
  }

  // 2. Validate GPS coordinates
  const lat = Number(payload.latitude);
  const lng = Number(payload.longitude);
  if (isNaN(lat) || lat < -90 || lat > 90 || isNaN(lng) || lng < -180 || lng > 180) {
    return {
      status: 400,
      error: 'Valid GPS coordinates (latitude between -90 and 90, longitude between -180 and 180) are required for dispatch.',
    };
  }
  const accuracy = payload.accuracy != null && !isNaN(Number(payload.accuracy)) ? Number(payload.accuracy) : null;

  // 3. Validate ZMCC scope
  let targetZmccId: bigint;
  if (auth.isSuperAdmin) {
    if (!payload.zmcc_id) {
      return { status: 400, error: 'ZMCC ID is required.' };
    }
    try {
      targetZmccId = BigInt(payload.zmcc_id);
    } catch {
      return { status: 400, error: 'Invalid ZMCC ID format.' };
    }
  } else {
    targetZmccId = auth.effectiveZmccId!;
    if (payload.zmcc_id && BigInt(payload.zmcc_id) !== targetZmccId) {
      return { status: 403, error: 'Forbidden. Cannot assign journey for a different ZMCC.' };
    }
  }

  const zmcc = await prisma.procurementSource.findUnique({ where: { id: targetZmccId } });
  if (!zmcc || !zmcc.is_active || zmcc.source_type !== 'ZMCC') {
    return { status: 400, error: 'Selected ZMCC does not exist or is inactive.' };
  }

  // 4. Validate Operational Date (must be today in Pakistan Standard Time)
  const todayPktStr = getOperationalBusinessDate(new Date());
  if (payload.operational_date) {
    const inputDate = payload.operational_date.trim();
    if (inputDate !== todayPktStr) {
      return {
        status: 400,
        error: `Operational date must be today (${todayPktStr}) in Pakistan Standard Time.`,
      };
    }
  }
  const operationalDate = new Date(`${todayPktStr}T00:00:00.000Z`);

  // 5. Parse and validate IDs
  let routeId: bigint;
  let profileId: bigint;
  let vehicleId: bigint;
  try {
    routeId = BigInt(payload.route_id);
    profileId = BigInt(payload.mot_profile_id);
    vehicleId = BigInt(payload.mot_vehicle_id);
  } catch {
    return { status: 400, error: 'Invalid ID format for Route, MOT Profile, or Vehicle.' };
  }

  // 6. Verify Route: must belong to same ZMCC, must be active, must have active shops
  const route = await prisma.zmccRoute.findUnique({
    where: { id: routeId },
  });

  if (!route) {
    return { status: 404, error: 'Selected route not found.' };
  }
  if (route.zmcc_id !== targetZmccId) {
    return { status: 400, error: 'Selected route does not belong to the target ZMCC.' };
  }
  if (!route.is_active) {
    return { status: 400, error: 'Selected route is inactive.' };
  }

  const activeShops = await prisma.zmccShop.findMany({
    where: { route_id: routeId, is_active: true },
    orderBy: [{ shop_code: 'asc' }, { id: 'asc' }],
  });

  if (activeShops.length === 0) {
    return { status: 400, error: 'Selected route has no active shops to collect milk from.' };
  }

  // 7. Verify MOT Profile: must belong to same ZMCC, must be active
  const profile = await prisma.motProfile.findUnique({
    where: { id: profileId },
  });
  if (!profile) {
    return { status: 404, error: 'Selected MOT Profile not found.' };
  }
  if (profile.zmcc_id !== targetZmccId) {
    return { status: 400, error: 'Selected MOT Profile does not belong to the target ZMCC.' };
  }
  if (!profile.is_active) {
    return { status: 400, error: 'Selected MOT Profile is inactive.' };
  }

  // 8. Verify MOT Vehicle: must belong to same ZMCC, must be active
  const vehicle = await prisma.motVehicle.findUnique({
    where: { id: vehicleId },
  });
  if (!vehicle) {
    return { status: 404, error: 'Selected MOT Vehicle not found.' };
  }
  if (vehicle.zmcc_id !== targetZmccId) {
    return { status: 400, error: 'Selected MOT Vehicle does not belong to the target ZMCC.' };
  }
  if (!vehicle.is_active) {
    return { status: 400, error: 'Selected MOT Vehicle is inactive.' };
  }

  // 9. Check active COLLECTING journeys for profile and vehicle
  const existingProfileJourney = await prisma.motJourney.findFirst({
    where: { mot_profile_id: profileId, status: 'COLLECTING' },
  });
  if (existingProfileJourney) {
    return {
      status: 409,
      error: `MOT Profile '${profile.name}' is already assigned to active journey #${existingProfileJourney.journey_number}.`,
    };
  }

  const existingVehicleJourney = await prisma.motJourney.findFirst({
    where: { mot_vehicle_id: vehicleId, status: 'COLLECTING' },
  });
  if (existingVehicleJourney) {
    return {
      status: 409,
      error: `MOT Vehicle '${vehicle.vehicle_number}' is already assigned to active journey #${existingVehicleJourney.journey_number}.`,
    };
  }

  // 10. Idempotency Key
  const idempotencyKey =
    (payload.idempotency_key || '').trim() ||
    `DISP-${targetZmccId}-${profileId}-${vehicleId}-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

  // Check if journey already created with this idempotency key
  const existingWithKey = await prisma.motJourney.findUnique({
    where: { idempotency_key: idempotencyKey },
    include: {
      zmcc: { select: { id: true, code: true, name: true } },
      route: { select: { id: true, route_code: true, name: true } },
      mot_profile: { select: { id: true, mot_code: true, name: true, phone_number: true } },
      mot_vehicle: { select: { id: true, vehicle_number: true } },
      stops: {
        include: {
          shop: { select: { id: true, shop_code: true, shop_name: true, owner_name: true } },
        },
        orderBy: { planned_sequence: 'asc' },
      },
      locations: {
        orderBy: { device_recorded_at: 'asc' },
      },
    },
  });
  if (existingWithKey) {
    return { status: 200, data: serializeJourney(existingWithKey) };
  }

  // 11. Execute Atomic Transaction:
  // - Generate journey number
  // - Create MotJourney (status: COLLECTING, assigned_at = started_at = NOW)
  // - Create MotJourneyLocation (ASSIGNING_USER)
  // - Freeze MotJourneyStop rows (ordered active shops)
  const now = new Date();
  const dateCode = todayPktStr.replace(/-/g, '');

  try {
    const result = await prisma.$transaction(async (tx) => {
      // Generate unique sequence
      const todayCount = await tx.motJourney.count({
        where: {
          journey_number: { startsWith: `MJ-${dateCode}` },
        },
      });
      let seq = todayCount + 1;
      let journeyNumber = `MJ-${dateCode}-${String(seq).padStart(4, '0')}`;
      while (await tx.motJourney.findUnique({ where: { journey_number: journeyNumber } })) {
        seq++;
        journeyNumber = `MJ-${dateCode}-${String(seq).padStart(4, '0')}`;
      }

      // Create MotJourney
      const journey = await tx.motJourney.create({
        data: {
          journey_number: journeyNumber,
          operational_date: operationalDate,
          zmcc_id: targetZmccId,
          route_id: routeId,
          mot_profile_id: profileId,
          mot_vehicle_id: vehicleId,
          status: 'COLLECTING',
          assigned_by: auth.actorUserId,
          assigned_at: now,
          assignment_latitude: lat,
          assignment_longitude: lng,
          assignment_gps_accuracy: accuracy,
          started_at: now,
          start_latitude: lat,
          start_longitude: lng,
          idempotency_key: idempotencyKey,
        },
      });

      // Create Initial Location Record
      await tx.motJourneyLocation.create({
        data: {
          journey_id: journey.id,
          recorded_by_user_id: auth.actorUserId,
          source_type: 'ASSIGNING_USER',
          latitude: lat,
          longitude: lng,
          gps_accuracy: accuracy,
          device_recorded_at: now,
          server_received_at: now,
          idempotency_key: `${idempotencyKey}-loc-0`,
        },
      });

      // Snapshot active shops from route as MotJourneyStop rows in stable sequence
      const stopsData = activeShops.map((s, idx) => ({
        journey_id: journey.id,
        shop_id: s.id,
        planned_sequence: idx + 1,
        status: 'PENDING',
      }));

      await tx.motJourneyStop.createMany({
        data: stopsData,
      });

      return journey;
    });

    // Fetch full created journey with relations
    const fullJourney = await prisma.motJourney.findUnique({
      where: { id: result.id },
      include: {
        zmcc: { select: { id: true, code: true, name: true } },
        route: { select: { id: true, route_code: true, name: true } },
        mot_profile: { select: { id: true, mot_code: true, name: true, phone_number: true } },
        mot_vehicle: { select: { id: true, vehicle_number: true } },
        assigner: { select: { id: true, username: true, full_name: true } },
        stops: {
          include: {
            shop: { select: { id: true, shop_code: true, shop_name: true, owner_name: true } },
          },
          orderBy: { planned_sequence: 'asc' },
        },
        locations: {
          orderBy: { device_recorded_at: 'asc' },
        },
      },
    });

    return { status: 201, data: serializeJourney(fullJourney!) };
  } catch (err: any) {
    if (err.code === 'P2002') {
      return {
        status: 409,
        error: 'A concurrent journey is already active for this MOT profile or vehicle.',
      };
    }
    throw err;
  }
}

// =============================================================
// CANCELLATION
// =============================================================

export async function cancelMotJourney(
  auth: MotAuthContext,
  journeyIdStr: string,
  reason: string
): Promise<ServiceResult<any>> {
  // Only SUPER_ADMIN and same-ZMCC ZMCC_MANAGER can cancel
  if (!auth.isSuperAdmin && !auth.isZmccManager) {
    return {
      status: 403,
      error: 'Forbidden. Only Super Admin or the assigned ZMCC Manager can cancel an MOT journey.',
    };
  }

  const cleanReason = (reason || '').trim();
  if (!cleanReason || cleanReason.length < 3) {
    return {
      status: 400,
      error: 'A valid cancellation reason (minimum 3 characters) is required.',
    };
  }

  let journeyId: bigint;
  try {
    journeyId = BigInt(journeyIdStr);
  } catch {
    return { status: 400, error: 'Invalid Journey ID format.' };
  }

  const journey = await prisma.motJourney.findUnique({
    where: { id: journeyId },
    include: {
      zmcc: true,
      mot_profile: true,
      mot_vehicle: true,
    },
  });

  if (!journey) {
    return { status: 404, error: 'Journey not found.' };
  }

  if (!auth.isSuperAdmin && journey.zmcc_id !== auth.effectiveZmccId) {
    return {
      status: 403,
      error: 'Forbidden. You cannot cancel a journey from another ZMCC.',
    };
  }

  if (journey.status !== 'COLLECTING') {
    return {
      status: 400,
      error: `Cannot cancel journey in '${journey.status}' status. Only active COLLECTING journeys can be cancelled.`,
    };
  }

  const updated = await prisma.motJourney.update({
    where: { id: journeyId },
    data: {
      status: 'CANCELLED',
      cancelled_at: new Date(),
      cancelled_by: auth.actorUserId,
      cancellation_reason: cleanReason,
    },
    include: {
      zmcc: { select: { id: true, code: true, name: true } },
      route: { select: { id: true, route_code: true, name: true } },
      mot_profile: { select: { id: true, mot_code: true, name: true, phone_number: true } },
      mot_vehicle: { select: { id: true, vehicle_number: true } },
      assigner: { select: { id: true, username: true, full_name: true } },
      canceller: { select: { id: true, username: true, full_name: true } },
      stops: {
        include: {
          shop: { select: { id: true, shop_code: true, shop_name: true, owner_name: true } },
        },
        orderBy: { planned_sequence: 'asc' },
      },
    },
  });

  return { status: 200, data: serializeJourney(updated) };
}

// =============================================================
// LIST & GET JOURNEYS
// =============================================================

export async function listMotJourneys(
  auth: MotAuthContext,
  filters?: {
    zmcc_id?: string;
    status?: string;
    operational_date?: string;
    route_id?: string;
    mot_profile_id?: string;
    mot_vehicle_id?: string;
  }
) {
  const where: any = {};

  if (auth.isSuperAdmin) {
    if (filters?.zmcc_id) {
      where.zmcc_id = BigInt(filters.zmcc_id);
    }
  } else {
    where.zmcc_id = auth.effectiveZmccId;
  }

  if (filters?.status && filters.status !== 'all') {
    where.status = filters.status;
  }

  if (filters?.operational_date) {
    where.operational_date = new Date(`${filters.operational_date}T00:00:00.000Z`);
  }

  if (filters?.route_id) {
    where.route_id = BigInt(filters.route_id);
  }

  if (filters?.mot_profile_id) {
    where.mot_profile_id = BigInt(filters.mot_profile_id);
  }

  if (filters?.mot_vehicle_id) {
    where.mot_vehicle_id = BigInt(filters.mot_vehicle_id);
  }

  const journeys = await prisma.motJourney.findMany({
    where,
    orderBy: { assigned_at: 'desc' },
    include: {
      zmcc: { select: { id: true, code: true, name: true } },
      route: { select: { id: true, route_code: true, name: true } },
      mot_profile: { select: { id: true, mot_code: true, name: true, phone_number: true } },
      mot_vehicle: { select: { id: true, vehicle_number: true } },
      assigner: { select: { id: true, username: true, full_name: true } },
      canceller: { select: { id: true, username: true, full_name: true } },
      _count: { select: { stops: true } },
    },
  });

  return journeys.map((j) => ({
    id: j.id.toString(),
    journey_number: j.journey_number,
    operational_date: j.operational_date.toISOString().split('T')[0],
    zmcc_id: j.zmcc_id.toString(),
    zmcc: {
      id: j.zmcc.id.toString(),
      code: j.zmcc.code,
      name: j.zmcc.name,
    },
    route_id: j.route_id.toString(),
    route: {
      id: j.route.id.toString(),
      route_code: j.route.route_code,
      name: j.route.name,
    },
    mot_profile_id: j.mot_profile_id.toString(),
    mot_profile: {
      id: j.mot_profile.id.toString(),
      mot_code: j.mot_profile.mot_code,
      name: j.mot_profile.name,
      phone_number: j.mot_profile.phone_number,
    },
    mot_vehicle_id: j.mot_vehicle_id.toString(),
    mot_vehicle: {
      id: j.mot_vehicle.id.toString(),
      vehicle_number: j.mot_vehicle.vehicle_number,
    },
    status: j.status,
    assigned_by: j.assigned_by.toString(),
    assigned_by_name: j.assigner.full_name || j.assigner.username,
    assigned_at: j.assigned_at.toISOString(),
    assignment_latitude: Number(j.assignment_latitude),
    assignment_longitude: Number(j.assignment_longitude),
    assignment_gps_accuracy: j.assignment_gps_accuracy != null ? Number(j.assignment_gps_accuracy) : null,
    started_at: j.started_at.toISOString(),
    start_latitude: Number(j.start_latitude),
    start_longitude: Number(j.start_longitude),
    first_mot_gps_at: j.first_mot_gps_at ? j.first_mot_gps_at.toISOString() : null,
    first_mot_latitude: j.first_mot_latitude != null ? Number(j.first_mot_latitude) : null,
    first_mot_longitude: j.first_mot_longitude != null ? Number(j.first_mot_longitude) : null,
    first_mot_gps_accuracy: j.first_mot_gps_accuracy != null ? Number(j.first_mot_gps_accuracy) : null,
    idempotency_key: j.idempotency_key,
    ended_at: j.ended_at ? j.ended_at.toISOString() : null,
    cancelled_by: j.cancelled_by ? j.cancelled_by.toString() : null,
    cancelled_by_name: j.canceller ? j.canceller.full_name || j.canceller.username : null,
    cancelled_at: j.cancelled_at ? j.cancelled_at.toISOString() : null,
    cancellation_reason: j.cancellation_reason,
    total_stops: j._count.stops,
    created_at: j.created_at.toISOString(),
    updated_at: j.updated_at.toISOString(),
  }));
}

export async function getMotJourneyById(
  auth: MotAuthContext,
  idStr: string
): Promise<ServiceResult<any>> {
  let id: bigint;
  try {
    id = BigInt(idStr);
  } catch {
    return { status: 400, error: 'Invalid Journey ID format.' };
  }

  const journey = await prisma.motJourney.findUnique({
    where: { id },
    include: {
      zmcc: { select: { id: true, code: true, name: true } },
      route: { select: { id: true, route_code: true, name: true } },
      mot_profile: { select: { id: true, mot_code: true, name: true, phone_number: true } },
      mot_vehicle: { select: { id: true, vehicle_number: true } },
      assigner: { select: { id: true, username: true, full_name: true } },
      canceller: { select: { id: true, username: true, full_name: true } },
      stops: {
        include: {
          shop: { select: { id: true, shop_code: true, shop_name: true, owner_name: true, phone_number: true } },
        },
        orderBy: { planned_sequence: 'asc' },
      },
      locations: {
        orderBy: { device_recorded_at: 'asc' },
      },
    },
  });

  if (!journey) {
    return { status: 404, error: 'Journey not found.' };
  }

  if (!auth.isSuperAdmin && journey.zmcc_id !== auth.effectiveZmccId) {
    return { status: 403, error: 'Forbidden. You cannot access a journey from another ZMCC.' };
  }

  return { status: 200, data: serializeJourney(journey) };
}

// =============================================================
// MOT CURRENT ACTIVE JOURNEY (FOR MOT DRIVER)
// =============================================================

export async function getCurrentMotJourney(auth: MotAuthContext): Promise<ServiceResult<any>> {
  // Find MOT Profile linked to this user
  const motProfile = await prisma.motProfile.findUnique({
    where: { user_id: auth.actorUserId },
  });

  if (!motProfile) {
    return {
      status: 200,
      data: {
        journey: null,
        message: 'No MOT Profile is linked to your user account.',
      },
    };
  }

  // Find active COLLECTING journey
  const activeJourney = await prisma.motJourney.findFirst({
    where: {
      mot_profile_id: motProfile.id,
      status: 'COLLECTING',
    },
    include: {
      zmcc: { select: { id: true, code: true, name: true } },
      route: { select: { id: true, route_code: true, name: true } },
      mot_profile: { select: { id: true, mot_code: true, name: true, phone_number: true } },
      mot_vehicle: { select: { id: true, vehicle_number: true } },
      assigner: { select: { id: true, username: true, full_name: true } },
      stops: {
        include: {
          shop: { select: { id: true, shop_code: true, shop_name: true, owner_name: true, phone_number: true } },
        },
        orderBy: { planned_sequence: 'asc' },
      },
    },
  });

  if (!activeJourney) {
    return {
      status: 200,
      data: {
        journey: null,
        message: 'No active collection journey assigned.',
      },
    };
  }

  return { status: 200, data: { journey: serializeJourney(activeJourney) } };
}

// Helper: Serializes BigInt and Decimal fields for clean JSON responses
function serializeJourney(j: any) {
  return {
    id: j.id.toString(),
    journey_number: j.journey_number,
    operational_date: j.operational_date.toISOString().split('T')[0],
    zmcc_id: j.zmcc_id.toString(),
    zmcc: j.zmcc
      ? {
          id: j.zmcc.id.toString(),
          code: j.zmcc.code,
          name: j.zmcc.name,
        }
      : null,
    route_id: j.route_id.toString(),
    route: j.route
      ? {
          id: j.route.id.toString(),
          route_code: j.route.route_code,
          name: j.route.name,
        }
      : null,
    mot_profile_id: j.mot_profile_id.toString(),
    mot_profile: j.mot_profile
      ? {
          id: j.mot_profile.id.toString(),
          mot_code: j.mot_profile.mot_code,
          name: j.mot_profile.name,
          phone_number: j.mot_profile.phone_number,
        }
      : null,
    mot_vehicle_id: j.mot_vehicle_id.toString(),
    mot_vehicle: j.mot_vehicle
      ? {
          id: j.mot_vehicle.id.toString(),
          vehicle_number: j.mot_vehicle.vehicle_number,
        }
      : null,
    status: j.status,
    assigned_by: j.assigned_by.toString(),
    assigned_by_name: j.assigner ? j.assigner.full_name || j.assigner.username : null,
    assigned_at: j.assigned_at.toISOString(),
    assignment_latitude: Number(j.assignment_latitude),
    assignment_longitude: Number(j.assignment_longitude),
    assignment_gps_accuracy: j.assignment_gps_accuracy != null ? Number(j.assignment_gps_accuracy) : null,
    started_at: j.started_at.toISOString(),
    start_latitude: Number(j.start_latitude),
    start_longitude: Number(j.start_longitude),
    first_mot_gps_at: j.first_mot_gps_at ? j.first_mot_gps_at.toISOString() : null,
    first_mot_latitude: j.first_mot_latitude != null ? Number(j.first_mot_latitude) : null,
    first_mot_longitude: j.first_mot_longitude != null ? Number(j.first_mot_longitude) : null,
    first_mot_gps_accuracy: j.first_mot_gps_accuracy != null ? Number(j.first_mot_gps_accuracy) : null,
    idempotency_key: j.idempotency_key,
    ended_at: j.ended_at ? j.ended_at.toISOString() : null,
    cancelled_by: j.cancelled_by ? j.cancelled_by.toString() : null,
    cancelled_by_name: j.canceller ? j.canceller.full_name || j.canceller.username : null,
    cancelled_at: j.cancelled_at ? j.cancelled_at.toISOString() : null,
    cancellation_reason: j.cancellation_reason,
    stops: (j.stops || []).map((s: any) => ({
      id: s.id.toString(),
      journey_id: s.journey_id.toString(),
      shop_id: s.shop_id.toString(),
      planned_sequence: s.planned_sequence,
      status: s.status,
      arrived_at: s.arrived_at ? s.arrived_at.toISOString() : null,
      completed_at: s.completed_at ? s.completed_at.toISOString() : null,
      skipped_at: s.skipped_at ? s.skipped_at.toISOString() : null,
      skip_reason: s.skip_reason,
      shop: s.shop
        ? {
            id: s.shop.id.toString(),
            shop_code: s.shop.shop_code,
            shop_name: s.shop.shop_name,
            owner_name: s.shop.owner_name,
            phone_number: s.shop.phone_number,
            contact_number: s.shop.phone_number,
          }
        : null,
    })),
    locations: (j.locations || []).map((l: any) => ({
      id: l.id.toString(),
      journey_id: l.journey_id.toString(),
      recorded_by_user_id: l.recorded_by_user_id ? l.recorded_by_user_id.toString() : null,
      source_type: l.source_type,
      latitude: Number(l.latitude),
      longitude: Number(l.longitude),
      gps_accuracy: l.gps_accuracy != null ? Number(l.gps_accuracy) : null,
      device_recorded_at: l.device_recorded_at.toISOString(),
      server_received_at: l.server_received_at.toISOString(),
      idempotency_key: l.idempotency_key,
    })),
    created_at: j.created_at.toISOString(),
    updated_at: j.updated_at.toISOString(),
  };
}
