'use client';

import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchJson } from '@/lib/query/fetchJson';
import type { User } from '@core/types';
import type {
  ReportDomain,
  ReportFieldDefinition,
  DynamicFilterClause,
  DynamicQueryResponse,
  SavedReportTemplate,
  PivotRequest,
  TimeBucket,
} from './dynamicReportTypes';
import { filtersForTemplate, pickDateFieldId, lossGainUnit } from './dynamicReportTypes';
import { getPakistanCalendarDate } from '@/backend/core/business-day';
import {
  Layers,
  BarChart3,
  Table as TableIcon,
  Grid as GridIcon,
  FlaskConical,
  FileSpreadsheet,
  FileText,
  Printer,
  Database,
  Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useListPageSize } from '@/components/ui/pagination';
import { StatCard } from '@/components/ui/stat-card';
import { toast } from '@/frontend/lib/appToast';
import { ErrorPopup } from '@/components/ui/error-popup';
import { CompactColumnPopover } from './components/CompactColumnPopover';
import { DynamicFilterBar } from './components/DynamicFilterBar';
import { DynamicReportTable } from './components/DynamicReportTable';
import { DynamicPivotGrid, defaultPivotConfig } from './components/DynamicPivotGrid';
import { DynamicReportVisualizer } from './components/DynamicReportVisualizer';
import { SavedTemplateManager } from './components/SavedTemplateManager';
import { PlantQaComparisonView } from './components/PlantQaComparisonView';
import { LossGainValue } from './components/LossGainValue';

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
  const [timeBucket, setTimeBucket] = useState<TimeBucket>('DAY');
  const [pivotConfig, setPivotConfig] = useState<PivotRequest | null>(null);
  const [sortFieldId, setSortFieldId] = useState<string | undefined>(undefined);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const listPageSize = useListPageSize(25);
  const [page, setPage] = useState<number>(1);
  // The rows-per-page the user picked on this screen; until then the app-wide setting applies.
  const [pickedPageSize, setPageSize] = useState<number | null>(null);
  const pageSize = pickedPageSize ?? listPageSize;
  const [viewMode, setViewMode] = useState<ViewMode>('GRID');
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [isRefreshingViews, setIsRefreshingViews] = useState<boolean>(false);

  const queryClient = useQueryClient();
  const isHeadOfMpd = currentUser?.role === 'HEAD_OF_MPD' || currentUser?.role === 'SUPER_ADMIN';

  const handleRefreshViews = async () => {
    try {
      setIsRefreshingViews(true);
      await fetchJson<{ success: boolean; durationMs: number }>('/api/management/reports/views', {
        method: 'POST',
      });
      toast.success(`Data refreshed.`);
      queryClient.invalidateQueries();
    } catch {
      toast.error('Refresh failed. Try again.');
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

  // Start from the default columns when the report type changes or its field list arrives.
  const fieldsKey = `${domain}:${allFields.length}`;
  const [initializedKey, setInitializedKey] = useState('');
  if (allFields.length > 0 && initializedKey !== fieldsKey) {
    const defaultIds = allFields.filter((f) => f.defaultSelected).map((f) => f.id);
    setInitializedKey(fieldsKey);
    setSelectedFieldIds(defaultIds.length > 0 ? defaultIds : allFields.slice(0, 8).map((f) => f.id));
    setFilters([]);
    setGroupByFieldId(undefined);
    setTimeBucket('DAY');
    setPivotConfig(defaultPivotConfig(allFields));
    setPage(1);
  }

  // After a domain switch the old selection lingers for one render: wait until it fits the new fields.
  const fieldsFit =
    allFields.length > 0 &&
    selectedFieldIds.every((id) => allFields.some((f) => f.id === id)) &&
    (!groupByFieldId || allFields.some((f) => f.id === groupByFieldId));

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
      timeBucket,
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
          timeBucket,
          sortFieldId,
          sortDirection,
          page,
          pageSize,
          zmccId: effectiveFacilityId,
        }),
      });
      return res;
    },
    enabled: selectedFieldIds.length > 0 && fieldsFit && viewMode !== 'PLANT_QA',
    staleTime: 30 * 1000,
    retry: false,
  });

  // The pivot is computed by the server over the whole filtered result.
  const pivotQuery = useQuery({
    queryKey: ['reports', 'dynamic-pivot', domain, filters, pivotConfig, effectiveFacilityId],
    queryFn: async () => {
      const res = await fetchJson<DynamicQueryResponse>('/api/reports/dynamic/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          domain,
          selectedFieldIds,
          filters,
          pivot: pivotConfig,
          page: 1,
          pageSize: 1,
          zmccId: effectiveFacilityId,
        }),
      });
      return res;
    },
    enabled: viewMode === 'PIVOT' && !!pivotConfig && fieldsFit && selectedFieldIds.length > 0,
    staleTime: 30 * 1000,
    retry: false,
  });

  const queryData = reportQuery.data;
  const isLoading = reportQuery.isPending || reportQuery.isFetching;
  const activeError = viewMode === 'PIVOT' ? pivotQuery.error : reportQuery.error;

  // Sorting handler
  const handleSort = (fieldId: string) => {
    if (sortFieldId === fieldId) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortFieldId(fieldId);
      setSortDirection('asc');
    }
  };

  const dateFieldId = pickDateFieldId(allFields);

  // Template apply handler: restores columns, filters, date range, grouping, bucket, sort and pivot.
  // Settings an older template does not have fall back to the defaults.
  const handleApplyTemplate = (template: SavedReportTemplate) => {
    if (template.domain !== domain) {
      setDomain(template.domain);
    }
    const defaultIds = allFields.filter((f) => f.defaultSelected).map((f) => f.id);
    setSelectedFieldIds(template.selectedFieldIds.length > 0 ? template.selectedFieldIds : defaultIds);
    setFilters(filtersForTemplate(template, dateFieldId, getPakistanCalendarDate(new Date())));
    setGroupByFieldId(template.groupByFieldId);
    setTimeBucket(template.timeBucket ?? 'DAY');
    setSortFieldId(template.sortFieldId);
    setSortDirection(template.sortDirection ?? 'desc');
    const pivot = template.pivot;
    const pivotFits = !!pivot && allFields.some((f) => f.id === pivot.rowFieldId) && allFields.some((f) => f.id === pivot.colFieldId);
    setPivotConfig(pivotFits && pivot ? pivot : defaultPivotConfig(allFields));
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
          timeBucket,
          sortFieldId,
          sortDirection,
          zmccId: effectiveFacilityId,
          exportFormat: format,
          reportTitle: `${domain.replace(/_/g, ' ')} Custom Report`,
        }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error || 'Export request failed');
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

      toast.success(`${format} exported.`);
    } catch (err) {
      toast.error(err instanceof Error && err.message !== 'Export request failed' ? err.message : `Could not export ${format}.`);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="space-y-6 animate-panel-in">
      {/* Domain Selection Header */}
      <div className="bg-card border border-border p-4 rounded-2xl shadow-xs space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-muted-foreground" /> Reports and analytics
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Custom columns and filters
            </p>
          </div>

          <SavedTemplateManager
            domain={domain}
            systemTemplates={systemTemplates}
            activeSelectedFieldIds={selectedFieldIds}
            activeFilters={filters}
            activeGroupByFieldId={groupByFieldId}
            activeTimeBucket={timeBucket}
            activePivot={pivotConfig}
            activeSortFieldId={sortFieldId}
            activeSortDirection={sortDirection}
            dateFieldId={dateFieldId}
            onApplyTemplate={handleApplyTemplate}
          />
        </div>

        {/* Domain Tabs */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1.5 border-t border-border pt-3 scrollbar-thin">
          <span className="text-xs font-semibold text-muted-foreground mr-2 shrink-0">Data Domain:</span>
          {(metaQuery.data?.domains || [
            { id: 'MOT_COLLECTIONS', label: 'Mobile Tester collections' },
            { id: 'HC_SUPPLIERS', label: 'HC suppliers' },
            { id: 'JOURNEY_RECONCILIATION', label: 'Journey Reconciliation' },
            { id: 'TANK_STORAGE', label: 'Tank storage' },
            { id: 'PLANT_TRANSIT', label: 'Plant Transit' },
            { id: 'QUALITY_SCREENING', label: 'Lab screening' },
            { id: 'VEHICLE_DISPATCH', label: 'Vehicles: dispatch vs plant' },
          ]).map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => {
                setDomain(d.id as ReportDomain);
                if (viewMode === 'PLANT_QA') setViewMode('GRID');
              }}
              className={`px-3 py-2 rounded-lg text-xs font-medium transition-colors shrink-0 ${
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
          timeBucket={timeBucket}
          onChangeTimeBucket={(b) => {
            setTimeBucket(b);
            setPage(1);
          }}
        />
      )}

      <ErrorPopup message={activeError instanceof Error ? activeError.message : null} />

      {viewMode !== 'PLANT_QA' && queryData?.dateRange && (
        <p className="text-xs text-muted-foreground">
          Dispatched {queryData.dateRange.from} to {queryData.dateRange.to}
          {queryData.dateRange.defaulted ? ' (last 30 days)' : ''}
        </p>
      )}

      {/* KPI Summary Ribbon */}
      {viewMode !== 'PLANT_QA' && queryData?.summaryKpis && queryData.summaryKpis.length > 0 && (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,11rem),1fr))] gap-3">
          {queryData.summaryKpis.map((kpi) => (
            <StatCard
              key={kpi.id}
              label={kpi.label}
              value={
                kpi.lossGain && typeof kpi.value === 'number' ? (
                  <LossGainValue value={kpi.value} unit={lossGainUnit(kpi)} kind={kpi.lossGain} />
                ) : (
                  <span>
                    {typeof kpi.value === 'number' ? kpi.value.toLocaleString() : kpi.value}
                    {kpi.unit ? <span className="text-xs font-normal text-muted-foreground ml-1">{kpi.unit}</span> : null}
                  </span>
                )
              }
              hint="Filtered dataset"
            />
          ))}
        </div>
      )}

      {/* Studio Toolbar: Column Chooser Popover, View Mode, Export */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-muted/30 border border-border/80 px-4 py-2 rounded-xl">
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
            <span className="inline-flex items-center gap-1 px-3 py-1 rounded-md bg-primary/10 text-primary text-xs font-medium border border-primary/20">
              <Layers className="w-3 h-3" /> Grouped by {allFields.find((f) => f.id === groupByFieldId)?.label || groupByFieldId}
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full lg:w-auto">
          {/* View Mode Toggle: Grid, Pivot, Chart, Plant QA */}
          <div className="flex items-center overflow-x-auto scrollbar-thin pb-1 bg-background border border-border rounded-lg p-0.5 max-w-full">
            <button
              type="button"
              onClick={() => setViewMode('GRID')}
              className={`shrink-0 whitespace-nowrap px-3 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5 ${
                viewMode === 'GRID'
                  ? 'bg-muted text-foreground font-semibold shadow-2xs'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <TableIcon className="w-3.5 h-3.5 shrink-0" /> Table Grid
            </button>
            <button
              type="button"
              onClick={() => setViewMode('PIVOT')}
              className={`shrink-0 whitespace-nowrap px-3 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5 ${
                viewMode === 'PIVOT'
                  ? 'bg-muted text-foreground font-semibold shadow-2xs'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <GridIcon className="w-3.5 h-3.5 shrink-0" /> Pivot Matrix
            </button>
            <button
              type="button"
              onClick={() => setViewMode('CHART')}
              className={`shrink-0 whitespace-nowrap px-3 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5 ${
                viewMode === 'CHART'
                  ? 'bg-muted text-foreground font-semibold shadow-2xs'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <BarChart3 className="w-3.5 h-3.5 shrink-0" /> Visual Charts
            </button>
            {isHeadOfMpd && (
              <button
                type="button"
                onClick={() => setViewMode('PLANT_QA')}
                className={`shrink-0 whitespace-nowrap px-3 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5 ${
                  viewMode === 'PLANT_QA'
                    ? 'bg-primary text-primary-foreground font-semibold shadow-2xs'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <FlaskConical className="w-3.5 h-3.5 shrink-0" /> Plant QA Audit
              </button>
            )}
          </div>

          {/* Export Dropdown Buttons */}
          <div className="flex flex-wrap items-center gap-2">
            {viewMode !== 'PLANT_QA' && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={isExporting || (queryData?.rows.length || 0) === 0}
                  onClick={() => handleExport('XLSX')}
                  className="h-9 px-3 text-xs font-medium shrink-0"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5 mr-1 text-emerald-600 shrink-0" />
                  {isExporting ? 'Exporting…' : 'Export Excel'}
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  disabled={isExporting || (queryData?.rows.length || 0) === 0}
                  onClick={() => handleExport('CSV')}
                  className="h-9 px-3 text-xs font-medium shrink-0"
                >
                  <FileText className="w-3.5 h-3.5 mr-1 text-secondary-foreground shrink-0" />
                  CSV
                </Button>
              </>
            )}

            <Button
              variant="outline"
              size="sm"
              onClick={() => window.print()}
              className="h-9 px-3 text-xs font-medium shrink-0"
            >
              <Printer className="w-3.5 h-3.5 mr-1 shrink-0" />
              Print
            </Button>

            <Button
              variant="outline"
              size="sm"
              disabled={isRefreshingViews}
              onClick={handleRefreshViews}
              className="h-9 px-3 text-xs font-medium text-primary border-action/30 hover:bg-primary/5 shrink-0"
              title="Refresh data"
            >
              {isRefreshingViews ? (
                <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin shrink-0" />
              ) : (
                <Database className="w-3.5 h-3.5 mr-1 shrink-0" />
              )}
              {isRefreshingViews ? 'Refreshing…' : 'Refresh Views'}
            </Button>
          </div>
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
          groupField={allFields.find((f) => f.id === groupByFieldId)}
          timeBucket={timeBucket}
          columnTotals={queryData?.columnTotals}
          groupedSubtotals={queryData?.groupedSubtotals}
          isLoading={isLoading}
        />
      )}

      {viewMode === 'PIVOT' && (
        <DynamicPivotGrid
          fields={allFields}
          config={pivotConfig}
          onChangeConfig={setPivotConfig}
          result={pivotQuery.data?.pivot}
          isLoading={pivotQuery.isFetching}
        />
      )}

      {viewMode === 'CHART' && (
        <DynamicReportVisualizer
          fields={queryData?.fields || allFields.filter((f) => selectedFieldIds.includes(f.id))}
          rows={queryData?.rows || []}
          groupedSubtotals={queryData?.groupedSubtotals}
        />
      )}

      {viewMode === 'PLANT_QA' && (
        <PlantQaComparisonView targetZmccId={effectiveFacilityId} />
      )}
    </div>
  );
}
