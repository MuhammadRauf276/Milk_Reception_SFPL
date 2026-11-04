'use client';

import { useAutoClearMessage } from '@/frontend/hooks/useAutoClearMessage';
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Truck,
  Send,
  Navigation,
  MapPin,
  Clock,
  AlertTriangle,
  CheckCircle2,
  MessageSquare,
  User as UserIcon,
  X,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react';
import { User } from '@core/types';
import { ManagerJourneyMap } from './ManagerJourneyMap';
import { SmsOutboxView } from './SmsOutboxView';
import { Combobox } from '@/components/ui/combobox';
import { SegmentedTabs } from '@/components/ui/segmented-tabs';
import { motion } from 'framer-motion';
import { fadeSlide } from '@/components/motion/presets';
import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { fetchJson } from '@/lib/query/fetchJson';
import { stationQueryKeys } from '@/lib/query/stationQueryKeys';
import { getErrorMessage } from '@/lib/errors';
import { PendingApprovalsPanel } from '@/frontend/modules/zmcc/approvals/PendingApprovalsPanel';
import {
  canApproveRoute,
  canAssignJourney,
  canCreateRoute,
  isFieldStationRole,
  routeNeedsApproval,
} from '@/frontend/modules/zmcc/stage1Capabilities';
import { sendJson } from './workspace/mutationUtils';
import { MOT_DATA_TABS, fetchMotTabData } from './workspace/fetchMotTabData';
import { useDispatchForm, useDispatchGps } from './workspace/useDispatch';
import { DispatchTab } from './workspace/DispatchTab';
import { ActiveJourneysTab } from './workspace/ActiveJourneysTab';
import { JourneyHistoryTab } from './workspace/JourneyHistoryTab';
import { ProfilesTab } from './workspace/ProfilesTab';
import { VehiclesTab } from './workspace/VehiclesTab';
import { JourneyDetailSheet } from './workspace/JourneyDetailSheet';
import { CancelJourneySheet } from './workspace/CancelJourneySheet';
import { ProfileSheet } from './workspace/ProfileSheet';
import { RouteRequestSheet } from './workspace/RouteRequestSheet';
import {
  EMPTY_JOURNEYS,
  EMPTY_PROFILES,
  EMPTY_ROUTES,
  EMPTY_VEHICLES,
  MOT_TAB_DATA_KEY,
  type JourneyItem,
  type MotProfileItem,
  type MotVehicleItem,
  type MotWorkspaceTab,
  type RouteOption,
  type ZmccSource,
} from './workspace/types';

export type { MotWorkspaceTab } from './workspace/types';

interface MotOperationsWorkspaceProps {
  currentUser: User | null;
  initialTab?: MotWorkspaceTab;
  activeTab?: MotWorkspaceTab;
  onTabChange?: (tab: MotWorkspaceTab) => void;
  hideTabBar?: boolean;
}

