import { prisma } from '../core/db';
import { Prisma, SiloTransactionType } from '@prisma/client';
import { calculatePhysicalLiters } from '../utils/milkFormulas';

export interface RecordTransactionParams {
  silo_id: bigint | string;
  transaction_type: SiloTransactionType;
  quantity_kg: number;
  quantity_liters?: number | null;
  operational_timestamp: Date;
  visit_id?: bigint | string | null;
  portion_id?: bigint | string | null;
  reference_type?: string | null;
  reference_id?: string | null;
  idempotency_key?: string | null;
  performed_by?: bigint | string | null;
  notes?: string | null;
}

export interface UpdateSiloConfigParams {
  silo_id: bigint | string;
  silo_name?: string;
  capacity_liters?: number;
  is_active?: boolean;
  updated_by?: bigint | string | null;
}

export interface FinalizeReceiptResult {
  success: boolean;
  receiptCreated: boolean;
  alreadyFinalized?: boolean;
  finalLiters?: number;
  targetSiloCode?: string;
  plantLrVal?: number;
  reason?: 'MISSING_PLANT_LR' | 'NO_ACCEPTED_PORTIONS' | 'NO_DESTINATION_SILO' | 'MULTI_SILO_ALLOCATION_REQUIRED' | 'CAPACITY_EXCEEDED' | 'ALREADY_FINALIZED';
  message: string;
}

/**
 * Calculates current stock of a silo in PHYSICAL LITERS purely from immutable inventory ledger transactions.
 * Formula: sum(RECEIPT quantity_liters) - sum(ISSUE quantity_liters)
 */
export async function getSiloCurrentStockLiters(siloIdInput: bigint | string, txPrisma?: Prisma.TransactionClient): Promise<number> {
  const db = txPrisma || prisma;
  const siloId = typeof siloIdInput === 'string' ? BigInt(siloIdInput) : siloIdInput;

  const silo = await db.silo.findUnique({
    where: { id: siloId },
  });

  if (!silo) {
    throw new Error(`Silo record not found (ID: ${siloIdInput}).`);
  }

  const transactions = await db.siloInventoryTransaction.findMany({
    where: { silo_id: siloId },
  });

  let totalInLiters = 0;
  let totalOutLiters = 0;

  for (const tx of transactions) {
    // If quantity_liters is stored, use it; fallback to mass / 1.0265 if unpopulated on legacy test rows
    const liters = tx.quantity_liters !== null ? Number(tx.quantity_liters) : Number(tx.quantity_kg) / 1.0265;

    if (tx.transaction_type === SiloTransactionType.RECEIPT) {
      totalInLiters += liters;
    } else if (tx.transaction_type === SiloTransactionType.ISSUE) {
      totalOutLiters += liters;
    }
  }

  const currentStockLiters = totalInLiters - totalOutLiters;
  return Math.max(0, currentStockLiters);
}

/**
 * Legacy mass compatibility helper for current stock in kg.
 */
export async function getSiloCurrentStock(siloIdInput: bigint | string, txPrisma?: Prisma.TransactionClient): Promise<number> {
  const db = txPrisma || prisma;
  const siloId = typeof siloIdInput === 'string' ? BigInt(siloIdInput) : siloIdInput;

  const inAgg = await db.siloInventoryTransaction.aggregate({
    where: { silo_id: siloId, transaction_type: SiloTransactionType.RECEIPT },
    _sum: { quantity_kg: true },
  });

  const outAgg = await db.siloInventoryTransaction.aggregate({
    where: { silo_id: siloId, transaction_type: SiloTransactionType.ISSUE },
    _sum: { quantity_kg: true },
  });

  const totalIn = inAgg._sum.quantity_kg ? Number(inAgg._sum.quantity_kg) : 0;
  const totalOut = outAgg._sum.quantity_kg ? Number(outAgg._sum.quantity_kg) : 0;

  return Math.max(0, totalIn - totalOut);
}

