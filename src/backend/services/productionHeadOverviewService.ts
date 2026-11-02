import { prisma } from '@core/db';
import { getOperationalBusinessDate, getPakistanCalendarDate, PLANT_TIMEZONE } from '../core/business-day';
import { getSiloStockSummary } from './siloInventoryService';
import { calculateAt13TSLiters } from '../utils/milkFormulas';
import type { User } from '../core/types';

export interface ProductionHeadKpis {
  totalIntake13TsLitersToday: number;
  totalIntakeGrossLitersToday: number;
  totalIntakeNetKgToday: number;
  activeVehiclesInPlant: number;
  weighbridgeTicketsToday: number;
  unloadingPortionsToday: number;
  totalSiloCapacityLiters: number;
  currentSiloStock13TsLiters: number;
  siloUtilizationPercent: number;
}

export interface ActivePumpingDetail {
  vehicleNumber: string;
  tokenNumber: string | null;
  bayNumber: string;
  siloNumber: string;
  portionNumber: number;
  pumpStartTimestamp: string;
  elapsedMinutes: number;
  startedByName: string;
}

export interface ProductionHeadSubordinateStations {
  weighbridge: {
    operationalStatus: 'ONLINE' | 'BUSY' | 'IDLE';
    activeOperators: string[];
    currentlyOnScale: {
      vehicleNumber: string;
      tokenNumber: string | null;
      stepType: 'GROSS' | 'TARE';
      waitingMinutes: number;
    } | null;
    waitingForGrossCount: number;
    waitingForTareCount: number;
    completedTodayCount: number;
    avgWeighmentMinutes: number;
  };
  reception: {
    operationalStatus: 'ACTIVE' | 'IDLE';
    activeOperators: string[];
    activeBaysCount: number;
    activePumpings: ActivePumpingDetail[];
    waitingForUnloadingCount: number;
    completedPortionsToday: number;
    avgUnloadingMinutes: number;
  };
}

export interface SubordinateWorkHistoryItem {
  id: string;
  station: 'WEIGHBRIDGE' | 'RECEPTION';
  action: 'GROSS_WEIGHMENT' | 'TARE_WEIGHMENT' | 'PUMP_STARTED' | 'UNLOAD_COMPLETED';
  actionLabel: string;
  timestamp: string;
  vehicleNumber: string;
  tokenNumber: string | null;
  operatorName: string;
  operatorUsername: string;
  operatorRole: string;
  details: {
    ticketNumber?: string;
    portionNumber?: number;
    siloNumber?: string;
    grossWeightKg?: number;
    tareWeightKg?: number;
    netWeightKg?: number;
    volumeLiters?: number;
    volumeAt13TsLiters?: number;
    compositeTsPercent?: number;
    durationMinutes?: number;
  };
}

export interface ProductionHeadSiloState {
  id: string;
  silo_code: string;
  silo_name: string;
  capacity_liters: number;
  current_stock_liters: number;
  current_stock_at_13ts: number | null;
  composite_ts_percent: number | null;
  status: 'RECEIVING' | 'STORAGE' | 'CIP' | 'MAINTENANCE' | 'EMPTY';
  activePumpingVehicle: string | null;
  utilizationPercent: number;
}

export interface ProductionHeadOverviewResult {
  businessDate: string;
  calendarDate: string;
  kpis: ProductionHeadKpis;
  teamStations: ProductionHeadSubordinateStations;
  subordinateWorkHistory: SubordinateWorkHistoryItem[];
  silos: ProductionHeadSiloState[];
}

