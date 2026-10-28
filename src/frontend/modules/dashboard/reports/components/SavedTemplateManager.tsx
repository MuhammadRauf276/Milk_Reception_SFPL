'use client';

import React, { useState, useEffect } from 'react';
import type {
  ReportDomain,
  SavedReportTemplate,
  DynamicFilterClause,
} from '../dynamicReportTypes';
import {
  Bookmark,
  Plus,
  Trash2,
  Sparkles,
  ChevronDown,
  X,
  Check,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

interface SavedTemplateManagerProps {
  domain: ReportDomain;
  systemTemplates: SavedReportTemplate[];
  activeSelectedFieldIds: string[];
  activeFilters: DynamicFilterClause[];
  activeGroupByFieldId?: string;
  onApplyTemplate: (template: SavedReportTemplate) => void;
}

const LOCAL_STORAGE_KEY = 'mra_dynamic_saved_report_templates_v1';

export function SavedTemplateManager({
  domain,
  systemTemplates,
  activeSelectedFieldIds,
  activeFilters,
  activeGroupByFieldId,
  onApplyTemplate,
}: SavedTemplateManagerProps) {
  const [customTemplates, setCustomTemplates] = useState<SavedReportTemplate[]>([]);
  const [isSaveModalOpen, setIsSaveModalOpen] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState('');
  const [newTemplateDesc, setNewTemplateDesc] = useState('');
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');

  // Load custom templates from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (stored) {
        const parsed: SavedReportTemplate[] = JSON.parse(stored);
        setCustomTemplates(parsed.filter((t) => t.domain === domain));
      }
    } catch {
      // ignore parsing errors
    }
  }, [domain]);

  const handleSaveCustomTemplate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTemplateName.trim()) {
      toast.error('Please provide a name for this custom report template.');
      return;
    }

    const newTemplate: SavedReportTemplate = {
      id: `custom-template-${Date.now()}`,
      name: newTemplateName.trim(),
      description: newTemplateDesc.trim() || 'Custom user-saved report configuration.',
      domain,
      selectedFieldIds: [...activeSelectedFieldIds],
      filters: [...activeFilters],
      groupByFieldId: activeGroupByFieldId,
      isSystemDefault: false,
      createdAt: new Date().toISOString(),
    };

    try {
      const stored = localStorage.getItem(LOCAL_STORAGE_KEY);
      const all: SavedReportTemplate[] = stored ? JSON.parse(stored) : [];
      const updated = [newTemplate, ...all.filter((t) => t.id !== newTemplate.id)];
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(updated));

      setCustomTemplates((prev) => [newTemplate, ...prev]);
      setSelectedTemplateId(newTemplate.id);
      setIsSaveModalOpen(false);
      setNewTemplateName('');
      setNewTemplateDesc('');
      toast.success(`Saved custom template "${newTemplate.name}"`);
    } catch {
      toast.error('Failed to save custom template to local storage.');
    }
  };

  const handleDeleteCustomTemplate = (templateId: string, name: string) => {
    try {
      const stored = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (stored) {
        const all: SavedReportTemplate[] = JSON.parse(stored);
        const updated = all.filter((t) => t.id !== templateId);
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(updated));
      }
      setCustomTemplates((prev) => prev.filter((t) => t.id !== templateId));
      if (selectedTemplateId === templateId) setSelectedTemplateId('');
      toast.success(`Removed template "${name}"`);
    } catch {
      toast.error('Failed to delete template.');
    }
  };

  const domainSystemTemplates = systemTemplates.filter((t) => t.domain === domain);

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Templates Dropdown */}
      <div className="relative flex items-center gap-1.5">
        <Bookmark className="w-4 h-4 text-primary shrink-0" />
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
              toast.success(`Applied template: ${match.name}`);
            }
          }}
          className="text-xs bg-background border border-border rounded-lg px-2.5 py-1.5 font-medium text-foreground focus:outline-hidden focus:ring-2 focus:ring-primary/20 cursor-pointer max-w-xs"
        >
          <option value="">Custom Report (Ad-Hoc Layout)</option>
          {domainSystemTemplates.length > 0 && (
            <optgroup label="System Standard Presets">
              {domainSystemTemplates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </optgroup>
          )}
          {customTemplates.length > 0 && (
            <optgroup label="My Saved Views">
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
        <Plus className="w-3.5 h-3.5 mr-1 text-primary" /> Save Current View
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div className="bg-card border border-border w-full max-w-md rounded-2xl shadow-2xl p-6 space-y-4 animate-panel-in">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div className="flex items-center gap-2">
                <Bookmark className="w-4 h-4 text-primary" />
                <h3 className="text-base font-semibold text-foreground">Save Custom Report View</h3>
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
                  placeholder="e.g. Sahiwal Route Quality & Losses"
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
                  placeholder="Explain what scenario this custom view audits…"
                  className="w-full px-3 py-2 bg-background border border-border rounded-xl text-xs font-medium text-foreground focus:outline-hidden focus:ring-2 focus:ring-primary/20 placeholder:text-muted-foreground"
                />
              </div>

              <div className="p-3 rounded-lg bg-muted/40 border border-border text-[11px] text-muted-foreground space-y-1">
                <div>Active Columns: <strong>{activeSelectedFieldIds.length} fields</strong></div>
                <div>Filter Clauses: <strong>{activeFilters.length} rules</strong></div>
                {activeGroupByFieldId && <div>Grouped By: <strong>{activeGroupByFieldId}</strong></div>}
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
                <Button type="button" variant="outline" size="sm" onClick={() => setIsSaveModalOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" variant="default" size="sm">
                  Save Template
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
