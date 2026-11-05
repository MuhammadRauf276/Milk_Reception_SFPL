import { prisma } from '@core/db';
import { writeAuditLog } from '@/backend/core/audit';
import { Prisma } from '@prisma/client';
import { User } from '@core/types';
import { resolveZmccAuth, ServiceResult, type ZmccAuthContext } from './zmccMasterDataService';
import { normalizePakistaniCnic, normalizePakistaniMobile } from '@/lib/pakistani-identity';

export const FORBIDDEN_CLIENT_FIELDS = [
  'erp_reference',
  'erp_mapping_status',
  'erpMappingStatus',
  'milk_source_id',
  'verified',
  'is_verified',
  'erp_code',
  'canonical_supplier_id',
];

export interface CreateHcSupplierPayload {
  name: string;
  phone?: string | null;
  cnic?: string | null;
  zmcc_id?: string | number | bigint;
}

export interface UpdateHcSupplierPayload {
  name?: string;
  phone?: string | null;
  cnic?: string | null;
  is_active?: boolean;
}

export interface HcSupplierSearchParams {
  search?: string;
  query?: string;
  zmcc_id?: string | number | bigint;
  is_active?: string | boolean;
  approval_status?: string;
  /** Optional pagination; without `page` the full list is returned. */
  page?: number;
  page_size?: number;
}

export interface HcSupplierDbRecord {
  id: bigint;
  local_supplier_code: string;
  zmcc_id: bigint;
  name: string;
  phone: string | null;
  cnic: string | null;
  is_active: boolean;
  created_by_user_id: bigint;
  updated_by_user_id: bigint | null;
  created_at: Date | string;
  updated_at: Date | string;
  approval_status?: string;
  rejection_reason?: string | null;
  approved_at?: Date | string | null;
  created_as_role?: string | null;
  created_is_delegated?: boolean;
  zmcc?: {
    id: bigint;
    code: string;
    name: string;
    is_active: boolean;
  } | null;
}

function maskIdentity(value: string | null | undefined, visible: boolean): string | null {
  if (!value) return null;
  if (visible) return value;
  return value.length <= 4 ? '••••' : `${'•'.repeat(Math.max(0, value.length - 4))}${value.slice(-4)}`;
}

/** Full CNIC/phone are returned only to the manager of the assigned source or Super Admin. */
export function serializeHcSupplier(supplier: HcSupplierDbRecord, canViewFullIdentity = false) {
  return {
    id: supplier.id.toString(),
    local_supplier_code: supplier.local_supplier_code,
    zmcc_id: supplier.zmcc_id.toString(),
    name: supplier.name,
    phone: maskIdentity(supplier.phone, canViewFullIdentity),
    cnic: maskIdentity(supplier.cnic, canViewFullIdentity),
    identity_complete: normalizePakistaniMobile(supplier.phone).ok && normalizePakistaniCnic(supplier.cnic).ok,
    is_active: supplier.is_active,
    approval_status: supplier.approval_status ?? 'ACTIVE',
    rejection_reason: supplier.rejection_reason ?? null,
    approved_at: supplier.approved_at instanceof Date ? supplier.approved_at.toISOString() : (supplier.approved_at ?? null),
    created_as_role: supplier.created_as_role ?? null,
    created_by_user_id: supplier.created_by_user_id.toString(),
    updated_by_user_id: supplier.updated_by_user_id ? supplier.updated_by_user_id.toString() : null,
    created_at: supplier.created_at instanceof Date ? supplier.created_at.toISOString() : supplier.created_at,
    updated_at: supplier.updated_at instanceof Date ? supplier.updated_at.toISOString() : supplier.updated_at,
    zmcc: supplier.zmcc
      ? {
          id: supplier.zmcc.id.toString(),
          code: supplier.zmcc.code,
          name: supplier.zmcc.name,
          is_active: supplier.zmcc.is_active,
        }
      : undefined,
  };
}

function auditActorFor(auth: ZmccAuthContext) {
  return {
    userId: auth.actorUserId,
    actorRole: auth.role,
    performedAsRole: auth.acting.actingAs,
    isDelegated: auth.acting.isDelegated,
  };
}

function inScope(auth: ZmccAuthContext, zmccId: bigint): boolean {
  const scope = auth.acting.scope;
  if (scope.kind === 'SYSTEM') return true;
  if (scope.kind === 'SOURCE') return scope.sourceId === zmccId;
  return false;
}

