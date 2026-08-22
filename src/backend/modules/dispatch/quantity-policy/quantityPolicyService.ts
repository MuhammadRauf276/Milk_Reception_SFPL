import { PrismaClient, Prisma } from '@prisma/client';
import {
  DispatchQuantityPolicyConfig,
  DispatchQuantityPolicySnapshotDTO,
  DEFAULT_DISPATCH_QUANTITY_POLICY,
} from './types';
import { validateQuantityPolicy } from './validation';

type DbClient = PrismaClient | Prisma.TransactionClient;

export function serializeQuantityPolicySnapshot(
  snapshot: any
): DispatchQuantityPolicySnapshotDTO {
  return {
    id: snapshot.id?.toString(),
    visitId: snapshot.visit_id.toString(),
    sourceId: snapshot.source_id.toString(),
    policyVersion: snapshot.policy_version,
    policy: snapshot.policy_snapshot as DispatchQuantityPolicyConfig,
    createdAt: snapshot.created_at ? snapshot.created_at.toISOString() : undefined,
  };
}

/**
 * Resolves the active Dispatch Quantity Policy for a given procurement source.
 * Falls back to DEFAULT_DISPATCH_QUANTITY_POLICY if the source has not defined a custom policy.
 * Operates purely on configuration without source-type branching.
 */
export async function resolveSourceQuantityPolicy(
  db: DbClient,
  sourceId: bigint | number | string
): Promise<DispatchQuantityPolicyConfig> {
  const parsedSourceId = typeof sourceId === 'bigint' ? sourceId : BigInt(sourceId);
  const source = await db.procurementSource.findUnique({
    where: { id: parsedSourceId },
  });

  if (!source) {
    throw new Error(`Procurement source with ID ${parsedSourceId} not found.`);
  }

  if (source.dispatch_quantity_policy) {
    try {
      return validateQuantityPolicy(source.dispatch_quantity_policy);
    } catch (e: any) {
      console.warn(
        `[QuantityPolicyService] Source ${parsedSourceId} has malformed quantity policy. Falling back to default. Error:`,
        e.message
      );
      return DEFAULT_DISPATCH_QUANTITY_POLICY;
    }
  }

  return DEFAULT_DISPATCH_QUANTITY_POLICY;
}

/**
 * Retrieves an existing frozen policy snapshot for a visit, or creates a new immutable
 * snapshot based on the source's current policy configuration.
 */
export async function getOrFreezeDispatchQuantityPolicy(
  db: DbClient,
  visitId: bigint | number | string,
  sourceId: bigint | number | string
): Promise<DispatchQuantityPolicySnapshotDTO> {
  const parsedVisitId = typeof visitId === 'bigint' ? visitId : BigInt(visitId);
  const parsedSourceId = typeof sourceId === 'bigint' ? sourceId : BigInt(sourceId);

  // 1. Check for existing frozen snapshot
  const existing = await db.dispatchQuantityPolicySnapshot.findUnique({
    where: { visit_id: parsedVisitId },
  });

  if (existing) {
    return serializeQuantityPolicySnapshot(existing);
  }

  // 2. Resolve current source policy and freeze snapshot
  const currentPolicy = await resolveSourceQuantityPolicy(db, parsedSourceId);

  const created = await db.dispatchQuantityPolicySnapshot.create({
    data: {
      visit_id: parsedVisitId,
      source_id: parsedSourceId,
      policy_version: currentPolicy.version,
      policy_snapshot: currentPolicy as any,
    },
  });

  return serializeQuantityPolicySnapshot(created);
}

/**
 * Returns existing frozen policy snapshot for a visit, or null if none exists.
 */
export async function getFrozenDispatchQuantityPolicy(
  db: DbClient,
  visitId: bigint | number | string
): Promise<DispatchQuantityPolicySnapshotDTO | null> {
  const parsedVisitId = typeof visitId === 'bigint' ? visitId : BigInt(visitId);
  const existing = await db.dispatchQuantityPolicySnapshot.findUnique({
    where: { visit_id: parsedVisitId },
  });

  if (!existing) return null;
  return serializeQuantityPolicySnapshot(existing);
}

/**
 * Updates a procurement source's configured quantity policy.
 */
export async function updateSourceQuantityPolicy(
  db: DbClient,
  sourceId: bigint | number | string,
  policy: unknown
): Promise<DispatchQuantityPolicyConfig> {
  const parsedSourceId = typeof sourceId === 'bigint' ? sourceId : BigInt(sourceId);
  const validated = validateQuantityPolicy(policy);

  await db.procurementSource.update({
    where: { id: parsedSourceId },
    data: {
      dispatch_quantity_policy: validated as any,
    },
  });

  return validated;
}

