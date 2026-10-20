import { prisma } from '@core/db';
import { writeAuditLog } from '@/backend/core/audit';
import { Prisma } from '@prisma/client';
import { User } from '@core/types';
import { resolveZmccAuth, ServiceResult, type ZmccAuthContext } from './zmccMasterDataService';
import { normalizePakistaniCnic, normalizePakistaniMobile } from '@/lib/pakistani-identity';
import { createNotificationsForEvent } from '@/backend/services/notificationService';

export const FORBIDDEN_ERP_PLACEHOLDERS = new Set([
  'new',
  'pending',
  'unknown',
  'n/a',
  'na',
  'tbd',
  'none',
  'not available',
  'not known',
  '-',
]);

export const FORBIDDEN_CLIENT_FIELDS = [
  'erp_mapping_status',
  'erpMappingStatus',
  'verified',
  'is_verified',
  'erp_code',
  'canonical_supplier_id',
];

export interface CreateLocalSupplierPayload {
  name: string;
  phone?: string | null;
  cnic?: string | null;
  erp_reference?: string | null;
  zmcc_id?: string | number | bigint;
  milk_source_id?: string | number | bigint;
}

export interface UpdateLocalSupplierPayload {
  name?: string;
  phone?: string | null;
  cnic?: string | null;
  erp_reference?: string | null;
  is_active?: boolean;
}

export interface LocalSupplierSearchParams {
  search?: string;
  query?: string;
  zmcc_id?: string | number | bigint;
  is_active?: string | boolean;
  erp_mapping_status?: string;
  approval_status?: string;
}

export interface LocalSupplierDbRecord {
  id: bigint;
  local_supplier_code: string;
  zmcc_id: bigint;
  name: string;
  phone: string | null;
  cnic: string | null;
  erp_reference: string | null;
  erp_mapping_status: string;
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
export function serializeLocalSupplier(supplier: LocalSupplierDbRecord, canViewFullIdentity = false) {
  return {
    id: supplier.id.toString(),
    local_supplier_code: supplier.local_supplier_code,
    zmcc_id: supplier.zmcc_id.toString(),
    name: supplier.name,
    phone: maskIdentity(supplier.phone, canViewFullIdentity),
    cnic: maskIdentity(supplier.cnic, canViewFullIdentity),
    identity_complete: normalizePakistaniMobile(supplier.phone).ok && normalizePakistaniCnic(supplier.cnic).ok,
    erp_reference: supplier.erp_reference ?? null,
    erp_mapping_status: supplier.erp_mapping_status,
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

/**
 * Validates ERP reference string according to Frozen ERP Rule:
 * - Optional / nullable
 * - Trim whitespace, preserve leading zeros and special characters
 * - Blank -> null
 * - Case-insensitive check against forbidden placeholder values
 * - Max length 100
 */
export function validateErpReference(raw: unknown): { value: string | null; error?: string } {
  if (raw === undefined || raw === null) {
    return { value: null };
  }
  if (typeof raw !== 'string') {
    return { value: null, error: 'erp_reference must be a text string.' };
  }
  const trimmed = raw.trim();
  if (trimmed === '') {
    return { value: null };
  }
  if (trimmed.length > 100) {
    return { value: null, error: 'erp_reference cannot exceed 100 characters.' };
  }

  const lower = trimmed.toLowerCase();
  if (FORBIDDEN_ERP_PLACEHOLDERS.has(lower)) {
    return {
      value: null,
      error: `Placeholder ERP reference "${trimmed}" is forbidden. Leave blank if unknown.`,
    };
  }

  return { value: trimmed };
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
        deep_link: '/zmcc',
        source_type: 'LOCAL_SUPPLIER',
        source_id: supplier.id.toString(),
        dedupe_key: dedupeKey,
      },
      update: {},
    });
  }
}

/**
 * Get / Search local suppliers with scope isolation
 */
export async function getLocalSuppliers(
  reqOrUser?: Request | User,
  params: LocalSupplierSearchParams = {}
): Promise<ServiceResult<ReturnType<typeof serializeLocalSupplier>[]>> {
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

  if (params.erp_mapping_status) {
    where.erp_mapping_status = params.erp_mapping_status;
  }
  if (params.approval_status) {
    where.approval_status = params.approval_status;
  }

  // Text search query across code, name, phone, cnic, erp_reference
  const searchQuery = (params.search || params.query || '').trim();
  if (searchQuery) {
    where.OR = [
      { local_supplier_code: { contains: searchQuery, mode: 'insensitive' } },
      { name: { contains: searchQuery, mode: 'insensitive' } },
      { phone: { contains: searchQuery, mode: 'insensitive' } },
      { cnic: { contains: searchQuery, mode: 'insensitive' } },
      { erp_reference: { contains: searchQuery, mode: 'insensitive' } },
    ];
  }

  const suppliers = await prisma.zmccLocalSupplier.findMany({
    where,
    include: { zmcc: true },
    orderBy: [
      { is_active: 'desc' },
      { name: 'asc' },
    ],
  });

  return {
    status: 200,
    data: suppliers.map((supplier) => serializeLocalSupplier(supplier, auth.isSuperAdmin || auth.isZmccManager)),
  };
}