/** Tells the Zonal Manager(s) of the ZMCC that a new HC is waiting. */
async function notifyZonalManagersHcPending(
  tx: Prisma.TransactionClient,
  supplier: { id: bigint; name: string; local_supplier_code: string },
  zmccId: bigint
) {
  const managers = await tx.user.findMany({
    where: { is_active: true, role: 'ZMCC_MANAGER', procurement_source_id: zmccId },
    select: { id: true },
  });
  for (const manager of managers) {
    const dedupeKey = `HC_APPROVAL_PENDING:${supplier.id}:${manager.id}`;
    await tx.notification.upsert({
      where: { dedupe_key: dedupeKey },
      create: {
        recipient_user_id: manager.id,
        event_key: 'HC_APPROVAL_PENDING',
        priority: 'HIGH',
        title: 'New HC waiting for approval',
        body: `HC "${supplier.name}" (${supplier.local_supplier_code}) is waiting for your approval.`,
        deep_link: '/mpd/zmcc-manager?tab=APPROVALS',
        source_type: 'LOCAL_SUPPLIER',
        source_id: supplier.id.toString(),
        dedupe_key: dedupeKey,
      },
      update: {},
    });
  }
}

/**
 * Get / Search HC suppliers with scope isolation
 */
export async function getHcSuppliers(
  reqOrUser?: Request | User,
  params: HcSupplierSearchParams = {}
): Promise<ServiceResult<ReturnType<typeof serializeHcSupplier>[]>> {
  const { auth, errorResponse } = await resolveZmccAuth(reqOrUser as Request, 'READ');
  if (errorResponse) return errorResponse;
  if (!auth) return { status: 401, error: 'Unauthorized.' };

  let targetZmccId: bigint | null = null;
  if (auth.isSuperAdmin) {
    if (params.zmcc_id) {
      try {
        targetZmccId = BigInt(String(params.zmcc_id).trim());
      } catch {
        return { status: 400, error: 'Invalid zmcc_id format.' };
      }
    }
  } else {
    targetZmccId = auth.effectiveZmccId;
  }

  const where: Prisma.ZmccLocalSupplierWhereInput = {};

  if (targetZmccId) {
    where.zmcc_id = targetZmccId;
  }

  // Active filter: PHE only allowed to see active suppliers for operational selection
  if (auth.isPheOperator) {
    where.is_active = true;
  } else if (params.is_active !== undefined) {
    if (typeof params.is_active === 'boolean') {
      where.is_active = params.is_active;
    } else if (typeof params.is_active === 'string') {
      const activeStr = params.is_active.trim().toLowerCase();
      if (activeStr === 'true') where.is_active = true;
      else if (activeStr === 'false') where.is_active = false;
    }
  }

  if (params.approval_status) {
    where.approval_status = params.approval_status;
  }

  // Text search query across code, name, phone, cnic
  const searchQuery = (params.search || params.query || '').trim();
  if (searchQuery) {
    where.OR = [
      { local_supplier_code: { contains: searchQuery, mode: 'insensitive' } },
      { name: { contains: searchQuery, mode: 'insensitive' } },
      { phone: { contains: searchQuery, mode: 'insensitive' } },
      { cnic: { contains: searchQuery, mode: 'insensitive' } },
    ];
  }

  const paginated = params.page != null;
  const pageSize = Math.min(Math.max(params.page_size ?? 50, 1), 200);
  const page = Math.max(params.page ?? 1, 1);
  const [suppliers, total] = await Promise.all([
    prisma.zmccLocalSupplier.findMany({
      where,
      include: { zmcc: { select: { id: true, code: true, name: true, is_active: true } } },
      orderBy: [
        { is_active: 'desc' },
        { name: 'asc' },
      ],
      ...(paginated ? { skip: (page - 1) * pageSize, take: pageSize } : {}),
    }),
    paginated ? prisma.zmccLocalSupplier.count({ where }) : Promise.resolve(0),
  ]);

  return {
    status: 200,
    data: suppliers.map((supplier) => serializeHcSupplier(supplier, auth.isSuperAdmin || auth.isZmccManager)),
    ...(paginated
      ? { pagination: { page, page_size: pageSize, total, total_pages: Math.max(1, Math.ceil(total / pageSize)) } }
      : {}),
  };
}

/**
 * Get HC supplier by ID with ZMCC authorization check
 */
