'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { User } from '@core/types';
import { Header } from '@modules/shared/Header';
import { HierarchicalNavDrawer } from '@modules/shared/navigation/HierarchicalNavDrawer';
import {
  Truck,
  MapPin,
  Clock,
  Store,
  RotateCw,
  AlertCircle,
  CheckCircle2,
  Navigation,
  Wifi,
  WifiOff,
  Save,
  Send,
  X,
  FileEdit,
} from 'lucide-react';
import {
  saveCachedJourney,
  getCachedJourney,
  saveDraft,
  getDraft,
  deleteDraft,
  queueCollection,
  queueGpsLocation,
  getUnsyncedSummary,
  syncAll,
} from '@/frontend/modules/mot/offlineStore';
import { computeCanonicalMilkMetrics } from '@/backend/utils/milkFormulas';

interface StopDetail {
  id: string;
  planned_sequence: number;
  status: string;
  shop_code?: string;
  shop_name?: string;
  owner_name?: string;
  phone_number?: string;
  area_code?: string;
  area_name?: string;
  shop?: {
    id: string;
    shop_code: string;
    shop_name: string;
    owner_name: string;
    contact_number: string;
  } | null;
  collection?: {
    id?: string;
    collection_number?: string;
    gross_liters: number;
    unit: string;
    lr: number;
    fat: number;
    at_13ts_liters: number;
    created_at?: string;
  } | null;
}

interface CurrentJourney {
  id: string;
  journey_number: string;
  operational_date: string;
  route: { id: string; route_code: string; name: string } | null;
  mot_vehicle: { id: string; vehicle_number: string } | null;
  status: string;
  assigned_by_name: string | null;
  assigned_at: string;
  stops: StopDetail[];
}

