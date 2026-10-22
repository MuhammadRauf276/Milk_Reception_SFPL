import { useQuery } from '@tanstack/react-query';
import { fetchJson } from '@/lib/query/fetchJson';

/** Online-only read; polls every 30s while the tab is visible and the device is online. */
export function useArrivingJourneys() {
  const { data, error, isLoading, refetch } = useQuery({
    queryKey: ['zmcc', 'arriving-journeys'],
    queryFn: ({ signal }) => fetchJson<any[]>('/api/zmcc/arrivals/arriving-journeys', { signal }),
    refetchInterval: () =>
      typeof document !== 'undefined' && (document.hidden || !navigator.onLine) ? false : 30_000,
  });

  return {
    arrivingJourneys: data || [],
    isLoading,
    isError: error,
    refresh: refetch,
  };
}
