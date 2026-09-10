import { prisma } from '@core/db';
import { getCurrentUser } from '@core/auth';
import { User, Role } from '@core/types';

export interface ZmccAuthContext {
  user: User;
  actorUserId: bigint;
  role: Role;
  isSuperAdmin: boolean;
  isZmccManager: boolean;
  isPheOperator: boolean;
  effectiveZmccId: bigint | null;
}

export type RequiredMasterDataAction =
  | 'READ'
  | 'WRITE_ROUTE'
  | 'WRITE_AREA'
  | 'WRITE_MILK_SOURCE'
  | 'WRITE_CHILLER_OWNERSHIP'
  | 'WRITE_SHOP';

export interface ServiceResult<T> {
  status: number;
  data?: T;
  error?: string;
}

/**
 * Server-side Authorization & Scope Resolver for ZMCC Master Data
 */
export async function resolveZmccAuth(
  req?: Request,
  requiredAction: RequiredMasterDataAction = 'READ'
): Promise<{ auth?: ZmccAuthContext; errorResponse?: { error: string; status: number } }> {
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

  // 1. Validate permitted roles
  if (!isSuperAdmin && !isZmccManager && !isPheOperator) {
    return {
      errorResponse: {
        error: 'Forbidden. You do not have permission to access ZMCC Master Data.',
        status: 403,
      },
    };
  }

  // 2. Validate source assignment for scoped roles (ZMCC_MANAGER, PHE_OPERATOR)
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

  // 3. Validate specific write permissions
  if (requiredAction === 'WRITE_CHILLER_OWNERSHIP' && !isSuperAdmin) {
    return {
      errorResponse: {
        error: 'Forbidden. Only Super Admin may manage global Chiller Ownership.',
        status: 403,
      },
    };
  }

  if (
    isPheOperator &&
    (requiredAction === 'WRITE_ROUTE' ||
      requiredAction === 'WRITE_AREA' ||
      requiredAction === 'WRITE_MILK_SOURCE')
  ) {
    return {
      errorResponse: {
        error: 'Forbidden. PHE Operator may only manage shops in their assigned ZMCC.',
        status: 403,
      },
    };
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

// -------------------------------------------------------------
// Validation Helpers
// -------------------------------------------------------------
const PHONE_REGEX = /^(\+92-?|92-?|0)?3[0-9]{2}-?[0-9]{7}$/;
const CNIC_REGEX = /^([0-9]{13}|[0-9]{5}-[0-9]{7}-[0-9])$/;

export function validatePhone(phone: string): boolean {
  return PHONE_REGEX.test(phone.trim());
}

export function validateCnic(cnic: string): boolean {
  return CNIC_REGEX.test(cnic.trim());
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

  // PHE requires routes only as active selectable dropdown options
  if (auth.isPheOperator) {
    where.is_active = true;
  } else if (filters?.is_active !== undefined && filters.is_active !== 'all') {
    where.is_active = filters.is_active === 'true';
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

  // PHE Operator cannot view inactive routes directly
  if (auth.isPheOperator && !route.is_active) {
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
    route_code: string;
    name: string;
    origin: string;
    destination: string;
    zmcc_id?: string;
  }
): Promise<ServiceResult<any>> {
  const route_code = body.route_code?.trim();
  const name = body.name?.trim();
  const origin = body.origin?.trim();
  const destination = body.destination?.trim();

  if (!route_code || !name || !origin || !destination) {
    return { status: 400, error: 'Route code, name, origin, and destination are required and cannot be empty.' };
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

  // Check unique constraints
  const existingCode = await prisma.zmccRoute.findUnique({ where: { route_code } });
  if (existingCode) {
    return { status: 409, error: `Route code "${route_code}" already exists.` };
  }

  const existingName = await prisma.zmccRoute.findUnique({
    where: { zmcc_id_name: { zmcc_id: zmccId, name } },
  });
  if (existingName) {
    return { status: 409, error: `Route name "${name}" already exists in this ZMCC.` };
  }

  return await prisma.$transaction(async (tx) => {
    const created = await tx.zmccRoute.create({
      data: {
        route_code,
        name,
        origin,
        destination,
        zmcc_id: zmccId,
        is_active: true,
        created_by: auth.actorUserId,
      },
    });

    await tx.auditLog.create({
      data: {
        table_name: 'zmcc_route',
        record_id: created.id,
        action: 'ZMCC_ROUTE_CREATED',
        old_values: undefined,
        new_values: {
          id: created.id.toString(),
          route_code: created.route_code,
          name: created.name,
          origin: created.origin,
          destination: created.destination,
          zmcc_id: created.zmcc_id.toString(),
          is_active: true,
        },
        user_id: auth.actorUserId,
      },
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
      },
    };
  });
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
): Promise<ServiceResult<any>> {
  const existing = await prisma.zmccRoute.findUnique({
    where: { id: routeId },
    include: { zmcc: true },
  });
  if (!existing) {
    return { status: 404, error: 'Route not found.' };
  }

  if (!auth.isSuperAdmin && existing.zmcc_id !== auth.effectiveZmccId) {
    return { status: 403, error: 'Forbidden. You cannot modify routes outside your assigned ZMCC.' };
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

    await tx.auditLog.create({
      data: {
        table_name: 'zmcc_route',
        record_id: routeId,
        action,
        old_values: {
          name: existing.name,
          origin: existing.origin,
          destination: existing.destination,
          is_active: existing.is_active,
        },
        new_values: {
          name: updated.name,
          origin: updated.origin,
          destination: updated.destination,
          is_active: updated.is_active,
        },
        user_id: auth.actorUserId,
      },
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
  const where: any = {};

  if (auth.isSuperAdmin) {
    if (filters?.zmcc_id) {
      where.zmcc_id = BigInt(filters.zmcc_id);
    }
  } else {
    where.zmcc_id = auth.effectiveZmccId;
  }

  if (filters?.route_id) {
    where.route_id = BigInt(filters.route_id);
  }

  // PHE requires areas only as active selectable dropdown options
  if (auth.isPheOperator) {
    where.is_active = true;
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
  if (auth.isPheOperator && !area.is_active) {
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
    area_code: string;
    name: string;
    route_id: string;
  }
): Promise<ServiceResult<any>> {
  const area_code = body.area_code?.trim();
  const name = body.name?.trim();

  if (!area_code || !name || !body.route_id) {
    return { status: 400, error: 'Area code, name, and route selection are required.' };
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

  // Check unique constraints
  const existingCode = await prisma.zmccArea.findUnique({ where: { area_code } });
  if (existingCode) {
    return { status: 409, error: `Area code "${area_code}" already exists.` };
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
        area_code,
        name,
        route_id: routeId,
        zmcc_id: effectiveZmccId,
        is_active: true,
        created_by: auth.actorUserId,
      },
    });

    await tx.auditLog.create({
      data: {
        table_name: 'zmcc_area',
        record_id: created.id,
        action: 'ZMCC_AREA_CREATED',
        old_values: undefined,
        new_values: {
          id: created.id.toString(),
          area_code: created.area_code,
          name: created.name,
          route_id: created.route_id.toString(),
          zmcc_id: created.zmcc_id.toString(),
          is_active: true,
        },
        user_id: auth.actorUserId,
      },
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
): Promise<ServiceResult<any>> {
  const existing = await prisma.zmccArea.findUnique({
    where: { id: areaId },
    include: { route: { include: { zmcc: true } } },
  });

  if (!existing) {
    return { status: 404, error: 'Area not found.' };
  }

  if (!auth.isSuperAdmin && existing.zmcc_id !== auth.effectiveZmccId) {
    return { status: 403, error: 'Forbidden. You cannot modify areas outside your assigned ZMCC.' };
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

    await tx.auditLog.create({
      data: {
        table_name: 'zmcc_area',
        record_id: areaId,
        action,
        old_values: {
          name: existing.name,
          is_active: existing.is_active,
        },
        new_values: {
          name: updated.name,
          is_active: updated.is_active,
        },
        user_id: auth.actorUserId,
      },
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
  const where: any = {};

  if (auth.isSuperAdmin) {
    if (filters?.zmcc_id) {
      where.zmcc_id = BigInt(filters.zmcc_id);
    }
  } else {
    where.zmcc_id = auth.effectiveZmccId;
  }

  // PHE requires milk sources only as active selectable dropdown options
  if (auth.isPheOperator) {
    where.is_active = true;
  } else if (filters?.is_active !== undefined && filters.is_active !== 'all') {
    where.is_active = filters.is_active === 'true';
  }

  if (filters?.search) {
    const s = filters.search.trim();
    where.OR = [
      { erp_code: { contains: s, mode: 'insensitive' } },
      { name: { contains: s, mode: 'insensitive' } },
    ];
  }

  const sources = await prisma.zmccMilkSource.findMany({
    where,
    orderBy: { erp_code: 'asc' },
    include: {
      zmcc: { select: { id: true, code: true, name: true, is_active: true } },
      creator: { select: { id: true, username: true, full_name: true } },
      updater: { select: { id: true, username: true, full_name: true } },
      _count: { select: { shops: true } },
    },
  });

  return sources.map((ms) => ({
    id: ms.id.toString(),
    erp_code: ms.erp_code,
    name: ms.name,
    zmcc_id: ms.zmcc_id.toString(),
    zmcc: {
      id: ms.zmcc.id.toString(),
      code: ms.zmcc.code,
      name: ms.zmcc.name,
      is_active: ms.zmcc.is_active,
    },
    is_active: ms.is_active,
    created_by: ms.created_by.toString(),
    updated_by: ms.updated_by ? ms.updated_by.toString() : null,
    creator_name: ms.creator.full_name || ms.creator.username,
    updater_name: ms.updater ? ms.updater.full_name || ms.updater.username : null,
    created_at: ms.created_at.toISOString(),
    updated_at: ms.updated_at.toISOString(),
    shop_count: ms._count.shops,
  }));
}

export async function getMilkSourceById(auth: ZmccAuthContext, sourceId: bigint) {
  const ms = await prisma.zmccMilkSource.findUnique({
    where: { id: sourceId },
    include: {
      zmcc: { select: { id: true, code: true, name: true, is_active: true } },
      creator: { select: { id: true, username: true, full_name: true } },
      updater: { select: { id: true, username: true, full_name: true } },
    },
  });

  if (!ms) {
    return null;
  }

  if (!auth.isSuperAdmin && ms.zmcc_id !== auth.effectiveZmccId) {
    return null;
  }

  // PHE Operator cannot view inactive milk sources directly
  if (auth.isPheOperator && !ms.is_active) {
    return null;
  }

  return {
    id: ms.id.toString(),
    erp_code: ms.erp_code,
    name: ms.name,
    zmcc_id: ms.zmcc_id.toString(),
    zmcc: {
      id: ms.zmcc.id.toString(),
      code: ms.zmcc.code,
      name: ms.zmcc.name,
      is_active: ms.zmcc.is_active,
    },
    is_active: ms.is_active,
    created_by: ms.created_by.toString(),
    updated_by: ms.updated_by ? ms.updated_by.toString() : null,
    creator_name: ms.creator.full_name || ms.creator.username,
    updater_name: ms.updater ? ms.updater.full_name || ms.updater.username : null,
    created_at: ms.created_at.toISOString(),
    updated_at: ms.updated_at.toISOString(),
  };
}

export async function createMilkSource(
  auth: ZmccAuthContext,
  body: {
    erp_code: string;
    name: string;
    zmcc_id?: string;
  }
): Promise<ServiceResult<any>> {
  const erp_code = body.erp_code?.trim();
  const name = body.name?.trim();

  if (!erp_code || !name) {
    return { status: 400, error: 'ERP code and name are required.' };
  }

  let zmccId: bigint;
  if (auth.isSuperAdmin) {
    if (!body.zmcc_id) {
      return { status: 400, error: 'Super Admin must select a ZMCC for the new milk source.' };
    }
    zmccId = BigInt(body.zmcc_id);
  } else {
    zmccId = auth.effectiveZmccId!;
  }

  const zmcc = await prisma.procurementSource.findUnique({ where: { id: zmccId } });
  if (!zmcc || zmcc.source_type !== 'ZMCC') {
    return { status: 400, error: 'Target procurement source is not a valid ZMCC.' };
  }
  if (!zmcc.is_active) {
    return { status: 409, error: 'Cannot create milk source under an inactive ZMCC.' };
  }

  const existingCode = await prisma.zmccMilkSource.findUnique({ where: { erp_code } });
  if (existingCode) {
    return { status: 409, error: `ERP code "${erp_code}" already exists.` };
  }

  const existingName = await prisma.zmccMilkSource.findUnique({
    where: { zmcc_id_name: { zmcc_id: zmccId, name } },
  });
  if (existingName) {
    return { status: 409, error: `Milk source name "${name}" already exists in this ZMCC.` };
  }

  return await prisma.$transaction(async (tx) => {
    const created = await tx.zmccMilkSource.create({
      data: {
        erp_code,
        name,
        zmcc_id: zmccId,
        is_active: true,
        created_by: auth.actorUserId,
      },
    });

    await tx.auditLog.create({
      data: {
        table_name: 'zmcc_milk_source',
        record_id: created.id,
        action: 'ZMCC_MILK_SOURCE_CREATED',
        old_values: undefined,
        new_values: {
          id: created.id.toString(),
          erp_code: created.erp_code,
          name: created.name,
          zmcc_id: created.zmcc_id.toString(),
          is_active: true,
        },
        user_id: auth.actorUserId,
      },
    });

    return {
      status: 201,
      data: {
        id: created.id.toString(),
        erp_code: created.erp_code,
        name: created.name,
        zmcc_id: created.zmcc_id.toString(),
        is_active: created.is_active,
      },
    };
  });
}

export async function updateMilkSource(
  auth: ZmccAuthContext,
  sourceId: bigint,
  body: {
    name?: string;
    is_active?: boolean;
  }
): Promise<ServiceResult<any>> {
  const existing = await prisma.zmccMilkSource.findUnique({
    where: { id: sourceId },
    include: { zmcc: true },
  });
  if (!existing) {
    return { status: 404, error: 'Milk source not found.' };
  }

  if (!auth.isSuperAdmin && existing.zmcc_id !== auth.effectiveZmccId) {
    return { status: 403, error: 'Forbidden. You cannot modify milk sources outside your assigned ZMCC.' };
  }

  const name = body.name !== undefined ? body.name.trim() : existing.name;
  if (!name) {
    return { status: 400, error: 'Milk source name cannot be empty.' };
  }

  if (name !== existing.name) {
    const dup = await prisma.zmccMilkSource.findUnique({
      where: { zmcc_id_name: { zmcc_id: existing.zmcc_id, name } },
    });
    if (dup && dup.id !== sourceId) {
      return { status: 409, error: `Milk source name "${name}" already exists in this ZMCC.` };
    }
  }

  let targetActive = existing.is_active;
  let action = 'ZMCC_MILK_SOURCE_UPDATED';

  if (body.is_active !== undefined) {
    targetActive = body.is_active;
    if (targetActive && !existing.is_active) {
      // Activation: parent ZMCC must be active
      if (!existing.zmcc.is_active) {
        return { status: 409, error: 'Cannot activate milk source: parent ZMCC is inactive.' };
      }
      action = 'ZMCC_MILK_SOURCE_ACTIVATED';
    } else if (!targetActive && existing.is_active) {
      // Deactivation: block if active shops exist
      const activeShopsCount = await prisma.zmccShop.count({
        where: { milk_source_id: sourceId, is_active: true },
      });
      if (activeShopsCount > 0) {
        return {
          status: 409,
          error: `Cannot deactivate milk source: ${activeShopsCount} active shop(s) depend on this source. Deactivate shops first.`,
        };
      }
      action = 'ZMCC_MILK_SOURCE_DEACTIVATED';
    }
  }

  return await prisma.$transaction(async (tx) => {
    const updated = await tx.zmccMilkSource.update({
      where: { id: sourceId },
      data: {
        name,
        is_active: targetActive,
        updated_by: auth.actorUserId,
      },
    });

    await tx.auditLog.create({
      data: {
        table_name: 'zmcc_milk_source',
        record_id: sourceId,
        action,
        old_values: {
          name: existing.name,
          is_active: existing.is_active,
        },
        new_values: {
          name: updated.name,
          is_active: updated.is_active,
        },
        user_id: auth.actorUserId,
      },
    });

    return {
      status: 200,
      data: {
        id: updated.id.toString(),
        erp_code: updated.erp_code,
        name: updated.name,
        zmcc_id: updated.zmcc_id.toString(),
        is_active: updated.is_active,
      },
    };
  });
}

// =============================================================
// CHILLER OWNERSHIP (GLOBAL MASTER)
// =============================================================

export async function listChillerOwnerships(
  auth: ZmccAuthContext,
  filters?: { is_active?: string; search?: string }
) {
  const where: any = {};

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
): Promise<ServiceResult<any>> {
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

    await tx.auditLog.create({
      data: {
        table_name: 'chiller_ownership',
        record_id: created.id,
        action: 'CHILLER_OWNERSHIP_CREATED',
        old_values: undefined,
        new_values: {
          id: created.id.toString(),
          ownership_code: created.ownership_code,
          name: created.name,
          is_active: true,
        },
        user_id: auth.actorUserId,
      },
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
): Promise<ServiceResult<any>> {
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

    await tx.auditLog.create({
      data: {
        table_name: 'chiller_ownership',
        record_id: id,
        action,
        old_values: {
          name: existing.name,
          is_active: existing.is_active,
        },
        new_values: {
          name: updated.name,
          is_active: updated.is_active,
        },
        user_id: auth.actorUserId,
      },
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
    milk_source_id?: string;
    chiller_ownership_id?: string;
    is_active?: string;
    search?: string;
    zmcc_id?: string;
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

  if (filters?.route_id) {
    where.route_id = BigInt(filters.route_id);
  }
  if (filters?.area_id) {
    where.area_id = BigInt(filters.area_id);
  }
  if (filters?.milk_source_id) {
    where.milk_source_id = BigInt(filters.milk_source_id);
  }
  if (filters?.chiller_ownership_id) {
    where.chiller_ownership_id = BigInt(filters.chiller_ownership_id);
  }

  if (filters?.is_active !== undefined && filters.is_active !== 'all') {
    where.is_active = filters.is_active === 'true';
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

  const shops = await prisma.zmccShop.findMany({
    where,
    orderBy: { shop_code: 'asc' },
    include: {
      area: { select: { id: true, area_code: true, name: true, is_active: true } },
      milk_source: { select: { id: true, erp_code: true, name: true, is_active: true } },
      chiller_ownership: { select: { id: true, ownership_code: true, name: true, is_active: true } },
      creator: { select: { id: true, username: true, full_name: true } },
      updater: { select: { id: true, username: true, full_name: true } },
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
    milk_source_id: s.milk_source_id.toString(),
    chiller_ownership_id: s.chiller_ownership_id.toString(),
    latitude: s.latitude ? Number(s.latitude) : null,
    longitude: s.longitude ? Number(s.longitude) : null,
    is_active: s.is_active,
    area: {
      id: s.area.id.toString(),
      area_code: s.area.area_code,
      name: s.area.name,
      is_active: s.area.is_active,
    },
    milk_source: {
      id: s.milk_source.id.toString(),
      erp_code: s.milk_source.erp_code,
      name: s.milk_source.name,
      is_active: s.milk_source.is_active,
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
      milk_source: true,
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
    milk_source_id: shop.milk_source_id.toString(),
    chiller_ownership_id: shop.chiller_ownership_id.toString(),
    latitude: shop.latitude ? Number(shop.latitude) : null,
    longitude: shop.longitude ? Number(shop.longitude) : null,
    is_active: shop.is_active,
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
    milk_source: {
      id: shop.milk_source.id.toString(),
      erp_code: shop.milk_source.erp_code,
      name: shop.milk_source.name,
      is_active: shop.milk_source.is_active,
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
    shop_code: string;
    shop_name: string;
    owner_name: string;
    phone_number: string;
    cnic: string;
    area_id: string;
    milk_source_id: string;
    chiller_ownership_id: string;
    latitude?: number | null;
    longitude?: number | null;
  }
): Promise<ServiceResult<any>> {
  const shop_code = body.shop_code?.trim();
  const shop_name = body.shop_name?.trim();
  const owner_name = body.owner_name?.trim();
  const phone_number = body.phone_number?.trim();
  const cnic = body.cnic?.trim();

  if (!shop_code || !shop_name || !owner_name || !phone_number || !cnic) {
    return { status: 400, error: 'Shop code, shop name, owner name, phone number, and CNIC are required.' };
  }

  if (!body.area_id || !body.milk_source_id || !body.chiller_ownership_id) {
    return { status: 400, error: 'Area, Milk Source, and Chiller Ownership selections are required.' };
  }

  // Phone & CNIC validation
  if (!validatePhone(phone_number)) {
    return { status: 400, error: 'Invalid phone number format. Must be a valid Pakistani mobile number.' };
  }
  if (!validateCnic(cnic)) {
    return { status: 400, error: 'Invalid CNIC format. Must be 13 digits (XXXXX-XXXXXXX-X or 13 contiguous digits).' };
  }

  // GPS validation
  const gpsCheck = validateGps(body.latitude, body.longitude);
  if (!gpsCheck.valid) {
    return { status: 400, error: gpsCheck.error };
  }

  const areaId = BigInt(body.area_id);
  const milkSourceId = BigInt(body.milk_source_id);
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

  // Validate Milk Source (must belong to SAME ZMCC and be active)
  const milkSource = await prisma.zmccMilkSource.findUnique({
    where: { id: milkSourceId },
  });
  if (!milkSource) {
    return { status: 400, error: 'Selected milk source not found.' };
  }
  if (milkSource.zmcc_id !== effectiveZmccId) {
    return { status: 409, error: 'Cross-ZMCC violation: selected milk source does not belong to this ZMCC.' };
  }
  if (!milkSource.is_active) {
    return { status: 409, error: 'Cannot create shop: selected milk source is inactive.' };
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

  // Unique checks
  const existingCode = await prisma.zmccShop.findUnique({ where: { shop_code } });
  if (existingCode) {
    return { status: 409, error: `Shop code "${shop_code}" already exists.` };
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
        shop_code,
        shop_name,
        owner_name,
        phone_number,
        cnic,
        area_id: areaId,
        route_id: routeId,
        zmcc_id: effectiveZmccId,
        milk_source_id: milkSourceId,
        chiller_ownership_id: chillerOwnershipId,
        latitude: body.latitude != null ? body.latitude : null,
        longitude: body.longitude != null ? body.longitude : null,
        is_active: true,
        created_by: auth.actorUserId,
      },
    });

    await tx.auditLog.create({
      data: {
        table_name: 'zmcc_shop',
        record_id: created.id,
        action: 'ZMCC_SHOP_CREATED',
        old_values: undefined,
        new_values: {
          id: created.id.toString(),
          shop_code: created.shop_code,
          shop_name: created.shop_name,
          owner_name: created.owner_name,
          phone_number: created.phone_number,
          cnic: created.cnic,
          area_id: created.area_id.toString(),
          route_id: created.route_id.toString(),
          zmcc_id: created.zmcc_id.toString(),
          milk_source_id: created.milk_source_id.toString(),
          chiller_ownership_id: created.chiller_ownership_id.toString(),
          is_active: true,
        },
        user_id: auth.actorUserId,
      },
    });

    return {
      status: 201,
      data: {
        id: created.id.toString(),
        shop_code: created.shop_code,
        shop_name: created.shop_name,
        is_active: created.is_active,
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
    milk_source_id?: string;
    chiller_ownership_id?: string;
    latitude?: number | null;
    longitude?: number | null;
    is_active?: boolean;
  }
): Promise<ServiceResult<any>> {
  const existing = await prisma.zmccShop.findUnique({
    where: { id: shopId },
    include: {
      area: { include: { route: { include: { zmcc: true } } } },
      milk_source: true,
      chiller_ownership: true,
    },
  });

  if (!existing) {
    return { status: 404, error: 'Shop not found.' };
  }

  if (!auth.isSuperAdmin && existing.zmcc_id !== auth.effectiveZmccId) {
    return { status: 403, error: 'Forbidden. You cannot modify shops outside your assigned ZMCC.' };
  }

  const shop_name = body.shop_name !== undefined ? body.shop_name.trim() : existing.shop_name;
  const owner_name = body.owner_name !== undefined ? body.owner_name.trim() : existing.owner_name;
  const phone_number = body.phone_number !== undefined ? body.phone_number.trim() : existing.phone_number;
  const cnic = body.cnic !== undefined ? body.cnic.trim() : existing.cnic;

  if (!shop_name || !owner_name || !phone_number || !cnic) {
    return { status: 400, error: 'Shop name, owner name, phone number, and CNIC cannot be empty.' };
  }

  if (!validatePhone(phone_number)) {
    return { status: 400, error: 'Invalid phone number format. Must be a valid Pakistani mobile number.' };
  }
  if (!validateCnic(cnic)) {
    return { status: 400, error: 'Invalid CNIC format. Must be 13 digits.' };
  }

  let targetAreaId = existing.area_id;
  let targetRouteId = existing.route_id;
  let targetZmccId = existing.zmcc_id;

  if (body.area_id && BigInt(body.area_id) !== existing.area_id) {
    targetAreaId = BigInt(body.area_id);
    const newArea = await prisma.zmccArea.findUnique({
      where: { id: targetAreaId },
      include: { route: { include: { zmcc: true } } },
    });
    if (!newArea) {
      return { status: 400, error: 'New area not found.' };
    }
    // Area must be in same ZMCC
    if (newArea.zmcc_id !== existing.zmcc_id) {
      return { status: 409, error: 'Cannot transfer shop to an area in another ZMCC.' };
    }
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

  let targetMilkSourceId = existing.milk_source_id;
  if (body.milk_source_id && BigInt(body.milk_source_id) !== existing.milk_source_id) {
    targetMilkSourceId = BigInt(body.milk_source_id);
    const newSource = await prisma.zmccMilkSource.findUnique({ where: { id: targetMilkSourceId } });
    if (!newSource) {
      return { status: 400, error: 'Selected milk source not found.' };
    }
    if (newSource.zmcc_id !== targetZmccId) {
      return { status: 409, error: 'Selected milk source does not belong to this ZMCC.' };
    }
    if (!newSource.is_active) {
      return { status: 409, error: 'Cannot assign shop to an inactive milk source.' };
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

      const activeMs = await prisma.zmccMilkSource.findUnique({ where: { id: targetMilkSourceId } });
      if (!activeMs || !activeMs.is_active) {
        return { status: 409, error: 'Cannot activate shop: assigned milk source is inactive.' };
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
        milk_source_id: targetMilkSourceId,
        chiller_ownership_id: targetChillerOwnershipId,
        latitude: targetLat,
        longitude: targetLng,
        is_active: targetActive,
        updated_by: auth.actorUserId,
      },
    });

    await tx.auditLog.create({
      data: {
        table_name: 'zmcc_shop',
        record_id: shopId,
        action,
        old_values: {
          shop_name: existing.shop_name,
          owner_name: existing.owner_name,
          phone_number: existing.phone_number,
          cnic: existing.cnic,
          area_id: existing.area_id.toString(),
          route_id: existing.route_id.toString(),
          milk_source_id: existing.milk_source_id.toString(),
          chiller_ownership_id: existing.chiller_ownership_id.toString(),
          is_active: existing.is_active,
        },
        new_values: {
          shop_name: updated.shop_name,
          owner_name: updated.owner_name,
          phone_number: updated.phone_number,
          cnic: updated.cnic,
          area_id: updated.area_id.toString(),
          route_id: updated.route_id.toString(),
          milk_source_id: updated.milk_source_id.toString(),
          chiller_ownership_id: updated.chiller_ownership_id.toString(),
          is_active: updated.is_active,
        },
        user_id: auth.actorUserId,
      },
    });

    return {
      status: 200,
      data: {
        id: updated.id.toString(),
        shop_code: updated.shop_code,
        shop_name: updated.shop_name,
        is_active: updated.is_active,
      },
    };
  });
}
