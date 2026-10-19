'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { User } from '@core/types';
import {
  MapPin,
  Route as RouteIcon,
  Store,
  Milk,
  Building2,
  Search,
  Plus,
  Edit2,
  Power,
  AlertCircle,
  CheckCircle2,
  Loader2,
  X,
  Users,
  Truck,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react';
import { Modal } from '@/components/ui/modal';
import { SegmentedTabs } from '@/components/ui/segmented-tabs';
import { AnimatePresence } from 'framer-motion';
import { getErrorMessage } from '@/lib/errors';
import { PendingApprovalsPanel } from './approvals/PendingApprovalsPanel';

export type MasterDataTab = 'LOCAL_SUPPLIERS' | 'ROUTES' | 'AREAS' | 'MILK_SOURCES' | 'SHOPS' | 'CHILLER_OWNERSHIP' | 'TANKS' | 'APPROVALS';

interface LocalSupplierItem {
  id: string;
  local_supplier_code: string;
  name: string;
  phone: string | null;
  cnic: string | null;
  erp_reference: string | null;
  erp_mapping_status: string;
  zmcc_id: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  creator?: { id: string; username: string; full_name: string };
  updater?: { id: string; username: string; full_name: string } | null;
}

/** Any master-data row; the active tab decides which fields are present. */
type MasterRecordFields = LocalSupplierItem & RouteItem & AreaItem & MilkSourceItem & ChillerOwnershipItem & ShopItem & TankItem;
type MasterRecord = { [K in keyof MasterRecordFields]?: MasterRecordFields[K] | null } & { id: string };

type MasterFormField =
  | 'name' | 'origin' | 'destination' | 'route_id' | 'area_id' | 'erp_code' | 'ownership_code'
  | 'shop_name' | 'owner_name' | 'phone_number' | 'cnic' | 'phone' | 'erp_reference'
  | 'milk_source_id' | 'chiller_ownership_id' | 'latitude' | 'longitude'
  | 'tank_code' | 'tank_name' | 'capacity_liters'
  | 'vehicle_number' | 'vehicle_type' | 'category' | 'driver_name' | 'driver_phone';
type MasterFormData = Partial<Record<MasterFormField, string | number>>;

interface ZmccMasterDataWorkspaceProps {
  currentUser: User | null;
  initialTab?: MasterDataTab;
  activeTab?: MasterDataTab;
  onTabChange?: (tab: MasterDataTab) => void;
  hideTabBar?: boolean;
}

interface TankItem {
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

interface ZmccSource {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
}

interface RouteItem {
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

interface AreaItem {
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

interface MilkSourceItem {
  id: string;
  erp_code: string;
  name: string;
  zmcc_id: string;
  is_active: boolean;
  creator_name: string;
  updater_name: string | null;
  shop_count?: number;
  created_at: string;
}

interface ChillerOwnershipItem {
  id: string;
  ownership_code: string;
  name: string;
  is_active: boolean;
  creator_name: string;
  updater_name: string | null;
  shop_count?: number;
  created_at: string;
}

interface ShopItem {
  id: string;
  shop_code: string;
  shop_name: string;
  owner_name: string;
  phone_number: string;
  cnic: string;
  area_id: string;
  route_id: string;
  zmcc_id: string;
  milk_source_id: string;
  chiller_ownership_id: string;
  latitude: number | null;
  longitude: number | null;
  is_active: boolean;
  area: { id: string; area_code: string; name: string; is_active: boolean };
  milk_source: { id: string; erp_code: string; name: string; is_active: boolean };
  chiller_ownership: { id: string; ownership_code: string; name: string; is_active: boolean };
  creator_name: string;
  updater_name: string | null;
  created_at: string;
}

interface MasterDataFilters {
  /** Only sent for Super Admins; managers are scoped server-side. */
  zmccId: string;
  status: 'all' | 'true' | 'false';
  search: string;
  routeId: string;
  areaId: string;
  milkSourceId: string;
}

type MasterDataResult =
  | { tab: 'LOCAL_SUPPLIERS'; items: LocalSupplierItem[] }
  | { tab: 'ROUTES'; items: RouteItem[] }
  | { tab: 'AREAS'; items: AreaItem[] }
  | { tab: 'MILK_SOURCES'; items: MilkSourceItem[] }
  | { tab: 'CHILLER_OWNERSHIP'; items: ChillerOwnershipItem[] }
  | { tab: 'SHOPS'; items: ShopItem[] }
  | { tab: 'TANKS'; items: TankItem[] };

/** Fetches the rows for one master-data tab with the given filters. */
async function fetchMasterData(tab: MasterDataTab, filters: MasterDataFilters): Promise<MasterDataResult> {
  const zmccParam = filters.zmccId ? `&zmcc_id=${filters.zmccId}` : '';
  const statusParam = filters.status !== 'all' ? `&is_active=${filters.status}` : '';
  const searchParam = filters.search ? `&search=${encodeURIComponent(filters.search)}` : '';

  const getJson = async (url: string, fallbackError: string) => {
    const res = await fetch(url);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || fallbackError);
    return data;
  };

  if (tab === 'LOCAL_SUPPLIERS') {
    const data = await getJson(`/api/zmcc/local-suppliers?${zmccParam}${statusParam}${searchParam}`, 'Failed to fetch local suppliers');
    return { tab, items: data.suppliers || [] };
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
    const sParam = filters.milkSourceId ? `&milk_source_id=${filters.milkSourceId}` : '';
    const data = await getJson(
      `/api/zmcc/shops?${zmccParam}${statusParam}${searchParam}${rParam}${aParam}${sParam}`,
      'Failed to fetch shops'
    );
    return { tab, items: data.shops || [] };
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

export const ZmccMasterDataWorkspace: React.FC<ZmccMasterDataWorkspaceProps> = ({
  currentUser,
  initialTab,
  activeTab: controlledTab,
  onTabChange,
  hideTabBar = true,
}) => {
  const isSuperAdmin = currentUser?.role === 'SUPER_ADMIN';
  const isDataExecutive = currentUser?.role === 'DATA_EXECUTIVE';
  const isZmccManager = currentUser?.role === 'ZMCC_MANAGER';
  const isPheOperator = currentUser?.role === 'PHE_OPERATOR';
  const canEditMaster = isDataExecutive || isSuperAdmin;

  // Tabs permitted
  const permittedTabs: { id: MasterDataTab; label: string; icon: LucideIcon }[] = React.useMemo(() => {
    if (isPheOperator) {
      return [
        { id: 'LOCAL_SUPPLIERS', label: 'Local Suppliers', icon: Users },
        { id: 'SHOPS', label: 'Shop Details (Reference)', icon: Store },
        { id: 'APPROVALS', label: 'Pending Approvals', icon: ShieldCheck },
      ];
    }
    const tabs: { id: MasterDataTab; label: string; icon: LucideIcon }[] = [
      { id: 'LOCAL_SUPPLIERS', label: 'Local Suppliers', icon: Users },
      { id: 'ROUTES', label: 'Routes', icon: RouteIcon },
      { id: 'AREAS', label: 'Areas', icon: MapPin },
      { id: 'MILK_SOURCES', label: 'Milk Sources', icon: Milk },
      { id: 'SHOPS', label: 'Shop Details', icon: Store },
    ];
    if (isSuperAdmin || isDataExecutive) {
      tabs.push({ id: 'CHILLER_OWNERSHIP', label: 'Chiller Ownership', icon: Building2 });
    }
    if (isSuperAdmin || isDataExecutive || isZmccManager) {
      tabs.push({ id: 'TANKS', label: 'Tanks', icon: Building2 });
    }
    tabs.push({ id: 'APPROVALS', label: 'Approvals', icon: ShieldCheck });
    return tabs;
  }, [isSuperAdmin, isDataExecutive, isZmccManager, isPheOperator]);

  const [internalTab, setInternalTab] = useState<MasterDataTab>(
    controlledTab || initialTab || 'LOCAL_SUPPLIERS'
  );
  const activeTab = controlledTab || internalTab;

  const setActiveTab = (tab: MasterDataTab) => {
    setInternalTab(tab);
    if (onTabChange) onTabChange(tab);
  };

  // ZMCC Scope
  const [sources, setSources] = useState<ZmccSource[]>([]);
  const [selectedZmccId, setSelectedZmccId] = useState<string>('');

  const currentZmccName =
    currentUser?.procurement_source?.name ||
    sources.find((s) => s.id === selectedZmccId)?.name ||
    'Assigned ZMCC';

  // Data states
  const [localSuppliersList, setLocalSuppliersList] = useState<LocalSupplierItem[]>([]);
  const [routes, setRoutes] = useState<RouteItem[]>([]);
  const [areas, setAreas] = useState<AreaItem[]>([]);
  const [milkSources, setMilkSources] = useState<MilkSourceItem[]>([]);
  const [chillerOwnerships, setChillerOwnerships] = useState<ChillerOwnershipItem[]>([]);
  const [shops, setShops] = useState<ShopItem[]>([]);
  const [tanks, setTanks] = useState<TankItem[]>([]);

  // Filtering states
  const [search, setSearch] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'true' | 'false'>('all');
  const [routeFilter, setRouteFilter] = useState<string>('');
  const [areaFilter, setAreaFilter] = useState<string>('');
  const [sourceFilter, setSourceFilter] = useState<string>('');

  // A parent-driven tab change starts the new tab with cleared filters.
  const [previousControlledTab, setPreviousControlledTab] = useState(controlledTab);
  if (controlledTab !== previousControlledTab) {
    setPreviousControlledTab(controlledTab);
    if (controlledTab) {
      setInternalTab(controlledTab);
      setSearch('');
      setStatusFilter('all');
      setRouteFilter('');
      setAreaFilter('');
      setSourceFilter('');
    }
  }

  // UI state
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Modals state
  const [modalType, setModalType] = useState<
    'CREATE_ROUTE' | 'EDIT_ROUTE' |
    'CREATE_AREA' | 'EDIT_AREA' |
    'CREATE_MILK_SOURCE' | 'EDIT_MILK_SOURCE' |
    'CREATE_CHILLER' | 'EDIT_CHILLER' |
    'CREATE_SHOP' | 'EDIT_SHOP' |
    'CREATE_TANK' | 'EDIT_TANK' |
    'CREATE_LOCAL_SUPPLIER' | 'EDIT_LOCAL_SUPPLIER' |
    'REGISTER_SUBSTITUTE_VEHICLE' |
    'TOGGLE_ACTIVE' | null
  >(null);

  const [activeRecord, setActiveRecord] = useState<MasterRecord | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  // Form Fields
  const [formData, setFormData] = useState<MasterFormData>({});

  // 1. Fetch ZMCC sources
  useEffect(() => {
    async function loadSources() {
      try {
        const res = await fetch('/api/zmcc/sources');
        if (res.ok) {
          const data = await res.json();
          setSources(data.zmccs || []);
          if (data.zmccs && data.zmccs.length > 0) {
            setSelectedZmccId(data.zmccs[0].id);
          }
        }
      } catch (err) {
        console.error('Failed to load ZMCC sources', err);
      }
    }
    loadSources();
  }, []);

  // Fetch scoped reference data
  const dataFilters = useMemo<MasterDataFilters>(
    () => ({
      zmccId: isSuperAdmin ? selectedZmccId : '',
      status: statusFilter,
      search,
      routeId: routeFilter,
      areaId: areaFilter,
      milkSourceId: sourceFilter,
    }),
    [isSuperAdmin, selectedZmccId, statusFilter, search, routeFilter, areaFilter, sourceFilter]
  );
  const dataRequestKey = JSON.stringify([activeTab, dataFilters]);
  // Tab + filters whose request last settled; any other key means a fetch is in flight.
  const [loadedDataKey, setLoadedDataKey] = useState<string | null>(null);
  const loading = loadedDataKey !== dataRequestKey;

  const loadData = useCallback(() => {
    const requestKey = JSON.stringify([activeTab, dataFilters]);
    if (activeTab === 'APPROVALS') {
      setLoadedDataKey(requestKey);
      return Promise.resolve();
    }
    return fetchMasterData(activeTab, dataFilters)
      .then(
        (result) => {
          if (result.tab === 'LOCAL_SUPPLIERS') setLocalSuppliersList(result.items);
          else if (result.tab === 'ROUTES') setRoutes(result.items);
          else if (result.tab === 'AREAS') setAreas(result.items);
          else if (result.tab === 'MILK_SOURCES') setMilkSources(result.items);
          else if (result.tab === 'CHILLER_OWNERSHIP') setChillerOwnerships(result.items);
          else if (result.tab === 'SHOPS') setShops(result.items);
          else setTanks(result.items);
          setErrorMsg(null);
        },
        (err) => setErrorMsg(getErrorMessage(err) || 'Error loading data.')
      )
      .finally(() => setLoadedDataKey(requestKey));
  }, [activeTab, dataFilters]);

  // Load dropdown helper data for Shop and Area forms
  const [helperRoutes, setHelperRoutes] = useState<RouteItem[]>([]);
  const [helperAreas, setHelperAreas] = useState<AreaItem[]>([]);
  const [helperMilkSources, setHelperMilkSources] = useState<MilkSourceItem[]>([]);
  const [helperChillers, setHelperChillers] = useState<ChillerOwnershipItem[]>([]);

  const loadHelperData = useCallback(() => {
    const zmccParam = isSuperAdmin && selectedZmccId ? `&zmcc_id=${selectedZmccId}` : '';
    return Promise.all([
      fetch(`/api/zmcc/routes?is_active=true${zmccParam}`),
      fetch(`/api/zmcc/areas?is_active=true${zmccParam}`),
      fetch(`/api/zmcc/milk-sources?is_active=true${zmccParam}`),
      fetch('/api/zmcc/chiller-ownerships?is_active=true'),
    ])
      .then(async ([rRes, aRes, mRes, cRes]) => {
        if (rRes.ok) {
          const d = await rRes.json();
          setHelperRoutes(d.routes || []);
        }
        if (aRes.ok) {
          const d = await aRes.json();
          setHelperAreas(d.areas || []);
        }
        if (mRes.ok) {
          const d = await mRes.json();
          setHelperMilkSources(d.milk_sources || []);
        }
        if (cRes.ok) {
          const d = await cRes.json();
          setHelperChillers(d.chiller_ownerships || []);
        }
      })
      .catch((err) => {
        console.error('Failed loading helper data', err);
      });
  }, [isSuperAdmin, selectedZmccId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    loadHelperData();
  }, [loadHelperData]);

  // When selected ZMCC changes for Super Admin, clear dependent filters
  const handleZmccChange = (zmccId: string) => {
    setSelectedZmccId(zmccId);
    setRouteFilter('');
    setAreaFilter('');
    setSourceFilter('');
    setSearch('');
  };

  const closeModal = () => {
    setModalType(null);
    setActiveRecord(null);
    setModalError(null);
    setFormData({});
  };

  const handleOpenCreateModal = () => {
    setModalError(null);
    setFormData({});
    if (activeTab === 'LOCAL_SUPPLIERS') setModalType('CREATE_LOCAL_SUPPLIER');
    if (activeTab === 'ROUTES') {
      setFormData({
        origin: currentZmccName,
        destination: 'Main Plant',
      });
      setModalType('CREATE_ROUTE');
    }
    if (activeTab === 'AREAS') setModalType('CREATE_AREA');
    if (activeTab === 'MILK_SOURCES') setModalType('CREATE_MILK_SOURCE');
    if (activeTab === 'CHILLER_OWNERSHIP') setModalType('CREATE_CHILLER');
    if (activeTab === 'SHOPS') setModalType('CREATE_SHOP');
    if (activeTab === 'TANKS') setModalType('CREATE_TANK');
  };

  const handleOpenEditModal = (item: MasterRecord) => {
    setModalError(null);
    setActiveRecord(item);
    if (activeTab === 'LOCAL_SUPPLIERS') {
      setFormData({
        name: item.name ?? '',
        phone: item.phone || '',
        cnic: item.cnic || '',
        erp_reference: item.erp_reference || '',
      });
      setModalType('EDIT_LOCAL_SUPPLIER');
    } else if (activeTab === 'ROUTES') {
      setFormData({ name: item.name ?? '', origin: item.origin ?? '', destination: item.destination ?? '' });
      setModalType('EDIT_ROUTE');
    } else if (activeTab === 'AREAS') {
      setFormData({ name: item.name ?? '' });
      setModalType('EDIT_AREA');
    } else if (activeTab === 'MILK_SOURCES') {
      setFormData({ name: item.name ?? '' });
      setModalType('EDIT_MILK_SOURCE');
    } else if (activeTab === 'CHILLER_OWNERSHIP') {
      setFormData({ name: item.name ?? '' });
      setModalType('EDIT_CHILLER');
    } else if (activeTab === 'SHOPS') {
      setFormData({
        shop_name: item.shop_name ?? '',
        owner_name: item.owner_name ?? '',
        phone_number: item.phone_number ?? '',
        cnic: item.cnic ?? '',
        area_id: item.area_id ?? '',
        route_id: item.route_id ?? '',
        milk_source_id: item.milk_source_id ?? '',
        chiller_ownership_id: item.chiller_ownership_id ?? '',
        latitude: item.latitude ?? '',
        longitude: item.longitude ?? '',
      });
      setModalType('EDIT_SHOP');
    } else if (activeTab === 'TANKS') {
      setFormData({
        tank_code: item.tank_code ?? '',
        tank_name: item.tank_name ?? '',
        capacity_liters: item.capacity_liters ?? '',
      });
      setModalType('EDIT_TANK');
    }
  };

  const handleOpenToggleModal = (item: MasterRecord) => {
    setModalError(null);
    setActiveRecord(item);
    setModalType('TOGGLE_ACTIVE');
  };

  // Submit handlers
  const handleModalSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setModalError(null);

    try {
      let url = '';
      let method = 'POST';
      let body: Record<string, unknown> = {};

      if (modalType === 'CREATE_ROUTE') {
        url = '/api/zmcc/routes';
        body = {
          name: formData.name,
          origin: formData.origin || currentZmccName,
          destination: formData.destination || 'Main Plant',
          zmcc_id: isSuperAdmin ? selectedZmccId : undefined,
        };
      } else if (modalType === 'EDIT_ROUTE') {
        url = `/api/zmcc/routes/${activeRecord?.id}`;
        method = 'PATCH';
        body = {
          name: formData.name,
          origin: formData.origin,
          destination: formData.destination,
        };
      } else if (modalType === 'CREATE_AREA') {
        url = '/api/zmcc/areas';
        body = {
          name: formData.name,
          route_id: formData.route_id,
        };
      } else if (modalType === 'EDIT_AREA') {
        url = `/api/zmcc/areas/${activeRecord?.id}`;
        method = 'PATCH';
        body = { name: formData.name };
      } else if (modalType === 'CREATE_MILK_SOURCE') {
        url = '/api/zmcc/milk-sources';
        body = {
          erp_code: formData.erp_code,
          name: formData.name,
          zmcc_id: isSuperAdmin ? selectedZmccId : undefined,
        };
      } else if (modalType === 'EDIT_MILK_SOURCE') {
        url = `/api/zmcc/milk-sources/${activeRecord?.id}`;
        method = 'PATCH';
        body = { name: formData.name };
      } else if (modalType === 'CREATE_CHILLER') {
        url = '/api/zmcc/chiller-ownerships';
        body = {
          ownership_code: formData.ownership_code,
          name: formData.name,
        };
      } else if (modalType === 'EDIT_CHILLER') {
        url = `/api/zmcc/chiller-ownerships/${activeRecord?.id}`;
        method = 'PATCH';
        body = { name: formData.name };
      } else if (modalType === 'CREATE_SHOP') {
        url = '/api/zmcc/shops';
        body = {
          shop_name: formData.shop_name,
          owner_name: formData.owner_name,
          phone_number: formData.phone_number,
          cnic: formData.cnic,
          area_id: formData.area_id,
          milk_source_id: formData.milk_source_id,
          chiller_ownership_id: formData.chiller_ownership_id,
          latitude: formData.latitude !== '' && formData.latitude != null ? Number(formData.latitude) : null,
          longitude: formData.longitude !== '' && formData.longitude != null ? Number(formData.longitude) : null,
        };
      } else if (modalType === 'EDIT_SHOP') {
        url = `/api/zmcc/shops/${activeRecord?.id}`;
        method = 'PATCH';
        body = {
          shop_name: formData.shop_name,
          owner_name: formData.owner_name,
          phone_number: formData.phone_number,
          cnic: formData.cnic,
          area_id: formData.area_id,
          milk_source_id: formData.milk_source_id,
          chiller_ownership_id: formData.chiller_ownership_id,
          latitude: formData.latitude !== '' && formData.latitude != null ? Number(formData.latitude) : null,
          longitude: formData.longitude !== '' && formData.longitude != null ? Number(formData.longitude) : null,
        };
      } else if (modalType === 'CREATE_LOCAL_SUPPLIER') {
        url = '/api/zmcc/local-suppliers';
        body = {
          name: formData.name,
          phone: formData.phone || undefined,
          cnic: formData.cnic || undefined,
          erp_reference: formData.erp_reference || undefined,
          milk_source_id: formData.milk_source_id && formData.milk_source_id !== 'UNKNOWN_ERP' ? formData.milk_source_id : undefined,
          zmcc_id: isSuperAdmin ? selectedZmccId : undefined,
        };
      } else if (modalType === 'REGISTER_SUBSTITUTE_VEHICLE') {
        url = '/api/zmcc/mot/vehicles';
        body = {
          vehicle_number: formData.vehicle_number,
          vehicle_type: formData.vehicle_type,
          capacity_liters: Number(formData.capacity_liters),
          driver_name: formData.driver_name,
          driver_phone: formData.driver_phone,
          category: 'EMERGENCY_SUBSTITUTE',
          zmcc_id: isSuperAdmin ? selectedZmccId : undefined,
        };
      } else if (modalType === 'EDIT_LOCAL_SUPPLIER') {
        url = `/api/zmcc/local-suppliers/${activeRecord?.id}`;
        method = 'PATCH';
        body = {
          name: formData.name,
          phone: formData.phone !== undefined ? formData.phone : undefined,
          cnic: formData.cnic !== undefined ? formData.cnic : undefined,
          erp_reference: formData.erp_reference !== undefined ? formData.erp_reference : undefined,
        };
      } else if (modalType === 'CREATE_TANK') {
        url = '/api/zmcc/tanks';
        body = {
          tank_code: formData.tank_code,
          tank_name: formData.tank_name,
          capacity_liters: Number(formData.capacity_liters),
          zmcc_id: isSuperAdmin ? selectedZmccId : undefined,
        };
      } else if (modalType === 'EDIT_TANK') {
        url = `/api/zmcc/tanks/${activeRecord?.id}`;
        method = 'PATCH';
        body = {
          tank_code: formData.tank_code,
          tank_name: formData.tank_name,
          capacity_liters: formData.capacity_liters !== undefined ? Number(formData.capacity_liters) : undefined,
        };
      } else if (modalType === 'TOGGLE_ACTIVE') {
        const targetActive = !activeRecord?.is_active;
        if (activeTab === 'LOCAL_SUPPLIERS') url = `/api/zmcc/local-suppliers/${activeRecord?.id}`;
        else if (activeTab === 'ROUTES') url = `/api/zmcc/routes/${activeRecord?.id}`;
        else if (activeTab === 'AREAS') url = `/api/zmcc/areas/${activeRecord?.id}`;
        else if (activeTab === 'MILK_SOURCES') url = `/api/zmcc/milk-sources/${activeRecord?.id}`;
        else if (activeTab === 'CHILLER_OWNERSHIP') url = `/api/zmcc/chiller-ownerships/${activeRecord?.id}`;
        else if (activeTab === 'SHOPS') url = `/api/zmcc/shops/${activeRecord?.id}`;
        else if (activeTab === 'TANKS') url = `/api/zmcc/tanks/${activeRecord?.id}`;
        method = 'PATCH';
        body = { is_active: targetActive };
      }

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const resJson = await res.json();
      if (!res.ok) {
        throw new Error(resJson.error || 'Operation failed.');
      }

      setSuccessMsg('Record saved successfully.');
      setTimeout(() => setSuccessMsg(null), 3000);
      closeModal();
      loadData();
      loadHelperData();
    } catch (err: unknown) {
      setModalError(err instanceof Error ? err.message : 'An error occurred.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6 max-w-full overflow-x-hidden">
      {/* Header Banner */}
      <div className="bg-white p-5 rounded-xl border border-border shadow-2xs flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-blue-50 text-primary rounded-xl border border-blue-200">
              <Store className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-lg sm:text-xl font-semibold text-foreground">
                {isPheOperator ? 'PHE Shop Station' : 'ZMCC master data'}
              </h1>
              <p className="text-xs font-medium text-slate-500">
                {isPheOperator
                  ? 'Manage and maintain collection shops within your assigned ZMCC.'
                  : 'Manage routes, collection areas, milk sources, shops, and chiller ownership.'}
              </p>
            </div>
          </div>
        </div>

        {/* ZMCC Context selector or Fixed Badge */}
        <div className="flex items-center gap-3">
          {isSuperAdmin ? (
            <div className="flex items-center gap-2 bg-subtle px-3.5 py-2 rounded-xl border border-border">
              <span className="text-xs font-semibold text-slate-600 uppercase tracking-wider">Target ZMCC:</span>
              <select
                value={selectedZmccId}
                onChange={(e) => handleZmccChange(e.target.value)}
                className="bg-transparent text-xs font-semibold text-foreground focus:outline-hidden cursor-pointer min-h-[36px]"
                aria-label="Select Target ZMCC"
              >
                {sources.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} · {s.code}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="flex items-center gap-2 bg-blue-50 px-3.5 py-2 rounded-xl border border-blue-200">
              <span className="text-xs font-semibold text-primary uppercase tracking-wider">Scope:</span>
              <span className="text-xs font-semibold text-foreground">
                {currentZmccName} ({currentUser?.procurement_source?.code || 'ZMCC'})
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Success/Error Banners */}
      {successMsg && (
        <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl text-xs font-semibold text-emerald-800 flex items-center gap-2 animate-panel-in">
          <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
          <span>{successMsg}</span>
        </div>
      )}
      {errorMsg && (
        <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-xl text-xs font-semibold text-rose-800 flex items-center gap-2 animate-panel-in">
          <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Navigation Tabs (Only if more than 1 tab and not hidden) */}
      {!hideTabBar && permittedTabs.length > 1 && (
        <SegmentedTabs
          label="Master data sections"
          value={activeTab}
          onValueChange={(tab) => {
            setActiveTab(tab);
            setSearch('');
            setStatusFilter('all');
            setRouteFilter('');
            setAreaFilter('');
            setSourceFilter('');
          }}
          tabs={permittedTabs.map((t) => ({ value: t.id, label: t.label, icon: t.icon }))}
        />
      )}

      {activeTab === 'APPROVALS' ? (
        <div id="tabpanel-APPROVALS" role="tabpanel" aria-labelledby="tab-APPROVALS" className="space-y-6 animate-panel-in">
          <PendingApprovalsPanel
            currentUser={currentUser}
            showRoutes={isSuperAdmin || isZmccManager}
            showShops={true}
            onRefreshParent={loadData}
          />
        </div>
      ) : (
        <>
          <div className="bg-white p-4 rounded-xl border border-border flex flex-col md:flex-row md:items-center justify-between gap-3 shadow-2xs">
        <div className="flex flex-wrap items-center gap-2.5 flex-1">
          {/* Search */}
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search code or name…"
              className="w-full pl-9 pr-3 py-2 min-h-[44px] bg-subtle border border-border rounded-xl text-xs font-medium text-foreground placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-primary"
            />
          </div>

          {/* Status Filter */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'all' | 'true' | 'false')}
            className="px-3 py-2 min-h-[44px] bg-subtle border border-border rounded-xl text-xs font-semibold text-slate-700 focus:outline-hidden focus:ring-2 focus:ring-primary"
            aria-label="Filter by Status"
          >
            <option value="all">All statuses</option>
            <option value="true">Active</option>
            <option value="false">Inactive</option>
          </select>

          {/* Area Filter on Shops */}
          {activeTab === 'SHOPS' && (
            <>
              <select
                value={routeFilter}
                onChange={(e) => {
                  setRouteFilter(e.target.value);
                  setAreaFilter('');
                }}
                className="px-3 py-2 min-h-[44px] bg-subtle border border-border rounded-xl text-xs font-semibold text-slate-700 focus:outline-hidden focus:ring-2 focus:ring-primary"
                aria-label="Filter by Route"
              >
                <option value="">All routes</option>
                {helperRoutes.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} · {r.route_code}
                  </option>
                ))}
              </select>

              <select
                value={areaFilter}
                onChange={(e) => setAreaFilter(e.target.value)}
                className="px-3 py-2 min-h-[44px] bg-subtle border border-border rounded-xl text-xs font-semibold text-slate-700 focus:outline-hidden focus:ring-2 focus:ring-primary"
                aria-label="Filter by Area"
              >
                <option value="">All areas</option>
                {helperAreas
                  .filter((a) => !routeFilter || a.route_id === routeFilter)
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} · {a.area_code}
                    </option>
                  ))}
              </select>
            </>
          )}

          {/* Route Filter on Areas */}
          {activeTab === 'AREAS' && (
            <select
              value={routeFilter}
              onChange={(e) => setRouteFilter(e.target.value)}
              className="px-3 py-2 min-h-[44px] bg-subtle border border-border rounded-xl text-xs font-semibold text-slate-700 focus:outline-hidden focus:ring-2 focus:ring-primary"
              aria-label="Filter Areas by Route"
            >
              <option value="">All routes</option>
              {helperRoutes.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} · {r.route_code}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Action Button: Add Entity */}
        {((isSuperAdmin || isDataExecutive) ||
          (isZmccManager && activeTab !== 'CHILLER_OWNERSHIP' && activeTab !== 'TANKS') ||
          (isPheOperator && (activeTab === 'SHOPS' || activeTab === 'LOCAL_SUPPLIERS'))) && (
          <button
            type="button"
            onClick={handleOpenCreateModal}
            className="flex items-center justify-center gap-2 px-4 py-2 min-h-[44px] bg-primary text-white rounded-xl text-xs font-semibold hover:bg-primary-hover transition shadow-2xs shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span>
              {activeTab === 'LOCAL_SUPPLIERS' && 'Add Local Supplier'}
              {activeTab === 'ROUTES' && 'Add Route'}
              {activeTab === 'AREAS' && 'Add Area'}
              {activeTab === 'MILK_SOURCES' && 'Add Milk Source'}
              {activeTab === 'CHILLER_OWNERSHIP' && 'Add Chiller Ownership'}
              {activeTab === 'SHOPS' && 'Add Shop'}
              {activeTab === 'TANKS' && 'Add Tank'}
            </span>
          </button>
        )}

        {/* Pakistani Emergency Substitute Vehicle Registration */}
        {(isSuperAdmin || isDataExecutive || isZmccManager) && (
          <button
            type="button"
            onClick={() => {
              setModalError(null);
              setFormData({
                vehicle_type: 'SUZUKI_PICKUP',
                category: 'EMERGENCY_SUBSTITUTE',
              });
              setModalType('REGISTER_SUBSTITUTE_VEHICLE');
            }}
            className="flex items-center justify-center gap-2 px-4 py-2 min-h-[44px] bg-amber-600 text-white rounded-xl text-xs font-semibold hover:bg-amber-700 transition shadow-2xs shrink-0"
          >
            <Truck className="w-4 h-4" />
            <span>Register Substitute Vehicle</span>
          </button>
        )}
      </div>

      {/* Main Content Table (keyed so switching sections replays the entrance) */}
      <div key={activeTab} className="bg-white rounded-xl border border-border shadow-2xs overflow-hidden animate-panel-in">
        {loading ? (
          <div className="p-12 text-center flex flex-col items-center justify-center text-slate-500 space-y-2">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
            <span className="text-xs font-semibold">Loading master data…</span>
          </div>
        ) : (
          <div className="overflow-x-auto">
            {activeTab === 'LOCAL_SUPPLIERS' && (
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-subtle border-b border-border text-slate-600 font-semibold uppercase text-xs tracking-wider">
                    <th className="py-3 px-4">Supplier Code</th>
                    <th className="py-3 px-4">Supplier Name</th>
                    <th className="py-3 px-4">Phone</th>
                    <th className="py-3 px-4">CNIC</th>
                    <th className="py-3 px-4">Candidate ERP Ref</th>
                    <th className="py-3 px-4 text-center">ERP Status</th>
                    <th className="py-3 px-4 text-center">Status</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {localSuppliersList.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-8 text-center text-slate-400 font-semibold">
                        No local suppliers found. Click &quot;Add Local Supplier&quot; to register one.
                      </td>
                    </tr>
                  ) : (
                    localSuppliersList.map((s) => (
                      <tr key={s.id} className="hover:bg-subtle/60 transition">
                        <td className="py-3 px-4 tabular-nums font-semibold text-primary">{s.local_supplier_code}</td>
                        <td className="py-3 px-4 font-semibold text-foreground">{s.name}</td>
                        <td className="py-3 px-4 tabular-nums text-slate-600">{s.phone || '-'}</td>
                        <td className="py-3 px-4 tabular-nums text-slate-600">{s.cnic || '-'}</td>
                        <td className="py-3 px-4">
                          {s.erp_reference ? (
                            <span className="tabular-nums font-semibold text-slate-800 bg-slate-100 px-2 py-0.5 rounded text-[11px]">
                              {s.erp_reference}
                            </span>
                          ) : (
                            <span className="text-slate-400 italic">None</span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-center">
                          <span className="px-2 py-0.5 rounded-full text-xs font-semibold uppercase bg-amber-50 text-amber-700 border border-amber-200">
                            {s.erp_mapping_status || 'PENDING'}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-center">
                          <span
                            className={`px-2.5 py-1 rounded-full text-xs font-semibold uppercase ${
                              s.is_active
                                ? 'bg-emerald-100 text-emerald-800'
                                : 'bg-rose-100 text-rose-800'
                            }`}
                          >
                            {s.is_active ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right">
                          {!canEditMaster ? (
                            <span className="text-[11px] text-slate-400 font-medium italic">Read-only</span>
                          ) : (
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                type="button"
                                onClick={() => handleOpenEditModal(s)}
                                className="p-2 min-h-[36px] min-w-[36px] rounded-lg border border-border hover:bg-slate-100 text-slate-700 transition"
                                title="Edit Local Supplier"
                              >
                                <Edit2 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleOpenToggleModal(s)}
                                className={`p-2 min-h-[36px] min-w-[36px] rounded-lg border transition ${
                                  s.is_active
                                    ? 'border-rose-200 text-rose-600 hover:bg-rose-50'
                                    : 'border-emerald-200 text-emerald-600 hover:bg-emerald-50'
                                }`}
                                title={s.is_active ? 'Deactivate Local Supplier' : 'Activate Local Supplier'}
                              >
                                <Power className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            )}

            {activeTab === 'ROUTES' && (
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-subtle border-b border-border text-slate-600 font-semibold uppercase text-xs tracking-wider">
                    <th className="py-3 px-4">Route Code</th>
                    <th className="py-3 px-4">Route Name</th>
                    <th className="py-3 px-4">Origin</th>
                    <th className="py-3 px-4">Destination</th>
                    <th className="py-3 px-4 text-center">Areas</th>
                    <th className="py-3 px-4 text-center">Status</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {routes.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-slate-400 font-semibold">
                        No routes found. Click &quot;Add Route&quot; to create one.
                      </td>
                    </tr>
                  ) : (
                    routes.map((r) => (
                      <tr key={r.id} className="hover:bg-subtle/60 transition">
                        <td className="py-3 px-4 tabular-nums font-semibold text-foreground">{r.route_code}</td>
                        <td className="py-3 px-4 font-semibold text-foreground">{r.name}</td>
                        <td className="py-3 px-4 text-slate-600">{r.origin}</td>
                        <td className="py-3 px-4 text-slate-600">{r.destination}</td>
                        <td className="py-3 px-4 text-center font-semibold tabular-nums">{r.area_count || 0}</td>
                        <td className="py-3 px-4 text-center">
                          <span
                            className={`px-2.5 py-1 rounded-full text-xs font-semibold uppercase ${
                              r.is_active
                                ? 'bg-emerald-100 text-emerald-800'
                                : 'bg-rose-100 text-rose-800'
                            }`}
                          >
                            {r.is_active ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right">
                          {!canEditMaster ? (
                            <span className="text-[11px] text-slate-400 font-medium italic">Read-only</span>
                          ) : (
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                type="button"
                                onClick={() => handleOpenEditModal(r)}
                                className="p-2 min-h-[36px] min-w-[36px] rounded-lg border border-border hover:bg-slate-100 text-slate-700 transition"
                                title="Edit Route"
                              >
                                <Edit2 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleOpenToggleModal(r)}
                                className={`p-2 min-h-[36px] min-w-[36px] rounded-lg border transition ${
                                  r.is_active
                                    ? 'border-rose-200 text-rose-600 hover:bg-rose-50'
                                    : 'border-emerald-200 text-emerald-600 hover:bg-emerald-50'
                                }`}
                                title={r.is_active ? 'Deactivate Route' : 'Activate Route'}
                              >
                                <Power className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            )}

            {activeTab === 'AREAS' && (
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-subtle border-b border-border text-slate-600 font-semibold uppercase text-xs tracking-wider">
                    <th className="py-3 px-4">Area Code</th>
                    <th className="py-3 px-4">Area Name</th>
                    <th className="py-3 px-4">Route</th>
                    <th className="py-3 px-4 text-center">Shops</th>
                    <th className="py-3 px-4 text-center">Status</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {areas.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-slate-400 font-semibold">
                        No areas found. Click &quot;Add Area&quot; to create one.
                      </td>
                    </tr>
                  ) : (
                    areas.map((a) => (
                      <tr key={a.id} className="hover:bg-subtle/60 transition">
                        <td className="py-3 px-4 tabular-nums font-semibold text-foreground">{a.area_code}</td>
                        <td className="py-3 px-4 font-semibold text-foreground">{a.name}</td>
                        <td className="py-3 px-4 text-slate-600">
                          {a.route.name} <span className="text-xs tabular-nums text-slate-400">({a.route.route_code})</span>
                        </td>
                        <td className="py-3 px-4 text-center font-semibold tabular-nums">{a.shop_count || 0}</td>
                        <td className="py-3 px-4 text-center">
                          <span
                            className={`px-2.5 py-1 rounded-full text-xs font-semibold uppercase ${
                              a.is_active
                                ? 'bg-emerald-100 text-emerald-800'
                                : 'bg-rose-100 text-rose-800'
                            }`}
                          >
                            {a.is_active ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right">
                          {!canEditMaster ? (
                            <span className="text-[11px] text-slate-400 font-medium italic">Read-only</span>
                          ) : (
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                type="button"
                                onClick={() => handleOpenEditModal(a)}
                                className="p-2 min-h-[36px] min-w-[36px] rounded-lg border border-border hover:bg-slate-100 text-slate-700 transition"
                                title="Edit Area"
                              >
                                <Edit2 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleOpenToggleModal(a)}
                                className={`p-2 min-h-[36px] min-w-[36px] rounded-lg border transition ${
                                  a.is_active
                                    ? 'border-rose-200 text-rose-600 hover:bg-rose-50'
                                    : 'border-emerald-200 text-emerald-600 hover:bg-emerald-50'
                                }`}
                                title={a.is_active ? 'Deactivate Area' : 'Activate Area'}
                              >
                                <Power className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            )}

            {activeTab === 'MILK_SOURCES' && (
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-subtle border-b border-border text-slate-600 font-semibold uppercase text-xs tracking-wider">
                    <th className="py-3 px-4">ERP Code</th>
                    <th className="py-3 px-4">Source Name</th>
                    <th className="py-3 px-4 text-center">Shops</th>
                    <th className="py-3 px-4 text-center">Status</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {milkSources.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-slate-400 font-semibold">
                        No milk sources found. Click &quot;Add Milk Source&quot; to create one.
                      </td>
                    </tr>
                  ) : (
                    milkSources.map((ms) => (
                      <tr key={ms.id} className="hover:bg-subtle/60 transition">
                        <td className="py-3 px-4 tabular-nums font-semibold text-foreground">{ms.erp_code}</td>
                        <td className="py-3 px-4 font-semibold text-foreground">{ms.name}</td>
                        <td className="py-3 px-4 text-center font-semibold tabular-nums">{ms.shop_count || 0}</td>
                        <td className="py-3 px-4 text-center">
                          <span
                            className={`px-2.5 py-1 rounded-full text-xs font-semibold uppercase ${
                              ms.is_active
                                ? 'bg-emerald-100 text-emerald-800'
                                : 'bg-rose-100 text-rose-800'
                            }`}
                          >
                            {ms.is_active ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right">
                          {!canEditMaster ? (
                            <span className="text-[11px] text-slate-400 font-medium italic">Read-only</span>
                          ) : (
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                type="button"
                                onClick={() => handleOpenEditModal(ms)}
                                className="p-2 min-h-[36px] min-w-[36px] rounded-lg border border-border hover:bg-slate-100 text-slate-700 transition"
                                title="Edit Milk Source"
                              >
                                <Edit2 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleOpenToggleModal(ms)}
                                className={`p-2 min-h-[36px] min-w-[36px] rounded-lg border transition ${
                                  ms.is_active
                                    ? 'border-rose-200 text-rose-600 hover:bg-rose-50'
                                    : 'border-emerald-200 text-emerald-600 hover:bg-emerald-50'
                                }`}
                                title={ms.is_active ? 'Deactivate Milk Source' : 'Activate Milk Source'}
                              >
                                <Power className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            )}

            {activeTab === 'CHILLER_OWNERSHIP' && (
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-subtle border-b border-border text-slate-600 font-semibold uppercase text-xs tracking-wider">
                    <th className="py-3 px-4">Ownership Code</th>
                    <th className="py-3 px-4">Owner / Brand Name</th>
                    <th className="py-3 px-4 text-center">Shops Assigned</th>
                    <th className="py-3 px-4 text-center">Status</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {chillerOwnerships.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-slate-400 font-semibold">
                        No chiller ownerships found.
                      </td>
                    </tr>
                  ) : (
                    chillerOwnerships.map((co) => (
                      <tr key={co.id} className="hover:bg-subtle/60 transition">
                        <td className="py-3 px-4 tabular-nums font-semibold text-foreground">{co.ownership_code}</td>
                        <td className="py-3 px-4 font-semibold text-foreground">{co.name}</td>
                        <td className="py-3 px-4 text-center font-semibold tabular-nums">{co.shop_count || 0}</td>
                        <td className="py-3 px-4 text-center">
                          <span
                            className={`px-2.5 py-1 rounded-full text-xs font-semibold uppercase ${
                              co.is_active
                                ? 'bg-emerald-100 text-emerald-800'
                                : 'bg-rose-100 text-rose-800'
                            }`}
                          >
                            {co.is_active ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right">
                          {!canEditMaster ? (
                            <span className="text-[11px] text-slate-400 font-medium italic">Read-only</span>
                          ) : (
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                type="button"
                                onClick={() => handleOpenEditModal(co)}
                                className="p-2 min-h-[36px] min-w-[36px] rounded-lg border border-border hover:bg-slate-100 text-slate-700 transition"
                                title="Edit Chiller Ownership"
                              >
                                <Edit2 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleOpenToggleModal(co)}
                                className={`p-2 min-h-[36px] min-w-[36px] rounded-lg border transition ${
                                  co.is_active
                                    ? 'border-rose-200 text-rose-600 hover:bg-rose-50'
                                    : 'border-emerald-200 text-emerald-600 hover:bg-emerald-50'
                                }`}
                                title={co.is_active ? 'Deactivate Chiller Ownership' : 'Activate Chiller Ownership'}
                              >
                                <Power className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            )}

            {activeTab === 'SHOPS' && (
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-subtle border-b border-border text-slate-600 font-semibold uppercase text-xs tracking-wider">
                    <th className="py-3 px-4">Shop Code</th>
                    <th className="py-3 px-4">Shop Name</th>
                    <th className="py-3 px-4">Owner / Contractor</th>
                    <th className="py-3 px-4">Contact</th>
                    <th className="py-3 px-4">Area & Route</th>
                    <th className="py-3 px-4">Source</th>
                    <th className="py-3 px-4">Chiller</th>
                    <th className="py-3 px-4 text-center">Status</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {shops.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="py-8 text-center text-slate-400 font-semibold">
                        No shops found. Click &quot;Add Shop&quot; to register a collection shop.
                      </td>
                    </tr>
                  ) : (
                    shops.map((s) => (
                      <tr key={s.id} className="hover:bg-subtle/60 transition">
                        <td className="py-3 px-4 tabular-nums font-semibold text-foreground">{s.shop_code}</td>
                        <td className="py-3 px-4 font-semibold text-foreground">{s.shop_name}</td>
                        <td className="py-3 px-4 font-medium text-slate-700">{s.owner_name}</td>
                        <td className="py-3 px-4 tabular-nums text-slate-600">{s.phone_number}</td>
                        <td className="py-3 px-4 text-slate-700">{s.area.name}</td>
                        <td className="py-3 px-4 text-slate-700 font-medium">{s.milk_source.name}</td>
                        <td className="py-3 px-4 text-slate-700 font-medium">{s.chiller_ownership.name}</td>
                        <td className="py-3 px-4 text-center">
                          <span
                            className={`px-2.5 py-1 rounded-full text-xs font-semibold uppercase ${
                              s.is_active
                                ? 'bg-emerald-100 text-emerald-800'
                                : 'bg-rose-100 text-rose-800'
                            }`}
                          >
                            {s.is_active ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right">
                          {!canEditMaster ? (
                            <span className="text-[11px] text-slate-400 font-medium italic">Read-only</span>
                          ) : (
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                type="button"
                                onClick={() => handleOpenEditModal(s)}
                                className="p-2 min-h-[36px] min-w-[36px] rounded-lg border border-border hover:bg-slate-100 text-slate-700 transition"
                                title="Edit Shop"
                              >
                                <Edit2 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleOpenToggleModal(s)}
                                className={`p-2 min-h-[36px] min-w-[36px] rounded-lg border transition ${
                                  s.is_active
                                    ? 'border-rose-200 text-rose-600 hover:bg-rose-50'
                                    : 'border-emerald-200 text-emerald-600 hover:bg-emerald-50'
                                }`}
                                title={s.is_active ? 'Deactivate Shop' : 'Activate Shop'}
                              >
                                <Power className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            )}

            {activeTab === 'TANKS' && (
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-subtle border-b border-border text-slate-600 font-semibold uppercase text-xs tracking-wider">
                    <th className="py-3 px-4">Tank Code</th>
                    <th className="py-3 px-4">Tank Name</th>
                    <th className="py-3 px-4 text-right">Capacity (L)</th>
                    <th className="py-3 px-4 text-right">Current Stock (L)</th>
                    <th className="py-3 px-4 text-right">Available Capacity (L)</th>
                    <th className="py-3 px-4 text-center">Status</th>
                    {canEditMaster && <th className="py-3 px-4 text-right">Actions</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {tanks.length === 0 ? (
                    <tr>
                      <td colSpan={canEditMaster ? 7 : 6} className="py-8 text-center text-slate-400 font-semibold">
                        No ZMCC tanks found.
                      </td>
                    </tr>
                  ) : (
                    tanks.map((tank) => (
                      <tr key={tank.id} className="hover:bg-subtle/60 transition">
                        <td className="py-3 px-4 tabular-nums font-semibold text-foreground">{tank.tank_code}</td>
                        <td className="py-3 px-4 font-semibold text-foreground">{tank.tank_name}</td>
                        <td className="py-3 px-4 text-right tabular-nums font-semibold">{Number(tank.capacity_liters).toFixed(2)} L</td>
                        <td className="py-3 px-4 text-right tabular-nums font-semibold text-blue-700">{Number(tank.current_stock).toFixed(2)} L</td>
                        <td className="py-3 px-4 text-right tabular-nums font-semibold text-emerald-700">{Number(tank.available_capacity).toFixed(2)} L</td>
                        <td className="py-3 px-4 text-center">
                          <span
                            className={`px-2.5 py-1 rounded-full text-xs font-semibold uppercase ${
                              tank.is_active
                                ? 'bg-emerald-100 text-emerald-800'
                                : 'bg-rose-100 text-rose-800'
                            }`}
                          >
                            {tank.is_active ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        {canEditMaster && (
                          <td className="py-3 px-4 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                type="button"
                                onClick={() => handleOpenEditModal(tank)}
                                className="p-2 min-h-[36px] min-w-[36px] rounded-lg border border-border hover:bg-slate-100 text-slate-700 transition"
                                title="Edit Tank"
                              >
                                <Edit2 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleOpenToggleModal(tank)}
                                className={`p-2 min-h-[36px] min-w-[36px] rounded-lg border transition ${
                                  tank.is_active
                                    ? 'border-rose-200 text-rose-600 hover:bg-rose-50'
                                    : 'border-emerald-200 text-emerald-600 hover:bg-emerald-50'
                                }`}
                                title={tank.is_active ? 'Deactivate Tank' : 'Activate Tank'}
                              >
                                <Power className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        )}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
      </>
    )}

      {/* MODALS */}
      <AnimatePresence>{modalType && (
        <Modal key="modal-0" onClose={closeModal} title="ZMCC master data record" className="max-w-lg p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-border">
              <h2 id="modal-title" className="text-base font-semibold text-foreground">
                {modalType === 'CREATE_LOCAL_SUPPLIER' && 'Register Local Supplier'}
                {modalType === 'EDIT_LOCAL_SUPPLIER' && `Edit Local Supplier: ${activeRecord?.local_supplier_code}`}
                {modalType === 'CREATE_ROUTE' && 'Create New Route'}
                {modalType === 'EDIT_ROUTE' && `Edit Route: ${activeRecord?.route_code}`}
                {modalType === 'CREATE_AREA' && 'Create Collection Area'}
                {modalType === 'EDIT_AREA' && `Edit Area: ${activeRecord?.area_code}`}
                {modalType === 'CREATE_MILK_SOURCE' && 'Create Milk Source'}
                {modalType === 'EDIT_MILK_SOURCE' && `Edit Milk Source: ${activeRecord?.erp_code}`}
                {modalType === 'CREATE_CHILLER' && 'Create Chiller Ownership Option'}
                {modalType === 'EDIT_CHILLER' && `Edit Chiller Ownership: ${activeRecord?.ownership_code}`}
                {modalType === 'CREATE_SHOP' && 'Register Collection Shop'}
                {modalType === 'EDIT_SHOP' && `Edit Shop: ${activeRecord?.shop_code}`}
                {modalType === 'CREATE_TANK' && 'Create ZMCC Tank'}
                {modalType === 'EDIT_TANK' && `Edit Tank: ${activeRecord?.tank_code}`}
                {modalType === 'REGISTER_SUBSTITUTE_VEHICLE' && 'Register Emergency Substitute Vehicle'}
                {modalType === 'TOGGLE_ACTIVE' &&
                  (activeRecord?.is_active ? 'Confirm Deactivation' : 'Confirm Activation')}
              </h2>
              <button
                type="button"
                onClick={closeModal}
                className="p-1.5 rounded-lg border border-border text-slate-500 hover:bg-slate-100"
                aria-label="Close dialog"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {modalError && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs font-semibold text-rose-800 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
                <span>{modalError}</span>
              </div>
            )}

            <form onSubmit={handleModalSubmit} className="space-y-4">
              {/* Local Supplier Form */}
              {(modalType === 'CREATE_LOCAL_SUPPLIER' || modalType === 'EDIT_LOCAL_SUPPLIER') && (
                <div className="space-y-3">
                  {modalType === 'CREATE_LOCAL_SUPPLIER' && (
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">Local Supplier Code</label>
                      <div className="inline-flex items-center px-3 py-1.5 rounded-lg bg-slate-100 border border-slate-200 text-slate-600 tabular-nums text-xs font-semibold">
                        [ Auto-generated by system ]
                      </div>
                    </div>
                  )}
                  {modalType === 'EDIT_LOCAL_SUPPLIER' && (
                    <div className="bg-slate-50 p-3 rounded-xl border border-border text-xs space-y-1">
                      <div className="flex justify-between">
                        <span className="font-semibold text-slate-500">Supplier Code:</span>
                        <span className="tabular-nums font-semibold text-primary">{activeRecord?.local_supplier_code}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="font-semibold text-slate-500">ERP Mapping Status:</span>
                        <span className="font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded text-xs uppercase border border-amber-200">
                          {activeRecord?.erp_mapping_status || 'PENDING'}
                        </span>
                      </div>
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">
                      Supplier Name *
                    </label>
                    <input
                      type="text"
                      required
                      maxLength={150}
                      value={formData.name || ''}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      placeholder="e.g. Haji Muhammad Sharif"
                      className="w-full px-3 py-2 border border-border rounded-xl text-xs font-semibold focus:ring-2 focus:ring-primary"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">
                        Phone Number *
                      </label>
                      <input
                        type="text"
                        required
                        maxLength={50}
                        value={formData.phone || ''}
                        onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                        placeholder="03001234567"
                        className="w-full px-3 py-2 border border-border rounded-xl text-xs tabular-nums font-semibold focus:ring-2 focus:ring-primary"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">
                        CNIC *
                      </label>
                      <input
                        type="text"
                        required
                        maxLength={50}
                        value={formData.cnic || ''}
                        onChange={(e) => setFormData({ ...formData, cnic: e.target.value })}
                        placeholder="35201-1234567-1"
                        className="w-full px-3 py-2 border border-border rounded-xl text-xs tabular-nums font-semibold focus:ring-2 focus:ring-primary"
                      />
                    </div>
                  </div>

                  {modalType === 'CREATE_LOCAL_SUPPLIER' && (
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">
                        Milk Source
                      </label>
                      <select
                        value={formData.milk_source_id || ''}
                        onChange={(e) => setFormData({ ...formData, milk_source_id: e.target.value })}
                        className="w-full px-3 py-2 border border-border rounded-xl text-xs font-semibold focus:ring-2 focus:ring-primary"
                      >
                        <option value="">Select milk source</option>
                        <option value="UNKNOWN_ERP">New source</option>
                        {helperMilkSources.map((ms) => (
                          <option key={ms.id} value={ms.id}>
                            {ms.name} · {ms.erp_code}
                          </option>
                        ))}
                      </select>
                      <p className="text-[11px] text-slate-500 font-medium mt-1">
                        Choose &quot;New source&quot; if the ERP source is not mapped yet.
                      </p>
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">
                      Candidate ERP Reference (Optional)
                    </label>
                    <input
                      type="text"
                      maxLength={100}
                      value={formData.erp_reference || ''}
                      onChange={(e) => setFormData({ ...formData, erp_reference: e.target.value })}
                      placeholder="e.g. 00045231"
                      className="w-full px-3 py-2 border border-border rounded-xl text-xs tabular-nums font-semibold focus:ring-2 focus:ring-primary"
                    />
                    <p className="text-[11px] text-slate-500 font-medium mt-1">
                      Candidate ERP reference only. Leading zeros are preserved. Status remains PENDING. Placeholders (e.g. New, TBD, Unknown) are rejected.
                    </p>
                  </div>
                </div>
              )}

              {/* Route Form */}
              {(modalType === 'CREATE_ROUTE' || modalType === 'EDIT_ROUTE') && (
                <>
                  {modalType === 'CREATE_ROUTE' && (
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">Route Code</label>
                      <div className="inline-flex items-center px-3 py-1.5 rounded-lg bg-slate-100 border border-slate-200 text-slate-600 tabular-nums text-xs font-semibold">
                        [ Auto-generated by system ]
                      </div>
                    </div>
                  )}
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Route Name</label>
                    <input
                      type="text"
                      required
                      value={formData.name || ''}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      placeholder="e.g. Jhang North Route"
                      className="w-full px-3 py-2 border border-border rounded-xl text-xs font-semibold focus:ring-2 focus:ring-primary"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">Origin</label>
                      <input
                        type="text"
                        required
                        value={formData.origin || ''}
                        onChange={(e) => setFormData({ ...formData, origin: e.target.value })}
                        placeholder="e.g. Jhang Center"
                        className="w-full px-3 py-2 border border-border rounded-xl text-xs font-semibold focus:ring-2 focus:ring-primary"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">Destination</label>
                      <input
                        type="text"
                        required
                        value={formData.destination || ''}
                        onChange={(e) => setFormData({ ...formData, destination: e.target.value })}
                        placeholder="e.g. Shakarganj Main Plant"
                        className="w-full px-3 py-2 border border-border rounded-xl text-xs font-semibold focus:ring-2 focus:ring-primary"
                      />
                    </div>
                  </div>
                </>
              )}

              {/* Area Form */}
              {(modalType === 'CREATE_AREA' || modalType === 'EDIT_AREA') && (
                <>
                  {modalType === 'CREATE_AREA' && (
                    <>
                      <div>
                        <label className="block text-xs font-semibold text-slate-600 mb-1">Parent Route</label>
                        <select
                          required
                          value={formData.route_id || ''}
                          onChange={(e) => setFormData({ ...formData, route_id: e.target.value })}
                          className="w-full px-3 py-2 border border-border rounded-xl text-xs font-semibold focus:ring-2 focus:ring-primary"
                        >
                          <option value="">Select an active route</option>
                          {helperRoutes.map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.name} · {r.route_code}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-600 mb-1">Area Code</label>
                        <div className="inline-flex items-center px-3 py-1.5 rounded-lg bg-slate-100 border border-slate-200 text-slate-600 tabular-nums text-xs font-semibold">
                          [ Auto-generated by system ]
                        </div>
                      </div>
                    </>
                  )}
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Area Name</label>
                    <input
                      type="text"
                      required
                      value={formData.name || ''}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      placeholder="e.g. Kot Lakhpat Sub-area"
                      className="w-full px-3 py-2 border border-border rounded-xl text-xs font-semibold focus:ring-2 focus:ring-primary"
                    />
                  </div>
                </>
              )}

              {/* Milk Source Form */}
              {(modalType === 'CREATE_MILK_SOURCE' || modalType === 'EDIT_MILK_SOURCE') && (
                <>
                  {modalType === 'CREATE_MILK_SOURCE' && (
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">ERP Code</label>
                      <input
                        type="text"
                        required
                        value={formData.erp_code || ''}
                        onChange={(e) => setFormData({ ...formData, erp_code: e.target.value.toUpperCase() })}
                        placeholder="e.g. SRC-ERP-901"
                        className="w-full px-3 py-2 border border-border rounded-xl text-xs tabular-nums font-semibold uppercase focus:ring-2 focus:ring-primary"
                      />
                    </div>
                  )}
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Source Name</label>
                    <input
                      type="text"
                      required
                      value={formData.name || ''}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      placeholder="e.g. Direct Farmer Collective A"
                      className="w-full px-3 py-2 border border-border rounded-xl text-xs font-semibold focus:ring-2 focus:ring-primary"
                    />
                  </div>
                </>
              )}

              {/* Chiller Ownership Form */}
              {(modalType === 'CREATE_CHILLER' || modalType === 'EDIT_CHILLER') && (
                <>
                  {modalType === 'CREATE_CHILLER' && (
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">Ownership Code</label>
                      <input
                        type="text"
                        required
                        value={formData.ownership_code || ''}
                        onChange={(e) => setFormData({ ...formData, ownership_code: e.target.value.toUpperCase() })}
                        placeholder="e.g. CHL-BRAND-01"
                        className="w-full px-3 py-2 border border-border rounded-xl text-xs tabular-nums font-semibold uppercase focus:ring-2 focus:ring-primary"
                      />
                    </div>
                  )}
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Owner / Brand Name</label>
                    <input
                      type="text"
                      required
                      value={formData.name || ''}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      placeholder="e.g. Shakarganj"
                      className="w-full px-3 py-2 border border-border rounded-xl text-xs font-semibold focus:ring-2 focus:ring-primary"
                    />
                  </div>
                </>
              )}

              {/* Shop Details Form */}
              {(modalType === 'CREATE_SHOP' || modalType === 'EDIT_SHOP') && (
                <div className="space-y-3">
                  {modalType === 'CREATE_SHOP' && (
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">Shop Code</label>
                      <div className="inline-flex items-center px-3 py-1.5 rounded-lg bg-slate-100 border border-slate-200 text-slate-600 tabular-nums text-xs font-semibold">
                        [ Auto-generated by system ]
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">Shop Name</label>
                      <input
                        type="text"
                        required
                        value={formData.shop_name || ''}
                        onChange={(e) => setFormData({ ...formData, shop_name: e.target.value })}
                        placeholder="e.g. Al-Madina Milk Point"
                        className="w-full px-3 py-2 border border-border rounded-xl text-xs font-semibold focus:ring-2 focus:ring-primary"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">
                        Shop Owner / Contractor
                      </label>
                      <input
                        type="text"
                        required
                        value={formData.owner_name || ''}
                        onChange={(e) => setFormData({ ...formData, owner_name: e.target.value })}
                        placeholder="e.g. Owner Full Name"
                        className="w-full px-3 py-2 border border-border rounded-xl text-xs font-semibold focus:ring-2 focus:ring-primary"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">Phone Number</label>
                      <input
                        type="text"
                        required
                        value={formData.phone_number || ''}
                        onChange={(e) => setFormData({ ...formData, phone_number: e.target.value })}
                        placeholder="03001234567"
                        className="w-full px-3 py-2 border border-border rounded-xl text-xs tabular-nums font-semibold focus:ring-2 focus:ring-primary"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">CNIC (13 Digits)</label>
                      <input
                        type="text"
                        required
                        value={formData.cnic || ''}
                        onChange={(e) => setFormData({ ...formData, cnic: e.target.value })}
                        placeholder="35201-1234567-1"
                        className="w-full px-3 py-2 border border-border rounded-xl text-xs tabular-nums font-semibold focus:ring-2 focus:ring-primary"
                      />
                    </div>
                  </div>

                  {/* Dependent Route & Area Selection */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">Route</label>
                      <select
                        value={formData.route_id || ''}
                        onChange={(e) => {
                          const rId = e.target.value;
                          setFormData({ ...formData, route_id: rId, area_id: '' });
                        }}
                        className="w-full px-3 py-2 border border-border rounded-xl text-xs font-semibold focus:ring-2 focus:ring-primary"
                      >
                        <option value="">Select route</option>
                        {helperRoutes.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.name} · {r.route_code}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">Collection Area</label>
                      <select
                        required
                        value={formData.area_id || ''}
                        onChange={(e) => {
                          const selectedArea = helperAreas.find((a) => a.id === e.target.value);
                          setFormData({
                            ...formData,
                            area_id: e.target.value,
                            route_id: selectedArea ? selectedArea.route_id : formData.route_id,
                          });
                        }}
                        className="w-full px-3 py-2 border border-border rounded-xl text-xs font-semibold focus:ring-2 focus:ring-primary"
                      >
                        <option value="">Select area</option>
                        {helperAreas
                          .filter((a) => !formData.route_id || a.route_id === formData.route_id)
                          .map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.name} · {a.area_code}
                            </option>
                          ))}
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">Source Name</label>
                      <select
                        required
                        value={formData.milk_source_id || ''}
                        onChange={(e) => setFormData({ ...formData, milk_source_id: e.target.value })}
                        className="w-full px-3 py-2 border border-border rounded-xl text-xs font-semibold focus:ring-2 focus:ring-primary"
                      >
                        <option value="">Select milk source</option>
                        {helperMilkSources.map((ms) => (
                          <option key={ms.id} value={ms.id}>
                            {ms.name} · {ms.erp_code}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">Chiller Ownership</label>
                      <select
                        required
                        value={formData.chiller_ownership_id || ''}
                        onChange={(e) => setFormData({ ...formData, chiller_ownership_id: e.target.value })}
                        className="w-full px-3 py-2 border border-border rounded-xl text-xs font-semibold focus:ring-2 focus:ring-primary"
                      >
                        <option value="">Select chiller ownership</option>
                        {helperChillers.map((co) => (
                          <option key={co.id} value={co.id}>
                            {co.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* GPS Optional Coordinates */}
                  <div className="grid grid-cols-2 gap-3 pt-1 border-t border-border">
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">
                        Latitude <span className="text-xs text-slate-400 font-normal">(-90 to 90)</span>
                      </label>
                      <input
                        type="number"
                        step="any"
                        value={formData.latitude ?? ''}
                        onChange={(e) => setFormData({ ...formData, latitude: e.target.value })}
                        placeholder="31.2681"
                        className="w-full px-3 py-2 border border-border rounded-xl text-xs tabular-nums font-semibold focus:ring-2 focus:ring-primary"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">
                        Longitude <span className="text-xs text-slate-400 font-normal">(-180 to 180)</span>
                      </label>
                      <input
                        type="number"
                        step="any"
                        value={formData.longitude ?? ''}
                        onChange={(e) => setFormData({ ...formData, longitude: e.target.value })}
                        placeholder="72.3181"
                        className="w-full px-3 py-2 border border-border rounded-xl text-xs tabular-nums font-semibold focus:ring-2 focus:ring-primary"
                      />
                    </div>
                  </div>
                  <p className="text-[11px] text-slate-500 font-medium">
                    Note: Latitude and Longitude must both be provided, or both omitted.
                  </p>
                </div>
              )}

              {/* Tank Form */}
              {(modalType === 'CREATE_TANK' || modalType === 'EDIT_TANK') && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Tank Code *</label>
                    <input
                      type="text"
                      required
                      value={formData.tank_code || ''}
                      onChange={(e) => setFormData({ ...formData, tank_code: e.target.value.toUpperCase() })}
                      placeholder="e.g. TANK-01"
                      className="w-full px-3 py-2 border border-border rounded-xl text-xs tabular-nums font-semibold uppercase focus:ring-2 focus:ring-primary"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Tank Name *</label>
                    <input
                      type="text"
                      required
                      value={formData.tank_name || ''}
                      onChange={(e) => setFormData({ ...formData, tank_name: e.target.value })}
                      placeholder="e.g. Raw Milk Tank 1"
                      className="w-full px-3 py-2 border border-border rounded-xl text-xs font-semibold focus:ring-2 focus:ring-primary"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Total Capacity (Liters) *</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0.01"
                      required
                      value={formData.capacity_liters ?? ''}
                      onChange={(e) => setFormData({ ...formData, capacity_liters: e.target.value })}
                      placeholder="e.g. 5000"
                      className="w-full px-3 py-2 border border-border rounded-xl text-xs tabular-nums font-semibold focus:ring-2 focus:ring-primary"
                    />
                  </div>
                </div>
              )}

              {/* Pakistani Emergency Substitute Vehicle Form */}
              {modalType === 'REGISTER_SUBSTITUTE_VEHICLE' && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">
                      Registration Plate *
                    </label>
                    <input
                      type="text"
                      required
                      value={formData.vehicle_number || ''}
                      onChange={(e) => setFormData({ ...formData, vehicle_number: e.target.value.toUpperCase() })}
                      placeholder="e.g. LEA-8921, FSD-4019, ICT-202"
                      className="w-full px-3 py-2 border border-border rounded-xl text-xs tabular-nums font-semibold uppercase focus:ring-2 focus:ring-primary"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">
                        Vehicle Type *
                      </label>
                      <select
                        required
                        value={formData.vehicle_type || 'SUZUKI_PICKUP'}
                        onChange={(e) => setFormData({ ...formData, vehicle_type: e.target.value })}
                        className="w-full px-3 py-2 border border-border rounded-xl text-xs font-semibold focus:ring-2 focus:ring-primary"
                      >
                        <option value="SUZUKI_PICKUP">Pickup</option>
                        <option value="MINI_TRUCK">Mini truck</option>
                        <option value="MEDIUM_TRUCK">Medium truck</option>
                        <option value="INSULATED_TANKER">Insulated tanker</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">
                        Tank / Drum Capacity (Liters) *
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        min="1"
                        required
                        value={formData.capacity_liters ?? ''}
                        onChange={(e) => setFormData({ ...formData, capacity_liters: e.target.value })}
                        placeholder="e.g. 1500"
                        className="w-full px-3 py-2 border border-border rounded-xl text-xs tabular-nums font-semibold focus:ring-2 focus:ring-primary"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">
                        Driver Name *
                      </label>
                      <input
                        type="text"
                        required
                        value={formData.driver_name || ''}
                        onChange={(e) => setFormData({ ...formData, driver_name: e.target.value })}
                        placeholder="e.g. Muhammad Asif"
                        className="w-full px-3 py-2 border border-border rounded-xl text-xs font-semibold focus:ring-2 focus:ring-primary"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">
                        Driver Phone Number *
                      </label>
                      <input
                        type="text"
                        required
                        value={formData.driver_phone || ''}
                        onChange={(e) => setFormData({ ...formData, driver_phone: e.target.value })}
                        placeholder="03001234567"
                        className="w-full px-3 py-2 border border-border rounded-xl text-xs tabular-nums font-semibold focus:ring-2 focus:ring-primary"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">
                      Category
                    </label>
                    <div className="inline-flex items-center px-3 py-1.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 tabular-nums text-xs font-semibold">
                      EMERGENCY_SUBSTITUTE
                    </div>
                  </div>
                </div>
              )}

              {/* Toggle Active Confirmation */}
              {modalType === 'TOGGLE_ACTIVE' && (
                <div className="space-y-3 py-2">
                  <p className="text-xs text-slate-700 font-medium">
                    Are you sure you want to {activeRecord?.is_active ? 'deactivate' : 'activate'}{' '}
                    <strong className="text-foreground font-semibold">
                      {activeRecord?.name || activeRecord?.shop_name || activeRecord?.tank_name}
                    </strong>
                    ?
                  </p>
                  {activeRecord?.is_active ? (
                    <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800 font-medium">
                      <strong>Warning:</strong> Deactivating this entity will exclude it from operational selection.
                      If active dependent records exist, deactivation will be strictly blocked.
                    </div>
                  ) : (
                    <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl text-xs text-blue-800 font-medium">
                      Activating this entity will return it to active operational selection, provided all parent entities
                      are active.
                    </div>
                  )}
                </div>
              )}

              {/* Footer Buttons */}
              <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-border">
                <button
                  type="button"
                  onClick={closeModal}
                  disabled={isSubmitting}
                  className="px-4 py-2 min-h-[44px] rounded-xl border border-border text-xs font-semibold text-slate-700 hover:bg-slate-100 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className={`px-5 py-2 min-h-[44px] rounded-xl text-xs font-semibold text-white transition shadow-2xs flex items-center gap-2 ${
                    modalType === 'TOGGLE_ACTIVE' && activeRecord?.is_active
                      ? 'bg-rose-600 hover:bg-rose-700'
                      : 'bg-primary hover:bg-primary-hover'
                  }`}
                >
                  {isSubmitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>
                    {modalType === 'TOGGLE_ACTIVE'
                      ? activeRecord?.is_active
                        ? 'Confirm Deactivation'
                        : 'Confirm Activation'
                      : 'Save Record'}
                  </span>
                </button>
              </div>
            </form>
          </Modal>
      )}</AnimatePresence>
    </div>
  );
};
