import { prisma } from '@core/db';
import { canActAs } from '@/backend/core/roles/hierarchy';

export const DEFAULT_MTD_WARNING_THRESHOLD = 4;
const MODULE_NAME = 'QA_POLICY';
const THRESHOLD_KEY = 'MTD_WARNING_THRESHOLD';

/**
 * Computes Month-To-Date (MTD) date boundaries for Pakistan Standard Time (PKT, UTC+5).
 */
export function getPktMtdDateRange(atDate: Date = new Date()): { startOfMonth: Date; endOfMonth: Date } {
  // PKT is UTC+5
  const pktMs = atDate.getTime() + 5 * 3600 * 1000;
  const pktDate = new Date(pktMs);

  const year = pktDate.getUTCFullYear();
  const month = pktDate.getUTCMonth(); // 0-indexed

  // Start of month in PKT: YYYY-MM-01 00:00:00 PKT -> (UTC-5h)
  const startPktUtcMs = Date.UTC(year, month, 1, 0, 0, 0, 0) - 5 * 3600 * 1000;
  const startOfMonth = new Date(startPktUtcMs);

  // End of month in PKT: YYYY-MM-(last day) 23:59:59.999 PKT
  const nextMonthFirstUtcMs = Date.UTC(year, month + 1, 1, 0, 0, 0, 0) - 5 * 3600 * 1000;
  const endOfMonth = new Date(nextMonthFirstUtcMs - 1);

  return { startOfMonth, endOfMonth };
}

export class QaWarningEscalationService {
  /**
   * Retrieves the Super Admin configurable MTD warning threshold.
   * Default is 4.
   */
  static async getMtdWarningThreshold(): Promise<number> {
    try {
      const config = await prisma.configChangeLog.findFirst({
        where: {
          module: MODULE_NAME,
          entity_key: THRESHOLD_KEY,
        },
        orderBy: { id: 'desc' },
      });

      if (config && config.new_value) {
        const val = typeof config.new_value === 'object' && config.new_value !== null && 'threshold' in (config.new_value as Record<string, unknown>)
          ? Number((config.new_value as Record<string, unknown>).threshold)
          : Number(config.new_value);
        if (Number.isFinite(val) && val > 0) {
          return val;
        }
      }
    } catch (e) {
      console.warn('[QaWarningEscalationService] getMtdWarningThreshold error, using default', e);
    }
    return DEFAULT_MTD_WARNING_THRESHOLD;
  }

  /**
   * Updates the Super Admin configurable MTD warning threshold.
   */
  static async setMtdWarningThreshold(
    threshold: number,
    actorUserId: bigint,
    reason: string
  ): Promise<number> {
    const cleanThreshold = Math.max(1, Math.min(100, Math.round(threshold)));
    const current = await this.getMtdWarningThreshold();

    await prisma.configChangeLog.create({
      data: {
        module: MODULE_NAME,
        entity_key: THRESHOLD_KEY,
        old_value: { threshold: current },
        new_value: { threshold: cleanThreshold },
        changed_by: actorUserId,
        reason: reason || 'Updated MTD warning escalation threshold',
        status: 'APPLIED',
      },
    });

    return cleanThreshold;
  }

  /**
   * Counts distinct vehicle visits accepted with warnings in current Month-To-Date (MTD)
   * for a given procurement source.
   *
   * DEDUPLICATION INVARIANT:
   * A vehicle with multiple warning tests counts as exactly ONE (1) warning event.
   */
  static async getProcurementSourceMtdWarningCount(
    sourceId: bigint | string,
    atDate: Date = new Date()
  ): Promise<number> {
    const sId = BigInt(sourceId.toString());
    const { startOfMonth, endOfMonth } = getPktMtdDateRange(atDate);

    // Retrieve active warnings for this source in current month
    const warnings = await prisma.qAWarning.findMany({
      where: {
        procurement_source_id: sId,
        status: 'ACTIVE',
        OR: [
          { operational_timestamp: { gte: startOfMonth, lte: endOfMonth } },
          {
            AND: [
              { operational_timestamp: null },
              { created_at: { gte: startOfMonth, lte: endOfMonth } },
            ],
          },
        ],
      },
      select: { visit_id: true, id: true },
    });

    // Deduplicate by visit_id (if visit_id is null, fallback to distinct warning id)
    const distinctVehicles = new Set<string>();
    for (const w of warnings) {
      if (w.visit_id) {
        distinctVehicles.add(`visit:${w.visit_id.toString()}`);
      } else {
        distinctVehicles.add(`warning:${w.id.toString()}`);
      }
    }

    return distinctVehicles.size;
  }

  /**
   * Evaluates if an acceptance of a vehicle with warning requires escalation to AVP-QA (QA Head).
   *
   * Escalation Trigger:
   * - Vehicle has at least 1 test in Warning Hold.
   * - Procurement source has reached or exceeded the MTD warning limit (Count >= Threshold).
   * - Operator is normal QAE (QA_LAB_ATTENDANT).
   * - If user is already AVP (QA_HEAD) or Super Admin, they have superior authority to decide directly.
   */
  static async evaluateWarningEscalation(
    sourceId: bigint | string | null | undefined,
    hasWarning: boolean,
    actorRole: string,
    atDate: Date = new Date()
  ): Promise<{
    requiresAvpEscalation: boolean;
    currentMtdCount: number;
    threshold: number;
    reason?: string;
  }> {
    const threshold = await this.getMtdWarningThreshold();

    if (!sourceId || !hasWarning) {
      return { requiresAvpEscalation: false, currentMtdCount: 0, threshold };
    }

    const currentMtdCount = await this.getProcurementSourceMtdWarningCount(sourceId, atDate);
    const isSuperior = actorRole === 'SUPER_ADMIN' || canActAs(actorRole, 'QA_HEAD');

    // If source has reached or exceeded threshold and actor is NOT a superior authority:
    if (currentMtdCount >= threshold && !isSuperior) {
      return {
        requiresAvpEscalation: true,
        currentMtdCount,
        threshold,
        reason: `Monthly warning limit reached for this procurement source (${currentMtdCount}/${threshold} warnings this month). Acceptance requires AVP Reception Lab authorization.`,
      };
    }

    return {
      requiresAvpEscalation: false,
      currentMtdCount,
      threshold,
    };
  }

  /**
   * Records an accepted vehicle warning event against the procurement source.
   * Ensures that multiple warning tests on the same vehicle are deduplicated into a single visit record.
   */
  static async recordVehicleAcceptedWarning(
    visitId: bigint,
    portionId: bigint,
    sourceId: bigint,
    warningTestCodes: string[],
    userId: bigint,
    opTs: Date = new Date()
  ): Promise<void> {
    if (warningTestCodes.length === 0) return;

    // Check if warning already logged for this visit to maintain deduplication
    const existing = await prisma.qAWarning.findFirst({
      where: {
        visit_id: visitId,
        procurement_source_id: sourceId,
        status: 'ACTIVE',
      },
    });

    const reasonText = `Accepted with warning in ${warningTestCodes.length} test(s): ${warningTestCodes.join(', ')}`;

    if (existing) {
      // Update existing record
      await prisma.qAWarning.update({
        where: { id: existing.id },
        data: {
          portion_id: portionId,
          reason: reasonText,
          operational_timestamp: opTs,
        },
      });
    } else {
      // Create single vehicle warning record
      await prisma.qAWarning.create({
        data: {
          procurement_source_id: sourceId,
          visit_id: visitId,
          portion_id: portionId,
          reason: reasonText,
          operational_timestamp: opTs,
          status: 'ACTIVE',
          created_by: userId,
        },
      });
    }
  }
}
