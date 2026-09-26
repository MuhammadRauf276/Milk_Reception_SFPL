import { prisma } from '@core/db';
import { getCurrentUser } from '@core/auth';
import { User, Role } from '@core/types';
import { Prisma } from '@prisma/client';
import { resolveCoreMilkTestResults } from '@/backend/utils/milkTestResolvers';

export interface ServiceResult<T> {
  status: number;
  data?: T;
  error?: string;
}

export interface ZmccTankAuthContext {
  actorUserId: bigint;
  role: Role;
  isSuperAdmin: boolean;
  isZmccManager: boolean;
  isZmccLabAttendant: boolean;
  effectiveZmccId: bigint | null;
}

/**
 * Resolve actor authentication & role boundaries for ZMCC Tank operations
 */
export async function resolveZmccTankAuth(
  reqOrUser?: Request | User,
  action: 'READ' | 'MUTATE_MASTER' | 'RECEIVE_HISTORICAL' = 'READ'
): Promise<{ auth?: ZmccTankAuthContext; errorResponse?: ServiceResult<never> }> {
  let authUser: User | null = null;
  if (reqOrUser && 'role' in reqOrUser && 'id' in reqOrUser) {
    authUser = reqOrUser as User;
  } else if (reqOrUser) {
    const req = reqOrUser as Request;
    authUser = await getCurrentUser(req);
  }

  if (!authUser) {
    return { errorResponse: { status: 401, error: 'Unauthorized.' } };
  }

  const actorUserId = BigInt(String(authUser.id).trim());
  const dbUser = await prisma.user.findUnique({
    where: { id: actorUserId },
    include: { procurement_source: true },
  });

  if (!dbUser || !dbUser.is_active) {
    return { errorResponse: { status: 403, error: 'Forbidden. User is inactive or not found.' } };
  }

  const role = dbUser.role as Role;
  const isSuperAdmin = role === 'SUPER_ADMIN';
  const isZmccManager = role === 'ZMCC_MANAGER';
  const isZmccLabAttendant = role === 'ZMCC_LAB_ATTENDANT';

  // Only SUPER_ADMIN, ZMCC_MANAGER, and ZMCC_LAB_ATTENDANT have ZMCC tank access
  if (!isSuperAdmin && !isZmccManager && !isZmccLabAttendant) {
    return { errorResponse: { status: 403, error: 'Forbidden. Insufficient permissions for ZMCC Tank operations.' } };
  }

  // Master mutation is strictly SUPER_ADMIN only
  if (action === 'MUTATE_MASTER' && !isSuperAdmin) {
    return { errorResponse: { status: 403, error: 'Forbidden. Only Super Admin can modify ZMCC Tank Master configuration.' } };
  }

  // Historical receipt is restricted to ZMCC_LAB_ATTENDANT (own ZMCC) or SUPER_ADMIN (global)
  if (action === 'RECEIVE_HISTORICAL' && !isSuperAdmin && !isZmccLabAttendant) {
    return { errorResponse: { status: 403, error: 'Forbidden. Only ZMCC Lab Attendant or Super Admin can receive milk into tank.' } };
  }

  // Scoped roles must be attached to an active ZMCC source
  let effectiveZmccId: bigint | null = null;
  if (!isSuperAdmin) {
    if (!dbUser.procurement_source_id || !dbUser.procurement_source) {
      return { errorResponse: { status: 403, error: 'Forbidden. User is not assigned to a procurement source.' } };
    }
    if (dbUser.procurement_source.source_type !== 'ZMCC') {
      return { errorResponse: { status: 403, error: 'Forbidden. User is not assigned to a ZMCC source.' } };
    }
    if (!dbUser.procurement_source.is_active) {
      return { errorResponse: { status: 403, error: 'Forbidden. Assigned ZMCC source is inactive.' } };
    }
    effectiveZmccId = dbUser.procurement_source_id;
  }

  return {
    auth: {
      actorUserId,
      role,
      isSuperAdmin,
      isZmccManager,
      isZmccLabAttendant,
      effectiveZmccId,
    },
  };
}

/**
 * Calculates current physical stock of a tank strictly from immutable ledger transactions.
 * Current Tank Stock Liters = SUM(RECEIPT) + SUM(ADJUSTMENT_IN) - SUM(ISSUE) - SUM(ADJUSTMENT_OUT)
 */
