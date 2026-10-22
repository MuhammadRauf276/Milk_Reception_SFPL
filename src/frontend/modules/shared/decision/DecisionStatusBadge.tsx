import React from 'react';
import { AlertTriangle, CheckCircle2, Clock, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

export type DecisionBadgeStatus = 'ACCEPTED' | 'REJECTED' | 'PENDING' | 'EXCEPTION' | 'APPROVED';

interface DecisionStatusBadgeProps {
  status: DecisionBadgeStatus;
  label?: string;
  size?: 'md' | 'lg';
}

const STYLES: Record<DecisionBadgeStatus, { text: string; className: string; Icon: typeof CheckCircle2 }> = {
  ACCEPTED: { text: 'Accepted', className: 'border-emerald-300 bg-emerald-50 text-emerald-800', Icon: CheckCircle2 },
  APPROVED: { text: 'Approved', className: 'border-emerald-300 bg-emerald-50 text-emerald-800', Icon: CheckCircle2 },
  REJECTED: { text: 'Rejected', className: 'border-rose-300 bg-rose-50 text-rose-800', Icon: XCircle },
  PENDING: { text: 'Waiting for Approver', className: 'border-violet-300 bg-violet-50 text-violet-800', Icon: Clock },
  EXCEPTION: { text: 'Needs decision', className: 'border-amber-300 bg-amber-50 text-amber-900', Icon: AlertTriangle },
};

/** Colour + icon + word, so status never depends on colour alone. */
export function DecisionStatusBadge({ status, label, size = 'md' }: DecisionStatusBadgeProps) {
  const { text, className, Icon } = STYLES[status];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border font-semibold',
        size === 'lg' ? 'px-4 py-2 text-base' : 'px-2.5 py-1 text-sm',
        className
      )}
    >
      <Icon className={size === 'lg' ? 'h-5 w-5' : 'h-4 w-4'} aria-hidden="true" />
      {label ?? text}
    </span>
  );
}