/**
 * Calculates remaining available physical capacity of a silo in LITERS.
 * Formula: capacity_liters - current_stock_liters
 */
export async function getSiloAvailableCapacity(siloIdInput: bigint | string, txPrisma?: Prisma.TransactionClient): Promise<number> {
  const db = txPrisma || prisma;
  const siloId = typeof siloIdInput === 'string' ? BigInt(siloIdInput) : siloIdInput;

  const silo = await db.silo.findUnique({
    where: { id: siloId },
  });

  if (!silo) {
    throw new Error(`Silo record not found (ID: ${siloIdInput}).`);
  }

  const capacityLiters = Number(silo.capacity_liters);
  const currentStockLiters = await getSiloCurrentStockLiters(siloId, db);
  const availableCapacity = capacityLiters - currentStockLiters;

  return Math.max(0, availableCapacity);
}

/**
 * Calculates active reserved liters for a silo from ongoing unfinalized unloading logs and READY_FOR_TARE/TARE_WEIGHED vehicles.
 * Reservation remains active until the final SiloInventoryTransaction RECEIPT is posted!
 */
export async function getSiloActiveReservedLiters(
  siloIdInput: bigint | string,
  txPrisma?: Prisma.TransactionClient,
  excludeVisitId?: bigint | string
): Promise<number> {
  const db = txPrisma || prisma;
  const siloId = typeof siloIdInput === 'string' ? BigInt(siloIdInput) : siloIdInput;
  const excludeId = excludeVisitId ? (typeof excludeVisitId === 'string' ? BigInt(excludeVisitId) : excludeVisitId) : null;

  const activeLogs = await db.unloadingLog.findMany({
    where: {
      silo_id: siloId,
      pump_start_timestamp: { not: null },
      portion: {
        visit: {
          current_status: { in: ['UNLOADING', 'READY_FOR_TARE', 'TARE_WEIGHED'] },
          ...(excludeId ? { id: { not: excludeId } } : {}),
          // Exclude visits that ALREADY have a final SiloInventoryTransaction RECEIPT posted
          inventory_transactions: {
            none: {
              transaction_type: SiloTransactionType.RECEIPT,
            },
          },
        },
      },
    },
    include: {
      portion: {
        include: {
          plant_lab_results: {
            include: { lab_test: true },
          },
          dispatch_lab_results: {
            include: { lab_test: true },
          },
        },
      },
    },
  });

  let totalReservedLiters = 0;
  for (const log of activeLogs) {
    const declaredKg = log.portion.declared_quantity_kg ? Number(log.portion.declared_quantity_kg) : 0;
    if (declaredKg <= 0) continue;

    // Primary: Plant QA LR; Fallback: Dispatch LR for provisional planning
    const plantLrRes = log.portion.plant_lab_results.find(
      (r) => r.lab_test.testCode === 'LT-000008' || r.lab_test.testCode === 'LT-000027' || r.lab_test.testName.toUpperCase().includes('LR')
    );
    const dispatchLrRes = log.portion.dispatch_lab_results.find(
      (r) => r.lab_test.testCode === 'LT-000008' || r.lab_test.testCode === 'LT-000027' || r.lab_test.testName.toUpperCase().includes('LR')
    );

    const lrVal = plantLrRes?.numeric_value ? Number(plantLrRes.numeric_value) : dispatchLrRes?.numeric_value ? Number(dispatchLrRes.numeric_value) : 26.5;
    const density = 1 + lrVal / 1000;
    const physicalLiters = declaredKg / density;

    totalReservedLiters += physicalLiters;
  }

  return totalReservedLiters;
}

/**
 * Calculates provisional available capacity in LITERS for new unloading assignments.
 * Formula: Maximum Capacity Liters - Finalized Stock Liters - Active Reserved Liters
 */
