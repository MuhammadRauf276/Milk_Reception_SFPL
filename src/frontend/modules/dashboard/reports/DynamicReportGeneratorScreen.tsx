'use client';

import React, { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchJson } from '@/lib/query/fetchJson';
import type { User } from '@core/types';
import type {
  ReportDomain,
  ReportFieldDefinition,
  DynamicFilterClause,
  DynamicQueryResponse,
  SavedReportTemplate,
} from './dynamicReportTypes';
import {
  Download,
  Filter,
  Layers,
  Sparkles,
  BarChart3,
  Table as TableIcon,
  Grid as GridIcon,
  FlaskConical,
  FileSpreadsheet,
  FileText,
  Printer,
  ChevronDown,
  Building2,
  Database,
  Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StatCard } from '@/components/ui/stat-card';
import { toast } from '@/frontend/lib/appToast';
import { CompactColumnPopover } from './components/CompactColumnPopover';
import { DynamicFilterBar } from './components/DynamicFilterBar';
import { DynamicReportTable } from './components/DynamicReportTable';
import { DynamicPivotGrid } from './components/DynamicPivotGrid';
import { DynamicReportVisualizer } from './components/DynamicReportVisualizer';
import { SavedTemplateManager } from './components/SavedTemplateManager';
import { PlantQaComparisonView } from './components/PlantQaComparisonView';

interface DynamicReportGeneratorScreenProps {
  currentUser: User | null;
  targetZmccId?: string;
  initialDomain?: ReportDomain;
}

type ViewMode = 'GRID' | 'PIVOT' | 'CHART' | 'PLANT_QA';

