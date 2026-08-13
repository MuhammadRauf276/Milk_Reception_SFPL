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

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const search = searchParams.get('search')?.trim().toUpperCase() || '';

    // Fetch visits in UNLOADING status
    const visits = await prisma.vehicleVisit.findMany({
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

      let totalAcceptedKg = 0;
      let totalAcceptedPhysicalLiters = 0;
      let totalAcceptedAt13TSLiters = 0;
      let earliestStartTime: Date | null = null;
      let starterName: string | null = null;

      const formattedPortions = v.portions.map((p) => {
        const declaredKg = p.declared_quantity_kg ? Number(p.declared_quantity_kg) : 0;
        const isAccepted = p.plant_decision === 'ACCEPTED';

        // Extract LR and Fat values
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
        const physicalLiters = calculatePhysicalLiters(declaredKg, lrVal);
        const at13TSLiters = calculateAt13TSLiters(physicalLiters, tsVal);

        if (isAccepted) {
          totalAcceptedKg += declaredKg;
          totalAcceptedPhysicalLiters += physicalLiters;
          totalAcceptedAt13TSLiters += at13TSLiters;
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
          declared_quantity_kg: declaredKg,
          plant_decision: p.plant_decision || 'PENDING',
          plant_rejection_reason: p.plant_rejection_reason || null,
          current_status: p.current_status,
          lr: lrVal,
          fat: fatVal,
          expected_physical_liters: Math.round(physicalLiters),
          expected_at13_ts_liters: Math.round(at13TSLiters),
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

      const elapsedMinutes = earliestStartTime
        ? Math.max(0, Math.floor((Date.now() - (earliestStartTime as Date).getTime()) / 60000))
        : 0;

      return {
        id: String(v.id),
        visit_number: v.visit_number,
        vehicle_number: v.vehicle_number,
        token_number: v.token_number,
        current_status: v.current_status,
        gross_weight_kg: v.weight_ticket?.gross_weight_kg ? Number(v.weight_ticket.gross_weight_kg) : null,
        portion_count: v.portions.length,
        accepted_portion_count: acceptedPortions.length,
        rejected_portion_count: rejectedPortions.length,
        total_accepted_kg: totalAcceptedKg,
        total_accepted_physical_liters: Math.round(totalAcceptedPhysicalLiters),
        total_accepted_at13_ts_liters: Math.round(totalAcceptedAt13TSLiters),
        started_at: earliestStartTime ? (earliestStartTime as Date).toISOString() : null,
        started_by_name: starterName || 'Operator',
        elapsed_minutes: elapsedMinutes,
        portions: formattedPortions,
      };
    });

    return NextResponse.json({ visits: formattedVisits });
  } catch (err: any) {
    console.error('Error fetching unloading visits:', err);
    return NextResponse.json({ error: 'Failed to fetch ongoing unloading visits' }, { status: 500 });
  }
}
