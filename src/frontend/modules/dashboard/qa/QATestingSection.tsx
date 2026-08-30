'use client';

import React from 'react';
import { RefreshCw, Play, CheckCircle2, XCircle } from 'lucide-react';
import { QualitativeResultRadioGroup } from '@/frontend/modules/shared/QualitativeResultRadioGroup';
import { formatOperationalTime } from '@/lib/datetime-utils';

export type TestPerformanceStatus = 'PERFORMED' | 'NOT_PERFORMED';

export interface LabTestDef {
  id: string;
  testCode: string;
  testName: string;
  resultType: 'NUMERIC' | 'TEXT' | 'QUALITATIVE' | 'BOOLEAN' | 'OK_NOT_OK' | 'POSITIVE_NEGATIVE' | 'CALCULATED' | string;
  unit: string | null;
  testScope: string;
  isRequired: boolean;
  displayOrder: number;
  resultOptions?: Array<{ value: string; label: string; isPassing: boolean | null }> | null;
}

export interface SavedPlantResult {
  testId: string;
  testCode: string;
  testName: string;
  resultType: string;
  unit: string | null;
  performanceStatus: string;
  notPerformedReason: string | null;
  numericValue: number | null;
  textValue: string | null;
  isPassed: boolean | null;
}

export interface VisitDetailPortion {
  id: string;
  visit_id: string;
  portion_number: number;
  current_status: string;
  dispatch_quantity_value?: number | null;
  dispatch_quantity_unit?: string;
  dispatch_quantity_basis?: string;
  plant_decision: string;
  plant_rejection_reason: string | null;
  dispatch_results: any[];
  plant_results: SavedPlantResult[];
}

export interface VisitDetail {
  id: string;
  visit_number: string;
  reception_number: string | null;
  vehicle_number: string;
  token_number: string | null;
  operational_date: string | null;
  entry_timestamp: string | null;
  current_status: string;
  visit_decision_summary: string;
  portions: VisitDetailPortion[];
  active_plant_tests: LabTestDef[];
}

export interface TestInputState {
  performanceStatus: TestPerformanceStatus;
  notPerformedReason: string;
  numericValue: string;
  textValue: string;
}

export interface QATestingSectionProps {
  activeTab: 'WAITING' | 'IN_TESTING' | 'ON_HOLD';
  searchQuery: string;
  selectedWaitingVisit: any;
  selectedHeldVisit: any;
  visitDetail: VisitDetail | null;
  activePortionIndex: number;
  onSelectPortion: (index: number) => void;
  isLoadingVisit: boolean;
  testInputs: Record<string, TestInputState>;
  onTestPerformanceStatusChange: (testId: string, status: TestPerformanceStatus) => void;
  onTestNumericChange: (testId: string, value: string) => void;
  onTestTextChange: (testId: string, value: string) => void;
  onTestReasonChange: (testId: string, value: string) => void;
  onOpenActionModal: (action: 'START' | 'RESUME' | 'ACCEPT' | 'HOLD' | 'REJECT', visitId?: string) => void;
  requiredManualPlantTests: LabTestDef[];
  performedCount: number;
  notPerformedCount: number;
  unresolvedCount: number;
  canAccept: boolean;
  isSubmitting: boolean;
  formatDispatchQty: (portion: VisitDetailPortion | null) => string;
}

