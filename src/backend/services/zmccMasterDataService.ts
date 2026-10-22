import { prisma } from '@core/db';
import { writeAuditLog } from '@/backend/core/audit';
import { normalizePakistaniCnic, normalizePakistaniMobile } from '@/lib/pakistani-identity';
import { getCurrentUser } from '@core/auth';
import { User, Role } from '@core/types';
import { isZmccFieldOfficer, canActAs } from '@core/roles/hierarchy';
import { resolveActingContext } from '@core/acting-context';
import { ACTING_AS_HEADER } from '@core/route-guards';
import type { ActingContext } from '@/types/acting';
import { Prisma } from '@prisma/client';
import { requireZmccScope } from '@/backend/core/scope';
import { isSourceOwnerRole, stripErpForRole } from '@/backend/services/milkSourceService';
import { createErpSource, updateErpSource } from '@/backend/services/financeMasterDataService';

export interface ZmccAuthContext {
  user: User;
  actorUserId: bigint;
  role: Role;
  isSuperAdmin: boolean;
  isDataExecutive?: boolean;
  isZmccManager: boolean;
  /**
   * PHE Operator or MDO. Kept ONLY for Stage 2 / area / milk-source lists, which
   * both roles still read the same way. Do not use it for Stage 1 decisions:
   * use `acting`, `isMdo` and `canApproveStage1` instead.
   */
  isPheOperator: boolean;
  isFinanceAccounts?: boolean;
  isMot?: boolean;
  effectiveZmccId: bigint | null;
  /** Who is acting as which role (the server validates any `x-acting-as` request). */
  acting: ActingContext;
  /** The signed-in user is an MDO. */
  isMdo: boolean;
  /** Zonal Manager or above (not Data Executive): may approve routes, shops and exceptions. */
  canApproveStage1: boolean;
  /** Acting scope is the whole system (Super Admin, Data Executive, Head of MPD, ...). */
  isSystemScope: boolean;
}

export type RequiredMasterDataAction =
  | 'READ'
  | 'WRITE_ROUTE'
  | 'APPROVE_ROUTE'
  | 'WRITE_AREA'
  | 'WRITE_MILK_SOURCE'
  | 'WRITE_CHILLER_OWNERSHIP'
  | 'WRITE_SHOP'
  | 'APPROVE_SHOP'
  | 'REQUEST_SHOP';

/** Roles allowed per action. Every role above an allowed role is allowed too (delegation). */
export const ZMCC_ACTION_ROLES: Record<RequiredMasterDataAction, readonly string[]> = {
  READ: ['SUPER_ADMIN', 'DATA_EXECUTIVE', 'ZMCC_MANAGER', 'PHE_OPERATOR', 'MDO', 'FINANCE_ACCOUNTS', 'MOT'],
  WRITE_ROUTE: ['MDO', 'DATA_EXECUTIVE'],
  APPROVE_ROUTE: ['ZMCC_MANAGER'],
  WRITE_AREA: ['ZMCC_MANAGER', 'DATA_EXECUTIVE'],
  WRITE_MILK_SOURCE: ['HEAD_OF_MPD', 'DATA_EXECUTIVE'],
  WRITE_CHILLER_OWNERSHIP: ['SUPER_ADMIN'],
  WRITE_SHOP: ['MDO', 'PHE_OPERATOR', 'DATA_EXECUTIVE'],
  APPROVE_SHOP: ['MDO'],
  REQUEST_SHOP: ['MOT', 'MDO'],
};

const FORBIDDEN_MESSAGES: Record<RequiredMasterDataAction, string> = {
  READ: 'Forbidden. You do not have permission to access ZMCC Master Data.',
  WRITE_ROUTE: 'Forbidden. Only the MDO (or a Zonal Manager or above) can add routes.',
  APPROVE_ROUTE: 'Forbidden. Only the Zonal Manager (or above) can approve routes.',
  WRITE_AREA: 'Forbidden. Only the Zonal Manager, Data Executive or Super Admin can change areas.',
  WRITE_MILK_SOURCE: 'Forbidden. Milk sources are managed only by the Head of MPD, Data Executive or Super Admin.',
  WRITE_CHILLER_OWNERSHIP: 'Forbidden. Only Super Admin may manage global Chiller Ownership.',
  WRITE_SHOP: 'Forbidden. Only the MDO or PHE Operator (or a superior) can change shops.',
  APPROVE_SHOP: 'Forbidden. Only the MDO (or a Zonal Manager or above) can approve shops.',
  REQUEST_SHOP: 'Forbidden. Only MOT or MDO (or a superior) can send new shop requests.',
};

export interface ServicePagination {
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
}

export interface ServiceResult<T> {
  status: number;
  data?: T;
  error?: string;
  /** Present only when the caller asked for a page. */
  pagination?: ServicePagination;
}

/** Audit actor for a ZMCC auth context: real user plus the role the work was done as. */
function auditActorFor(auth: ZmccAuthContext) {
  return {
    userId: auth.actorUserId,
    actorRole: auth.role,
    performedAsRole: auth.acting.actingAs,
    isDelegated: auth.acting.isDelegated,
  };
}

/**
 * Server-side Authorization & Scope Resolver for ZMCC Master Data
 */
export async function resolveZmccAuth(
  reqOrUser?: Request | User,
  requiredAction: RequiredMasterDataAction = 'READ',
  opts?: { requestedAs?: string | null }
): Promise<{ auth?: ZmccAuthContext; errorResponse?: { error: string; status: number } }> {
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
  const isDataExecutive = role === 'DATA_EXECUTIVE';
  const isZmccManager = role === 'ZMCC_MANAGER';
  const isMdo = role === 'MDO';
  // PHE_OPERATOR or MDO: same station rights for Stage 2 / area / milk-source lists only.
  const isPheOperator = isZmccFieldOfficer(role);
  const isFinanceAccounts = role === 'FINANCE_ACCOUNTS';
  const isMot = role === 'MOT';

  const user: User = {
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
  };

  // 1. Who may do this action (own role or any role above it), and as which role.
  const requestedAs =
    opts?.requestedAs !== undefined
      ? opts.requestedAs
      : reqOrUser && 'headers' in reqOrUser
        ? (reqOrUser as Request).headers.get(ACTING_AS_HEADER)
        : null;
  const resolved = resolveActingContext(user, ZMCC_ACTION_ROLES[requiredAction], { requestedAs });
  if (!resolved.ok && resolved.code === 'FORBIDDEN') {
    return { errorResponse: { error: FORBIDDEN_MESSAGES[requiredAction], status: 403 } };
  }
  if (!resolved.ok && resolved.code === 'CANNOT_ACT_AS') {
    return { errorResponse: { error: 'Forbidden. You cannot work as this role.', status: 403 } };
  }

  // 2. Validate source assignment for scoped roles (ZMCC_MANAGER, PHE_OPERATOR, MDO, MOT)
  let effectiveZmccId: bigint | null = null;
  const isSystemScope =
    isSuperAdmin ||
    isFinanceAccounts ||
    isDataExecutive ||
    role === 'HEAD_OF_MPD' ||
    (resolved.ok && resolved.ctx.scope.kind === 'SYSTEM');

  if (!isSystemScope) {
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
  } else if (reqOrUser && 'headers' in reqOrUser) {
    try {
      const req = reqOrUser as Request;
      const url = new URL(req.url);
      const reqZmcc =
        url.searchParams.get('zmccId') ||
        url.searchParams.get('zmcc_id') ||
        req.headers.get('x-acting-source-id');

      if (reqZmcc && /^\d+$/.test(reqZmcc.trim())) {
        const found = await prisma.procurementSource.findFirst({
          where: { id: BigInt(reqZmcc.trim()), is_active: true, source_type: 'ZMCC' },
          select: { id: true },
        });
        if (found) {
          effectiveZmccId = found.id;
        }
      }
    } catch (_err) {
      // Fallback
    }
  }
  if (!resolved.ok) {
    return {
      errorResponse: { error: 'Forbidden. Your account is not bound to a work area for this action.', status: 403 },
    };
  }
  const acting = resolved.ctx;

  return {
    auth: {
      user,
      actorUserId,
      role,
      isSuperAdmin,
      isDataExecutive,
      isZmccManager,
      isPheOperator,
      isFinanceAccounts,
      isMot,
      effectiveZmccId,
      acting,
      isMdo,
      canApproveStage1: !isDataExecutive && canActAs(role, 'ZMCC_MANAGER'),
      isSystemScope: acting.scope.kind === 'SYSTEM',
    },
  };
}

/** True when a ZMCC is inside the caller's acting scope (own ZMCC, or the whole system). */
function inZmccScope(auth: ZmccAuthContext, zmccId: bigint): boolean {
  const scope = auth.acting.scope;
  if (scope.kind === 'SYSTEM') return true;
  if (scope.kind === 'SOURCE') return scope.sourceId === zmccId;
  return false;
}

// -------------------------------------------------------------
// Validation Helpers
// -------------------------------------------------------------
export function validatePhone(phone: string): boolean {
  return normalizePakistaniMobile(phone).ok;
}

export function validateCnic(cnic: string): boolean {
  return normalizePakistaniCnic(cnic).ok;
}

export function validateGps(
  lat: number | null | undefined,
  lng: number | null | undefined
): { valid: boolean; error?: string } {
  if (lat == null && lng == null) {
    return { valid: true };
  }
  if (lat == null || lng == null) {
    return { valid: false, error: 'Both latitude and longitude must be provided, or both omitted.' };
  }
  if (typeof lat !== 'number' || isNaN(lat) || lat < -90 || lat > 90) {
    return { valid: false, error: 'Latitude must be a valid number between -90 and 90.' };
  }
  if (typeof lng !== 'number' || isNaN(lng) || lng < -180 || lng > 180) {
    return { valid: false, error: 'Longitude must be a valid number between -180 and 180.' };
  }
  return { valid: true };
}

// =============================================================
// ROUTES
// =============================================================

