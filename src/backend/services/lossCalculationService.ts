import { prisma } from '@core/db';
import { Prisma } from '@prisma/client';
import ExcelJS from 'exceljs';
import { createNotificationsForEvent } from '@/backend/services/notificationService';

export interface LossMetricResult {
  lossLiters: number;
  lossPercent: number;
  gainLiters: number;
  signedVarianceLiters: number;
  at13tsLossLiters: number;
  at13tsLossPercent: number;
  at13tsGainLiters: number;
  signedVarianceAt13tsLiters: number;
  isLoss: boolean;
}

export interface Tier1RouteLossResult extends LossMetricResult {
  shopGrossLiters: number;
  zmccArrivalGrossLiters: number;
  shopAt13tsLiters: number;
  zmccArrivalAt13tsLiters: number;
}

export interface Tier2ZmccLossResult extends LossMetricResult {
  motInwardGrossLiters: number;
  localInwardGrossLiters: number;
  totalInwardGrossLiters: number;
  dispatchedGrossLiters: number;
  startingTankStockLiters: number;
  endingTankStockLiters: number;
  deltaTankStockLiters: number;
  totalInwardAt13tsLiters: number;
  dispatchedAt13tsLiters: number;
}

export interface Tier3TransitLossResult extends LossMetricResult {
  dispatchedGrossLiters: number;
  plantAcceptedGrossLiters: number;
  plantAcceptedNetKg: number;
  dispatchedAt13tsLiters: number;
  plantAcceptedAt13tsLiters: number;
  isHighLoss: boolean;
}

export interface Tier4TotalLossResult extends LossMetricResult {
  totalInitialIntakeLiters: number;
  totalFinalPlantLiters: number;
  totalInitialIntakeAt13tsLiters: number;
  totalFinalPlantAt13tsLiters: number;
}

export interface SupplyChainLossSummary {
  period: string;
  startDate: string;
  endDate: string;
  tier1RouteLoss: Tier1RouteLossResult & { label: string };
  tier2ZmccLoss: Tier2ZmccLossResult & { label: string };
  tier3TransitLoss: Tier3TransitLossResult & { label: string; highLossCount: number };
  tier4TotalLoss: Tier4TotalLossResult & { label: string };
}

export interface LossReconciliationDetailRow {
  date: string;
  zmccName: string;
  zmccCode: string;
  routeCode?: string;
  vehicleNumber: string;
  driverName?: string;
  referenceNumber?: string;
  // Tier 1
  shopLiters?: number;
  zmccLiters?: number;
  routeLossLiters?: number;
  routeLossPercent?: number;
  // Tier 2
  motInwardLiters?: number;
  localInwardLiters?: number;
  dispatchedLiters?: number;
  deltaStockLiters?: number;
  zmccLossLiters?: number;
  zmccLossPercent?: number;
  // Tier 3
  dispatchedGrossLiters?: number;
  plantNetKg?: number;
  plantAcceptedLiters?: number;
  transitLossLiters?: number;
  transitLossPercent?: number;
  isHighTransitLoss?: boolean;
  // Quality
  dispatchLr?: number;
  dispatchFat?: number;
  plantLr?: number;
  plantFat?: number;
  lrDelta?: number;
  fatDelta?: number;
  financialImpactEstimatedRs?: number;
}

// -------------------------------------------------------------
// PURE CALCULATION FUNCTIONS (Zero side-effects, fully testable)
// -------------------------------------------------------------

/**
 * Calculates Tier 1 (MOT Route / Area Loss):
 * Route Loss = Sum(Shop Collections) - Arrival Quantity at ZMCC
 */
export function calculateTier1RouteLoss(params: {
  shopGrossLiters: number;
  zmccArrivalGrossLiters: number;
  shopAt13tsLiters?: number;
  zmccArrivalAt13tsLiters?: number;
}): Tier1RouteLossResult {
  const shopGross = Math.max(0, Number(params.shopGrossLiters.toFixed(2)));
  const zmccArrivalGross = Math.max(0, Number(params.zmccArrivalGrossLiters.toFixed(2)));
  const shop13ts = Math.max(0, Number((params.shopAt13tsLiters ?? 0).toFixed(2)));
  const zmccArrival13ts = Math.max(0, Number((params.zmccArrivalAt13tsLiters ?? 0).toFixed(2)));

  const signedGrossVar = Number((zmccArrivalGross - shopGross).toFixed(2));
  const lossLiters = signedGrossVar < 0 ? Math.abs(signedGrossVar) : 0;
  const gainLiters = signedGrossVar > 0 ? signedGrossVar : 0;
  const lossPercent = shopGross > 0 ? Number(((lossLiters / shopGross) * 100).toFixed(4)) : 0;

  const signed13tsVar = Number((zmccArrival13ts - shop13ts).toFixed(2));
  const loss13ts = signed13tsVar < 0 ? Math.abs(signed13tsVar) : 0;
  const gain13ts = signed13tsVar > 0 ? signed13tsVar : 0;
  const loss13tsPercent = shop13ts > 0 ? Number(((loss13ts / shop13ts) * 100).toFixed(4)) : 0;

  return {
    shopGrossLiters: shopGross,
    zmccArrivalGrossLiters: zmccArrivalGross,
    shopAt13tsLiters: shop13ts,
    zmccArrivalAt13tsLiters: zmccArrival13ts,
    lossLiters,
    lossPercent,
    gainLiters,
    signedVarianceLiters: signedGrossVar,
    at13tsLossLiters: loss13ts,
    at13tsLossPercent: loss13tsPercent,
    at13tsGainLiters: gain13ts,
    signedVarianceAt13tsLiters: signed13tsVar,
    isLoss: lossLiters > 0,
  };
}

