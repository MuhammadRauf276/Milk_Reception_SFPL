'use client';

import React, { useMemo } from 'react';
import { MilkProcessLog } from '@backend/core/types';
import { formatOperationalDatetime, formatOperationalDate } from '@/lib/datetime-utils';
import {
  X,
  Truck,
  Scale,
  FlaskConical,
  Receipt,
  FileText,
  ShieldCheck,
} from 'lucide-react';

interface ZMCCManagerVisitDetailModalProps {
  isOpen: boolean;
  log: MilkProcessLog | null;
  portions?: MilkProcessLog[];
  onClose: () => void;
  assignedSourceName?: string;
}

export const ZMCCManagerVisitDetailModal: React.FC<ZMCCManagerVisitDetailModalProps> = ({
  isOpen,
  log,
  portions,
  onClose,
  assignedSourceName,
}) => {
  const displayPortions = useMemo(() => {
    if (portions && portions.length > 0) return portions;
    return log ? [log] : [];
  }, [portions, log]);

  if (!isOpen || !log) return null;

  const isCompletedReceipt = Boolean(log.final_receipt_exists && log.final_receipt_timestamp);
  const isReceiptPending = Boolean(log.second_weight_of_vehicle != null && !log.final_receipt_exists);
  const receiptStatusText = isCompletedReceipt
    ? 'Completed'
    : isReceiptPending
    ? 'Pending Final Receipt'
    : 'In Progress';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200"
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
                  Visit: {log.vehicle_number}
                </h2>
              </div>
              <p className="text-xs text-[#475569] font-medium">
                {assignedSourceName || log.zonal_contractor_name || 'Station'} · Business Date:{' '}
                <span className={`font-bold ${log.business_date ? 'text-slate-800' : 'text-amber-700'}`}>
                  {log.business_date ? formatOperationalDate(log.business_date) : 'Pending plant completion'}
                </span>
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 min-h-[44px] min-w-[44px] rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-all flex items-center justify-center"
            aria-label="Close modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 text-xs">
          {/* 1. Dispatch Details */}
          <div className="p-5 rounded-xl bg-[#FFFFFF] border border-[#EAE4D5] space-y-4 shadow-xs">
            <div className="flex items-center space-x-2 border-b border-[#EAE4D5]/60 pb-2">
              <FileText className="w-4 h-4 text-[#1E3A8A]" />
              <h3 className="text-xs font-extrabold text-[#111311] uppercase tracking-wider">
                Dispatch Details
              </h3>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 font-mono">
              <div className="p-3 rounded-lg bg-[#FDFBF9] border border-[#EAE4D5]/60">
                <span className="text-[10px] font-sans font-bold text-slate-500 uppercase block">
                  Vehicle Number
                </span>
                <span className="text-sm font-black text-slate-900">
                  {log.vehicle_number || 'Not recorded'}
                </span>
              </div>

              <div className="p-3 rounded-lg bg-[#FDFBF9] border border-[#EAE4D5]/60">
                <span className="text-[10px] font-sans font-bold text-slate-500 uppercase block">
                  Station
                </span>
                <span className="text-sm font-bold text-slate-800">
                  {assignedSourceName || log.zonal_contractor_name || 'Not recorded'}
                </span>
              </div>

              <div className="p-3 rounded-lg bg-[#FDFBF9] border border-[#EAE4D5]/60">
                <span className="text-[10px] font-sans font-bold text-slate-500 uppercase block">
                  Business Date
                </span>
                <span className={`text-sm font-bold ${log.business_date ? 'text-slate-800' : 'text-amber-700'}`}>
                  {log.business_date ? formatOperationalDate(log.business_date) : 'Pending plant completion'}
                </span>
              </div>

              <div className="p-3 rounded-lg bg-[#FDFBF9] border border-[#EAE4D5]/60">
                <span className="text-[10px] font-sans font-bold text-slate-500 uppercase block">
                  Dispatch Date
                </span>
                <span className="text-sm font-bold text-slate-800">
                  {log.dispatch_date ? formatOperationalDate(log.dispatch_date) : 'Not recorded'}
                </span>
              </div>

              <div className="p-3 rounded-lg bg-[#FDFBF9] border border-[#EAE4D5]/60">
                <span className="text-[10px] font-sans font-bold text-slate-500 uppercase block">
                  Dispatch Quantity
                </span>
                <span className="text-sm font-black text-[#1E3A8A]">
                  {log.vehicle_dispatch_quantity_value != null
                    ? `${log.vehicle_dispatch_quantity_value.toLocaleString()} ${log.vehicle_dispatch_quantity_unit || ''}`
                    : log.vehicle_dispatch_gross_liters != null
                    ? `${log.vehicle_dispatch_gross_liters.toLocaleString()} L`
                    : 'Not recorded'}
                </span>
              </div>

              <div className="p-3 rounded-lg bg-[#FDFBF9] border border-[#EAE4D5]/60">
                <span className="text-[10px] font-sans font-bold text-slate-500 uppercase block">
                  Dispatch Time
                </span>
                <span className="text-xs font-semibold text-slate-800">
                  {log.dispatch_timestamp ? formatOperationalDatetime(log.dispatch_timestamp) : 'Not recorded'}
                </span>
              </div>

              <div className="p-3 rounded-lg bg-[#FDFBF9] border border-[#EAE4D5]/60">
                <span className="text-[10px] font-sans font-bold text-slate-500 uppercase block">
                  Gate Entry Time
                </span>
                <span className="text-xs font-semibold text-slate-800">
                  {log.gate_entry_timestamp ? formatOperationalDatetime(log.gate_entry_timestamp) : 'Pending'}
                </span>
              </div>
            </div>
          </div>

          {/* 2. Weight & Quantity */}
          <div className="p-5 rounded-xl bg-[#FFFFFF] border border-[#EAE4D5] space-y-4 shadow-xs">
            <div className="flex items-center space-x-2 border-b border-[#EAE4D5]/60 pb-2">
              <Scale className="w-4 h-4 text-[#1E3A8A]" />
              <h3 className="text-xs font-extrabold text-[#111311] uppercase tracking-wider">
                Weight & Quantity
              </h3>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 font-mono">
              <div className="p-3 rounded-lg bg-[#FDFBF9] border border-[#EAE4D5]/60">
                <span className="text-[10px] font-sans font-bold text-slate-500 uppercase block">
                  Gross Weight
                </span>
                <span className="text-sm font-bold text-slate-800">
                  {log.first_weight_of_vehicle != null
                    ? `${log.first_weight_of_vehicle.toLocaleString()} kg`
                    : 'Not recorded'}
                </span>
              </div>

              <div className="p-3 rounded-lg bg-[#FDFBF9] border border-[#EAE4D5]/60">
                <span className="text-[10px] font-sans font-bold text-slate-500 uppercase block">
                  Tare Weight
                </span>
                <span className="text-sm font-bold text-slate-800">
                  {log.second_weight_of_vehicle != null
                    ? `${log.second_weight_of_vehicle.toLocaleString()} kg`
                    : log.first_weight_of_vehicle != null
                    ? 'Pending'
                    : 'Not recorded'}
                </span>
              </div>

              <div className="p-3 rounded-lg bg-[#FDFBF9] border border-[#EAE4D5]/60">
                <span className="text-[10px] font-sans font-bold text-slate-500 uppercase block">
                  Net Milk Weight
                </span>
                <span className="text-sm font-black text-[#1E3A8A]">
                  {log.computed_net_milk_weight != null
                    ? `${log.computed_net_milk_weight.toLocaleString()} kg`
                    : 'Pending'}
                </span>
              </div>

              <div className="p-3 rounded-lg bg-[#FDFBF9] border border-[#EAE4D5]/60">
                <span className="text-[10px] font-sans font-bold text-slate-500 uppercase block">
                  Received Quantity
                </span>
                <span className="text-sm font-black text-[#166534]">
                  {log.authoritative_final_liters != null
                    ? `${log.authoritative_final_liters.toLocaleString()} L`
                    : log.final_receipt_exists
                    ? 'Not recorded'
                    : 'Pending'}
                </span>
              </div>

              <div className="p-3 rounded-lg bg-[#FDFBF9] border border-[#EAE4D5]/60">
                <span className="text-[10px] font-sans font-bold text-slate-500 uppercase block">
                  First Weight Time
                </span>
                <span className="text-xs font-semibold text-slate-800">
                  {log.first_weight_timestamp ? formatOperationalDatetime(log.first_weight_timestamp) : 'Not recorded'}
                </span>
              </div>

              <div className="p-3 rounded-lg bg-[#FDFBF9] border border-[#EAE4D5]/60">
                <span className="text-[10px] font-sans font-bold text-slate-500 uppercase block">
                  Second Weight Time
                </span>
                <span className="text-xs font-semibold text-slate-800">
                  {log.second_weight_timestamp
                    ? formatOperationalDatetime(log.second_weight_timestamp)
                    : log.first_weight_of_vehicle != null
                    ? 'Pending'
                    : 'Not recorded'}
                </span>
              </div>
            </div>
          </div>

          {/* 3. Portion Quality Results */}
          <div className="p-5 rounded-xl bg-[#FFFFFF] border border-[#EAE4D5] space-y-4 shadow-xs">
            <div className="flex items-center space-x-2 border-b border-[#EAE4D5]/60 pb-2">
              <FlaskConical className="w-4 h-4 text-[#1E3A8A]" />
              <h3 className="text-xs font-extrabold text-[#111311] uppercase tracking-wider">
                Portion Quality Results
              </h3>
            </div>

            <div className="space-y-4">
              {displayPortions.map((p, idx) => {
                const portionTests = (p.portion_lab_results && p.portion_lab_results.length > 0)
                  ? p.portion_lab_results.map((tr) => {
                      const dispatchVal = tr.dispatch_numeric_value != null
                        ? `${tr.dispatch_numeric_value}`
                        : tr.dispatch_text_value != null && tr.dispatch_text_value !== ''
                        ? tr.dispatch_text_value
                        : tr.dispatch_performed
                        ? 'Recorded'
                        : 'Not recorded';

                      const plantVal = tr.plant_numeric_value != null
                        ? `${tr.plant_numeric_value}`
                        : tr.plant_text_value != null && tr.plant_text_value !== ''
                        ? tr.plant_text_value
                        : tr.plant_is_passed === true
                        ? 'Passed'
                        : tr.plant_is_passed === false
                        ? 'Failed'
                        : tr.plant_performed
                        ? (tr.plant_status || 'Performed')
                        : 'Pending';

                      const isPerformed = tr.plant_performed || tr.dispatch_performed;

                      return {
                        name: tr.test_name,
                        performed: isPerformed,
                        dispatchResult: dispatchVal,
                        plantResult: plantVal,
                        unit: tr.unit || '-',
                      };
                    })
                  : [
                      {
                        name: 'Fat',
                        performed: p.sampling_fat != null,
                        dispatchResult: p.dispatch_fat != null ? `${p.dispatch_fat}` : 'Not recorded',
                        plantResult: p.sampling_fat != null ? `${p.sampling_fat}` : 'Pending',
                        unit: '%',
                      },
                      {
                        name: 'LR',
                        performed: p.sampling_lr != null,
                        dispatchResult: p.dispatch_lr != null ? `${p.dispatch_lr}` : 'Not recorded',
                        plantResult: p.sampling_lr != null ? `${p.sampling_lr}` : 'Pending',
                        unit: '°L',
                      },
                      {
                        name: 'SNF',
                        performed: p.computed_sampling_snf != null,
                        dispatchResult: p.computed_dispatch_snf != null ? `${p.computed_dispatch_snf}` : 'Not recorded',
                        plantResult: p.computed_sampling_snf != null ? `${p.computed_sampling_snf}` : 'Pending',
                        unit: '%',
                      },
                      {
                        name: 'TS',
                        performed: p.computed_sampling_ts != null,
                        dispatchResult: p.computed_dispatch_ts != null ? `${p.computed_dispatch_ts}` : 'Not recorded',
                        plantResult: p.computed_sampling_ts != null ? `${p.computed_sampling_ts}` : 'Pending',
                        unit: '%',
                      },
                      {
                        name: 'MBRT',
                        performed: p.b_mbrt_minutes_test != null,
                        dispatchResult: 'Not recorded',
                        plantResult: p.b_mbrt_minutes_test != null ? `${p.b_mbrt_minutes_test}` : 'Pending',
                        unit: 'min',
                      },
                    ];

                const decision = p.calculated_status || 'Pending';
                const decisionUpper = decision.toUpperCase();

                return (
                  <div
                    key={p.portion_id || idx}
                    className="p-4 rounded-xl bg-[#FDFBF9] border border-[#EAE4D5] space-y-3"
                  >
                    {/* Portion Header */}
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#EAE4D5]/60 pb-2.5">
                      <div className="flex items-center space-x-2">
                        <span className="text-xs font-black text-slate-900">
                          Portion #{p.portion_number || (idx + 1)}
                        </span>
                        <span className="text-xs text-slate-500 font-mono">
                          (Quantity:{' '}
                          <span className="font-bold text-slate-800">
                            {p.dispatch_liters_gross != null
                              ? `${p.dispatch_liters_gross.toLocaleString()} L`
                              : p.dispatch_kg_gross != null
                              ? `${p.dispatch_kg_gross.toLocaleString()} kg`
                              : 'Not recorded'}
                          </span>
                          )
                        </span>
                      </div>

                      <span
                        className={`px-2.5 py-0.5 rounded text-[10px] font-black uppercase tracking-wider ${
                          decisionUpper === 'ACCEPTED'
                            ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                            : decisionUpper === 'REJECTED'
                            ? 'bg-red-100 text-red-800 border border-red-300'
                            : decisionUpper === 'HOLD'
                            ? 'bg-amber-100 text-amber-800 border border-amber-300'
                            : 'bg-slate-100 text-slate-700 border border-slate-300'
                        }`}
                      >
                        {decisionUpper}
                      </span>
                    </div>

                    {/* Rejection Reason (where present) */}
                    {p.rejection_reasons && (
                      <div className="p-2.5 rounded-lg bg-red-50 border border-red-200 text-red-900 text-xs">
                        <span className="font-bold">Rejection Reason: </span>
                        <span>{p.rejection_reasons}</span>
                      </div>
                    )}

                    {/* Configured Lab Tests Table */}
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead>
                          <tr className="border-b border-[#EAE4D5] text-[10.5px] font-bold text-slate-500 uppercase tracking-wider">
                            <th className="py-1.5 px-2">Lab Test</th>
                            <th className="py-1.5 px-2">Status</th>
                            <th className="py-1.5 px-2 font-mono">Dispatch Result</th>
                            <th className="py-1.5 px-2 font-mono">Plant Result</th>
                            <th className="py-1.5 px-2">Unit</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#EAE4D5]/40 font-mono">
                          {portionTests.map((t) => (
                            <tr key={t.name} className="hover:bg-slate-50/60">
                              <td className="py-1.5 px-2 font-sans font-bold text-slate-900">
                                {t.name}
                              </td>
                              <td className="py-1.5 px-2 font-sans">
                                <span
                                  className={`inline-block px-2 py-0.5 rounded text-[9.5px] font-bold ${
                                    t.performed
                                      ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                      : 'bg-slate-100 text-slate-500'
                                  }`}
                                >
                                  {t.performed ? 'Performed' : 'Not performed'}
                                </span>
                              </td>
                              <td className="py-1.5 px-2 text-slate-700">
                                {t.dispatchResult}
                              </td>
                              <td className="py-1.5 px-2 font-bold text-slate-900">
                                {t.plantResult}
                              </td>
                              <td className="py-1.5 px-2 font-sans text-slate-500">
                                {t.unit}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 4. Receipt Details */}
          <div className="p-5 rounded-xl bg-[#FFFFFF] border border-[#EAE4D5] space-y-4 shadow-xs">
            <div className="flex items-center space-x-2 border-b border-[#EAE4D5]/60 pb-2">
              <Receipt className="w-4 h-4 text-[#1E3A8A]" />
              <h3 className="text-xs font-extrabold text-[#111311] uppercase tracking-wider">
                Receipt Details
              </h3>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 font-mono">
              <div className="p-3 rounded-lg bg-[#FDFBF9] border border-[#EAE4D5]/60">
                <span className="text-[10px] font-sans font-bold text-slate-500 uppercase block">
                  Receipt Status
                </span>
                <span
                  className={`text-xs font-black uppercase inline-block px-2 py-0.5 rounded ${
                    isCompletedReceipt
                      ? 'bg-emerald-100 text-emerald-800'
                      : isReceiptPending
                      ? 'bg-amber-100 text-amber-800'
                      : 'bg-blue-100 text-blue-800'
                  }`}
                >
                  {receiptStatusText}
                </span>
              </div>

              <div className="p-3 rounded-lg bg-[#FDFBF9] border border-[#EAE4D5]/60">
                <span className="text-[10px] font-sans font-bold text-slate-500 uppercase block">
                  Destination Silo
                </span>
                <span className="text-sm font-bold text-slate-800">
                  {log.silo_storage_id || 'Pending'}
                </span>
              </div>

              <div className="p-3 rounded-lg bg-[#FDFBF9] border border-[#EAE4D5]/60">
                <span className="text-[10px] font-sans font-bold text-slate-500 uppercase block">
                  Unloading Start
                </span>
                <span className="text-xs font-semibold text-slate-800">
                  {log.unloading_start_timestamp
                    ? formatOperationalDatetime(log.unloading_start_timestamp)
                    : 'Pending'}
                </span>
              </div>

              <div className="p-3 rounded-lg bg-[#FDFBF9] border border-[#EAE4D5]/60">
                <span className="text-[10px] font-sans font-bold text-slate-500 uppercase block">
                  Unloading End
                </span>
                <span className="text-xs font-semibold text-slate-800">
                  {log.unloading_end_timestamp
                    ? formatOperationalDatetime(log.unloading_end_timestamp)
                    : 'Pending'}
                </span>
              </div>

              <div className="p-3 rounded-lg bg-[#FDFBF9] border border-[#EAE4D5]/60">
                <span className="text-[10px] font-sans font-bold text-slate-500 uppercase block">
                  Final Receipt Time
                </span>
                <span className="text-xs font-semibold text-[#166534]">
                  {log.final_receipt_timestamp
                    ? formatOperationalDatetime(log.final_receipt_timestamp)
                    : 'Pending'}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between px-6 py-3.5 border-t border-[#EAE4D5] bg-[#FDFBF9]">
          <div className="flex items-center space-x-1.5 text-slate-600 text-xs font-semibold">
            <ShieldCheck className="w-4 h-4 text-[#1E3A8A]" />
            <span>Station: {assignedSourceName || log.zonal_contractor_name || 'Assigned Station'}</span>
          </div>

          <button
            onClick={onClose}
            className="min-h-[44px] min-w-[80px] px-4 py-2 rounded-xl bg-[#1E3A8A] text-white text-xs font-bold hover:bg-[#1E3A8A]/90 transition-all shadow-xs flex items-center justify-center focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
