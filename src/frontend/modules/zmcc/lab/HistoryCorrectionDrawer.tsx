'use client';

import React from 'react';
import { ShieldAlert, Calculator } from 'lucide-react';
import { ZmccDrawer } from '@/frontend/modules/zmcc/shared/ZmccDrawer';
import type { computeCanonicalMilkMetrics } from '@/backend/utils/milkFormulas';
import type { LabSession, LabResult, ResultDrafts } from './labTypes';

export interface HistoryCorrectionDrawerProps {
  open: boolean;
  onClose: () => void;
  session: LabSession | null;
  correctionReason: string;
  setCorrectionReason: (v: string) => void;
  correctionQuantityValue: string;
  setCorrectionQuantityValue: (v: string) => void;
  correctionQuantityUnit: 'KG' | 'LITER';
  setCorrectionQuantityUnit: (v: 'KG' | 'LITER') => void;
  correctionDecision: 'ACCEPTED' | 'REJECTED';
  setCorrectionDecision: (v: 'ACCEPTED' | 'REJECTED') => void;
  correctionRejectionReason: string;
  setCorrectionRejectionReason: (v: string) => void;
  correctionValues: ResultDrafts;
  setCorrectionValues: React.Dispatch<React.SetStateAction<ResultDrafts>>;
  savingCorrection: boolean;
  handleSaveCorrection: () => void | Promise<void>;
  calculatePreview: (
    qtyStr: string,
    unit: 'KG' | 'LITER',
    values: ResultDrafts,
    results: LabResult[]
  ) => ReturnType<typeof computeCanonicalMilkMetrics> | null;
}

