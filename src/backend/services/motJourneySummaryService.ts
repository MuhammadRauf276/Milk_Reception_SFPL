import { Prisma } from '@prisma/client';

export const MOT_JOURNEY_SUMMARY_VERSION = '1.0';

export interface SerializedMotJourneySummary {
  id: string;
  journey_id: string;
  journey_ended_at: string;
  assigned_shop_count: number;
  collected_shop_count: number;
  skipped_shop_count: number;
  pending_shop_count: number;
  total_gross_liters: number;
  total_at_13ts_liters: number;
  weighted_avg_lr: number | null;
  weighted_avg_fat: number | null;
  weighted_avg_snf: number | null;
  weighted_avg_ts: number | null;
  summary_version: string;
  source_calculation_versions: string[];
  revision: number;
  generated_at: string;
  last_recomputed_at: string | null;
}

export interface SummaryCalculationMetrics {
  assigned_shop_count: number;
  collected_shop_count: number;
  skipped_shop_count: number;
  pending_shop_count: number;
  total_gross_liters: Prisma.Decimal;
  total_at_13ts_liters: Prisma.Decimal;
  weighted_avg_lr: Prisma.Decimal | null;
  weighted_avg_fat: Prisma.Decimal | null;
  weighted_avg_snf: Prisma.Decimal | null;
  weighted_avg_ts: Prisma.Decimal | null;
  source_calculation_versions: string[];
}

/**
 * Pure aggregation calculation from persisted collection and stop models.
 * Quality weighting is FROZEN on gross_liters:
 * Weighted M = SUM(collection.gross_liters * collection.M) / SUM(collection.gross_liters)
 */
export function calculateJourneySummaryMetrics(
  stops: Array<{ id: bigint; status: string; skipped_at: Date | null }>,
  collections: Array<{
    id: bigint;
    journey_stop_id: bigint;
    gross_liters: Prisma.Decimal | number | string;
    at_13ts_liters: Prisma.Decimal | number | string;
    lr: Prisma.Decimal | number | string;
    fat: Prisma.Decimal | number | string;
    snf: Prisma.Decimal | number | string;
    ts: Prisma.Decimal | number | string;
    calculation_version?: string | null;
  }>
): SummaryCalculationMetrics {
  const assigned_shop_count = stops.length;

  // Unique qualifying collected stops
  const collectedStopIds = new Set<string>();
  for (const col of collections) {
    collectedStopIds.add(col.journey_stop_id.toString());
  }
  const collected_shop_count = collectedStopIds.size;

  // Stops explicitly skipped
  let skipped_shop_count = 0;
  for (const stop of stops) {
    if (stop.status === 'SKIPPED' || stop.skipped_at != null) {
      skipped_shop_count++;
    }
  }

  const pending_shop_count = Math.max(0, assigned_shop_count - collected_shop_count - skipped_shop_count);

  if (collections.length === 0) {
    return {
      assigned_shop_count,
      collected_shop_count: 0,
      skipped_shop_count,
      pending_shop_count,
      total_gross_liters: new Prisma.Decimal('0.00'),
      total_at_13ts_liters: new Prisma.Decimal('0.00'),
      weighted_avg_lr: null,
      weighted_avg_fat: null,
      weighted_avg_snf: null,
      weighted_avg_ts: null,
      source_calculation_versions: [],
    };
  }

  let sumGross = new Prisma.Decimal(0);
  let sumAt13Ts = new Prisma.Decimal(0);
  let sumWeightedLr = new Prisma.Decimal(0);
  let sumWeightedFat = new Prisma.Decimal(0);
  let sumWeightedSnf = new Prisma.Decimal(0);
  let sumWeightedTs = new Prisma.Decimal(0);

  const versionSet = new Set<string>();

  for (const col of collections) {
    const gross = new Prisma.Decimal(col.gross_liters);
    const at13 = new Prisma.Decimal(col.at_13ts_liters);
    const lr = new Prisma.Decimal(col.lr);
    const fat = new Prisma.Decimal(col.fat);
    const snf = new Prisma.Decimal(col.snf);
    const ts = new Prisma.Decimal(col.ts);

    sumGross = sumGross.plus(gross);
    sumAt13Ts = sumAt13Ts.plus(at13);

    sumWeightedLr = sumWeightedLr.plus(gross.times(lr));
    sumWeightedFat = sumWeightedFat.plus(gross.times(fat));
    sumWeightedSnf = sumWeightedSnf.plus(gross.times(snf));
    sumWeightedTs = sumWeightedTs.plus(gross.times(ts));

    if (col.calculation_version) {
      versionSet.add(col.calculation_version);
    }
  }

  const source_calculation_versions = Array.from(versionSet).sort();

  if (sumGross.isZero()) {
    return {
      assigned_shop_count,
      collected_shop_count,
      skipped_shop_count,
      pending_shop_count,
      total_gross_liters: new Prisma.Decimal('0.00'),
      total_at_13ts_liters: new Prisma.Decimal('0.00'),
      weighted_avg_lr: null,
      weighted_avg_fat: null,
      weighted_avg_snf: null,
      weighted_avg_ts: null,
      source_calculation_versions,
    };
  }

  const total_gross_liters = new Prisma.Decimal(sumGross.toFixed(2));
  const total_at_13ts_liters = new Prisma.Decimal(sumAt13Ts.toFixed(2));

  // Perform division with full precision before final rounding to 2 decimals
  const weighted_avg_lr = new Prisma.Decimal(sumWeightedLr.div(sumGross).toFixed(2));
  const weighted_avg_fat = new Prisma.Decimal(sumWeightedFat.div(sumGross).toFixed(2));
  const weighted_avg_snf = new Prisma.Decimal(sumWeightedSnf.div(sumGross).toFixed(2));
  const weighted_avg_ts = new Prisma.Decimal(sumWeightedTs.div(sumGross).toFixed(2));

  return {
    assigned_shop_count,
    collected_shop_count,
    skipped_shop_count,
    pending_shop_count,
    total_gross_liters,
    total_at_13ts_liters,
    weighted_avg_lr,
    weighted_avg_fat,
    weighted_avg_snf,
    weighted_avg_ts,
    source_calculation_versions,
  };
}

