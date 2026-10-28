'use client';

import React from 'react';
import { Search, Edit3 } from 'lucide-react';
import { MyCorrectionTicketsButton } from '@/frontend/modules/governance/MyCorrectionTickets';
import type { LabSession } from './labTypes';

export interface LabHistoryPanelProps {
  historySearch: string;
  setHistorySearch: (v: string) => void;
  historyDate: string;
  setHistoryDate: (v: string) => void;
  historyDecision: string;
  setHistoryDecision: (v: string) => void;
  historyPage: number;
  setHistoryPage: React.Dispatch<React.SetStateAction<number>>;
  historyItems: LabSession[];
  historyTotal: number;
  historyTotalPages: number;
  loadingHistory: boolean;
  fetchHistory: () => void;
  canTest: boolean;
  canDirectCorrect: boolean;
  canReceiveHistorical: boolean;
  /** Roles below Data Executive raise a correction ticket instead of correcting. */
  canRequestCorrection: boolean;
  /** Lab attendant never sees litres or 13TS figures. */
  showLitres: boolean;
  openCorrection: (session: LabSession) => void;
  openRequestCorrection: (session: LabSession) => void;
  openHistoricalReceiveModal: (session: LabSession) => void | Promise<void>;
  startRmr: (session: LabSession) => void;
}

