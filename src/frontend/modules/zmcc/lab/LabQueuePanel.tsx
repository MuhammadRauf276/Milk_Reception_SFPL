'use client';

import React from 'react';
import { CheckCircle2, Clock, Search } from 'lucide-react';
import type { LabQueueItem } from './labTypes';

export interface LabQueuePanelProps {
  queueSearch: string;
  setQueueSearch: (v: string) => void;
  fetchQueue: () => void;
  loadingQueue: boolean;
  loadingSession: boolean;
  filteredQueue: LabQueueItem[];
  paginatedQueue: LabQueueItem[];
  queuePage: number;
  setQueuePage: React.Dispatch<React.SetStateAction<number>>;
  totalQueuePages: number;
  handleStartOrResume: (item: LabQueueItem) => void | Promise<void>;
  canTest: boolean;
}

export const LabQueuePanel: React.FC<LabQueuePanelProps> = ({
  queueSearch,
  setQueueSearch,
  fetchQueue,
  loadingQueue,
  loadingSession,
  filteredQueue,
  paginatedQueue,
  queuePage,
  setQueuePage,
  totalQueuePages,
  handleStartOrResume,
  canTest,
}) => {
  return (
        <div className="space-y-4 animate-panel-in">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
            <div className="relative w-full sm:w-80">
              <Search className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
              <input
                type="text"
                value={queueSearch}
                onChange={(e) => setQueueSearch(e.target.value)}
                placeholder="Search"
                className="min-h-11 w-full pl-9 pr-4 py-2 border border-slate-300 rounded-xl text-sm focus:outline-hidden focus:ring-2 focus:ring-primary"
              />
            </div>
            <button
              onClick={fetchQueue}
              disabled={loadingQueue}
              className="min-h-11 min-w-11 flex items-center gap-2 px-4 py-2 bg-white border border-slate-300 text-slate-700 text-sm font-medium rounded-xl hover:bg-slate-50"
            >
              Refresh
            </button>
          </div>

          {loadingQueue ? (
            <div className="bg-card border-border p-12 text-center text-slate-500 rounded-xl border">
              Loading…
            </div>
          ) : filteredQueue.length === 0 ? (
            <div className="bg-card border-border p-12 text-center text-slate-500 rounded-xl border">
              <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto mb-3" />
              <p className="font-semibold text-slate-700">No arrivals waiting</p>
              <button
                type="button"
                onClick={fetchQueue}
                className="mt-3 min-h-11 rounded-xl border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Refresh
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {paginatedQueue.map((item) => (
                <div
                  key={`${item.queue_type}-${item.arrival_id}`}
                  className="bg-card p-5 rounded-xl border border-border shadow-xs flex flex-col justify-between hover:border-primary transition-colors"
                >
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span
                        className={`text-xs font-semibold px-2.5 py-1 rounded-full uppercase ${
                          item.queue_type === 'MOT' ? 'bg-blue-100 text-blue-800' : 'bg-emerald-100 text-emerald-800'
                        }`}
                      >
                        {item.queue_type === 'MOT' ? 'Mobile Tester Milk' : 'HC Milk'}
                      </span>
                      <span className="text-xs text-slate-500 flex items-center gap-1 tabular-nums">
                        <Clock className="w-3.5 h-3.5" />
                        {new Date(item.arrival_timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>

                    <div>
                      <div className="font-semibold text-slate-800 text-base">
                        {item.queue_type === 'MOT'
                          ? item.route_name || item.route_code || 'Direct Mobile Tester'
                          : item.local_supplier_name}
                      </div>
                      <div className="text-xs text-slate-500 flex items-center gap-2 mt-0.5">
                        <span>Vehicle: <strong className="text-slate-700">{item.vehicle_number || 'N/A'}</strong></span>
                        <span>·</span>
                        <span>Token: <strong className="text-slate-700 tabular-nums">{item.zmcc_token}</strong></span>
                      </div>
                    </div>

                    {item.queue_type === 'MOT' && (
                      <div className="bg-card border-border text-xs text-slate-600 p-2.5 rounded-lg border space-y-1">
                        <div>Journey: <strong>{item.journey_number}</strong></div>
                        <div>Tester: <strong>{item.mot_name || 'N/A'}</strong></div>
                      </div>
                    )}

                    {item.queue_type === 'HC' && (
                      <div className="bg-card border-border text-xs text-slate-600 p-2.5 rounded-lg border space-y-1">
                        <div>Code: <strong>{item.local_supplier_code}</strong></div>
                        <div>RMR: <strong>{item.rmr_number || 'N/A'}</strong></div>
                      </div>
                    )}

                  </div>

                  <div className="pt-4 mt-4 border-t border-slate-100 flex items-center justify-between">
                    <div>
                      {item.lab_session_status === 'IN_PROGRESS' ? (
                        <span className="text-xs text-amber-600 font-semibold bg-amber-50 px-2 py-1 rounded">
                          In progress
                        </span>
                      ) : (
                        <span className="text-xs text-slate-400 font-medium">Not started</span>
                      )}
                    </div>

                    {canTest ? (
                      <button
                        onClick={() => handleStartOrResume(item)}
                        disabled={loadingSession}
                        className="min-h-11 min-w-11 flex items-center gap-1.5 px-4 py-2 bg-primary text-white text-xs font-semibold rounded-xl hover:bg-primary-hover transition-colors shadow-xs"
                      >
                        {item.lab_session_status === 'IN_PROGRESS' ? 'Resume' : 'Start'}
                        
                      </button>
                    ) : (
                      <span className="text-xs text-slate-400 italic">Attendant only</span>
                    )}
                  </div>
                </div>
              ))}
              </div>

              {totalQueuePages > 1 && (
                <div className="bg-card border-border flex items-center justify-between p-3 rounded-xl border">
                  <span className="text-xs text-slate-600 font-semibold">
                    Page {queuePage} of {totalQueuePages} ({filteredQueue.length} pending arrivals)
                  </span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={queuePage <= 1}
                      onClick={() => setQueuePage((p) => Math.max(1, p - 1))}
                      className="min-h-11 min-w-11 px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                    >
                      Previous
                    </button>
                    <button
                      type="button"
                      disabled={queuePage >= totalQueuePages}
                      onClick={() => setQueuePage((p) => Math.min(totalQueuePages, p + 1))}
                      className="min-h-11 min-w-11 px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
  );
};