function serializeSummaryAuditValues(summary: any): Record<string, any> {
  return {
    journey_id: summary.journey_id.toString(),
    revision: summary.revision,
    assigned_shop_count: summary.assigned_shop_count,
    collected_shop_count: summary.collected_shop_count,
    skipped_shop_count: summary.skipped_shop_count,
    pending_shop_count: summary.pending_shop_count,
    total_gross_liters: Number(summary.total_gross_liters).toFixed(2),
    total_at_13ts_liters: Number(summary.total_at_13ts_liters).toFixed(2),
    weighted_avg_lr: summary.weighted_avg_lr != null ? Number(summary.weighted_avg_lr).toFixed(2) : null,
    weighted_avg_fat: summary.weighted_avg_fat != null ? Number(summary.weighted_avg_fat).toFixed(2) : null,
    weighted_avg_snf: summary.weighted_avg_snf != null ? Number(summary.weighted_avg_snf).toFixed(2) : null,
    weighted_avg_ts: summary.weighted_avg_ts != null ? Number(summary.weighted_avg_ts).toFixed(2) : null,
    summary_version: summary.summary_version,
    source_calculation_versions: Array.isArray(summary.source_calculation_versions)
      ? summary.source_calculation_versions
      : typeof summary.source_calculation_versions === 'string'
      ? JSON.parse(summary.source_calculation_versions)
      : [],
    journey_ended_at: summary.journey_ended_at instanceof Date ? summary.journey_ended_at.toISOString() : summary.journey_ended_at,
  };
}

/**
 * Creates the initial MotJourneySummary within an existing transaction.
 * Invoked during ZMCC MOT arrival recording when journey becomes COMPLETED.
 */
