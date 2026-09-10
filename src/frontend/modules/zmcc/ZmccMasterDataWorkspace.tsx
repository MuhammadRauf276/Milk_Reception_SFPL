'use client';

import React, { useState, useEffect, useCallback } from 'react';
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
  ChevronRight,
  Filter,
} from 'lucide-react';

export type MasterDataTab = 'ROUTES' | 'AREAS' | 'MILK_SOURCES' | 'SHOPS' | 'CHILLER_OWNERSHIP';

interface ZmccMasterDataWorkspaceProps {
  currentUser: User | null;
  initialTab?: MasterDataTab;
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
  created_at: string;
}

interface ChillerOwnershipItem {
  id: string;
  ownership_code: string;
  name: string;
  is_active: boolean;
  creator_name: string;
  updater_name: string | null;
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

export const ZmccMasterDataWorkspace: React.FC<ZmccMasterDataWorkspaceProps> = ({
  currentUser,
  initialTab,
}) => {
  const isSuperAdmin = currentUser?.role === 'SUPER_ADMIN' || currentUser?.role === 'Admin';
  const isZmccManager = currentUser?.role === 'ZMCC_MANAGER';
  const isPheOperator = currentUser?.role === 'PHE_OPERATOR';

  // Tabs permitted
  const permittedTabs: { id: MasterDataTab; label: string; icon: any }[] = React.useMemo(() => {
    if (isPheOperator) {
      return [{ id: 'SHOPS', label: 'Shop Details', icon: Store }];
    }
    const tabs: { id: MasterDataTab; label: string; icon: any }[] = [
      { id: 'ROUTES', label: 'Routes', icon: RouteIcon },
      { id: 'AREAS', label: 'Areas', icon: MapPin },
      { id: 'MILK_SOURCES', label: 'Milk Sources', icon: Milk },
      { id: 'SHOPS', label: 'Shop Details', icon: Store },
    ];
    if (isSuperAdmin) {
      tabs.push({ id: 'CHILLER_OWNERSHIP', label: 'Chiller Ownership', icon: Building2 });
    }
    return tabs;
  }, [isSuperAdmin, isPheOperator]);

  const [activeTab, setActiveTab] = useState<MasterDataTab>(
    initialTab || (isPheOperator ? 'SHOPS' : 'ROUTES')
  );

  // ZMCC Scope
  const [sources, setSources] = useState<ZmccSource[]>([]);
  const [selectedZmccId, setSelectedZmccId] = useState<string>('');

  // Data states
  const [routes, setRoutes] = useState<RouteItem[]>([]);
  const [areas, setAreas] = useState<AreaItem[]>([]);
  const [milkSources, setMilkSources] = useState<MilkSourceItem[]>([]);
  const [chillerOwnerships, setChillerOwnerships] = useState<ChillerOwnershipItem[]>([]);
  const [shops, setShops] = useState<ShopItem[]>([]);

  // Filtering states
  const [search, setSearch] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'true' | 'false'>('all');
  const [routeFilter, setRouteFilter] = useState<string>('');
  const [areaFilter, setAreaFilter] = useState<string>('');
  const [sourceFilter, setSourceFilter] = useState<string>('');

  // UI state
  const [loading, setLoading] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Modals state
  const [modalType, setModalType] = useState<
    'CREATE_ROUTE' | 'EDIT_ROUTE' |
    'CREATE_AREA' | 'EDIT_AREA' |
    'CREATE_MILK_SOURCE' | 'EDIT_MILK_SOURCE' |
    'CREATE_CHILLER' | 'EDIT_CHILLER' |
    'CREATE_SHOP' | 'EDIT_SHOP' |
    'TOGGLE_ACTIVE' | null
  >(null);

  const [activeRecord, setActiveRecord] = useState<any>(null);
  const [modalError, setModalError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  // Form Fields
  const [formData, setFormData] = useState<any>({});

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
  const loadData = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const zmccParam = isSuperAdmin && selectedZmccId ? `&zmcc_id=${selectedZmccId}` : '';
      const statusParam = statusFilter !== 'all' ? `&is_active=${statusFilter}` : '';
      const searchParam = search ? `&search=${encodeURIComponent(search)}` : '';

      if (activeTab === 'ROUTES') {
        const res = await fetch(`/api/zmcc/routes?${zmccParam}${statusParam}${searchParam}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to fetch routes');
        setRoutes(data.routes || []);
      } else if (activeTab === 'AREAS') {
        const rParam = routeFilter ? `&route_id=${routeFilter}` : '';
        const res = await fetch(`/api/zmcc/areas?${zmccParam}${statusParam}${searchParam}${rParam}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to fetch areas');
        setAreas(data.areas || []);
      } else if (activeTab === 'MILK_SOURCES') {
        const res = await fetch(`/api/zmcc/milk-sources?${zmccParam}${statusParam}${searchParam}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to fetch milk sources');
        setMilkSources(data.milk_sources || []);
      } else if (activeTab === 'CHILLER_OWNERSHIP') {
        const res = await fetch(`/api/zmcc/chiller-ownerships?${statusParam}${searchParam}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to fetch chiller ownerships');
        setChillerOwnerships(data.chiller_ownerships || []);
      } else if (activeTab === 'SHOPS') {
        const rParam = routeFilter ? `&route_id=${routeFilter}` : '';
        const aParam = areaFilter ? `&area_id=${areaFilter}` : '';
        const sParam = sourceFilter ? `&milk_source_id=${sourceFilter}` : '';
        const res = await fetch(
          `/api/zmcc/shops?${zmccParam}${statusParam}${searchParam}${rParam}${aParam}${sParam}`
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to fetch shops');
        setShops(data.shops || []);
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Error loading data.');
    } finally {
      setLoading(false);
    }
  }, [activeTab, isSuperAdmin, selectedZmccId, statusFilter, search, routeFilter, areaFilter, sourceFilter]);

  // Load dropdown helper data for Shop and Area forms
  const [helperRoutes, setHelperRoutes] = useState<RouteItem[]>([]);
  const [helperAreas, setHelperAreas] = useState<AreaItem[]>([]);
  const [helperMilkSources, setHelperMilkSources] = useState<MilkSourceItem[]>([]);
  const [helperChillers, setHelperChillers] = useState<ChillerOwnershipItem[]>([]);

  const loadHelperData = useCallback(async () => {
    try {
      const zmccParam = isSuperAdmin && selectedZmccId ? `&zmcc_id=${selectedZmccId}` : '';
      const [rRes, aRes, mRes, cRes] = await Promise.all([
        fetch(`/api/zmcc/routes?is_active=true${zmccParam}`),
        fetch(`/api/zmcc/areas?is_active=true${zmccParam}`),
        fetch(`/api/zmcc/milk-sources?is_active=true${zmccParam}`),
        fetch('/api/zmcc/chiller-ownerships?is_active=true'),
      ]);

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
    } catch (err) {
      console.error('Failed loading helper data', err);
    }
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

  // Close modals on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && modalType) {
        closeModal();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [modalType]);

  const closeModal = () => {
    setModalType(null);
    setActiveRecord(null);
    setModalError(null);
    setFormData({});
  };

  const handleOpenCreateModal = () => {
    setModalError(null);
    setFormData({});
    if (activeTab === 'ROUTES') setModalType('CREATE_ROUTE');
    if (activeTab === 'AREAS') setModalType('CREATE_AREA');
    if (activeTab === 'MILK_SOURCES') setModalType('CREATE_MILK_SOURCE');
    if (activeTab === 'CHILLER_OWNERSHIP') setModalType('CREATE_CHILLER');
    if (activeTab === 'SHOPS') setModalType('CREATE_SHOP');
  };

  const handleOpenEditModal = (item: any) => {
    setModalError(null);
    setActiveRecord(item);
    if (activeTab === 'ROUTES') {
      setFormData({ name: item.name, origin: item.origin, destination: item.destination });
      setModalType('EDIT_ROUTE');
    } else if (activeTab === 'AREAS') {
      setFormData({ name: item.name });
      setModalType('EDIT_AREA');
    } else if (activeTab === 'MILK_SOURCES') {
      setFormData({ name: item.name });
      setModalType('EDIT_MILK_SOURCE');
    } else if (activeTab === 'CHILLER_OWNERSHIP') {
      setFormData({ name: item.name });
      setModalType('EDIT_CHILLER');
    } else if (activeTab === 'SHOPS') {
      setFormData({
        shop_name: item.shop_name,
        owner_name: item.owner_name,
        phone_number: item.phone_number,
        cnic: item.cnic,
        area_id: item.area_id,
        route_id: item.route_id,
        milk_source_id: item.milk_source_id,
        chiller_ownership_id: item.chiller_ownership_id,
        latitude: item.latitude ?? '',
        longitude: item.longitude ?? '',
      });
      setModalType('EDIT_SHOP');
    }
  };

  const handleOpenToggleModal = (item: any) => {
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
      let body: any = {};

      if (modalType === 'CREATE_ROUTE') {
        url = '/api/zmcc/routes';
        body = {
          route_code: formData.route_code,
          name: formData.name,
          origin: formData.origin,
          destination: formData.destination,
          zmcc_id: isSuperAdmin ? selectedZmccId : undefined,
        };
      } else if (modalType === 'EDIT_ROUTE') {
        url = `/api/zmcc/routes/${activeRecord.id}`;
        method = 'PATCH';
        body = {
          name: formData.name,
          origin: formData.origin,
          destination: formData.destination,
        };
      } else if (modalType === 'CREATE_AREA') {
        url = '/api/zmcc/areas';
        body = {
          area_code: formData.area_code,
          name: formData.name,
          route_id: formData.route_id,
        };
      } else if (modalType === 'EDIT_AREA') {
        url = `/api/zmcc/areas/${activeRecord.id}`;
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
        url = `/api/zmcc/milk-sources/${activeRecord.id}`;
        method = 'PATCH';
        body = { name: formData.name };
      } else if (modalType === 'CREATE_CHILLER') {
        url = '/api/zmcc/chiller-ownerships';
        body = {
          ownership_code: formData.ownership_code,
          name: formData.name,
        };
      } else if (modalType === 'EDIT_CHILLER') {
        url = `/api/zmcc/chiller-ownerships/${activeRecord.id}`;
        method = 'PATCH';
        body = { name: formData.name };
      } else if (modalType === 'CREATE_SHOP') {
        url = '/api/zmcc/shops';
        body = {
          shop_code: formData.shop_code,
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
        url = `/api/zmcc/shops/${activeRecord.id}`;
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
      } else if (modalType === 'TOGGLE_ACTIVE') {
        const targetActive = !activeRecord.is_active;
        if (activeTab === 'ROUTES') url = `/api/zmcc/routes/${activeRecord.id}`;
        else if (activeTab === 'AREAS') url = `/api/zmcc/areas/${activeRecord.id}`;
        else if (activeTab === 'MILK_SOURCES') url = `/api/zmcc/milk-sources/${activeRecord.id}`;
        else if (activeTab === 'CHILLER_OWNERSHIP') url = `/api/zmcc/chiller-ownerships/${activeRecord.id}`;
        else if (activeTab === 'SHOPS') url = `/api/zmcc/shops/${activeRecord.id}`;
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
    } catch (err: any) {
      setModalError(err.message || 'An error occurred.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Find assigned ZMCC name for ZMCC Manager / PHE Operator
  const currentZmccName =
    currentUser?.procurement_source?.name ||
    sources.find((s) => s.id === selectedZmccId)?.name ||
    'Assigned ZMCC';

  return (
    <div className="space-y-6 max-w-full overflow-x-hidden">
      {/* Header Banner */}
      <div className="bg-white p-5 rounded-2xl border border-[#EAE4D5] shadow-xs flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-blue-50 text-[#1E3A8A] rounded-xl border border-blue-200">
              <Store className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-lg sm:text-xl font-black text-[#111311]">
                {isPheOperator ? 'PHE Shop Station' : 'ZMCC Master Data Management'}
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
            <div className="flex items-center gap-2 bg-[#FDFBF9] px-3.5 py-2 rounded-xl border border-[#EAE4D5]">
              <span className="text-xs font-black text-slate-600 uppercase tracking-wider">Target ZMCC:</span>
              <select
                value={selectedZmccId}
                onChange={(e) => handleZmccChange(e.target.value)}
                className="bg-transparent text-xs font-extrabold text-[#111311] focus:outline-none cursor-pointer min-h-[36px]"
                aria-label="Select Target ZMCC"
              >
                {sources.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.code})
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="flex items-center gap-2 bg-blue-50 px-3.5 py-2 rounded-xl border border-blue-200">
              <span className="text-xs font-black text-[#1E3A8A] uppercase tracking-wider">Scope:</span>
              <span className="text-xs font-black text-[#111311]">
                {currentZmccName} ({currentUser?.procurement_source?.code || 'ZMCC'})
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Success/Error Banners */}
      {successMsg && (
        <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl text-xs font-bold text-emerald-800 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
          <span>{successMsg}</span>
        </div>
      )}
      {errorMsg && (
        <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-xl text-xs font-bold text-rose-800 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Navigation Tabs (Only if more than 1 tab) */}
      {permittedTabs.length > 1 && (
        <div className="flex items-center gap-2 overflow-x-auto pb-1 border-b border-[#EAE4D5]">
          {permittedTabs.map((t) => {
            const Icon = t.icon;
            const isActive = activeTab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  setActiveTab(t.id);
                  setSearch('');
                  setStatusFilter('all');
                  setRouteFilter('');
                  setAreaFilter('');
                  setSourceFilter('');
                }}
                className={`flex items-center gap-2 px-4 py-2.5 min-h-[44px] rounded-xl text-xs font-extrabold transition-all shrink-0 ${
                  isActive
                    ? 'bg-[#1E3A8A] text-white shadow-xs'
                    : 'bg-white text-slate-700 border border-[#EAE4D5] hover:bg-[#F4F0E6]'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span>{t.label}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Toolbar: Filters, Search, Add Button */}
      <div className="bg-white p-4 rounded-xl border border-[#EAE4D5] flex flex-col md:flex-row md:items-center justify-between gap-3 shadow-xs">
        <div className="flex flex-wrap items-center gap-2.5 flex-1">
          {/* Search */}
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search code or name..."
              className="w-full pl-9 pr-3 py-2 min-h-[44px] bg-[#FDFBF9] border border-[#EAE4D5] rounded-xl text-xs font-medium text-[#111311] placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]"
            />
          </div>

          {/* Status Filter */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
            className="px-3 py-2 min-h-[44px] bg-[#FDFBF9] border border-[#EAE4D5] rounded-xl text-xs font-bold text-slate-700 focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]"
            aria-label="Filter by Status"
          >
            <option value="all">All Statuses</option>
            <option value="true">Active Only</option>
            <option value="false">Inactive Only</option>
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
                className="px-3 py-2 min-h-[44px] bg-[#FDFBF9] border border-[#EAE4D5] rounded-xl text-xs font-bold text-slate-700 focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]"
                aria-label="Filter by Route"
              >
                <option value="">All Routes</option>
                {helperRoutes.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} ({r.route_code})
                  </option>
                ))}
              </select>

              <select
                value={areaFilter}
                onChange={(e) => setAreaFilter(e.target.value)}
                className="px-3 py-2 min-h-[44px] bg-[#FDFBF9] border border-[#EAE4D5] rounded-xl text-xs font-bold text-slate-700 focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]"
                aria-label="Filter by Area"
              >
                <option value="">All Areas</option>
                {helperAreas
                  .filter((a) => !routeFilter || a.route_id === routeFilter)
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({a.area_code})
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
              className="px-3 py-2 min-h-[44px] bg-[#FDFBF9] border border-[#EAE4D5] rounded-xl text-xs font-bold text-slate-700 focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]"
              aria-label="Filter Areas by Route"
            >
              <option value="">All Routes</option>
              {helperRoutes.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} ({r.route_code})
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Action Button: Add Entity */}
        {((isSuperAdmin) ||
          (isZmccManager && activeTab !== 'CHILLER_OWNERSHIP') ||
          (isPheOperator && activeTab === 'SHOPS')) && (
          <button
            type="button"
            onClick={handleOpenCreateModal}
            className="flex items-center justify-center gap-2 px-4 py-2 min-h-[44px] bg-[#1E3A8A] text-white rounded-xl text-xs font-extrabold hover:bg-blue-900 transition shadow-xs shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span>
              {activeTab === 'ROUTES' && 'Add Route'}
              {activeTab === 'AREAS' && 'Add Area'}
              {activeTab === 'MILK_SOURCES' && 'Add Milk Source'}
              {activeTab === 'CHILLER_OWNERSHIP' && 'Add Chiller Ownership'}
              {activeTab === 'SHOPS' && 'Add Shop'}
            </span>
          </button>
        )}
      </div>

      {/* Main Content Table */}
      <div className="bg-white rounded-2xl border border-[#EAE4D5] shadow-xs overflow-hidden">
        {loading ? (
          <div className="p-12 text-center flex flex-col items-center justify-center text-slate-500 space-y-2">
            <Loader2 className="w-6 h-6 animate-spin text-[#1E3A8A]" />
            <span className="text-xs font-extrabold">Loading master data...</span>
          </div>
        ) : (
          <div className="overflow-x-auto">
            {activeTab === 'ROUTES' && (
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-[#FDFBF9] border-b border-[#EAE4D5] text-slate-600 font-black uppercase text-[10px] tracking-wider">
                    <th className="py-3 px-4">Route Code</th>
                    <th className="py-3 px-4">Route Name</th>
                    <th className="py-3 px-4">Origin</th>
                    <th className="py-3 px-4">Destination</th>
                    <th className="py-3 px-4 text-center">Areas</th>
                    <th className="py-3 px-4 text-center">Status</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EAE4D5]">
                  {routes.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-slate-400 font-bold">
                        No routes found. Click &quot;Add Route&quot; to create one.
                      </td>
                    </tr>
                  ) : (
                    routes.map((r) => (
                      <tr key={r.id} className="hover:bg-[#FDFBF9]/60 transition">
                        <td className="py-3 px-4 font-mono font-black text-[#111311]">{r.route_code}</td>
                        <td className="py-3 px-4 font-extrabold text-[#111311]">{r.name}</td>
                        <td className="py-3 px-4 text-slate-600">{r.origin}</td>
                        <td className="py-3 px-4 text-slate-600">{r.destination}</td>
                        <td className="py-3 px-4 text-center font-bold font-mono">{(r as any).area_count || 0}</td>
                        <td className="py-3 px-4 text-center">
                          <span
                            className={`px-2.5 py-1 rounded-full text-[10px] font-black uppercase ${
                              r.is_active
                                ? 'bg-emerald-100 text-emerald-800'
                                : 'bg-rose-100 text-rose-800'
                            }`}
                          >
                            {r.is_active ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => handleOpenEditModal(r)}
                              className="p-2 min-h-[36px] min-w-[36px] rounded-lg border border-[#EAE4D5] hover:bg-slate-100 text-slate-700 transition"
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
                  <tr className="bg-[#FDFBF9] border-b border-[#EAE4D5] text-slate-600 font-black uppercase text-[10px] tracking-wider">
                    <th className="py-3 px-4">Area Code</th>
                    <th className="py-3 px-4">Area Name</th>
                    <th className="py-3 px-4">Route</th>
                    <th className="py-3 px-4 text-center">Shops</th>
                    <th className="py-3 px-4 text-center">Status</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EAE4D5]">
                  {areas.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-slate-400 font-bold">
                        No areas found. Click &quot;Add Area&quot; to create one.
                      </td>
                    </tr>
                  ) : (
                    areas.map((a) => (
                      <tr key={a.id} className="hover:bg-[#FDFBF9]/60 transition">
                        <td className="py-3 px-4 font-mono font-black text-[#111311]">{a.area_code}</td>
                        <td className="py-3 px-4 font-extrabold text-[#111311]">{a.name}</td>
                        <td className="py-3 px-4 text-slate-600">
                          {a.route.name} <span className="text-[10px] font-mono text-slate-400">({a.route.route_code})</span>
                        </td>
                        <td className="py-3 px-4 text-center font-bold font-mono">{(a as any).shop_count || 0}</td>
                        <td className="py-3 px-4 text-center">
                          <span
                            className={`px-2.5 py-1 rounded-full text-[10px] font-black uppercase ${
                              a.is_active
                                ? 'bg-emerald-100 text-emerald-800'
                                : 'bg-rose-100 text-rose-800'
                            }`}
                          >
                            {a.is_active ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => handleOpenEditModal(a)}
                              className="p-2 min-h-[36px] min-w-[36px] rounded-lg border border-[#EAE4D5] hover:bg-slate-100 text-slate-700 transition"
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
                  <tr className="bg-[#FDFBF9] border-b border-[#EAE4D5] text-slate-600 font-black uppercase text-[10px] tracking-wider">
                    <th className="py-3 px-4">ERP Code</th>
                    <th className="py-3 px-4">Source Name</th>
                    <th className="py-3 px-4 text-center">Shops</th>
                    <th className="py-3 px-4 text-center">Status</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EAE4D5]">
                  {milkSources.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-slate-400 font-bold">
                        No milk sources found. Click &quot;Add Milk Source&quot; to create one.
                      </td>
                    </tr>
                  ) : (
                    milkSources.map((ms) => (
                      <tr key={ms.id} className="hover:bg-[#FDFBF9]/60 transition">
                        <td className="py-3 px-4 font-mono font-black text-[#111311]">{ms.erp_code}</td>
                        <td className="py-3 px-4 font-extrabold text-[#111311]">{ms.name}</td>
                        <td className="py-3 px-4 text-center font-bold font-mono">{(ms as any).shop_count || 0}</td>
                        <td className="py-3 px-4 text-center">
                          <span
                            className={`px-2.5 py-1 rounded-full text-[10px] font-black uppercase ${
                              ms.is_active
                                ? 'bg-emerald-100 text-emerald-800'
                                : 'bg-rose-100 text-rose-800'
                            }`}
                          >
                            {ms.is_active ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => handleOpenEditModal(ms)}
                              className="p-2 min-h-[36px] min-w-[36px] rounded-lg border border-[#EAE4D5] hover:bg-slate-100 text-slate-700 transition"
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
                  <tr className="bg-[#FDFBF9] border-b border-[#EAE4D5] text-slate-600 font-black uppercase text-[10px] tracking-wider">
                    <th className="py-3 px-4">Ownership Code</th>
                    <th className="py-3 px-4">Owner / Brand Name</th>
                    <th className="py-3 px-4 text-center">Shops Assigned</th>
                    <th className="py-3 px-4 text-center">Status</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EAE4D5]">
                  {chillerOwnerships.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-slate-400 font-bold">
                        No chiller ownerships found.
                      </td>
                    </tr>
                  ) : (
                    chillerOwnerships.map((co) => (
                      <tr key={co.id} className="hover:bg-[#FDFBF9]/60 transition">
                        <td className="py-3 px-4 font-mono font-black text-[#111311]">{co.ownership_code}</td>
                        <td className="py-3 px-4 font-extrabold text-[#111311]">{co.name}</td>
                        <td className="py-3 px-4 text-center font-bold font-mono">{(co as any).shop_count || 0}</td>
                        <td className="py-3 px-4 text-center">
                          <span
                            className={`px-2.5 py-1 rounded-full text-[10px] font-black uppercase ${
                              co.is_active
                                ? 'bg-emerald-100 text-emerald-800'
                                : 'bg-rose-100 text-rose-800'
                            }`}
                          >
                            {co.is_active ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => handleOpenEditModal(co)}
                              className="p-2 min-h-[36px] min-w-[36px] rounded-lg border border-[#EAE4D5] hover:bg-slate-100 text-slate-700 transition"
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
                  <tr className="bg-[#FDFBF9] border-b border-[#EAE4D5] text-slate-600 font-black uppercase text-[10px] tracking-wider">
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
                <tbody className="divide-y divide-[#EAE4D5]">
                  {shops.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="py-8 text-center text-slate-400 font-bold">
                        No shops found. Click &quot;Add Shop&quot; to register a collection shop.
                      </td>
                    </tr>
                  ) : (
                    shops.map((s) => (
                      <tr key={s.id} className="hover:bg-[#FDFBF9]/60 transition">
                        <td className="py-3 px-4 font-mono font-black text-[#111311]">{s.shop_code}</td>
                        <td className="py-3 px-4 font-extrabold text-[#111311]">{s.shop_name}</td>
                        <td className="py-3 px-4 font-medium text-slate-700">
                          <div>{s.owner_name}</div>
                          <div className="font-mono text-[10px] text-slate-400">{s.cnic}</div>
                        </td>
                        <td className="py-3 px-4 font-mono text-slate-600">{s.phone_number}</td>
                        <td className="py-3 px-4 text-slate-700">
                          <div>{s.area.name}</div>
                          <div className="text-[10px] font-mono text-slate-400">Area: {s.area.area_code}</div>
                        </td>
                        <td className="py-3 px-4 text-slate-700 font-medium">
                          <div>{s.milk_source.name}</div>
                          <div className="text-[10px] font-mono text-slate-400">{s.milk_source.erp_code}</div>
                        </td>
                        <td className="py-3 px-4 text-slate-700 font-medium">{s.chiller_ownership.name}</td>
                        <td className="py-3 px-4 text-center">
                          <span
                            className={`px-2.5 py-1 rounded-full text-[10px] font-black uppercase ${
                              s.is_active
                                ? 'bg-emerald-100 text-emerald-800'
                                : 'bg-rose-100 text-rose-800'
                            }`}
                          >
                            {s.is_active ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => handleOpenEditModal(s)}
                              className="p-2 min-h-[36px] min-w-[36px] rounded-lg border border-[#EAE4D5] hover:bg-slate-100 text-slate-700 transition"
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
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      {/* MODALS */}
      {modalType && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs"
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-title"
        >
          <div className="bg-white rounded-2xl border border-[#EAE4D5] shadow-2xl max-w-lg w-full p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-[#EAE4D5]">
              <h2 id="modal-title" className="text-base font-black text-[#111311]">
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
                {modalType === 'TOGGLE_ACTIVE' &&
                  (activeRecord?.is_active ? 'Confirm Deactivation' : 'Confirm Activation')}
              </h2>
              <button
                type="button"
                onClick={closeModal}
                className="p-1.5 rounded-lg border border-[#EAE4D5] text-slate-500 hover:bg-slate-100"
                aria-label="Close dialog"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {modalError && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs font-bold text-rose-800 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
                <span>{modalError}</span>
              </div>
            )}

            <form onSubmit={handleModalSubmit} className="space-y-4">
              {/* Route Form */}
              {(modalType === 'CREATE_ROUTE' || modalType === 'EDIT_ROUTE') && (
                <>
                  {modalType === 'CREATE_ROUTE' && (
                    <div>
                      <label className="block text-xs font-black uppercase text-slate-600 mb-1">Route Code</label>
                      <input
                        type="text"
                        required
                        value={formData.route_code || ''}
                        onChange={(e) => setFormData({ ...formData, route_code: e.target.value.toUpperCase() })}
                        placeholder="e.g. RT-NORTH-01"
                        className="w-full px-3 py-2 border border-[#EAE4D5] rounded-xl text-xs font-mono font-bold uppercase focus:ring-2 focus:ring-[#1E3A8A]"
                      />
                    </div>
                  )}
                  <div>
                    <label className="block text-xs font-black uppercase text-slate-600 mb-1">Route Name</label>
                    <input
                      type="text"
                      required
                      value={formData.name || ''}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      placeholder="e.g. Jhang North Route"
                      className="w-full px-3 py-2 border border-[#EAE4D5] rounded-xl text-xs font-bold focus:ring-2 focus:ring-[#1E3A8A]"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-black uppercase text-slate-600 mb-1">Origin</label>
                      <input
                        type="text"
                        required
                        value={formData.origin || ''}
                        onChange={(e) => setFormData({ ...formData, origin: e.target.value })}
                        placeholder="e.g. Jhang Center"
                        className="w-full px-3 py-2 border border-[#EAE4D5] rounded-xl text-xs font-bold focus:ring-2 focus:ring-[#1E3A8A]"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-black uppercase text-slate-600 mb-1">Destination</label>
                      <input
                        type="text"
                        required
                        value={formData.destination || ''}
                        onChange={(e) => setFormData({ ...formData, destination: e.target.value })}
                        placeholder="e.g. Shakarganj Main Plant"
                        className="w-full px-3 py-2 border border-[#EAE4D5] rounded-xl text-xs font-bold focus:ring-2 focus:ring-[#1E3A8A]"
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
                        <label className="block text-xs font-black uppercase text-slate-600 mb-1">Parent Route</label>
                        <select
                          required
                          value={formData.route_id || ''}
                          onChange={(e) => setFormData({ ...formData, route_id: e.target.value })}
                          className="w-full px-3 py-2 border border-[#EAE4D5] rounded-xl text-xs font-bold focus:ring-2 focus:ring-[#1E3A8A]"
                        >
                          <option value="">Select an active route...</option>
                          {helperRoutes.map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.name} ({r.route_code})
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-black uppercase text-slate-600 mb-1">Area Code</label>
                        <input
                          type="text"
                          required
                          value={formData.area_code || ''}
                          onChange={(e) => setFormData({ ...formData, area_code: e.target.value.toUpperCase() })}
                          placeholder="e.g. AR-JHG-01"
                          className="w-full px-3 py-2 border border-[#EAE4D5] rounded-xl text-xs font-mono font-bold uppercase focus:ring-2 focus:ring-[#1E3A8A]"
                        />
                      </div>
                    </>
                  )}
                  <div>
                    <label className="block text-xs font-black uppercase text-slate-600 mb-1">Area Name</label>
                    <input
                      type="text"
                      required
                      value={formData.name || ''}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      placeholder="e.g. Kot Lakhpat Sub-area"
                      className="w-full px-3 py-2 border border-[#EAE4D5] rounded-xl text-xs font-bold focus:ring-2 focus:ring-[#1E3A8A]"
                    />
                  </div>
                </>
              )}

              {/* Milk Source Form */}
              {(modalType === 'CREATE_MILK_SOURCE' || modalType === 'EDIT_MILK_SOURCE') && (
                <>
                  {modalType === 'CREATE_MILK_SOURCE' && (
                    <div>
                      <label className="block text-xs font-black uppercase text-slate-600 mb-1">ERP Code</label>
                      <input
                        type="text"
                        required
                        value={formData.erp_code || ''}
                        onChange={(e) => setFormData({ ...formData, erp_code: e.target.value.toUpperCase() })}
                        placeholder="e.g. SRC-ERP-901"
                        className="w-full px-3 py-2 border border-[#EAE4D5] rounded-xl text-xs font-mono font-bold uppercase focus:ring-2 focus:ring-[#1E3A8A]"
                      />
                    </div>
                  )}
                  <div>
                    <label className="block text-xs font-black uppercase text-slate-600 mb-1">Source Name</label>
                    <input
                      type="text"
                      required
                      value={formData.name || ''}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      placeholder="e.g. Direct Farmer Collective A"
                      className="w-full px-3 py-2 border border-[#EAE4D5] rounded-xl text-xs font-bold focus:ring-2 focus:ring-[#1E3A8A]"
                    />
                  </div>
                </>
              )}

              {/* Chiller Ownership Form */}
              {(modalType === 'CREATE_CHILLER' || modalType === 'EDIT_CHILLER') && (
                <>
                  {modalType === 'CREATE_CHILLER' && (
                    <div>
                      <label className="block text-xs font-black uppercase text-slate-600 mb-1">Ownership Code</label>
                      <input
                        type="text"
                        required
                        value={formData.ownership_code || ''}
                        onChange={(e) => setFormData({ ...formData, ownership_code: e.target.value.toUpperCase() })}
                        placeholder="e.g. CHL-BRAND-01"
                        className="w-full px-3 py-2 border border-[#EAE4D5] rounded-xl text-xs font-mono font-bold uppercase focus:ring-2 focus:ring-[#1E3A8A]"
                      />
                    </div>
                  )}
                  <div>
                    <label className="block text-xs font-black uppercase text-slate-600 mb-1">Owner / Brand Name</label>
                    <input
                      type="text"
                      required
                      value={formData.name || ''}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      placeholder="e.g. Shakarganj"
                      className="w-full px-3 py-2 border border-[#EAE4D5] rounded-xl text-xs font-bold focus:ring-2 focus:ring-[#1E3A8A]"
                    />
                  </div>
                </>
              )}

              {/* Shop Details Form */}
              {(modalType === 'CREATE_SHOP' || modalType === 'EDIT_SHOP') && (
                <div className="space-y-3">
                  {modalType === 'CREATE_SHOP' && (
                    <div>
                      <label className="block text-xs font-black uppercase text-slate-600 mb-1">Shop Code</label>
                      <input
                        type="text"
                        required
                        value={formData.shop_code || ''}
                        onChange={(e) => setFormData({ ...formData, shop_code: e.target.value.toUpperCase() })}
                        placeholder="e.g. SHP-101"
                        className="w-full px-3 py-2 border border-[#EAE4D5] rounded-xl text-xs font-mono font-bold uppercase focus:ring-2 focus:ring-[#1E3A8A]"
                      />
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-black uppercase text-slate-600 mb-1">Shop Name</label>
                      <input
                        type="text"
                        required
                        value={formData.shop_name || ''}
                        onChange={(e) => setFormData({ ...formData, shop_name: e.target.value })}
                        placeholder="e.g. Al-Madina Milk Point"
                        className="w-full px-3 py-2 border border-[#EAE4D5] rounded-xl text-xs font-bold focus:ring-2 focus:ring-[#1E3A8A]"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-black uppercase text-slate-600 mb-1">
                        Shop Owner / Contractor
                      </label>
                      <input
                        type="text"
                        required
                        value={formData.owner_name || ''}
                        onChange={(e) => setFormData({ ...formData, owner_name: e.target.value })}
                        placeholder="e.g. Muhammad Aslam"
                        className="w-full px-3 py-2 border border-[#EAE4D5] rounded-xl text-xs font-bold focus:ring-2 focus:ring-[#1E3A8A]"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-black uppercase text-slate-600 mb-1">Phone Number</label>
                      <input
                        type="text"
                        required
                        value={formData.phone_number || ''}
                        onChange={(e) => setFormData({ ...formData, phone_number: e.target.value })}
                        placeholder="03001234567"
                        className="w-full px-3 py-2 border border-[#EAE4D5] rounded-xl text-xs font-mono font-bold focus:ring-2 focus:ring-[#1E3A8A]"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-black uppercase text-slate-600 mb-1">CNIC (13 Digits)</label>
                      <input
                        type="text"
                        required
                        value={formData.cnic || ''}
                        onChange={(e) => setFormData({ ...formData, cnic: e.target.value })}
                        placeholder="35201-1234567-1"
                        className="w-full px-3 py-2 border border-[#EAE4D5] rounded-xl text-xs font-mono font-bold focus:ring-2 focus:ring-[#1E3A8A]"
                      />
                    </div>
                  </div>

                  {/* Dependent Route & Area Selection */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-black uppercase text-slate-600 mb-1">Route</label>
                      <select
                        value={formData.route_id || ''}
                        onChange={(e) => {
                          const rId = e.target.value;
                          setFormData({ ...formData, route_id: rId, area_id: '' });
                        }}
                        className="w-full px-3 py-2 border border-[#EAE4D5] rounded-xl text-xs font-bold focus:ring-2 focus:ring-[#1E3A8A]"
                      >
                        <option value="">Select Route...</option>
                        {helperRoutes.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.name} ({r.route_code})
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-black uppercase text-slate-600 mb-1">Collection Area</label>
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
                        className="w-full px-3 py-2 border border-[#EAE4D5] rounded-xl text-xs font-bold focus:ring-2 focus:ring-[#1E3A8A]"
                      >
                        <option value="">Select Area...</option>
                        {helperAreas
                          .filter((a) => !formData.route_id || a.route_id === formData.route_id)
                          .map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.name} ({a.area_code})
                            </option>
                          ))}
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-black uppercase text-slate-600 mb-1">Source Name</label>
                      <select
                        required
                        value={formData.milk_source_id || ''}
                        onChange={(e) => setFormData({ ...formData, milk_source_id: e.target.value })}
                        className="w-full px-3 py-2 border border-[#EAE4D5] rounded-xl text-xs font-bold focus:ring-2 focus:ring-[#1E3A8A]"
                      >
                        <option value="">Select Milk Source...</option>
                        {helperMilkSources.map((ms) => (
                          <option key={ms.id} value={ms.id}>
                            {ms.name} ({ms.erp_code})
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-black uppercase text-slate-600 mb-1">Chiller Ownership</label>
                      <select
                        required
                        value={formData.chiller_ownership_id || ''}
                        onChange={(e) => setFormData({ ...formData, chiller_ownership_id: e.target.value })}
                        className="w-full px-3 py-2 border border-[#EAE4D5] rounded-xl text-xs font-bold focus:ring-2 focus:ring-[#1E3A8A]"
                      >
                        <option value="">Select Chiller Ownership...</option>
                        {helperChillers.map((co) => (
                          <option key={co.id} value={co.id}>
                            {co.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* GPS Optional Coordinates */}
                  <div className="grid grid-cols-2 gap-3 pt-1 border-t border-[#EAE4D5]">
                    <div>
                      <label className="block text-xs font-black uppercase text-slate-600 mb-1">
                        Latitude <span className="text-[10px] text-slate-400 font-normal">(-90 to 90)</span>
                      </label>
                      <input
                        type="number"
                        step="any"
                        value={formData.latitude ?? ''}
                        onChange={(e) => setFormData({ ...formData, latitude: e.target.value })}
                        placeholder="31.2681"
                        className="w-full px-3 py-2 border border-[#EAE4D5] rounded-xl text-xs font-mono font-bold focus:ring-2 focus:ring-[#1E3A8A]"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-black uppercase text-slate-600 mb-1">
                        Longitude <span className="text-[10px] text-slate-400 font-normal">(-180 to 180)</span>
                      </label>
                      <input
                        type="number"
                        step="any"
                        value={formData.longitude ?? ''}
                        onChange={(e) => setFormData({ ...formData, longitude: e.target.value })}
                        placeholder="72.3181"
                        className="w-full px-3 py-2 border border-[#EAE4D5] rounded-xl text-xs font-mono font-bold focus:ring-2 focus:ring-[#1E3A8A]"
                      />
                    </div>
                  </div>
                  <p className="text-[11px] text-slate-500 font-medium">
                    Note: Latitude and Longitude must both be provided, or both omitted.
                  </p>
                </div>
              )}

              {/* Toggle Active Confirmation */}
              {modalType === 'TOGGLE_ACTIVE' && (
                <div className="space-y-3 py-2">
                  <p className="text-xs text-slate-700 font-medium">
                    Are you sure you want to {activeRecord?.is_active ? 'deactivate' : 'activate'}{' '}
                    <strong className="text-[#111311] font-black">
                      {activeRecord?.name || activeRecord?.shop_name}
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
              <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-[#EAE4D5]">
                <button
                  type="button"
                  onClick={closeModal}
                  disabled={isSubmitting}
                  className="px-4 py-2 min-h-[44px] rounded-xl border border-[#EAE4D5] text-xs font-extrabold text-slate-700 hover:bg-slate-100 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className={`px-5 py-2 min-h-[44px] rounded-xl text-xs font-black text-white transition shadow-xs flex items-center gap-2 ${
                    modalType === 'TOGGLE_ACTIVE' && activeRecord?.is_active
                      ? 'bg-rose-600 hover:bg-rose-700'
                      : 'bg-[#1E3A8A] hover:bg-blue-900'
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
          </div>
        </div>
      )}
    </div>
  );
};