/**
 * Calculates Tier 2 (ZMCC Process & Chilling Loss):
 * ZMCC Loss = (Total MOT Inward + Total Local Supplier Inward) - Dispatched Tankers - Delta Tank Stock
 */
export function calculateTier2ZmccLoss(params: {
  motInwardGrossLiters: number;
  localInwardGrossLiters: number;
  dispatchedGrossLiters: number;
  startingTankStockLiters: number;
  endingTankStockLiters: number;
  motInwardAt13tsLiters?: number;
  localInwardAt13tsLiters?: number;
  dispatchedAt13tsLiters?: number;
}): Tier2ZmccLossResult {
  const motInward = Math.max(0, Number(params.motInwardGrossLiters.toFixed(2)));
  const localInward = Math.max(0, Number(params.localInwardGrossLiters.toFixed(2)));
  const totalInward = Number((motInward + localInward).toFixed(2));
  const dispatched = Math.max(0, Number(params.dispatchedGrossLiters.toFixed(2)));
  const startStock = Math.max(0, Number(params.startingTankStockLiters.toFixed(2)));
  const endStock = Math.max(0, Number(params.endingTankStockLiters.toFixed(2)));
  const deltaStock = Number((endStock - startStock).toFixed(2));

  // Expected stock remaining or accounted for: totalInward - dispatched
  // Actual physical change: deltaStock
  // Variance = (dispatched + deltaStock) - totalInward (negative is loss)
  const accountedLiters = Number((dispatched + deltaStock).toFixed(2));
  const signedGrossVar = Number((accountedLiters - totalInward).toFixed(2));
  const lossLiters = signedGrossVar < 0 ? Math.abs(signedGrossVar) : 0;
  const gainLiters = signedGrossVar > 0 ? signedGrossVar : 0;
  const lossPercent = totalInward > 0 ? Number(((lossLiters / totalInward) * 100).toFixed(4)) : 0;

  const mot13ts = Math.max(0, Number((params.motInwardAt13tsLiters ?? 0).toFixed(2)));
  const local13ts = Math.max(0, Number((params.localInwardAt13tsLiters ?? 0).toFixed(2)));
  const totalInward13ts = Number((mot13ts + local13ts).toFixed(2));
  const dispatched13ts = Math.max(0, Number((params.dispatchedAt13tsLiters ?? 0).toFixed(2)));
  const signed13tsVar = Number((dispatched13ts - totalInward13ts).toFixed(2));
  const loss13ts = signed13tsVar < 0 ? Math.abs(signed13tsVar) : 0;
  const gain13ts = signed13tsVar > 0 ? signed13tsVar : 0;
  const loss13tsPercent = totalInward13ts > 0 ? Number(((loss13ts / totalInward13ts) * 100).toFixed(4)) : 0;

  return {
    motInwardGrossLiters: motInward,
    localInwardGrossLiters: localInward,
    totalInwardGrossLiters: totalInward,
    dispatchedGrossLiters: dispatched,
    startingTankStockLiters: startStock,
    endingTankStockLiters: endStock,
    deltaTankStockLiters: deltaStock,
    totalInwardAt13tsLiters: totalInward13ts,
    dispatchedAt13tsLiters: dispatched13ts,
    lossLiters,
    lossPercent,
    gainLiters,
    signedVarianceLiters: signedGrossVar,
    at13tsLossLiters: loss13ts,
    at13tsLossPercent: loss13tsPercent,
    at13tsGainLiters: gain13ts,
    signedVarianceAt13tsLiters: signed13tsVar,
    isLoss: lossLiters > 0,
  };
}

/**
 * Calculates Tier 3 (Road Transit Loss):
 * Transit Loss = ZMCC Dispatched Gross Liters - Plant Accepted Net Liters
 * High Transit Loss Alert triggers when lossPercent > 1.0%
 */
