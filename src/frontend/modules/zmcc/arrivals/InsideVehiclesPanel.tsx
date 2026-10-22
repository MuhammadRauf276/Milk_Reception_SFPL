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
              <h3 className="text-sm font-semibold text-slate-900">
                Vehicles Currently Inside ZMCC ({insideTotalCount > insideVehicles.length ? `${insideVehicles.length} of ${insideTotalCount}` : insideVehicles.length})
              </h3>
            </div>
            <button
              type="button"
              onClick={fetchInsideVehicles}
              className="flex items-center space-x-1.5 min-h-[44px] px-4 bg-white border border-border rounded-xl text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-all cursor-pointer"
            >
              {loadingInside && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              <span>Refresh</span>
            </button>
          </div>

          {insideHasMore && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl flex items-center space-x-2 text-amber-800 text-xs">
              <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
              <span>
                <strong>Warning:</strong> Display capped at {insideVehicles.length} of {insideTotalCount} active vehicles inside ZMCC.
              </span>
            </div>
          )}

          {insideVehicles.length === 0 ? (
            <div className="bg-white rounded-xl border border-border p-12 text-center text-xs text-slate-400">
              <Truck className="w-8 h-8 text-slate-300 mx-auto mb-2" />
              <span>No vehicles currently inside ZMCC. All gate-tracked vehicles have exited.</span>
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
                        className="bg-white rounded-xl border border-border p-5 shadow-2xs flex flex-col justify-between space-y-4 hover:border-slate-300 transition-all"
                      >
                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold uppercase tracking-wider ${
                              v.arrival_type === 'MOT'
                                ? 'bg-blue-100 text-blue-800'
                                : 'bg-emerald-100 text-emerald-800'
                            }`}>
                              {v.arrival_type === 'MOT' ? 'MC Vehicle' : 'HC Supplier'}
                            </span>
                            <span className="tabular-nums text-xs font-semibold text-slate-900">
                              {v.vehicle_number}
                            </span>
                          </div>

                          <div className="text-xs space-y-1">
                            <div className="font-semibold text-slate-800">
                              {v.source_name}
                            </div>
                            <div className="flex items-center space-x-2 text-xs text-slate-500 tabular-nums">
                              <span>Token: <strong>{v.zmcc_token}</strong></span>
                            </div>
                            <div className="text-xs text-slate-500 flex items-center space-x-1">
                              <Clock className="w-3 h-3 text-slate-400" />
                              <span>Entered: {new Date(v.arrival_timestamp).toLocaleString('en-GB', { timeZone: 'Asia/Karachi' })} PKT</span>
                            </div>
                          </div>

                          <div className="pt-2 border-t border-slate-100 flex flex-wrap gap-1.5 items-center">
                            <span className={`px-2 py-0.5 rounded-md text-xs font-semibold ${
                              v.lab_status === 'COMPLETED'
                                ? 'bg-slate-100 text-slate-800'
                                : 'bg-amber-100 text-amber-800'
                            }`}>
                              Lab: {v.lab_status}
                            </span>
                            {v.lab_decision && (
                              <span className={`px-2 py-0.5 rounded-md text-xs font-semibold ${
                                v.lab_decision === 'ACCEPTED'
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : 'bg-rose-100 text-rose-800'
                              }`}>
                                {v.lab_decision}
                              </span>
                            )}
                            {v.has_tank_receipt && (
                              <span className="px-2 py-0.5 rounded-md text-xs font-semibold bg-blue-100 text-blue-800">
                                Tank Received
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="p-2 bg-slate-50 rounded-xl border border-slate-200 text-center">
                          <span className="text-xs font-semibold text-slate-500">Old record. Gate exit is no longer used.</span>
                        </div>
                      </div>
                    ))}
                  </div>

                  {totalInsidePages > 1 && (
                    <div className="flex items-center justify-between pt-3 border-t border-border">
                      <span className="text-xs text-slate-500">
                        Page {insidePage} of {totalInsidePages}
                      </span>
                      <div className="flex items-center space-x-2">
                        <button
                          type="button"
                          disabled={insidePage <= 1}
                          onClick={() => setInsidePage((p) => Math.max(1, p - 1))}
                          className="min-h-[44px] px-4 rounded-xl border border-border text-xs font-semibold text-slate-700 disabled:opacity-40 hover:bg-slate-50 cursor-pointer"
                        >
                          Previous
                        </button>
                        <button
                          type="button"
                          disabled={insidePage >= totalInsidePages}
                          onClick={() => setInsidePage((p) => Math.min(totalInsidePages, p + 1))}
                          className="min-h-[44px] px-4 rounded-xl border border-border text-xs font-semibold text-slate-700 disabled:opacity-40 hover:bg-slate-50 cursor-pointer"
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
