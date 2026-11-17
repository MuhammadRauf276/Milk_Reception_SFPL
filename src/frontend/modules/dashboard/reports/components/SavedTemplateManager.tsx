'use client';

import React, { useState, useMemo, useSyncExternalStore } from 'react';
import type {
  ReportDomain,
  SavedReportTemplate,
  DynamicFilterClause,
  PivotRequest,
  TimeBucket,
} from '../dynamicReportTypes';
import { normalizeSavedTemplate, dateSettingsForTemplate, readDateRange, DATE_PRESET_LABELS, TIME_BUCKET_LABELS } from '../dynamicReportTypes';
import {
  Bookmark,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { toast } from '@/frontend/lib/appToast';
import { getPakistanCalendarDate } from '@/backend/core/business-day';

interface SavedTemplateManagerProps {
  domain: ReportDomain;
  systemTemplates: SavedReportTemplate[];
  activeSelectedFieldIds: string[];
  activeFilters: DynamicFilterClause[];
  activeGroupByFieldId?: string;
  activeTimeBucket?: TimeBucket;
  activePivot?: PivotRequest | null;
  activeSortFieldId?: string;
  activeSortDirection?: 'asc' | 'desc';
  /** The date field the date range filters. Absent for report types without one. */
  dateFieldId?: string;
  onApplyTemplate: (template: SavedReportTemplate) => void;
}

const LOCAL_STORAGE_KEY = 'mra_dynamic_saved_report_templates_v1';
const STORAGE_CHANGED_EVENT = 'mra-report-templates-changed';

// Saved templates live in the browser. useSyncExternalStore reads them without an effect and follows other tabs.
const subscribeToTemplates = (onChange: () => void) => {
  window.addEventListener('storage', onChange);
  window.addEventListener(STORAGE_CHANGED_EVENT, onChange);
  return () => {
    window.removeEventListener('storage', onChange);
    window.removeEventListener(STORAGE_CHANGED_EVENT, onChange);
  };
};
const readStoredText = (): string => {
  try {
    return localStorage.getItem(LOCAL_STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
};
const readNoTemplates = (): string => '';

/** Every stored entry as it was saved (also entries this version does not understand, so saving never drops them). */
const parseRawList = (text: string): unknown[] => {
  if (!text) return [];
  try {
    const parsed: unknown = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};
const writeStored = (list: unknown[]) => {
  localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(list));
  window.dispatchEvent(new Event(STORAGE_CHANGED_EVENT));
};

export function SavedTemplateManager({
  domain,
  systemTemplates,
  activeSelectedFieldIds,
  activeFilters,
  activeGroupByFieldId,
  activeTimeBucket,
  activePivot,
  activeSortFieldId,
  activeSortDirection,
  dateFieldId,
  onApplyTemplate,
}: SavedTemplateManagerProps) {
  const storedText = useSyncExternalStore(subscribeToTemplates, readStoredText, readNoTemplates);
  const customTemplates = useMemo(
    () =>
      parseRawList(storedText)
        .map(normalizeSavedTemplate)
        .filter((t): t is SavedReportTemplate => t !== null && t.domain === domain),
    [storedText, domain]
  );
  const [isSaveModalOpen, setIsSaveModalOpen] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState('');
  const [newTemplateDesc, setNewTemplateDesc] = useState('');
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');

  const handleSaveCustomTemplate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTemplateName.trim()) {
      toast.error('Enter a template name.');
      return;
    }

    // The date range is saved on its own: a quick range by name (so it moves with today), or the two days.
    const dates = dateSettingsForTemplate(activeFilters, dateFieldId, getPakistanCalendarDate(new Date()));
    const newTemplate: SavedReportTemplate = {
      id: `custom-template-${Date.now()}`,
      name: newTemplateName.trim(),
      description: newTemplateDesc.trim() || 'Custom user-saved report configuration.',
      domain,
      selectedFieldIds: [...activeSelectedFieldIds],
      filters: dates.filters.map((f) => ({ ...f })),
      groupByFieldId: activeGroupByFieldId,
      sortFieldId: activeSortFieldId,
      sortDirection: activeSortDirection,
      timeBucket: activeTimeBucket,
      pivot: activePivot ? { ...activePivot } : undefined,
      datePreset: dates.datePreset,
      dateFrom: dates.dateFrom,
      dateTo: dates.dateTo,
      isSystemDefault: false,
      createdAt: new Date().toISOString(),
    };

    try {
      writeStored([newTemplate, ...parseRawList(readStoredText())]);
      setSelectedTemplateId(newTemplate.id);
      setIsSaveModalOpen(false);
      setNewTemplateName('');
      setNewTemplateDesc('');
      toast.success(`Template saved`);
    } catch {
      toast.error('Could not save template.');
    }
  };

  const handleDeleteCustomTemplate = (templateId: string, name: string) => {
    try {
      writeStored(parseRawList(readStoredText()).filter((t) => !(typeof t === 'object' && t !== null && 'id' in t && t.id === templateId)));
      if (selectedTemplateId === templateId) setSelectedTemplateId('');
      toast.success(`Removed "${name}"`);
    } catch {
      toast.error('Could not delete template.');
    }
  };

  const domainSystemTemplates = systemTemplates.filter((t) => t.domain === domain);
  const dateRange = readDateRange(activeFilters, dateFieldId);
  const datePreset = dateSettingsForTemplate(activeFilters, dateFieldId, getPakistanCalendarDate(new Date())).datePreset;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Templates Dropdown */}
      <div className="relative flex items-center gap-2">
        <Bookmark className="w-4 h-4 text-muted-foreground shrink-0" />
        <span className="text-xs font-semibold text-foreground">Report Template:</span>
        <select
          value={selectedTemplateId}
          onChange={(e) => {
            const id = e.target.value;
            setSelectedTemplateId(id);
            if (!id) return;
            const match =
              domainSystemTemplates.find((t) => t.id === id) ||
              customTemplates.find((t) => t.id === id);
            if (match) {
              onApplyTemplate(match);
              toast.success(`Template applied`);
            }
          }}
          className="text-xs bg-background border border-border rounded-lg px-3 py-2 font-medium text-foreground focus:outline-hidden focus:ring-2 focus:ring-primary/20 cursor-pointer max-w-xs"
        >
          <option value="">Custom report</option>
          {domainSystemTemplates.length > 0 && (
            <optgroup label="Presets">
              {domainSystemTemplates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </optgroup>
          )}
          {customTemplates.length > 0 && (
            <optgroup label="My views">
              {customTemplates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </div>

      {/* Save Button */}
      <Button
        variant="outline"
        size="sm"
        onClick={() => setIsSaveModalOpen(true)}
        className="h-8 text-xs font-medium"
      >
        <Plus className="w-3.5 h-3.5 mr-1 text-muted-foreground" /> Save Current View
      </Button>

      {/* Delete button if a custom template is currently selected */}
      {customTemplates.some((t) => t.id === selectedTemplateId) && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            const target = customTemplates.find((t) => t.id === selectedTemplateId);
            if (target) handleDeleteCustomTemplate(target.id, target.name);
          }}
          className="h-8 text-xs text-rose-600 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/20"
        >
          <Trash2 className="w-3.5 h-3.5 mr-1" /> Delete Preset
        </Button>
      )}

      {/* Save View Modal */}
      {isSaveModalOpen && (
        <Modal
          onClose={() => setIsSaveModalOpen(false)}
          title="Save view"
          showHeader={false}
          className="max-w-md p-6 space-y-4"
        >
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div className="flex items-center gap-2">
                <Bookmark className="w-4 h-4 text-muted-foreground" />
                <h3 className="text-base font-semibold text-foreground">Save view</h3>
              </div>
              <Button variant="ghost" size="icon-sm" onClick={() => setIsSaveModalOpen(false)}>
                <X className="w-4 h-4" />
              </Button>
            </div>

            <form onSubmit={handleSaveCustomTemplate} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-foreground block">
                  Template Name <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={newTemplateName}
                  onChange={(e) => setNewTemplateName(e.target.value)}
                  placeholder="e.g. Sahiwal route losses"
                  className="w-full px-3 py-2 bg-background border border-border rounded-xl text-xs font-medium text-foreground focus:outline-hidden focus:ring-2 focus:ring-primary/20 placeholder:text-muted-foreground"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-foreground block">
                  Description (Optional)
                </label>
                <textarea
                  rows={2}
                  value={newTemplateDesc}
                  onChange={(e) => setNewTemplateDesc(e.target.value)}
                  placeholder="What this view checks"
                  className="w-full px-3 py-2 bg-background border border-border rounded-xl text-xs font-medium text-foreground focus:outline-hidden focus:ring-2 focus:ring-primary/20 placeholder:text-muted-foreground"
                />
              </div>

              <div className="p-3 rounded-lg bg-muted/40 border border-border text-xs text-muted-foreground space-y-1">
                <div>Active Columns: <strong>{activeSelectedFieldIds.length} fields</strong></div>
                <div>Filter Clauses: <strong>{activeFilters.length} rules</strong></div>
                {activeGroupByFieldId && (
                  <div>
                    Grouped By: <strong>{activeGroupByFieldId}</strong>
                    {activeTimeBucket ? <> · <strong>{TIME_BUCKET_LABELS[activeTimeBucket]}</strong></> : null}
                  </div>
                )}
                {activePivot && <div>Pivot: <strong>{activePivot.rowFieldId} by {activePivot.colFieldId}</strong></div>}
                {dateRange && <div>Dates: <strong>{datePreset ? DATE_PRESET_LABELS[datePreset] : `${dateRange.from} to ${dateRange.to}`}</strong></div>}
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
                <Button type="button" variant="secondary" size="sm" onClick={() => setIsSaveModalOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" variant="default" size="sm">
                  Save Template
                </Button>
              </div>
            </form>
        </Modal>
      )}
    </div>
  );
}