export async function createInitialMotJourneySummaryTx(
  tx: Prisma.TransactionClient,
  journeyId: bigint,
  journeyEndedAt: Date,
  actorUserId: bigint
) {
  // Idempotency check: if summary already exists, return existing
  const existing = await tx.motJourneySummary.findUnique({
    where: { journey_id: journeyId },
  });
  if (existing) {
    return existing;
  }

  // Load stops and qualifying collections (device_collected_at <= journeyEndedAt)
  const stops = await tx.motJourneyStop.findMany({
    where: { journey_id: journeyId },
    select: { id: true, status: true, skipped_at: true },
    orderBy: { planned_sequence: 'asc' },
  });

  const collections = await tx.motShopCollection.findMany({
    where: {
      journey_id: journeyId,
      device_collected_at: { lte: journeyEndedAt },
    },
    select: {
      id: true,
      journey_stop_id: true,
      gross_liters: true,
      at_13ts_liters: true,
      lr: true,
      fat: true,
      snf: true,
      ts: true,
      calculation_version: true,
    },
  });

  const metrics = calculateJourneySummaryMetrics(stops, collections);
  const now = new Date();

  const summary = await tx.motJourneySummary.create({
    data: {
      journey_id: journeyId,
      journey_ended_at: journeyEndedAt,
      assigned_shop_count: metrics.assigned_shop_count,
      collected_shop_count: metrics.collected_shop_count,
      skipped_shop_count: metrics.skipped_shop_count,
      pending_shop_count: metrics.pending_shop_count,
      total_gross_liters: metrics.total_gross_liters,
      total_at_13ts_liters: metrics.total_at_13ts_liters,
      weighted_avg_lr: metrics.weighted_avg_lr,
      weighted_avg_fat: metrics.weighted_avg_fat,
      weighted_avg_snf: metrics.weighted_avg_snf,
      weighted_avg_ts: metrics.weighted_avg_ts,
      summary_version: MOT_JOURNEY_SUMMARY_VERSION,
      source_calculation_versions: metrics.source_calculation_versions,
      revision: 1,
      generated_at: now,
      last_recomputed_at: null,
    },
  });

  await tx.auditLog.create({
    data: {
      table_name: 'mot_journey_summary',
      record_id: summary.id,
      action: 'MOT_JOURNEY_SUMMARY_CREATED',
      old_values: Prisma.DbNull,
      new_values: serializeSummaryAuditValues(summary),
      user_id: actorUserId,
    },
  });

  return summary;
}

/**
 * Recomputes an existing MotJourneySummary when a delayed collection arrives after journey completion.
 * Invoked within the same transaction that inserts the delayed collection.
 */