export async function getSiloProvisionalAvailableCapacity(siloIdInput: bigint | string, txPrisma?: Prisma.TransactionClient): Promise<number> {
  const db = txPrisma || prisma;
  const siloId = typeof siloIdInput === 'string' ? BigInt(siloIdInput) : siloIdInput;

  const silo = await db.silo.findUnique({
    where: { id: siloId },
  });

  if (!silo) {
    throw new Error(`Silo record not found (ID: ${siloIdInput}).`);
  }

  const capacityLiters = Number(silo.capacity_liters);
  const currentStockLiters = await getSiloCurrentStockLiters(siloId, db);
  const reservedLiters = await getSiloActiveReservedLiters(siloId, db);

  const provisionalAvailable = capacityLiters - currentStockLiters - reservedLiters;
  return Math.max(0, provisionalAvailable);
}

/**
 * Reusable finalization service to post final audited SiloInventoryTransaction RECEIPT for a vehicle visit.
 * HARDENING RULE: Requires AUTHORITATIVE Plant QA LR (LT-000008 / LT-000027). Zero Dispatch or 26.5 fallbacks allowed for final stock!
 */
export async function finalizeSiloReceiptForVisit(
  visitIdInput: bigint | string,
  performedByUserIdInput: bigint | string,
  opTimestampInput?: Date,
  txPrisma?: Prisma.TransactionClient
): Promise<FinalizeReceiptResult> {
  const db = txPrisma || prisma;
  const visitId = typeof visitIdInput === 'string' ? BigInt(visitIdInput) : visitIdInput;
  const performedByUserId = typeof performedByUserIdInput === 'string' ? BigInt(performedByUserIdInput) : performedByUserIdInput;

  const idempotencyKey = `FINAL_RECEIPT:VISIT:${visitId.toString()}`;

  // 1. Idempotency Check: Check if final RECEIPT already exists
  const existingReceipt = await db.siloInventoryTransaction.findFirst({
    where: {
      OR: [
        { idempotency_key: idempotencyKey },
        { visit_id: visitId, transaction_type: SiloTransactionType.RECEIPT },
      ],
    },
    include: { silo: true },
  });

  if (existingReceipt) {
    return {
      success: true,
      receiptCreated: false,
      alreadyFinalized: true,
      finalLiters: Number(existingReceipt.quantity_liters || 0),
      targetSiloCode: existingReceipt.silo.silo_code,
      message: `Final silo inventory receipt has already been created for vehicle visit #${visitId.toString()}.`,
    };
  }

  // 2. Fetch VehicleVisit with portions, plant lab results, unloading log & weight ticket
  const visit = await db.vehicleVisit.findUnique({
    where: { id: visitId },
    include: {
      portions: {
        include: {
          unloading_log: true,
          plant_lab_results: { include: { lab_test: true } },
        },
      },
      weight_ticket: true,
    },
  });

  if (!visit) {
    throw new Error(`Vehicle visit record not found (ID ${visitId.toString()}).`);
  }

  if (!visit.weight_ticket || visit.weight_ticket.net_weight_kg === null) {
    throw new Error(`Net weight has not been calculated yet for vehicle visit #${visit.visit_number}.`);
  }

  const netWeightKg = Number(visit.weight_ticket.net_weight_kg);
  if (netWeightKg <= 0) {
    throw new Error(`Invalid net weight (${netWeightKg} kg) for vehicle visit #${visit.visit_number}.`);
  }

  const acceptedPortions = (visit.portions || []).filter((p) => p.plant_decision === 'ACCEPTED');
  if (acceptedPortions.length === 0) {
    return {
      success: false,
      receiptCreated: false,
      reason: 'NO_ACCEPTED_PORTIONS',
      message: 'No accepted portions exist for this vehicle.',
    };
  }

  // Collect destination silos from unloading logs
  const siloIdsSet = new Set<bigint>();
  for (const p of acceptedPortions) {
    if (p.unloading_log?.silo_id) {
      siloIdsSet.add(p.unloading_log.silo_id);
    }
  }

  const uniqueSiloIds = Array.from(siloIdsSet);
  if (uniqueSiloIds.length === 0) {
    return {
      success: false,
      receiptCreated: false,
      reason: 'NO_DESTINATION_SILO',
      message: 'No destination silo recorded during unloading.',
    };
  }

  if (uniqueSiloIds.length > 1) {
    // Case B: Multiple accepted portions with DIFFERENT destination silos
    // V1 Safety Rule: Do not guess unapproved allocation rules.
    return {
      success: false,
      receiptCreated: false,
      reason: 'MULTI_SILO_ALLOCATION_REQUIRED',
      message: 'Multiple accepted portions map to different destination silos. Automatic inventory finalization skipped.',
    };
  }

  const targetSiloId = uniqueSiloIds[0];

  // 3. STRICT AUTHORITATIVE PLANT LR CHECK (No Dispatch LR, No 26.5 fallback!)
  let plantLrVal: number | null = null;
  for (const p of acceptedPortions) {
    const plantLrRes = p.plant_lab_results.find(
      (r) => r.lab_test.testCode === 'LT-000008' || r.lab_test.testCode === 'LT-000027' || r.lab_test.testName.toUpperCase().includes('LR')
    );
    if (plantLrRes?.numeric_value) {
      const val = Number(plantLrRes.numeric_value);
      if (!isNaN(val) && val > 0) {
        plantLrVal = val;
        break;
      }
    }
  }

  if (plantLrVal === null) {
    return {
      success: false,
      receiptCreated: false,
      reason: 'MISSING_PLANT_LR',
      message: 'Authoritative Plant QA LR is missing. Final physical silo receipt cannot be calculated.',
    };
  }

  // Calculate final physical received liters
  const finalLiters = calculatePhysicalLiters(netWeightKg, plantLrVal);
  const opTimestamp = opTimestampInput || visit.weight_ticket.tare_timestamp || new Date();

  // 4. Lock Silo row for atomic inventory update & validate capacity
  await db.$executeRaw`SELECT id FROM silo WHERE id = ${targetSiloId} FOR UPDATE`;

  const silo = await db.silo.findUnique({ where: { id: targetSiloId } });
  if (!silo) {
    throw new Error(`Target Silo (ID ${targetSiloId}) not found.`);
  }

  if (!silo.is_active) {
    return {
      success: false,
      receiptCreated: false,
      reason: 'CAPACITY_EXCEEDED',
      message: `Target Silo "${silo.silo_name}" (${silo.silo_code}) is INACTIVE. Final milk receipt blocked.`,
    };
  }

  const currentStockLiters = await getSiloCurrentStockLiters(targetSiloId, db);
  const otherReservedLiters = await getSiloActiveReservedLiters(targetSiloId, db, visitId);
  const capacityLiters = Number(silo.capacity_liters);
  const availableCapacityLiters = capacityLiters - currentStockLiters - otherReservedLiters;

  if (finalLiters > availableCapacityLiters) {
    return {
      success: false,
      receiptCreated: false,
      reason: 'CAPACITY_EXCEEDED',
      message: `Final received milk volume (${Math.round(finalLiters)} L) exceeds available capacity in Silo "${silo.silo_name}" (${Math.round(availableCapacityLiters)} L available).`,
    };
  }

  // 5. Create Database-Level Idempotent SiloInventoryTransaction RECEIPT
  await db.siloInventoryTransaction.create({
    data: {
      silo_id: targetSiloId,
      transaction_type: SiloTransactionType.RECEIPT,
      quantity_kg: new Prisma.Decimal(netWeightKg),
      quantity_liters: new Prisma.Decimal(finalLiters),
      operational_timestamp: opTimestamp,
      visit_id: visitId,
      portion_id: acceptedPortions.length === 1 ? acceptedPortions[0].id : null,
      reference_type: 'SCALE2_TARE_WEIGHMENT',
      reference_id: visit.weight_ticket.ticket_number || `TK-${visitId}`,
      idempotency_key: idempotencyKey,
      performed_by: performedByUserId,
      notes: `Final milk receipt upon Scale 2 Tare weighing (${visit.vehicle_number}). Authoritative Plant LR: ${plantLrVal}`,
    },
  });

  // 6. Log Immutable Audit Record for Final Silo Receipt
  await db.auditLog.create({
    data: {
      table_name: 'silo_inventory_transaction',
      record_id: visitId,
      action: 'SILO_RECEIPT_FINALIZED',
      user_id: performedByUserId,
      new_values: {
        visit_id: visitId.toString(),
        vehicle_number: visit.vehicle_number,
        silo_id: targetSiloId.toString(),
        silo_code: silo.silo_code,
        net_weight_kg: netWeightKg,
        final_physical_liters: Math.round(finalLiters),
        plant_lr: plantLrVal,
        op_timestamp: opTimestamp.toISOString(),
        submitted_at: new Date().toISOString(),
      },
    },
  });

  // 7. Advance VehicleVisit status to READY_FOR_GATE_EXIT
  await db.vehicleVisit.update({
    where: { id: visitId },
    data: { current_status: 'READY_FOR_GATE_EXIT' },
  });

  return {
    success: true,
    receiptCreated: true,
    finalLiters: Math.round(finalLiters),
    targetSiloCode: silo.silo_code,
    plantLrVal,
    message: `Final Silo Receipt created (~${Math.round(finalLiters).toLocaleString()} L in ${silo.silo_code}). Vehicle is ready for gate exit.`,
  };
}