export async function listRoutes(
  auth: ZmccAuthContext,
  filters?: { zmcc_id?: string; is_active?: string; search?: string; approval_status?: string; for_dispatch?: string }
) {
  const where: Prisma.ZmccRouteWhereInput = {};

  if (auth.isSuperAdmin) {
    if (filters?.zmcc_id) {
      where.zmcc_id = BigInt(filters.zmcc_id);
    }
  } else {
    where.zmcc_id = requireZmccScope(auth);
  }

  // PHE or Dispatch requires routes only as active and approved.
  // An MDO also sees the pending routes of their own ZMCC (the ZMCC filter above already applies).
  const andFilters: Prisma.ZmccRouteWhereInput[] = [];
  if (filters?.for_dispatch === 'true' || (auth.isPheOperator && !auth.isMdo)) {
    where.is_active = true;
    where.approval_status = 'ACTIVE';
  } else if (auth.isMdo) {
    andFilters.push({
      OR: [{ is_active: true, approval_status: 'ACTIVE' }, { approval_status: 'PENDING_APPROVAL' }],
    });
  } else {
    if (filters?.is_active !== undefined && filters.is_active !== 'all') {
      where.is_active = filters.is_active === 'true';
    }
    if (filters?.approval_status) {
      where.approval_status = filters.approval_status;
    } else if (filters?.is_active === 'true') {
      where.approval_status = 'ACTIVE';
    }
  }

  if (filters?.search) {
    const s = filters.search.trim();
    where.OR = [
      { route_code: { contains: s, mode: 'insensitive' } },
      { name: { contains: s, mode: 'insensitive' } },
      { origin: { contains: s, mode: 'insensitive' } },
      { destination: { contains: s, mode: 'insensitive' } },
    ];
  }
  if (andFilters.length > 0) where.AND = andFilters;

  const routes = await prisma.zmccRoute.findMany({
    where,
    orderBy: { route_code: 'asc' },
    include: {
      zmcc: { select: { id: true, code: true, name: true, is_active: true } },
      creator: { select: { id: true, username: true, full_name: true } },
      updater: { select: { id: true, username: true, full_name: true } },
      _count: { select: { areas: true } },
    },
  });

  return routes.map((r) => ({
    id: r.id.toString(),
    route_code: r.route_code,
    name: r.name,
    origin: r.origin,
    destination: r.destination,
    zmcc_id: r.zmcc_id.toString(),
    zmcc: {
      id: r.zmcc.id.toString(),
      code: r.zmcc.code,
      name: r.zmcc.name,
      is_active: r.zmcc.is_active,
    },
    is_active: r.is_active,
    approval_status: r.approval_status,
    rejection_reason: r.rejection_reason,
    approved_by: r.approved_by ? r.approved_by.toString() : null,
    approved_at: r.approved_at ? r.approved_at.toISOString() : null,
    created_by: r.created_by.toString(),
    updated_by: r.updated_by ? r.updated_by.toString() : null,
    creator_name: r.creator.full_name || r.creator.username,
    updater_name: r.updater ? r.updater.full_name || r.updater.username : null,
    created_at: r.created_at.toISOString(),
    updated_at: r.updated_at.toISOString(),
    area_count: r._count.areas,
  }));
}

export async function getRouteById(auth: ZmccAuthContext, routeId: bigint) {
  const route = await prisma.zmccRoute.findUnique({
    where: { id: routeId },
    include: {
      zmcc: { select: { id: true, code: true, name: true, is_active: true } },
      creator: { select: { id: true, username: true, full_name: true } },
      updater: { select: { id: true, username: true, full_name: true } },
    },
  });

  if (!route) {
    return null;
  }

  if (!auth.isSuperAdmin && route.zmcc_id !== auth.effectiveZmccId) {
    return null;
  }

  // PHE Operator cannot view inactive routes directly; an MDO may also open their own ZMCC's pending routes
  const mdoMaySeePending = auth.isMdo && route.approval_status === 'PENDING_APPROVAL';
  if (auth.isPheOperator && !mdoMaySeePending && (!route.is_active || route.approval_status !== 'ACTIVE')) {
    return null;
  }

  return {
    id: route.id.toString(),
    route_code: route.route_code,
    name: route.name,
    origin: route.origin,
    destination: route.destination,
    zmcc_id: route.zmcc_id.toString(),
    zmcc: {
      id: route.zmcc.id.toString(),
      code: route.zmcc.code,
      name: route.zmcc.name,
      is_active: route.zmcc.is_active,
    },
    is_active: route.is_active,
    approval_status: route.approval_status,
    rejection_reason: route.rejection_reason,
    approved_by: route.approved_by ? route.approved_by.toString() : null,
    approved_at: route.approved_at ? route.approved_at.toISOString() : null,
    created_by: route.created_by.toString(),
    updated_by: route.updated_by ? route.updated_by.toString() : null,
    creator_name: route.creator.full_name || route.creator.username,
    updater_name: route.updater ? route.updater.full_name || route.updater.username : null,
    created_at: route.created_at.toISOString(),
    updated_at: route.updated_at.toISOString(),
  };
}

export async function createRoute(
  auth: ZmccAuthContext,
  body: {
    route_code?: string;
    name: string;
    origin: string;
    destination: string;
    zmcc_id?: string;
    area?: string;
    area_name?: string;
  }
): Promise<ServiceResult<unknown>> {
  const route_code = body.route_code?.trim();
  const name = body.name?.trim();
  const origin = body.origin?.trim();
  const destination = body.destination?.trim();
  const initialAreaName = (body.area_name || body.area)?.trim();

  if (!name || !origin || !destination) {
    return { status: 400, error: 'Route name, origin, and destination are required and cannot be empty.' };
  }

  let zmccId: bigint;
  if (auth.isSuperAdmin) {
    if (!body.zmcc_id) {
      return { status: 400, error: 'Super Admin must explicitly select a ZMCC for the new route.' };
    }
    zmccId = BigInt(body.zmcc_id);
  } else {
    zmccId = auth.effectiveZmccId!;
  }

  // Validate target ZMCC exists and is active
  const zmcc = await prisma.procurementSource.findUnique({
    where: { id: zmccId },
  });
  if (!zmcc || zmcc.source_type !== 'ZMCC') {
    return { status: 400, error: 'Target procurement source is not a valid ZMCC.' };
  }
  if (!zmcc.is_active) {
    return { status: 409, error: 'Cannot create route under an inactive ZMCC.' };
  }

  let finalRouteCode = route_code;
  if (!finalRouteCode) {
    const count = await prisma.zmccRoute.count({ where: { zmcc_id: zmccId } });
    finalRouteCode = `RT-${zmcc.code || 'ZMCC'}-${String(count + 1).padStart(3, '0')}`;
  }

  // Check unique constraints
  const existingCode = await prisma.zmccRoute.findUnique({ where: { route_code: finalRouteCode } });
  if (existingCode) {
    return { status: 409, error: `Route code "${finalRouteCode}" already exists.` };
  }

  const existingName = await prisma.zmccRoute.findUnique({
    where: { zmcc_id_name: { zmcc_id: zmccId, name } },
  });
  if (existingName) {
    return { status: 409, error: `Route name "${name}" already exists in this ZMCC.` };
  }

  // A route stays pending until a Zonal Manager (or above) approves it.
  const needsApproval = !canActAs(auth.role, 'ZMCC_MANAGER');
  const initialApprovalStatus = needsApproval ? 'PENDING_APPROVAL' : 'ACTIVE';
  const initialIsActive = !needsApproval;
  const creatorAsRole = {
    created_as_role: auth.acting.actingAs,
    created_is_delegated: auth.acting.isDelegated,
  };

  return await prisma.$transaction(async (tx) => {
    const created = await tx.zmccRoute.create({
      data: {
        route_code: finalRouteCode,
        name,
        origin,
        destination,
        zmcc_id: zmccId,
        is_active: initialIsActive,
        approval_status: initialApprovalStatus,
        created_by: auth.actorUserId,
        ...creatorAsRole,
      },
    });

    let createdArea = null;
    if (initialAreaName) {
      const areaCode = `AR-${finalRouteCode}-01`;
      createdArea = await tx.zmccArea.create({
        data: {
          area_code: areaCode,
          name: initialAreaName,
          route_id: created.id,
          zmcc_id: zmccId,
          is_active: initialIsActive,
          approval_status: initialApprovalStatus,
          created_by: auth.actorUserId,
          ...creatorAsRole,
        },
      });
    }

    await writeAuditLog(tx, {
      tableName: 'zmcc_route',
      recordId: created.id,
      action: needsApproval ? 'ZMCC_ROUTE_REQUESTED' : 'ZMCC_ROUTE_CREATED',
      oldValues: undefined,
      newValues: {
        id: created.id.toString(),
        route_code: created.route_code,
        name: created.name,
        origin: created.origin,
        destination: created.destination,
        zmcc_id: created.zmcc_id.toString(),
        is_active: initialIsActive,
        approval_status: initialApprovalStatus,
        initial_area: createdArea?.name,
      },
      actor: auditActorFor(auth),
    });

    return {
      status: 201,
      data: {
        id: created.id.toString(),
        route_code: created.route_code,
        name: created.name,
        origin: created.origin,
        destination: created.destination,
        zmcc_id: created.zmcc_id.toString(),
        is_active: created.is_active,
        approval_status: created.approval_status,
        area: createdArea ? { id: createdArea.id.toString(), name: createdArea.name, area_code: createdArea.area_code } : null,
      },
    };
  });
}

export async function approveRoute(auth: ZmccAuthContext, routeId: bigint): Promise<ServiceResult<unknown>> {
  if (!auth.canApproveStage1) {
    return { status: 403, error: 'Forbidden. Only the Zonal Manager (or above) can approve routes.' };
  }

  const existing = await prisma.zmccRoute.findUnique({
    where: { id: routeId },
    include: { zmcc: true },
  });
  if (!existing) {
    return { status: 404, error: 'Route not found.' };
  }

  if (!auth.isSuperAdmin && !inZmccScope(auth, existing.zmcc_id)) {
    return { status: 403, error: 'Forbidden. You cannot approve routes outside your assigned ZMCC.' };
  }

  if (existing.approval_status === 'ACTIVE' && existing.is_active) {
    return { status: 409, error: 'Route is already active and approved.' };
  }

  return await prisma.$transaction(async (tx) => {
    const updated = await tx.zmccRoute.update({
      where: { id: routeId },
      data: {
        approval_status: 'ACTIVE',
        is_active: true,
        approved_by: auth.actorUserId,
        approved_at: new Date(),
        approved_as_role: auth.acting.actingAs,
        approved_is_delegated: auth.acting.isDelegated,
        rejection_reason: null,
        updated_by: auth.actorUserId,
      },
    });

    // Also activate pending areas under this route
    await tx.zmccArea.updateMany({
      where: { route_id: routeId, approval_status: 'PENDING_APPROVAL' },
      data: {
        approval_status: 'ACTIVE',
        is_active: true,
        approved_by: auth.actorUserId,
        approved_at: new Date(),
        approved_as_role: auth.acting.actingAs,
        approved_is_delegated: auth.acting.isDelegated,
        rejection_reason: null,
        updated_by: auth.actorUserId,
      },
    });

    await writeAuditLog(tx, {
      tableName: 'zmcc_route',
      recordId: routeId,
      action: 'ZMCC_ROUTE_APPROVED',
      oldValues: {
        approval_status: existing.approval_status,
        is_active: existing.is_active,
      },
      newValues: {
        approval_status: 'ACTIVE',
        is_active: true,
        approved_by: auth.actorUserId.toString(),
      },
      actor: auditActorFor(auth),
    });

    return {
      status: 200,
      data: {
        id: updated.id.toString(),
        route_code: updated.route_code,
        name: updated.name,
        approval_status: updated.approval_status,
        is_active: updated.is_active,
        approved_at: updated.approved_at?.toISOString(),
      },
    };
  });
}

