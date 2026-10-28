'use client';

import React, { useState, useMemo } from 'react';
import type { ReportFieldDefinition } from '../dynamicReportTypes';
import { Layers, ArrowRightLeft, Table, Hash, Percent } from 'lucide-react';

interface DynamicPivotGridProps {
  fields: ReportFieldDefinition[];
  rows: Record<string, any>[];
  initialRowDimension?: string;
  initialColDimension?: string;
  initialMetric?: string;
}

export function DynamicPivotGrid({
  fields,
  rows,
  initialRowDimension,
  initialColDimension,
  initialMetric,
}: DynamicPivotGridProps) {
  // Available dimensions (string, date, enum)
  const dimensionFields = useMemo(() => {
    return fields.filter(
      (f) =>
        f.dataType === 'string' ||
        f.dataType === 'date' ||
        f.dataType === 'enum' ||
        f.id.includes('route') ||
        f.id.includes('name') ||
        f.id.includes('mot') ||
        f.id.includes('date') ||
        f.id.includes('status') ||
        f.id.includes('decision')
    );
  }, [fields]);

  // Available numeric metrics
  const metricFields = useMemo(() => {
    return fields.filter(
      (f) =>
        f.dataType === 'number' ||
        f.id.includes('liters') ||
        f.id.includes('fat') ||
        f.id.includes('lr') ||
        f.id.includes('snf') ||
        f.id.includes('loss')
    );
  }, [fields]);

  const defaultRowDim =
    initialRowDimension ||
    dimensionFields.find((f) => f.id.includes('route') || f.id.includes('supplier'))?.id ||
    dimensionFields[0]?.id ||
    'route_name';

  const defaultColDim =
    initialColDimension ||
    dimensionFields.find((f) => f.id.includes('date') || f.id.includes('decision') || f.id.includes('status'))?.id ||
    dimensionFields[1]?.id ||
    'operational_date';

  const defaultMetric =
    initialMetric ||
    metricFields.find((f) => f.id === 'gross_liters')?.id ||
    metricFields[0]?.id ||
    'gross_liters';

  const [rowDimension, setRowDimension] = useState<string>(defaultRowDim);
  const [colDimension, setColDimension] = useState<string>(defaultColDim);
  const [selectedMetric, setSelectedMetric] = useState<string>(defaultMetric);

  const metricDef = useMemo(() => {
    return fields.find((f) => f.id === selectedMetric) || metricFields[0];
  }, [fields, selectedMetric, metricFields]);

  // Swap Row and Column Dimensions
  const handleSwapDimensions = () => {
    const temp = rowDimension;
    setRowDimension(colDimension);
    setColDimension(temp);
  };

  // Build the 2D Pivot Matrix
  const { rowKeys, colKeys, matrix, rowTotals, colTotals, grandTotal, maxCellValue } = useMemo(() => {
    const rowSet = new Set<string>();
    const colSet = new Set<string>();

    // cellMap: "rowKey:::colKey" -> { sumValue: number, sumLiters: number, count: number }
    const cellMap = new Map<string, { sumValue: number; sumWeight: number; count: number }>();
    const rowTotalMap = new Map<string, { sumValue: number; sumWeight: number; count: number }>();
    const colTotalMap = new Map<string, { sumValue: number; sumWeight: number; count: number }>();
    let grandSumValue = 0;
    let grandSumWeight = 0;
    let grandCount = 0;

    const isWeightedRatio =
      metricDef?.id.includes('fat') ||
      metricDef?.id.includes('lr') ||
      metricDef?.id.includes('snf') ||
      metricDef?.format === 'percent';

    for (const r of rows) {
      const rKey = String(r[rowDimension] || 'Unassigned');
      const cKey = String(r[colDimension] || 'Unassigned');
      const rawVal = Number(r[selectedMetric]);
      const liters = Number(r.gross_liters || r.shop_liters || 1);

      if (isNaN(rawVal)) continue;

      rowSet.add(rKey);
      colSet.add(cKey);

      const cellKey = `${rKey}:::${cKey}`;
      const cell = cellMap.get(cellKey) || { sumValue: 0, sumWeight: 0, count: 0 };
      const rowTot = rowTotalMap.get(rKey) || { sumValue: 0, sumWeight: 0, count: 0 };
      const colTot = colTotalMap.get(cKey) || { sumValue: 0, sumWeight: 0, count: 0 };

      const weight = isWeightedRatio ? (liters > 0 ? liters : 1) : 1;
      const weightedVal = isWeightedRatio ? rawVal * weight : rawVal;

      cell.sumValue += weightedVal;
      cell.sumWeight += weight;
      cell.count += 1;
      cellMap.set(cellKey, cell);

      rowTot.sumValue += weightedVal;
      rowTot.sumWeight += weight;
      rowTot.count += 1;
      rowTotalMap.set(rKey, rowTot);

      colTot.sumValue += weightedVal;
      colTot.sumWeight += weight;
      colTot.count += 1;
      colTotalMap.set(cKey, colTot);

      grandSumValue += weightedVal;
      grandSumWeight += weight;
      grandCount += 1;
    }

    const sortedRows = Array.from(rowSet).sort();
    const sortedCols = Array.from(colSet).sort();

    // Compute cell matrix
    let maxVal = 0;
    const computedMatrix: Record<string, Record<string, number | null>> = {};
    for (const rKey of sortedRows) {
      computedMatrix[rKey] = {};
      for (const cKey of sortedCols) {
        const cell = cellMap.get(`${rKey}:::${cKey}`);
        if (!cell || cell.count === 0) {
          computedMatrix[rKey][cKey] = null;
        } else {
          const finalVal = isWeightedRatio
            ? cell.sumWeight > 0
              ? cell.sumValue / cell.sumWeight
              : cell.sumValue / cell.count
            : cell.sumValue;
          const rounded = Number(finalVal.toFixed(2));
          computedMatrix[rKey][cKey] = rounded;
          if (rounded > maxVal) maxVal = rounded;
        }
      }
    }

    // Compute totals
    const finalRowTotals: Record<string, number> = {};
    for (const rKey of sortedRows) {
      const tot = rowTotalMap.get(rKey);
      if (!tot) finalRowTotals[rKey] = 0;
      else {
        finalRowTotals[rKey] = isWeightedRatio
          ? tot.sumWeight > 0
            ? Number((tot.sumValue / tot.sumWeight).toFixed(2))
            : 0
          : Number(tot.sumValue.toFixed(2));
      }
    }

    const finalColTotals: Record<string, number> = {};
    for (const cKey of sortedCols) {
      const tot = colTotalMap.get(cKey);
      if (!tot) finalColTotals[cKey] = 0;
      else {
        finalColTotals[cKey] = isWeightedRatio
          ? tot.sumWeight > 0
            ? Number((tot.sumValue / tot.sumWeight).toFixed(2))
            : 0
          : Number(tot.sumValue.toFixed(2));
      }
    }

    const finalGrandTotal = isWeightedRatio
      ? grandSumWeight > 0
        ? Number((grandSumValue / grandSumWeight).toFixed(2))
        : 0
      : Number(grandSumValue.toFixed(2));

    return {
      rowKeys: sortedRows,
      colKeys: sortedCols,
      matrix: computedMatrix,
      rowTotals: finalRowTotals,
      colTotals: finalColTotals,
      grandTotal: finalGrandTotal,
      maxCellValue: Math.max(maxVal, 1),
    };
  }, [rows, rowDimension, colDimension, selectedMetric, metricDef]);

  const formatCellValue = (val: number | null | undefined) => {
    if (val === null || val === undefined) return <span className="text-slate-300 font-mono">—</span>;
    if (metricDef?.format === 'liters') {
      return `${val.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} L`;
    }
    if (metricDef?.format === 'percent') {
      return `${val.toFixed(2)}%`;
    }
    if (metricDef?.format === 'temperature') {
      return `${val.toFixed(1)}°C`;
    }
    return val.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 2 });
  };

  return (
    <div className="bg-card border border-border rounded-xl shadow-xs overflow-hidden flex flex-col space-y-4 p-4 animate-panel-in">
      {/* Pivot Dimension Pickers */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-border">
        <div className="flex flex-wrap items-center gap-3">
          {/* Row Dimension */}
          <div className="flex items-center gap-1.5 text-xs">
            <span className="text-muted-foreground font-semibold">Rows:</span>
            <select
              value={rowDimension}
              onChange={(e) => setRowDimension(e.target.value)}
              className="bg-background border border-border rounded-lg px-2.5 py-1 text-xs font-semibold text-foreground focus:outline-hidden focus:ring-1 focus:ring-primary cursor-pointer"
            >
              {dimensionFields.map((f) => (
                <option key={`row-${f.id}`} value={f.id} disabled={f.id === colDimension}>
                  {f.label}
                </option>
              ))}
            </select>
          </div>

          {/* Swap Button */}
          <button
            type="button"
            onClick={handleSwapDimensions}
            className="p-1.5 rounded-lg border border-border bg-background hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            title="Swap rows and columns"
          >
            <ArrowRightLeft className="w-3.5 h-3.5" />
          </button>

          {/* Column Dimension */}
          <div className="flex items-center gap-1.5 text-xs">
            <span className="text-muted-foreground font-semibold">Columns:</span>
            <select
              value={colDimension}
              onChange={(e) => setColDimension(e.target.value)}
              className="bg-background border border-border rounded-lg px-2.5 py-1 text-xs font-semibold text-foreground focus:outline-hidden focus:ring-1 focus:ring-primary cursor-pointer"
            >
              {dimensionFields.map((f) => (
                <option key={`col-${f.id}`} value={f.id} disabled={f.id === rowDimension}>
                  {f.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Aggregated Metric */}
        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground font-semibold">Cell Value:</span>
          <select
            value={selectedMetric}
            onChange={(e) => setSelectedMetric(e.target.value)}
            className="bg-background border border-border rounded-lg px-3 py-1 text-xs font-semibold text-primary focus:outline-hidden focus:ring-1 focus:ring-primary cursor-pointer"
          >
            {metricFields.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label} {m.unit ? `(${m.unit})` : ''}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Cross-Tabulation Grid */}
      <div className="overflow-x-auto min-h-[300px]">
        {rowKeys.length === 0 ? (
          <div className="py-12 text-center text-muted-foreground text-xs">
            No records available to construct the pivot table with current filters.
          </div>
        ) : (
          <table className="w-full text-xs text-left border-collapse">
            <thead>
              <tr className="border-b border-border bg-muted/60 text-muted-foreground font-semibold uppercase text-[10px] tracking-wider">
                {/* Top Left Header */}
                <th className="py-3 px-3.5 text-foreground bg-muted/80 sticky left-0 z-20 border-r border-border min-w-[160px]">
                  {dimensionFields.find((f) => f.id === rowDimension)?.label || rowDimension} \ {dimensionFields.find((f) => f.id === colDimension)?.label || colDimension}
                </th>

                {/* Column Headers */}
                {colKeys.map((cKey) => (
                  <th key={cKey} className="py-3 px-3 text-right font-semibold text-foreground min-w-[110px]">
                    {cKey}
                  </th>
                ))}

                {/* Row Total Header */}
                <th className="py-3 px-3.5 text-right font-bold text-foreground bg-muted/80 sticky right-0 z-10 border-l border-border min-w-[120px]">
                  Total / Avg
                </th>
              </tr>
            </thead>

            <tbody className="divide-y divide-border/60">
              {rowKeys.map((rKey) => (
                <tr key={rKey} className="hover:bg-muted/30 transition-colors">
                  {/* Row Label (Sticky Left) */}
                  <td className="py-2.5 px-3.5 font-semibold text-foreground bg-card sticky left-0 z-10 border-r border-border whitespace-nowrap">
                    {rKey}
                  </td>

                  {/* Intersecting Cells */}
                  {colKeys.map((cKey) => {
                    const val = matrix[rKey]?.[cKey];
                    // Subtle heat tint
                    const intensity = val ? Math.min(1, Math.max(0.05, val / maxCellValue)) : 0;
                    return (
                      <td
                        key={`${rKey}-${cKey}`}
                        className="py-2 px-3 text-right tabular-nums font-mono transition-colors"
                        style={{
                          backgroundColor: val ? `rgba(30, 58, 138, ${intensity * 0.12})` : undefined,
                        }}
                      >
                        {formatCellValue(val)}
                      </td>
                    );
                  })}

                  {/* Row Total (Sticky Right) */}
                  <td className="py-2 px-3.5 text-right tabular-nums font-mono font-bold text-foreground bg-card sticky right-0 z-10 border-l border-border">
                    {formatCellValue(rowTotals[rKey])}
                  </td>
                </tr>
              ))}
            </tbody>

            {/* Column Grand Totals Footer */}
            <tfoot>
              <tr className="border-t-2 border-border bg-muted/70 font-semibold text-xs sticky bottom-0 z-20">
                <td className="py-3 px-3.5 text-foreground uppercase tracking-wider text-[11px] font-bold sticky left-0 z-30 bg-muted/90 border-r border-border">
                  GRAND TOTAL
                </td>

                {colKeys.map((cKey) => (
                  <td key={`tot-${cKey}`} className="py-3 px-3 text-right tabular-nums font-mono font-bold text-foreground">
                    {formatCellValue(colTotals[cKey])}
                  </td>
                ))}

                <td className="py-3 px-3.5 text-right tabular-nums font-mono font-black text-primary bg-muted/90 sticky right-0 z-30 border-l border-border text-sm">
                  {formatCellValue(grandTotal)}
                </td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    </div>
  );
}
