import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@core/db';
import { getCurrentUser } from '@core/auth';
import {
  calculateSNF,
  calculateTS,
  calculateRatio,
  calculatePhysicalLiters,
  calculateAt13TSLiters,
} from '@/backend/utils/milkFormulas';
import { isPlantLrTest, isPlantFatTest } from '@/backend/services/vehicleQuantityService';
import { aggregateAcceptedPortionQuantities } from '@/lib/portion-quantity-aggregator';
import { vehicleVisitPaperIdentity } from '@/backend/modules/paper-references';

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const search = searchParams.get('search')?.trim().toUpperCase() || '';

    // Fetch visits in UNLOADING status
    const visits = await prisma.vehicleVisit.findMany({
      take: 100, // live queue: bounded page
      where: {
        current_status: 'UNLOADING',
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
              include: {
                silo: true,
                starter: true,
              },
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
      },
      orderBy: { created_at: 'asc' },
    });

    const formattedVisits = visits.map((v) => {
      const acceptedPortions = v.portions.filter((p) => p.plant_decision === 'ACCEPTED');
      const rejectedPortions = v.portions.filter((p) => p.plant_decision === 'REJECTED');

      let allAcceptedHavePhysicalLiters = acceptedPortions.length > 0;
      let totalAcceptedPhysicalLiters = 0;
      let allAcceptedHaveAt13TS = acceptedPortions.length > 0;
      let totalAcceptedAt13TSLiters = 0;
      let earliestStartTime: Date | null = null;
      let starterName: string | null = null;

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

        if (p.unloading_log?.pump_start_timestamp) {
          const pStartTime = p.unloading_log.pump_start_timestamp;
          if (!earliestStartTime || pStartTime < earliestStartTime) {
            earliestStartTime = pStartTime;
          }
          if (!starterName && p.unloading_log.starter) {
            starterName = p.unloading_log.starter.full_name || p.unloading_log.starter.username;
          }
        }

        return {
          id: String(p.id),
          portion_number: p.portion_number,
          dispatch_quantity_value: dispatchQuantityValue,
          dispatch_quantity_unit: dispatchQuantityUnit,
          dispatch_quantity_basis: p.dispatch_quantity_basis || null,
          plant_decision: p.plant_decision || 'PENDING',
          plant_rejection_reason: p.plant_rejection_reason || null,
          current_status: p.current_status,
          first_weight_kg: p.first_weight_kg !== null && p.first_weight_kg !== undefined ? Number(p.first_weight_kg) : null,
          first_weight_at: p.first_weight_at ? p.first_weight_at.toISOString() : null,
          second_weight_kg: p.second_weight_kg !== null && p.second_weight_kg !== undefined ? Number(p.second_weight_kg) : null,
          second_weight_at: p.second_weight_at ? p.second_weight_at.toISOString() : null,
          net_weight_kg: p.net_weight_kg !== null && p.net_weight_kg !== undefined ? Number(p.net_weight_kg) : null,
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
                silo_code: p.unloading_log.silo?.silo_code || p.unloading_log.silo_number || 'SILO',
                silo_name: p.unloading_log.silo?.silo_name || null,
                pump_start_timestamp: p.unloading_log.pump_start_timestamp
                  ? p.unloading_log.pump_start_timestamp.toISOString()
                  : null,
                started_by_name: p.unloading_log.starter
                  ? p.unloading_log.starter.full_name || p.unloading_log.starter.username
                  : null,
              }
            : null,
        };
      });

      // Unit-safe dispatch total across accepted portions via shared production helper
      const { totalAcceptedDispatchValue, totalAcceptedDispatchUnit } =
        aggregateAcceptedPortionQuantities(acceptedPortions);

      const isMultiPortion = acceptedPortions.length > 1;
      const isPortionWise = isMultiPortion || v.test_mode === 'PORTION_WISE';
      const sortedAccepted = [...acceptedPortions].sort((a, b) => a.portion_number - b.portion_number);
      const activePortion = isPortionWise
        ? sortedAccepted.find((p) => p.current_status === 'UNLOADING' || (p.unloading_log?.pump_start_timestamp && !p.unloading_log?.pump_end_timestamp)) || sortedAccepted[0]
        : null;

      const elapsedMinutes = earliestStartTime
        ? Math.max(0, Math.floor((Date.now() - (earliestStartTime as Date).getTime()) / 60000))
        : 0;

      return {
        id: String(v.id),
        visit_number: v.visit_number,
        vehicle_number: v.vehicle_number,
        token_number: v.token_number,
        identifiers: vehicleVisitPaperIdentity(v),
        current_status: v.current_status,
        gross_weight_kg: v.weight_ticket?.gross_weight_kg ? Number(v.weight_ticket.gross_weight_kg) : null,
        portion_count: v.portions.length,
        accepted_portion_count: acceptedPortions.length,
        rejected_portion_count: rejectedPortions.length,
        // Double-Blind Operator Entry: Mask dispatch values and expected liters from Production Operator
        vehicle_dispatch_quantity_value: null,
        vehicle_dispatch_quantity_unit: null,
        vehicle_dispatch_quantity_basis: null,
        total_accepted_dispatch_value: null,
        total_accepted_dispatch_unit: null,
        total_accepted_physical_liters: null,
        total_accepted_at13_ts_liters: null,
        started_at: earliestStartTime ? (earliestStartTime as Date).toISOString() : null,
        started_by_name: starterName || 'Operator',
        elapsed_minutes: elapsedMinutes,
        test_mode: v.test_mode || 'COMPOSITE',
        is_portion_wise: isPortionWise,
        active_portion_number: activePortion?.portion_number ?? (sortedAccepted[0]?.portion_number ?? 1),
        portions: formattedPortions.map((p) => ({
          ...p,
          dispatch_quantity_value: null,
          dispatch_quantity_unit: null,
          provisional_physical_liters: null,
          expected_physical_liters: null,
          expected_at_13ts_liters: null,
        })),
      };
    });

    return NextResponse.json({ visits: formattedVisits });
  } catch (err) {
    console.error('Error fetching unloading visits:', err);
    return NextResponse.json({ error: 'Failed to fetch ongoing unloading visits' }, { status: 500 });
  }
}