export function calculateTier3TransitLoss(params: {
  dispatchedGrossLiters: number;
  plantAcceptedGrossLiters: number;
  plantAcceptedNetKg?: number;
  dispatchedAt13tsLiters?: number;
  plantAcceptedAt13tsLiters?: number;
}): Tier3TransitLossResult {
  const dispatched = Math.max(0, Number(params.dispatchedGrossLiters.toFixed(2)));
  const received = Math.max(0, Number(params.plantAcceptedGrossLiters.toFixed(2)));
  const plantNetKg = Math.max(0, Number((params.plantAcceptedNetKg ?? 0).toFixed(2)));
  const dispatched13ts = Math.max(0, Number((params.dispatchedAt13tsLiters ?? 0).toFixed(2)));
  const received13ts = Math.max(0, Number((params.plantAcceptedAt13tsLiters ?? 0).toFixed(2)));

  const signedGrossVar = Number((received - dispatched).toFixed(2));
  const lossLiters = signedGrossVar < 0 ? Math.abs(signedGrossVar) : 0;
  const gainLiters = signedGrossVar > 0 ? signedGrossVar : 0;
  const lossPercent = dispatched > 0 ? Number(((lossLiters / dispatched) * 100).toFixed(4)) : 0;

  const signed13tsVar = Number((received13ts - dispatched13ts).toFixed(2));
  const loss13ts = signed13tsVar < 0 ? Math.abs(signed13tsVar) : 0;
  const gain13ts = signed13tsVar > 0 ? signed13tsVar : 0;
  const loss13tsPercent = dispatched13ts > 0 ? Number(((loss13ts / dispatched13ts) * 100).toFixed(4)) : 0;

  const isHighLoss = lossPercent > 1.0;

  return {
    dispatchedGrossLiters: dispatched,
    plantAcceptedGrossLiters: received,
    plantAcceptedNetKg: plantNetKg,
    dispatchedAt13tsLiters: dispatched13ts,
    plantAcceptedAt13tsLiters: received13ts,
    lossLiters,
    lossPercent,
    gainLiters,
    signedVarianceLiters: signedGrossVar,
    at13tsLossLiters: loss13ts,
    at13tsLossPercent: loss13tsPercent,
    at13tsGainLiters: gain13ts,
    signedVarianceAt13tsLiters: signed13tsVar,
    isHighLoss,
    isLoss: lossLiters > 0,
  };
}

/**
 * Calculates Tier 4 (Total MPD Supply Chain Loss):
 * Cumulative loss across village route collection, ZMCC processing, and road transit.
 */
export function calculateTier4TotalLoss(
  tier1: Tier1RouteLossResult,
  tier2: Tier2ZmccLossResult,
  tier3: Tier3TransitLossResult
): Tier4TotalLossResult {
  const totalLossLiters = Number((tier1.lossLiters + tier2.lossLiters + tier3.lossLiters).toFixed(2));
  const totalGainLiters = Number((tier1.gainLiters + tier2.gainLiters + tier3.gainLiters).toFixed(2));
  const signedGrossVar = Number((totalGainLiters - totalLossLiters).toFixed(2));

  const totalIntakeLiters = Number((tier1.shopGrossLiters + tier2.localInwardGrossLiters).toFixed(2));
  const totalPlantLiters = tier3.plantAcceptedGrossLiters;

  const lossPercent = totalIntakeLiters > 0 ? Number(((totalLossLiters / totalIntakeLiters) * 100).toFixed(4)) : 0;

  const totalLoss13ts = Number((tier1.at13tsLossLiters + tier2.at13tsLossLiters + tier3.at13tsLossLiters).toFixed(2));
  const totalGain13ts = Number((tier1.at13tsGainLiters + tier2.at13tsGainLiters + tier3.at13tsGainLiters).toFixed(2));
  const signed13tsVar = Number((totalGain13ts - totalLoss13ts).toFixed(2));
  const totalIntake13ts = Number((tier1.shopAt13tsLiters + tier2.totalInwardAt13tsLiters).toFixed(2));
  const loss13tsPercent = totalIntake13ts > 0 ? Number(((totalLoss13ts / totalIntake13ts) * 100).toFixed(4)) : 0;

  return {
    totalInitialIntakeLiters: totalIntakeLiters,
    totalFinalPlantLiters: totalPlantLiters,
    totalInitialIntakeAt13tsLiters: totalIntake13ts,
    totalFinalPlantAt13tsLiters: tier3.plantAcceptedAt13tsLiters,
    lossLiters: totalLossLiters,
    lossPercent,
    gainLiters: totalGainLiters,
    signedVarianceLiters: signedGrossVar,
    at13tsLossLiters: totalLoss13ts,
    at13tsLossPercent: loss13tsPercent,
    at13tsGainLiters: totalGain13ts,
    signedVarianceAt13tsLiters: signed13tsVar,
    isLoss: totalLossLiters > 0,
  };
}

// -------------------------------------------------------------
// DATE RANGE RESOLUTION
// -------------------------------------------------------------