export async function rejectRoute(auth: ZmccAuthContext, routeId: bigint, reason: string): Promise<ServiceResult<unknown>> {
  if (!auth.canApproveStage1) {
    return { status: 403, error: 'Forbidden. Only the Zonal Manager (or above) can reject routes.' };
  }

  const cleanReason = reason?.trim();
  if (!cleanReason) {
    return { status: 400, error: 'Rejection reason is required.' };
  }

  const existing = await prisma.zmccRoute.findUnique({
    where: { id: routeId },
  });
  if (!existing) {
    return { status: 404, error: 'Route not found.' };
  }

  if (!auth.isSuperAdmin && !inZmccScope(auth, existing.zmcc_id)) {
    return { status: 403, error: 'Forbidden. You cannot reject routes outside your assigned ZMCC.' };
  }

  return await prisma.$transaction(async (tx) => {
    const updated = await tx.zmccRoute.update({
      where: { id: routeId },
      data: {
        approval_status: 'REJECTED',
        is_active: false,
        rejection_reason: cleanReason,
        approved_by: auth.actorUserId,
        approved_at: new Date(),
        approved_as_role: auth.acting.actingAs,
        approved_is_delegated: auth.acting.isDelegated,
        updated_by: auth.actorUserId,
      },
    });

    await tx.zmccArea.updateMany({
      where: { route_id: routeId, approval_status: 'PENDING_APPROVAL' },
      data: {
        approval_status: 'REJECTED',
        is_active: false,
        rejection_reason: cleanReason,
        approved_by: auth.actorUserId,
        approved_at: new Date(),
        approved_as_role: auth.acting.actingAs,
        approved_is_delegated: auth.acting.isDelegated,
        updated_by: auth.actorUserId,
      },
    });

    await writeAuditLog(tx, {
      tableName: 'zmcc_route',
      recordId: routeId,
      action: 'ZMCC_ROUTE_REJECTED',
      oldValues: {
        approval_status: existing.approval_status,
        is_active: existing.is_active,
      },
      newValues: {
        approval_status: 'REJECTED',
        is_active: false,
        rejection_reason: cleanReason,
        rejected_by: auth.actorUserId.toString(),
      },
      actor: auditActorFor(auth),
    });

    return {
      status: 200,
      data: {
        id: updated.id.toString(),
        route_code: updated.route_code,
        name: updated.name,
        approval_status: updated.approval_status,
        is_active: updated.is_active,
        rejection_reason: updated.rejection_reason,
      },
    };
  });
}

export async function listPendingRoutes(auth: ZmccAuthContext) {
  const where: Prisma.ZmccRouteWhereInput = {
    approval_status: 'PENDING_APPROVAL',
  };

  if (!auth.isSuperAdmin) {
    where.zmcc_id = requireZmccScope(auth);
  }

  const routes = await prisma.zmccRoute.findMany({
    where,
    orderBy: { created_at: 'desc' },
    include: {
      zmcc: { select: { id: true, code: true, name: true } },
      creator: { select: { id: true, username: true, full_name: true } },
      areas: { select: { id: true, name: true, area_code: true } },
    },
  });

  return routes.map((r) => ({
    id: r.id.toString(),
    route_code: r.route_code,
    name: r.name,
    origin: r.origin,
    destination: r.destination,
    zmcc_id: r.zmcc_id.toString(),
    zmcc: { id: r.zmcc.id.toString(), code: r.zmcc.code, name: r.zmcc.name },
    is_active: r.is_active,
    approval_status: r.approval_status,
    rejection_reason: r.rejection_reason,
    created_by: r.created_by.toString(),
    creator_name: r.creator.full_name || r.creator.username,
    created_at: r.created_at.toISOString(),
    areas: r.areas.map((a) => ({ id: a.id.toString(), name: a.name, area_code: a.area_code })),
  }));
}

export async function updateRoute(
  auth: ZmccAuthContext,
  routeId: bigint,
  body: {
    name?: string;
    origin?: string;
    destination?: string;
    is_active?: boolean;
  }
): Promise<ServiceResult<unknown>> {
  if (!auth.isSuperAdmin && !auth.isDataExecutive) {
    return { status: 403, error: 'Forbidden. Only Data Executive or Super Admin may update routes.' };
  }

  const existing = await prisma.zmccRoute.findUnique({
    where: { id: routeId },
    include: { zmcc: true },
  });
  if (!existing) {
    return { status: 404, error: 'Route not found.' };
  }

  const name = body.name !== undefined ? body.name.trim() : existing.name;
  const origin = body.origin !== undefined ? body.origin.trim() : existing.origin;
  const destination = body.destination !== undefined ? body.destination.trim() : existing.destination;

  if (!name || !origin || !destination) {
    return { status: 400, error: 'Route name, origin, and destination cannot be empty.' };
  }

  // Name uniqueness check if name changed
  if (name !== existing.name) {
    const dup = await prisma.zmccRoute.findUnique({
      where: { zmcc_id_name: { zmcc_id: existing.zmcc_id, name } },
    });
    if (dup && dup.id !== routeId) {
      return { status: 409, error: `Route name "${name}" already exists in this ZMCC.` };
    }
  }

  // Lifecycle check if is_active is mutated
  let targetActive = existing.is_active;
  let action = 'ZMCC_ROUTE_UPDATED';

  if (body.is_active !== undefined) {
    targetActive = body.is_active;
    if (targetActive && !existing.is_active) {
      // Activation: parent ZMCC must be active
      if (!existing.zmcc.is_active) {
        return { status: 409, error: 'Cannot activate route: parent ZMCC is inactive.' };
      }
      action = 'ZMCC_ROUTE_ACTIVATED';
    } else if (!targetActive && existing.is_active) {
      // Deactivation: block if active areas or shops exist
      const activeAreasCount = await prisma.zmccArea.count({
        where: { route_id: routeId, is_active: true },
      });
      if (activeAreasCount > 0) {
        return {
          status: 409,
          error: `Cannot deactivate route: ${activeAreasCount} active area(s) exist under this route. Deactivate areas first.`,
        };
      }

      const activeShopsCount = await prisma.zmccShop.count({
        where: { route_id: routeId, is_active: true },
      });
      if (activeShopsCount > 0) {
        return {
          status: 409,
          error: `Cannot deactivate route: ${activeShopsCount} active shop(s) exist on this route. Deactivate shops first.`,
        };
      }

      action = 'ZMCC_ROUTE_DEACTIVATED';
    }
  }

  return await prisma.$transaction(async (tx) => {
    const updated = await tx.zmccRoute.update({
      where: { id: routeId },
      data: {
        name,
        origin,
        destination,
        is_active: targetActive,
        updated_by: auth.actorUserId,
      },
    });

    await writeAuditLog(tx, {
      tableName: 'zmcc_route',
      recordId: routeId,
      action,
      oldValues: {
        name: existing.name,
        origin: existing.origin,
        destination: existing.destination,
        is_active: existing.is_active,
      },
      newValues: {
        name: updated.name,
        origin: updated.origin,
        destination: updated.destination,
        is_active: updated.is_active,
      },
      actor: { userId: auth.actorUserId, actorRole: auth.role },
    });

    return {
      status: 200,
      data: {
        id: updated.id.toString(),
        route_code: updated.route_code,
        name: updated.name,
        origin: updated.origin,
        destination: updated.destination,
        zmcc_id: updated.zmcc_id.toString(),
        is_active: updated.is_active,
      },
    };
  });
}

// =============================================================
// AREAS
// =============================================================

export async function listAreas(
  auth: ZmccAuthContext,
  filters?: { route_id?: string; is_active?: string; search?: string; zmcc_id?: string }
) {
  const where: Prisma.ZmccAreaWhereInput = {};

  if (auth.isSuperAdmin) {
    if (filters?.zmcc_id) {
      where.zmcc_id = BigInt(filters.zmcc_id);
    }
  } else {
    where.zmcc_id = requireZmccScope(auth);
  }

  if (filters?.route_id) {
    where.route_id = BigInt(filters.route_id);
  }

  // PHE requires areas only as active selectable dropdown options
  if (auth.isPheOperator) {
    where.is_active = true;
    where.approval_status = 'ACTIVE';
  } else if (filters?.is_active !== undefined && filters.is_active !== 'all') {
    where.is_active = filters.is_active === 'true';
  }

  if (filters?.search) {
    const s = filters.search.trim();
    where.OR = [
      { area_code: { contains: s, mode: 'insensitive' } },
      { name: { contains: s, mode: 'insensitive' } },
    ];
  }

  const areas = await prisma.zmccArea.findMany({
    where,
    orderBy: { area_code: 'asc' },
    include: {
      route: { select: { id: true, route_code: true, name: true, is_active: true } },
      creator: { select: { id: true, username: true, full_name: true } },
      updater: { select: { id: true, username: true, full_name: true } },
      _count: { select: { shops: true } },
    },
  });

  return areas.map((a) => ({
    id: a.id.toString(),
    area_code: a.area_code,
    name: a.name,
    route_id: a.route_id.toString(),
    zmcc_id: a.zmcc_id.toString(),
    route: {
      id: a.route.id.toString(),
      route_code: a.route.route_code,
      name: a.route.name,
      is_active: a.route.is_active,
    },
    is_active: a.is_active,
    approval_status: a.approval_status,
    rejection_reason: a.rejection_reason,
    approved_by: a.approved_by ? a.approved_by.toString() : null,
    approved_at: a.approved_at ? a.approved_at.toISOString() : null,
    created_by: a.created_by.toString(),
    updated_by: a.updated_by ? a.updated_by.toString() : null,
    creator_name: a.creator.full_name || a.creator.username,
    updater_name: a.updater ? a.updater.full_name || a.updater.username : null,
    created_at: a.created_at.toISOString(),
    updated_at: a.updated_at.toISOString(),
    shop_count: a._count.shops,
  }));
}

export async function getAreaById(auth: ZmccAuthContext, areaId: bigint) {
  const area = await prisma.zmccArea.findUnique({
    where: { id: areaId },
    include: {
      route: { select: { id: true, route_code: true, name: true, is_active: true } },
      creator: { select: { id: true, username: true, full_name: true } },
      updater: { select: { id: true, username: true, full_name: true } },
    },
  });

  if (!area) {
    return null;
  }

  if (!auth.isSuperAdmin && area.zmcc_id !== auth.effectiveZmccId) {
    return null;
  }

  // PHE Operator cannot view inactive areas directly
  if (auth.isPheOperator && (!area.is_active || area.approval_status !== 'ACTIVE')) {
    return null;
  }

  return {
    id: area.id.toString(),
    area_code: area.area_code,
    name: area.name,
    route_id: area.route_id.toString(),
    zmcc_id: area.zmcc_id.toString(),
    route: {
      id: area.route.id.toString(),
      route_code: area.route.route_code,
      name: area.route.name,
      is_active: area.route.is_active,
    },
    is_active: area.is_active,
    approval_status: area.approval_status,
    rejection_reason: area.rejection_reason,
    approved_by: area.approved_by ? area.approved_by.toString() : null,
    approved_at: area.approved_at ? area.approved_at.toISOString() : null,
    created_by: area.created_by.toString(),
    updated_by: area.updated_by ? area.updated_by.toString() : null,
    creator_name: area.creator.full_name || area.creator.username,
    updater_name: area.updater ? area.updater.full_name || area.updater.username : null,
    created_at: area.created_at.toISOString(),
    updated_at: area.updated_at.toISOString(),
  };
}

