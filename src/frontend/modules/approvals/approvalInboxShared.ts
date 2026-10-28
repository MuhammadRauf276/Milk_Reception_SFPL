import type { OperationalStage } from '@/backend/services/escalation/approvalMatrix';

export const STAGE_LABELS: Record<OperationalStage, { label: string; badge: string; color: string }> = {
  STAGE_1: { label: 'Area (Mobile Tester)', badge: 'Area', color: 'bg-blue-100 text-blue-800 border-blue-200' },
  STAGE_2: { label: 'ZMCC Reception', badge: 'ZMCC', color: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
  STAGE_3: { label: 'Dispatch', badge: 'Dispatch', color: 'bg-violet-100 text-violet-800 border-violet-200' },
  STAGE_4: { label: 'Plant QA', badge: 'Plant QA', color: 'bg-amber-100 text-amber-800 border-amber-200' },
};

export function cleanEntityTitle(title: string | undefined | null): string {
  return (title ?? '')
    .replace(/\s*\(MOT\)/g, ' (Mobile Tester)')
    .replace(/\s*\(MC\)/g, ' (Mobile Tester)')
    .replace(/^(Route: [^(]+?)\s*\(.*\)\s*$/, '$1')
    .replace(/\bMOT\b/g, 'Mobile Tester')
    .replace(/\bMC\b/g, 'Mobile Tester');
}

export function formatWaitingLabel(waitingMinutes: number): string {
  if (waitingMinutes < 1) return '<1m';
  if (waitingMinutes < 60) return `${waitingMinutes}m`;
  const hours = Math.floor(waitingMinutes / 60);
  const mins = waitingMinutes % 60;
  return `${hours}h ${mins}m`;
}
