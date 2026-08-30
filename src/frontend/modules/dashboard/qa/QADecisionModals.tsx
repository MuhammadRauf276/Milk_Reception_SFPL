'use client';

import React from 'react';
import { Play, CheckCircle2, PauseCircle, XCircle } from 'lucide-react';

export interface QADecisionModalsProps {
  activeActionModal: 'START' | 'RESUME' | 'ACCEPT' | 'HOLD' | 'REJECT' | null;
  onCloseModal: () => void;
  actionVisitId: string | null;
  visitDetail: any;
  activePortionIndex: number;
  qaOpTimestamp: string;
  onQaOpTimestampChange: (val: string) => void;
  holdReason: string;
  onHoldReasonChange: (val: string) => void;
  rejectionReason: string;
  onRejectionReasonChange: (val: string) => void;
  rejectionRemarks: string;
  onRejectionRemarksChange: (val: string) => void;
  onStartTestingConfirm: (e: React.FormEvent) => void;
  onResumeTestingConfirm: (e: React.FormEvent) => void;
  onAcceptPortionConfirm: (e: React.FormEvent) => void;
  onHoldPortionConfirm: (e: React.FormEvent) => void;
  onRejectPortionConfirm: (e: React.FormEvent) => void;
  isSubmitting: boolean;
  waitingVisits: any[];
  onHoldVisits: any[];
}