export function DynamicReportGeneratorScreen({
  currentUser,
  targetZmccId,
  initialDomain = 'MOT_COLLECTIONS',
}: DynamicReportGeneratorScreenProps) {
  const [domain, setDomain] = useState<ReportDomain>(initialDomain);
  const [selectedFieldIds, setSelectedFieldIds] = useState<string[]>([]);
  const [filters, setFilters] = useState<DynamicFilterClause[]>([]);
  const [groupByFieldId, setGroupByFieldId] = useState<string | undefined>(undefined);
  const [sortFieldId, setSortFieldId] = useState<string | undefined>(undefined);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(20);
  const [viewMode, setViewMode] = useState<ViewMode>('GRID');
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [isRefreshingViews, setIsRefreshingViews] = useState<boolean>(false);

  const queryClient = useQueryClient();
  const isHeadOfMpd = currentUser?.role === 'HEAD_OF_MPD' || currentUser?.role === 'SUPER_ADMIN';

  const handleRefreshViews = async () => {
    try {
      setIsRefreshingViews(true);
      const res = await fetchJson<{ success: boolean; durationMs: number }>('/api/management/reports/views', {
        method: 'POST',
      });
      toast.success(`Database views refreshed concurrently in ${res.durationMs || 10}ms.`);
      queryClient.invalidateQueries();
    } catch {
      toast.error('Failed to refresh database views.');
    } finally {
      setIsRefreshingViews(false);
    }
  };

  // 1. Fetch domain metadata & field definitions
  const metaQuery = useQuery({
    queryKey: ['reports', 'dynamic-meta'],
    queryFn: async () => {
      const res = await fetchJson<{
        domains: Array<{ id: ReportDomain; label: string; description: string }>;
        fieldMap: Record<ReportDomain, ReportFieldDefinition[]>;
        defaultTemplates: SavedReportTemplate[];
      }>('/api/reports/dynamic/fields');
      return res;
    },
    staleTime: 10 * 60 * 1000,
  });

  const allFields = metaQuery.data?.fieldMap?.[domain] || [];
  const systemTemplates = metaQuery.data?.defaultTemplates || [];

  // Initialize default fields when domain changes or metadata loads
  useEffect(() => {
    if (allFields.length > 0) {
      const defaultIds = allFields.filter((f) => f.defaultSelected).map((f) => f.id);
      setSelectedFieldIds(defaultIds.length > 0 ? defaultIds : allFields.slice(0, 8).map((f) => f.id));
      setFilters([]);
      setGroupByFieldId(undefined);
      setPage(1);
    }
  }, [domain, allFields.length]);

  // Determine effective ZMCC facility ID
  const isSystemScope =
    currentUser?.role === 'HEAD_OF_MPD' ||
    currentUser?.role === 'SUPER_ADMIN' ||
    currentUser?.role === 'DATA_EXECUTIVE' ||
    currentUser?.role === 'EXECUTIVE_MANAGEMENT';

  const effectiveFacilityId = isSystemScope
    ? targetZmccId || ''
    : currentUser?.procurement_source_id
    ? String(currentUser.procurement_source_id)
    : '';

  // 2. Query dynamic report data
  const reportQuery = useQuery({
    queryKey: [
      'reports',
      'dynamic-query',
      domain,
      selectedFieldIds,
      filters,
      groupByFieldId,
      sortFieldId,
      sortDirection,
      page,
      pageSize,
      effectiveFacilityId,
    ],
    queryFn: async () => {
      if (selectedFieldIds.length === 0) return null;
      const res = await fetchJson<DynamicQueryResponse>('/api/reports/dynamic/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          domain,
          selectedFieldIds,
          filters,
          groupByFieldId,
          sortFieldId,
          sortDirection,
          page,
          pageSize,
          zmccId: effectiveFacilityId,
        }),
      });
      return res;
    },
    enabled: selectedFieldIds.length > 0 && viewMode !== 'PLANT_QA',
    staleTime: 30 * 1000,
  });

  const queryData = reportQuery.data;
  const isLoading = reportQuery.isPending || reportQuery.isFetching;

  // Sorting handler
  const handleSort = (fieldId: string) => {
    if (sortFieldId === fieldId) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortFieldId(fieldId);
      setSortDirection('asc');
    }
  };

  // Template apply handler
  const handleApplyTemplate = (template: SavedReportTemplate) => {
    if (template.domain !== domain) {
      setDomain(template.domain);
    }
    setSelectedFieldIds(template.selectedFieldIds);
    setFilters(template.filters || []);
    setGroupByFieldId(template.groupByFieldId);
    if (template.sortFieldId) setSortFieldId(template.sortFieldId);
    if (template.sortDirection) setSortDirection(template.sortDirection);
    setPage(1);
  };

  // Export handler (Excel or CSV)
  const handleExport = async (format: 'XLSX' | 'CSV') => {
    setIsExporting(true);
    try {
      const response = await fetch('/api/reports/dynamic/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          domain,
          selectedFieldIds,
          filters,
          groupByFieldId,
          sortFieldId,
          sortDirection,
          zmccId: effectiveFacilityId,
          exportFormat: format,
          reportTitle: `${domain.replace(/_/g, ' ')} Custom Report`,
        }),
      });

      if (!response.ok) {
        throw new Error('Export request failed');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${domain.toLowerCase().replace(/_/g, '-')}-report.${format.toLowerCase()}`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      toast.success(`Exported ${format} file successfully.`);
    } catch {
      toast.error(`Failed to export ${format} report.`);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="space-y-6 animate-panel-in">
      {/* Domain Selection Header */}
      <div className="bg-card border border-border p-4 rounded-xl shadow-xs space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-primary" /> Reports & Analytics Studio
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Live operational reporting with custom columns, multi-clause filters, pivot cross-tabulation, and formatted exports
            </p>
          </div>

          <SavedTemplateManager
            domain={domain}
            systemTemplates={systemTemplates}
            activeSelectedFieldIds={selectedFieldIds}
            activeFilters={filters}
            activeGroupByFieldId={groupByFieldId}
            onApplyTemplate={handleApplyTemplate}
          />
        </div>

        {/* Domain Tabs */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 border-t border-border pt-3 scrollbar-none">
          <span className="text-xs font-semibold text-muted-foreground mr-1.5 shrink-0">Data Domain:</span>
          {(metaQuery.data?.domains || [
            { id: 'MOT_COLLECTIONS', label: 'MOT Route Collections' },
            { id: 'HC_SUPPLIERS', label: 'Direct HC Suppliers' },
            { id: 'JOURNEY_RECONCILIATION', label: 'Journey Reconciliation' },
            { id: 'TANK_STORAGE', label: 'Silo Tank Inventory' },
            { id: 'PLANT_TRANSIT', label: 'Plant Transit' },
            { id: 'QUALITY_SCREENING', label: 'Quality Lab Screening' },
          ]).map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => {
                setDomain(d.id as ReportDomain);
                if (viewMode === 'PLANT_QA') setViewMode('GRID');
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors shrink-0 ${
                domain === d.id && viewMode !== 'PLANT_QA'
                  ? 'bg-primary text-primary-foreground font-semibold shadow-xs'
                  : 'bg-muted/40 text-muted-foreground hover:text-foreground hover:bg-muted/70'
              }`}
            >
              {d.label}
            </button>
          ))}
        </div>
      </div>

      {/* Dynamic Filter Engine (Only when not in Plant QA comparison mode) */}
      {viewMode !== 'PLANT_QA' && (
        <DynamicFilterBar
          fields={allFields}
          filters={filters}
          onChangeFilters={(flts) => {
            setFilters(flts);
            setPage(1);
          }}
          groupByFieldId={groupByFieldId}
          onChangeGroupByFieldId={(gId) => {
            setGroupByFieldId(gId);
            setPage(1);
          }}
        />
      )}

      {/* KPI Summary Ribbon */}
      {viewMode !== 'PLANT_QA' && queryData?.summaryKpis && queryData.summaryKpis.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {queryData.summaryKpis.map((kpi) => (
            <StatCard
              key={kpi.id}
              label={kpi.label}
              value={
                <span>
                  {typeof kpi.value === 'number' ? kpi.value.toLocaleString() : kpi.value}
                  {kpi.unit ? <span className="text-xs font-normal text-muted-foreground ml-1">{kpi.unit}</span> : null}
                </span>
              }
              hint="Filtered dataset"
            />
          ))}
        </div>
      )}

      {/* Studio Toolbar: Column Chooser Popover, View Mode, Export */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-muted/30 border border-border/80 px-4 py-2.5 rounded-xl">
        <div className="flex items-center gap-2">
          {/* Sleek Column Popover */}
          {viewMode !== 'PLANT_QA' && (
            <CompactColumnPopover
              allFields={allFields}
              selectedFieldIds={selectedFieldIds}
              onChangeSelectedFieldIds={setSelectedFieldIds}
            />
          )}

          {groupByFieldId && viewMode === 'GRID' && (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-primary/10 text-primary text-[11px] font-medium border border-primary/20">
              <Layers className="w-3 h-3" /> Grouped by {allFields.find((f) => f.id === groupByFieldId)?.label || groupByFieldId}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* View Mode Toggle: Grid, Pivot, Chart, Plant QA */}
          <div className="flex items-center bg-background border border-border rounded-lg p-0.5">
            <button
              type="button"
              onClick={() => setViewMode('GRID')}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors flex items-center gap-1 ${
                viewMode === 'GRID'
                  ? 'bg-muted text-foreground font-semibold shadow-2xs'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <TableIcon className="w-3.5 h-3.5" /> Table Grid
            </button>
            <button
              type="button"
              onClick={() => setViewMode('PIVOT')}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors flex items-center gap-1 ${
                viewMode === 'PIVOT'
                  ? 'bg-muted text-foreground font-semibold shadow-2xs'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <GridIcon className="w-3.5 h-3.5" /> Pivot Matrix
            </button>
            <button
              type="button"
              onClick={() => setViewMode('CHART')}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors flex items-center gap-1 ${
                viewMode === 'CHART'
                  ? 'bg-muted text-foreground font-semibold shadow-2xs'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <BarChart3 className="w-3.5 h-3.5" /> Visual Charts
            </button>
            {isHeadOfMpd && (
              <button
                type="button"
                onClick={() => setViewMode('PLANT_QA')}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors flex items-center gap-1 ${
                  viewMode === 'PLANT_QA'
                    ? 'bg-primary text-primary-foreground font-semibold shadow-2xs'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <FlaskConical className="w-3.5 h-3.5" /> Plant QA Audit
              </button>
            )}
          </div>

          {/* Export Dropdown Buttons */}
          {viewMode !== 'PLANT_QA' && (
            <>
              <Button
                variant="outline"
                size="sm"
                disabled={isExporting || (queryData?.rows.length || 0) === 0}
                onClick={() => handleExport('XLSX')}
                className="h-8 text-xs font-medium"
              >
                <FileSpreadsheet className="w-3.5 h-3.5 mr-1 text-emerald-600" />
                {isExporting ? 'Exporting…' : 'Export Excel'}
              </Button>

              <Button
                variant="outline"
                size="sm"
                disabled={isExporting || (queryData?.rows.length || 0) === 0}
                onClick={() => handleExport('CSV')}
                className="h-8 text-xs font-medium"
              >
                <FileText className="w-3.5 h-3.5 mr-1 text-slate-600" />
                CSV
              </Button>
            </>
          )}

          <Button
            variant="outline"
            size="sm"
            onClick={() => window.print()}
            className="h-8 text-xs font-medium"
          >
            <Printer className="w-3.5 h-3.5 mr-1" />
            Print
          </Button>

          <Button
            variant="outline"
            size="sm"
            disabled={isRefreshingViews}
            onClick={handleRefreshViews}
            className="h-8 text-xs font-medium text-primary border-primary/30 hover:bg-primary/5"
            title="Concurrently refresh read-model materialized views"
          >
            {isRefreshingViews ? (
              <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
            ) : (
              <Database className="w-3.5 h-3.5 mr-1" />
            )}
            {isRefreshingViews ? 'Refreshing…' : 'Refresh Views'}
          </Button>
        </div>
      </div>

      {/* Main Studio Viewport */}
      {viewMode === 'GRID' && (
        <DynamicReportTable
          fields={queryData?.fields || allFields.filter((f) => selectedFieldIds.includes(f.id))}
          rows={queryData?.rows || []}
          totalRecords={queryData?.totalRecords || 0}
          currentPage={page}
          totalPages={queryData?.totalPages || 1}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={(newSize) => {
            setPageSize(newSize);
            setPage(1);
          }}
          sortFieldId={sortFieldId}
          sortDirection={sortDirection}
          onSort={handleSort}
          groupByFieldId={groupByFieldId}
          groupedSubtotals={queryData?.groupedSubtotals}
          isLoading={isLoading}
        />
      )}

      {viewMode === 'PIVOT' && (
        <DynamicPivotGrid
          fields={queryData?.fields || allFields.filter((f) => selectedFieldIds.includes(f.id))}
          rows={queryData?.rows || []}
        />
      )}

      {viewMode === 'CHART' && (
        <DynamicReportVisualizer
          fields={queryData?.fields || allFields.filter((f) => selectedFieldIds.includes(f.id))}
          rows={queryData?.rows || []}
          groupByFieldId={groupByFieldId}
          groupedSubtotals={queryData?.groupedSubtotals}
        />
      )}

      {viewMode === 'PLANT_QA' && (
        <PlantQaComparisonView targetZmccId={effectiveFacilityId} />
      )}
    </div>
  );
}