export async function getTankPhysicalStock(
  tankId: bigint,
  tx?: Prisma.TransactionClient
): Promise<number> {
  const client = tx || prisma;
  const res: Array<{ current_stock: string | number | null }> = await client.$queryRaw`
    SELECT COALESCE(
      SUM(
        CASE 
          WHEN transaction_type IN ('RECEIPT', 'ADJUSTMENT_IN') THEN quantity_liters
          WHEN transaction_type IN ('ISSUE', 'ADJUSTMENT_OUT') THEN -quantity_liters
          ELSE 0
        END
      ), 0
    ) as current_stock
    FROM zmcc_tank_inventory_transaction
    WHERE tank_id = ${tankId}
  `;

    return Number(res[0]?.current_stock || 0);
  }

  /**
   * Calculates current commercial stock (@13TS Liters) of a tank strictly from immutable ledger transactions.
   * Current Tank Commercial Stock (@13TS) = SUM(RECEIPT) + SUM(ADJUSTMENT_IN) - SUM(ISSUE) - SUM(ADJUSTMENT_OUT)
   *
   * FAILS TRUTHFULLY WHEN INCOMPLETE:
   * If ANY applicable transaction row required for the balance has NULL at_13ts_liters,
   * returns stockAt13Ts = null and isComplete = false.
   * Physical Gross-Liter stock remains independently available and unaffected.
   */
  export async function getTankCommercialStock(
    tankId: bigint,
    tx?: Prisma.TransactionClient
  ): Promise<{ stockAt13Ts: number | null; isComplete: boolean; partialStockAt13Ts?: number }> {
    const client = tx || prisma;
    const res: Array<{
      sum_commercial: string | number | null;
      missing_count: string | number | null;
    }> = await client.$queryRaw`
      SELECT 
        COALESCE(
          SUM(
            CASE 
              WHEN transaction_type IN ('RECEIPT', 'ADJUSTMENT_IN') THEN at_13ts_liters
              WHEN transaction_type IN ('ISSUE', 'ADJUSTMENT_OUT') THEN -at_13ts_liters
              ELSE 0
            END
          ), 0
        ) as sum_commercial,
        COUNT(CASE WHEN at_13ts_liters IS NULL THEN 1 ELSE NULL END) as missing_count
      FROM zmcc_tank_inventory_transaction
      WHERE tank_id = ${tankId}
    `;

    const missingCount = Number(res[0]?.missing_count || 0);
    const sumCommercial = Number(res[0]?.sum_commercial || 0);

    if (missingCount > 0) {
      return {
        stockAt13Ts: null,
        isComplete: false,
        partialStockAt13Ts: Number(sumCommercial.toFixed(2)),
      };
    }

    return {
      stockAt13Ts: Number(sumCommercial.toFixed(2)),
      isComplete: true,
    };
  }

  export async function getTankStockSummary(
    tankId: bigint,
    tx?: Prisma.TransactionClient
  ): Promise<{
    physicalStockGrossLiters: number;
    commercialStockAt13Ts: number | null;
    commercialBalanceComplete: boolean;
  }> {
    const [physical, commercial] = await Promise.all([
      getTankPhysicalStock(tankId, tx),
      getTankCommercialStock(tankId, tx),
    ]);
    return {
      physicalStockGrossLiters: physical,
      commercialStockAt13Ts: commercial.stockAt13Ts,
      commercialBalanceComplete: commercial.isComplete,
    };
  }

  export function serializeTank(
    tank: any,
    stockOrSummary?:
      | { physicalStockGrossLiters: number; commercialStockAt13Ts: number | null; commercialBalanceComplete: boolean }
      | number
  ) {
    let physicalStock = 0;
    let commercialStock: number | null = null;
    let commercialComplete = true;

    if (typeof stockOrSummary === 'number') {
      physicalStock = stockOrSummary;
    } else if (stockOrSummary) {
      physicalStock = stockOrSummary.physicalStockGrossLiters;
      commercialStock = stockOrSummary.commercialStockAt13Ts;
      commercialComplete = stockOrSummary.commercialBalanceComplete;
    } else if (tank.current_stock !== undefined) {
      physicalStock = Number(tank.current_stock);
      if (tank.current_commercial_stock_at_13ts !== undefined) {
        commercialStock = tank.current_commercial_stock_at_13ts !== null ? Number(tank.current_commercial_stock_at_13ts) : null;
        commercialComplete = tank.commercial_balance_complete ?? (commercialStock !== null);
      }
    }

    const cap = Number(tank.capacity_liters);
    return {
      id: tank.id.toString(),
      zmcc_id: tank.zmcc_id.toString(),
      tank_code: tank.tank_code,
      tank_name: tank.tank_name,
      capacity_liters: cap,
      current_stock: Number(physicalStock.toFixed(2)),
      current_physical_stock_gross_liters: Number(physicalStock.toFixed(2)),
      current_commercial_stock_at_13ts: commercialStock !== null ? Number(commercialStock.toFixed(2)) : null,
      commercial_balance_complete: commercialComplete,
      available_capacity: Number(Math.max(0, cap - physicalStock).toFixed(2)),
      is_active: tank.is_active,
      created_by_user_id: tank.created_by_user_id.toString(),
      updated_by_user_id: tank.updated_by_user_id ? tank.updated_by_user_id.toString() : null,
      created_at: tank.created_at instanceof Date ? tank.created_at.toISOString() : tank.created_at,
      updated_at: tank.updated_at instanceof Date ? tank.updated_at.toISOString() : tank.updated_at,
      creator: tank.creator ? { id: tank.creator.id.toString(), username: tank.creator.username, full_name: tank.creator.full_name } : undefined,
      updater: tank.updater ? { id: tank.updater.id.toString(), username: tank.updater.username, full_name: tank.updater.full_name } : undefined,
      zmcc: tank.zmcc ? { id: tank.zmcc.id.toString(), code: tank.zmcc.code, name: tank.zmcc.name } : undefined,
    };
  }

  export function serializeTankReceipt(receipt: any) {
    return {
      id: receipt.id.toString(),
      lab_session_id: receipt.lab_session_id.toString(),
      zmcc_id: receipt.zmcc_id.toString(),
      tank_id: receipt.tank_id.toString(),
      arrival_type: receipt.arrival_type,
      quantity_value: Number(receipt.quantity_value),
      quantity_unit: receipt.quantity_unit,
      density: Number(receipt.density),
      gross_liters: Number(receipt.gross_liters),
      lr: Number(receipt.lr),
      fat: Number(receipt.fat),
      snf: Number(receipt.snf),
      ts: Number(receipt.ts),
      at_13ts_liters: Number(receipt.at_13ts_liters),
      calculation_version: receipt.calculation_version,
      received_at: receipt.received_at instanceof Date ? receipt.received_at.toISOString() : receipt.received_at,
      received_by_user_id: receipt.received_by_user_id.toString(),
      correction_count: receipt.correction_count,
      manager_correction_count: receipt.manager_correction_count,
      last_corrected_by_user_id: receipt.last_corrected_by_user_id ? receipt.last_corrected_by_user_id.toString() : null,
      last_corrected_at: receipt.last_corrected_at instanceof Date ? receipt.last_corrected_at.toISOString() : receipt.last_corrected_at,
      created_at: receipt.created_at instanceof Date ? receipt.created_at.toISOString() : receipt.created_at,
      updated_at: receipt.updated_at instanceof Date ? receipt.updated_at.toISOString() : receipt.updated_at,
      tank: receipt.tank ? serializeTank(receipt.tank) : undefined,
      receiver: receipt.receiver ? { id: receipt.receiver.id.toString(), username: receipt.receiver.username, full_name: receipt.receiver.full_name } : undefined,
    };
  }

  export function serializeTankTransaction(tx: any) {
    return {
      id: tx.id.toString(),
      tank_id: tx.tank_id.toString(),
      zmcc_id: tx.zmcc_id.toString(),
      transaction_type: tx.transaction_type,
      quantity_liters: Number(tx.quantity_liters),
      at_13ts_liters: tx.at_13ts_liters !== null && tx.at_13ts_liters !== undefined ? Number(tx.at_13ts_liters) : null,
      tank_receipt_id: tx.tank_receipt_id ? tx.tank_receipt_id.toString() : null,
      dispatch_id: tx.dispatch_id ? tx.dispatch_id.toString() : null,
      reference_type: tx.reference_type,
      reference_id: tx.reference_id,
      idempotency_key: tx.idempotency_key,
      operational_timestamp: tx.operational_timestamp instanceof Date ? tx.operational_timestamp.toISOString() : tx.operational_timestamp,
      performed_by_user_id: tx.performed_by_user_id.toString(),
      notes: tx.notes,
      created_at: tx.created_at instanceof Date ? tx.created_at.toISOString() : tx.created_at,
    };
  }

