import { prisma } from '@core/db';
import { Prisma } from '@prisma/client';
import { writeAuditLog } from '@/backend/core/audit';
import type { ActingContext } from '@/types/acting';

export type WeighingAllowedUnits = 'KG' | 'LITER' | 'BOTH';

export interface WeighingPolicyView {
  manual_entry_enabled: boolean;
  allowed_units: WeighingAllowedUnits;
  /** What the Mobile Tester may enter milk in at the shop. */
  mot_allowed_units: WeighingAllowedUnits;
  /** Testing allowance for the ZMCC tank check on @13 TS: percent of the dispatch's @13 TS litres. */
  tank_variance_percent: number;
  version: number;
}

/** Highest testing allowance Super Admin may set. */
export const MAX_TANK_VARIANCE_PERCENT = 5;

type Db = Prisma.TransactionClient | typeof prisma;

const DEFAULT_POLICY: WeighingPolicyView = { manual_entry_enabled: false, allowed_units: 'BOTH', mot_allowed_units: 'LITER', tank_variance_percent: 0.5, version: 0 };

function normalizeUnits(value: string | null | undefined): WeighingAllowedUnits {
  return value === 'KG' || value === 'LITER' ? value : 'BOTH';
}

/** The single global weighing policy row (defaults when nobody has saved it yet). */
export async function getWeighingPolicyDb(db: Db): Promise<WeighingPolicyView> {
  const row = await db.zmccWeighingPolicy.findFirst({ orderBy: { id: 'asc' } });
  if (!row) return { ...DEFAULT_POLICY };
  return {
    manual_entry_enabled: row.manual_entry_enabled,
    allowed_units: normalizeUnits(row.allowed_units),
    mot_allowed_units: normalizeUnits(row.mot_allowed_units),
    tank_variance_percent: Number(row.tank_variance_percent),
    version: row.version,
  };
}

/** The ZMCC tank testing allowance in percent (0.5 when nobody has saved the policy). */
export async function getTankVariancePercent(db: Db): Promise<number> {
  return (await getWeighingPolicyDb(db)).tank_variance_percent;
}

/** The units the Mobile Tester's form offers, litres first. */
export function motUnitChoices(allowed: WeighingAllowedUnits): Array<'LITER' | 'KG'> {
  if (allowed === 'KG') return ['KG'];
  return allowed === 'BOTH' ? ['LITER', 'KG'] : ['LITER'];
}

export async function getWeighingPolicy(): Promise<WeighingPolicyView> {
  return getWeighingPolicyDb(prisma);
}

export function isUnitAllowed(allowed: WeighingAllowedUnits, unit: 'KG' | 'LITER'): boolean {
  return allowed === 'BOTH' || allowed === unit;
}

/** What MDO / PHE Operator may read: only the two settings. */
export async function getWeighingPolicyForOperators(): Promise<{
  manual_entry_enabled: boolean;
  allowed_units: WeighingAllowedUnits;
}> {
  const p = await getWeighingPolicy();
  return { manual_entry_enabled: p.manual_entry_enabled, allowed_units: p.allowed_units };
}

export async function updateWeighingPolicy(
  acting: ActingContext,
  payload: { manual_entry_enabled?: unknown; allowed_units?: unknown; mot_allowed_units?: unknown; tank_variance_percent?: unknown }
): Promise<{ status: number; data?: WeighingPolicyView; error?: string }> {
  if (typeof payload?.manual_entry_enabled !== 'boolean') {
    return { status: 400, error: 'manual_entry_enabled must be true or false.' };
  }
  const units = payload.allowed_units;
  if (units !== 'KG' && units !== 'LITER' && units !== 'BOTH') {
    return { status: 400, error: 'allowed_units must be KG, LITER or BOTH.' };
  }
  const motUnits = payload.mot_allowed_units;
  if (motUnits !== undefined && motUnits !== 'KG' && motUnits !== 'LITER' && motUnits !== 'BOTH') {
    return { status: 400, error: 'mot_allowed_units must be KG, LITER or BOTH.' };
  }
  const variance = payload.tank_variance_percent;
  if (
    variance !== undefined &&
    (typeof variance !== 'number' || !Number.isFinite(variance) || variance < 0 || variance > MAX_TANK_VARIANCE_PERCENT)
  ) {
    return { status: 400, error: `Tank variance must be a number from 0 to ${MAX_TANK_VARIANCE_PERCENT}%.` };
  }
  const varianceData = variance !== undefined ? { tank_variance_percent: new Prisma.Decimal(Number(variance).toFixed(2)) } : {};
  const enabled = payload.manual_entry_enabled;
  try {
    const saved = await prisma.$transaction(async (tx) => {
      const existing = await tx.zmccWeighingPolicy.findFirst({ orderBy: { id: 'asc' } });
      const row = existing
        ? await tx.zmccWeighingPolicy.update({
            where: { id: existing.id },
            data: {
              manual_entry_enabled: enabled,
              allowed_units: units,
              ...(motUnits ? { mot_allowed_units: motUnits } : {}),
              ...varianceData,
              version: { increment: 1 },
              updated_by: acting.userId,
            },
          })
        : await tx.zmccWeighingPolicy.create({
            data: {
              manual_entry_enabled: enabled,
              allowed_units: units,
              ...(motUnits ? { mot_allowed_units: motUnits } : {}),
              ...varianceData,
              updated_by: acting.userId,
            },
          });
      await writeAuditLog(tx, {
        tableName: 'zmcc_weighing_policy',
        recordId: row.id,
        action: existing ? 'ZMCC_WEIGHING_POLICY_UPDATED' : 'ZMCC_WEIGHING_POLICY_CREATED',
        oldValues: existing
          ? {
              manual_entry_enabled: existing.manual_entry_enabled,
              allowed_units: existing.allowed_units,
              mot_allowed_units: existing.mot_allowed_units,
              tank_variance_percent: Number(existing.tank_variance_percent),
            }
          : null,
        newValues: {
          manual_entry_enabled: row.manual_entry_enabled,
          allowed_units: row.allowed_units,
          mot_allowed_units: row.mot_allowed_units,
          tank_variance_percent: Number(row.tank_variance_percent),
        },
        actor: acting,
      });
      return row;
    });
    return {
      status: 200,
      data: {
        manual_entry_enabled: saved.manual_entry_enabled,
        allowed_units: normalizeUnits(saved.allowed_units),
        mot_allowed_units: normalizeUnits(saved.mot_allowed_units),
        tank_variance_percent: Number(saved.tank_variance_percent),
        version: saved.version,
      },
    };
  } catch (err) {
    console.error('updateWeighingPolicy error:', err);
    return { status: 500, error: 'Could not save the weighing policy.' };
  }
}
