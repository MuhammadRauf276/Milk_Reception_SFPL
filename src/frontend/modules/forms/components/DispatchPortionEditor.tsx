'use client';

import React from 'react';
import { PlusCircle, Check, Calculator, Edit3, Trash2, X } from 'lucide-react';
import { QualitativeResultRadioGroup } from '@/frontend/modules/shared/QualitativeResultRadioGroup';
import {
  QuantityUnit,
  MeasurementBasis,
  getAllowedBases,
  type AllowedMeasurementConfig,
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
  portionAllowedMeasurements: AllowedMeasurementConfig[];
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
        <h3 className="text-xs font-semibold text-foreground">
          Milk Portions ({portions.length})
        </h3>

        {editingPortionIndex === null && (
          <button
            type="button"
            onClick={onAddPortionClick}
            className="flex items-center space-x-1.5 h-10 px-3.5 rounded-xl bg-primary-hover text-white text-xs font-semibold shadow-xs hover:bg-blue-800 transition"
          >
            <PlusCircle className="w-4 h-4" />
            <span>+ Add Portion</span>
          </button>
        )}
      </div>

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
                className="p-4 rounded-xl bg-white border border-border-strong shadow-xs space-y-3 transition"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                  <div className="flex items-center space-x-3">
                    <div className="p-2 rounded-xl bg-emerald-100 text-emerald-800 shrink-0">
                      <Check className="w-4 h-4 stroke-3" />
                    </div>
                    <div>
                      <div className="flex items-center space-x-2">
                        <span className="font-semibold text-sm text-foreground">
                          Portion {portion.portionNumber}
                        </span>
                        <span className="px-2 py-0.5 rounded-lg text-xs font-semibold bg-blue-50 text-primary-hover tabular-nums border border-blue-200">
                          {portion.quantity.value
                            ? `${Number(portion.quantity.value).toLocaleString()} ${portion.quantity.unit}`
                            : '—'}
                        </span>
                        <span className="text-[10px] font-semibold text-slate-500">
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
                      className="flex items-center space-x-1 h-9 px-3 rounded-xl bg-white border border-border-strong text-xs font-semibold text-primary-hover hover:bg-blue-50 transition"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                      <span>Edit</span>
                    </button>

                    {portions.length > 1 && (
                      <button
                        type="button"
                        onClick={() => onRemovePortion(index)}
                        className="flex items-center space-x-1 h-9 px-3 rounded-xl bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100 text-xs font-semibold transition"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Remove</span>
                      </button>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-slate-100 text-xs tabular-nums font-semibold text-slate-700">
                  <div className="p-2 rounded-xl bg-subtle border border-border">
                    <span className="text-[10px] font-sans text-slate-500 block">SNF %</span>
                    <span className="text-foreground">{calcValues.snf !== null ? `${calcValues.snf.toFixed(2)}%` : '—'}</span>
                  </div>
                  <div className="p-2 rounded-xl bg-subtle border border-border">
                    <span className="text-[10px] font-sans text-slate-500 block">TS %</span>
                    <span className="text-foreground">{calcValues.ts !== null ? `${calcValues.ts.toFixed(2)}%` : '—'}</span>
                  </div>
                  <div className="p-2 rounded-xl bg-subtle border border-border">
                    <span className="text-[10px] font-sans text-slate-500 block">Gross Liters</span>
                    <span className="text-emerald-900 font-semibold">
                      {calcValues.grossLiters !== null
                        ? `${Math.round(calcValues.grossLiters).toLocaleString()} L`
                        : '—'}
                    </span>
                  </div>
                  <div className="p-2 rounded-xl bg-subtle border border-border">
                    <span className="text-[10px] font-sans text-slate-500 block">Liters @ 13% TS</span>
                    <span className="text-emerald-900 font-semibold">
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
                className="p-4 sm:p-5 rounded-xl bg-white border-2 border-primary-hover shadow-md space-y-4"
              >
                <div className="flex items-center justify-between border-b pb-2.5">
                  <div className="flex items-center space-x-2">
                    <span className="font-semibold text-sm text-primary">
                      Portion {portion.portionNumber}
                    </span>
                    {portions.length > 1 && (
                      <span className="text-[10px] text-slate-500 font-medium">
                        (Sub-lot)
                      </span>
                    )}
                  </div>
                  <div className="flex items-center space-x-2">
                    <span className="text-xs font-semibold text-slate-600 bg-slate-100 px-3 py-1 rounded-full border border-slate-200">
                      {progress.label}
                    </span>
                    {portions.length > 1 && (
                      <button
                        type="button"
                        onClick={() => onRemovePortion(index)}
                        title={`Remove Portion ${portion.portionNumber}`}
                        className="p-1 rounded-lg text-slate-400 hover:text-rose-700 hover:bg-rose-50 transition border border-transparent hover:border-rose-200 cursor-pointer"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="block text-xs font-semibold text-foreground">
                      {portionLabel} *
                    </label>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="space-y-1">
                      <label htmlFor={`portion-qty-input-${index}`} className="block text-xs font-semibold text-slate-600">Value *</label>
                      <input
                        id={`portion-qty-input-${index}`}
                        type="number"
                        min="0.01"
                        step="0.01"
                        value={portion.quantity.value}
                        onChange={(e) => onPortionQuantityValueChange(index, e.target.value)}
                        placeholder="e.g. 8500"
                        className={`w-full h-11 px-3.5 text-sm tabular-nums font-semibold rounded-xl border bg-card text-foreground focus:ring-2 focus:ring-primary-hover outline-hidden transition ${
                          portionErrors[index]?.quantity
                            ? 'border-rose-500 bg-rose-50/20 ring-1 ring-rose-500'
                            : 'border-border-strong'
                        }`}
                        required
                      />
                    </div>

                    <div className="space-y-1">
                      <label htmlFor={`portion-unit-select-${index}`} className="block text-xs font-semibold text-slate-600">
                        Unit * {index > 0 && <span className="text-[10px] font-normal text-slate-500">(Shared from P1)</span>}
                      </label>
                      <div className="w-full h-11 px-3.5 flex items-center justify-between rounded-xl border border-border-strong bg-slate-50 text-foreground">
                        <span className="text-xs font-bold tabular-nums text-slate-900 tracking-wider">
                          KG
                        </span>
                        <span className="text-[10px] font-bold uppercase tracking-wider text-primary bg-primary/10 px-2 py-0.5 rounded-md">
                          Standard
                        </span>
                      </div>
                      <input type="hidden" id={`portion-unit-select-${index}`} value="KG" />
                    </div>

                    <div className="space-y-1">
                      <label htmlFor={`portion-basis-select-${index}`} className="block text-xs font-semibold text-slate-600">
                        Basis * {index > 0 && <span className="text-[10px] font-normal text-slate-500">(Shared from P1)</span>}
                      </label>
                      {index === 0 ? (
                        <select
                          id={`portion-basis-select-${index}`}
                          value={portion.quantity.basis}
                          onChange={(e) => onPortionBasisChange(index, e.target.value as MeasurementBasisType)}
                          className="w-full h-11 px-3 text-xs tabular-nums font-semibold rounded-xl border border-border-strong bg-white text-foreground focus:ring-2 focus:ring-primary-hover outline-hidden transition"
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
                          className="w-full h-11 px-3.5 text-xs tabular-nums font-semibold rounded-xl border border-slate-200 bg-slate-100 text-slate-500 cursor-not-allowed outline-hidden select-none"
                        />
                      )}
                    </div>
                  </div>

                  {portionErrors[index]?.quantity && (
                    <p className="text-xs font-semibold text-rose-600 mt-1" id={`portion-qty-error-${index}`}>
                      {portionErrors[index].quantity}
                    </p>
                  )}
                </div>

                {isContractorSource ? (
                  <div className="space-y-2 pt-2 border-t border-slate-100">
                    <div className="flex items-center justify-between">
                      <label className="block text-xs font-semibold text-foreground">
                        Contractor Dispatch Tests ({manualLabTests.length} Tests)
                      </label>
                      <span className="text-[10px] font-semibold text-slate-500">
                        Default: NOT_PERFORMED (Contract Vehicle)
                      </span>
                    </div>

                    <div className="max-h-[380px] overflow-y-auto pr-1.5 scrollbar-thin scrollbar-thumb-slate-300 hover:scrollbar-thumb-slate-400 p-2 bg-slate-50/70 rounded-xl border border-slate-200">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 min-w-0">
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
                              className={`p-2.5 rounded-lg border space-y-1.5 min-w-0 transition ${
                                testError
                                  ? 'border-rose-500 bg-rose-50/30 ring-1 ring-rose-400'
                                  : isPerformed
                                  ? 'border-border-strong bg-muted'
                                  : 'border-slate-300 bg-slate-100/70'
                              }`}
                            >
                              <div className="flex items-center justify-between text-xs font-semibold gap-1.5 min-w-0">
                                <span className="text-foreground font-semibold truncate" title={test.testName}>
                                  {test.testName}
                                </span>
                                {test.unit && (
                                  <span className="text-[10px] tabular-nums text-slate-500 shrink-0 font-medium">({test.unit})</span>
                                )}
                              </div>

                              <div className="grid grid-cols-2 gap-1 w-full p-0.5 bg-slate-200/80 rounded-md">
                                <button
                                  type="button"
                                  onClick={() => onPerformanceStatusChange(index, test.testId, 'PERFORMED')}
                                  className={`h-6.5 px-1.5 rounded text-[10px] sm:text-[11px] font-bold transition whitespace-nowrap flex items-center justify-center ${
                                    isPerformed
                                      ? 'bg-primary text-white shadow-xs'
                                      : 'text-slate-700 hover:bg-slate-300/80'
                                  }`}
                                >
                                  PERFORMED
                                </button>
                                <button
                                  type="button"
                                  onClick={() => onPerformanceStatusChange(index, test.testId, 'NOT_PERFORMED')}
                                  className={`h-6.5 px-1.5 rounded text-[10px] sm:text-[11px] font-bold transition whitespace-nowrap flex items-center justify-center ${
                                    !isPerformed
                                      ? 'bg-rose-700 text-white shadow-xs'
                                      : 'text-slate-700 hover:bg-slate-300/80'
                                  }`}
                                >
                                  NOT PERFORMED
                                </button>
                              </div>

                              {isPerformed ? (
                                <div className="space-y-1 min-w-0">
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
                                      className={`w-full min-w-0 h-8 px-2.5 text-xs tabular-nums font-semibold rounded-md border bg-white text-foreground focus:ring-2 focus:ring-primary outline-hidden transition ${
                                        testError ? 'border-rose-500' : 'border-border-strong'
                                      }`}
                                    />
                                  ) : Array.isArray(test.resultOptions) && test.resultOptions.length > 0 ? (
                                    <QualitativeResultRadioGroup
                                      name={`dispatch-contractor-${portion.clientId}-${test.id}`}
                                      value={resultState.textValue || null}
                                      options={test.resultOptions}
                                      compact={true}
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
                                      className={`w-full min-w-0 h-8 px-2.5 text-xs tabular-nums font-semibold rounded-md border bg-white text-foreground focus:ring-2 focus:ring-primary outline-hidden transition ${
                                        testError ? 'border-rose-500' : 'border-border-strong'
                                      }`}
                                    />
                                  )}
                                </div>
                              ) : (
                                <div className="space-y-1 min-w-0">
                                  <input
                                    id={`test-reason-field-${index}-${test.id}`}
                                    type="text"
                                    value={resultState.notPerformedReason}
                                    onChange={(e) =>
                                      onTestResultChange(index, test.testId, 'notPerformedReason', e.target.value)
                                    }
                                    placeholder="Reason (e.g. Contract Vehicle)"
                                    className={`w-full min-w-0 h-8 px-2.5 text-xs tabular-nums font-semibold rounded-md border bg-rose-50/40 text-rose-900 border-rose-300 focus:ring-2 focus:ring-rose-500 outline-hidden transition ${
                                      testError ? 'border-rose-500' : ''
                                    }`}
                                  />
                                </div>
                              )}

                              {testError && (
                                <p className="text-[10.5px] font-semibold text-rose-600 mt-0.5 break-words" id={`test-error-${index}-${test.id}`}>
                                  {testError}
                                </p>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2 pt-2 border-t border-slate-100">
                    <div className="flex items-center justify-between pb-1">
                      <label className="block text-xs font-semibold text-foreground">
                        Lab Tests ({manualLabTests.length} Manual Observations)
                      </label>
                      <span className="text-[10px] font-semibold text-slate-500">
                        ZMCC Strict Mode Testing
                      </span>
                    </div>

                    {isLoadingTests ? (
                      <p className="text-xs text-slate-500">Loading lab tests…</p>
                    ) : (
                      <div className="max-h-[380px] overflow-y-auto pr-1.5 scrollbar-thin scrollbar-thumb-slate-300 hover:scrollbar-thumb-slate-400 p-2 bg-slate-50/70 rounded-xl border border-slate-200">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 min-w-0">
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
                                key={`test-input-${portion.clientId}-${test.id}`}
                                className={`p-2.5 rounded-lg bg-muted border space-y-1.5 min-w-0 transition ${
                                  testError ? 'border-rose-500 bg-rose-50/20' : 'border-border-strong'
                                }`}
                              >
                                <div className="flex items-center justify-between text-xs font-semibold gap-1.5 min-w-0">
                                  <span className="truncate" title={test.testName}>
                                    {test.testName} {test.isRequired && <span className="text-rose-600 font-semibold">*</span>}
                                  </span>
                                  {test.unit && (
                                    <span className="text-[10px] tabular-nums text-slate-500 shrink-0 font-medium">({test.unit})</span>
                                  )}
                                </div>

                                {test.resultType === 'NUMERIC' ? (
                                  <div className="space-y-1.5 min-w-0">
                                    <div className="grid grid-cols-2 gap-1 w-full p-0.5 bg-slate-200/80 rounded-md">
                                      <button
                                        type="button"
                                        onClick={() => onPerformanceStatusChange(index, test.testId, 'PERFORMED')}
                                        className={`h-6.5 px-1.5 rounded text-[10px] sm:text-[11px] font-bold transition whitespace-nowrap flex items-center justify-center ${
                                          resultState.performanceStatus === 'PERFORMED'
                                            ? 'bg-primary text-white shadow-xs'
                                            : 'text-slate-700 hover:bg-slate-300/80'
                                        }`}
                                      >
                                        PERFORMED
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => onPerformanceStatusChange(index, test.testId, 'NOT_PERFORMED')}
                                        className={`h-6.5 px-1.5 rounded text-[10px] sm:text-[11px] font-bold transition whitespace-nowrap flex items-center justify-center ${
                                          resultState.performanceStatus === 'NOT_PERFORMED'
                                            ? 'bg-rose-700 text-white shadow-xs'
                                            : 'text-slate-700 hover:bg-slate-300/80'
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
                                        className={`w-full min-w-0 h-8 px-2.5 text-xs tabular-nums font-semibold rounded-md border bg-white text-foreground outline-hidden transition ${
                                          testError ? 'border-rose-500 focus:ring-2 focus:ring-rose-500' : 'border-border-strong focus:ring-2 focus:ring-primary'
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
                                        className={`w-full min-w-0 h-8 px-2.5 text-xs tabular-nums font-semibold rounded-md border bg-rose-50 text-rose-900 border-rose-300 outline-hidden transition ${
                                          testError ? 'border-rose-500 focus:ring-2 focus:ring-rose-500' : ''
                                        }`}
                                      />
                                    )}
                                  </div>
                                ) : Array.isArray(test.resultOptions) && test.resultOptions.length > 0 ? (
                                  <div className="space-y-1.5 min-w-0">
                                    <div className="grid grid-cols-2 gap-1 w-full p-0.5 bg-slate-200/80 rounded-md">
                                      <button
                                        type="button"
                                        onClick={() => onPerformanceStatusChange(index, test.testId, 'PERFORMED')}
                                        className={`h-6.5 px-1.5 rounded text-[10px] sm:text-[11px] font-bold transition whitespace-nowrap flex items-center justify-center ${
                                          resultState.performanceStatus === 'PERFORMED'
                                            ? 'bg-primary text-white shadow-xs'
                                            : 'text-slate-700 hover:bg-slate-300/80'
                                        }`}
                                      >
                                        PERFORMED
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => onPerformanceStatusChange(index, test.testId, 'NOT_PERFORMED')}
                                        className={`h-6.5 px-1.5 rounded text-[10px] sm:text-[11px] font-bold transition whitespace-nowrap flex items-center justify-center ${
                                          resultState.performanceStatus === 'NOT_PERFORMED'
                                            ? 'bg-rose-700 text-white shadow-xs'
                                            : 'text-slate-700 hover:bg-slate-300/80'
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
                                        compact={true}
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
                                        className={`w-full min-w-0 h-8 px-2.5 text-xs tabular-nums font-semibold rounded-md border bg-rose-50 text-rose-900 border-rose-300 outline-hidden transition ${
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
                                    className={`w-full min-w-0 h-8 px-2.5 text-xs tabular-nums font-semibold rounded-md border bg-white text-foreground outline-hidden transition ${
                                      testError ? 'border-rose-500 focus:ring-2 focus:ring-rose-500' : 'border-border-strong focus:ring-2 focus:ring-primary'
                                    }`}
                                  />
                                )}

                                {testError && (
                                  <p className="text-[10.5px] font-semibold text-rose-600 mt-0.5 break-words" id={`test-error-${index}-${test.id}`}>
                                    {testError}
                                  </p>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                <div className="flex items-center space-x-2 text-xs font-medium text-slate-600 bg-subtle p-2.5 rounded-xl border border-border">
                  <Calculator className="w-4 h-4 text-primary shrink-0" />
                  <span>Canonical milk values update live in the summary panel.</span>
                </div>

                <div className="flex items-center justify-end space-x-2.5 pt-3 border-t">
                  {portions.length > 1 && (
                    <button
                      type="button"
                      onClick={() => onRemovePortion(index)}
                      className="h-11 px-4 rounded-xl border border-rose-200 bg-rose-50 text-rose-700 text-xs font-semibold hover:bg-rose-100 transition"
                    >
                      Remove
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => onSavePortion(index)}
                    className="h-11 px-5 rounded-xl bg-emerald-700 text-white text-xs font-semibold shadow-xs hover:bg-emerald-800 transition"
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
    </div>
  );
};