export async function recomputeMotJourneySummaryTx(
  tx: Prisma.TransactionClient,
  journeyId: bigint,
  actorUserId: bigint
) {
  const existing = await tx.motJourneySummary.findUnique({
    where: { journey_id: journeyId },
  });

  if (!existing) {
    // If summary hasn't been created yet (journey not completed), nothing to recompute
    return null;
  }

  const stops = await tx.motJourneyStop.findMany({
    where: { journey_id: journeyId },
    select: { id: true, status: true, skipped_at: true },
    orderBy: { planned_sequence: 'asc' },
  });

  const collections = await tx.motShopCollection.findMany({
    where: {
      journey_id: journeyId,
      device_collected_at: { lte: existing.journey_ended_at },
    },
    select: {
      id: true,
      journey_stop_id: true,
      gross_liters: true,
      at_13ts_liters: true,
      lr: true,
      fat: true,
      snf: true,
      ts: true,
      calculation_version: true,
    },
  });

  const metrics = calculateJourneySummaryMetrics(stops, collections);

  const isDecimalDifferent = (
    d1: Prisma.Decimal | null | undefined,
    d2: Prisma.Decimal | null | undefined
  ): boolean => {
    if (d1 == null && d2 == null) return false;
    if (d1 == null || d2 == null) return true;
    return !new Prisma.Decimal(d1).equals(new Prisma.Decimal(d2));
  };

  const changed =
    existing.assigned_shop_count !== metrics.assigned_shop_count ||
    existing.collected_shop_count !== metrics.collected_shop_count ||
    existing.skipped_shop_count !== metrics.skipped_shop_count ||
    existing.pending_shop_count !== metrics.pending_shop_count ||
    isDecimalDifferent(existing.total_gross_liters, metrics.total_gross_liters) ||
    isDecimalDifferent(existing.total_at_13ts_liters, metrics.total_at_13ts_liters) ||
    isDecimalDifferent(existing.weighted_avg_lr, metrics.weighted_avg_lr) ||
    isDecimalDifferent(existing.weighted_avg_fat, metrics.weighted_avg_fat) ||
    isDecimalDifferent(existing.weighted_avg_snf, metrics.weighted_avg_snf) ||
    isDecimalDifferent(existing.weighted_avg_ts, metrics.weighted_avg_ts) ||
    JSON.stringify(existing.source_calculation_versions) !== JSON.stringify(metrics.source_calculation_versions);

  if (!changed) {
    // Idempotent or no-op: do not increment revision, do not create audit log
    return existing;
  }

  const newRevision = existing.revision + 1;
  const now = new Date();

  const updated = await tx.motJourneySummary.update({
    where: { id: existing.id },
    data: {
      assigned_shop_count: metrics.assigned_shop_count,
      collected_shop_count: metrics.collected_shop_count,
      skipped_shop_count: metrics.skipped_shop_count,
      pending_shop_count: metrics.pending_shop_count,
      total_gross_liters: metrics.total_gross_liters,
      total_at_13ts_liters: metrics.total_at_13ts_liters,
      weighted_avg_lr: metrics.weighted_avg_lr,
      weighted_avg_fat: metrics.weighted_avg_fat,
      weighted_avg_snf: metrics.weighted_avg_snf,
      weighted_avg_ts: metrics.weighted_avg_ts,
      source_calculation_versions: metrics.source_calculation_versions,
      revision: newRevision,
      last_recomputed_at: now,
    },
  });

  await tx.auditLog.create({
    data: {
      table_name: 'mot_journey_summary',
      record_id: existing.id,
      action: 'MOT_JOURNEY_SUMMARY_REFRESHED_LATE_SYNC',
      old_values: serializeSummaryAuditValues(existing),
      new_values: serializeSummaryAuditValues(updated),
      user_id: actorUserId,
    },
  });

  return updated;
}

/**
 * Canonical serializer for MotJourneySummary into client-friendly plain object.
 */
export function serializeMotJourneySummary(summary: any): SerializedMotJourneySummary | null {
  if (!summary) return null;

  return {
    id: summary.id.toString(),
    journey_id: summary.journey_id.toString(),
    journey_ended_at: summary.journey_ended_at instanceof Date ? summary.journey_ended_at.toISOString() : summary.journey_ended_at,
    assigned_shop_count: summary.assigned_shop_count,
    collected_shop_count: summary.collected_shop_count,
    skipped_shop_count: summary.skipped_shop_count,
    pending_shop_count: summary.pending_shop_count,
    total_gross_liters: summary.total_gross_liters != null ? Number(Number(summary.total_gross_liters).toFixed(2)) : 0,
    total_at_13ts_liters: summary.total_at_13ts_liters != null ? Number(Number(summary.total_at_13ts_liters).toFixed(2)) : 0,
    weighted_avg_lr: summary.weighted_avg_lr != null ? Number(Number(summary.weighted_avg_lr).toFixed(2)) : null,
    weighted_avg_fat: summary.weighted_avg_fat != null ? Number(Number(summary.weighted_avg_fat).toFixed(2)) : null,
    weighted_avg_snf: summary.weighted_avg_snf != null ? Number(Number(summary.weighted_avg_snf).toFixed(2)) : null,
    weighted_avg_ts: summary.weighted_avg_ts != null ? Number(Number(summary.weighted_avg_ts).toFixed(2)) : null,
    summary_version: summary.summary_version,
    source_calculation_versions: Array.isArray(summary.source_calculation_versions)
      ? summary.source_calculation_versions
      : typeof summary.source_calculation_versions === 'string'
      ? JSON.parse(summary.source_calculation_versions)
      : [],
    revision: summary.revision,
    generated_at: summary.generated_at instanceof Date ? summary.generated_at.toISOString() : summary.generated_at,
    last_recomputed_at: summary.last_recomputed_at
      ? summary.last_recomputed_at instanceof Date
        ? summary.last_recomputed_at.toISOString()
        : summary.last_recomputed_at
      : null,
  };
}
