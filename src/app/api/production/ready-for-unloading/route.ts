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

      let totalAcceptedKg = 0;
      let totalAcceptedPhysicalLiters = 0;
      let totalAcceptedAt13TSLiters = 0;

      const formattedPortions = v.portions.map((p) => {
        const declaredKg = p.declared_quantity_kg ? Number(p.declared_quantity_kg) : 0;
        const isAccepted = p.plant_decision === 'ACCEPTED';

        // Extract LR and Fat values (Plant QA primary, Dispatch fallback)
        const plantLr = p.plant_lab_results.find(
          (r) => r.lab_test.testCode === 'LT-000008' || r.lab_test.testCode === 'LT-000027' || r.lab_test.testName.toUpperCase().includes('LR')
        );
        const dispatchLr = p.dispatch_lab_results.find(
          (r) => r.lab_test.testCode === 'LT-000008' || r.lab_test.testCode === 'LT-000027' || r.lab_test.testName.toUpperCase().includes('LR')
        );
        const lrVal = plantLr?.numeric_value ? Number(plantLr.numeric_value) : dispatchLr?.numeric_value ? Number(dispatchLr.numeric_value) : 26.5;

        const plantFat = p.plant_lab_results.find(
          (r) => r.lab_test.testCode === 'LT-000026' || r.lab_test.testName.toUpperCase().includes('FAT')
        );
        const dispatchFat = p.dispatch_lab_results.find(
          (r) => r.lab_test.testCode === 'LT-000026' || r.lab_test.testName.toUpperCase().includes('FAT')
        );
        const fatVal = plantFat?.numeric_value ? Number(plantFat.numeric_value) : dispatchFat?.numeric_value ? Number(dispatchFat.numeric_value) : 3.8;

        const snfVal = calculateSNF(lrVal, fatVal);
        const tsVal = calculateTS(fatVal, snfVal);
        const ratioVal = calculateRatio(snfVal, fatVal);
        const physicalLiters = calculatePhysicalLiters(declaredKg, lrVal);
        const at13TSLiters = calculateAt13TSLiters(physicalLiters, tsVal);

        if (isAccepted) {
          totalAcceptedKg += declaredKg;
          totalAcceptedPhysicalLiters += physicalLiters;
          totalAcceptedAt13TSLiters += at13TSLiters;
        }

        return {
          id: String(p.id),
          portion_number: p.portion_number,
          declared_quantity_kg: declaredKg,
          plant_decision: p.plant_decision || 'PENDING',
          plant_rejection_reason: p.plant_rejection_reason || null,
          current_status: p.current_status,
          lr: lrVal,
          fat: fatVal,
          snf: Math.round(snfVal * 1000) / 1000,
          ts: Math.round(tsVal * 1000) / 1000,
          snf_fat_ratio: Math.round(ratioVal * 1000) / 1000,
          expected_physical_liters: Math.round(physicalLiters),
          expected_at13_ts_liters: Math.round(at13TSLiters),
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
        total_accepted_kg: totalAcceptedKg,
        total_accepted_physical_liters: Math.round(totalAcceptedPhysicalLiters),
        total_accepted_at13_ts_liters: Math.round(totalAcceptedAt13TSLiters),
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
