'use client';

import React, { useState } from 'react';
import { AlertCircle, CheckCircle2, ShieldAlert, X } from 'lucide-react';
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
  module: 'ZMCC_LAB_SESSION' | 'MOT_SHOP_COLLECTION' | 'VEHICLE_VISIT' | 'PLANT_QA_MEASUREMENT' | 'ZMCC_MOT_ARRIVAL' | 'ZMCC_LOCAL_SUPPLIER_ARRIVAL' | string;
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
  const [selectedField, setSelectedField] = useState<string>(availableFields[0]?.field || '');
  const [proposedValue, setProposedValue] = useState<string>('');
  const [reason, setReason] = useState<string>('');
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
      impact: 'MEDIUM',
    };

    try {
      const res = await fetch('/api/corrections/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to submit correction request.');
      }

      setSuccessMsg(data.message || 'Correction request successfully sent to the Data Executive.');
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div className="bg-white border border-slate-200 rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden text-xs">
        {/* Header */}
        <div className="px-5 py-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <div className="p-1.5 rounded-lg bg-blue-100 text-blue-700">
              <ShieldAlert className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-semibold text-sm text-slate-900">Request Data Correction</h3>
              <p className="text-slate-500 text-[11px]">
                {recordIdentifierLabel || `${module} #${recordId}`}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200 transition-colors"
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
            <p className="text-slate-500 text-xs">
              Physical milk flow remains unimpeded. The Data Executive will review and apply this change shortly.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-5 space-y-4">
            <div className="p-3 rounded-xl bg-blue-50/70 border border-blue-100 text-blue-900 text-[11px] leading-relaxed">
              <strong>Maker-Checker Policy:</strong> Station entries lock upon submission. To fix a mistake or typo, submit your proposed correction below. Only the <strong>Data Executive</strong> and <strong>Super Admin</strong> can apply corrections to production logs.
            </div>

            {error && (
              <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 flex items-center space-x-2">
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
                className="w-full p-2.5 rounded-xl border border-slate-300 bg-white font-medium text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
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
              <div className="flex items-center justify-between p-2.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-600">
                <span className="font-medium">Currently Recorded Value:</span>
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
                  className="w-full p-2.5 rounded-xl border border-slate-300 bg-white font-medium text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
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
                  className="w-full p-2.5 rounded-xl border border-slate-300 bg-white font-medium text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-blue-500 tabular-nums"
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
                placeholder="Explain why this correction is needed (e.g., Typo on scale reading, physical re-test slip attached)…"
                className="w-full p-2.5 rounded-xl border border-slate-300 bg-white font-medium text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* Actions */}
            <div className="flex items-center justify-end space-x-2 pt-2 border-t border-slate-200">
              <button
                type="button"
                onClick={onClose}
                disabled={submitting}
                className="px-4 py-2 rounded-xl border border-slate-300 text-slate-700 font-semibold hover:bg-slate-100 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting || !proposedValue.trim() || reason.trim().length < 5}
                className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold shadow-xs transition-colors disabled:opacity-50 flex items-center space-x-1.5"
              >
                {submitting ? 'Submitting…' : 'Submit to Data Executive'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
