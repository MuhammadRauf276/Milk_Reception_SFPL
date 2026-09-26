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
  vehiclePortionComparison: VehiclePortionComparisonDTO;
  safeTotals: DispatchSafeSummaryTotals;
  calculatedPortionsList: CalculatedPortionValues[];
  labTests: LabTestDef[];
}

export const DispatchSummaryPanel: React.FC<DispatchSummaryPanelProps> = ({
  isCollapsible = false,
  portions,
  vehicleQuantity,
  portionSummary,
  safeTotals,
  calculatedPortionsList,
  labTests,
}) => {
  const [isMobileExpanded, setIsMobileExpanded] = useState(false);

  // Compute composite LR and Fat from portions
  const lrTest = labTests.find(
    (t) => t.testName.toLowerCase().includes('lactometer') || t.testName.toLowerCase().includes('lr')
  );
  const fatTest = labTests.find(
    (t) =>
      t.testName.toLowerCase().includes('fat') &&
      !t.testName.toLowerCase().includes('ratio') &&
      !t.testName.toLowerCase().includes('snf')
  );

  let totalQty = 0;
  let weightedLrSum = 0;
  let weightedFatSum = 0;
  let simpleLrSum = 0;
  let simpleFatSum = 0;
  let validLrCount = 0;
  let validFatCount = 0;

  portions.forEach((p) => {
    const qty = parseFloat(p.quantity.value) || 0;
    const lrRes = lrTest ? p.results[lrTest.testId] : null;
    const fatRes = fatTest ? p.results[fatTest.testId] : null;

    const lrVal = lrRes && lrRes.performanceStatus === 'PERFORMED' && lrRes.numericValue !== ''
      ? parseFloat(lrRes.numericValue)
      : null;
    const fatVal = fatRes && fatRes.performanceStatus === 'PERFORMED' && fatRes.numericValue !== ''
      ? parseFloat(fatRes.numericValue)
      : null;

    if (lrVal !== null && !isNaN(lrVal)) {
      simpleLrSum += lrVal;
      validLrCount++;
      if (qty > 0) {
        weightedLrSum += qty * lrVal;
      }
    }

    if (fatVal !== null && !isNaN(fatVal)) {
      simpleFatSum += fatVal;
      validFatCount++;
      if (qty > 0) {
        weightedFatSum += qty * fatVal;
      }
    }

    if (qty > 0) {
      totalQty += qty;
    }
  });

  const avgLr = totalQty > 0 && weightedLrSum > 0
    ? (weightedLrSum / totalQty).toFixed(2)
    : validLrCount > 0
    ? (simpleLrSum / validLrCount).toFixed(2)
    : null;

  const avgFat = totalQty > 0 && weightedFatSum > 0
    ? (weightedFatSum / totalQty).toFixed(2)
    : validFatCount > 0
    ? (simpleFatSum / validFatCount).toFixed(2)
    : null;

  return (
    <div className="space-y-4">
      {/* Mobile Accordion Toggle Header */}
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
                <span className="text-xs font-mono font-bold text-[#1E40AF]">
                  {safeTotals.formattedTotalGrossLiters ? `${safeTotals.formattedTotalGrossLiters} • Gross` : 'Calculations active'}
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

      {/* Summary Content Body */}
      <div className={`space-y-4 ${isCollapsible ? (isMobileExpanded ? 'block' : 'hidden lg:block') : 'block'}`}>
        {/* Single Unified Dispatch Summary Card */}
        <div className="p-4 sm:p-5 rounded-2xl bg-white border border-[#C4B9A3] shadow-sm space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
            <div className="flex items-center space-x-2">
              <Calculator className="w-4 h-4 text-[#1E40AF]" />
              <h3 className="text-xs font-black uppercase tracking-wider text-[#111311]">
                Dispatch Summary
              </h3>
            </div>
            <span className="px-2.5 py-0.5 rounded-lg text-xs font-mono font-bold bg-[#F4EFE3] text-slate-700 border border-[#C4B9A3]">
              {portions.length} Portion{portions.length > 1 ? 's' : ''}
            </span>
          </div>

          {/* Measured Vehicle Quantity & Average Quality */}
          <div className="grid grid-cols-2 gap-2.5 text-xs font-mono font-bold">
            <div className="p-3 rounded-xl bg-[#F4EFE3]/70 border border-[#C4B9A3]">
              <span className="text-xs font-sans text-slate-500 block font-bold">Vehicle Issue</span>
              <span className="text-slate-900 text-sm font-black block mt-0.5">
                {vehicleQuantity.value ? `${Number(vehicleQuantity.value).toLocaleString()} ${vehicleQuantity.unit}` : '—'}
              </span>
              <span className="text-xs font-sans text-emerald-700 block font-semibold mt-0.5">
                {vehicleQuantity.basis || 'MEASURED'}
              </span>
            </div>

            <div className="p-3 rounded-xl bg-[#F4EFE3]/70 border border-[#C4B9A3]">
              <span className="text-xs font-sans text-slate-500 block font-bold">Portions Total</span>
              <span className="text-slate-900 text-sm font-black block mt-0.5">
                {portionSummary.complete && portionSummary.formattedTotal
                  ? portionSummary.formattedTotal
                  : '—'}
              </span>
              <span className="text-xs font-sans text-slate-500 block font-medium mt-0.5">
                {portions.length > 0 ? `${portions.length} sub-lots` : '—'}
              </span>
            </div>
          </div>

          {/* Average Quality: LR & Fat */}
          <div className="grid grid-cols-2 gap-2.5 text-xs font-mono font-bold">
            <div className="p-3 rounded-xl bg-blue-50/70 border border-blue-200">
              <span className="text-xs font-sans text-blue-900 font-bold block">Average LR</span>
              <span className="text-blue-950 text-sm font-black block mt-0.5">
                {avgLr ? avgLr : '—'}
              </span>
            </div>

            <div className="p-3 rounded-xl bg-amber-50/70 border border-amber-200">
              <span className="text-xs font-sans text-amber-900 font-bold block">Average Fat</span>
              <span className="text-amber-950 text-sm font-black block mt-0.5">
                {avgFat ? `${avgFat}%` : '—'}
              </span>
            </div>
          </div>

          {/* Safe Calculated Totals (Gross Liters & Liters @ 13% TS) */}
          <div className="grid grid-cols-2 gap-2.5 text-xs font-mono font-bold pt-2 border-t border-slate-100">
            <div className="p-3 rounded-xl bg-emerald-50/70 border border-emerald-300">
              <span className="text-xs font-sans text-emerald-950 font-black block uppercase">Gross Liters</span>
              <span className="text-emerald-900 text-sm font-black block mt-0.5">
                {safeTotals.formattedTotalGrossLiters || '—'}
              </span>
            </div>

            <div className="p-3 rounded-xl bg-emerald-50/70 border border-emerald-300">
              <span className="text-xs font-sans text-emerald-950 font-black block uppercase">Liters @ 13% TS</span>
              <span className="text-emerald-900 text-sm font-black block mt-0.5">
                {safeTotals.formattedTotalLitersAt13TS || '—'}
              </span>
            </div>
          </div>
        </div>

        {/* Compact Portion Breakdown List */}
        <div className="p-4 sm:p-5 rounded-2xl bg-white border border-[#C4B9A3] shadow-sm space-y-3">
          <h4 className="text-xs font-black uppercase tracking-wider text-[#111311]">
            Portion Details
          </h4>

          <div className="space-y-2">
            {portions.map((p, idx) => {
              const calc = calculatedPortionsList[idx];
              const pLrRes = lrTest ? p.results[lrTest.testId] : null;
              const pFatRes = fatTest ? p.results[fatTest.testId] : null;

              const pLr = pLrRes && pLrRes.performanceStatus === 'PERFORMED' && pLrRes.numericValue !== ''
                ? pLrRes.numericValue
                : '—';
              const pFat = pFatRes && pFatRes.performanceStatus === 'PERFORMED' && pFatRes.numericValue !== ''
                ? `${pFatRes.numericValue}%`
                : '—';

              return (
                <div
                  key={`portion-breakdown-${idx}`}
                  className="p-3 rounded-xl bg-[#F4EFE3]/50 border border-[#C4B9A3] space-y-1.5"
                >
                  <div className="flex items-center justify-between text-xs font-mono font-bold">
                    <span className="font-sans font-black text-[#111311]">
                      Portion {idx + 1}
                    </span>
                    <span className="text-slate-900">
                      {p.quantity.value ? `${Number(p.quantity.value).toLocaleString()} ${p.quantity.unit}` : '—'}
                    </span>
                  </div>

                  <div className="grid grid-cols-3 gap-2 text-xs font-mono">
                    <div className="text-slate-600">
                      <span className="font-sans text-slate-400 block">LR / Fat</span>
                      <span className="font-bold text-[#111311]">{pLr} / {pFat}</span>
                    </div>
                    <div className="text-slate-600">
                      <span className="font-sans text-slate-400 block">Gross L</span>
                      <span className="font-bold text-emerald-800">
                        {calc?.grossLiters != null ? `${calc.grossLiters.toFixed(1)} L` : '—'}
                      </span>
                    </div>
                    <div className="text-slate-600">
                      <span className="font-sans text-slate-400 block">@13TS</span>
                      <span className="font-bold text-emerald-800">
                        {calc?.at13TsLiters != null ? `${calc.at13TsLiters.toFixed(1)} L` : '—'}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
