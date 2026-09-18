'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Header } from '@modules/shared/Header';
import { HierarchicalNavDrawer } from '@modules/shared/navigation/HierarchicalNavDrawer';
import { User } from '@core/types';
import {
  ShieldAlert,
  AlertOctagon,
  CheckCircle2,
  XCircle,
  Clock,
  Truck,
  Check,
  X,
  Lock,
  RefreshCw,
} from 'lucide-react';

interface LabResultItem {
  id: string;
  testCode: string;
  testName: string;
  resultType: string;
  numericValue: number | null;
  textValue: string | null;
  performanceStatus: string;
  isPassed: boolean | null;
  appliedRuleVersion: number | null;
}

interface PendingPortion {
  portionId: string;
  visitId: string;
  portionNumber: number;
  vehicleNumber: string;
  sourceName: string;
  sourceCode: string;
  systemQualityOutcome: string;
  managerReviewStatus: string;
  managerRequestedDecision: string;
  managerReviewRequestedAt: string | null;
  requesterName: string;
  vehicleExited: boolean;
  results: LabResultItem[];
}

export default function QAManagerDepartmentPage() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const hamburgerButtonRef = useRef<HTMLButtonElement | null>(null);

  const [queue, setQueue] = useState<PendingPortion[]>([]);
  const [selectedPortion, setSelectedPortion] = useState<PendingPortion | null>(null);
  const [actionType, setActionType] = useState<'APPROVE' | 'REJECT' | null>(null);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const loadQueue = useCallback(async () => {
    try {
      const res = await fetch('/api/qa/manager/queue');
      if (res.ok) {
        const data = await res.json();
        setQueue(data.queue || []);
      }
    } catch (err) {
      console.error('Failed to load QA manager queue', err);
    }
  }, []);

  useEffect(() => {
    async function loadUser() {
      try {
        const res = await fetch('/api/auth/me');
        if (res.ok) {
          const data = await res.json();
          setUser(data.user);
        }
      } catch (err) {
        console.error('Failed to load user', err);
      } finally {
        setLoading(false);
      }
    }
    loadUser();
  }, []);

  useEffect(() => {
    loadQueue();
  }, [loadQueue]);

  const handleDecisionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPortion || !actionType) return;
    setSubmitError(null);

    if (reason.trim().length < 3) {
      setSubmitError('A substantive managerial reason of at least 3 characters is required.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(
        `/api/qa/vehicle-visits/${selectedPortion.visitId}/portions/${selectedPortion.portionId}/correct-decision`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            decision: actionType,
            reason: reason.trim(),
          }),
        }
      );

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Failed to submit exception decision.');
      }

      setSelectedPortion(null);
      setActionType(null);
      setReason('');
      await loadQueue();
    } catch (err: any) {
      setSubmitError(err.message || 'Error submitting decision.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <div className="p-8 text-center text-xs font-bold text-slate-500">Loading QA Manager Station...</div>;
  }

  return (
    <div className="min-h-screen bg-[#FDFBF9] text-[#111311] flex flex-col font-sans w-full max-w-full overflow-x-hidden">
      <Header
        currentUser={user}
        title="Plant QA Manager — Exception Review"
        showBranding={true}
        showMenuButton={true}
        onMenuClick={() => setIsDrawerOpen(true)}
        menuButtonRef={hamburgerButtonRef}
      />

      <HierarchicalNavDrawer
        currentUser={user}
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        triggerButtonRef={hamburgerButtonRef}
      />

      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8 space-y-6">
        {/* Top Header Card */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-6 rounded-xl border border-[#EAE4D5] shadow-xs">
          <div>
            <h1 className="text-xl font-black text-slate-900 flex items-center gap-2">
              <ShieldAlert className="w-6 h-6 text-amber-600" />
              Quality Exception & Decision Review Queue
            </h1>
            <p className="text-xs text-slate-600 mt-1">
              Authoritative review station for out-of-spec milk testing where operator acceptance requires QA Manager discretion.
            </p>
          </div>
          <button
            onClick={() => loadQueue()}
            className="flex items-center justify-center gap-2 bg-slate-100 text-slate-700 px-4 py-2 rounded-lg text-xs font-bold hover:bg-slate-200 transition border border-slate-200 shadow-xs"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh Queue
          </button>
        </div>

        {/* Pending Queue List */}
        {queue.length === 0 ? (
          <div className="bg-white rounded-xl border border-[#EAE4D5] p-12 text-center text-slate-500 space-y-2 shadow-xs">
            <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto" />
            <p className="text-sm font-bold text-slate-800">No Quality Exceptions Pending</p>
            <p className="text-xs text-slate-500">All laboratory testing decisions are currently in compliance or resolved.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {queue.map((item) => (
              <div
                key={item.portionId}
                className="bg-white rounded-xl border border-[#EAE4D5] p-6 shadow-xs space-y-4"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
                  <div className="flex items-center gap-3">
                    <span className="p-2 rounded-lg bg-amber-100 text-amber-800 font-bold text-xs flex items-center gap-1.5">
                      <Truck className="w-4 h-4" />
                      {item.vehicleNumber} (Portion #{item.portionNumber})
                    </span>
                    <span className="text-xs font-bold text-slate-700">{item.sourceName}</span>
                  </div>

                  <div className="flex items-center gap-2">
                    {item.vehicleExited ? (
                      <span className="inline-flex items-center gap-1 bg-red-100 text-red-800 text-[11px] font-bold px-2.5 py-1 rounded-full">
                        <Lock className="w-3.5 h-3.5" /> Vehicle Exited Plant (Review Only)
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 bg-amber-100 text-amber-800 text-[11px] font-bold px-2.5 py-1 rounded-full">
                        <Clock className="w-3.5 h-3.5" /> Pending QA Manager Review
                      </span>
                    )}
                  </div>
                </div>

                {/* Exception Info */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs bg-slate-50 p-4 rounded-lg border border-slate-200">
                  <div>
                    <span className="text-slate-500 block">System Outcome:</span>
                    <span className="font-bold text-red-600 uppercase tracking-wider">{item.systemQualityOutcome}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Operator Requested Decision:</span>
                    <span className="font-bold text-emerald-700">{item.managerRequestedDecision}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Requested By / Time:</span>
                    <span className="font-medium text-slate-800">
                      {item.requesterName} &bull;{' '}
                      {item.managerReviewRequestedAt
                        ? new Date(item.managerReviewRequestedAt).toLocaleTimeString('en-PK', {
                            hour: '2-digit',
                            minute: '2-digit',
                          })
                        : '—'}
                    </span>
                  </div>
                </div>

                {/* Lab Results Table */}
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-100 text-slate-600 font-bold border-b border-slate-200 uppercase tracking-wider">
                      <tr>
                        <th className="px-4 py-2">Test Name</th>
                        <th className="px-4 py-2">Value</th>
                        <th className="px-4 py-2">Evaluation</th>
                        <th className="px-4 py-2">Rule Version</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
                      {item.results.map((r) => (
                        <tr key={r.id}>
                          <td className="px-4 py-2">
                            <span className="font-bold text-slate-900">{r.testName}</span>
                            <span className="text-[10px] text-slate-400 font-mono ml-2">({r.testCode})</span>
                          </td>
                          <td className="px-4 py-2 font-mono">
                            {r.numericValue !== null ? r.numericValue : (r.textValue || '—')}
                          </td>
                          <td className="px-4 py-2">
                            {r.isPassed === true ? (
                              <span className="text-emerald-700 font-bold flex items-center gap-1">
                                <Check className="w-3.5 h-3.5" /> PASS
                              </span>
                            ) : r.isPassed === false ? (
                              <span className="text-red-600 font-bold flex items-center gap-1">
                                <X className="w-3.5 h-3.5" /> OUT_OF_SPEC
                              </span>
                            ) : (
                              <span className="text-slate-400">NO RULE</span>
                            )}
                          </td>
                          <td className="px-4 py-2 font-mono text-slate-500">
                            {r.appliedRuleVersion ? `v${r.appliedRuleVersion}` : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Action Buttons */}
                <div className="flex justify-end gap-3 pt-2">
                  <button
                    onClick={() => {
                      setSelectedPortion(item);
                      setActionType('REJECT');
                      setReason('');
                      setSubmitError(null);
                    }}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold bg-red-600 text-white hover:bg-red-700 transition shadow-xs"
                  >
                    <XCircle className="w-4 h-4" /> Reject Milk (Uphold Spec)
                  </button>

                  <button
                    disabled={item.vehicleExited}
                    onClick={() => {
                      setSelectedPortion(item);
                      setActionType('APPROVE');
                      setReason('');
                      setSubmitError(null);
                    }}
                    title={item.vehicleExited ? 'Vehicle has already exited the plant; physical admission cannot be granted.' : undefined}
                    className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold transition shadow-xs ${
                      item.vehicleExited
                        ? 'bg-slate-200 text-slate-400 cursor-not-allowed border border-slate-300'
                        : 'bg-[#1A4D2E] text-white hover:bg-[#153e25]'
                    }`}
                  >
                    <CheckCircle2 className="w-4 h-4" /> Grant Exception (Admit Milk)
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* Decision Confirmation Modal */}
      {selectedPortion && actionType && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full p-6 border border-slate-200 space-y-4">
            <div className="flex justify-between items-center border-b border-slate-100 pb-3">
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                {actionType === 'APPROVE' ? (
                  <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                ) : (
                  <XCircle className="w-5 h-5 text-red-600" />
                )}
                {actionType === 'APPROVE' ? 'Grant Quality Exception' : 'Confirm Milk Rejection'}
              </h3>
              <button
                onClick={() => {
                  setSelectedPortion(null);
                  setActionType(null);
                }}
                className="text-slate-400 hover:text-slate-600 text-lg font-bold"
              >
                &times;
              </button>
            </div>

            <p className="text-xs text-slate-600">
              Vehicle <strong className="text-slate-800">{selectedPortion.vehicleNumber}</strong> &bull; Portion #{selectedPortion.portionNumber}.{' '}
              {actionType === 'APPROVE'
                ? 'Approving overrides the out-of-spec system rule and unlocks gross weighment and silo unloading.'
                : 'Rejecting upholds the out-of-spec finding, confirms rejection, and requires the vehicle to exit the plant.'}
            </p>

            {submitError && (
              <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg flex items-center gap-2">
                <AlertOctagon className="w-4 h-4 shrink-0" />
                <span>{submitError}</span>
              </div>
            )}

            <form onSubmit={handleDecisionSubmit} className="space-y-4 text-xs">
              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  Substantive Managerial Reason (Required)
                </label>
                <textarea
                  required
                  rows={3}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder={
                    actionType === 'APPROVE'
                      ? 'Specify technical justification for admitting out-of-spec portion (e.g. blend suitability, minor deviation authorized by QC)...'
                      : 'Specify rejection basis and disposal instructions...'
                  }
                  className="w-full border border-slate-300 rounded-lg p-2.5 text-xs text-slate-800"
                />
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedPortion(null);
                    setActionType(null);
                  }}
                  className="px-4 py-2 text-slate-600 font-bold hover:bg-slate-100 rounded-lg transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className={`px-5 py-2 rounded-lg font-bold text-white transition disabled:opacity-50 ${
                    actionType === 'APPROVE' ? 'bg-[#1A4D2E] hover:bg-[#153e25]' : 'bg-red-600 hover:bg-red-700'
                  }`}
                >
                  {submitting ? 'Submitting...' : actionType === 'APPROVE' ? 'Confirm Exception' : 'Confirm Rejection'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
