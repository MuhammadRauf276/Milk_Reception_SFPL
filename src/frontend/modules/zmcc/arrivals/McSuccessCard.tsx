'use client';

import React from 'react';
import { CheckCircle2, Clock } from 'lucide-react';
import type { McArrivalRow } from './arrivalTypes';

export const McSuccessCard: React.FC<{
  result: McArrivalRow;
  journeyNumber?: string;
  onReset: () => void;
}> = ({ result, journeyNumber, onReset }) => (
            <div className="bg-card border-border border-2 border-emerald-500/40 rounded-xl p-6 space-y-4">
              <div className="flex items-center space-x-3 text-emerald-800">
                <CheckCircle2 className="w-8 h-8 text-emerald-600 shrink-0" />
                <div>
                  <h3 className="text-base font-semibold">Mobile Tester arrival recorded</h3>
                </div>
              </div>

              <div className="bg-card border-border grid grid-cols-1 md:grid-cols-2 gap-4 p-4 rounded-xl border">
                <div>
                  <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    Raw Milk Token
                  </span>
                  <div className="text-base tabular-nums font-semibold text-slate-900 mt-0.5">
                    {result.raw_milk_token_number || '—'}
                  </div>
                  {result.route_milk_token && (
                    <div className="text-xs text-slate-500 mt-0.5">
                      <span className="font-semibold">Legacy Route Milk Token:</span>{' '}
                      <span className="tabular-nums">{result.route_milk_token}</span>
                    </div>
                  )}
                </div>
                <div>
                  <span className="text-xs font-semibold text-emerald-700 uppercase tracking-wider">Generated ZMCC Token</span>
                  <div className="text-base tabular-nums font-semibold text-emerald-700 mt-0.5">
                    {result.zmcc_token}
                  </div>
                  {result.zmcc_token?.includes('OFFLINE') && (
                    <div className="mt-1 text-[11px] font-medium text-amber-700 bg-amber-50 rounded px-1.5 py-0.5 border border-amber-200">
                      Saved offline on device. Will sync automatically once connected.
                    </div>
                  )}
                </div>
                <div>
                  <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Arrival Time</span>
                  <div className="text-xs font-semibold text-slate-800 mt-0.5">
                    {new Date(result.arrival_timestamp).toLocaleString('en-GB', { timeZone: 'Asia/Karachi' })} PKT
                  </div>
                </div>
                <div>
                  <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Journey Number</span>
                  <div className="text-xs font-semibold text-slate-800 mt-0.5">
                    {result.journey?.journey_number || journeyNumber}
                  </div>
                </div>
              </div>

              {result.journey?.summary && (
                <div className="bg-card border-border p-4 rounded-xl border space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wider text-slate-700">
                      Mobile Tester Journey Final Summary (v{result.journey.summary.summary_version}, Rev #{result.journey.summary.revision})
                    </span>
                    <span className="text-xs font-semibold text-slate-500">
                      Ended: {new Date(result.journey.summary.journey_ended_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} PKT
                    </span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
                    <div className="bg-card border-border p-2 rounded-lg border">
                      <div className="text-xs uppercase font-semibold text-slate-500">Assigned Shops</div>
                      <div className="text-sm font-semibold text-slate-900">{result.journey.summary.assigned_shop_count}</div>
                    </div>
                    <div className="bg-card border-border p-2 rounded-lg border">
                      <div className="text-xs uppercase font-semibold text-emerald-700">Collected Shops</div>
                      <div className="text-sm font-semibold text-emerald-800">{result.journey.summary.collected_shop_count}</div>
                    </div>
                    <div className="bg-card border-border p-2 rounded-lg border">
                      <div className="text-xs uppercase font-semibold text-amber-700">Skipped Shops</div>
                      <div className="text-sm font-semibold text-amber-800">{result.journey.summary.skipped_shop_count}</div>
                    </div>
                    <div className="bg-card border-border p-2 rounded-lg border">
                      <div className="text-xs uppercase font-semibold text-blue-700">Pending Sync</div>
                      <div className="text-sm font-semibold text-blue-800">{result.journey.summary.pending_shop_count}</div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-6 gap-2 text-center">
                    <div className="bg-card border-border p-2 rounded-lg border">
                      <div className="text-xs uppercase font-semibold text-slate-500">Gross Liters</div>
                      <div className="text-xs tabular-nums font-semibold text-slate-900">
                        {Number(result.journey.summary.total_gross_liters).toFixed(2)} L
                      </div>
                    </div>
                    <div className="bg-card border-border p-2 rounded-lg border">
                      <div className="text-xs uppercase font-semibold text-slate-500">@13TS Liters</div>
                      <div className="text-xs tabular-nums font-semibold text-slate-900">
                        {Number(result.journey.summary.total_at_13ts_liters).toFixed(2)} L
                      </div>
                    </div>
                    <div className="bg-card border-border p-2 rounded-lg border">
                      <div className="text-xs uppercase font-semibold text-slate-500">Weighted LR</div>
                      <div className="text-xs tabular-nums font-semibold text-slate-800">
                        {result.journey.summary.weighted_avg_lr != null ? Number(result.journey.summary.weighted_avg_lr).toFixed(2) : '—'}
                      </div>
                    </div>
                    <div className="bg-card border-border p-2 rounded-lg border">
                      <div className="text-xs uppercase font-semibold text-slate-500">Weighted Fat</div>
                      <div className="text-xs tabular-nums font-semibold text-slate-800">
                        {result.journey.summary.weighted_avg_fat != null ? `${Number(result.journey.summary.weighted_avg_fat).toFixed(2)}%` : '—'}
                      </div>
                    </div>
                    <div className="bg-card border-border p-2 rounded-lg border">
                      <div className="text-xs uppercase font-semibold text-slate-500">Weighted SNF</div>
                      <div className="text-xs tabular-nums font-semibold text-slate-800">
                        {result.journey.summary.weighted_avg_snf != null ? `${Number(result.journey.summary.weighted_avg_snf).toFixed(2)}%` : '—'}
                      </div>
                    </div>
                    <div className="bg-card border-border p-2 rounded-lg border">
                      <div className="text-xs uppercase font-semibold text-slate-500">Weighted TS</div>
                      <div className="text-xs tabular-nums font-semibold text-slate-800">
                        {result.journey.summary.weighted_avg_ts != null ? `${Number(result.journey.summary.weighted_avg_ts).toFixed(2)}%` : '—'}
                      </div>
                    </div>
                  </div>

                  {result.journey.summary.pending_shop_count > 0 && (
                    <div className="bg-card border-border flex items-center space-x-2 text-xs font-semibold text-blue-800 p-2.5 rounded-lg border">
                      <Clock className="w-4 h-4 shrink-0 text-blue-600" />
                      <span>
                        Waiting for delayed collection sync: {result.journey.summary.pending_shop_count} assigned shop record(s) are still unresolved.
                      </span>
                    </div>
                  )}
                </div>
              )}

              <button
                type="button"
                onClick={onReset}
                className="min-h-[44px] px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-semibold transition-all"
              >
                Record Another Arrival
              </button>
            </div>
);
