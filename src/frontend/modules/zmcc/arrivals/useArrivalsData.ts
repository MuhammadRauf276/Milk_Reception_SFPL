'use client';

import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchJson } from '@/lib/query/fetchJson';
import { useDebouncedValue } from '@/frontend/modules/super-admin/shared/useDebouncedValue';
import type { InsideVehicle } from '@/backend/services/zmccArrival/zmccArrivalCore';
import type {
  ArrivingJourney,
  HcArrivalRow,
  HcSupplierRow,
  MainTab,
  McArrivalRow,
  PolicyMode,
} from './arrivalTypes';

type HistoryPage<T> = { items?: T[]; total?: number; totalPages?: number } | null;

interface Args {
  activeTab: MainTab;
  canSubmit: boolean;
  correctionOpen: boolean;
  zmccSourceId?: string;
  historyDate: string;
  historySearch: string;
  historyPage: number;
  historyPageSize: number;
}

/** All TanStack queries used by the ZMCC arrivals workspace. */
export function useArrivalsData(a: Args) {
  const queryClient = useQueryClient();
  const zmccParam = a.zmccSourceId ? `?zmcc_id=${encodeURIComponent(a.zmccSourceId)}` : '';

  const journeysQuery = useQuery({
    queryKey: ['zmcc', 'arrivals', 'arriving-journeys', a.zmccSourceId],
    enabled: a.canSubmit && a.activeTab === 'MC_ARRIVAL',
    queryFn: ({ signal }) => fetchJson<ArrivingJourney[]>(`/api/zmcc/arrivals/arriving-journeys${zmccParam}`, { signal }),
  });

  const needsSuppliers = a.canSubmit && (a.activeTab === 'HC_ARRIVAL' || a.correctionOpen);
  const localSuppliersUrl = a.zmccSourceId
    ? `/api/zmcc/hc-suppliers?is_active=true&zmcc_id=${encodeURIComponent(a.zmccSourceId)}`
    : '/api/zmcc/hc-suppliers?is_active=true';
  const localSuppliersQuery = useQuery({
    queryKey: ['zmcc', 'hc-suppliers', 'active', a.zmccSourceId],
    enabled: needsSuppliers,
    queryFn: ({ signal }) => fetchJson<{ suppliers?: HcSupplierRow[] }>(localSuppliersUrl, { signal }),
  });
  const addLocalSupplierToCache = (supplier: HcSupplierRow) =>
    queryClient.setQueryData<{ suppliers?: HcSupplierRow[] }>(['zmcc', 'hc-suppliers', 'active', a.zmccSourceId], (prev) => ({
      ...(prev ?? {}),
      suppliers: [supplier, ...(prev?.suppliers ?? [])],
    }));

  const insideQuery = useQuery({
    queryKey: ['zmcc', 'arrivals', 'inside', a.zmccSourceId],
    enabled: a.activeTab === 'INSIDE_ZMCC',
    queryFn: ({ signal }) =>
      fetchJson<{ vehicles?: InsideVehicle[]; has_more?: boolean; total_count?: number }>(
        `/api/zmcc/arrivals/inside${zmccParam}`,
        { signal }
      ),
    refetchInterval: () => (typeof document !== 'undefined' && document.hidden ? false : 30_000),
  });

  const debouncedHistorySearch = useDebouncedValue(a.historySearch, 300);
  const historyParams = new URLSearchParams();
  if (a.zmccSourceId) historyParams.set('zmcc_id', a.zmccSourceId);
  if (a.historyDate) historyParams.set('date', a.historyDate);
  if (debouncedHistorySearch) historyParams.set('search', debouncedHistorySearch);
  historyParams.set('page', String(a.historyPage));
  historyParams.set('pageSize', String(a.historyPageSize));
  const historyQuery = historyParams.toString();
  const historyResult = useQuery({
    queryKey: ['zmcc', 'arrivals', 'history', historyQuery],
    enabled: a.activeTab === 'HISTORY',
    placeholderData: keepPreviousData,
    queryFn: async ({ signal }) => {
      const [mc, hc] = await Promise.all([
        fetchJson<HistoryPage<McArrivalRow>>(`/api/zmcc/arrivals/mot?${historyQuery}`, { signal }).catch(() => null),
        fetchJson<HistoryPage<HcArrivalRow>>(`/api/zmcc/arrivals/hc?${historyQuery}`, { signal }).catch(() => null),
      ]);
      const parts = [mc, hc];
      return {
        mcArrivals: mc?.items ?? [],
        hcArrivals: hc?.items ?? [],
        totalRecords: parts.reduce((n, d) => n + (d?.total || 0), 0),
        totalPages: parts.reduce((n, d) => Math.max(n, d?.totalPages || 1), 1),
      };
    },
  });

  const policiesQuery = useQuery({
    queryKey: ['paper-reference-policies'],
    staleTime: 5 * 60_000,
    queryFn: ({ signal }) =>
      fetchJson<{ policies?: Array<{ referenceType: string; policyMode?: PolicyMode }> }>('/api/paper-reference-policies', { signal }),
  });
  const rawMilkTokenPolicyMode: PolicyMode =
    (policiesQuery.data?.policies || []).find((p) => p.referenceType === 'RAW_MILK_TOKEN')?.policyMode ?? 'REQUIRED';

  const insideVehicles = insideQuery.data?.vehicles ?? [];
  return {
    arrivingJourneys: Array.isArray(journeysQuery.data) ? journeysQuery.data : [],
    loadingJourneys: journeysQuery.isFetching,
    fetchArrivingJourneys: () => journeysQuery.refetch(),
    localSuppliers: localSuppliersQuery.data?.suppliers ?? [],
    loadingLocalSuppliers: localSuppliersQuery.isFetching,
    addLocalSupplierToCache,
    insideVehicles,
    insideHasMore: Boolean(insideQuery.data?.has_more),
    insideTotalCount: insideQuery.data?.total_count ?? insideVehicles.length,
    loadingInside: insideQuery.isFetching,
    fetchInsideVehicles: () => insideQuery.refetch(),
    mcArrivals: historyResult.data?.mcArrivals ?? [],
    hcArrivals: historyResult.data?.hcArrivals ?? [],
    historyTotalRecords: historyResult.data?.totalRecords ?? 0,
    historyTotalPages: historyResult.data?.totalPages ?? 1,
    loadingHistory: historyResult.isFetching,
    fetchHistory: () => historyResult.refetch(),
    rawMilkTokenPolicyMode,
  };
}
