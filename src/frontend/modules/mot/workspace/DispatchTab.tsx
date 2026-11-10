'use client';

import React from 'react';
import { MapPin, Plus, Send, CheckCircle2, AlertTriangle } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Combobox } from '@/components/ui/combobox';
import { InfoTip } from '@/components/ui/info-tip';
import { DecisionStatusBadge } from '@/frontend/modules/shared/decision/DecisionStatusBadge';
import { getErrorMessage } from '@/lib/errors';
import { sendJson } from './mutationUtils';
import type { DispatchForm, DispatchGps } from './useDispatch';
import { MOT_TAB_DATA_KEY, type MotProfileItem, type MotVehicleItem, type RouteOption } from './types';

interface Props {
  form: DispatchForm;
  gps: DispatchGps;
  routes: RouteOption[];
  profiles: MotProfileItem[];
  vehicles: MotVehicleItem[];
  effectiveZmccId: string | null;
  canAssignAndDispatch: boolean;
  canCreateRoutes: boolean;
  routeNeedsZonalApproval: boolean;
  onRequestRoute: () => void;
  onError: (message: string | null) => void;
  onDispatched: (message: string) => void;
}

export function DispatchTab({
  form,
  gps,
  routes,
  profiles,
  vehicles,
  effectiveZmccId,
  canAssignAndDispatch,
  canCreateRoutes,
  routeNeedsZonalApproval,
  onRequestRoute,
  onError,
  onDispatched,
}: Props) {
  const queryClient = useQueryClient();
  const {
    routeId: dispatchRouteId, setRouteId: setDispatchRouteId,
    profileId: dispatchProfileId, setProfileId: setDispatchProfileId,
    vehicleId: dispatchVehicleId, setVehicleId: setDispatchVehicleId,
  } = form;
  const { gpsLocation, displayedGpsStatus, displayedGpsErrorMsg, acquireGps, requestGpsPosition } = gps;

  const dispatchMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      sendJson<{ journey: { journey_number: string; stops?: unknown[] } }>(
        '/api/zmcc/mot/journeys/assign-and-dispatch',
        'POST',
        payload,
        'Failed to assign and dispatch journey.'
      ),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: MOT_TAB_DATA_KEY });
      form.reset();
      onDispatched(
        `Journey #${data.journey.journey_number} dispatched successfully! ${data.journey.stops?.length || 0} planned shops snapshot captured.`
      );
    },
    onError: (err) => onError(getErrorMessage(err)),
  });
  const actionLoading = dispatchMutation.isPending;

  const handleAssignAndDispatch = (e: React.FormEvent) => {
    e.preventDefault();
    const selectedVehicleValue = dispatchVehicleId;

    if (!dispatchRouteId || !dispatchProfileId || !selectedVehicleValue) {
      onError('Please select Route, Mobile Tester, and Vehicle.');
      return;
    }
    if (!gpsLocation) {
      onError('GPS coordinates are required. Please acquire your GPS position before dispatching.');
      return;
    }
    onError(null);

    const idempotencyKey =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `DISP-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

    dispatchMutation.mutate({
      zmcc_id: effectiveZmccId || undefined,
      route_id: dispatchRouteId,
      mot_profile_id: dispatchProfileId,
      mot_vehicle_id: selectedVehicleValue,
      latitude: gpsLocation.latitude,
      longitude: gpsLocation.longitude,
      accuracy: gpsLocation.accuracy,
      idempotency_key: idempotencyKey,
    });
  };

  return (
        <div className="max-w-4xl mx-auto bg-card p-5 rounded-2xl border border-border shadow-2xs space-y-4 animate-panel-in">
          <div className="flex items-center justify-between border-b border-border pb-3">
            <div>
              <h2 className="text-sm font-semibold text-foreground">Assign & dispatch</h2>
            </div>
            <span className="px-3 py-1 rounded-md bg-blue-50 text-primary text-xs font-semibold border border-blue-200">
              Now
            </span>
          </div>

          {!canAssignAndDispatch && (
            <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm font-semibold text-amber-900">
              Dispatch is done by MDO or Zonal Manager.
            </p>
          )}

          {profiles.length > 0 && profiles.every((p) => p.has_active_journey) && (
            <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-xs text-amber-900 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="font-semibold text-amber-950">All registered Mobile Testers are currently on active journeys</p>
                <p className="text-amber-800">
                  A tester can run one journey at a time. Finish or cancel the active journey, or add a new tester.
                </p>
              </div>
            </div>
          )}

          <form onSubmit={handleAssignAndDispatch} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <div className="space-y-1.5 min-w-0">
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-semibold text-foreground break-words min-w-0">
                    Route <span className="text-rose-600">*</span>
                  </label>
                  {canCreateRoutes && (
                    <button
                      type="button"
                      onClick={() => onRequestRoute()}
                      className="inline-flex items-center min-h-[44px] text-xs font-semibold text-primary hover:underline shrink-0 ml-1"
                    >
                      <Plus className="w-3.5 h-3.5 mr-0.5" />
                      {routeNeedsZonalApproval ? 'Request route' : 'New route'}
                    </button>
                  )}
                </div>
                <Combobox
                  className="min-h-[44px]"
                  value={dispatchRouteId}
                  onValueChange={setDispatchRouteId}
                  placeholder="Select collection route"
                  searchPlaceholder="Search route"
                  options={routes.map((r) => ({ value: r.id, label: `${r.route_code} · ${r.name}`, keywords: `${r.route_code} ${r.name}` }))}
                />
                {dispatchRouteId && (
                  <div className="mt-1">
                    <DecisionStatusBadge status="APPROVED" label="Route approved" />
                  </div>
                )}
                {routes.length === 0 && (
                  <p className="text-xs text-amber-700 font-semibold mt-1">
                    No approved routes.
                  </p>
                )}
              </div>

              <div className="space-y-1.5 min-w-0">
                <label className="block text-xs font-semibold text-foreground mb-1 break-words min-w-0">
                  Mobile Tester <span className="text-rose-600">*</span>
                </label>
                <Combobox
                  className="min-h-[44px]"
                  value={dispatchProfileId}
                  onValueChange={(v) => {
                    const prof = profiles.find((p) => p.id === v);
                    if (prof?.has_active_journey) {
                      onError(
                        `Mobile Tester '${prof.name}' (${prof.mot_code}) is already on active journey #${
                          prof.active_journey?.journey_number || 'in progress'
                        }. Complete or cancel that journey first.`
                      );
                      return;
                    }
                    onError(null);
                    setDispatchProfileId(v);
                  }}
                  placeholder="Select mobile tester"
                  searchPlaceholder="Search tester"
                  options={profiles.map((p) => ({
                    value: p.id,
                    label: `${p.name} · ${p.mot_code}`,
                    keywords: `${p.name} ${p.mot_code}`,
                    disabled: Boolean(p.has_active_journey),
                    disabledReason: p.has_active_journey
                      ? `Busy on journey #${p.active_journey?.journey_number || 'in progress'}`
                      : undefined,
                  }))}
                />
                {profiles.length > 0 && profiles.every((p) => p.has_active_journey) && (
                  <p className="text-xs font-semibold text-amber-800 mt-1">
                    All testers are currently busy on active journeys.
                  </p>
                )}
              </div>

              <div className="space-y-1.5 min-w-0">
                <label className="block text-xs font-semibold text-foreground break-words min-w-0 mb-1">
                  Collection Vehicle <span className="text-rose-600">*</span>
                </label>
                <Combobox
                  className="min-h-[44px]"
                  value={dispatchVehicleId}
                  onValueChange={(v) => {
                    const veh = vehicles.find((x) => x.id === v);
                    if (!veh || !veh.is_available) {
                      onError(
                        `Vehicle '${veh?.vehicle_number || v}' is currently unavailable (${
                          veh?.has_active_journey ? 'On active journey' : 'At ZMCC waiting unload'
                        }).`
                      );
                      return;
                    }
                    onError(null);
                    setDispatchVehicleId(v);
                  }}
                  placeholder="Select vehicle"
                  searchPlaceholder="Search vehicle"
                  options={vehicles.map((v) => ({
                    value: v.id,
                    label: v.vehicle_number,
                    keywords: v.vehicle_number,
                    disabled: !v.is_available,
                    disabledReason: v.has_active_journey
                      ? 'On active journey'
                      : v.at_zmcc_waiting_unload
                      ? 'At ZMCC waiting unload'
                      : !v.is_available
                      ? 'Unavailable'
                      : undefined,
                  }))}
                />
                {vehicles.length === 0 ? (
                  <p className="text-xs font-semibold text-amber-800">
                    No vehicle registered.
                  </p>
                ) : null}
              </div>
            </div>

            <div className="bg-card border-border p-3 rounded-lg border space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <MapPin className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="text-xs font-semibold text-foreground">
                    Location
                  </span>
                </div>
                <button
                  type="button"
                  onClick={acquireGps}
                  disabled={displayedGpsStatus === 'ACQUIRING'}
                  className="flex items-center space-x-1 min-h-[44px] px-3 rounded-md bg-action-soft border border-action/30 text-xs font-semibold text-action hover:bg-action-soft"
                >
                  <span>{displayedGpsStatus === 'ACQUIRING' ? 'Acquiring…' : 'Refresh GPS'}</span>
                </button>
              </div>

              {displayedGpsStatus === 'SUCCESS' && gpsLocation && (
                <div className="flex items-center space-x-2 text-xs tabular-nums text-emerald-800 bg-emerald-50/80 p-2 rounded-md border border-emerald-200">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  <div className="min-w-0 flex-1 break-words min-w-0">
                    <span className="font-medium">
                      Lat: {gpsLocation.latitude.toFixed(6)}, Lng: {gpsLocation.longitude.toFixed(6)}
                    </span>
                    {gpsLocation.accuracy != null && (
                      <span className="text-xs text-emerald-700 ml-2">
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
                    <span className="font-medium break-words min-w-0">
                      Lat: {gpsLocation.latitude.toFixed(6)}, Lng: {gpsLocation.longitude.toFixed(6)}
                    </span>
                    <span className="text-xs font-semibold px-2 py-0.5 rounded bg-amber-200/80 text-amber-800">
                      {gpsLocation.source === 'FACILITY_DEFAULT' ? 'Center Coords' : 'Offline Cache'}
                    </span>
                  </div>
                  {displayedGpsErrorMsg && (
                    <p className="text-xs text-amber-700 leading-tight break-words min-w-0">{displayedGpsErrorMsg}</p>
                  )}
                </div>
              )}

              {displayedGpsStatus === 'ERROR' && (
                <div className="space-y-1.5 text-xs text-rose-800 bg-rose-50 p-3 rounded-md border border-rose-200">
                  <p className="flex items-center leading-snug">
                    {displayedGpsErrorMsg || 'No GPS.'}
                    <InfoTip text="Allow location for this site in your browser settings, then tap retry." />
                  </p>
                  <div>
                    <button
                      type="button"
                      onClick={() => requestGpsPosition(true)}
                      className="inline-flex items-center space-x-1.5 min-h-[44px] px-3 rounded-md bg-card border border-rose-300 text-rose-900 text-xs font-semibold hover:bg-rose-100 shadow-2xs transition"
                    >
                      <MapPin className="w-3 h-3 text-rose-600" />
                      <span>Use ZMCC location</span>
                    </button>
                  </div>
                </div>
              )}

              {displayedGpsStatus === 'IDLE' && (
                <p className="text-xs text-muted-foreground">Getting GPS…</p>
              )}
            </div>

            <button
              type="submit"
              disabled={!canAssignAndDispatch || actionLoading || !gpsLocation || !dispatchRouteId || !dispatchProfileId || !dispatchVehicleId}
              className="w-full min-h-[56px] flex items-center justify-center space-x-2 px-4 rounded-xl bg-primary text-white text-xs font-semibold hover:bg-primary/90 transition shadow-xs disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Send className="w-3.5 h-3.5" />
              <span>{actionLoading ? 'Dispatching…' : 'Assign & dispatch'}</span>
            </button>
          </form>
        </div>
  );
}
