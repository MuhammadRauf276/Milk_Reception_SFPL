'use client';

import React, { useState, useRef, useEffect, useMemo } from 'react';
import type {
  ReportFieldDefinition,
  FieldCategory,
} from '../dynamicReportTypes';
import {
  Columns,
  Search,
  Check,
  ChevronDown,
  X,
  RotateCcw,
  Layers,
} from 'lucide-react';
import { Button } from '@/components/ui/button';

interface CompactColumnPopoverProps {
  allFields: ReportFieldDefinition[];
  selectedFieldIds: string[];
  onChangeSelectedFieldIds: (fieldIds: string[]) => void;
}

const CATEGORY_NAMES: Record<FieldCategory, string> = {
  IDENTIFICATION: 'Identifiers',
  TIMING: 'Date & Time',
  OPERATIONAL: 'Operations',
  VOLUMES: 'Volume & Liters',
  QUALITY: 'Quality & Lab',
  LOSS_FINANCIAL: 'Loss & Variance',
  GEOLOCATION: 'GPS & Location',
};

export function CompactColumnPopover({
  allFields,
  selectedFieldIds,
  onChangeSelectedFieldIds,
}: CompactColumnPopoverProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const popoverRef = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const toggleField = (fieldId: string) => {
    if (selectedFieldIds.includes(fieldId)) {
      if (selectedFieldIds.length <= 1) return; // Keep at least one column
      onChangeSelectedFieldIds(selectedFieldIds.filter((id) => id !== fieldId));
    } else {
      onChangeSelectedFieldIds([...selectedFieldIds, fieldId]);
    }
  };

  const handleSelectAll = () => {
    onChangeSelectedFieldIds(allFields.map((f) => f.id));
  };

  const handleResetDefaults = () => {
    const defaults = allFields.filter((f) => f.defaultSelected).map((f) => f.id);
    onChangeSelectedFieldIds(defaults.length > 0 ? defaults : allFields.slice(0, 8).map((f) => f.id));
  };

  const moveColumn = (index: number, direction: 'left' | 'right') => {
    const targetIndex = direction === 'left' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= selectedFieldIds.length) return;
    const next = [...selectedFieldIds];
    const temp = next[index];
    next[index] = next[targetIndex];
    next[targetIndex] = temp;
    onChangeSelectedFieldIds(next);
  };

  // Group fields by category
  const categorizedFields = useMemo(() => {
    const map = new Map<FieldCategory, ReportFieldDefinition[]>();
    for (const f of allFields) {
      if (searchTerm && !f.label.toLowerCase().includes(searchTerm.toLowerCase()) && !f.id.toLowerCase().includes(searchTerm.toLowerCase())) {
        continue;
      }
      const list = map.get(f.category) || [];
      list.push(f);
      map.set(f.category, list);
    }
    return map;
  }, [allFields, searchTerm]);

  return (
    <div className="relative inline-block" ref={popoverRef}>
      {/* Trigger Button */}
      <Button
        variant="outline"
        size="sm"
        onClick={() => setIsOpen(!isOpen)}
        className="h-8 text-xs font-semibold bg-background hover:bg-muted border-border flex items-center gap-1.5"
      >
        <Columns className="w-3.5 h-3.5 text-primary" />
        <span>Columns ({selectedFieldIds.length} of {allFields.length})</span>
        <ChevronDown className="w-3 h-3 text-muted-foreground ml-0.5" />
      </Button>

      {/* Floating Popover Dropdown */}
      {isOpen && (
        <div className="absolute left-0 top-full mt-1.5 w-84 bg-card border border-border rounded-xl shadow-xl z-50 overflow-hidden flex flex-col animate-panel-in">
          {/* Header */}
          <div className="p-3 border-b border-border bg-muted/30 flex items-center justify-between">
            <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
              <Columns className="w-3.5 h-3.5 text-primary" /> Column Visibility
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleResetDefaults}
                className="text-[11px] font-medium text-primary hover:underline cursor-pointer"
              >
                Reset Defaults
              </button>
              <span className="text-slate-300">·</span>
              <button
                type="button"
                onClick={handleSelectAll}
                className="text-[11px] font-medium text-slate-600 dark:text-slate-400 hover:text-foreground cursor-pointer"
              >
                Select All
              </button>
            </div>
          </div>

          {/* Quick Search Box */}
          <div className="p-2 border-b border-border bg-background">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search columns…"
                className="w-full pl-8 pr-3 py-1.5 bg-muted/40 border border-border rounded-lg text-xs font-medium text-foreground focus:outline-hidden focus:ring-1 focus:ring-primary placeholder:text-muted-foreground"
              />
              {searchTerm && (
                <button
                  type="button"
                  onClick={() => setSearchTerm('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>

          {/* Scrollable Column Checklist */}
          <div className="max-h-72 overflow-y-auto p-2 divide-y divide-border/40 space-y-2">
            {Array.from(categorizedFields.entries()).map(([cat, fields]) => (
              <div key={cat} className="pt-2 first:pt-0">
                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-2 block mb-1">
                  {CATEGORY_NAMES[cat] || cat}
                </span>

                <div className="space-y-0.5">
                  {fields.map((f) => {
                    const isSelected = selectedFieldIds.includes(f.id);
                    return (
                      <label
                        key={f.id}
                        className={`flex items-center justify-between px-2 py-1.5 rounded-lg text-xs cursor-pointer select-none transition-colors ${
                          isSelected
                            ? 'bg-primary/5 text-foreground font-medium'
                            : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleField(f.id)}
                            className="rounded border-border text-primary focus:ring-primary cursor-pointer w-3.5 h-3.5"
                          />
                          <span>{f.label}</span>
                        </div>
                        {f.unit && (
                          <span className="text-[10px] text-muted-foreground font-mono">
                            {f.unit}
                          </span>
                        )}
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          {/* Active Columns Sequence & Quick Reorder Bar */}
          <div className="p-2.5 bg-muted/40 border-t border-border flex flex-col gap-1.5">
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
              <Layers className="w-3 h-3 text-primary" /> Active Column Order ({selectedFieldIds.length})
            </span>

            <div className="flex items-center gap-1 overflow-x-auto pb-1 scrollbar-none">
              {selectedFieldIds.map((fId, idx) => {
                const def = allFields.find((f) => f.id === fId);
                if (!def) return null;
                return (
                  <div
                    key={fId}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-background border border-border text-[11px] font-medium text-foreground shrink-0 shadow-2xs"
                  >
                    <span>{def.label}</span>
                    <button
                      type="button"
                      disabled={idx === 0}
                      onClick={() => moveColumn(idx, 'left')}
                      className="text-slate-400 hover:text-foreground disabled:opacity-20 cursor-pointer disabled:cursor-not-allowed"
                      title="Move left"
                    >
                      <span className="text-[10px] font-bold select-none">&larr;</span>
                    </button>
                    <button
                      type="button"
                      disabled={idx === selectedFieldIds.length - 1}
                      onClick={() => moveColumn(idx, 'right')}
                      className="text-slate-400 hover:text-foreground disabled:opacity-20 cursor-pointer disabled:cursor-not-allowed"
                      title="Move right"
                    >
                      <span className="text-[10px] font-bold select-none">&rarr;</span>
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Footer */}
          <div className="p-2 border-t border-border bg-background flex items-center justify-between">
            <span className="text-[11px] text-muted-foreground font-medium pl-1">
              {selectedFieldIds.length} active
            </span>
            <Button variant="default" size="sm" onClick={() => setIsOpen(false)} className="h-7 text-xs px-3">
              Done
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
