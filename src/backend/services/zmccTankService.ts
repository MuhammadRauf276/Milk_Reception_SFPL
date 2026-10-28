import { prisma } from '@core/db';
import { writeAuditLog } from '@/backend/core/audit';
import { getCurrentUser } from '@core/auth';
import { User, Role } from '@core/types';
import { Prisma, type ZmccTank, type ZmccTankReceipt, type ZmccTankInventoryTransaction } from '@prisma/client';
import type { NumericLike, SourceRef, UserRef } from '@/backend/core/serializable';
import { resolveCoreMilkTestResults } from '@/backend/utils/milkTestResolvers';
import { getErrorCode, getErrorMessage, getErrorMeta } from '@/lib/errors';
import type { ActingContext } from '@/types/acting';
import { assertResourceInScope, primaryActorFields, asRoleFields } from '@/backend/core/acting-context';
import { isZmccFieldOfficer, canActAs } from '@/backend/core/roles/hierarchy';
import { MOT_CALCULATION_VERSION } from '@/backend/utils/milkFormulas';
import {
  calculatePortionReceived,
  computeAndStoreAreaLossTx,
  weightedAverageByNetWeight,
} from '@/backend/services/lossCalculationService';
import { getWeighingPolicyDb, isUnitAllowed } from '@/backend/services/zmccWeighingPolicyService';
import { getPakistanCalendarDate } from '@/backend/core/business-day';

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
  const isDataExecutive = role === 'DATA_EXECUTIVE';
  const isZmccManager = role === 'ZMCC_MANAGER';
  const isZmccLabAttendant = role === 'ZMCC_LAB_ATTENDANT';
  // MDO and PHE Operator may read tanks (they do the weighing); they cannot change tank settings.
  const isFieldOfficerReader = action === 'READ' && isZmccFieldOfficer(role);

  // Check role access with delegation
  const canCoverLab = canActAs(role, 'ZMCC_LAB_ATTENDANT');
  if (!isSuperAdmin && !isDataExecutive && !isZmccManager && !isZmccLabAttendant && !isFieldOfficerReader && !canCoverLab) {
    return { errorResponse: { status: 403, error: 'Forbidden. Insufficient permissions for ZMCC Tank operations.' } };
  }

  // Master mutation is strictly SUPER_ADMIN or DATA_EXECUTIVE only
  if (action === 'MUTATE_MASTER' && !isSuperAdmin && !isDataExecutive) {
    return { errorResponse: { status: 403, error: 'Forbidden. Only Super Admin or Data Executive can modify ZMCC Tank Master configuration.' } };
  }

  // Historical receipt is restricted to ZMCC_LAB_ATTENDANT (own ZMCC) or SUPER_ADMIN (global)
  if (action === 'RECEIVE_HISTORICAL' && !isSuperAdmin && !isZmccLabAttendant) {
    return { errorResponse: { status: 403, error: 'Forbidden. Only ZMCC Lab Attendant or Super Admin can receive milk into tank.' } };
  }

  // Scoped roles must be attached to an active ZMCC source
  let effectiveZmccId: bigint | null = null;
  const isSystemScope = isSuperAdmin || isDataExecutive || role === 'HEAD_OF_MPD';
  if (!isSystemScope) {
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
   * Calculates current physical stock for multiple tanks in a single batch query strictly from immutable ledger transactions.
   * Returns a Map of tankId string -> stock number.
   */
  export async function getBatchTankPhysicalStock(
    tankIds: bigint[],
    tx?: Prisma.TransactionClient
  ): Promise<Map<string, number>> {
    const stockMap = new Map<string, number>();
    if (tankIds.length === 0) return stockMap;

    const client = tx || prisma;
    const rows: Array<{ tank_id: bigint | string; current_stock: string | number | null }> = await client.$queryRaw`
      SELECT tank_id, COALESCE(
        SUM(
          CASE 
            WHEN transaction_type IN ('RECEIPT', 'ADJUSTMENT_IN') THEN quantity_liters
            WHEN transaction_type IN ('ISSUE', 'ADJUSTMENT_OUT') THEN -quantity_liters
            ELSE 0
          END
        ), 0
      ) as current_stock
      FROM zmcc_tank_inventory_transaction
      WHERE tank_id IN (${Prisma.join(tankIds)})
      GROUP BY tank_id
    `;

    for (const row of rows) {
      stockMap.set(row.tank_id.toString(), Number(row.current_stock || 0));
    }
    return stockMap;
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

  export type SerializableTank = ZmccTank & {
    current_stock?: NumericLike | null;
    current_commercial_stock_at_13ts?: NumericLike | null;
    commercial_balance_complete?: boolean;
    creator?: UserRef | null;
    updater?: UserRef | null;
    zmcc?: SourceRef | null;
  };

  export function serializeTank(
    tank: SerializableTank,
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

  export function serializeTankReceipt(
    receipt: ZmccTankReceipt & { tank?: SerializableTank | null; receiver?: UserRef | null }
  ) {
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

  export function serializeTankTransaction(tx: ZmccTankInventoryTransaction) {
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
): Promise<ServiceResult<unknown>> {
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

function parseZmccTankUniqueViolation(err: unknown): { isCodeConflict: boolean; isActiveTankConflict: boolean } {
  const target = getErrorMeta(err)?.target;
  const msg = getErrorMessage(err);

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
): Promise<ServiceResult<unknown>> {
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

      await writeAuditLog(tx, {
        tableName: 'zmcc_tank',
        recordId: tank.id,
        action: 'ZMCC_TANK_CREATED',
        newValues: {
          tank_code: tank.tank_code,
          tank_name: tank.tank_name,
          capacity_liters: capNum,
          is_active: tank.is_active,
          zmcc_id: targetZmccId.toString(),
          created_by_user_id: auth.actorUserId.toString(),
        },
        actor: { userId: auth.actorUserId, actorRole: auth.role },
      });

      return tank;
    });

    return { status: 201, data: { tank: serializeTank(createdTank, 0) } };
  } catch (err) {
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
    if (getErrorCode(err) === 'P2002') {
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
): Promise<ServiceResult<unknown>> {
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

    await writeAuditLog(tx, {
      tableName: 'zmcc_tank',
      recordId: tankId,
      action: 'ZMCC_TANK_UPDATED',
      oldValues: oldValues,
      newValues: newValues,
      actor: { userId: auth.actorUserId, actorRole: auth.role },
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
): Promise<ServiceResult<unknown>> {
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

      await writeAuditLog(tx, {
        tableName: 'zmcc_tank',
        recordId: tankId,
        action: isActive ? 'ZMCC_TANK_ACTIVATED' : 'ZMCC_TANK_DEACTIVATED',
        oldValues: { is_active: existing.is_active },
        newValues: { is_active: isActive, updated_by_user_id: auth.actorUserId.toString() },
        actor: { userId: auth.actorUserId, actorRole: auth.role },
      });

      return updated;
    });

    const stock = await getTankPhysicalStock(updatedTank.id);
    return { status: 200, data: { tank: serializeTank(updatedTank, stock) } };
  } catch (err) {
    const violation = parseZmccTankUniqueViolation(err);
    if (violation.isActiveTankConflict) {
      return {
        status: 400,
        error: 'Cannot activate tank. An active tank already exists for this ZMCC. Only one active tank is permitted per ZMCC.',
      };
    }
    if (getErrorCode(err) === 'P2002') {
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
): Promise<ServiceResult<unknown>> {
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
    if (!existingReceipt) {
      return { status: 500, error: 'Existing tank receipt could not be loaded.' };
    }
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
  const targetTankId = soleTank.id;

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

      await writeAuditLog(tx, {
        tableName: 'zmcc_tank_receipt',
        recordId: newReceipt.id,
        action: 'ZMCC_TANK_RECEIPT_CREATED',
        newValues: {
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
        actor: { userId: auth.actorUserId, actorRole: auth.role },
      });

      return newReceipt;
    });

    return { status: 201, data: { tank_receipt: serializeTankReceipt(receipt) } };
  } catch (err) {
    if (getErrorMessage(err) && getErrorMessage(err).startsWith('INSUFFICIENT_CAPACITY:')) {
      const msg = getErrorMessage(err).replace('INSUFFICIENT_CAPACITY:', '');
      return { status: 400, error: msg };
    }
    if (getErrorMessage(err) && getErrorMessage(err).startsWith('TANK_INACTIVE:')) {
      const msg = getErrorMessage(err).replace('TANK_INACTIVE:', '');
      return { status: 400, error: msg };
    }
    if (getErrorMessage(err) === 'TANK_WRONG_ZMCC') {
      return { status: 403, error: 'Forbidden. Selected tank belongs to another ZMCC.' };
    }
    if (getErrorMessage(err) === 'TANK_NOT_FOUND') {
      return { status: 404, error: 'Selected destination tank not found.' };
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError && getErrorCode(err) === 'P2002') {
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

// ============================================================================
// ZMCC weighing per VEHICLE (lab session), then ONE "Unload to ZMCC tank" action.
// Done by MDO / PHE Operator (and superiors). Saving weights books nothing into the tank.
// Operator-facing views never carry litres, 13 TS, LR, SNF or TS.
// ============================================================================

export const WEIGHING_ROLES = ['MDO', 'PHE_OPERATOR'] as const;

export type WeighingMode = 'WEIGHT' | 'MANUAL';

class WeighingError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const SESSION_INCLUDE = {
  portions: { orderBy: { portion_number: 'asc' } },
  mot_arrival: { include: { journey: { include: { mot_vehicle: true, route: true } } } },
  local_supplier_arrival: { include: { local_supplier: true } },
  tank_receipt: { include: { tank: true } },
} satisfies Prisma.ZmccLabSessionInclude;

type SessionFull = Prisma.ZmccLabSessionGetPayload<{ include: typeof SESSION_INCLUDE }>;
type PortionRow = SessionFull['portions'][number];

/** Filter: every portion has a final decision (no pending portion or QA review) and one is accepted. */
const NO_PENDING_PORTION: Prisma.ZmccLabPortionListRelationFilter = {
  none: {
    OR: [
      { final_decision: 'PENDING' },
      { review_status: 'PENDING' },
      { final_decision: { notIn: ['ACCEPTED', 'REJECTED'] } },
    ],
  },
  some: { final_decision: 'ACCEPTED' },
};

function scopeError(acting: ActingContext, zmccId: bigint): WeighingError | null {
  const check = assertResourceInScope(acting, { sourceId: zmccId, sourceType: 'ZMCC' });
  if (!check.ok) return new WeighingError(403, 'This vehicle belongs to another ZMCC.');
  return null;
}

function parseId(value: string | number | bigint, label: string): bigint {
  try {
    return BigInt(String(value).trim());
  } catch {
    throw new WeighingError(400, `Invalid ${label}.`);
  }
}

function parseWeightKg(value: unknown): number {
  const n = typeof value === 'string' ? Number(value.trim()) : Number(value);
  if (value === null || value === undefined || value === '' || !Number.isFinite(n) || n <= 0) {
    throw new WeighingError(400, 'Enter each value as a number more than 0.');
  }
  if (n > 200000) throw new WeighingError(400, 'A value looks too big. Please check it.');
  return Number(n.toFixed(3));
}

function toServiceError(err: unknown, fallback: string, label: string): ServiceResult<never> {
  if (err instanceof WeighingError) return { status: err.status, error: err.message };
  console.error(`${label} error:`, err);
  return { status: 500, error: fallback };
}

function num(v: Prisma.Decimal | number | null | undefined): number | null {
  return v === null || v === undefined ? null : Number(v);
}

/** Milk sources a ZMCC may credit milk to (assigned visibility, plus legacy direct link). */
async function findAssignedSource(db: Prisma.TransactionClient, zmccId: bigint, sourceId: bigint) {
  const vis = await db.milkSourceZmccVisibility.findFirst({
    where: { zmcc_id: zmccId, milk_source_id: sourceId, is_active: true, milk_source: { is_active: true } },
    include: { milk_source: true },
  });
  if (vis) return vis.milk_source;
  return db.zmccMilkSource.findFirst({ where: { id: sourceId, zmcc_id: zmccId, is_active: true } });
}

export function isHcSession(arrivalType: string): boolean {
  return arrivalType === 'HC';
}

/** Computed (never typed) outcome of a vehicle visit. */
export function computeExitOutcome(
  portions: Array<{ final_decision: string; status: string }>
): 'RECEIVED' | 'REJECTED' | 'PARTLY_RECEIVED' | 'ACCEPTED_NOT_RECEIVED' {
  const accepted = portions.filter((p) => p.final_decision === 'ACCEPTED');
  if (accepted.length === 0) return 'REJECTED';
  const received = accepted.filter((p) => p.status === 'WEIGHED').length;
  if (received === accepted.length) return 'RECEIVED';
  return received === 0 ? 'ACCEPTED_NOT_RECEIVED' : 'PARTLY_RECEIVED';
}

/** Why a vehicle cannot be weighed / unloaded yet; null when it is ready. */
function notReadyReason(s: SessionFull): string | null {
  if (s.unloaded_at) return 'This vehicle is already unloaded.';
  if (s.journey_closed_at || s.closed_reason) return 'This vehicle visit is already closed.';
  if (s.local_supplier_arrival?.exit_timestamp) return 'This vehicle has already left.';
  if (s.portions.length === 0) return 'No portions found for this vehicle.';
  const pending = s.portions.some(
    (p) => !['ACCEPTED', 'REJECTED'].includes(p.final_decision) || p.review_status === 'PENDING'
  );
  if (pending) return 'One or more portions are still waiting for a lab decision or review.';
  if (!s.portions.some((p) => p.final_decision === 'ACCEPTED')) return 'There is no accepted milk to weigh.';
  return null;
}

function acceptedOf(s: SessionFull): PortionRow[] {
  return s.portions.filter((p) => p.final_decision === 'ACCEPTED');
}

export type WeighingPortionView = {
  id: string;
  portion_number: number;
  label: string;
  /** Net quantity as the operator entered / weighed it (kg, or the typed unit). */
  net_value: number | null;
  net_unit: 'KG' | 'LITER' | null;
  /** Hidden (null) when the operator typed litres. */
  net_weight_kg: number | null;
};

export type WeighingSessionView = {
  session_id: string;
  zmcc_id: string;
  source_type: 'MC' | 'HC';
  vehicle_number: string | null;
  source_name: string | null;
  zmcc_token: string | null;
  arrived_at: string | null;
  status: 'READY' | 'UNLOADED';
  needs_source: boolean;
  mode: WeighingMode | null;
  portions: WeighingPortionView[];
  /** WEIGHT mode only: w0..wN. */
  weights_kg: number[] | null;
  values_complete: boolean;
  unloaded_at: string | null;
  tank_code: string | null;
  milk_source_name: string | null;
  close_requested: boolean;
};

export function serializeWeighingSession(s: SessionFull): WeighingSessionView {
  const journey = s.mot_arrival?.journey ?? null;
  const supplier = s.local_supplier_arrival;
  const accepted = acceptedOf(s);
  const mode = (accepted[0]?.net_entry_mode as WeighingMode | null | undefined) ?? null;
  const portions: WeighingPortionView[] = accepted.map((p) => {
    const manual = p.net_entry_mode === 'MANUAL';
    const manualLiter = manual && p.net_entry_unit === 'LITER';
    return {
      id: p.id.toString(),
      portion_number: p.portion_number,
      label: `Portion ${p.portion_number}`,
      net_value: manual ? num(p.net_entry_value) : num(p.net_weight_kg),
      net_unit: manual ? ((p.net_entry_unit as 'KG' | 'LITER' | null) ?? null) : p.net_weight_kg !== null ? 'KG' : null,
      net_weight_kg: manualLiter ? null : num(p.net_weight_kg),
    };
  });
  let weights: number[] | null = null;
  if (mode === 'WEIGHT' && accepted.every((p) => p.first_weight_kg !== null && p.second_weight_kg !== null)) {
    weights = [Number(accepted[0].first_weight_kg), ...accepted.map((p) => Number(p.second_weight_kg))];
  }
  return {
    session_id: s.id.toString(),
    zmcc_id: s.zmcc_id.toString(),
    source_type: isHcSession(s.arrival_type) ? 'HC' : 'MC',
    vehicle_number: journey?.mot_vehicle?.vehicle_number ?? supplier?.vehicle_number ?? null,
    source_name: journey?.route?.route_code ?? supplier?.local_supplier?.name ?? null,
    zmcc_token: s.mot_arrival?.zmcc_token ?? supplier?.zmcc_token ?? null,
    arrived_at: (s.mot_arrival?.arrival_timestamp ?? supplier?.arrival_timestamp)?.toISOString() ?? null,
    status: s.unloaded_at ? 'UNLOADED' : 'READY',
    needs_source: isHcSession(s.arrival_type),
    mode,
    portions,
    weights_kg: weights,
    values_complete: accepted.length > 0 && accepted.every((p) => p.net_weight_kg !== null),
    unloaded_at: s.unloaded_at ? s.unloaded_at.toISOString() : null,
    tank_code: s.tank_receipt?.tank?.tank_code ?? null,
    milk_source_name: s.tank_receipt?.milk_source_name_snapshot ?? null,
    close_requested: !!s.close_requested_at && !s.close_approved_at,
  };
}

export type WeighingTankView = {
  id: string;
  zmcc_id: string;
  tank_code: string;
  tank_name: string;
  capacity_liters: number;
  available_capacity: number;
};

export type WeighingSourceView = { id: string; zmcc_id: string; name: string };

export const WEIGHING_DONE_PAGE_SIZE = 10;

export type WeighingQueueData = {
  ready: WeighingSessionView[];
  done: WeighingSessionView[];
  done_total: number;
  done_page: number;
  done_page_size: number;
  tanks: WeighingTankView[];
  sources: WeighingSourceView[];
  range?: 'today' | '7days' | 'custom';
  from_date?: string;
  to_date?: string;
};

export type ListWeighingQueueOpts = {
  donePage?: number;
  donePageSize?: number;
  range?: 'today' | '7days' | 'custom';
  fromDate?: string;
  toDate?: string;
  search?: string;
};

/** Vehicles ready to weigh/unload, plus vehicles unloaded within the specified range (paged, max 7 days). */
export async function listWeighingQueue(
  acting: ActingContext,
  opts: ListWeighingQueueOpts = {}
): Promise<ServiceResult<WeighingQueueData>> {
  const zmccFilter = acting.scope.kind === 'SOURCE' ? { zmcc_id: acting.scope.sourceId } : {};
  const todayStr = getPakistanCalendarDate(new Date());
  let since: Date;
  let until: Date | undefined = undefined;

  const range = opts.range ?? 'today';
  let effectiveFrom = todayStr;
  let effectiveTo = todayStr;

  if (range === '7days') {
    const d = new Date();
    d.setDate(d.getDate() - 6);
    effectiveFrom = getPakistanCalendarDate(d);
    effectiveTo = todayStr;
    since = new Date(`${effectiveFrom}T00:00:00.000+05:00`);
    until = new Date(`${effectiveTo}T23:59:59.999+05:00`);
  } else if (range === 'custom' && (opts.fromDate || opts.toDate)) {
    effectiveFrom = opts.fromDate || todayStr;
    effectiveTo = opts.toDate || todayStr;
    let startD = new Date(`${effectiveFrom}T00:00:00.000+05:00`);
    let endD = new Date(`${effectiveTo}T23:59:59.999+05:00`);
    if (isNaN(startD.getTime())) {
      effectiveFrom = todayStr;
      startD = new Date(`${todayStr}T00:00:00.000+05:00`);
    }
    if (isNaN(endD.getTime())) {
      effectiveTo = todayStr;
      endD = new Date(`${todayStr}T23:59:59.999+05:00`);
    }
    if (endD < startD) {
      endD = new Date(`${effectiveFrom}T23:59:59.999+05:00`);
      effectiveTo = effectiveFrom;
    }
    // Enforce greater range 7 days only (max 7 calendar days)
    const maxSpanMs = 7 * 24 * 60 * 60 * 1000;
    if (endD.getTime() - startD.getTime() > maxSpanMs) {
      const clampedStart = new Date(endD.getTime() - (6 * 24 * 60 * 60 * 1000));
      effectiveFrom = getPakistanCalendarDate(clampedStart);
      startD = new Date(`${effectiveFrom}T00:00:00.000+05:00`);
    }
    since = startD;
    until = endD;
  } else {
    // 'today' default: full current day in PKT (from 00:00:00 to 23:59:59.999)
    effectiveFrom = todayStr;
    effectiveTo = todayStr;
    since = new Date(`${todayStr}T00:00:00.000+05:00`);
    until = new Date(`${todayStr}T23:59:59.999+05:00`);
  }

  const donePageSize = Math.min(Math.max(opts.donePageSize ?? WEIGHING_DONE_PAGE_SIZE, 1), 50);
  const donePage = Math.max(opts.donePage ?? 1, 1);

  const search = opts.search?.trim();
  const searchFilter: Prisma.ZmccLabSessionWhereInput = search
    ? {
        OR: [
          { mot_arrival: { zmcc_token: { contains: search, mode: 'insensitive' } } },
          { mot_arrival: { journey: { mot_vehicle: { vehicle_number: { contains: search, mode: 'insensitive' } } } } },
          { mot_arrival: { journey: { route: { route_code: { contains: search, mode: 'insensitive' } } } } },
          { local_supplier_arrival: { zmcc_token: { contains: search, mode: 'insensitive' } } },
          { local_supplier_arrival: { vehicle_number: { contains: search, mode: 'insensitive' } } },
          { local_supplier_arrival: { local_supplier: { name: { contains: search, mode: 'insensitive' } } } },
        ],
      }
    : {};

  const doneWhere: Prisma.ZmccLabSessionWhereInput = {
    ...zmccFilter,
    unloaded_at: {
      gte: since,
      ...(until ? { lte: until } : {}),
    },
    ...searchFilter,
  };

  const [readyRows, doneTotal, doneRows] = await Promise.all([
    prisma.zmccLabSession.findMany({
      where: {
        ...zmccFilter,
        unloaded_at: null,
        journey_closed_at: null,
        closed_reason: null,
        portions: NO_PENDING_PORTION,
      },
      include: SESSION_INCLUDE,
      orderBy: { created_at: 'asc' },
      take: 200,
    }),
    prisma.zmccLabSession.count({ where: doneWhere }),
    prisma.zmccLabSession.findMany({
      where: doneWhere,
      include: SESSION_INCLUDE,
      orderBy: { unloaded_at: 'desc' },
      skip: (donePage - 1) * donePageSize,
      take: donePageSize,
    }),
  ]);

  const tankRows = await prisma.zmccTank.findMany({
    where: { is_active: true, ...zmccFilter },
    orderBy: { tank_code: 'asc' },
  });
  const tankStocks = await getBatchTankPhysicalStock(tankRows.map((t) => t.id));
  const tanks = tankRows.map((t) => {
    const stock = tankStocks.get(t.id.toString()) ?? 0;
    const cap = Number(t.capacity_liters);
    return {
      id: t.id.toString(),
      zmcc_id: t.zmcc_id.toString(),
      tank_code: t.tank_code,
      tank_name: t.tank_name,
      capacity_liters: cap,
      available_capacity: Number(Math.max(0, cap - stock).toFixed(2)),
    };
  });

  const visibilities = await prisma.milkSourceZmccVisibility.findMany({
    where: { is_active: true, milk_source: { is_active: true }, ...zmccFilter },
    include: { milk_source: { select: { id: true, name: true } } },
    orderBy: { milk_source: { name: 'asc' } },
  });
  const sources: WeighingSourceView[] = visibilities.map((v) => ({
    id: v.milk_source.id.toString(),
    zmcc_id: v.zmcc_id.toString(),
    name: v.milk_source.name,
  }));

  return {
    status: 200,
    data: {
      ready: readyRows.filter((s) => notReadyReason(s) === null).map(serializeWeighingSession),
      done: doneRows.map(serializeWeighingSession),
      done_total: doneTotal,
      done_page: donePage,
      done_page_size: donePageSize,
      tanks,
      sources,
      range,
      from_date: effectiveFrom,
      to_date: effectiveTo,
    },
  };
}

async function lockAndLoadSession(
  tx: Prisma.TransactionClient,
  sessionId: bigint,
  acting: ActingContext
): Promise<SessionFull> {
  await tx.$queryRaw`SELECT id FROM zmcc_lab_session WHERE id = ${sessionId} FOR UPDATE`;
  const session = await tx.zmccLabSession.findUnique({ where: { id: sessionId }, include: SESSION_INCLUDE });
  if (!session) throw new WeighingError(404, 'Vehicle not found.');
  const sErr = scopeError(acting, session.zmcc_id);
  if (sErr) throw sErr;
  return session;
}

export interface SaveWeighingValuesPayload {
  mode?: unknown;
  /** WEIGHT mode: w0..wN (N accepted portions -> N+1 strictly decreasing weights, kg). */
  weights_kg?: unknown;
  /** MANUAL mode: one net quantity per accepted portion: { portion_id, value, unit }. */
  values?: unknown;
}

/** Saves the weights (or typed net quantities) for a vehicle. Books nothing into the tank. */
export async function saveWeighingValues(
  acting: ActingContext,
  sessionIdParam: string | number | bigint,
  payload: SaveWeighingValuesPayload
): Promise<ServiceResult<{ session: WeighingSessionView }>> {
  try {
    const sessionId = parseId(sessionIdParam, 'vehicle id');
    const mode = payload?.mode;
    if (mode !== 'WEIGHT' && mode !== 'MANUAL') throw new WeighingError(400, 'Choose Weight or Manual entry.');

    const updated = await prisma.$transaction(async (tx) => {
      const session = await lockAndLoadSession(tx, sessionId, acting);
      const blocked = notReadyReason(session);
      if (blocked) throw new WeighingError(409, blocked);
      const accepted = acceptedOf(session);
      const now = new Date();
      const nets: Array<{ id: bigint; data: Prisma.ZmccLabPortionUncheckedUpdateInput; net: number }> = [];

      if (mode === 'WEIGHT') {
        const raw = payload.weights_kg;
        if (!Array.isArray(raw) || raw.length !== accepted.length + 1) {
          throw new WeighingError(
            400,
            `Enter ${accepted.length + 1} weights (the vehicle weight before, and after each portion).`
          );
        }
        const w = raw.map(parseWeightKg);
        for (let i = 1; i < w.length; i++) {
          if (w[i] >= w[i - 1]) throw new WeighingError(400, 'Each weight must be less than the one before it.');
        }
        accepted.forEach((p, i) => {
          const net = Number((w[i] - w[i + 1]).toFixed(3));
          nets.push({
            id: p.id,
            net,
            data: {
              net_entry_mode: 'WEIGHT',
              net_entry_value: null,
              net_entry_unit: null,
              first_weight_kg: new Prisma.Decimal(w[i].toFixed(3)),
              first_weight_at: now,
              first_weight_by_user_id: acting.userId,
              ...asRoleFields(acting, 'first_weight'),
              second_weight_kg: new Prisma.Decimal(w[i + 1].toFixed(3)),
              second_weight_at: now,
              second_weight_by_user_id: acting.userId,
              ...asRoleFields(acting, 'second_weight'),
              net_weight_kg: new Prisma.Decimal(net.toFixed(3)),
            },
          });
        });
      } else {
        const policy = await getWeighingPolicyDb(tx);
        if (!policy.manual_entry_enabled) {
          throw new WeighingError(403, 'Manual entry is not allowed. Please use the scale.');
        }
        const raw = payload.values;
        if (!Array.isArray(raw) || raw.length !== accepted.length) {
          throw new WeighingError(400, `Enter a quantity for each of the ${accepted.length} portion(s).`);
        }
        const byPortion = new Map<string, { value: unknown; unit: unknown }>();
        for (const r of raw as Array<Record<string, unknown>>) {
          if (!r || typeof r !== 'object' || r.portion_id === undefined) {
            throw new WeighingError(400, 'Invalid quantity entry.');
          }
          byPortion.set(String(r.portion_id), { value: r.value, unit: r.unit });
        }
        for (const p of accepted) {
          const entry = byPortion.get(p.id.toString());
          if (!entry) throw new WeighingError(400, `Enter the quantity for Portion ${p.portion_number}.`);
          const unit = String(entry.unit ?? '').toUpperCase();
          if (unit !== 'KG' && unit !== 'LITER') throw new WeighingError(400, 'Choose KG or Liter.');
          if (!isUnitAllowed(policy.allowed_units, unit)) {
            throw new WeighingError(400, `${unit === 'KG' ? 'Kilograms are' : 'Litres are'} not allowed for manual entry.`);
          }
          const value = parseWeightKg(entry.value);
          let netKg = value;
          if (unit === 'LITER') {
            const density = calculatePortionReceived({
              netWeightKg: 1,
              density: num(p.density),
              lr: num(p.lr),
              ts: Number(p.ts ?? 0),
            }).density;
            netKg = Number((value * density).toFixed(3));
          }
          if (netKg <= 0) throw new WeighingError(400, 'The quantity is too small. Please check it.');
          nets.push({
            id: p.id,
            net: netKg,
            data: {
              net_entry_mode: 'MANUAL',
              net_entry_value: new Prisma.Decimal(value.toFixed(3)),
              net_entry_unit: unit,
              first_weight_kg: null,
              first_weight_at: null,
              first_weight_by_user_id: null,
              second_weight_kg: null,
              second_weight_at: null,
              second_weight_by_user_id: null,
              net_weight_kg: new Prisma.Decimal(netKg.toFixed(3)),
            },
          });
        }
      }

      for (const n of nets) {
        await tx.zmccLabPortion.update({ where: { id: n.id }, data: n.data });
      }
      await writeAuditLog(tx, {
        tableName: 'zmcc_lab_session',
        recordId: sessionId,
        action: 'ZMCC_WEIGHING_VALUES_SAVED',
        oldValues: null,
        newValues: {
          mode,
          portions: nets.map((n) => ({ portion_id: n.id.toString(), net_weight_kg: n.net })),
        },
        actor: acting,
      });
      return tx.zmccLabSession.findUniqueOrThrow({ where: { id: sessionId }, include: SESSION_INCLUDE });
    });
    return { status: 200, data: { session: serializeWeighingSession(updated) } };
  } catch (err) {
    return toServiceError(err, 'Could not save the values.', 'saveWeighingValues');
  }
}

export interface UnloadPayload {
  tank_id?: string | number | bigint | null;
  milk_source_id?: string | number | bigint | null;
}

/**
 * The single "Unload to ZMCC tank" action for a vehicle. In ONE transaction: tank capacity check,
 * one stock transaction per accepted portion, the tank receipt (totals; LR/Fat/SNF/TS weighted by
 * net weight), HC milk source (once per vehicle), portions -> WEIGHED, session unloaded, journey close.
 */
export async function unloadSessionToTank(
  acting: ActingContext,
  sessionIdParam: string | number | bigint,
  payload: UnloadPayload
): Promise<ServiceResult<{ session: WeighingSessionView; journey_closed: boolean }>> {
  try {
    const sessionId = parseId(sessionIdParam, 'vehicle id');
    const result = await prisma.$transaction(async (tx) => {
      const session = await lockAndLoadSession(tx, sessionId, acting);
      const blocked = notReadyReason(session);
      if (blocked) throw new WeighingError(409, blocked);
      const accepted = acceptedOf(session);
      if (!accepted.every((p) => p.net_weight_kg !== null)) {
        throw new WeighingError(400, 'Save all weights (or quantities) before unloading.');
      }
      if (session.tank_receipt) throw new WeighingError(409, 'This vehicle already has a tank receipt.');
      const zmccId = session.zmcc_id;

      // Tank
      const activeTanks = await tx.zmccTank.findMany({
        where: { zmcc_id: zmccId, is_active: true },
        orderBy: { id: 'asc' },
      });
      if (activeTanks.length === 0) throw new WeighingError(400, 'No active tank is set up for this ZMCC.');
      let tank = activeTanks[0];
      const suppliedTank = payload?.tank_id;
      if (suppliedTank !== undefined && suppliedTank !== null && String(suppliedTank).trim() !== '') {
        const suppliedId = parseId(suppliedTank, 'tank id');
        const found = activeTanks.find((t) => t.id === suppliedId);
        if (!found) throw new WeighingError(400, 'This tank is not active in your ZMCC.');
        tank = found;
      } else if (activeTanks.length > 1) {
        throw new WeighingError(400, 'Choose a tank.');
      }

      // HC milk source (chosen once per vehicle). MC milk already carries its source per collection.
      let source: { id: bigint; erp_code: string; name: string } | null = null;
      if (isHcSession(session.arrival_type)) {
        const suppliedSource = payload?.milk_source_id;
        if (suppliedSource === undefined || suppliedSource === null || String(suppliedSource).trim() === '') {
          throw new WeighingError(400, 'Choose the milk source.');
        }
        source = await findAssignedSource(tx, zmccId, parseId(suppliedSource, 'milk source id'));
        if (!source) throw new WeighingError(400, 'This milk source is not available for your ZMCC.');
      }

      // Received quantities per portion
      const rows = accepted.map((p) => {
        const net = Number(p.net_weight_kg);
        const m = calculatePortionReceived({
          netWeightKg: net,
          density: num(p.density),
          lr: num(p.lr),
          ts: Number(p.ts ?? 0),
        });
        if (m.grossLiters <= 0) {
          throw new WeighingError(400, `Portion ${p.portion_number}: the quantity is too small. Please check it.`);
        }
        return {
          portion: p,
          net,
          gross: m.grossLiters,
          at13: m.at13tsLiters,
          density: m.density,
          lr: Number(p.lr ?? 0),
          fat: Number(p.fat ?? 0),
          snf: Number(p.snf ?? 0),
          ts: Number(p.ts ?? 0),
        };
      });
      const totalGross = Number(rows.reduce((a, r) => a + r.gross, 0).toFixed(2));

      // Lock the tank; capacity check for the whole vehicle
      const locked: Array<{ id: bigint; zmcc_id: bigint; capacity_liters: Prisma.Decimal; is_active: boolean }> =
        await tx.$queryRaw`SELECT id, zmcc_id, capacity_liters, is_active FROM zmcc_tank WHERE id = ${tank.id} FOR UPDATE`;
      if (!locked.length || locked[0].zmcc_id !== zmccId) throw new WeighingError(404, 'Tank not found.');
      if (!locked[0].is_active) throw new WeighingError(400, 'This tank is not active.');
      const stock = await getTankPhysicalStock(tank.id, tx);
      const available = Math.max(0, Number(locked[0].capacity_liters) - stock);
      if (totalGross > available) {
        throw new WeighingError(400, `Tank is too full. ${available.toFixed(0)} L free; ${totalGross.toFixed(0)} L needed.`);
      }

      const now = new Date();
      const totalNet = rows.reduce((a, r) => a + r.net, 0);
      const wavg = (pick: (r: (typeof rows)[number]) => number) =>
        weightedAverageByNetWeight(rows.map((r) => ({ netWeightKg: r.net, value: pick(r) })));
      const receipt = await tx.zmccTankReceipt.create({
        data: {
          lab_session_id: sessionId,
          zmcc_id: zmccId,
          tank_id: tank.id,
          arrival_type: session.arrival_type,
          quantity_unit: 'KG',
          calculation_version: MOT_CALCULATION_VERSION,
          received_at: now,
          received_by_user_id: acting.userId,
          portion_id: rows.length === 1 ? rows[0].portion.id : null,
          quantity_value: new Prisma.Decimal(totalNet.toFixed(2)),
          density: new Prisma.Decimal(wavg((r) => r.density).toFixed(4)),
          gross_liters: new Prisma.Decimal(totalGross.toFixed(2)),
          lr: new Prisma.Decimal(wavg((r) => r.lr).toFixed(2)),
          fat: new Prisma.Decimal(wavg((r) => r.fat).toFixed(2)),
          snf: new Prisma.Decimal(wavg((r) => r.snf).toFixed(2)),
          ts: new Prisma.Decimal(wavg((r) => r.ts).toFixed(2)),
          at_13ts_liters: new Prisma.Decimal(rows.reduce((a, r) => a + r.at13, 0).toFixed(2)),
          ...(source
            ? {
                milk_source_id: source.id,
                milk_source_code_snapshot: source.erp_code,
                milk_source_name_snapshot: source.name,
              }
            : {}),
        },
      });

      for (const r of rows) {
        await tx.zmccTankInventoryTransaction.create({
          data: {
            tank_id: tank.id,
            zmcc_id: zmccId,
            transaction_type: 'RECEIPT',
            quantity_liters: new Prisma.Decimal(r.gross.toFixed(2)),
            at_13ts_liters: new Prisma.Decimal(r.at13.toFixed(2)),
            tank_receipt_id: receipt.id,
            reference_type: 'ZMCC_LAB_PORTION',
            reference_id: r.portion.id.toString(),
            idempotency_key: `ZMCC_TANK_RECEIPT:PORTION:${r.portion.id}`,
            operational_timestamp: now,
            performed_by_user_id: acting.userId,
            notes: `Tank receipt for ${session.arrival_type} portion (Session #${sessionId}, portion #${r.portion.id})`,
          },
        });
        await tx.zmccLabPortion.update({
          where: { id: r.portion.id },
          data: { status: 'WEIGHED', tank_id: tank.id },
        });
      }

      await tx.zmccLabSession.update({
        where: { id: sessionId },
        data: { unloaded_at: now, unloaded_by_user_id: acting.userId, close_requested_by_user_id: null, close_requested_at: null },
      });

      if (source && session.local_supplier_arrival_id) {
        await tx.zmccLocalSupplierArrival.update({
          where: { id: session.local_supplier_arrival_id },
          data: {
            milk_source_id: source.id,
            milk_source_code_snapshot: source.erp_code,
            milk_source_name_snapshot: source.name,
          },
        });
      }

      await writeAuditLog(tx, {
        tableName: 'zmcc_tank_receipt',
        recordId: receipt.id,
        action: 'ZMCC_TANK_RECEIPT_CREATED',
        oldValues: null,
        newValues: {
          lab_session_id: sessionId.toString(),
          tank_id: tank.id.toString(),
          portions: rows.length,
          net_weight_kg: totalNet,
          gross_liters: totalGross,
          at_13ts_liters: Number(receipt.at_13ts_liters),
          ts: Number(receipt.ts),
          milk_source_id: source ? source.id.toString() : null,
          ...primaryActorFields(acting),
        },
        actor: acting,
      });
      await writeAuditLog(tx, {
        tableName: 'zmcc_lab_session',
        recordId: sessionId,
        action: 'ZMCC_UNLOADED_TO_TANK',
        oldValues: null,
        newValues: { tank_id: tank.id.toString(), tank_code: tank.tank_code, portions: rows.length },
        actor: acting,
      });

      const journeyClosed = await closeJourneyIfDoneTx(tx, sessionId, acting);
      if (journeyClosed && !isHcSession(session.arrival_type)) {
        // MC has no gate exit: the outcome is final once the milk is unloaded.
        await tx.zmccLabSession.update({
          where: { id: sessionId },
          data: {
            exit_outcome: computeExitOutcome(
              session.portions.map((p) => ({
                final_decision: p.final_decision,
                status: p.final_decision === 'ACCEPTED' ? 'WEIGHED' : p.status,
              }))
            ),
          },
        });
      }
      const fresh = await tx.zmccLabSession.findUniqueOrThrow({ where: { id: sessionId }, include: SESSION_INCLUDE });
      return { fresh, journeyClosed };
    });
    return {
      status: 200,
      data: { session: serializeWeighingSession(result.fresh), journey_closed: result.journeyClosed },
    };
  } catch (err) {
    if (getErrorCode(err) === 'P2002') {
      return { status: 409, error: 'This vehicle was already unloaded.' };
    }
    return toServiceError(err, 'Could not unload the milk.', 'unloadSessionToTank');
  }
}

/**
 * Closes the journey when the lab is finished and every portion is either rejected or weighed.
 * Stores Area (MC) loss / gain from received (unloaded) accepted portions only. Safe to call more than once.
 */
export async function closeJourneyIfDoneTx(
  tx: Prisma.TransactionClient,
  sessionId: bigint,
  acting: ActingContext
): Promise<boolean> {
  const session = await tx.zmccLabSession.findUnique({
    where: { id: sessionId },
    include: { portions: true, mot_arrival: { select: { journey_id: true } } },
  });
  if (!session || session.journey_closed_at || session.status !== 'COMPLETED') return false;

  const portions = session.portions;
  const weighedCount = portions.filter((x) => x.final_decision === 'ACCEPTED' && x.status === 'WEIGHED').length;
  const allDone = portions.every(
    (x) => x.final_decision === 'REJECTED' || (x.final_decision === 'ACCEPTED' && x.status === 'WEIGHED')
  );
  if (portions.length === 0 || weighedCount === 0 || !allDone) return false;

  await tx.zmccLabSession.update({
    where: { id: sessionId },
    data: { journey_closed_at: new Date(), closed_reason: 'ALL_PORTIONS_WEIGHED' },
  });
  await writeAuditLog(tx, {
    tableName: 'zmcc_lab_session',
    recordId: sessionId,
    action: 'ZMCC_JOURNEY_CLOSED',
    oldValues: null,
    newValues: { closed_reason: 'ALL_PORTIONS_WEIGHED', weighed_portions: weighedCount },
    actor: acting,
  });

  if (session.mot_arrival?.journey_id) {
    await computeAndStoreAreaLossTx(tx, { journeyId: session.mot_arrival.journey_id, sessionId, actor: acting });
  }
  return true;
}
