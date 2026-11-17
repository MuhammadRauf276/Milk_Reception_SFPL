'use client';

import React from 'react';
import { StepRail, type StepRailApproval, type StepRailItem, type StepRailState } from '@/components/ui/step-rail';
import { LifecycleStageId, LifecycleStageInfo, ManagerLifecycleSummary } from './zmccManagerTypes';
import { CheckCircle2, Circle, FlaskConical, Scale, Building2, Truck, ShieldCheck, LogOut } from 'lucide-react';

interface ManagerLifecycleTrackerProps {
  lifecycle: ManagerLifecycleSummary;
  compact?: boolean;
  /** A stage waiting for someone's approval: that stage shows who it waits on. */
  approval?: (StepRailApproval & { stageId: LifecycleStageId }) | null;
}

const STAGE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  DISPATCH: Truck,
  GATE_ENTRY: ShieldCheck,
  PLANT_QA: FlaskConical,
  FIRST_WEIGHT: Scale,
  UNLOADING: Building2,
  SECOND_WEIGHT: Scale,
  FINAL_RECEIPT: CheckCircle2,
  GATE_EXIT: LogOut,
};

const STATE: Record<LifecycleStageInfo['status'], StepRailState> = {
  COMPLETED: 'done',
  CURRENT: 'current',
  UPCOMING: 'upcoming',
  SKIPPED: 'upcoming',
};

function qaTone(badge: ManagerLifecycleSummary['portionQA']['badgeType']): string {
  if (badge === 'ALL_ACCEPTED') return 'bg-emerald-50 text-emerald-800';
  if (badge === 'ALL_REJECTED' || badge === 'MIXED') return 'bg-rose-50 text-rose-800';
  if (badge === 'HAS_HOLD') return 'bg-amber-50 text-amber-700';
  return 'bg-muted text-secondary-foreground';
}

export const ManagerLifecycleTracker: React.FC<ManagerLifecycleTrackerProps> = ({ lifecycle, compact = false, approval }) => {
  const steps: StepRailItem[] = lifecycle.stages.map((stage) => {
    const waits = approval && approval.stageId === stage.id && (stage.status !== 'UPCOMING' || stage.id === 'DISPATCH');
    const lines: React.ReactNode[] = [];
    if (stage.status === 'CURRENT' && !waits) {
      lines.push(
        <span className="mt-0.5 inline-block rounded border border-primary/20 bg-primary/10 px-2 py-0.5 font-semibold text-primary">Current</span>
      );
    }
    if (stage.id === 'PLANT_QA' && stage.detailText) {
      lines.push(
        <span className={`mt-0.5 inline-block rounded px-2 py-0.5 font-semibold ${qaTone(lifecycle.portionQA.badgeType)}`}>{stage.detailText}</span>
      );
    }
    if (stage.metricText) lines.push(<span className="font-semibold text-secondary-foreground">{stage.metricText}</span>);
    if (stage.id === 'UNLOADING') {
      if (stage.detailText) lines.push(<span className="text-secondary-foreground">{stage.detailText}</span>);
      if (stage.eventTimestamp) lines.push(`Started: ${stage.eventTimestamp}`);
      if (stage.eventTimestampEnd) lines.push(`Completed: ${stage.eventTimestampEnd}`);
    } else if (stage.eventTimestamp) {
      lines.push(stage.eventTimestamp);
    }
    return {
      key: stage.key ?? stage.id,
      label: compact ? stage.shortLabel : stage.label,
      state: waits ? 'waiting' : STATE[stage.status],
      icon: STAGE_ICONS[stage.id] || Circle,
      lines,
      approval: waits ? { roleLabel: approval.roleLabel, name: approval.name } : null,
    };
  });

  return <StepRail steps={steps} ariaLabel="Vehicle progress" stepClassName={compact ? 'min-w-29' : 'min-w-34'} />;
};
