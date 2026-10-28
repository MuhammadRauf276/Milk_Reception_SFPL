/**
 * Centralized TanStack Query Key Factory for Milk Reception Workspaces.
 *
 * Guarantees that query caches are scoped strictly by:
 * - Domain / Station
 * - Active Facility / Procurement Source ID (preventing cross-facility "ghost data")
 * - Specific Queue / View / Active Tab
 * - Search / Pagination filters
 */

export const stationQueryKeys = {
  // Security Gateway
  security: {
    all: (facilityId?: string | null) => ['security', facilityId || 'active'] as const,
    queue: (
      facilityId: string | null | undefined,
      queueType: 'dispatched' | 'active' | 'exit',
      search = ''
    ) => ['security', facilityId || 'active', queueType, search.trim()] as const,
  },

  // Production Unloading
  production: {
    all: (facilityId?: string | null) => ['production', facilityId || 'active'] as const,
    queue: (
      facilityId: string | null | undefined,
      queueType: 'ready' | 'unloading',
      search = ''
    ) => ['production', facilityId || 'active', queueType, search.trim()] as const,
    silos: (facilityId?: string | null) => ['production', facilityId || 'active', 'silos'] as const,
  },

  // ZMCC Master Data & Operations
  zmcc: {
    sources: (targetSourceType?: string | null) =>
      ['zmcc', 'sources', targetSourceType || 'ALL'] as const,
    contractors: () => ['zmcc', 'contractors'] as const,
    master: (
      tab: string,
      filters: Record<string, unknown> = {},
      facilityId?: string | null
    ) => ['zmcc', 'master', facilityId || 'active', tab, filters] as const,
    helpers: {
      routes: (facilityId?: string | null) =>
        ['zmcc', 'helper', 'routes', facilityId || 'active'] as const,
      areas: (facilityId?: string | null) =>
        ['zmcc', 'helper', 'areas', facilityId || 'active'] as const,
      chillers: () => ['zmcc', 'helper', 'chillers'] as const,
    },
  },

  // Executive Dashboard
  executive: {
    overview: () => ['mpd', 'executive-overview'] as const,
  },
};
