import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@core/db';
import { getCurrentUser } from '@core/auth';
import {
  getSiloCurrentStockLiters,
  getSiloActiveReservedLiters,
  getSiloProvisionalAvailableCapacity,
} from '@/backend/services/siloInventoryService';
import {
  calculateSNF,
  calculateTS,
  calculateRatio,
  calculatePhysicalLiters,
  calculateAt13TSLiters,
} from '@/backend/utils/milkFormulas';
import { isPlantLrTest, isPlantFatTest } from '@/backend/services/vehicleQuantityService';

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const search = searchParams.get('search')?.trim().toUpperCase() || '';

    // Fetch visits in READY_FOR_UNLOADING status with Scale 1 gross weight recorded
    const visits = await prisma.vehicleVisit.findMany({
      where: {
        current_status: 'READY_FOR_UNLOADING',
        weight_ticket: {
          gross_weight_kg: { not: null },
        },
        portions: {
          some: {
            plant_decision: 'ACCEPTED',
          },
        },
        ...(search
          ? {
              OR: [
                { visit_number: { contains: search, mode: 'insensitive' } },
                { vehicle_number: { contains: search, mode: 'insensitive' } },
                { token_number: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      include: {
        portions: {
          include: {
            unloading_log: {
              include: { silo: true },
            },
            plant_lab_results: {
              include: { lab_test: true },
            },
            dispatch_lab_results: {
              include: { lab_test: true },
            },
          },
          orderBy: { portion_number: 'asc' },
        },
        weight_ticket: true,
        gate_log: true,
      },
      orderBy: [
        { weight_ticket: { gross_timestamp: 'asc' } },
        { created_at: 'asc' },
      ],
    });

    // Format ready visits for operator workspace
    const formattedVisits = visits.map((v) => {
      const acceptedPortions = v.portions.filter((p) => p.plant_decision === 'ACCEPTED');
      const rejectedPortions = v.portions.filter((p) => p.plant_decision === 'REJECTED');

      let allAcceptedHavePhysicalLiters = acceptedPortions.length > 0;
      let totalAcceptedPhysicalLiters = 0;
      let allAcceptedHaveAt13TS = acceptedPortions.length > 0;
      let totalAcceptedAt13TSLiters = 0;

      const formattedPortions = v.portions.map((p) => {
        const dispatchQuantityValue = p.dispatch_quantity_value !== null && p.dispatch_quantity_value !== undefined ? Number(p.dispatch_quantity_value) : null;
        const dispatchQuantityUnit = p.dispatch_quantity_unit ? p.dispatch_quantity_unit.toUpperCase() : null;
        const isAccepted = p.plant_decision === 'ACCEPTED';

        // Extract Plant LR (genuine PERFORMED only, no Dispatch or fake fallback)
        const performedPlantLr = p.plant_lab_results.filter(
          (r) => isPlantLrTest(r.lab_test.testCode, r.lab_test.testName) && r.performance_status === 'PERFORMED' && r.numeric_value !== null
        );
        const plantLrVal = performedPlantLr.length === 1 && Number(performedPlantLr[0].numeric_value) > 0 ? Number(performedPlantLr[0].numeric_value) : null;

        // Extract Plant Fat (genuine PERFORMED only, no Dispatch or fake fallback)
        const performedPlantFat = p.plant_lab_results.filter(
          (r) => isPlantFatTest(r.lab_test.testCode, r.lab_test.testName) && r.performance_status === 'PERFORMED' && r.numeric_value !== null
        );
        const plantFatVal = performedPlantFat.length === 1 && Number(performedPlantFat[0].numeric_value) >= 0 ? Number(performedPlantFat[0].numeric_value) : null;

        // Calculate provisional physical volume
        let provisionalPhysicalLiters: number | null = null;
        if (isAccepted && dispatchQuantityValue !== null && dispatchQuantityValue > 0) {
          if (dispatchQuantityUnit === 'LITER') {
            provisionalPhysicalLiters = dispatchQuantityValue;
          } else if (dispatchQuantityUnit === 'KG') {
            // KG requires valid performed Plant LR
            if (plantLrVal !== null) {
              provisionalPhysicalLiters = calculatePhysicalLiters(dispatchQuantityValue, plantLrVal);
            }
          }
        }

        // Calculate derived quality metrics
        let snfVal: number | null = null;
        let tsVal: number | null = null;
        let ratioVal: number | null = null;
        let at13TSLiters: number | null = null;

        if (plantLrVal !== null && plantFatVal !== null) {
          snfVal = calculateSNF(plantLrVal, plantFatVal);
          tsVal = calculateTS(plantFatVal, snfVal);
          ratioVal = calculateRatio(snfVal, plantFatVal);
          if (provisionalPhysicalLiters !== null) {
            at13TSLiters = calculateAt13TSLiters(provisionalPhysicalLiters, tsVal);
          }
        }

        if (isAccepted) {
          if (provisionalPhysicalLiters !== null) {
            totalAcceptedPhysicalLiters += provisionalPhysicalLiters;
          } else {
            allAcceptedHavePhysicalLiters = false;
          }

          if (at13TSLiters !== null) {
            totalAcceptedAt13TSLiters += at13TSLiters;
          } else {
            allAcceptedHaveAt13TS = false;
          }
        }

        return {
          id: String(p.id),
          portion_number: p.portion_number,
          dispatch_quantity_value: dispatchQuantityValue,
          dispatch_quantity_unit: dispatchQuantityUnit,
          dispatch_quantity_basis: p.dispatch_quantity_basis || null,
          dispatch_measurement_method: p.dispatch_measurement_method || null,
          plant_decision: p.plant_decision || 'PENDING',
          plant_rejection_reason: p.plant_rejection_reason || null,
          current_status: p.current_status,
          lr: plantLrVal,
          fat: plantFatVal,
          snf: snfVal !== null ? Math.round(snfVal * 1000) / 1000 : null,
          ts: tsVal !== null ? Math.round(tsVal * 1000) / 1000 : null,
          snf_fat_ratio: ratioVal !== null ? Math.round(ratioVal * 1000) / 1000 : null,
          expected_physical_liters: provisionalPhysicalLiters !== null ? Math.round(provisionalPhysicalLiters) : null,
          expected_at13_ts_liters: at13TSLiters !== null ? Math.round(at13TSLiters) : null,
          unloading_log: p.unloading_log
            ? {
                id: String(p.unloading_log.id),
                silo_id: p.unloading_log.silo_id ? String(p.unloading_log.silo_id) : null,
                silo_number: p.unloading_log.silo_number,
                pump_start_timestamp: p.unloading_log.pump_start_timestamp
                  ? p.unloading_log.pump_start_timestamp.toISOString()
                  : null,
                pump_end_timestamp: p.unloading_log.pump_end_timestamp
                  ? p.unloading_log.pump_end_timestamp.toISOString()
                  : null,
              }
            : null,
        };
      });

      // Unit-safe dispatch total across accepted portions
      let totalAcceptedDispatchValue: number | null = null;
      let totalAcceptedDispatchUnit: string | null = null;

      if (acceptedPortions.length > 0) {
        let allValid = true;
        let runningSum = 0;
        let singleUnit: string | null = null;
        const acceptedUnits = new Set<string>();

        for (const p of acceptedPortions) {
          const val = p.dispatch_quantity_value !== null && p.dispatch_quantity_value !== undefined ? Number(p.dispatch_quantity_value) : null;
          const unit = typeof p.dispatch_quantity_unit === 'string' ? p.dispatch_quantity_unit.trim().toUpperCase() : null;

          if (unit) acceptedUnits.add(unit);

          if (val === null || isNaN(val) || !isFinite(val) || val <= 0) {
            allValid = false;
          }
          if (unit !== 'KG' && unit !== 'LITER') {
            allValid = false;
          }
          if (singleUnit === null) {
            singleUnit = unit;
          } else if (singleUnit !== unit) {
            allValid = false;
          }

          if (val !== null && !isNaN(val)) {
            runningSum += val;
          }
        }

        if (allValid && singleUnit !== null) {
          totalAcceptedDispatchValue = runningSum;
          totalAcceptedDispatchUnit = singleUnit;
        } else {
          totalAcceptedDispatchValue = null;
          totalAcceptedDispatchUnit = acceptedUnits.size > 1 ? 'MIXED' : null;
        }
      }

      // Calculate waiting minutes from Gross timestamp or Entry timestamp
      const refTime = v.weight_ticket?.gross_timestamp || v.gate_log?.entry_timestamp || v.created_at;
      const waitingMinutes = Math.max(0, Math.floor((Date.now() - refTime.getTime()) / 60000));

      return {
        id: String(v.id),
        visit_number: v.visit_number,
        vehicle_number: v.vehicle_number,
        token_number: v.token_number,
        current_status: v.current_status,
        gross_weight_kg: v.weight_ticket?.gross_weight_kg ? Number(v.weight_ticket.gross_weight_kg) : null,
        gross_timestamp: v.weight_ticket?.gross_timestamp ? v.weight_ticket.gross_timestamp.toISOString() : null,
        portion_count: v.portions.length,
        accepted_portion_count: acceptedPortions.length,
        rejected_portion_count: rejectedPortions.length,
        vehicle_dispatch_quantity_value: v.vehicle_dispatch_quantity_value !== null && v.vehicle_dispatch_quantity_value !== undefined
          ? Number(v.vehicle_dispatch_quantity_value)
          : null,
        vehicle_dispatch_quantity_unit: v.vehicle_dispatch_quantity_unit || null,
        vehicle_dispatch_quantity_basis: v.vehicle_dispatch_quantity_basis || null,
        vehicle_dispatch_measurement_method: v.vehicle_dispatch_measurement_method || null,
        total_accepted_dispatch_value: totalAcceptedDispatchValue,
        total_accepted_dispatch_unit: totalAcceptedDispatchUnit,
        total_accepted_physical_liters: allAcceptedHavePhysicalLiters ? Math.round(totalAcceptedPhysicalLiters) : null,
        total_accepted_at13_ts_liters: allAcceptedHaveAt13TS ? Math.round(totalAcceptedAt13TSLiters) : null,
        waiting_minutes: waitingMinutes,
        portions: formattedPortions,
      };
    });

    // Fetch all Silos with capacity & stock calculations (Active & Inactive)
    const allSilosInDb = await prisma.silo.findMany({
      orderBy: { silo_code: 'asc' },
    });

    const activeSilos = await Promise.all(
      allSilosInDb.map(async (silo) => {
        const capacity = Number(silo.capacity_liters);
        const currentStock = await getSiloCurrentStockLiters(silo.id);
        const activeReservedLiters = await getSiloActiveReservedLiters(silo.id);
        const provisionalAvailable = await getSiloProvisionalAvailableCapacity(silo.id);

        return {
          id: String(silo.id),
          silo_code: silo.silo_code,
          silo_name: silo.silo_name,
          capacity_liters: capacity,
          current_stock_liters: Math.round(currentStock),
          active_reserved_liters: Math.round(activeReservedLiters),
          provisional_available_liters: Math.round(provisionalAvailable),
          is_active: silo.is_active,
        };
      })
    );

    return NextResponse.json({ visits: formattedVisits, silos: activeSilos });
  } catch (err: any) {
    console.error('Error fetching ready-for-unloading visits:', err);
    return NextResponse.json({ error: 'Failed to fetch vehicles ready for unloading' }, { status: 500 });
  }
}
