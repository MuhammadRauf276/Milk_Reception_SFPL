'use client';

import { AutoGpsStatusLine } from './AutoGpsStatusLine';
import type { AutoGpsStatus } from './useGpsCapture';
import React from 'react';
import { AlertCircle, Loader2, Truck, User } from 'lucide-react';
import { onActivateKey } from '@/lib/a11y';
import { ZmccDrawer, zmccInputClass, zmccLabelClass } from '../shared/ZmccDrawer';
import { McSuccessCard } from './McSuccessCard';
import type { useMcArrivalForm } from './useMcArrivalForm';
import type { ArrivingJourney, PolicyMode } from './arrivalTypes';

interface Props {
  form: ReturnType<typeof useMcArrivalForm>;
  journeys: ArrivingJourney[];
  loadingJourneys: boolean;
  onRefresh: () => void;
  policyMode: PolicyMode;
  gpsStatus: AutoGpsStatus;
  onRetryGps: () => void;
  isManager?: boolean;
}

export const McArrivalPanel: React.FC<Props> = ({ form, journeys, loadingJourneys, onRefresh, policyMode, gpsStatus,
  onRetryGps, isManager = false }) => {
  const arrivingJourneys = journeys;
  const selectedJourney = form.selectedJourney;
  const rawMilkTokenPolicyMode = policyMode;
  const motGps = form.gps;

  const returningJourneys = arrivingJourneys.filter((j) => j.status === 'RETURNING');
  const fieldJourneys = arrivingJourneys.filter((j) => j.status !== 'RETURNING');

  const renderJourneyCard = (j: ArrivingJourney) => {
    const isSelected = selectedJourney?.id === j.id;
    const isReturning = j.status === 'RETURNING';
    return (
      <div
        role="button"
        tabIndex={0}
        onKeyDown={onActivateKey}
        key={j.id}
        onClick={() => form.selectJourney(j)}
        className={`group p-4 rounded-2xl border transition-all duration-150 cursor-pointer flex flex-col justify-between shadow-2xs hover:shadow-md ${
          isSelected
            ? 'bg-primary/5 border-primary ring-2 ring-primary/20'
            : isReturning
            ? 'bg-amber-50/40 border-amber-300 hover:border-amber-400'
            : 'bg-card border-border hover:border-primary/50'
        }`}
      >
        <div>
          {/* Header row: Journey badge + Status pill + Volume */}
          <div className="flex items-start justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="tabular-nums text-xs font-semibold font-mono px-2 py-0.5 rounded-md bg-muted text-foreground border border-border">
                {j.journey_number}
              </span>
              {isReturning ? (
                <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 border border-amber-300">
                  <Truck className="w-3 h-3 text-amber-700" />
                  RETURNING
                </span>
              ) : (
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 border border-blue-200">
                  COLLECTING
                </span>
              )}
            </div>
            <div className="text-right shrink-0">
              <span className="font-semibold text-sm text-foreground tabular-nums">
                {Number(j.total_gross_liters || 0).toLocaleString()} <span className="text-xs font-semibold text-muted-foreground">L</span>
              </span>
            </div>
          </div>

          {/* Route Info */}
          <div className="mt-2.5">
            <div className="text-sm font-semibold text-foreground line-clamp-1 group-hover:text-primary transition-colors" title={j.route?.name || j.route?.route_code}>
              {j.route?.name || 'Route'}
            </div>
            {j.route?.route_code && (
              <div className="text-xs font-mono text-muted-foreground mt-0.5">
                {j.route.route_code}
              </div>
            )}
          </div>

          {/* Key details: Vehicle & Collector */}
          <div className="mt-3 pt-2.5 border-t border-border text-xs text-secondary-foreground grid grid-cols-[repeat(auto-fit,minmax(min(100%,7rem),1fr))] gap-2">
            <div className="flex items-center gap-1.5 min-w-0" title={`Vehicle: ${j.mot_vehicle?.vehicle_number || '—'}`}>
              <Truck className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              <span className="break-words min-w-0 font-semibold text-foreground">{j.mot_vehicle?.vehicle_number || '—'}</span>
            </div>
            <div className="flex items-center gap-1.5 min-w-0" title={`Collector: ${j.mot_profile?.name || '—'}`}>
              <User className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              <span className="break-words min-w-0 font-medium text-secondary-foreground">{j.mot_profile?.name || '—'}</span>
            </div>
          </div>
        </div>

        {/* Footer: Stops chips */}
        <div className="mt-3 pt-2.5 border-t border-border flex items-center justify-between gap-1 text-xs">
          <div className="flex items-center gap-1 text-xs">
            <span className="px-1.5 py-0.5 rounded bg-muted text-secondary-foreground font-medium" title="Active shops on this journey">
              Active shops: <strong>{j.total_stops}</strong>
            </span>
            <span className="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-800 font-semibold" title="Collected stops">
              Collected: <strong>{j.visited_stops}</strong>
            </span>
            {Number(j.skipped_stops || 0) > 0 && (
              <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 font-semibold" title="Skipped stops">
                Skipped: <strong>{j.skipped_stops}</strong>
              </span>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6 animate-panel-in">
      {form.successResult ? (
        <McSuccessCard
          result={form.successResult}
          journeyNumber={selectedJourney?.journey_number}
          onReset={() => {
            form.setSuccessResult(null);
            form.reset();
          }}
        />
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <h3 className="text-sm font-semibold text-foreground">
                Mobile Tester journeys ({arrivingJourneys.length})
              </h3>
              {returningJourneys.length > 0 && (
                <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 font-semibold text-xs flex items-center gap-1">
                  <Truck className="w-3 h-3 text-amber-700" />
                  {returningJourneys.length} Incoming
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={onRefresh}
              className="flex items-center gap-1.5 min-h-[44px] px-3 text-xs font-semibold text-secondary-foreground hover:text-foreground rounded-lg hover:bg-muted"
            >
              {loadingJourneys && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Refresh
            </button>
          </div>

          {arrivingJourneys.length === 0 ? (
            <div className="bg-card rounded-2xl border border-border p-8 text-center text-xs text-muted-foreground">
              No Mobile Tester journeys.
            </div>
          ) : (
            <div className="space-y-4">
              {returningJourneys.length > 0 && (
                <div className="space-y-2.5">
                  <div className="flex items-center space-x-1.5 text-xs font-semibold text-amber-900">
                    <Truck className="w-3.5 h-3.5 text-amber-700" />
                    <span>Incoming to ZMCC / En Route ({returningJourneys.length})</span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {returningJourneys.map(renderJourneyCard)}
                  </div>
                </div>
              )}

              {fieldJourneys.length > 0 && (
                <div className="space-y-2.5">
                  {returningJourneys.length > 0 && (
                    <div className="text-xs font-semibold text-secondary-foreground pt-2">
                      Collecting in Field ({fieldJourneys.length})
                    </div>
                  )}
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {fieldJourneys.map(renderJourneyCard)}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <ZmccDrawer
        open={form.formOpen && !!selectedJourney && !form.successResult}
        onClose={() => form.setFormOpen(false)}
        title="Record Mobile Tester Arrival at ZMCC"
      >
        {selectedJourney && (
          <form onSubmit={form.submit} className="space-y-4">
            {form.error && (
              <div className="bg-card border-border p-3 border text-rose-800 text-xs rounded-xl flex items-center space-x-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{form.error}</span>
              </div>
            )}

            <div className="bg-card border-border p-3 rounded-xl border text-xs space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <span className="font-semibold text-foreground tabular-nums">
                    Journey #{selectedJourney.journey_number}
                  </span>
                  {selectedJourney.status === 'RETURNING' ? (
                    <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 text-xs font-semibold">
                      RETURNING TO PHE
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-900 text-xs font-semibold">
                      COLLECTING
                    </span>
                  )}
                </div>
                <span className="text-xs font-semibold text-secondary-foreground">
                  {selectedJourney.route?.route_code} · {selectedJourney.route?.name}
                </span>
              </div>

              <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,7rem),1fr))] gap-2 text-xs text-secondary-foreground">
                <div>Vehicle: <strong className="text-foreground">{selectedJourney.mot_vehicle?.vehicle_number}</strong></div>
                <div>Mobile Tester: <strong className="text-foreground">{selectedJourney.mot_profile?.name}</strong></div>
              </div>

              {isManager && (
                <>
                  <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,5rem),1fr))] gap-2 text-center pt-1 border-t border-border">
                    <div className="p-2 bg-card rounded-lg border border-border">
                      <div className="text-xs font-semibold text-muted-foreground">Active shops</div>
                      <div className="text-xs font-semibold text-foreground">{selectedJourney.total_stops}</div>
                    </div>
                    <div className="p-2 bg-card rounded-lg border border-border">
                      <div className="text-xs font-semibold text-emerald-700">Collected</div>
                      <div className="text-xs font-semibold text-emerald-800">{selectedJourney.visited_stops}</div>
                    </div>
                    <div className="p-2 bg-card rounded-lg border border-border">
                      <div className="text-xs font-semibold text-amber-700">Skipped</div>
                      <div className="text-xs font-semibold text-amber-800">{selectedJourney.skipped_stops || 0}</div>
                    </div>
                    <div className="p-2 bg-card rounded-lg border border-border">
                      <div className="text-xs font-semibold text-blue-700">Pending</div>
                      <div className="text-xs font-semibold text-blue-800">
                        {selectedJourney.pending_stops ?? Math.max(0, selectedJourney.total_stops - selectedJourney.visited_stops - (selectedJourney.skipped_stops || 0))}
                      </div>
                    </div>
                  </div>

                  {selectedJourney.stops && selectedJourney.stops.length > 0 && (
                    <div className="space-y-1.5 pt-2 border-t border-border">
                      <div className="text-xs font-semibold text-secondary-foreground">
                        Journey Stops ({selectedJourney.stops.length})
                      </div>
                      <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                        {selectedJourney.stops.map((stop) => (
                          <div
                            key={stop.id}
                            className="p-2 bg-card rounded-lg border border-border flex items-center justify-between text-xs"
                          >
                            <div className="flex items-center space-x-2">
                              <span className="w-5 h-5 rounded-full bg-muted text-secondary-foreground font-semibold flex items-center justify-center text-xs">
                                {stop.planned_sequence}
                              </span>
                              <div>
                                <div className="font-semibold text-foreground">
                                  {stop.shop?.shop_name || 'Shop'}
                                </div>
                                <div className="text-xs text-muted-foreground">
                                  {stop.shop?.shop_code} · {stop.shop?.owner_name}
                                </div>
                              </div>
                            </div>

                            <div>
                              {stop.status === 'VISITED' && stop.collection ? (
                                <span className="font-semibold text-emerald-700">
                                  {stop.collection.gross_liters} L
                                </span>
                              ) : stop.status === 'SKIPPED' ? (
                                <span className="text-amber-700 text-xs font-semibold">
                                  SKIPPED
                                </span>
                              ) : (
                                <span className="text-muted-foreground text-xs">Pending</span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            {rawMilkTokenPolicyMode !== 'DISABLED' && (
              <div>
                <label className={zmccLabelClass}>
                  Raw Milk Intake Token Number {rawMilkTokenPolicyMode === 'REQUIRED' && '*'}
                </label>
                <input
                  type="text"
                  required={rawMilkTokenPolicyMode === 'REQUIRED'}
                  value={form.rawMilkTokenNumber}
                  onChange={(e) => form.setRawMilkTokenNumber(e.target.value)}
                  placeholder="e.g. RMT-20261021-001"
                  className={zmccInputClass}
                />
              </div>
            )}

            <div>
              <label className={zmccLabelClass}>Arrival Timestamp *</label>
              <input
                type="datetime-local"
                required
                value={form.arrivalTimestamp}
                onChange={(e) => form.setArrivalTimestamp(e.target.value)}
                className={zmccInputClass}
              />
            </div>

            <AutoGpsStatusLine label="Gate GPS Location" gps={motGps} status={gpsStatus} onRetry={onRetryGps} />

            <div className="flex justify-end space-x-2 pt-2">
              <button
                type="button"
                onClick={() => form.setFormOpen(false)}
                className="min-h-11 min-w-11 px-4 py-2 text-xs font-semibold rounded-lg border border-border-strong text-secondary-foreground hover:bg-subtle"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={form.submitting}
                className="min-h-11 min-w-11 px-4 py-2 text-xs font-semibold rounded-lg bg-primary text-white hover:bg-primary-hover shadow-2xs transition disabled:opacity-50 flex items-center space-x-1"
              >
                {form.submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>Issue ZMCC Token</span>
              </button>
            </div>
          </form>
        )}
      </ZmccDrawer>
    </div>
  );
};