export const QATestingSection: React.FC<QATestingSectionProps> = ({
  activeTab,
  searchQuery,
  selectedWaitingVisit,
  selectedHeldVisit,
  visitDetail,
  activePortionIndex,
  onSelectPortion,
  isLoadingVisit,
  testInputs,
  onTestPerformanceStatusChange,
  onTestNumericChange,
  onTestTextChange,
  onTestReasonChange,
  onOpenActionModal,
  requiredManualPlantTests,
  performedCount,
  notPerformedCount,
  unresolvedCount,
  canAccept,
  isSubmitting,
  formatDispatchQty,
}) => {
  if (activeTab === 'WAITING') {
    if (!selectedWaitingVisit) {
      return (
        <div className="p-8 text-center border border-dashed border-[#C4B9A3] rounded-2xl bg-[#EFE9D9] text-xs font-bold text-slate-500">
          {searchQuery ? 'No matching vehicles found.' : 'No vehicles are waiting for QA testing.'}
        </div>
      );
    }

    return (
      <div className="p-6 rounded-2xl bg-[#EFE9D9] border border-[#C4B9A3] shadow-md space-y-5 text-[#111311]">
        <div className="pb-3 border-b border-[#C4B9A3]">
          <h3 className="text-base font-extrabold text-[#111311]">Vehicle Waiting for QA</h3>
          <p className="text-xs text-[#334155] font-semibold mt-0.5">
            Vehicle: <strong className="font-mono text-[#111311]">{selectedWaitingVisit.vehicle_number}</strong> | Token:{' '}
            <strong className="font-mono text-[#1E3A8A]">{selectedWaitingVisit.token_number || 'NO-TOKEN'}</strong>
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3 p-3.5 rounded-xl bg-[#F4EFE3] border border-[#C4B9A3] text-xs font-mono font-bold">
          <div>
            <span className="text-slate-500 font-sans block text-[10px]">Portions</span>
            <span>{selectedWaitingVisit.portion_count} Composite Portions</span>
          </div>
          <div>
            <span className="text-slate-500 font-sans block text-[10px]">Gate Entry Time</span>
            <span>{formatOperationalTime(selectedWaitingVisit.entry_timestamp)}</span>
          </div>
        </div>

        <div className="pt-2">
          <button
            type="button"
            disabled={isSubmitting}
            onClick={() => onOpenActionModal('START', selectedWaitingVisit.id)}
            className="w-full min-h-[44px] py-3 px-4 rounded-xl bg-[#1E3A8A] hover:bg-blue-800 text-white font-extrabold text-xs shadow-md transition flex items-center justify-center space-x-2"
          >
            <Play className="w-4 h-4 fill-current" />
            <span>Start QA Testing Session</span>
          </button>
        </div>
      </div>
    );
  }

  if (activeTab === 'ON_HOLD') {
    if (!selectedHeldVisit) {
      return (
        <div className="p-8 text-center border border-dashed border-[#C4B9A3] rounded-2xl bg-[#EFE9D9] text-xs font-bold text-slate-500">
          Select a held vehicle to view hold details.
        </div>
      );
    }

    return (
      <div className="p-6 rounded-2xl bg-amber-50 border border-amber-300 shadow-md space-y-5 text-[#111311]">
        <div className="pb-3 border-b border-amber-200">
          <h3 className="text-base font-extrabold text-amber-950">QA Testing On Hold</h3>
          <p className="text-xs text-amber-800 font-semibold mt-0.5">
            Vehicle: <strong className="font-mono text-amber-950">{selectedHeldVisit.vehicle_number}</strong> | Token:{' '}
            <strong className="font-mono text-amber-900">{selectedHeldVisit.token_number || 'NO-TOKEN'}</strong>
          </p>
        </div>

        <div className="p-4 rounded-xl bg-white border border-amber-200 space-y-2">
          <label className="text-xs font-extrabold text-amber-950 uppercase tracking-wider block">
            Reason for Hold
          </label>
          <p className="text-xs font-bold text-amber-900">{selectedHeldVisit.hold_reason}</p>
        </div>

        <div className="grid grid-cols-2 gap-3 p-3.5 rounded-xl bg-amber-100/60 border border-amber-200 text-xs font-mono font-bold">
          <div>
            <span className="text-amber-800 font-sans block text-[10px]">Chemist</span>
            <span className="text-amber-950">{selectedHeldVisit.chemist_name}</span>
          </div>
          <div>
            <span className="text-amber-800 font-sans block text-[10px]">Held Since</span>
            <span className="text-amber-950">{formatOperationalTime(selectedHeldVisit.held_since)}</span>
          </div>
        </div>

        <div className="pt-2">
          <button
            type="button"
            disabled={isSubmitting}
            onClick={() => onOpenActionModal('RESUME', selectedHeldVisit.id)}
            className="w-full min-h-[44px] py-3 px-4 rounded-xl bg-amber-700 hover:bg-amber-800 text-white font-extrabold text-xs shadow-md transition flex items-center justify-center space-x-2"
          >
            <Play className="w-4 h-4 fill-current" />
            <span>Resume Testing Session</span>
          </button>
        </div>
      </div>
    );
  }

  // Active IN_TESTING workspace
  if (isLoadingVisit) {
    return (
      <div className="p-12 text-center border border-dashed border-[#C4B9A3] rounded-2xl bg-[#EFE9D9] text-xs font-bold text-slate-500">
        <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-blue-700" />
        Loading vehicle testing session...
      </div>
    );
  }

  if (!visitDetail) {
    return (
      <div className="p-8 text-center border border-dashed border-[#C4B9A3] rounded-2xl bg-[#EFE9D9] text-xs font-bold text-slate-500">
        Select an active testing session from the left queue to begin observations.
      </div>
    );
  }

  const currentPortion = visitDetail.portions[activePortionIndex] || null;

  return (
    <div className="p-6 rounded-2xl bg-[#EFE9D9] border border-[#C4B9A3] shadow-md space-y-6 text-[#111311]">
      {/* Session Header Card */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-[#C4B9A3]">
        <div>
          <div className="flex items-center space-x-3">
            <span className="font-mono font-black text-lg text-[#111311]">{visitDetail.vehicle_number}</span>
            <span className="px-2 py-0.5 rounded-lg text-xs font-mono font-black bg-[#1E3A8A] text-white">
              {visitDetail.token_number || 'NO-TOKEN'}
            </span>
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase bg-blue-100 text-[#1E3A8A] border border-blue-200">
              IN_TESTING
            </span>
          </div>
          <p className="text-xs text-[#334155] font-semibold mt-1">
            Gate Entry: <span className="font-mono">{formatOperationalTime(visitDetail.entry_timestamp)}</span> | Visit #{visitDetail.visit_number}
          </p>
        </div>

        <div className="flex items-center space-x-2">
          <span className="text-xs font-mono font-bold bg-[#F4EFE3] px-3 py-1.5 rounded-xl border border-[#C4B9A3] text-[#111311]">
            Decision: {visitDetail.visit_decision_summary}
          </span>
        </div>
      </div>

      {/* Portion Sub-Tabs */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <label className="text-xs font-black uppercase tracking-wider text-[#111311]">
            Select Composite Portion ({visitDetail.portions.length} Total)
          </label>
        </div>

        <div className="flex items-center space-x-2 overflow-x-auto max-w-full pb-1">
          {visitDetail.portions.map((p, idx) => {
            const isSelected = activePortionIndex === idx;
            const isAccepted = p.plant_decision === 'ACCEPTED';
            const isRejected = p.plant_decision === 'REJECTED';

            return (
              <button
                key={`portion-tab-${p.id}`}
                type="button"
                onClick={() => onSelectPortion(idx)}
                className={`px-4 py-2.5 rounded-xl text-xs font-extrabold transition flex items-center space-x-2 border shrink-0 min-h-[44px] ${
                  isSelected
                    ? 'bg-[#1E3A8A] text-white border-blue-900 shadow-md ring-2 ring-blue-500/30'
                    : isAccepted
                    ? 'bg-emerald-50 text-emerald-900 border-emerald-300 hover:bg-emerald-100'
                    : isRejected
                    ? 'bg-rose-50 text-rose-900 border-rose-300 hover:bg-rose-100'
                    : 'bg-[#F4EFE3] text-[#111311] border-[#C4B9A3] hover:bg-amber-100/50'
                }`}
              >
                <span>Portion {p.portion_number}</span>
                {isAccepted && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />}
                {isRejected && <XCircle className="w-3.5 h-3.5 text-rose-500" />}
              </button>
            );
          })}
        </div>
      </div>

      {/* Selected Portion Testing Content */}
      {currentPortion ? (
        <div className="space-y-5">
          {/* Portion Meta Summary Strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 p-3.5 rounded-xl bg-[#F4EFE3] border border-[#C4B9A3] text-xs font-mono font-bold">
            <div>
              <span className="text-slate-500 font-sans block text-[9.5px]">Portion Number</span>
              <span>Portion #{currentPortion.portion_number}</span>
            </div>
            <div>
              <span className="text-slate-500 font-sans block text-[9.5px]">Dispatch Qty</span>
              <span>{formatDispatchQty(currentPortion)}</span>
            </div>
            <div>
              <span className="text-slate-500 font-sans block text-[9.5px]">Decision</span>
              <span className={`px-2 py-0.5 rounded text-[10px] font-extrabold ${
                currentPortion.plant_decision === 'ACCEPTED'
                  ? 'bg-emerald-100 text-emerald-800'
                  : currentPortion.plant_decision === 'REJECTED'
                  ? 'bg-rose-100 text-rose-800'
                  : 'bg-amber-100 text-amber-800'
              }`}>
                {currentPortion.plant_decision}
              </span>
            </div>
            <div>
              <span className="text-slate-500 font-sans block text-[9.5px]">Plant Observations</span>
              <span>{currentPortion.plant_results.length} Saved</span>
            </div>
          </div>

          {/* Plant Rejection Banner if rejected */}
          {currentPortion.plant_decision === 'REJECTED' && currentPortion.plant_rejection_reason && (
            <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-300 text-rose-800 text-xs font-bold space-y-1">
              <span className="uppercase text-[10px] tracking-wider block text-rose-900">
                Portion Rejection Reason
              </span>
              <p>{currentPortion.plant_rejection_reason}</p>
            </div>
          )}

          {/* Dynamic Plant Test Observation Matrix */}
          <div className="space-y-3">
            <div className="flex items-center justify-between pb-1 border-b border-[#C4B9A3]">
              <h4 className="text-xs font-extrabold uppercase tracking-wider text-[#111311]">
                Plant Lab Observations ({visitDetail.active_plant_tests.length} Active Tests)
              </h4>
              <span className="text-[10px] font-bold text-slate-500">
                Dynamic Plant Quality Control
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {visitDetail.active_plant_tests
                .filter((t) => t.resultType !== 'CALCULATED')
                .map((test) => {
                  const state = testInputs[test.id] || {
                    performanceStatus: 'PERFORMED',
                    notPerformedReason: '',
                    numericValue: '',
                    textValue: '',
                  };
                  const isPerformed = state.performanceStatus === 'PERFORMED';

                  return (
                    <div
                      key={`plant-test-card-${test.id}`}
                      className={`p-3.5 rounded-xl border space-y-2.5 transition ${
                        isPerformed
                          ? 'bg-[#F4EFE3] border-[#C4B9A3]'
                          : 'bg-slate-100/80 border-slate-300'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <span className="text-xs font-extrabold text-[#111311] block">
                            {test.testName} {test.isRequired && <span className="text-rose-600 font-bold">*</span>}
                          </span>
                          <span className="text-[10px] font-mono text-slate-500">{test.testCode}</span>
                        </div>
                        {test.unit && (
                          <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-white text-slate-700 border border-[#C4B9A3]">
                            {test.unit}
                          </span>
                        )}
                      </div>

                      {/* Performance Status Toggle */}
                      <div className="flex items-center space-x-1.5">
                        <button
                          type="button"
                          onClick={() => onTestPerformanceStatusChange(test.id, 'PERFORMED')}
                          className={`min-h-[40px] px-3.5 py-2 rounded-lg text-[11px] font-extrabold transition ${
                            isPerformed
                              ? 'bg-[#1E3A8A] text-white shadow-sm'
                              : 'bg-white text-slate-700 border border-[#C4B9A3] hover:bg-slate-50'
                          }`}
                        >
                          PERFORMED
                        </button>
                        <button
                          type="button"
                          onClick={() => onTestPerformanceStatusChange(test.id, 'NOT_PERFORMED')}
                          className={`min-h-[40px] px-3.5 py-2 rounded-lg text-[11px] font-extrabold transition ${
                            !isPerformed
                              ? 'bg-rose-700 text-white shadow-sm'
                              : 'bg-white text-slate-700 border border-[#C4B9A3] hover:bg-slate-50'
                          }`}
                        >
                          NOT PERFORMED
                        </button>
                      </div>

                      {/* Dynamic Result Input or Not Performed Reason */}
                      {isPerformed ? (
                        test.resultType === 'NUMERIC' ? (
                          <div>
                            <input
                              type="number"
                              step="0.01"
                              value={state.numericValue}
                              onChange={(e) => onTestNumericChange(test.id, e.target.value)}
                              placeholder={`Enter numeric result (${test.unit || 'value'})`}
                              className="w-full min-h-[44px] px-3.5 py-2 text-xs font-mono font-bold rounded-lg border border-[#C4B9A3] bg-white text-[#111311] focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]"
                            />
                          </div>
                        ) : Array.isArray(test.resultOptions) && test.resultOptions.length > 0 ? (
                          <QualitativeResultRadioGroup
                            name={`qa-plant-test-${currentPortion.id}-${test.id}`}
                            value={state.textValue || null}
                            options={test.resultOptions}
                            onChange={(val) => onTestTextChange(test.id, val)}
                            ariaLabel={`${test.testName} observation`}
                          />
                        ) : (
                          <div>
                            <input
                              type="text"
                              value={state.textValue}
                              onChange={(e) => onTestTextChange(test.id, e.target.value)}
                              placeholder="Enter observation result"
                              className="w-full min-h-[44px] px-3.5 py-2 text-xs font-mono font-bold rounded-lg border border-[#C4B9A3] bg-white text-[#111311] focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]"
                            />
                          </div>
                        )
                      ) : (
                        <div>
                          <input
                            type="text"
                            value={state.notPerformedReason}
                            onChange={(e) => onTestReasonChange(test.id, e.target.value)}
                            placeholder="Enter reason test was not performed"
                            className="w-full min-h-[44px] px-3.5 py-2 text-xs font-mono font-bold rounded-lg border border-rose-300 bg-rose-50/50 text-rose-900 focus:outline-none focus:ring-2 focus:ring-rose-500"
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
          </div>

          {/* Test Accountability Status Bar */}
          <div className="p-3.5 rounded-xl bg-[#F4EFE3] border border-[#C4B9A3] space-y-2">
            <div className="flex items-center justify-between text-xs font-black text-[#111311]">
              <span>Mandatory Test Accountability:</span>
              <span className="font-mono">
                {performedCount}/{requiredManualPlantTests.length} Performed • {notPerformedCount} Marked Omitted • {unresolvedCount} Unresolved
              </span>
            </div>
            {!canAccept && (
              <p className="text-[11px] font-bold text-amber-800">
                All required manual tests must be either marked PERFORMED with valid observation or explicitly marked NOT PERFORMED before accepting portion.
              </p>
            )}
          </div>

          {/* Decision Action Buttons */}
          <div className="flex flex-wrap items-center justify-end gap-2.5 pt-3 border-t border-[#C4B9A3]">
            <button
              type="button"
              disabled={isSubmitting}
              onClick={() => onOpenActionModal('HOLD')}
              className="min-h-[44px] py-2.5 px-4 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-extrabold transition shadow-sm"
            >
              Place on Hold
            </button>

            <button
              type="button"
              disabled={isSubmitting}
              onClick={() => onOpenActionModal('REJECT')}
              className="min-h-[44px] py-2.5 px-4 rounded-xl bg-rose-700 hover:bg-rose-800 text-white text-xs font-extrabold transition shadow-sm"
            >
              Reject Portion
            </button>

            <button
              type="button"
              disabled={!canAccept || isSubmitting}
              onClick={() => onOpenActionModal('ACCEPT')}
              className="min-h-[44px] py-2.5 px-5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-extrabold transition shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Accept Portion
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
};
