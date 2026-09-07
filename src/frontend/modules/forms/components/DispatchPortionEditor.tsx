'use client';

import React from 'react';
import { PlusCircle, Check, Calculator, Edit3, Trash2 } from 'lucide-react';
import { QualitativeResultRadioGroup } from '@/frontend/modules/shared/QualitativeResultRadioGroup';
import {
  QuantityUnit,
  MeasurementBasis,
  getAllowedBases,
} from '@/backend/modules/dispatch/quantity-policy/types';

export type QuantityUnitType = QuantityUnit;
export type MeasurementBasisType = MeasurementBasis;

export interface LabTestDef {
  id: string;
  testId: string;
  testCode: string;
  testName: string;
  resultType: 'NUMERIC' | 'TEXT' | 'QUALITATIVE' | 'BOOLEAN' | 'OK_NOT_OK' | 'POSITIVE_NEGATIVE' | 'CALCULATED' | string;
  unit: string | null;
  isRequired: boolean;
  displayOrder: number;
  resultOptions?: Array<{ value: string; label: string; isPassing: boolean | null }> | null;
}

export interface TestResultState {
  numericValue: string;
  textValue: string;
  performanceStatus: 'PERFORMED' | 'NOT_PERFORMED';
  notPerformedReason: string;
}

export interface QuantityState {
  value: string;
  unit: QuantityUnit;
  basis: MeasurementBasis;
}

export interface PortionFormState {
  clientId: string;
  portionNumber: number;
  quantity: QuantityState;
  results: Record<string, TestResultState>;
  isSaved: boolean;
}

export interface DispatchPortionEditorProps {
  portions: PortionFormState[];
  editingPortionIndex: number | null;
  onAddPortionClick: () => void;
  onEditPortion: (index: number) => void;
  onRemovePortion: (index: number) => void;
  onSavePortion: (index: number) => void;
  onPortionQuantityValueChange: (index: number, value: string) => void;
  onPortionUnitChange: (index: number, unit: QuantityUnitType) => void;
  onPortionBasisChange: (index: number, basis: MeasurementBasisType) => void;
  onPerformanceStatusChange: (
    index: number,
    testId: string,
    status: 'PERFORMED' | 'NOT_PERFORMED'
  ) => void;
  onTestResultChange: (
    index: number,
    testId: string,
    field: 'numericValue' | 'textValue' | 'notPerformedReason',
    value: string
  ) => void;
  portionAllowedMeasurements: any;
  portionAllowedUnits: QuantityUnitType[];
  portionErrors: Record<number, { quantity?: string; tests?: Record<string, string> }>;
  isContractorSource: boolean;
  manualLabTests: LabTestDef[];
  isLoadingTests: boolean;
  getPortionProgress: (portion: PortionFormState) => { label: string; accounted: number; total: number };
  computeCalculatedMilkValues: (portion: PortionFormState) => {
    density: number | null;
    grossLiters: number | null;
    at13TsLiters: number | null;
    snf: number | null;
    ts: number | null;
    ratio: number | null;
  };
}