export async function createArea(
  auth: ZmccAuthContext,
  body: {
    area_code?: string;
    name: string;
    route_id: string;
  }
): Promise<ServiceResult<unknown>> {
  const area_code = body.area_code?.trim();
  const name = body.name?.trim();

  if (!name || !body.route_id) {
    return { status: 400, error: 'Area name and route selection are required.' };
  }

  const routeId = BigInt(body.route_id);
  const route = await prisma.zmccRoute.findUnique({
    where: { id: routeId },
    include: { zmcc: true },
  });

  if (!route) {
    return { status: 400, error: 'Selected route not found.' };
  }

  if (route.zmcc.source_type !== 'ZMCC') {
    return { status: 400, error: 'Target procurement source is not a valid ZMCC.' };
  }

  // Cross-ZMCC boundary check
  if (!auth.isSuperAdmin && route.zmcc_id !== auth.effectiveZmccId) {
    return { status: 403, error: 'Forbidden. You cannot create areas on routes outside your assigned ZMCC.' };
  }

  // Active check on parent route & ZMCC
  if (!route.is_active) {
    return { status: 409, error: 'Cannot create area under an inactive route.' };
  }
  if (!route.zmcc.is_active) {
    return { status: 409, error: 'Cannot create area under an inactive ZMCC.' };
  }

  const effectiveZmccId = route.zmcc_id;

  let finalAreaCode = area_code;
  if (!finalAreaCode) {
    const areaCount = await prisma.zmccArea.count({ where: { route_id: routeId } });
    finalAreaCode = `AR-${route.route_code}-${String(areaCount + 1).padStart(2, '0')}`;
  }

  // Check unique constraints
  const existingCode = await prisma.zmccArea.findUnique({ where: { area_code: finalAreaCode } });
  if (existingCode) {
    return { status: 409, error: `Area code "${finalAreaCode}" already exists.` };
  }

  const existingName = await prisma.zmccArea.findUnique({
    where: { route_id_name: { route_id: routeId, name } },
  });
  if (existingName) {
    return { status: 409, error: `Area name "${name}" already exists on this route.` };
  }

  return await prisma.$transaction(async (tx) => {
    const created = await tx.zmccArea.create({
      data: {
        area_code: finalAreaCode,
        name,
        route_id: routeId,
        zmcc_id: effectiveZmccId,
        is_active: true,
        created_by: auth.actorUserId,
      },
    });

    await writeAuditLog(tx, {
      tableName: 'zmcc_area',
      recordId: created.id,
      action: 'ZMCC_AREA_CREATED',
      oldValues: undefined,
      newValues: {
        id: created.id.toString(),
        area_code: created.area_code,
        name: created.name,
        route_id: created.route_id.toString(),
        zmcc_id: created.zmcc_id.toString(),
        is_active: true,
      },
      actor: { userId: auth.actorUserId, actorRole: auth.role },
    });

    return {
      status: 201,
      data: {
        id: created.id.toString(),
        area_code: created.area_code,
        name: created.name,
        route_id: created.route_id.toString(),
        zmcc_id: created.zmcc_id.toString(),
        is_active: created.is_active,
      },
    };
  });
}

export async function updateArea(
  auth: ZmccAuthContext,
  areaId: bigint,
  body: {
    name?: string;
    is_active?: boolean;
  }
): Promise<ServiceResult<unknown>> {
  const existing = await prisma.zmccArea.findUnique({
    where: { id: areaId },
    include: { route: { include: { zmcc: true } } },
  });

  if (!existing) {
    return { status: 404, error: 'Area not found.' };
  }

  if (!auth.isSuperAdmin && !auth.isDataExecutive) {
    return { status: 403, error: 'Forbidden. Only Data Executive or Super Admin may update areas.' };
  }

  const name = body.name !== undefined ? body.name.trim() : existing.name;
  if (!name) {
    return { status: 400, error: 'Area name cannot be empty.' };
  }

  if (name !== existing.name) {
    const dup = await prisma.zmccArea.findUnique({
      where: { route_id_name: { route_id: existing.route_id, name } },
    });
    if (dup && dup.id !== areaId) {
      return { status: 409, error: `Area name "${name}" already exists on this route.` };
    }
  }

  let targetActive = existing.is_active;
  let action = 'ZMCC_AREA_UPDATED';

  if (body.is_active !== undefined) {
    targetActive = body.is_active;
    if (targetActive && !existing.is_active) {
      // Activation: parent route and ZMCC must be active
      if (!existing.route.is_active) {
        return { status: 409, error: 'Cannot activate area: parent route is inactive.' };
      }
      if (!existing.route.zmcc.is_active) {
        return { status: 409, error: 'Cannot activate area: parent ZMCC is inactive.' };
      }
      action = 'ZMCC_AREA_ACTIVATED';
    } else if (!targetActive && existing.is_active) {
      // Deactivation: block if active shops exist
      const activeShopsCount = await prisma.zmccShop.count({
        where: { area_id: areaId, is_active: true },
      });
      if (activeShopsCount > 0) {
        return {
          status: 409,
          error: `Cannot deactivate area: ${activeShopsCount} active shop(s) exist in this area. Deactivate shops first.`,
        };
      }
      action = 'ZMCC_AREA_DEACTIVATED';
    }
  }

  return await prisma.$transaction(async (tx) => {
    const updated = await tx.zmccArea.update({
      where: { id: areaId },
      data: {
        name,
        is_active: targetActive,
        updated_by: auth.actorUserId,
      },
    });

    await writeAuditLog(tx, {
      tableName: 'zmcc_area',
      recordId: areaId,
      action,
      oldValues: {
        name: existing.name,
        is_active: existing.is_active,
      },
      newValues: {
        name: updated.name,
        is_active: updated.is_active,
      },
      actor: { userId: auth.actorUserId, actorRole: auth.role },
    });

    return {
      status: 200,
      data: {
        id: updated.id.toString(),
        area_code: updated.area_code,
        name: updated.name,
        route_id: updated.route_id.toString(),
        zmcc_id: updated.zmcc_id.toString(),
        is_active: updated.is_active,
      },
    };
  });
}

// =============================================================
// MILK SOURCES
// =============================================================

export async function listMilkSources(
  auth: ZmccAuthContext,
  filters?: { is_active?: string; search?: string; zmcc_id?: string }
) {
  const isOwner = isSourceOwnerRole(auth.role);
  const where: Prisma.ZmccMilkSourceWhereInput = {};

  const targetZmccId = isOwner
    ? (filters?.zmcc_id && /^d+$/.test(filters.zmcc_id) ? BigInt(filters.zmcc_id) : undefined)
    : requireZmccScope(auth);

  if (targetZmccId) {
    where.visibilities = { some: { zmcc_id: targetZmccId, is_active: true } };
  }

  // Field roles only ever pick from active sources
  if (!isOwner) {
    where.is_active = true;
  } else if (filters?.is_active !== undefined && filters.is_active !== 'all') {
    where.is_active = filters.is_active === 'true';
  }

  if (filters?.search) {
    const s = filters.search.trim();
    // Search by ERP code works only for the owner roles (code is hidden from everyone else).
    where.OR = isOwner
      ? [
          { erp_code: { contains: s, mode: 'insensitive' as const } },
          { name: { contains: s, mode: 'insensitive' as const } },
        ]
      : [{ name: { contains: s, mode: 'insensitive' as const } }];
  }

  const sources = await prisma.zmccMilkSource.findMany({
    where,
    orderBy: { name: 'asc' },
    include: {
      visibilities: { include: { zmcc: { select: { id: true, code: true, name: true, source_type: true } } } },
      creator: { select: { id: true, username: true, full_name: true } },
      updater: { select: { id: true, username: true, full_name: true } },
    },
  });

  return sources.map((ms) =>
    stripErpForRole(auth.role, {
      id: ms.id.toString(),
      erp_code: ms.erp_code,
      name: ms.name,
      is_active: ms.is_active,
      ...(isOwner
        ? {
            zmcc_visibilities: ms.visibilities.map((v) => ({
              zmcc_id: v.zmcc.id.toString(),
              zmcc_code: v.zmcc.code,
              zmcc_name: v.zmcc.name,
              source_type: v.zmcc.source_type,
              is_active: v.is_active,
            })),
            created_by: ms.created_by.toString(),
            updated_by: ms.updated_by ? ms.updated_by.toString() : null,
            creator_name: ms.creator.full_name || ms.creator.username,
            updater_name: ms.updater ? ms.updater.full_name || ms.updater.username : null,
            created_at: ms.created_at.toISOString(),
            updated_at: ms.updated_at.toISOString(),
          }
        : {}),
    })
  );
}

export async function getMilkSourceById(auth: ZmccAuthContext, sourceId: bigint) {
  const isOwner = isSourceOwnerRole(auth.role);
  const ms = await prisma.zmccMilkSource.findUnique({
    where: { id: sourceId },
    include: {
      visibilities: { include: { zmcc: { select: { id: true, code: true, name: true, source_type: true } } } },
    },
  });

  if (!ms) {
    return null;
  }

  if (!isOwner) {
    const visible = ms.visibilities.some(
      (v) => v.is_active && auth.effectiveZmccId !== null && v.zmcc_id === auth.effectiveZmccId
    );
    if (!visible || !ms.is_active) {
      return null;
    }
  }

  return stripErpForRole(auth.role, {
    id: ms.id.toString(),
    erp_code: ms.erp_code,
    name: ms.name,
    is_active: ms.is_active,
    ...(isOwner
      ? {
          zmcc_visibilities: ms.visibilities.map((v) => ({
            zmcc_id: v.zmcc.id.toString(),
            zmcc_code: v.zmcc.code,
            zmcc_name: v.zmcc.name,
            source_type: v.zmcc.source_type,
            is_active: v.is_active,
          })),
          created_at: ms.created_at.toISOString(),
          updated_at: ms.updated_at.toISOString(),
        }
      : {}),
  });
}

function milkSourceErrorStatus(message: string): number {
  return /already exists/i.test(message) ? 409 : /not found/i.test(message) ? 404 : 400;
}

