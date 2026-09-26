import useSWR from 'swr';
import { fetcher } from '../lib/fetcher';

export function useArrivingJourneys() {
  const { data, error, isLoading, mutate } = useSWR('/api/zmcc/arrivals/arriving-journeys', fetcher, {
    refreshInterval: 15000, 
    revalidateOnFocus: true,
  });

  return {
    arrivingJourneys: data || [],
    isLoading,
    isError: error,
    refresh: mutate
  };
}