/**
 * List tanks for a ZMCC with real-time stock and available capacity
 */
export async function listZmccTanks(
  reqOrUser: Request | User,
  zmccIdParam?: string | number | bigint,
  activeOnly: boolean = false
): Promise<ServiceResult<{ tanks: Record<string, unknown>[] }>> {
  const { auth, errorResponse } = await resolveZmccTankAuth(reqOrUser, 'READ');
  if (errorResponse) return errorResponse;
  if (!auth) return { status: 401, error: 'Unauthorized.' };

  let targetZmccId: bigint;
  if (auth.isSuperAdmin) {
    if (zmccIdParam) {
      try {
        targetZmccId = BigInt(String(zmccIdParam).trim());
      } catch {
        return { status: 400, error: 'Invalid zmcc_id format.' };
      }
    } else {
      // Return all tanks if no zmcc_id filter given
      const tanks = await prisma.zmccTank.findMany({
        where: activeOnly ? { is_active: true } : undefined,
        include: {
          creator: true,
          updater: true,
          zmcc: true,
        },
        orderBy: [{ zmcc_id: 'asc' }, { tank_code: 'asc' }],
      });

      const serialized = await Promise.all(
        tanks.map(async (t) => {
          const stockSummary = await getTankStockSummary(t.id);
          return serializeTank(t, stockSummary);
        })
      );
      return { status: 200, data: { tanks: serialized } };
    }
  } else {
    targetZmccId = auth.effectiveZmccId!;
    if (zmccIdParam && BigInt(String(zmccIdParam).trim()) !== targetZmccId) {
      return { status: 403, error: 'Forbidden. You may only view tanks for your assigned ZMCC.' };
    }
  }

  const tanks = await prisma.zmccTank.findMany({
    where: {
      zmcc_id: targetZmccId,
      ...(activeOnly ? { is_active: true } : {}),
    },
    include: {
      creator: true,
      updater: true,
      zmcc: true,
    },
    orderBy: { tank_code: 'asc' },
  });

  const serialized = await Promise.all(
    tanks.map(async (t) => {
      const stockSummary = await getTankStockSummary(t.id);
      return serializeTank(t, stockSummary);
    })
  );

  return { status: 200, data: { tanks: serialized } };
}