export async function getHcSupplierById(
  reqOrUser: Request | User,
  idParam: string | number | bigint
): Promise<ServiceResult<unknown>> {
  const { auth, errorResponse } = await resolveZmccAuth(reqOrUser as Request, 'READ');
  if (errorResponse) return errorResponse;
  if (!auth) return { status: 401, error: 'Unauthorized.' };

  let supplierId: bigint;
  try {
    supplierId = BigInt(String(idParam).trim());
  } catch {
    return { status: 400, error: 'Invalid supplier ID format.' };
  }

  const supplier = await prisma.zmccLocalSupplier.findUnique({
    where: { id: supplierId },
    include: { zmcc: true },
  });

  if (!supplier) {
    return { status: 404, error: 'HC supplier not found.' };
  }

  if (!auth.isSuperAdmin && supplier.zmcc_id !== auth.effectiveZmccId) {
    return { status: 403, error: 'Forbidden. Supplier belongs to another ZMCC.' };
  }

  return {
    status: 200,
    data: serializeHcSupplier(supplier, auth.isSuperAdmin || auth.isZmccManager),
  };
}

/** Manager remediation queue for legacy suppliers that cannot be activated or used for arrivals. */
export async function getIncompleteHcSuppliers(
  reqOrUser?: Request | User
): Promise<ServiceResult<ReturnType<typeof serializeHcSupplier>[]>> {
  const { auth, errorResponse } = await resolveZmccAuth(reqOrUser as Request, 'READ');
  if (errorResponse) return errorResponse;
  if (!auth || (!auth.isSuperAdmin && !auth.isZmccManager)) return { status: 403, error: 'Forbidden. Only ZMCC Manager or Super Admin may view incomplete identities.' };
  const suppliers = await prisma.zmccLocalSupplier.findMany({
    where: { ...(auth.isSuperAdmin || !auth.effectiveZmccId ? {} : { zmcc_id: auth.effectiveZmccId }), OR: [{ phone: null }, { cnic: null }, { phone: '' }, { cnic: '' }] },
    include: { zmcc: true }, orderBy: [{ zmcc_id: 'asc' }, { name: 'asc' }],
  });
  return { status: 200, data: suppliers.map((supplier) => serializeHcSupplier(supplier, true)) };
}

/**
 * Create lightweight HC supplier (PHE_OPERATOR, ZMCC_MANAGER, SUPER_ADMIN)
 */
