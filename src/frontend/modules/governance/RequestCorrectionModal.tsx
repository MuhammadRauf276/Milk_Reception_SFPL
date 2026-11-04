'use client';

import { useLocalFormDraft } from '@/frontend/hooks/useLocalFormDraft';
import React, { useState } from 'react';
import { AlertCircle, CheckCircle2, ShieldAlert, X } from 'lucide-react';
import { Drawer, DrawerContent, DrawerTitle } from '@/components/ui/drawer';
import { useQueryClient } from '@tanstack/react-query';
import { fetchJson } from '@/lib/query/fetchJson';
import { getErrorMessage } from '@/lib/errors';

export interface EditableFieldOption {
  field: string;
  label: string;
  currentValue?: string | number | null;
  type?: 'text' | 'number' | 'select';
  options?: Array<{ value: string; label: string }>;
}

export interface RequestCorrectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  module: 'ZMCC_LAB_SESSION' | 'MOT_SHOP_COLLECTION' | 'VEHICLE_VISIT' | 'PLANT_QA_MEASUREMENT' | 'ZMCC_MC_ARRIVAL' | 'ZMCC_HC_ARRIVAL' | 'ZMCC_WEIGHING' | 'ZMCC_EXIT';
  recordId: string | number;
  recordIdentifierLabel?: string;
  sourceId?: string | number | null;
  availableFields: EditableFieldOption[];
  onSuccess?: (requestId: string) => void;
}

