import { NextResponse } from 'next/server';
import { getCurrentUser } from '@core/auth';
import { prisma } from '@core/db';

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const query = searchParams.get('q')?.trim() || '';

  try {
    const visits = await prisma.vehicleVisit.findMany({
      where: {
        current_status: 'READY_FOR_TARE',
        ...(query
          ? {
              OR: [
                { vehicle_number: { contains: query, mode: 'insensitive' } },
                { token_number: { contains: query, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      include: {
        portions: {
          include: {
            dispatch_info: true,
            unloading_log: true,
            plant_lab_results: { include: { lab_test: true } },
          },
        },
        gate_log: true,
        weight_ticket: {
          include: {
            gross_recorder: true,
          },
        },
      },
      orderBy: {
        weight_ticket: {
          gross_timestamp: 'asc',
        },
      },
    });

    const eligibleVisits = visits.filter(
      (v) => v.weight_ticket && v.weight_ticket.gross_weight_kg !== null && v.weight_ticket.tare_weight_kg === null
    );

    const formatted = eligibleVisits.map((v) => {
      const ticket = v.weight_ticket;
      const grossKg = ticket?.gross_weight_kg ? Number(ticket.gross_weight_kg) : 0;
      const grossTime = ticket?.gross_timestamp ? ticket.gross_timestamp.toISOString() : null;
      const grossRecorderName = ticket?.gross_recorder?.full_name || ticket?.gross_recorder?.username || 'Weighbridge Operator';
      
      const now = new Date();
      const grossTimeMs = grossTime ? new Date(grossTime).getTime() : now.getTime();
      const firstDispatchInfo = v.portions.find((p) => p.dispatch_info)?.dispatch_info;
      const dispatchTimeMs = firstDispatchInfo?.dispatch_timestamp ? new Date(firstDispatchInfo.dispatch_timestamp).getTime() : null;
      const firstUnloading = v.portions.find((p) => p.unloading_log)?.unloading_log;
      const unloadingCompletedTimeMs = firstUnloading?.pump_end_timestamp ? new Date(firstUnloading.pump_end_timestamp).getTime() : null;

      const timestampsToCompare: number[] = [grossTimeMs];
      if (dispatchTimeMs) timestampsToCompare.push(dispatchTimeMs);
      if (unloadingCompletedTimeMs) timestampsToCompare.push(unloadingCompletedTimeMs);

      const minAllowedTimestampMs = Math.max(...timestampsToCompare);
      const minAllowedTimestampIso = new Date(minAllowedTimestampMs).toISOString();

      const waitingMinutes = grossTime
        ? Math.max(0, Math.floor((now.getTime() - new Date(grossTime).getTime()) / 60000))
        : 0;

      const opDateStr = v.operational_date
        ? new Date(v.operational_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
        : new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

      // Destination Silo Summary
      const acceptedPortions = v.portions.filter((p) => p.plant_decision === 'ACCEPTED');
      const siloCodesSet = new Set<string>();
      for (const p of acceptedPortions) {
        if (p.unloading_log?.silo_number) {
          siloCodesSet.add(p.unloading_log.silo_number);
        }
      }

      const uniqueSiloCodes = Array.from(siloCodesSet);
      let destinationSiloText = 'Not Assigned';
      let isMultiSiloDifferent = false;

      if (uniqueSiloCodes.length === 1) {
        destinationSiloText = uniqueSiloCodes[0];
      } else if (uniqueSiloCodes.length > 1) {
        destinationSiloText = 'Multiple Silos';
        isMultiSiloDifferent = true;
      }

      // STRICT Authoritative Plant LR Only (No Dispatch LR, No 26.5 fallback!)
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

      return {
        id: v.id.toString(),
        vehicle_number: v.vehicle_number,
        token_number: v.token_number || null,
        operational_date: opDateStr,
        current_status: v.current_status,
        portion_count: v.portions.length,
        ticket_number: ticket?.ticket_number || null,
        gross_weight_kg: grossKg,
        gross_timestamp: grossTime,
        gross_recorded_by_name: grossRecorderName,
        min_allowed_timestamp: minAllowedTimestampIso,
        waiting_minutes: waitingMinutes,
        destination_silo_text: destinationSiloText,
        is_multi_silo_different: isMultiSiloDifferent,
        has_plant_lr: plantLrVal !== null,
        plant_lr: plantLrVal,
      };
    });

    return NextResponse.json({ visits: formatted });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Failed to fetch visits ready for tare weight' }, { status: 500 });
  }
}
