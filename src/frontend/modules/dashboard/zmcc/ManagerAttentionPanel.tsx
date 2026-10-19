'use client';

import React from 'react';
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
      <div className="p-6 rounded-xl bg-card border border-border/80 shadow-xs text-center space-y-2">
        <div className="w-10 h-10 rounded-full bg-green-50 text-green-800 flex items-center justify-center mx-auto border border-green-200">
          <CheckCircle2 className="w-5 h-5" />
        </div>
        <h4 className="text-sm font-semibold text-foreground">No Items Need Attention</h4>
        <p className="text-xs text-slate-500 max-w-md mx-auto">
          All active dispatches from your ZMCC source are progressing normally through laboratory testing, weighbridge, and silo reception.
        </p>
      </div>
    );
  }

  return (
    <div className="p-5 rounded-xl bg-card border border-border/80 shadow-xs space-y-4">
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

          let cardBg = 'bg-subtle border-border';
          let iconColor = 'text-primary bg-blue-50 border-blue-200';
          let badgeText = 'Notice';
          let badgeStyle = 'bg-slate-100 text-slate-700';

          if (item.type === 'PLANT_QA_REJECTION') {
            cardBg = 'bg-red-50/60 border-red-200';
            iconColor = 'text-red-800 bg-red-100 border-red-300';
            badgeText = 'QA Rejection';
            badgeStyle = 'bg-red-50 text-red-800 border border-red-200';
          } else if (item.type === 'RECEIPT_PENDING') {
            cardBg = 'bg-amber-50/60 border-amber-200';
            iconColor = 'text-amber-800 bg-amber-100 border-amber-300';
            badgeText = 'Receipt Pending';
            badgeStyle = 'bg-amber-50 text-amber-800 border border-amber-200';
          } else if (item.type === 'QUANTITY_DIFFERENCE') {
            cardBg = 'bg-blue-50/60 border-blue-200';
            iconColor = 'text-blue-800 bg-blue-100 border-blue-300';
            badgeText = 'Quantity Difference';
            badgeStyle = 'bg-blue-50 text-blue-800 border border-blue-200';
          } else if (item.type === 'QUALITY_DIFFERENCE') {
            cardBg = 'bg-amber-50/60 border-amber-200';
            iconColor = 'text-amber-700 bg-amber-100 border-amber-300';
            badgeText = 'Quality Difference';
            badgeStyle = 'bg-amber-50 text-amber-700 border border-amber-200';
          } else if (item.type === 'IN_PLANT_DURATION') {
            cardBg = 'bg-slate-50 border-slate-200';
            iconColor = 'text-slate-700 bg-slate-100 border-slate-300';
            badgeText = 'In Plant';
            badgeStyle = 'bg-slate-100 text-slate-700 border border-slate-200';
          }

          return (
            <div
              key={item.id}
              className={`p-4 rounded-xl border flex flex-col justify-between space-y-3 transition shadow-2xs hover:shadow-xs ${cardBg}`}
            >
              <div className="space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center space-x-2">
                    <div className={`p-1.5 rounded-lg border ${iconColor}`}>
                      <Icon className="w-3.5 h-3.5" />
                    </div>
                    <div>
                      <span className="tabular-nums font-semibold text-xs text-foreground block">
                        {item.vehicleNumber}
                      </span>
                      <span className="text-xs text-slate-500 font-semibold">
                        Visit #{item.visitId}
                      </span>
                    </div>
                  </div>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-semibold uppercase tracking-wider ${badgeStyle}`}>
                    {badgeText}
                  </span>
                </div>

                <div>
                  <h4 className="text-xs font-semibold text-foreground">{item.title}</h4>
                  <p className="text-xs text-slate-600 font-medium mt-0.5 leading-snug">
                    {item.description}
                  </p>
                </div>

                {item.metrics && item.metrics.length > 0 && (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 pt-1 tabular-nums text-xs">
                    {item.metrics.map((m, idx) => (
                      <div key={idx} className="bg-white/80 p-1.5 rounded border border-border/60">
                        <span className="text-xs text-slate-500 block font-sans">{m.label}</span>
                        <span className="font-semibold text-foreground">{m.value}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="pt-2 border-t border-border/60 flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-500">
                  {item.eventDate ? `Date: ${item.eventDate}` : ''}
                </span>
                <button
                  onClick={() => onInspectDetails(item.log)}
                  className="px-2.5 py-1 rounded-lg bg-primary hover:bg-primary-hover text-white font-sans text-xs font-semibold transition flex items-center space-x-1 shadow-2xs"
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
