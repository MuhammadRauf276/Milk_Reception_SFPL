'use client';

import React from 'react';
import { MapPin, Plus, Send, AlertTriangle } from 'lucide-react';
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
  const { origin, originSet } = gps;

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
      onError('Select route, Mobile Tester and vehicle.');
      return;
    }
    // A missing location is only shown as a warning here: the server reads the ZMCC fresh and decides.
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
                <p className="inline-flex items-center font-semibold text-amber-950">
                  All testers are busy
                  <InfoTip
                    label="What to do"
                    className="-my-3"
                    text="A tester can run one journey at a time. Finish or cancel the active journey, or add a new tester."
                  />
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
                      className="inline-flex items-center min-h-11 text-xs font-semibold text-primary hover:underline shrink-0 ml-1"
                    >
                      <Plus className="w-3.5 h-3.5 mr-0.5" />
                      {routeNeedsZonalApproval ? 'Request route' : 'New route'}
                    </button>
                  )}
                </div>
                <Combobox
                  className="min-h-11"
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
                  className="min-h-11"
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
                    All testers are busy.
                  </p>
                )}
              </div>

              <div className="space-y-1.5 min-w-0">
                <label className="block text-xs font-semibold text-foreground break-words min-w-0 mb-1">
                  Collection Vehicle <span className="text-rose-600">*</span>
                </label>
                <Combobox
                  className="min-h-11"
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

            {origin && (
              <p className="flex min-w-0 items-center gap-2 rounded-lg border border-border bg-card p-3 text-xs text-foreground">
                <MapPin className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="min-w-0 break-words">
                  Starts from: <span className="font-semibold">{origin.name || 'ZMCC'}</span>
                  {originSet === false ? <span className="font-semibold text-amber-800"> · location not set</span> : null}
                </span>
                <InfoTip
                  label="About the start point"
                  className="-my-3"
                  text="Every journey starts from its ZMCC and comes back to it. The Super Admin sets the ZMCC location under Procurement Sources."
                />
              </p>
            )}

            <button
              type="submit"
              disabled={!canAssignAndDispatch || actionLoading || !dispatchRouteId || !dispatchProfileId || !dispatchVehicleId}
              className="w-full min-h-14 flex items-center justify-center space-x-2 px-4 rounded-xl bg-primary text-white text-xs font-semibold hover:bg-primary/90 transition shadow-xs disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Send className="w-3.5 h-3.5" />
              <span>{actionLoading ? 'Dispatching…' : 'Assign & dispatch'}</span>
            </button>
          </form>
        </div>
  );
}
