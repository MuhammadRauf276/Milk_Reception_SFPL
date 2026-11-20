import { journeyTripFigures } from './motTripFigures';
import { prisma } from '@core/db';
import { Prisma } from '@prisma/client';
import ExcelJS from 'exceljs';
import { createNotificationsForEvent } from '@/backend/services/notificationService';
import { writeAuditLog } from '@/backend/core/audit';
import type { ActingContext } from '@/types/acting';
import { calculateAt13TSLiters, calculateDensity } from '@/backend/utils/milkFormulas';
import {
  signedPercent, lossGainKind, lossGainExportValue, LOSS_GAIN_EXPORT_HEADER, LOSS_GAIN_EXPORT_PERCENT_HEADER,
  toCents, fromCents, emptyFigureTotals, addToFigureTotals, mergeFigureTotals, figureFromTotals, pairFromTotals,
  type LossFigure, type PairTotals, type FigureTotals,
} from '@/lib/lossGain';
import { reportRangeError, withReportTimeout } from '@/backend/core/reportQuery';
import {
  LOSS_PRESETS,
  type AreaLossRow, type ContractorLossRow, type LitrePair, type LossFilterOptions, type LossLevels, type LossPreset,
  type MotJourneyLossRow, type MotTesterLossRow, type TankerLossRow, type TransitZmccRow, type WholeLevel, type WholeZmccRow,
} from '@/backend/modules/management-reporting/lossLevelContracts';
import { getPakistanCalendarDate, getPakistanDayWindow, plantVisitDateWhere, type DateBasis } from '@core/business-day';

/**
 * Every figure is received minus sent. signedVariance* is the headline (negative = loss, positive = gain).
 * lossLiters / gainLiters are that same net split by sign, so one of them is always 0; they are never summed on their own.
 * The grossLoss / grossGain fields add up each record's own loss or gain (set where a tier covers many records).
 */
export interface LossMetricResult {
  lossLiters: number;
  lossPercent: number;
  gainLiters: number;
  signedVarianceLiters: number;
  /** Net signed variance / total sent x 100 (negative = loss). */
  signedVariancePercent: number;
  at13tsLossLiters: number;
  at13tsLossPercent: number;
  at13tsGainLiters: number;
  signedVarianceAt13tsLiters: number;
  signedVarianceAt13tsPercent: number;
  isLoss: boolean;
  grossLossLiters?: number;
  grossGainLiters?: number;
  at13tsGrossLossLiters?: number;
  at13tsGrossGainLiters?: number;
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
  adminAdjustmentGrossLiters?: number;
  /** Manual stock removed from the tank (not a dispatch): accounted for as outflow. */
  adminAdjustmentOutGrossLiters?: number;
  totalInwardGrossLiters: number;
  dispatchedGrossLiters: number;
  startingTankStockLiters: number;
  endingTankStockLiters: number;
  deltaTankStockLiters: number;
  totalInwardAt13tsLiters: number;
  adminAdjustmentAt13tsLiters?: number;
  dispatchedAt13tsLiters: number;
  deltaTankStockAt13tsLiters?: number;
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

/** The older four-tier summary (Tier 4 is the Whole figure). The new levels come beside it as `levels`. */
export interface SupplyChainLossSummary {
  period: string;
  startDate: string;
  endDate: string;
  tier1RouteLoss: Tier1RouteLossResult & { label: string };
  tier2ZmccLoss: Tier2ZmccLossResult & { label: string };
  tier3TransitLoss: Tier3TransitLossResult & { label: string; highLossCount: number };
  tier4TotalLoss: Tier4TotalLossResult & { label: string };
  /** Accepted milk that left/closed without unloading; excluded from every loss figure above. */
  acceptedNotReceivedLiters: number;
}

export interface LossReconciliationDetailRow {
  date: string;
  zmccName: string;
  zmccCode: string;
  routeCode?: string;
  vehicleNumber: string;
  driverName?: string;
  referenceNumber?: string;
  // Tier 1. Signed fields are received minus sent: negative = loss, positive = gain.
  shopLiters?: number;
  zmccLiters?: number;
  shopAt13tsLiters?: number;
  zmccAt13tsLiters?: number;
  routeSignedLiters?: number;
  routeSignedPercent?: number;
  routeSignedAt13tsLiters?: number;
  routeSignedAt13tsPercent?: number;
  /** Accepted by lab but never unloaded into the tank (not counted in loss). */
  acceptedNotReceivedLiters?: number;
  // Tier 3
  dispatchedGrossLiters?: number;
  dispatchedAt13tsLiters?: number;
  plantNetKg?: number;
  plantAcceptedLiters?: number;
  plantAcceptedAt13tsLiters?: number;
  transitSignedLiters?: number;
  transitSignedPercent?: number;
  transitSignedAt13tsLiters?: number;
  transitSignedAt13tsPercent?: number;
  /** Alert only: true when the transit LOSS is over 1% (a gain never alerts). */
  isHighTransitLoss?: boolean;
  // Quality
  dispatchLr?: number;
  dispatchFat?: number;
  plantLr?: number;
  plantFat?: number;
  lrDelta?: number;
  fatDelta?: number;
  /** Signed: negative is a loss in rupees, positive a gain. */
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
    signedVariancePercent: signedPercent(signedGrossVar, shopGross) ?? 0,
    at13tsLossLiters: loss13ts,
    at13tsLossPercent: loss13tsPercent,
    at13tsGainLiters: gain13ts,
    signedVarianceAt13tsLiters: signed13tsVar,
    signedVarianceAt13tsPercent: signedPercent(signed13tsVar, shop13ts) ?? 0,
    isLoss: lossLiters > 0,
  };
}

/**
 * Milk received at ZMCC for one weighed portion (pure).
 * Net weight (kg) is the truth: litres = net kg / density. @13 TS litres use the portion TS.
 */
export function calculatePortionReceived(params: {
  netWeightKg: number;
  density?: number | null;
  lr?: number | null;
  ts: number;
}): { grossLiters: number; at13tsLiters: number; density: number } {
  const density =
    params.density != null && Number(params.density) > 0
      ? Number(params.density)
      : calculateDensity(Number(params.lr ?? 0));
  const net = Math.max(0, Number(params.netWeightKg));
  const grossLiters = density > 0 ? Number((net / density).toFixed(2)) : 0;
  const at13tsLiters = Number(calculateAt13TSLiters(grossLiters, Number(params.ts)).toFixed(2));
  return { grossLiters, at13tsLiters, density };
}

/** Net-weight weighted average (pure). Returns 0 when there is no weight. */
export function weightedAverageByNetWeight(rows: Array<{ netWeightKg: number; value: number }>): number {
  const total = rows.reduce((a, r) => a + r.netWeightKg, 0);
  if (total <= 0) return 0;
  return rows.reduce((a, r) => a + r.value * r.netWeightKg, 0) / total;
}

/**
 * Stores Area (MOT) loss / gain on the journey at journey close.
 * Received = ACCEPTED and weighed portions only. Declared = MOT journey summary totals.
 * Signed: received - declared (negative = loss). Writes an audit row.
 */
export async function computeAndStoreAreaLossTx(
  tx: Prisma.TransactionClient,
  params: { journeyId: bigint; sessionId: bigint; actor: ActingContext }
): Promise<{ lossGainLiters: number; lossGainPct: number } | null> {
  const [summary, portions] = await Promise.all([
    tx.motJourneySummary.findUnique({ where: { journey_id: params.journeyId } }),
    tx.zmccLabPortion.findMany({
      where: {
        lab_session_id: params.sessionId,
        final_decision: 'ACCEPTED',
        status: 'WEIGHED', // received (unloaded) milk only
        net_weight_kg: { not: null },
      },
    }),
  ]);
  if (!summary || portions.length === 0) return null;

  let netKg = 0;
  let liters = 0;
  let at13 = 0;
  for (const p of portions) {
    const net = Number(p.net_weight_kg);
    const m = calculatePortionReceived({
      netWeightKg: net,
      density: p.density != null ? Number(p.density) : null,
      lr: p.lr != null ? Number(p.lr) : null,
      ts: Number(p.ts ?? 0),
    });
    netKg += net;
    // The figures saved at unloading are what entered the tank, so route loss always agrees with the receipt.
    liters += p.gross_liters != null ? Number(p.gross_liters) : m.grossLiters;
    at13 += p.at_13ts_liters != null ? Number(p.at_13ts_liters) : m.at13tsLiters;
  }
  netKg = Number(netKg.toFixed(3));
  liters = Number(liters.toFixed(2));
  at13 = Number(at13.toFixed(2));

  const declared = Number(summary.total_gross_liters);
  const declared13 = Number(summary.total_at_13ts_liters);
  const tier1 = calculateTier1RouteLoss({
    shopGrossLiters: declared,
    zmccArrivalGrossLiters: liters,
    shopAt13tsLiters: declared13,
    zmccArrivalAt13tsLiters: at13,
  });
  const signedPct = declared > 0 ? Number(((tier1.signedVarianceLiters / declared) * 100).toFixed(4)) : 0;
  const now = new Date();

  await tx.motJourney.update({
    where: { id: params.journeyId },
    data: {
      area_received_net_kg: new Prisma.Decimal(netKg.toFixed(3)),
      area_received_liters: new Prisma.Decimal(liters.toFixed(2)),
      area_received_at_13ts_liters: new Prisma.Decimal(at13.toFixed(2)),
      area_mot_declared_liters: new Prisma.Decimal(declared.toFixed(2)),
      area_mot_declared_at_13ts_liters: new Prisma.Decimal(declared13.toFixed(2)),
      area_loss_gain_liters: new Prisma.Decimal(tier1.signedVarianceLiters.toFixed(2)),
      area_loss_gain_at_13ts_liters: new Prisma.Decimal(tier1.signedVarianceAt13tsLiters.toFixed(2)),
      area_loss_gain_pct: new Prisma.Decimal(signedPct.toFixed(4)),
      area_computed_at: now,
    },
  });

  await writeAuditLog(tx, {
    tableName: 'mot_journey',
    recordId: params.journeyId,
    action: 'MOT_AREA_LOSS_GAIN_STORED',
    newValues: {
      lab_session_id: params.sessionId.toString(),
      accepted_portions: portions.length,
      received_net_kg: netKg,
      received_liters: liters,
      declared_liters: declared,
      loss_gain_liters: tier1.signedVarianceLiters,
      loss_gain_pct: signedPct,
    },
    actor: params.actor,
  });

  return { lossGainLiters: tier1.signedVarianceLiters, lossGainPct: signedPct };
}

/**
 * Calculates Tier 2 (ZMCC Process & Chilling Loss):
 * ZMCC Loss = (Total MOT Inward + Total HC Inward + Admin Adjustment Inward) - Dispatched Tankers - Admin Adjustment Outward - Delta Tank Stock
 * The @13 TS figures follow the same equation with the @13 TS stock movement.
 */
