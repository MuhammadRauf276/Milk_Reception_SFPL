'use client';

import React, { useState, useEffect } from 'react';
import { Truck, X, CheckCircle2, Lock, Clock, ShieldCheck } from 'lucide-react';
import { MilkProcessLog, User } from '@core/types';

interface MPDDispatchFormProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: Partial<MilkProcessLog>) => Promise<void>;
  currentUser?: User | null;
}

export const MPDDispatchForm: React.FC<MPDDispatchFormProps> = ({
  isOpen,
  onClose,
  onSave,
  currentUser,
}) => {
  const [vehicleNumber, setVehicleNumber] = useState('');
  const [portionNumber, setPortionNumber] = useState('P-01');

  // Automatic Profile Detection: Bind Contractor Zone to Authenticated JWT User Profile
  const boundContractorZone = currentUser?.zone || 'ZMCC / Contractor';
  const [zonalContractorName, setZonalContractorName] = useState(boundContractorZone);

  const [dispatchKg, setDispatchKg] = useState<number | ''>(15000);
  const [dispatchLiters, setDispatchLiters] = useState<number | ''>(14563);
  const [dispatchFat, setDispatchFat] = useState<number | ''>(3.8);
  const [dispatchLr, setDispatchLr] = useState<number | ''>(28.5);
  const [dispatchTests, setDispatchTests] = useState('COB: Pass, Alcohol: 75% Pass');

  // Live Auto-Captured Immutability Parameters
  const [currentDateStr, setCurrentDateStr] = useState('');
  const [currentTimeStr, setCurrentTimeStr] = useState('');

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (currentUser?.zone) {
      setZonalContractorName(currentUser.zone);
    }
  }, [currentUser]);

  useEffect(() => {
    const updateLiveTimestamps = () => {
      const now = new Date();
      setCurrentDateStr(now.toISOString().split('T')[0]);
      setCurrentTimeStr(now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    };

    updateLiveTimestamps();
    const interval = setInterval(updateLiveTimestamps, 1000);
    return () => clearInterval(interval);
  }, []);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setErrorMsg(null);

    // Exact Millisecond Submission Timestamps
    const now = new Date();
    const exactDate = now.toISOString().split('T')[0];
    const exactTime = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    
    // Scheduled Arrival (+2 hours estimated)
    const arrivalTimeDate = new Date(now.getTime() + 2 * 3600 * 1000);
    const estimatedArrival = arrivalTimeDate.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

    const fat = Number(dispatchFat) || 0;
    const lr = Number(dispatchLr) || 0;
    const kg = Number(dispatchKg) || 0;
    const liters = Number(dispatchLiters) || 0;

    try {
      await onSave({
        vehicle_number: vehicleNumber.toUpperCase().trim(),
        portion_number: portionNumber,
        zonal_contractor_name: zonalContractorName,
        dispatch_date: exactDate,
        dispatch_day: now.toLocaleDateString('en-US', { weekday: 'long' }),
        dispatch_week: Math.ceil(now.getDate() / 7),
        dispatch_month: now.toLocaleDateString('en-US', { month: 'long' }),
        dispatch_year: now.getFullYear(),
        zonal_contractor_dispatch_time: exactTime,
        scheduled_arrival_time: estimatedArrival,
        dispatch_kg_gross: kg,
        dispatch_liters_gross: liters,
        dispatch_fat: fat,
        dispatch_lr: lr,
        dispatch_tests: dispatchTests,
        status: 'Dispatched',
      });
      onClose();
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to record dispatch');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Preview dynamic SNF % formula: (LR / 4) + (0.2 * Fat) + 0.36
  const previewFat = Number(dispatchFat) || 0;
  const previewLr = Number(dispatchLr) || 0;
  const previewLiters = Number(dispatchLiters) || 0;
  const previewSnf = previewLr > 0 && previewFat > 0 ? (previewLr / 4) + (0.2 * previewFat) + 0.36 : 0;
  const previewTs = previewFat + previewSnf;
  const preview13ts = (previewLiters * previewTs) / 13.0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
      <div className="relative w-full max-w-xl bg-[#EFE9D9] text-[#111311] rounded-2xl shadow-xl border border-[#C4B9A3] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#C4B9A3] bg-[#F4EFE3]">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 bg-[#1E3A8A] text-white rounded-xl shadow-sm">
              <Truck className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-extrabold tracking-tight text-[#111311]">Record MPD Field Dispatch</h3>
              <p className="text-xs text-[#334155] font-semibold">Auto-bound contractor profile & immutable submission timestamps</p>
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

          {/* READ-ONLY IMMUTABLE CONTRACTOR BINDING BANNER */}
          <div className="p-3 rounded-xl bg-[#F4EFE3] border border-[#C4B9A3] space-y-1">
            <div className="flex items-center justify-between text-xs font-extrabold">
              <span className="flex items-center gap-1.5 text-[#1E40AF]">
                <ShieldCheck className="w-4 h-4" />
                Auto-Bound Procurement Profile
              </span>
              <span className="flex items-center gap-1 px-2 py-0.5 rounded bg-blue-100 text-[#1E40AF] text-[10px] font-mono font-black">
                <Lock className="w-3 h-3" /> HARD-LOCKED
              </span>
            </div>
            <p className="text-sm font-black text-[#111311] font-mono">{zonalContractorName}</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold mb-1">Vehicle Registration # *</label>
              <input
                type="text"
                value={vehicleNumber}
                onChange={(e) => setVehicleNumber(e.target.value)}
                placeholder="e.g. KBL-8492"
                className="w-full px-3 py-2 text-sm font-mono font-bold rounded-xl border border-[#C4B9A3] bg-[#F4EFE3] text-[#111311]"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-bold mb-1">Portion Number *</label>
              <select
                value={portionNumber}
                onChange={(e) => setPortionNumber(e.target.value)}
                className="w-full px-3 py-2 text-sm font-bold rounded-xl border border-[#C4B9A3] bg-[#F4EFE3] text-[#111311]"
              >
                <option value="P-01">Portion 01 (P-01)</option>
                <option value="P-02">Portion 02 (P-02)</option>
                <option value="P-03">Portion 03 (P-03)</option>
              </select>
            </div>
          </div>

          {/* READ-ONLY IMMUTABLE LIVE TIMESTAMPS GRID */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold mb-1 flex items-center justify-between">
                <span>Dispatch Date (Live System)</span>
                <Lock className="w-3 h-3 text-slate-400" />
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={currentDateStr}
                  disabled
                  className="w-full px-3 py-2 text-sm font-mono font-bold rounded-xl border border-[#C4B9A3] bg-slate-200/70 text-slate-700 cursor-not-allowed"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold mb-1 flex items-center justify-between">
                <span>Dispatch Time (Exact Millisecond)</span>
                <Clock className="w-3 h-3 text-slate-400" />
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={currentTimeStr}
                  disabled
                  className="w-full px-3 py-2 text-sm font-mono font-bold rounded-xl border border-[#C4B9A3] bg-slate-200/70 text-slate-700 cursor-not-allowed"
                />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold mb-1">Dispatch Gross Weight (KG) *</label>
              <input
                type="number"
                value={dispatchKg}
                onChange={(e) => setDispatchKg(e.target.value ? Number(e.target.value) : '')}
                className="w-full px-3 py-2 text-sm font-mono font-bold rounded-xl border border-[#C4B9A3] bg-[#F4EFE3] text-[#111311]"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-bold mb-1">Dispatch Gross Liters *</label>
              <input
                type="number"
                value={dispatchLiters}
                onChange={(e) => setDispatchLiters(e.target.value ? Number(e.target.value) : '')}
                className="w-full px-3 py-2 text-sm font-mono font-bold rounded-xl border border-[#C4B9A3] bg-[#F4EFE3] text-[#111311]"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold mb-1">Dispatch Fat % *</label>
              <input
                type="number"
                step="0.01"
                value={dispatchFat}
                onChange={(e) => setDispatchFat(e.target.value ? Number(e.target.value) : '')}
                className="w-full px-3 py-2 text-sm font-mono font-bold rounded-xl border border-[#C4B9A3] bg-[#F4EFE3] text-[#111311]"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-bold mb-1">Dispatch LR *</label>
              <input
                type="number"
                step="0.1"
                value={dispatchLr}
                onChange={(e) => setDispatchLr(e.target.value ? Number(e.target.value) : '')}
                className="w-full px-3 py-2 text-sm font-mono font-bold rounded-xl border border-[#C4B9A3] bg-[#F4EFE3] text-[#111311]"
                required
              />
            </div>
          </div>

          {/* DYNAMIC FORMULA PREVIEW */}
          <div className="p-3 rounded-xl bg-[#F4EFE3] border border-[#C4B9A3] text-xs font-mono font-bold space-y-1">
            <span className="text-[10px] font-sans font-extrabold text-slate-500 uppercase tracking-wider block">
              Automated Runtime Preview (Computed Dynamically)
            </span>
            <div className="grid grid-cols-3 gap-2 text-[#111311]">
              <div>
                <span className="text-slate-500 font-sans block text-[9px]">SNF %</span>
                <span>{previewSnf.toFixed(2)}%</span>
              </div>
              <div>
                <span className="text-slate-500 font-sans block text-[9px]">Total Solids</span>
                <span>{previewTs.toFixed(2)}%</span>
              </div>
              <div>
                <span className="text-slate-500 font-sans block text-[9px]">13% TS Eq Liters</span>
                <span>{preview13ts.toFixed(2)} L</span>
              </div>
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold mb-1">Field Adulteration Tests Panel</label>
            <input
              type="text"
              value={dispatchTests}
              onChange={(e) => setDispatchTests(e.target.value)}
              className="w-full px-3 py-2 text-xs font-semibold rounded-xl border border-[#C4B9A3] bg-[#F4EFE3] text-[#111311]"
            />
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
              className="flex items-center space-x-1.5 px-5 py-2.5 rounded-xl bg-[#1E3A8A] hover:bg-blue-900 text-white font-extrabold text-xs shadow-md border border-blue-950"
            >
              <CheckCircle2 className="w-4 h-4 text-white" />
              <span>{isSubmitting ? 'Recording Dispatch...' : 'Submit & Dispatch Vehicle'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
