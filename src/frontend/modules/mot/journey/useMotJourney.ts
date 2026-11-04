'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { fetchJson } from '@/lib/query/fetchJson';
import type { User } from '@core/types';
import { resolveCurrentJourney } from './resolveJourney';
import { EMPTY_COVER, type CoverJourneyOption, type CurrentJourney } from './types';

/**
 * The current journey (online with offline fallback), plus the journey list a covering superior can choose from.
 * A superior covering MOT work is online only, on the chosen journey, with nothing cached.
 */
export function useMotJourney(currentUser: User | null, isOnline: boolean) {
  const searchParams = useSearchParams();
  const zmccId = searchParams?.get('zmccId') || searchParams?.get('zmcc_id') || currentUser?.procurement_source_id || '';
  const [journey, setJourney] = useState<CurrentJourney | null>(null);
  const [loadingJourney, setLoadingJourney] = useState(true);
  const [journeyError, setJourneyError] = useState<string | null>(null);
  const [coverJourneyId, setCoverJourneyId] = useState<string | null>(null);

  const isCovering = Boolean(currentUser && currentUser.role !== 'MOT');

  const loadCurrentJourney = useCallback(
    () =>
      resolveCurrentJourney(isCovering ? { journeyId: coverJourneyId } : undefined)
        .then((result) => {
          if (result.journey !== undefined) setJourney(result.journey);
          setJourneyError(result.error);
        })
        .finally(() => setLoadingJourney(false)),
    [isCovering, coverJourneyId]
  );

  useEffect(() => {
    if (currentUser) {
      loadCurrentJourney();
    }
  }, [currentUser, loadCurrentJourney]);

  // Journeys a superior can cover (collecting, own ZMCC; the server applies scope).
  const coverUrl = zmccId
    ? `/api/zmcc/mot/journeys?status=COLLECTING,RETURNING&zmcc_id=${encodeURIComponent(zmccId)}`
    : '/api/zmcc/mot/journeys?status=COLLECTING,RETURNING';

  const coverQuery = useQuery({
    queryKey: ['mot', 'cover-journeys', zmccId],
    queryFn: ({ signal }) =>
      fetchJson<{ journeys?: CoverJourneyOption[] }>(coverUrl, { signal }),
    enabled: Boolean(currentUser && isCovering && isOnline),
    staleTime: 15_000,
  });
  const coverJourneys: CoverJourneyOption[] = Array.isArray(coverQuery.data?.journeys)
    ? (coverQuery.data!.journeys as CoverJourneyOption[])
    : EMPTY_COVER;
  const coverListError = coverQuery.error ? (coverQuery.error as Error).message || 'Could not load journeys.' : null;

  const selectCoverJourney = (value: string) => {
    setLoadingJourney(true);
    setJourney(null);
    setCoverJourneyId(value || null);
  };

  return {
    journey,
    setJourney,
    loadingJourney,
    journeyError,
    reloadJourney: loadCurrentJourney,
    isCovering,
    coverJourneyId,
    coverJourneys,
    coverListError,
    selectCoverJourney,
  };
}