export function calculateTier2ZmccLoss(params: {
  motInwardGrossLiters: number;
  localInwardGrossLiters: number;
  adminAdjustmentGrossLiters?: number;
  adminAdjustmentOutGrossLiters?: number;
  dispatchedGrossLiters: number;
  startingTankStockLiters: number;
  endingTankStockLiters: number;
  motInwardAt13tsLiters?: number;
  localInwardAt13tsLiters?: number;
  adminAdjustmentAt13tsLiters?: number;
  adminAdjustmentOutAt13tsLiters?: number;
  dispatchedAt13tsLiters?: number;
  startingTankStockAt13tsLiters?: number;
  endingTankStockAt13tsLiters?: number;
}): Tier2ZmccLossResult {
  const motInward = Math.max(0, Number(params.motInwardGrossLiters.toFixed(2)));
  const localInward = Math.max(0, Number(params.localInwardGrossLiters.toFixed(2)));
  const adminInward = Math.max(0, Number((params.adminAdjustmentGrossLiters ?? 0).toFixed(2)));
  const totalInward = Number((motInward + localInward + adminInward).toFixed(2));
  const dispatched = Math.max(0, Number(params.dispatchedGrossLiters.toFixed(2)));
  const adminOutward = Math.max(0, Number((params.adminAdjustmentOutGrossLiters ?? 0).toFixed(2)));
  const startStock = Math.max(0, Number(params.startingTankStockLiters.toFixed(2)));
  const endStock = Math.max(0, Number(params.endingTankStockLiters.toFixed(2)));
  const deltaStock = Number((endStock - startStock).toFixed(2));

  // Expected stock remaining or accounted for: totalInward - dispatched - adminOutward
  // Actual physical change: deltaStock
  // Variance = (dispatched + adminOutward + deltaStock) - totalInward (negative is loss)
  const accountedLiters = Number((dispatched + adminOutward + deltaStock).toFixed(2));
  const signedGrossVar = Number((accountedLiters - totalInward).toFixed(2));
  const lossLiters = signedGrossVar < 0 ? Math.abs(signedGrossVar) : 0;
  const gainLiters = signedGrossVar > 0 ? signedGrossVar : 0;
  const lossPercent = totalInward > 0 ? Number(((lossLiters / totalInward) * 100).toFixed(4)) : 0;

  const mot13ts = Math.max(0, Number((params.motInwardAt13tsLiters ?? 0).toFixed(2)));
  const local13ts = Math.max(0, Number((params.localInwardAt13tsLiters ?? 0).toFixed(2)));
  const admin13ts = Math.max(0, Number((params.adminAdjustmentAt13tsLiters ?? 0).toFixed(2)));
  const totalInward13ts = Number((mot13ts + local13ts + admin13ts).toFixed(2));
  const dispatched13ts = Math.max(0, Number((params.dispatchedAt13tsLiters ?? 0).toFixed(2)));
  const adminOutward13ts = Math.max(0, Number((params.adminAdjustmentOutAt13tsLiters ?? 0).toFixed(2)));
  const startStock13ts = Math.max(0, Number((params.startingTankStockAt13tsLiters ?? 0).toFixed(2)));
  const endStock13ts = Math.max(0, Number((params.endingTankStockAt13tsLiters ?? 0).toFixed(2)));
  const deltaStock13ts = Number((endStock13ts - startStock13ts).toFixed(2));
  const signed13tsVar = Number((dispatched13ts + adminOutward13ts + deltaStock13ts - totalInward13ts).toFixed(2));
  const loss13ts = signed13tsVar < 0 ? Math.abs(signed13tsVar) : 0;
  const gain13ts = signed13tsVar > 0 ? signed13tsVar : 0;
  const loss13tsPercent = totalInward13ts > 0 ? Number(((loss13ts / totalInward13ts) * 100).toFixed(4)) : 0;

  return {
    motInwardGrossLiters: motInward,
    localInwardGrossLiters: localInward,
    adminAdjustmentGrossLiters: adminInward,
    adminAdjustmentOutGrossLiters: adminOutward,
    deltaTankStockAt13tsLiters: deltaStock13ts,
    totalInwardGrossLiters: totalInward,
    dispatchedGrossLiters: dispatched,
    startingTankStockLiters: startStock,
    endingTankStockLiters: endStock,
    deltaTankStockLiters: deltaStock,
    totalInwardAt13tsLiters: totalInward13ts,
    adminAdjustmentAt13tsLiters: admin13ts,
    dispatchedAt13tsLiters: dispatched13ts,
    lossLiters,
    lossPercent,
    gainLiters,
    signedVarianceLiters: signedGrossVar,
    signedVariancePercent: signedPercent(signedGrossVar, totalInward) ?? 0,
    at13tsLossLiters: loss13ts,
    at13tsLossPercent: loss13tsPercent,
    at13tsGainLiters: gain13ts,
    signedVarianceAt13tsLiters: signed13tsVar,
    signedVarianceAt13tsPercent: signedPercent(signed13tsVar, totalInward13ts) ?? 0,
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
    signedVariancePercent: signedPercent(signedGrossVar, dispatched) ?? 0,
    at13tsLossLiters: loss13ts,
    at13tsLossPercent: loss13tsPercent,
    at13tsGainLiters: gain13ts,
    signedVarianceAt13tsLiters: signed13tsVar,
    signedVarianceAt13tsPercent: signedPercent(signed13tsVar, dispatched13ts) ?? 0,
    isHighLoss,
    isLoss: lossLiters > 0,
  };
}

/**
 * Calculates Tier 4 (Whole Loss / Gain, older shape):
 * the NET of the three tiers' signed variances, so a gain in one tier offsets a loss in another.
 * Percent is the net signed variance over the total intake.
 */
