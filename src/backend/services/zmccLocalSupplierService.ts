import { prisma } from '@core/db';
import { Prisma } from '@prisma/client';
import { User } from '@core/types';
import { resolveZmccAuth, validatePhone, validateCnic, ServiceResult } from './zmccMasterDataService';

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
}

export function serializeLocalSupplier(supplier: any) {
  return {
    id: supplier.id.toString(),
    local_supplier_code: supplier.local_supplier_code,
    zmcc_id: supplier.zmcc_id.toString(),
    name: supplier.name,
    phone: supplier.phone ?? null,
    cnic: supplier.cnic ?? null,
    erp_reference: supplier.erp_reference ?? null,
    erp_mapping_status: supplier.erp_mapping_status,
    is_active: supplier.is_active,
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

/**
 * Get / Search local suppliers with scope isolation
 */
export async function getLocalSuppliers(
  reqOrUser?: Request | User,
  params: LocalSupplierSearchParams = {}
): Promise<ServiceResult<any[]>> {
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
    data: suppliers.map(serializeLocalSupplier),
  };
}

/**
 * Get local supplier by ID with ZMCC authorization check
 */
export async function getLocalSupplierById(
  reqOrUser: Request | User,
  idParam: string | number | bigint
): Promise<ServiceResult<any>> {
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
    data: serializeLocalSupplier(supplier),
  };
}

/**
 * Create lightweight local supplier (PHE_OPERATOR, ZMCC_MANAGER, SUPER_ADMIN)
 */
export async function createLocalSupplier(
  reqOrUser: Request | User,
  payload: CreateLocalSupplierPayload
): Promise<ServiceResult<any>> {
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
    ? new Set(['name', 'phone', 'cnic', 'erp_reference', 'zmcc_id'])
    : new Set(['name', 'phone', 'cnic', 'erp_reference']);

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

  // Validate Phone
  let phone: string | null = null;
  if (payload.phone !== undefined && payload.phone !== null) {
    if (typeof payload.phone !== 'string') {
      return { status: 400, error: 'phone must be a string.' };
    }
    const trimmedPhone = payload.phone.trim();
    if (trimmedPhone !== '') {
      if (!validatePhone(trimmedPhone)) {
        return { status: 400, error: 'Invalid Pakistani phone number format (e.g. 03001234567 or +923001234567).' };
      }
      phone = trimmedPhone;
    }
  }

  // Validate CNIC
  let cnic: string | null = null;
  if (payload.cnic !== undefined && payload.cnic !== null) {
    if (typeof payload.cnic !== 'string') {
      return { status: 400, error: 'cnic must be a string.' };
    }
    const trimmedCnic = payload.cnic.trim();
    if (trimmedCnic !== '') {
      if (!validateCnic(trimmedCnic)) {
        return { status: 400, error: 'Invalid CNIC format (13 digits or XXXXX-XXXXXXX-X).' };
      }
      cnic = trimmedCnic;
    }
  }

  // Validate ERP Reference
  const erpValidation = validateErpReference(payload.erp_reference);
  if (erpValidation.error) {
    return { status: 400, error: erpValidation.error };
  }
  const erpReference = erpValidation.value;

  // Race-safe sequence allocation and atomic creation inside transaction
  try {
    const createdSupplier = await prisma.$transaction(async (tx) => {
      const seqResult = await tx.$queryRaw<{ nextval: bigint }[]>`
        SELECT nextval('zmcc_local_supplier_code_seq') as nextval
      `;
      if (!seqResult || seqResult.length === 0 || seqResult[0].nextval === undefined || seqResult[0].nextval === null) {
        throw new Error('FAILED_TO_ALLOCATE_LOCAL_SUPPLIER_CODE_SEQUENCE');
      }
      const seqNum = Number(seqResult[0].nextval);
      const localSupplierCode = `ZLS-${String(seqNum).padStart(6, '0')}`;

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
        },
        include: { zmcc: true },
      });

      await tx.auditLog.create({
        data: {
          table_name: 'zmcc_local_supplier',
          record_id: supplier.id,
          action: 'ZMCC_LOCAL_SUPPLIER_CREATED',
          old_values: Prisma.DbNull,
          new_values: {
            local_supplier_code: supplier.local_supplier_code,
            zmcc_id: targetZmccId.toString(),
            name: supplier.name,
            phone: supplier.phone,
            cnic: supplier.cnic,
            erp_reference: supplier.erp_reference,
            erp_mapping_status: supplier.erp_mapping_status,
            is_active: supplier.is_active,
          },
          user_id: auth.actorUserId,
        },
      });

      return supplier;
    });

    return {
      status: 201,
      data: serializeLocalSupplier(createdSupplier),
    };
  } catch (err: any) {
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
): Promise<ServiceResult<any>> {
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

  if (!auth.isZmccManager && !auth.isSuperAdmin) {
    return {
      status: 403,
      error: 'Forbidden. Only ZMCC Managers or Super Admins may update local suppliers.',
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

  // Validate Phone if provided
  if (payload.phone !== undefined) {
    if (payload.phone === null) {
      updateData.phone = null;
    } else {
      if (typeof payload.phone !== 'string') {
        return { status: 400, error: 'phone must be a string.' };
      }
      const trimmed = payload.phone.trim();
      if (trimmed === '') {
        updateData.phone = null;
      } else {
        if (!validatePhone(trimmed)) {
          return { status: 400, error: 'Invalid Pakistani phone number format.' };
        }
        updateData.phone = trimmed;
      }
    }
  }

  // Validate CNIC if provided
  if (payload.cnic !== undefined) {
    if (payload.cnic === null) {
      updateData.cnic = null;
    } else {
      if (typeof payload.cnic !== 'string') {
        return { status: 400, error: 'cnic must be a string.' };
      }
      const trimmed = payload.cnic.trim();
      if (trimmed === '') {
        updateData.cnic = null;
      } else {
        if (!validateCnic(trimmed)) {
          return { status: 400, error: 'Invalid CNIC format (13 digits or XXXXX-XXXXXXX-X).' };
        }
        updateData.cnic = trimmed;
      }
    }
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

      await tx.auditLog.create({
        data: {
          table_name: 'zmcc_local_supplier',
          record_id: supplierId,
          action: 'ZMCC_LOCAL_SUPPLIER_UPDATED',
          old_values: {
            name: existingSupplier.name,
            phone: existingSupplier.phone,
            cnic: existingSupplier.cnic,
            erp_reference: existingSupplier.erp_reference,
            is_active: existingSupplier.is_active,
          },
          new_values: {
            name: result.name,
            phone: result.phone,
            cnic: result.cnic,
            erp_reference: result.erp_reference,
            is_active: result.is_active,
          },
          user_id: auth.actorUserId,
        },
      });

      return result;
    });

    return {
      status: 200,
      data: serializeLocalSupplier(updated),
    };
  } catch (err: any) {
    console.error('updateLocalSupplier error:', err);
    return { status: 500, error: 'Internal server error while updating local supplier.' };
  }
}