/**
 * Get a single tank by ID with current stock
 */
export async function getZmccTankById(
  reqOrUser: Request | User,
  tankIdParam: string | number | bigint
): Promise<ServiceResult<any>> {
  const { auth, errorResponse } = await resolveZmccTankAuth(reqOrUser, 'READ');
  if (errorResponse) return errorResponse;
  if (!auth) return { status: 401, error: 'Unauthorized.' };

  let tankId: bigint;
  try {
    tankId = BigInt(String(tankIdParam).trim());
  } catch {
    return { status: 400, error: 'Invalid tank ID format.' };
  }

  const tank = await prisma.zmccTank.findUnique({
    where: { id: tankId },
    include: {
      creator: true,
      updater: true,
      zmcc: true,
    },
  });

  if (!tank) {
    return { status: 404, error: 'ZMCC Tank not found.' };
  }

  if (!auth.isSuperAdmin && tank.zmcc_id !== auth.effectiveZmccId!) {
    return { status: 403, error: 'Forbidden. Tank belongs to another ZMCC.' };
  }

  const stockSummary = await getTankStockSummary(tank.id);
  return { status: 200, data: { tank: serializeTank(tank, stockSummary) } };
}

export interface CreateTankPayload {
  zmcc_id: string | number | bigint;
  tank_code: string;
  tank_name: string;
  capacity_liters: number;
  is_active?: boolean;
}

function parseZmccTankUniqueViolation(err: any): { isCodeConflict: boolean; isActiveTankConflict: boolean } {
  const target = err?.meta?.target;
  const msg = String(err?.message || '');

  // 1. Check for partial unique index: zmcc_tank_one_active_per_zmcc_idx
  if (
    (typeof target === 'string' && target.includes('zmcc_tank_one_active_per_zmcc_idx')) ||
    (Array.isArray(target) && target.includes('zmcc_tank_one_active_per_zmcc_idx')) ||
    msg.includes('zmcc_tank_one_active_per_zmcc_idx')
  ) {
    return { isCodeConflict: false, isActiveTankConflict: true };
  }

  // 2. Check for unique constraint on (zmcc_id, tank_code)
  if (
    (Array.isArray(target) && (target.includes('tank_code') || target.includes('zmcc_id'))) ||
    (typeof target === 'string' && (target.includes('tank_code') || target.includes('zmcc_id_tank_code'))) ||
    msg.includes('zmcc_id_tank_code') ||
    msg.includes('tank_code')
  ) {
    return { isCodeConflict: true, isActiveTankConflict: false };
  }

  return { isCodeConflict: false, isActiveTankConflict: false };
}

/**
 * Create a new ZMCC Tank Master record (SUPER_ADMIN only)
 */
