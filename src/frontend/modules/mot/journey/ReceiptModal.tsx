'use client';

import React from 'react';
import { CheckCircle2, MessageSquare, Truck } from 'lucide-react';
import { Modal } from '@/components/ui/modal';
import type { CompletedReceipt } from './useCollection';

interface Props {
  receipt: CompletedReceipt;
  onClose: () => void;
  onReturnToPhe?: () => void;
  hasRemainingStops?: boolean;
}

export function ReceiptModal({
  receipt: completedReceiptModal,
  onClose,
  onReturnToPhe,
  hasRemainingStops = true,
}: Props) {
  return (
    <Modal onClose={onClose} title="Collection Saved & WhatsApp Receipt" className="max-w-md overflow-hidden">
      <div className="p-4 space-y-4">
        <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-950 flex items-start space-x-3">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-emerald-900">Collection Recorded Successfully</h4>
            <p className="text-xs text-emerald-800 mt-0.5">
              {completedReceiptModal.shopName} · {completedReceiptModal.grossLiters.toFixed(1)} L (@13TS: {completedReceiptModal.at13tsLiters.toFixed(1)} L)
            </p>
          </div>
        </div>

        <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs space-y-1">
          <div className="flex justify-between text-slate-600">
            <span>Shop / Recipient:</span>
            <strong className="text-foreground">{completedReceiptModal.shopName}</strong>
          </div>
          <div className="flex justify-between text-slate-600">
            <span>WhatsApp Number:</span>
            <strong className="text-foreground font-mono">{completedReceiptModal.phone}</strong>
          </div>
          <div className="flex justify-between text-slate-600">
            <span>LR / Fat:</span>
            <strong className="text-foreground">{completedReceiptModal.lr} / {completedReceiptModal.fat}%</strong>
          </div>
        </div>

        <div className="space-y-2">
          <a
            href={completedReceiptModal.whatsappUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => onClose()}
            className="w-full flex items-center justify-center space-x-2 py-3 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs shadow-md transition min-h-[44px]"
          >
            <MessageSquare className="w-4 h-4" />
            <span>Send WhatsApp Receipt ({completedReceiptModal.phone})</span>
          </a>

          {!hasRemainingStops && onReturnToPhe ? (
            <>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onReturnToPhe();
                }}
                className="w-full py-2.5 px-4 rounded-xl bg-primary hover:bg-primary-hover text-white text-xs font-semibold shadow-2xs transition flex items-center justify-center space-x-1.5 min-h-[44px]"
              >
                <Truck className="w-4 h-4" />
                <span>Return to PHE (All Shops Visited)</span>
              </button>
              <button
                type="button"
                onClick={() => onClose()}
                className="w-full py-2 px-4 rounded-xl border border-border text-slate-700 hover:bg-subtle text-xs font-semibold transition min-h-[44px]"
              >
                Close & View Journey
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => onClose()}
                className="w-full py-2.5 px-4 rounded-xl border border-border text-slate-700 hover:bg-subtle text-xs font-semibold transition min-h-[44px]"
              >
                Done / Proceed to Next Shop
              </button>
              {onReturnToPhe && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onReturnToPhe();
                  }}
                  className="w-full py-1.5 text-center text-xs font-medium text-slate-500 hover:text-slate-800 transition"
                >
                  Finish Route Early & Return to PHE →
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
