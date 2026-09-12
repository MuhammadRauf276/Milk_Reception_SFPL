import { prisma } from '@core/db';
import { Prisma } from '@prisma/client';
import { getCurrentUser } from '@core/auth';
import { User, Role } from '@core/types';
import { getPakistanCalendarDate } from '@core/business-day';
import { validatePhone, validateCnic } from './zmccMasterDataService';
import {
  computeCanonicalMilkMetrics,
  formatCollectionSmsMessage,
  MOT_CALCULATION_VERSION,
} from '@backend/utils/milkFormulas';
import {
  recomputeMotJourneySummaryTx,
  serializeMotJourneySummary,
} from './motJourneySummaryService';

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
  | 'READ_CURRENT_JOURNEY'
  | 'SUBMIT_COLLECTION'
  | 'UPLOAD_GPS'
  | 'READ_MAP'
  | 'READ_SMS_OUTBOX'
  | 'READ_COLLECTIONS';

export interface ServiceResult<T> {
  status: number;
  data?: T;
  error?: string;
}

/**
 * Server-side Authorization & Scope Resolver for MOT Operations
 */
export async function resolveMotAuth(
  reqOrUser?: Request | User,
  action: MotAction = 'READ'
): Promise<{ auth?: MotAuthContext; errorResponse?: { error: string; status: number } }> {
  let authUser: User | null = null;
  if (reqOrUser && 'role' in reqOrUser && 'id' in reqOrUser) {
    authUser = reqOrUser as User;
  } else {
    authUser = await getCurrentUser(reqOrUser as Request);
  }
  if (!authUser) {
    return { errorResponse: { error: 'Unauthorized. Authentication required.', status: 401 } };
  }

  const actorUserId = BigInt(String(authUser.id).trim());
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
  } else if (action === 'SUBMIT_COLLECTION' || action === 'UPLOAD_GPS') {
    // Only exact canonical linked MOT role is authorized to submit collections or upload live GPS
    if (!isMot) {
      return {
        errorResponse: {
          error: 'Forbidden. Only canonical linked MOT operators may perform this action.',
          status: 403,
        },
      };
    }
  } else if (action === 'READ_MAP' || action === 'READ_SMS_OUTBOX') {
    // Management tracking and SMS view
    if (!isSuperAdmin && !isZmccManager && !isPheOperator) {
      return {
        errorResponse: {
          error: 'Forbidden. Access restricted to management roles.',
          status: 403,
        },
      };
    }
  } else if (action === 'READ_COLLECTIONS') {
    // Exact canonical authorization: SUPER_ADMIN, ZMCC_MANAGER, PHE_OPERATOR, MOT
    // Every other role (or legacy role) returns 403
    if (!isSuperAdmin && !isZmccManager && !isPheOperator && !isMot) {
      return {
        errorResponse: {
          error: 'Forbidden. Role not permitted to read journey collections.',
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

async function validateLinkedMotUser(
  userId: bigint,
  targetZmccId: bigint,
  excludeProfileId?: bigint
): Promise<{ error?: string; status?: number }> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { procurement_source: true },
  });

  if (!user) {
    return { error: 'Linked user not found.', status: 400 };
  }
  if (user.role !== 'MOT') {
    return { error: "Linked user must have canonical role 'MOT'.", status: 400 };
  }
  if (!user.is_active) {
    return { error: 'Linked user account is inactive.', status: 400 };
  }
  if (user.scope_type !== 'SOURCE') {
    return { error: "Linked user must have scope_type 'SOURCE'.", status: 400 };
  }
  if (!user.procurement_source_id || !user.procurement_source) {
    return { error: 'Linked user must be assigned to an active procurement source.', status: 400 };
  }
  if (!user.procurement_source.is_active) {
    return { error: 'Linked user assigned procurement source is inactive.', status: 400 };
  }
  if (user.procurement_source.source_type !== 'ZMCC') {
    return { error: 'Linked user assigned procurement source must be a ZMCC.', status: 400 };
  }
  if (user.procurement_source_id !== targetZmccId) {
    return { error: 'Linked user must be assigned to the same ZMCC as the MOT Profile.', status: 400 };
  }

  const whereAssigned: any = { user_id: userId };
  if (excludeProfileId) {
    whereAssigned.id = { not: excludeProfileId };
  }
  const assigned = await prisma.motProfile.findFirst({ where: whereAssigned });
  if (assigned) {
    return { error: 'This user is already linked to another MOT Profile.', status: 409 };
  }

  return {};
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
    } catch {
      return { status: 400, error: 'Invalid User ID format.' };
    }
    const userValidation = await validateLinkedMotUser(linkedUserId, targetZmccId);
    if (userValidation.error) {
      return { status: userValidation.status || 400, error: userValidation.error };
    }
  }

  const profile = await prisma.$transaction(async (tx) => {
    const p = await tx.motProfile.create({
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

    await tx.auditLog.create({
      data: {
        table_name: 'mot_profile',
        record_id: p.id,
        action: 'MOT_PROFILE_CREATED',
        old_values: Prisma.DbNull,
        new_values: {
          mot_code: p.mot_code,
          name: p.name,
          phone_number: p.phone_number,
          cnic: p.cnic,
          zmcc_id: p.zmcc_id.toString(),
          user_id: p.user_id ? p.user_id.toString() : null,
          is_active: p.is_active,
        },
        user_id: auth.actorUserId,
      },
    });

    return p;
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

  let targetZmccId = existing.zmcc_id;

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
      targetZmccId = newZmccId;
      updateData.zmcc_id = newZmccId;
    } catch {
      return { status: 400, error: 'Invalid target ZMCC ID format.' };
    }

    // If user_id is not explicitly changed in this request, verify current linked user belongs to new ZMCC
    if (payload.user_id === undefined && existing.user_id !== null) {
      const currentUser = await prisma.user.findUnique({
        where: { id: existing.user_id },
        include: { procurement_source: true },
      });
      if (currentUser && currentUser.procurement_source_id !== targetZmccId) {
        return {
          status: 400,
          error:
            'Cannot transfer MOT Profile to another ZMCC while linked to a user assigned to a different ZMCC. Reassign or unlink the user first.',
        };
      }
    }
  }

  if (payload.user_id !== undefined) {
    if (payload.user_id === null || payload.user_id === '') {
      updateData.user_id = null;
    } else {
      try {
        const uId = BigInt(payload.user_id);
        const userValidation = await validateLinkedMotUser(uId, targetZmccId, id);
        if (userValidation.error) {
          return { status: userValidation.status || 400, error: userValidation.error };
        }
        updateData.user_id = uId;
      } catch {
        return { status: 400, error: 'Invalid User ID format.' };
      }
    }
  }

  const updated = await prisma.$transaction(async (tx) => {
    const p = await tx.motProfile.update({
      where: { id },
      data: updateData,
      include: {
        zmcc: { select: { id: true, code: true, name: true, is_active: true } },
        user: { select: { id: true, username: true, full_name: true } },
        creator: { select: { id: true, username: true, full_name: true } },
        updater: { select: { id: true, username: true, full_name: true } },
      },
    });

    let actionName = 'MOT_PROFILE_UPDATED';
    if (payload.is_active !== undefined && payload.is_active !== existing.is_active) {
      actionName = payload.is_active ? 'MOT_PROFILE_ACTIVATED' : 'MOT_PROFILE_DEACTIVATED';
    } else if (payload.zmcc_id !== undefined && BigInt(payload.zmcc_id) !== existing.zmcc_id) {
      actionName = 'MOT_PROFILE_TRANSFERRED';
    } else if (
      payload.user_id !== undefined &&
      (payload.user_id ? BigInt(payload.user_id) : null) !== existing.user_id
    ) {
      actionName = 'MOT_PROFILE_USER_LINKED';
    }

    await tx.auditLog.create({
      data: {
        table_name: 'mot_profile',
        record_id: p.id,
        action: actionName,
        old_values: {
          mot_code: existing.mot_code,
          name: existing.name,
          phone_number: existing.phone_number,
          cnic: existing.cnic,
          zmcc_id: existing.zmcc_id.toString(),
          user_id: existing.user_id ? existing.user_id.toString() : null,
          is_active: existing.is_active,
        },
        new_values: {
          mot_code: p.mot_code,
          name: p.name,
          phone_number: p.phone_number,
          cnic: p.cnic,
          zmcc_id: p.zmcc_id.toString(),
          user_id: p.user_id ? p.user_id.toString() : null,
          is_active: p.is_active,
        },
        user_id: auth.actorUserId,
      },
    });

    return p;
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

  const vehicle = await prisma.$transaction(async (tx) => {
    const v = await tx.motVehicle.create({
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

    await tx.auditLog.create({
      data: {
        table_name: 'mot_vehicle',
        record_id: v.id,
        action: 'MOT_VEHICLE_CREATED',
        old_values: Prisma.DbNull,
        new_values: {
          vehicle_number: v.vehicle_number,
          zmcc_id: v.zmcc_id.toString(),
          is_active: v.is_active,
        },
        user_id: auth.actorUserId,
      },
    });

    return v;
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

  const updated = await prisma.$transaction(async (tx) => {
    const v = await tx.motVehicle.update({
      where: { id },
      data: updateData,
      include: {
        zmcc: { select: { id: true, code: true, name: true, is_active: true } },
        creator: { select: { id: true, username: true, full_name: true } },
        updater: { select: { id: true, username: true, full_name: true } },
      },
    });

    let actionName = 'MOT_VEHICLE_UPDATED';
    if (payload.is_active !== undefined && payload.is_active !== existing.is_active) {
      actionName = payload.is_active ? 'MOT_VEHICLE_ACTIVATED' : 'MOT_VEHICLE_DEACTIVATED';
    } else if (payload.zmcc_id !== undefined && BigInt(payload.zmcc_id) !== existing.zmcc_id) {
      actionName = 'MOT_VEHICLE_TRANSFERRED';
    }

    await tx.auditLog.create({
      data: {
        table_name: 'mot_vehicle',
        record_id: v.id,
        action: actionName,
        old_values: {
          vehicle_number: existing.vehicle_number,
          zmcc_id: existing.zmcc_id.toString(),
          is_active: existing.is_active,
        },
        new_values: {
          vehicle_number: v.vehicle_number,
          zmcc_id: v.zmcc_id.toString(),
          is_active: v.is_active,
        },
        user_id: auth.actorUserId,
      },
    });

    return v;
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

  // 2. Validate client-provided idempotency_key early (required, non-empty)
  const rawKey = payload.idempotency_key;
  if (!rawKey || typeof rawKey !== 'string' || !rawKey.trim()) {
    return {
      status: 400,
      error: 'A non-empty client idempotency_key is required for Assign & Dispatch.',
    };
  }
  const idempotencyKey = rawKey.trim();

  // 3. Validate GPS coordinates
  const lat = Number(payload.latitude);
  const lng = Number(payload.longitude);
  if (isNaN(lat) || lat < -90 || lat > 90 || isNaN(lng) || lng < -180 || lng > 180) {
    return {
      status: 400,
      error: 'Valid GPS coordinates (latitude between -90 and 90, longitude between -180 and 180) are required for dispatch.',
    };
  }
  const accuracy = payload.accuracy != null && !isNaN(Number(payload.accuracy)) ? Number(payload.accuracy) : null;

  // 4. Validate ZMCC scope
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
    if (payload.zmcc_id !== undefined && payload.zmcc_id !== null && String(payload.zmcc_id).trim() !== '') {
      let providedZmccId: bigint;
      try {
        providedZmccId = BigInt(payload.zmcc_id);
      } catch {
        return { status: 400, error: 'Invalid ZMCC ID format.' };
      }
      if (providedZmccId !== targetZmccId) {
        return { status: 403, error: 'Forbidden. Cannot assign journey for a different ZMCC.' };
      }
    }
  }

  const zmcc = await prisma.procurementSource.findUnique({ where: { id: targetZmccId } });
  if (!zmcc || !zmcc.is_active || zmcc.source_type !== 'ZMCC') {
    return { status: 400, error: 'Selected ZMCC does not exist or is inactive.' };
  }

  // 5. Validate Operational Date (must be today in Pakistan Standard Time calendar date)
  const todayPktStr = getPakistanCalendarDate(new Date());
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

  // 6. Parse and validate IDs
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

  // Helpers for idempotent journey lookup and validation
  const findFullJourneyByIdempotencyKey = async (key: string) => {
    return prisma.motJourney.findUnique({
      where: { idempotency_key: key },
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
  };

  const validateAndReturnExistingJourney = (existing: any) => {
    // Cross-ZMCC: Never return another ZMCC's journey through an idempotency-key lookup
    if (existing.zmcc_id !== targetZmccId) {
      return {
        status: 409,
        error: 'The provided idempotency key is already in use for another ZMCC.',
      };
    }

    const existingOpDateStr = existing.operational_date.toISOString().split('T')[0];
    const isSameRoute = existing.route_id === routeId;
    const isSameProfile = existing.mot_profile_id === profileId;
    const isSameVehicle = existing.mot_vehicle_id === vehicleId;
    const isSameDate = existingOpDateStr === todayPktStr;

    if (!isSameRoute || !isSameProfile || !isSameVehicle || !isSameDate) {
      return {
        status: 409,
        error: 'The provided idempotency key is already in use with different journey parameters.',
      };
    }

    return { status: 200, data: serializeJourney(existing) };
  };

  // 7. Look up Idempotency Key BEFORE conflict checks
  const existingWithKey = await findFullJourneyByIdempotencyKey(idempotencyKey);
  if (existingWithKey) {
    return validateAndReturnExistingJourney(existingWithKey);
  }

  // 8. Verify Route: must belong to same ZMCC, must be active, must have active shops
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

  // Deterministically snapshot active shops: area.area_code ASC, shop_code ASC, id ASC
  const activeShops = await prisma.zmccShop.findMany({
    where: { route_id: routeId, is_active: true },
    include: {
      area: { select: { id: true, area_code: true, name: true } },
    },
    orderBy: [
      { area: { area_code: 'asc' } },
      { shop_code: 'asc' },
      { id: 'asc' },
    ],
  });

  if (activeShops.length === 0) {
    return { status: 400, error: 'Selected route has no active shops to collect milk from.' };
  }

  // 9. Verify MOT Profile: must belong to same ZMCC, must be active
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

  // 10. Verify MOT Vehicle: must belong to same ZMCC, must be active
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

  // 11. Check active COLLECTING journeys for profile and vehicle
  const existingProfileJourney = await prisma.motJourney.findFirst({
    where: { mot_profile_id: profileId, status: 'COLLECTING' },
  });
  if (existingProfileJourney) {
    if (existingProfileJourney.idempotency_key === idempotencyKey) {
      const full = await findFullJourneyByIdempotencyKey(idempotencyKey);
      if (full) return validateAndReturnExistingJourney(full);
    }
    const existingConcurrent = await findFullJourneyByIdempotencyKey(idempotencyKey);
    if (existingConcurrent) {
      return validateAndReturnExistingJourney(existingConcurrent);
    }
    return {
      status: 409,
      error: `MOT Profile '${profile.name}' is already assigned to active journey #${existingProfileJourney.journey_number}.`,
    };
  }

  const existingVehicleJourney = await prisma.motJourney.findFirst({
    where: { mot_vehicle_id: vehicleId, status: 'COLLECTING' },
  });
  if (existingVehicleJourney) {
    if (existingVehicleJourney.idempotency_key === idempotencyKey) {
      const full = await findFullJourneyByIdempotencyKey(idempotencyKey);
      if (full) return validateAndReturnExistingJourney(full);
    }
    const existingConcurrent = await findFullJourneyByIdempotencyKey(idempotencyKey);
    if (existingConcurrent) {
      return validateAndReturnExistingJourney(existingConcurrent);
    }
    return {
      status: 409,
      error: `MOT Vehicle '${vehicle.vehicle_number}' is already assigned to active journey #${existingVehicleJourney.journey_number}.`,
    };
  }

  // 12. Execute Atomic Transaction:
  // - Generate journey number using atomic PostgreSQL sequence
  // - Create MotJourney (status: COLLECTING, assigned_at = started_at = NOW)
  // - Create MotJourneyLocation (ASSIGNING_USER)
  // - Freeze MotJourneyStop rows (ordered active shops)
  // - Create AuditLog
  const now = new Date();
  const dateCode = todayPktStr.replace(/-/g, '');

  try {
    // Ensure sequence exists in database
    await prisma.$executeRawUnsafe('CREATE SEQUENCE IF NOT EXISTS "mot_journey_number_seq" START WITH 1 INCREMENT BY 1;');

    const result = await prisma.$transaction(async (tx) => {
      // Atomic sequence generation
      const seqResult = await tx.$queryRaw<{ nextval: bigint }[]>`SELECT nextval('mot_journey_number_seq') as nextval`;
      const seqNum = seqResult[0]?.nextval ? Number(seqResult[0].nextval) : Math.floor(Math.random() * 9000) + 1000;
      const journeyNumber = `MJ-${dateCode}-${String(seqNum).padStart(4, '0')}`;

      // Create MotJourney
      const journey = await tx.motJourney.create({
        data: {
          journey_number: journeyNumber,
          operational_date: new Date(`${todayPktStr}T00:00:00.000Z`),
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

      // Freeze MotJourneyStop rows with sequential numbering starting at 1 and immutable snapshot data
      const stopsData = activeShops.map((shop, index) => ({
        journey_id: journey.id,
        shop_id: shop.id,
        planned_sequence: index + 1,
        status: 'PENDING' as const,
        shop_code_snapshot: shop.shop_code,
        shop_name_snapshot: shop.shop_name,
        owner_name_snapshot: shop.owner_name,
        phone_number_snapshot: shop.phone_number,
        area_code_snapshot: shop.area.area_code,
        area_name_snapshot: shop.area.name,
        planned_latitude_snapshot: shop.latitude,
        planned_longitude_snapshot: shop.longitude,
      }));

      await tx.motJourneyStop.createMany({
        data: stopsData,
      });

      // Create AuditLog entry atomically
      await tx.auditLog.create({
        data: {
          table_name: 'mot_journey',
          record_id: journey.id,
          action: 'MOT_JOURNEY_ASSIGN_AND_DISPATCH',
          old_values: Prisma.DbNull,
          new_values: {
            journey_number: journey.journey_number,
            operational_date: todayPktStr,
            zmcc_id: targetZmccId.toString(),
            route_id: routeId.toString(),
            mot_profile_id: profileId.toString(),
            mot_vehicle_id: vehicleId.toString(),
            status: 'COLLECTING',
            assigned_by: auth.actorUserId.toString(),
            assigned_at: now.toISOString(),
            assignment_latitude: lat,
            assignment_longitude: lng,
            assignment_gps_accuracy: accuracy,
            started_at: now.toISOString(),
            start_latitude: lat,
            start_longitude: lng,
            idempotency_key: idempotencyKey,
            total_stops: stopsData.length,
          },
          user_id: auth.actorUserId,
        },
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
      const target = Array.isArray(err.meta?.target)
        ? err.meta.target.join(',')
        : String(err.meta?.target || '');

      // 1. Idempotency Key collision (e.g. concurrent identical request won race)
      const existingAfterCollision = await findFullJourneyByIdempotencyKey(idempotencyKey);
      if (existingAfterCollision) {
        return validateAndReturnExistingJourney(existingAfterCollision);
      }

      // 2. Active MOT Profile collision
      if (target.includes('mot_profile_id') || target.includes('profile')) {
        return {
          status: 409,
          error: `MOT Profile '${profile.name}' is already assigned to an active journey.`,
        };
      }

      // 3. Active MOT Vehicle collision
      if (target.includes('mot_vehicle_id') || target.includes('vehicle')) {
        return {
          status: 409,
          error: `MOT Vehicle '${vehicle.vehicle_number}' is already assigned to an active journey.`,
        };
      }

      // 4. Journey number collision
      if (target.includes('journey_number')) {
        return {
          status: 409,
          error: 'A collision occurred while assigning journey number. Please retry.',
        };
      }

      // Fallback: Check if profile or vehicle has active journey
      const conflictProfile = await prisma.motJourney.findFirst({
        where: { mot_profile_id: profileId, status: 'COLLECTING' },
      });
      if (conflictProfile) {
        if (conflictProfile.idempotency_key === idempotencyKey) {
          const full = await findFullJourneyByIdempotencyKey(idempotencyKey);
          if (full) return validateAndReturnExistingJourney(full);
        }
        return {
          status: 409,
          error: `MOT Profile '${profile.name}' is already assigned to active journey #${conflictProfile.journey_number}.`,
        };
      }

      const conflictVehicle = await prisma.motJourney.findFirst({
        where: { mot_vehicle_id: vehicleId, status: 'COLLECTING' },
      });
      if (conflictVehicle) {
        if (conflictVehicle.idempotency_key === idempotencyKey) {
          const full = await findFullJourneyByIdempotencyKey(idempotencyKey);
          if (full) return validateAndReturnExistingJourney(full);
        }
        return {
          status: 409,
          error: `MOT Vehicle '${vehicle.vehicle_number}' is already assigned to active journey #${conflictVehicle.journey_number}.`,
        };
      }

      return {
        status: 409,
        error: 'A concurrent conflict occurred while creating the journey.',
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

  const now = new Date();
  try {
    const updated = await prisma.$transaction(async (tx) => {
      const updateResult = await tx.motJourney.updateMany({
        where: {
          id: journeyId,
          status: 'COLLECTING',
        },
        data: {
          status: 'CANCELLED',
          cancelled_at: now,
          cancelled_by: auth.actorUserId,
          cancellation_reason: cleanReason,
        },
      });

      if (updateResult.count === 0) {
        const current = await tx.motJourney.findUnique({ where: { id: journeyId } });
        if (!current) {
          throw new Error('JOURNEY_NOT_FOUND');
        }
        throw new Error(
          `CONFLICT: Cannot cancel journey in '${current.status}' status. Only active COLLECTING journeys can be cancelled.`
        );
      }

      await tx.auditLog.create({
        data: {
          table_name: 'mot_journey',
          record_id: journeyId,
          action: 'MOT_JOURNEY_CANCEL',
          old_values: {
            status: 'COLLECTING',
          },
          new_values: {
            status: 'CANCELLED',
            cancelled_by: auth.actorUserId.toString(),
            cancelled_at: now.toISOString(),
            cancellation_reason: cleanReason,
          },
          user_id: auth.actorUserId,
        },
      });

      return tx.motJourney.findUnique({
        where: { id: journeyId },
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
    });

    return { status: 200, data: serializeJourney(updated!) };
  } catch (err: any) {
    if (err.message === 'JOURNEY_NOT_FOUND') {
      return { status: 404, error: 'Journey not found.' };
    }
    if (err.message?.startsWith('CONFLICT:')) {
      return { status: 400, error: err.message.replace('CONFLICT: ', '') };
    }
    throw err;
  }
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
      summary: true,
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
          collection: {
            include: { sms_outbox: true },
          },
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
export function serializeJourney(j: any) {
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
      shop_code_snapshot: s.shop_code_snapshot || s.shop?.shop_code || '',
      shop_name_snapshot: s.shop_name_snapshot || s.shop?.shop_name || '',
      owner_name_snapshot: s.owner_name_snapshot || s.shop?.owner_name || '',
      phone_number_snapshot: s.phone_number_snapshot || s.shop?.phone_number || '',
      area_code_snapshot: s.area_code_snapshot || '',
      area_name_snapshot: s.area_name_snapshot || '',
      planned_latitude_snapshot: s.planned_latitude_snapshot != null ? Number(s.planned_latitude_snapshot) : null,
      planned_longitude_snapshot: s.planned_longitude_snapshot != null ? Number(s.planned_longitude_snapshot) : null,
      arrived_at: s.arrived_at ? s.arrived_at.toISOString() : null,
      completed_at: s.completed_at ? s.completed_at.toISOString() : null,
      skipped_at: s.skipped_at ? s.skipped_at.toISOString() : null,
      skip_reason: s.skip_reason,
      // Built from snapshot data for historical preservation (no mutable shop dependency)
      shop: {
        id: s.shop_id.toString(),
        shop_code: s.shop_code_snapshot || s.shop?.shop_code || '',
        shop_name: s.shop_name_snapshot || s.shop?.shop_name || '',
        owner_name: s.owner_name_snapshot || s.shop?.owner_name || '',
        phone_number: s.phone_number_snapshot || s.shop?.phone_number || '',
        contact_number: s.phone_number_snapshot || s.shop?.phone_number || '',
      },
      collection: s.collection ? serializeCollection(s.collection) : null,
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
    summary: j.summary ? serializeMotJourneySummary(j.summary) : null,
    created_at: j.created_at.toISOString(),
    updated_at: j.updated_at.toISOString(),
  };
}

// Helper: Serializes MotShopCollection BigInt and Decimal fields
export function serializeCollection(c: any) {
  return {
    id: c.id.toString(),
    collection_number: c.collection_number,
    journey_id: c.journey_id.toString(),
    journey_stop_id: c.journey_stop_id.toString(),
    shop_id: c.shop_id.toString(),
    zmcc_id: c.zmcc_id.toString(),
    route_id: c.route_id.toString(),
    mot_profile_id: c.mot_profile_id.toString(),
    mot_vehicle_id: c.mot_vehicle_id.toString(),
    operational_date: c.operational_date.toISOString().split('T')[0],
    client_event_id: c.client_event_id,
    quantity_value: Number(c.quantity_value),
    quantity_unit: c.quantity_unit,
    gross_liters: Number(c.gross_liters),
    density: Number(c.density),
    lr: Number(c.lr),
    fat: Number(c.fat),
    snf: Number(c.snf),
    ts: Number(c.ts),
    at_13ts_liters: Number(c.at_13ts_liters),
    calculation_version: c.calculation_version,
    collection_latitude: Number(c.collection_latitude),
    collection_longitude: Number(c.collection_longitude),
    collection_gps_accuracy: c.collection_gps_accuracy != null ? Number(c.collection_gps_accuracy) : null,
    device_collected_at: c.device_collected_at.toISOString(),
    server_received_at: c.server_received_at.toISOString(),
    submitted_by_user_id: c.submitted_by_user_id.toString(),
    collection_notes: c.collection_notes || null,
    notes: c.collection_notes || null,
    created_at: c.created_at.toISOString(),
    sms_outbox: c.sms_outbox
      ? {
          id: c.sms_outbox.id.toString(),
          recipient_phone: c.sms_outbox.recipient_phone,
          message_body: c.sms_outbox.message_body,
          status: c.sms_outbox.status,
          attempt_count: c.sms_outbox.attempt_count,
          created_at: c.sms_outbox.created_at.toISOString(),
          sent_at: c.sms_outbox.sent_at ? c.sms_outbox.sent_at.toISOString() : null,
        }
      : null,
  };
}

export interface SubmitCollectionPayload {
  client_event_id: string;
  journey_stop_id: string | number | bigint;
  quantity_value: number;
  quantity_unit: 'LITER' | 'KG' | string;
  lr: number;
  fat: number;
  latitude: number;
  longitude: number;
  gps_accuracy?: number | null;
  device_collected_at: string;
  collection_notes?: string | null;
  notes?: string | null;
}

/**
 * Submits a shop milk collection event atomically.
 * Only the canonical linked MOT user may submit collections for their active journey.
 * Idempotent: Re-submitting with the same client_event_id returns HTTP 200 with the original record.
 */
function matchesCollectionIdempotency(
  existingCollection: any,
  params: {
    stopId: bigint;
    quantityValue: number;
    quantityUnit: string;
    lr: number;
    fat: number;
    lat: number;
    lng: number;
    accuracy: number | null;
    deviceCollectedAt: Date;
    notes: string | null;
  }
): boolean {
  const isSameStop = existingCollection.journey_stop_id === params.stopId;
  const isSameQty = Math.abs(Number(existingCollection.quantity_value) - params.quantityValue) < 0.001;
  const isSameUnit = existingCollection.quantity_unit === params.quantityUnit;
  const isSameLr = Math.abs(Number(existingCollection.lr) - params.lr) < 0.001;
  const isSameFat = Math.abs(Number(existingCollection.fat) - params.fat) < 0.001;
  const isSameLat = Math.abs(Number(existingCollection.collection_latitude) - params.lat) < 0.0001;
  const isSameLng = Math.abs(Number(existingCollection.collection_longitude) - params.lng) < 0.0001;
  const existingAcc =
    existingCollection.collection_gps_accuracy != null ? Number(existingCollection.collection_gps_accuracy) : null;
  const isSameAcc =
    (params.accuracy == null && existingAcc == null) ||
    (params.accuracy != null && existingAcc != null && Math.abs(existingAcc - params.accuracy) < 0.01);
  const isSameTimestamp =
    Math.abs(new Date(existingCollection.device_collected_at).getTime() - params.deviceCollectedAt.getTime()) < 1000;
  const isSameNotes = (existingCollection.collection_notes || '').trim() === (params.notes || '').trim();

  return (
    isSameStop &&
    isSameQty &&
    isSameUnit &&
    isSameLr &&
    isSameFat &&
    isSameLat &&
    isSameLng &&
    isSameAcc &&
    isSameTimestamp &&
    isSameNotes
  );
}

function resolveCollectionIdempotencyMatch(
  existingCollection: any,
  auth: MotAuthContext,
  linkedProfile: any,
  params: {
    stopId: bigint;
    quantityValue: number;
    quantityUnit: string;
    lr: number;
    fat: number;
    lat: number;
    lng: number;
    accuracy: number | null;
    deviceCollectedAt: Date;
    notes: string | null;
  }
): ServiceResult<any> {
  // Cross-ZMCC: Never return another ZMCC's collection
  if (existingCollection.zmcc_id !== auth.effectiveZmccId!) {
    return {
      status: 409,
      error: 'The provided client event ID is already in use for another ZMCC.',
    };
  }

  // Cross-MOT: Collection must belong to the same MOT profile
  if (existingCollection.mot_profile_id !== linkedProfile.id) {
    return {
      status: 403,
      error: 'Forbidden. Collection does not belong to your MOT profile.',
    };
  }

  if (!matchesCollectionIdempotency(existingCollection, params)) {
    return {
      status: 409,
      error: 'The provided client event ID is already in use with different collection parameters.',
    };
  }

  return { status: 200, data: serializeCollection(existingCollection) };
}

export async function submitShopCollection(
  reqOrUser: Request | User,
  payload: SubmitCollectionPayload
): Promise<ServiceResult<any>> {
  const { auth, errorResponse } = await resolveMotAuth(reqOrUser, 'SUBMIT_COLLECTION');
  if (errorResponse) return errorResponse;
  if (!auth) return { status: 401, error: 'Unauthorized.' };

  // 1. Verify MOT linked to an active MOT Profile in the same ZMCC
  const linkedProfile = await prisma.motProfile.findFirst({
    where: {
      user_id: auth.actorUserId,
      is_active: true,
      zmcc_id: auth.effectiveZmccId!,
    },
  });
  if (!linkedProfile) {
    return {
      status: 403,
      error: 'Forbidden. MOT user is not linked to an active MOT Profile in their assigned ZMCC.',
    };
  }

  // 2. Validate client_event_id early
  const clientEventId = (payload?.client_event_id || '').trim();
  if (!clientEventId) {
    return { status: 400, error: 'client_event_id is required and cannot be blank.' };
  }

  // 3. Validate numerical & text inputs (supporting flexible aliases)
  const rawStopId = payload.journey_stop_id || (payload as any).stop_id;
  let stopId: bigint;
  try {
    stopId = BigInt(rawStopId);
  } catch {
    return { status: 400, error: 'Invalid journey_stop_id format.' };
  }

  const rawQty = payload.quantity_value !== undefined ? payload.quantity_value : (payload as any).quantity;
  const quantityValue = Number(rawQty);
  if (isNaN(quantityValue) || quantityValue <= 0 || quantityValue > 10000) {
    return { status: 400, error: 'Quantity must be a positive number up to 10,000.' };
  }

  const rawUnit = payload.quantity_unit || (payload as any).unit || '';
  const quantityUnit = rawUnit.trim().toUpperCase();
  if (quantityUnit !== 'LITER' && quantityUnit !== 'KG') {
    return { status: 400, error: 'Quantity unit must be either LITER or KG.' };
  }

  const lr = Number(payload.lr);
  if (isNaN(lr) || lr < 20.0 || lr > 35.0) {
    return { status: 400, error: 'Lactometer reading (LR) must be between 20.0 and 35.0.' };
  }

  const fat = Number(payload.fat);
  if (isNaN(fat) || fat < 1.5 || fat > 12.0) {
    return { status: 400, error: 'Fat percentage must be between 1.5% and 12.0%.' };
  }

  const rawLat = payload.latitude !== undefined ? payload.latitude : (payload as any).recorded_latitude;
  const rawLng = payload.longitude !== undefined ? payload.longitude : (payload as any).recorded_longitude;
  const lat = Number(rawLat);
  const lng = Number(rawLng);
  if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180 || (lat === 0 && lng === 0)) {
    return { status: 400, error: 'Invalid collection GPS coordinates.' };
  }

  const rawAcc = payload.gps_accuracy !== undefined ? payload.gps_accuracy : (payload as any).recorded_gps_accuracy;
  const accuracy = rawAcc != null ? Number(rawAcc) : null;
  if (accuracy != null && (isNaN(accuracy) || accuracy < 0)) {
    return { status: 400, error: 'Invalid GPS accuracy.' };
  }

  const rawTimestamp = payload.device_collected_at || (payload as any).offline_created_at || new Date().toISOString();
  const deviceCollectedAt = new Date(rawTimestamp);
  if (isNaN(deviceCollectedAt.getTime())) {
    return { status: 400, error: 'Invalid device_collected_at timestamp.' };
  }
  if (deviceCollectedAt.getTime() > Date.now() + 5 * 60 * 1000) {
    return { status: 400, error: 'device_collected_at cannot be in the future.' };
  }

  const rawNotes = payload.collection_notes !== undefined ? payload.collection_notes : (payload as any).notes;
  const notes = typeof rawNotes === 'string' ? rawNotes.trim() : null;

  // 4. Idempotency Check BEFORE transaction
  const existingCollection = await prisma.motShopCollection.findUnique({
    where: { client_event_id: clientEventId },
    include: {
      sms_outbox: true,
    },
  });

  if (existingCollection) {
    return resolveCollectionIdempotencyMatch(existingCollection, auth, linkedProfile, {
      stopId,
      quantityValue,
      quantityUnit,
      lr,
      fat,
      lat,
      lng,
      accuracy,
      deviceCollectedAt,
      notes,
    });
  }

  // 5. Look up Journey Stop & Journey Hierarchy
  const stop = await prisma.motJourneyStop.findUnique({
    where: { id: stopId },
    include: {
      journey: {
        include: {
          mot_profile: true,
          mot_vehicle: true,
        },
      },
      collection: true,
    },
  });

  if (!stop) {
    return { status: 404, error: 'Journey stop not found.' };
  }

  if (stop.journey.zmcc_id !== auth.effectiveZmccId!) {
    return { status: 403, error: 'Forbidden. Journey does not belong to your ZMCC.' };
  }

  if (stop.journey.mot_profile_id !== linkedProfile.id) {
    return { status: 403, error: 'Forbidden. Journey does not belong to your MOT profile.' };
  }

  // Time Validations against Journey Lifespan
  if (deviceCollectedAt.getTime() < new Date(stop.journey.started_at).getTime()) {
    return { status: 400, error: 'Collection time cannot predate journey start time.' };
  }

  if (stop.journey.ended_at && deviceCollectedAt.getTime() > new Date(stop.journey.ended_at).getTime()) {
    return { status: 400, error: 'Collection time cannot be later than journey ended_at.' };
  }

  if (stop.journey.cancelled_at && deviceCollectedAt.getTime() > new Date(stop.journey.cancelled_at).getTime()) {
    return { status: 400, error: 'Collection time cannot be later than journey cancelled_at.' };
  }

  if (stop.status !== 'PENDING' || stop.collection !== null) {
    const existingOnVisitedStop = await prisma.motShopCollection.findUnique({
      where: { client_event_id: clientEventId },
      include: { sms_outbox: true },
    });
    if (existingOnVisitedStop) {
      return resolveCollectionIdempotencyMatch(existingOnVisitedStop, auth, linkedProfile, {
        stopId,
        quantityValue,
        quantityUnit,
        lr,
        fat,
        lat,
        lng,
        accuracy,
        deviceCollectedAt,
        notes,
      });
    }

    return {
      status: 409,
      error: `Journey stop #${stop.planned_sequence} has already been visited or recorded.`,
    };
  }

  // 6. Recalculate ALL derived milk metrics on server using canonical formulas
  let metrics;
  try {
    metrics = computeCanonicalMilkMetrics(quantityValue, quantityUnit, lr, fat);
  } catch (err: any) {
    return { status: 400, error: err.message || 'Failed to compute milk quality metrics.' };
  }

  const now = new Date();
  const dateCode = stop.journey.operational_date.toISOString().split('T')[0].replace(/-/g, '');

  // 7. Atomic Stop Visit Transaction
  try {
    await prisma.$executeRawUnsafe('CREATE SEQUENCE IF NOT EXISTS "mot_collection_number_seq" START WITH 1 INCREMENT BY 1;');

    const result = await prisma.$transaction(async (tx) => {
      // Concurrency-safe atomic check-and-update on stop
      const updatedStop = await tx.motJourneyStop.updateMany({
        where: {
          id: stop.id,
          journey_id: stop.journey_id,
          status: 'PENDING',
        },
        data: {
          status: 'VISITED',
          arrived_at: deviceCollectedAt,
          completed_at: now,
        },
      });

      if (updatedStop.count === 0) {
        throw new Error('STOP_ALREADY_VISITED');
      }

      // Atomic collection number generation
      const seqResult = await tx.$queryRaw<{ nextval: bigint }[]>`SELECT nextval('mot_collection_number_seq') as nextval`;
      const seqNum = seqResult[0]?.nextval ? Number(seqResult[0].nextval) : Math.floor(Math.random() * 9000) + 1000;
      const collectionNumber = `MC-${dateCode}-${String(seqNum).padStart(4, '0')}`;

      // Create MotShopCollection
      const collection = await tx.motShopCollection.create({
        data: {
          collection_number: collectionNumber,
          journey_id: stop.journey_id,
          journey_stop_id: stop.id,
          shop_id: stop.shop_id,
          zmcc_id: stop.journey.zmcc_id,
          route_id: stop.journey.route_id,
          mot_profile_id: stop.journey.mot_profile_id,
          mot_vehicle_id: stop.journey.mot_vehicle_id,
          operational_date: stop.journey.operational_date,
          client_event_id: clientEventId,
          quantity_value: new Prisma.Decimal(quantityValue.toFixed(2)),
          quantity_unit: quantityUnit,
          gross_liters: new Prisma.Decimal(metrics.grossLiters.toFixed(2)),
          density: new Prisma.Decimal(metrics.density.toFixed(4)),
          lr: new Prisma.Decimal(lr.toFixed(2)),
          fat: new Prisma.Decimal(fat.toFixed(2)),
          snf: new Prisma.Decimal(metrics.snf.toFixed(2)),
          ts: new Prisma.Decimal(metrics.ts.toFixed(2)),
          at_13ts_liters: new Prisma.Decimal(metrics.at13tsLiters.toFixed(2)),
          calculation_version: metrics.calculationVersion,
          collection_latitude: new Prisma.Decimal(lat.toFixed(7)),
          collection_longitude: new Prisma.Decimal(lng.toFixed(7)),
          collection_gps_accuracy: accuracy != null ? new Prisma.Decimal(accuracy.toFixed(2)) : null,
          device_collected_at: deviceCollectedAt,
          server_received_at: now,
          submitted_by_user_id: auth.actorUserId,
          collection_notes: notes || null,
        },
      });

      // Create initial MotJourneyLocation (MOT_DEVICE)
      await tx.motJourneyLocation.create({
        data: {
          journey_id: stop.journey_id,
          recorded_by_user_id: auth.actorUserId,
          source_type: 'MOT_DEVICE',
          latitude: new Prisma.Decimal(lat.toFixed(7)),
          longitude: new Prisma.Decimal(lng.toFixed(7)),
          gps_accuracy: accuracy != null ? new Prisma.Decimal(accuracy.toFixed(2)) : null,
          device_recorded_at: deviceCollectedAt,
          server_received_at: now,
          idempotency_key: `${clientEventId}-loc`,
        },
      });

      // Maintain first_mot_gps_* as the chronologically earliest accepted point
      await tx.motJourney.updateMany({
        where: {
          id: stop.journey_id,
          OR: [
            { first_mot_gps_at: null },
            { first_mot_gps_at: { gt: deviceCollectedAt } },
          ],
        },
        data: {
          first_mot_gps_at: deviceCollectedAt,
          first_mot_latitude: new Prisma.Decimal(lat.toFixed(7)),
          first_mot_longitude: new Prisma.Decimal(lng.toFixed(7)),
          first_mot_gps_accuracy: accuracy != null ? new Prisma.Decimal(accuracy.toFixed(2)) : null,
        },
      });

      // Maintain final_mot_gps_* if journey has completed and this delayed point is newer
      if (stop.journey.ended_at && deviceCollectedAt.getTime() <= new Date(stop.journey.ended_at).getTime()) {
        await tx.motJourney.updateMany({
          where: {
            id: stop.journey_id,
            OR: [
              { final_mot_gps_at: null },
              { final_mot_gps_at: { lt: deviceCollectedAt } },
            ],
          },
          data: {
            final_mot_gps_at: deviceCollectedAt,
            final_mot_latitude: new Prisma.Decimal(lat.toFixed(7)),
            final_mot_longitude: new Prisma.Decimal(lng.toFixed(7)),
            final_mot_gps_accuracy: accuracy != null ? new Prisma.Decimal(accuracy.toFixed(2)) : null,
          },
        });
      }

      // Create SMS Outbox row
      const smsBody = formatCollectionSmsMessage({
        shopName: stop.shop_name_snapshot,
        collectionNumber: collection.collection_number,
        journeyNumber: stop.journey.journey_number,
        vehicleNumber: stop.journey.mot_vehicle.vehicle_number,
        motName: stop.journey.mot_profile.name,
        grossLiters: metrics.grossLiters,
        lr,
        fat,
        snf: metrics.snf,
        ts: metrics.ts,
        at13tsLiters: metrics.at13tsLiters,
        collectedAt: deviceCollectedAt,
      });

      const smsOutbox = await tx.motCollectionSmsOutbox.create({
        data: {
          collection_id: collection.id,
          recipient_phone: stop.phone_number_snapshot,
          message_body: smsBody,
          status: 'PENDING',
          attempt_count: 0,
        },
      });

      // Create immutable AuditLog entry
      await tx.auditLog.create({
        data: {
          table_name: 'mot_shop_collection',
          record_id: collection.id,
          action: 'MOT_SHOP_COLLECTION_SUBMITTED',
          old_values: Prisma.DbNull,
          new_values: {
            collection_number: collection.collection_number,
            journey_id: stop.journey_id.toString(),
            journey_stop_id: stop.id.toString(),
            shop_id: stop.shop_id.toString(),
            shop_code: stop.shop_code_snapshot,
            shop_name: stop.shop_name_snapshot,
            quantity_value: quantityValue,
            quantity_unit: quantityUnit,
            gross_liters: metrics.grossLiters,
            density: metrics.density,
            lr,
            fat,
            snf: metrics.snf,
            ts: metrics.ts,
            at_13ts_liters: metrics.at13tsLiters,
            calculation_version: metrics.calculationVersion,
            device_collected_at: deviceCollectedAt.toISOString(),
            server_received_at: now.toISOString(),
            latitude: lat,
            longitude: lng,
            gps_accuracy: accuracy,
            collection_notes: notes || null,
            sms_outbox_id: smsOutbox.id.toString(),
          },
          user_id: auth.actorUserId,
        },
      });

      // If journey has already completed (ended_at exists), recompute MotJourneySummary in SAME transaction
      if (stop.journey.ended_at && deviceCollectedAt.getTime() <= new Date(stop.journey.ended_at).getTime()) {
        await recomputeMotJourneySummaryTx(tx, stop.journey_id, auth.actorUserId);
      }

      return {
        ...collection,
        sms_outbox: smsOutbox,
      };
    });

    return { status: 201, data: serializeCollection(result) };
  } catch (err: any) {
    if (err.message === 'STOP_ALREADY_VISITED' || err.code === 'P2002') {
      const existingAfterCollision = await prisma.motShopCollection.findUnique({
        where: { client_event_id: clientEventId },
        include: { sms_outbox: true },
      });
      if (existingAfterCollision) {
        return resolveCollectionIdempotencyMatch(existingAfterCollision, auth, linkedProfile, {
          stopId,
          quantityValue,
          quantityUnit,
          lr,
          fat,
          lat,
          lng,
          accuracy,
          deviceCollectedAt,
          notes,
        });
      }

      if (err.message === 'STOP_ALREADY_VISITED') {
        return {
          status: 409,
          error: `Journey stop #${stop.planned_sequence} has already been visited or recorded.`,
        };
      }

      const target = Array.isArray(err.meta?.target)
        ? err.meta.target.join(',')
        : String(err.meta?.target || '');

      if (target.includes('journey_stop_id')) {
        return {
          status: 409,
          error: `A collection has already been submitted for this journey stop.`,
        };
      }

      if (target.includes('collection_number')) {
        return {
          status: 409,
          error: 'A collision occurred while generating collection number. Please retry.',
        };
      }

      return {
        status: 409,
        error: 'A concurrent conflict occurred while creating the collection.',
      };
    }

    throw err;
  }
}

export interface GpsLocationItem {
  client_location_id: string;
  journey_id?: string | number | bigint;
  latitude: number;
  longitude: number;
  gps_accuracy?: number | null;
  device_recorded_at: string;
}

/**
 * Uploads a batch of GPS locations from an active MOT driver's device.
 * Idempotent per location item.
 */
export async function recordGpsBatch(
  reqOrUser: Request | User,
  payload: { locations: GpsLocationItem[]; journey_id?: string | number | bigint }
): Promise<ServiceResult<any>> {
  const { auth, errorResponse } = await resolveMotAuth(reqOrUser, 'UPLOAD_GPS');
  if (errorResponse) return errorResponse;
  if (!auth) return { status: 401, error: 'Unauthorized.' };

  // 1. Find MOT's active linked profile
  const linkedProfile = await prisma.motProfile.findFirst({
    where: {
      user_id: auth.actorUserId,
      is_active: true,
      zmcc_id: auth.effectiveZmccId!,
    },
  });
  if (!linkedProfile) {
    return {
      status: 403,
      error: 'Forbidden. MOT user is not linked to an active MOT Profile.',
    };
  }

  const locations = Array.isArray(payload?.locations) ? payload.locations : [];
  if (locations.length === 0) {
    return { status: 400, error: 'Locations array must contain at least one point.' };
  }

  if (locations.length > 500) {
    return { status: 400, error: 'Locations batch exceeds maximum of 500 points.' };
  }

  // Require non-empty client_location_id on every location; never generate one!
  for (const item of locations) {
    if (!item.client_location_id || typeof item.client_location_id !== 'string' || !item.client_location_id.trim()) {
      return { status: 400, error: 'Each location item must include a valid non-empty client_location_id.' };
    }
  }

  // Require journey_id on every location (or payload level)
  for (const item of locations) {
    const jId = item.journey_id !== undefined ? item.journey_id : payload.journey_id;
    if (jId === undefined || jId === null || String(jId).trim() === '') {
      return { status: 400, error: 'Each location item must specify a valid journey_id.' };
    }
  }

  // Check mixed-journey batch: reject clearly
  const uniqueJourneyIds = Array.from(
    new Set(locations.map((item) => String(item.journey_id !== undefined ? item.journey_id : payload.journey_id).trim()))
  );
  if (uniqueJourneyIds.length > 1) {
    return {
      status: 400,
      error: 'Mixed-journey batches are not permitted. Please submit locations grouped by journey_id.',
    };
  }

  const rawJourneyId = uniqueJourneyIds[0];
  let journeyId: bigint;
  try {
    journeyId = BigInt(rawJourneyId);
  } catch {
    return { status: 400, error: 'Invalid journey_id format.' };
  }

  const journey = await prisma.motJourney.findUnique({
    where: { id: journeyId },
  });
  if (!journey) {
    return { status: 404, error: 'Journey not found.' };
  }

  if (journey.mot_profile_id !== linkedProfile.id) {
    return { status: 403, error: 'Forbidden. Journey does not belong to your MOT profile.' };
  }

  if (journey.zmcc_id !== auth.effectiveZmccId!) {
    return { status: 403, error: 'Forbidden. Journey does not belong to your assigned ZMCC.' };
  }

  const now = new Date();
  const results: { client_location_id: string; status: string; reason?: string }[] = [];
  let acceptedCount = 0;

  for (const item of locations) {
    const locId = item.client_location_id.trim();

    const lat = Number(item.latitude);
    const lng = Number(item.longitude);
    if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180 || (lat === 0 && lng === 0)) {
      results.push({ client_location_id: locId, status: 'REJECTED', reason: 'Invalid coordinates' });
      continue;
    }

    const accuracy = item.gps_accuracy != null ? Number(item.gps_accuracy) : null;
    if (accuracy != null && (isNaN(accuracy) || accuracy < 0)) {
      results.push({ client_location_id: locId, status: 'REJECTED', reason: 'Invalid accuracy' });
      continue;
    }

    const recDate = new Date(item.device_recorded_at);
    if (isNaN(recDate.getTime())) {
      results.push({ client_location_id: locId, status: 'REJECTED', reason: 'Invalid device_recorded_at' });
      continue;
    }

    // Reject timestamps unreasonably in the future (> 5 min)
    if (recDate.getTime() > now.getTime() + 5 * 60 * 1000) {
      results.push({ client_location_id: locId, status: 'REJECTED', reason: 'Timestamp in future' });
      continue;
    }

    // Must not predate journey.started_at
    if (recDate.getTime() < new Date(journey.started_at).getTime()) {
      results.push({ client_location_id: locId, status: 'REJECTED', reason: 'Timestamp predates journey started_at' });
      continue;
    }

    // Must not be later than journey.ended_at when ended_at exists
    if (journey.ended_at && recDate.getTime() > new Date(journey.ended_at).getTime()) {
      results.push({ client_location_id: locId, status: 'REJECTED', reason: 'Timestamp is after journey ended_at' });
      continue;
    }

    // Cancelled journeys must reject events after cancelled_at
    if (journey.cancelled_at && recDate.getTime() > new Date(journey.cancelled_at).getTime()) {
      results.push({ client_location_id: locId, status: 'REJECTED', reason: 'Timestamp is after journey cancelled_at' });
      continue;
    }

    // Check existing by idempotency_key
    const existing = await prisma.motJourneyLocation.findUnique({
      where: { idempotency_key: locId },
    });

    if (existing) {
      const isSameJourney = existing.journey_id === journey.id;
      const isSameLat = Math.abs(Number(existing.latitude) - lat) < 0.0001;
      const isSameLng = Math.abs(Number(existing.longitude) - lng) < 0.0001;
      const isSameTime = Math.abs(new Date(existing.device_recorded_at).getTime() - recDate.getTime()) < 1000;
      const existingAcc = existing.gps_accuracy != null ? Number(existing.gps_accuracy) : null;
      const isSameAcc =
        (accuracy == null && existingAcc == null) ||
        (accuracy != null && existingAcc != null && Math.abs(existingAcc - accuracy) < 0.01);

      if (isSameJourney && isSameLat && isSameLng && isSameTime && isSameAcc) {
        results.push({ client_location_id: locId, status: 'ALREADY_PROCESSED' });
        acceptedCount++;
      } else {
        results.push({
          client_location_id: locId,
          status: 'CONFLICT',
          reason: 'Reused client_location_id with changed journey, coordinates, timestamp, or accuracy',
        });
      }
      continue;
    }

    // Insert new point atomically with earliest first-MOT-GPS update
    try {
      await prisma.$transaction(async (tx) => {
        await tx.motJourneyLocation.create({
          data: {
            journey_id: journey.id,
            recorded_by_user_id: auth.actorUserId,
            source_type: 'MOT_DEVICE',
            latitude: new Prisma.Decimal(lat.toFixed(7)),
            longitude: new Prisma.Decimal(lng.toFixed(7)),
            gps_accuracy: accuracy != null ? new Prisma.Decimal(accuracy.toFixed(2)) : null,
            device_recorded_at: recDate,
            server_received_at: now,
            idempotency_key: locId,
          },
        });

        // Maintain first_mot_gps_* as the chronologically earliest accepted MOT_DEVICE point
        await tx.motJourney.updateMany({
          where: {
            id: journey.id,
            OR: [
              { first_mot_gps_at: null },
              { first_mot_gps_at: { gt: recDate } },
            ],
          },
          data: {
            first_mot_gps_at: recDate,
            first_mot_latitude: new Prisma.Decimal(lat.toFixed(7)),
            first_mot_longitude: new Prisma.Decimal(lng.toFixed(7)),
            first_mot_gps_accuracy: accuracy != null ? new Prisma.Decimal(accuracy.toFixed(2)) : null,
          },
        });

        // Maintain final_mot_gps_* if journey has completed and this delayed point is newer
        if (journey.ended_at && recDate.getTime() <= new Date(journey.ended_at).getTime()) {
          await tx.motJourney.updateMany({
            where: {
              id: journey.id,
              OR: [
                { final_mot_gps_at: null },
                { final_mot_gps_at: { lt: recDate } },
              ],
            },
            data: {
              final_mot_gps_at: recDate,
              final_mot_latitude: new Prisma.Decimal(lat.toFixed(7)),
              final_mot_longitude: new Prisma.Decimal(lng.toFixed(7)),
              final_mot_gps_accuracy: accuracy != null ? new Prisma.Decimal(accuracy.toFixed(2)) : null,
            },
          });
        }
      });

      results.push({ client_location_id: locId, status: 'ACCEPTED' });
      acceptedCount++;
    } catch (err: any) {
      if (err.code === 'P2002') {
        const existingAfterCollision = await prisma.motJourneyLocation.findUnique({
          where: { idempotency_key: locId },
        });
        if (existingAfterCollision) {
          const isSameJourney = existingAfterCollision.journey_id === journey.id;
          const isSameLat = Math.abs(Number(existingAfterCollision.latitude) - lat) < 0.0001;
          const isSameLng = Math.abs(Number(existingAfterCollision.longitude) - lng) < 0.0001;
          const isSameTime = Math.abs(new Date(existingAfterCollision.device_recorded_at).getTime() - recDate.getTime()) < 1000;
          const existingAcc = existingAfterCollision.gps_accuracy != null ? Number(existingAfterCollision.gps_accuracy) : null;
          const isSameAcc =
            (accuracy == null && existingAcc == null) ||
            (accuracy != null && existingAcc != null && Math.abs(existingAcc - accuracy) < 0.01);

          if (isSameJourney && isSameLat && isSameLng && isSameTime && isSameAcc) {
            results.push({ client_location_id: locId, status: 'ALREADY_PROCESSED' });
            acceptedCount++;
          } else {
            results.push({
              client_location_id: locId,
              status: 'CONFLICT',
              reason: 'Concurrent insert with conflicting attributes',
            });
          }
        } else {
          results.push({ client_location_id: locId, status: 'CONFLICT', reason: 'Concurrent insert conflict' });
        }
      } else {
        results.push({ client_location_id: locId, status: 'REJECTED', reason: err.message });
      }
    }
  }

  return {
    status: 200,
    data: {
      total: locations.length,
      accepted: acceptedCount,
      accepted_count: acceptedCount,
      rejected_count: locations.length - acceptedCount,
      items: results,
      results,
    },
  };
}

/**
 * Reads manager tracking map and journey history data.
 * Authorized for SUPER_ADMIN, ZMCC_MANAGER (own ZMCC), and PHE_OPERATOR (own ZMCC read-only).
 * MOT drivers are strictly forbidden.
 */
export async function getJourneyMapData(
  reqOrUser: Request | User,
  journeyIdParam: string | bigint
): Promise<ServiceResult<any>> {
  const { auth, errorResponse } = await resolveMotAuth(reqOrUser, 'READ_MAP');
  if (errorResponse) return errorResponse;
  if (!auth) return { status: 401, error: 'Unauthorized.' };

  let journeyId: bigint;
  try {
    journeyId = BigInt(journeyIdParam);
  } catch {
    return { status: 400, error: 'Invalid journey ID format.' };
  }

  const journey = await prisma.motJourney.findUnique({
    where: { id: journeyId },
    include: {
      zmcc: { select: { id: true, code: true, name: true } },
      route: { select: { id: true, route_code: true, name: true } },
      mot_profile: { select: { id: true, mot_code: true, name: true, phone_number: true } },
      mot_vehicle: { select: { id: true, vehicle_number: true } },
      assigner: { select: { id: true, username: true, full_name: true } },
      mot_arrival: {
        include: {
          recorded_by: { select: { id: true, username: true, full_name: true } },
        },
      },
      stops: {
        include: {
          collection: {
            include: { sms_outbox: true },
          },
        },
        orderBy: { planned_sequence: 'asc' },
      },
      locations: {
        orderBy: { device_recorded_at: 'asc' },
        take: 1000,
      },
    },
  });

  if (!journey) {
    return { status: 404, error: 'Journey not found.' };
  }

  // Scoped authorization check
  if (!auth.isSuperAdmin) {
    if (journey.zmcc_id !== auth.effectiveZmccId!) {
      return { status: 403, error: 'Forbidden. Journey belongs to another ZMCC.' };
    }
  }

  // Calculate totals from collections
  let totalGrossLiters = 0;
  let totalAt13TsLiters = 0;
  let visitedCount = 0;
  let pendingCount = 0;

  for (const s of journey.stops) {
    if (s.status === 'VISITED') visitedCount++;
    else if (s.status === 'PENDING') pendingCount++;

    if (s.collection) {
      totalGrossLiters += Number(s.collection.gross_liters);
      totalAt13TsLiters += Number(s.collection.at_13ts_liters);
    }
  }

  const latestLocation = journey.locations.length > 0
    ? journey.locations[journey.locations.length - 1]
    : null;

  return {
    status: 200,
    data: {
      journey: {
        id: journey.id.toString(),
        journey_number: journey.journey_number,
        operational_date: journey.operational_date.toISOString().split('T')[0],
        status: journey.status,
        zmcc: journey.zmcc ? { id: journey.zmcc.id.toString(), code: journey.zmcc.code, name: journey.zmcc.name } : null,
        route: journey.route ? { id: journey.route.id.toString(), route_code: journey.route.route_code, name: journey.route.name } : null,
        mot_profile: journey.mot_profile ? { id: journey.mot_profile.id.toString(), mot_code: journey.mot_profile.mot_code, name: journey.mot_profile.name, phone_number: journey.mot_profile.phone_number } : null,
        mot_vehicle: journey.mot_vehicle ? { id: journey.mot_vehicle.id.toString(), vehicle_number: journey.mot_vehicle.vehicle_number } : null,
        assigner: journey.assigner ? { id: journey.assigner.id.toString(), username: journey.assigner.username, full_name: journey.assigner.full_name } : null,
        assigned_at: journey.assigned_at.toISOString(),
        started_at: journey.started_at.toISOString(),
        ended_at: journey.ended_at ? journey.ended_at.toISOString() : null,
        start_point: {
          latitude: Number(journey.assignment_latitude),
          longitude: Number(journey.assignment_longitude),
          gps_accuracy: journey.assignment_gps_accuracy != null ? Number(journey.assignment_gps_accuracy) : null,
        },
        first_mot_gps: journey.first_mot_gps_at ? {
          timestamp: journey.first_mot_gps_at.toISOString(),
          latitude: journey.first_mot_latitude != null ? Number(journey.first_mot_latitude) : null,
          longitude: journey.first_mot_longitude != null ? Number(journey.first_mot_longitude) : null,
          gps_accuracy: journey.first_mot_gps_accuracy != null ? Number(journey.first_mot_gps_accuracy) : null,
        } : null,
        final_mot_gps: journey.final_mot_gps_at ? {
          timestamp: journey.final_mot_gps_at.toISOString(),
          latitude: journey.final_mot_latitude != null ? Number(journey.final_mot_latitude) : null,
          longitude: journey.final_mot_longitude != null ? Number(journey.final_mot_longitude) : null,
          gps_accuracy: journey.final_mot_gps_accuracy != null ? Number(journey.final_mot_gps_accuracy) : null,
        } : null,
        phe_arrival: journey.mot_arrival ? {
          id: journey.mot_arrival.id.toString(),
          route_milk_token: journey.mot_arrival.route_milk_token,
          zmcc_token: journey.mot_arrival.zmcc_token,
          arrival_timestamp: journey.mot_arrival.arrival_timestamp.toISOString(),
          arrival_date: journey.mot_arrival.arrival_date.toISOString().split('T')[0],
          latitude: journey.mot_arrival.phe_latitude != null ? Number(journey.mot_arrival.phe_latitude) : null,
          longitude: journey.mot_arrival.phe_longitude != null ? Number(journey.mot_arrival.phe_longitude) : null,
          gps_accuracy: journey.mot_arrival.phe_gps_accuracy != null ? Number(journey.mot_arrival.phe_gps_accuracy) : null,
          recorded_by: journey.mot_arrival.recorded_by ? {
            id: journey.mot_arrival.recorded_by.id.toString(),
            username: journey.mot_arrival.recorded_by.username,
            full_name: journey.mot_arrival.recorded_by.full_name,
          } : null,
          submitted_at: journey.mot_arrival.submitted_at.toISOString(),
          correction_count: journey.mot_arrival.correction_count,
        } : null,
        latest_point: latestLocation ? {
          timestamp: latestLocation.device_recorded_at.toISOString(),
          latitude: Number(latestLocation.latitude),
          longitude: Number(latestLocation.longitude),
          gps_accuracy: latestLocation.gps_accuracy != null ? Number(latestLocation.gps_accuracy) : null,
        } : null,
        endpoint: journey.mot_arrival && journey.mot_arrival.phe_latitude != null ? {
          latitude: Number(journey.mot_arrival.phe_latitude),
          longitude: Number(journey.mot_arrival.phe_longitude),
          gps_accuracy: journey.mot_arrival.phe_gps_accuracy != null ? Number(journey.mot_arrival.phe_gps_accuracy) : null,
          recorded_at: journey.mot_arrival.arrival_timestamp.toISOString(),
        } : null,
        endpoint_status: journey.mot_arrival
          ? (journey.mot_arrival.phe_latitude != null ? 'Recorded upon ZMCC arrival' : 'Recorded upon ZMCC arrival (No GPS)')
          : 'Not recorded yet (Recorded upon ZMCC arrival)',
      },
      stops: journey.stops.map((s) => ({
        id: s.id.toString(),
        planned_sequence: s.planned_sequence,
        status: s.status,
        shop_code: s.shop_code_snapshot,
        shop_name: s.shop_name_snapshot,
        owner_name: s.owner_name_snapshot,
        phone_number: s.phone_number_snapshot,
        area_code: s.area_code_snapshot,
        area_name: s.area_name_snapshot,
        planned_latitude: s.planned_latitude_snapshot != null ? Number(s.planned_latitude_snapshot) : null,
        planned_longitude: s.planned_longitude_snapshot != null ? Number(s.planned_longitude_snapshot) : null,
        arrived_at: s.arrived_at ? s.arrived_at.toISOString() : null,
        completed_at: s.completed_at ? s.completed_at.toISOString() : null,
        collection: s.collection ? serializeCollection(s.collection) : null,
      })),
      gps_trail: journey.locations.map((l) => ({
        id: l.id.toString(),
        source_type: l.source_type,
        latitude: Number(l.latitude),
        longitude: Number(l.longitude),
        gps_accuracy: l.gps_accuracy != null ? Number(l.gps_accuracy) : null,
        device_recorded_at: l.device_recorded_at.toISOString(),
        server_received_at: l.server_received_at.toISOString(),
      })),
      totals: {
        total_stops: journey.stops.length,
        visited_stops: visitedCount,
        pending_stops: pendingCount,
        total_gross_liters: Number(totalGrossLiters.toFixed(2)),
        total_at_13ts_liters: Number(totalAt13TsLiters.toFixed(2)),
        gps_point_count: journey.locations.length,
        last_sync_time: latestLocation ? latestLocation.server_received_at.toISOString() : journey.assigned_at.toISOString(),
      },
    },
  };
}

/**
 * Reads collections for a journey.
 */
export async function getJourneyCollections(
  reqOrUser: Request | User,
  journeyIdParam: string | bigint
): Promise<ServiceResult<any>> {
  const { auth, errorResponse } = await resolveMotAuth(reqOrUser, 'READ_COLLECTIONS');
  if (errorResponse) return errorResponse;
  if (!auth) return { status: 401, error: 'Unauthorized.' };

  let journeyId: bigint;
  try {
    journeyId = BigInt(journeyIdParam);
  } catch {
    return { status: 400, error: 'Invalid journey ID format.' };
  }

  const journey = await prisma.motJourney.findUnique({
    where: { id: journeyId },
    select: { id: true, zmcc_id: true, mot_profile_id: true },
  });

  if (!journey) {
    return { status: 404, error: 'Journey not found.' };
  }

  if (auth.isMot) {
    const linkedProfile = await prisma.motProfile.findFirst({
      where: { user_id: auth.actorUserId, is_active: true },
    });
    if (!linkedProfile || linkedProfile.id !== journey.mot_profile_id) {
      return { status: 403, error: 'Forbidden. You can only view collections for your own journey.' };
    }
    if (journey.zmcc_id !== auth.effectiveZmccId!) {
      return { status: 403, error: 'Forbidden. Journey belongs to another ZMCC.' };
    }
  } else if (!auth.isSuperAdmin) {
    if (journey.zmcc_id !== auth.effectiveZmccId!) {
      return { status: 403, error: 'Forbidden. Journey belongs to another ZMCC.' };
    }
  }

  const collections = await prisma.motShopCollection.findMany({
    where: { journey_id: journeyId },
    include: { sms_outbox: true },
    orderBy: { created_at: 'asc' },
  });

  return {
    status: 200,
    data: {
      collections: collections.map(serializeCollection),
    },
  };
}

/**
 * Reads SMS delivery outbox for authorized managers.
 */
export async function getSmsOutbox(
  reqOrUser: Request | User,
  filterParams?: { journey_id?: string; status?: string; limit?: number; offset?: number }
): Promise<ServiceResult<any>> {
  const { auth, errorResponse } = await resolveMotAuth(reqOrUser, 'READ_SMS_OUTBOX');
  if (errorResponse) return errorResponse;
  if (!auth) return { status: 401, error: 'Unauthorized.' };

  const where: Prisma.MotCollectionSmsOutboxWhereInput = {};

  if (!auth.isSuperAdmin) {
    where.collection = { zmcc_id: auth.effectiveZmccId! };
  }

  if (filterParams?.journey_id) {
    try {
      const jId = BigInt(filterParams.journey_id);
      where.collection = { ...(where.collection as any), journey_id: jId };
    } catch {
      return { status: 400, error: 'Invalid journey_id filter.' };
    }
  }

  if (filterParams?.status) {
    const st = filterParams.status.trim().toUpperCase();
    if (['PENDING', 'SENT', 'FAILED'].includes(st)) {
      where.status = st;
    }
  }

  const limit = Math.min(Math.max(Number(filterParams?.limit || 50), 1), 200);
  const offset = Math.max(Number(filterParams?.offset || 0), 0);

  const [total, items] = await Promise.all([
    prisma.motCollectionSmsOutbox.count({ where }),
    prisma.motCollectionSmsOutbox.findMany({
      where,
      include: {
        collection: {
          select: {
            id: true,
            collection_number: true,
            journey_id: true,
            shop_id: true,
            zmcc_id: true,
            gross_liters: true,
            operational_date: true,
            stop: {
              select: {
                shop_code_snapshot: true,
                shop_name_snapshot: true,
              },
            },
          },
        },
      },
      orderBy: { created_at: 'desc' },
      take: limit,
      skip: offset,
    }),
  ]);

  return {
    status: 200,
    data: {
      total,
      limit,
      offset,
      items: items.map((item) => ({
        id: item.id.toString(),
        collection_id: item.collection_id.toString(),
        recipient_phone: item.recipient_phone,
        message_body: item.message_body,
        status: item.status,
        attempt_count: item.attempt_count,
        provider_message_id: item.provider_message_id,
        last_error: item.last_error,
        created_at: item.created_at.toISOString(),
        sent_at: item.sent_at ? item.sent_at.toISOString() : null,
        updated_at: item.updated_at.toISOString(),
        collection: item.collection
          ? {
              id: item.collection.id.toString(),
              collection_number: item.collection.collection_number,
              journey_id: item.collection.journey_id.toString(),
              gross_liters: Number(item.collection.gross_liters),
              shop_code: item.collection.stop?.shop_code_snapshot || '',
              shop_name: item.collection.stop?.shop_name_snapshot || '',
            }
          : null,
      })),
    },
  };
}