/**
 * Super Admin configuration update helper for Silo (Name, Maximum Capacity Liters, Active State).
 * Includes capacity reduction safety check vs current calculated stock.
 */
export async function updateSiloConfiguration(params: UpdateSiloConfigParams) {
  const siloId = typeof params.silo_id === 'string' ? BigInt(params.silo_id) : params.silo_id;
  const updatedBy = params.updated_by ? (typeof params.updated_by === 'string' ? BigInt(params.updated_by) : params.updated_by) : null;

  return await prisma.$transaction(async (tx) => {
    // Lock silo row for atomic configuration update
    await tx.$executeRaw`SELECT id FROM silo WHERE id = ${siloId} FOR UPDATE`;

    const silo = await tx.silo.findUnique({
      where: { id: siloId },
    });

    if (!silo) {
      throw new Error(`Silo record not found (ID: ${params.silo_id}).`);
    }

    if (params.capacity_liters !== undefined) {
      if (typeof params.capacity_liters !== 'number' || isNaN(params.capacity_liters) || params.capacity_liters <= 0) {
        throw new Error('Silo maximum capacity must be a positive number greater than 0 Liters.');
      }

      // Safety Rule: New maximum capacity cannot be reduced below current calculated stock!
      const currentStockLiters = await getSiloCurrentStockLiters(siloId, tx);
      if (params.capacity_liters < currentStockLiters) {
        throw new Error(`New capacity (${params.capacity_liters} L) cannot be less than current calculated stock (${currentStockLiters} L).`);
      }
    }

    const updatedSilo = await tx.silo.update({
      where: { id: siloId },
      data: {
        ...(params.silo_name ? { silo_name: params.silo_name.trim() } : {}),
        ...(params.capacity_liters !== undefined ? { capacity_liters: new Prisma.Decimal(params.capacity_liters) } : {}),
        ...(params.is_active !== undefined ? { is_active: params.is_active } : {}),
        ...(updatedBy ? { updated_by: updatedBy } : {}),
      },
    });

    return updatedSilo;
  });
}