export const DispatchPortionEditor: React.FC<DispatchPortionEditorProps> = ({
  portions,
  editingPortionIndex,
  onAddPortionClick,
  onEditPortion,
  onRemovePortion,
  onSavePortion,
  onPortionQuantityValueChange,
  onPortionUnitChange,
  onPortionBasisChange,
  onPerformanceStatusChange,
  onTestResultChange,
  portionAllowedMeasurements,
  portionAllowedUnits,
  portionErrors,
  isContractorSource,
  manualLabTests,
  isLoadingTests,
  getPortionProgress,
  computeCalculatedMilkValues,
}) => {
  return (
    <div className="space-y-4 pt-1">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-extrabold uppercase tracking-wider text-[#111311]">
          Milk Portions ({portions.length})
        </h3>

        {editingPortionIndex === null && (
          <button
            type="button"
            onClick={onAddPortionClick}
            className="flex items-center space-x-1.5 h-10 px-3.5 rounded-xl bg-[#1E40AF] text-white text-xs font-bold shadow-sm hover:bg-blue-800 transition"
          >
            <PlusCircle className="w-4 h-4" />
            <span>+ Add Portion</span>
          </button>
        )}
      </div>

      {/* Render Saved Portion Summary Cards & Active Expanded Editor */}
      <div className="space-y-3.5">
        {portions.map((portion, index) => {
          const isEditing = editingPortionIndex === index;
          const progress = getPortionProgress(portion);
          const calcValues = computeCalculatedMilkValues(portion);

          // Collapsed Summary Card View for Saved Portions
          if (!isEditing && portion.isSaved) {
            return (
              <div
                key={`portion-card-${portion.clientId}`}
                className="p-4 rounded-2xl bg-white border border-[#C4B9A3] shadow-sm space-y-3 transition"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                  <div className="flex items-center space-x-3">
                    <div className="p-2 rounded-xl bg-emerald-100 text-emerald-800 shrink-0">
                      <Check className="w-4 h-4 stroke-[3]" />
                    </div>
                    <div>
                      <div className="flex items-center space-x-2">
                        <span className="font-extrabold text-sm text-[#111311]">
                          Portion {portion.portionNumber}
                        </span>
                        <span className="px-2 py-0.5 rounded-lg text-xs font-black bg-blue-50 text-[#1E40AF] font-mono border border-blue-200">
                          {portion.quantity.value
                            ? `${Number(portion.quantity.value).toLocaleString()} ${portion.quantity.unit}`
                            : '—'}
                        </span>
                        <span className="text-[10px] font-bold text-slate-500">
                          ({portion.quantity.basis})
                        </span>
                      </div>
                      <p className="text-xs font-medium text-slate-600 mt-0.5">
                        {progress.label}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center space-x-2 self-end sm:self-center">
                    <button
                      type="button"
                      onClick={() => onEditPortion(index)}
                      className="flex items-center space-x-1 h-9 px-3 rounded-xl bg-white border border-[#C4B9A3] text-xs font-bold text-[#1E40AF] hover:bg-blue-50 transition"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                      <span>Edit</span>
                    </button>

                    {portions.length > 1 && (
                      <button
                        type="button"
                        onClick={() => onRemovePortion(index)}
                        className="flex items-center space-x-1 h-9 px-3 rounded-xl bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100 text-xs font-bold transition"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Remove</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Calculated Milk Summary Strip */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-slate-100 text-xs font-mono font-bold text-slate-700">
                  <div className="p-2 rounded-xl bg-[#F4EFE3]/60 border border-[#C4B9A3]">
                    <span className="text-[9.5px] font-sans text-slate-500 block">SNF %</span>
                    <span className="text-[#111311]">{calcValues.snf !== null ? `${calcValues.snf.toFixed(2)}%` : '—'}</span>
                  </div>
                  <div className="p-2 rounded-xl bg-[#F4EFE3]/60 border border-[#C4B9A3]">
                    <span className="text-[9.5px] font-sans text-slate-500 block">TS %</span>
                    <span className="text-[#111311]">{calcValues.ts !== null ? `${calcValues.ts.toFixed(2)}%` : '—'}</span>
                  </div>
                  <div className="p-2 rounded-xl bg-[#F4EFE3]/60 border border-[#C4B9A3]">
                    <span className="text-[9.5px] font-sans text-slate-500 block">Gross Liters</span>
                    <span className="text-emerald-900 font-black">
                      {calcValues.grossLiters !== null
                        ? `${Math.round(calcValues.grossLiters).toLocaleString()} L`
                        : '—'}
                    </span>
                  </div>
                  <div className="p-2 rounded-xl bg-[#F4EFE3]/60 border border-[#C4B9A3]">
                    <span className="text-[9.5px] font-sans text-slate-500 block">Liters @ 13% TS</span>
                    <span className="text-emerald-900 font-black">
                      {calcValues.at13TsLiters !== null
                        ? `${Math.round(calcValues.at13TsLiters).toLocaleString()} L`
                        : '—'}
                    </span>
                  </div>
                </div>
              </div>
            );
          }

          // Expanded Portion Editor View
          if (isEditing) {
            const pAllowedBases = getAllowedBases(portionAllowedMeasurements, portion.quantity.unit);
            const portionLabel =
              portion.quantity.basis === 'ESTIMATED'
                ? 'Estimated Portion Quantity'
                : 'Measured Portion Quantity';

            return (
              <div
                key={`portion-editor-${portion.clientId}`}
                className="p-4 sm:p-5 rounded-2xl bg-white border-2 border-[#1E40AF] shadow-md space-y-4"
              >
                <div className="flex items-center justify-between border-b pb-2.5">
                  <span className="font-extrabold text-sm text-[#1E40AF]">
                    Portion {portion.portionNumber}
                  </span>
                  <span className="text-xs font-bold text-slate-600 bg-slate-100 px-3 py-1 rounded-full border border-slate-200">
                    {progress.label}
                  </span>
                </div>

                {/* Portion Quantity & Controls */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="block text-xs font-bold text-[#111311]">
                      {portionLabel} *
                    </label>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="space-y-1">
                      <label htmlFor={`portion-qty-input-${index}`} className="block text-xs font-bold text-slate-600">Value *</label>
                      <input
                        id={`portion-qty-input-${index}`}
                        type="number"
                        min="0.01"
                        step="0.01"
                        value={portion.quantity.value}
                        onChange={(e) => onPortionQuantityValueChange(index, e.target.value)}
                        placeholder="e.g. 8500"
                        className={`w-full h-11 px-3.5 text-sm font-mono font-bold rounded-xl border bg-[#F4EFE3] text-[#111311] focus:ring-2 focus:ring-[#1E40AF] outline-none transition ${
                          portionErrors[index]?.quantity
                            ? 'border-rose-500 bg-rose-50/20 ring-1 ring-rose-500'
                            : 'border-[#C4B9A3]'
                        }`}
                        required
                      />
                    </div>

                    <div className="space-y-1">
                      <label htmlFor={`portion-unit-select-${index}`} className="block text-xs font-bold text-slate-600">
                        Unit * {index > 0 && <span className="text-[10px] font-normal text-slate-500">(Shared from P1)</span>}
                      </label>
                      {index === 0 ? (
                        <select
                          id={`portion-unit-select-${index}`}
                          value={portion.quantity.unit}
                          onChange={(e) => onPortionUnitChange(index, e.target.value as QuantityUnitType)}
                          className="w-full h-11 px-3 text-xs font-mono font-black rounded-xl border border-[#C4B9A3] bg-white text-[#111311] focus:ring-2 focus:ring-[#1E40AF] outline-none transition"
                        >
                          {portionAllowedUnits.map((u) => (
                            <option key={u} value={u}>
                              {u}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          id={`portion-unit-select-${index}`}
                          type="text"
                          readOnly
                          disabled
                          value={portion.quantity.unit}
                          className="w-full h-11 px-3.5 text-xs font-mono font-black rounded-xl border border-slate-200 bg-slate-100 text-slate-500 cursor-not-allowed outline-none select-none"
                        />
                      )}
                    </div>

                    <div className="space-y-1">
                      <label htmlFor={`portion-basis-select-${index}`} className="block text-xs font-bold text-slate-600">
                        Basis * {index > 0 && <span className="text-[10px] font-normal text-slate-500">(Shared from P1)</span>}
                      </label>
                      {index === 0 ? (
                        <select
                          id={`portion-basis-select-${index}`}
                          value={portion.quantity.basis}
                          onChange={(e) => onPortionBasisChange(index, e.target.value as MeasurementBasisType)}
                          className="w-full h-11 px-3 text-xs font-mono font-bold rounded-xl border border-[#C4B9A3] bg-white text-[#111311] focus:ring-2 focus:ring-[#1E40AF] outline-none transition"
                        >
                          {pAllowedBases.map((b) => (
                            <option key={b} value={b}>
                              {b}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          id={`portion-basis-select-${index}`}
                          type="text"
                          readOnly
                          disabled
                          value={portion.quantity.basis}
                          className="w-full h-11 px-3.5 text-xs font-mono font-bold rounded-xl border border-slate-200 bg-slate-100 text-slate-500 cursor-not-allowed outline-none select-none"
                        />
                      )}
                    </div>
                  </div>

                  {portionErrors[index]?.quantity && (
                    <p className="text-xs font-bold text-rose-600 mt-1" id={`portion-qty-error-${index}`}>
                      {portionErrors[index].quantity}
                    </p>
                  )}
                </div>

                {/* Contractor Dispatch Tests Grid (Explicit Performance Status) */}
                {isContractorSource ? (
                  <div className="space-y-3 pt-2 border-t border-slate-100">
                    <div className="flex items-center justify-between">
                      <label className="block text-xs font-extrabold uppercase text-[#111311]">
                        Contractor Dispatch Tests ({manualLabTests.length} Tests)
                      </label>
                      <span className="text-[10px] font-bold text-slate-500">
                        Default: NOT_PERFORMED (Contract Vehicle)
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
                      {manualLabTests.map((test) => {
                        const resultState = portion.results[test.testId] || {
                          numericValue: '',
                          textValue: '',
                          performanceStatus: 'PERFORMED',
                          notPerformedReason: '',
                        };
                        const testError = portionErrors[index]?.tests?.[test.testId];
                        const isPerformed = resultState.performanceStatus === 'PERFORMED';

                        return (
                          <div
                            key={`contractor-test-${portion.clientId}-${test.id}`}
                            className={`p-3 rounded-xl border space-y-2 transition ${
                              testError
                                ? 'border-rose-500 bg-rose-50/30 ring-1 ring-rose-400'
                                : isPerformed
                                ? 'border-[#C4B9A3] bg-[#F4EFE3]'
                                : 'border-slate-300 bg-slate-100/70'
                            }`}
                          >
                            <div className="flex items-center justify-between text-xs font-bold">
                              <span className="text-[#111311] font-extrabold">
                                {test.testName}
                              </span>
                              {test.unit && (
                                <span className="text-[10px] font-mono text-slate-500">({test.unit})</span>
                              )}
                            </div>

                            {/* Performance Status Toggle */}
                            <div className="flex items-center space-x-1.5">
                              <button
                                type="button"
                                onClick={() => onPerformanceStatusChange(index, test.testId, 'PERFORMED')}
                                className={`h-8 px-3 rounded-lg text-xs font-black transition ${
                                  isPerformed
                                    ? 'bg-[#1E40AF] text-white shadow-sm'
                                    : 'bg-slate-200 text-slate-700 hover:bg-slate-300'
                                }`}
                              >
                                PERFORMED
                              </button>
                              <button
                                type="button"
                                onClick={() => onPerformanceStatusChange(index, test.testId, 'NOT_PERFORMED')}
                                className={`h-8 px-3 rounded-lg text-xs font-black transition ${
                                  !isPerformed
                                    ? 'bg-rose-700 text-white shadow-sm'
                                    : 'bg-slate-200 text-slate-700 hover:bg-slate-300'
                                }`}
                              >
                                NOT PERFORMED
                              </button>
                            </div>

                            {/* Dynamic Input Control: Result when PERFORMED, Reason when NOT_PERFORMED */}
                            {isPerformed ? (
                              <div className="space-y-1">
                                {test.resultType === 'NUMERIC' ? (
                                  <input
                                    id={`test-input-field-${index}-${test.id}`}
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    value={resultState.numericValue}
                                    onChange={(e) =>
                                      onTestResultChange(index, test.testId, 'numericValue', e.target.value)
                                    }
                                    placeholder="Enter numeric value"
                                    className={`w-full h-10 px-3 text-xs font-mono font-bold rounded-lg border bg-white text-[#111311] focus:ring-2 focus:ring-[#1E40AF] outline-none transition ${
                                      testError ? 'border-rose-500' : 'border-[#C4B9A3]'
                                    }`}
                                  />
                                ) : Array.isArray(test.resultOptions) && test.resultOptions.length > 0 ? (
                                  <QualitativeResultRadioGroup
                                    name={`dispatch-contractor-${portion.clientId}-${test.id}`}
                                    value={resultState.textValue || null}
                                    options={test.resultOptions}
                                    onChange={(val) =>
                                      onTestResultChange(index, test.testId, 'textValue', val)
                                    }
                                    error={testError}
                                    ariaLabel={`${test.testName} result for Portion ${portion.portionNumber}`}
                                  />
                                ) : (
                                  <input
                                    id={`test-input-field-${index}-${test.id}`}
                                    type="text"
                                    value={resultState.textValue}
                                    onChange={(e) =>
                                      onTestResultChange(index, test.testId, 'textValue', e.target.value)
                                    }
                                    placeholder="Enter result"
                                    className={`w-full h-10 px-3 text-xs font-mono font-bold rounded-lg border bg-white text-[#111311] focus:ring-2 focus:ring-[#1E40AF] outline-none transition ${
                                      testError ? 'border-rose-500' : 'border-[#C4B9A3]'
                                    }`}
                                  />
                                )}
                              </div>
                            ) : (
                              <div className="space-y-1">
                                <input
                                  id={`test-reason-field-${index}-${test.id}`}
                                  type="text"
                                  value={resultState.notPerformedReason}
                                  onChange={(e) =>
                                    onTestResultChange(index, test.testId, 'notPerformedReason', e.target.value)
                                  }
                                  placeholder="Reason (e.g. Contract Vehicle)"
                                  className={`w-full h-10 px-3 text-xs font-mono font-bold rounded-lg border bg-rose-50/40 text-rose-900 border-rose-300 focus:ring-2 focus:ring-rose-500 outline-none transition ${
                                    testError ? 'border-rose-500' : ''
                                  }`}
                                />
                              </div>
                            )}

                            {testError && (
                              <p className="text-[11px] font-bold text-rose-600 mt-0.5" id={`test-error-${index}-${test.id}`}>
                                {testError}
                              </p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  /* ZMCC Full Manual Lab Tests Input Grid */
                  <div className="space-y-2.5 pt-2 border-t border-slate-100">
                    <div className="flex items-center justify-between pb-1">
                      <label className="block text-xs font-extrabold uppercase text-[#111311]">
                        Lab Tests ({manualLabTests.length} Manual Observations)
                      </label>
                      <span className="text-[10px] font-bold text-slate-500">
                        ZMCC Strict Mode Testing
                      </span>
                    </div>

                    {isLoadingTests ? (
                      <p className="text-xs text-slate-500">Loading lab tests...</p>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
                        {manualLabTests.map((test) => {
                          const resultState = portion.results[test.testId] || {
                            numericValue: '',
                            textValue: '',
                            performanceStatus: 'PERFORMED',
                            notPerformedReason: '',
                          };
                          const testError = portionErrors[index]?.tests?.[test.testId];

                          return (
                            <div
                              key={`test-input-${portion.clientId}-${test.id}`}
                              className={`p-3 rounded-xl bg-[#F4EFE3] border space-y-2 ${
                                testError ? 'border-rose-500 bg-rose-50/20' : 'border-[#C4B9A3]'
                              }`}
                            >
                              <div className="flex items-center justify-between text-xs font-bold">
                                <span>
                                  {test.testName} {test.isRequired && <span className="text-rose-600">*</span>}
                                </span>
                                {test.unit && (
                                  <span className="text-[10px] font-mono text-slate-500">({test.unit})</span>
                                )}
                              </div>

                              {test.resultType === 'NUMERIC' ? (
                                <div className="space-y-1.5">
                                  <div className="flex items-center space-x-1">
                                    <button
                                      type="button"
                                      onClick={() => onPerformanceStatusChange(index, test.testId, 'PERFORMED')}
                                      className={`h-7 px-2.5 rounded text-[11px] font-black transition ${
                                        resultState.performanceStatus === 'PERFORMED'
                                          ? 'bg-blue-700 text-white shadow-sm'
                                          : 'bg-slate-200 text-slate-700'
                                      }`}
                                    >
                                      PERFORMED
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => onPerformanceStatusChange(index, test.testId, 'NOT_PERFORMED')}
                                      className={`h-7 px-2.5 rounded text-[11px] font-black transition ${
                                        resultState.performanceStatus === 'NOT_PERFORMED'
                                          ? 'bg-rose-700 text-white shadow-sm'
                                          : 'bg-slate-200 text-slate-700'
                                      }`}
                                    >
                                      NOT PERFORMED
                                    </button>
                                  </div>

                                  {resultState.performanceStatus === 'PERFORMED' ? (
                                    <input
                                      id={`test-input-field-${index}-${test.id}`}
                                      type="number"
                                      step="0.01"
                                      value={resultState.numericValue}
                                      onChange={(e) =>
                                        onTestResultChange(index, test.testId, 'numericValue', e.target.value)
                                      }
                                      placeholder="Enter value"
                                      className={`w-full h-10 px-3 text-xs font-mono font-bold rounded-lg border bg-white text-[#111311] outline-none transition ${
                                        testError ? 'border-rose-500 focus:ring-2 focus:ring-rose-500' : 'border-[#C4B9A3] focus:ring-2 focus:ring-[#1E40AF]'
                                      }`}
                                    />
                                  ) : (
                                    <input
                                      id={`test-input-field-${index}-${test.id}`}
                                      type="text"
                                      value={resultState.notPerformedReason}
                                      onChange={(e) =>
                                        onTestResultChange(index, test.testId, 'notPerformedReason', e.target.value)
                                      }
                                      placeholder="Enter reason for not performing"
                                      className={`w-full h-10 px-3 text-xs font-mono font-bold rounded-lg border bg-rose-50 text-rose-900 border-rose-300 outline-none transition ${
                                        testError ? 'border-rose-500 focus:ring-2 focus:ring-rose-500' : ''
                                      }`}
                                    />
                                  )}
                                </div>
                              ) : Array.isArray(test.resultOptions) && test.resultOptions.length > 0 ? (
                                <div className="space-y-1.5">
                                  <div className="flex items-center space-x-1">
                                    <button
                                      type="button"
                                      onClick={() => onPerformanceStatusChange(index, test.testId, 'PERFORMED')}
                                      className={`h-7 px-2.5 rounded text-[11px] font-black transition ${
                                        resultState.performanceStatus === 'PERFORMED'
                                          ? 'bg-blue-700 text-white shadow-sm'
                                          : 'bg-slate-200 text-slate-700'
                                      }`}
                                    >
                                      PERFORMED
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => onPerformanceStatusChange(index, test.testId, 'NOT_PERFORMED')}
                                      className={`h-7 px-2.5 rounded text-[11px] font-black transition ${
                                        resultState.performanceStatus === 'NOT_PERFORMED'
                                          ? 'bg-rose-700 text-white shadow-sm'
                                          : 'bg-slate-200 text-slate-700'
                                      }`}
                                    >
                                      NOT PERFORMED
                                    </button>
                                  </div>

                                  {resultState.performanceStatus === 'PERFORMED' ? (
                                    <QualitativeResultRadioGroup
                                      name={`dispatch-zmcc-${portion.clientId}-${test.id}`}
                                      value={resultState.textValue || null}
                                      options={test.resultOptions}
                                      onChange={(val) =>
                                        onTestResultChange(index, test.testId, 'textValue', val)
                                      }
                                      error={testError}
                                      ariaLabel={`${test.testName} result for Portion ${portion.portionNumber}`}
                                    />
                                  ) : (
                                    <input
                                      id={`test-input-field-${index}-${test.id}`}
                                      type="text"
                                      value={resultState.notPerformedReason}
                                      onChange={(e) =>
                                        onTestResultChange(index, test.testId, 'notPerformedReason', e.target.value)
                                      }
                                      placeholder="Enter reason for not performing"
                                      className={`w-full h-10 px-3 text-xs font-mono font-bold rounded-lg border bg-rose-50 text-rose-900 border-rose-300 outline-none transition ${
                                        testError ? 'border-rose-500 focus:ring-2 focus:ring-rose-500' : ''
                                      }`}
                                    />
                                  )}
                                </div>
                              ) : (
                                <input
                                  id={`test-input-field-${index}-${test.id}`}
                                  type="text"
                                  value={resultState.textValue}
                                  onChange={(e) =>
                                    onTestResultChange(index, test.testId, 'textValue', e.target.value)
                                  }
                                  placeholder="Enter result"
                                  className={`w-full h-10 px-3 text-xs font-mono font-bold rounded-lg border bg-white text-[#111311] outline-none transition ${
                                    testError ? 'border-rose-500 focus:ring-2 focus:ring-rose-500' : 'border-[#C4B9A3] focus:ring-2 focus:ring-[#1E40AF]'
                                  }`}
                                />
                              )}

                              {testError && (
                                <p className="text-[11px] font-bold text-rose-600 mt-1" id={`test-error-${index}-${test.id}`}>
                                  {testError}
                                </p>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {/* Calculation summary notice */}
                <div className="flex items-center space-x-2 text-xs font-medium text-slate-600 bg-[#F4EFE3]/70 p-2.5 rounded-xl border border-[#C4B9A3]">
                  <Calculator className="w-4 h-4 text-[#1E40AF] shrink-0" />
                  <span>Canonical milk values update live in the summary panel.</span>
                </div>

                {/* Save Portion Action Controls */}
                <div className="flex items-center justify-end space-x-2.5 pt-3 border-t">
                  {portions.length > 1 && (
                    <button
                      type="button"
                      onClick={() => onRemovePortion(index)}
                      className="h-11 px-4 rounded-xl border border-rose-200 bg-rose-50 text-rose-700 text-xs font-bold hover:bg-rose-100 transition"
                    >
                      Remove
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => onSavePortion(index)}
                    className="h-11 px-5 rounded-xl bg-emerald-700 text-white text-xs font-bold shadow-sm hover:bg-emerald-800 transition"
                  >
                    Save Portion
                  </button>
                </div>
              </div>
            );
          }

          return null;
        })}
      </div>

      {/* Add Portion Button when all saved */}
      {editingPortionIndex === null && (
        <button
          type="button"
          onClick={onAddPortionClick}
          className="w-full h-12 rounded-2xl border-2 border-dashed border-[#1E40AF] text-[#1E40AF] font-bold text-xs bg-blue-50/40 hover:bg-blue-100/50 transition flex items-center justify-center space-x-2"
        >
          <PlusCircle className="w-4 h-4" />
          <span>+ Add Portion</span>
        </button>
      )}
    </div>
  );
};
