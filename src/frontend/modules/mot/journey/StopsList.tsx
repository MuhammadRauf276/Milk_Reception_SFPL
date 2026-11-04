'use client';

import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { ChevronLeft, ChevronRight, Plus, Store } from 'lucide-react';
import { StopRow } from './StopRow';
import { StopSearch } from './StopSearch';
import { computeHaversineDistanceKm, type CurrentJourney, type StopDetail } from './types';

const STOPS_PER_PAGE = 6;

interface Props {
  journey: CurrentJourney;
  deviceGps: { latitude: number; longitude: number } | null;
  onRecord: (stop: StopDetail) => void;
  onRequestShop: () => void;
  locked?: boolean;
}

/** Planned stops, nearest first when GPS is known (max 6 per screen). */
export function StopsList({ journey, deviceGps, onRecord, onRequestShop, locked = false }: Props) {
  const [stopsPage, setStopsPage] = useState<number>(1);
  const stopsPerPage = STOPS_PER_PAGE;
  const visitedCount = journey.stops.filter((s) => s.status === 'VISITED').length;

  const computedStops = journey.stops.map((s) => {
    const lat = s.planned_latitude_snapshot ?? s.planned_latitude ?? null;
    const lng = s.planned_longitude_snapshot ?? s.planned_longitude ?? null;
    const hasCoordinates = lat != null && lng != null && !(Number(lat) === 0 && Number(lng) === 0);
    const distanceKm =
      deviceGps && hasCoordinates
        ? computeHaversineDistanceKm(deviceGps.latitude, deviceGps.longitude, Number(lat), Number(lng))
        : null;
    return { ...s, hasCoordinates, distanceKm };
  });

  const sortedStops = [...computedStops].sort((a, b) => {
    if (a.distanceKm != null && b.distanceKm != null) {
      return a.distanceKm - b.distanceKm;
    }
    if (a.distanceKm != null && b.distanceKm == null) return -1;
    if (a.distanceKm == null && b.distanceKm != null) return 1;
    if (a.hasCoordinates && !b.hasCoordinates) return -1;
    if (!a.hasCoordinates && b.hasCoordinates) return 1;
    return a.planned_sequence - b.planned_sequence;
  });

  const totalStopsPages = Math.ceil(sortedStops.length / stopsPerPage) || 1;
  const pagedStops = sortedStops.slice((stopsPage - 1) * stopsPerPage, stopsPage * stopsPerPage);

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, delay: 0.05 }}
      className="bg-white rounded-xl border border-border shadow-2xs overflow-hidden"
    >
                    <div className="p-3 sm:p-4 border-b border-border space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-2">
                          <Store className="w-4 h-4 text-primary" />
                          <h3 className="text-xs sm:text-sm font-semibold text-foreground">
                            Planned Stops ({journey.stops.length})
                          </h3>
                        </div>
                        <div className="flex items-center space-x-2">
                          <span className="text-[11px] font-medium text-slate-500">
                            {visitedCount} of {journey.stops.length} completed
                          </span>
                          {!locked && (
                          <button
                            type="button"
                            onClick={onRequestShop}
                            className="inline-flex items-center gap-1 min-h-[44px] px-3 text-xs font-semibold rounded-lg bg-primary text-white hover:bg-primary/90 transition shadow-2xs"
                          >
                            <Plus className="w-3.5 h-3.5" />
                            <span>Request Shop</span>
                          </button>
                          )}
                        </div>
                      </div>


                      <StopSearch stops={journey.stops} onSelectPending={onRecord} />
                    </div>

                    <div className="divide-y divide-border">
                      {pagedStops.map((stop) => (
                        <StopRow key={stop.id} stop={stop} journey={journey} onRecord={onRecord} locked={locked} />
                      ))}

                      {totalStopsPages > 1 && (
                        <div className="flex items-center justify-between p-3.5 bg-subtle border-t border-border">
                          <span className="text-xs text-slate-500 font-medium">
                            Showing {(stopsPage - 1) * stopsPerPage + 1}–{Math.min(stopsPage * stopsPerPage, sortedStops.length)} of {sortedStops.length} shops
                          </span>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              disabled={stopsPage === 1}
                              onClick={() => setStopsPage((p) => Math.max(1, p - 1))}
                              className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg border border-border text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                              <ChevronLeft className="w-4 h-4" />
                            </button>
                            <span className="text-xs font-semibold text-foreground">
                              {stopsPage} / {totalStopsPages}
                            </span>
                            <button
                              type="button"
                              disabled={stopsPage >= totalStopsPages}
                              onClick={() => setStopsPage((p) => Math.min(totalStopsPages, p + 1))}
                              className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg border border-border text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                              <ChevronRight className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </motion.div>
  );
}
