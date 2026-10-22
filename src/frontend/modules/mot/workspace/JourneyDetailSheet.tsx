'use client';

import React, { useState } from 'react';
import { Clock } from 'lucide-react';
import { MotSheet } from '../MotSheet';
import type { JourneyItem } from './types';

const STOPS_PER_PAGE = 6;

export function JourneyDetailSheet({ journey, onClose }: { journey: JourneyItem; onClose: () => void }) {
  const [stopsPage, setStopsPage] = useState(1);
  const stopsPerPage = STOPS_PER_PAGE;

  return (
    <MotSheet
      title={`Journey #${journey.journey_number}: Planned Stops`}
      subtitle={`${journey.route?.route_code} | Mobile Tester: ${journey.mot_profile?.name} | Vehicle: ${journey.mot_vehicle?.vehicle_number}`}
      onClose={onClose}
    >
            {(() => {
              const stops = journey.stops || [];
              const assignedCount = journey.summary
                ? journey.summary.assigned_shop_count
                : stops.length;
              const collectedCount = journey.summary
                ? journey.summary.collected_shop_count
                : stops.filter((s) => s.status === 'VISITED').length;
              const skippedCount = journey.summary
                ? journey.summary.skipped_shop_count
                : stops.filter((s) => s.status === 'SKIPPED').length;
              const pendingCount = journey.summary
                ? journey.summary.pending_shop_count
                : Math.max(0, assignedCount - collectedCount - skippedCount);

              return (
                <div className="p-4 rounded-xl bg-slate-50 border border-border space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wider text-slate-700">
                      Journey Summary
                    </span>
                    {journey.summary && (
                      <span className="text-[11px] font-semibold text-slate-500">
                        Ended: {new Date(journey.summary.journey_ended_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} PKT
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

                  {journey.summary && (
                    <div className="grid grid-cols-2 sm:grid-cols-6 gap-2 text-center">
                      <div className="p-2 bg-white rounded-lg border border-border">
                        <div className="text-[10px] uppercase font-semibold text-slate-500">Gross Liters</div>
                        <div className="text-xs tabular-nums font-semibold text-slate-900">
                          {journey.summary.total_gross_liters.toFixed(2)} L
                        </div>
                      </div>
                      <div className="p-2 bg-white rounded-lg border border-border">
                        <div className="text-[10px] uppercase font-semibold text-slate-500">@13TS Liters</div>
                        <div className="text-xs tabular-nums font-semibold text-slate-900">
                          {journey.summary.total_at_13ts_liters.toFixed(2)} L
                        </div>
                      </div>
                      <div className="p-2 bg-white rounded-lg border border-border">
                        <div className="text-[10px] uppercase font-semibold text-slate-500">Weighted LR</div>
                        <div className="text-xs tabular-nums font-semibold text-slate-800">
                          {journey.summary.weighted_avg_lr != null ? journey.summary.weighted_avg_lr.toFixed(2) : '—'}
                        </div>
                      </div>
                      <div className="p-2 bg-white rounded-lg border border-border">
                        <div className="text-[10px] uppercase font-semibold text-slate-500">Weighted Fat</div>
                        <div className="text-xs tabular-nums font-semibold text-slate-800">
                          {journey.summary.weighted_avg_fat != null ? `${journey.summary.weighted_avg_fat.toFixed(2)}%` : '—'}
                        </div>
                      </div>
                      <div className="p-2 bg-white rounded-lg border border-border">
                        <div className="text-[10px] uppercase font-semibold text-slate-500">Weighted SNF</div>
                        <div className="text-xs tabular-nums font-semibold text-slate-800">
                          {journey.summary.weighted_avg_snf != null ? `${journey.summary.weighted_avg_snf.toFixed(2)}%` : '—'}
                        </div>
                      </div>
                      <div className="p-2 bg-white rounded-lg border border-border">
                        <div className="text-[10px] uppercase font-semibold text-slate-500">Weighted TS</div>
                        <div className="text-xs tabular-nums font-semibold text-slate-800">
                          {journey.summary.weighted_avg_ts != null ? `${journey.summary.weighted_avg_ts.toFixed(2)}%` : '—'}
                        </div>
                      </div>
                    </div>
                  )}

                  {journey.summary && journey.summary.pending_shop_count > 0 && (
                    <div className="flex items-center space-x-2 text-[11px] font-semibold text-blue-800 bg-blue-50 p-2.5 rounded-lg border border-blue-200">
                      <Clock className="w-4 h-4 shrink-0 text-blue-600" />
                      <span>
                        Waiting for delayed collection sync: {journey.summary.pending_shop_count} assigned shop record(s) are still unresolved.
                      </span>
                    </div>
                  )}
                </div>
              );
            })()}

            {(() => {
              const allStops = journey.stops || [];
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
                          className="min-h-[44px] px-3 text-xs font-semibold rounded-lg border border-border bg-white text-slate-700 hover:bg-muted disabled:opacity-40"
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
                          className="min-h-[44px] px-3 text-xs font-semibold rounded-lg border border-border bg-white text-slate-700 hover:bg-muted disabled:opacity-40"
                        >
                          Next
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}
    </MotSheet>
  );
}
