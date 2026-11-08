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

  const isSingle = portions.length === 1;
  const avgLr = totalQty > 0 && weightedLrSum > 0
    ? (weightedLrSum / totalQty).toFixed(2)
    : isSingle && validLrCount === 1
    ? (simpleLrSum).toFixed(2)
    : null;

  const avgFat = totalQty > 0 && weightedFatSum > 0
    ? (weightedFatSum / totalQty).toFixed(2)
    : isSingle && validFatCount === 1
    ? (simpleFatSum).toFixed(2)
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
            className="w-full flex items-center justify-between p-4 rounded-2xl bg-card border border-border-strong shadow-xs text-left transition hover:bg-subtle"
          >
            <div className="flex items-center space-x-2.5">
              <div className="p-2 rounded-xl bg-primary text-white">
                <Calculator className="w-4 h-4" />
              </div>
              <div>
                <span className="font-semibold text-xs text-foreground block">
                  Dispatch Summary
                </span>
                <span className="text-xs tabular-nums font-semibold text-primary">
                  {vehicleQuantity.value && Number(vehicleQuantity.value) > 0 ? `${Number(vehicleQuantity.value).toLocaleString()} KG` : 'Calculating'}
                  {avgLr ? ` · LR ${avgLr}` : ''}
                  {avgFat ? ` · Fat ${avgFat}%` : ''}
                </span>
              </div>
            </div>

            <div className="flex items-center space-x-1.5 text-xs font-semibold text-primary">
              <span>{isMobileExpanded ? 'Hide' : 'Details'}</span>
              <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${isMobileExpanded ? 'rotate-180' : ''}`} />
            </div>
          </button>
        </div>
      )}

      <div className={`space-y-4 ${isCollapsible ? (isMobileExpanded ? 'block max-lg:animate-panel-in' : 'hidden lg:block') : 'block'}`}>
        <div className="p-4 sm:p-5 rounded-2xl bg-card border border-border-strong shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-border pb-2.5">
            <div className="flex items-center space-x-2">
              <Calculator className="w-4 h-4 text-muted-foreground" />
              <h3 className="text-xs font-semibold text-foreground">
                Dispatch Summary
              </h3>
            </div>
            <span className="px-2.5 py-0.5 rounded-lg text-xs tabular-nums font-semibold bg-muted text-secondary-foreground border border-border-strong">
              {portions.length} Portion{portions.length > 1 ? 's' : ''}
            </span>
          </div>

          <div className="bg-card border-border p-3.5 rounded-2xl border-strong space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-secondary-foreground text-xs">Net weight</span>
              <span className="text-xs font-semibold text-primary bg-primary/10 border border-primary/20 px-1.5 py-0.5 rounded">
                AUTO-SUM
              </span>
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-2xl font-semibold text-foreground tabular-nums">
                {vehicleQuantity.value && Number(vehicleQuantity.value) > 0
                  ? Number(vehicleQuantity.value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                  : '0.00'}
              </span>
              <span className="text-xs font-semibold text-muted-foreground">KG</span>
            </div>
            <span className="text-xs font-semibold text-emerald-700 block">
              Net
            </span>
          </div>

          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,7rem),1fr))] gap-2.5 text-xs tabular-nums font-semibold min-w-0">
            <div className="bg-card border-border p-3 rounded-xl border-strong space-y-0.5 min-w-0">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-muted-foreground break-words min-w-0">Avg LR</span>
                <span className="text-xs font-semibold text-muted-foreground bg-muted/80 px-1 py-0.5 rounded">@20°C</span>
              </div>
              <span className="text-lg font-semibold text-foreground tabular-nums block">
                {avgLr ? avgLr : '—'}
              </span>
              <span className="text-xs text-muted-foreground font-medium block break-words min-w-0">
                Density: {weightedDensity !== null ? weightedDensity.toFixed(4) : '—'}
              </span>
            </div>

            <div className="bg-card border-border p-3 rounded-xl border-strong space-y-0.5 min-w-0">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-muted-foreground break-words min-w-0">Avg Fat</span>
                <span className="text-xs font-semibold text-emerald-800 bg-emerald-100 px-1 py-0.5 rounded">GERBER</span>
              </div>
              <span className="text-lg font-semibold text-foreground tabular-nums block">
                {avgFat ? `${avgFat}%` : '—'}
              </span>
              <span className="text-xs text-muted-foreground font-medium block break-words min-w-0">
                SNF: {weightedSnf !== null ? `${weightedSnf.toFixed(2)}%` : '—'}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,7rem),1fr))] gap-2.5 text-xs tabular-nums font-semibold min-w-0">
            <div className="bg-card border-border p-3 rounded-xl border-strong space-y-0.5 min-w-0">
              <span className="text-xs font-semibold text-muted-foreground block break-words min-w-0">Gross L</span>
              <span className="text-base font-semibold text-foreground tabular-nums block break-words min-w-0">
                {safeTotals.formattedTotalGrossLiters || '—'}
              </span>
            </div>

            <div className="bg-card border-border p-3 rounded-xl border space-y-0.5 min-w-0">
              <span className="text-xs font-semibold text-emerald-950 block break-words min-w-0">L @ 13 TS</span>
              <span className="text-base font-semibold text-emerald-900 tabular-nums block break-words min-w-0">
                {safeTotals.formattedTotalLitersAt13TS || '—'}
              </span>
            </div>
          </div>
        </div>

        <div className="p-4 sm:p-5 rounded-2xl bg-card border border-border-strong shadow-xs space-y-3">
          <h4 className="text-xs font-semibold text-foreground">
            Portions
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
                    <span className="font-sans font-semibold text-foreground break-words min-w-0">
                      Portion {idx + 1}
                    </span>
                    <span className="text-foreground shrink-0">
                      {p.quantity.value ? `${Number(p.quantity.value).toLocaleString()} ${p.quantity.unit}` : '—'}
                    </span>
                  </div>

                  <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,5rem),1fr))] gap-2 text-xs tabular-nums min-w-0">
                    <div className="text-secondary-foreground min-w-0">
                      <span className="font-sans text-muted-foreground block break-words min-w-0">LR / Fat</span>
                      <span className="font-semibold text-foreground block break-words min-w-0">{pLr} / {pFat}</span>
                    </div>
                    <div className="text-secondary-foreground min-w-0">
                      <span className="font-sans text-muted-foreground block break-words min-w-0">Gross L</span>
                      <span className="font-semibold text-emerald-800 block break-words min-w-0">
                        {calc?.grossLiters != null ? `${calc.grossLiters.toFixed(1)} L` : '—'}
                      </span>
                    </div>
                    <div className="text-secondary-foreground min-w-0">
                      <span className="font-sans text-muted-foreground block break-words min-w-0">@13TS</span>
                      <span className="font-semibold text-emerald-800 block break-words min-w-0">
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
