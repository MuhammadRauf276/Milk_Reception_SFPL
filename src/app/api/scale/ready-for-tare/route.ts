import { NextResponse } from 'next/server';
import { prisma } from '@core/db';
import { requireCapability } from '@/backend/modules/access-control/serverGuard';
import { vehicleVisitPaperIdentity } from '@/backend/modules/paper-references';
import { getErrorMessage } from '@/lib/errors';

const WEIGHBRIDGE_SCOPE = { kind: 'DEPARTMENT', departmentId: 'Production & Weighbridge' } as const;

export async function GET(req: Request) {
  const access = await requireCapability('VIEW', WEIGHBRIDGE_SCOPE, { request: req });
  if (!access.allowed) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: access.status });
  }

  const { searchParams } = new URL(req.url);
  const query = searchParams.get('q')?.trim() || '';

  try {
    const visits = await prisma.vehicleVisit.findMany({
      take: 100, // live queue: bounded page
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

      // Destination Silo Summary
      const acceptedPortions = v.portions.filter((p) => (p.plant_decision || '').toUpperCase() === 'ACCEPTED');
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

      const sortedAccepted = [...acceptedPortions].sort((a, b) => a.portion_number - b.portion_number);
      const isMultiPortion = sortedAccepted.length > 1;
      const isPortionWise = isMultiPortion || v.test_mode === 'PORTION_WISE';
      const activePortion = sortedAccepted.find((p) => p.first_weight_kg !== null && p.second_weight_kg === null) || sortedAccepted[0];
      const activeFirstWeight = activePortion?.first_weight_kg ? Number(activePortion.first_weight_kg) : grossKg;
      const activeSilo = activePortion?.unloading_log?.silo_number || destinationSiloText;
      const completedCount = sortedAccepted.filter((p) => p.second_weight_kg !== null).length;
      const isFinalWeighment = completedCount === sortedAccepted.length - 1;

      // Operational Chronology Bounds
      const activePortionFirstWeightMs = activePortion?.first_weight_at ? new Date(activePortion.first_weight_at).getTime() : grossTimeMs;
      const activeUnloadingEndMs = activePortion?.unloading_log?.pump_end_timestamp
        ? new Date(activePortion.unloading_log.pump_end_timestamp).getTime()
        : null;

      const timestampsToCompare: number[] = [grossTimeMs, activePortionFirstWeightMs];
      if (dispatchTimeMs) timestampsToCompare.push(dispatchTimeMs);
      if (activeUnloadingEndMs) timestampsToCompare.push(activeUnloadingEndMs);

      const minAllowedTimestampMs = Math.max(...timestampsToCompare);
      const minAllowedTimestampIso = new Date(minAllowedTimestampMs).toISOString();

      const waitingMinutes = grossTime
        ? Math.max(0, Math.floor((now.getTime() - new Date(grossTime).getTime()) / 60000))
        : 0;

      const opDateStr = v.operational_date
        ? new Date(v.operational_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
        : new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

      return {
        id: v.id.toString(),
        vehicle_number: v.vehicle_number,
        token_number: v.token_number || null,
        identifiers: vehicleVisitPaperIdentity(v),
        operational_date: opDateStr,
        current_status: v.current_status,
        portion_count: v.portions.length,
        ticket_number: ticket?.ticket_number || null,
        gross_weight_kg: activeFirstWeight,
        gross_timestamp: grossTime,
        gross_recorded_by_name: grossRecorderName,
        min_allowed_timestamp: minAllowedTimestampIso,
        waiting_minutes: waitingMinutes,
        destination_silo_text: isPortionWise ? activeSilo : destinationSiloText,
        is_multi_silo_different: isMultiSiloDifferent,
        test_mode: v.test_mode || 'COMPOSITE',
        is_portion_wise: isPortionWise,
        is_multi_portion: isMultiPortion,
        is_final_weighment: isFinalWeighment,
        active_portion_number: activePortion?.portion_number ?? 1,
        active_portion_first_weight_kg: activeFirstWeight,
        total_accepted_portions: sortedAccepted.length,
        completed_accepted_portions: completedCount,
      };
    });

    return NextResponse.json({ visits: formatted });
  } catch (error) {
    return NextResponse.json({ error: getErrorMessage(error) || 'Failed to fetch visits ready for tare weight' }, { status: 500 });
  }
}
