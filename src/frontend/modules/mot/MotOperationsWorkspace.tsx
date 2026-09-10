'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Truck,
  Send,
  Navigation,
  MapPin,
  Store,
  Clock,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  RotateCw,
  Search,
  Plus,
  Edit2,
  Ban,
  User as UserIcon,
  Phone,
  CreditCard,
  Building2,
  X,
} from 'lucide-react';
import { User } from '@core/types';

export type MotWorkspaceTab =
  | 'DISPATCH'
  | 'ACTIVE_JOURNEYS'
  | 'JOURNEY_HISTORY'
  | 'PROFILES'
  | 'VEHICLES';

interface ZmccSource {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
}

interface MotProfileItem {
  id: string;
  mot_code: string;
  name: string;
  phone_number: string;
  cnic: string;
  zmcc_id: string;
  zmcc: { id: string; code: string; name: string };
  user_id: string | null;
  user: { id: string; username: string; full_name: string | null } | null;
  is_active: boolean;
  has_active_journey: boolean;
  active_journey?: { id: string; journey_number: string; status: string } | null;
  creator_name: string;
  updater_name: string | null;
  created_at: string;
}

interface MotVehicleItem {
  id: string;
  vehicle_number: string;
  zmcc_id: string;
  zmcc: { id: string; code: string; name: string };
  is_active: boolean;
  has_active_journey: boolean;
  active_journey?: { id: string; journey_number: string; status: string } | null;
  creator_name: string;
  updater_name: string | null;
  created_at: string;
}

interface RouteOption {
  id: string;
  route_code: string;
  name: string;
  zmcc_id: string;
  is_active: boolean;
  _count?: { areas: number };
}

interface JourneyItem {
  id: string;
  journey_number: string;
  operational_date: string;
  zmcc_id: string;
  zmcc: { id: string; code: string; name: string };
  route_id: string;
  route: { id: string; route_code: string; name: string };
  mot_profile_id: string;
  mot_profile: { id: string; mot_code: string; name: string; phone_number: string };
  mot_vehicle_id: string;
  mot_vehicle: { id: string; vehicle_number: string };
  status: string;
  assigned_by_name: string;
  assigned_at: string;
  assignment_latitude: number;
  assignment_longitude: number;
  assignment_gps_accuracy: number | null;
  started_at: string;
  ended_at: string | null;
  cancelled_by_name: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  total_stops?: number;
  stops?: Array<{
    id: string;
    planned_sequence: number;
    status: string;
    shop?: {
      id: string;
      shop_code: string;
      shop_name: string;
      owner_name: string;
      contact_number: string;
    } | null;
  }>;
  locations?: Array<{
    id: string;
    source_type: string;
    latitude: number;
    longitude: number;
    device_recorded_at: string;
  }>;
}

interface MotOperationsWorkspaceProps {
  currentUser: User | null;
  initialTab?: MotWorkspaceTab;
}

