'use client';

import React, { useState, useEffect, useCallback, useMemo, useSyncExternalStore } from 'react';
import {
  Truck,
  Send,
  Navigation,
  MapPin,
  Clock,
  AlertTriangle,
  CheckCircle2,
  Plus,
  Ban,
  User as UserIcon,
  Phone,
  MessageSquare,
  X,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react';
import { User } from '@core/types';
import { ManagerJourneyMap } from './ManagerJourneyMap';
import { SmsOutboxView } from './SmsOutboxView';
import { Modal } from '@/components/ui/modal';
import { SegmentedTabs } from '@/components/ui/segmented-tabs';
import { AnimatePresence } from 'framer-motion';
import { getErrorMessage } from '@/lib/errors';
import { acquireRobustGps } from '@/lib/gps';
import { PendingApprovalsPanel } from '@/frontend/modules/zmcc/approvals/PendingApprovalsPanel';

export type MotWorkspaceTab =
  | 'DISPATCH'
  | 'ACTIVE_JOURNEYS'
  | 'JOURNEY_HISTORY'
  | 'JOURNEY_MAP'
  | 'SMS_OUTBOX'
  | 'PROFILES'
  | 'VEHICLES'
  | 'APPROVALS';

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
    skip_reason?: string | null;
    shop?: {
      id: string;
      shop_code: string;
      shop_name: string;
      owner_name: string;
      contact_number: string;
    } | null;
    collection?: {
      gross_liters: number;
      at_13ts_liters?: number;
    } | null;
  }>;
  locations?: Array<{
    id: string;
    source_type: string;
    latitude: number;
    longitude: number;
    device_recorded_at: string;
  }>;
  summary?: {
    id: string;
    journey_id: string;
    journey_ended_at: string;
    assigned_shop_count: number;
    collected_shop_count: number;
    skipped_shop_count: number;
    pending_shop_count: number;
    total_gross_liters: number;
    total_at_13ts_liters: number;
    weighted_avg_lr: number | null;
    weighted_avg_fat: number | null;
    weighted_avg_snf: number | null;
    weighted_avg_ts: number | null;
    summary_version: string;
    source_calculation_versions: string[];
    revision: number;
    generated_at: string;
    last_recomputed_at: string | null;
  } | null;
}

interface MotOperationsWorkspaceProps {
  currentUser: User | null;
  initialTab?: MotWorkspaceTab;
  activeTab?: MotWorkspaceTab;
  onTabChange?: (tab: MotWorkspaceTab) => void;
  hideTabBar?: boolean;
}

const subscribeToNothing = () => () => {};

/** Tabs whose lists are loaded by fetchMotTabData. */
const MOT_DATA_TABS = new Set<MotWorkspaceTab>(['DISPATCH', 'ACTIVE_JOURNEYS', 'JOURNEY_HISTORY', 'PROFILES', 'VEHICLES']);

/** Fetches the lists a MOT operations tab shows; only the lists that tab needs are returned. */
async function fetchMotTabData(
  tab: MotWorkspaceTab,
  zmccId: string | null | undefined,
  historyStatusFilter: string
): Promise<{
  routes?: RouteOption[];
  profiles?: MotProfileItem[];
  vehicles?: MotVehicleItem[];
  journeys?: JourneyItem[];
}> {
  const zmccParam = zmccId ? `zmcc_id=${zmccId}` : '';
  const getJson = async (url: string) => (await fetch(url)).json();

  if (tab === 'DISPATCH') {
    // Load active routes, active profiles, active vehicles
    const [rData, pData, vData] = await Promise.all([
      getJson(`/api/zmcc/routes?${zmccParam}&is_active=true`),
      getJson(`/api/zmcc/mot/profiles?${zmccParam}&is_active=true`),
      getJson(`/api/zmcc/mot/vehicles?${zmccParam}&is_active=true`),
    ]);
    return { routes: rData.routes || [], profiles: pData.profiles || [], vehicles: vData.vehicles || [] };
  }
  if (tab === 'ACTIVE_JOURNEYS') {
    const data = await getJson(`/api/zmcc/mot/journeys?${zmccParam}&status=COLLECTING`);
    return { journeys: data.journeys || [] };
  }
  if (tab === 'JOURNEY_HISTORY') {
    const statusParam = historyStatusFilter !== 'all' ? `&status=${historyStatusFilter}` : '';
    const data = await getJson(`/api/zmcc/mot/journeys?${zmccParam}${statusParam}`);
    return { journeys: data.journeys || [] };
  }
  if (tab === 'PROFILES') {
    const data = await getJson(`/api/zmcc/mot/profiles?${zmccParam}`);
    return { profiles: data.profiles || [] };
  }
  if (tab === 'VEHICLES') {
    const data = await getJson(`/api/zmcc/mot/vehicles?${zmccParam}`);
    return { vehicles: data.vehicles || [] };
  }
  return {};
}

