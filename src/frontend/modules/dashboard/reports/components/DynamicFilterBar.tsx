'use client';

import React, { useState } from 'react';
import type {
  ReportFieldDefinition,
  DynamicFilterClause,
  FilterOperator,
  TimeBucket,
  DatePreset,
} from '../dynamicReportTypes';
import {
  TIME_BUCKET_LABELS,
  DATE_PRESETS,
  DATE_PRESET_LABELS,
  MAX_DATE_RANGE_DAYS,
  isTimeField,
  pickDateFieldId,
  readDateRange,
  withDateRange,
  resolveDatePreset,
  detectDatePreset,
  checkDateRange,
  daysInRange,
} from '../dynamicReportTypes';
import {
  Filter,
  Plus,
  Trash2,
  Calendar,
  Layers,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ErrorPopup } from '@/components/ui/error-popup';
import { InfoTip } from '@/components/ui/info-tip';
import { getPakistanCalendarDate } from '@/backend/core/business-day';

interface DynamicFilterBarProps {
  fields: ReportFieldDefinition[];
  filters: DynamicFilterClause[];
  onChangeFilters: (filters: DynamicFilterClause[]) => void;
  groupByFieldId?: string;
  onChangeGroupByFieldId?: (fieldId: string | undefined) => void;
  timeBucket?: TimeBucket;
  onChangeTimeBucket?: (bucket: TimeBucket) => void;
}

// Ids are made here, outside the component, so rendering stays free of random values.
const ID_PREFIX = `flt-${Date.now().toString(36)}`;
let idCounter = 0;
const newFilterId = () => `${ID_PREFIX}-${++idCounter}`;

const presetButtonClass = (active: boolean) =>
  `px-3 py-1 min-h-11 rounded-md text-xs font-medium transition-colors ${
    active ? 'bg-primary text-primary-foreground' : 'bg-muted/60 text-muted-foreground hover:text-foreground'
  }`;

const dateInputClass =
  'bg-background border border-border rounded-md px-3 py-1 min-h-11 text-xs font-medium text-foreground focus:outline-hidden focus:ring-1 focus:ring-primary';

