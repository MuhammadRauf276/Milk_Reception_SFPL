'use client';

import React, { useState } from 'react';
import { Calculator, ChevronDown, ChevronUp } from 'lucide-react';
import {
  QuantityUnit,
  MeasurementBasis,
} from '@/backend/modules/dispatch/quantity-policy/types';
import { DispatchSafeSummaryTotals } from '@/backend/modules/dispatch/quantity/dispatchQuantityService';

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

export interface CalculatedPortionValues {
  density: number | null;
  grossLiters: number | null;
  at13TsLiters: number | null;
  snf: number | null;
  ts: number | null;
  ratio: number | null;
}

export interface PortionSummaryDTO {
  complete: boolean;
  totalValue: number | null;
  formattedTotal: string | null;
  unit: QuantityUnit | null;
  basis: MeasurementBasis | null;
  label: string | null;
}

export interface VehiclePortionComparisonDTO {
  isDifferentUnits: boolean;
  eligibleForDifference: boolean;
  difference: number | null;
  formattedDifference: string | null;
  message: string | null;
}

export interface DispatchSummaryPanelProps {
  isCollapsible?: boolean;
  portions: PortionFormState[];
  vehicleQuantity: QuantityState;
  portionSummary: PortionSummaryDTO;
  isEligibleForAssistance: boolean;
  vehiclePortionComparison: VehiclePortionComparisonDTO;
  onApplyAssistedQuantity: (totalValue: string) => void;
  safeTotals: DispatchSafeSummaryTotals;
  calculatedPortionsList: CalculatedPortionValues[];
  labTests: LabTestDef[];
}