export const QADecisionModals: React.FC<QADecisionModalsProps> = ({
  activeActionModal,
  onCloseModal,
  actionVisitId,
  visitDetail,
  activePortionIndex,
  qaOpTimestamp,
  onQaOpTimestampChange,
  holdReason,
  onHoldReasonChange,
  rejectionReason,
  onRejectionReasonChange,
  rejectionRemarks,
  onRejectionRemarksChange,
  onStartTestingConfirm,
  onResumeTestingConfirm,
  onAcceptPortionConfirm,
  onHoldPortionConfirm,
  onRejectPortionConfirm,
  isSubmitting,
  waitingVisits,
  onHoldVisits,
}) => {
  if (!activeActionModal) return null;

  const currentPortion = visitDetail?.portions?.[activePortionIndex] || null;
  const targetWaitingVisit = waitingVisits.find((v) => v.id === actionVisitId) || null;
  const targetHeldVisit = onHoldVisits.find((v) => v.id === actionVisitId) || null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto"
    >
      <div className="bg-[#EFE9D9] border-2 border-[#C4B9A3] rounded-3xl p-5 sm:p-6 max-w-md w-full max-h-[90dvh] overflow-y-auto shadow-2xl space-y-5 text-[#111311]">
        {/* START TESTING MODAL */}
        {activeActionModal === 'START' && (
          <form onSubmit={onStartTestingConfirm} className="space-y-4">
            <div className="flex items-center space-x-2.5 pb-2 border-b border-[#C4B9A3]">
              <div className="p-2 bg-[#1E3A8A] text-white rounded-xl">
                <Play className="w-5 h-5 fill-current" />
              </div>
              <div>
                <h3 className="font-extrabold text-base text-[#111311]">Start QA Testing Session</h3>
                <p className="text-xs text-[#334155] font-semibold">
                  Vehicle: <strong className="font-mono">{targetWaitingVisit?.vehicle_number || 'Selected'}</strong>
                </p>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-extrabold text-[#111311]">
                Testing Start Operational Timestamp *
              </label>
              <input
                type="datetime-local"
                value={qaOpTimestamp}
                onChange={(e) => onQaOpTimestampChange(e.target.value)}
                className="w-full min-h-[44px] px-3.5 py-2 text-xs font-mono font-bold rounded-xl border border-[#C4B9A3] bg-white text-[#111311] focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]"
                required
              />
              <p className="text-[10px] text-[#334155] font-medium">
                Records the authoritative start time of this QA session.
              </p>
            </div>

            <div className="flex items-center justify-end space-x-2 pt-3 border-t border-[#C4B9A3]">
              <button
                type="button"
                disabled={isSubmitting}
                onClick={onCloseModal}
                className="min-h-[44px] px-4 py-2 text-xs font-extrabold text-[#334155] hover:text-[#111311]"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="min-h-[44px] px-5 py-2.5 bg-[#1E3A8A] hover:bg-blue-800 text-white font-extrabold text-xs rounded-xl shadow-md transition"
              >
                {isSubmitting ? 'Starting...' : 'Confirm & Start Testing'}
              </button>
            </div>
          </form>
        )}

        {/* RESUME TESTING MODAL */}
        {activeActionModal === 'RESUME' && (
          <form onSubmit={onResumeTestingConfirm} className="space-y-4">
            <div className="flex items-center space-x-2.5 pb-2 border-b border-[#C4B9A3]">
              <div className="p-2 bg-amber-700 text-white rounded-xl">
                <Play className="w-5 h-5 fill-current" />
              </div>
              <div>
                <h3 className="font-extrabold text-base text-[#111311]">Resume QA Testing Session</h3>
                <p className="text-xs text-[#334155] font-semibold">
                  Vehicle: <strong className="font-mono">{targetHeldVisit?.vehicle_number || 'Selected'}</strong>
                </p>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-extrabold text-[#111311]">
                Resume Operational Timestamp *
              </label>
              <input
                type="datetime-local"
                value={qaOpTimestamp}
                onChange={(e) => onQaOpTimestampChange(e.target.value)}
                className="w-full min-h-[44px] px-3.5 py-2 text-xs font-mono font-bold rounded-xl border border-[#C4B9A3] bg-white text-[#111311] focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]"
                required
              />
            </div>

            <div className="flex items-center justify-end space-x-2 pt-3 border-t border-[#C4B9A3]">
              <button
                type="button"
                disabled={isSubmitting}
                onClick={onCloseModal}
                className="min-h-[44px] px-4 py-2 text-xs font-extrabold text-[#334155] hover:text-[#111311]"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="min-h-[44px] px-5 py-2.5 bg-amber-700 hover:bg-amber-800 text-white font-extrabold text-xs rounded-xl shadow-md transition"
              >
                {isSubmitting ? 'Resuming...' : 'Confirm & Resume Session'}
              </button>
            </div>
          </form>
        )}

        {/* ACCEPT PORTION MODAL */}
        {activeActionModal === 'ACCEPT' && (
          <form onSubmit={onAcceptPortionConfirm} className="space-y-4">
            <div className="flex items-center space-x-2.5 pb-2 border-b border-[#C4B9A3]">
              <div className="p-2 bg-emerald-700 text-white rounded-xl">
                <CheckCircle2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-extrabold text-base text-[#111311]">Accept Portion for Reception</h3>
                <p className="text-xs text-[#334155] font-semibold">
                  Portion #{currentPortion?.portion_number} of {visitDetail?.vehicle_number}
                </p>
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-300 text-emerald-900 text-xs font-bold space-y-1">
              <p>
                Confirming that Portion #{currentPortion?.portion_number} meets plant quality standards and is approved for weighbridge and unloading.
              </p>
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-extrabold text-[#111311]">
                Acceptance Operational Timestamp *
              </label>
              <input
                type="datetime-local"
                value={qaOpTimestamp}
                onChange={(e) => onQaOpTimestampChange(e.target.value)}
                className="w-full min-h-[44px] px-3.5 py-2 text-xs font-mono font-bold rounded-xl border border-[#C4B9A3] bg-white text-[#111311] focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]"
                required
              />
            </div>

            <div className="flex items-center justify-end space-x-2 pt-3 border-t border-[#C4B9A3]">
              <button
                type="button"
                disabled={isSubmitting}
                onClick={onCloseModal}
                className="min-h-[44px] px-4 py-2 text-xs font-extrabold text-[#334155] hover:text-[#111311]"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="min-h-[44px] px-5 py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white font-extrabold text-xs rounded-xl shadow-md transition"
              >
                {isSubmitting ? 'Accepting...' : 'Confirm Portion Acceptance'}
              </button>
            </div>
          </form>
        )}

        {/* HOLD PORTION MODAL */}
        {activeActionModal === 'HOLD' && (
          <form onSubmit={onHoldPortionConfirm} className="space-y-4">
            <div className="flex items-center space-x-2.5 pb-2 border-b border-[#C4B9A3]">
              <div className="p-2 bg-amber-600 text-white rounded-xl">
                <PauseCircle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-extrabold text-base text-[#111311]">Place Portion On Hold</h3>
                <p className="text-xs text-[#334155] font-semibold">
                  Portion #{currentPortion?.portion_number} of {visitDetail?.vehicle_number}
                </p>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-extrabold text-[#111311]">
                Hold Reason / Explanation *
              </label>
              <textarea
                value={holdReason}
                onChange={(e) => onHoldReasonChange(e.target.value)}
                placeholder="Describe why this portion is being put on hold (e.g. pending supervisor review, re-sampling needed)..."
                rows={3}
                className="w-full p-3 text-xs font-bold rounded-xl border border-[#C4B9A3] bg-white text-[#111311] focus:outline-none focus:ring-2 focus:ring-amber-600"
                required
              />
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-extrabold text-[#111311]">
                Hold Operational Timestamp *
              </label>
              <input
                type="datetime-local"
                value={qaOpTimestamp}
                onChange={(e) => onQaOpTimestampChange(e.target.value)}
                className="w-full min-h-[44px] px-3.5 py-2 text-xs font-mono font-bold rounded-xl border border-[#C4B9A3] bg-white text-[#111311] focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]"
                required
              />
            </div>

            <div className="flex items-center justify-end space-x-2 pt-3 border-t border-[#C4B9A3]">
              <button
                type="button"
                disabled={isSubmitting}
                onClick={onCloseModal}
                className="min-h-[44px] px-4 py-2 text-xs font-extrabold text-[#334155] hover:text-[#111311]"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting || !holdReason.trim()}
                className="min-h-[44px] px-5 py-2.5 bg-amber-600 hover:bg-amber-700 text-white font-extrabold text-xs rounded-xl shadow-md transition disabled:opacity-50"
              >
                {isSubmitting ? 'Placing On Hold...' : 'Confirm Hold Decision'}
              </button>
            </div>
          </form>
        )}

        {/* REJECT PORTION MODAL */}
        {activeActionModal === 'REJECT' && (
          <form onSubmit={onRejectPortionConfirm} className="space-y-4">
            <div className="flex items-center space-x-2.5 pb-2 border-b border-[#C4B9A3]">
              <div className="p-2 bg-rose-700 text-white rounded-xl">
                <XCircle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-extrabold text-base text-[#111311]">Reject Portion</h3>
                <p className="text-xs text-[#334155] font-semibold">
                  Portion #{currentPortion?.portion_number} of {visitDetail?.vehicle_number}
                </p>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-extrabold text-[#111311]">
                Rejection Reason *
              </label>
              <select
                value={rejectionReason}
                onChange={(e) => onRejectionReasonChange(e.target.value)}
                className="w-full min-h-[44px] px-3.5 py-2 text-xs font-bold rounded-xl border border-[#C4B9A3] bg-white text-[#111311] focus:outline-none focus:ring-2 focus:ring-rose-700"
                required
              >
                <option value="">-- Select Rejection Reason --</option>
                <option value="SOP Violation / Quality Out of Range">SOP Violation / Quality Out of Range</option>
                <option value="Adulteration Suspected / Positive">Adulteration Suspected / Positive</option>
                <option value="Temperature / Acidity Out of Bounds">Temperature / Acidity Out of Bounds</option>
                <option value="Organoleptic / Visual Defect">Organoleptic / Visual Defect</option>
                <option value="Antibiotics / Toxin Positive">Antibiotics / Toxin Positive</option>
                <option value="Contractor / Transporter Breach">Contractor / Transporter Breach</option>
                <option value="Other / Lab Supervisor Override">Other / Lab Supervisor Override</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-extrabold text-[#111311]">
                Remarks / Additional Details
              </label>
              <textarea
                value={rejectionRemarks}
                onChange={(e) => onRejectionRemarksChange(e.target.value)}
                placeholder="Optional detailed remarks regarding the rejection decision..."
                rows={2}
                className="w-full p-3 text-xs font-bold rounded-xl border border-[#C4B9A3] bg-white text-[#111311] focus:outline-none focus:ring-2 focus:ring-rose-700"
              />
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-extrabold text-[#111311]">
                Rejection Operational Timestamp *
              </label>
              <input
                type="datetime-local"
                value={qaOpTimestamp}
                onChange={(e) => onQaOpTimestampChange(e.target.value)}
                className="w-full min-h-[44px] px-3.5 py-2 text-xs font-mono font-bold rounded-xl border border-[#C4B9A3] bg-white text-[#111311] focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]"
                required
              />
            </div>

            <div className="flex items-center justify-end space-x-2 pt-3 border-t border-[#C4B9A3]">
              <button
                type="button"
                disabled={isSubmitting}
                onClick={onCloseModal}
                className="min-h-[44px] px-4 py-2 text-xs font-extrabold text-[#334155] hover:text-[#111311]"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting || !rejectionReason}
                className="min-h-[44px] px-5 py-2.5 bg-rose-700 hover:bg-rose-800 text-white font-extrabold text-xs rounded-xl shadow-md transition disabled:opacity-50"
              >
                {isSubmitting ? 'Rejecting...' : 'Confirm Portion Rejection'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