export function resolvePeriodDateRange(
  period: 'today' | 'wtd' | 'mtd' | 'custom' = 'today',
  customFrom?: string | Date,
  customTo?: string | Date
): { startDate: Date; endDate: Date; label: string } {
  const now = new Date();
  // Pakistan standard business time (UTC+5)
  const pkNow = new Date(now.getTime() + 5 * 60 * 60 * 1000);

  if (period === 'custom' && customFrom) {
    const s = typeof customFrom === 'string' ? new Date(`${customFrom}T00:00:00.000Z`) : customFrom;
    const e = customTo
      ? typeof customTo === 'string' ? new Date(`${customTo}T23:59:59.999Z`) : customTo
      : new Date();
    return { startDate: s, endDate: e, label: 'Custom Range' };
  }

  if (period === 'wtd') {
    // Week starts Monday
    const day = pkNow.getUTCDay();
    const diff = (day === 0 ? 6 : day - 1);
    const monday = new Date(pkNow);
    monday.setUTCDate(pkNow.getUTCDate() - diff);
    const startStr = monday.toISOString().split('T')[0];
    const endStr = pkNow.toISOString().split('T')[0];
    return {
      startDate: new Date(`${startStr}T00:00:00.000Z`),
      endDate: new Date(`${endStr}T23:59:59.999Z`),
      label: 'Weekly (WTD)',
    };
  }

  if (period === 'mtd') {
    const year = pkNow.getUTCFullYear();
    const month = String(pkNow.getUTCMonth() + 1).padStart(2, '0');
    const startStr = `${year}-${month}-01`;
    const endStr = pkNow.toISOString().split('T')[0];
    return {
      startDate: new Date(`${startStr}T00:00:00.000Z`),
      endDate: new Date(`${endStr}T23:59:59.999Z`),
      label: 'Monthly (MTD)',
    };
  }

  // Default: today
  const todayStr = pkNow.toISOString().split('T')[0];
  return {
    startDate: new Date(`${todayStr}T00:00:00.000Z`),
    endDate: new Date(`${todayStr}T23:59:59.999Z`),
    label: 'Daily (Today)',
  };
}

// -------------------------------------------------------------
// DATABASE QUERY & AGGREGATE ENGINE
// -------------------------------------------------------------

