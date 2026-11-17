import { prisma } from '@/backend/core/db';
import type { LifecycleStageId } from '@/frontend/modules/dashboard/zmcc/zmccManagerTypes';

/** Who a yard board step is waiting on: the approver's role and, for signed-in viewers, their name. */
export interface ApprovalWait {
  role: string;
  name: string | null;
}

/** A plant tanker waiting for an approval at one lifecycle stage. */
export interface TvVehicleApproval extends ApprovalWait {
  stageId: LifecycleStageId;
}

/** Roles whose approver is the manager of one source (ZMCC or contractor); other roles are plant-wide. */
const SOURCE_SCOPED = new Set(['ZMCC_MANAGER', 'CONTRACTOR_MANAGER', 'MDO']);

/**
 * Names of the active users holding each approver role, keyed `ROLE:sourceId` for source-scoped roles and
 * `ROLE` for plant-wide ones. Two names at most, joined with a comma. One query for the whole board.
 */
export async function resolveApproverNames(requests: Array<{ role: string; sourceId?: bigint | null }>): Promise<Map<string, string>> {
  const roles = Array.from(new Set(requests.map((r) => r.role)));
  const out = new Map<string, string>();
  if (roles.length === 0) return out;
  const users = await prisma.user.findMany({
    where: { is_active: true, role: { in: roles } },
    select: { full_name: true, username: true, role: true, procurement_source_id: true },
    orderBy: { id: 'asc' },
  });
  const grouped = new Map<string, string[]>();
  for (const u of users) {
    const key = SOURCE_SCOPED.has(u.role) ? `${u.role}:${u.procurement_source_id ?? ''}` : u.role;
    const list = grouped.get(key) ?? [];
    list.push(u.full_name || u.username);
    grouped.set(key, list);
  }
  for (const r of requests) {
    const key = SOURCE_SCOPED.has(r.role) ? `${r.role}:${r.sourceId ?? ''}` : r.role;
    const list = grouped.get(key);
    if (list?.length) out.set(key, list.slice(0, 2).join(', '));
  }
  return out;
}

export function approverKey(role: string, sourceId?: bigint | null): string {
  return SOURCE_SCOPED.has(role) ? `${role}:${sourceId ?? ''}` : role;
}
