'use client';

import React, { useState } from 'react';
import { AlertCircle, Clock, Loader2, Truck } from 'lucide-react';
import type { InsideVehicle } from '@/backend/services/zmccArrival/zmccArrivalCore';

interface Props {
  insideVehicles: InsideVehicle[];
  insideHasMore: boolean;
  insideTotalCount: number;
  loadingInside: boolean;
  onRefresh: () => void;
}

export const InsideVehiclesPanel: React.FC<Props> = ({
  insideVehicles,
  insideHasMore,
  insideTotalCount,
  loadingInside,
  onRefresh,
}) => {
  const [insidePage, setInsidePage] = useState(1);
  const fetchInsideVehicles = onRefresh;
  return (
    <div className="space-y-4 animate-panel-in">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-foreground">
                Inside ({insideTotalCount > insideVehicles.length ? `${insideVehicles.length} of ${insideTotalCount}` : insideVehicles.length})
              </h3>
            </div>
            <button
              type="button"
              onClick={fetchInsideVehicles}
              className="flex items-center space-x-1.5 min-h-[44px] px-4 bg-action-soft border border-action/30 rounded-xl text-xs font-semibold text-action hover:bg-action-soft transition-[color,background-color,border-color,box-shadow,opacity,transform] cursor-pointer"
            >
              {loadingInside && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              <span>Refresh</span>
            </button>
          </div>

          {insideHasMore && (
            <div className="bg-card border-border p-3 border rounded-xl flex items-center space-x-2 text-amber-800 text-xs">
              <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
              <span>
                <strong>Warning:</strong> Display capped at {insideVehicles.length} of {insideTotalCount} active vehicles inside ZMCC.
              </span>
            </div>
          )}

          {insideVehicles.length === 0 ? (
            <div className="bg-card rounded-xl border border-border p-12 text-center text-xs text-muted-foreground">
              <Truck className="w-8 h-8 text-neutral-300 mx-auto mb-2" />
              <span>No vehicles inside.</span>
            </div>
          ) : (
            (() => {
              const INSIDE_PAGE_SIZE = 6;
              const totalInsidePages = Math.ceil(insideVehicles.length / INSIDE_PAGE_SIZE) || 1;
              const currentInsideVehicles = insideVehicles.slice((insidePage - 1) * INSIDE_PAGE_SIZE, insidePage * INSIDE_PAGE_SIZE);

              return (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {currentInsideVehicles.map((v) => (
                      <div
                        key={`${v.arrival_type}-${v.id}`}
                        className="bg-card rounded-2xl border border-border p-4 shadow-2xs flex flex-col justify-between space-y-3 hover:border-border-strong transition-[color,background-color,border-color,box-shadow,opacity,transform]"
                      >
                        <div className="space-y-3">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center shrink-0">
                                <Truck className="h-4 w-4 text-secondary-foreground" />
                              </div>
                              <div>
                                <div className="text-sm font-semibold text-foreground tabular-nums leading-tight">
                                  {v.vehicle_number}
                                </div>
                                <span
                                  className={`inline-block mt-0.5 px-2 py-0.2 rounded text-xs font-semibold tracking-wider ${
                                    v.arrival_type === 'MOT'
                                      ? 'bg-blue-100 text-blue-800'
                                      : 'bg-emerald-100 text-emerald-800'
                                  }`}
                                >
                                  {v.arrival_type === 'MOT' ? 'Mobile Tester Vehicle' : 'HC Supplier'}
                                </span>
                              </div>
                            </div>
                          </div>

                          <div className="space-y-1.5">
                            <div className="text-sm font-semibold text-foreground line-clamp-1" title={v.source_name}>
                              {v.source_name}
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                              {v.zmcc_token && (
                                <span className="font-mono text-xs font-medium px-2 py-0.5 rounded bg-muted text-secondary-foreground border border-border">
                                  Token: {v.zmcc_token}
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-muted-foreground flex items-center gap-1 pt-0.5 min-w-0">
                              <Clock className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                              <span className="break-words min-w-0">Entered: {new Date(v.arrival_timestamp).toLocaleString('en-GB', { timeZone: 'Asia/Karachi' })} PKT</span>
                            </div>
                          </div>

                          <div className="pt-3 border-t border-border flex flex-wrap gap-2 items-center">
                            <span
                              className={`px-2 py-0.5 rounded text-xs font-semibold ${
                                v.lab_status === 'COMPLETED'
                                  ? 'bg-muted text-foreground'
                                  : 'bg-amber-100 text-amber-800'
                              }`}
                            >
                              Lab: {v.lab_status}
                            </span>
                            {v.lab_decision && (
                              <span
                                className={`px-2 py-0.5 rounded text-xs font-semibold ${
                                  v.lab_decision === 'ACCEPTED'
                                    ? 'bg-emerald-100 text-emerald-800'
                                    : 'bg-rose-100 text-rose-800'
                                }`}
                              >
                                {v.lab_decision}
                              </span>
                            )}
                            {v.has_tank_receipt && (
                              <span className="px-2 py-0.5 rounded text-xs font-semibold bg-blue-100 text-blue-800">
                                Tank Received
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="bg-subtle p-2 rounded-xl border border-border text-center">
                          <span className="text-xs font-medium text-muted-foreground">Old record. Gate exit is no longer used.</span>
                        </div>
                      </div>
                    ))}
                  </div>

                  {totalInsidePages > 1 && (
                    <div className="flex items-center justify-between pt-3 border-t border-border">
                      <span className="text-xs text-muted-foreground">
                        Page {insidePage} of {totalInsidePages}
                      </span>
                      <div className="flex items-center space-x-2">
                        <button
                          type="button"
                          disabled={insidePage <= 1}
                          onClick={() => setInsidePage((p) => Math.max(1, p - 1))}
                          className="min-h-[44px] px-4 rounded-xl border border-border text-xs font-semibold text-secondary-foreground disabled:opacity-40 hover:bg-subtle cursor-pointer"
                        >
                          Previous
                        </button>
                        <button
                          type="button"
                          disabled={insidePage >= totalInsidePages}
                          onClick={() => setInsidePage((p) => Math.min(totalInsidePages, p + 1))}
                          className="min-h-[44px] px-4 rounded-xl border border-border text-xs font-semibold text-secondary-foreground disabled:opacity-40 hover:bg-subtle cursor-pointer"
                        >
                          Next
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })()
          )}
    </div>
  );
};