export const MotOperationsWorkspace: React.FC<MotOperationsWorkspaceProps> = ({
  currentUser,
  initialTab = 'DISPATCH',
  activeTab: controlledTab,
  onTabChange,
  hideTabBar = true,
}) => {
  const isSuperAdmin = currentUser?.role === 'SUPER_ADMIN';
  const isDataExecutive = currentUser?.role === 'DATA_EXECUTIVE';
  const isCentralRole = isSuperAdmin || isDataExecutive;
  const isZmccManager = currentUser?.role === 'ZMCC_MANAGER';
  const isPheOperator = currentUser?.role === 'PHE_OPERATOR';
  const canTransferVehicle = isCentralRole;

  // Permitted tabs
  const permittedTabs: { id: MotWorkspaceTab; label: string; icon: LucideIcon }[] = useMemo(() => {
    const tabs: { id: MotWorkspaceTab; label: string; icon: LucideIcon }[] = [
      { id: 'DISPATCH', label: 'Assign & Dispatch', icon: Send },
      { id: 'ACTIVE_JOURNEYS', label: 'Active Journeys', icon: Truck },
      { id: 'JOURNEY_HISTORY', label: 'Journey History', icon: Clock },
      { id: 'JOURNEY_MAP', label: 'Journey map', icon: MapPin },
      { id: 'SMS_OUTBOX', label: 'WhatsApp Receipts', icon: MessageSquare },
    ];
    if (!isPheOperator) {
      tabs.push(
        { id: 'PROFILES', label: 'Mobile Testers', icon: UserIcon },
        { id: 'VEHICLES', label: 'MOT Vehicles', icon: Navigation }
      );
    }
    tabs.push({ id: 'APPROVALS', label: 'Approvals', icon: ShieldCheck });
    return tabs;
  }, [isPheOperator]);

  const [internalTab, setInternalTab] = useState<MotWorkspaceTab>(
    controlledTab || initialTab
  );
  const activeTab = controlledTab || internalTab;

  const setActiveTab = (tab: MotWorkspaceTab) => {
    setInternalTab(tab);
    if (onTabChange) onTabChange(tab);
  };

  const [selectedMapJourneyId, setSelectedMapJourneyId] = useState<string | null>(null);

  // ZMCC Scope
  const [sources, setSources] = useState<ZmccSource[]>([]);
  const [selectedZmccId, setSelectedZmccId] = useState<string>('');

  // Data states
  const [profiles, setProfiles] = useState<MotProfileItem[]>([]);
  const [vehicles, setVehicles] = useState<MotVehicleItem[]>([]);
  const [routes, setRoutes] = useState<RouteOption[]>([]);
  const [journeys, setJourneys] = useState<JourneyItem[]>([]);
  const [refreshing, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // A parent-driven tab change clears the previous tab's messages.
  const [previousControlledTab, setPreviousControlledTab] = useState(controlledTab);
  if (controlledTab !== previousControlledTab) {
    setPreviousControlledTab(controlledTab);
    if (controlledTab) {
      setInternalTab(controlledTab);
      setError(null);
      setSuccessMessage(null);
    }
  }

  // Search & Filter
  const [historyStatusFilter, setHistoryStatusFilter] = useState('all');

  // Dispatch Form State
  const [dispatchRouteId, setDispatchRouteId] = useState('');
  const [dispatchProfileId, setDispatchProfileId] = useState('');
  const [dispatchVehicleId, setDispatchVehicleId] = useState('');
  const [dispatchVehicleInputMode, setDispatchVehicleInputMode] = useState<'SELECT' | 'MANUAL'>('SELECT');
  const [manualVehicleNumber, setManualVehicleNumber] = useState('');
  const [gpsLocation, setGpsLocation] = useState<{
    latitude: number;
    longitude: number;
    accuracy: number | null;
    source?: string;
  } | null>(null);
  const [gpsStatus, setGpsStatus] = useState<'IDLE' | 'ACQUIRING' | 'SUCCESS' | 'FALLBACK' | 'ERROR'>('IDLE');
  const [gpsErrorMsg, setGpsErrorMsg] = useState('');

  // Modals
  const [selectedJourneyDetail, setSelectedJourneyDetail] = useState<JourneyItem | null>(null);
  const [stopsPage, setStopsPage] = useState(1);
  const stopsPerPage = 6;
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
  const [transferModalVehicle, setTransferModalVehicle] = useState<MotVehicleItem | null>(null);
  const [transferTargetZmccId, setTransferTargetZmccId] = useState('');

  // Route Request State
  const [routeRequestModalOpen, setRouteRequestModalOpen] = useState(false);
  const [routeRequestForm, setRouteRequestForm] = useState({
    name: '',
    origin: '',
    destination: '',
    initial_area_name: '',
    description: '',
  });

  // Effective ZMCC
  const effectiveZmccId = useMemo(() => {
    if (isCentralRole) return selectedZmccId || null;
    return currentUser?.procurement_source_id ? String(currentUser.procurement_source_id) : null;
  }, [isCentralRole, selectedZmccId, currentUser]);

  // Fetch ZMCC Sources for Super Admin & Data Executive
  useEffect(() => {
    if (isCentralRole) {
      fetch('/api/zmcc/sources')
        .then((res) => res.json())
        .then((data) => {
          const list = ((data.zmccs || []) as ZmccSource[]).filter((s) => s.is_active);
          setSources(list);
          if (list.length > 0) {
            setSelectedZmccId((current) => current || list[0].id);
          }
        })
        .catch(() => {});
    }
  }, [isCentralRole]);

  // Acquire GPS on Dispatch tab with progressive offline fallback
  const geolocationSupported = useSyncExternalStore(
    subscribeToNothing,
    () => 'geolocation' in navigator,
    () => true
  );

  const requestGpsPosition = useCallback(
    async (allowFallback = false) => {
      setGpsStatus('ACQUIRING');
      setGpsErrorMsg('');

      const selectedSource = sources.find((s) => s.id === effectiveZmccId);
      const facilityCode = selectedSource?.code || (currentUser?.procurement_source?.code as string | undefined);

      const res = await acquireRobustGps({
        facilityCode,
        allowFacilityFallback: allowFallback || (typeof window !== 'undefined' && window.isSecureContext === false),
      });

      if (res.location) {
        setGpsLocation({
          latitude: res.location.latitude,
          longitude: res.location.longitude,
          accuracy: res.location.accuracy,
          source: res.location.source,
        });
        setGpsStatus(res.status === 'FALLBACK' ? 'FALLBACK' : 'SUCCESS');
        if (res.errorMsg) {
          setGpsErrorMsg(res.errorMsg);
        }
      } else {
        setGpsStatus('ERROR');
        setGpsErrorMsg(res.errorMsg || 'Failed to obtain GPS coordinates.');
      }
    },
    [sources, effectiveZmccId, currentUser]
  );

  const acquireGps = () => {
    requestGpsPosition(false);
  };

  // Opening the Dispatch tab starts acquisition automatically, so it counts as acquiring.
  const autoAcquiringGps = activeTab === 'DISPATCH' && gpsStatus === 'IDLE';
  const displayedGpsStatus = autoAcquiringGps ? 'ACQUIRING' : gpsStatus;
  const displayedGpsErrorMsg = gpsErrorMsg;

  useEffect(() => {
    if (autoAcquiringGps) {
      requestGpsPosition(true);
    }
  }, [autoAcquiringGps, requestGpsPosition]);

  // Load Data based on activeTab and effectiveZmccId
  const canLoadData = Boolean(effectiveZmccId) || isCentralRole;
  const dataRequestKey = `${activeTab}|${effectiveZmccId ?? ''}|${historyStatusFilter}`;
  // Request whose response last settled; any other key means a fetch is in flight.
  const [loadedDataKey, setLoadedDataKey] = useState<string | null>(null);
  const loading = refreshing || (canLoadData && MOT_DATA_TABS.has(activeTab) && loadedDataKey !== dataRequestKey);

  const loadData = useCallback(() => {
    if (!effectiveZmccId && !isCentralRole) return Promise.resolve();
    const requestKey = `${activeTab}|${effectiveZmccId ?? ''}|${historyStatusFilter}`;
    return fetchMotTabData(activeTab, effectiveZmccId, historyStatusFilter)
      .then(
        (result) => {
          if (result.routes) setRoutes(result.routes);
          if (result.profiles) setProfiles(result.profiles);
          if (result.vehicles) setVehicles(result.vehicles);
          if (result.journeys) setJourneys(result.journeys);
        },
        (err) => setError(getErrorMessage(err) || 'Failed to load MOT data.')
      )
      .finally(() => {
        setLoading(false);
        setLoadedDataKey(requestKey);
      });
  }, [activeTab, effectiveZmccId, isCentralRole, historyStatusFilter]);

  const refreshData = () => {
    setLoading(true);
    setError(null);
    return loadData();
  };

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Handle Assign & Dispatch
  const handleAssignAndDispatch = async (e: React.FormEvent) => {
    e.preventDefault();
    const selectedVehicleValue = dispatchVehicleInputMode === 'MANUAL'
      ? manualVehicleNumber.trim().toUpperCase()
      : dispatchVehicleId;

    if (!dispatchRouteId || !dispatchProfileId || !selectedVehicleValue) {
      setError('Please select Route, Mobile Tester, and Vehicle.');
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
        mot_vehicle_id: selectedVehicleValue,
        vehicle_number: dispatchVehicleInputMode === 'MANUAL' ? selectedVehicleValue : undefined,
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
      setManualVehicleNumber('');
      setDispatchVehicleInputMode('SELECT');
      setActiveTab('ACTIVE_JOURNEYS');
    } catch (err) {
      setError(getErrorMessage(err));
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
    } catch (err) {
      setError(getErrorMessage(err));
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
          zmcc_id: isCentralRole ? profileForm.zmcc_id || effectiveZmccId : effectiveZmccId,
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
    } catch (err) {
      setError(getErrorMessage(err));
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
    } catch (err) {
      setError(getErrorMessage(err));
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
          zmcc_id: isCentralRole ? vehicleForm.zmcc_id || effectiveZmccId : effectiveZmccId,
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
    } catch (err) {
      setError(getErrorMessage(err));
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
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setActionLoading(false);
    }
  };

  const handleOpenTransferModal = (v: MotVehicleItem) => {
    setTransferModalVehicle(v);
    setTransferTargetZmccId('');
  };

  const handleExecuteTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!transferModalVehicle || !transferTargetZmccId) return;

    setActionLoading(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const res = await fetch(`/api/zmcc/mot/vehicles/${transferModalVehicle.id}/transfer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_zmcc_id: transferTargetZmccId }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to transfer vehicle.');
      }

      setSuccessMessage(
        `Vehicle ${transferModalVehicle.vehicle_number} transferred successfully to ${data.vehicle?.zmcc?.name || 'target ZMCC'}.`
      );
      setTransferModalVehicle(null);
      loadData();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setActionLoading(false);
    }
  };

  const handleRequestRoute = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!routeRequestForm.name.trim()) {
      setError('Route name is required.');
      return;
    }
    setActionLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/zmcc/routes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          zmcc_id: isCentralRole ? selectedZmccId || effectiveZmccId : effectiveZmccId,
          name: routeRequestForm.name.trim(),
          origin: routeRequestForm.origin.trim() || undefined,
          destination: routeRequestForm.destination.trim() || undefined,
          initial_area_name: routeRequestForm.initial_area_name.trim() || undefined,
          description: routeRequestForm.description.trim() || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to request route.');
      }

      setSuccessMessage(
        isPheOperator
          ? 'Route requested successfully and submitted for manager approval.'
          : 'Route created successfully.'
      );
      setRouteRequestModalOpen(false);
      setRouteRequestForm({
        name: '',
        origin: '',
        destination: '',
        initial_area_name: '',
        description: '',
      });
      loadData();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-4 bg-white rounded-xl border border-border shadow-2xs">
        <div className="flex items-center space-x-3">
          <div className="p-2.5 bg-primary text-white rounded-xl shadow-2xs">
            <Truck className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-base sm:text-lg font-semibold text-foreground tracking-tight">
              MOT operations
            </h1>
          </div>
        </div>

        {isCentralRole && sources.length > 0 && (
          <div className="flex items-center space-x-2">
            <label htmlFor="zmcc-select" className="text-xs font-semibold text-slate-700 whitespace-nowrap">
              ZMCC Center:
            </label>
            <select
              id="zmcc-select"
              value={selectedZmccId}
              onChange={(e) => setSelectedZmccId(e.target.value)}
              className="text-xs font-semibold border border-border rounded-xl px-3 py-2 bg-subtle text-foreground focus:ring-2 focus:ring-primary focus:outline-hidden"
            >
              {sources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} · {s.code}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {error && (
        <div className="flex items-center justify-between p-3.5 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-xs font-semibold animate-panel-in">
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
        <div className="flex items-center justify-between p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800 text-xs font-semibold">
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

      {!hideTabBar && (
        <SegmentedTabs
          label="MOT operations views"
          value={activeTab}
          onValueChange={(tab) => {
            setActiveTab(tab);
            setError(null);
            setSuccessMessage(null);
          }}
          tabs={permittedTabs.map((tab) => ({ value: tab.id, label: tab.label, icon: tab.icon }))}
        />
      )}

      {activeTab === 'DISPATCH' && (
        <div className="max-w-4xl mx-auto bg-card p-5 rounded-xl border border-border shadow-2xs space-y-4 animate-panel-in">
          <div className="flex items-center justify-between border-b border-border pb-3">
            <div>
              <h2 className="text-sm font-semibold text-foreground">Physical Assign & Departure</h2>
            </div>
            <span className="px-2.5 py-1 rounded-full bg-blue-50 text-primary text-[10px] font-semibold uppercase tracking-wider border border-blue-200">
              Immediate Departure
            </span>
          </div>

          <form onSubmit={handleAssignAndDispatch} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
              <div className="space-y-1.5 min-w-0">
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-semibold text-foreground truncate">
                    Assigned Route <span className="text-rose-600">*</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => setRouteRequestModalOpen(true)}
                    className="inline-flex items-center text-[11px] font-semibold text-primary hover:underline shrink-0 ml-1"
                  >
                    <Plus className="w-3 h-3 mr-0.5" />
                    Request New Route
                  </button>
                </div>
                <select
                  value={dispatchRouteId}
                  onChange={(e) => setDispatchRouteId(e.target.value)}
                  className="w-full h-10 text-xs font-semibold border border-border rounded-lg px-2.5 bg-subtle text-foreground focus:ring-2 focus:ring-primary min-w-0"
                  required
                >
                  <option value="">Select collection route</option>
                  {routes.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.route_code} · {r.name}
                    </option>
                  ))}
                </select>
                {routes.length === 0 && (
                  <p className="text-[11px] text-amber-700 font-semibold mt-1">
                    No active routes found for this ZMCC.
                  </p>
                )}
              </div>

              <div className="space-y-1.5 min-w-0">
                <label className="block text-xs font-semibold text-foreground mb-1 truncate">
                  Mobile Tester <span className="text-rose-600">*</span>
                </label>
                <select
                  value={dispatchProfileId}
                  onChange={(e) => setDispatchProfileId(e.target.value)}
                  className="w-full h-10 text-xs font-semibold border border-border rounded-lg px-2.5 bg-subtle text-foreground focus:ring-2 focus:ring-primary min-w-0"
                  required
                >
                  <option value="">Select mobile tester</option>
                  {profiles.map((p) => (
                    <option
                      key={p.id}
                      value={p.id}
                      disabled={p.has_active_journey}
                    >
                      {p.name} · {p.mot_code}
                      {p.has_active_journey ? ' · On journey' : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5 min-w-0">
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-semibold text-foreground truncate">
                    Collection Vehicle <span className="text-rose-600">*</span>
                  </label>
                  <div className="flex items-center space-x-1 shrink-0 ml-1">
                    <button
                      type="button"
                      onClick={() => setDispatchVehicleInputMode('SELECT')}
                      className={`px-1.5 py-0.5 rounded text-[10px] font-semibold transition-colors ${
                        dispatchVehicleInputMode === 'SELECT'
                          ? 'bg-primary text-white shadow-2xs'
                          : 'bg-muted text-muted-foreground hover:bg-slate-200'
                      }`}
                    >
                      Select
                    </button>
                    <button
                      type="button"
                      onClick={() => setDispatchVehicleInputMode('MANUAL')}
                      className={`px-1.5 py-0.5 rounded text-[10px] font-semibold transition-colors ${
                        dispatchVehicleInputMode === 'MANUAL'
                          ? 'bg-primary text-white shadow-2xs'
                          : 'bg-muted text-muted-foreground hover:bg-slate-200'
                      }`}
                    >
                      Type #
                    </button>
                  </div>
                </div>

                {dispatchVehicleInputMode === 'SELECT' ? (
                  <select
                    value={dispatchVehicleId}
                    onChange={(e) => {
                      if (e.target.value === '__TYPE_NEW__') {
                        setDispatchVehicleInputMode('MANUAL');
                        setDispatchVehicleId('');
                      } else {
                        setDispatchVehicleId(e.target.value);
                      }
                    }}
                    className="w-full h-10 text-xs font-semibold border border-border rounded-lg px-2.5 bg-subtle text-foreground focus:ring-2 focus:ring-primary min-w-0"
                    required={dispatchVehicleInputMode === 'SELECT'}
                  >
                    <option value="">Select vehicle</option>
                    {vehicles.map((v) => (
                      <option
                        key={v.id}
                        value={v.id}
                        disabled={v.has_active_journey}
                      >
                        {v.vehicle_number}
                        {v.has_active_journey ? ' · On journey' : ''}
                      </option>
                    ))}
                    <option value="__TYPE_NEW__">Enter number manually</option>
                  </select>
                ) : (
                  <input
                    type="text"
                    value={manualVehicleNumber}
                    onChange={(e) => setManualVehicleNumber(e.target.value.toUpperCase())}
                    placeholder="e.g. LES-1234 or LHR-5678"
                    className="w-full h-10 text-xs font-semibold border border-border rounded-lg px-2.5 bg-subtle text-foreground focus:ring-2 focus:ring-primary uppercase tracking-wider min-w-0"
                    required={dispatchVehicleInputMode === 'MANUAL'}
                    autoFocus
                  />
                )}
              </div>
            </div>

            <div className="p-3 rounded-lg border border-border bg-slate-50 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <MapPin className="w-3.5 h-3.5 text-primary" />
                  <span className="text-xs font-semibold text-foreground">
                    Assigning User GPS Coordinates
                  </span>
                </div>
                <button
                  type="button"
                  onClick={acquireGps}
                  disabled={displayedGpsStatus === 'ACQUIRING'}
                  className="flex items-center space-x-1 px-2.5 py-1 rounded-md bg-white border border-border text-[11px] font-semibold text-slate-700 hover:bg-muted"
                >
                  <span>{displayedGpsStatus === 'ACQUIRING' ? 'Acquiring…' : 'Refresh GPS'}</span>
                </button>
              </div>

              {displayedGpsStatus === 'SUCCESS' && gpsLocation && (
                <div className="flex items-center space-x-2 text-xs tabular-nums text-emerald-800 bg-emerald-50/80 p-2 rounded-md border border-emerald-200">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  <div className="min-w-0 flex-1 truncate">
                    <span className="font-medium">
                      Lat: {gpsLocation.latitude.toFixed(6)}, Lng: {gpsLocation.longitude.toFixed(6)}
                    </span>
                    {gpsLocation.accuracy != null && (
                      <span className="text-[11px] text-emerald-700 ml-1.5">
                        (±{Math.round(gpsLocation.accuracy)}m live)
                      </span>
                    )}
                  </div>
                </div>
              )}

              {displayedGpsStatus === 'FALLBACK' && gpsLocation && (
                <div className="space-y-1 p-2 rounded-md bg-amber-50 border border-amber-200 text-xs text-amber-900">
                  <div className="flex items-center space-x-2 tabular-nums">
                    <CheckCircle2 className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                    <span className="font-medium truncate">
                      Lat: {gpsLocation.latitude.toFixed(6)}, Lng: {gpsLocation.longitude.toFixed(6)}
                    </span>
                    <span className="text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded bg-amber-200/80 text-amber-800">
                      {gpsLocation.source === 'FACILITY_DEFAULT' ? 'Center Coords' : 'Offline Cache'}
                    </span>
                  </div>
                  {displayedGpsErrorMsg && (
                    <p className="text-[11px] text-amber-700 leading-tight truncate">{displayedGpsErrorMsg}</p>
                  )}
                </div>
              )}

              {displayedGpsStatus === 'ERROR' && (
                <div className="space-y-1.5 text-xs text-rose-800 bg-rose-50 p-2.5 rounded-md border border-rose-200">
                  <p className="leading-snug">{displayedGpsErrorMsg || 'Failed to obtain GPS coordinates.'}</p>
                  <div>
                    <button
                      type="button"
                      onClick={() => requestGpsPosition(true)}
                      className="inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-md bg-white border border-rose-300 text-rose-900 text-[11px] font-semibold hover:bg-rose-100 shadow-2xs transition"
                    >
                      <MapPin className="w-3 h-3 text-rose-600" />
                      <span>Use Center / Offline Coordinates</span>
                    </button>
                  </div>
                </div>
              )}

              {displayedGpsStatus === 'IDLE' && (
                <p className="text-xs text-slate-500">Acquiring current GPS location from browser…</p>
              )}
            </div>

            <button
              type="submit"
              disabled={actionLoading || !gpsLocation || !dispatchRouteId || !dispatchProfileId || !dispatchVehicleId}
              className="w-full h-11 flex items-center justify-center space-x-2 px-4 rounded-lg bg-primary text-white text-xs font-semibold hover:bg-primary/90 transition shadow-xs disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Send className="w-3.5 h-3.5" />
              <span>{actionLoading ? 'Assigning & Dispatching…' : 'Assign & Dispatch (Begin Journey)'}</span>
            </button>
          </form>
        </div>
      )}

      {activeTab === 'ACTIVE_JOURNEYS' && (
        <div className="bg-white rounded-xl border border-border shadow-2xs overflow-hidden animate-panel-in">
          <div className="p-4 border-b border-border flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-foreground">Active Collection Journeys</h2>
            </div>
            <button
              type="button"
              onClick={refreshData}
              className="flex items-center space-x-1 px-3 py-1.5 rounded-xl border border-border text-xs font-semibold text-slate-700 hover:bg-muted"
            >
              <span>Refresh</span>
            </button>
          </div>

          {loading ? (
            <div className="p-8 text-center text-xs font-semibold text-slate-500">Loading active journeys…</div>
          ) : journeys.length === 0 ? (
            <div className="p-8 text-center text-xs font-semibold text-slate-500">
              No active journeys currently in progress.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-muted/60 text-slate-700 uppercase font-semibold tracking-wider text-[10px] border-b border-border">
                  <tr>
                    <th className="p-3">Journey #</th>
                    <th className="p-3">Route</th>
                    <th className="p-3">Mobile Tester</th>
                    <th className="p-3">Vehicle</th>
                    <th className="p-3">Stops</th>
                    <th className="p-3">Dispatched At</th>
                    <th className="p-3">Dispatched By</th>
                    <th className="p-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {journeys.map((j) => (
                    <tr key={j.id} className="hover:bg-subtle">
                      <td className="p-3 tabular-nums font-semibold text-primary">
                        {j.journey_number}
                      </td>
                      <td className="p-3 font-semibold text-foreground">
                        {j.route?.route_code} · {j.route?.name}
                      </td>
                      <td className="p-3 font-semibold text-foreground">
                        {j.mot_profile?.name} ({j.mot_profile?.mot_code})
                      </td>
                      <td className="p-3 tabular-nums font-semibold text-slate-700">
                        {j.mot_vehicle?.vehicle_number}
                      </td>
                      <td className="p-3 font-semibold text-slate-700">
                        {j.total_stops != null ? `${j.total_stops} shops` : '—'}
                      </td>
                      <td className="p-3 font-medium text-slate-600">
                        {new Date(j.assigned_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td className="p-3 font-medium text-slate-600">{j.assigned_by_name}</td>
                      <td className="p-3 text-right space-x-2">
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedMapJourneyId(j.id);
                            setActiveTab('JOURNEY_MAP');
                          }}
                          className="px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-800 font-semibold hover:bg-emerald-100"
                        >
                          View Map
                        </button>
                        <button
                          type="button"
                          onClick={() => handleInspectJourney(j.id)}
                          className="px-2.5 py-1 rounded-lg bg-blue-50 text-primary font-semibold hover:bg-blue-100"
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
                            className="px-2.5 py-1 rounded-lg bg-rose-50 text-rose-700 font-semibold hover:bg-rose-100"
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

      {activeTab === 'JOURNEY_HISTORY' && (
        <div className="bg-white rounded-xl border border-border shadow-2xs overflow-hidden space-y-3 animate-panel-in">
          <div className="p-4 border-b border-border flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-foreground">Journey Historical Ledger</h2>
            </div>
            <div className="flex items-center space-x-2">
              <select
                value={historyStatusFilter}
                onChange={(e) => setHistoryStatusFilter(e.target.value)}
                className="text-xs font-semibold border border-border rounded-xl px-3 py-1.5 bg-subtle text-foreground"
              >
                <option value="all">All statuses</option>
                <option value="COLLECTING">Collecting</option>
                <option value="COMPLETED">Completed</option>
                <option value="CANCELLED">Cancelled</option>
              </select>
              <button
                type="button"
                onClick={refreshData}
                className="flex items-center space-x-1 px-3 py-1.5 rounded-xl border border-border text-xs font-semibold text-slate-700 hover:bg-muted"
              >
                <span>Refresh</span>
              </button>
            </div>
          </div>

          {loading ? (
            <div className="p-8 text-center text-xs font-semibold text-slate-500">Loading journey history…</div>
          ) : journeys.length === 0 ? (
            <div className="p-8 text-center text-xs font-semibold text-slate-500">No journeys recorded.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-muted/60 text-slate-700 uppercase font-semibold tracking-wider text-[10px] border-b border-border">
                  <tr>
                    <th className="p-3">Journey #</th>
                    <th className="p-3">Date</th>
                    <th className="p-3">Route</th>
                    <th className="p-3">Mobile Tester</th>
                    <th className="p-3">Vehicle</th>
                    <th className="p-3">Status</th>
                    <th className="p-3">Dispatched At</th>
                    <th className="p-3">Outcome</th>
                    <th className="p-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {journeys.map((j) => (
                    <tr key={j.id} className="hover:bg-subtle">
                      <td className="p-3 tabular-nums font-semibold text-primary">{j.journey_number}</td>
                      <td className="p-3 font-medium text-slate-600">{j.operational_date}</td>
                      <td className="p-3 font-semibold text-foreground">{j.route?.route_code}</td>
                      <td className="p-3 font-semibold text-foreground">{j.mot_profile?.name}</td>
                      <td className="p-3 tabular-nums font-semibold text-slate-700">{j.mot_vehicle?.vehicle_number}</td>
                      <td className="p-3">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase ${
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
                            Cancelled by {j.cancelled_by_name}: {j.cancellation_reason?.slice(0, 30)}…
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="p-3 text-right space-x-2">
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedMapJourneyId(j.id);
                            setActiveTab('JOURNEY_MAP');
                          }}
                          className="px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-800 font-semibold hover:bg-emerald-100"
                        >
                          View Map
                        </button>
                        <button
                          type="button"
                          onClick={() => handleInspectJourney(j.id)}
                          className="px-2.5 py-1 rounded-lg bg-blue-50 text-primary font-semibold hover:bg-blue-100"
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

      {activeTab === 'JOURNEY_MAP' && (
        <div className="space-y-4 animate-panel-in">
          <div className="p-3 bg-white rounded-xl border border-border flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-center space-x-2">
              <label className="text-xs font-semibold text-slate-700 whitespace-nowrap">
                Select Journey:
              </label>
              <select
                value={selectedMapJourneyId || ''}
                onChange={(e) => setSelectedMapJourneyId(e.target.value)}
                className="text-xs font-semibold border border-border rounded-xl px-3 py-1.5 bg-subtle text-foreground"
              >
                <option value="">Choose journey</option>
                {journeys.map((j) => (
                  <option key={j.id} value={j.id}>
                    #{j.journey_number} · {j.route?.route_code} · {j.mot_profile?.name}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              onClick={refreshData}
              className="flex items-center space-x-1 px-3 py-1.5 rounded-xl border border-border text-xs font-semibold text-slate-700 hover:bg-muted"
            >
              <span>Refresh Journeys</span>
            </button>
          </div>

          <ManagerJourneyMap
            currentUser={currentUser}
            journeyId={selectedMapJourneyId || (journeys[0]?.id ?? null)}
            onClose={() => setActiveTab('ACTIVE_JOURNEYS')}
          />
        </div>
      )}

      {activeTab === 'SMS_OUTBOX' && (
        <SmsOutboxView currentUser={currentUser} />
      )}

      {activeTab === 'PROFILES' && !isPheOperator && (
        <div className="bg-white rounded-xl border border-border shadow-2xs overflow-hidden space-y-3 animate-panel-in">
          <div className="p-4 border-b border-border flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-foreground">Mobile Testers & Profiles</h2>
            </div>
            <button
              type="button"
              onClick={() => handleOpenProfileModal()}
              className="flex items-center space-x-1.5 px-3.5 py-2 rounded-xl bg-primary text-white text-xs font-semibold hover:bg-primary/90 transition"
            >
              <Plus className="w-4 h-4" />
              <span>Add Mobile Tester</span>
            </button>
          </div>

          {loading ? (
            <div className="p-8 text-center text-xs font-semibold text-slate-500">Loading profiles…</div>
          ) : profiles.length === 0 ? (
            <div className="p-8 text-center text-xs font-semibold text-slate-500">
              No Mobile Tester profiles registered for this ZMCC.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-muted/60 text-slate-700 uppercase font-semibold tracking-wider text-[10px] border-b border-border">
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
                <tbody className="divide-y divide-border">
                  {profiles.map((p) => (
                    <tr key={p.id} className="hover:bg-subtle">
                      <td className="p-3 tabular-nums font-semibold text-primary">{p.mot_code}</td>
                      <td className="p-3 font-semibold text-foreground">{p.name}</td>
                      <td className="p-3 font-medium text-slate-700">{p.phone_number}</td>
                      <td className="p-3 tabular-nums text-slate-600">{p.cnic}</td>
                      <td className="p-3 text-slate-600 font-medium">
                        {p.user ? `@${p.user.username}` : <span className="text-slate-400">Unlinked</span>}
                      </td>
                      <td className="p-3">
                        {p.has_active_journey ? (
                          <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[10px] font-semibold">
                            #{p.active_journey?.journey_number}
                          </span>
                        ) : (
                          <span className="text-slate-400 text-[11px]">None (Available)</span>
                        )}
                      </td>
                      <td className="p-3">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase ${
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
                          className="px-2.5 py-1 rounded-lg bg-muted text-slate-800 font-semibold hover:bg-border"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => handleToggleProfileActive(p)}
                          disabled={p.has_active_journey && p.is_active}
                          className={`px-2.5 py-1 rounded-lg font-semibold ${
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

      {activeTab === 'VEHICLES' && !isPheOperator && (
        <div className="bg-white rounded-xl border border-border shadow-2xs overflow-hidden space-y-3 animate-panel-in">
          <div className="p-4 border-b border-border flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-foreground">MOT Vehicles Fleet</h2>
            </div>
            <button
              type="button"
              onClick={() => handleOpenVehicleModal()}
              className="flex items-center space-x-1.5 px-3.5 py-2 rounded-xl bg-primary text-white text-xs font-semibold hover:bg-primary/90 transition"
            >
              <Plus className="w-4 h-4" />
              <span>Add Vehicle</span>
            </button>
          </div>

          {loading ? (
            <div className="p-8 text-center text-xs font-semibold text-slate-500">Loading vehicles…</div>
          ) : vehicles.length === 0 ? (
            <div className="p-8 text-center text-xs font-semibold text-slate-500">
              No MOT vehicles registered for this ZMCC.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-muted/60 text-slate-700 uppercase font-semibold tracking-wider text-[10px] border-b border-border">
                  <tr>
                    <th className="p-3">Vehicle Number</th>
                    <th className="p-3">ZMCC Center</th>
                    <th className="p-3">Active Journey</th>
                    <th className="p-3">Status</th>
                    <th className="p-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {vehicles.map((v) => (
                    <tr key={v.id} className="hover:bg-subtle">
                      <td className="p-3 tabular-nums font-semibold text-primary">{v.vehicle_number}</td>
                      <td className="p-3 font-medium text-slate-700">{v.zmcc?.name}</td>
                      <td className="p-3">
                        {v.has_active_journey ? (
                          <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[10px] font-semibold">
                            #{v.active_journey?.journey_number}
                          </span>
                        ) : (
                          <span className="text-slate-400 text-[11px]">None (Available)</span>
                        )}
                      </td>
                      <td className="p-3">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase ${
                            v.is_active ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-700'
                          }`}
                        >
                          {v.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="p-3 text-right space-x-2">
                        {canTransferVehicle && (
                          <button
                            type="button"
                            onClick={() => handleOpenTransferModal(v)}
                            disabled={v.has_active_journey}
                            title={v.has_active_journey ? 'Cannot transfer: active journey in progress' : 'Transfer vehicle across ZMCCs'}
                            className="px-2.5 py-1 rounded-lg bg-blue-50 text-blue-700 font-semibold hover:bg-blue-100 disabled:opacity-50"
                          >
                            Transfer
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => handleOpenVehicleModal(v)}
                          className="px-2.5 py-1 rounded-lg bg-muted text-slate-800 font-semibold hover:bg-border"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => handleToggleVehicleActive(v)}
                          disabled={v.has_active_journey && v.is_active}
                          className={`px-2.5 py-1 rounded-lg font-semibold ${
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

      {activeTab === 'APPROVALS' && (
        <div id="tabpanel-APPROVALS" role="tabpanel" aria-labelledby="tab-APPROVALS" className="space-y-6 animate-panel-in">
          <PendingApprovalsPanel
            currentUser={currentUser}
            showRoutes={isSuperAdmin || isZmccManager}
            showShops={true}
            onRefreshParent={loadData}
          />
        </div>
      )}

      <AnimatePresence>{selectedJourneyDetail && (
        <Modal key="modal-0" onClose={() => setSelectedJourneyDetail(null)} title="Journey details" closeOnOutsideClick className="max-w-2xl p-6 space-y-4 max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div>
                <h3 className="text-base font-semibold text-foreground">
                  Journey #{selectedJourneyDetail.journey_number}: Planned Stops
                </h3>
                <p className="text-xs text-slate-500 font-medium">
                  {selectedJourneyDetail.route?.route_code} | Mobile Tester: {selectedJourneyDetail.mot_profile?.name} | Vehicle: {selectedJourneyDetail.mot_vehicle?.vehicle_number}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedJourneyDetail(null)}
                className="p-1 rounded-lg border border-border text-slate-500 hover:bg-muted"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {(() => {
              const stops = selectedJourneyDetail.stops || [];
              const assignedCount = selectedJourneyDetail.summary
                ? selectedJourneyDetail.summary.assigned_shop_count
                : stops.length;
              const collectedCount = selectedJourneyDetail.summary
                ? selectedJourneyDetail.summary.collected_shop_count
                : stops.filter((s) => s.status === 'VISITED').length;
              const skippedCount = selectedJourneyDetail.summary
                ? selectedJourneyDetail.summary.skipped_shop_count
                : stops.filter((s) => s.status === 'SKIPPED').length;
              const pendingCount = selectedJourneyDetail.summary
                ? selectedJourneyDetail.summary.pending_shop_count
                : Math.max(0, assignedCount - collectedCount - skippedCount);

              return (
                <div className="p-4 rounded-xl bg-slate-50 border border-border space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wider text-slate-700">
                      Journey Summary
                    </span>
                    {selectedJourneyDetail.summary && (
                      <span className="text-[11px] font-semibold text-slate-500">
                        Ended: {new Date(selectedJourneyDetail.summary.journey_ended_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} PKT
                      </span>
                    )}
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
                    <div className="p-2 bg-white rounded-lg border border-border">
                      <div className="text-[10px] uppercase font-semibold text-slate-500">Assigned</div>
                      <div className="text-sm font-semibold text-slate-900">{assignedCount}</div>
                    </div>
                    <div className="p-2 bg-white rounded-lg border border-border">
                      <div className="text-[10px] uppercase font-semibold text-emerald-700">Collected</div>
                      <div className="text-sm font-semibold text-emerald-800">{collectedCount}</div>
                    </div>
                    <div className="p-2 bg-white rounded-lg border border-border">
                      <div className="text-[10px] uppercase font-semibold text-amber-700">Skipped</div>
                      <div className="text-sm font-semibold text-amber-800">{skippedCount}</div>
                    </div>
                    <div className="p-2 bg-white rounded-lg border border-border">
                      <div className="text-[10px] uppercase font-semibold text-blue-700">Pending</div>
                      <div className="text-sm font-semibold text-blue-800">{pendingCount}</div>
                    </div>
                  </div>

                  {selectedJourneyDetail.summary && (
                    <div className="grid grid-cols-2 sm:grid-cols-6 gap-2 text-center">
                      <div className="p-2 bg-white rounded-lg border border-border">
                        <div className="text-[10px] uppercase font-semibold text-slate-500">Gross Liters</div>
                        <div className="text-xs tabular-nums font-semibold text-slate-900">
                          {selectedJourneyDetail.summary.total_gross_liters.toFixed(2)} L
                        </div>
                      </div>
                      <div className="p-2 bg-white rounded-lg border border-border">
                        <div className="text-[10px] uppercase font-semibold text-slate-500">@13TS Liters</div>
                        <div className="text-xs tabular-nums font-semibold text-slate-900">
                          {selectedJourneyDetail.summary.total_at_13ts_liters.toFixed(2)} L
                        </div>
                      </div>
                      <div className="p-2 bg-white rounded-lg border border-border">
                        <div className="text-[10px] uppercase font-semibold text-slate-500">Weighted LR</div>
                        <div className="text-xs tabular-nums font-semibold text-slate-800">
                          {selectedJourneyDetail.summary.weighted_avg_lr != null ? selectedJourneyDetail.summary.weighted_avg_lr.toFixed(2) : '—'}
                        </div>
                      </div>
                      <div className="p-2 bg-white rounded-lg border border-border">
                        <div className="text-[10px] uppercase font-semibold text-slate-500">Weighted Fat</div>
                        <div className="text-xs tabular-nums font-semibold text-slate-800">
                          {selectedJourneyDetail.summary.weighted_avg_fat != null ? `${selectedJourneyDetail.summary.weighted_avg_fat.toFixed(2)}%` : '—'}
                        </div>
                      </div>
                      <div className="p-2 bg-white rounded-lg border border-border">
                        <div className="text-[10px] uppercase font-semibold text-slate-500">Weighted SNF</div>
                        <div className="text-xs tabular-nums font-semibold text-slate-800">
                          {selectedJourneyDetail.summary.weighted_avg_snf != null ? `${selectedJourneyDetail.summary.weighted_avg_snf.toFixed(2)}%` : '—'}
                        </div>
                      </div>
                      <div className="p-2 bg-white rounded-lg border border-border">
                        <div className="text-[10px] uppercase font-semibold text-slate-500">Weighted TS</div>
                        <div className="text-xs tabular-nums font-semibold text-slate-800">
                          {selectedJourneyDetail.summary.weighted_avg_ts != null ? `${selectedJourneyDetail.summary.weighted_avg_ts.toFixed(2)}%` : '—'}
                        </div>
                      </div>
                    </div>
                  )}

                  {selectedJourneyDetail.summary && selectedJourneyDetail.summary.pending_shop_count > 0 && (
                    <div className="flex items-center space-x-2 text-[11px] font-semibold text-blue-800 bg-blue-50 p-2.5 rounded-lg border border-blue-200">
                      <Clock className="w-4 h-4 shrink-0 text-blue-600" />
                      <span>
                        Waiting for delayed collection sync: {selectedJourneyDetail.summary.pending_shop_count} assigned shop record(s) are still unresolved.
                      </span>
                    </div>
                  )}
                </div>
              );
            })()}

            {(() => {
              const allStops = selectedJourneyDetail.stops || [];
              const totalStopsPages = Math.ceil(allStops.length / stopsPerPage) || 1;
              const pagedStops = allStops.slice((stopsPage - 1) * stopsPerPage, stopsPage * stopsPerPage);

              return (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-semibold text-foreground">
                      Planned Route Stops ({allStops.length} shops)
                    </h4>
                    {totalStopsPages > 1 && (
                      <span className="text-[11px] text-slate-500 font-medium">
                        Page {stopsPage} of {totalStopsPages}
                      </span>
                    )}
                  </div>
                  <div className="space-y-2">
                    {pagedStops.map((stop) => (
                      <div
                        key={stop.id}
                        className="flex items-center justify-between p-3 rounded-xl border border-border bg-subtle min-w-0"
                      >
                        <div className="flex items-center space-x-3 min-w-0 flex-1">
                          <span className="w-6 h-6 rounded-full bg-primary text-white text-xs font-semibold flex items-center justify-center shrink-0">
                            {stop.planned_sequence}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-semibold text-foreground truncate">
                              {stop.shop?.shop_name} ({stop.shop?.shop_code})
                            </p>
                            <p className="text-[11px] text-slate-500 truncate">
                              Owner: {stop.shop?.owner_name || '—'} | Contact: {stop.shop?.contact_number || '—'}
                            </p>
                          </div>
                        </div>
                        <div className="shrink-0 ml-2">
                          {stop.status === 'VISITED' ? (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase bg-emerald-100 text-emerald-800 border border-emerald-300">
                              {stop.collection?.gross_liters != null ? `${Number(stop.collection.gross_liters).toFixed(1)} L` : 'Visited'}
                            </span>
                          ) : stop.status === 'SKIPPED' ? (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-100 text-amber-900 border border-amber-300">
                              SKIPPED {stop.skip_reason ? `· ${stop.skip_reason}` : ''}
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase bg-slate-100 text-slate-700 border border-slate-300">
                              Pending
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>

                  {totalStopsPages > 1 && (
                    <div className="flex items-center justify-between pt-2 border-t border-border">
                      <span className="text-[11px] text-slate-500 font-medium">
                        Showing {(stopsPage - 1) * stopsPerPage + 1}–{Math.min(stopsPage * stopsPerPage, allStops.length)} of {allStops.length} stops
                      </span>
                      <div className="flex items-center space-x-1.5">
                        <button
                          type="button"
                          disabled={stopsPage === 1}
                          onClick={() => setStopsPage((p) => Math.max(1, p - 1))}
                          className="px-2.5 py-1 text-xs font-semibold rounded-lg border border-border bg-white text-slate-700 hover:bg-muted disabled:opacity-40"
                        >
                          Previous
                        </button>
                        <span className="text-xs font-semibold text-slate-700 tabular-nums px-1">
                          {stopsPage} / {totalStopsPages}
                        </span>
                        <button
                          type="button"
                          disabled={stopsPage >= totalStopsPages}
                          onClick={() => setStopsPage((p) => Math.min(totalStopsPages, p + 1))}
                          className="px-2.5 py-1 text-xs font-semibold rounded-lg border border-border bg-white text-slate-700 hover:bg-muted disabled:opacity-40"
                        >
                          Next
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}

            <div className="pt-2 flex justify-end">
              <button
                type="button"
                onClick={() => setSelectedJourneyDetail(null)}
                className="px-4 py-2 rounded-xl bg-primary text-white text-xs font-semibold"
              >
                Close
              </button>
            </div>
          </Modal>
      )}</AnimatePresence>

      <AnimatePresence>{cancelModalJourney && (
        <Modal key="modal-1" onClose={() => setCancelModalJourney(null)} title="Cancel collection journey" className="max-w-md p-5 space-y-4">
            <div className="flex items-center space-x-2 text-rose-700">
              <Ban className="w-5 h-5" />
              <h3 className="text-sm font-semibold">Cancel Collection Journey</h3>
            </div>
            <p className="text-xs text-slate-600 font-medium">
              You are cancelling active Journey <strong>#{cancelModalJourney.journey_number}</strong>. This operation is authoritative and cannot be undone.
            </p>

            <form onSubmit={handleCancelSubmit} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-foreground mb-1">
                  Reason for Cancellation <span className="text-rose-600">*</span>
                </label>
                <textarea
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  placeholder="e.g. Mechanical breakdown, road blockage, vehicle swap required…"
                  className="w-full text-xs font-medium border border-border rounded-xl p-2.5 bg-subtle text-foreground focus:ring-2 focus:ring-rose-500"
                  rows={3}
                  required
                />
              </div>

              <div className="flex items-center justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setCancelModalJourney(null)}
                  className="px-3 py-2 rounded-xl border border-border text-xs font-semibold text-slate-700 hover:bg-muted"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading || !cancelReason.trim()}
                  className="px-4 py-2 rounded-xl bg-rose-600 text-white text-xs font-semibold hover:bg-rose-700 disabled:opacity-50"
                >
                  {actionLoading ? 'Cancelling…' : 'Confirm Cancellation'}
                </button>
              </div>
            </form>
          </Modal>
      )}</AnimatePresence>

      <AnimatePresence>{profileModalOpen && (
        <Modal key="modal-2" onClose={() => setProfileModalOpen(false)} title="Mobile Tester profile" className="max-w-md p-5 space-y-4">
            <h3 className="text-sm font-semibold text-foreground">
              {editingProfile ? 'Edit Mobile Tester Profile' : 'New Mobile Tester Profile'}
            </h3>

            <form onSubmit={handleSaveProfile} className="space-y-3">
              {!editingProfile && (
                <div>
                  <label className="block text-xs font-semibold text-foreground mb-1">MOT Code *</label>
                  <input
                    type="text"
                    value={profileForm.mot_code}
                    onChange={(e) => setProfileForm({ ...profileForm, mot_code: e.target.value })}
                    placeholder="e.g. MOT-001"
                    className="w-full text-xs font-semibold border border-border rounded-xl p-2.5 bg-subtle"
                    required
                  />
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-foreground mb-1">Mobile Tester Full Name *</label>
                <input
                  type="text"
                  value={profileForm.name}
                  onChange={(e) => setProfileForm({ ...profileForm, name: e.target.value })}
                  placeholder="e.g. Full Name"
                  className="w-full text-xs font-semibold border border-border rounded-xl p-2.5 bg-subtle"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-foreground mb-1">Phone Number *</label>
                <input
                  type="text"
                  value={profileForm.phone_number}
                  onChange={(e) => setProfileForm({ ...profileForm, phone_number: e.target.value })}
                  placeholder="0300-1234567"
                  className="w-full text-xs font-semibold border border-border rounded-xl p-2.5 bg-subtle"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-foreground mb-1">CNIC Number *</label>
                <input
                  type="text"
                  value={profileForm.cnic}
                  onChange={(e) => setProfileForm({ ...profileForm, cnic: e.target.value })}
                  placeholder="35201-1234567-1"
                  className="w-full text-xs font-semibold border border-border rounded-xl p-2.5 bg-subtle"
                  required
                />
              </div>

              <div className="flex items-center justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setProfileModalOpen(false)}
                  className="px-3 py-2 rounded-xl border border-border text-xs font-semibold text-slate-700 hover:bg-muted"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="px-4 py-2 rounded-xl bg-primary text-white text-xs font-semibold hover:bg-primary/90 disabled:opacity-50"
                >
                  {actionLoading ? 'Saving…' : 'Save Profile'}
                </button>
              </div>
            </form>
          </Modal>
      )}</AnimatePresence>

      <AnimatePresence>{vehicleModalOpen && (
        <Modal key="modal-3" onClose={() => setVehicleModalOpen(false)} title="MOT vehicle" className="max-w-md p-5 space-y-4">
            <h3 className="text-sm font-semibold text-foreground">
              {editingVehicle ? 'Edit MOT Vehicle' : 'New MOT Collection Vehicle'}
            </h3>

            <form onSubmit={handleSaveVehicle} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-foreground mb-1">Vehicle Registration # *</label>
                <input
                  type="text"
                  value={vehicleForm.vehicle_number}
                  onChange={(e) => setVehicleForm({ ...vehicleForm, vehicle_number: e.target.value })}
                  placeholder="e.g. LES-1234"
                  className="w-full text-xs tabular-nums font-semibold border border-border rounded-xl p-2.5 bg-subtle"
                  required
                />
              </div>

              <div className="flex items-center justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setVehicleModalOpen(false)}
                  className="px-3 py-2 rounded-xl border border-border text-xs font-semibold text-slate-700 hover:bg-muted"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="px-4 py-2 rounded-xl bg-primary text-white text-xs font-semibold hover:bg-primary/90 disabled:opacity-50"
                >
                  {actionLoading ? 'Saving…' : 'Save Vehicle'}
                </button>
              </div>
            </form>
          </Modal>
      )}</AnimatePresence>

      <AnimatePresence>{transferModalVehicle && (
        <Modal key="modal-transfer" onClose={() => setTransferModalVehicle(null)} title="Transfer MOT Vehicle" className="max-w-md p-5 space-y-4">
            <h3 className="text-sm font-semibold text-foreground">
              Transfer Vehicle across ZMCCs
            </h3>

            <p className="text-xs text-muted-foreground">
              Transferring vehicle <strong className="text-foreground">{transferModalVehicle.vehicle_number}</strong> from current center <strong className="text-foreground">{transferModalVehicle.zmcc?.name}</strong>.
            </p>

            <form onSubmit={handleExecuteTransfer} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-foreground mb-1">Target ZMCC Center *</label>
                <select
                  value={transferTargetZmccId}
                  onChange={(e) => setTransferTargetZmccId(e.target.value)}
                  className="w-full text-xs font-semibold border border-border rounded-xl p-2.5 bg-subtle text-foreground focus:ring-2 focus:ring-primary"
                  required
                >
                  <option value="">Select destination ZMCC</option>
                  {sources
                    .filter((s) => s.id !== transferModalVehicle.zmcc_id)
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.code} · {s.name}
                      </option>
                    ))}
                </select>
              </div>

              <div className="flex items-center justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setTransferModalVehicle(null)}
                  className="px-3 py-2 rounded-xl border border-border text-xs font-semibold text-slate-700 hover:bg-muted"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading || !transferTargetZmccId}
                  className="px-4 py-2 rounded-xl bg-primary text-white text-xs font-semibold hover:bg-primary/90 disabled:opacity-50"
                >
                  {actionLoading ? 'Transferring…' : 'Confirm Transfer'}
                </button>
              </div>
            </form>
          </Modal>
      )}</AnimatePresence>

      <AnimatePresence>{routeRequestModalOpen && (
        <Modal key="modal-route-request" onClose={() => setRouteRequestModalOpen(false)} title="Route Request" className="max-w-md p-5 space-y-4">
          <h3 className="text-sm font-semibold text-foreground">
            {isPheOperator ? 'Request New Collection Route' : 'Create New Collection Route'}
          </h3>

          <form onSubmit={handleRequestRoute} className="space-y-3">
            <div>
              <label className="block text-xs font-semibold text-foreground mb-1">Route Name *</label>
              <input
                type="text"
                value={routeRequestForm.name}
                onChange={(e) => setRouteRequestForm({ ...routeRequestForm, name: e.target.value })}
                placeholder="e.g. Sahiwal North Route"
                className="w-full text-xs font-semibold border border-border rounded-xl p-2.5 bg-subtle"
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-semibold text-foreground mb-1">Origin Point</label>
                <input
                  type="text"
                  value={routeRequestForm.origin}
                  onChange={(e) => setRouteRequestForm({ ...routeRequestForm, origin: e.target.value })}
                  placeholder="e.g. ZMCC Center"
                  className="w-full text-xs font-semibold border border-border rounded-xl p-2.5 bg-subtle"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-foreground mb-1">Destination</label>
                <input
                  type="text"
                  value={routeRequestForm.destination}
                  onChange={(e) => setRouteRequestForm({ ...routeRequestForm, destination: e.target.value })}
                  placeholder="e.g. Chichawatni"
                  className="w-full text-xs font-semibold border border-border rounded-xl p-2.5 bg-subtle"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-foreground mb-1">First Area Name (Optional)</label>
              <input
                type="text"
                value={routeRequestForm.initial_area_name}
                onChange={(e) => setRouteRequestForm({ ...routeRequestForm, initial_area_name: e.target.value })}
                placeholder="e.g. Chak 90/9L"
                className="w-full text-xs font-semibold border border-border rounded-xl p-2.5 bg-subtle"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-foreground mb-1">Description / Notes</label>
              <textarea
                value={routeRequestForm.description}
                onChange={(e) => setRouteRequestForm({ ...routeRequestForm, description: e.target.value })}
                placeholder="Operational notes or route rationale"
                rows={2}
                className="w-full text-xs font-semibold border border-border rounded-xl p-2.5 bg-subtle"
              />
            </div>

            <div className="flex items-center justify-end space-x-2 pt-2">
              <button
                type="button"
                onClick={() => setRouteRequestModalOpen(false)}
                className="px-3 py-2 rounded-xl border border-border text-xs font-semibold text-slate-700 hover:bg-muted"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={actionLoading}
                className="px-4 py-2 rounded-xl bg-primary text-white text-xs font-semibold hover:bg-primary/90 disabled:opacity-50"
              >
                {actionLoading ? 'Submitting…' : isPheOperator ? 'Submit Route Request' : 'Create Route'}
              </button>
            </div>
          </form>
        </Modal>
      )}</AnimatePresence>
    </div>
  );
};
