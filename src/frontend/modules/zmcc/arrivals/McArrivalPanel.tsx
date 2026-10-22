'use client';

import React from 'react';
import { AlertCircle, Loader2, MapPin, Truck } from 'lucide-react';
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
  onCaptureGps: () => void;
}

export const McArrivalPanel: React.FC<Props> = ({ form, journeys, loadingJourneys, onRefresh, policyMode, onCaptureGps }) => {
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
        className={`p-4 rounded-xl border transition-all cursor-pointer ${
          isSelected
            ? 'bg-blue-50/60 border-primary shadow-2xs'
            : isReturning
            ? 'bg-amber-50/40 border-amber-300 hover:border-amber-400'
            : 'bg-white border-border hover:border-slate-300'
        }`}
      >
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center space-x-2">
            <span className="tabular-nums text-xs font-semibold text-primary">
              {j.journey_number}
            </span>
            {isReturning ? (
              <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 border border-amber-200">
                <Truck className="w-3 h-3 text-amber-700 animate-pulse" />
                RETURNING TO PHE
              </span>
            ) : (
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-blue-100 text-blue-800">
                COLLECTING
              </span>
            )}
          </div>
          <span className="font-semibold text-xs text-slate-800 tabular-nums">
            {j.total_gross_liters} L
          </span>
        </div>
        <div className="text-xs font-semibold text-slate-800">
          {j.route?.route_code} · {j.route?.name}
        </div>
        <div className="text-xs text-slate-600 mt-1 flex flex-wrap gap-x-4">
          <span>Vehicle: <strong>{j.mot_vehicle?.vehicle_number}</strong></span>
          <span>MOT: <strong>{j.mot_profile?.name}</strong></span>
        </div>
        <div className="text-xs text-slate-500 mt-2 flex flex-wrap items-center justify-between gap-1 border-t border-slate-100 pt-2">
          <div className="flex items-center space-x-2 text-[11px]">
            <span>Assigned: <strong>{j.total_stops}</strong></span>
            <span>·</span>
            <span className="text-emerald-700">Collected: <strong>{j.visited_stops}</strong></span>
            <span>·</span>
            <span className="text-amber-700">Skipped: <strong>{j.skipped_stops || 0}</strong></span>
          </div>
          <span className="text-[11px] text-slate-500">
            @13TS: <strong className="text-slate-800">{j.total_at_13ts_liters} L</strong>
          </span>
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
              <h3 className="text-sm font-semibold text-slate-900">
                Active MC Journeys ({arrivingJourneys.length})
              </h3>
              {returningJourneys.length > 0 && (
                <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 font-bold text-xs flex items-center gap-1">
                  <Truck className="w-3 h-3 text-amber-700" />
                  {returningJourneys.length} Incoming
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={onRefresh}
              className="flex items-center gap-1.5 min-h-[44px] px-3 text-xs font-semibold text-slate-600 hover:text-slate-900 rounded-lg hover:bg-slate-100"
            >
              {loadingJourneys && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Refresh
            </button>
          </div>

          {arrivingJourneys.length === 0 ? (
            <div className="bg-white rounded-xl border border-border p-8 text-center text-xs text-slate-500">
              No MC journeys currently active or returning for this ZMCC.
            </div>
          ) : (
            <div className="space-y-4">
              {returningJourneys.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center space-x-1.5 text-xs font-semibold text-amber-900">
                    <Truck className="w-3.5 h-3.5 text-amber-700" />
                    <span>Incoming to ZMCC / En Route ({returningJourneys.length})</span>
                  </div>
                  <div className="space-y-3">
                    {returningJourneys.map(renderJourneyCard)}
                  </div>
                </div>
              )}

              {fieldJourneys.length > 0 && (
                <div className="space-y-2">
                  {returningJourneys.length > 0 && (
                    <div className="text-xs font-semibold text-slate-600 pt-2">
                      Collecting in Field ({fieldJourneys.length})
                    </div>
                  )}
                  <div className="space-y-3">
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
        title="Record MC Arrival at ZMCC"
      >
        {selectedJourney && (
          <form onSubmit={form.submit} className="space-y-4">
            {form.error && (
              <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 text-xs rounded-xl flex items-center space-x-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{form.error}</span>
              </div>
            )}

            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <span className="font-semibold text-slate-800 tabular-nums">
                    Journey #{selectedJourney.journey_number}
                  </span>
                  {selectedJourney.status === 'RETURNING' ? (
                    <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 text-[10px] font-bold">
                      RETURNING TO PHE
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-900 text-[10px] font-bold">
                      COLLECTING
                    </span>
                  )}
                </div>
                <span className="text-[11px] font-semibold text-slate-600">
                  {selectedJourney.route?.route_code} · {selectedJourney.route?.name}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-600">
                <div>Vehicle: <strong className="text-slate-900">{selectedJourney.mot_vehicle?.vehicle_number}</strong></div>
                <div>MOT: <strong className="text-slate-900">{selectedJourney.mot_profile?.name}</strong></div>
              </div>

              <div className="grid grid-cols-4 gap-2 text-center pt-1 border-t border-slate-200">
                <div className="p-2 bg-white rounded-lg border border-border">
                  <div className="text-[10px] uppercase font-semibold text-slate-500">Assigned</div>
                  <div className="text-xs font-semibold text-slate-900">{selectedJourney.total_stops}</div>
                </div>
                <div className="p-2 bg-white rounded-lg border border-border">
                  <div className="text-[10px] uppercase font-semibold text-emerald-700">Collected</div>
                  <div className="text-xs font-semibold text-emerald-800">{selectedJourney.visited_stops}</div>
                </div>
                <div className="p-2 bg-white rounded-lg border border-border">
                  <div className="text-[10px] uppercase font-semibold text-amber-700">Skipped</div>
                  <div className="text-xs font-semibold text-amber-800">{selectedJourney.skipped_stops || 0}</div>
                </div>
                <div className="p-2 bg-white rounded-lg border border-border">
                  <div className="text-[10px] uppercase font-semibold text-blue-700">Pending</div>
                  <div className="text-xs font-semibold text-blue-800">
                    {selectedJourney.pending_stops ?? Math.max(0, selectedJourney.total_stops - selectedJourney.visited_stops - (selectedJourney.skipped_stops || 0))}
                  </div>
                </div>
              </div>

              {selectedJourney.stops && selectedJourney.stops.length > 0 && (
                <div className="space-y-1.5 pt-2 border-t border-slate-200">
                  <div className="text-[11px] font-semibold text-slate-700">
                    Journey Stops ({selectedJourney.stops.length})
                  </div>
                  <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                    {selectedJourney.stops.map((stop) => (
                      <div
                        key={stop.id}
                        className="p-2 bg-white rounded-lg border border-slate-200 flex items-center justify-between text-[11px]"
                      >
                        <div className="flex items-center space-x-2">
                          <span className="w-5 h-5 rounded-full bg-slate-100 text-slate-700 font-semibold flex items-center justify-center text-[10px]">
                            {stop.planned_sequence}
                          </span>
                          <div>
                            <div className="font-semibold text-slate-800">
                              {stop.shop?.shop_name || 'Shop'}
                            </div>
                            <div className="text-[10px] text-slate-500">
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
                            <span className="text-amber-700 text-[10px] font-semibold">
                              SKIPPED
                            </span>
                          ) : (
                            <span className="text-slate-400 text-[10px]">Pending</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
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

            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-slate-600 flex items-center gap-1">
                  <MapPin className="w-3.5 h-3.5" />
                  Gate GPS Location
                </span>
                {motGps.lat && motGps.lng ? (
                  <span className="text-emerald-700 font-semibold tabular-nums text-[11px]">
                    {motGps.lat.toFixed(5)}, {motGps.lng.toFixed(5)}
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={onCaptureGps}
                    className="text-primary hover:underline text-xs font-semibold"
                  >
                    Capture GPS
                  </button>
                )}
              </div>
            </div>

            <div className="flex justify-end space-x-2 pt-2">
              <button
                type="button"
                onClick={() => form.setFormOpen(false)}
                className="px-4 py-2 text-xs font-semibold rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={form.submitting}
                className="px-4 py-2 text-xs font-semibold rounded-lg bg-primary text-white hover:bg-primary-hover shadow-2xs transition disabled:opacity-50 flex items-center space-x-1"
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