export const LabHistoryPanel: React.FC<LabHistoryPanelProps> = ({
  historySearch,
  setHistorySearch,
  historyDate,
  setHistoryDate,
  historyDecision,
  setHistoryDecision,
  historyPage,
  setHistoryPage,
  historyItems,
  historyTotal,
  historyTotalPages,
  loadingHistory,
  fetchHistory,
  canTest,
  canDirectCorrect,
  canReceiveHistorical,
  canRequestCorrection,
  showLitres,
  openCorrection,
  openRequestCorrection,
  openHistoricalReceiveModal,
  startRmr,
}) => {
  return (
        <div className="space-y-4 animate-panel-in">
          
          <div className="bg-card border-border flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 p-4 rounded-xl border">
            <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
                <input
                  type="text"
                  value={historySearch}
                  onChange={(e) => { setHistorySearch(e.target.value); setHistoryPage(1); }}
                  placeholder="Search token, vehicle…"
                  className="min-h-11 pl-9 pr-4 py-2 border border-slate-300 rounded-xl text-xs focus:outline-hidden focus:ring-1 focus:ring-primary"
                />
              </div>

              <input
                type="date"
                value={historyDate}
                onChange={(e) => { setHistoryDate(e.target.value); setHistoryPage(1); }}
                className="min-h-11 px-3 py-2 border border-slate-300 rounded-xl text-xs focus:outline-hidden focus:ring-1 focus:ring-primary"
              />

              <select
                value={historyDecision}
                onChange={(e) => { setHistoryDecision(e.target.value); setHistoryPage(1); }}
                className="min-h-11 px-3 py-2 border border-slate-300 rounded-xl text-xs focus:outline-hidden focus:ring-1 focus:ring-primary"
              >
                <option value="ALL">All decisions</option>
                <option value="ACCEPTED">Accepted</option>
                <option value="REJECTED">Rejected</option>
              </select>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {canRequestCorrection && <MyCorrectionTicketsButton />}
              <button
                onClick={fetchHistory}
                disabled={loadingHistory}
                className="flex items-center gap-2 min-h-[44px] px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-xl"
              >
                Filter
              </button>
            </div>
          </div>

          
          {loadingHistory ? (
            <div className="bg-card border-border p-12 text-center text-slate-500 rounded-xl border">
              Loading test history…
            </div>
          ) : historyItems.length === 0 ? (
            <div className="bg-card border-border p-12 text-center text-slate-500 rounded-xl border">
              No completed laboratory testing records found.
            </div>
          ) : (
            <>
              <div className="bg-card border-border rounded-xl border shadow-xs overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                    <th className="py-3 px-4">Session #</th>
                    <th className="py-3 px-4">Type</th>
                    <th className="py-3 px-4">Intake Token</th>
                    <th className="py-3 px-4">Source / Vehicle</th>
                    <th className="py-3 px-4">Received Qty</th>
                    {showLitres && <th className="py-3 px-4">Gross Liters</th>}
                    {showLitres && <th className="py-3 px-4">@13% TS Liters</th>}
                    <th className="py-3 px-4">Tank Receipt</th>
                    <th className="py-3 px-4">Completed At</th>
                    <th className="py-3 px-4">Tested By</th>
                    <th className="py-3 px-4">Decision</th>
                    {canDirectCorrect && <th className="py-3 px-4">Corrections</th>}
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {historyItems.map((item) => (
                    <tr key={item.id} className="hover:bg-slate-50/60">
                      <td className="py-3.5 px-4 tabular-nums font-semibold text-slate-800">
                        #{item.id}
                      </td>
                      <td className="py-3.5 px-4">
                        <span
                          className={`text-xs font-semibold px-2 py-0.5 rounded ${
                            item.arrival_type === 'MOT' ? 'bg-blue-100 text-blue-800' : 'bg-emerald-100 text-emerald-800'
                          }`}
                        >
                          {item.arrival_type === 'MOT' ? 'Mobile Tester' : 'HC'}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 tabular-nums text-slate-700">
                        {item.mot_arrival?.zmcc_token ||
                          item.local_supplier_arrival?.zmcc_token ||
                          '—'}
                      </td>
                      <td className="py-3.5 px-4 text-slate-700">
                        {item.arrival_type === 'MOT' ? (
                          <span>
                            {item.mot_arrival?.journey?.route?.name || 'Route Milk'} (
                            {item.mot_arrival?.journey?.mot_vehicle?.vehicle_number || 'Mobile Tester'})
                          </span>
                        ) : (
                          <span>
                            {item.local_supplier_arrival?.local_supplier?.name || 'HC supplier'} (
                            {item.local_supplier_arrival?.vehicle_number || '—'})
                          </span>
                        )}
                      </td>
                      <td className="py-3.5 px-4 tabular-nums text-slate-800 font-semibold">
                        {item.quantity_value != null ? (
                          <span>
                            {Number(item.quantity_value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{' '}
                            <span className="text-xs text-slate-500 font-normal">
                              {item.quantity_unit === 'LITER' ? 'Liters' : item.quantity_unit}
                            </span>
                          </span>
                        ) : (
                          <span className="text-xs text-slate-400 italic">Not captured under this version</span>
                        )}
                      </td>
                      {showLitres && (
                        <td className="py-3.5 px-4 tabular-nums text-slate-700">
                          {item.gross_liters != null ? `${Number(item.gross_liters).toFixed(2)} L` : '—'}
                        </td>
                      )}
                      {showLitres && (
                        <td className="py-3.5 px-4 tabular-nums font-semibold text-emerald-700">
                          {item.at_13ts_liters != null ? `${Number(item.at_13ts_liters).toFixed(2)} L` : '—'}
                        </td>
                      )}
                      <td className="py-3.5 px-4">
                        {item.tank_receipt ? (
                          <div className="tabular-nums text-xs">
                            <span className="font-semibold text-slate-800">
                              {item.tank_receipt.tank?.tank_code || 'Tank'}
                            </span>
                            {showLitres && (
                              <div className="text-xs text-slate-500 font-sans">
                                {Number(item.tank_receipt.gross_liters).toFixed(2)} L
                              </div>
                            )}
                          </div>
                        ) : item.decision === 'ACCEPTED' ? (
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs text-amber-700 bg-amber-50 px-2 py-0.5 rounded font-medium border border-amber-200">
                              Unassigned
                            </span>
                            {canReceiveHistorical && (
                              <button
                                type="button"
                                onClick={() => openHistoricalReceiveModal(item)}
                                className="min-h-11 min-w-11 px-2 py-0.5 text-xs font-semibold text-white bg-primary rounded hover:bg-primary-hover shadow-xs"
                              >
                                Receive
                              </button>
                            )}
                          </div>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="py-3.5 px-4 text-slate-500">
                        {item.completed_at ? new Date(item.completed_at).toLocaleString() : '—'}
                      </td>
                      <td className="py-3.5 px-4 text-slate-600">
                        {item.completer?.full_name || item.completer?.username || '—'}
                      </td>
                      <td className="py-3.5 px-4">
                        {item.manager_review_status === 'PENDING' ? (
                          <span className="text-xs font-semibold text-amber-800 bg-amber-100 px-2 py-0.5 rounded-full">
                            MANAGER REVIEW
                          </span>
                        ) : item.decision === 'ACCEPTED' ? (
                          <span className="text-xs font-semibold text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded-full">
                            ACCEPTED
                          </span>
                        ) : item.decision === 'REJECTED' ? (
                          <span className="text-xs font-semibold text-rose-800 bg-rose-100 px-2 py-0.5 rounded-full">
                            REJECTED
                          </span>
                        ) : (
                          <span className="text-xs font-semibold text-slate-600 bg-slate-100 px-2 py-0.5 rounded-full">
                            PENDING
                          </span>
                        )}
                      </td>
                      {canDirectCorrect && (
                        <td className="py-3.5 px-4">
                          <div className="space-y-0.5">
                            <div className="font-semibold text-slate-700">Saves: {item.correction_count ?? 0}</div>
                            {item.last_corrected_at && (
                              <div className="text-xs text-slate-400">
                                Last by {item.last_corrector?.full_name || item.last_corrector?.username || 'user'}
                              </div>
                            )}
                          </div>
                        </td>
                      )}
                      <td className="py-3.5 px-4 text-right">
                        {canTest && item.arrival_type === 'HC' && item.final_decision === 'ACCEPTED' && item.tank_receipt && (
                          <button
                            onClick={() => startRmr(item)}
                            className="min-h-11 min-w-11 mr-2 px-2.5 py-1 text-xs font-semibold text-emerald-800 bg-emerald-50 rounded-lg hover:bg-emerald-100"
                          >
                            Issue RMR
                          </button>
                        )}
                        {canDirectCorrect ? (
                          <button
                            onClick={() => openCorrection(item)}
                            className="inline-flex items-center gap-1 min-h-[44px] px-3 text-xs font-semibold text-primary bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors cursor-pointer"
                          >
                            <Edit3 className="w-3 h-3" />
                            Correct
                          </button>
                        ) : canRequestCorrection ? (
                          <button
                            onClick={() => openRequestCorrection(item)}
                            className="inline-flex items-center gap-1 min-h-[44px] px-3 text-xs font-semibold text-amber-700 bg-amber-50 hover:bg-amber-100 rounded-lg border border-amber-200 transition-colors cursor-pointer"
                          >
                            Request correction
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            
            {historyTotalPages > 1 && (
              <div className="flex items-center justify-between p-3 border-t border-slate-200 bg-slate-50 text-xs font-semibold text-slate-700">
                <div>
                  Page <span className="font-semibold text-primary">{historyPage}</span> of{' '}
                  <span className="font-semibold text-primary">{historyTotalPages}</span> ({historyTotal} completed tests)
                </div>
                <div className="flex items-center space-x-2">
                  <button
                    type="button"
                    disabled={historyPage <= 1 || loadingHistory}
                    onClick={() => setHistoryPage((p) => Math.max(1, p - 1))}
                    className="min-h-11 min-w-11 px-3 py-1 bg-white border border-slate-300 rounded-lg hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed font-semibold"
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    disabled={historyPage >= historyTotalPages || loadingHistory}
                    onClick={() => setHistoryPage((p) => Math.min(historyTotalPages, p + 1))}
                    className="min-h-11 min-w-11 px-3 py-1 bg-white border border-slate-300 rounded-lg hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed font-semibold"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
  );
};
