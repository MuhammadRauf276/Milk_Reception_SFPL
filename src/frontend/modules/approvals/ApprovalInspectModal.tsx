'use client';

import React, { useState } from 'react';
import {
  Clock,
  ShieldAlert,
  X,
  FileText,
  AlertTriangle,
} from 'lucide-react';
import type { User } from '@/backend/core/types';
import type { UnifiedApprovalItem } from '@/backend/services/approvals/approvalInboxService';
import { getRoleLabel } from '@/backend/core/roles/labels';
import { Drawer, DrawerContent, DrawerTitle } from '@/components/ui/drawer';
import { Modal } from '@/components/ui/modal';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';
import { getErrorMessage } from '@/lib/errors';
import { STAGE_LABELS, cleanEntityTitle, formatWaitingLabel } from './approvalInboxShared';
import { ApprovalDetailBody } from './ApprovalDetailBody';

export interface ApprovalInspectModalProps {
  item: UnifiedApprovalItem | null;
  isOpen: boolean;
  currentUser: User | null;
  onClose: () => void;
  onSubmitDecision: (args: { id: string; body: Record<string, unknown> }) => Promise<void>;
  onDecided: () => void;
}

export function ApprovalInspectModal({
  item,
  isOpen,
  currentUser,
  onClose,
  onSubmitDecision,
  onDecided,
}: ApprovalInspectModalProps) {
  const [verdict, setVerdict] = useState<'OKAY' | 'NO' | null>(null);
  const [decisionRemarks, setDecisionRemarks] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const [previewPhotoUrl, setPreviewPhotoUrl] = useState<string | null>(null);

  React.useEffect(() => {
    setVerdict(null);
    setDecisionRemarks('');
    setDecisionError(null);
  }, [item]);

  if (!item) return null;

  const stageMeta = STAGE_LABELS[item.stage];
  const isPending = item.status === 'PENDING';

  const handleConfirmDecision = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!verdict) return;
    setDecisionError(null);

    const isSelfApproval = Boolean(
      currentUser?.id && item.submittedBy.id && String(currentUser.id) === String(item.submittedBy.id)
    );
    const isSuperAdmin = currentUser?.role === 'SUPER_ADMIN';

    // Validation
    if (isSelfApproval && isSuperAdmin && decisionRemarks.trim().length < 20) {
      setDecisionError('Super Admin self-approval requires substantive justification of at least 20 characters.');
      return;
    }
    if (verdict === 'NO' && decisionRemarks.trim().length < 5) {
      setDecisionError('Please write a substantive rejection reason (at least 5 characters).');
      return;
    }

    setIsSubmitting(true);
    try {
      await onSubmitDecision({
        id: item.id,
        body: {
          approvalType: item.approvalType,
          verdict,
          remarks: decisionRemarks.trim(),
          version: item.version,
        },
      });
      onDecided();
    } catch (err: unknown) {
      setDecisionError(getErrorMessage(err) || 'Error submitting decision.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <Drawer open={isOpen} onOpenChange={(open) => !open && !isSubmitting && onClose()}>
        <DrawerContent className="max-h-[88dvh] md:max-h-[85dvh] flex flex-col bg-white">
          {/* Header */}
          <div className="flex items-start justify-between p-4 sm:p-5 border-b border-border bg-slate-50/70 shrink-0">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className={cn('px-2 py-0.5 rounded text-[11px] font-bold border', stageMeta.color)}>
                  {stageMeta.label}
                </span>
                <DrawerTitle className="text-base sm:text-lg font-bold text-foreground">
                  {item.referenceNumber}
                </DrawerTitle>
              </div>
              <p className="text-xs text-slate-600 font-medium">{cleanEntityTitle(item.details.entityTitle)}</p>
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500 pt-0.5">
                <span>
                  Source: <strong className="text-slate-700">{item.sourceName || 'ZMCC Area'}</strong>
                </span>
                <span>·</span>
                <span>
                  By: <strong className="text-slate-700">{item.submittedBy.name}</strong> (
                  {getRoleLabel(item.submittedBy.role)})
                </span>
                <span>·</span>
                {isPending ? (
                  <span className="inline-flex items-center gap-1 font-semibold text-slate-700">
                    <Clock className="w-3 h-3 text-slate-400" />
                    Waiting: {formatWaitingLabel(item.waitingMinutes)}
                  </span>
                ) : (
                  <span className="font-semibold text-slate-700">
                    Status: {item.status}
                  </span>
                )}
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200 transition min-h-11 min-w-11"
              aria-label="Close dialog"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Scrollable Body: Detail Content */}
          <div className="flex-1 overflow-y-auto">
            <ApprovalDetailBody item={item} onPreviewPhoto={setPreviewPhotoUrl} />
          </div>

          {/* Decision / Action Footer */}
          <div className="p-4 sm:p-5 border-t border-border bg-slate-50/90 shrink-0">
            {isPending ? (
              item.canDecide ? (
                <form onSubmit={handleConfirmDecision} className="space-y-3">
                  {/* Select Verdict (Approve or Reject) */}
                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        setVerdict('OKAY');
                        setDecisionError(null);
                      }}
                      className={cn(
                        'flex-1 min-h-11 px-4 py-2 rounded-xl text-xs font-bold border-2 transition flex items-center justify-center gap-2',
                        verdict === 'OKAY'
                          ? 'border-emerald-600 bg-emerald-600 text-white shadow-xs'
                          : 'border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
                      )}
                    >
                      
                      <span>Approve Request</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setVerdict('NO');
                        setDecisionError(null);
                      }}
                      className={cn(
                        'flex-1 min-h-11 px-4 py-2 rounded-xl text-xs font-bold border-2 transition flex items-center justify-center gap-2',
                        verdict === 'NO'
                          ? 'border-rose-600 bg-rose-600 text-white shadow-xs'
                          : 'border-rose-300 bg-rose-50 text-rose-800 hover:bg-rose-100'
                      )}
                    >
                      
                      <span>Reject Request</span>
                    </button>
                  </div>

                  {/* Contextual form when verdict selected */}
                  {verdict && (
                    <div className="space-y-3 pt-1 animate-panel-in">
                      {/* Remarks Textarea */}
                      <div>
                        <label className="block text-xs font-bold text-slate-700 mb-1">
                          {verdict === 'NO' ? (
                            <span>
                              Rejection Justification <span className="text-rose-600">* (Min 5 chars)</span>
                            </span>
                          ) : (
                            <span>Supervisor Approval Notes (Optional)</span>
                          )}
                        </label>
                        <textarea
                          rows={2}
                          value={decisionRemarks}
                          onChange={(e) => setDecisionRemarks(e.target.value)}
                          placeholder={
                            verdict === 'NO'
                              ? 'State specific technical or operational reason for rejection…'
                              : 'Optional notes for audit logs…'
                          }
                          className="w-full p-2.5 text-xs border border-border rounded-lg bg-white resize-none focus:outline-none focus:ring-1 focus:ring-primary min-h-11"
                        />
                      </div>

                      {decisionError && (
                        <div className="bg-card border-border p-2.5 rounded-lg border text-rose-700 text-xs font-semibold flex items-center gap-2">
                          <AlertTriangle className="w-4 h-4 shrink-0" />
                          <span>{decisionError}</span>
                        </div>
                      )}

                      <div className="flex items-center justify-end gap-2.5">
                        <button
                          type="button"
                          onClick={() => {
                            setVerdict(null);
                            setDecisionError(null);
                          }}
                          disabled={isSubmitting}
                          className="min-h-11 px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900 rounded-lg hover:bg-slate-200 transition"
                        >
                          Cancel
                        </button>
                        <button
                          type="submit"
                          disabled={isSubmitting}
                          className={cn(
                            'min-h-11 px-5 py-2 text-xs font-bold text-white rounded-lg transition flex items-center gap-2 shadow-xs',
                            verdict === 'OKAY'
                              ? 'bg-emerald-600 hover:bg-emerald-700'
                              : 'bg-rose-600 hover:bg-rose-700'
                          )}
                        >
                          {isSubmitting ? (
                            <>
                              <Spinner className="w-4 h-4 text-white" />
                              <span>Submitting…</span>
                            </>
                          ) : (
                            <span>Confirm {verdict === 'OKAY' ? 'Approval' : 'Rejection'}</span>
                          )}
                        </button>
                      </div>
                    </div>
                  )}
                </form>
              ) : (
                <div className="flex items-center justify-between gap-3 text-xs">
                  <div className="flex items-center gap-2 text-slate-500">
                    <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0" />
                    <span>
                      {item.disabledReason || 'Action disabled: Segregation of duties applies.'}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={onClose}
                    className="min-h-11 px-4 py-2 text-xs font-bold bg-slate-200 hover:bg-slate-300 text-slate-800 rounded-lg transition"
                  >
                    Close
                  </button>
                </div>
              )
            ) : (
              <div className="flex items-center justify-between gap-3">
                <div className="text-xs text-slate-500">
                  Audit record only · Decisions cannot be modified.
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  className="min-h-11 px-5 py-2 text-xs font-bold bg-slate-200 hover:bg-slate-300 text-slate-800 rounded-lg transition"
                >
                  Done
                </button>
              </div>
            )}
          </div>
        </DrawerContent>
      </Drawer>

      {/* Photo Preview Modal */}
      {previewPhotoUrl && (
        <Modal
          key="photo-preview-modal"
          onClose={() => setPreviewPhotoUrl(null)}
          title="Captured Evidence Photo"
          className="max-w-2xl p-4"
        >
          <div className="space-y-3">
            <div className="rounded-xl overflow-hidden bg-black flex items-center justify-center max-h-[75vh]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={previewPhotoUrl} alt="Evidence preview" className="max-w-full max-h-full object-contain" />
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setPreviewPhotoUrl(null)}
                className="min-h-11 px-4 py-2 text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg"
              >
                Close
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
