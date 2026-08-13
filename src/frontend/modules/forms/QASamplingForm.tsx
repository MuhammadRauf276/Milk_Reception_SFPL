'use client';

import React from 'react';
import { MilkProcessLog } from '@core/types';
import { DynamicQALabForm } from './DynamicQALabForm';

interface QASamplingFormProps {
  isOpen: boolean;
  onClose: () => void;
  log: MilkProcessLog | null;
  onSave?: (id: number, updates: Partial<MilkProcessLog>) => Promise<void>;
}

export const QASamplingForm: React.FC<QASamplingFormProps> = ({ isOpen, onClose, log }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm overflow-y-auto">
      <div className="relative w-full max-w-4xl bg-[#EFE9D9] text-[#111311] rounded-2xl shadow-2xl border border-[#C4B9A3] p-6 my-8">
        <DynamicQALabForm initialVisitId={log?.id ? String(log.id) : null} onClose={onClose} />
      </div>
    </div>
  );
};
