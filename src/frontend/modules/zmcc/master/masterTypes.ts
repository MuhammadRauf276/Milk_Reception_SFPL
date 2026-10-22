import { fetchJson } from '@/lib/query/fetchJson';
import { getErrorMessage } from '@/lib/errors';

export type MasterDataTab = 'LOCAL_SUPPLIERS' | 'ROUTES' | 'AREAS' | 'MILK_SOURCES' | 'SHOPS' | 'CHILLER_OWNERSHIP' | 'TANKS' | 'APPROVALS';

export interface LocalSupplierItem {
  id: string;
  local_supplier_code: string;
  name: string;
  phone: string | null;
  cnic: string | null;
  zmcc_id: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  creator?: { id: string; username: string; full_name: string };
  updater?: { id: string; username: string; full_name: string } | null;
}

/** Any master-data row; the active tab decides which fields are present. */
export type MasterRecordFields = LocalSupplierItem & RouteItem & AreaItem & MilkSourceItem & ChillerOwnershipItem & ShopItem & TankItem;
export type MasterRecord = { [K in keyof MasterRecordFields]?: MasterRecordFields[K] | null } & { id: string };

export type MasterFormField =
  | 'name' | 'origin' | 'destination' | 'route_id' | 'area_id' | 'erp_code' | 'ownership_code'
  | 'shop_name' | 'owner_name' | 'phone_number' | 'cnic' | 'phone'
  | 'chiller_ownership_id' | 'latitude' | 'longitude'
  | 'tank_code' | 'tank_name' | 'capacity_liters'
  | 'vehicle_number' | 'vehicle_type' | 'category' | 'driver_name' | 'driver_phone';
export type MasterFormData = Partial<Record<MasterFormField, string | number>>;
export interface TankItem {
  id: string;
  zmcc_id: string;
  tank_code: string;
  tank_name: string;
  capacity_liters: number;
  current_stock: number;
  available_capacity: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  creator?: { id: string; username: string; full_name: string };
  updater?: { id: string; username: string; full_name: string } | null;
  zmcc?: { id: string; code: string; name: string };
}

export interface ZmccSource {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
}

export interface RouteItem {
  id: string;
  route_code: string;
  name: string;
  origin: string;
  destination: string;
  zmcc_id: string;
  is_active: boolean;
  creator_name: string;
  updater_name: string | null;
  area_count?: number;
  created_at: string;
}

export interface AreaItem {
  id: string;
  area_code: string;
  name: string;
  route_id: string;
  zmcc_id: string;
  route: { id: string; route_code: string; name: string; is_active: boolean };
  is_active: boolean;
  creator_name: string;
  updater_name: string | null;
  shop_count?: number;
  created_at: string;
}

export interface MilkSourceItem {
  id: string;
  /** Only present for the source owner roles (MPD Head, Data Executive, Super Admin). */
  erp_code?: string;
  name: string;
  is_active: boolean;
  creator_name?: string;
  updater_name?: string | null;
  created_at?: string;
}

export interface ChillerOwnershipItem {
  id: string;
  ownership_code: string;
  name: string;
  is_active: boolean;
  creator_name: string;
  updater_name: string | null;
  shop_count?: number;
  created_at: string;
}

export interface ShopItem {
  id: string;
  shop_code: string;
  shop_name: string;
  owner_name: string;
  phone_number: string;
  cnic: string;
  area_id: string;
  route_id: string;
  zmcc_id: string;
  chiller_ownership_id: string;
  latitude: number | null;
  longitude: number | null;
  is_active: boolean;
  area: { id: string; area_code: string; name: string; is_active: boolean };
  chiller_ownership: { id: string; ownership_code: string; name: string; is_active: boolean };
  creator_name: string;
  updater_name: string | null;
  created_at: string;
}

export interface MasterDataFilters {
  /** Only sent for Super Admins; managers are scoped server-side. */
  zmccId: string;
  status: 'all' | 'true' | 'false';
  search: string;
  routeId: string;
  areaId: string;
  /** 1-based page for the paginated tabs (shops, local suppliers). */
  page: number;
}

export const MASTER_PAGE_SIZE = 50;

export interface MasterPagination {
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
}