/**
 * Get local supplier by ID with ZMCC authorization check
 */
export async function getLocalSupplierById(
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
    return { status: 404, error: 'Local supplier not found.' };
  }

  if (!auth.isSuperAdmin && supplier.zmcc_id !== auth.effectiveZmccId) {
    return { status: 403, error: 'Forbidden. Supplier belongs to another ZMCC.' };
  }

  return {
    status: 200,
    data: serializeLocalSupplier(supplier, auth.isSuperAdmin || auth.isZmccManager),
  };
}

/** Manager remediation queue for legacy suppliers that cannot be activated or used for arrivals. */
export async function getIncompleteLocalSuppliers(
  reqOrUser?: Request | User
): Promise<ServiceResult<ReturnType<typeof serializeLocalSupplier>[]>> {
  const { auth, errorResponse } = await resolveZmccAuth(reqOrUser as Request, 'READ');
  if (errorResponse) return errorResponse;
  if (!auth || (!auth.isSuperAdmin && !auth.isZmccManager)) return { status: 403, error: 'Forbidden. Only ZMCC Manager or Super Admin may view incomplete identities.' };
  const suppliers = await prisma.zmccLocalSupplier.findMany({
    where: { ...(auth.isSuperAdmin || !auth.effectiveZmccId ? {} : { zmcc_id: auth.effectiveZmccId }), OR: [{ phone: null }, { cnic: null }, { phone: '' }, { cnic: '' }] },
    include: { zmcc: true }, orderBy: [{ zmcc_id: 'asc' }, { name: 'asc' }],
  });
  return { status: 200, data: suppliers.map((supplier) => serializeLocalSupplier(supplier, true)) };
}

/**
 * Create lightweight local supplier (PHE_OPERATOR, ZMCC_MANAGER, SUPER_ADMIN)
 */
export async function createLocalSupplier(
  reqOrUser: Request | User,
  payload: CreateLocalSupplierPayload
): Promise<ServiceResult<unknown>> {
  const { auth, errorResponse } = await resolveZmccAuth(reqOrUser as Request, 'READ');
  if (errorResponse) return errorResponse;
  if (!auth) return { status: 401, error: 'Unauthorized.' };

  // Role check: Only PHE_OPERATOR, ZMCC_MANAGER, SUPER_ADMIN can create local suppliers
  if (!auth.isPheOperator && !auth.isZmccManager && !auth.isSuperAdmin) {
    return {
      status: 403,
      error: 'Forbidden. Only PHE Operator, ZMCC Manager, or Super Admin can create local suppliers.',
    };
  }

  if (!payload || typeof payload !== 'object') {
    return { status: 400, error: 'Missing request payload.' };
  }

  // Role-specific strict create allowlists
  const allowedCreateFields = auth.isSuperAdmin
    ? new Set(['name', 'phone', 'cnic', 'erp_reference', 'zmcc_id', 'milk_source_id'])
    : new Set(['name', 'phone', 'cnic', 'erp_reference', 'milk_source_id']);

  for (const field of Object.keys(payload)) {
    if (!allowedCreateFields.has(field)) {
      if (!auth.isSuperAdmin && (field === 'zmcc_id' || field === 'target_zmcc_id' || field.toLowerCase().includes('zmcc'))) {
        return {
          status: 400,
          error: `Scoped users (${auth.role}) cannot supply zmcc_id. Target ZMCC is resolved automatically from session.`,
        };
      }
      return { status: 400, error: `Field "${field}" is not allowed on local supplier creation.` };
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

  // Validate ERP Reference
  const erpValidation = validateErpReference(payload.erp_reference);
  if (erpValidation.error) {
    return { status: 400, error: erpValidation.error };
  }
  const erpReference = erpValidation.value;

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
          erp_reference: erpReference,
          erp_mapping_status: 'PENDING',
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
          erp_reference: supplier.erp_reference,
          erp_mapping_status: supplier.erp_mapping_status,
          is_active: supplier.is_active,
          approval_status: supplier.approval_status,
        },
        actor: auditActorFor(auth),
      });

      if (needsApproval) {
        await notifyZonalManagersHcPending(tx, supplier, targetZmccId);
      } else if (supplier.erp_mapping_status === 'PENDING') {
        await createNotificationsForEvent(tx, {
          eventKey: 'ERP_VENDOR_MAPPING_REQUIRED',
          sourceId: supplier.id.toString(),
          sourceZmccId: targetZmccId,
          title: 'ERP Vendor Mapping Required',
          body: `Local supplier "${supplier.name}" (${supplier.local_supplier_code}) requires official ERP vendor mapping.`,
          deepLink: '/finance/reconciliation',
          dedupeSuffix: supplier.id.toString(),
        });
      }

      return supplier;
    });

    return {
      status: 201,
      data: serializeLocalSupplier(createdSupplier, true),
    };
  } catch (err: unknown) {
    console.error('createLocalSupplier error:', err);
    return { status: 500, error: 'Internal server error while creating local supplier.' };
  }
}

