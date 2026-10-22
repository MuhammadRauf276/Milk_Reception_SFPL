import { fetchJson } from '@/lib/query/fetchJson';
import type { JourneyItem, MotProfileItem, MotVehicleItem, MotWorkspaceTab, RouteOption } from './types';

/** Tabs whose lists are loaded by fetchMotTabData. */
export const MOT_DATA_TABS = new Set<MotWorkspaceTab>(['DISPATCH', 'ACTIVE_JOURNEYS', 'JOURNEY_HISTORY', 'PROFILES', 'VEHICLES']);

/** Fetches the lists a MOT operations tab shows; only the lists that tab needs are returned. */
export async function fetchMotTabData(
  tab: MotWorkspaceTab,
  zmccId: string | null | undefined,
  historyStatusFilter: string,
  signal?: AbortSignal
): Promise<{
  routes?: RouteOption[];
  profiles?: MotProfileItem[];
  vehicles?: MotVehicleItem[];
  journeys?: JourneyItem[];
}> {
  const zmccParam = zmccId ? `zmcc_id=${zmccId}` : '';
  const getJson = (url: string, signal?: AbortSignal) => fetchJson<any>(url, { signal });

  if (tab === 'DISPATCH') {
    // Load active routes, active profiles, active vehicles
    const [rData, pData, vData] = await Promise.all([
      getJson(`/api/zmcc/routes?${zmccParam}&is_active=true`, signal),
      getJson(`/api/zmcc/mot/profiles?${zmccParam}&is_active=true`, signal),
      getJson(`/api/zmcc/mot/vehicles?${zmccParam}&is_active=true`, signal),
    ]);
    return { routes: rData.routes || [], profiles: pData.profiles || [], vehicles: vData.vehicles || [] };
  }
  if (tab === 'ACTIVE_JOURNEYS') {
    const data = await getJson(`/api/zmcc/mot/journeys?${zmccParam}&status=COLLECTING`, signal);
    return { journeys: data.journeys || [] };
  }
  if (tab === 'JOURNEY_HISTORY') {
    const statusParam = historyStatusFilter !== 'all' ? `&status=${historyStatusFilter}` : '';
    const data = await getJson(`/api/zmcc/mot/journeys?${zmccParam}${statusParam}`, signal);
    return { journeys: data.journeys || [] };
  }
  if (tab === 'PROFILES') {
    const data = await getJson(`/api/zmcc/mot/profiles?${zmccParam}`, signal);
    return { profiles: data.profiles || [] };
  }
  if (tab === 'VEHICLES') {
    const data = await getJson(`/api/zmcc/mot/vehicles?${zmccParam}`, signal);
    return { vehicles: data.vehicles || [] };
  }
  return {};
}
