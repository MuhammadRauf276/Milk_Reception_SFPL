import type { OperationalStage } from '@/backend/services/escalation/approvalMatrix';

export const STAGE_LABELS: Record<OperationalStage, { label: string; badge: string; color: string }> = {
  STAGE_1: { label: 'Stage 1 · Area (MOT)', badge: 'S1 Area', color: 'bg-blue-100 text-blue-800 border-blue-200' },
  STAGE_2: { label: 'Stage 2 · ZMCC Reception', badge: 'S2 ZMCC', color: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
  STAGE_3: { label: 'Stage 3 · Dispatch', badge: 'S3 Dispatch', color: 'bg-violet-100 text-violet-800 border-violet-200' },
  STAGE_4: { label: 'Stage 4 · Plant QA', badge: 'S4 Plant', color: 'bg-amber-100 text-amber-800 border-amber-200' },
};

export function formatWaitingLabel(waitingMinutes: number): string {
  if (waitingMinutes < 1) return '<1m';
  if (waitingMinutes < 60) return `${waitingMinutes}m`;
  const hours = Math.floor(waitingMinutes / 60);
  const mins = waitingMinutes % 60;
  return `${hours}h ${mins}m`;
}
