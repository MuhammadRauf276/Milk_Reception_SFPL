'use client';

import React from 'react';
import { PlusCircle, Check, Calculator, Edit3, Trash2, X, Hash } from 'lucide-react';
import type { LiveCameraResult } from '@/types/captured-photo';
import { DispatchPolicyTests, type DispatchPhotoState } from './DispatchPolicyTests';
import type { DispatchPolicyTest, DispatchTestMode } from '../dispatchDecisionPreview';
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
  /** Seal number of this portion: required, unique in the dispatch. */
  sealNumber: string;
  /** labTestId -> value typed for that policy test. */
  results: Record<string, TestResultState>;
  /** labTestId -> picture taken with the live camera (kept until it is uploaded). */
  photos: Record<string, DispatchPhotoState>;
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
  onTestResultChange: (
    index: number,
    testId: string,
    field: 'numericValue' | 'textValue',
    value: string
  ) => void;
  portionAllowedMeasurements: AllowedMeasurementConfig[];
  portionAllowedUnits: QuantityUnitType[];
  portionErrors: Record<number, { quantity?: string; seal?: string; tests?: Record<string, string> }>;
  testMode: DispatchTestMode;
  sourceType?: string;
  policyTests: DispatchPolicyTest[];
  onSealChange: (index: number, value: string) => void;
  onPhotoTaken: (index: number, test: DispatchPolicyTest, result: LiveCameraResult) => void;
  onPhotoRemoved: (index: number, labTestId: string) => void;
  stamp: { employeeCode: string; roleLabel: string; actingAsLabel?: string | null; pointLabel: string; vehicleNo?: string | null };
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

/** Same seal number on another portion of this dispatch (case and spaces ignored). */
export function getDuplicateSealMessage(portions: PortionFormState[], index: number): string | null {
  const mine = portions[index]?.sealNumber.trim().toUpperCase();
  if (!mine) return null;
  const other = portions.findIndex((p, i) => i !== index && p.sealNumber.trim().toUpperCase() === mine);
  return other >= 0 ? `Seal number is already used on Portion ${portions[other].portionNumber}. Use a different one.` : null;
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
  onTestResultChange,
  portionAllowedMeasurements,
  portionAllowedUnits,
  portionErrors,
  testMode,
  sourceType,
  policyTests,
  onSealChange,
  onPhotoTaken,
  onPhotoRemoved,
  stamp,
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

        {editingPortionIndex === null && testMode === 'PORTION_WISE' && (
          <button
            type="button"
            onClick={onAddPortionClick}
            className="flex items-center space-x-1.5 min-h-[48px] px-4 rounded-xl bg-primary-hover text-white text-sm font-semibold shadow-xs hover:bg-blue-800 transition"
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
                        Seal: <span className="tabular-nums font-semibold">{portion.sealNumber || '—'}</span> · {progress.label}
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
            const sealError = portionErrors[index]?.seal || getDuplicateSealMessage(portions, index);
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

                <div className="space-y-1">
                  <label htmlFor={`portion-seal-input-${index}`} className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                    <Hash className="w-4 h-4" aria-hidden="true" />
                    Seal number <span className="text-red-700">*</span>
                  </label>
                  <input
                    id={`portion-seal-input-${index}`}
                    type="text"
                    value={portion.sealNumber}
                    onChange={(e) => onSealChange(index, e.target.value)}
                    placeholder="Write the seal number"
                    autoComplete="off"
                    className={`w-full min-h-[48px] px-3.5 text-base font-semibold rounded-xl border bg-card text-foreground focus:ring-2 focus:ring-primary-hover outline-hidden transition ${
                      sealError ? 'border-rose-500 bg-rose-50/20 ring-1 ring-rose-500' : 'border-border-strong'
                    }`}
                  />
                  {sealError && <p className="text-xs font-semibold text-rose-700">{sealError}</p>}
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

                <div className="space-y-2 pt-2 border-t border-slate-100">
                  <div className="flex items-center justify-between pb-1">
                    <label className="block text-sm font-semibold text-foreground">
                      Tests ({policyTests.length})
                    </label>
                    <span className="text-xs font-semibold text-slate-500">
                      {sourceType === 'CONTRACTOR' ? 'Contractor dispatch' : 'ZMCC dispatch'}
                    </span>
                  </div>
                  {isLoadingTests ? (
                    <p className="text-sm text-slate-500">Loading tests…</p>
                  ) : (
                    <DispatchPolicyTests
                      tests={policyTests}
                      values={portion.results}
                      photos={portion.photos}
                      errors={portionErrors[index]?.tests}
                      onValueChange={(testId, field, value) => onTestResultChange(index, testId, field, value)}
                      onPhotoTaken={(test, res) => onPhotoTaken(index, test, res)}
                      onPhotoRemoved={(testId) => onPhotoRemoved(index, testId)}
                      stamp={stamp}
                      idPrefix={`test-input-field-${index}`}
                    />
                  )}
                </div>

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
                    className="min-h-[56px] px-6 rounded-xl bg-emerald-700 text-white text-base font-semibold shadow-xs hover:bg-emerald-800 transition"
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
