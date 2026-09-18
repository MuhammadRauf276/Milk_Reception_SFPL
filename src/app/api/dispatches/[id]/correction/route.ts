import { NextResponse } from 'next/server';
import { getCurrentUser } from '@core/auth';
import { prisma } from '@core/db';
import { Prisma, PaperReferenceType } from '@prisma/client';
import { z } from 'zod';
import { PaperReferenceService, PaperValidationError } from '@/backend/services/paperReferenceService';
import { computeCanonicalMilkMetrics, calculateDensity, calculateGrossLiters } from '@/backend/utils/milkFormulas';
import { calculateDualReconciliation } from '@/backend/services/reconciliationService';

const correctDispatchSchema = z.object({
  reason: z.string().trim().min(3, 'A substantive correction reason of at least 3 characters is required.'),
  raw_milk_dispatch_note_number: z.string().nullable().optional(),
  rawMilkDispatchNoteNumber: z.string().nullable().optional(),
  vehicle_dispatch_quantity_value: z.number().positive().optional(),
  vehicle_dispatch_quantity_unit: z.enum(['KG', 'LITER']).optional(),
  vehicle_dispatch_quantity_basis: z.enum(['ESTIMATED', 'MEASURED']).optional(),
  vehicle_dispatch_lr: z.number().positive().optional(),
  vehicle_dispatch_fat: z.number().nonnegative().optional(),
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

    const result = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT id FROM vehicle_visit WHERE id = ${visitId} FOR UPDATE`;

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
          { excludeEntityId: visit.id, tx }
        );

        if (cleanNote !== visit.raw_milk_dispatch_note_number) {
          isNoteChanged = true;
          await tx.vehicleVisit.update({
            where: { id: visit.id },
            data: { raw_milk_dispatch_note_number: cleanNote },
          });

          await tx.auditLog.create({
            data: {
              table_name: 'vehicle_visit',
              record_id: visit.id,
              action: 'RAW_MILK_DISPATCH_NOTE_CORRECTED',
              old_values: { raw_milk_dispatch_note_number: visit.raw_milk_dispatch_note_number },
              new_values: { raw_milk_dispatch_note_number: cleanNote, reason: validated.reason },
              user_id: dbUser.id,
            },
          });
        }
      }

      // Measurement Correction
      const hasQtyVal = validated.vehicle_dispatch_quantity_value !== undefined;
      const hasQtyUnit = validated.vehicle_dispatch_quantity_unit !== undefined;
      const hasQtyBasis = validated.vehicle_dispatch_quantity_basis !== undefined;
      const hasLr = validated.vehicle_dispatch_lr !== undefined;
      const hasFat = validated.vehicle_dispatch_fat !== undefined;

      let isMeasurementChanged = false;

      if (hasQtyVal || hasQtyUnit || hasQtyBasis || hasLr || hasFat) {
        isMeasurementChanged = true;

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

        const oldGross = visit.vehicle_dispatch_gross_liters ? Number(visit.vehicle_dispatch_gross_liters) : null;
        const oldAt13ts = visit.vehicle_dispatch_at_13ts_liters ? Number(visit.vehicle_dispatch_at_13ts_liters) : null;

        await tx.vehicleVisit.update({
          where: { id: visit.id },
          data: {
            vehicle_dispatch_quantity_value: new Prisma.Decimal(effectiveQtyVal),
            vehicle_dispatch_quantity_unit: effectiveQtyUnit,
            vehicle_dispatch_quantity_basis: effectiveQtyBasis,
            vehicle_dispatch_lr: effectiveLr !== null ? new Prisma.Decimal(effectiveLr.toFixed(2)) : null,
            vehicle_dispatch_fat: effectiveFat !== null ? new Prisma.Decimal(effectiveFat.toFixed(2)) : null,
            vehicle_dispatch_density: vehicleDensity !== null ? new Prisma.Decimal(vehicleDensity.toFixed(4)) : null,
            vehicle_dispatch_gross_liters: vehicleGrossLiters !== null ? new Prisma.Decimal(vehicleGrossLiters.toFixed(2)) : null,
            vehicle_dispatch_snf: vehicleSnf !== null ? new Prisma.Decimal(vehicleSnf.toFixed(2)) : null,
            vehicle_dispatch_ts: vehicleTs !== null ? new Prisma.Decimal(vehicleTs.toFixed(2)) : null,
            vehicle_dispatch_at_13ts_liters: vehicleAt13tsLiters !== null ? new Prisma.Decimal(vehicleAt13tsLiters.toFixed(2)) : null,
            vehicle_dispatch_calculation_version: vehicleCalculationVersion,
          },
        });

        // Inventory adjustment for ZMCC tank issue
        if (visit.procurement_source?.source_type === 'ZMCC' && vehicleGrossLiters !== null) {
          const existingIssue = await tx.zmccTankInventoryTransaction.findFirst({
            where: {
              dispatch_id: visit.id,
              reference_type: 'DISPATCH',
            },
          });

          if (existingIssue && oldGross !== null) {
            const deltaGross = vehicleGrossLiters - oldGross;
            const deltaAt13 = (vehicleAt13tsLiters || 0) - (oldAt13ts || 0);

            if (Math.abs(deltaGross) >= 0.01) {
              const absGross = Math.abs(deltaGross);
              const absAt13 = Math.abs(deltaAt13);
              const isIncrease = deltaGross > 0;
              const corrTxType = isIncrease ? 'ADJUSTMENT_OUT' : 'ADJUSTMENT_IN';

              await tx.zmccTankInventoryTransaction.create({
                data: {
                  tank_id: existingIssue.tank_id,
                  zmcc_id: visit.procurement_source_id!,
                  transaction_type: corrTxType,
                  quantity_liters: new Prisma.Decimal(absGross.toFixed(2)),
                  at_13ts_liters: new Prisma.Decimal(absAt13.toFixed(2)),
                  dispatch_id: visit.id,
                  reference_type: 'DISPATCH_CORRECTION',
                  reference_id: visit.id.toString(),
                  idempotency_key: `ZMCC_TANK_DISPATCH_CORRECTION:${visit.id}:${Date.now()}`,
                  operational_timestamp: new Date(),
                  performed_by_user_id: dbUser.id,
                  notes: `Dispatch correction ${corrTxType} for visit ${visit.visit_number} (${deltaGross > 0 ? '+' : '-'}${absGross.toFixed(2)} L)`,
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

        await tx.auditLog.create({
          data: {
            table_name: 'vehicle_visit',
            record_id: visit.id,
            action: 'VEHICLE_DISPATCH_MEASUREMENT_CORRECTED',
            old_values: {
              quantity_value: visit.vehicle_dispatch_quantity_value ? Number(visit.vehicle_dispatch_quantity_value) : null,
              quantity_unit: visit.vehicle_dispatch_quantity_unit,
              lr: visit.vehicle_dispatch_lr ? Number(visit.vehicle_dispatch_lr) : null,
              fat: visit.vehicle_dispatch_fat ? Number(visit.vehicle_dispatch_fat) : null,
              gross_liters: oldGross,
              at_13ts_liters: oldAt13ts,
            },
            new_values: {
              quantity_value: effectiveQtyVal,
              quantity_unit: effectiveQtyUnit,
              lr: effectiveLr,
              fat: effectiveFat,
              gross_liters: vehicleGrossLiters,
              at_13ts_liters: vehicleAt13tsLiters,
              reason: validated.reason,
            },
            user_id: dbUser.id,
          },
        });
      }

      if (!isNoteChanged && !isMeasurementChanged) {
        throw new Error('NO_CHANGES:No changes detected in correction payload.');
      }

      return { success: true };
    });

    return NextResponse.json(result, { status: 200 });
  } catch (err: any) {
    if (err instanceof PaperValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
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