export function calculateTier4TotalLoss(
  tier1: Tier1RouteLossResult,
  tier2: Tier2ZmccLossResult,
  tier3: Tier3TransitLossResult
): Tier4TotalLossResult {
  const signedGrossVar = Number((tier1.signedVarianceLiters + tier2.signedVarianceLiters + tier3.signedVarianceLiters).toFixed(2));
  const totalLossLiters = signedGrossVar < 0 ? Math.abs(signedGrossVar) : 0;
  const totalGainLiters = signedGrossVar > 0 ? signedGrossVar : 0;

  const adminGross = Math.max(0, Number((tier2.adminAdjustmentGrossLiters ?? 0).toFixed(2)));
  const totalIntakeLiters = Number((tier1.shopGrossLiters + tier2.localInwardGrossLiters + adminGross).toFixed(2));
  const totalPlantLiters = tier3.plantAcceptedGrossLiters;

  const signed13tsVar = Number((tier1.signedVarianceAt13tsLiters + tier2.signedVarianceAt13tsLiters + tier3.signedVarianceAt13tsLiters).toFixed(2));
  const totalLoss13ts = signed13tsVar < 0 ? Math.abs(signed13tsVar) : 0;
  const totalGain13ts = signed13tsVar > 0 ? signed13tsVar : 0;
  const nonMot13ts = Math.max(0, Number((tier2.totalInwardAt13tsLiters - (tier1.shopGrossLiters > 0 ? tier1.zmccArrivalAt13tsLiters : 0)).toFixed(2)));
  const totalIntake13ts = Number((tier1.shopAt13tsLiters + (tier1.shopGrossLiters > 0 ? nonMot13ts : tier2.totalInwardAt13tsLiters)).toFixed(2));

  const signedPct = signedPercent(signedGrossVar, totalIntakeLiters) ?? 0;
  const signed13tsPct = signedPercent(signed13tsVar, totalIntake13ts) ?? 0;

  return {
    totalInitialIntakeLiters: totalIntakeLiters,
    totalFinalPlantLiters: totalPlantLiters,
    totalInitialIntakeAt13tsLiters: totalIntake13ts,
    totalFinalPlantAt13tsLiters: tier3.plantAcceptedAt13tsLiters,
    lossLiters: totalLossLiters,
    lossPercent: signedGrossVar < 0 ? Math.abs(signedPct) : 0,
    gainLiters: totalGainLiters,
    signedVarianceLiters: signedGrossVar,
    signedVariancePercent: signedPct,
    at13tsLossLiters: totalLoss13ts,
    at13tsLossPercent: signed13tsVar < 0 ? Math.abs(signed13tsPct) : 0,
    at13tsGainLiters: totalGain13ts,
    signedVarianceAt13tsLiters: signed13tsVar,
    signedVarianceAt13tsPercent: signed13tsPct,
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
): {
  /** For @db.Date columns such as operational_date. */
  startDate: Date;
  endDate: Date;
  /** For timestamp columns: the same Pakistan days, as real instants. */
  timestampStart: Date;
  timestampEnd: Date;
  label: string;
} {
  const now = new Date();
  const todayStr = getPakistanCalendarDate(now);
  const pakistanDays = (startStr: string, endStr: string, label: string) => {
    const first = getPakistanDayWindow(startStr);
    const last = getPakistanDayWindow(endStr);
    return { startDate: first.dateStart, endDate: last.dateEnd, timestampStart: first.start, timestampEnd: last.end, label };
  };

  if (period === 'custom' && customFrom) {
    const range = pakistanDays(
      typeof customFrom === 'string' ? customFrom : todayStr,
      typeof customTo === 'string' ? customTo : todayStr,
      'Custom Range',
    );
    if (customFrom instanceof Date) {
      range.startDate = customFrom;
      range.timestampStart = customFrom;
    }
    if (customTo instanceof Date || !customTo) {
      range.endDate = customTo instanceof Date ? customTo : now;
      range.timestampEnd = range.endDate;
    }
    return range;
  }

  if (period === 'wtd') {
    // Week starts Monday
    const today = new Date(`${todayStr}T00:00:00.000Z`);
    const day = today.getUTCDay();
    const diff = (day === 0 ? 6 : day - 1);
    today.setUTCDate(today.getUTCDate() - diff);
    return pakistanDays(today.toISOString().split('T')[0], todayStr, 'Weekly (WTD)');
  }

  if (period === 'mtd') {
    return pakistanDays(`${todayStr.slice(0, 7)}-01`, todayStr, 'Monthly (MTD)');
  }

  // Default: today
  return pakistanDays(todayStr, todayStr, 'Daily (Today)');
}


// -------------------------------------------------------------
// PRESET RANGES AND FILTER PARSING
// -------------------------------------------------------------

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const DIGITS = /^\d{1,18}$/;
const MAX_FILTER_IDS = 200;

function shiftDay(dateStr: string, days: number): string {
  return new Date(Date.parse(`${dateStr}T00:00:00.000Z`) + days * 86400000).toISOString().slice(0, 10);
}

function isRealDate(value: string): boolean {
  if (!DATE_ONLY.test(value)) return false;
  const t = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === value;
}

export const LOSS_PRESET_LABELS: Record<LossPreset, string> = {
  TODAY: 'Today',
  YESTERDAY: 'Yesterday',
  LAST_7: 'Last 7 days',
  LAST_30: 'Last 30 days',
  MTD: 'Month to date',
  LAST_MONTH: 'Last month',
  QTD: 'Quarter to date',
  YTD: 'Year to date',
};

/** The Pakistan days a preset covers, in the same shape as resolvePeriodDateRange plus the day strings. */
export function resolveLossPresetRange(preset: LossPreset, now: Date = new Date()) {
  const today = getPakistanCalendarDate(now);
  let from = today;
  let to = today;
  if (preset === 'YESTERDAY') {
    from = shiftDay(today, -1);
    to = from;
  } else if (preset === 'LAST_7') {
    from = shiftDay(today, -6);
  } else if (preset === 'LAST_30') {
    from = shiftDay(today, -29);
  } else if (preset === 'MTD') {
    from = `${today.slice(0, 7)}-01`;
  } else if (preset === 'LAST_MONTH') {
    const firstThisMonth = `${today.slice(0, 7)}-01`;
    to = shiftDay(firstThisMonth, -1);
    from = `${to.slice(0, 7)}-01`;
  } else if (preset === 'QTD') {
    const month = Number(today.slice(5, 7));
    const quarterStart = month - ((month - 1) % 3);
    from = `${today.slice(0, 4)}-${String(quarterStart).padStart(2, '0')}-01`;
  } else if (preset === 'YTD') {
    from = `${today.slice(0, 4)}-01-01`;
  }
  const first = getPakistanDayWindow(from);
  const last = getPakistanDayWindow(to);
  return {
    startDate: first.dateStart,
    endDate: last.dateEnd,
    timestampStart: first.start,
    timestampEnd: last.end,
    label: LOSS_PRESET_LABELS[preset],
    from,
    to,
  };
}

export interface LossFilters {
  /** New: TODAY, YESTERDAY, LAST_7, LAST_30, MTD. Wins over `period`. */
  preset?: LossPreset;
  /** Older callers: today, wtd, mtd, or custom with from / to. */
  period?: 'today' | 'wtd' | 'mtd' | 'custom';
  from?: string;
  to?: string;
  /** One ZMCC (older callers). */
  zmccId?: string | bigint;
  /** Empty or missing = every ZMCC. */
  zmccIds?: Array<string | bigint>;
  /** Empty or missing = every contractor. */
  contractorIds?: Array<string | bigint>;
  /** Narrows the MOT and Area levels only. */
  motProfileId?: string | bigint;
  /** How plant vehicles are placed on a day; ZMCC and MOT figures always use the calendar day. */
  dateBasis?: DateBasis;
  /** False for a ZMCC manager: contractor tankers are not theirs. */
  includeContractor?: boolean;
}

export type ParsedLossQuery =
  | { ok: true; filters: LossFilters }
  | { ok: false; status: 400 | 403; error: string };

function parseIdList(values: string[], label: string): { ok: true; ids: string[] } | { ok: false; error: string } {
  const ids: string[] = [];
  for (const raw of values) {
    for (const piece of raw.split(',')) {
      const v = piece.trim();
      if (!v) continue;
      if (!DIGITS.test(v)) return { ok: false, error: `${label} must be numbers only.` };
      const normal = BigInt(v).toString();
      if (!ids.includes(normal)) ids.push(normal);
    }
  }
  if (ids.length > MAX_FILTER_IDS) return { ok: false, error: `Pick at most ${MAX_FILTER_IDS} ${label.toLowerCase()}.` };
  return { ok: true, ids };
}

/**
 * Reads the shared filter parameters of the loss screens: preset or from/to (or the older period), zmccIds, contractorIds,
 * motProfileId. A ZMCC manager is locked to their own ZMCC whatever they send.
 */
export function parseLossQuery(
  params: URLSearchParams,
  ctx: { role: string; managerZmccId?: bigint | null; defaultPreset: LossPreset; today?: string }
): ParsedLossQuery {
  const today = ctx.today ?? getPakistanCalendarDate();
  const filters: LossFilters = {};

  const zmccs = parseIdList([...params.getAll('zmccIds'), ...params.getAll('zmccId')], 'ZMCC ids');
  if (!zmccs.ok) return { ok: false, status: 400, error: zmccs.error };
  const contractors = parseIdList(params.getAll('contractorIds'), 'Contractor ids');
  if (!contractors.ok) return { ok: false, status: 400, error: contractors.error };
  const profile = parseIdList(params.getAll('motProfileId'), 'Mobile Tester id');
  if (!profile.ok) return { ok: false, status: 400, error: profile.error };
  if (profile.ids.length > 1) return { ok: false, status: 400, error: 'Pick one Mobile Tester.' };

  if (ctx.role === 'ZMCC_MANAGER') {
    if (!ctx.managerZmccId) return { ok: false, status: 403, error: 'No ZMCC is assigned to this account.' };
    filters.zmccIds = [ctx.managerZmccId.toString()];
    filters.contractorIds = [];
    filters.includeContractor = false;
  } else {
    filters.zmccIds = zmccs.ids;
    filters.contractorIds = contractors.ids;
  }
  if (profile.ids[0]) filters.motProfileId = profile.ids[0];

  const from = params.get('from')?.trim() || undefined;
  const to = params.get('to')?.trim() || undefined;
  const presetRaw = params.get('preset')?.trim().toUpperCase();
  const periodRaw = params.get('period')?.trim().toLowerCase();

  if (from || to) {
    if ((from && !isRealDate(from)) || (to && !isRealDate(to))) {
      return { ok: false, status: 400, error: 'Dates must look like 2026-03-31.' };
    }
    const start = from ?? to!;
    const end = to ?? today;
    if (start > end) return { ok: false, status: 400, error: 'The start date is after the end date.' };
    const rangeError = reportRangeError(start, end, today);
    if (rangeError) return { ok: false, status: 400, error: rangeError };
    filters.period = 'custom';
    filters.from = start;
    filters.to = end;
  } else if (presetRaw) {
    if (!(LOSS_PRESETS as readonly string[]).includes(presetRaw)) {
      return { ok: false, status: 400, error: 'Pick Today, Yesterday, Last 7 days, Last 30 days or Month to date.' };
    }
    filters.preset = presetRaw as LossPreset;
  } else if (periodRaw === 'today' || periodRaw === 'wtd' || periodRaw === 'mtd') {
    filters.period = periodRaw;
  } else {
    filters.preset = ctx.defaultPreset;
  }
  return { ok: true, filters };
}

/** A stable text for a filter, used as part of a cache key. */
export function lossFilterCacheKey(filters: LossFilters): string {
  const ids = (list?: Array<string | bigint>) => [...new Set((list ?? []).map((v) => String(v)))].sort().join(',');
  const zmccs = ids([...(filters.zmccIds ?? []), ...(filters.zmccId ? [filters.zmccId] : [])]);
  return [
    filters.preset ?? filters.period ?? 'today',
    filters.from ?? '',
    filters.to ?? '',
    zmccs,
    ids(filters.contractorIds),
    filters.motProfileId ? String(filters.motProfileId) : '',
    filters.dateBasis ?? 'calendar',
    filters.includeContractor === false ? 'nc' : '',
  ].join('|');
}

function normalizeIds(list?: Array<string | bigint>, single?: string | bigint): bigint[] {
  const out = new Map<string, bigint>();
  for (const v of [...(list ?? []), ...(single ? [single] : [])]) {
    const s = String(v).trim();
    if (!DIGITS.test(s)) throw new Error('Ids must be numbers only.');
    out.set(BigInt(s).toString(), BigInt(s));
  }
  return [...out.values()];
}

/** The Pakistan dates a set of loss filters covers (preset or from / to). */
export function resolveLossRange(filters: LossFilters): { from: string; to: string; label?: string } {
  return resolveRange(filters);
}

function resolveRange(filters: LossFilters) {
  if (filters.preset) return resolveLossPresetRange(filters.preset);
  const range = resolvePeriodDateRange(filters.period || 'today', filters.from, filters.to);
  return {
    ...range,
    from: range.startDate.toISOString().slice(0, 10),
    to: range.endDate.toISOString().slice(0, 10),
  };
}

// -------------------------------------------------------------
// LEVELS (pure): MOT, Area, Transit, Whole, Contractor Transit
// -------------------------------------------------------------

export interface LevelJourneyInput {
  id: string;
  number: string;
  date: string;
  zmccId: string;
  zmccName: string;
  zmccCode: string;
  routeCode: string | null;
  vehicleNumber: string | null;
  profileId: string;
  profileName: string;
  profileCode: string | null;
  shopGross: number;
  shop13ts: number;
  receivedGross: number;
  /** Null = not recorded. It is never taken from gross. */
  received13ts: number | null;
  acceptedNotReceived: number;
}

export interface LevelTankerInput {
  id: string;
  visitNumber: string;
  date: string;
  sourceId: string | null;
  sourceName: string;
  sourceCode: string;
  vehicleNumber: string;
  referenceNumber: string;
  status: string;
  dispatchedGross: number;
  dispatched13ts: number | null;
  /** Set only when the plant has reconciled the tanker. */
  plant: { gross: number; at13ts: number | null } | null;
  plantNetKg: number;
}

export interface LevelsInput {
  zmccNames: Map<string, { name: string; code: string }>;
  /** Every completed journey in scope (not narrowed by Mobile Tester: Whole needs them all). */
  journeys: LevelJourneyInput[];
  motProfileId?: string | null;
  hc: Map<string, { gross: number; at13ts: number }>;
  stock: Map<string, { startGross: number; endGross: number; start13ts: number; end13ts: number }>;
  admin: Map<string, { inGross: number; outGross: number; in13ts: number; out13ts: number }>;
  tankers: LevelTankerInput[];
  contractorTankers: LevelTankerInput[];
  acceptedNotReceivedLiters: number;
}

interface ZState {
  id: string;
  shopG: number; shop13: number;
  motG: number; mot13: number;
  hcG: number; hc13: number;
  dispG: number; disp13: number; missingDisp13: number;
  recDispG: number; recDisp13: number;
  plantG: number; plant13: number;
  dStockG: number; dStock13: number;
  adminG: number; admin13: number;
  flightG: number; flight13: number; flightN: number;
  road: FigureTotals;
}

function newZ(id: string): ZState {
  return {
    id, shopG: 0, shop13: 0, motG: 0, mot13: 0, hcG: 0, hc13: 0, dispG: 0, disp13: 0, missingDisp13: 0,
    recDispG: 0, recDisp13: 0, plantG: 0, plant13: 0, dStockG: 0, dStock13: 0, adminG: 0, admin13: 0,
    flightG: 0, flight13: 0, flightN: 0, road: emptyFigureTotals(),
  };
}

/** A pair from hundredths: sent and signed. A loss or gain counts once per group it is added for. */
function addSignedCents(t: PairTotals, sentC: number, signedC: number): void {
  t.sent += sentC;
  t.received += sentC + signedC;
  if (signedC < 0) t.loss += -signedC;
  else t.gain += signedC;
}

function litres(g: number, t13: number): LitrePair {
  return { at13ts: fromCents(t13), gross: fromCents(g) };
}

function tankerFigure(t: LevelTankerInput): LossFigure | null {
  if (!t.plant) return null;
  const totals = emptyFigureTotals();
  const has13 = t.dispatched13ts != null;
  addToFigureTotals(totals, {
    sentGross: t.dispatchedGross,
    receivedGross: t.plant.gross,
    sent13ts: t.dispatched13ts,
    received13ts: has13 ? t.plant.at13ts : null,
  });
  return figureFromTotals(totals);
}

function tankerRow(t: LevelTankerInput): TankerLossRow {
  const figure = tankerFigure(t);
  const pct = figure ? figure.at13ts.percent ?? figure.gross.percent : null;
  return {
    visitId: t.id,
    visitNumber: t.visitNumber,
    date: t.date,
    sourceId: t.sourceId,
    sourceName: t.sourceName,
    sourceCode: t.sourceCode,
    vehicleNumber: t.vehicleNumber,
    referenceNumber: t.referenceNumber,
    status: t.status,
    reconciled: Boolean(t.plant),
    dispatched: { gross: t.dispatchedGross, at13ts: t.dispatched13ts },
    plantReceived: t.plant ? { gross: t.plant.gross, at13ts: t.plant.at13ts } : null,
    plantNetKg: t.plantNetKg,
    figure,
    isHighLoss: pct != null && pct < -1.0,
  };
}

/**
 * The five levels from plain data. Money-free, side-effect-free, and exact: everything adds up in hundredths of a litre.
 * Whole = MOT + Transit by construction, and `whole.reconciles` re-checks it from separate sums.
 */
export function buildLossLevels(input: LevelsInput): Omit<LossLevels, 'filters'> {
  const zs = new Map<string, ZState>();
  const z = (id: string) => {
    let s = zs.get(id);
    if (!s) { s = newZ(id); zs.set(id, s); }
    return s;
  };

  // 1. MOT: every journey counts for Whole; the Mobile Tester filter narrows only the MOT and Area views.
  const motAll = emptyFigureTotals();
  const testers = new Map<string, { row: MotTesterLossRow; totals: FigureTotals }>();
  const areaZ = new Map<string, { totals: FigureTotals; testers: Set<string>; journeys: number }>();
  const motTotals = emptyFigureTotals();

  for (const j of input.journeys) {
    const s = z(j.zmccId);
    s.shopG += toCents(j.shopGross);
    s.shop13 += toCents(j.shop13ts);
    s.motG += toCents(j.receivedGross);
    s.mot13 += toCents(j.received13ts);
    addToFigureTotals(motAll, { sentGross: j.shopGross, receivedGross: j.receivedGross, sent13ts: j.shop13ts, received13ts: j.received13ts });

    if (input.motProfileId && j.profileId !== input.motProfileId) continue;
    const rec = { sentGross: j.shopGross, receivedGross: j.receivedGross, sent13ts: j.shop13ts, received13ts: j.received13ts };
    const own = emptyFigureTotals();
    addToFigureTotals(own, rec);
    addToFigureTotals(motTotals, rec);
    const row: MotJourneyLossRow = {
      journeyId: j.id,
      journeyNumber: j.number,
      date: j.date,
      zmccId: j.zmccId,
      zmccName: j.zmccName,
      zmccCode: j.zmccCode,
      routeCode: j.routeCode,
      vehicleNumber: j.vehicleNumber,
      motProfileId: j.profileId,
      motName: j.profileName,
      shop: { gross: j.shopGross, at13ts: j.shop13ts },
      received: { gross: j.receivedGross, at13ts: j.received13ts },
      figure: figureFromTotals(own),
      acceptedNotReceivedLiters: j.acceptedNotReceived,
    };
    let t = testers.get(j.profileId);
    if (!t) {
      t = {
        row: { motProfileId: j.profileId, name: j.profileName, code: j.profileCode, zmccId: j.zmccId, zmccName: j.zmccName, total: figureFromTotals(emptyFigureTotals()), journeys: [] },
        totals: emptyFigureTotals(),
      };
      testers.set(j.profileId, t);
    }
    addToFigureTotals(t.totals, rec);
    t.row.journeys.push(row);
    let a = areaZ.get(j.zmccId);
    if (!a) { a = { totals: emptyFigureTotals(), testers: new Set(), journeys: 0 }; areaZ.set(j.zmccId, a); }
    addToFigureTotals(a.totals, rec);
    a.testers.add(j.profileId);
    a.journeys += 1;
  }

  const testerRows = [...testers.values()].map((t) => {
    t.row.total = figureFromTotals(t.totals);
    t.row.journeys.sort((a, b) => b.date.localeCompare(a.date) || a.journeyNumber.localeCompare(b.journeyNumber));
    return t.row;
  }).sort((a, b) => a.name.localeCompare(b.name));

  const nameOf = (id: string) => input.zmccNames.get(id) ?? { name: `ZMCC #${id}`, code: '' };
  const areaRows: AreaLossRow[] = [...areaZ.entries()].map(([id, a]) => ({
    zmccId: id,
    zmccName: nameOf(id).name,
    zmccCode: nameOf(id).code,
    total: figureFromTotals(a.totals),
    journeyCount: a.journeys,
    testerCount: a.testers.size,
  })).sort((a, b) => a.zmccName.localeCompare(b.zmccName));

  // 2. Sources of the transit level: HC receipts, tank stock, admin adjustments, tankers.
  for (const [id, h] of input.hc) {
    const s = z(id);
    s.hcG += toCents(h.gross);
    s.hc13 += toCents(h.at13ts);
  }
  for (const [id, st] of input.stock) {
    const s = z(id);
    s.dStockG += toCents(st.endGross) - toCents(st.startGross);
    s.dStock13 += toCents(st.end13ts) - toCents(st.start13ts);
  }
  for (const [id, a] of input.admin) {
    const s = z(id);
    s.adminG += toCents(a.inGross) - toCents(a.outGross);
    s.admin13 += toCents(a.in13ts) - toCents(a.out13ts);
  }

  const tankerRows: TankerLossRow[] = [];
  for (const t of input.tankers) {
    tankerRows.push(tankerRow(t));
    if (!t.sourceId) continue;
    const s = z(t.sourceId);
    s.dispG += toCents(t.dispatchedGross);
    s.disp13 += toCents(t.dispatched13ts);
    if (t.dispatched13ts == null) s.missingDisp13 += 1;
    if (t.plant) {
      const has13 = t.dispatched13ts != null;
      s.recDispG += toCents(t.dispatchedGross);
      s.plantG += toCents(t.plant.gross);
      if (has13) {
        s.recDisp13 += toCents(t.dispatched13ts);
        s.plant13 += toCents(t.plant.at13ts);
      }
      addToFigureTotals(s.road, {
        sentGross: t.dispatchedGross,
        receivedGross: t.plant.gross,
        sent13ts: t.dispatched13ts,
        received13ts: has13 ? t.plant.at13ts : null,
      });
    } else {
      s.flightG += toCents(t.dispatchedGross);
      s.flight13 += toCents(t.dispatched13ts);
      s.flightN += 1;
    }
  }
  tankerRows.sort((a, b) => b.date.localeCompare(a.date) || a.visitNumber.localeCompare(b.visitNumber));

  // 3. Per ZMCC: Transit (At ZMCC, On road), Whole lines.
  const atTotals = emptyFigureTotals();
  const roadTotals = emptyFigureTotals();
  const netTotals = emptyFigureTotals();
  const wholeNetTotals = emptyFigureTotals();
  const totalFlows = { motG: 0, mot13: 0, hcG: 0, hc13: 0, dispG: 0, disp13: 0, dStockG: 0, dStock13: 0 };
  const sumLines = {
    shopG: 0, shop13: 0, hcG: 0, hc13: 0, stockG: 0, stock13: 0, roadG: 0, road13: 0, plantG: 0, plant13: 0, adminG: 0, admin13: 0,
    flightG: 0, flight13: 0, flightN: 0,
  };
  const transitRows: TransitZmccRow[] = [];
  const wholeRows: WholeZmccRow[] = [];

  for (const s of zs.values()) {
    const inG = s.motG + s.hcG;
    const in13 = s.mot13 + s.hc13;
    const stockG = s.dStockG - s.adminG;
    const stock13 = s.dStock13 - s.admin13;
    const aG = s.dispG + stockG - inG;
    const a13 = s.disp13 + stock13 - in13;
    const bG = s.plantG - s.recDispG;
    const b13 = s.plant13 - s.recDisp13;
    const active = inG || in13 || s.dispG || s.disp13 || s.shopG || s.hcG || stockG || s.adminG || s.flightN || s.road.records;
    if (!active) continue;

    const at: FigureTotals = emptyFigureTotals();
    addSignedCents(at.gross, inG, aG);
    addSignedCents(at.at13ts, in13, a13);
    at.records = 1;
    at.missing13ts = s.missingDisp13;
    const net: FigureTotals = emptyFigureTotals();
    addSignedCents(net.gross, inG, aG + bG);
    addSignedCents(net.at13ts, in13, a13 + b13);
    net.records = 1;
    net.missing13ts = s.missingDisp13 + s.road.missing13ts;
    mergeFigureTotals(atTotals, at);
    mergeFigureTotals(roadTotals, s.road);
    mergeFigureTotals(netTotals, net);

    totalFlows.motG += s.motG; totalFlows.mot13 += s.mot13; totalFlows.hcG += s.hcG; totalFlows.hc13 += s.hc13;
    totalFlows.dispG += s.dispG; totalFlows.disp13 += s.disp13; totalFlows.dStockG += stockG; totalFlows.dStock13 += stock13;

    const info = nameOf(s.id);
    transitRows.push({
      zmccId: s.id,
      zmccName: info.name,
      zmccCode: info.code,
      atZmcc: figureFromTotals(at),
      onRoad: figureFromTotals(s.road),
      net: figureFromTotals(net),
      flows: {
        motIn: litres(s.motG, s.mot13),
        hcIn: litres(s.hcG, s.hc13),
        totalIn: litres(inG, in13),
        dispatched: litres(s.dispG, s.disp13),
        stockChange: litres(stockG, stock13),
      },
      inFlight: { ...litres(s.flightG, s.flight13), tankers: s.flightN },
    });

    // Whole: bought vs (plant received + still in tanks + on the road).
    const boughtG = s.shopG + s.hcG;
    const bought13 = s.shop13 + s.hc13;
    const roadG = s.dispG - s.recDispG;
    const road13 = s.disp13 - s.recDisp13;
    const wG = s.plantG + stockG + roadG - boughtG;
    const w13 = s.plant13 + stock13 + road13 - bought13;
    const wt: FigureTotals = emptyFigureTotals();
    addSignedCents(wt.gross, boughtG, wG);
    addSignedCents(wt.at13ts, bought13, w13);
    mergeFigureTotals(wholeNetTotals, wt);
    sumLines.shopG += s.shopG; sumLines.shop13 += s.shop13; sumLines.hcG += s.hcG; sumLines.hc13 += s.hc13;
    sumLines.stockG += stockG; sumLines.stock13 += stock13; sumLines.roadG += roadG; sumLines.road13 += road13;
    sumLines.plantG += s.plantG; sumLines.plant13 += s.plant13; sumLines.adminG += s.adminG; sumLines.admin13 += s.admin13;
    sumLines.flightG += s.flightG; sumLines.flight13 += s.flight13; sumLines.flightN += s.flightN;

    wholeRows.push({
      zmccId: s.id,
      zmccName: info.name,
      zmccCode: info.code,
      lines: {
        boughtShop: litres(s.shopG, s.shop13),
        boughtHc: litres(s.hcG, s.hc13),
        bought: litres(boughtG, bought13),
        stockChange: litres(stockG, stock13),
        onRoad: litres(roadG, road13),
        plantReceived: litres(s.plantG, s.plant13),
        adminAdjustment: litres(s.adminG, s.admin13),
        acceptedNotReceivedLiters: 0,
      },
      net: {
        at13ts: pairFromTotals(wt.at13ts),
        gross: pairFromTotals(wt.gross),
      },
      netWithAdmin: litres(wG + s.adminG, w13 + s.admin13),
    });
  }
  transitRows.sort((a, b) => a.zmccName.localeCompare(b.zmccName));
  wholeRows.sort((a, b) => a.zmccName.localeCompare(b.zmccName));

  const wholeNetG = wholeNetTotals.gross.received - wholeNetTotals.gross.sent;
  const whole13 = wholeNetTotals.at13ts.received - wholeNetTotals.at13ts.sent;
  const motNetG = motAll.gross.received - motAll.gross.sent;
  const mot13 = motAll.at13ts.received - motAll.at13ts.sent;
  const transitNetG = netTotals.gross.received - netTotals.gross.sent;
  const transit13 = netTotals.at13ts.received - netTotals.at13ts.sent;

  const whole: WholeLevel = {
    lines: {
      boughtShop: litres(sumLines.shopG, sumLines.shop13),
      boughtHc: litres(sumLines.hcG, sumLines.hc13),
      bought: litres(sumLines.shopG + sumLines.hcG, sumLines.shop13 + sumLines.hc13),
      stockChange: litres(sumLines.stockG, sumLines.stock13),
      onRoad: litres(sumLines.roadG, sumLines.road13),
      plantReceived: litres(sumLines.plantG, sumLines.plant13),
      adminAdjustment: litres(sumLines.adminG, sumLines.admin13),
      acceptedNotReceivedLiters: input.acceptedNotReceivedLiters,
    },
    net: { at13ts: pairFromTotals(wholeNetTotals.at13ts), gross: pairFromTotals(wholeNetTotals.gross) },
    netWithAdmin: litres(wholeNetG + sumLines.adminG, whole13 + sumLines.admin13),
    byZmcc: wholeRows,
    reconciles: wholeNetG === motNetG + transitNetG && whole13 === mot13 + transit13,
  };

  // 4. Contractor transit (not part of Whole): reconciled tankers only.
  const byContractor = new Map<string, { row: ContractorLossRow; totals: FigureTotals }>();
  const contractorTotals = emptyFigureTotals();
  let pendingContractor = 0;
  for (const t of input.contractorTankers) {
    const key = t.sourceId ?? 'none';
    let c = byContractor.get(key);
    if (!c) {
      c = {
        row: { contractorId: key, name: t.sourceName, code: t.sourceCode, total: figureFromTotals(emptyFigureTotals()), tankers: [], pendingTankers: 0 },
        totals: emptyFigureTotals(),
      };
      byContractor.set(key, c);
    }
    const row = tankerRow(t);
    c.row.tankers.push(row);
    if (!t.plant) {
      c.row.pendingTankers += 1;
      pendingContractor += 1;
      continue;
    }
    const has13 = t.dispatched13ts != null;
    const rec = { sentGross: t.dispatchedGross, receivedGross: t.plant.gross, sent13ts: t.dispatched13ts, received13ts: has13 ? t.plant.at13ts : null };
    addToFigureTotals(c.totals, rec);
    addToFigureTotals(contractorTotals, rec);
  }
  const contractorRows = [...byContractor.values()].map((c) => {
    c.row.total = figureFromTotals(c.totals);
    c.row.tankers.sort((a, b) => b.date.localeCompare(a.date) || a.visitNumber.localeCompare(b.visitNumber));
    return c.row;
  }).sort((a, b) => a.name.localeCompare(b.name));

  return {
    mot: { total: figureFromTotals(motTotals), testers: testerRows },
    area: { total: figureFromTotals(motTotals), zmccs: areaRows },
    transit: {
      atZmcc: figureFromTotals(atTotals),
      onRoad: figureFromTotals(roadTotals),
      net: figureFromTotals(netTotals),
      flows: {
        motIn: litres(totalFlows.motG, totalFlows.mot13),
        hcIn: litres(totalFlows.hcG, totalFlows.hc13),
        totalIn: litres(totalFlows.motG + totalFlows.hcG, totalFlows.mot13 + totalFlows.hc13),
        dispatched: litres(totalFlows.dispG, totalFlows.disp13),
        stockChange: litres(totalFlows.dStockG, totalFlows.dStock13),
      },
      byZmcc: transitRows,
      tankers: tankerRows,
      inFlight: { ...litres(sumLines.flightG, sumLines.flight13), tankers: sumLines.flightN },
      highLossCount: tankerRows.filter((t) => t.isHighLoss).length,
    },
    whole,
    contractorTransit: { total: figureFromTotals(contractorTotals), contractors: contractorRows, pendingTankers: pendingContractor },
  };
}


// -------------------------------------------------------------
// DATABASE QUERY & AGGREGATE ENGINE
// -------------------------------------------------------------

/** The statuses of a ZMCC dispatch that really left the tank. Only requests never sent are left out. */
const NOT_SENT_VISIT_STATUSES = ['DRAFT_DISPATCH', 'PENDING_APPROVAL', 'REOPENED', 'CANCELLED'];

const dec = (v: unknown): number => (v == null ? 0 : Number(v));

export async function getSupplyChainLossHierarchy(filters: LossFilters): Promise<{
  summary: SupplyChainLossSummary;
  details: LossReconciliationDetailRow[];
  /** The Loss / Gain levels (MOT, Area, Transit, Whole, Contractor Transit). */
  levels: LossLevels;
}> {
  const range = resolveRange(filters);
  const { startDate, endDate, timestampStart, timestampEnd } = range;
  const zmccIds = normalizeIds(filters.zmccIds, filters.zmccId);
  const contractorIds = normalizeIds(filters.contractorIds);
  const motProfileId = filters.motProfileId ? normalizeIds(undefined, filters.motProfileId)[0] : undefined;
  const fromDay = startDate.toISOString().slice(0, 10);
  const toDay = endDate.toISOString().slice(0, 10);
  const visitDates = plantVisitDateWhere(filters.dateBasis ?? 'calendar', fromDay, toDay);
  const includeContractor = filters.includeContractor !== false;

  // The journey, tank, dispatch and stock reads do not depend on each other, so they all start together.
  const stockScope = zmccIds.length ? Prisma.sql`zmcc_id IN (${Prisma.join(zmccIds)})` : Prisma.sql`TRUE`;
  const visitSelect = {
    id: true,
    visit_number: true,
    vehicle_number: true,
    raw_milk_dispatch_note_number: true,
    operational_date: true,
    created_at: true,
    current_status: true,
    procurement_source_id: true,
    vehicle_dispatch_gross_liters: true,
    vehicle_dispatch_at_13ts_liters: true,
    vehicle_dispatch_lr: true,
    vehicle_dispatch_fat: true,
    procurement_source: { select: { name: true, code: true } },
    weight_ticket: { select: { net_weight_kg: true } },
    dual_reconciliation: { select: { received_gross_liters: true, received_at_13ts_liters: true } },
  } as const;
  // Only the columns the rows below read: a visit row also carries large JSON decision columns that are never used here.
  const loadVisits = (where: Prisma.VehicleVisitWhereInput) =>
    prisma.vehicleVisit.findMany({ where, select: visitSelect, orderBy: { created_at: 'desc' } });

  const [journeys, stockRows, hcRows, hcNotReceived, dispatchedVisits, adminRows, contractorVisits] = await Promise.all([
    // Journeys: only the columns the rows below read.
    prisma.motJourney.findMany({
      where: {
        operational_date: { gte: startDate, lte: endDate },
        ...(zmccIds.length ? { zmcc_id: { in: zmccIds } } : {}),
        status: 'COMPLETED',
      },
      select: {
        id: true,
        zmcc_id: true,
        mot_profile_id: true,
        operational_date: true,
        journey_number: true,
        area_received_liters: true,
        area_received_at_13ts_liters: true,
        zmcc: { select: { name: true, code: true } },
        route: { select: { route_code: true } },
        mot_vehicle: { select: { vehicle_number: true } },
        mot_profile: { select: { name: true, mot_code: true } },
        summary: { select: { total_gross_liters: true, total_at_13ts_liters: true } },
        collections: { select: { gross_liters: true, at_13ts_liters: true, final_decision: true } },
        mot_arrival: {
          select: {
            lab_session: {
              select: {
                tank_receipt: { select: { gross_liters: true, at_13ts_liters: true } },
                portions: { select: { status: true, final_decision: true, gross_liters: true, at_13ts_liters: true } },
              },
            },
          },
        },
      },
      orderBy: { operational_date: 'desc' },
    }),
    // Tank stock at both ends of the period, per ZMCC, physical and @13 TS. A failed query throws: zero stock would be invented.
    withReportTimeout((tx) => tx.$queryRaw<Array<{
      zmcc_id: bigint;
      start_stock: string | number | null;
      end_stock: string | number | null;
      start_stock_13ts: string | number | null;
      end_stock_13ts: string | number | null;
    }>>`
      SELECT zmcc_id,
        COALESCE(SUM(CASE WHEN transaction_type IN ('RECEIPT', 'ADJUSTMENT_IN') THEN quantity_liters WHEN transaction_type IN ('ISSUE', 'ADJUSTMENT_OUT') THEN -quantity_liters ELSE 0 END) FILTER (WHERE operational_timestamp < ${timestampStart}), 0) AS start_stock,
        COALESCE(SUM(CASE WHEN transaction_type IN ('RECEIPT', 'ADJUSTMENT_IN') THEN quantity_liters WHEN transaction_type IN ('ISSUE', 'ADJUSTMENT_OUT') THEN -quantity_liters ELSE 0 END) FILTER (WHERE operational_timestamp <= ${timestampEnd}), 0) AS end_stock,
        COALESCE(SUM(CASE WHEN transaction_type IN ('RECEIPT', 'ADJUSTMENT_IN') THEN at_13ts_liters WHEN transaction_type IN ('ISSUE', 'ADJUSTMENT_OUT') THEN -at_13ts_liters ELSE 0 END) FILTER (WHERE operational_timestamp < ${timestampStart}), 0) AS start_stock_13ts,
        COALESCE(SUM(CASE WHEN transaction_type IN ('RECEIPT', 'ADJUSTMENT_IN') THEN at_13ts_liters WHEN transaction_type IN ('ISSUE', 'ADJUSTMENT_OUT') THEN -at_13ts_liters ELSE 0 END) FILTER (WHERE operational_timestamp <= ${timestampEnd}), 0) AS end_stock_13ts
      FROM zmcc_tank_inventory_transaction
      WHERE ${stockScope}
      GROUP BY zmcc_id
    `),
    // HC receipts per ZMCC, summed in the database.
    prisma.zmccTankReceipt.groupBy({
      by: ['zmcc_id'],
      where: {
        arrival_type: 'HC',
        received_at: { gte: timestampStart, lte: timestampEnd },
        ...(zmccIds.length ? { zmcc_id: { in: zmccIds } } : {}),
      },
      _sum: { gross_liters: true, at_13ts_liters: true },
    }),
    // HC milk accepted by the lab but never unloaded.
    prisma.zmccLabPortion.aggregate({
      where: {
        final_decision: 'ACCEPTED',
        status: { notIn: ['WEIGHED', 'LOADED'] },
        lab_session: {
          arrival_type: 'HC',
          created_at: { gte: timestampStart, lte: timestampEnd },
          ...(zmccIds.length ? { zmcc_id: { in: zmccIds } } : {}),
        },
      },
      _sum: { gross_liters: true },
    }),
    // ZMCC dispatches only: contractor visits never left a ZMCC tank. A tanker the plant rejected still left the tank.
    loadVisits({
      ...visitDates,
      procurement_source: { source_type: 'ZMCC' },
      ...(zmccIds.length ? { procurement_source_id: { in: zmccIds } } : {}),
      current_status: { notIn: NOT_SENT_VISIT_STATUSES },
    }),
    // Admin adjustments per ZMCC and direction. A correction is already in the corrected receipt or dispatch figure;
    // counting its ledger row too would double it.
    withReportTimeout((tx) => tx.$queryRaw<Array<{
      zmcc_id: bigint;
      transaction_type: string;
      gross: string | number | null;
      at13: string | number | null;
    }>>`
      SELECT zmcc_id, transaction_type::text AS transaction_type,
             COALESCE(SUM(quantity_liters), 0) AS gross, COALESCE(SUM(at_13ts_liters), 0) AS at13
      FROM zmcc_tank_inventory_transaction
      WHERE transaction_type IN ('ADJUSTMENT_IN', 'ADJUSTMENT_OUT')
        AND reference_type NOT IN ('ZMCC_LAB_SESSION_CORRECTION', 'DISPATCH_CORRECTION')
        AND operational_timestamp >= ${timestampStart} AND operational_timestamp <= ${timestampEnd}
        AND ${stockScope}
      GROUP BY zmcc_id, transaction_type
    `),
    // Contractor tankers, for the Contractor Transit level (not part of Whole).
    includeContractor
      ? loadVisits({
          ...visitDates,
          procurement_source: { source_type: 'CONTRACTOR' },
          ...(contractorIds.length ? { procurement_source_id: { in: contractorIds } } : {}),
          current_status: { notIn: NOT_SENT_VISIT_STATUSES },
        })
      : Promise.resolve([] as Awaited<ReturnType<typeof loadVisits>>),
  ]);

  let totalShopGrossLiters = 0;
  let totalShopAt13tsLiters = 0;
  let totalZmccArrivalGrossLiters = 0;
  let totalZmccArrivalAt13tsLiters = 0;
  let totalAcceptedNotReceivedLiters = 0;
  // Each journey's own loss or gain, added up separately from the net.
  let routeGrossLoss = 0;
  let routeGrossGain = 0;
  let routeGrossLoss13ts = 0;
  let routeGrossGain13ts = 0;

  const detailRows: LossReconciliationDetailRow[] = [];
  const levelJourneys: LevelJourneyInput[] = [];

  for (const j of journeys) {
    const labSession = j.mot_arrival?.lab_session;

    // Shops from the summary (or the accepted collections); RECEIVED milk only (unloaded into the tank), the stored
    // Area figure first, else the tank receipt. The same rule feeds the Stage by stage trip (motTripFigures.ts).
    // Accepted-but-not-received milk is reported separately and never counted as received.
    const trip = journeyTripFigures(j);
    const shopGross = trip.shopGross;
    const shop13ts = trip.shop13ts;
    const zmccGross = trip.receivedGross;
    // Nothing received at all is a real zero; received milk without an @13 TS figure stays missing.
    const received13Raw = trip.received13ts;
    const zmcc13ts = received13Raw ?? 0;
    const notReceivedPortions = (labSession?.portions ?? []).filter(
      (p) => p.final_decision === 'ACCEPTED' && p.status !== 'WEIGHED' && p.status !== 'LOADED',
    );
    const acceptedNotReceived = Number(notReceivedPortions.reduce((t, p) => t + Number(p.gross_liters ?? 0), 0).toFixed(2));
    totalAcceptedNotReceivedLiters += acceptedNotReceived;

    totalShopGrossLiters += shopGross;
    totalShopAt13tsLiters += shop13ts;
    totalZmccArrivalGrossLiters += zmccGross;
    totalZmccArrivalAt13tsLiters += zmcc13ts;

    levelJourneys.push({
      id: j.id.toString(),
      number: j.journey_number,
      date: j.operational_date.toISOString().split('T')[0],
      zmccId: j.zmcc_id.toString(),
      zmccName: j.zmcc.name,
      zmccCode: j.zmcc.code,
      routeCode: j.route?.route_code ?? null,
      vehicleNumber: j.mot_vehicle?.vehicle_number ?? null,
      profileId: j.mot_profile_id.toString(),
      profileName: j.mot_profile.name,
      profileCode: j.mot_profile.mot_code ?? null,
      shopGross,
      shop13ts,
      receivedGross: zmccGross,
      received13ts: received13Raw,
      acceptedNotReceived,
    });

    // Received minus sent: negative is a loss, positive a gain. Never clamped.
    const routeSigned = Number((zmccGross - shopGross).toFixed(2));
    const routeSigned13ts = Number((zmcc13ts - shop13ts).toFixed(2));
    if (routeSigned < 0) routeGrossLoss -= routeSigned; else routeGrossGain += routeSigned;
    if (routeSigned13ts < 0) routeGrossLoss13ts -= routeSigned13ts; else routeGrossGain13ts += routeSigned13ts;

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
      shopAt13tsLiters: shop13ts,
      zmccAt13tsLiters: zmcc13ts,
      routeSignedLiters: routeSigned,
      routeSignedPercent: signedPercent(routeSigned, shopGross) ?? 0,
      routeSignedAt13tsLiters: routeSigned13ts,
      routeSignedAt13tsPercent: signedPercent(routeSigned13ts, shop13ts) ?? 0,
      acceptedNotReceivedLiters: acceptedNotReceived,
    });
  }

  const tier1Base = calculateTier1RouteLoss({
    shopGrossLiters: totalShopGrossLiters,
    zmccArrivalGrossLiters: totalZmccArrivalGrossLiters,
    shopAt13tsLiters: totalShopAt13tsLiters,
    zmccArrivalAt13tsLiters: totalZmccArrivalAt13tsLiters,
  });
  const tier1Calc: Tier1RouteLossResult = {
    ...tier1Base,
    grossLossLiters: Number(routeGrossLoss.toFixed(2)),
    grossGainLiters: Number(routeGrossGain.toFixed(2)),
    at13tsGrossLossLiters: Number(routeGrossLoss13ts.toFixed(2)),
    at13tsGrossGainLiters: Number(routeGrossGain13ts.toFixed(2)),
  };

  // Per-ZMCC maps for the levels, and the all-ZMCC sums the older tier figures use.
  const hcByZmcc = new Map<string, { gross: number; at13ts: number }>();
  let localInwardGross = 0;
  let localInward13ts = 0;
  for (const r of hcRows) {
    const g = dec(r._sum.gross_liters);
    const t = dec(r._sum.at_13ts_liters);
    hcByZmcc.set(r.zmcc_id.toString(), { gross: g, at13ts: t });
    localInwardGross += g;
    localInward13ts += t;
  }

  const adminByZmcc = new Map<string, { inGross: number; outGross: number; in13ts: number; out13ts: number }>();
  let adminInwardGross = 0;
  let adminInward13ts = 0;
  let adminOutwardGross = 0;
  let adminOutward13ts = 0;
  for (const a of adminRows) {
    const id = a.zmcc_id.toString();
    const entry = adminByZmcc.get(id) ?? { inGross: 0, outGross: 0, in13ts: 0, out13ts: 0 };
    const gross = dec(a.gross);
    const at13 = dec(a.at13);
    if (a.transaction_type === 'ADJUSTMENT_OUT') {
      entry.outGross += gross;
      entry.out13ts += at13;
      adminOutwardGross += gross;
      adminOutward13ts += at13;
    } else {
      entry.inGross += gross;
      entry.in13ts += at13;
      adminInwardGross += gross;
      adminInward13ts += at13;
    }
    adminByZmcc.set(id, entry);
  }

  const stockByZmcc = new Map<string, { startGross: number; endGross: number; start13ts: number; end13ts: number }>();
  const stockTotal = { start: 0, end: 0, start13ts: 0, end13ts: 0 };
  for (const s of stockRows) {
    const row = { startGross: dec(s.start_stock), endGross: dec(s.end_stock), start13ts: dec(s.start_stock_13ts), end13ts: dec(s.end_stock_13ts) };
    stockByZmcc.set(s.zmcc_id.toString(), row);
    stockTotal.start += row.startGross;
    stockTotal.end += row.endGross;
    stockTotal.start13ts += row.start13ts;
    stockTotal.end13ts += row.end13ts;
  }

  totalAcceptedNotReceivedLiters += dec(hcNotReceived._sum.gross_liters);
  totalAcceptedNotReceivedLiters = Number(totalAcceptedNotReceivedLiters.toFixed(2));

  let totalDispatchedGrossLiters = 0;
  let totalDispatchedAt13tsLiters = 0;
  // Transit loss compares only visits the plant has reconciled; both sides must cover the same tankers.
  let reconciledDispatchedGrossLiters = 0;
  let reconciledDispatchedAt13tsLiters = 0;
  let totalPlantAcceptedGrossLiters = 0;
  let totalPlantAcceptedAt13tsLiters = 0;
  let totalPlantNetKg = 0;
  let highLossCount = 0;
  let transitGrossLoss = 0;
  let transitGrossGain = 0;
  let transitGrossLoss13ts = 0;
  let transitGrossGain13ts = 0;

  const toTanker = (v: (typeof dispatchedVisits)[number]): LevelTankerInput => {
    const dual = v.dual_reconciliation;
    const reconciled = Boolean(dual) && v.vehicle_dispatch_gross_liters != null;
    return {
      id: v.id.toString(),
      visitNumber: v.visit_number,
      date: (v.operational_date || v.created_at).toISOString().split('T')[0],
      sourceId: v.procurement_source_id ? v.procurement_source_id.toString() : null,
      sourceName: v.procurement_source?.name || 'Source',
      sourceCode: v.procurement_source?.code || '',
      vehicleNumber: v.vehicle_number,
      referenceNumber: v.raw_milk_dispatch_note_number || v.visit_number,
      status: v.current_status,
      dispatchedGross: dec(v.vehicle_dispatch_gross_liters),
      dispatched13ts: v.vehicle_dispatch_at_13ts_liters != null ? Number(v.vehicle_dispatch_at_13ts_liters) : null,
      plant: reconciled && dual ? { gross: Number(dual.received_gross_liters), at13ts: dual.received_at_13ts_liters != null ? Number(dual.received_at_13ts_liters) : null } : null,
      plantNetKg: v.weight_ticket?.net_weight_kg ? Number(v.weight_ticket.net_weight_kg) : 0,
    };
  };
  const zmccTankers = dispatchedVisits.map(toTanker);
  const contractorTankers = contractorVisits.map(toTanker);

  for (const v of dispatchedVisits) {
    const dispGross = v.vehicle_dispatch_gross_liters ? Number(v.vehicle_dispatch_gross_liters) : 0;
    const disp13ts = v.vehicle_dispatch_at_13ts_liters ? Number(v.vehicle_dispatch_at_13ts_liters) : 0;

    const dual = v.dual_reconciliation;
    const weight = v.weight_ticket;
    const netKg = weight?.net_weight_kg ? Number(weight.net_weight_kg) : 0;

    // Everything dispatched left the ZMCC tank, reconciled or not (Tier 2 outflow).
    totalDispatchedGrossLiters += dispGross;
    totalDispatchedAt13tsLiters += disp13ts;

    const dispLr = v.vehicle_dispatch_lr ? Number(v.vehicle_dispatch_lr) : undefined;
    const dispFat = v.vehicle_dispatch_fat ? Number(v.vehicle_dispatch_fat) : undefined;

    if (!dual || v.vehicle_dispatch_gross_liters == null) {
      // Not reconciled yet: no plant figure and no loss, so these fields stay absent.
      detailRows.push({
        date: (v.operational_date || v.created_at).toISOString().split('T')[0],
        zmccName: v.procurement_source?.name || 'ZMCC',
        zmccCode: v.procurement_source?.code || '',
        vehicleNumber: v.vehicle_number,
        referenceNumber: v.raw_milk_dispatch_note_number || v.visit_number,
        dispatchedGrossLiters: dispGross,
        dispatchedAt13tsLiters: v.vehicle_dispatch_at_13ts_liters != null ? disp13ts : undefined,
        plantNetKg: netKg,
        dispatchLr: dispLr,
        dispatchFat: dispFat,
      });
      continue;
    }

    const plantGross = Number(dual.received_gross_liters);

    reconciledDispatchedGrossLiters += dispGross;
    totalPlantAcceptedGrossLiters += plantGross;
    if (v.vehicle_dispatch_at_13ts_liters != null) {
      reconciledDispatchedAt13tsLiters += disp13ts;
      totalPlantAcceptedAt13tsLiters += Number(dual.received_at_13ts_liters);
    }
    totalPlantNetKg += netKg;

    // Received minus sent: negative is a loss, positive a gain. Never clamped.
    const transitSigned = Number((plantGross - dispGross).toFixed(2));
    const transitSignedPct = signedPercent(transitSigned, dispGross) ?? 0;
    const has13ts = v.vehicle_dispatch_at_13ts_liters != null;
    const plant13ts = has13ts ? Number(dual.received_at_13ts_liters) : undefined;
    const transitSigned13ts = plant13ts !== undefined ? Number((plant13ts - disp13ts).toFixed(2)) : undefined;
    if (transitSigned < 0) transitGrossLoss -= transitSigned; else transitGrossGain += transitSigned;
    if (transitSigned13ts !== undefined) {
      if (transitSigned13ts < 0) transitGrossLoss13ts -= transitSigned13ts; else transitGrossGain13ts += transitSigned13ts;
    }
    // The alert is for loss only.
    const isHigh = transitSignedPct < -1.0;
    if (isHigh) highLossCount++;

    detailRows.push({
      date: (v.operational_date || v.created_at).toISOString().split('T')[0],
      zmccName: v.procurement_source?.name || 'ZMCC',
      zmccCode: v.procurement_source?.code || '',
      vehicleNumber: v.vehicle_number,
      referenceNumber: v.raw_milk_dispatch_note_number || v.visit_number,
      dispatchedGrossLiters: dispGross,
      dispatchedAt13tsLiters: has13ts ? disp13ts : undefined,
      plantNetKg: netKg,
      plantAcceptedLiters: plantGross,
      plantAcceptedAt13tsLiters: plant13ts,
      transitSignedLiters: transitSigned,
      transitSignedPercent: transitSignedPct,
      transitSignedAt13tsLiters: transitSigned13ts,
      transitSignedAt13tsPercent: transitSigned13ts !== undefined ? signedPercent(transitSigned13ts, disp13ts) ?? 0 : undefined,
      isHighTransitLoss: isHigh,
      dispatchLr: dispLr,
      dispatchFat: dispFat,
      financialImpactEstimatedRs: Number((transitSigned * 180).toFixed(2)), // Standard estimated raw milk cost ~Rs. 180/L
    });
  }

  // Older four-tier figures, kept beside the levels until the screens move over.
  const tier2Calc = calculateTier2ZmccLoss({
    motInwardGrossLiters: totalZmccArrivalGrossLiters,
    localInwardGrossLiters: localInwardGross,
    adminAdjustmentGrossLiters: adminInwardGross,
    adminAdjustmentOutGrossLiters: adminOutwardGross,
    dispatchedGrossLiters: totalDispatchedGrossLiters,
    startingTankStockLiters: stockTotal.start,
    endingTankStockLiters: stockTotal.end,
    motInwardAt13tsLiters: totalZmccArrivalAt13tsLiters,
    localInwardAt13tsLiters: localInward13ts,
    adminAdjustmentAt13tsLiters: adminInward13ts,
    adminAdjustmentOutAt13tsLiters: adminOutward13ts,
    dispatchedAt13tsLiters: totalDispatchedAt13tsLiters,
    startingTankStockAt13tsLiters: stockTotal.start13ts,
    endingTankStockAt13tsLiters: stockTotal.end13ts,
  });

  const tier3Base = calculateTier3TransitLoss({
    dispatchedGrossLiters: reconciledDispatchedGrossLiters,
    plantAcceptedGrossLiters: totalPlantAcceptedGrossLiters,
    plantAcceptedNetKg: totalPlantNetKg,
    dispatchedAt13tsLiters: reconciledDispatchedAt13tsLiters,
    plantAcceptedAt13tsLiters: totalPlantAcceptedAt13tsLiters,
  });
  const tier3Calc: Tier3TransitLossResult = {
    ...tier3Base,
    grossLossLiters: Number(transitGrossLoss.toFixed(2)),
    grossGainLiters: Number(transitGrossGain.toFixed(2)),
    at13tsGrossLossLiters: Number(transitGrossLoss13ts.toFixed(2)),
    at13tsGrossGainLiters: Number(transitGrossGain13ts.toFixed(2)),
  };

  const tier4Calc = calculateTier4TotalLoss(tier1Calc, tier2Calc, tier3Calc);

  // Names for ZMCCs that have stock or HC milk but no journey or tanker in the period.
  const zmccNames = new Map<string, { name: string; code: string }>();
  for (const j of levelJourneys) zmccNames.set(j.zmccId, { name: j.zmccName, code: j.zmccCode });
  for (const t of zmccTankers) if (t.sourceId) zmccNames.set(t.sourceId, { name: t.sourceName, code: t.sourceCode });
  const missingNames = [...new Set([...hcByZmcc.keys(), ...stockByZmcc.keys(), ...adminByZmcc.keys()])].filter((id) => !zmccNames.has(id));
  if (missingNames.length) {
    const found = await prisma.procurementSource.findMany({
      where: { id: { in: missingNames.map((id) => BigInt(id)) } },
      select: { id: true, name: true, code: true },
    });
    for (const f of found) zmccNames.set(f.id.toString(), { name: f.name, code: f.code });
  }

  const built = buildLossLevels({
    zmccNames,
    journeys: levelJourneys,
    motProfileId: motProfileId ? motProfileId.toString() : null,
    hc: hcByZmcc,
    stock: stockByZmcc,
    admin: adminByZmcc,
    tankers: zmccTankers,
    contractorTankers,
    acceptedNotReceivedLiters: totalAcceptedNotReceivedLiters,
  });
  const levels: LossLevels = {
    filters: {
      preset: filters.preset ?? (filters.period === 'today' || !filters.period ? 'TODAY' : filters.period === 'mtd' ? 'MTD' : 'CUSTOM'),
      from: range.from,
      to: range.to,
      label: range.label,
      zmccIds: zmccIds.map(String),
      contractorIds: contractorIds.map(String),
      motProfileId: motProfileId ? motProfileId.toString() : null,
    },
    ...built,
  };

  return {
    summary: {
      period: filters.preset ?? filters.period ?? 'today',
      startDate: fromDay,
      endDate: toDay,
      tier1RouteLoss: { ...tier1Calc, label: 'MOT / Area Loss / Gain (shops vs ZMCC)' },
      tier2ZmccLoss: { ...tier2Calc, label: 'ZMCC Tank & Processing Loss / Gain' },
      tier3TransitLoss: { ...tier3Calc, label: 'Tanker trip Loss / Gain (Dispatch vs Plant Received)', highLossCount },
      tier4TotalLoss: { ...tier4Calc, label: 'Whole Loss / Gain (Bought vs Plant Received)' },
      acceptedNotReceivedLiters: totalAcceptedNotReceivedLiters,
    },
    details: detailRows,
    levels,
  };
}