export const HistoryCorrectionDrawer: React.FC<HistoryCorrectionDrawerProps> = ({
  open,
  onClose,
  session: selectedHistorySession,
  correctionReason,
  setCorrectionReason,
  correctionQuantityValue,
  setCorrectionQuantityValue,
  correctionQuantityUnit,
  setCorrectionQuantityUnit,
  correctionDecision,
  setCorrectionDecision,
  correctionRejectionReason,
  setCorrectionRejectionReason,
  correctionValues,
  setCorrectionValues,
  savingCorrection,
  handleSaveCorrection,
  calculatePreview,
}) => {
  if (!selectedHistorySession) return null;
  const setShowCorrectionModal = (v: boolean) => {
    if (!v) onClose();
  };
  return (
    <ZmccDrawer
      open={open}
      onClose={onClose}
      title="Correct lab record"
      icon={<ShieldAlert className="mt-0.5 h-5 w-5 text-amber-600" aria-hidden="true" />}
      subtitle={`Correction: Session #${selectedHistorySession.id}`}
    >
            <div className="text-xs text-slate-600 bg-amber-50 p-3 rounded-xl border border-amber-200">
              <strong>Correction policy:</strong> corrections are unlimited, but every change is counted and permanently audited.
            </div>

            
            <div>
              <label className="block text-xs font-semibold text-slate-800 mb-1">
                Correction Reason *
              </label>
              <input
                type="text"
                required
                value={correctionReason}
                onChange={(e) => setCorrectionReason(e.target.value)}
                placeholder="Reason for changing lab results or decision…"
                className="w-full p-2.5 border border-slate-300 rounded-xl text-xs focus:outline-hidden focus:ring-2 focus:ring-primary"
              />
            </div>

            
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Corrected Decision
                </label>
                <select
                  value={correctionDecision}
                  onChange={(e) => setCorrectionDecision(e.target.value as 'ACCEPTED' | 'REJECTED')}
                  className="w-full p-2.5 border border-slate-300 rounded-xl text-xs focus:outline-hidden focus:ring-1 focus:ring-primary"
                >
                  <option value="ACCEPTED">ACCEPTED</option>
                  <option value="REJECTED">REJECTED</option>
                </select>
              </div>

              {correctionDecision === 'REJECTED' && (
                <div>
                  <label className="block text-xs font-semibold text-rose-700 mb-1">
                    Rejection Reason *
                  </label>
                  <input
                    type="text"
                    required
                    value={correctionRejectionReason}
                    onChange={(e) => setCorrectionRejectionReason(e.target.value)}
                    placeholder="Reason for rejection…"
                    className="w-full p-2.5 border border-rose-300 rounded-xl text-xs focus:outline-hidden focus:ring-1 focus:ring-rose-500"
                  />
                </div>
              )}
            </div>

            
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-slate-50 p-3 rounded-xl border border-slate-200">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Actual Reception Quantity
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={correctionQuantityValue}
                  onChange={(e) => setCorrectionQuantityValue(e.target.value)}
                  placeholder="e.g. 5000"
                  className="w-full p-2.5 border border-slate-300 rounded-xl text-xs tabular-nums focus:outline-hidden focus:ring-2 focus:ring-primary"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Quantity Unit
                </label>
                <div className="w-full h-9 px-3 flex items-center justify-between rounded-xl border border-slate-300 bg-white text-slate-900">
                  <span className="text-xs font-bold tabular-nums tracking-wider">
                    KG
                  </span>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-primary bg-primary/10 px-2 py-0.5 rounded-md">
                    Standard
                  </span>
                </div>
              </div>
            </div>

            
            {(() => {
              const corrPreview = calculatePreview(
                correctionQuantityValue,
                correctionQuantityUnit,
                correctionValues,
                selectedHistorySession.results
              );

              return (
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                      <Calculator className="w-3.5 h-3.5 text-primary" />
                      Recomputed Final Metrics Preview
                    </span>
                    <span className="text-xs text-slate-500 tabular-nums">
                      {corrPreview ? 'Recomputed' : 'Awaiting valid inputs'}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
                    <div className="bg-white p-2 rounded-lg border border-slate-200">
                      <span className="text-xs text-slate-500 uppercase font-semibold">Density</span>
                      <p className="text-xs font-semibold tabular-nums text-slate-800">
                        {corrPreview ? corrPreview.density.toFixed(4) : (selectedHistorySession.density != null ? Number(selectedHistorySession.density).toFixed(4) : '—')}
                      </p>
                    </div>
                    <div className="bg-white p-2 rounded-lg border border-slate-200">
                      <span className="text-xs text-slate-500 uppercase font-semibold">Gross Liters</span>
                      <p className="text-xs font-semibold tabular-nums text-slate-800">
                        {corrPreview ? `${corrPreview.grossLiters.toFixed(2)} L` : (selectedHistorySession.gross_liters != null ? `${Number(selectedHistorySession.gross_liters).toFixed(2)} L` : '—')}
                      </p>
                    </div>
                    <div className="bg-white p-2 rounded-lg border border-slate-200">
                      <span className="text-xs text-slate-500 uppercase font-semibold">SNF</span>
                      <p className="text-xs font-semibold tabular-nums text-slate-800">
                        {corrPreview ? `${corrPreview.snf.toFixed(2)}%` : (selectedHistorySession.snf != null ? `${Number(selectedHistorySession.snf).toFixed(2)}%` : '—')}
                      </p>
                    </div>
                    <div className="bg-white p-2 rounded-lg border border-slate-200">
                      <span className="text-xs text-slate-500 uppercase font-semibold">Total Solids</span>
                      <p className="text-xs font-semibold tabular-nums text-slate-800">
                        {corrPreview ? `${corrPreview.ts.toFixed(2)}%` : (selectedHistorySession.ts != null ? `${Number(selectedHistorySession.ts).toFixed(2)}%` : '—')}
                      </p>
                    </div>
                    <div className="bg-white p-2 rounded-lg border border-slate-200">
                      <span className="text-xs text-slate-500 uppercase font-semibold">@13TS Liters</span>
                      <p className="text-xs font-semibold tabular-nums text-emerald-700">
                        {corrPreview ? `${corrPreview.at13tsLiters.toFixed(2)} L` : (selectedHistorySession.at_13ts_liters != null ? `${Number(selectedHistorySession.at_13ts_liters).toFixed(2)} L` : '—')}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })()}

            
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-2">
                Override Parameter Values
              </label>
              <div className="max-h-60 overflow-y-auto border border-slate-200 rounded-xl p-3 space-y-2">
                {selectedHistorySession.results?.map((res) => {
                  const testId = res.test_id;
                  const current = correctionValues[testId] || { numeric_value: '', text_value: '' };
                  const isCalculated = res.result_type_snapshot === 'CALCULATED';
                  const isNumeric = res.result_type_snapshot === 'NUMERIC';

                  return (
                    <div key={testId} className="flex items-center justify-between text-xs py-1 border-b border-slate-100 last:border-0">
                      <div className="w-1/2">
                        <span className="font-semibold text-slate-800">{res.test_name_snapshot}</span>
                        <span className="text-xs text-slate-400 tabular-nums ml-2">({res.test_code_snapshot})</span>
                      </div>
                      <div className="w-1/2 flex items-center justify-end gap-2">
                        {isCalculated ? (
                          <span className="text-xs text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200 italic">
                            Read-only (Calculated)
                          </span>
                        ) : isNumeric ? (
                          <input
                            type="number"
                            step="any"
                            value={current.numeric_value}
                            onChange={(e) =>
                              setCorrectionValues({
                                ...correctionValues,
                                [testId]: { ...current, numeric_value: e.target.value },
                              })
                            }
                            className="w-28 px-2 py-1 border border-slate-300 rounded text-xs tabular-nums"
                          />
                        ) : (
                          <input
                            type="text"
                            value={current.text_value}
                            onChange={(e) =>
                              setCorrectionValues({
                                ...correctionValues,
                                [testId]: { ...current, text_value: e.target.value },
                              })
                            }
                            className="w-28 px-2 py-1 border border-slate-300 rounded text-xs"
                          />
                        )}
                        <span className="text-xs text-slate-400 tabular-nums w-10">
                          {res.unit_snapshot || ''}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowCorrectionModal(false)}
                disabled={savingCorrection}
                className="px-4 py-2 border border-slate-300 text-slate-700 text-xs font-semibold rounded-xl hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveCorrection}
                disabled={savingCorrection}
                className="px-5 py-2 bg-primary text-white text-xs font-semibold rounded-xl hover:bg-primary-hover transition-colors"
              >
                {savingCorrection ? 'Saving…' : 'Apply Correction'}
              </button>
            </div>
    </ZmccDrawer>
  );
};
