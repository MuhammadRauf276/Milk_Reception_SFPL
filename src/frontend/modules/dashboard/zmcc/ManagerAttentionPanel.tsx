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
      <div className="p-6 rounded-xl bg-[#FFFFFF] border border-[#EAE4D5]/80 shadow-sm text-center space-y-2">
        <div className="w-10 h-10 rounded-full bg-[#F0FDF4] text-[#166534] flex items-center justify-center mx-auto border border-[#BBF7D0]">
          <CheckCircle2 className="w-5 h-5" />
        </div>
        <h4 className="text-sm font-extrabold text-[#111311]">No Items Need Attention</h4>
        <p className="text-xs text-slate-500 max-w-md mx-auto">
          All active dispatches from your ZMCC source are progressing normally through laboratory testing, weighbridge, and silo reception.
        </p>
      </div>
    );
  }

  return (
    <div className="p-5 rounded-xl bg-[#FFFFFF] border border-[#EAE4D5]/80 shadow-sm space-y-4">
      <div className="flex items-center justify-between pb-2 border-b border-[#EAE4D5]/80">
        <div className="flex items-center space-x-2">
          <AlertTriangle className="w-4 h-4 text-[#B45309]" />
          <h3 className="text-sm font-extrabold text-[#111311]">
            Needs Attention ({items.length})
          </h3>
        </div>
        <span className="text-[11px] font-bold text-slate-500">
          Derived operational supervisory indicators
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {items.map((item) => {
          const Icon = TYPE_ICONS[item.type] || AlertTriangle;

          let cardBg = 'bg-[#FDFBF9] border-[#EAE4D5]';
          let iconColor = 'text-[#1E3A8A] bg-blue-50 border-blue-200';
          let badgeText = 'Notice';
          let badgeStyle = 'bg-slate-100 text-slate-700';

          if (item.type === 'PLANT_QA_REJECTION') {
            cardBg = 'bg-[#FEF2F2]/60 border-[#FECACA]';
            iconColor = 'text-[#991B1B] bg-red-100 border-red-300';
            badgeText = 'QA Rejection';
            badgeStyle = 'bg-[#FEF2F2] text-[#991B1B] border border-[#FECACA]';
          } else if (item.type === 'RECEIPT_PENDING') {
            cardBg = 'bg-[#FAF5FF]/60 border-[#E9D5FF]';
            iconColor = 'text-[#6B21A8] bg-purple-100 border-purple-300';
            badgeText = 'Receipt Pending';
            badgeStyle = 'bg-[#FAF5FF] text-[#6B21A8] border border-[#E9D5FF]';
          } else if (item.type === 'QUANTITY_DIFFERENCE') {
            cardBg = 'bg-[#EFF6FF]/60 border-[#BFDBFE]';
            iconColor = 'text-[#1E40AF] bg-blue-100 border-blue-300';
            badgeText = 'Quantity Difference';
            badgeStyle = 'bg-[#EFF6FF] text-[#1E40AF] border border-[#BFDBFE]';
          } else if (item.type === 'QUALITY_DIFFERENCE') {
            cardBg = 'bg-[#FFFBEB]/60 border-[#FDE68A]';
            iconColor = 'text-[#B45309] bg-amber-100 border-amber-300';
            badgeText = 'Quality Difference';
            badgeStyle = 'bg-[#FFFBEB] text-[#B45309] border border-[#FDE68A]';
          } else if (item.type === 'IN_PLANT_DURATION') {
            cardBg = 'bg-[#F8FAFC] border-slate-200';
            iconColor = 'text-slate-700 bg-slate-100 border-slate-300';
            badgeText = 'In Plant';
            badgeStyle = 'bg-slate-100 text-slate-700 border border-slate-200';
          }

          return (
            <div
              key={item.id}
              className={`p-4 rounded-xl border flex flex-col justify-between space-y-3 transition shadow-xs hover:shadow-sm ${cardBg}`}
            >
              <div className="space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center space-x-2">
                    <div className={`p-1.5 rounded-lg border ${iconColor}`}>
                      <Icon className="w-3.5 h-3.5" />
                    </div>
                    <div>
                      <span className="font-mono font-black text-xs text-[#111311] block">
                        {item.vehicleNumber}
                      </span>
                      <span className="text-[10px] text-slate-500 font-bold">
                        Visit #{item.visitId}
                      </span>
                    </div>
                  </div>
                  <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider ${badgeStyle}`}>
                    {badgeText}
                  </span>
                </div>

                <div>
                  <h4 className="text-xs font-extrabold text-[#111311]">{item.title}</h4>
                  <p className="text-[11px] text-slate-600 font-medium mt-0.5 leading-snug">
                    {item.description}
                  </p>
                </div>

                {item.metrics && item.metrics.length > 0 && (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 pt-1 font-mono text-[10.5px]">
                    {item.metrics.map((m, idx) => (
                      <div key={idx} className="bg-white/80 p-1.5 rounded border border-[#EAE4D5]/60">
                        <span className="text-[9px] text-slate-500 block font-sans">{m.label}</span>
                        <span className="font-black text-[#111311]">{m.value}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="pt-2 border-t border-[#EAE4D5]/60 flex items-center justify-between">
                <span className="text-[10px] font-bold text-slate-500">
                  {item.eventDate ? `Date: ${item.eventDate}` : ''}
                </span>
                <button
                  onClick={() => onInspectDetails(item.log)}
                  className="px-2.5 py-1 rounded-lg bg-[#1E3A8A] hover:bg-blue-900 text-white font-sans text-[10.5px] font-extrabold transition flex items-center space-x-1 shadow-xs"
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