export async function createHcSupplier(
  reqOrUser: Request | User,
  payload: CreateHcSupplierPayload
): Promise<ServiceResult<unknown>> {
  const { auth, errorResponse } = await resolveZmccAuth(reqOrUser as Request, 'READ');
  if (errorResponse) return errorResponse;
  if (!auth) return { status: 401, error: 'Unauthorized.' };

  // Role check: Only PHE_OPERATOR, ZMCC_MANAGER, SUPER_ADMIN can create HC suppliers
  if (!auth.isPheOperator && !auth.isZmccManager && !auth.isSuperAdmin) {
    return {
      status: 403,
      error: 'Forbidden. Only PHE Operator, ZMCC Manager, or Super Admin can create HC suppliers.',
    };
  }

  if (!payload || typeof payload !== 'object') {
    return { status: 400, error: 'Missing request payload.' };
  }

  // Role-specific strict create allowlists
  const allowedCreateFields = auth.isSuperAdmin
    ? new Set(['name', 'phone', 'cnic', 'zmcc_id'])
    : new Set(['name', 'phone', 'cnic']);

  for (const field of Object.keys(payload)) {
    if (!allowedCreateFields.has(field)) {
      if (!auth.isSuperAdmin && (field === 'zmcc_id' || field === 'target_zmcc_id' || field.toLowerCase().includes('zmcc'))) {
        return {
          status: 400,
          error: `Scoped users (${auth.role}) cannot supply zmcc_id. Target ZMCC is resolved automatically from session.`,
        };
      }
      return { status: 400, error: `Field "${field}" is not allowed on HC supplier creation.` };
    }
  }

  // Reject forbidden client fields
  for (const field of FORBIDDEN_CLIENT_FIELDS) {
    if (field in payload) {
      return { status: 400, error: `Field "${field}" is forbidden and cannot be provided.` };
    }
  }

  // Resolve target ZMCC
  let targetZmccId: bigint;
  if (auth.isSuperAdmin) {
    if (!payload.zmcc_id || String(payload.zmcc_id).trim() === '') {
      return { status: 400, error: 'zmcc_id is required for Super Admin.' };
    }
    try {
      targetZmccId = BigInt(String(payload.zmcc_id).trim());
    } catch {
      return { status: 400, error: 'Invalid zmcc_id format.' };
    }
  } else {
    targetZmccId = auth.effectiveZmccId!;
  }

  // Verify target ZMCC is valid and active
  const targetZmcc = await prisma.procurementSource.findUnique({
    where: { id: targetZmccId },
  });
  if (!targetZmcc) {
    return { status: 404, error: 'Target ZMCC procurement source not found.' };
  }
  if (targetZmcc.source_type !== 'ZMCC') {
    return { status: 400, error: 'Target procurement source is not of type ZMCC.' };
  }
  if (!targetZmcc.is_active) {
    return { status: 400, error: 'Target ZMCC procurement source is inactive.' };
  }

  // Validate Name
  if (payload.name === undefined || payload.name === null || typeof payload.name !== 'string') {
    return { status: 400, error: 'name is required and must be a string.' };
  }
  const name = payload.name.trim();
  if (!name) {
    return { status: 400, error: 'name cannot be empty or blank.' };
  }
  if (name.length > 150) {
    return { status: 400, error: 'name cannot exceed 150 characters.' };
  }

  const phoneResult = normalizePakistaniMobile(payload.phone);
  if (!phoneResult.ok) return { status: 400, error: phoneResult.error };
  const cnicResult = normalizePakistaniCnic(payload.cnic);
  if (!cnicResult.ok) return { status: 400, error: cnicResult.error };
  const phone = phoneResult.value;
  const cnic = cnicResult.value;

  // PHE / MDO create HCs as PENDING; a Zonal Manager (or above) creates them already approved.
  const needsApproval = !auth.canApproveStage1 && !auth.isSuperAdmin;

  // Race-safe sequence allocation and atomic creation inside transaction
  try {
    const createdSupplier = await prisma.$transaction(async (tx) => {
      let localSupplierCode: string;
      try {
        const seqResult = await tx.$queryRaw<{ nextval: bigint }[]>`
          SELECT nextval('zmcc_local_supplier_code_seq') as nextval
        `;
        if (seqResult && seqResult.length > 0 && seqResult[0].nextval !== undefined && seqResult[0].nextval !== null) {
          localSupplierCode = `ZLS-${String(Number(seqResult[0].nextval)).padStart(6, '0')}`;
        } else {
          throw new Error('FALLBACK');
        }
      } catch {
        const count = await tx.zmccLocalSupplier.count();
        localSupplierCode = `ZLS-${String(count + 1).padStart(6, '0')}`;
      }

      const supplier = await tx.zmccLocalSupplier.create({
        data: {
          local_supplier_code: localSupplierCode,
          zmcc_id: targetZmccId,
          name,
          phone,
          cnic,
          is_active: true,
          created_by_user_id: auth.actorUserId,
          created_as_role: auth.acting.actingAs,
          created_is_delegated: auth.acting.isDelegated,
          approval_status: needsApproval ? 'PENDING_APPROVAL' : 'ACTIVE',
          ...(needsApproval
            ? {}
            : {
                approved_by_user_id: auth.actorUserId,
                approved_as_role: auth.acting.actingAs,
                approved_is_delegated: auth.acting.isDelegated,
                approved_at: new Date(),
              }),
        },
        include: { zmcc: true },
      });

      await writeAuditLog(tx, {
        tableName: 'zmcc_local_supplier',
        recordId: supplier.id,
        action: 'ZMCC_LOCAL_SUPPLIER_CREATED',
        oldValues: null,
        newValues: {
          local_supplier_code: supplier.local_supplier_code,
          zmcc_id: targetZmccId.toString(),
          name: supplier.name,
          phone: supplier.phone,
          cnic: supplier.cnic,
          is_active: supplier.is_active,
          approval_status: supplier.approval_status,
        },
        actor: auditActorFor(auth),
      });

      if (needsApproval) {
        await notifyZonalManagersHcPending(tx, supplier, targetZmccId);
      }

      return supplier;
    });

    return {
      status: 201,
      data: serializeHcSupplier(createdSupplier, true),
    };
  } catch (err: unknown) {
    console.error('createHcSupplier error:', err);
    return { status: 500, error: 'Internal server error while creating HC supplier.' };
  }
}

/**
 * Update / Deactivate HC supplier (ZMCC_MANAGER, SUPER_ADMIN only)
 * PHE Operator is strictly forbidden from editing or deactivating existing suppliers.
 */