export const MotOperationsWorkspace: React.FC<MotOperationsWorkspaceProps> = ({
  currentUser,
  initialTab = 'DISPATCH',
}) => {
  const isSuperAdmin = currentUser?.role === 'SUPER_ADMIN';
  const isZmccManager = currentUser?.role === 'ZMCC_MANAGER';
  const isPheOperator = currentUser?.role === 'PHE_OPERATOR';

  // Permitted tabs
  const permittedTabs: { id: MotWorkspaceTab; label: string; icon: any }[] = useMemo(() => {
    const tabs: { id: MotWorkspaceTab; label: string; icon: any }[] = [
      { id: 'DISPATCH', label: 'Assign & Dispatch', icon: Send },
      { id: 'ACTIVE_JOURNEYS', label: 'Active Journeys', icon: Truck },
      { id: 'JOURNEY_HISTORY', label: 'Journey History', icon: Clock },
    ];
    if (!isPheOperator) {
      tabs.push(
        { id: 'PROFILES', label: 'MOT Profiles', icon: UserIcon },
        { id: 'VEHICLES', label: 'MOT Vehicles', icon: Navigation }
      );
    }
    return tabs;
  }, [isPheOperator]);

  const [activeTab, setActiveTab] = useState<MotWorkspaceTab>(initialTab);

  // ZMCC Scope
  const [sources, setSources] = useState<ZmccSource[]>([]);
  const [selectedZmccId, setSelectedZmccId] = useState<string>('');

  // Data states
  const [profiles, setProfiles] = useState<MotProfileItem[]>([]);
  const [vehicles, setVehicles] = useState<MotVehicleItem[]>([]);
  const [routes, setRoutes] = useState<RouteOption[]>([]);
  const [journeys, setJourneys] = useState<JourneyItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Search & Filter
  const [searchQuery, setSearchQuery] = useState('');
  const [historyStatusFilter, setHistoryStatusFilter] = useState('all');

  // Dispatch Form State
  const [dispatchRouteId, setDispatchRouteId] = useState('');
  const [dispatchProfileId, setDispatchProfileId] = useState('');
  const [dispatchVehicleId, setDispatchVehicleId] = useState('');
  const [gpsLocation, setGpsLocation] = useState<{
    latitude: number;
    longitude: number;
    accuracy: number | null;
  } | null>(null);
  const [gpsStatus, setGpsStatus] = useState<'IDLE' | 'ACQUIRING' | 'SUCCESS' | 'ERROR'>('IDLE');
  const [gpsErrorMsg, setGpsErrorMsg] = useState('');

  // Modals
  const [selectedJourneyDetail, setSelectedJourneyDetail] = useState<JourneyItem | null>(null);
  const [cancelModalJourney, setCancelModalJourney] = useState<JourneyItem | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [editingProfile, setEditingProfile] = useState<MotProfileItem | null>(null);
  const [profileForm, setProfileForm] = useState({
    mot_code: '',
    name: '',
    phone_number: '',
    cnic: '',
    user_id: '',
    zmcc_id: '',
  });

  const [vehicleModalOpen, setVehicleModalOpen] = useState(false);
  const [editingVehicle, setEditingVehicle] = useState<MotVehicleItem | null>(null);
  const [vehicleForm, setVehicleForm] = useState({
    vehicle_number: '',
    zmcc_id: '',
  });

  // Effective ZMCC
  const effectiveZmccId = useMemo(() => {
    if (isSuperAdmin) return selectedZmccId || null;
    return currentUser?.procurement_source_id ? String(currentUser.procurement_source_id) : null;
  }, [isSuperAdmin, selectedZmccId, currentUser]);

  // Fetch ZMCC Sources for Super Admin
  useEffect(() => {
    if (isSuperAdmin) {
      fetch('/api/super-admin/sources?source_type=ZMCC')
        .then((res) => res.json())
        .then((data) => {
          const list = (data.sources || []).filter((s: any) => s.is_active);
          setSources(list);
          if (list.length > 0 && !selectedZmccId) {
            setSelectedZmccId(list[0].id);
          }
        })
        .catch(() => {});
    }
  }, [isSuperAdmin, selectedZmccId]);

  // Acquire GPS on Dispatch tab
  const acquireGps = useCallback(() => {
    if (!navigator.geolocation) {
      setGpsStatus('ERROR');
      setGpsErrorMsg('Geolocation is not supported by your browser.');
      return;
    }
    setGpsStatus('ACQUIRING');
    setGpsErrorMsg('');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGpsLocation({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        });
        setGpsStatus('SUCCESS');
      },
      (err) => {
        setGpsStatus('ERROR');
        setGpsErrorMsg(`GPS Error: ${err.message}. Please enable location permissions.`);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  }, []);

  useEffect(() => {
    if (activeTab === 'DISPATCH' && gpsStatus === 'IDLE') {
      acquireGps();
    }
  }, [activeTab, gpsStatus, acquireGps]);

  // Load Data based on activeTab and effectiveZmccId
  const loadData = useCallback(async () => {
    if (!effectiveZmccId && !isSuperAdmin) return;
    setLoading(true);
    setError(null);

    const zmccParam = effectiveZmccId ? `zmcc_id=${effectiveZmccId}` : '';

    try {
      if (activeTab === 'DISPATCH') {
        // Load active routes, active profiles, active vehicles
        const [rRes, pRes, vRes] = await Promise.all([
          fetch(`/api/zmcc/routes?${zmccParam}&is_active=true`),
          fetch(`/api/zmcc/mot/profiles?${zmccParam}&is_active=true`),
          fetch(`/api/zmcc/mot/vehicles?${zmccParam}&is_active=true`),
        ]);
        const rData = await rRes.json();
        const pData = await pRes.json();
        const vData = await vRes.json();
        setRoutes(rData.routes || []);
        setProfiles(pData.profiles || []);
        setVehicles(vData.vehicles || []);
      } else if (activeTab === 'ACTIVE_JOURNEYS') {
        const res = await fetch(`/api/zmcc/mot/journeys?${zmccParam}&status=COLLECTING`);
        const data = await res.json();
        setJourneys(data.journeys || []);
      } else if (activeTab === 'JOURNEY_HISTORY') {
        const statusParam = historyStatusFilter !== 'all' ? `&status=${historyStatusFilter}` : '';
        const res = await fetch(`/api/zmcc/mot/journeys?${zmccParam}${statusParam}`);
        const data = await res.json();
        setJourneys(data.journeys || []);
      } else if (activeTab === 'PROFILES') {
        const res = await fetch(`/api/zmcc/mot/profiles?${zmccParam}`);
        const data = await res.json();
        setProfiles(data.profiles || []);
      } else if (activeTab === 'VEHICLES') {
        const res = await fetch(`/api/zmcc/mot/vehicles?${zmccParam}`);
        const data = await res.json();
        setVehicles(data.vehicles || []);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load MOT data.');
    } finally {
      setLoading(false);
    }
  }, [activeTab, effectiveZmccId, isSuperAdmin, historyStatusFilter]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Handle Assign & Dispatch
  const handleAssignAndDispatch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dispatchRouteId || !dispatchProfileId || !dispatchVehicleId) {
      setError('Please select Route, MOT Driver, and Vehicle.');
      return;
    }
    if (!gpsLocation) {
      setError('GPS coordinates are required. Please acquire your GPS position before dispatching.');
      return;
    }

    setActionLoading(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const idempotencyKey =
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `DISP-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      const payload = {
        zmcc_id: effectiveZmccId || undefined,
        route_id: dispatchRouteId,
        mot_profile_id: dispatchProfileId,
        mot_vehicle_id: dispatchVehicleId,
        latitude: gpsLocation.latitude,
        longitude: gpsLocation.longitude,
        accuracy: gpsLocation.accuracy,
        idempotency_key: idempotencyKey,
      };

      const res = await fetch('/api/zmcc/mot/journeys/assign-and-dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to assign and dispatch journey.');
      }

      setSuccessMessage(
        `Journey #${data.journey.journey_number} dispatched successfully! ${data.journey.stops?.length || 0} planned shops snapshot captured.`
      );
      setDispatchRouteId('');
      setDispatchProfileId('');
      setDispatchVehicleId('');
      // Switch to active journeys
      setActiveTab('ACTIVE_JOURNEYS');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setActionLoading(false);
    }
  };

  // Handle Cancellation
  const handleCancelSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cancelModalJourney) return;
    if (!cancelReason.trim() || cancelReason.trim().length < 3) {
      setError('Cancellation reason must be at least 3 characters.');
      return;
    }

    setActionLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/zmcc/mot/journeys/${cancelModalJourney.id}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: cancelReason.trim() }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to cancel journey.');
      }

      setSuccessMessage(`Journey #${cancelModalJourney.journey_number} cancelled successfully.`);
      setCancelModalJourney(null);
      setCancelReason('');
      loadData();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setActionLoading(false);
    }
  };

  // Inspect Journey Details
  const handleInspectJourney = async (journeyId: string) => {
    try {
      const res = await fetch(`/api/zmcc/mot/journeys/${journeyId}`);
      const data = await res.json();
      if (res.ok && data.journey) {
        setSelectedJourneyDetail(data.journey);
      }
    } catch {
      // ignore
    }
  };

  // Profile Create / Edit
  const handleOpenProfileModal = (item?: MotProfileItem) => {
    if (item) {
      setEditingProfile(item);
      setProfileForm({
        mot_code: item.mot_code,
        name: item.name,
        phone_number: item.phone_number,
        cnic: item.cnic,
        user_id: item.user_id || '',
        zmcc_id: item.zmcc_id,
      });
    } else {
      setEditingProfile(null);
      setProfileForm({
        mot_code: '',
        name: '',
        phone_number: '',
        cnic: '',
        user_id: '',
        zmcc_id: effectiveZmccId || '',
      });
    }
    setProfileModalOpen(true);
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionLoading(true);
    setError(null);

    try {
      const url = editingProfile
        ? `/api/zmcc/mot/profiles/${editingProfile.id}`
        : '/api/zmcc/mot/profiles';
      const method = editingProfile ? 'PATCH' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...profileForm,
          zmcc_id: isSuperAdmin ? profileForm.zmcc_id || effectiveZmccId : effectiveZmccId,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to save MOT Profile.');
      }

      setSuccessMessage(
        editingProfile ? 'MOT Profile updated successfully.' : 'MOT Profile created successfully.'
      );
      setProfileModalOpen(false);
      loadData();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleToggleProfileActive = async (profile: MotProfileItem) => {
    if (profile.has_active_journey && profile.is_active) {
      setError('Cannot deactivate an MOT Profile with an active journey.');
      return;
    }
    setActionLoading(true);
    try {
      const res = await fetch(`/api/zmcc/mot/profiles/${profile.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !profile.is_active }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      loadData();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setActionLoading(false);
    }
  };

  // Vehicle Create / Edit
  const handleOpenVehicleModal = (item?: MotVehicleItem) => {
    if (item) {
      setEditingVehicle(item);
      setVehicleForm({
        vehicle_number: item.vehicle_number,
        zmcc_id: item.zmcc_id,
      });
    } else {
      setEditingVehicle(null);
      setVehicleForm({
        vehicle_number: '',
        zmcc_id: effectiveZmccId || '',
      });
    }
    setVehicleModalOpen(true);
  };

  const handleSaveVehicle = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionLoading(true);
    setError(null);

    try {
      const url = editingVehicle
        ? `/api/zmcc/mot/vehicles/${editingVehicle.id}`
        : '/api/zmcc/mot/vehicles';
      const method = editingVehicle ? 'PATCH' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...vehicleForm,
          zmcc_id: isSuperAdmin ? vehicleForm.zmcc_id || effectiveZmccId : effectiveZmccId,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to save MOT Vehicle.');
      }

      setSuccessMessage(
        editingVehicle ? 'MOT Vehicle updated successfully.' : 'MOT Vehicle created successfully.'
      );
      setVehicleModalOpen(false);
      loadData();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleToggleVehicleActive = async (vehicle: MotVehicleItem) => {
    if (vehicle.has_active_journey && vehicle.is_active) {
      setError('Cannot deactivate an MOT Vehicle with an active journey.');
      return;
    }
    setActionLoading(true);
    try {
      const res = await fetch(`/api/zmcc/mot/vehicles/${vehicle.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !vehicle.is_active }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      loadData();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Header & ZMCC Selector */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-4 bg-white rounded-2xl border border-[#EAE4D5] shadow-xs">
        <div className="flex items-center space-x-3">
          <div className="p-2.5 bg-[#1E3A8A] text-white rounded-xl shadow-xs">
            <Truck className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-base sm:text-lg font-black text-[#111311] tracking-tight">
              MOT Operations & Dispatch
            </h1>
            <p className="text-xs text-slate-500 font-medium">
              Milk Operator / Transporter dispatch, route journey tracking, and fleet foundation.
            </p>
          </div>
        </div>

        {isSuperAdmin && sources.length > 0 && (
          <div className="flex items-center space-x-2">
            <label htmlFor="zmcc-select" className="text-xs font-bold text-slate-700 whitespace-nowrap">
              ZMCC Center:
            </label>
            <select
              id="zmcc-select"
              value={selectedZmccId}
              onChange={(e) => setSelectedZmccId(e.target.value)}
              className="text-xs font-bold border border-[#EAE4D5] rounded-xl px-3 py-2 bg-[#FDFBF9] text-[#111311] focus:ring-2 focus:ring-[#1E3A8A] focus:outline-none"
            >
              {sources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.code})
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Notifications */}
      {error && (
        <div className="flex items-center justify-between p-3.5 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-xs font-bold">
          <div className="flex items-center space-x-2">
            <AlertTriangle className="w-4 h-4 shrink-0 text-rose-600" />
            <span>{error}</span>
          </div>
          <button
            type="button"
            onClick={() => setError(null)}
            className="p-1 text-rose-600 hover:text-rose-900"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {successMessage && (
        <div className="flex items-center justify-between p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800 text-xs font-bold">
          <div className="flex items-center space-x-2">
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
            <span>{successMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => setSuccessMessage(null)}
            className="p-1 text-emerald-600 hover:text-emerald-900"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex flex-wrap gap-1.5 p-1.5 bg-[#F4F0E6]/50 rounded-2xl border border-[#EAE4D5]">
        {permittedTabs.map((tab) => {
          const IconComp = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                setActiveTab(tab.id);
                setError(null);
                setSuccessMessage(null);
              }}
              className={`flex items-center space-x-2 px-3.5 py-2 rounded-xl text-xs font-black transition-all ${
                isActive
                  ? 'bg-[#1E3A8A] text-white shadow-xs'
                  : 'bg-transparent text-slate-700 hover:bg-white/80 hover:text-[#111311]'
              }`}
            >
              <IconComp className="w-4 h-4" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* TAB 1: ASSIGN & DISPATCH */}
      {activeTab === 'DISPATCH' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* Dispatch Form */}
          <div className="lg:col-span-2 bg-white p-5 rounded-2xl border border-[#EAE4D5] shadow-xs space-y-4">
            <div className="flex items-center justify-between border-b border-[#EAE4D5] pb-3">
              <div>
                <h2 className="text-sm font-black text-[#111311]">Physical Assign & Departure</h2>
                <p className="text-xs text-slate-500 font-medium">
                  Assign MOT driver and vehicle when physically ready to depart for milk collection.
                </p>
              </div>
              <span className="px-2.5 py-1 rounded-full bg-blue-100 text-[#1E3A8A] text-[10px] font-black uppercase">
                Immediate Departure
              </span>
            </div>

            <form onSubmit={handleAssignAndDispatch} className="space-y-4">
              {/* Route Selection */}
              <div>
                <label className="block text-xs font-black text-[#111311] mb-1">
                  Assigned Route <span className="text-rose-600">*</span>
                </label>
                <select
                  value={dispatchRouteId}
                  onChange={(e) => setDispatchRouteId(e.target.value)}
                  className="w-full text-xs font-bold border border-[#EAE4D5] rounded-xl p-2.5 bg-[#FDFBF9] text-[#111311] focus:ring-2 focus:ring-[#1E3A8A]"
                  required
                >
                  <option value="">-- Select Collection Route --</option>
                  {routes.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.route_code} — {r.name}
                    </option>
                  ))}
                </select>
                {routes.length === 0 && (
                  <p className="text-[11px] text-amber-700 font-semibold mt-1">
                    No active routes found for this ZMCC.
                  </p>
                )}
              </div>

              {/* MOT Profile (Driver) */}
              <div>
                <label className="block text-xs font-black text-[#111311] mb-1">
                  MOT Driver / Operator <span className="text-rose-600">*</span>
                </label>
                <select
                  value={dispatchProfileId}
                  onChange={(e) => setDispatchProfileId(e.target.value)}
                  className="w-full text-xs font-bold border border-[#EAE4D5] rounded-xl p-2.5 bg-[#FDFBF9] text-[#111311] focus:ring-2 focus:ring-[#1E3A8A]"
                  required
                >
                  <option value="">-- Select MOT Driver --</option>
                  {profiles.map((p) => (
                    <option
                      key={p.id}
                      value={p.id}
                      disabled={p.has_active_journey}
                    >
                      {p.mot_code} — {p.name} ({p.phone_number})
                      {p.has_active_journey ? ' [ACTIVE JOURNEY]' : ''}
                    </option>
                  ))}
                </select>
              </div>

              {/* Vehicle Selection */}
              <div>
                <label className="block text-xs font-black text-[#111311] mb-1">
                  Collection Vehicle <span className="text-rose-600">*</span>
                </label>
                <select
                  value={dispatchVehicleId}
                  onChange={(e) => setDispatchVehicleId(e.target.value)}
                  className="w-full text-xs font-bold border border-[#EAE4D5] rounded-xl p-2.5 bg-[#FDFBF9] text-[#111311] focus:ring-2 focus:ring-[#1E3A8A]"
                  required
                >
                  <option value="">-- Select Vehicle --</option>
                  {vehicles.map((v) => (
                    <option
                      key={v.id}
                      value={v.id}
                      disabled={v.has_active_journey}
                    >
                      {v.vehicle_number}
                      {v.has_active_journey ? ' [ACTIVE JOURNEY]' : ''}
                    </option>
                  ))}
                </select>
              </div>

              {/* GPS Coordinates Display & Trigger */}
              <div className="p-3.5 rounded-xl border border-[#EAE4D5] bg-[#FDFBF9] space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <MapPin className="w-4 h-4 text-[#1E3A8A]" />
                    <span className="text-xs font-black text-[#111311]">
                      Assigning User GPS Coordinates
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={acquireGps}
                    disabled={gpsStatus === 'ACQUIRING'}
                    className="flex items-center space-x-1 px-2.5 py-1 rounded-lg bg-white border border-[#EAE4D5] text-[11px] font-bold text-slate-700 hover:bg-[#F4F0E6]"
                  >
                    <RotateCw className={`w-3 h-3 ${gpsStatus === 'ACQUIRING' ? 'animate-spin' : ''}`} />
                    <span>{gpsStatus === 'ACQUIRING' ? 'Acquiring...' : 'Refresh GPS'}</span>
                  </button>
                </div>

                {gpsStatus === 'SUCCESS' && gpsLocation && (
                  <div className="flex items-center space-x-2 text-xs font-mono text-emerald-800 bg-emerald-50 p-2 rounded-lg border border-emerald-200">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span>
                      Lat: {gpsLocation.latitude.toFixed(6)}, Lng: {gpsLocation.longitude.toFixed(6)}
                      {gpsLocation.accuracy != null && ` (±${Math.round(gpsLocation.accuracy)}m)`}
                    </span>
                  </div>
                )}

                {gpsStatus === 'ERROR' && (
                  <div className="text-xs text-rose-700 bg-rose-50 p-2 rounded-lg border border-rose-200">
                    {gpsErrorMsg || 'Failed to obtain GPS coordinates.'}
                  </div>
                )}

                {gpsStatus === 'IDLE' && (
                  <p className="text-xs text-slate-500">Acquiring current GPS location from browser...</p>
                )}
              </div>

              {/* Submit Button */}
              <button
                type="submit"
                disabled={actionLoading || !gpsLocation || !dispatchRouteId || !dispatchProfileId || !dispatchVehicleId}
                className="w-full min-h-[44px] flex items-center justify-center space-x-2 px-4 py-3 rounded-xl bg-[#1E3A8A] text-white text-xs font-black hover:bg-[#1E3A8A]/90 transition shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Send className="w-4 h-4" />
                <span>{actionLoading ? 'Assigning & Dispatching...' : 'Assign & Dispatch (Begin Journey)'}</span>
              </button>
            </form>
          </div>

          {/* Quick Rules & Architecture info panel */}
          <div className="bg-white p-5 rounded-2xl border border-[#EAE4D5] shadow-xs space-y-3 h-fit">
            <h3 className="text-xs font-black uppercase text-[#111311] tracking-wider">
              Operational Rules
            </h3>
            <ul className="text-xs text-slate-600 space-y-2 font-medium">
              <li className="flex items-start space-x-2">
                <span className="text-[#1E3A8A] font-bold">•</span>
                <span>
                  <strong>No Accept Button:</strong> The MOT journey immediately transitions to <code>COLLECTING</code> upon dispatch.
                </span>
              </li>
              <li className="flex items-start space-x-2">
                <span className="text-[#1E3A8A] font-bold">•</span>
                <span>
                  <strong>Shop Snapshot:</strong> All active shops on the selected route are frozen into planned stops in stable sequence.
                </span>
              </li>
              <li className="flex items-start space-x-2">
                <span className="text-[#1E3A8A] font-bold">•</span>
                <span>
                  <strong>Single Active Journey:</strong> Neither the MOT Driver nor the Vehicle can have multiple concurrent active journeys.
                </span>
              </li>
              <li className="flex items-start space-x-2">
                <span className="text-[#1E3A8A] font-bold">•</span>
                <span>
                  <strong>Cancellation:</strong> Only Super Admin or the assigned ZMCC Manager can cancel a journey with a mandatory reason.
                </span>
              </li>
            </ul>
          </div>
        </div>
      )}

      {/* TAB 2: ACTIVE JOURNEYS */}
      {activeTab === 'ACTIVE_JOURNEYS' && (
        <div className="bg-white rounded-2xl border border-[#EAE4D5] shadow-xs overflow-hidden">
          <div className="p-4 border-b border-[#EAE4D5] flex items-center justify-between">
            <div>
              <h2 className="text-sm font-black text-[#111311]">Active Collection Journeys</h2>
              <p className="text-xs text-slate-500 font-medium">
                Journeys currently in progress (<code>COLLECTING</code>).
              </p>
            </div>
            <button
              type="button"
              onClick={loadData}
              className="flex items-center space-x-1 px-3 py-1.5 rounded-xl border border-[#EAE4D5] text-xs font-bold text-slate-700 hover:bg-[#F4F0E6]"
            >
              <RotateCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </button>
          </div>

          {loading ? (
            <div className="p-8 text-center text-xs font-bold text-slate-500">Loading active journeys...</div>
          ) : journeys.length === 0 ? (
            <div className="p-8 text-center text-xs font-bold text-slate-500">
              No active journeys currently in progress.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-[#F4F0E6]/60 text-slate-700 uppercase font-black tracking-wider text-[10px] border-b border-[#EAE4D5]">
                  <tr>
                    <th className="p-3">Journey #</th>
                    <th className="p-3">Route</th>
                    <th className="p-3">MOT Driver</th>
                    <th className="p-3">Vehicle</th>
                    <th className="p-3">Stops</th>
                    <th className="p-3">Dispatched At</th>
                    <th className="p-3">Dispatched By</th>
                    <th className="p-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EAE4D5]">
                  {journeys.map((j) => (
                    <tr key={j.id} className="hover:bg-[#FDFBF9]">
                      <td className="p-3 font-mono font-black text-[#1E3A8A]">
                        {j.journey_number}
                      </td>
                      <td className="p-3 font-bold text-[#111311]">
                        {j.route?.route_code} — {j.route?.name}
                      </td>
                      <td className="p-3 font-bold text-[#111311]">
                        {j.mot_profile?.name} ({j.mot_profile?.mot_code})
                      </td>
                      <td className="p-3 font-mono font-bold text-slate-700">
                        {j.mot_vehicle?.vehicle_number}
                      </td>
                      <td className="p-3 font-bold text-slate-700">
                        {j.total_stops != null ? `${j.total_stops} shops` : '—'}
                      </td>
                      <td className="p-3 font-medium text-slate-600">
                        {new Date(j.assigned_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td className="p-3 font-medium text-slate-600">{j.assigned_by_name}</td>
                      <td className="p-3 text-right space-x-2">
                        <button
                          type="button"
                          onClick={() => handleInspectJourney(j.id)}
                          className="px-2.5 py-1 rounded-lg bg-blue-50 text-[#1E3A8A] font-black hover:bg-blue-100"
                        >
                          View Stops
                        </button>
                        {(isSuperAdmin || isZmccManager) && (
                          <button
                            type="button"
                            onClick={() => {
                              setCancelModalJourney(j);
                              setCancelReason('');
                            }}
                            className="px-2.5 py-1 rounded-lg bg-rose-50 text-rose-700 font-black hover:bg-rose-100"
                          >
                            Cancel
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* TAB 3: JOURNEY HISTORY */}
      {activeTab === 'JOURNEY_HISTORY' && (
        <div className="bg-white rounded-2xl border border-[#EAE4D5] shadow-xs overflow-hidden space-y-3">
          <div className="p-4 border-b border-[#EAE4D5] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h2 className="text-sm font-black text-[#111311]">Journey Historical Ledger</h2>
              <p className="text-xs text-slate-500 font-medium">All historical dispatches and journey outcomes.</p>
            </div>
            <div className="flex items-center space-x-2">
              <select
                value={historyStatusFilter}
                onChange={(e) => setHistoryStatusFilter(e.target.value)}
                className="text-xs font-bold border border-[#EAE4D5] rounded-xl px-3 py-1.5 bg-[#FDFBF9] text-[#111311]"
              >
                <option value="all">All Statuses</option>
                <option value="COLLECTING">Collecting</option>
                <option value="COMPLETED">Completed</option>
                <option value="CANCELLED">Cancelled</option>
              </select>
              <button
                type="button"
                onClick={loadData}
                className="flex items-center space-x-1 px-3 py-1.5 rounded-xl border border-[#EAE4D5] text-xs font-bold text-slate-700 hover:bg-[#F4F0E6]"
              >
                <RotateCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                <span>Refresh</span>
              </button>
            </div>
          </div>

          {loading ? (
            <div className="p-8 text-center text-xs font-bold text-slate-500">Loading journey history...</div>
          ) : journeys.length === 0 ? (
            <div className="p-8 text-center text-xs font-bold text-slate-500">No journeys recorded.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-[#F4F0E6]/60 text-slate-700 uppercase font-black tracking-wider text-[10px] border-b border-[#EAE4D5]">
                  <tr>
                    <th className="p-3">Journey #</th>
                    <th className="p-3">Date</th>
                    <th className="p-3">Route</th>
                    <th className="p-3">MOT Driver</th>
                    <th className="p-3">Vehicle</th>
                    <th className="p-3">Status</th>
                    <th className="p-3">Dispatched At</th>
                    <th className="p-3">Outcome</th>
                    <th className="p-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EAE4D5]">
                  {journeys.map((j) => (
                    <tr key={j.id} className="hover:bg-[#FDFBF9]">
                      <td className="p-3 font-mono font-black text-[#1E3A8A]">{j.journey_number}</td>
                      <td className="p-3 font-medium text-slate-600">{j.operational_date}</td>
                      <td className="p-3 font-bold text-[#111311]">{j.route?.route_code}</td>
                      <td className="p-3 font-bold text-[#111311]">{j.mot_profile?.name}</td>
                      <td className="p-3 font-mono font-bold text-slate-700">{j.mot_vehicle?.vehicle_number}</td>
                      <td className="p-3">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase ${
                            j.status === 'COLLECTING'
                              ? 'bg-blue-100 text-blue-800'
                              : j.status === 'COMPLETED'
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-rose-100 text-rose-800'
                          }`}
                        >
                          {j.status}
                        </span>
                      </td>
                      <td className="p-3 font-medium text-slate-600">
                        {new Date(j.assigned_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td className="p-3 text-slate-600 font-medium">
                        {j.status === 'CANCELLED' ? (
                          <span className="text-rose-700 text-[11px]" title={j.cancellation_reason || ''}>
                            Cancelled by {j.cancelled_by_name}: {j.cancellation_reason?.slice(0, 30)}...
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="p-3 text-right">
                        <button
                          type="button"
                          onClick={() => handleInspectJourney(j.id)}
                          className="px-2.5 py-1 rounded-lg bg-blue-50 text-[#1E3A8A] font-black hover:bg-blue-100"
                        >
                          View Stops
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* TAB 4: MOT PROFILES (SUPER ADMIN & ZMCC MANAGER ONLY) */}
      {activeTab === 'PROFILES' && !isPheOperator && (
        <div className="bg-white rounded-2xl border border-[#EAE4D5] shadow-xs overflow-hidden space-y-3">
          <div className="p-4 border-b border-[#EAE4D5] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h2 className="text-sm font-black text-[#111311]">MOT Drivers & Profiles</h2>
              <p className="text-xs text-slate-500 font-medium">
                Manage registered Milk Operators / Transporters for this ZMCC.
              </p>
            </div>
            <button
              type="button"
              onClick={() => handleOpenProfileModal()}
              className="flex items-center space-x-1.5 px-3.5 py-2 rounded-xl bg-[#1E3A8A] text-white text-xs font-black hover:bg-[#1E3A8A]/90 transition"
            >
              <Plus className="w-4 h-4" />
              <span>Add MOT Profile</span>
            </button>
          </div>

          {loading ? (
            <div className="p-8 text-center text-xs font-bold text-slate-500">Loading profiles...</div>
          ) : profiles.length === 0 ? (
            <div className="p-8 text-center text-xs font-bold text-slate-500">
              No MOT profiles registered for this ZMCC.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-[#F4F0E6]/60 text-slate-700 uppercase font-black tracking-wider text-[10px] border-b border-[#EAE4D5]">
                  <tr>
                    <th className="p-3">MOT Code</th>
                    <th className="p-3">Name</th>
                    <th className="p-3">Phone</th>
                    <th className="p-3">CNIC</th>
                    <th className="p-3">Linked User</th>
                    <th className="p-3">Active Journey</th>
                    <th className="p-3">Status</th>
                    <th className="p-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EAE4D5]">
                  {profiles.map((p) => (
                    <tr key={p.id} className="hover:bg-[#FDFBF9]">
                      <td className="p-3 font-mono font-black text-[#1E3A8A]">{p.mot_code}</td>
                      <td className="p-3 font-bold text-[#111311]">{p.name}</td>
                      <td className="p-3 font-medium text-slate-700">{p.phone_number}</td>
                      <td className="p-3 font-mono text-slate-600">{p.cnic}</td>
                      <td className="p-3 text-slate-600 font-medium">
                        {p.user ? `@${p.user.username}` : <span className="text-slate-400">Unlinked</span>}
                      </td>
                      <td className="p-3">
                        {p.has_active_journey ? (
                          <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[10px] font-black">
                            #{p.active_journey?.journey_number}
                          </span>
                        ) : (
                          <span className="text-slate-400 text-[11px]">None (Available)</span>
                        )}
                      </td>
                      <td className="p-3">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase ${
                            p.is_active ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-700'
                          }`}
                        >
                          {p.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="p-3 text-right space-x-2">
                        <button
                          type="button"
                          onClick={() => handleOpenProfileModal(p)}
                          className="px-2.5 py-1 rounded-lg bg-[#F4F0E6] text-slate-800 font-bold hover:bg-[#EAE4D5]"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => handleToggleProfileActive(p)}
                          disabled={p.has_active_journey && p.is_active}
                          className={`px-2.5 py-1 rounded-lg font-bold ${
                            p.is_active
                              ? 'bg-rose-50 text-rose-700 hover:bg-rose-100 disabled:opacity-50'
                              : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                          }`}
                        >
                          {p.is_active ? 'Deactivate' : 'Activate'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* TAB 5: MOT VEHICLES (SUPER ADMIN & ZMCC MANAGER ONLY) */}
      {activeTab === 'VEHICLES' && !isPheOperator && (
        <div className="bg-white rounded-2xl border border-[#EAE4D5] shadow-xs overflow-hidden space-y-3">
          <div className="p-4 border-b border-[#EAE4D5] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h2 className="text-sm font-black text-[#111311]">MOT Vehicles Fleet</h2>
              <p className="text-xs text-slate-500 font-medium">Manage collection vehicles for this ZMCC.</p>
            </div>
            <button
              type="button"
              onClick={() => handleOpenVehicleModal()}
              className="flex items-center space-x-1.5 px-3.5 py-2 rounded-xl bg-[#1E3A8A] text-white text-xs font-black hover:bg-[#1E3A8A]/90 transition"
            >
              <Plus className="w-4 h-4" />
              <span>Add Vehicle</span>
            </button>
          </div>

          {loading ? (
            <div className="p-8 text-center text-xs font-bold text-slate-500">Loading vehicles...</div>
          ) : vehicles.length === 0 ? (
            <div className="p-8 text-center text-xs font-bold text-slate-500">
              No MOT vehicles registered for this ZMCC.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-[#F4F0E6]/60 text-slate-700 uppercase font-black tracking-wider text-[10px] border-b border-[#EAE4D5]">
                  <tr>
                    <th className="p-3">Vehicle Number</th>
                    <th className="p-3">ZMCC Center</th>
                    <th className="p-3">Active Journey</th>
                    <th className="p-3">Status</th>
                    <th className="p-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EAE4D5]">
                  {vehicles.map((v) => (
                    <tr key={v.id} className="hover:bg-[#FDFBF9]">
                      <td className="p-3 font-mono font-black text-[#1E3A8A]">{v.vehicle_number}</td>
                      <td className="p-3 font-medium text-slate-700">{v.zmcc?.name}</td>
                      <td className="p-3">
                        {v.has_active_journey ? (
                          <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[10px] font-black">
                            #{v.active_journey?.journey_number}
                          </span>
                        ) : (
                          <span className="text-slate-400 text-[11px]">None (Available)</span>
                        )}
                      </td>
                      <td className="p-3">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase ${
                            v.is_active ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-700'
                          }`}
                        >
                          {v.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="p-3 text-right space-x-2">
                        <button
                          type="button"
                          onClick={() => handleOpenVehicleModal(v)}
                          className="px-2.5 py-1 rounded-lg bg-[#F4F0E6] text-slate-800 font-bold hover:bg-[#EAE4D5]"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => handleToggleVehicleActive(v)}
                          disabled={v.has_active_journey && v.is_active}
                          className={`px-2.5 py-1 rounded-lg font-bold ${
                            v.is_active
                              ? 'bg-rose-50 text-rose-700 hover:bg-rose-100 disabled:opacity-50'
                              : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                          }`}
                        >
                          {v.is_active ? 'Deactivate' : 'Activate'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* DETAIL MODAL: JOURNEY STOPS & LOCATIONS */}
      {selectedJourneyDetail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-2xl w-full p-6 space-y-4 shadow-2xl border border-[#EAE4D5] max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-[#EAE4D5] pb-3">
              <div>
                <h3 className="text-base font-black text-[#111311]">
                  Journey #{selectedJourneyDetail.journey_number} — Planned Stops
                </h3>
                <p className="text-xs text-slate-500 font-medium">
                  {selectedJourneyDetail.route?.route_code} | Driver: {selectedJourneyDetail.mot_profile?.name} | Vehicle: {selectedJourneyDetail.mot_vehicle?.vehicle_number}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedJourneyDetail(null)}
                className="p-1 rounded-lg border border-[#EAE4D5] text-slate-500 hover:bg-[#F4F0E6]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3">
              <h4 className="text-xs font-black uppercase tracking-wider text-[#111311]">
                Frozen Route Stops ({selectedJourneyDetail.stops?.length || 0} shops)
              </h4>
              <div className="space-y-2">
                {(selectedJourneyDetail.stops || []).map((stop) => (
                  <div
                    key={stop.id}
                    className="flex items-center justify-between p-3 rounded-xl border border-[#EAE4D5] bg-[#FDFBF9]"
                  >
                    <div className="flex items-center space-x-3">
                      <span className="w-6 h-6 rounded-full bg-[#1E3A8A] text-white text-xs font-black flex items-center justify-center">
                        {stop.planned_sequence}
                      </span>
                      <div>
                        <p className="text-xs font-black text-[#111311]">
                          {stop.shop?.shop_name} ({stop.shop?.shop_code})
                        </p>
                        <p className="text-[11px] text-slate-500">
                          Owner: {stop.shop?.owner_name || '—'} | Contact: {stop.shop?.contact_number || '—'}
                        </p>
                      </div>
                    </div>
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase ${
                        stop.status === 'VISITED'
                          ? 'bg-emerald-100 text-emerald-800'
                          : stop.status === 'SKIPPED'
                          ? 'bg-amber-100 text-amber-800'
                          : 'bg-slate-100 text-slate-700'
                      }`}
                    >
                      {stop.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="pt-2 flex justify-end">
              <button
                type="button"
                onClick={() => setSelectedJourneyDetail(null)}
                className="px-4 py-2 rounded-xl bg-[#1E3A8A] text-white text-xs font-black"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CANCELLATION MODAL */}
      {cancelModalJourney && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-md w-full p-5 space-y-4 shadow-2xl border border-[#EAE4D5]">
            <div className="flex items-center space-x-2 text-rose-700">
              <Ban className="w-5 h-5" />
              <h3 className="text-sm font-black">Cancel Collection Journey</h3>
            </div>
            <p className="text-xs text-slate-600 font-medium">
              You are cancelling active Journey <strong>#{cancelModalJourney.journey_number}</strong>. This operation is authoritative and cannot be undone.
            </p>

            <form onSubmit={handleCancelSubmit} className="space-y-3">
              <div>
                <label className="block text-xs font-black text-[#111311] mb-1">
                  Reason for Cancellation <span className="text-rose-600">*</span>
                </label>
                <textarea
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  placeholder="e.g. Mechanical breakdown, road blockage, vehicle swap required..."
                  className="w-full text-xs font-medium border border-[#EAE4D5] rounded-xl p-2.5 bg-[#FDFBF9] text-[#111311] focus:ring-2 focus:ring-rose-500"
                  rows={3}
                  required
                />
              </div>

              <div className="flex items-center justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setCancelModalJourney(null)}
                  className="px-3 py-2 rounded-xl border border-[#EAE4D5] text-xs font-bold text-slate-700 hover:bg-[#F4F0E6]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading || !cancelReason.trim()}
                  className="px-4 py-2 rounded-xl bg-rose-600 text-white text-xs font-black hover:bg-rose-700 disabled:opacity-50"
                >
                  {actionLoading ? 'Cancelling...' : 'Confirm Cancellation'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* PROFILE CREATE/EDIT MODAL */}
      {profileModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-md w-full p-5 space-y-4 shadow-2xl border border-[#EAE4D5]">
            <h3 className="text-sm font-black text-[#111311]">
              {editingProfile ? 'Edit MOT Profile' : 'New MOT Driver Profile'}
            </h3>

            <form onSubmit={handleSaveProfile} className="space-y-3">
              {!editingProfile && (
                <div>
                  <label className="block text-xs font-black text-[#111311] mb-1">MOT Code *</label>
                  <input
                    type="text"
                    value={profileForm.mot_code}
                    onChange={(e) => setProfileForm({ ...profileForm, mot_code: e.target.value })}
                    placeholder="e.g. MOT-001"
                    className="w-full text-xs font-bold border border-[#EAE4D5] rounded-xl p-2.5 bg-[#FDFBF9]"
                    required
                  />
                </div>
              )}

              <div>
                <label className="block text-xs font-black text-[#111311] mb-1">Driver Full Name *</label>
                <input
                  type="text"
                  value={profileForm.name}
                  onChange={(e) => setProfileForm({ ...profileForm, name: e.target.value })}
                  placeholder="e.g. Muhammad Aslam"
                  className="w-full text-xs font-bold border border-[#EAE4D5] rounded-xl p-2.5 bg-[#FDFBF9]"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-black text-[#111311] mb-1">Phone Number *</label>
                <input
                  type="text"
                  value={profileForm.phone_number}
                  onChange={(e) => setProfileForm({ ...profileForm, phone_number: e.target.value })}
                  placeholder="0300-1234567"
                  className="w-full text-xs font-bold border border-[#EAE4D5] rounded-xl p-2.5 bg-[#FDFBF9]"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-black text-[#111311] mb-1">CNIC Number *</label>
                <input
                  type="text"
                  value={profileForm.cnic}
                  onChange={(e) => setProfileForm({ ...profileForm, cnic: e.target.value })}
                  placeholder="35201-1234567-1"
                  className="w-full text-xs font-bold border border-[#EAE4D5] rounded-xl p-2.5 bg-[#FDFBF9]"
                  required
                />
              </div>

              <div className="flex items-center justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setProfileModalOpen(false)}
                  className="px-3 py-2 rounded-xl border border-[#EAE4D5] text-xs font-bold text-slate-700 hover:bg-[#F4F0E6]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="px-4 py-2 rounded-xl bg-[#1E3A8A] text-white text-xs font-black hover:bg-[#1E3A8A]/90 disabled:opacity-50"
                >
                  {actionLoading ? 'Saving...' : 'Save Profile'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* VEHICLE CREATE/EDIT MODAL */}
      {vehicleModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-md w-full p-5 space-y-4 shadow-2xl border border-[#EAE4D5]">
            <h3 className="text-sm font-black text-[#111311]">
              {editingVehicle ? 'Edit MOT Vehicle' : 'New MOT Collection Vehicle'}
            </h3>

            <form onSubmit={handleSaveVehicle} className="space-y-3">
              <div>
                <label className="block text-xs font-black text-[#111311] mb-1">Vehicle Registration # *</label>
                <input
                  type="text"
                  value={vehicleForm.vehicle_number}
                  onChange={(e) => setVehicleForm({ ...vehicleForm, vehicle_number: e.target.value })}
                  placeholder="e.g. LES-1234"
                  className="w-full text-xs font-mono font-bold border border-[#EAE4D5] rounded-xl p-2.5 bg-[#FDFBF9]"
                  required
                />
              </div>

              <div className="flex items-center justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setVehicleModalOpen(false)}
                  className="px-3 py-2 rounded-xl border border-[#EAE4D5] text-xs font-bold text-slate-700 hover:bg-[#F4F0E6]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="px-4 py-2 rounded-xl bg-[#1E3A8A] text-white text-xs font-black hover:bg-[#1E3A8A]/90 disabled:opacity-50"
                >
                  {actionLoading ? 'Saving...' : 'Save Vehicle'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