export async function createZmccTank(
  reqOrUser: Request | User,
  payload: CreateTankPayload
): Promise<ServiceResult<any>> {
  const { auth, errorResponse } = await resolveZmccTankAuth(reqOrUser, 'MUTATE_MASTER');
  if (errorResponse) return errorResponse;
  if (!auth) return { status: 401, error: 'Unauthorized.' };

  const { zmcc_id, tank_code, tank_name, capacity_liters, is_active } = payload || {};

  if (!zmcc_id) {
    return { status: 400, error: 'zmcc_id is required.' };
  }
  let targetZmccId: bigint;
  try {
    targetZmccId = BigInt(String(zmcc_id).trim());
  } catch {
    return { status: 400, error: 'Invalid zmcc_id format.' };
  }

  const source = await prisma.procurementSource.findUnique({
    where: { id: targetZmccId },
  });
  if (!source) {
    return { status: 404, error: 'Procurement source not found.' };
  }
  if (source.source_type !== 'ZMCC') {
    return { status: 400, error: 'Procurement source must be of type ZMCC. Contractor sources cannot own tanks.' };
  }

  const codeTrimmed = typeof tank_code === 'string' ? tank_code.trim().toUpperCase() : '';
  if (!codeTrimmed) {
    return { status: 400, error: 'tank_code is required.' };
  }

  const nameTrimmed = typeof tank_name === 'string' ? tank_name.trim() : '';
  if (!nameTrimmed) {
    return { status: 400, error: 'tank_name is required.' };
  }

  const capNum = Number(capacity_liters);
  if (isNaN(capNum) || capNum <= 0) {
    return { status: 400, error: 'capacity_liters must be a positive number greater than 0.' };
  }

  let shouldBeActive = true;
  if (is_active !== undefined) {
    if (typeof is_active !== 'boolean') {
      return { status: 400, error: 'is_active must be a boolean (true or false).' };
    }
    shouldBeActive = is_active;
  }

  // Check code uniqueness within ZMCC
  const existing = await prisma.zmccTank.findUnique({
    where: {
      zmcc_id_tank_code: {
        zmcc_id: targetZmccId,
        tank_code: codeTrimmed,
      },
    },
  });
  if (existing) {
    return { status: 400, error: `Tank code "${codeTrimmed}" already exists in this ZMCC.` };
  }

  // Check if an active tank already exists for this ZMCC
  if (shouldBeActive) {
    const existingActive = await prisma.zmccTank.findFirst({
      where: {
        zmcc_id: targetZmccId,
        is_active: true,
      },
    });
    if (existingActive) {
      return {
        status: 400,
        error: `An active tank ("${existingActive.tank_code}") already exists for this ZMCC. Only one active tank is permitted per ZMCC.`,
      };
    }
  }

  try {
    const createdTank = await prisma.$transaction(async (tx) => {
      const tank = await tx.zmccTank.create({
        data: {
          zmcc_id: targetZmccId,
          tank_code: codeTrimmed,
          tank_name: nameTrimmed,
          capacity_liters: new Prisma.Decimal(capNum.toFixed(2)),
          is_active: shouldBeActive,
          created_by_user_id: auth.actorUserId,
        },
        include: {
          creator: true,
          updater: true,
          zmcc: true,
        },
      });

      await tx.auditLog.create({
        data: {
          table_name: 'zmcc_tank',
          record_id: tank.id,
          action: 'ZMCC_TANK_CREATED',
          new_values: {
            tank_code: tank.tank_code,
            tank_name: tank.tank_name,
            capacity_liters: capNum,
            is_active: tank.is_active,
            zmcc_id: targetZmccId.toString(),
            created_by_user_id: auth.actorUserId.toString(),
          },
          user_id: auth.actorUserId,
        },
      });

      return tank;
    });

    return { status: 201, data: { tank: serializeTank(createdTank, 0) } };
  } catch (err: any) {
    const violation = parseZmccTankUniqueViolation(err);
    if (violation.isActiveTankConflict) {
      return {
        status: 400,
        error: 'An active tank already exists for this ZMCC. Only one active tank is permitted per ZMCC.',
      };
    }
    if (violation.isCodeConflict) {
      return {
        status: 400,
        error: `Tank code "${codeTrimmed}" already exists in this ZMCC.`,
      };
    }
    if (err?.code === 'P2002') {
      return {
        status: 400,
        error: 'A tank with these unique properties already exists in this ZMCC.',
      };
    }
    console.error('createZmccTank error:', err);
    return { status: 500, error: 'Internal server error while creating tank.' };
  }
}

export interface UpdateTankPayload {
  tank_code?: string;
  tank_name?: string;
  capacity_liters?: number;
}

/**
 * Update an existing ZMCC Tank Master record (SUPER_ADMIN only)
 */
export async function updateZmccTank(
  reqOrUser: Request | User,
  tankIdParam: string | number | bigint,
  payload: UpdateTankPayload
): Promise<ServiceResult<any>> {
  const { auth, errorResponse } = await resolveZmccTankAuth(reqOrUser, 'MUTATE_MASTER');
  if (errorResponse) return errorResponse;
  if (!auth) return { status: 401, error: 'Unauthorized.' };

  let tankId: bigint;
  try {
    tankId = BigInt(String(tankIdParam).trim());
  } catch {
    return { status: 400, error: 'Invalid tank ID format.' };
  }

  const existing = await prisma.zmccTank.findUnique({
    where: { id: tankId },
  });
  if (!existing) {
    return { status: 404, error: 'ZMCC Tank not found.' };
  }

  const { tank_code, tank_name, capacity_liters } = payload || {};

  let newCode: string | undefined;
  if (tank_code !== undefined) {
    const c = typeof tank_code === 'string' ? tank_code.trim().toUpperCase() : '';
    if (!c) {
      return { status: 400, error: 'tank_code cannot be empty.' };
    }
    if (c !== existing.tank_code) {
      const dup = await prisma.zmccTank.findUnique({
        where: {
          zmcc_id_tank_code: {
            zmcc_id: existing.zmcc_id,
            tank_code: c,
          },
        },
      });
      if (dup && dup.id !== tankId) {
        return { status: 400, error: `Tank code "${c}" is already in use in this ZMCC.` };
      }
      newCode = c;
    }
  }

  let newName: string | undefined;
  if (tank_name !== undefined) {
    const n = typeof tank_name === 'string' ? tank_name.trim() : '';
    if (!n) {
      return { status: 400, error: 'tank_name cannot be empty.' };
    }
    newName = n;
  }

  let newCap: number | undefined;
  if (capacity_liters !== undefined) {
    const cap = Number(capacity_liters);
    if (isNaN(cap) || cap <= 0) {
      return { status: 400, error: 'capacity_liters must be greater than 0.' };
    }
    newCap = cap;
  }

  const updatedTank = await prisma.$transaction(async (tx) => {
    // Lock row FOR UPDATE
    const locked: Array<{ id: bigint; capacity_liters: number | Prisma.Decimal }> = await tx.$queryRaw`
      SELECT id, capacity_liters FROM zmcc_tank WHERE id = ${tankId} FOR UPDATE
    `;
    if (!locked || locked.length === 0) {
      throw new Error('TANK_NOT_FOUND');
    }

    if (newCap !== undefined) {
      const currentStock = await getTankPhysicalStock(tankId, tx);
      if (newCap < currentStock) {
        throw new Error(`CANNOT_REDUCE_CAPACITY_BELOW_STOCK:${currentStock}`);
      }
    }

    const oldValues = {
      tank_code: existing.tank_code,
      tank_name: existing.tank_name,
      capacity_liters: Number(existing.capacity_liters),
    };

    const updated = await tx.zmccTank.update({
      where: { id: tankId },
      data: {
        ...(newCode ? { tank_code: newCode } : {}),
        ...(newName ? { tank_name: newName } : {}),
        ...(newCap !== undefined ? { capacity_liters: new Prisma.Decimal(newCap.toFixed(2)) } : {}),
        updated_by_user_id: auth.actorUserId,
      },
      include: {
        creator: true,
        updater: true,
        zmcc: true,
      },
    });

    const newValues = {
      tank_code: updated.tank_code,
      tank_name: updated.tank_name,
      capacity_liters: Number(updated.capacity_liters),
      updated_by_user_id: auth.actorUserId.toString(),
    };

    await tx.auditLog.create({
      data: {
        table_name: 'zmcc_tank',
        record_id: tankId,
        action: 'ZMCC_TANK_UPDATED',
        old_values: oldValues,
        new_values: newValues,
        user_id: auth.actorUserId,
      },
    });

    return updated;
  });

  const stock = await getTankPhysicalStock(updatedTank.id);
  return { status: 200, data: { tank: serializeTank(updatedTank, stock) } };
}

