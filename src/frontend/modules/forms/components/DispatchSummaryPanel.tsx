'use client';

import React, { useState } from 'react';
import { Calculator, ChevronDown } from 'lucide-react';
import {
  QuantityUnit,
  MeasurementBasis,
} from '@/backend/modules/dispatch/quantity-policy/types';
import { DispatchSafeSummaryTotals } from '@/backend/modules/dispatch/quantity/dispatchQuantityService';
import { calculateDensity, calculateSNF } from '@/backend/utils/milkFormulas';

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

  const numAvgLr = avgLr ? parseFloat(avgLr) : NaN;
  const numAvgFat = avgFat ? parseFloat(avgFat) : NaN;
  const weightedDensity = !isNaN(numAvgLr) && numAvgLr > 0 ? calculateDensity(numAvgLr) : null;
  const weightedSnf = !isNaN(numAvgLr) && !isNaN(numAvgFat) && numAvgLr > 0 && numAvgFat >= 0
    ? calculateSNF(numAvgLr, numAvgFat)
    : null;

  return (
    <div className="space-y-4">
      {isCollapsible && (
        <div className="block lg:hidden">
          <button
            type="button"
            id="btn-summary-accordion-toggle"
            aria-expanded={isMobileExpanded}
            onClick={() => setIsMobileExpanded((prev) => !prev)}
            className="w-full flex items-center justify-between p-4 rounded-xl bg-white border border-border-strong shadow-xs text-left transition hover:bg-slate-50"
          >
            <div className="flex items-center space-x-2.5">
              <div className="p-2 rounded-xl bg-primary text-white">
                <Calculator className="w-4 h-4" />
              </div>
              <div>
                <span className="font-semibold text-xs text-foreground uppercase tracking-wider block">
                  Dispatch Summary
                </span>
                <span className="text-xs tabular-nums font-semibold text-primary">
                  {vehicleQuantity.value && Number(vehicleQuantity.value) > 0 ? `${Number(vehicleQuantity.value).toLocaleString()} KG` : 'Calculations active'}
                  {avgLr ? ` · LR ${avgLr}` : ''}
                  {avgFat ? ` · Fat ${avgFat}%` : ''}
                </span>
              </div>
            </div>

            <div className="flex items-center space-x-1.5 text-xs font-semibold text-primary">
              <span>{isMobileExpanded ? 'Hide Details' : 'View Details'}</span>
              <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${isMobileExpanded ? 'rotate-180' : ''}`} />
            </div>
          </button>
        </div>
      )}

      <div className={`space-y-4 ${isCollapsible ? (isMobileExpanded ? 'block max-lg:animate-panel-in' : 'hidden lg:block') : 'block'}`}>
        <div className="p-4 sm:p-5 rounded-xl bg-white border border-border-strong shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
            <div className="flex items-center space-x-2">
              <Calculator className="w-4 h-4 text-primary" />
              <h3 className="text-xs font-semibold text-foreground uppercase tracking-wider">
                Dispatch Summary
              </h3>
            </div>
            <span className="px-2.5 py-0.5 rounded-lg text-xs tabular-nums font-semibold bg-muted text-slate-700 border border-border-strong">
              {portions.length} Portion{portions.length > 1 ? 's' : ''}
            </span>
          </div>

          <div className="p-3.5 rounded-xl bg-slate-50 border border-border-strong space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-slate-600 uppercase text-[11px]">Dispatched Net Weight</span>
              <span className="text-[10px] font-bold text-primary bg-primary/10 border border-primary/20 px-1.5 py-0.5 rounded">
                AUTO-SUM
              </span>
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-2xl font-extrabold text-slate-900 tabular-nums">
                {vehicleQuantity.value && Number(vehicleQuantity.value) > 0
                  ? Number(vehicleQuantity.value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                  : '0.00'}
              </span>
              <span className="text-xs font-bold text-slate-500">KG (Measured)</span>
            </div>
            <span className="text-[11px] font-semibold text-emerald-700 block">
              Standard Net Weight
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2.5 text-xs tabular-nums font-semibold min-w-0">
            <div className="p-3 rounded-xl bg-slate-50 border border-border-strong space-y-0.5 min-w-0">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold text-slate-500 uppercase truncate">Weighted LR</span>
                <span className="text-[9px] font-bold text-slate-500 bg-slate-200/80 px-1 py-0.5 rounded">@20°C</span>
              </div>
              <span className="text-lg font-extrabold text-slate-900 tabular-nums block">
                {avgLr ? avgLr : '—'}
              </span>
              <span className="text-[10px] text-slate-400 font-medium block truncate">
                Density: {weightedDensity !== null ? weightedDensity.toFixed(4) : '—'}
              </span>
            </div>

            <div className="p-3 rounded-xl bg-slate-50 border border-border-strong space-y-0.5 min-w-0">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold text-slate-500 uppercase truncate">Weighted Fat</span>
                <span className="text-[9px] font-bold text-emerald-800 bg-emerald-100 px-1 py-0.5 rounded">GERBER</span>
              </div>
              <span className="text-lg font-extrabold text-slate-900 tabular-nums block">
                {avgFat ? `${avgFat}%` : '—'}
              </span>
              <span className="text-[10px] text-slate-400 font-medium block truncate">
                SNF: {weightedSnf !== null ? `${weightedSnf.toFixed(2)}%` : '—'}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2.5 text-xs tabular-nums font-semibold min-w-0">
            <div className="p-3 rounded-xl bg-slate-50 border border-border-strong space-y-0.5 min-w-0">
              <span className="text-[10px] font-bold text-slate-500 uppercase block truncate">Gross Liters</span>
              <span className="text-base font-extrabold text-slate-900 tabular-nums block truncate">
                {safeTotals.formattedTotalGrossLiters || '—'}
              </span>
            </div>

            <div className="p-3 rounded-xl bg-emerald-50/70 border border-emerald-300 space-y-0.5 min-w-0">
              <span className="text-[10px] font-bold text-emerald-950 uppercase block truncate">Liters @ 13% TS</span>
              <span className="text-base font-extrabold text-emerald-900 tabular-nums block truncate">
                {safeTotals.formattedTotalLitersAt13TS || '—'}
              </span>
            </div>
          </div>
        </div>

        <div className="p-4 sm:p-5 rounded-xl bg-white border border-border-strong shadow-xs space-y-3">
          <h4 className="text-xs font-semibold text-foreground">
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
                  className="p-3 rounded-xl bg-subtle border border-border space-y-1.5 min-w-0"
                >
                  <div className="flex items-center justify-between text-xs tabular-nums font-semibold gap-2 min-w-0">
                    <span className="font-sans font-semibold text-foreground truncate">
                      Portion {idx + 1}
                    </span>
                    <span className="text-slate-900 shrink-0">
                      {p.quantity.value ? `${Number(p.quantity.value).toLocaleString()} ${p.quantity.unit}` : '—'}
                    </span>
                  </div>

                  <div className="grid grid-cols-3 gap-2 text-xs tabular-nums min-w-0">
                    <div className="text-slate-600 min-w-0">
                      <span className="font-sans text-slate-400 block truncate">LR / Fat</span>
                      <span className="font-semibold text-foreground block truncate">{pLr} / {pFat}</span>
                    </div>
                    <div className="text-slate-600 min-w-0">
                      <span className="font-sans text-slate-400 block truncate">Gross L</span>
                      <span className="font-semibold text-emerald-800 block truncate">
                        {calc?.grossLiters != null ? `${calc.grossLiters.toFixed(1)} L` : '—'}
                      </span>
                    </div>
                    <div className="text-slate-600 min-w-0">
                      <span className="font-sans text-slate-400 block truncate">@13TS</span>
                      <span className="font-semibold text-emerald-800 block truncate">
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
