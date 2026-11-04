import { NextResponse } from 'next/server';
import { prisma } from '@core/db';
import { requireCapability } from '@/backend/modules/access-control/serverGuard';
import { vehicleVisitPaperIdentity } from '@/backend/modules/paper-references';
import { getErrorMessage } from '@/lib/errors';

const WEIGHBRIDGE_SCOPE = { kind: 'DEPARTMENT', departmentId: 'Production & Weighbridge' } as const;

export interface ProgressiveWeighmentStep {
  step_index: number;
  step_number: number;
  label: string;
  stage_type: 'INITIAL_GROSS' | 'INTERMEDIATE_TARE' | 'FINAL_TARE';
  portion_number: number | null;
  destination_silo: string | null;
  starting_weight_kg: number | null;
  recorded_weight_kg: number | null;
  net_weight_kg: number | null;
  total_ticket_net_kg?: number | null;
  timestamp: string | null;
  recorded_by: string | null;
  status: 'COMPLETED' | 'ACTIVE_INPUT' | 'PENDING';
  is_locked: boolean;
  min_allowed_timestamp: string | null;
}

export interface UnifiedWeighbridgeVisit {
  id: string;
  vehicle_number: string;
  token_number: string | null;
  identifiers?: any;
  operational_date: string;
  current_status: string;
  test_mode: string;
  portion_count: number;
  accepted_portion_count: number;
  rejected_portion_count: number;
  rejected_portion_numbers: number[];
  total_weighments: number;
  current_weighment_index: number;
  is_scale_action_needed: boolean;
  active_scale_status: 'READY_FOR_GROSS' | 'READY_FOR_TARE' | 'AT_SILO' | 'COMPLETED' | 'REJECTED_EXIT';
  current_action_label: string;
  active_portion_number: number | null;
  active_portion_first_weight_kg: number | null;
  active_silo_text: string;
  waiting_minutes: number;
  steps: ProgressiveWeighmentStep[];
  // Double-blind anti-fraud: all dispatch numbers strictly null
  vehicle_dispatch_quantity_value: null;
  vehicle_dispatch_quantity_unit: null;
}