export function DynamicFilterBar({
  fields,
  filters,
  onChangeFilters,
  groupByFieldId,
  onChangeGroupByFieldId,
  timeBucket,
  onChangeTimeBucket,
}: DynamicFilterBarProps) {
  const filterableFields = fields.filter((f) => f.filterable !== false);
  const groupableFields = fields.filter(
    (f) => f.dataType === 'string' || f.dataType === 'date' || f.dataType === 'datetime' || f.dataType === 'enum'
  );
  const groupField = fields.find((f) => f.id === groupByFieldId);

  // The date range filters the first calendar-day field of the report type (tanks have none).
  const dateFieldId = pickDateFieldId(fields);
  const today = getPakistanCalendarDate(new Date());
  const activeRange = readDateRange(filters, dateFieldId);
  const activePreset = activeRange ? detectDatePreset(activeRange, today) : null;
  // Dates typed but not yet complete or valid; the active range shows until both are good.
  const [draft, setDraft] = useState<{ from: string; to: string } | null>(null);
  const [rangeError, setRangeError] = useState<string | null>(null);
  const fromValue = draft?.from ?? activeRange?.from ?? '';
  const toValue = draft?.to ?? activeRange?.to ?? '';

  const addFilter = () => {
    const firstField = filterableFields[0];
    if (!firstField) return;

    const defaultOp: FilterOperator =
      firstField.dataType === 'number'
        ? 'GREATER_THAN'
        : isTimeField(firstField)
        ? 'EQUALS'
        : 'CONTAINS';

    const newClause: DynamicFilterClause = {
      id: newFilterId(),
      fieldId: firstField.id,
      operator: defaultOp,
      value: firstField.dataType === 'number' ? 0 : '',
    };
    onChangeFilters([...filters, newClause]);
  };

  const removeFilter = (id: string) => {
    onChangeFilters(filters.filter((f) => f.id !== id));
  };

  const updateFilter = (id: string, updates: Partial<DynamicFilterClause>) => {
    onChangeFilters(
      filters.map((f) => {
        if (f.id !== id) return f;
        const updated = { ...f, ...updates };

        // If field changed, adapt default operator
        if (updates.fieldId && updates.fieldId !== f.fieldId) {
          const fieldDef = fields.find((d) => d.id === updates.fieldId);
          if (fieldDef?.dataType === 'number') {
            updated.operator = 'GREATER_THAN';
            updated.value = 0;
          } else if (isTimeField(fieldDef)) {
            updated.operator = 'EQUALS';
            updated.value = getPakistanCalendarDate(new Date());
          } else {
            updated.operator = 'CONTAINS';
            updated.value = '';
          }
        }
        return updated;
      })
    );
  };

  const applyHorizonPreset = (preset: DatePreset) => {
    if (!dateFieldId) return;
    setDraft(null);
    setRangeError(null);
    // Replaces any existing date filter with this range
    onChangeFilters(withDateRange(filters, dateFieldId, resolveDatePreset(preset, getPakistanCalendarDate(new Date()))));
  };

  const changeCustomRange = (next: { from: string; to: string }) => {
    if (!dateFieldId) return;
    setDraft(next);
    if (!next.from || !next.to) return;
    const problem = checkDateRange(next.from, next.to);
    if (problem) {
      setRangeError(problem);
      return;
    }
    setRangeError(null);
    setDraft(null);
    onChangeFilters(withDateRange(filters, dateFieldId, next));
  };

  const clearDateRange = () => {
    if (!dateFieldId) return;
    setDraft(null);
    setRangeError(null);
    onChangeFilters(withDateRange(filters, dateFieldId, null));
  };

  const clearAllFilters = () => {
    onChangeFilters([]);
  };

  return (
    <div className="bg-card border border-border p-4 rounded-2xl space-y-4 shadow-xs animate-panel-in">
      {/* Top Bar: Controls & Quick Date Presets */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
            <Filter className="w-4 h-4 text-muted-foreground" />
            <span>Filters</span>
            {filters.length > 0 && (
              <span className="px-2 py-0.5 rounded-md bg-primary/10 text-primary text-xs font-semibold">
                {filters.length} active
              </span>
            )}
          </div>

          {dateFieldId && (
            <div className="flex flex-wrap items-center gap-1 ml-2">
              <span className="text-xs text-muted-foreground mr-1">Horizon:</span>
              {DATE_PRESETS.map((p) => (
                <button key={p} type="button" onClick={() => applyHorizonPreset(p)} className={presetButtonClass(activePreset === p)}>
                  {DATE_PRESET_LABELS[p]}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Group By Selector */}
        {onChangeGroupByFieldId && (
          <div className="flex items-center gap-2">
            <Layers className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-xs text-muted-foreground font-medium">Group By:</span>
            <select
              value={groupByFieldId || ''}
              onChange={(e) => onChangeGroupByFieldId(e.target.value || undefined)}
              className="text-xs bg-background border border-border rounded-lg px-3 py-1 text-foreground font-medium focus:outline-hidden focus:ring-2 focus:ring-primary/20 cursor-pointer"
            >
              <option value="">No grouping</option>
              {groupableFields.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
            {isTimeField(groupField) && onChangeTimeBucket && (
              <select
                value={timeBucket ?? 'DAY'}
                onChange={(e) => onChangeTimeBucket(e.target.value as TimeBucket)}
                className="text-xs bg-background border border-border rounded-lg px-3 py-1 text-foreground font-medium focus:outline-hidden focus:ring-2 focus:ring-primary/20 cursor-pointer"
                aria-label="Time bucket"
              >
                {(Object.keys(TIME_BUCKET_LABELS) as TimeBucket[]).map((b) => (
                  <option key={b} value={b}>
                    {TIME_BUCKET_LABELS[b]}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}
      </div>

      {/* Custom date range (Pakistan days): drives the report's date field like the presets above */}
      {dateFieldId && (
        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-border">
          <Calendar className="w-4 h-4 text-muted-foreground shrink-0" />
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            From
            <input
              type="date"
              value={fromValue}
              onChange={(e) => changeCustomRange({ from: e.target.value, to: toValue })}
              className={dateInputClass}
            />
          </label>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            To
            <input
              type="date"
              value={toValue}
              onChange={(e) => changeCustomRange({ from: fromValue, to: e.target.value })}
              className={dateInputClass}
            />
          </label>
          <span className="px-2 py-1 rounded-md bg-primary/10 text-primary text-xs font-semibold tabular-nums">
            {activeRange
              ? `${activeRange.from === activeRange.to ? activeRange.from : `${activeRange.from} to ${activeRange.to}`} · ${daysInRange(activeRange.from, activeRange.to)} d`
              : 'Last 30 days'}
          </span>
          {activeRange && (
            <button
              type="button"
              onClick={clearDateRange}
              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
              aria-label="Clear dates"
              title="Clear dates"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
          <InfoTip text={`Pakistan dates, at most ${MAX_DATE_RANGE_DAYS} days. Vehicle reports show the last 30 days when no dates are set.`} />
          <ErrorPopup message={rangeError} onClear={() => setRangeError(null)} />
        </div>
      )}

      {/* Filter Rows */}
      {filters.length > 0 && (
        <div className="space-y-2 pt-2 border-t border-border">
          {filters.map((filter) => {
            const currentFieldDef = fields.find((f) => f.id === filter.fieldId);
            return (
              <div
                key={filter.id}
                className="flex flex-wrap items-center gap-2 p-3 rounded-lg bg-muted/30 border border-border/70 text-xs"
              >
                <span className="text-xs font-semibold text-muted-foreground w-10">WHERE</span>

                {/* Field Selector */}
                <select
                  value={filter.fieldId}
                  onChange={(e) => updateFilter(filter.id, { fieldId: e.target.value })}
                  className="bg-background border border-border rounded-md px-3 py-1 text-xs font-semibold text-foreground focus:outline-hidden focus:ring-1 focus:ring-primary cursor-pointer min-w-37.5"
                >
                  {filterableFields.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.label}
                    </option>
                  ))}
                </select>

                {/* Operator Selector */}
                <select
                  value={filter.operator}
                  onChange={(e) => updateFilter(filter.id, { operator: e.target.value as FilterOperator })}
                  className="bg-background border border-border rounded-md px-2 py-1 text-xs font-medium text-foreground focus:outline-hidden focus:ring-1 focus:ring-primary cursor-pointer min-w-30"
                >
                  {currentFieldDef?.dataType === 'number' ? (
                    <>
                      <option value="GREATER_THAN">&gt; (greater than)</option>
                      <option value="LESS_THAN">&lt; (less than)</option>
                      <option value="GREATER_EQUAL">&gt;= (greater or equal)</option>
                      <option value="LESS_EQUAL">&lt;= (less or equal)</option>
                      <option value="EQUALS">= (exact value)</option>
                      <option value="BETWEEN">between</option>
                    </>
                  ) : isTimeField(currentFieldDef) ? (
                    <>
                      <option value="EQUALS">on date (=)</option>
                      <option value="GREATER_EQUAL">on or after</option>
                      <option value="LESS_EQUAL">on or before</option>
                      <option value="BETWEEN">between dates</option>
                    </>
                  ) : (
                    <>
                      <option value="CONTAINS">contains</option>
                      <option value="EQUALS">exact match (=)</option>
                      <option value="STARTS_WITH">starts with</option>
                    </>
                  )}
                </select>

                {/* Primary Value Input */}
                {currentFieldDef?.enumValues && currentFieldDef.enumValues.length > 0 ? (
                  <select
                    value={filter.value || ''}
                    onChange={(e) => updateFilter(filter.id, { value: e.target.value })}
                    className="bg-background border border-border rounded-md px-3 py-1 text-xs font-medium text-foreground focus:outline-hidden focus:ring-1 focus:ring-primary min-w-35"
                  >
                    <option value="">Select option…</option>
                    {currentFieldDef.enumValues.map((val) => (
                      <option key={val} value={val}>
                        {val}
                      </option>
                    ))}
                  </select>
                ) : isTimeField(currentFieldDef) ? (
                  <input
                    type="date"
                    value={filter.value || ''}
                    onChange={(e) => updateFilter(filter.id, { value: e.target.value })}
                    className="bg-background border border-border rounded-md px-3 py-1 text-xs font-medium text-foreground focus:outline-hidden focus:ring-1 focus:ring-primary"
                  />
                ) : currentFieldDef?.dataType === 'number' ? (
                  <input
                    type="number"
                    step="any"
                    value={filter.value ?? ''}
                    onChange={(e) => updateFilter(filter.id, { value: Number(e.target.value) })}
                    placeholder="Enter threshold…"
                    className="bg-background border border-border rounded-md px-3 py-1 text-xs font-medium text-foreground focus:outline-hidden focus:ring-1 focus:ring-primary w-28"
                  />
                ) : (
                  <input
                    type="text"
                    value={filter.value || ''}
                    onChange={(e) => updateFilter(filter.id, { value: e.target.value })}
                    placeholder="Type search text…"
                    className="bg-background border border-border rounded-md px-3 py-1 text-xs font-medium text-foreground focus:outline-hidden focus:ring-1 focus:ring-primary flex-1 min-w-35"
                  />
                )}

                {/* Secondary Value Input for BETWEEN */}
                {filter.operator === 'BETWEEN' && (
                  <>
                    <span className="text-muted-foreground font-medium text-xs">and</span>
                    {isTimeField(currentFieldDef) ? (
                      <input
                        type="date"
                        value={filter.valueSecondary || ''}
                        onChange={(e) => updateFilter(filter.id, { valueSecondary: e.target.value })}
                        className="bg-background border border-border rounded-md px-3 py-1 text-xs font-medium text-foreground focus:outline-hidden focus:ring-1 focus:ring-primary"
                      />
                    ) : (
                      <input
                        type="number"
                        step="any"
                        value={filter.valueSecondary ?? ''}
                        onChange={(e) => updateFilter(filter.id, { valueSecondary: Number(e.target.value) })}
                        placeholder="Max value…"
                        className="bg-background border border-border rounded-md px-3 py-1 text-xs font-medium text-foreground focus:outline-hidden focus:ring-1 focus:ring-primary w-28"
                      />
                    )}
                  </>
                )}

                {/* Remove Clause Button */}
                <button
                  type="button"
                  onClick={() => removeFilter(filter.id)}
                  className="p-1 rounded text-muted-foreground hover:text-rose-600 transition-colors ml-auto cursor-pointer"
                  title="Remove condition"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Action Bar */}
      <div className="flex items-center justify-between pt-1">
        <Button variant="outline" size="sm" onClick={addFilter} className="h-8 text-xs font-medium">
          <Plus className="w-3.5 h-3.5 mr-1 text-muted-foreground" /> Add Filter Condition
        </Button>

        {filters.length > 0 && (
          <Button variant="ghost" size="sm" onClick={clearAllFilters} className="h-8 text-xs text-muted-foreground hover:text-foreground">
            Clear all filters
          </Button>
        )}
      </div>
    </div>
  );
}