/** Same as getSupplyChainLossHierarchy, under the Whole name. */
export const getLossHierarchy = getSupplyChainLossHierarchy;

// -------------------------------------------------------------
// FILTER PICK-LISTS
// -------------------------------------------------------------

/**
 * ZMCCs, contractors and Mobile Testers for the filter bar: the active ones plus any that appear in the period.
 * A ZMCC manager sees only their own ZMCC and its testers, and no contractors.
 */
export async function listLossFilterOptions(filters: LossFilters): Promise<LossFilterOptions> {
  const range = resolveRange(filters);
  const zmccScope = normalizeIds(filters.zmccIds, filters.zmccId);
  const locked = filters.includeContractor === false;
  const visitDates = plantVisitDateWhere(filters.dateBasis ?? 'calendar', range.from, range.to);

  const [journeyGroups, visitGroups, receiptGroups] = await Promise.all([
    prisma.motJourney.groupBy({
      by: ['zmcc_id', 'mot_profile_id'],
      where: { operational_date: { gte: range.startDate, lte: range.endDate }, ...(locked && zmccScope.length ? { zmcc_id: { in: zmccScope } } : {}) },
    }),
    prisma.vehicleVisit.groupBy({
      by: ['procurement_source_id'],
      where: { ...visitDates, current_status: { notIn: NOT_SENT_VISIT_STATUSES }, ...(locked && zmccScope.length ? { procurement_source_id: { in: zmccScope } } : {}) },
    }),
    prisma.zmccTankReceipt.groupBy({
      by: ['zmcc_id'],
      where: { received_at: { gte: range.timestampStart, lte: range.timestampEnd }, ...(locked && zmccScope.length ? { zmcc_id: { in: zmccScope } } : {}) },
    }),
  ]);

  const appearingSources = new Set<bigint>();
  for (const g of journeyGroups) appearingSources.add(g.zmcc_id);
  for (const g of receiptGroups) appearingSources.add(g.zmcc_id);
  for (const g of visitGroups) if (g.procurement_source_id) appearingSources.add(g.procurement_source_id);
  const appearingProfiles = journeyGroups.map((g) => g.mot_profile_id);

  const sources = await prisma.procurementSource.findMany({
    where: {
      OR: [{ is_active: true }, { id: { in: [...appearingSources] } }],
      ...(locked && zmccScope.length ? { id: { in: zmccScope } } : {}),
    },
    select: { id: true, code: true, name: true, source_type: true, is_active: true },
    orderBy: { name: 'asc' },
  });
  const profiles = await prisma.motProfile.findMany({
    where: {
      OR: [{ is_active: true }, { id: { in: appearingProfiles } }],
      ...(locked && zmccScope.length ? { zmcc_id: { in: zmccScope } } : {}),
    },
    select: { id: true, mot_code: true, name: true, zmcc_id: true, is_active: true, zmcc: { select: { name: true } } },
    orderBy: { name: 'asc' },
  });

  const pick = (s: (typeof sources)[number]) => ({ id: s.id.toString(), code: s.code, name: s.name, isActive: s.is_active });
  return {
    zmccs: sources.filter((s) => s.source_type === 'ZMCC').map(pick),
    contractors: locked ? [] : sources.filter((s) => s.source_type === 'CONTRACTOR').map(pick),
    mobileTesters: profiles.map((p) => ({
      id: p.id.toString(),
      code: p.mot_code,
      name: p.name,
      zmccId: p.zmcc_id.toString(),
      zmccName: p.zmcc.name,
      isActive: p.is_active,
    })),
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
      deepLink: '/mpd/zmcc-manager?tab=PLANT_TRANSIT&view=RECONCILIATION',
      dedupeSuffix: `high-transit-${params.visitId.toString()}`,
    });
    return true;
  }
  return false;
}