export async function updateHcSupplier(
  reqOrUser: Request | User,
  idParam: string | number | bigint,
  payload: UpdateHcSupplierPayload
): Promise<ServiceResult<unknown>> {
  const { auth, errorResponse } = await resolveZmccAuth(reqOrUser as Request, 'READ');
  if (errorResponse) return errorResponse;
  if (!auth) return { status: 401, error: 'Unauthorized.' };

  // PHE Operators cannot edit or deactivate existing suppliers
  if (auth.isPheOperator) {
    return {
      status: 403,
      error: 'Forbidden. PHE Operators may create new suppliers but cannot edit or deactivate existing records.',
    };
  }

  if (!auth.isDataExecutive && !auth.isSuperAdmin) {
    return {
      status: 403,
      error: 'Forbidden. Only Data Executive or Super Admin may update HC suppliers.',
    };
  }

  let supplierId: bigint;
  try {
    supplierId = BigInt(String(idParam).trim());
  } catch {
    return { status: 400, error: 'Invalid supplier ID format.' };
  }

  if (!payload || typeof payload !== 'object') {
    return { status: 400, error: 'Missing request payload.' };
  }

  // Strict PATCH allowlist: exactly name, phone, cnic, is_active
  const allowedPatchFields = new Set(['name', 'phone', 'cnic', 'is_active']);
  for (const field of Object.keys(payload)) {
    if (!allowedPatchFields.has(field)) {
      return { status: 400, error: `Field "${field}" is not allowed on HC supplier update.` };
    }
  }

  // Reject forbidden client fields
  for (const field of FORBIDDEN_CLIENT_FIELDS) {
    if (field in payload) {
      return { status: 400, error: `Field "${field}" is forbidden and cannot be modified.` };
    }
  }

  const existingSupplier = await prisma.zmccLocalSupplier.findUnique({
    where: { id: supplierId },
    include: { zmcc: true },
  });

  if (!existingSupplier) {
    return { status: 404, error: 'HC supplier not found.' };
  }

  // Manager can only update suppliers in their own ZMCC
  if (!auth.isSuperAdmin && existingSupplier.zmcc_id !== auth.effectiveZmccId) {
    return { status: 403, error: 'Forbidden. Supplier belongs to another ZMCC.' };
  }

  const updateData: Prisma.ZmccLocalSupplierUpdateInput = {
    updater: { connect: { id: auth.actorUserId } },
  };

  // Validate Name if provided
  if (payload.name !== undefined) {
    if (payload.name === null || typeof payload.name !== 'string') {
      return { status: 400, error: 'name must be a string.' };
    }
    const name = payload.name.trim();
    if (!name) {
      return { status: 400, error: 'name cannot be empty or blank.' };
    }
    if (name.length > 150) {
      return { status: 400, error: 'name cannot exceed 150 characters.' };
    }
    updateData.name = name;
  }

  const isDeactivationOnly = payload.is_active === false &&
    payload.phone === undefined && payload.cnic === undefined;

  if (!isDeactivationOnly) {
    const phoneResult = normalizePakistaniMobile(payload.phone ?? existingSupplier.phone);
    if (!phoneResult.ok) return { status: 400, error: phoneResult.error };
    const cnicResult = normalizePakistaniCnic(payload.cnic ?? existingSupplier.cnic);
    if (!cnicResult.ok) return { status: 400, error: cnicResult.error };
    updateData.phone = phoneResult.value;
    updateData.cnic = cnicResult.value;
  }

  // Validate Active status if provided
  if (payload.is_active !== undefined) {
    if (typeof payload.is_active !== 'boolean') {
      return { status: 400, error: 'is_active must be a boolean.' };
    }
    updateData.is_active = payload.is_active;
  }

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.zmccLocalSupplier.update({
        where: { id: supplierId },
        data: updateData,
        include: { zmcc: true },
      });

      await writeAuditLog(tx, {
        tableName: 'zmcc_local_supplier',
        recordId: supplierId,
        action: 'ZMCC_LOCAL_SUPPLIER_UPDATED',
        oldValues: {
          name: existingSupplier.name,
          phone: existingSupplier.phone,
          cnic: existingSupplier.cnic,
          is_active: existingSupplier.is_active,
        },
        newValues: {
          name: result.name,
          phone: result.phone,
          cnic: result.cnic,
          is_active: result.is_active,
        },
        actor: auditActorFor(auth),
      });

      return result;
    });

    return {
      status: 200,
      data: serializeHcSupplier(updated, true),
    };
  } catch (err: unknown) {
    console.error('updateHcSupplier error:', err);
    return { status: 500, error: 'Internal server error while updating HC supplier.' };
  }
}