/**
 * Update / Deactivate local supplier (ZMCC_MANAGER, SUPER_ADMIN only)
 * PHE Operator is strictly forbidden from editing or deactivating existing suppliers.
 */
export async function updateLocalSupplier(
  reqOrUser: Request | User,
  idParam: string | number | bigint,
  payload: UpdateLocalSupplierPayload
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
      error: 'Forbidden. Only Data Executive or Super Admin may update local suppliers.',
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

  // Strict PATCH allowlist: exactly name, phone, cnic, erp_reference, is_active
  const allowedPatchFields = new Set(['name', 'phone', 'cnic', 'erp_reference', 'is_active']);
  for (const field of Object.keys(payload)) {
    if (!allowedPatchFields.has(field)) {
      return { status: 400, error: `Field "${field}" is not allowed on local supplier update.` };
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
    return { status: 404, error: 'Local supplier not found.' };
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

  // Validate ERP Reference if provided
  if (payload.erp_reference !== undefined) {
    const erpValidation = validateErpReference(payload.erp_reference);
    if (erpValidation.error) {
      return { status: 400, error: erpValidation.error };
    }
    updateData.erp_reference = erpValidation.value;
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
          erp_reference: existingSupplier.erp_reference,
          is_active: existingSupplier.is_active,
        },
        newValues: {
          name: result.name,
          phone: result.phone,
          cnic: result.cnic,
          erp_reference: result.erp_reference,
          is_active: result.is_active,
        },
        actor: auditActorFor(auth),
      });

      return result;
    });

    return {
      status: 200,
      data: serializeLocalSupplier(updated, true),
    };
  } catch (err: unknown) {
    console.error('updateLocalSupplier error:', err);
    return { status: 500, error: 'Internal server error while updating local supplier.' };
  }
}

/** HCs waiting for Zonal Manager approval (own ZMCC; Super Admin sees all). */
export async function listPendingLocalSuppliers(
  reqOrUser?: Request | User
): Promise<ServiceResult<ReturnType<typeof serializeLocalSupplier>[]>> {
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
  return { status: 200, data: suppliers.map((supplier) => serializeLocalSupplier(supplier, true)) };
}

async function decideLocalSupplier(
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
  if (!existing) return { status: 404, error: 'Local supplier not found.' };
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

      if (approved && result.erp_mapping_status === 'PENDING') {
        await createNotificationsForEvent(tx, {
          eventKey: 'ERP_VENDOR_MAPPING_REQUIRED',
          sourceId: result.id.toString(),
          sourceZmccId: result.zmcc_id,
          title: 'ERP Vendor Mapping Required',
          body: `Local supplier "${result.name}" (${result.local_supplier_code}) requires official ERP vendor mapping.`,
          deepLink: '/finance/reconciliation',
          dedupeSuffix: result.id.toString(),
        });
      }
      return result;
    });
    return { status: 200, data: serializeLocalSupplier(updated, true) };
  } catch (err: unknown) {
    console.error('decideLocalSupplier error:', err);
    return { status: 500, error: 'Internal server error while saving the HC decision.' };
  }
}

export function approveLocalSupplier(reqOrUser: Request | User, idParam: string | number | bigint) {
  return decideLocalSupplier(reqOrUser, idParam, 'APPROVE');
}

export function rejectLocalSupplier(reqOrUser: Request | User, idParam: string | number | bigint, reason: string) {
  return decideLocalSupplier(reqOrUser, idParam, 'REJECT', reason);
}
