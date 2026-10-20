'use client';

import React from 'react';
import { Play, CheckCircle2, XCircle, AlertTriangle } from 'lucide-react';
import { AnimatePresence } from 'framer-motion';
import { Modal } from '@/components/ui/modal';
import type { OnHoldVisit, WaitingVisit } from './QAQueuePanel';
import type { VisitDetail } from './QATestingSection';

export interface QADecisionModalsProps {
  activeActionModal: 'START' | 'RESUME' | 'ACCEPT' | 'HOLD' | 'REJECT' | null;
  onCloseModal: () => void;
  actionVisitId: string | null;
  visitDetail: VisitDetail | null;
  activePortionIndex: number;
  qaOpTimestamp: string;
  onQaOpTimestampChange: (val: string) => void;
  holdReason?: string;
  onHoldReasonChange?: (val: string) => void;
  rejectionReason: string;
  onRejectionReasonChange: (val: string) => void;
  rejectionRemarks: string;
  onRejectionRemarksChange: (val: string) => void;
  exceptionReason?: string;
  onExceptionReasonChange?: (val: string) => void;
  hasFailingTests?: boolean;
  onStartTestingConfirm: (e: React.FormEvent) => void;
  onResumeTestingConfirm: (e: React.FormEvent) => void;
  onAcceptPortionConfirm: (e: React.FormEvent) => void;
  onHoldPortionConfirm?: (e: React.FormEvent) => void;
  onRejectPortionConfirm: (e: React.FormEvent) => void;
  isSubmitting: boolean;
  waitingVisits: WaitingVisit[];
  onHoldVisits: OnHoldVisit[];
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
  exceptionReason = '',
  onExceptionReasonChange,
  hasFailingTests = false,
  onStartTestingConfirm,
  onResumeTestingConfirm,
  onAcceptPortionConfirm,
  onHoldPortionConfirm,
  onRejectPortionConfirm,
  isSubmitting,
  waitingVisits,
  onHoldVisits,
}) => {
  const currentPortion = visitDetail?.portions?.[activePortionIndex] || null;
  const targetWaitingVisit = waitingVisits.find((v) => v.id === actionVisitId) || null;
  const targetHeldVisit = onHoldVisits.find((v) => v.id === actionVisitId) || null;
  const hasFailedTests = hasFailingTests || Boolean(currentPortion?.plant_results?.some((r) => r.isPassed === false));

  return (
    <AnimatePresence>
      {activeActionModal && (
        <Modal key="qa-decision" onClose={onCloseModal} title="QA decision" preventClose={isSubmitting} className="p-5 sm:p-6 max-w-md max-h-[90dvh] overflow-y-auto space-y-5 text-foreground">
            {activeActionModal === 'START' && (
              <form onSubmit={onStartTestingConfirm} className="space-y-4">
                <div className="flex items-center space-x-2.5 pb-2 border-b border-border-strong">
                  <div className="p-2 bg-primary text-white rounded-xl">
                    <Play className="w-5 h-5 fill-current" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-base text-foreground">Start QA Testing Session</h3>
                    <p className="text-xs text-slate-700 font-semibold">
                      Vehicle: <strong className="tabular-nums">{targetWaitingVisit?.vehicle_number || 'Selected'}</strong>
                    </p>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold text-foreground">
                    Testing Start Operational Timestamp *
                  </label>
                  <input
                    type="datetime-local"
                    value={qaOpTimestamp}
                    onChange={(e) => onQaOpTimestampChange(e.target.value)}
                    className="w-full min-h-[44px] px-3.5 py-2 text-xs tabular-nums font-semibold rounded-xl border border-border-strong bg-white text-foreground focus:outline-hidden focus:ring-2 focus:ring-primary"
                    required
                  />
                  <p className="text-[10px] text-slate-700 font-medium">
                    Records the authoritative start time of this QA session.
                  </p>
                </div>

                <div className="flex items-center justify-end space-x-2 pt-3 border-t border-border-strong">
                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={onCloseModal}
                    className="min-h-[44px] px-4 py-2 text-xs font-semibold text-slate-700 hover:text-foreground"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="min-h-[44px] px-5 py-2.5 bg-primary hover:bg-primary-hover text-white font-semibold text-xs rounded-xl shadow-md transition"
                  >
                    {isSubmitting ? 'Starting…' : 'Confirm & Start Testing'}
                  </button>
                </div>
              </form>
            )}

            {activeActionModal === 'RESUME' && (
              <form onSubmit={onResumeTestingConfirm} className="space-y-4">
                <div className="flex items-center space-x-2.5 pb-2 border-b border-border-strong">
                  <div className="p-2 bg-amber-700 text-white rounded-xl">
                    <Play className="w-5 h-5 fill-current" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-base text-foreground">Resume QA Testing Session</h3>
                    <p className="text-xs text-slate-700 font-semibold">
                      Vehicle: <strong className="tabular-nums">{targetHeldVisit?.vehicle_number || 'Selected'}</strong>
                    </p>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold text-foreground">
                    Resume Operational Timestamp *
                  </label>
                  <input
                    type="datetime-local"
                    value={qaOpTimestamp}
                    onChange={(e) => onQaOpTimestampChange(e.target.value)}
                    className="w-full min-h-[44px] px-3.5 py-2 text-xs tabular-nums font-semibold rounded-xl border border-border-strong bg-white text-foreground focus:outline-hidden focus:ring-2 focus:ring-primary"
                    required
                  />
                </div>

                <div className="flex items-center justify-end space-x-2 pt-3 border-t border-border-strong">
                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={onCloseModal}
                    className="min-h-[44px] px-4 py-2 text-xs font-semibold text-slate-700 hover:text-foreground"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="min-h-[44px] px-5 py-2.5 bg-amber-700 hover:bg-amber-800 text-white font-semibold text-xs rounded-xl shadow-md transition"
                  >
                    {isSubmitting ? 'Resuming…' : 'Confirm & Resume Session'}
                  </button>
                </div>
              </form>
            )}

            {activeActionModal === 'ACCEPT' && (
              <form onSubmit={onAcceptPortionConfirm} className="space-y-4">
                <div className="flex items-center space-x-2.5 pb-2 border-b border-border-strong">
                  <div className={`p-2 rounded-xl text-white ${hasFailedTests ? 'bg-amber-600' : 'bg-emerald-700'}`}>
                    {hasFailedTests ? <AlertTriangle className="w-5 h-5" /> : <CheckCircle2 className="w-5 h-5" />}
                  </div>
                  <div>
                    <h3 className="font-semibold text-base text-foreground">
                      {hasFailedTests ? 'Confirm Exception Decision' : 'Accept Portion for Reception'}
                    </h3>
                    <p className="text-xs text-slate-700 font-semibold">
                      Portion #{currentPortion?.portion_number} of {visitDetail?.vehicle_number}
                    </p>
                  </div>
                </div>

                {hasFailedTests ? (
                  <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-300 text-amber-900 text-xs font-semibold space-y-2">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                      <div>
                        <p className="font-semibold text-sm text-amber-950">Are you sure with your decision?</p>
                        <p className="mt-1 font-normal text-amber-900">
                          One or more tests failed SOP rules (FAIL), picture is missing, or seal mismatch detected. Your decision will be sent to <strong>AVP, Quality Assurance (QA Head)</strong> for final decision.
                        </p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-300 text-emerald-900 text-xs font-semibold space-y-1">
                    <p>
                      Confirming that Portion #{currentPortion?.portion_number} meets plant quality standards and is approved for weighbridge and unloading.
                    </p>
                  </div>
                )}

                {hasFailedTests && (
                  <div className="space-y-1.5">
                    <label className="block text-xs font-semibold text-foreground">
                      Reason for Exception (Required) *
                    </label>
                    <textarea
                      value={exceptionReason || rejectionReason}
                      onChange={(e) => {
                        if (onExceptionReasonChange) onExceptionReasonChange(e.target.value);
                        onRejectionReasonChange(e.target.value);
                      }}
                      placeholder="Specify reason for accepting portion that failed SOP rules…"
                      rows={2}
                      className="w-full min-w-0 resize-y break-words p-2.5 text-xs font-semibold rounded-xl border border-amber-300 bg-white text-foreground focus:outline-hidden focus:ring-2 focus:ring-amber-600"
                      required
                    />
                  </div>
                )}

                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold text-foreground">
                    Acceptance Operational Timestamp *
                  </label>
                  <input
                    type="datetime-local"
                    value={qaOpTimestamp}
                    onChange={(e) => onQaOpTimestampChange(e.target.value)}
                    className="w-full min-h-[44px] px-3.5 py-2 text-xs tabular-nums font-semibold rounded-xl border border-border-strong bg-white text-foreground focus:outline-hidden focus:ring-2 focus:ring-primary"
                    required
                  />
                </div>

                <div className="flex items-center justify-end space-x-2 pt-3 border-t border-border-strong">
                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={onCloseModal}
                    className="min-h-[44px] px-4 py-2 text-xs font-semibold text-slate-700 hover:text-foreground"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting || (hasFailedTests && !(exceptionReason || rejectionReason || '').trim())}
                    className={`min-h-[44px] px-5 py-2.5 text-white font-semibold text-xs rounded-xl shadow-md transition disabled:opacity-50 ${
                      hasFailedTests
                        ? 'bg-amber-600 hover:bg-amber-700'
                        : 'bg-emerald-700 hover:bg-emerald-800'
                    }`}
                  >
                    {isSubmitting
                      ? 'Submitting…'
                      : hasFailedTests
                      ? 'Confirm & Send to AVP-QA (QA Head)'
                      : 'Confirm Portion Acceptance'}
                  </button>
                </div>
              </form>
            )}

            {activeActionModal === 'REJECT' && (
              <form onSubmit={onRejectPortionConfirm} className="space-y-4">
                <div className="flex items-center space-x-2.5 pb-2 border-b border-border-strong">
                  <div className="p-2 bg-rose-700 text-white rounded-xl">
                    <XCircle className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-base text-foreground">Reject Portion</h3>
                    <p className="text-xs text-slate-700 font-semibold">
                      Portion #{currentPortion?.portion_number} of {visitDetail?.vehicle_number}
                    </p>
                  </div>
                </div>

                {!hasFailedTests && (
                  <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-300 text-amber-900 text-xs font-semibold space-y-1">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                      <div>
                        <p className="font-semibold text-sm text-amber-950">Are you sure with your decision?</p>
                        <p className="mt-1 font-normal text-amber-900">
                          All tested parameters passed SOP rules (PASS). Your manual rejection will be sent to <strong>AVP, Quality Assurance (QA Head)</strong> for final decision.
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold text-foreground">
                    Rejection Reason *
                  </label>
                  <select
                    value={rejectionReason}
                    onChange={(e) => onRejectionReasonChange(e.target.value)}
                    className="w-full min-h-[44px] px-3.5 py-2 text-xs font-semibold rounded-xl border border-border-strong bg-white text-foreground focus:outline-hidden focus:ring-2 focus:ring-rose-700"
                    required
                  >
                    <option value="">Select rejection reason</option>
                    <option value="SOP Violation / Quality Out of Range">SOP violation</option>
                    <option value="Adulteration Suspected / Positive">Adulteration</option>
                    <option value="Temperature / Acidity Out of Bounds">Temperature or acidity</option>
                    <option value="Organoleptic / Visual Defect">Visual defect</option>
                    <option value="Antibiotics / Toxin Positive">Antibiotics or toxin</option>
                    <option value="Contractor / Transporter Breach">Transporter breach</option>
                    <option value="Other / Lab Supervisor Override">Other</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold text-foreground">
                    Rejection Remarks *
                  </label>
                  <textarea
                    value={rejectionRemarks}
                    onChange={(e) => onRejectionRemarksChange(e.target.value)}
                    placeholder="Detailed chemist lab observations, sample retest notes…"
                    rows={2}
                    className="w-full min-w-0 resize-y break-words p-3 text-xs font-semibold rounded-xl border border-border-strong bg-white text-foreground focus:outline-hidden focus:ring-2 focus:ring-rose-700"
                    required
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold text-foreground">
                    Rejection Operational Timestamp *
                  </label>
                  <input
                    type="datetime-local"
                    value={qaOpTimestamp}
                    onChange={(e) => onQaOpTimestampChange(e.target.value)}
                    className="w-full min-h-[44px] px-3.5 py-2 text-xs tabular-nums font-semibold rounded-xl border border-border-strong bg-white text-foreground focus:outline-hidden focus:ring-2 focus:ring-primary"
                    required
                  />
                </div>

                <div className="flex items-center justify-end space-x-2 pt-3 border-t border-border-strong">
                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={onCloseModal}
                    className="min-h-[44px] px-4 py-2 text-xs font-semibold text-slate-700 hover:text-foreground"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting || !rejectionReason.trim() || !rejectionRemarks.trim()}
                    className="min-h-[44px] px-5 py-2.5 bg-rose-700 hover:bg-rose-800 text-white font-semibold text-xs rounded-xl shadow-md transition disabled:opacity-50"
                  >
                    {isSubmitting
                      ? 'Rejecting…'
                      : !hasFailedTests
                      ? 'Confirm & Send to AVP-QA (QA Head)'
                      : 'Confirm Portion Rejection'}
                  </button>
                </div>
              </form>
            )}
        </Modal>
      )}
    </AnimatePresence>
  );
};