/** Only HEAD_OF_MPD, SUPER_ADMIN and DATA_EXECUTIVE create milk sources (name + ERP code, assigned to ZMCCs). */
export async function createMilkSource(
  auth: ZmccAuthContext,
  body: {
    erp_code: string;
    name: string;
    zmcc_ids?: Array<string | number>;
  }
): Promise<ServiceResult<unknown>> {
  if (!isSourceOwnerRole(auth.role)) {
    return { status: 403, error: FORBIDDEN_MESSAGES.WRITE_MILK_SOURCE };
  }
  try {
    const created = await createErpSource(
      auth.actorUserId,
      { erp_code: body.erp_code ?? '', name: body.name ?? '', zmcc_ids: Array.isArray(body.zmcc_ids) ? body.zmcc_ids : [] },
      auth.role
    );
    return {
      status: 201,
      data: { id: created.id.toString(), erp_code: created.erp_code, name: created.name, is_active: created.is_active },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Could not create the milk source.';
    return { status: milkSourceErrorStatus(message), error: message };
  }
}

export async function updateMilkSource(
  auth: ZmccAuthContext,
  sourceId: bigint,
  body: {
    name?: string;
    erp_code?: string;
    is_active?: boolean;
    zmcc_ids?: Array<string | number>;
  }
): Promise<ServiceResult<unknown>> {
  if (!isSourceOwnerRole(auth.role)) {
    return { status: 403, error: FORBIDDEN_MESSAGES.WRITE_MILK_SOURCE };
  }
  try {
    const updated = await updateErpSource(
      auth.actorUserId,
      sourceId,
      {
        name: body.name,
        erp_code: typeof body.erp_code === 'string' ? body.erp_code : undefined,
        is_active: body.is_active,
        zmcc_ids: Array.isArray(body.zmcc_ids) ? body.zmcc_ids : undefined,
      },
      auth.role
    );
    return {
      status: 200,
      data: { id: updated.id.toString(), erp_code: updated.erp_code, name: updated.name, is_active: updated.is_active },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Could not update the milk source.';
    return { status: milkSourceErrorStatus(message), error: message };
  }
}

// =============================================================
// CHILLER OWNERSHIP (GLOBAL MASTER)
// =============================================================

export async function listChillerOwnerships(
  auth: ZmccAuthContext,
  filters?: { is_active?: string; search?: string }
) {
  const where: Prisma.ChillerOwnershipWhereInput = {};

  // For non-Super Admin (ZMCC_MANAGER, PHE_OPERATOR), return active options only for shop details
  if (!auth.isSuperAdmin) {
    where.is_active = true;
  } else if (filters?.is_active !== undefined && filters.is_active !== 'all') {
    where.is_active = filters.is_active === 'true';
  }

  if (filters?.search) {
    const s = filters.search.trim();
    where.OR = [
      { ownership_code: { contains: s, mode: 'insensitive' } },
      { name: { contains: s, mode: 'insensitive' } },
    ];
  }

  const list = await prisma.chillerOwnership.findMany({
    where,
    orderBy: { name: 'asc' },
    include: {
      creator: { select: { id: true, username: true, full_name: true } },
      updater: { select: { id: true, username: true, full_name: true } },
      _count: { select: { shops: true } },
    },
  });

  return list.map((co) => ({
    id: co.id.toString(),
    ownership_code: co.ownership_code,
    name: co.name,
    is_active: co.is_active,
    created_by: co.created_by.toString(),
    updated_by: co.updated_by ? co.updated_by.toString() : null,
    creator_name: co.creator.full_name || co.creator.username,
    updater_name: co.updater ? co.updater.full_name || co.updater.username : null,
    created_at: co.created_at.toISOString(),
    updated_at: co.updated_at.toISOString(),
    shop_count: co._count.shops,
  }));
}

export async function getChillerOwnershipById(auth: ZmccAuthContext, id: bigint) {
  const co = await prisma.chillerOwnership.findUnique({
    where: { id },
    include: {
      creator: { select: { id: true, username: true, full_name: true } },
      updater: { select: { id: true, username: true, full_name: true } },
    },
  });

  if (!co) {
    return null;
  }

  // Non-Super Admin cannot view inactive chiller ownership records directly
  if (!auth.isSuperAdmin && !co.is_active) {
    return null;
  }

  return {
    id: co.id.toString(),
    ownership_code: co.ownership_code,
    name: co.name,
    is_active: co.is_active,
    created_by: co.created_by.toString(),
    updated_by: co.updated_by ? co.updated_by.toString() : null,
    creator_name: co.creator.full_name || co.creator.username,
    updater_name: co.updater ? co.updater.full_name || co.updater.username : null,
    created_at: co.created_at.toISOString(),
    updated_at: co.updated_at.toISOString(),
  };
}

export async function createChillerOwnership(
  auth: ZmccAuthContext,
  body: { ownership_code: string; name: string }
): Promise<ServiceResult<unknown>> {
  if (!auth.isSuperAdmin) {
    return { status: 403, error: 'Forbidden. Only Super Admin may create Chiller Ownership options.' };
  }

  const ownership_code = body.ownership_code?.trim();
  const name = body.name?.trim();

  if (!ownership_code || !name) {
    return { status: 400, error: 'Ownership code and name are required.' };
  }

  const existingCode = await prisma.chillerOwnership.findUnique({ where: { ownership_code } });
  if (existingCode) {
    return { status: 409, error: `Ownership code "${ownership_code}" already exists.` };
  }

  const existingName = await prisma.chillerOwnership.findUnique({ where: { name } });
  if (existingName) {
    return { status: 409, error: `Ownership name "${name}" already exists.` };
  }

  return await prisma.$transaction(async (tx) => {
    const created = await tx.chillerOwnership.create({
      data: {
        ownership_code,
        name,
        is_active: true,
        created_by: auth.actorUserId,
      },
    });

    await writeAuditLog(tx, {
      tableName: 'chiller_ownership',
      recordId: created.id,
      action: 'CHILLER_OWNERSHIP_CREATED',
      oldValues: undefined,
      newValues: {
        id: created.id.toString(),
        ownership_code: created.ownership_code,
        name: created.name,
        is_active: true,
      },
      actor: { userId: auth.actorUserId, actorRole: auth.role },
    });

    return {
      status: 201,
      data: {
        id: created.id.toString(),
        ownership_code: created.ownership_code,
        name: created.name,
        is_active: created.is_active,
      },
    };
  });
}

export async function updateChillerOwnership(
  auth: ZmccAuthContext,
  id: bigint,
  body: { name?: string; is_active?: boolean }
): Promise<ServiceResult<unknown>> {
  if (!auth.isSuperAdmin) {
    return { status: 403, error: 'Forbidden. Only Super Admin may modify Chiller Ownership options.' };
  }

  const existing = await prisma.chillerOwnership.findUnique({ where: { id } });
  if (!existing) {
    return { status: 404, error: 'Chiller ownership not found.' };
  }

  const name = body.name !== undefined ? body.name.trim() : existing.name;
  if (!name) {
    return { status: 400, error: 'Name cannot be empty.' };
  }

  if (name !== existing.name) {
    const dup = await prisma.chillerOwnership.findUnique({ where: { name } });
    if (dup && dup.id !== id) {
      return { status: 409, error: `Ownership name "${name}" already exists.` };
    }
  }

  let targetActive = existing.is_active;
  let action = 'CHILLER_OWNERSHIP_UPDATED';

  if (body.is_active !== undefined) {
    targetActive = body.is_active;
    if (targetActive && !existing.is_active) {
      action = 'CHILLER_OWNERSHIP_ACTIVATED';
    } else if (!targetActive && existing.is_active) {
      // Deactivation check: block if active shops exist
      const activeShopsCount = await prisma.zmccShop.count({
        where: { chiller_ownership_id: id, is_active: true },
      });
      if (activeShopsCount > 0) {
        return {
          status: 409,
          error: `Cannot deactivate chiller ownership: ${activeShopsCount} active shop(s) are assigned to this ownership.`,
        };
      }
      action = 'CHILLER_OWNERSHIP_DEACTIVATED';
    }
  }

  return await prisma.$transaction(async (tx) => {
    const updated = await tx.chillerOwnership.update({
      where: { id },
      data: {
        name,
        is_active: targetActive,
        updated_by: auth.actorUserId,
      },
    });

    await writeAuditLog(tx, {
      tableName: 'chiller_ownership',
      recordId: id,
      action,
      oldValues: {
        name: existing.name,
        is_active: existing.is_active,
      },
      newValues: {
        name: updated.name,
        is_active: updated.is_active,
      },
      actor: { userId: auth.actorUserId, actorRole: auth.role },
    });

    return {
      status: 200,
      data: {
        id: updated.id.toString(),
        ownership_code: updated.ownership_code,
        name: updated.name,
        is_active: updated.is_active,
      },
    };
  });
}

// =============================================================
// SHOPS
// =============================================================

export async function listShops(
  auth: ZmccAuthContext,
  filters?: {
    route_id?: string;
    area_id?: string;
    chiller_ownership_id?: string;
    is_active?: string;
    approval_status?: string;
    geotag_status?: string;
    search?: string;
    zmcc_id?: string;
    /** When set, the list is paginated and the caller can read the total via listShopsPage. */
    page?: number;
    page_size?: number;
  }
) {
  return (await listShopsPage(auth, filters)).shops;
}

export async function listShopsPage(
  auth: ZmccAuthContext,
  filters?: Parameters<typeof listShops>[1]
) {
  const where: Prisma.ZmccShopWhereInput = {};

  if (auth.isSuperAdmin) {
    if (filters?.zmcc_id) {
      where.zmcc_id = BigInt(filters.zmcc_id);
    }
  } else {
    where.zmcc_id = requireZmccScope(auth);
  }

  if (filters?.route_id) {
    where.route_id = BigInt(filters.route_id);
  }
  if (filters?.area_id) {
    where.area_id = BigInt(filters.area_id);
  }
  if (filters?.chiller_ownership_id) {
    where.chiller_ownership_id = BigInt(filters.chiller_ownership_id);
  }

  if (filters?.is_active !== undefined && filters.is_active !== 'all') {
    where.is_active = filters.is_active === 'true';
  }
  if (filters?.approval_status) {
    where.approval_status = filters.approval_status;
  }
  if (filters?.geotag_status) {
    where.geotag_status = filters.geotag_status;
  }

  if (filters?.search) {
    const s = filters.search.trim();
    where.OR = [
      { shop_code: { contains: s, mode: 'insensitive' } },
      { shop_name: { contains: s, mode: 'insensitive' } },
      { owner_name: { contains: s, mode: 'insensitive' } },
      { phone_number: { contains: s, mode: 'insensitive' } },
      { cnic: { contains: s, mode: 'insensitive' } },
    ];
  }

  const paginated = filters?.page != null;
  const pageSize = Math.min(Math.max(filters?.page_size ?? 50, 1), 200);
  const page = Math.max(filters?.page ?? 1, 1);
  const [rows, total] = await Promise.all([
    prisma.zmccShop.findMany({
      where,
      orderBy: { shop_code: 'asc' },
      ...(paginated ? { skip: (page - 1) * pageSize, take: pageSize } : {}),
      include: {
        area: { select: { id: true, area_code: true, name: true, is_active: true } },
        chiller_ownership: { select: { id: true, ownership_code: true, name: true, is_active: true } },
        creator: { select: { id: true, username: true, full_name: true } },
        updater: { select: { id: true, username: true, full_name: true } },
      },
    }),
    paginated ? prisma.zmccShop.count({ where }) : Promise.resolve(0),
  ]);

  const shops = rows.map((s) => ({
    id: s.id.toString(),
    shop_code: s.shop_code,
    shop_name: s.shop_name,
    owner_name: s.owner_name,
    phone_number: s.phone_number,
    cnic: s.cnic,
    area_id: s.area_id.toString(),
    route_id: s.route_id.toString(),
    zmcc_id: s.zmcc_id.toString(),
    chiller_ownership_id: s.chiller_ownership_id.toString(),
    latitude: s.latitude ? Number(s.latitude) : null,
    longitude: s.longitude ? Number(s.longitude) : null,
    is_active: s.is_active,
    approval_status: s.approval_status,
    rejection_reason: s.rejection_reason,
    approved_by: s.approved_by ? s.approved_by.toString() : null,
    approved_at: s.approved_at ? s.approved_at.toISOString() : null,
    geotag_status: s.geotag_status,
    area: {
      id: s.area.id.toString(),
      area_code: s.area.area_code,
      name: s.area.name,
      is_active: s.area.is_active,
    },
    chiller_ownership: {
      id: s.chiller_ownership.id.toString(),
      ownership_code: s.chiller_ownership.ownership_code,
      name: s.chiller_ownership.name,
      is_active: s.chiller_ownership.is_active,
    },
    created_by: s.created_by.toString(),
    updated_by: s.updated_by ? s.updated_by.toString() : null,
    creator_name: s.creator.full_name || s.creator.username,
    updater_name: s.updater ? s.updater.full_name || s.updater.username : null,
    created_at: s.created_at.toISOString(),
    updated_at: s.updated_at.toISOString(),
  }));

  return {
    shops,
    pagination: paginated
      ? { page, page_size: pageSize, total, total_pages: Math.max(1, Math.ceil(total / pageSize)) }
      : null,
  };
}

export async function getShopById(auth: ZmccAuthContext, shopId: bigint) {
  const shop = await prisma.zmccShop.findUnique({
    where: { id: shopId },
    include: {
      area: {
        include: {
          route: {
            include: { zmcc: true },
          },
        },
      },
      chiller_ownership: true,
      creator: { select: { id: true, username: true, full_name: true } },
      updater: { select: { id: true, username: true, full_name: true } },
    },
  });

  if (!shop) {
    return null;
  }

  if (!auth.isSuperAdmin && shop.zmcc_id !== auth.effectiveZmccId) {
    return null;
  }

  return {
    id: shop.id.toString(),
    shop_code: shop.shop_code,
    shop_name: shop.shop_name,
    owner_name: shop.owner_name,
    phone_number: shop.phone_number,
    cnic: shop.cnic,
    area_id: shop.area_id.toString(),
    route_id: shop.route_id.toString(),
    zmcc_id: shop.zmcc_id.toString(),
    chiller_ownership_id: shop.chiller_ownership_id.toString(),
    latitude: shop.latitude ? Number(shop.latitude) : null,
    longitude: shop.longitude ? Number(shop.longitude) : null,
    is_active: shop.is_active,
    approval_status: shop.approval_status,
    rejection_reason: shop.rejection_reason,
    approved_by: shop.approved_by ? shop.approved_by.toString() : null,
    approved_at: shop.approved_at ? shop.approved_at.toISOString() : null,
    geotag_status: shop.geotag_status,
    area: {
      id: shop.area.id.toString(),
      area_code: shop.area.area_code,
      name: shop.area.name,
      is_active: shop.area.is_active,
    },
    route: {
      id: shop.area.route.id.toString(),
      route_code: shop.area.route.route_code,
      name: shop.area.route.name,
      is_active: shop.area.route.is_active,
    },
    chiller_ownership: {
      id: shop.chiller_ownership.id.toString(),
      ownership_code: shop.chiller_ownership.ownership_code,
      name: shop.chiller_ownership.name,
      is_active: shop.chiller_ownership.is_active,
    },
    created_by: shop.created_by.toString(),
    updated_by: shop.updated_by ? shop.updated_by.toString() : null,
    creator_name: shop.creator.full_name || shop.creator.username,
    updater_name: shop.updater ? shop.updater.full_name || shop.updater.username : null,
    created_at: shop.created_at.toISOString(),
    updated_at: shop.updated_at.toISOString(),
  };
}

export async function createShop(
  auth: ZmccAuthContext,
  body: {
    shop_code?: string;
    shop_name: string;
    owner_name: string;
    phone_number: string;
    cnic: string;
    area_id: string;
    chiller_ownership_id: string;
    latitude?: number | null;
    longitude?: number | null;
  }
): Promise<ServiceResult<unknown>> {
  const shop_code = body.shop_code?.trim();
  const shop_name = body.shop_name?.trim();
  const owner_name = body.owner_name?.trim();
  const phoneInput = body.phone_number?.trim();
  const cnicInput = body.cnic?.trim();

  if (!shop_name || !owner_name || !phoneInput || !cnicInput) {
    return { status: 400, error: 'Shop name, owner name, phone number, and CNIC are required.' };
  }

  if (!body.area_id || !body.chiller_ownership_id) {
    return { status: 400, error: 'Area and Chiller Ownership selections are required.' };
  }

  // Phone & CNIC validation
  const phoneResult = normalizePakistaniMobile(phoneInput);
  if (!phoneResult.ok) return { status: 400, error: phoneResult.error };
  const cnicResult = normalizePakistaniCnic(cnicInput);
  if (!cnicResult.ok) return { status: 400, error: cnicResult.error };
  const phone_number = phoneResult.value;
  const cnic = cnicResult.value;

  // GPS validation
  const gpsCheck = validateGps(body.latitude, body.longitude);
  if (!gpsCheck.valid) {
    return { status: 400, error: gpsCheck.error };
  }

  const areaId = BigInt(body.area_id);
  const chillerOwnershipId = BigInt(body.chiller_ownership_id);

  // Validate Area and its Route + ZMCC
  const area = await prisma.zmccArea.findUnique({
    where: { id: areaId },
    include: {
      route: { include: { zmcc: true } },
    },
  });
  if (!area) {
    return { status: 400, error: 'Selected area not found.' };
  }

  const effectiveZmccId = area.zmcc_id;
  const routeId = area.route_id;

  // Scoped user cross-ZMCC check
  if (!auth.isSuperAdmin && effectiveZmccId !== auth.effectiveZmccId) {
    return { status: 403, error: 'Forbidden. You cannot create shops outside your assigned ZMCC.' };
  }

  // Hierarchy active checks
  if (!area.zmcc_id || !area.route.zmcc.is_active) {
    return { status: 409, error: 'Cannot create shop: parent ZMCC is inactive.' };
  }
  if (area.route.zmcc.source_type !== 'ZMCC') {
    return { status: 400, error: 'Target procurement source is not a valid ZMCC.' };
  }
  if (!area.route.is_active) {
    return { status: 409, error: 'Cannot create shop: parent Route is inactive.' };
  }
  if (!area.is_active) {
    return { status: 409, error: 'Cannot create shop: parent Area is inactive.' };
  }

  // Validate Chiller Ownership (must exist and be active)
  const chillerOwnership = await prisma.chillerOwnership.findUnique({
    where: { id: chillerOwnershipId },
  });
  if (!chillerOwnership) {
    return { status: 400, error: 'Selected chiller ownership not found.' };
  }
  if (!chillerOwnership.is_active) {
    return { status: 409, error: 'Cannot create shop: selected chiller ownership is inactive.' };
  }

  let finalShopCode = shop_code;
  if (!finalShopCode) {
    const count = await prisma.zmccShop.count();
    finalShopCode = `SHP-${String(count + 1).padStart(6, '0')}`;
  }

  // Unique checks
  const existingCode = await prisma.zmccShop.findUnique({ where: { shop_code: finalShopCode } });
  if (existingCode) {
    return { status: 409, error: `Shop code "${finalShopCode}" already exists.` };
  }

  const existingName = await prisma.zmccShop.findUnique({
    where: { area_id_shop_name: { area_id: areaId, shop_name } },
  });
  if (existingName) {
    return { status: 409, error: `Shop name "${shop_name}" already exists in this area.` };
  }

  return await prisma.$transaction(async (tx) => {
    const created = await tx.zmccShop.create({
      data: {
        shop_code: finalShopCode,
        shop_name,
        owner_name,
        phone_number,
        cnic,
        area_id: areaId,
        route_id: routeId,
        zmcc_id: effectiveZmccId,
        chiller_ownership_id: chillerOwnershipId,
        latitude: body.latitude != null ? body.latitude : null,
        longitude: body.longitude != null ? body.longitude : null,
        geotag_status: (body.latitude != null && body.longitude != null) ? 'VERIFIED' : 'PENDING_FIRST_VISIT',
        approval_status: 'ACTIVE',
        is_active: true,
        created_by: auth.actorUserId,
      },
    });

    await writeAuditLog(tx, {
      tableName: 'zmcc_shop',
      recordId: created.id,
      action: 'ZMCC_SHOP_CREATED',
      oldValues: undefined,
      newValues: {
        id: created.id.toString(),
        shop_code: created.shop_code,
        shop_name: created.shop_name,
        owner_name: created.owner_name,
        phone_number: created.phone_number,
        cnic: created.cnic,
        area_id: created.area_id.toString(),
        route_id: created.route_id.toString(),
        zmcc_id: created.zmcc_id.toString(),
        chiller_ownership_id: created.chiller_ownership_id.toString(),
        is_active: true,
        approval_status: 'ACTIVE',
        geotag_status: created.geotag_status,
      },
      actor: { userId: auth.actorUserId, actorRole: auth.role },
    });

    return {
      status: 201,
      data: {
        id: created.id.toString(),
        shop_code: created.shop_code,
        shop_name: created.shop_name,
        is_active: created.is_active,
        approval_status: created.approval_status,
        geotag_status: created.geotag_status,
      },
    };
  });
}

export async function updateShop(
  auth: ZmccAuthContext,
  shopId: bigint,
  body: {
    shop_name?: string;
    owner_name?: string;
    phone_number?: string;
    cnic?: string;
    area_id?: string;
    chiller_ownership_id?: string;
    latitude?: number | null;
    longitude?: number | null;
    is_active?: boolean;
  }
): Promise<ServiceResult<unknown>> {
  const existing = await prisma.zmccShop.findUnique({
    where: { id: shopId },
    include: {
      area: { include: { route: { include: { zmcc: true } } } },
      chiller_ownership: true,
    },
  });

  if (!existing) {
    return { status: 404, error: 'Shop not found.' };
  }

  if (!auth.isSuperAdmin && !auth.isDataExecutive) {
    return { status: 403, error: 'Forbidden. Only Data Executive or Super Admin may update shops.' };
  }

  const shop_name = body.shop_name !== undefined ? body.shop_name.trim() : existing.shop_name;
  const owner_name = body.owner_name !== undefined ? body.owner_name.trim() : existing.owner_name;
  const phoneInput = body.phone_number !== undefined ? body.phone_number.trim() : existing.phone_number;
  const cnicInput = body.cnic !== undefined ? body.cnic.trim() : existing.cnic;

  if (!shop_name || !owner_name || !phoneInput || !cnicInput) {
    return { status: 400, error: 'Shop name, owner name, phone number, and CNIC cannot be empty.' };
  }

  const phoneResult = normalizePakistaniMobile(phoneInput);
  if (!phoneResult.ok) return { status: 400, error: phoneResult.error };
  const cnicResult = normalizePakistaniCnic(cnicInput);
  if (!cnicResult.ok) return { status: 400, error: cnicResult.error };
  const phone_number = phoneResult.value;
  const cnic = cnicResult.value;

  let targetAreaId = existing.area_id;
  let targetRouteId = existing.route_id;
  const targetZmccId = existing.zmcc_id;

  if (body.area_id && BigInt(body.area_id) !== existing.area_id) {
    targetAreaId = BigInt(body.area_id);
    const newArea = await prisma.zmccArea.findUnique({
      where: { id: targetAreaId },
      include: { route: { include: { zmcc: true } } },
    });
    if (!newArea) {
      return { status: 400, error: 'New area not found.' };
    }
    // Hierarchy consistency check
    if (!newArea.route || !newArea.route.zmcc || newArea.route.zmcc_id !== newArea.zmcc_id) {
      return { status: 400, error: 'Cannot transfer shop: Area route and ZMCC hierarchy is inconsistent.' };
    }
    // Area must be in same ZMCC
    if (newArea.zmcc_id !== existing.zmcc_id) {
      return { status: 409, error: 'Cannot transfer shop to an area in another ZMCC.' };
    }
    // Source type must be ZMCC
    if (newArea.route.zmcc.source_type !== 'ZMCC') {
      return { status: 400, error: 'Cannot transfer shop: Target procurement source is not a valid ZMCC.' };
    }
    // Parent ZMCC must be active
    if (!newArea.route.zmcc.is_active) {
      return { status: 409, error: 'Cannot transfer shop: Parent ZMCC is inactive.' };
    }
    // Parent Route must be active
    if (!newArea.route.is_active) {
      return { status: 409, error: 'Cannot transfer shop: Parent Route is inactive.' };
    }
    // Area must be active
    if (!newArea.is_active) {
      return { status: 409, error: 'Cannot assign shop to an inactive area.' };
    }
    targetRouteId = newArea.route_id;
  }

  // Name uniqueness check if name or area changed
  if (shop_name !== existing.shop_name || targetAreaId !== existing.area_id) {
    const dup = await prisma.zmccShop.findUnique({
      where: { area_id_shop_name: { area_id: targetAreaId, shop_name } },
    });
    if (dup && dup.id !== shopId) {
      return { status: 409, error: `Shop name "${shop_name}" already exists in this area.` };
    }
  }

  let targetChillerOwnershipId = existing.chiller_ownership_id;
  if (body.chiller_ownership_id && BigInt(body.chiller_ownership_id) !== existing.chiller_ownership_id) {
    targetChillerOwnershipId = BigInt(body.chiller_ownership_id);
    const newCo = await prisma.chillerOwnership.findUnique({ where: { id: targetChillerOwnershipId } });
    if (!newCo) {
      return { status: 400, error: 'Selected chiller ownership not found.' };
    }
    if (!newCo.is_active) {
      return { status: 409, error: 'Cannot assign shop to an inactive chiller ownership.' };
    }
  }

  // GPS validation
  let targetLat = existing.latitude ? Number(existing.latitude) : null;
  let targetLng = existing.longitude ? Number(existing.longitude) : null;
  if (body.latitude !== undefined || body.longitude !== undefined) {
    targetLat = body.latitude !== undefined ? body.latitude : targetLat;
    targetLng = body.longitude !== undefined ? body.longitude : targetLng;
    const gpsCheck = validateGps(targetLat, targetLng);
    if (!gpsCheck.valid) {
      return { status: 400, error: gpsCheck.error };
    }
  }

  // Lifecycle check
  let targetActive = existing.is_active;
  let action = 'ZMCC_SHOP_UPDATED';

  if (body.is_active !== undefined) {
    targetActive = body.is_active;
    if (targetActive && !existing.is_active) {
      // Must verify all parents are active before reactivating
      const activeArea = await prisma.zmccArea.findUnique({
        where: { id: targetAreaId },
        include: { route: { include: { zmcc: true } } },
      });
      if (!activeArea || !activeArea.is_active) {
        return { status: 409, error: 'Cannot activate shop: parent area is inactive.' };
      }
      if (!activeArea.route.is_active) {
        return { status: 409, error: 'Cannot activate shop: parent route is inactive.' };
      }
      if (!activeArea.route.zmcc.is_active) {
        return { status: 409, error: 'Cannot activate shop: parent ZMCC is inactive.' };
      }

      const activeCo = await prisma.chillerOwnership.findUnique({ where: { id: targetChillerOwnershipId } });
      if (!activeCo || !activeCo.is_active) {
        return { status: 409, error: 'Cannot activate shop: assigned chiller ownership is inactive.' };
      }

      action = 'ZMCC_SHOP_ACTIVATED';
    } else if (!targetActive && existing.is_active) {
      action = 'ZMCC_SHOP_DEACTIVATED';
    }
  }

  const updatedGeotagStatus = (targetLat != null && targetLng != null) ? 'VERIFIED' : existing.geotag_status;

  return await prisma.$transaction(async (tx) => {
    const updated = await tx.zmccShop.update({
      where: { id: shopId },
      data: {
        shop_name,
        owner_name,
        phone_number,
        cnic,
        area_id: targetAreaId,
        route_id: targetRouteId,
        chiller_ownership_id: targetChillerOwnershipId,
        latitude: targetLat,
        longitude: targetLng,
        geotag_status: updatedGeotagStatus,
        is_active: targetActive,
        updated_by: auth.actorUserId,
      },
    });

    await writeAuditLog(tx, {
      tableName: 'zmcc_shop',
      recordId: shopId,
      action,
      oldValues: {
        shop_name: existing.shop_name,
        owner_name: existing.owner_name,
        phone_number: existing.phone_number,
        cnic: existing.cnic,
        area_id: existing.area_id.toString(),
        route_id: existing.route_id.toString(),
        chiller_ownership_id: existing.chiller_ownership_id.toString(),
        is_active: existing.is_active,
        geotag_status: existing.geotag_status,
      },
      newValues: {
        shop_name: updated.shop_name,
        owner_name: updated.owner_name,
        phone_number: updated.phone_number,
        cnic: updated.cnic,
        area_id: updated.area_id.toString(),
        route_id: updated.route_id.toString(),
        chiller_ownership_id: updated.chiller_ownership_id.toString(),
        is_active: updated.is_active,
        geotag_status: updated.geotag_status,
      },
      actor: { userId: auth.actorUserId, actorRole: auth.role },
    });

    return {
      status: 200,
      data: {
        id: updated.id.toString(),
        shop_code: updated.shop_code,
        shop_name: updated.shop_name,
        is_active: updated.is_active,
        geotag_status: updated.geotag_status,
      },
    };
  });
}

export async function requestNewShop(
  auth: ZmccAuthContext,
  body: {
    shop_name: string;
    owner_name: string;
    phone_number: string;
    cnic: string;
    route_id?: string;
    area_id?: string;
    chiller_ownership_id?: string;
    latitude?: number | null;
    longitude?: number | null;
  }
): Promise<ServiceResult<unknown>> {
  const shop_name = body.shop_name?.trim();
  const owner_name = body.owner_name?.trim();
  const phoneInput = body.phone_number?.trim();
  const cnicInput = body.cnic?.trim();

  if (!shop_name || !owner_name || !phoneInput || !cnicInput) {
    return { status: 400, error: 'Shop name, owner name, phone number, and CNIC are required.' };
  }

  const phoneResult = normalizePakistaniMobile(phoneInput);
  if (!phoneResult.ok) return { status: 400, error: phoneResult.error };
  const cnicResult = normalizePakistaniCnic(cnicInput);
  if (!cnicResult.ok) return { status: 400, error: cnicResult.error };

  const phone_number = phoneResult.value;
  const cnic = cnicResult.value;

  const gpsCheck = validateGps(body.latitude, body.longitude);
  if (!gpsCheck.valid) {
    return { status: 400, error: gpsCheck.error };
  }

  let effectiveZmccId = auth.effectiveZmccId;
  let targetAreaId: bigint | null = null;
  let targetRouteId: bigint | null = null;

  if (body.area_id) {
    const area = await prisma.zmccArea.findUnique({
      where: { id: BigInt(body.area_id) },
      include: { route: true },
    });
    if (!area) return { status: 400, error: 'Selected area not found.' };
    targetAreaId = area.id;
    targetRouteId = area.route_id;
    if (!auth.isSuperAdmin && area.zmcc_id !== effectiveZmccId) {
      return { status: 403, error: 'Forbidden. Selected area belongs to a different ZMCC.' };
    }
    effectiveZmccId = area.zmcc_id;
  } else if (body.route_id) {
    const route = await prisma.zmccRoute.findUnique({
      where: { id: BigInt(body.route_id) },
      include: { areas: { where: { is_active: true } } },
    });
    if (!route) return { status: 400, error: 'Selected route not found.' };
    targetRouteId = route.id;
    if (!auth.isSuperAdmin && route.zmcc_id !== effectiveZmccId) {
      return { status: 403, error: 'Forbidden. Selected route belongs to a different ZMCC.' };
    }
    effectiveZmccId = route.zmcc_id;
    if (route.areas.length > 0) {
      targetAreaId = route.areas[0].id;
    } else {
      let anyArea = await prisma.zmccArea.findFirst({ where: { route_id: route.id } });
      if (!anyArea) {
        anyArea = await prisma.zmccArea.create({
          data: {
            area_code: `AR-${route.route_code}-01`,
            name: `${route.name} General`,
            route_id: route.id,
            zmcc_id: effectiveZmccId!,
            is_active: true,
            approval_status: 'ACTIVE',
            created_by: auth.actorUserId,
          },
        });
      }
      targetAreaId = anyArea.id;
    }
  } else {
    if (!effectiveZmccId) {
      return { status: 400, error: 'Route or Area must be selected.' };
    }
    const defaultArea = await prisma.zmccArea.findFirst({
      where: { zmcc_id: effectiveZmccId, is_active: true },
    });
    if (!defaultArea) {
      return { status: 400, error: 'No active areas available in this ZMCC. Please create an area first.' };
    }
    targetAreaId = defaultArea.id;
    targetRouteId = defaultArea.route_id;
  }

  // Validate or resolve Chiller Ownership
  let chillerOwnershipId: bigint;
  if (body.chiller_ownership_id) {
    const co = await prisma.chillerOwnership.findUnique({ where: { id: BigInt(body.chiller_ownership_id) } });
    if (!co) return { status: 400, error: 'Invalid chiller ownership selected.' };
    chillerOwnershipId = co.id;
  } else {
    let defaultCo = await prisma.chillerOwnership.findFirst({ where: { is_active: true } });
    if (!defaultCo) {
      defaultCo = await prisma.chillerOwnership.create({
        data: {
          ownership_code: 'COMPANY_OWNED',
          name: 'Company Owned Chiller',
          is_active: true,
          created_by: auth.actorUserId,
        },
      });
    }
    chillerOwnershipId = defaultCo.id;
  }

  const hasGps = body.latitude != null && body.longitude != null;
  const geotag_status = hasGps ? 'VERIFIED' : 'PENDING_FIRST_VISIT';
  const tempShopCode = `REQ-${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 900 + 100)}`;

  return await prisma.$transaction(async (tx) => {
    const created = await tx.zmccShop.create({
      data: {
        shop_code: tempShopCode,
        shop_name,
        owner_name,
        phone_number,
        cnic,
        area_id: targetAreaId!,
        route_id: targetRouteId!,
        zmcc_id: effectiveZmccId!,
        chiller_ownership_id: chillerOwnershipId,
        latitude: hasGps ? body.latitude : null,
        longitude: hasGps ? body.longitude : null,
        is_active: false,
        approval_status: 'PENDING_APPROVAL',
        geotag_status,
        created_by: auth.actorUserId,
        created_as_role: auth.acting.actingAs,
        created_is_delegated: auth.acting.isDelegated,
      },
    });

    await writeAuditLog(tx, {
      tableName: 'zmcc_shop',
      recordId: created.id,
      action: 'ZMCC_SHOP_REQUESTED',
      oldValues: undefined,
      newValues: {
        id: created.id.toString(),
        temp_shop_code: tempShopCode,
        shop_name,
        owner_name,
        phone_number,
        cnic,
        area_id: targetAreaId!.toString(),
        route_id: targetRouteId!.toString(),
        zmcc_id: effectiveZmccId!.toString(),
        geotag_status,
      },
      actor: auditActorFor(auth),
    });

    return {
      status: 201,
      data: {
        id: created.id.toString(),
        shop_code: created.shop_code,
        shop_name: created.shop_name,
        owner_name: created.owner_name,
        phone_number: created.phone_number,
        cnic: created.cnic,
        approval_status: created.approval_status,
        geotag_status: created.geotag_status,
        is_active: created.is_active,
      },
    };
  });
}

export async function approveShop(auth: ZmccAuthContext, shopId: bigint): Promise<ServiceResult<unknown>> {
  // MDO and above (PHE Operator no longer approves shops)
  if (!canActAs(auth.role, 'MDO')) {
    return { status: 403, error: 'Forbidden. Only the MDO (or a Zonal Manager or above) can approve shops.' };
  }

  const existing = await prisma.zmccShop.findUnique({
    where: { id: shopId },
    include: {
      area: {
        include: { route: true },
      },
    },
  });
  if (!existing) {
    return { status: 404, error: 'Shop not found.' };
  }

  if (!auth.isSuperAdmin && !inZmccScope(auth, existing.zmcc_id)) {
    return { status: 403, error: 'Forbidden. You cannot approve shops outside your assigned ZMCC.' };
  }

  if (existing.approval_status === 'ACTIVE' && existing.is_active) {
    return { status: 409, error: 'Shop is already active and approved.' };
  }

  return await prisma.$transaction(async (tx) => {
    // Allocate sequential shop_code (SHP-000001 format)
    const latestShop = await tx.zmccShop.findFirst({
      where: { shop_code: { startsWith: 'SHP-' } },
      orderBy: { shop_code: 'desc' },
      select: { shop_code: true },
    });
    let nextNum = 1;
    if (latestShop && /^SHP-(\d+)$/.test(latestShop.shop_code)) {
      const match = latestShop.shop_code.match(/^SHP-(\d+)$/);
      if (match) nextNum = parseInt(match[1], 10) + 1;
    }
    let allocatedCode = `SHP-${String(nextNum).padStart(6, '0')}`;
    while (await tx.zmccShop.findUnique({ where: { shop_code: allocatedCode } })) {
      nextNum++;
      allocatedCode = `SHP-${String(nextNum).padStart(6, '0')}`;
    }

    const updated = await tx.zmccShop.update({
      where: { id: shopId },
      data: {
        shop_code: allocatedCode,
        approval_status: 'ACTIVE',
        is_active: true,
        approved_by: auth.actorUserId,
        approved_at: new Date(),
        approved_as_role: auth.acting.actingAs,
        approved_is_delegated: auth.acting.isDelegated,
        rejection_reason: null,
        updated_by: auth.actorUserId,
      },
    });

    // If there is an active COLLECTING journey for that route, inject a new stop
    const activeJourneys = await tx.motJourney.findMany({
      where: {
        route_id: updated.route_id,
        status: 'COLLECTING',
      },
      include: {
        stops: {
          orderBy: { planned_sequence: 'desc' },
          take: 1,
        },
      },
    });

    for (const journey of activeJourneys) {
      const existingStop = await tx.motJourneyStop.findUnique({
        where: {
          journey_id_shop_id: {
            journey_id: journey.id,
            shop_id: updated.id,
          },
        },
      });
      if (!existingStop) {
        const lastSeq = journey.stops[0]?.planned_sequence ?? 0;
        await tx.motJourneyStop.create({
          data: {
            journey_id: journey.id,
            shop_id: updated.id,
            planned_sequence: lastSeq + 1,
            status: 'PENDING',
            shop_code_snapshot: updated.shop_code,
            shop_name_snapshot: updated.shop_name,
            owner_name_snapshot: updated.owner_name,
            phone_number_snapshot: updated.phone_number,
            area_code_snapshot: existing.area.area_code,
            area_name_snapshot: existing.area.name,
            planned_latitude_snapshot: updated.latitude,
            planned_longitude_snapshot: updated.longitude,
          },
        });
      }
    }

    await writeAuditLog(tx, {
      tableName: 'zmcc_shop',
      recordId: shopId,
      action: 'ZMCC_SHOP_APPROVED',
      oldValues: {
        shop_code: existing.shop_code,
        approval_status: existing.approval_status,
        is_active: existing.is_active,
      },
      newValues: {
        shop_code: allocatedCode,
        approval_status: 'ACTIVE',
        is_active: true,
        approved_by: auth.actorUserId.toString(),
      },
      actor: auditActorFor(auth),
    });

    return {
      status: 200,
      data: {
        id: updated.id.toString(),
        shop_code: updated.shop_code,
        shop_name: updated.shop_name,
        approval_status: updated.approval_status,
        is_active: updated.is_active,
        approved_at: updated.approved_at?.toISOString(),
      },
    };
  });
}

export async function rejectShop(auth: ZmccAuthContext, shopId: bigint, reason: string): Promise<ServiceResult<unknown>> {
  if (!canActAs(auth.role, 'MDO')) {
    return { status: 403, error: 'Forbidden. Only the MDO (or a Zonal Manager or above) can reject shops.' };
  }

  const cleanReason = reason?.trim();
  if (!cleanReason) {
    return { status: 400, error: 'Rejection reason is required.' };
  }

  const existing = await prisma.zmccShop.findUnique({
    where: { id: shopId },
  });
  if (!existing) {
    return { status: 404, error: 'Shop not found.' };
  }

  if (!auth.isSuperAdmin && !inZmccScope(auth, existing.zmcc_id)) {
    return { status: 403, error: 'Forbidden. You cannot reject shops outside your assigned ZMCC.' };
  }

  return await prisma.$transaction(async (tx) => {
    const updated = await tx.zmccShop.update({
      where: { id: shopId },
      data: {
        approval_status: 'REJECTED',
        is_active: false,
        rejection_reason: cleanReason,
        approved_by: auth.actorUserId,
        approved_at: new Date(),
        approved_as_role: auth.acting.actingAs,
        approved_is_delegated: auth.acting.isDelegated,
        updated_by: auth.actorUserId,
      },
    });

    await writeAuditLog(tx, {
      tableName: 'zmcc_shop',
      recordId: shopId,
      action: 'ZMCC_SHOP_REJECTED',
      oldValues: {
        approval_status: existing.approval_status,
        is_active: existing.is_active,
      },
      newValues: {
        approval_status: 'REJECTED',
        is_active: false,
        rejection_reason: cleanReason,
        rejected_by: auth.actorUserId.toString(),
      },
      actor: auditActorFor(auth),
    });

    return {
      status: 200,
      data: {
        id: updated.id.toString(),
        shop_code: updated.shop_code,
        shop_name: updated.shop_name,
        approval_status: updated.approval_status,
        is_active: updated.is_active,
        rejection_reason: updated.rejection_reason,
      },
    };
  });
}

export async function listPendingShops(auth: ZmccAuthContext) {
  const where: Prisma.ZmccShopWhereInput = {
    approval_status: 'PENDING_APPROVAL',
  };

  if (!auth.isSuperAdmin) {
    where.zmcc_id = requireZmccScope(auth);
  }

  const shops = await prisma.zmccShop.findMany({
    where,
    orderBy: { created_at: 'desc' },
    include: {
      area: {
        include: {
          route: { select: { id: true, route_code: true, name: true } },
        },
      },
      creator: { select: { id: true, username: true, full_name: true } },
    },
  });

  return shops.map((s) => ({
    id: s.id.toString(),
    shop_code: s.shop_code,
    shop_name: s.shop_name,
    owner_name: s.owner_name,
    phone_number: s.phone_number,
    cnic: s.cnic,
    area_id: s.area_id.toString(),
    route_id: s.route_id.toString(),
    zmcc_id: s.zmcc_id.toString(),
    latitude: s.latitude ? Number(s.latitude) : null,
    longitude: s.longitude ? Number(s.longitude) : null,
    is_active: s.is_active,
    approval_status: s.approval_status,
    rejection_reason: s.rejection_reason,
    geotag_status: s.geotag_status,
    area_name: s.area.name,
    area_code: s.area.area_code,
    route_name: s.area.route.name,
    route_code: s.area.route.route_code,
    creator_name: s.creator.full_name || s.creator.username,
    created_at: s.created_at.toISOString(),
  }));
}