export default function MotDriverPage() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [loadingUser, setLoadingUser] = useState(true);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const hamburgerButtonRef = useRef<HTMLButtonElement | null>(null);

  // Network and Sync States
  const [isOnline, setIsOnline] = useState<boolean>(true);
  const [unsyncedCount, setUnsyncedCount] = useState<number>(0);
  const [lastSyncTime, setLastSyncTime] = useState<string | null>(null);
  const [syncing, setSyncing] = useState<boolean>(false);
  const [syncFeedback, setSyncFeedback] = useState<string | null>(null);

  // Journey States
  const [journey, setJourney] = useState<CurrentJourney | null>(null);
  const [loadingJourney, setLoadingJourney] = useState(true);
  const [journeyError, setJourneyError] = useState<string | null>(null);

  // Collection Modal States
  const [activeStop, setActiveStop] = useState<StopDetail | null>(null);
  const [shopRmrNumber, setShopRmrNumber] = useState<string>('');
  const [quantity, setQuantity] = useState<string>('');
  const [unit, setUnit] = useState<'LITER' | 'KG'>('LITER');
  const [lr, setLr] = useState<string>('');
  const [fat, setFat] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [collectionGps, setCollectionGps] = useState<{
    latitude: number | null;
    longitude: number | null;
    accuracy: number | null;
    status: 'ACQUIRING' | 'CAPTURED' | 'UNAVAILABLE';
  }>({ latitude: null, longitude: null, accuracy: null, status: 'ACQUIRING' });
  const [formError, setFormError] = useState<string | null>(null);
  const [submittingCollection, setSubmittingCollection] = useState(false);

  // Online / Offline listener
  useEffect(() => {
    setIsOnline(navigator.onLine);
    const handleOnline = () => {
      setIsOnline(true);
      triggerSync();
    };
    const handleOffline = () => {
      setIsOnline(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Refresh unsynced count
  const refreshUnsynced = useCallback(async () => {
    try {
      const summary = await getUnsyncedSummary();
      setUnsyncedCount(summary.totalUnsynced);
    } catch {
      // IndexedDB might not be ready
    }
  }, []);

  useEffect(() => {
    refreshUnsynced();
  }, [refreshUnsynced]);

  // Sync execution
  const triggerSync = useCallback(async () => {
    if (syncing) return;
    setSyncing(true);
    setSyncFeedback(null);
    try {
      const result = await syncAll();
      const totalSynced = result.collections.synced + result.gps.synced;
      if (totalSynced > 0) {
        setSyncFeedback(`Successfully synced ${totalSynced} pending item(s).`);
      }
      setLastSyncTime(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
      await refreshUnsynced();
    } catch (err: any) {
      setSyncFeedback('Sync failed: Network issue.');
    } finally {
      setSyncing(false);
    }
  }, [syncing, refreshUnsynced]);

  // Periodic 30s sync when online
  useEffect(() => {
    const interval = setInterval(() => {
      if (navigator.onLine) {
        triggerSync();
      }
    }, 30000);
    return () => clearInterval(interval);
  }, [triggerSync]);

  // Periodic GPS recording (every 60s when journey is active)
  useEffect(() => {
    if (!journey || journey.status !== 'COLLECTING') return;

    const interval = setInterval(() => {
      if ('geolocation' in navigator && journey?.id) {
        navigator.geolocation.getCurrentPosition(
          async (pos) => {
            await queueGpsLocation({
              journey_id: journey.id,
              latitude: pos.coords.latitude,
              longitude: pos.coords.longitude,
              gps_accuracy: pos.coords.accuracy,
              device_recorded_at: new Date().toISOString(),
            });
            refreshUnsynced();
            if (navigator.onLine) {
              triggerSync();
            }
          },
          () => {
            // Geolocation error ignored for background queue
          },
          { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
        );
      }
    }, 60000);

    return () => clearInterval(interval);
  }, [journey, refreshUnsynced, triggerSync]);

  // Authenticate and guard
  useEffect(() => {
    async function loadUser() {
      try {
        const res = await fetch('/api/auth/me');
        if (res.ok) {
          const data = await res.json();
          if (!data.user) {
            router.push('/login');
            return;
          }
          const user = data.user;
          if (
            user.role !== 'MOT' ||
            user.is_active === false ||
            !user.procurement_source_id ||
            !user.procurement_source ||
            user.procurement_source.is_active === false ||
            user.procurement_source.source_type !== 'ZMCC'
          ) {
            router.push('/workspace-unavailable');
            return;
          }
          setCurrentUser(user);
        } else {
          router.push('/login');
        }
      } catch (err) {
        console.error('Failed to load MOT user', err);
        router.push('/login');
      } finally {
        setLoadingUser(false);
      }
    }
    loadUser();
  }, [router]);

  // Fetch current journey with offline fallback
  const fetchCurrentJourney = useCallback(async () => {
    setLoadingJourney(true);
    setJourneyError(null);
    try {
      if (navigator.onLine) {
        const res = await fetch('/api/zmcc/mot/journeys/current');
        const data = await res.json();
        if (res.ok) {
          if (data.journey) {
            setJourney(data.journey);
            await saveCachedJourney(data.journey);
          } else {
            setJourney(null);
          }
        } else {
          throw new Error(data.error || 'Failed to fetch current journey.');
        }
      } else {
        // Load from offline store
        const cached = await getCachedJourney();
        if (cached) {
          setJourney(cached as any);
        } else {
          setJourney(null);
        }
      }
    } catch (err: any) {
      // Fallback to cache on error
      try {
        const cached = await getCachedJourney();
        if (cached) {
          setJourney(cached as any);
        } else {
          setJourneyError(err.message || 'Unable to connect and no cached journey available.');
        }
      } catch {
        setJourneyError(err.message || 'Failed to load journey.');
      }
    } finally {
      setLoadingJourney(false);
    }
  }, []);

  useEffect(() => {
    if (currentUser) {
      fetchCurrentJourney();
    }
  }, [currentUser, fetchCurrentJourney]);

  // Handle open collection modal
  const handleOpenCollectionModal = async (stop: StopDetail) => {
    setActiveStop(stop);
    setFormError(null);

    // Acquire GPS for collection event
    setCollectionGps({ latitude: null, longitude: null, accuracy: null, status: 'ACQUIRING' });
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setCollectionGps({
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
            status: 'CAPTURED',
          });
        },
        () => {
          setCollectionGps({
            latitude: null,
            longitude: null,
            accuracy: null,
            status: 'UNAVAILABLE',
          });
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 15000 }
      );
    } else {
      setCollectionGps({
        latitude: null,
        longitude: null,
        accuracy: null,
        status: 'UNAVAILABLE',
      });
    }

    // Check for existing draft
    try {
      const draft = await getDraft(stop.id);
      if (draft) {
        setShopRmrNumber(draft.shop_rmr_number || '');
        setQuantity(draft.quantity || '');
        setUnit(draft.unit || 'LITER');
        setLr(draft.lr || '');
        setFat(draft.fat || '');
        setNotes(draft.notes || '');
      } else {
        setShopRmrNumber('');
        setQuantity('');
        setUnit('LITER');
        setLr('');
        setFat('');
        setNotes('');
      }
    } catch {
      setShopRmrNumber('');
      setQuantity('');
      setUnit('LITER');
      setLr('');
      setFat('');
      setNotes('');
    }
  };

  // Live calculated milk metrics preview
  const livePreview = React.useMemo(() => {
    const qNum = parseFloat(quantity);
    const lrNum = parseFloat(lr);
    const fatNum = parseFloat(fat);

    if (isNaN(qNum) || qNum <= 0 || isNaN(lrNum) || isNaN(fatNum)) {
      return null;
    }

    try {
      return computeCanonicalMilkMetrics(qNum, unit, lrNum, fatNum);
    } catch {
      return null;
    }
  }, [quantity, unit, lr, fat]);

  // Save Draft Action
  const handleSaveDraft = async () => {
    if (!activeStop) return;
    try {
      await saveDraft(activeStop.id, {
        shop_rmr_number: shopRmrNumber.trim() || null,
        quantity,
        unit,
        lr,
        fat,
        notes,
      });
      setActiveStop(null);
      setSyncFeedback('Draft saved locally.');
    } catch (err: any) {
      setFormError('Failed to save draft: ' + err.message);
    }
  };

  // Record & Queue Collection Action
  const handleRecordCollection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeStop || !journey) return;
    setFormError(null);

    const qNum = parseFloat(quantity);
    const lrNum = parseFloat(lr);
    const fatNum = parseFloat(fat);

    if (isNaN(qNum) || qNum <= 0 || qNum > 10000) {
      setFormError('Quantity must be a positive number up to 10,000.');
      return;
    }
    if (isNaN(lrNum) || lrNum <= 0) {
      setFormError('Lactometer reading (LR) must be greater than zero.');
      return;
    }
    if (isNaN(fatNum) || fatNum < 0) {
      setFormError('Fat percentage must be non-negative.');
      return;
    }

    setSubmittingCollection(true);
    try {
      const clientEventId =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `evt-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      const offlineCreatedAt = new Date().toISOString();

      // Queue into IndexedDB
      await queueCollection({
        client_event_id: clientEventId,
        journey_id: journey.id,
        stop_id: activeStop.id,
        shop_rmr_number: shopRmrNumber.trim() || null,
        quantity: qNum,
        unit,
        lr: lrNum,
        fat: fatNum,
        recorded_latitude: collectionGps.latitude,
        recorded_longitude: collectionGps.longitude,
        recorded_gps_accuracy: collectionGps.accuracy,
        notes: notes.trim() || undefined,
        offline_created_at: offlineCreatedAt,
      });

      // Update local stop state immediately for instant UI feedback
      const preview = computeCanonicalMilkMetrics(qNum, unit, lrNum, fatNum);
      setJourney((prev) => {
        if (!prev) return null;
        return {
          ...prev,
          stops: prev.stops.map((s) =>
            s.id === activeStop.id
              ? {
                  ...s,
                  status: 'VISITED',
                  collection: {
                    gross_liters: preview.grossLiters,
                    unit,
                    lr: lrNum,
                    fat: fatNum,
                    at_13ts_liters: preview.at13TsLiters,
                    created_at: offlineCreatedAt,
                  },
                }
              : s
          ),
        };
      });

      setActiveStop(null);
      await refreshUnsynced();

      // Trigger immediate sync if online
      if (navigator.onLine) {
        triggerSync();
      }
    } catch (err: any) {
      setFormError(err.message || 'Failed to queue collection event.');
    } finally {
      setSubmittingCollection(false);
    }
  };

  const openDrawer = useCallback(() => setIsDrawerOpen(true), []);
  const closeDrawer = useCallback(() => {
    setIsDrawerOpen(false);
    setTimeout(() => {
      hamburgerButtonRef.current?.focus();
    }, 0);
  }, []);

  if (loadingUser) {
    return (
      <div className="min-h-screen bg-[#FDFBF9] flex items-center justify-center p-8 text-center text-xs font-bold text-slate-500">
        Loading MOT Driver Station...
      </div>
    );
  }

  if (!currentUser) return null;

  return (
    <div className="w-full max-w-full flex flex-col h-screen bg-[#FDFBF9] text-[#111311] overflow-hidden font-sans">
      {/* Header */}
      <Header
        currentUser={currentUser}
        title="MOT Driver Station"
        showBranding={true}
        showMenuButton={true}
        onMenuClick={openDrawer}
        menuButtonRef={hamburgerButtonRef}
      />

      {/* Accessible Hierarchical Navigation Drawer */}
      <HierarchicalNavDrawer
        currentUser={currentUser}
        isOpen={isDrawerOpen}
        onClose={closeDrawer}
        triggerButtonRef={hamburgerButtonRef}
      />

      <div className="flex-1 flex overflow-hidden">
        {/* Main Content Area */}
        <main className="flex-1 overflow-y-auto p-3 sm:p-5 lg:p-6 w-full max-w-5xl mx-auto space-y-4">
          {/* Online/Offline Status & Sync Control Bar */}
          <div className="flex items-center justify-between gap-2 px-3 py-2 sm:px-4 sm:py-2.5 bg-white rounded-2xl border border-[#EAE4D5] shadow-xs">
            <div className="flex items-center space-x-2 sm:space-x-3 min-w-0">
              <span
                className={`px-2.5 py-1 rounded-full text-xs font-black flex items-center space-x-1.5 shrink-0 ${
                  isOnline ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                }`}
              >
                {isOnline ? (
                  <>
                    <Wifi className="w-3.5 h-3.5" />
                    <span>Online</span>
                  </>
                ) : (
                  <>
                    <WifiOff className="w-3.5 h-3.5" />
                    <span>Offline</span>
                  </>
                )}
              </span>

              <span className="text-xs text-slate-600 font-bold truncate">
                {unsyncedCount > 0 ? (
                  <span className="text-[#1E3A8A] font-black">{unsyncedCount} pending sync</span>
                ) : (
                  'All synced'
                )}
              </span>

              {lastSyncTime && (
                <span className="hidden md:inline text-[11px] text-slate-400 font-mono">
                  Synced {lastSyncTime}
                </span>
              )}
            </div>

            <div className="flex items-center space-x-2 shrink-0">
              {syncFeedback && (
                <span className="hidden sm:inline text-xs font-bold text-emerald-700">{syncFeedback}</span>
              )}
              <button
                type="button"
                onClick={triggerSync}
                disabled={syncing || !isOnline}
                className="min-h-[44px] px-3.5 py-2 rounded-xl bg-[#1E3A8A] text-white text-xs font-bold hover:bg-[#1E3A8A]/90 disabled:opacity-50 disabled:cursor-not-allowed shadow-xs flex items-center space-x-1.5 focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]"
              >
                <RotateCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
                <span>{syncing ? 'Syncing...' : 'Sync Now'}</span>
              </button>
            </div>
          </div>

          {loadingJourney ? (
            <div className="p-12 text-center text-xs font-bold text-slate-500 bg-white rounded-2xl border border-[#EAE4D5]">
              <RotateCw className="w-5 h-5 animate-spin mx-auto mb-2 text-[#1E3A8A]" />
              Checking assigned route...
            </div>
          ) : journeyError ? (
            <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-xs font-bold flex items-center space-x-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
              <span>{journeyError}</span>
            </div>
          ) : !journey ? (
            <div className="p-10 bg-white rounded-2xl border border-[#EAE4D5] shadow-xs text-center space-y-3">
              <div className="w-12 h-12 rounded-full bg-blue-50 text-[#1E3A8A] flex items-center justify-center mx-auto">
                <Truck className="w-6 h-6" />
              </div>
              <h2 className="text-base font-bold text-[#111311]">No Active Journey Assigned</h2>
              <p className="text-xs text-slate-500 max-w-md mx-auto">
                A milk collection journey has not been dispatched to this unit yet.
              </p>
            </div>
          ) : (
            (() => {
              const visitedStops = journey.stops.filter((s) => s.status === 'VISITED');
              const pendingStops = journey.stops.filter((s) => s.status !== 'VISITED');
              const nextPendingStop = pendingStops[0] || null;
              const totalGross = visitedStops.reduce(
                (sum, s) => sum + (s.collection?.gross_liters || 0),
                0
              );
              const totalAt13ts = visitedStops.reduce(
                (sum, s) => sum + (s.collection?.at_13ts_liters || 0),
                0
              );

              return (
                <div className="space-y-4">
                  {/* Active Journey Hero Card */}
                  <div className="p-4 sm:p-5 bg-white rounded-2xl border border-[#EAE4D5] shadow-xs space-y-3">
                    <div className="flex items-center justify-between border-b border-[#EAE4D5] pb-3">
                      <div>
                        <span className="text-[10px] font-black uppercase text-slate-500 tracking-wider block">
                          Active Journey
                        </span>
                        <div className="flex items-center space-x-2 mt-0.5">
                          <h2 className="text-base sm:text-lg font-mono font-black text-[#1E3A8A]">
                            #{journey.journey_number}
                          </h2>
                          <span className="text-xs font-bold text-[#111311] truncate">
                            {journey.route?.name || journey.route?.route_code || 'Assigned Route'}
                          </span>
                        </div>
                      </div>

                      <div className="text-right">
                        <span className="text-[10px] font-bold text-slate-500 block uppercase">Vehicle</span>
                        <span className="font-mono font-black text-sm text-[#111311]">
                          {journey.mot_vehicle?.vehicle_number || '—'}
                        </span>
                      </div>
                    </div>

                    {/* Operational Metrics Cards (Physical vs Commercial Truth) */}
                    <div className="grid grid-cols-3 gap-2 sm:gap-3 text-center">
                      <div className="p-2 sm:p-2.5 rounded-xl bg-[#FDFBF9] border border-[#EAE4D5]">
                        <span className="text-[10px] font-bold text-slate-500 uppercase block">Stops Done</span>
                        <span className="font-black text-xs sm:text-sm text-slate-900 font-mono">
                          {visitedStops.length} / {journey.stops.length}
                        </span>
                      </div>
                      <div className="p-2 sm:p-2.5 rounded-xl bg-blue-50/70 border border-blue-200">
                        <span className="text-[10px] font-black text-blue-800 uppercase block">Physical</span>
                        <span className="font-black text-xs sm:text-sm text-blue-950 font-mono">
                          {totalGross.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 2 })} L Gross
                        </span>
                      </div>
                      <div className="p-2 sm:p-2.5 rounded-xl bg-emerald-50/70 border border-emerald-300">
                        <span className="text-[10px] font-black text-emerald-800 uppercase block">Commercial</span>
                        <span className="font-black text-xs sm:text-sm text-emerald-950 font-mono">
                          {totalAt13ts.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 2 })} L @13TS
                        </span>
                      </div>
                    </div>

                    {/* Next Stop Highlight Callout */}
                    {nextPendingStop && (
                      <div className="mt-2 p-3 sm:p-3.5 bg-[#F4F0E6]/70 border border-[#EAE4D5] rounded-xl flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                        <div className="flex items-center space-x-2.5">
                          <span className="w-7 h-7 rounded-lg bg-[#1E3A8A] text-white font-mono font-black text-xs flex items-center justify-center shrink-0">
                            {nextPendingStop.planned_sequence}
                          </span>
                          <div>
                            <span className="text-[10px] font-bold text-slate-500 uppercase block">
                              Next Stop
                            </span>
                            <span className="font-bold text-xs sm:text-sm text-[#111311]">
                              {nextPendingStop.shop_name || nextPendingStop.shop?.shop_name || 'Shop'}
                            </span>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => handleOpenCollectionModal(nextPendingStop)}
                          className="min-h-[44px] w-full sm:w-auto px-4 py-2 bg-[#1E3A8A] hover:bg-blue-900 text-white rounded-xl font-bold text-xs shadow-xs transition flex items-center justify-center space-x-1.5 focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]"
                        >
                          <span>Record Collection</span>
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Stops Timeline / List */}
                  <div className="bg-white rounded-2xl border border-[#EAE4D5] shadow-xs overflow-hidden">
                    <div className="p-3 sm:p-4 border-b border-[#EAE4D5] flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        <Store className="w-4 h-4 text-[#1E3A8A]" />
                        <h3 className="text-xs sm:text-sm font-bold text-[#111311]">
                          Planned Stops ({journey.stops.length})
                        </h3>
                      </div>
                      <span className="text-[11px] font-medium text-slate-500">
                        {visitedStops.length} of {journey.stops.length} completed
                      </span>
                    </div>

                    <div className="divide-y divide-[#EAE4D5]">
                      {journey.stops.map((stop) => {
                        const shopName = stop.shop_name || stop.shop?.shop_name || 'Shop';
                        const shopCode = stop.shop_code || stop.shop?.shop_code || '—';
                        const ownerName = stop.owner_name || stop.shop?.owner_name || '—';
                        const isVisited = stop.status === 'VISITED';

                        return (
                          <div
                            key={stop.id}
                            className="p-3.5 sm:p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 hover:bg-[#FDFBF9] transition"
                          >
                            <div className="flex items-start space-x-3">
                              <span
                                className={`w-7 h-7 rounded-lg text-xs font-mono font-bold flex items-center justify-center shrink-0 mt-0.5 ${
                                  isVisited
                                    ? 'bg-emerald-600 text-white'
                                    : 'bg-[#F4F0E6] text-slate-700 border border-[#C4B9A3]'
                                }`}
                              >
                                {stop.planned_sequence}
                              </span>
                              <div className="space-y-1">
                                <div className="flex items-center space-x-2">
                                  <span className="text-xs font-bold text-[#111311]">
                                    {shopName}
                                  </span>
                                  <span className="text-[10px] font-mono text-slate-500">
                                    ({shopCode})
                                  </span>
                                  <span
                                    className={`px-2 py-0.5 rounded-md text-[9.5px] font-bold uppercase ${
                                      isVisited
                                        ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                                        : 'bg-amber-100 text-amber-800 border border-amber-300'
                                    }`}
                                  >
                                    {isVisited ? 'Completed' : 'Pending'}
                                  </span>
                                </div>

                                <p className="text-[11px] text-slate-500">
                                  Owner: {ownerName}
                                </p>

                                {isVisited && stop.collection && (
                                  <div className="mt-1 p-2 rounded-lg bg-emerald-50/70 border border-emerald-200 text-[11px] font-mono font-bold text-emerald-950 flex flex-wrap gap-x-3 gap-y-1">
                                    <span>Gross: {Number(stop.collection.gross_liters).toFixed(2)} L</span>
                                    <span>@13TS: {Number(stop.collection.at_13ts_liters).toFixed(2)} L</span>
                                    <span>LR: {stop.collection.lr}</span>
                                    <span>Fat: {stop.collection.fat}%</span>
                                  </div>
                                )}
                              </div>
                            </div>

                            {!isVisited && (
                              <div className="self-end sm:self-center">
                                <button
                                  type="button"
                                  onClick={() => handleOpenCollectionModal(stop)}
                                  className="min-h-[44px] px-3.5 py-2 rounded-xl bg-[#1E3A8A] text-white text-xs font-bold hover:bg-blue-900 transition shadow-xs focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]"
                                >
                                  Record Collection
                                </button>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })()
          )}

          {/* Collection Entry Modal / Drawer */}
          {activeStop && (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs"
              role="dialog"
              aria-modal="true"
            >
              <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl border border-[#EAE4D5] overflow-hidden flex flex-col max-h-[90vh]">
                {/* Modal Header */}
                <div className="p-4 border-b border-[#EAE4D5] flex items-center justify-between bg-[#FDFBF9]">
                  <div className="flex items-center space-x-2">
                    <span className="w-6 h-6 rounded-full bg-[#1E3A8A] text-white text-xs font-black flex items-center justify-center">
                      {activeStop.planned_sequence}
                    </span>
                    <div>
                      <h3 className="text-sm font-black text-[#111311]">
                        {activeStop.shop_name || activeStop.shop?.shop_name} ({activeStop.shop_code || activeStop.shop?.shop_code})
                      </h3>
                      <p className="text-[11px] text-slate-500">Record Shop Milk Intake</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveStop(null)}
                    className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {/* GPS Status Indicator */}
                <div className="px-4 py-2 bg-slate-50 border-b border-[#EAE4D5] text-[11px] flex items-center justify-between">
                  <div className="flex items-center space-x-1.5">
                    <Navigation className="w-3.5 h-3.5 text-blue-700" />
                    <span className="text-slate-600 font-bold">GPS Location:</span>
                    {collectionGps.status === 'ACQUIRING' && (
                      <span className="text-amber-700 font-bold animate-pulse">Acquiring coordinates...</span>
                    )}
                    {collectionGps.status === 'CAPTURED' && (
                      <span className="text-emerald-700 font-bold">
                        Captured (±{Math.round(collectionGps.accuracy || 0)}m)
                      </span>
                    )}
                    {collectionGps.status === 'UNAVAILABLE' && (
                      <span className="text-slate-500 font-medium">GPS Unavailable</span>
                    )}
                  </div>
                </div>

                {/* Modal Form */}
                <form onSubmit={handleRecordCollection} className="p-4 overflow-y-auto space-y-4">
                  {formError && (
                    <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-xs font-bold">
                      {formError}
                    </div>
                  )}

                  {/* Manual Shop RMR Serial # */}
                  <div>
                    <label className="block text-xs font-black text-[#111311] mb-1">
                      Shop RMR Number (Paper Reference)
                    </label>
                    <input
                      type="text"
                      pattern="[0-9]*"
                      inputMode="numeric"
                      value={shopRmrNumber}
                      onChange={(e) => setShopRmrNumber(e.target.value.replace(/[^0-9]/g, ''))}
                      placeholder="e.g. 004821"
                      className="w-full text-xs font-bold border border-[#EAE4D5] rounded-xl p-2.5 bg-[#FDFBF9] focus:ring-2 focus:ring-[#1E3A8A]"
                    />
                    <p className="text-[10px] text-slate-500 mt-1">Manual paper receipt serial (digits only, leading zeros preserved)</p>
                  </div>

                  {/* Quantity & Unit Toggle */}
                  <div>
                    <label className="block text-xs font-black text-[#111311] mb-1">
                      Intake Milk Quantity <span className="text-rose-600">*</span>
                    </label>
                    <div className="flex space-x-2">
                      <input
                        type="number"
                        step="0.01"
                        min="0.1"
                        max="10000"
                        value={quantity}
                        onChange={(e) => setQuantity(e.target.value)}
                        placeholder="e.g. 150.0"
                        className="flex-1 text-xs font-bold border border-[#EAE4D5] rounded-xl p-2.5 bg-[#FDFBF9] focus:ring-2 focus:ring-[#1E3A8A]"
                        required
                      />
                      <div className="flex rounded-xl border border-[#EAE4D5] overflow-hidden bg-[#FDFBF9]">
                        <button
                          type="button"
                          onClick={() => setUnit('LITER')}
                          className={`px-3 py-2 text-xs font-black transition ${
                            unit === 'LITER' ? 'bg-[#1E3A8A] text-white' : 'text-slate-600'
                          }`}
                        >
                          LITER
                        </button>
                        <button
                          type="button"
                          onClick={() => setUnit('KG')}
                          className={`px-3 py-2 text-xs font-black transition ${
                            unit === 'KG' ? 'bg-[#1E3A8A] text-white' : 'text-slate-600'
                          }`}
                        >
                          KG
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* LR and Fat Inputs */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-black text-[#111311] mb-1">
                        LR Reading (20-35) <span className="text-rose-600">*</span>
                      </label>
                      <input
                        type="number"
                        step="0.1"
                        min="20"
                        max="35"
                        value={lr}
                        onChange={(e) => setLr(e.target.value)}
                        placeholder="e.g. 28.5"
                        className="w-full text-xs font-bold border border-[#EAE4D5] rounded-xl p-2.5 bg-[#FDFBF9] focus:ring-2 focus:ring-[#1E3A8A]"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-black text-[#111311] mb-1">
                        Fat % (1.5-12.0) <span className="text-rose-600">*</span>
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        min="1.5"
                        max="12"
                        value={fat}
                        onChange={(e) => setFat(e.target.value)}
                        placeholder="e.g. 4.2"
                        className="w-full text-xs font-bold border border-[#EAE4D5] rounded-xl p-2.5 bg-[#FDFBF9] focus:ring-2 focus:ring-[#1E3A8A]"
                        required
                      />
                    </div>
                  </div>

                  {/* Live Calculated Canonical Milk Preview */}
                  {livePreview && (
                    <div className="p-3 bg-blue-50/70 border border-blue-200 rounded-xl space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-black uppercase tracking-wider text-[#1E3A8A]">
                          Live Dual-Truth Preview (Canonical)
                        </span>
                        <span className="text-[9px] font-bold text-slate-500 bg-white/80 px-2 py-0.5 rounded border border-blue-100">
                          v1.0 Rules
                        </span>
                      </div>
                      
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {/* Physical Milk Truth */}
                        <div className="p-2.5 bg-white/90 rounded-lg border border-blue-100">
                          <span className="text-[10px] font-extrabold uppercase text-slate-500 block mb-1">
                            Physical Milk Truth
                          </span>
                          <div className="flex items-baseline justify-between">
                            <span className="text-xs text-slate-600 font-semibold">Gross Liters:</span>
                            <span className="text-sm font-black text-slate-900">{livePreview.grossLiters} L</span>
                          </div>
                          <div className="flex items-baseline justify-between mt-0.5 text-xs">
                            <span className="text-[11px] text-slate-500">Density:</span>
                            <span className="text-[11px] font-bold text-slate-700">{livePreview.density}</span>
                          </div>
                        </div>

                        {/* Commercial Milk Truth */}
                        <div className="p-2.5 bg-emerald-50/70 rounded-lg border border-emerald-200">
                          <span className="text-[10px] font-extrabold uppercase text-emerald-800 block mb-1">
                            Commercial Milk Truth
                          </span>
                          <div className="flex items-baseline justify-between">
                            <span className="text-xs text-emerald-900 font-semibold">@13TS Liters:</span>
                            <span className="text-sm font-black text-emerald-700">{livePreview.at13TsLiters} L</span>
                          </div>
                          <div className="flex items-baseline justify-between mt-0.5 text-[11px] text-emerald-800">
                            <span>SNF: <strong className="font-bold">{livePreview.snf}%</strong></span>
                            <span>TS: <strong className="font-bold">{livePreview.totalSolids}%</strong></span>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Notes (Optional) */}
                  <div>
                    <label className="block text-xs font-black text-[#111311] mb-1">
                      Driver Notes (Optional)
                    </label>
                    <textarea
                      rows={2}
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="e.g. Clean container, verified supplier seal"
                      className="w-full text-xs border border-[#EAE4D5] rounded-xl p-2.5 bg-[#FDFBF9] focus:ring-2 focus:ring-[#1E3A8A]"
                    />
                  </div>

                  {/* Modal Action Buttons */}
                  <div className="flex items-center space-x-2 pt-3 border-t border-[#EAE4D5]">
                    <button
                      type="button"
                      onClick={handleSaveDraft}
                      className="flex-1 flex items-center justify-center space-x-1.5 px-3 py-3 rounded-xl border border-[#EAE4D5] text-xs font-bold text-slate-700 hover:bg-[#F4F0E6] min-h-[44px] transition"
                    >
                      <Save className="w-4 h-4" />
                      <span>Save Draft</span>
                    </button>
                    <button
                      type="submit"
                      disabled={submittingCollection}
                      className="flex-2 flex items-center justify-center space-x-1.5 px-4 py-3 rounded-xl bg-[#1E3A8A] text-white text-xs font-black hover:bg-[#1E3A8A]/90 transition shadow-sm disabled:opacity-50 min-h-[44px]"
                    >
                      <Send className="w-4 h-4" />
                      <span>{submittingCollection ? 'Queueing...' : 'Record & Queue'}</span>
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