export async function getProductionHeadOverview(
  dateFilter?: string | null,
  stationFilter?: 'ALL' | 'WEIGHBRIDGE' | 'RECEPTION' | null
): Promise<ProductionHeadOverviewResult> {
  const now = new Date();
  const businessDate = dateFilter || getOperationalBusinessDate(now);
  const calendarDate = getPakistanCalendarDate(now);

  // Business day start/end approximate window for today's shifts (or 24h around date)
  const [bYear, bMonth, bDay] = businessDate.split('-').map(Number);
  const shiftStartUtc = new Date(Date.UTC(bYear, bMonth - 1, bDay, 3, 0, 0, 0)); // 08:00 AM PKT is 03:00 AM UTC
  const shiftEndUtc = new Date(Date.UTC(bYear, bMonth - 1, bDay + 1, 3, 0, 0, 0));

  // 1. Fetch active vehicles in plant (Gate Entry entered, not exited)
  const activeInPlantVisits = await prisma.vehicleVisit.findMany({
    where: {
      gate_log: {
        entry_timestamp: { not: null },
        exit_timestamp: null,
      },
    },
    select: {
      id: true,
      vehicle_number: true,
      token_number: true,
      current_status: true,
      operational_date: true,
      gate_log: {
        select: {
          entry_timestamp: true,
        },
      },
      weight_ticket: {
        select: {
          gross_weight_kg: true,
          gross_timestamp: true,
          tare_weight_kg: true,
          tare_timestamp: true,
        },
      },
      portions: {
        select: {
          id: true,
          portion_number: true,
          current_status: true,
          plant_decision: true,
          unloading_log: {
            select: {
              silo_number: true,
              silo_id: true,
              pump_start_timestamp: true,
              pump_end_timestamp: true,
              starter: { select: { full_name: true, username: true } },
            },
          },
        },
      },
    },
  });

  const activeVehiclesCount = activeInPlantVisits.length;

  // 2. Weighbridge Live Station Metrics
  let waitingForGrossCount = 0;
  let waitingForTareCount = 0;
  let currentlyOnScale: ProductionHeadSubordinateStations['weighbridge']['currentlyOnScale'] = null;

  for (const v of activeInPlantVisits) {
    const hasGross = v.weight_ticket?.gross_weight_kg !== null && v.weight_ticket?.gross_weight_kg !== undefined;
    const hasTare = v.weight_ticket?.tare_weight_kg !== null && v.weight_ticket?.tare_weight_kg !== undefined;

    if (v.current_status === 'READY_FOR_GROSS' || (!hasGross && v.current_status !== 'DISPATCHED')) {
      waitingForGrossCount++;
      if (!currentlyOnScale && v.current_status === 'READY_FOR_GROSS') {
        const entryTime = v.gate_log?.entry_timestamp ? new Date(v.gate_log.entry_timestamp).getTime() : now.getTime();
        const waitMins = Math.max(0, Math.round((now.getTime() - entryTime) / 60000));
        currentlyOnScale = {
          vehicleNumber: v.vehicle_number,
          tokenNumber: v.token_number,
          stepType: 'GROSS',
          waitingMinutes: Math.min(120, waitMins),
        };
      }
    } else if (v.current_status === 'READY_FOR_TARE' || (hasGross && !hasTare && v.current_status === 'READY_FOR_GATE_EXIT')) {
      waitingForTareCount++;
      if (!currentlyOnScale && v.current_status === 'READY_FOR_TARE') {
        const grossTime = v.weight_ticket?.gross_timestamp ? new Date(v.weight_ticket.gross_timestamp).getTime() : now.getTime();
        const waitMins = Math.max(0, Math.round((now.getTime() - grossTime) / 60000));
        currentlyOnScale = {
          vehicleNumber: v.vehicle_number,
          tokenNumber: v.token_number,
          stepType: 'TARE',
          waitingMinutes: Math.min(120, waitMins),
        };
      }
    }
  }

  // 3. Reception Live Station Metrics
  let waitingForUnloadingCount = 0;
  const activePumpings: ActivePumpingDetail[] = [];

  for (const v of activeInPlantVisits) {
    if (v.current_status === 'READY_FOR_UNLOADING') {
      waitingForUnloadingCount++;
    }
    for (const p of v.portions) {
      if (p.unloading_log?.pump_start_timestamp && !p.unloading_log.pump_end_timestamp) {
        const startTime = new Date(p.unloading_log.pump_start_timestamp).getTime();
        activePumpings.push({
          vehicleNumber: v.vehicle_number,
          tokenNumber: v.token_number,
          bayNumber: `Bay ${p.portion_number}`,
          siloNumber: p.unloading_log.silo_number || 'Silo',
          portionNumber: p.portion_number,
          pumpStartTimestamp: new Date(p.unloading_log.pump_start_timestamp).toISOString(),
          elapsedMinutes: Math.max(0, Math.round((now.getTime() - startTime) / 60000)),
          startedByName: p.unloading_log.starter?.full_name || p.unloading_log.starter?.username || 'Operator',
        });
      }
    }
  }

  // 4. Subordinate Tickets & History within shift
  const [completedTicketsToday, completedUnloadsToday] = await Promise.all([
    prisma.weightTicket.findMany({
      where: {
        OR: [
          { gross_submitted_at: { gte: shiftStartUtc, lte: shiftEndUtc } },
          { tare_submitted_at: { gte: shiftStartUtc, lte: shiftEndUtc } },
          { updated_at: { gte: shiftStartUtc, lte: shiftEndUtc } },
        ],
      },
      include: {
        visit: {
          select: {
            vehicle_number: true,
            token_number: true,
            operational_date: true,
          },
        },
        gross_recorder: { select: { full_name: true, username: true, role: true } },
        tare_recorder: { select: { full_name: true, username: true, role: true } },
      },
      orderBy: { updated_at: 'desc' },
      take: 60,
    }),
    prisma.unloadingLog.findMany({
      where: {
        OR: [
          { pump_start_timestamp: { gte: shiftStartUtc, lte: shiftEndUtc } },
          { pump_end_timestamp: { gte: shiftStartUtc, lte: shiftEndUtc } },
          { complete_submitted_at: { gte: shiftStartUtc, lte: shiftEndUtc } },
        ],
      },
      include: {
        portion: {
          include: {
            visit: {
              select: {
                vehicle_number: true,
                token_number: true,
              },
            },
            inventory_transactions: {
              where: { transaction_type: 'RECEIPT' },
              select: {
                quantity_liters: true,
                plant_final_at_13ts_liters: true,
                plant_ts: true,
              },
              take: 1,
            },
          },
        },
        starter: { select: { full_name: true, username: true, role: true } },
        completer: { select: { full_name: true, username: true, role: true } },
        silo: { select: { silo_code: true, silo_name: true } },
      },
      orderBy: { updated_at: 'desc' },
      take: 60,
    }),
  ]);

  // Aggregate Active Operators
  const weighbridgeOperatorsSet = new Set<string>();
  let totalWeighmentMinutesSum = 0;
  let weighmentCount = 0;

  for (const t of completedTicketsToday) {
    if (t.gross_recorder?.full_name) weighbridgeOperatorsSet.add(t.gross_recorder.full_name);
    if (t.tare_recorder?.full_name) weighbridgeOperatorsSet.add(t.tare_recorder.full_name);
    if (t.gross_timestamp && t.tare_timestamp) {
      const gMs = new Date(t.gross_timestamp).getTime();
      const tMs = new Date(t.tare_timestamp).getTime();
      if (tMs > gMs) {
        totalWeighmentMinutesSum += (tMs - gMs) / 60000;
        weighmentCount++;
      }
    }
  }

  const receptionOperatorsSet = new Set<string>();
  let totalPumpingMinutesSum = 0;
  let pumpingCount = 0;

  for (const u of completedUnloadsToday) {
    if (u.starter?.full_name) receptionOperatorsSet.add(u.starter.full_name);
    if (u.completer?.full_name) receptionOperatorsSet.add(u.completer.full_name);
    if (u.pump_start_timestamp && u.pump_end_timestamp) {
      const sMs = new Date(u.pump_start_timestamp).getTime();
      const eMs = new Date(u.pump_end_timestamp).getTime();
      if (eMs > sMs) {
        totalPumpingMinutesSum += (eMs - sMs) / 60000;
        pumpingCount++;
      }
    }
  }

  // 5. Build Subordinate Work History Feed
  const workHistory: SubordinateWorkHistoryItem[] = [];

  // Add Weighbridge events
  for (const t of completedTicketsToday) {
    if (stationFilter === 'RECEPTION') continue;

    if (t.gross_timestamp && t.gross_weight_kg) {
      workHistory.push({
        id: `wb-gross-${t.id.toString()}`,
        station: 'WEIGHBRIDGE',
        action: 'GROSS_WEIGHMENT',
        actionLabel: 'Gross Weighed (Scale 1)',
        timestamp: new Date(t.gross_timestamp).toISOString(),
        vehicleNumber: t.visit?.vehicle_number || 'N/A',
        tokenNumber: t.visit?.token_number || null,
        operatorName: t.gross_recorder?.full_name || t.gross_recorder?.username || 'Weighbridge Operator',
        operatorUsername: t.gross_recorder?.username || 'weighbridge',
        operatorRole: t.gross_recorded_as_role || 'WEIGHBRIDGE_OPERATOR',
        details: {
          ticketNumber: t.ticket_number,
          grossWeightKg: Number(t.gross_weight_kg),
        },
      });
    }

    if (t.tare_timestamp && t.tare_weight_kg) {
      workHistory.push({
        id: `wb-tare-${t.id.toString()}`,
        station: 'WEIGHBRIDGE',
        action: 'TARE_WEIGHMENT',
        actionLabel: 'Tare Weighed (Net Done)',
        timestamp: new Date(t.tare_timestamp).toISOString(),
        vehicleNumber: t.visit?.vehicle_number || 'N/A',
        tokenNumber: t.visit?.token_number || null,
        operatorName: t.tare_recorder?.full_name || t.tare_recorder?.username || 'Weighbridge Operator',
        operatorUsername: t.tare_recorder?.username || 'weighbridge',
        operatorRole: t.tare_recorded_as_role || 'WEIGHBRIDGE_OPERATOR',
        details: {
          ticketNumber: t.ticket_number,
          grossWeightKg: t.gross_weight_kg ? Number(t.gross_weight_kg) : undefined,
          tareWeightKg: Number(t.tare_weight_kg),
          netWeightKg: t.net_weight_kg ? Number(t.net_weight_kg) : undefined,
        },
      });
    }
  }

  // Add Reception events
  for (const u of completedUnloadsToday) {
    if (stationFilter === 'WEIGHBRIDGE') continue;

    const tx = u.portion?.inventory_transactions?.[0];

    if (u.pump_start_timestamp) {
      workHistory.push({
        id: `rc-start-${u.id.toString()}`,
        station: 'RECEPTION',
        action: 'PUMP_STARTED',
        actionLabel: 'Pumping Started',
        timestamp: new Date(u.pump_start_timestamp).toISOString(),
        vehicleNumber: u.portion?.visit?.vehicle_number || 'N/A',
        tokenNumber: u.portion?.visit?.token_number || null,
        operatorName: u.starter?.full_name || u.starter?.username || 'Reception Operator',
        operatorUsername: u.starter?.username || 'operator',
        operatorRole: u.started_as_role || 'PRODUCTION_RECEPTION_OPERATOR',
        details: {
          portionNumber: u.portion?.portion_number,
          siloNumber: u.silo?.silo_code || u.silo_number || undefined,
        },
      });
    }

    if (u.pump_end_timestamp) {
      const sMs = u.pump_start_timestamp ? new Date(u.pump_start_timestamp).getTime() : 0;
      const eMs = new Date(u.pump_end_timestamp).getTime();
      const dur = sMs > 0 && eMs > sMs ? Math.round((eMs - sMs) / 60000) : undefined;

      workHistory.push({
        id: `rc-end-${u.id.toString()}`,
        station: 'RECEPTION',
        action: 'UNLOAD_COMPLETED',
        actionLabel: 'Unloading Completed',
        timestamp: new Date(u.pump_end_timestamp).toISOString(),
        vehicleNumber: u.portion?.visit?.vehicle_number || 'N/A',
        tokenNumber: u.portion?.visit?.token_number || null,
        operatorName: u.completer?.full_name || u.completer?.username || u.starter?.full_name || 'Reception Operator',
        operatorUsername: u.completer?.username || u.starter?.username || 'operator',
        operatorRole: u.completed_as_role || 'PRODUCTION_RECEPTION_OPERATOR',
        details: {
          portionNumber: u.portion?.portion_number,
          siloNumber: u.silo?.silo_code || u.silo_number || undefined,
          volumeLiters: tx?.quantity_liters ? Number(tx.quantity_liters) : undefined,
          volumeAt13TsLiters: tx?.plant_final_at_13ts_liters ? Number(tx.plant_final_at_13ts_liters) : undefined,
          compositeTsPercent: tx?.plant_ts ? Number(tx.plant_ts) : undefined,
          durationMinutes: dur,
        },
      });
    }
  }

  // Sort history descending by timestamp
  workHistory.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  // 6. Fetch All Silos and compute stock summary
  const allDbSilos = await prisma.silo.findMany({
    where: { is_active: true },
    orderBy: { silo_code: 'asc' },
  });

  let totalSiloCapLiters = 0;
  let totalCurrentStockLiters = 0;
  let totalSiloStock13TsLiters = 0;

  const silosResult: ProductionHeadSiloState[] = await Promise.all(
    allDbSilos.map(async (s) => {
      const cap = Number(s.capacity_liters);
      totalSiloCapLiters += cap;

      const summary = await getSiloStockSummary(s.id);
      totalCurrentStockLiters += summary.currentStockLiters;
      if (summary.currentStockAt13Ts) {
        totalSiloStock13TsLiters += summary.currentStockAt13Ts;
      }

      // Check if actively pumping into this silo
      const activePumping = activePumpings.find(
        (p) => p.siloNumber.toUpperCase() === s.silo_code.toUpperCase() || p.siloNumber.toUpperCase() === s.silo_name.toUpperCase()
      );

      const status: ProductionHeadSiloState['status'] = activePumping
        ? 'RECEIVING'
        : summary.currentStockLiters > 0
        ? 'STORAGE'
        : 'EMPTY';

      const util = cap > 0 ? Math.min(100, Math.round((summary.currentStockLiters / cap) * 100)) : 0;

      return {
        id: s.id.toString(),
        silo_code: s.silo_code,
        silo_name: s.silo_name,
        capacity_liters: cap,
        current_stock_liters: summary.currentStockLiters,
        current_stock_at_13ts: summary.currentStockAt13Ts,
        composite_ts_percent: summary.compositeTsPercent,
        status,
        activePumpingVehicle: activePumping ? activePumping.vehicleNumber : null,
        utilizationPercent: util,
      };
    })
  );

  // 7. Calculate Shift Daily Intake Totals
  const todayReceiptTxs = await prisma.siloInventoryTransaction.findMany({
    where: {
      transaction_type: 'RECEIPT',
      operational_timestamp: { gte: shiftStartUtc, lte: shiftEndUtc },
    },
    select: {
      quantity_liters: true,
      quantity_kg: true,
      plant_final_at_13ts_liters: true,
    },
  });

  let totalIntakeGrossLitersToday = 0;
  let totalIntake13TsLitersToday = 0;
  let totalIntakeNetKgToday = 0;

  for (const rx of todayReceiptTxs) {
    if (rx.quantity_liters) totalIntakeGrossLitersToday += Number(rx.quantity_liters);
    if (rx.plant_final_at_13ts_liters) totalIntake13TsLitersToday += Number(rx.plant_final_at_13ts_liters);
    if (rx.quantity_kg) totalIntakeNetKgToday += Number(rx.quantity_kg);
  }

  // Fallback to weight ticket net sum if no silo transactions yet
  if (totalIntakeNetKgToday === 0) {
    for (const t of completedTicketsToday) {
      if (t.net_weight_kg) totalIntakeNetKgToday += Number(t.net_weight_kg);
    }
  }

  const kpis: ProductionHeadKpis = {
    totalIntake13TsLitersToday: Number(totalIntake13TsLitersToday.toFixed(2)),
    totalIntakeGrossLitersToday: Number(totalIntakeGrossLitersToday.toFixed(2)),
    totalIntakeNetKgToday: Number(totalIntakeNetKgToday.toFixed(2)),
    activeVehiclesInPlant: activeVehiclesCount,
    weighbridgeTicketsToday: completedTicketsToday.filter((t) => t.tare_timestamp !== null).length,
    unloadingPortionsToday: completedUnloadsToday.filter((u) => u.pump_end_timestamp !== null).length,
    totalSiloCapacityLiters: totalSiloCapLiters,
    currentSiloStock13TsLiters: Number(totalSiloStock13TsLiters.toFixed(2)),
    siloUtilizationPercent: totalSiloCapLiters > 0 ? Math.round((totalCurrentStockLiters / totalSiloCapLiters) * 100) : 0,
  };

  const teamStations: ProductionHeadSubordinateStations = {
    weighbridge: {
      operationalStatus: currentlyOnScale ? 'BUSY' : waitingForGrossCount > 0 || waitingForTareCount > 0 ? 'ONLINE' : 'IDLE',
      activeOperators: Array.from(weighbridgeOperatorsSet),
      currentlyOnScale,
      waitingForGrossCount,
      waitingForTareCount,
      completedTodayCount: kpis.weighbridgeTicketsToday,
      avgWeighmentMinutes: weighmentCount > 0 ? Math.round(totalWeighmentMinutesSum / weighmentCount) : 12,
    },
    reception: {
      operationalStatus: activePumpings.length > 0 ? 'ACTIVE' : 'IDLE',
      activeOperators: Array.from(receptionOperatorsSet),
      activeBaysCount: activePumpings.length,
      activePumpings,
      waitingForUnloadingCount,
      completedPortionsToday: kpis.unloadingPortionsToday,
      avgUnloadingMinutes: pumpingCount > 0 ? Math.round(totalPumpingMinutesSum / pumpingCount) : 35,
    },
  };

  return {
    businessDate,
    calendarDate,
    kpis,
    teamStations,
    subordinateWorkHistory: workHistory,
    silos: silosResult,
  };
}
