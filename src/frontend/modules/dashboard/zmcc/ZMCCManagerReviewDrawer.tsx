'use client';

import React, { useState } from 'react';
import { AlertTriangle, CheckCircle, Loader2, ShieldCheck, X, XCircle } from 'lucide-react';
import { fetchJson } from '@/lib/query/fetchJson';
import { formatOperationalDatetime } from '@/lib/datetime-utils';
import { getErrorMessage } from '@/lib/errors';
import { Drawer, DrawerContent, DrawerTitle } from '@/components/ui/drawer';
import type { ZmccLabSessionItem } from './zmccQualityTypes';

/** Bottom sheet where the ZMCC manager records an accept / reject decision on a lab session. */
export const ZMCCManagerReviewDrawer: React.FC<{
  session: ZmccLabSessionItem;
  onClose: () => void;
  onSubmitted: (message: string) => void;
}> = ({ session, onClose, onSubmitted }) => {
  const [reviewDecision, setReviewDecision] = useState<'ACCEPTED' | 'REJECTED'>(
    session.decision === 'REJECTED' ? 'ACCEPTED' : 'REJECTED'
  );
  const [reviewReason, setReviewReason] = useState<string>('');
  const [reviewSubmitting, setReviewSubmitting] = useState<boolean>(false);
  const [reviewError, setReviewError] = useState<string | null>(null);

  const handleSubmitReview = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!reviewReason.trim() || reviewReason.trim().length < 3) {
      setReviewError('Substantive review reason is required (minimum 3 characters).');
      return;
    }

    setReviewSubmitting(true);
    setReviewError(null);
    try {
      const data = await fetchJson<{ manager_review_status?: string }>(`/api/zmcc/lab/sessions/${session.id}/correction`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          decision: reviewDecision,
          reason: reviewReason.trim(),
        }),
      });

      const isReviewExited = data.manager_review_status === 'REVIEWED_EXITED';
      onSubmitted(
        isReviewExited
          ? `Review recorded for session #${session.id} (vehicle already exited; review-only).`
          : `Decision ${reviewDecision} recorded successfully for session #${session.id}.`
      );
    } catch (err) {
      setReviewError(getErrorMessage(err) || 'Failed to submit manager decision.');
    } finally {
      setReviewSubmitting(false);
    }
  };

  const hasExited = !!(session.mot_arrival?.exit_timestamp || session.local_supplier_arrival?.exit_timestamp);
  const exitTime = session.mot_arrival?.exit_timestamp || session.local_supplier_arrival?.exit_timestamp;

  return (
    <Drawer open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DrawerContent>
        <div className="overflow-y-auto pb-[max(1rem,env(safe-area-inset-bottom))]">
          <div className="p-4 sm:p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50">
            <div className="flex items-center space-x-2">
              <ShieldCheck className="w-5 h-5 text-primary" />
              <DrawerTitle className="text-sm font-semibold text-slate-900">
                Manager Quality Review: Session #{session.id}
              </DrawerTitle>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 transition-all"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <form onSubmit={handleSubmitReview} className="p-5 space-y-4">
            {reviewError && (
              <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 text-xs font-semibold rounded-lg flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                <span>{reviewError}</span>
              </div>
            )}

            {/* Physical Reality Warning */}
            {hasExited ? (
              <div className="p-3 bg-amber-50 border border-amber-200 text-amber-900 text-xs rounded-xl space-y-1">
                <div className="flex items-center gap-1.5 font-semibold text-amber-800">
                  <AlertTriangle className="w-4 h-4 text-amber-600" />
                  <span>Vehicle Physically Exited</span>
                </div>
                <p className="text-[11px] leading-relaxed">
                  The vehicle departed on <strong>{formatOperationalDatetime(exitTime!)}</strong>. Approving this
                  record will register an official audit review (
                  <code className="font-semibold text-amber-900 bg-amber-100 px-1 py-0.5 rounded">
                    REVIEWED_EXITED
                  </code>
                  ) and will strictly NOT inject retroactive tank stock.
                </p>
              </div>
            ) : (
              <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs rounded-xl space-y-1">
                <div className="flex items-center gap-1.5 font-semibold text-emerald-800">
                  <CheckCircle className="w-4 h-4 text-emerald-600" />
                  <span>Vehicle On-Site</span>
                </div>
                <p className="text-[11px] leading-relaxed">
                  The vehicle is currently on-site. Approving will accept the milk, create the canonical tank
                  receipt, and credit active tank stock.
                </p>
              </div>
            )}

            {/* Session Meta */}
            <div className="grid grid-cols-2 gap-2 text-xs tabular-nums bg-slate-50 p-3 rounded-xl border border-slate-200">
              <div>
                <span className="text-slate-500 text-xs block font-sans uppercase font-semibold">Arrival Type</span>
                <span className="font-semibold text-slate-900">{session.arrival_type === 'MOT' ? 'MC' : 'HC'}</span>
              </div>
              <div>
                <span className="text-slate-500 text-xs block font-sans uppercase font-semibold">Original Decision</span>
                <span className="font-semibold text-slate-900">{session.decision}</span>
              </div>
              <div>
                <span className="text-slate-500 text-xs block font-sans uppercase font-semibold">System Outcome</span>
                <span className="font-semibold text-slate-900">{session.system_quality_outcome || '—'}</span>
              </div>
              <div>
                <span className="text-slate-500 text-xs block font-sans uppercase font-semibold">Quantity</span>
                <span className="font-semibold text-slate-900">
                  {session.gross_liters != null ? `${session.gross_liters.toLocaleString()} L` : '—'}
                </span>
              </div>
            </div>

            {/* Decision Radio Choice */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-800 block">Manager Decision</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setReviewDecision('ACCEPTED')}
                  className={`min-h-11 p-3 rounded-xl border text-xs font-semibold flex items-center justify-center gap-2 transition-all ${
                    reviewDecision === 'ACCEPTED'
                      ? 'border-emerald-500 bg-emerald-50 text-emerald-800 ring-2 ring-emerald-500/20'
                      : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  <CheckCircle className="w-4 h-4 text-emerald-600" />
                  <span>Approve (ACCEPTED)</span>
                </button>

                <button
                  type="button"
                  onClick={() => setReviewDecision('REJECTED')}
                  className={`min-h-11 p-3 rounded-xl border text-xs font-semibold flex items-center justify-center gap-2 transition-all ${
                    reviewDecision === 'REJECTED'
                      ? 'border-rose-500 bg-rose-50 text-rose-800 ring-2 ring-rose-500/20'
                      : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  <XCircle className="w-4 h-4 text-rose-600" />
                  <span>Confirm (REJECTED)</span>
                </button>
              </div>
            </div>

            {/* Substantive Reason Textarea */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-800 block">
                Substantive Justification / Reason <span className="text-rose-600">*</span>
              </label>
              <textarea
                value={reviewReason}
                onChange={(e) => setReviewReason(e.target.value)}
                placeholder="Enter substantive managerial justification for this decision (minimum 3 characters)…"
                rows={3}
                required
                className="w-full p-2.5 text-xs font-medium rounded-xl bg-subtle border border-border text-foreground focus:ring-2 focus:ring-primary outline-hidden"
              />
              <span className="text-xs text-slate-400 font-sans block">
                Mandatory audit justification recorded in the official governance log.
              </span>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={onClose}
                className="min-h-11 px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl transition-all"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={reviewSubmitting || reviewReason.trim().length < 3}
                className="min-h-11 px-4 py-2 text-xs font-semibold bg-primary text-white rounded-xl hover:bg-primary/90 transition-all disabled:opacity-50 shadow-2xs flex items-center gap-1.5"
              >
                {reviewSubmitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>{reviewSubmitting ? 'Recording…' : 'Submit Decision'}</span>
              </button>
            </div>
          </form>
        </div>
      </DrawerContent>
    </Drawer>
  );
};