export const DispatchSummaryPanel: React.FC<DispatchSummaryPanelProps> = ({
  isCollapsible = false,
  portions,
  vehicleQuantity,
  portionSummary,
  isEligibleForAssistance,
  vehiclePortionComparison,
  onApplyAssistedQuantity,
  safeTotals,
  calculatedPortionsList,
  labTests,
}) => {
  const [isMobileExpanded, setIsMobileExpanded] = useState(false);

  return (
    <div className="space-y-4">
      {/* Mobile Accordion Toggle Header when isCollapsible is true */}
      {isCollapsible && (
        <div className="block lg:hidden">
          <button
            type="button"
            id="btn-summary-accordion-toggle"
            aria-expanded={isMobileExpanded}
            onClick={() => setIsMobileExpanded((prev) => !prev)}
            className="w-full flex items-center justify-between p-4 rounded-2xl bg-white border border-[#C4B9A3] shadow-sm text-left transition hover:bg-slate-50"
          >
            <div className="flex items-center space-x-2.5">
              <div className="p-2 rounded-xl bg-[#1E40AF] text-white">
                <Calculator className="w-4 h-4" />
              </div>
              <div>
                <span className="font-extrabold text-xs text-[#111311] uppercase tracking-wider block">
                  Dispatch Summary
                </span>
                <span className="text-[11px] font-mono font-bold text-[#1E40AF]">
                  {safeTotals.formattedTotalGrossLiters ? `${safeTotals.formattedTotalGrossLiters} • Est. Gross` : 'Calculations active'}
                </span>
              </div>
            </div>

            <div className="flex items-center space-x-1.5 text-xs font-bold text-[#1E40AF]">
              <span>{isMobileExpanded ? 'Hide Details' : 'View Details'}</span>
              {isMobileExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </div>
          </button>
        </div>
      )}

      {/* Summary Content Body (Always visible on Desktop, collapsible on Mobile when isCollapsible is true) */}
      <div className={`space-y-4 ${isCollapsible ? (isMobileExpanded ? 'block' : 'hidden lg:block') : 'block'}`}>
        {/* 1. Whole-Vehicle vs Portions Reconciliation Card */}
        <div className="p-4 sm:p-5 rounded-2xl bg-white border border-[#C4B9A3] shadow-sm space-y-3.5">
          <div className="flex items-center justify-between border-b border-slate-100 pb-2">
            <div className="flex items-center space-x-1.5 text-xs font-black uppercase tracking-wider text-[#111311]">
              <Calculator className="w-4 h-4 text-[#1E40AF]" />
              <span>Vehicle vs Portions</span>
            </div>
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-[#F4EFE3] text-slate-700 border border-[#C4B9A3]">
              {portions.length} Portion{portions.length > 1 ? 's' : ''}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2.5 text-xs font-mono font-bold">
            <div className="p-3 rounded-xl bg-[#F4EFE3]/60 border border-[#C4B9A3]">
              <span className="text-[9.5px] font-sans text-slate-500 block uppercase">Vehicle Qty</span>
              <span className="text-slate-900 text-sm font-black block">
                {vehicleQuantity.value ? `${Number(vehicleQuantity.value).toLocaleString()} ${vehicleQuantity.unit}` : '—'}
              </span>
              <span className="text-[9.5px] font-sans text-slate-500 block font-medium mt-0.5">
                {vehicleQuantity.basis}
              </span>
            </div>

            <div className="p-3 rounded-xl bg-[#F4EFE3]/60 border border-[#C4B9A3]">
              <span className="text-[9.5px] font-sans text-slate-500 block uppercase">
                {portionSummary.label || 'Portion Total'}
              </span>
              <span className="text-slate-900 text-sm font-black block">
                {portionSummary.complete && portionSummary.formattedTotal
                  ? portionSummary.formattedTotal
                  : '— (incomplete)'}
              </span>
              <span className="text-[9.5px] font-sans text-slate-500 block font-medium mt-0.5">
                {portionSummary.basis || '—'}
              </span>
            </div>
          </div>

          {/* Difference / Comparison Strip with Assistance button */}
          <div className="p-3 rounded-xl bg-[#F4EFE3]/80 border border-[#C4B9A3] text-xs font-bold space-y-2">
            <div className="flex items-center justify-between text-[10px] font-sans uppercase tracking-wider text-slate-500">
              <span>Reconciliation</span>
              {isEligibleForAssistance && portionSummary.totalValue !== null && (
                <button
                  type="button"
                  id="btn-use-measured-portion-total"
                  onClick={() => {
                    onApplyAssistedQuantity(portionSummary.totalValue!.toString());
                  }}
                  className="h-7 px-2.5 rounded-lg bg-[#1E40AF] text-white text-[11px] font-bold shadow-sm hover:bg-blue-800 transition flex items-center space-x-1"
                >
                  <span>Use Portion Total</span>
                </button>
              )}
            </div>

            <div className="font-mono text-xs">
              {vehiclePortionComparison.isDifferentUnits ? (
                <span className="text-amber-700 font-sans text-[11px] font-semibold">
                  {vehiclePortionComparison.message}
                </span>
              ) : vehiclePortionComparison.eligibleForDifference && vehiclePortionComparison.formattedDifference !== null ? (
                <div className="flex items-center justify-between">
                  <span className="text-slate-600 font-sans text-xs">Difference:</span>
                  <span
                    className={
                      vehiclePortionComparison.difference === 0
                        ? 'text-emerald-700 font-bold'
                        : vehiclePortionComparison.difference! > 0
                        ? 'text-blue-700 font-bold'
                        : 'text-amber-700 font-bold'
                    }
                  >
                    {vehiclePortionComparison.formattedDifference}
                  </span>
                </div>
              ) : (
                <span className="text-slate-400 font-sans text-[11px]">
                  Enter vehicle & portion quantities to view difference
                </span>
              )}
            </div>
          </div>

          {/* Safe Calculated Totals (Gross Liters & Liters @ 13% TS) */}
          <div className="grid grid-cols-2 gap-2.5 text-xs font-mono font-bold pt-1 border-t border-slate-100">
            <div className="p-3 rounded-xl bg-emerald-50/60 border border-emerald-300/80">
              <span className="text-[10px] font-sans text-emerald-950 font-extrabold block uppercase">Gross Liters</span>
              <span className="text-emerald-900 text-sm font-black">
                {safeTotals.formattedTotalGrossLiters || '—'}
              </span>
            </div>

            <div className="p-3 rounded-xl bg-emerald-50/60 border border-emerald-300/80">
              <span className="text-[10px] font-sans text-emerald-950 font-extrabold block uppercase">Liters @ 13% TS</span>
              <span className="text-emerald-900 text-sm font-black">
                {safeTotals.formattedTotalLitersAt13TS || '—'}
              </span>
            </div>
          </div>
        </div>

        {/* 2. Dynamic Portion Summaries */}
        <div className="space-y-3">
          {portions.map((p, idx) => {
            const calc = calculatedPortionsList[idx];
            const lrTest = labTests.find(
              (t) => t.testName.toLowerCase().includes('lactometer') || t.testName.toLowerCase().includes('lr')
            );
            const fatTest = labTests.find(
              (t) =>
                t.testName.toLowerCase().includes('fat') &&
                !t.testName.toLowerCase().includes('ratio') &&
                !t.testName.toLowerCase().includes('snf')
            );
            const lrRes = lrTest ? p.results[lrTest.testId] : null;
            const fatRes = fatTest ? p.results[fatTest.testId] : null;
            const lrDisplay =
              lrRes && lrRes.performanceStatus === 'PERFORMED' && lrRes.numericValue !== ''
                ? `${lrRes.numericValue}`
                : '—';
            const fatDisplay =
              fatRes && fatRes.performanceStatus === 'PERFORMED' && fatRes.numericValue !== ''
                ? `${fatRes.numericValue}%`
                : '—';

            return (
              <div
                key={`portion-summary-card-${idx}`}
                className="p-4 rounded-2xl bg-white border border-[#C4B9A3] shadow-sm space-y-3"
              >
                <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                  <span className="text-xs font-black text-[#111311] uppercase tracking-wider">
                    Portion {idx + 1}
                  </span>
                  <span className="text-[10px] font-mono font-bold px-2.5 py-0.5 rounded-lg bg-[#F4EFE3] text-slate-700 border border-[#C4B9A3]">
                    {p.quantity.value ? `${Number(p.quantity.value).toLocaleString()} ${p.quantity.unit}` : '—'} ({p.quantity.basis})
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs font-mono font-bold">
                  <div className="p-2 rounded-xl bg-[#F4EFE3]/60 border border-[#C4B9A3]">
                    <span className="text-[9.5px] font-sans text-slate-500 block">LR / Fat</span>
                    <span className="text-[#111311]">
                      {lrDisplay} / {fatDisplay}
                    </span>
                  </div>
                  <div className="p-2 rounded-xl bg-[#F4EFE3]/60 border border-[#C4B9A3]">
                    <span className="text-[9.5px] font-sans text-slate-500 block">Density</span>
                    <span className="text-[#111311]">{calc?.density !== null && calc?.density !== undefined ? `${calc.density.toFixed(4)} g/mL` : '—'}</span>
                  </div>
                  <div className="p-2 rounded-xl bg-[#F4EFE3]/60 border border-[#C4B9A3]">
                    <span className="text-[9.5px] font-sans text-slate-500 block">Gross Liters</span>
                    <span className="text-emerald-900 font-black">
                      {calc?.grossLiters !== null && calc?.grossLiters !== undefined ? `${Math.round(calc.grossLiters).toLocaleString()} L` : '—'}
                    </span>
                  </div>
                  <div className="p-2 rounded-xl bg-[#F4EFE3]/60 border border-[#C4B9A3]">
                    <span className="text-[9.5px] font-sans text-slate-500 block">Liters @ 13% TS</span>
                    <span className="text-emerald-900 font-black">
                      {calc?.at13TsLiters !== null && calc?.at13TsLiters !== undefined ? `${Math.round(calc.at13TsLiters).toLocaleString()} L` : '—'}
                    </span>
                  </div>
                  <div className="p-2 rounded-xl bg-[#F4EFE3]/60 border border-[#C4B9A3]">
                    <span className="text-[9.5px] font-sans text-slate-500 block">SNF %</span>
                    <span className="text-blue-900">{calc?.snf !== null && calc?.snf !== undefined ? `${calc.snf.toFixed(3)} %` : '—'}</span>
                  </div>
                  <div className="p-2 rounded-xl bg-[#F4EFE3]/60 border border-[#C4B9A3]">
                    <span className="text-[9.5px] font-sans text-slate-500 block">Total Solids (TS %)</span>
                    <span className="text-blue-900">{calc?.ts !== null && calc?.ts !== undefined ? `${calc.ts.toFixed(3)} %` : '—'}</span>
                  </div>
                  <div className="p-2 rounded-xl bg-[#F4EFE3]/60 border border-[#C4B9A3] col-span-2">
                    <span className="text-[9.5px] font-sans text-slate-500 block">SNF : Fat</span>
                    <span className="text-blue-900">{calc?.ratio !== null && calc?.ratio !== undefined ? calc.ratio.toFixed(3) : '—'}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