/**
 * Activate / Deactivate a ZMCC Tank (SUPER_ADMIN only)
 */
export async function toggleZmccTankActive(
  reqOrUser: Request | User,
  tankIdParam: string | number | bigint,
  isActive: boolean
): Promise<ServiceResult<any>> {
  const { auth, errorResponse } = await resolveZmccTankAuth(reqOrUser, 'MUTATE_MASTER');
  if (errorResponse) return errorResponse;
  if (!auth) return { status: 401, error: 'Unauthorized.' };

  let tankId: bigint;
  try {
    tankId = BigInt(String(tankIdParam).trim());
  } catch {
    return { status: 400, error: 'Invalid tank ID format.' };
  }

  const existing = await prisma.zmccTank.findUnique({
    where: { id: tankId },
  });
  if (!existing) {
    return { status: 404, error: 'ZMCC Tank not found.' };
  }

  if (existing.is_active === isActive) {
    const stock = await getTankPhysicalStock(tankId);
    return { status: 200, data: { tank: serializeTank(existing, stock) } };
  }

  if (isActive) {
    const existingActive = await prisma.zmccTank.findFirst({
      where: {
        zmcc_id: existing.zmcc_id,
        is_active: true,
        id: { not: tankId },
      },
    });
    if (existingActive) {
      return {
        status: 400,
        error: `Cannot activate tank. An active tank ("${existingActive.tank_code}") already exists for this ZMCC. Only one active tank is permitted per ZMCC.`,
      };
    }
  }

  try {
    const updatedTank = await prisma.$transaction(async (tx) => {
      const updated = await tx.zmccTank.update({
        where: { id: tankId },
        data: {
          is_active: isActive,
          updated_by_user_id: auth.actorUserId,
        },
        include: {
          creator: true,
          updater: true,
          zmcc: true,
        },
      });

      await tx.auditLog.create({
        data: {
          table_name: 'zmcc_tank',
          record_id: tankId,
          action: isActive ? 'ZMCC_TANK_ACTIVATED' : 'ZMCC_TANK_DEACTIVATED',
          old_values: { is_active: existing.is_active },
          new_values: { is_active: isActive, updated_by_user_id: auth.actorUserId.toString() },
          user_id: auth.actorUserId,
        },
      });

      return updated;
    });

    const stock = await getTankPhysicalStock(updatedTank.id);
    return { status: 200, data: { tank: serializeTank(updatedTank, stock) } };
  } catch (err: any) {
    const violation = parseZmccTankUniqueViolation(err);
    if (violation.isActiveTankConflict) {
      return {
        status: 400,
        error: 'Cannot activate tank. An active tank already exists for this ZMCC. Only one active tank is permitted per ZMCC.',
      };
    }
    if (err?.code === 'P2002') {
      return {
        status: 400,
        error: 'Cannot update tank status due to a unique constraint conflict.',
      };
    }
    console.error('toggleZmccTankActive error:', err);
    return { status: 500, error: 'Internal server error while updating tank status.' };
  }
}

/**
 * Controlled receipt action for an eligible historical pre-6G-D accepted session:
 * status = COMPLETED, decision = ACCEPTED, no existing ZmccTankReceipt.
 * Authorized actor: ZMCC_LAB_ATTENDANT in own ZMCC, or SUPER_ADMIN.
 */
