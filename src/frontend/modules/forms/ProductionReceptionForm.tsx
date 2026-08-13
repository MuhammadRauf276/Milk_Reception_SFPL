'use client';

import React, { useState } from 'react';
import { Factory, X, CheckCircle2 } from 'lucide-react';
import { MilkProcessLog } from '@core/types';

interface ProductionReceptionFormProps {
  isOpen: boolean;
  onClose: () => void;
  log: MilkProcessLog | null;
  onSave: (id: number, updates: Partial<MilkProcessLog>) => Promise<void>;
}

export const ProductionReceptionForm: React.FC<ProductionReceptionFormProps> = ({ isOpen, onClose, log, onSave }) => {
  const [siloId, setSiloId] = useState(log?.silo_storage_id || 'Silo #3 / Tank A');
  const [receptionKg, setReceptionKg] = useState<number | ''>(log?.computed_net_milk_weight || log?.first_weight_of_vehicle || 18050);
  const [receptionLiters, setReceptionLiters] = useState<number | ''>(log?.computed_plant_liters || log?.dispatch_liters_gross || 17524);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!isOpen || !log) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setErrorMsg(null);

    try {
      await onSave(log.id, {
        reception_date: new Date().toISOString().split('T')[0],
        reception_start_time: log.reception_start_time || new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
        reception_end_time: new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
        silo_storage_id: siloId,
        status: 'Completed',
      });
      onClose();
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to save Silo Reception');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
      <div className="relative w-full max-w-lg bg-[#EFE9D9] text-[#111311] rounded-2xl shadow-xl border border-[#C4B9A3] overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#C4B9A3] bg-[#F4EFE3]">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 bg-[#1E3A8A] text-white rounded-xl shadow-sm">
              <Factory className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-extrabold tracking-tight text-[#111311]">Silo Milk Reception & Offloading</h3>
              <p className="text-xs text-[#334155] font-semibold">Vehicle {log.vehicle_number} | Token #{log.token_number || 'N/A'}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-500 hover:text-[#111311]">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {errorMsg && (
            <div className="p-3 text-xs font-bold rounded-xl bg-rose-50 text-rose-800 border border-rose-200">
              {errorMsg}
            </div>
          )}

          <div>
            <label className="block text-xs font-bold mb-1">Target Storage Tank / Silo ID *</label>
            <select
              value={siloId}
              onChange={(e) => setSiloId(e.target.value)}
              className="w-full px-3 py-2 text-xs font-bold rounded-xl border border-[#C4B9A3] bg-[#F4EFE3]"
            >
              <option value="Silo #1 / Tank A">Silo #1 / Tank A (Raw Whole Milk)</option>
              <option value="Silo #2 / Tank B">Silo #2 / Tank B (Raw Whole Milk)</option>
              <option value="Silo #3 / Tank A">Silo #3 / Tank A (Standardized Raw)</option>
              <option value="Silo #4 / Tank C">Silo #4 / Tank C (High Fat Raw)</option>
            </select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold mb-1">Net Weight KG (Calculated)</label>
              <input
                type="number"
                value={receptionKg}
                onChange={(e) => setReceptionKg(e.target.value ? Number(e.target.value) : '')}
                className="w-full px-3 py-2 text-sm font-mono font-bold rounded-xl border border-[#C4B9A3] bg-[#F4EFE3]"
                disabled
              />
            </div>
            <div>
              <label className="block text-xs font-bold mb-1">Computed Plant Liters</label>
              <input
                type="number"
                value={receptionLiters}
                onChange={(e) => setReceptionLiters(e.target.value ? Number(e.target.value) : '')}
                className="w-full px-3 py-2 text-sm font-mono font-bold rounded-xl border border-[#C4B9A3] bg-[#F4EFE3]"
                disabled
              />
            </div>
          </div>

          <div className="p-3 rounded-xl bg-[#F4EFE3] border border-[#C4B9A3] text-xs font-mono font-bold space-y-1">
            <span className="text-[10px] font-sans font-extrabold text-slate-500 uppercase tracking-wider block">
              Dynamic Runtime Calculation Preview
            </span>
            <div className="flex justify-between text-[#111311]">
              <span>Plant 13% TS Equivalent Liters:</span>
              <span className="text-[#1E40AF]">{log.computed_plant_13ts_liters || 0} L</span>
            </div>
          </div>

          <div className="flex items-center justify-end space-x-3 pt-3 border-t border-[#C4B9A3]">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-[#F4EFE3] rounded-xl"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex items-center space-x-1.5 px-5 py-2.5 rounded-xl bg-[#1E40AF] hover:bg-blue-900 text-white font-extrabold text-xs shadow-md border border-blue-950"
            >
              <CheckCircle2 className="w-4 h-4 text-white" />
              <span>{isSubmitting ? 'Finalizing Silo Unloading...' : 'Complete Silo Reception & Close Dispatch'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
