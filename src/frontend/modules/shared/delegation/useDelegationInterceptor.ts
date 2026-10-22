'use client';

import { useEffect } from 'react';

/**
 * Automatically decorates outgoing `/api/*` fetch requests with `x-acting-as` and
 * `x-acting-source-id` headers whenever operating in delegated mode (§5.6).
 *
 * Automatically restores the original `window.fetch` on unmount or when delegation changes.
 */
export function useDelegationInterceptor(
  isDelegated: boolean,
  actingAs: string | null,
  actingSourceId?: string | null
) {
  useEffect(() => {
    if (!isDelegated || !actingAs || typeof window === 'undefined') {
      return;
    }

    const originalFetch = window.fetch;

    window.fetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
      try {
        const urlStr =
          typeof input === 'string'
            ? input
            : input instanceof URL
            ? input.toString()
            : input.url;

        // Only decorate relative or same-origin API requests
        if (urlStr.startsWith('/api/') || urlStr.includes('/api/')) {
          const headers = new Headers(
            init.headers ||
              (typeof input === 'object' && 'headers' in input ? (input as Request).headers : {})
          );

          if (!headers.has('x-acting-as')) {
            headers.set('x-acting-as', actingAs);
          }

          if (actingSourceId && !headers.has('x-acting-source-id')) {
            headers.set('x-acting-source-id', actingSourceId);
          }

          init = {
            ...init,
            headers,
          };
        }
      } catch (_err) {
        // Fallback silently to unmodified request if URL parsing fails
      }

      return originalFetch(input, init);
    };

    return () => {
      window.fetch = originalFetch;
    };
  }, [isDelegated, actingAs, actingSourceId]);
}