export async function getSupplyChainLossHierarchy(filters: {
  period?: 'today' | 'wtd' | 'mtd' | 'custom';
  from?: string;
  to?: string;
  zmccId?: string | bigint;
}): Promise<{
  summary: SupplyChainLossSummary;
  details: LossReconciliationDetailRow[];
}> {
  const { startDate, endDate, label: periodLabel } = resolvePeriodDateRange(
    filters.period || 'today',
    filters.from,
    filters.to
  );

  const zmccFilter = filters.zmccId ? { id: BigInt(String(filters.zmccId)) } : {};
  const zmccIdBigInt = filters.zmccId ? BigInt(String(filters.zmccId)) : undefined;

  // 1. Query Tier 1 Journeys (MOT Route Collections vs ZMCC Arrival)
  const journeys = await prisma.motJourney.findMany({
    where: {
      operational_date: { gte: startDate, lte: endDate },
      ...(zmccIdBigInt ? { zmcc_id: zmccIdBigInt } : {}),
      status: 'COMPLETED',
    },
    include: {
      zmcc: true,
      route: true,
      mot_vehicle: true,
      mot_profile: true,
      summary: true,
      mot_arrival: {
        include: {
          lab_session: true,
        },
      },
    },
    orderBy: { operational_date: 'desc' },
  });

  let totalShopGrossLiters = 0;
  let totalShopAt13tsLiters = 0;
  let totalZmccArrivalGrossLiters = 0;
  let totalZmccArrivalAt13tsLiters = 0;

  const detailRows: LossReconciliationDetailRow[] = [];

  for (const j of journeys) {
    const summary = j.summary;
    const labSession = j.mot_arrival?.lab_session;

    const shopGross = summary ? Number(summary.total_gross_liters) : 0;
    const shop13ts = summary ? Number(summary.total_at_13ts_liters) : 0;

    const zmccGross = labSession && labSession.gross_liters != null ? Number(labSession.gross_liters) : 0;
    const zmcc13ts = labSession && labSession.at_13ts_liters != null ? Number(labSession.at_13ts_liters) : 0;

    totalShopGrossLiters += shopGross;
    totalShopAt13tsLiters += shop13ts;
    totalZmccArrivalGrossLiters += zmccGross;
    totalZmccArrivalAt13tsLiters += zmcc13ts;

    const routeLossL = shopGross > zmccGross ? Number((shopGross - zmccGross).toFixed(2)) : 0;
    const routeLossPct = shopGross > 0 ? Number(((routeLossL / shopGross) * 100).toFixed(2)) : 0;

    detailRows.push({
      date: j.operational_date.toISOString().split('T')[0],
      zmccName: j.zmcc.name,
      zmccCode: j.zmcc.code,
      routeCode: j.route.route_code,
      vehicleNumber: j.mot_vehicle.vehicle_number,
      driverName: j.mot_profile.name,
      referenceNumber: j.journey_number,
      shopLiters: shopGross,
      zmccLiters: zmccGross,
      routeLossLiters: routeLossL,
      routeLossPercent: routeLossPct,
    });
  }

  const tier1Calc = calculateTier1RouteLoss({
    shopGrossLiters: totalShopGrossLiters,
    zmccArrivalGrossLiters: totalZmccArrivalGrossLiters,
    shopAt13tsLiters: totalShopAt13tsLiters,
    zmccArrivalAt13tsLiters: totalZmccArrivalAt13tsLiters,
  });

  // 2. Query Tier 2 (ZMCC Inward vs Outward Dispatches vs Stock Delta)
  const [localSupplierSessions, dispatchedVisits] = await Promise.all([
    prisma.zmccLabSession.findMany({
      where: {
        arrival_type: 'LOCAL_SUPPLIER',
        created_at: { gte: startDate, lte: endDate },
        ...(zmccIdBigInt ? { zmcc_id: zmccIdBigInt } : {}),
        status: 'COMPLETED',
        decision: 'ACCEPTED',
      },
      select: {
        gross_liters: true,
        at_13ts_liters: true,
      },
    }),
    prisma.vehicleVisit.findMany({
      where: {
        operational_date: { gte: startDate, lte: endDate },
        ...(zmccIdBigInt ? { procurement_source_id: zmccIdBigInt } : {}),
        current_status: { notIn: ['CANCELLED', 'REJECTED'] },
      },
      include: {
        procurement_source: true,
        weight_ticket: true,
        dual_reconciliation: true,
      },
      orderBy: { created_at: 'desc' },
    }),
  ]);

  let localInwardGross = 0;
  let localInward13ts = 0;
  for (const s of localSupplierSessions) {
    localInwardGross += s.gross_liters ? Number(s.gross_liters) : 0;
    localInward13ts += s.at_13ts_liters ? Number(s.at_13ts_liters) : 0;
  }

  let totalDispatchedGrossLiters = 0;
  let totalDispatchedAt13tsLiters = 0;
  let totalPlantAcceptedGrossLiters = 0;
  let totalPlantAcceptedAt13tsLiters = 0;
  let totalPlantNetKg = 0;
  let highLossCount = 0;

  for (const v of dispatchedVisits) {
    const dispGross = v.vehicle_dispatch_gross_liters ? Number(v.vehicle_dispatch_gross_liters) : 0;
    const disp13ts = v.vehicle_dispatch_at_13ts_liters ? Number(v.vehicle_dispatch_at_13ts_liters) : 0;

    const dual = v.dual_reconciliation;
    const weight = v.weight_ticket;

    const plantGross = dual ? Number(dual.received_gross_liters) : (dispGross > 0 ? dispGross : 0);
    const plant13ts = dual ? Number(dual.received_at_13ts_liters) : (disp13ts > 0 ? disp13ts : 0);
    const netKg = weight?.net_weight_kg ? Number(weight.net_weight_kg) : 0;

    totalDispatchedGrossLiters += dispGross;
    totalDispatchedAt13tsLiters += disp13ts;
    totalPlantAcceptedGrossLiters += plantGross;
    totalPlantAcceptedAt13tsLiters += plant13ts;
    totalPlantNetKg += netKg;

    const transitLossL = dispGross > plantGross ? Number((dispGross - plantGross).toFixed(2)) : 0;
    const transitLossPct = dispGross > 0 ? Number(((transitLossL / dispGross) * 100).toFixed(2)) : 0;
    const isHigh = transitLossPct > 1.0;
    if (isHigh) highLossCount++;

    const dispLr = v.vehicle_dispatch_lr ? Number(v.vehicle_dispatch_lr) : undefined;
    const dispFat = v.vehicle_dispatch_fat ? Number(v.vehicle_dispatch_fat) : undefined;

    detailRows.push({
      date: (v.operational_date || v.created_at).toISOString().split('T')[0],
      zmccName: v.procurement_source?.name || 'ZMCC',
      zmccCode: v.procurement_source?.code || '',
      vehicleNumber: v.vehicle_number,
      referenceNumber: v.raw_milk_dispatch_note_number || v.visit_number,
      dispatchedGrossLiters: dispGross,
      plantNetKg: netKg,
      plantAcceptedLiters: plantGross,
      transitLossLiters: transitLossL,
      transitLossPercent: transitLossPct,
      isHighTransitLoss: isHigh,
      dispatchLr: dispLr,
      dispatchFat: dispFat,
      financialImpactEstimatedRs: Number((transitLossL * 180).toFixed(2)), // Standard estimated raw milk cost ~Rs. 180/L
    });
  }

  let startStockLiters = 0;
  let endStockLiters = 0;

  try {
    if (zmccIdBigInt) {
      const [startRes, endRes] = await Promise.all([
        prisma.$queryRaw<Array<{ stock: string | number | null }>>`
          SELECT COALESCE(
            SUM(
              CASE 
                WHEN transaction_type IN ('RECEIPT', 'ADJUSTMENT_IN') THEN quantity_liters
                WHEN transaction_type IN ('ISSUE', 'ADJUSTMENT_OUT') THEN -quantity_liters
                ELSE 0
              END
            ), 0
          ) as stock
          FROM zmcc_tank_inventory_transaction
          WHERE zmcc_id = ${zmccIdBigInt} AND operational_timestamp < ${startDate}
        `,
        prisma.$queryRaw<Array<{ stock: string | number | null }>>`
          SELECT COALESCE(
            SUM(
              CASE 
                WHEN transaction_type IN ('RECEIPT', 'ADJUSTMENT_IN') THEN quantity_liters
                WHEN transaction_type IN ('ISSUE', 'ADJUSTMENT_OUT') THEN -quantity_liters
                ELSE 0
              END
            ), 0
          ) as stock
          FROM zmcc_tank_inventory_transaction
          WHERE zmcc_id = ${zmccIdBigInt} AND operational_timestamp <= ${endDate}
        `,
      ]);
      startStockLiters = Math.max(0, Number(startRes[0]?.stock || 0));
      endStockLiters = Math.max(0, Number(endRes[0]?.stock || 0));
    } else {
      const [startRes, endRes] = await Promise.all([
        prisma.$queryRaw<Array<{ stock: string | number | null }>>`
          SELECT COALESCE(
            SUM(
              CASE 
                WHEN transaction_type IN ('RECEIPT', 'ADJUSTMENT_IN') THEN quantity_liters
                WHEN transaction_type IN ('ISSUE', 'ADJUSTMENT_OUT') THEN -quantity_liters
                ELSE 0
              END
            ), 0
          ) as stock
          FROM zmcc_tank_inventory_transaction
          WHERE operational_timestamp < ${startDate}
        `,
        prisma.$queryRaw<Array<{ stock: string | number | null }>>`
          SELECT COALESCE(
            SUM(
              CASE 
                WHEN transaction_type IN ('RECEIPT', 'ADJUSTMENT_IN') THEN quantity_liters
                WHEN transaction_type IN ('ISSUE', 'ADJUSTMENT_OUT') THEN -quantity_liters
                ELSE 0
              END
            ), 0
          ) as stock
          FROM zmcc_tank_inventory_transaction
          WHERE operational_timestamp <= ${endDate}
        `,
      ]);
      startStockLiters = Math.max(0, Number(startRes[0]?.stock || 0));
      endStockLiters = Math.max(0, Number(endRes[0]?.stock || 0));
    }
  } catch {
    startStockLiters = 0;
    endStockLiters = 0;
  }

  const tier2Calc = calculateTier2ZmccLoss({
    motInwardGrossLiters: totalZmccArrivalGrossLiters,
    localInwardGrossLiters: localInwardGross,
    dispatchedGrossLiters: totalDispatchedGrossLiters,
    startingTankStockLiters: startStockLiters,
    endingTankStockLiters: endStockLiters,
    motInwardAt13tsLiters: totalZmccArrivalAt13tsLiters,
    localInwardAt13tsLiters: localInward13ts,
    dispatchedAt13tsLiters: totalDispatchedAt13tsLiters,
  });

  // 3. Query Tier 3 (Road Transit Loss)
  const tier3Calc = calculateTier3TransitLoss({
    dispatchedGrossLiters: totalDispatchedGrossLiters,
    plantAcceptedGrossLiters: totalPlantAcceptedGrossLiters,
    plantAcceptedNetKg: totalPlantNetKg,
    dispatchedAt13tsLiters: totalDispatchedAt13tsLiters,
    plantAcceptedAt13tsLiters: totalPlantAcceptedAt13tsLiters,
  });

  // 4. Tier 4 (Total Cumulative Loss)
  const tier4Calc = calculateTier4TotalLoss(tier1Calc, tier2Calc, tier3Calc);

  return {
    summary: {
      period: filters.period || 'today',
      startDate: startDate.toISOString().split('T')[0],
      endDate: endDate.toISOString().split('T')[0],
      tier1RouteLoss: { ...tier1Calc, label: 'MOT Route / Area Loss' },
      tier2ZmccLoss: { ...tier2Calc, label: 'ZMCC Process & Chilling Loss' },
      tier3TransitLoss: { ...tier3Calc, label: 'Road Transit Loss', highLossCount },
      tier4TotalLoss: { ...tier4Calc, label: 'Total MPD Loss' },
    },
    details: detailRows,
  };
}

