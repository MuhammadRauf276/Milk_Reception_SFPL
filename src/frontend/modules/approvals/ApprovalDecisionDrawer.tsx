'use client';

import { useLocalFormDraft } from '@/frontend/hooks/useLocalFormDraft';
import React, { useState } from 'react';
import { CheckCircle2, ShieldAlert, XCircle } from 'lucide-react';
import type { User } from '@/backend/core/types';
import type { UnifiedApprovalItem } from '@/backend/services/approvals/approvalInboxService';
import { Drawer, DrawerContent, DrawerTitle } from '@/components/ui/drawer';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';
import { getErrorMessage } from '@/lib/errors';

/** Bottom sheet that confirms an approve / reject verdict with supervisor remarks. */
export function ApprovalDecisionDrawer({
  item,
  verdict,
  currentUser,
  submitDecision,
  onClose,
  onDecided,
}: {
  item: UnifiedApprovalItem;
  verdict: 'OKAY' | 'NO';
  currentUser: User | null;
  submitDecision: (args: { id: string; body: Record<string, unknown> }) => Promise<void>;
  onClose: () => void;
  onDecided: () => void;
}) {
  const [decisionRemarks, setDecisionRemarks] = useState('');
  const formDraft = useLocalFormDraft({
    formKey: `approval:${item.id}:${verdict}`,
    values: { remarks: decisionRemarks },
    onRestore: (fields) => {
      if (fields.remarks !== undefined) setDecisionRemarks(fields.remarks);
    },
  });
  const [isSubmittingDecision, setIsSubmittingDecision] = useState(false);
  const [decisionError, setDecisionError] = useState<string | null>(null);

  const handleClose = () => {
    if (!isSubmittingDecision) onClose();
  };

  const handleConfirmDecision = async (e: React.FormEvent) => {
    e.preventDefault();
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

    setIsSubmittingDecision(true);
    try {
      await submitDecision({
        id: item.id,
        body: {
          approvalType: item.approvalType,
          verdict,
          remarks: decisionRemarks.trim(),
          version: item.version,
        },
      });
      formDraft.clear();
      onDecided();
    } catch (err: unknown) {
      setDecisionError(getErrorMessage(err) || 'Error submitting decision.');
    } finally {
      setIsSubmittingDecision(false);
    }
  };

  return (
    <Drawer open onOpenChange={(o) => !o && handleClose()}>
      <DrawerContent>
        <div className="space-y-2 overflow-y-auto p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-5">
          <DrawerTitle className="sr-only">
            {verdict === 'OKAY' ? 'Confirm Approval' : 'Confirm Rejection'}
          </DrawerTitle>
          <div className="flex items-center gap-2.5">
            {verdict === 'OKAY' ? (
              <div className="w-10 h-10 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
                <CheckCircle2 className="w-6 h-6" />
              </div>
            ) : (
              <div className="w-10 h-10 rounded-full bg-rose-100 text-rose-700 flex items-center justify-center shrink-0">
                <XCircle className="w-6 h-6" />
              </div>
            )}
            <div>
              <h3 className="text-base font-bold text-foreground">
                {verdict === 'OKAY' ? 'Approve Exception' : 'Reject & Return Exception'}
              </h3>
              <p className="text-xs text-slate-500">
                Reference: <strong>{item.referenceNumber}</strong>
              </p>
            </div>
          </div>



          {/* Super Admin Self-Approval Warning */}
          {currentUser?.id && item.submittedBy.id === String(currentUser.id) && (
            <div className="bg-card border-border p-3 border rounded-lg text-amber-900 text-xs space-y-1">
              <p className="font-bold flex items-center gap-1.5">
                <ShieldAlert className="w-4 h-4 text-amber-700" />
                <span>Self-Approval Compliance Review</span>
              </p>
              <p>
                As Super Admin self-approving your own submission, you must provide at least 20 characters of justification.
                
              </p>
            </div>
          )}

          {decisionError && (
            <div className="bg-card border-border p-2.5 rounded-lg border text-rose-800 text-xs font-semibold">
              {decisionError}
            </div>
          )}

          <form onSubmit={handleConfirmDecision} className="space-y-3 pt-2">
            <div className="space-y-2">
              <label className="block text-xs font-bold text-slate-700">
                Supervisor Remarks {verdict === 'NO' ? <span className="text-rose-600">* (Required)</span> : '(Optional)'}
              </label>
              <textarea
                rows={3}
                value={decisionRemarks}
                onChange={(e) => setDecisionRemarks(e.target.value)}
                placeholder={
                  verdict === 'OKAY'
                    ? 'Add any operational approval notes…'
                    : 'Specify reason for rejection or return instructions (minimum 5 letters)…'
                }
                className="w-full border border-border rounded-xl p-2.5 text-base sm:text-xs focus:ring-1 focus:ring-primary focus:outline-none min-h-11"
                autoFocus
              />
              <div className="flex justify-between items-center text-[10px] text-slate-400 mt-1">
                <span>{verdict === 'NO' ? 'Min 5 characters' : 'Optional notes'}</span>
                <span>{decisionRemarks.length} chars</span>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-border">
              <button
                type="button"
                onClick={onClose}
                disabled={isSubmittingDecision}
                className="min-h-11 px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg transition"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmittingDecision}
                className={cn(
                  'min-h-11 px-5 py-2 text-xs font-bold rounded-lg text-white transition flex items-center gap-1.5',
                  verdict === 'OKAY' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-rose-600 hover:bg-rose-700',
                  isSubmittingDecision && 'opacity-60 cursor-not-allowed'
                )}
              >
                {isSubmittingDecision ? (
                  <>
                    <Spinner className="w-3.5 h-3.5 text-white" />
                    <span>Saving…</span>
                  </>
                ) : (
                  <span>Confirm {verdict === 'OKAY' ? 'Approval' : 'Rejection'}</span>
                )}
              </button>
            </div>
          </form>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