/**
 * Records an auditable inventory transaction in the ledger with strict safety checks and PostgreSQL row-level locking.
 */
export async function recordSiloTransaction(params: RecordTransactionParams) {
  const siloId = typeof params.silo_id === 'string' ? BigInt(params.silo_id) : params.silo_id;
  const visitId = params.visit_id ? (typeof params.visit_id === 'string' ? BigInt(params.visit_id) : params.visit_id) : null;
  const portionId = params.portion_id ? (typeof params.portion_id === 'string' ? BigInt(params.portion_id) : params.portion_id) : null;
  const performedBy = params.performed_by ? (typeof params.performed_by === 'string' ? BigInt(params.performed_by) : params.performed_by) : null;

  // Validation 1: Positive Quantity
  if (typeof params.quantity_kg !== 'number' || isNaN(params.quantity_kg) || params.quantity_kg <= 0) {
    throw new Error('Transaction quantity must be a positive number greater than 0 kg.');
  }

  // Validation 2: Future Timestamp Protection
  const serverNow = new Date();
  if (params.operational_timestamp.getTime() > serverNow.getTime()) {
    throw new Error('Operational timestamp cannot be in the future.');
  }

  return await prisma.$transaction(async (tx) => {
    // Database Concurrency: Acquire PostgreSQL Row-Level Lock (FOR UPDATE)
    await tx.$executeRaw`SELECT id FROM silo WHERE id = ${siloId} FOR UPDATE`;

    const silo = await tx.silo.findUnique({
      where: { id: siloId },
    });

    if (!silo) {
      throw new Error(`Silo record not found (ID: ${params.silo_id}).`);
    }

    const currentStockLiters = await getSiloCurrentStockLiters(siloId, tx);
    const capacityLiters = Number(silo.capacity_liters);
    const txLiters = params.quantity_liters !== undefined && params.quantity_liters !== null
      ? params.quantity_liters
      : params.quantity_kg / 1.0265;

    // Validation 3: RECEIPT Inactive Check (New milk receipts require active silo)
    if (params.transaction_type === SiloTransactionType.RECEIPT) {
      if (!silo.is_active) {
        throw new Error(`Silo "${silo.silo_name}" (${silo.silo_code}) is INACTIVE. New milk receipts are blocked.`);
      }

      if (currentStockLiters + txLiters > capacityLiters) {
        const available = capacityLiters - currentStockLiters;
        throw new Error(`Receipt quantity (${Math.round(txLiters)} L) exceeds available silo capacity (${Math.round(available)} L).`);
      }
    }

    // Validation 4: ISSUE Check (Allows inactive silo provided existing stock is sufficient)
    if (params.transaction_type === SiloTransactionType.ISSUE) {
      if (currentStockLiters - txLiters < 0) {
        throw new Error(`Issue quantity (${Math.round(txLiters)} L) exceeds current stock balance (${Math.round(currentStockLiters)} L).`);
      }
    }

    // Create Ledger Transaction
    const transaction = await tx.siloInventoryTransaction.create({
      data: {
        silo_id: siloId,
        transaction_type: params.transaction_type,
        quantity_kg: new Prisma.Decimal(params.quantity_kg),
        quantity_liters: new Prisma.Decimal(txLiters),
        operational_timestamp: params.operational_timestamp,
        visit_id: visitId,
        portion_id: portionId,
        reference_type: params.reference_type || null,
        reference_id: params.reference_id || null,
        idempotency_key: params.idempotency_key || null,
        performed_by: performedBy,
        notes: params.notes || null,
      },
    });

    return transaction;
  });
}

