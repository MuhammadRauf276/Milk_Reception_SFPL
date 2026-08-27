'use client';

import React from 'react';
import { MilkProcessLog } from '@backend/core/types';
import { formatOperationalDatetime } from '@/lib/datetime-utils';
import {
  X,
  Truck,
  Scale,
  FlaskConical,
  Factory,
  CheckCircle2,
  AlertTriangle,
  Clock,
  ShieldCheck,
  Calendar,
  Layers,
  Database,
} from 'lucide-react';

interface ZMCCManagerVisitDetailModalProps {
  isOpen: boolean;
  log: MilkProcessLog | null;
  onClose: () => void;
  assignedSourceName?: string;
}

export const ZMCCManagerVisitDetailModal: React.FC<ZMCCManagerVisitDetailModalProps> = ({
  isOpen,
  log,
  onClose,
  assignedSourceName,
}) => {
  if (!isOpen || !log) return null;

  const isCompletedReceipt = Boolean(log.final_receipt_exists && log.final_receipt_timestamp);
  const isReceiptPending = Boolean(log.second_weight_of_vehicle != null && !log.final_receipt_exists);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
    >
      <div className="relative w-full max-w-4xl max-h-[90vh] bg-[#FFFFFF] rounded-2xl border border-[#EAE4D5] shadow-2xl overflow-hidden flex flex-col">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#EAE4D5] bg-[#FDFBF9]">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 rounded-xl bg-[#1E3A8A]/10 text-[#1E3A8A]">
              <Truck className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h2 id="modal-title" className="text-base font-black text-[#111311]">
                  Visit Detail: {log.vehicle_number}
                </h2>
                {log.token_number && (
                  <span className="px-2 py-0.5 rounded text-[11px] font-mono font-black bg-[#1E3A8A]/10 text-[#1E3A8A]">
                    Token: {log.token_number}
                  </span>
                )}
              </div>
              <p className="text-xs text-[#475569] font-medium">
                {assignedSourceName || log.zonal_contractor_name || 'ZMCC Source'} · Business Date:{' '}
                <span className="font-bold text-slate-800">{log.dispatch_date || '—'}</span>
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-all"
            aria-label="Close modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 text-xs">
          {/* 1. Lifecycle Status Banner */}
          <div className="p-4 rounded-xl bg-[#F8FAFC] border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center space-x-2">
              <span className="text-[11px] font-bold text-slate-600 uppercase tracking-wider">
                Overall Lifecycle State:
              </span>
              <span
                className={`px-2.5 py-0.5 rounded-full text-xs font-black uppercase tracking-wider ${
                  isCompletedReceipt
                    ? 'bg-emerald-100 text-emerald-800'
                    : isReceiptPending
                    ? 'bg-amber-100 text-amber-800'
                    : 'bg-blue-100 text-blue-800'
                }`}
              >
                {isCompletedReceipt ? 'Final Receipt Completed' : isReceiptPending ? 'Receipt Pending' : log.status || 'In Progress'}
              </span>
            </div>

            <div className="flex items-center space-x-1.5 text-slate-500 font-mono text-[11px]">
              <Clock className="w-3.5 h-3.5" />
              <span>Created: {log.created_at ? formatOperationalDatetime(log.created_at) : '—'}</span>
            </div>
          </div>

          {/* 2. Weighbridge & Physical Quantities (Authoritative) */}
          <div className="p-5 rounded-xl bg-[#FFFFFF] border border-[#EAE4D5]/80 space-y-4 shadow-sm">
            <div className="flex items-center space-x-2 border-b border-[#EAE4D5]/60 pb-2">
              <Scale className="w-4 h-4 text-[#1E3A8A]" />
              <h3 className="text-xs font-extrabold text-[#111311] uppercase tracking-wider">
                Authoritative Scale & Quantity Ledger
              </h3>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 font-mono">
              <div className="p-3 rounded-lg bg-[#FDFBF9] border border-[#EAE4D5]/60">
                <span className="text-[10px] font-sans font-bold text-slate-500 uppercase block">
                  Dispatch Gross Liters
                </span>
                <span className="text-sm font-black text-slate-900">
                  {log.vehicle_dispatch_gross_liters != null
                    ? `${log.vehicle_dispatch_gross_liters.toLocaleString()} L`
                    : '—'}
                </span>
              </div>

              <div className="p-3 rounded-lg bg-[#FDFBF9] border border-[#EAE4D5]/60">
                <span className="text-[10px] font-sans font-bold text-slate-500 uppercase block">
                  First Weight (Loaded Vehicle)
                </span>
                <span className="text-sm font-bold text-slate-800">
                  {log.first_weight_of_vehicle != null
                    ? `${log.first_weight_of_vehicle.toLocaleString()} kg`
                    : '—'}
                </span>
              </div>

              <div className="p-3 rounded-lg bg-[#FDFBF9] border border-[#EAE4D5]/60">
                <span className="text-[10px] font-sans font-bold text-slate-500 uppercase block">
                  Second Weight (After Unloading)
                </span>
                <span className="text-sm font-bold text-slate-800">
                  {log.second_weight_of_vehicle != null
                    ? `${log.second_weight_of_vehicle.toLocaleString()} kg`
                    : '—'}
                </span>
              </div>

              <div className="p-3 rounded-lg bg-[#FDFBF9] border border-[#EAE4D5]/60">
                <span className="text-[10px] font-sans font-bold text-slate-500 uppercase block">
                  Net Milk Weight
                </span>
                <span className="text-sm font-black text-[#1E3A8A]">
                  {log.computed_net_milk_weight != null
                    ? `${log.computed_net_milk_weight.toLocaleString()} kg`
                    : '—'}
                </span>
              </div>

              <div className="p-3 rounded-lg bg-[#FDFBF9] border border-[#EAE4D5]/60">
                <span className="text-[10px] font-sans font-bold text-slate-500 uppercase block">
                  Physical Received Liters
                </span>
                <span className="text-sm font-black text-[#166534]">
                  {log.authoritative_final_liters != null
                    ? `${log.authoritative_final_liters.toLocaleString()} L`
                    : '—'}
                </span>
              </div>

              <div className="p-3 rounded-lg bg-[#FDFBF9] border border-[#EAE4D5]/60">
                <span className="text-[10px] font-sans font-bold text-slate-500 uppercase block">
                  Final Liters @ 13% TS
                </span>
                <span className="text-sm font-bold text-slate-500">
                  —
                </span>
              </div>

              <div className="p-3 rounded-lg bg-[#FDFBF9] border border-[#EAE4D5]/60">
                <span className="text-[10px] font-sans font-bold text-slate-500 uppercase block">
                  Destination Silo
                </span>
                <span className="text-sm font-black text-slate-800">
                  {log.silo_storage_id || '—'}
                </span>
              </div>

              <div className="p-3 rounded-lg bg-[#FDFBF9] border border-[#EAE4D5]/60">
                <span className="text-[10px] font-sans font-bold text-slate-500 uppercase block">
                  Final Receipt Tx ID
                </span>
                <span className="text-sm font-bold text-slate-700">
                  {log.final_receipt_transaction_id ? `#${log.final_receipt_transaction_id}` : '—'}
                </span>
              </div>
            </div>
          </div>

          {/* 3. Portion QA Decisions */}
          <div className="p-5 rounded-xl bg-[#FFFFFF] border border-[#EAE4D5]/80 space-y-4 shadow-sm">
            <div className="flex items-center space-x-2 border-b border-[#EAE4D5]/60 pb-2">
              <FlaskConical className="w-4 h-4 text-[#1E3A8A]" />
              <h3 className="text-xs font-extrabold text-[#111311] uppercase tracking-wider">
                Portion Quality & Rejection Breakdown
              </h3>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="p-3.5 rounded-lg bg-[#FDFBF9] border border-[#EAE4D5]/60 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-extrabold text-slate-900">
                    Portion #{log.portion_number || '1'}
                  </span>
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider ${
                      log.calculated_status === 'ACCEPTED'
                        ? 'bg-emerald-100 text-emerald-800'
                        : log.calculated_status === 'REJECTED'
                        ? 'bg-red-100 text-red-800'
                        : log.calculated_status === 'HOLD'
                        ? 'bg-amber-100 text-amber-800'
                        : 'bg-slate-100 text-slate-800'
                    }`}
                  >
                    {log.calculated_status || 'PENDING'}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 text-[11px] font-mono">
                  <div>
                    <span className="text-slate-500 block text-[10px]">Dispatch Fat / LR:</span>
                    <span className="font-bold text-slate-800">
                      {log.dispatch_fat != null ? `${log.dispatch_fat}%` : '—'} / {log.dispatch_lr != null ? log.dispatch_lr : '—'}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[10px]">Plant Fat / LR:</span>
                    <span className="font-bold text-slate-800">
                      {log.sampling_fat != null ? `${log.sampling_fat}%` : '—'} / {log.sampling_lr != null ? log.sampling_lr : '—'}
                    </span>
                  </div>
                </div>

                {log.rejection_reasons && (
                  <div className="p-2 rounded bg-red-50 border border-red-100 text-[11px] text-red-800 space-y-0.5">
                    <span className="font-black block uppercase text-[10px]">Rejection Reason:</span>
                    <span className="font-semibold">{log.rejection_reasons}</span>
                  </div>
                )}

                {log.remarks && !log.rejection_reasons && (
                  <div className="p-2 rounded bg-slate-50 border border-slate-200 text-[11px] text-slate-700">
                    <span className="font-bold block text-[10px]">Remarks:</span>
                    <span>{log.remarks}</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* 4. Milestone Event Chronology */}
          <div className="p-5 rounded-xl bg-[#FFFFFF] border border-[#EAE4D5]/80 space-y-4 shadow-sm">
            <div className="flex items-center space-x-2 border-b border-[#EAE4D5]/60 pb-2">
              <Calendar className="w-4 h-4 text-[#1E3A8A]" />
              <h3 className="text-xs font-extrabold text-[#111311] uppercase tracking-wider">
                Event Chronology (Asia/Karachi)
              </h3>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 font-mono text-[11px]">
              <div className="p-2.5 rounded bg-[#F8FAFC] border border-slate-100">
                <span className="text-slate-500 block text-[10px] font-sans font-bold uppercase">1. Dispatch Timestamp</span>
                <span className="font-semibold text-slate-800">
                  {log.dispatch_timestamp ? formatOperationalDatetime(log.dispatch_timestamp) : '—'}
                </span>
              </div>

              <div className="p-2.5 rounded bg-[#F8FAFC] border border-slate-100">
                <span className="text-slate-500 block text-[10px] font-sans font-bold uppercase">2. Gate Entry Timestamp</span>
                <span className="font-semibold text-slate-800">
                  {log.gate_entry_timestamp ? formatOperationalDatetime(log.gate_entry_timestamp) : '—'}
                </span>
              </div>

              <div className="p-2.5 rounded bg-[#F8FAFC] border border-slate-100">
                <span className="text-slate-500 block text-[10px] font-sans font-bold uppercase">3. First Weight Timestamp</span>
                <span className="font-semibold text-slate-800">
                  {log.first_weight_timestamp ? formatOperationalDatetime(log.first_weight_timestamp) : '—'}
                </span>
              </div>

              <div className="p-2.5 rounded bg-[#F8FAFC] border border-slate-100">
                <span className="text-slate-500 block text-[10px] font-sans font-bold uppercase">4. Unloading Timestamp</span>
                <span className="font-semibold text-slate-800">
                  {log.unloading_start_timestamp ? formatOperationalDatetime(log.unloading_start_timestamp) : '—'}
                </span>
              </div>

              <div className="p-2.5 rounded bg-[#F8FAFC] border border-slate-100">
                <span className="text-slate-500 block text-[10px] font-sans font-bold uppercase">5. Second Weight Timestamp</span>
                <span className="font-semibold text-slate-800">
                  {log.second_weight_timestamp ? formatOperationalDatetime(log.second_weight_timestamp) : '—'}
                </span>
              </div>

              <div className="p-2.5 rounded bg-[#F8FAFC] border border-slate-100">
                <span className="text-slate-500 block text-[10px] font-sans font-bold uppercase">6. Final Receipt Timestamp</span>
                <span className="font-semibold text-[#166534] font-bold">
                  {log.final_receipt_timestamp ? formatOperationalDatetime(log.final_receipt_timestamp) : '—'}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between px-6 py-3.5 border-t border-[#EAE4D5] bg-[#FDFBF9]">
          <div className="flex items-center space-x-1.5 text-slate-500 text-[11px]">
            <ShieldCheck className="w-4 h-4 text-[#1E3A8A]" />
            <span>Read-only supervisory ledger record for assigned ZMCC.</span>
          </div>

          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl bg-[#1E3A8A] text-white text-xs font-bold hover:bg-[#1E3A8A]/90 transition-all shadow-sm"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
