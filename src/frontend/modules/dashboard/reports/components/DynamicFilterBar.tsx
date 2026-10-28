'use client';

import React from 'react';
import type {
  ReportFieldDefinition,
  DynamicFilterClause,
  FilterOperator,
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
import { getPakistanCalendarDate } from '@/backend/core/business-day';

interface DynamicFilterBarProps {
  fields: ReportFieldDefinition[];
  filters: DynamicFilterClause[];
  onChangeFilters: (filters: DynamicFilterClause[]) => void;
  groupByFieldId?: string;
  onChangeGroupByFieldId?: (fieldId: string | undefined) => void;
}

const OPERATOR_LABELS: Record<FilterOperator, string> = {
  EQUALS: 'equals (=)',
  NOT_EQUALS: 'does not equal (!=)',
  CONTAINS: 'contains',
  STARTS_WITH: 'starts with',
  GREATER_THAN: 'greater than (>)',
  LESS_THAN: 'less than (<)',
  GREATER_EQUAL: 'greater or equal (>=)',
  LESS_EQUAL: 'less or equal (<=)',
  BETWEEN: 'between',
  IN_LIST: 'is any of',
};

export function DynamicFilterBar({
  fields,
  filters,
  onChangeFilters,
  groupByFieldId,
  onChangeGroupByFieldId,
}: DynamicFilterBarProps) {
  const filterableFields = fields.filter((f) => f.filterable !== false);
  const groupableFields = fields.filter(
    (f) => f.dataType === 'string' || f.dataType === 'date' || f.dataType === 'enum'
  );

  const addFilter = () => {
    const firstField = filterableFields[0];
    if (!firstField) return;

    const defaultOp: FilterOperator =
      firstField.dataType === 'number'
        ? 'GREATER_THAN'
        : firstField.dataType === 'date'
        ? 'EQUALS'
        : 'CONTAINS';

    const newClause: DynamicFilterClause = {
      id: `flt-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
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
          } else if (fieldDef?.dataType === 'date') {
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

  const applyHorizonPreset = (preset: 'TODAY' | 'YESTERDAY' | 'LAST_7' | 'MTD') => {
    const today = getPakistanCalendarDate(new Date());
    const dateField = fields.find((f) => f.dataType === 'date' || f.id.includes('date'));
    if (!dateField) return;

    let clause: DynamicFilterClause;

    if (preset === 'TODAY') {
      clause = {
        id: `flt-preset-${Date.now()}`,
        fieldId: dateField.id,
        operator: 'EQUALS',
        value: today,
      };
    } else if (preset === 'YESTERDAY') {
      const y = new Date(Date.now() - 86400000).toISOString().split('T')[0];
      clause = {
        id: `flt-preset-${Date.now()}`,
        fieldId: dateField.id,
        operator: 'EQUALS',
        value: y,
      };
    } else if (preset === 'LAST_7') {
      const from = new Date(Date.now() - 6 * 86400000).toISOString().split('T')[0];
      clause = {
        id: `flt-preset-${Date.now()}`,
        fieldId: dateField.id,
        operator: 'BETWEEN',
        value: from,
        valueSecondary: today,
      };
    } else {
      const from = `${today.slice(0, 7)}-01`;
      clause = {
        id: `flt-preset-${Date.now()}`,
        fieldId: dateField.id,
        operator: 'BETWEEN',
        value: from,
        valueSecondary: today,
      };
    }

    // Replace any existing date filter with this preset
    const nonDateFilters = filters.filter((f) => f.fieldId !== dateField.id);
    onChangeFilters([...nonDateFilters, clause]);
  };

  const clearAllFilters = () => {
    onChangeFilters([]);
  };

  return (
    <div className="bg-card border border-border p-4 rounded-xl space-y-4 shadow-xs animate-panel-in">
      {/* Top Bar: Controls & Quick Date Presets */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
            <Filter className="w-4 h-4 text-primary" />
            <span>Ad-Hoc Query Filters</span>
            {filters.length > 0 && (
              <span className="px-1.5 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-bold">
                {filters.length} active
              </span>
            )}
          </div>

          <div className="flex items-center gap-1 ml-2">
            <span className="text-[11px] text-muted-foreground mr-1">Horizon:</span>
            <button
              type="button"
              onClick={() => applyHorizonPreset('TODAY')}
              className="px-2 py-1 rounded-md text-[11px] font-medium bg-muted/60 text-muted-foreground hover:text-foreground transition-colors"
            >
              Today
            </button>
            <button
              type="button"
              onClick={() => applyHorizonPreset('YESTERDAY')}
              className="px-2 py-1 rounded-md text-[11px] font-medium bg-muted/60 text-muted-foreground hover:text-foreground transition-colors"
            >
              Yesterday
            </button>
            <button
              type="button"
              onClick={() => applyHorizonPreset('LAST_7')}
              className="px-2 py-1 rounded-md text-[11px] font-medium bg-muted/60 text-muted-foreground hover:text-foreground transition-colors"
            >
              Last 7 Days
            </button>
            <button
              type="button"
              onClick={() => applyHorizonPreset('MTD')}
              className="px-2 py-1 rounded-md text-[11px] font-medium bg-muted/60 text-muted-foreground hover:text-foreground transition-colors"
            >
              MTD
            </button>
          </div>
        </div>

        {/* Group By Selector */}
        {onChangeGroupByFieldId && (
          <div className="flex items-center gap-2">
            <Layers className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-xs text-muted-foreground font-medium">Group By:</span>
            <select
              value={groupByFieldId || ''}
              onChange={(e) => onChangeGroupByFieldId(e.target.value || undefined)}
              className="text-xs bg-background border border-border rounded-lg px-2.5 py-1 text-foreground font-medium focus:outline-hidden focus:ring-2 focus:ring-primary/20 cursor-pointer"
            >
              <option value="">No Grouping (Flat Records)</option>
              {groupableFields.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Filter Rows */}
      {filters.length > 0 && (
        <div className="space-y-2 pt-2 border-t border-border">
          {filters.map((filter) => {
            const currentFieldDef = fields.find((f) => f.id === filter.fieldId);
            return (
              <div
                key={filter.id}
                className="flex flex-wrap items-center gap-2 p-2.5 rounded-lg bg-muted/30 border border-border/70 text-xs"
              >
                <span className="text-[10px] uppercase font-bold text-slate-400 w-10">WHERE</span>

                {/* Field Selector */}
                <select
                  value={filter.fieldId}
                  onChange={(e) => updateFilter(filter.id, { fieldId: e.target.value })}
                  className="bg-background border border-border rounded-md px-2.5 py-1 text-xs font-semibold text-foreground focus:outline-hidden focus:ring-1 focus:ring-primary cursor-pointer min-w-[150px]"
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
                  className="bg-background border border-border rounded-md px-2 py-1 text-xs font-medium text-foreground focus:outline-hidden focus:ring-1 focus:ring-primary cursor-pointer min-w-[120px]"
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
                  ) : currentFieldDef?.dataType === 'date' ? (
                    <>
                      <option value="EQUALS">on date (=)</option>
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
                    className="bg-background border border-border rounded-md px-2.5 py-1 text-xs font-medium text-foreground focus:outline-hidden focus:ring-1 focus:ring-primary min-w-[140px]"
                  >
                    <option value="">Select option…</option>
                    {currentFieldDef.enumValues.map((val) => (
                      <option key={val} value={val}>
                        {val}
                      </option>
                    ))}
                  </select>
                ) : currentFieldDef?.dataType === 'date' ? (
                  <input
                    type="date"
                    value={filter.value || ''}
                    onChange={(e) => updateFilter(filter.id, { value: e.target.value })}
                    className="bg-background border border-border rounded-md px-2.5 py-1 text-xs font-medium text-foreground focus:outline-hidden focus:ring-1 focus:ring-primary"
                  />
                ) : currentFieldDef?.dataType === 'number' ? (
                  <input
                    type="number"
                    step="any"
                    value={filter.value ?? ''}
                    onChange={(e) => updateFilter(filter.id, { value: Number(e.target.value) })}
                    placeholder="Enter threshold…"
                    className="bg-background border border-border rounded-md px-2.5 py-1 text-xs font-medium text-foreground focus:outline-hidden focus:ring-1 focus:ring-primary w-28"
                  />
                ) : (
                  <input
                    type="text"
                    value={filter.value || ''}
                    onChange={(e) => updateFilter(filter.id, { value: e.target.value })}
                    placeholder="Type search text…"
                    className="bg-background border border-border rounded-md px-2.5 py-1 text-xs font-medium text-foreground focus:outline-hidden focus:ring-1 focus:ring-primary flex-1 min-w-[140px]"
                  />
                )}

                {/* Secondary Value Input for BETWEEN */}
                {filter.operator === 'BETWEEN' && (
                  <>
                    <span className="text-muted-foreground font-medium text-xs">and</span>
                    {currentFieldDef?.dataType === 'date' ? (
                      <input
                        type="date"
                        value={filter.valueSecondary || ''}
                        onChange={(e) => updateFilter(filter.id, { valueSecondary: e.target.value })}
                        className="bg-background border border-border rounded-md px-2.5 py-1 text-xs font-medium text-foreground focus:outline-hidden focus:ring-1 focus:ring-primary"
                      />
                    ) : (
                      <input
                        type="number"
                        step="any"
                        value={filter.valueSecondary ?? ''}
                        onChange={(e) => updateFilter(filter.id, { valueSecondary: Number(e.target.value) })}
                        placeholder="Max value…"
                        className="bg-background border border-border rounded-md px-2.5 py-1 text-xs font-medium text-foreground focus:outline-hidden focus:ring-1 focus:ring-primary w-28"
                      />
                    )}
                  </>
                )}

                {/* Remove Clause Button */}
                <button
                  type="button"
                  onClick={() => removeFilter(filter.id)}
                  className="p-1 rounded text-slate-400 hover:text-rose-600 transition-colors ml-auto cursor-pointer"
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
          <Plus className="w-3.5 h-3.5 mr-1 text-primary" /> Add Filter Condition
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
