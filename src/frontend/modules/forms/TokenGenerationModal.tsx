'use client';

import React, { useState } from 'react';
import { KeyRound, X, CheckCircle2, AlertCircle } from 'lucide-react';
import { MilkProcessLog } from '@core/types';

interface TokenGenerationModalProps {
  isOpen: boolean;
  onClose: () => void;
  dispatchedLogs: MilkProcessLog[];
  onTokenSubmitted: (logId: number, tokenNumber: string, igpDate: string, igpTime: string) => Promise<void>;
}

export const TokenGenerationModal: React.FC<TokenGenerationModalProps> = ({
  isOpen,
  onClose,
  dispatchedLogs,
  onTokenSubmitted,
}) => {
  const [selectedLogId, setSelectedLogId] = useState<number | ''>(
    dispatchedLogs.length > 0 ? dispatchedLogs[0].id : ''
  );
  const defaultToken = `TK-${Math.floor(1000 + Math.random() * 9000)}`;
  const [tokenNumber, setTokenNumber] = useState(defaultToken);
  const [igpDate, setIgpDate] = useState(new Date().toISOString().split('T')[0]);
  const [igpTime, setIgpTime] = useState(new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }));

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  
  // Floating Toast Pop-up Alert State
  const [showSuccessToast, setShowSuccessToast] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedLogId) {
      setErrorMsg('Please select a vehicle');
      return;
    }

    setIsSubmitting(true);
    setErrorMsg(null);

    try {
      await onTokenSubmitted(Number(selectedLogId), tokenNumber.trim(), igpDate, igpTime);
      
      // Trigger Floating Self-Clearing Pop-up Toast Alert
      setShowSuccessToast(true);

      // Timed Disappearance: 3 Seconds Timer
      setTimeout(() => {
        setShowSuccessToast(false);
        onClose();
        // Reset defaults
        setTokenNumber(`TK-${Math.floor(1000 + Math.random() * 9000)}`);
      }, 3000);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to issue token');
      setIsSubmitting(false);
    }
  };

  return (
    <>
      {/* FLOATING SELF-CLEARING TOP-RIGHT POP-UP TOAST ALERT */}
      {showSuccessToast && (
        <div className="fixed top-6 right-6 z-[100] max-w-md p-4 rounded-xl bg-[#111311] border border-[#EAE4D5] text-[#FDFBF7] shadow-2xl flex items-center space-x-3 animate-slide-in">
          <div className="p-2 bg-emerald-600 rounded-lg text-white shrink-0">
            <CheckCircle2 className="w-5 h-5" />
          </div>
          <div>
            <h4 className="font-extrabold text-xs text-[#FDFBF7] uppercase tracking-wider">Security Gate Clearance</h4>
            <p className="text-xs font-bold text-emerald-300 mt-0.5">
              ✅ Token Issued Successfully! Vehicle advanced to Lab.
            </p>
          </div>
        </div>
      )}

      {/* MODAL BACKDROP & CONTAINER */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
        <div className="relative w-full max-w-lg bg-[#EFE9D9] text-[#111311] rounded-2xl shadow-2xl border border-[#C4B9A3] overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-[#C4B9A3] bg-[#F4EFE3]">
            <div className="flex items-center space-x-3">
              <div className="p-2.5 bg-indigo-700 text-white rounded-xl shadow-sm">
                <KeyRound className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-extrabold tracking-tight text-[#111311]">Issue Security Entry Token</h3>
                <p className="text-xs text-[#334155] font-semibold">Assign Gate 2 Token & Record IGP Timestamp</p>
              </div>
            </div>
            <button onClick={onClose} className="p-1.5 rounded-lg text-slate-500 hover:text-[#111311]">
              <X className="w-5 h-5" />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="p-6 space-y-4">
            {errorMsg && (
              <div className="p-3 text-xs font-bold rounded-xl bg-rose-50 text-rose-800 border border-rose-200 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            <div>
              <label className="block text-xs font-bold mb-1">Select Dispatched Vehicle *</label>
              <select
                value={selectedLogId}
                onChange={(e) => setSelectedLogId(Number(e.target.value))}
                className="w-full px-3 py-2.5 text-xs font-mono font-bold rounded-xl border border-[#C4B9A3] bg-[#F4EFE3] text-[#111311]"
                required
              >
                {dispatchedLogs.length === 0 ? (
                  <option value="">No Dispatched Vehicles Waiting</option>
                ) : (
                  dispatchedLogs.map((l) => (
                    <option key={`token-option-${String(l.id)}`} value={l.id}>
                      {l.vehicle_number} ({l.portion_number}) - {l.zonal_contractor_name}
                    </option>
                  ))
                )}
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold mb-1">Token Number *</label>
              <input
                type="text"
                value={tokenNumber}
                onChange={(e) => setTokenNumber(e.target.value)}
                placeholder="e.g. TK-9021"
                className="w-full px-3 py-2.5 text-sm font-mono font-black rounded-xl border border-[#C4B9A3] bg-[#F4EFE3] text-[#111311]"
                required
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold mb-1">IGP Arrival Date *</label>
                <input
                  type="date"
                  value={igpDate}
                  onChange={(e) => setIgpDate(e.target.value)}
                  className="w-full px-3 py-2 text-xs font-mono font-bold rounded-xl border border-[#C4B9A3] bg-[#F4EFE3] text-[#111311]"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-bold mb-1">IGP Arrival Time *</label>
                <input
                  type="text"
                  value={igpTime}
                  onChange={(e) => setIgpTime(e.target.value)}
                  className="w-full px-3 py-2 text-xs font-mono font-bold rounded-xl border border-[#C4B9A3] bg-[#F4EFE3] text-[#111311]"
                  required
                />
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
                disabled={isSubmitting || dispatchedLogs.length === 0}
                className="flex items-center space-x-1.5 px-5 py-2.5 rounded-xl bg-indigo-700 hover:bg-indigo-800 text-white font-extrabold text-xs shadow-md border border-indigo-950 transition active:scale-95 disabled:opacity-50"
              >
                <CheckCircle2 className="w-4 h-4 text-white" />
                <span>{isSubmitting ? 'Issuing Token...' : 'Issue Token & Log Gate Entry'}</span>
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
};