// -------------------------------------------------------------
// TRANSIT LOSS ALERT DISPATCHER
// -------------------------------------------------------------

export async function checkAndTriggerTransitLossAlertTx(
  tx: Prisma.TransactionClient,
  params: {
    visitId: bigint;
    visitNumber: string;
    vehicleNumber: string;
    zmccId?: bigint | null;
    zmccName?: string | null;
    dispatchedGrossLiters: number;
    receivedGrossLiters: number;
    transitLossPercent: number;
  }
): Promise<boolean> {
  if (params.transitLossPercent > 1.0) {
    const lossLiters = Math.max(0, Number((params.dispatchedGrossLiters - params.receivedGrossLiters).toFixed(2)));
    await createNotificationsForEvent(tx, {
      eventKey: 'HIGH_TRANSIT_LOSS_ALERT',
      sourceId: params.visitId.toString(),
      sourceZmccId: params.zmccId || undefined,
      title: 'High Road Transit Loss Alert (>1.0%)',
      body: `Vehicle ${params.vehicleNumber} (Visit #${params.visitNumber}) arrived with ${params.transitLossPercent.toFixed(2)}% loss (${lossLiters.toFixed(2)} L). Inspection required.`,
      deepLink: `/department/qa-manager?visitId=${params.visitId.toString()}`,
      dedupeSuffix: `high-transit-${params.visitId.toString()}`,
    });
    return true;
  }
  return false;
}