export async function GET(req: Request) {
  const access = await requireCapability('VIEW', WEIGHBRIDGE_SCOPE, { request: req });
  if (!access.allowed) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: access.status });
  }

  const { searchParams } = new URL(req.url);
  const query = searchParams.get('q')?.trim() || '';

  try {
    const visits = await prisma.vehicleVisit.findMany({
      take: 100,
      where: {
        current_status: {
          in: ['READY_FOR_GROSS', 'READY_FOR_UNLOADING', 'READY_FOR_TARE', 'TARE_WEIGHED', 'READY_FOR_GATE_EXIT', 'COMPLETED'],
        },
        gate_log: { entry_timestamp: { not: null } },
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
            unloading_log: { include: { silo: true } },
          },
          orderBy: { portion_number: 'asc' },
        },
        gate_log: true,
        qa_session: true,
        weight_ticket: {
          include: {
            gross_recorder: true,
            tare_recorder: true,
          },
        },
      },
      orderBy: [
        { updated_at: 'desc' },
      ],
    });

    const now = new Date();

    const formatted: UnifiedWeighbridgeVisit[] = visits.map((v) => {
      const allPortions = v.portions || [];
      const acceptedPortions = allPortions.filter((p) => (p.plant_decision || '').toUpperCase() === 'ACCEPTED');
      const rejectedPortions = allPortions.filter((p) => (p.plant_decision || '').toUpperCase() === 'REJECTED');
      const N = acceptedPortions.length;
      const M = allPortions.length;
      const R = rejectedPortions.length;
      const isAllRejected = N === 0;

      // Weighment Formula:
      // If N == 0 accepted -> 0 weighments (Bypasses scale entirely, routes directly to GATE EXIT)
      // If N == 1 accepted -> 2 weighments (W0 Gross + W1 Final Tare)
      // If N == 2 accepted -> 3 weighments (W0 Gross + W1 Intermediate Tare + W2 Final Tare)
      // If N == k accepted -> k + 1 weighments (W0 Gross + k Tares)
      const totalWeighments = isAllRejected ? 0 : N + 1;

      const ticket = v.weight_ticket;
      const grossKg = ticket?.gross_weight_kg ? Number(ticket.gross_weight_kg) : null;
      const tareKg = ticket?.tare_weight_kg ? Number(ticket.tare_weight_kg) : null;
      const grossTime = ticket?.gross_timestamp ? ticket.gross_timestamp.toISOString() : null;
      const grossWeigher = ticket?.gross_recorder?.full_name || ticket?.gross_recorder?.username || 'Weighbridge Operator';
      const tareTime = ticket?.tare_timestamp ? ticket.tare_timestamp.toISOString() : null;
      const tareWeigher = ticket?.tare_recorder?.full_name || ticket?.tare_recorder?.username || 'Weighbridge Operator';

      const entryTime = v.gate_log?.entry_timestamp ? new Date(v.gate_log.entry_timestamp) : now;
      // Same lower bound as /api/scale/gross-weight: the latest of dispatch, gate entry and QA completion.
      const firstDispatchTs = v.portions.find((p) => p.dispatch_info?.dispatch_timestamp)?.dispatch_info?.dispatch_timestamp;
      const qaCompletedTs = v.qa_session?.completed_at ?? v.qa_session?.updated_at;
      const grossMinAllowedMs = Math.max(
        entryTime.getTime(),
        firstDispatchTs ? new Date(firstDispatchTs).getTime() : 0,
        qaCompletedTs ? new Date(qaCompletedTs).getTime() : 0
      );
      const waitingMinutes = Math.max(0, Math.floor((now.getTime() - entryTime.getTime()) / 60000));

      const opDateStr = v.operational_date
        ? new Date(v.operational_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
        : new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

      // Identify currently active portion in tare cycle
      const activeTarePortion = acceptedPortions.find(
        (p) => p.first_weight_kg !== null && p.second_weight_kg === null
      ) || acceptedPortions[0];

      // Build the Progressive Steps Stepper Array (0 to N)
      const steps: ProgressiveWeighmentStep[] = [];

      if (!isAllRejected) {
        // Step 0: Initial Loaded Gross (W0)
        const isGrossRecorded = grossKg !== null;
        const isGrossCurrent = v.current_status === 'READY_FOR_GROSS';
        steps.push({
          step_index: 0,
          step_number: 1,
          label: 'Initial Loaded Gross (W0)',
          stage_type: 'INITIAL_GROSS',
          portion_number: null,
          destination_silo: null,
          starting_weight_kg: null,
          recorded_weight_kg: grossKg,
          net_weight_kg: null,
          timestamp: grossTime,
          recorded_by: grossWeigher,
          status: isGrossRecorded ? 'COMPLETED' : isGrossCurrent ? 'ACTIVE_INPUT' : 'PENDING',
          is_locked: isGrossRecorded,
          min_allowed_timestamp: new Date(grossMinAllowedMs).toISOString(),
        });

        // Steps 1 to N: Intermediate Tares & Final Tare for Accepted Compartments
        for (let i = 0; i < N; i++) {
          const portion = acceptedPortions[i];
          const stepIndex = i + 1;
          const isFinal = stepIndex === N;
          const portionSecondKg = portion.second_weight_kg ? Number(portion.second_weight_kg) : (isFinal && tareKg ? tareKg : null);
          const portionFirstKg = portion.first_weight_kg ? Number(portion.first_weight_kg) : grossKg;
          const portionNetKg = portion.net_weight_kg ? Number(portion.net_weight_kg) : (portionSecondKg && portionFirstKg ? portionFirstKg - portionSecondKg : null);
          const siloText = portion.unloading_log?.silo?.silo_code || portion.unloading_log?.silo_number || 'Silo';

          const isPortionRecorded = portionSecondKg !== null;
          const isPortionActive =
            v.current_status === 'READY_FOR_TARE' &&
            activeTarePortion &&
            activeTarePortion.id === portion.id;

          const portionPumpEnd = portion.unloading_log?.pump_end_timestamp
            ? new Date(portion.unloading_log.pump_end_timestamp).toISOString()
            : grossTime;

          steps.push({
            step_index: stepIndex,
            step_number: stepIndex + 1,
            label: isFinal
              ? `Final Empty Tare (W${N})`
              : `Tare After Compartment #${portion.portion_number} (W${stepIndex})`,
            stage_type: isFinal ? 'FINAL_TARE' : 'INTERMEDIATE_TARE',
            portion_number: portion.portion_number,
            destination_silo: siloText,
            starting_weight_kg: portionFirstKg,
            recorded_weight_kg: portionSecondKg,
            net_weight_kg: portionNetKg,
            total_ticket_net_kg: isFinal && ticket?.net_weight_kg ? Number(ticket.net_weight_kg) : null,
            timestamp: isFinal && tareTime ? tareTime : portion.second_weight_at ? portion.second_weight_at.toISOString() : null,
            recorded_by: isFinal ? tareWeigher : null,
            status: isPortionRecorded ? 'COMPLETED' : isPortionActive ? 'ACTIVE_INPUT' : 'PENDING',
            is_locked: isPortionRecorded,
            min_allowed_timestamp: portionPumpEnd,
          });
        }
      }

      // Determine vehicle overall scale state
      let active_scale_status: 'READY_FOR_GROSS' | 'READY_FOR_TARE' | 'AT_SILO' | 'COMPLETED' | 'REJECTED_EXIT' = 'AT_SILO';
      let is_scale_action_needed = false;
      let current_action_label = '';
      let current_weighment_index = 0;

      if (isAllRejected) {
        // N = 0: 100% Rejected by QA, strictly bypasses scale and unloading, direct to Gate Exit
        active_scale_status = 'REJECTED_EXIT';
        is_scale_action_needed = false;
        current_weighment_index = 0;
        current_action_label = `0 of ${M} Portions Accepted (All Rejected) · Bypassed Weighbridge · Route to Gate Exit`;
      } else if (v.current_status === 'READY_FOR_GROSS') {
        active_scale_status = 'READY_FOR_GROSS';
        is_scale_action_needed = true;
        current_weighment_index = 1;
        current_action_label = `Weighment 1 of ${totalWeighments} · Initial Loaded Gross (W0)`;
      } else if (v.current_status === 'READY_FOR_TARE') {
        active_scale_status = 'READY_FOR_TARE';
        is_scale_action_needed = true;
        const activeIdx = steps.findIndex((s) => s.status === 'ACTIVE_INPUT');
        current_weighment_index = activeIdx >= 0 ? activeIdx + 1 : totalWeighments;
        const activeStep = steps[activeIdx >= 0 ? activeIdx : steps.length - 1];
        current_action_label = `Weighment ${current_weighment_index} of ${totalWeighments} · ${activeStep?.label || 'Scale Reading'}`;
      } else if (v.current_status === 'READY_FOR_UNLOADING') {
        active_scale_status = 'AT_SILO';
        is_scale_action_needed = false;
        const nextPortionNum = activeTarePortion?.portion_number || 1;
        current_action_label = `Currently Offloading Compartment #${nextPortionNum} at Silo`;
      } else {
        active_scale_status = 'COMPLETED';
        is_scale_action_needed = false;
        current_action_label = `All ${totalWeighments} Weighments Completed`;
      }

      const activeSiloText = activeTarePortion?.unloading_log?.silo?.silo_code || activeTarePortion?.unloading_log?.silo_number || 'Silo';

      return {
        id: v.id.toString(),
        vehicle_number: v.vehicle_number,
        token_number: v.token_number || null,
        identifiers: vehicleVisitPaperIdentity(v),
        operational_date: opDateStr,
        current_status: v.current_status,
        test_mode: v.test_mode || 'COMPOSITE',
        portion_count: allPortions.length,
        accepted_portion_count: N,
        rejected_portion_count: R,
        rejected_portion_numbers: rejectedPortions.map((p) => p.portion_number),
        total_weighments: totalWeighments,
        current_weighment_index,
        is_scale_action_needed,
        active_scale_status,
        current_action_label,
        active_portion_number: activeTarePortion?.portion_number || null,
        active_portion_first_weight_kg: activeTarePortion?.first_weight_kg ? Number(activeTarePortion.first_weight_kg) : grossKg,
        active_silo_text: activeSiloText,
        waiting_minutes: waitingMinutes,
        steps,
        vehicle_dispatch_quantity_value: null,
        vehicle_dispatch_quantity_unit: null,
      };
    });

    return NextResponse.json({ visits: formatted });
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error) || 'Failed to fetch unified weighbridge queue' },
      { status: 500 }
    );
  }
}