export const RequestCorrectionModal: React.FC<RequestCorrectionModalProps> = ({
  isOpen,
  onClose,
  module,
  recordId,
  recordIdentifierLabel,
  sourceId,
  availableFields,
  onSuccess,
}) => {
  const queryClient = useQueryClient();
  const [selectedField, setSelectedField] = useState<string>(availableFields[0]?.field || '');
  const [proposedValue, setProposedValue] = useState<string>('');
  const [reason, setReason] = useState<string>('');
  const formDraft = useLocalFormDraft({
    formKey: isOpen ? `correction:${module}:${recordId}` : null,
    values: { field: selectedField, proposed: proposedValue, reason },
    onRestore: (fields) => {
      if (fields.field !== undefined) setSelectedField(fields.field);
      if (fields.proposed !== undefined) setProposedValue(fields.proposed);
      if (fields.reason !== undefined) setReason(fields.reason);
    },
  });
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const currentFieldConfig = availableFields.find((f) => f.field === selectedField);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedField) {
      setError('Please select a field to correct.');
      return;
    }
    if (!proposedValue.trim()) {
      setError('Please enter the proposed corrected value.');
      return;
    }
    if (reason.trim().length < 5) {
      setError('A substantive reason of at least 5 characters is required for audit verification.');
      return;
    }

    setSubmitting(true);
    setError(null);

    let parsedVal: unknown = proposedValue.trim();
    if (currentFieldConfig?.type === 'number' && !isNaN(Number(proposedValue))) {
      parsedVal = Number(proposedValue);
    }

    const payload = {
      module,
      recordId: String(recordId),
      sourceId: sourceId ? String(sourceId) : null,
      reason: reason.trim(),
      requestedChanges: {
        [selectedField]: parsedVal,
      },
      currentValues: currentFieldConfig?.currentValue !== undefined && currentFieldConfig.currentValue !== null
        ? { [selectedField]: currentFieldConfig.currentValue }
        : null,
      impact: 'MEDIUM',
    };

    try {
      const data = await fetchJson<{ message?: string; requestId?: string }>('/api/corrections/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      void queryClient.invalidateQueries({ queryKey: ['corrections'] });

      formDraft.clear();
      setSuccessMsg(data.message || 'Correction request sent. Follow it under My correction requests.');
      if (onSuccess && data.requestId) {
        onSuccess(data.requestId);
      }
      setTimeout(() => {
        onClose();
        setSuccessMsg(null);
        setReason('');
        setProposedValue('');
      }, 1800);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Drawer open onOpenChange={(open) => { if (!open && !submitting) onClose(); }}>
      <DrawerContent>
      <div className="overflow-y-auto text-xs">
        {/* Header */}
        <div className="px-5 py-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <div className="p-1.5 rounded-lg bg-blue-100 text-blue-700">
              <ShieldAlert className="w-4 h-4" />
            </div>
            <div>
              <DrawerTitle className="font-semibold text-sm text-slate-900">Request a correction</DrawerTitle>
              <p className="text-slate-500 text-[11px]">
                {recordIdentifierLabel || `${module} #${recordId}`}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close" className="p-3 -m-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200 transition-colors min-h-11 min-w-11"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        {successMsg ? (
          <div className="p-8 text-center space-y-3">
            <div className="w-12 h-12 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <p className="font-semibold text-slate-800 text-sm">{successMsg}</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-5 space-y-4">
            <div className="bg-card border-border p-3 rounded-xl border text-blue-900 text-[11px] leading-relaxed">
              <strong>How it works:</strong> saved entries are locked. Tell us what is wrong and what it should be. The <strong>Data Executive</strong> reviews your request and fixes the record. You can follow it under <em>My correction requests</em>: Open, Approved, Rejected or Done.
            </div>

            {error && (
              <div className="bg-card border-border p-3 rounded-xl border text-rose-800 flex items-center space-x-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
                <span>{error}</span>
              </div>
            )}

            {/* Field Selector */}
            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Field with Mistake / Typo <span className="text-rose-500">*</span>
              </label>
              <select
                value={selectedField}
                onChange={(e) => {
                  setSelectedField(e.target.value);
                  setProposedValue('');
                }}
                className="w-full min-h-11 p-2.5 rounded-xl border border-slate-300 bg-white font-medium text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
              >
                {availableFields.map((f) => (
                  <option key={f.field} value={f.field}>
                    {f.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Current Value Display */}
            {currentFieldConfig?.currentValue !== undefined && currentFieldConfig.currentValue !== null && (
              <div className="bg-card border-border flex items-center justify-between p-2.5 rounded-lg border text-slate-600">
                <span className="font-medium">Recorded now (wrong value):</span>
                <span className="font-semibold text-slate-900 tabular-nums">
                  {String(currentFieldConfig.currentValue)}
                </span>
              </div>
            )}

            {/* Proposed Value Input */}
            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Proposed Corrected Value <span className="text-rose-500">*</span>
              </label>
              {currentFieldConfig?.type === 'select' && currentFieldConfig.options ? (
                <select
                  value={proposedValue}
                  onChange={(e) => setProposedValue(e.target.value)}
                  className="w-full min-h-11 p-2.5 rounded-xl border border-slate-300 bg-white font-medium text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Select correct option</option>
                  {currentFieldConfig.options.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type={currentFieldConfig?.type === 'number' ? 'number' : 'text'}
                  step={currentFieldConfig?.type === 'number' ? 'any' : undefined}
                  value={proposedValue}
                  onChange={(e) => setProposedValue(e.target.value)}
                  placeholder={`Enter correct ${currentFieldConfig?.label || 'value'}…`}
                  className="w-full min-h-11 p-2.5 rounded-xl border border-slate-300 bg-white font-medium text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-blue-500 tabular-nums"
                />
              )}
            </div>

            {/* Reason */}
            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Substantive Reason / Audit Note <span className="text-rose-500">*</span>
              </label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={2}
                placeholder="Reason"
                className="w-full min-h-11 p-2.5 rounded-xl border border-slate-300 bg-white font-medium text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* Actions */}
            <div className="flex items-center justify-end space-x-2 pt-2 border-t border-slate-200">
              <button
                type="button"
                onClick={onClose}
                disabled={submitting}
                className="min-h-11 px-4 py-2 rounded-xl border border-slate-300 text-slate-700 font-semibold hover:bg-slate-100 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting || !proposedValue.trim() || reason.trim().length < 5}
                className="min-h-11 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold shadow-xs transition-colors disabled:opacity-50 flex items-center space-x-1.5"
              >
                {submitting ? 'Sending…' : 'Send request'}
              </button>
            </div>
          </form>
        )}
      </div>
      </DrawerContent>
    </Drawer>
  );
};
