'use client';

import React from 'react';
import { InfoTip } from '@/components/ui/info-tip';
import { ZMCCAttentionItem } from './zmccManagerTypes';
import { MilkProcessLog } from '@backend/core/types';
import {
  AlertTriangle,
  Clock,
  ArrowRightLeft,
  FlaskConical,
  Scale,
  Eye,
  CheckCircle2,
} from 'lucide-react';

interface ManagerAttentionPanelProps {
  items: ZMCCAttentionItem[];
  onInspectDetails: (log: MilkProcessLog) => void;
}

const TYPE_ICONS: Record<string, React.ElementType> = {
  PLANT_QA_REJECTION: AlertTriangle,
  RECEIPT_PENDING: Scale,
  QUANTITY_DIFFERENCE: ArrowRightLeft,
  QUALITY_DIFFERENCE: FlaskConical,
  IN_PLANT_DURATION: Clock,
};

export const ManagerAttentionPanel: React.FC<ManagerAttentionPanelProps> = ({
  items,
  onInspectDetails,
}) => {
  if (items.length === 0) {
    return (
      <div className="p-6 rounded-2xl bg-card border border-border/80 shadow-xs text-center space-y-2">
        <div className="w-10 h-10 rounded-full bg-emerald-50 text-emerald-800 flex items-center justify-center mx-auto border border-emerald-200">
          <CheckCircle2 className="w-5 h-5" />
        </div>
        <h4 className="text-sm font-semibold text-foreground">Nothing needs attention</h4>
        <p className="text-xs text-muted-foreground max-w-md mx-auto">
          All on track
        </p>
      </div>
    );
  }

  return (
    <div className="p-5 rounded-2xl bg-card border border-border/80 shadow-xs space-y-4">
      <div className="flex items-center justify-between pb-2 border-b border-border/80">
        <div className="flex items-center space-x-2">
          <AlertTriangle className="w-4 h-4 text-amber-700" />
          <h3 className="text-sm font-semibold text-foreground">
            Needs Attention ({items.length})
          </h3>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {items.map((item) => {
          const Icon = TYPE_ICONS[item.type] || AlertTriangle;

          let cardBg = 'bg-card border-border';
          let iconColor = 'text-primary bg-blue-50 border-blue-200';
          let badgeText = 'Notice';
          let badgeStyle = 'bg-muted text-secondary-foreground';

          if (item.type === 'PLANT_QA_REJECTION') {
            cardBg = 'bg-card border-border';
            iconColor = 'text-rose-800 bg-rose-100 border-rose-300';
            badgeText = 'QA Rejection';
            badgeStyle = 'bg-rose-50 text-rose-800 border border-rose-200';
          } else if (item.type === 'RECEIPT_PENDING') {
            cardBg = 'bg-card border-border';
            iconColor = 'text-amber-800 bg-amber-100 border-amber-300';
            badgeText = 'Receipt Pending';
            badgeStyle = 'bg-amber-50 text-amber-800 border border-amber-200';
          } else if (item.type === 'QUANTITY_DIFFERENCE') {
            cardBg = 'bg-card border-border';
            iconColor = 'text-blue-800 bg-blue-100 border-blue-300';
            badgeText = 'Quantity Difference';
            badgeStyle = 'bg-blue-50 text-blue-800 border border-blue-200';
          } else if (item.type === 'QUALITY_DIFFERENCE') {
            cardBg = 'bg-card border-border';
            iconColor = 'text-amber-700 bg-amber-100 border-amber-300';
            badgeText = 'Quality Difference';
            badgeStyle = 'bg-amber-50 text-amber-700 border border-amber-200';
          } else if (item.type === 'IN_PLANT_DURATION') {
            cardBg = 'bg-card border-border';
            iconColor = 'text-secondary-foreground bg-muted border-border-strong';
            badgeText = 'In Plant';
            badgeStyle = 'bg-muted text-secondary-foreground border border-border';
          }

          return (
            <div
              key={item.id}
              className={`p-4 rounded-2xl border flex flex-col justify-between space-y-3 transition shadow-2xs hover:shadow-xs ${cardBg}`}
            >
              <div className="space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center space-x-2">
                    <div className={`p-2 rounded-lg border ${iconColor}`}>
                      <Icon className="w-3.5 h-3.5" />
                    </div>
                    <div>
                      <span className="tabular-nums font-semibold text-xs text-foreground block">
                        {item.vehicleNumber}
                      </span>
                      {item.log?.token_number ? (
                        <span className="text-xs text-muted-foreground font-semibold">
                          Token {item.log.token_number}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <span className={`px-2 py-0.5 rounded-md text-xs font-semibold ${badgeStyle}`}>
                    {badgeText}
                  </span>
                </div>

                <div className="flex items-center gap-1 min-w-0">
                  <h4 className="text-xs font-semibold text-foreground">{item.title}</h4>
                  {item.description ? <InfoTip text={item.description} /> : null}
                </div>

                {item.metrics && item.metrics.length > 0 && (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-1 tabular-nums text-xs">
                    {item.metrics.map((m, idx) => (
                      <div key={idx} className="bg-white/80 p-2 rounded border border-border/60">
                        <span className="text-xs text-muted-foreground block font-sans">{m.label}</span>
                        <span className="font-semibold text-foreground">{m.value}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="pt-2 border-t border-border/60 flex items-center justify-between">
                <span className="text-xs font-semibold text-muted-foreground">
                  {item.eventDate ? `Date: ${item.eventDate}` : ''}
                </span>
                <button
                  onClick={() => onInspectDetails(item.log)}
                  className="px-3 py-1 rounded-lg bg-primary hover:bg-primary-hover text-white font-sans text-xs font-semibold transition flex items-center space-x-1 shadow-2xs min-h-11 min-w-11"
                >
                  <Eye className="w-3 h-3" />
                  <span>View Details</span>
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