export const MotOperationsWorkspace: React.FC<MotOperationsWorkspaceProps> = ({
  currentUser,
  initialTab = 'DISPATCH',
  activeTab: controlledTab,
  onTabChange,
  hideTabBar = false,
}) => {
  const isSuperAdmin = currentUser?.role === 'SUPER_ADMIN';
  const isDataExecutive = currentUser?.role === 'DATA_EXECUTIVE';
  const isCentralRole = isSuperAdmin || isDataExecutive;
  const role = currentUser?.role ?? '';
  const canCreateRoutes = canCreateRoute(role);
  const routeNeedsZonalApproval = routeNeedsApproval(role);
  // Zonal Manager and above (not Data Executive) approve routes and cancel journeys.
  const canApproveRoutes = canApproveRoute(role);
  const canAssignAndDispatch = canAssignJourney(role);
  // MDO and PHE Operator work from the station: they do not manage testers or vehicles.
  const isStationRole = isFieldStationRole(role);

  // Permitted tabs
  const permittedTabs: { id: MotWorkspaceTab; label: string; icon: LucideIcon }[] = useMemo(() => {
    const tabs: { id: MotWorkspaceTab; label: string; icon: LucideIcon }[] = [
      { id: 'DISPATCH', label: 'Assign & Dispatch', icon: Send },
      { id: 'ACTIVE_JOURNEYS', label: 'Active Journeys', icon: Truck },
      { id: 'JOURNEY_HISTORY', label: 'Journey History', icon: Clock },
      { id: 'JOURNEY_MAP', label: 'Journey map', icon: MapPin },
      { id: 'SMS_OUTBOX', label: 'WhatsApp Receipts', icon: MessageSquare },
    ];
    if (!isStationRole) {
      tabs.push({ id: 'PROFILES', label: 'Mobile Testers', icon: UserIcon });
    }
    // Everyone except Data Executive / Super Admin sees their own ZMCC fleet read-only here;
    // the two owners use the Fleet screen.
    if (!isCentralRole) {
      tabs.push({ id: 'VEHICLES', label: 'Fleet', icon: Navigation });
    }
    tabs.push({ id: 'APPROVALS', label: 'Approvals', icon: ShieldCheck });
    return tabs;
  }, [isStationRole, isCentralRole]);

  const [internalTab, setInternalTab] = useState<MotWorkspaceTab>(controlledTab || initialTab);
  const activeTab = controlledTab || internalTab;

  const setActiveTab = (tab: MotWorkspaceTab) => {
    setInternalTab(tab);
    if (onTabChange) onTabChange(tab);
  };

  const [selectedMapJourneyId, setSelectedMapJourneyId] = useState<string | null>(null);

  // ZMCC Scope
  const [selectedZmccId, setSelectedZmccId] = useState<string>('');

  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  useAutoClearMessage(successMessage, setSuccessMessage);

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

  const [historyStatusFilter, setHistoryStatusFilter] = useState('all');

  // Sheets
  const [selectedJourneyDetail, setSelectedJourneyDetail] = useState<JourneyItem | null>(null);
  const [cancelSheetJourney, setCancelSheetJourney] = useState<JourneyItem | null>(null);
  const [profileSheet, setProfileSheet] = useState<{ editing: MotProfileItem | null } | null>(null);
  const [routeRequestOpen, setRouteRequestOpen] = useState(false);

  // Effective ZMCC
  const effectiveZmccId = useMemo(() => {
    if (isCentralRole) return selectedZmccId || null;
    return currentUser?.procurement_source_id ? String(currentUser.procurement_source_id) : null;
  }, [isCentralRole, selectedZmccId, currentUser]);

  // ZMCC Sources for Super Admin & Data Executive
  const sourcesQuery = useQuery({
    queryKey: stationQueryKeys.zmcc.sources(),
    queryFn: ({ signal }) => fetchJson<{ zmccs?: ZmccSource[] }>('/api/zmcc/sources', { signal }),
    enabled: isCentralRole,
    staleTime: 10 * 60_000,
  });
  const sources = useMemo(
    () => (sourcesQuery.data?.zmccs || []).filter((s) => s.is_active),
    [sourcesQuery.data]
  );
  useEffect(() => {
    if (sources.length > 0) setSelectedZmccId((current) => current || sources[0].id);
  }, [sources]);

  // Dispatch form + GPS stay here so they survive tab switches.
  const dispatchForm = useDispatchForm();
  const dispatchGps = useDispatchGps({
    sources,
    effectiveZmccId,
    fallbackFacilityCode: currentUser?.procurement_source?.code as string | undefined,
    dispatchTabActive: activeTab === 'DISPATCH',
  });

  // Load Data based on activeTab and effectiveZmccId (TanStack Query: cached, aborted on tab switch)
  const queryClient = useQueryClient();
  const canLoadData = Boolean(effectiveZmccId) || isCentralRole;
  const dataEnabled = canLoadData && MOT_DATA_TABS.has(activeTab);
  const dataQuery = useQuery({
    queryKey: [...MOT_TAB_DATA_KEY, activeTab, effectiveZmccId ?? '', historyStatusFilter],
    queryFn: ({ signal }) => fetchMotTabData(activeTab, effectiveZmccId, historyStatusFilter, signal),
    enabled: dataEnabled,
    placeholderData: keepPreviousData,
  });
  const routes: RouteOption[] = dataQuery.data?.routes ?? EMPTY_ROUTES;
  const profiles: MotProfileItem[] = dataQuery.data?.profiles ?? EMPTY_PROFILES;
  const vehicles: MotVehicleItem[] = dataQuery.data?.vehicles ?? EMPTY_VEHICLES;
  const journeys: JourneyItem[] = dataQuery.data?.journeys ?? EMPTY_JOURNEYS;
  const loading = dataEnabled && dataQuery.isFetching && dataQuery.isPlaceholderData;

  const dataError = dataQuery.error;
  useEffect(() => {
    if (dataError) setError(getErrorMessage(dataError) || 'Failed to load MC data.');
  }, [dataError]);

  const loadData = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: MOT_TAB_DATA_KEY });
  }, [queryClient]);

  const refreshData = () => {
    setError(null);
    return loadData();
  };

  const finishSheet = (message: string, close: () => void) => {
    setSuccessMessage(message);
    close();
  };

  // Inspect journey details (read-only; failures are ignored as before)
  const inspectMutation = useMutation({
    mutationFn: (journeyId: string) => fetchJson<{ journey?: JourneyItem }>(`/api/zmcc/mot/journeys/${journeyId}`),
    onSuccess: (data) => {
      if (data.journey) setSelectedJourneyDetail(data.journey);
    },
  });

  const toggleActiveMutation = useMutation({
    mutationFn: (v: { kind: 'profiles'; id: string; is_active: boolean }) =>
      sendJson(`/api/zmcc/mot/${v.kind}/${v.id}`, 'PATCH', { is_active: v.is_active }, 'Request failed'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: MOT_TAB_DATA_KEY });
    },
    onError: (err) => setError(getErrorMessage(err)),
  });

  const handleToggleProfileActive = (profile: MotProfileItem) => {
    if (profile.has_active_journey && profile.is_active) {
      setError('Cannot deactivate an MC Profile with an active journey.');
      return;
    }
    toggleActiveMutation.mutate({ kind: 'profiles', id: profile.id, is_active: !profile.is_active });
  };

  const showMap = (journeyId: string) => {
    setSelectedMapJourneyId(journeyId);
    setActiveTab('JOURNEY_MAP');
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-4 bg-card rounded-xl border border-border shadow-2xs">
        <div className="flex items-center space-x-3">
          <div>
            <h1 className="text-base sm:text-lg font-semibold text-foreground tracking-tight">
              Mobile Tester operations
            </h1>
          </div>
        </div>

        {isCentralRole && sources.length > 0 && (
          <div className="flex items-center space-x-2">
            <label htmlFor="zmcc-select" className="text-xs font-semibold text-slate-700 whitespace-nowrap">
              ZMCC
            </label>
            <Combobox
              id="zmcc-select"
              className="min-h-[44px] min-w-[200px]"
              value={selectedZmccId}
              onValueChange={setSelectedZmccId}
              placeholder="Select ZMCC"
              searchPlaceholder="Search ZMCC"
              options={sources.map((s) => ({ value: s.id, label: `${s.name} · ${s.code}`, keywords: `${s.code} ${s.name}` }))}
            />
          </div>
        )}
      </div>

      {error && (
        <div className="bg-card border-border flex items-center justify-between p-3.5 border rounded-xl text-rose-800 text-xs font-semibold animate-panel-in">
          <div className="flex items-center space-x-2">
            <AlertTriangle className="w-4 h-4 shrink-0 text-rose-600" />
            <span>{error}</span>
          </div>
          <button
            type="button"
            onClick={() => setError(null)}
            aria-label="Dismiss error"
            className="flex min-h-[44px] min-w-[44px] items-center justify-center text-rose-600 hover:text-rose-900"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {successMessage && (
        <div className="bg-card border-border flex items-center justify-between p-3.5 border rounded-xl text-emerald-800 text-xs font-semibold">
          <div className="flex items-center space-x-2">
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
            <span>{successMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => setSuccessMessage(null)}
            aria-label="Dismiss message"
            className="flex min-h-[44px] min-w-[44px] items-center justify-center text-emerald-600 hover:text-emerald-900"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {!hideTabBar && (
        <div className="lg:hidden">
          <SegmentedTabs
            label="Mobile Tester operations views"
            value={activeTab}
            onValueChange={(tab) => {
              setActiveTab(tab);
              setError(null);
              setSuccessMessage(null);
            }}
            tabs={permittedTabs.map((tab) => ({ value: tab.id, label: tab.label, icon: tab.icon }))}
          />
        </div>
      )}

      <motion.div key={activeTab} variants={fadeSlide} initial="initial" animate="animate" className="space-y-4">
        {activeTab === 'DISPATCH' && (
          <DispatchTab
            form={dispatchForm}
            gps={dispatchGps}
            routes={routes}
            profiles={profiles}
            vehicles={vehicles}
            effectiveZmccId={effectiveZmccId}
            canAssignAndDispatch={canAssignAndDispatch}
            canCreateRoutes={canCreateRoutes}
            routeNeedsZonalApproval={routeNeedsZonalApproval}
            onRequestRoute={() => setRouteRequestOpen(true)}
            onError={(message) => {
              setError(message);
              if (message === null) setSuccessMessage(null);
            }}
            onDispatched={(message) => {
              setSuccessMessage(message);
              setActiveTab('ACTIVE_JOURNEYS');
            }}
          />
        )}

        {activeTab === 'ACTIVE_JOURNEYS' && (
          <ActiveJourneysTab
            journeys={journeys}
            loading={loading}
            canCancel={canApproveRoutes}
            onRefresh={refreshData}
            onViewMap={showMap}
            onViewStops={(id) => inspectMutation.mutate(id)}
            onCancel={setCancelSheetJourney}
          />
        )}

        {activeTab === 'JOURNEY_HISTORY' && (
          <JourneyHistoryTab
            journeys={journeys}
            loading={loading}
            statusFilter={historyStatusFilter}
            onStatusFilterChange={setHistoryStatusFilter}
            onRefresh={refreshData}
            onViewMap={showMap}
            onViewStops={(id) => inspectMutation.mutate(id)}
          />
        )}

        {activeTab === 'JOURNEY_MAP' && (
          <div className="space-y-4 animate-panel-in">
            <div className="p-3 bg-card rounded-xl border border-border flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="flex items-center space-x-2">
                <label className="text-xs font-semibold text-slate-700 whitespace-nowrap">
                  Select Journey:
                </label>
                <Combobox
                  className="min-h-[44px] min-w-[220px]"
                  value={selectedMapJourneyId || ''}
                  onValueChange={setSelectedMapJourneyId}
                  placeholder="Choose journey"
                  searchPlaceholder="Search journey"
                  options={journeys.map((j) => ({
                    value: j.id,
                    label: `#${j.journey_number} · ${j.route?.route_code ?? ''} · ${j.mot_profile?.name ?? ''}`,
                    keywords: `${j.journey_number} ${j.route?.route_code ?? ''} ${j.mot_profile?.name ?? ''}`,
                  }))}
                />
              </div>
              <button
                type="button"
                onClick={refreshData}
                className="flex min-h-[44px] items-center space-x-1 px-3 rounded-xl border border-border text-xs font-semibold text-slate-700 hover:bg-muted"
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

        {activeTab === 'SMS_OUTBOX' && <SmsOutboxView currentUser={currentUser} />}

        {activeTab === 'PROFILES' && !isStationRole && (
          <ProfilesTab
            profiles={profiles}
            loading={loading}
            onAdd={() => setProfileSheet({ editing: null })}
            onEdit={(profile) => setProfileSheet({ editing: profile })}
            onToggleActive={handleToggleProfileActive}
          />
        )}

        {activeTab === 'VEHICLES' && !isCentralRole && <VehiclesTab vehicles={vehicles} loading={loading} />}

        {activeTab === 'APPROVALS' && (
          <div id="tabpanel-APPROVALS" role="tabpanel" aria-labelledby="tab-APPROVALS" className="space-y-6 animate-panel-in">
            <PendingApprovalsPanel
              currentUser={currentUser}
              showRoutes={canCreateRoutes}
              showShops={true}
              onRefreshParent={loadData}
            />
          </div>
        )}
      </motion.div>

      {selectedJourneyDetail && (
        <JourneyDetailSheet journey={selectedJourneyDetail} onClose={() => setSelectedJourneyDetail(null)} />
      )}

      {cancelSheetJourney && (
        <CancelJourneySheet
          journey={cancelSheetJourney}
          onClose={() => setCancelSheetJourney(null)}
          onDone={(message) => finishSheet(message, () => setCancelSheetJourney(null))}
        />
      )}

      {profileSheet && (
        <ProfileSheet
          editing={profileSheet.editing}
          defaultZmccId={effectiveZmccId}
          isCentralRole={isCentralRole}
          onClose={() => setProfileSheet(null)}
          onDone={(message) => finishSheet(message, () => setProfileSheet(null))}
        />
      )}

      {routeRequestOpen && (
        <RouteRequestSheet
          zmccId={isCentralRole ? selectedZmccId || effectiveZmccId : effectiveZmccId}
          needsZonalApproval={routeNeedsZonalApproval}
          onClose={() => setRouteRequestOpen(false)}
          onDone={(message) => finishSheet(message, () => setRouteRequestOpen(false))}
        />
      )}
    </div>
  );
};
