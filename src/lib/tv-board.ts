import type { MilkProcessLog } from '@/backend/core/types';

/**
 * The operational read model may return one row per portion. The TV board is
 * vehicle-based, so it must render one card per vehicle visit.
 */
export function getActiveTvBoardVehicles(logs: readonly MilkProcessLog[]): MilkProcessLog[] {
  const ordered = logs
    .filter((log) => log.status !== 'Completed')
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

  const byVisit = new Map<string, MilkProcessLog>();
  for (const log of ordered) {
    const visitIdentity = String(log.id);
    if (!byVisit.has(visitIdentity)) {
      byVisit.set(visitIdentity, log);
    }
  }

  return Array.from(byVisit.values());
}
