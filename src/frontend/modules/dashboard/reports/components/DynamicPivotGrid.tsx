'use client';

import React, { useMemo } from 'react';
import type {
  AggregationType,
  PivotRequest,
  PivotResult,
  ReportFieldDefinition,
  TimeBucket,
} from '../dynamicReportTypes';
import { TIME_BUCKET_LABELS, isTimeField } from '../dynamicReportTypes';
import { ArrowRightLeft, Loader2 } from 'lucide-react';
import { TableWrapper } from '@/components/ui/table-wrapper';
import { InfoTip } from '@/components/ui/info-tip';

interface DynamicPivotGridProps {
  /** Every field of the report type, not only the selected columns. */
  fields: ReportFieldDefinition[];
  config: PivotRequest | null;
  onChangeConfig: (config: PivotRequest) => void;
  /** Computed by the server over the whole filtered result. */
  result?: PivotResult | null;
  isLoading?: boolean;
}

const AGGREGATION_LABELS: Record<AggregationType, string> = {
  SUM: 'Sum',
  AVG: 'Average',
  COUNT: 'Count',
  MIN: 'Min',
  MAX: 'Max',
};

const dimensionFieldsOf = (fields: ReportFieldDefinition[]) => fields.filter((f) => f.dataType !== 'number');
const metricFieldsOf = (fields: ReportFieldDefinition[]) => fields.filter((f) => f.dataType === 'number');

/** A first pivot that shows something useful: a name down the side, time or a status across, litres inside. */
export function defaultPivotConfig(fields: ReportFieldDefinition[]): PivotRequest | null {
  const dims = dimensionFieldsOf(fields);
  const metrics = metricFieldsOf(fields);
  if (dims.length < 2) return null;
  const row =
    dims.find((f) => /(route|supplier|source|contractor|tank)_name$/.test(f.id)) ??
    dims.find((f) => f.dataType === 'string') ??
    dims[0];
  const col =
    dims.find((f) => f.id !== row.id && isTimeField(f)) ??
    dims.find((f) => f.id !== row.id && f.dataType === 'enum') ??
    dims.find((f) => f.id !== row.id) ??
    dims[1];
  const metric = metrics.find((f) => f.format === 'liters' && f.aggregations?.includes('SUM')) ?? metrics[0];
  return {
    rowFieldId: row.id,
    colFieldId: col.id,
    metricFieldId: metric?.id,
    aggregation: metric ? (metric.aggregations?.includes('SUM') ? 'SUM' : 'AVG') : 'COUNT',
    colBucket: isTimeField(col) ? 'DAY' : undefined,
    rowBucket: isTimeField(row) ? 'DAY' : undefined,
  };
}

const selectClass =
  'bg-background border border-border rounded-lg px-3 py-1 min-h-11 text-xs font-semibold text-foreground focus:outline-hidden focus:ring-1 focus:ring-primary cursor-pointer';

