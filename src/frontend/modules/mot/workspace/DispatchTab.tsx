'use client';

import React from 'react';
import { MapPin, Plus, Send, CheckCircle2 } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Combobox } from '@/components/ui/combobox';
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
        <div className="max-w-4xl mx-auto bg-card p-5 rounded-xl border border-border shadow-2xs space-y-4 animate-panel-in">
          <div className="flex items-center justify-between border-b border-border pb-3">
            <div>
              <h2 className="text-sm font-semibold text-foreground">Physical Assign & Departure</h2>
            </div>
            <span className="px-2.5 py-1 rounded-full bg-blue-50 text-primary text-[10px] font-semibold uppercase tracking-wider border border-blue-200">
              Immediate Departure
            </span>
          </div>

          {!canAssignAndDispatch && (
            <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm font-semibold text-amber-900">
              Only the MDO or a Zonal Manager can send a tester out. You can watch journeys here.
            </p>
          )}
          <form onSubmit={handleAssignAndDispatch} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
              <div className="space-y-1.5 min-w-0">
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-semibold text-foreground truncate">
                    Assigned Route <span className="text-rose-600">*</span>
                  </label>
                  {canCreateRoutes && (
                    <button
                      type="button"
                      onClick={() => onRequestRoute()}
                      className="inline-flex items-center min-h-[44px] text-xs font-semibold text-primary hover:underline shrink-0 ml-1"
                    >
                      <Plus className="w-3.5 h-3.5 mr-0.5" />
                      {routeNeedsZonalApproval ? 'Send new route to Zonal Manager' : 'Add new route'}
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
                  <p className="text-[11px] text-amber-700 font-semibold mt-1">
                    No approved routes found for this ZMCC.
                    {routeNeedsZonalApproval ? ' Routes waiting for the Zonal Manager are listed under Approvals.' : ''}
                  </p>
                )}
              </div>

              <div className="space-y-1.5 min-w-0">
                <label className="block text-xs font-semibold text-foreground mb-1 truncate">
                  Mobile Tester <span className="text-rose-600">*</span>
                </label>
                <Combobox
                  className="min-h-[44px]"
                  value={dispatchProfileId}
                  onValueChange={(v) => {
                    const prof = profiles.find((p) => p.id === v);
                    if (prof?.has_active_journey) return;
                    setDispatchProfileId(v);
                  }}
                  placeholder="Select mobile tester"
                  searchPlaceholder="Search tester"
                  options={profiles.map((p) => ({
                    value: p.id,
                    label: `${p.name} · ${p.mot_code}${p.has_active_journey ? ' · On journey' : ''}`,
                    keywords: `${p.name} ${p.mot_code}`,
                  }))}
                />
              </div>

              <div className="space-y-1.5 min-w-0">
                <label className="block text-xs font-semibold text-foreground truncate mb-1">
                  Collection Vehicle <span className="text-rose-600">*</span>
                </label>
                <Combobox
                  className="min-h-[44px]"
                  value={dispatchVehicleId}
                  onValueChange={(v) => {
                    const veh = vehicles.find((x) => x.id === v);
                    if (!veh || !veh.is_available) return;
                    setDispatchVehicleId(v);
                  }}
                  placeholder="Select vehicle"
                  searchPlaceholder="Search vehicle"
                  options={vehicles.map((v) => ({
                    value: v.id,
                    label: `${v.vehicle_number}${
                      v.has_active_journey ? ' · On journey' : v.at_zmcc_waiting_unload ? ' · At ZMCC waiting unload' : ''
                    }`,
                    keywords: v.vehicle_number,
                  }))}
                />
                {vehicles.length === 0 ? (
                  <p className="text-[11px] font-semibold text-amber-800">
                    No vehicle is registered for this ZMCC. Ask the Data Executive to add one.
                  </p>
                ) : null}
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
                  className="flex items-center space-x-1 min-h-[44px] px-3 rounded-md bg-white border border-border text-[11px] font-semibold text-slate-700 hover:bg-muted"
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
                      className="inline-flex items-center space-x-1.5 min-h-[44px] px-3 rounded-md bg-white border border-rose-300 text-rose-900 text-[11px] font-semibold hover:bg-rose-100 shadow-2xs transition"
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
              disabled={!canAssignAndDispatch || actionLoading || !gpsLocation || !dispatchRouteId || !dispatchProfileId || !dispatchVehicleId}
              className="w-full min-h-[56px] flex items-center justify-center space-x-2 px-4 rounded-xl bg-primary text-white text-xs font-semibold hover:bg-primary/90 transition shadow-xs disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Send className="w-3.5 h-3.5" />
              <span>{actionLoading ? 'Assigning & Dispatching…' : 'Assign & Dispatch (Begin Journey)'}</span>
            </button>
          </form>
        </div>
  );
}