/** HCs waiting for Zonal Manager approval (own ZMCC; Super Admin sees all). */
export async function listPendingHcSuppliers(
  reqOrUser?: Request | User
): Promise<ServiceResult<ReturnType<typeof serializeHcSupplier>[]>> {
  const { auth, errorResponse } = await resolveZmccAuth(reqOrUser as Request, 'READ');
  if (errorResponse) return errorResponse;
  if (!auth) return { status: 401, error: 'Unauthorized.' };
  if (!auth.canApproveStage1 && !auth.isSuperAdmin) {
    return { status: 403, error: 'Forbidden. Only the Zonal Manager (or above) can see HCs waiting for approval.' };
  }
  const suppliers = await prisma.zmccLocalSupplier.findMany({
    where: {
      approval_status: 'PENDING_APPROVAL',
      ...(auth.isSuperAdmin || !auth.effectiveZmccId ? {} : { zmcc_id: auth.effectiveZmccId }),
    },
    include: { zmcc: true },
    orderBy: { created_at: 'asc' },
  });
  return { status: 200, data: suppliers.map((supplier) => serializeHcSupplier(supplier, true)) };
}

async function decideHcSupplier(
  reqOrUser: Request | User,
  idParam: string | number | bigint,
  decision: 'APPROVE' | 'REJECT',
  reason?: string
): Promise<ServiceResult<unknown>> {
  const { auth, errorResponse } = await resolveZmccAuth(reqOrUser as Request, 'READ');
  if (errorResponse) return errorResponse;
  if (!auth) return { status: 401, error: 'Unauthorized.' };
  if (!auth.canApproveStage1 && !auth.isSuperAdmin) {
    return { status: 403, error: 'Forbidden. Only the Zonal Manager (or above) can approve or reject an HC.' };
  }

  let supplierId: bigint;
  try {
    supplierId = BigInt(String(idParam).trim());
  } catch {
    return { status: 400, error: 'Invalid supplier ID format.' };
  }

  const cleanReason = (reason ?? '').trim();
  if (decision === 'REJECT' && !cleanReason) {
    return { status: 400, error: 'Please write the reason for rejecting this HC.' };
  }

  const existing = await prisma.zmccLocalSupplier.findUnique({ where: { id: supplierId }, include: { zmcc: true } });
  if (!existing) return { status: 404, error: 'HC supplier not found.' };
  if (!auth.isSuperAdmin && !inScope(auth, existing.zmcc_id)) {
    return { status: 403, error: 'Forbidden. This HC belongs to another ZMCC.' };
  }
  if (existing.approval_status !== 'PENDING_APPROVAL') {
    return { status: 409, error: 'This HC is not waiting for approval.' };
  }

  const approved = decision === 'APPROVE';
  try {
    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.zmccLocalSupplier.update({
        where: { id: supplierId },
        data: {
          approval_status: approved ? 'ACTIVE' : 'REJECTED',
          is_active: approved,
          rejection_reason: approved ? null : cleanReason,
          approved_by_user_id: auth.actorUserId,
          approved_as_role: auth.acting.actingAs,
          approved_is_delegated: auth.acting.isDelegated,
          approved_at: new Date(),
          updated_by_user_id: auth.actorUserId,
        },
        include: { zmcc: true },
      });

      await writeAuditLog(tx, {
        tableName: 'zmcc_local_supplier',
        recordId: supplierId,
        action: approved ? 'ZMCC_LOCAL_SUPPLIER_APPROVED' : 'ZMCC_LOCAL_SUPPLIER_REJECTED',
        oldValues: { approval_status: existing.approval_status, is_active: existing.is_active },
        newValues: {
          approval_status: result.approval_status,
          is_active: result.is_active,
          rejection_reason: result.rejection_reason,
        },
        actor: auditActorFor(auth),
      });

      return result;
    });
    return { status: 200, data: serializeHcSupplier(updated, true) };
  } catch (err: unknown) {
    console.error('decideHcSupplier error:', err);
    return { status: 500, error: 'Internal server error while saving the HC decision.' };
  }
}

export function approveHcSupplier(reqOrUser: Request | User, idParam: string | number | bigint) {
  return decideHcSupplier(reqOrUser, idParam, 'APPROVE');
}

export function rejectHcSupplier(reqOrUser: Request | User, idParam: string | number | bigint, reason: string) {
  return decideHcSupplier(reqOrUser, idParam, 'REJECT', reason);
}

/** Back-compat alias for older imports; prefer serializeHcSupplier. */
export const serializeLocalSupplier = serializeHcSupplier;