export function DynamicPivotGrid({ fields, config, onChangeConfig, result, isLoading }: DynamicPivotGridProps) {
  const dimensionFields = useMemo(() => dimensionFieldsOf(fields), [fields]);
  const metricFields = useMemo(() => metricFieldsOf(fields), [fields]);

  const maxCell = useMemo(() => {
    let max = 0;
    for (const row of Object.values(result?.cells ?? {})) {
      for (const v of Object.values(row)) if (v !== null && Math.abs(v) > max) max = Math.abs(v);
    }
    return Math.max(max, 1);
  }, [result]);

  if (!config) {
    return (
      <div className="bg-card border border-border rounded-2xl p-4 py-12 text-center text-muted-foreground text-xs">
        {isLoading ? 'Loading…' : 'No pivot available'}
      </div>
    );
  }

  const rowField = fields.find((f) => f.id === config.rowFieldId);
  const colField = fields.find((f) => f.id === config.colFieldId);
  const metricDef = config.metricFieldId ? fields.find((f) => f.id === config.metricFieldId) : undefined;
  const isCount = config.aggregation === 'COUNT';

  const update = (patch: Partial<PivotRequest>) => onChangeConfig({ ...config, ...patch });

  const handleSwap = () =>
    update({
      rowFieldId: config.colFieldId,
      colFieldId: config.rowFieldId,
      rowBucket: config.colBucket,
      colBucket: config.rowBucket,
    });

  const changeDimension = (side: 'row' | 'col', id: string) => {
    const f = fields.find((x) => x.id === id);
    const bucket: TimeBucket | undefined = isTimeField(f) ? 'DAY' : undefined;
    update(side === 'row' ? { rowFieldId: id, rowBucket: bucket } : { colFieldId: id, colBucket: bucket });
  };

  const changeAggregation = (agg: AggregationType) => {
    if (agg === 'COUNT') update({ aggregation: agg, metricFieldId: undefined });
    else update({ aggregation: agg, metricFieldId: config.metricFieldId ?? metricFields[0]?.id });
  };

  const formatValue = (val: number | null | undefined) => {
    if (val === null || val === undefined) return <span className="text-muted-foreground font-mono">—</span>;
    if (isCount) return val.toLocaleString('en-US', { maximumFractionDigits: 0 });
    if (metricDef?.format === 'liters') return `${val.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} L`;
    if (metricDef?.format === 'percent') return `${val.toFixed(2)}%`;
    if (metricDef?.format === 'temperature') return `${val.toFixed(1)}°C`;
    return val.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 2 });
  };

  const bucketSelect = (side: 'row' | 'col', field: ReportFieldDefinition | undefined, value: TimeBucket | undefined) =>
    isTimeField(field) ? (
      <select
        value={value ?? 'DAY'}
        onChange={(e) => update(side === 'row' ? { rowBucket: e.target.value as TimeBucket } : { colBucket: e.target.value as TimeBucket })}
        className={selectClass}
        aria-label="Time bucket"
      >
        {(Object.keys(TIME_BUCKET_LABELS) as TimeBucket[]).map((b) => (
          <option key={b} value={b}>
            {TIME_BUCKET_LABELS[b]}
          </option>
        ))}
      </select>
    ) : null;

  return (
    <div className="bg-card border border-border rounded-2xl shadow-xs overflow-hidden flex flex-col space-y-4 p-4 animate-panel-in">
      <div className="flex flex-wrap items-center gap-3 pb-3 border-b border-border">
        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground font-semibold">Rows</span>
          <select value={config.rowFieldId} onChange={(e) => changeDimension('row', e.target.value)} className={selectClass}>
            {dimensionFields.map((f) => (
              <option key={`row-${f.id}`} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
          {bucketSelect('row', rowField, config.rowBucket)}
        </div>

        <button
          type="button"
          onClick={handleSwap}
          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-action/30 bg-action-soft text-action transition-colors cursor-pointer"
          aria-label="Swap rows and columns"
          title="Swap"
        >
          <ArrowRightLeft className="w-3.5 h-3.5" />
        </button>

        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground font-semibold">Columns</span>
          <select value={config.colFieldId} onChange={(e) => changeDimension('col', e.target.value)} className={selectClass}>
            {dimensionFields.map((f) => (
              <option key={`col-${f.id}`} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
          {bucketSelect('col', colField, config.colBucket)}
        </div>

        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground font-semibold">Value</span>
          <select value={config.aggregation} onChange={(e) => changeAggregation(e.target.value as AggregationType)} className={selectClass}>
            {(Object.keys(AGGREGATION_LABELS) as AggregationType[]).map((a) => (
              <option key={a} value={a}>
                {AGGREGATION_LABELS[a]}
              </option>
            ))}
          </select>
          {!isCount && (
            <select
              value={config.metricFieldId ?? ''}
              onChange={(e) => update({ metricFieldId: e.target.value })}
              className={`${selectClass} text-primary`}
            >
              {metricFields.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          )}
          <InfoTip text="Counts every matching row. The grid covers the whole filtered result, not only the current page. With more than 50 columns, the 49 largest are shown and the rest are added into Other." />
        </div>
      </div>

      <TableWrapper className="min-h-75 relative">
        {isLoading && (
          <div className="absolute inset-0 bg-background/60 z-20 flex items-center justify-center">
            <Loader2 className="w-4 h-4 text-muted-foreground animate-spin" />
          </div>
        )}
        {!result || result.rowKeys.length === 0 ? (
          <div className="py-12 text-center text-muted-foreground text-xs">No records</div>
        ) : (
          <table className="w-full text-xs text-left border-collapse">
            <thead>
              <tr className="border-b border-border bg-muted/60 text-muted-foreground font-semibold text-xs">
                <th className="py-3 px-4 text-foreground bg-muted/80 sticky left-0 z-20 border-r border-border min-w-40">
                  {rowField?.label ?? config.rowFieldId} / {colField?.label ?? config.colFieldId}
                </th>
                {result.colKeys.map((cKey) => (
                  <th key={cKey} className="py-3 px-3 text-right font-semibold text-foreground min-w-28">
                    {cKey}
                  </th>
                ))}
                <th className="py-3 px-4 text-right font-semibold text-foreground bg-muted/80 sticky right-0 z-10 border-l border-border min-w-30">
                  Total
                </th>
              </tr>
            </thead>

            <tbody className="divide-y divide-border/60">
              {result.rowKeys.map((rKey) => (
                <tr key={rKey} className="hover:bg-muted/30 transition-colors">
                  <td className="py-2 px-4 font-semibold text-foreground bg-card sticky left-0 z-10 border-r border-border whitespace-nowrap">
                    {rKey}
                  </td>
                  {result.colKeys.map((cKey) => {
                    const val = result.cells[rKey]?.[cKey] ?? null;
                    const intensity = val ? Math.min(1, Math.max(0.05, Math.abs(val) / maxCell)) : 0;
                    return (
                      <td
                        key={`${rKey}-${cKey}`}
                        className="py-2 px-3 text-right tabular-nums font-mono transition-colors"
                        style={{ backgroundColor: val ? `rgba(30, 58, 138, ${intensity * 0.12})` : undefined }}
                      >
                        {formatValue(val)}
                      </td>
                    );
                  })}
                  <td className="py-2 px-4 text-right tabular-nums font-mono font-semibold text-foreground bg-card sticky right-0 z-10 border-l border-border">
                    {formatValue(result.rowTotals[rKey])}
                  </td>
                </tr>
              ))}
            </tbody>

            <tfoot>
              <tr className="border-t-2 border-border bg-muted/70 font-semibold text-xs sticky bottom-0 z-20">
                <td className="py-3 px-4 text-foreground text-xs font-semibold sticky left-0 z-30 bg-muted/90 border-r border-border">
                  Total
                </td>
                {result.colKeys.map((cKey) => (
                  <td key={`tot-${cKey}`} className="py-3 px-3 text-right tabular-nums font-mono font-semibold text-foreground">
                    {formatValue(result.colTotals[cKey])}
                  </td>
                ))}
                <td className="py-3 px-4 text-right tabular-nums font-mono font-semibold text-primary bg-muted/90 sticky right-0 z-30 border-l border-border">
                  {formatValue(result.grandTotal)}
                </td>
              </tr>
            </tfoot>
          </table>
        )}
      </TableWrapper>
    </div>
  );
}