export interface RecordSiloIssueParams {
  silo_id: bigint | string;
  quantity_liters: number;
  operational_timestamp: Date;
  performed_by: bigint | string;
  purpose?: string | null;
  flow_meter_reference?: string | null;
  idempotency_key?: string | null;
}

export async function recordSiloIssueTransaction(params: RecordSiloIssueParams) {
  const siloId = typeof params.silo_id === 'string' ? BigInt(params.silo_id) : params.silo_id;
  const performedBy = typeof params.performed_by === 'string' ? BigInt(params.performed_by) : params.performed_by;

  // Validation 1: Positive Quantity
  if (typeof params.quantity_liters !== 'number' || isNaN(params.quantity_liters) || params.quantity_liters <= 0) {
    throw new Error('Issue quantity must be a positive number greater than 0 Liters.');
  }

  // Validation 2: Future Timestamp Protection
  const serverNow = new Date();
  if (params.operational_timestamp.getTime() > serverNow.getTime()) {
    throw new Error('Operational timestamp cannot be in the future.');
  }

  return await prisma.$transaction(async (tx) => {
    // Check idempotency if key provided
    if (params.idempotency_key) {
      const existing = await tx.siloInventoryTransaction.findUnique({
        where: { idempotency_key: params.idempotency_key },
        include: { silo: true },
      });
      if (existing) {
        const currentStock = await getSiloCurrentStockLiters(siloId, tx);
        return {
          transaction: existing,
          stockBefore: currentStock + Number(existing.quantity_liters || 0),
          stockAfter: currentStock,
          alreadyProcessed: true,
        };
      }
    }

    // Database Concurrency: Acquire PostgreSQL Row-Level Lock (FOR UPDATE)
    await tx.$executeRaw`SELECT id FROM silo WHERE id = ${siloId} FOR UPDATE`;

    const silo = await tx.silo.findUnique({
      where: { id: siloId },
    });

    if (!silo) {
      throw new Error(`Silo record not found (ID: ${params.silo_id}).`);
    }

    // Physical stock calculation from ledger (RECEIPTS - ISSUES)
    const currentStockLiters = await getSiloCurrentStockLiters(siloId, tx);

    // Stock sufficiency check (Applies to both Active and Inactive silos!)
    if (params.quantity_liters > currentStockLiters) {
      throw new Error(
        `Requested issue quantity (${Math.round(params.quantity_liters).toLocaleString()} L) exceeds current physical stock (${Math.round(currentStockLiters).toLocaleString()} L) in Silo "${silo.silo_name}".`
      );
    }

    const stockAfterLiters = currentStockLiters - params.quantity_liters;

    // Create immutable SiloInventoryTransaction ISSUE
    const transaction = await tx.siloInventoryTransaction.create({
      data: {
        silo_id: siloId,
        transaction_type: SiloTransactionType.ISSUE,
        quantity_kg: null, // Flow-meter issue stores quantity_liters; zero fake kg invented
        quantity_liters: new Prisma.Decimal(params.quantity_liters),
        operational_timestamp: params.operational_timestamp,
        reference_type: 'PRODUCTION_ISSUE',
        reference_id: params.flow_meter_reference?.trim() || `ISSUE-${Date.now()}`,
        idempotency_key: params.idempotency_key || null,
        performed_by: performedBy,
        notes: params.purpose?.trim() || 'Production Issue',
      },
    });

    // Log Immutable Audit Record
    await tx.auditLog.create({
      data: {
        table_name: 'silo_inventory_transaction',
        record_id: transaction.id,
        action: 'SILO_MILK_ISSUED',
        user_id: performedBy,
        new_values: {
          silo_id: siloId.toString(),
          silo_code: silo.silo_code,
          silo_name: silo.silo_name,
          issue_liters: params.quantity_liters,
          stock_before_liters: currentStockLiters,
          stock_after_liters: stockAfterLiters,
          op_timestamp: params.operational_timestamp.toISOString(),
          submitted_at: serverNow.toISOString(),
          purpose: params.purpose?.trim() || 'Production Issue',
          flow_meter_reference: params.flow_meter_reference?.trim() || null,
        },
      },
    });

    return {
      transaction,
      stockBefore: currentStockLiters,
      stockAfter: stockAfterLiters,
      alreadyProcessed: false,
    };
  });
}