export type MasterDataResult = (
  | { tab: 'LOCAL_SUPPLIERS'; items: LocalSupplierItem[] }
  | { tab: 'ROUTES'; items: RouteItem[] }
  | { tab: 'AREAS'; items: AreaItem[] }
  | { tab: 'MILK_SOURCES'; items: MilkSourceItem[] }
  | { tab: 'CHILLER_OWNERSHIP'; items: ChillerOwnershipItem[] }
  | { tab: 'SHOPS'; items: ShopItem[] }
  | { tab: 'TANKS'; items: TankItem[] }
) & { pagination?: MasterPagination | null };

/** Fetches the rows for one master-data tab with the given filters. */
export async function fetchMasterData(tab: MasterDataTab, filters: MasterDataFilters, signal?: AbortSignal): Promise<MasterDataResult> {
  const zmccParam = filters.zmccId ? `&zmcc_id=${filters.zmccId}` : '';
  const statusParam = filters.status !== 'all' ? `&is_active=${filters.status}` : '';
  const searchParam = filters.search ? `&search=${encodeURIComponent(filters.search)}` : '';
  const pageParam = `&page=${filters.page}&page_size=${MASTER_PAGE_SIZE}`;

  const getJson = async (url: string, fallbackError: string) => {
    try {
      return await fetchJson<any>(url, { signal }); // eslint-disable-line @typescript-eslint/no-explicit-any
    } catch (err) {
      if (signal?.aborted) throw err;
      throw new Error(getErrorMessage(err) || fallbackError);
    }
  };

  if (tab === 'LOCAL_SUPPLIERS') {
    const data = await getJson(`/api/zmcc/hc-suppliers?${zmccParam}${statusParam}${searchParam}${pageParam}`, 'Failed to fetch HC suppliers');
    return { tab, items: data.suppliers || [], pagination: data.pagination ?? null };
  }
  if (tab === 'ROUTES') {
    const data = await getJson(`/api/zmcc/routes?${zmccParam}${statusParam}${searchParam}`, 'Failed to fetch routes');
    return { tab, items: data.routes || [] };
  }
  if (tab === 'AREAS') {
    const rParam = filters.routeId ? `&route_id=${filters.routeId}` : '';
    const data = await getJson(`/api/zmcc/areas?${zmccParam}${statusParam}${searchParam}${rParam}`, 'Failed to fetch areas');
    return { tab, items: data.areas || [] };
  }
  if (tab === 'MILK_SOURCES') {
    const data = await getJson(`/api/zmcc/milk-sources?${zmccParam}${statusParam}${searchParam}`, 'Failed to fetch milk sources');
    return { tab, items: data.milk_sources || [] };
  }
  if (tab === 'CHILLER_OWNERSHIP') {
    const data = await getJson(`/api/zmcc/chiller-ownerships?${statusParam}${searchParam}`, 'Failed to fetch chiller ownerships');
    return { tab, items: data.chiller_ownerships || [] };
  }
  if (tab === 'SHOPS') {
    const rParam = filters.routeId ? `&route_id=${filters.routeId}` : '';
    const aParam = filters.areaId ? `&area_id=${filters.areaId}` : '';
    const data = await getJson(
      `/api/zmcc/shops?${zmccParam}${statusParam}${searchParam}${rParam}${aParam}${pageParam}`,
      'Failed to fetch shops'
    );
    return { tab, items: data.shops || [], pagination: data.pagination ?? null };
  }
  const activeOnlyParam = filters.status === 'true' ? '&active_only=true' : '';
  const data = await getJson(`/api/zmcc/tanks?${zmccParam}${activeOnlyParam}`, 'Failed to fetch tanks');
  let tankList: TankItem[] = data.tanks || [];
  if (filters.status === 'false') {
    tankList = tankList.filter((t) => !t.is_active);
  }
  if (filters.search) {
    const s = filters.search.toLowerCase();
    tankList = tankList.filter((t) => t.tank_name.toLowerCase().includes(s) || t.tank_code.toLowerCase().includes(s));
  }
  return { tab: 'TANKS', items: tankList };
}

export type MasterModalType =
  | 'CREATE_ROUTE' | 'EDIT_ROUTE'
  | 'CREATE_AREA' | 'EDIT_AREA'
  | 'CREATE_MILK_SOURCE' | 'EDIT_MILK_SOURCE'
  | 'CREATE_CHILLER' | 'EDIT_CHILLER'
  | 'CREATE_SHOP' | 'EDIT_SHOP'
  | 'CREATE_TANK' | 'EDIT_TANK'
  | 'CREATE_LOCAL_SUPPLIER' | 'EDIT_LOCAL_SUPPLIER'
  | 'TOGGLE_ACTIVE';
