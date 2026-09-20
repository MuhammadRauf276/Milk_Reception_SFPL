import { NextResponse } from 'next/server';
import { getCurrentUser } from '@core/auth';
import { prisma } from '@core/db';
import { Prisma, PaperReferenceType } from '@prisma/client';
import { z } from 'zod';
import { PaperReferenceService, PaperValidationError } from '@/backend/services/paperReferenceService';
import { computeCanonicalMilkMetrics, calculateDensity, calculateGrossLiters } from '@/backend/utils/milkFormulas';
import { calculateDualReconciliation } from '@/backend/services/reconciliationService';
import { getTankPhysicalStock } from '@/backend/services/zmccTankService';

const correctDispatchSchema = z.object({
  reason: z.string().trim().min(3, 'A substantive correction reason of at least 3 characters is required.'),
  raw_milk_dispatch_note_number: z.string().nullable().optional(),
  rawMilkDispatchNoteNumber: z.string().nullable().optional(),
  vehicle_dispatch_quantity_value: z.number().positive().optional(),
  vehicle_dispatch_quantity_unit: z.enum(['KG', 'LITER']).optional(),
  vehicle_dispatch_quantity_basis: z.enum(['ESTIMATED', 'MEASURED']).optional(),
  vehicle_dispatch_lr: z.number().positive().optional(),
  vehicle_dispatch_fat: z.number().nonnegative().optional(),
  idempotency_key: z.string().trim().min(1).optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authUser = await getCurrentUser(req);
  if (!authUser) {
    return NextResponse.json({ error: 'Unauthorized. Authentication required.' }, { status: 401 });
  }

  const dbUser = await prisma.user.findFirst({
    where: {
      OR: [{ username: authUser.username }, { id: BigInt(authUser.id) }],
      is_active: true,
    },
    include: { procurement_source: true },
  });

  const allowedRoles = ['ZMCC_MANAGER', 'SUPER_ADMIN'];
  if (!dbUser || !allowedRoles.includes(dbUser.role)) {
    return NextResponse.json(
      { error: 'Unauthorized. ZMCC Manager or Super Admin role required for dispatch corrections.' },
      { status: 403 }
    );
  }

  const resolvedParams = await params;
  const dispatchIdStr = resolvedParams.id;

  let visitId: bigint;
  try {
    visitId = BigInt(dispatchIdStr);
  } catch {
    return NextResponse.json({ error: 'Invalid dispatch visit ID format.' }, { status: 400 });
  }

  try {
    const body = await req.json();
    const validated = correctDispatchSchema.parse(body);

    const clientKey = validated.idempotency_key || req.headers.get('Idempotency-Key') || req.headers.get('idempotency-key') || null;

    if (validated.vehicle_dispatch_quantity_basis === 'ESTIMATED') {
      return NextResponse.json(
        { error: 'Whole-vehicle dispatch quantity basis must remain MEASURED and cannot be changed to ESTIMATED.' },
        { status: 400 }
      );
    }

    if (clientKey) {
      const pastAudits = await prisma.auditLog.findMany({
        where: {
          table_name: 'vehicle_visit',
          record_id: visitId,
        },
        orderBy: { created_at: 'desc' },
        take: 30,
      });

      const matching = pastAudits.find(
        (a) => (a.new_values as any)?.idempotency_key === clientKey
      );

      if (matching) {
        const rec = matching.new_values as any;
        const notePayload = validated.raw_milk_dispatch_note_number !== undefined
          ? validated.raw_milk_dispatch_note_number
          : validated.rawMilkDispatchNoteNumber;

        const isMatch =
          rec.reason === validated.reason &&
          (notePayload === undefined || rec.raw_milk_dispatch_note_number === (notePayload ? notePayload.trim() : null)) &&
          (validated.vehicle_dispatch_quantity_value === undefined || rec.quantity_value === validated.vehicle_dispatch_quantity_value) &&
          (validated.vehicle_dispatch_quantity_unit === undefined || rec.quantity_unit === validated.vehicle_dispatch_quantity_unit) &&
          (validated.vehicle_dispatch_lr === undefined || rec.lr === validated.vehicle_dispatch_lr) &&
          (validated.vehicle_dispatch_fat === undefined || rec.fat === validated.vehicle_dispatch_fat);

        if (isMatch) {
          return NextResponse.json({ success: true, replayed: true }, { status: 200 });
        } else {
          return NextResponse.json(
            { error: 'Idempotency conflict: idempotency key already used with different payload.' },
            { status: 409 }
          );
        }
      }
    }

    const result = await prisma.$transaction(async (tx) => {
      const lockedRows = await tx.$queryRaw<{ id: bigint; correction_count: number; manager_correction_count: number }[]>`
        SELECT id, correction_count, manager_correction_count FROM vehicle_visit WHERE id = ${visitId} FOR UPDATE
      `;
      if (!lockedRows || lockedRows.length === 0) {
        throw new Error('NOT_FOUND:Dispatch visit not found.');
      }
      const currentTotalCount = lockedRows[0].correction_count ?? 0;
      const currentManagerCount = lockedRows[0].manager_correction_count ?? 0;

      if (dbUser.role !== 'SUPER_ADMIN' && currentManagerCount >= 5) {
        throw new Error('MAX_CORRECTIONS_REACHED:Maximum correction limit (5) reached for ZMCC Manager.');
      }

      const visit = await tx.vehicleVisit.findUnique({
        where: { id: visitId },
        include: {
          procurement_source: true,
          portions: true,
        },
      });

      if (!visit) {
        throw new Error('NOT_FOUND:Dispatch visit not found.');
      }

      if (dbUser.role === 'ZMCC_MANAGER') {
        if (!dbUser.procurement_source_id || dbUser.procurement_source_id !== visit.procurement_source_id) {
          throw new Error('FORBIDDEN:ZMCC Manager can only correct dispatches for their own ZMCC.');
        }
      }

      const noteInput = validated.raw_milk_dispatch_note_number !== undefined
        ? validated.raw_milk_dispatch_note_number
        : validated.rawMilkDispatchNoteNumber;

      let isNoteChanged = false;
      let cleanNote: string | null = null;

      if (noteInput !== undefined) {
        cleanNote = await PaperReferenceService.validateAndVerify(
          PaperReferenceType.RAW_MILK_DISPATCH_NOTE,
          noteInput,
          { scopeEntityId: visit.procurement_source_id || undefined, excludeEntityId: visit.id, tx }
        );

        if (cleanNote !== visit.raw_milk_dispatch_note_number) {
          isNoteChanged = true;
        }
      }

      // Measurement Correction
      const hasQtyVal = validated.vehicle_dispatch_quantity_value !== undefined;
      const hasQtyUnit = validated.vehicle_dispatch_quantity_unit !== undefined;
      const hasQtyBasis = validated.vehicle_dispatch_quantity_basis !== undefined;
      const hasLr = validated.vehicle_dispatch_lr !== undefined;
      const hasFat = validated.vehicle_dispatch_fat !== undefined;

      let isMeasurementChanged = false;

      if (hasQtyVal && Number(validated.vehicle_dispatch_quantity_value) !== (visit.vehicle_dispatch_quantity_value ? Number(visit.vehicle_dispatch_quantity_value) : null)) {
        isMeasurementChanged = true;
      }
      if (hasQtyUnit && validated.vehicle_dispatch_quantity_unit !== (visit.vehicle_dispatch_quantity_unit ? visit.vehicle_dispatch_quantity_unit.toString() : null)) {
        isMeasurementChanged = true;
      }
      if (hasQtyBasis && validated.vehicle_dispatch_quantity_basis !== (visit.vehicle_dispatch_quantity_basis ? visit.vehicle_dispatch_quantity_basis.toString() : null)) {
        isMeasurementChanged = true;
      }
      if (hasLr && Number(validated.vehicle_dispatch_lr) !== (visit.vehicle_dispatch_lr ? Number(visit.vehicle_dispatch_lr) : null)) {
        isMeasurementChanged = true;
      }
      if (hasFat && Number(validated.vehicle_dispatch_fat) !== (visit.vehicle_dispatch_fat ? Number(visit.vehicle_dispatch_fat) : null)) {
        isMeasurementChanged = true;
      }

      if (!isNoteChanged && !isMeasurementChanged) {
        throw new Error('NO_CHANGES:No changes detected in correction payload.');
      }

      const effectiveQtyVal = hasQtyVal
        ? validated.vehicle_dispatch_quantity_value!
        : (visit.vehicle_dispatch_quantity_value ? Number(visit.vehicle_dispatch_quantity_value) : 0);

      const effectiveQtyUnit = hasQtyUnit
        ? validated.vehicle_dispatch_quantity_unit!
        : (visit.vehicle_dispatch_quantity_unit as 'KG' | 'LITER' || 'LITER');

      const effectiveQtyBasis = hasQtyBasis
        ? validated.vehicle_dispatch_quantity_basis!
        : (visit.vehicle_dispatch_quantity_basis as 'ESTIMATED' | 'MEASURED' || 'MEASURED');

      const effectiveLr = hasLr
        ? validated.vehicle_dispatch_lr!
        : (visit.vehicle_dispatch_lr ? Number(visit.vehicle_dispatch_lr) : null);

      const effectiveFat = hasFat
        ? validated.vehicle_dispatch_fat!
        : (visit.vehicle_dispatch_fat ? Number(visit.vehicle_dispatch_fat) : null);

      let vehicleDensity: number | null = null;
      let vehicleGrossLiters: number | null = null;
      let vehicleSnf: number | null = null;
      let vehicleTs: number | null = null;
      let vehicleAt13tsLiters: number | null = null;
      let vehicleCalculationVersion: string | null = null;

      if (isMeasurementChanged) {
        if (effectiveQtyUnit === 'LITER') {
          vehicleGrossLiters = Number(effectiveQtyVal.toFixed(2));
          if (effectiveLr !== null) {
            vehicleDensity = Number(calculateDensity(effectiveLr).toFixed(4));
          }
        } else if (effectiveQtyUnit === 'KG') {
          if (effectiveLr !== null) {
            vehicleDensity = Number(calculateDensity(effectiveLr).toFixed(4));
            const rawGross = calculateGrossLiters(effectiveQtyVal, 'KG', effectiveLr);
            if (rawGross !== null) {
              vehicleGrossLiters = Number(rawGross.toFixed(2));
            }
          }
        }

        if (effectiveLr !== null && effectiveFat !== null && vehicleGrossLiters !== null && vehicleGrossLiters > 0) {
          const canonical = computeCanonicalMilkMetrics(
            effectiveQtyVal,
            effectiveQtyUnit,
            effectiveLr,
            effectiveFat
          );
          vehicleDensity = canonical.density;
          vehicleGrossLiters = canonical.grossLiters;
          vehicleSnf = canonical.snf;
          vehicleTs = canonical.ts;
          vehicleAt13tsLiters = canonical.at13tsLiters;
          vehicleCalculationVersion = canonical.calculationVersion;
        }
      }

      const oldGross = visit.vehicle_dispatch_gross_liters ? Number(visit.vehicle_dispatch_gross_liters) : null;
      const oldAt13ts = visit.vehicle_dispatch_at_13ts_liters ? Number(visit.vehicle_dispatch_at_13ts_liters) : null;

      if (isMeasurementChanged) {
        // Inventory adjustment for ZMCC tank issue (Item G)
        if (visit.procurement_source?.source_type === 'ZMCC' && vehicleGrossLiters !== null) {
          const existingIssue = await tx.zmccTankInventoryTransaction.findFirst({
            where: {
              dispatch_id: visit.id,
              reference_type: 'DISPATCH',
            },
          });

          if (existingIssue && oldGross !== null) {
            const deltaGross = Number((vehicleGrossLiters - oldGross).toFixed(2));
            const deltaAt13 = Number(((vehicleAt13tsLiters || 0) - (oldAt13ts || 0)).toFixed(2));

            const hasPhysicalDelta = Math.abs(deltaGross) >= 0.01;
            const hasCommercialDelta = Math.abs(deltaAt13) >= 0.01;

            if (hasPhysicalDelta) {
              const lockedTankRows: Array<{ id: bigint; capacity_liters: any }> = await tx.$queryRaw`
                SELECT id, capacity_liters FROM zmcc_tank WHERE id = ${existingIssue.tank_id} FOR UPDATE
              `;
              if (!lockedTankRows || lockedTankRows.length === 0) {
                throw new Error('TANK_NOT_FOUND:Destination tank not found.');
              }
              const tankCap = Number(lockedTankRows[0].capacity_liters);
              const currentStock = await getTankPhysicalStock(existingIssue.tank_id, tx);

              if (deltaGross > 0) {
                if (currentStock < deltaGross) {
                  throw new Error(`NEGATIVE_STOCK:Dispatch correction would result in negative tank stock. Current: ${currentStock} L; deduction: ${deltaGross} L.`);
                }
              } else if (deltaGross < 0) {
                const absGross = Math.abs(deltaGross);
                const available = Math.max(0, tankCap - currentStock);
                if (absGross > available) {
                  throw new Error(`INSUFFICIENT_CAPACITY:Tank capacity is insufficient for correction return. Available: ${available} L; required: ${absGross} L.`);
                }
              }

              const priorCorrCount = await tx.auditLog.count({
                where: {
                  table_name: 'vehicle_visit',
                  record_id: visit.id,
                  action: { in: ['VEHICLE_DISPATCH_CORRECTED', 'VEHICLE_DISPATCH_MEASUREMENT_CORRECTED', 'RAW_MILK_DISPATCH_NOTE_CORRECTED'] },
                },
              });
              const newCorrSeq = priorCorrCount + 1;

              const baseTxKey = clientKey
                ? `ZMCC_TANK_DISPATCH_CORRECTION:${visit.id}:${clientKey}`
                : `ZMCC_TANK_DISPATCH_CORRECTION:${visit.id}:CORR:${newCorrSeq}`;

              const physicalDirection = deltaGross > 0 ? 'ADJUSTMENT_OUT' : 'ADJUSTMENT_IN';
              await tx.zmccTankInventoryTransaction.create({
                data: {
                  tank_id: existingIssue.tank_id,
                  zmcc_id: visit.procurement_source_id!,
                  transaction_type: physicalDirection,
                  quantity_liters: new Prisma.Decimal(Math.abs(deltaGross).toFixed(2)),
                  at_13ts_liters: hasCommercialDelta ? new Prisma.Decimal(Math.abs(deltaAt13).toFixed(2)) : new Prisma.Decimal('0.00'),
                  dispatch_id: visit.id,
                  reference_type: 'DISPATCH_CORRECTION',
                  reference_id: `${visit.id}:${newCorrSeq}:PHYSICAL`,
                  idempotency_key: `${baseTxKey}:PHYSICAL`,
                  operational_timestamp: new Date(),
                  performed_by_user_id: dbUser.id,
                  notes: `Dispatch correction physical ${physicalDirection} for visit ${visit.visit_number} (${deltaGross > 0 ? '+' : ''}${deltaGross} L${hasCommercialDelta ? `, @13: ${deltaAt13 > 0 ? '+' : ''}${deltaAt13} L` : ''})`,
                },
              });
            }
          }
        }

        // Recompute PlantFinalDualReconciliation if reconciliation exists
        const existingRecon = await tx.plantFinalDualReconciliation.findUnique({
          where: { visit_id: visit.id },
        });

        if (existingRecon) {
          const dualRecon = calculateDualReconciliation({
            sentGrossLiters: vehicleGrossLiters,
            receivedGrossLiters: Number(existingRecon.received_gross_liters),
            sentAt13tsLiters: vehicleAt13tsLiters,
            receivedAt13tsLiters: Number(existingRecon.received_at_13ts_liters),
          });

          await tx.plantFinalDualReconciliation.update({
            where: { id: existingRecon.id },
            data: {
              sent_gross_liters: dualRecon.sentGrossLiters !== null ? new Prisma.Decimal(dualRecon.sentGrossLiters) : null,
              gross_variance_liters: dualRecon.grossVarianceLiters !== null ? new Prisma.Decimal(dualRecon.grossVarianceLiters) : null,
              gross_variance_percent: dualRecon.grossVariancePercent !== null ? new Prisma.Decimal(dualRecon.grossVariancePercent) : null,
              sent_at_13ts_liters: dualRecon.sentAt13tsLiters !== null ? new Prisma.Decimal(dualRecon.sentAt13tsLiters) : null,
              at_13ts_variance_liters: dualRecon.at13tsVarianceLiters !== null ? new Prisma.Decimal(dualRecon.at13tsVarianceLiters) : null,
              at_13ts_variance_percent: dualRecon.at13tsVariancePercent !== null ? new Prisma.Decimal(dualRecon.at13tsVariancePercent) : null,
              reconciliation_calculation_version: dualRecon.reconciliationCalculationVersion,
              reconciled_at: new Date(),
            },
          });
        }
      }

      const nextCorrectionCount = currentTotalCount + 1;
      const nextManagerCount = dbUser.role === 'SUPER_ADMIN' ? currentManagerCount : currentManagerCount + 1;
      const nowTs = new Date();

      const visitUpdateData: Prisma.VehicleVisitUncheckedUpdateInput = {
        correction_count: nextCorrectionCount,
        manager_correction_count: nextManagerCount,
        last_corrected_by_user_id: dbUser.id,
        last_corrected_at: nowTs,
      };

      if (isNoteChanged) {
        visitUpdateData.raw_milk_dispatch_note_number = cleanNote;
      }

      if (isMeasurementChanged) {
        visitUpdateData.vehicle_dispatch_quantity_value = new Prisma.Decimal(effectiveQtyVal);
        visitUpdateData.vehicle_dispatch_quantity_unit = effectiveQtyUnit;
        visitUpdateData.vehicle_dispatch_quantity_basis = effectiveQtyBasis;
        visitUpdateData.vehicle_dispatch_lr = effectiveLr !== null ? new Prisma.Decimal(effectiveLr.toFixed(2)) : null;
        visitUpdateData.vehicle_dispatch_fat = effectiveFat !== null ? new Prisma.Decimal(effectiveFat.toFixed(2)) : null;
        visitUpdateData.vehicle_dispatch_density = vehicleDensity !== null ? new Prisma.Decimal(vehicleDensity.toFixed(4)) : null;
        visitUpdateData.vehicle_dispatch_gross_liters = vehicleGrossLiters !== null ? new Prisma.Decimal(vehicleGrossLiters.toFixed(2)) : null;
        visitUpdateData.vehicle_dispatch_snf = vehicleSnf !== null ? new Prisma.Decimal(vehicleSnf.toFixed(2)) : null;
        visitUpdateData.vehicle_dispatch_ts = vehicleTs !== null ? new Prisma.Decimal(vehicleTs.toFixed(2)) : null;
        visitUpdateData.vehicle_dispatch_at_13ts_liters = vehicleAt13tsLiters !== null ? new Prisma.Decimal(vehicleAt13tsLiters.toFixed(2)) : null;
        visitUpdateData.vehicle_dispatch_calculation_version = vehicleCalculationVersion;
      }

      await tx.vehicleVisit.update({
        where: { id: visit.id },
        data: visitUpdateData,
      });

      const oldAuditValues: Record<string, any> = {
        correction_count: currentTotalCount,
        manager_correction_count: currentManagerCount,
      };
      const newAuditValues: Record<string, any> = {
        correction_count: nextCorrectionCount,
        manager_correction_count: nextManagerCount,
        reason: validated.reason,
        idempotency_key: clientKey,
      };

      if (isNoteChanged) {
        oldAuditValues.raw_milk_dispatch_note_number = visit.raw_milk_dispatch_note_number;
        newAuditValues.raw_milk_dispatch_note_number = cleanNote;
      }

      if (isMeasurementChanged) {
        oldAuditValues.quantity_value = visit.vehicle_dispatch_quantity_value ? Number(visit.vehicle_dispatch_quantity_value) : null;
        oldAuditValues.quantity_unit = visit.vehicle_dispatch_quantity_unit;
        oldAuditValues.lr = visit.vehicle_dispatch_lr ? Number(visit.vehicle_dispatch_lr) : null;
        oldAuditValues.fat = visit.vehicle_dispatch_fat ? Number(visit.vehicle_dispatch_fat) : null;
        oldAuditValues.gross_liters = oldGross;
        oldAuditValues.at_13ts_liters = oldAt13ts;

        newAuditValues.quantity_value = effectiveQtyVal;
        newAuditValues.quantity_unit = effectiveQtyUnit;
        newAuditValues.lr = effectiveLr;
        newAuditValues.fat = effectiveFat;
        newAuditValues.gross_liters = vehicleGrossLiters;
        newAuditValues.at_13ts_liters = vehicleAt13tsLiters;
      }

      await tx.auditLog.create({
        data: {
          table_name: 'vehicle_visit',
          record_id: visit.id,
          action: 'VEHICLE_DISPATCH_CORRECTED',
          old_values: oldAuditValues,
          new_values: newAuditValues,
          user_id: dbUser.id,
        },
      });

      return { success: true };
    });

    return NextResponse.json(result, { status: 200 });
  } catch (err: any) {
    if (err instanceof PaperValidationError) {
      if (err.message.includes('already in use') || err.message.includes('duplicate')) {
        return NextResponse.json({ error: err.message }, { status: 409 });
      }
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return NextResponse.json({ error: 'Conflict: Duplicate paper reference number already in use.' }, { status: 409 });
    }
    if (err.code === 'P2002') {
      return NextResponse.json({ error: 'Conflict: Duplicate paper reference number already in use.' }, { status: 409 });
    }
    if (err.message?.startsWith('MAX_CORRECTIONS_REACHED:')) {
      return NextResponse.json({ error: err.message.replace('MAX_CORRECTIONS_REACHED:', '') }, { status: 400 });
    }
    if (err.message?.startsWith('NOT_FOUND:')) {
      return NextResponse.json({ error: err.message.replace('NOT_FOUND:', '') }, { status: 404 });
    }
    if (err.message?.startsWith('FORBIDDEN:')) {
      return NextResponse.json({ error: err.message.replace('FORBIDDEN:', '') }, { status: 403 });
    }
    if (err.message?.startsWith('NO_CHANGES:')) {
      return NextResponse.json({ error: err.message.replace('NO_CHANGES:', '') }, { status: 400 });
    }
    if (err.message?.startsWith('NEGATIVE_STOCK:')) {
      return NextResponse.json({ error: err.message.replace('NEGATIVE_STOCK:', '') }, { status: 400 });
    }
    if (err.message?.startsWith('INSUFFICIENT_CAPACITY:')) {
      return NextResponse.json({ error: err.message.replace('INSUFFICIENT_CAPACITY:', '') }, { status: 400 });
    }
    if (err.name === 'ZodError') {
      return NextResponse.json({ error: err.issues?.[0]?.message || 'Validation error' }, { status: 400 });
    }
    console.error('PATCH /api/dispatches/[id]/correction error:', err);
    return NextResponse.json({ error: err.message || 'Failed to correct dispatch.' }, { status: 500 });
  }
}

export async function POST(
  req: Request,
  props: { params: Promise<{ id: string }> }
) {
  return PATCH(req, props);
}