// -------------------------------------------------------------
// EXCEL WORKBOOK GENERATOR (Native OpenXML .xlsx via ExcelJS)
// -------------------------------------------------------------

export async function generateLossReconciliationExcel(data: {
  summary: SupplyChainLossSummary;
  details: LossReconciliationDetailRow[];
}): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Milk Reception & Process Management';
  workbook.created = new Date();

  const headerFill: ExcelJS.Fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF1E3A8A' }, // Brand Navy
  };

  const headerFont: Partial<ExcelJS.Font> = {
    name: 'Segoe UI',
    size: 11,
    bold: true,
    color: { argb: 'FFFFFFFF' },
  };

  const subHeaderFill: ExcelJS.Fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFF1F5F9' },
  };

  const subHeaderFont: Partial<ExcelJS.Font> = {
    name: 'Segoe UI',
    size: 11,
    bold: true,
    color: { argb: 'FF0F172A' },
  };

  // ---------------------------------------------------------
  // SHEET 1: Supply Chain Loss Summary
  // ---------------------------------------------------------
  const summarySheet = workbook.addWorksheet('Loss Hierarchy Summary', {
    views: [{ showGridLines: true }],
  });

  summarySheet.columns = [
    { header: 'Loss Tier / Hierarchy Level', key: 'tier', width: 36 },
    { header: 'Initial Volume (L)', key: 'initial', width: 20 },
    { header: 'Final Volume (L)', key: 'final', width: 20 },
    { header: 'Loss Volume (L)', key: 'lossL', width: 18 },
    { header: 'Loss %', key: 'lossPct', width: 14 },
    { header: 'Loss @13% TS (L)', key: 'lossTs', width: 20 },
    { header: 'Status / Flag', key: 'status', width: 20 },
  ];

  const s1HeaderRow = summarySheet.getRow(1);
  s1HeaderRow.height = 28;
  s1HeaderRow.eachCell((cell) => {
    cell.fill = headerFill;
    cell.font = headerFont;
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
  });

  const { tier1RouteLoss, tier2ZmccLoss, tier3TransitLoss, tier4TotalLoss } = data.summary;

  summarySheet.addRow({
    tier: 'Tier 1: MOT Route / Area Loss',
    initial: tier1RouteLoss.shopGrossLiters,
    final: tier1RouteLoss.zmccArrivalGrossLiters,
    lossLiters: tier1RouteLoss.lossLiters,
    lossPercent: tier1RouteLoss.lossPercent / 100,
    lossTs: tier1RouteLoss.at13tsLossLiters,
    status: tier1RouteLoss.lossLiters > 0 ? 'Normal Variance' : 'Zero Loss',
  });

  summarySheet.addRow({
    tier: 'Tier 2: ZMCC Process & Chilling Loss',
    initial: tier2ZmccLoss.totalInwardGrossLiters,
    final: tier2ZmccLoss.dispatchedGrossLiters + tier2ZmccLoss.deltaTankStockLiters,
    lossLiters: tier2ZmccLoss.lossLiters,
    lossPercent: tier2ZmccLoss.lossPercent / 100,
    lossTs: tier2ZmccLoss.at13tsLossLiters,
    status: tier2ZmccLoss.lossLiters > 0 ? 'Process Loss' : 'Balanced',
  });

  summarySheet.addRow({
    tier: 'Tier 3: Road Transit Loss',
    initial: tier3TransitLoss.dispatchedGrossLiters,
    final: tier3TransitLoss.plantAcceptedGrossLiters,
    lossLiters: tier3TransitLoss.lossLiters,
    lossPercent: tier3TransitLoss.lossPercent / 100,
    lossTs: tier3TransitLoss.at13tsLossLiters,
    status: tier3TransitLoss.isHighLoss ? 'HIGH LOSS (>1.0%)' : 'Normal',
  });

  const totalRow = summarySheet.addRow({
    tier: 'Tier 4: Total Supply Chain Loss',
    initial: tier4TotalLoss.totalInitialIntakeLiters,
    final: tier4TotalLoss.totalFinalPlantLiters,
    lossLiters: tier4TotalLoss.lossLiters,
    lossPercent: tier4TotalLoss.lossPercent / 100,
    lossTs: tier4TotalLoss.at13tsLossLiters,
    status: 'Cumulative Total',
  });

  totalRow.eachCell((cell) => {
    cell.font = { name: 'Segoe UI', bold: true, size: 11 };
    cell.fill = subHeaderFill;
  });

  // Apply number formatting
  for (let r = 2; r <= 5; r++) {
    const row = summarySheet.getRow(r);
    row.height = 22;
    row.getCell('initial').numFmt = '#,##0.00';
    row.getCell('final').numFmt = '#,##0.00';
    row.getCell('lossL').numFmt = '#,##0.00';
    row.getCell('lossPct').numFmt = '0.00%';
    row.getCell('lossTs').numFmt = '#,##0.00';
  }

  // ---------------------------------------------------------
  // SHEET 2: Detailed Loss & Reconciliation Records
  // ---------------------------------------------------------
  const detailSheet = workbook.addWorksheet('Reconciliation Records', {
    views: [{ showGridLines: true }],
  });

  detailSheet.columns = [
    { header: 'Date', key: 'date', width: 14 },
    { header: 'ZMCC Name', key: 'zmccName', width: 22 },
    { header: 'Route Code', key: 'routeCode', width: 16 },
    { header: 'Vehicle / Tanker', key: 'vehicleNumber', width: 18 },
    { header: 'Ref / Note No.', key: 'referenceNumber', width: 20 },
    { header: 'Shop Qty (L)', key: 'shopLiters', width: 16 },
    { header: 'ZMCC Intake (L)', key: 'zmccLiters', width: 16 },
    { header: 'Route Loss (L)', key: 'routeLossLiters', width: 16 },
    { header: 'Route Loss %', key: 'routeLossPercent', width: 14 },
    { header: 'Dispatched (L)', key: 'dispatchedGrossLiters', width: 16 },
    { header: 'Plant Net (Kg)', key: 'plantNetKg', width: 16 },
    { header: 'Plant Net (L)', key: 'plantAcceptedLiters', width: 16 },
    { header: 'Transit Loss (L)', key: 'transitLossLiters', width: 16 },
    { header: 'Transit Loss %', key: 'transitLossPercent', width: 14 },
    { header: 'High Loss Alert', key: 'isHighTransitLoss', width: 16 },
    { header: 'Financial Impact (PKR)', key: 'financialImpactEstimatedRs', width: 22 },
  ];

  const s2HeaderRow = detailSheet.getRow(1);
  s2HeaderRow.height = 28;
  s2HeaderRow.eachCell((cell) => {
    cell.fill = headerFill;
    cell.font = headerFont;
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
  });

  data.details.forEach((d) => {
    const row = detailSheet.addRow({
      date: d.date,
      zmccName: d.zmccName,
      routeCode: d.routeCode || '-',
      vehicleNumber: d.vehicleNumber,
      referenceNumber: d.referenceNumber || '-',
      shopLiters: d.shopLiters ?? null,
      zmccLiters: d.zmccLiters ?? null,
      routeLossLiters: d.routeLossLiters ?? null,
      routeLossPercent: d.routeLossPercent !== undefined ? d.routeLossPercent / 100 : null,
      dispatchedGrossLiters: d.dispatchedGrossLiters ?? null,
      plantNetKg: d.plantNetKg ?? null,
      plantAcceptedLiters: d.plantAcceptedLiters ?? null,
      transitLossLiters: d.transitLossLiters ?? null,
      transitLossPercent: d.transitLossPercent !== undefined ? d.transitLossPercent / 100 : null,
      isHighTransitLoss: d.isHighTransitLoss ? 'HIGH LOSS (>1%)' : 'NORMAL',
      financialImpactEstimatedRs: d.financialImpactEstimatedRs ?? null,
    });

    row.height = 20;
    row.getCell('shopLiters').numFmt = '#,##0.00';
    row.getCell('zmccLiters').numFmt = '#,##0.00';
    row.getCell('routeLossLiters').numFmt = '#,##0.00';
    row.getCell('routeLossPercent').numFmt = '0.00%';
    row.getCell('dispatchedGrossLiters').numFmt = '#,##0.00';
    row.getCell('plantNetKg').numFmt = '#,##0.00';
    row.getCell('plantAcceptedLiters').numFmt = '#,##0.00';
    row.getCell('transitLossLiters').numFmt = '#,##0.00';
    row.getCell('transitLossPercent').numFmt = '0.00%';
    row.getCell('financialImpactEstimatedRs').numFmt = 'Rs. #,##0.00';

    if (d.isHighTransitLoss) {
      row.getCell('isHighTransitLoss').font = { name: 'Segoe UI', bold: true, color: { argb: 'FFDC2626' } };
    }
  });

  const rawBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(rawBuffer);
}
