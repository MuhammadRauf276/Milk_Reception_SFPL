'use client';

import { useSyncExternalStore } from 'react';
import { useQuery } from '@tanstack/react-query';
import { User } from '@/backend/core/types';
import { fetchJson } from '@/lib/query/fetchJson';

interface AuthMeResponse {
  user: User | null;
}

const subscribeNever = () => () => {};

/**
 * Universal cached hook for current authenticated user.
 * Cached in TanStack Query so switching pages or routes never triggers
 * redundant network waterfalls or full-screen loading flashes.
 */
export function useCurrentUser() {
  const query = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: async ({ signal }) => {
      const data = await fetchJson<AuthMeResponse>('/api/auth/me', { signal });
      return data.user ?? null;
    },
    staleTime: 5 * 60_000, // 5 minutes fresh
    gcTime: 30 * 60_000, // Keep in memory for 30 minutes
    refetchOnWindowFocus: false,
    retry: 1,
  });

  // The server never knows the user. A slow part of the page can hydrate after the user has loaded elsewhere,
  // so hold the answer back until hydration ends, or that first render would not match the server's HTML.
  const hydrated = useSyncExternalStore(subscribeNever, () => true, () => false);

  return {
    currentUser: hydrated ? query.data ?? null : null,
    loadingUser: !hydrated || query.isLoading,
    isError: query.isError,
    error: query.error,
    refetchUser: query.refetch,
  };
}