// -------------------------------------------------------------
// EXCEL WORKBOOK GENERATOR (Native OpenXML .xlsx via ExcelJS)
// -------------------------------------------------------------

const SIGNED_L_13TS_HEADER = 'Gain (+) / Loss (-) @13 TS L';
const SIGNED_P_13TS_HEADER = 'Gain (+) / Loss (-) @13 TS %';
const NUM_FMT = '#,##0.00';
const SIGNED_FMT = '#,##0.00;[Red]-#,##0.00';
const PCT_FMT = '0.00%;[Red]-0.00%';

interface SheetColumn {
  header: string;
  key: string;
  width: number;
  fmt?: string;
}

type SheetRow = Record<string, string | number | boolean | null | undefined>;

/** The columns every figure shares: @13 TS first, gross next. */
function figureColumns(): SheetColumn[] {
  return [
    { header: 'Sent @13 TS L', key: 'sent13', width: 16, fmt: NUM_FMT },
    { header: 'Received @13 TS L', key: 'recv13', width: 18, fmt: NUM_FMT },
    { header: SIGNED_L_13TS_HEADER, key: 'signed13', width: 24, fmt: SIGNED_FMT },
    { header: SIGNED_P_13TS_HEADER, key: 'pct13', width: 24, fmt: PCT_FMT },
    { header: 'Sent gross L', key: 'sentG', width: 16, fmt: NUM_FMT },
    { header: 'Received gross L', key: 'recvG', width: 18, fmt: NUM_FMT },
    { header: LOSS_GAIN_EXPORT_HEADER, key: 'signedG', width: 22, fmt: SIGNED_FMT },
    { header: LOSS_GAIN_EXPORT_PERCENT_HEADER, key: 'pctG', width: 22, fmt: PCT_FMT },
    { header: 'Missing @13 TS', key: 'missing', width: 14 },
  ];
}

