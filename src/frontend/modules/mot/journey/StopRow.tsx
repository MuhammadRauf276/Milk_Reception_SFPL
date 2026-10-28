'use client';

import React from 'react';
import { MessageSquare } from 'lucide-react';
import { DecisionStatusBadge } from '@/frontend/modules/shared/decision/DecisionStatusBadge';
import { decisionWord, formatDistance, type CurrentJourney, type StopDetail } from './types';

interface Props {
  stop: StopDetail;
  journey: CurrentJourney;
  onRecord: (stop: StopDetail) => void;
}

export const StopRow = React.memo(function StopRow({ stop, journey, onRecord }: Props) {
  const shopName = stop.shop_name || stop.shop?.shop_name || 'Shop';
  const shopCode = stop.shop_code || stop.shop?.shop_code || '—';
  const ownerName = stop.owner_name || stop.shop?.owner_name || '—';
  const areaName = stop.area_name || stop.area_code || '';
  const isVisited = stop.status === 'VISITED';
  const isSkipped = stop.status === 'SKIPPED';
  const isRejected = stop.status === 'REJECTED';
  const isPending = !isVisited && !isSkipped && !isRejected;
  const waitingDecision = isVisited && stop.collection?.final_decision === 'PENDING';

  return (
<div
                            className="p-3.5 sm:p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 hover:bg-subtle transition"
                          >
                            <div className="flex items-start space-x-3 min-w-0">
                              <span
                                className={`w-7 h-7 rounded-lg text-xs tabular-nums font-semibold flex items-center justify-center shrink-0 mt-0.5 ${
                                  isVisited
                                    ? 'bg-emerald-600 text-white'
                                    : isRejected
                                    ? 'bg-rose-100 text-rose-800 border border-rose-300'
                                    : isSkipped
                                    ? 'bg-rose-100 text-rose-800 border border-rose-300'
                                    : 'bg-muted text-slate-700 border border-border-strong'
                                }`}
                              >
                                {stop.planned_sequence}
                              </span>
                              <div className="space-y-1 min-w-0">
                                <div className="flex items-center space-x-2 flex-wrap gap-y-1">
                                  <span className="text-xs font-semibold text-foreground">
                                    {shopName}
                                  </span>
                                  <span className="text-[10px] tabular-nums text-slate-500">
                                    ({shopCode})
                                  </span>
                                  {waitingDecision ? (
                                    <DecisionStatusBadge status="PENDING" />
                                  ) : isVisited ? (
                                    <span className="px-2 py-0.5 rounded-md text-[10px] font-semibold uppercase bg-emerald-100 text-emerald-800 border border-emerald-300">
                                      Completed ({Number(stop.collection?.gross_liters || 0).toFixed(1)} L)
                                    </span>
                                  ) : isRejected ? (
                                    <DecisionStatusBadge status="REJECTED" />
                                  ) : isSkipped ? (
                                    <span className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-rose-100 text-rose-900 border border-rose-300">
                                      SKIPPED {stop.skip_reason ? `· ${stop.skip_reason}` : ''}
                                    </span>
                                  ) : (
                                    <span className="px-2 py-0.5 rounded-md text-[10px] font-semibold uppercase bg-slate-100 text-slate-700 border border-slate-300">
                                      Pending
                                    </span>
                                  )}
                                  {stop.distanceKm != null && (
                                    <span className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-blue-50 text-blue-800 border border-blue-200">
                                      {formatDistance(stop.distanceKm)}
                                    </span>
                                  )}
                                </div>

                                <p className="text-[11px] text-slate-500">
                                  Owner: {ownerName}
                                </p>

                                <div className="text-[11px] text-slate-500 flex items-center space-x-2 flex-wrap gap-y-1">
                                  {areaName && <span>Area: {areaName}</span>}
                                  {!stop.hasCoordinates && (
                                    <span className="px-1.5 py-0.5 rounded-md text-[10px] font-semibold bg-slate-100 text-slate-700 border border-slate-200">
                                      Geotag on 1st Visit
                                    </span>
                                  )}
                                </div>

                                {isVisited && stop.collection && (
                                  <div className="mt-2 space-y-2">
                                    <div className="bg-card border-border p-2 rounded-lg border text-[11px] tabular-nums font-semibold text-emerald-950 flex flex-wrap gap-x-3 gap-y-1">
                                      <span>Gross: {Number(stop.collection.gross_liters).toFixed(2)} L</span>
                                      <span>@13TS: {Number(stop.collection.at_13ts_liters).toFixed(2)} L</span>
                                      <span>LR: {stop.collection.lr}</span>
                                      <span>Fat: {stop.collection.fat}%</span>
                                    </div>
                                    {(() => {
                                      const rawPhone = stop.phone_number || stop.shop?.contact_number || '';
                                      if (!rawPhone) return null;
                                      const digits = rawPhone.replace(/\D/g, '');
                                      const intlPhone = digits.startsWith('92')
                                        ? digits
                                        : digits.startsWith('0')
                                          ? `92${digits.slice(1)}`
                                          : `92${digits}`;
                                      const msg = `*SFPL Milk Collection Receipt*\nShop: ${shopName}\nJourney: #${journey.journey_number || '101'}\nVehicle: ${journey.mot_vehicle?.vehicle_number || 'SFPL-MC'}\nGross: ${Number(stop.collection.gross_liters).toFixed(2)} L\nLR: ${stop.collection.lr} | Fat: ${stop.collection.fat}%\n@13TS: ${Number(stop.collection.at_13ts_liters).toFixed(2)} L\nStatus: ${decisionWord(stop.collection.final_decision)}`;
                                      return (
                                        <a
                                          href={`https://wa.me/${intlPhone}?text=${encodeURIComponent(msg)}`}
                                          target="_blank"
                                          rel="noreferrer"
                                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold bg-emerald-600 hover:bg-emerald-700 text-white transition shadow-2xs focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
                                        >
                                          <MessageSquare className="w-3.5 h-3.5" />
                                          <span>WhatsApp Receipt ({rawPhone})</span>
                                        </a>
                                      );
                                    })()}
                                  </div>
                                )}
                              </div>
                            </div>

                            {isPending && (
                              <div className="flex items-center space-x-2 self-end sm:self-center">
                                <button
                                  type="button"
                                  onClick={() => onRecord(stop)}
                                  className="min-h-[44px] px-3.5 py-2 rounded-xl bg-primary text-white text-xs font-semibold hover:bg-primary-hover transition shadow-2xs focus:outline-hidden focus:ring-2 focus:ring-primary"
                                >
                                  Record Collection
                                </button>
                              </div>
                            )}
                          </div>
  );
});