export async function receiveHistoricalSession(
  reqOrUser: Request | User,
  sessionIdParam: string | number | bigint,
  payload?: { tank_id?: string | number | bigint }
): Promise<ServiceResult<any>> {
  const { auth, errorResponse } = await resolveZmccTankAuth(reqOrUser, 'RECEIVE_HISTORICAL');
  if (errorResponse) return errorResponse;
  if (!auth) return { status: 401, error: 'Unauthorized.' };

  let sessionId: bigint;
  try {
    sessionId = BigInt(String(sessionIdParam).trim());
  } catch {
    return { status: 400, error: 'Invalid session ID format.' };
  }

  const session = await prisma.zmccLabSession.findUnique({
    where: { id: sessionId },
    include: {
      results: true,
      tank_receipt: true,
    },
  });

  if (!session) {
    return { status: 404, error: 'ZMCC Lab session not found.' };
  }

  if (!auth.isSuperAdmin && session.zmcc_id !== auth.effectiveZmccId!) {
    return { status: 403, error: 'Forbidden. Lab session belongs to another ZMCC.' };
  }

  if (session.status !== 'COMPLETED' || session.decision !== 'ACCEPTED') {
    return { status: 400, error: 'Only completed ACCEPTED sessions are eligible for tank receipt.' };
  }

  // Idempotency: if already received, return existing receipt
  if (session.tank_receipt) {
    const existingReceipt = await prisma.zmccTankReceipt.findUnique({
      where: { id: session.tank_receipt.id },
      include: { tank: true, receiver: true },
    });
    return { status: 200, data: { tank_receipt: serializeTankReceipt(existingReceipt) } };
  }

  // Check that session has complete authoritative Stage 6G-C metrics
  if (
    session.quantity_value === null || session.quantity_value === undefined ||
    !session.quantity_unit ||
    session.density === null || session.density === undefined ||
    session.gross_liters === null || session.gross_liters === undefined || Number(session.gross_liters) <= 0 ||
    session.snf === null || session.snf === undefined ||
    session.ts === null || session.ts === undefined ||
    session.at_13ts_liters === null || session.at_13ts_liters === undefined ||
    !session.calculation_version || !session.calculation_version.trim()
  ) {
    return {
      status: 400,
      error: 'Historical session does not contain complete authoritative Stage 6G-C metrics required for tank receipt.',
    };
  }

  // Resolve core LR and Fat strictly from session results
  const resolvedCore = resolveCoreMilkTestResults(session.results || []);
  if (!resolvedCore.success) {
    return {
      status: 400,
      error: 'Historical session does not contain authoritative LR/Fat values required for tank receipt.',
    };
  }
  const coreLr = new Prisma.Decimal(resolvedCore.lr.toFixed(2));
  const coreFat = new Prisma.Decimal(resolvedCore.fat.toFixed(2));

  if (payload?.tank_id !== undefined && payload.tank_id !== null && String(payload.tank_id).trim() !== '') {
    try {
      const suppliedTankId = BigInt(String(payload.tank_id).trim());
      const suppliedTank = await prisma.zmccTank.findUnique({ where: { id: suppliedTankId } });
      if (!suppliedTank) {
        return { status: 404, error: 'Selected ZMCC tank not found.' };
      }
      if (suppliedTank.zmcc_id !== session.zmcc_id) {
        return { status: 403, error: 'Forbidden. Selected tank belongs to another ZMCC.' };
      }
      if (!suppliedTank.is_active) {
        return { status: 400, error: 'Destination ZMCC tank is inactive.' };
      }
    } catch {
      return { status: 400, error: 'Invalid tank_id format.' };
    }
  }

  // Tank selection rules
  const activeTanks = await prisma.zmccTank.findMany({
    where: { zmcc_id: session.zmcc_id, is_active: true },
    orderBy: { id: 'asc' },
  });

  if (activeTanks.length === 0) {
    return { status: 400, error: 'No active ZMCC tank is configured.' };
  }
  if (activeTanks.length > 1) {
    return {
      status: 400,
      error: 'Configuration error: Multiple active tanks exist for this ZMCC. Exactly one active tank is permitted.',
    };
  }

  const soleTank = activeTanks[0];
  let targetTankId = soleTank.id;

  if (payload?.tank_id !== undefined && payload.tank_id !== null && String(payload.tank_id).trim() !== '') {
    try {
      const suppliedTankId = BigInt(String(payload.tank_id).trim());
      if (suppliedTankId !== soleTank.id) {
        return { status: 400, error: 'Selected tank does not match the active ZMCC tank.' };
      }
    } catch {
      return { status: 400, error: 'Invalid tank_id format.' };
    }
  }

  const grossLiters = Number(session.gross_liters);
  const now = new Date();

  try {
    const receipt = await prisma.$transaction(async (tx) => {
      // Check idempotency inside tx
      const existingInTx = await tx.zmccTankReceipt.findUnique({
        where: { lab_session_id: sessionId },
        include: { tank: true, receiver: true },
      });
      if (existingInTx) {
        return existingInTx;
      }

      // Lock destination tank row FOR UPDATE and revalidate active state under lock
      const lockedTankRows: Array<{ id: bigint; zmcc_id: bigint; capacity_liters: number | Prisma.Decimal; is_active: boolean }> = await tx.$queryRaw`
        SELECT id, zmcc_id, capacity_liters, is_active FROM zmcc_tank WHERE id = ${targetTankId} FOR UPDATE
      `;
      if (!lockedTankRows || lockedTankRows.length === 0) {
        throw new Error('TANK_NOT_FOUND');
      }
      if (lockedTankRows[0].zmcc_id !== session.zmcc_id) {
        throw new Error('TANK_WRONG_ZMCC');
      }
      if (!lockedTankRows[0].is_active) {
        throw new Error('TANK_INACTIVE:Destination ZMCC tank is inactive.');
      }

      const tankCapacity = Number(lockedTankRows[0].capacity_liters);
      const currentStock = await getTankPhysicalStock(targetTankId, tx);
      const availableCapacity = Math.max(0, tankCapacity - currentStock);

      if (grossLiters > availableCapacity) {
        const availStr = availableCapacity.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
        const reqStr = grossLiters.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
        throw new Error(`INSUFFICIENT_CAPACITY:Tank capacity is insufficient. ${availStr} L available; ${reqStr} L required.`);
      }

      const newReceipt = await tx.zmccTankReceipt.create({
        data: {
          lab_session_id: sessionId,
          zmcc_id: session.zmcc_id,
          tank_id: targetTankId,
          arrival_type: session.arrival_type,
          quantity_value: session.quantity_value!,
          quantity_unit: session.quantity_unit!,
          density: session.density!,
          gross_liters: session.gross_liters!,
          lr: coreLr,
          fat: coreFat,
          snf: session.snf!,
          ts: session.ts!,
          at_13ts_liters: session.at_13ts_liters!,
          calculation_version: session.calculation_version!,
          received_at: now,
          received_by_user_id: auth.actorUserId,
        },
        include: {
          tank: true,
          receiver: true,
        },
      });

      await tx.zmccTankInventoryTransaction.create({
        data: {
          tank_id: targetTankId,
          zmcc_id: session.zmcc_id,
          transaction_type: 'RECEIPT',
          quantity_liters: session.gross_liters!,
          at_13ts_liters: session.at_13ts_liters!,
          tank_receipt_id: newReceipt.id,
          reference_type: 'ZMCC_LAB_SESSION',
          reference_id: sessionId.toString(),
          idempotency_key: `ZMCC_TANK_RECEIPT:LAB_SESSION:${sessionId}`,
          operational_timestamp: now,
          performed_by_user_id: auth.actorUserId,
          notes: `Historical tank receipt for ${session.arrival_type} arrival (Session #${sessionId})`,
        },
      });

      await tx.auditLog.create({
        data: {
          table_name: 'zmcc_tank_receipt',
          record_id: newReceipt.id,
          action: 'ZMCC_TANK_RECEIPT_CREATED',
          new_values: {
            lab_session_id: sessionId.toString(),
            arrival_type: session.arrival_type,
            zmcc_id: session.zmcc_id.toString(),
            tank_id: targetTankId.toString(),
            quantity_value: session.quantity_value ? Number(session.quantity_value) : null,
            quantity_unit: session.quantity_unit,
            gross_liters: grossLiters,
            lr: Number(coreLr),
            fat: Number(coreFat),
            density: session.density ? Number(session.density) : null,
            snf: session.snf ? Number(session.snf) : null,
            ts: session.ts ? Number(session.ts) : null,
            at_13ts_liters: session.at_13ts_liters ? Number(session.at_13ts_liters) : null,
            calculation_version: session.calculation_version,
            received_at: now.toISOString(),
            actor: auth.actorUserId.toString(),
          },
          user_id: auth.actorUserId,
        },
      });

      return newReceipt;
    });

    return { status: 201, data: { tank_receipt: serializeTankReceipt(receipt) } };
  } catch (err: any) {
    if (err.message && err.message.startsWith('INSUFFICIENT_CAPACITY:')) {
      const msg = err.message.replace('INSUFFICIENT_CAPACITY:', '');
      return { status: 400, error: msg };
    }
    if (err.message && err.message.startsWith('TANK_INACTIVE:')) {
      const msg = err.message.replace('TANK_INACTIVE:', '');
      return { status: 400, error: msg };
    }
    if (err.message === 'TANK_WRONG_ZMCC') {
      return { status: 403, error: 'Forbidden. Selected tank belongs to another ZMCC.' };
    }
    if (err.message === 'TANK_NOT_FOUND') {
      return { status: 404, error: 'Selected destination tank not found.' };
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const existing = await prisma.zmccTankReceipt.findUnique({
        where: { lab_session_id: sessionId },
        include: { tank: true, receiver: true },
      });
      if (existing) {
        return { status: 200, data: { tank_receipt: serializeTankReceipt(existing) } };
      }
    }
    console.error('receiveHistoricalSession error:', err);
    return { status: 500, error: 'Failed to receive milk into ZMCC tank.' };
  }
}