function figureCells(f: LossFigure | null | undefined): SheetRow {
  if (!f) return {};
  return {
    sent13: f.at13ts.sent,
    recv13: f.at13ts.received,
    signed13: lossGainExportValue(f.at13ts.signed),
    pct13: f.at13ts.percent == null ? null : f.at13ts.percent / 100,
    sentG: f.gross.sent,
    recvG: f.gross.received,
    signedG: lossGainExportValue(f.gross.signed),
    pctG: f.gross.percent == null ? null : f.gross.percent / 100,
    missing: f.missing13ts,
  };
}

function addLevelSheet(workbook: ExcelJS.Workbook, name: string, columns: SheetColumn[], rows: SheetRow[]): void {
  const sheet = workbook.addWorksheet(name, { views: [{ showGridLines: true, state: 'frozen', ySplit: 1 }] });
  sheet.columns = columns.map((c) => ({ header: c.header, key: c.key, width: c.width }));
  const head = sheet.getRow(1);
  head.height = 30;
  head.eachCell((cell) => {
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  });
  for (const r of rows) {
    const { __bold, ...values } = r;
    const row = sheet.addRow(values);
    row.height = 20;
    for (const c of columns) if (c.fmt) row.getCell(c.key).numFmt = c.fmt;
    if (__bold) {
      row.eachCell({ includeEmpty: true }, (cell) => {
        cell.font = { name: 'Segoe UI', bold: true, size: 11 };
        cell.fill = SUB_FILL;
      });
    }
  }
}

const HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A8A' } };
const HEADER_FONT: Partial<ExcelJS.Font> = { name: 'Segoe UI', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
const SUB_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };

const statusOf = (signed: number | null | undefined) => {
  const kind = lossGainKind(signed);
  return kind === 'loss' ? 'Loss' : kind === 'gain' ? 'Gain' : kind === 'even' ? 'Even' : '';
};

export async function generateLossReconciliationExcel(data: {
  summary: SupplyChainLossSummary;
  details: LossReconciliationDetailRow[];
  levels: LossLevels;
}): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Milk Reception & Process Management';
  workbook.created = new Date();
  const { levels } = data;
  const figureCols = figureColumns();

  // Summary: the filters, then one row per level and part.
  const summaryRows: SheetRow[] = [];
  const add = (level: string, part: string, f: LossFigure, status?: string) =>
    summaryRows.push({ level, part, ...figureCells(f), status: status ?? statusOf(f.at13ts.signed) });
  add('MOT Loss / Gain', '', levels.mot.total);
  add('Area Loss / Gain', '', levels.area.total);
  add('Transit Loss / Gain', 'At ZMCC (tank)', levels.transit.atZmcc);
  add('Transit Loss / Gain', 'Tanker trip (ZMCC to plant)', levels.transit.onRoad, levels.transit.highLossCount > 0 ? 'High loss tankers' : undefined);
  summaryRows.push({ level: 'Transit Loss / Gain', part: 'Net (tank + tanker trip)', ...figureCells(levels.transit.net), status: statusOf(levels.transit.net.at13ts.signed), __bold: true });
  const wholeFigure: LossFigure = { at13ts: levels.whole.net.at13ts, gross: levels.whole.net.gross, records: levels.whole.byZmcc.length, missing13ts: 0 };
  summaryRows.push({ level: 'Whole Loss / Gain', part: 'Bought vs plant received', ...figureCells(wholeFigure), status: statusOf(wholeFigure.at13ts.signed), __bold: true });
  add('Contractor Transit Loss / Gain', 'Not part of Whole', levels.contractorTransit.total);
  summaryRows.push({});
  summaryRows.push({ level: 'Period', part: `${levels.filters.label}: ${levels.filters.from} to ${levels.filters.to}`, __bold: true });
  summaryRows.push({ level: 'ZMCCs', part: levels.filters.zmccIds.length ? `${levels.filters.zmccIds.length} selected` : 'All' });
  summaryRows.push({ level: 'Contractors', part: levels.filters.contractorIds.length ? `${levels.filters.contractorIds.length} selected` : 'All' });
  summaryRows.push({ level: 'Mobile Tester', part: levels.filters.motProfileId ? 'One selected (MOT and Area only)' : 'All' });
  addLevelSheet(
    workbook,
    'Summary',
    [{ header: 'Level', key: 'level', width: 34 }, { header: 'Part', key: 'part', width: 34 }, ...figureCols, { header: 'Status', key: 'status', width: 18 }],
    summaryRows,
  );

  // MOT: Mobile Tester totals with their journeys under them.
  const motRows: SheetRow[] = [];
  for (const t of levels.mot.testers) {
    motRows.push({ tester: t.name, zmcc: t.zmccName, journey: 'Total', ...figureCells(t.total), __bold: true });
    for (const j of t.journeys) {
      motRows.push({ tester: t.name, zmcc: j.zmccName, journey: j.journeyNumber, date: j.date, route: j.routeCode ?? '', vehicle: j.vehicleNumber ?? '', ...figureCells(j.figure) });
    }
  }
  motRows.push({ tester: 'All Mobile Testers', journey: 'Net total', ...figureCells(levels.mot.total), __bold: true });
  addLevelSheet(
    workbook,
    'MOT Loss Gain',
    [
      { header: 'Mobile Tester', key: 'tester', width: 24 },
      { header: 'ZMCC', key: 'zmcc', width: 22 },
      { header: 'Journey', key: 'journey', width: 20 },
      { header: 'Date', key: 'date', width: 12 },
      { header: 'Route', key: 'route', width: 12 },
      { header: 'Vehicle', key: 'vehicle', width: 14 },
      ...figureCols,
    ],
    motRows,
  );

  // Area: the sum of MOT per ZMCC.
  const areaRows: SheetRow[] = levels.area.zmccs.map((a) => ({ zmcc: a.zmccName, journeys: a.journeyCount, testers: a.testerCount, ...figureCells(a.total) }));
  areaRows.push({ zmcc: 'Net total', journeys: levels.area.zmccs.reduce((t, a) => t + a.journeyCount, 0), ...figureCells(levels.area.total), __bold: true });
  addLevelSheet(
    workbook,
    'Area Loss Gain',
    [{ header: 'ZMCC', key: 'zmcc', width: 26 }, { header: 'Journeys', key: 'journeys', width: 12 }, { header: 'Mobile Testers', key: 'testers', width: 14 }, ...figureCols],
    areaRows,
  );

  // Transit: per ZMCC (At ZMCC, On road, net), then per tanker.
  const transitRows: SheetRow[] = [];
  for (const z of levels.transit.byZmcc) {
    transitRows.push({ zmcc: z.zmccName, part: 'At ZMCC (tank)', note: `In ${z.flows.totalIn.at13ts.toFixed(2)} | dispatched ${z.flows.dispatched.at13ts.toFixed(2)} | stock change ${z.flows.stockChange.at13ts.toFixed(2)} (@13 TS L)`, ...figureCells(z.atZmcc) });
    transitRows.push({ zmcc: z.zmccName, part: 'Tanker trip (ZMCC to plant)', ...figureCells(z.onRoad) });
    transitRows.push({ zmcc: z.zmccName, part: 'Net', ...figureCells(z.net), __bold: true });
  }
  transitRows.push({ zmcc: 'All ZMCCs', part: 'At ZMCC (tank)', ...figureCells(levels.transit.atZmcc), __bold: true });
  transitRows.push({ zmcc: 'All ZMCCs', part: 'Tanker trip (ZMCC to plant)', ...figureCells(levels.transit.onRoad), __bold: true });
  transitRows.push({ zmcc: 'All ZMCCs', part: 'Net', ...figureCells(levels.transit.net), __bold: true });
  transitRows.push({});
  for (const t of levels.transit.tankers) {
    transitRows.push({
      zmcc: t.sourceName,
      part: t.reconciled ? 'Tanker' : 'Tanker (not reconciled)',
      note: `${t.date} | ${t.vehicleNumber} | ${t.referenceNumber}`,
      ...figureCells(t.figure),
      ...(t.figure ? {} : { sent13: t.dispatched.at13ts, sentG: t.dispatched.gross }),
    });
  }
  addLevelSheet(
    workbook,
    'Transit Loss Gain',
    [{ header: 'ZMCC', key: 'zmcc', width: 26 }, { header: 'Part', key: 'part', width: 24 }, { header: 'Detail', key: 'note', width: 56 }, ...figureCols],
    transitRows,
  );

  // Whole: the lines that reconcile it, then the net.
  const w = levels.whole;
  const line = (label: string, p: LitrePair, bold = false): SheetRow => ({ line: label, at13ts: p.at13ts, gross: p.gross, __bold: bold });
  const wholeRows: SheetRow[] = [
    line('Milk bought: shop collections', w.lines.boughtShop),
    line('Milk bought: HC receipts', w.lines.boughtHc),
    line('Milk bought (total)', w.lines.bought, true),
    line('Still in ZMCC tanks (stock change)', w.lines.stockChange),
    line('In tankers, not at plant yet (dispatched, plant not finished)', w.lines.onRoad),
    line('Received at plant', w.lines.plantReceived),
    { line: 'Whole Gain (+) / Loss (-)', at13ts: lossGainExportValue(w.net.at13ts.signed), gross: lossGainExportValue(w.net.gross.signed), __bold: true },
    { line: 'Whole Gain (+) / Loss (-) % of bought', at13ts: w.net.at13ts.percent, gross: w.net.gross.percent, __bold: true },
    line('Admin adjustments (own line, not counted as bought)', w.lines.adminAdjustment),
    line('Net with admin line', w.netWithAdmin),
    { line: 'MOT net + Transit net equals Whole net', at13ts: w.reconciles ? 'Yes' : 'No', gross: w.reconciles ? 'Yes' : 'No' },
    {},
  ];
  for (const z of w.byZmcc) {
    wholeRows.push({
      line: z.zmccName,
      at13ts: lossGainExportValue(z.net.at13ts.signed),
      gross: lossGainExportValue(z.net.gross.signed),
      bought13: z.lines.bought.at13ts,
      boughtG: z.lines.bought.gross,
      pct13: z.net.at13ts.percent == null ? null : z.net.at13ts.percent / 100,
      pctG: z.net.gross.percent == null ? null : z.net.gross.percent / 100,
    });
  }
  addLevelSheet(
    workbook,
    'Whole Loss Gain',
    [
      { header: 'Line', key: 'line', width: 52 },
      { header: '@13 TS L', key: 'at13ts', width: 18, fmt: SIGNED_FMT },
      { header: 'Gross L', key: 'gross', width: 18, fmt: SIGNED_FMT },
      { header: 'Bought @13 TS L', key: 'bought13', width: 18, fmt: NUM_FMT },
      { header: 'Bought gross L', key: 'boughtG', width: 18, fmt: NUM_FMT },
      { header: SIGNED_P_13TS_HEADER, key: 'pct13', width: 24, fmt: PCT_FMT },
      { header: LOSS_GAIN_EXPORT_PERCENT_HEADER, key: 'pctG', width: 22, fmt: PCT_FMT },
    ],
    wholeRows,
  );

  // Contractor transit: contractor dispatch vs plant received (reconciled only).
  const contractorRows: SheetRow[] = [];
  for (const c of levels.contractorTransit.contractors) {
    contractorRows.push({ contractor: c.name, tanker: 'Total', note: c.pendingTankers ? `${c.pendingTankers} not reconciled` : '', ...figureCells(c.total), __bold: true });
    for (const t of c.tankers) {
      contractorRows.push({
        contractor: c.name,
        tanker: t.vehicleNumber,
        note: `${t.date} | ${t.referenceNumber}${t.reconciled ? '' : ' | not reconciled'}`,
        ...figureCells(t.figure),
        ...(t.figure ? {} : { sent13: t.dispatched.at13ts, sentG: t.dispatched.gross }),
      });
    }
  }
  contractorRows.push({ contractor: 'All contractors', tanker: 'Net total', ...figureCells(levels.contractorTransit.total), __bold: true });
  addLevelSheet(
    workbook,
    'Contractor Transit',
    [{ header: 'Contractor', key: 'contractor', width: 26 }, { header: 'Tanker', key: 'tanker', width: 16 }, { header: 'Detail', key: 'note', width: 40 }, ...figureCols],
    contractorRows,
  );

  const rawBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(rawBuffer);
}
