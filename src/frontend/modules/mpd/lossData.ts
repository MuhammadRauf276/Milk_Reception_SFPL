'use client';

import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { fetchJson } from '@/lib/fetch-json';
import { toast } from '@/frontend/lib/appToast';
import type { LossFilterOptions, LossLevels } from '@/backend/modules/management-reporting/lossLevelContracts';
import { lossQueryParams, type LossFilters } from './lossFilters';

const BASE = '/api/management/reports/loss-reconciliation';

/** The five levels for the chosen filters. Nothing else from the response is used. */
export function useLossLevels(filters: LossFilters) {
  const qs = lossQueryParams(filters).toString();
  return useQuery({
    queryKey: ['loss', 'levels', qs],
    queryFn: async ({ signal }) => {
      const body = await fetchJson<{ levels?: LossLevels }>(
        `${BASE}?${qs}`,
        { headers: { Accept: 'application/json' }, signal },
        'Loss and gain could not be loaded.'
      );
      return body.levels ?? null;
    },
    placeholderData: keepPreviousData,
  });
}

/** Pick-lists for the filter bar. Follows the date range only. */
export function useLossFilterOptions(filters: LossFilters) {
  const qs = lossQueryParams(filters, false).toString();
  return useQuery({
    queryKey: ['loss', 'filters', qs],
    queryFn: ({ signal }) =>
      fetchJson<LossFilterOptions>(`${BASE}/filters?${qs}`, { headers: { Accept: 'application/json' }, signal }, 'The filter lists could not be loaded.'),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
}

/** Downloads the Excel file for the same filters as the screen. */
export function useLossExport(filters: LossFilters) {
  const [exporting, setExporting] = useState(false);
  const run = async () => {
    setExporting(true);
    try {
      const res = await fetch(`${BASE}/export?${lossQueryParams(filters).toString()}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(typeof body?.error === 'string' && body.error ? body.error : 'Export download failed.');
      }
      const blob = await res.blob();
      const href = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = href;
      link.download = `Loss_Gain_${new Date().toISOString().split('T')[0]}.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(href);
    } catch (err: unknown) {
      toast.error('Export failed', { description: err instanceof Error ? err.message : 'Failed to download report.' });
    } finally {
      setExporting(false);
    }
  };
  return { exporting, run };
}
