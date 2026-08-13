'use client';

import React, { useState, useEffect } from 'react';
import { MilkProcessLog } from '@core/types';
import { Tv, Radio, Clock, Truck, ShieldAlert } from 'lucide-react';

export default function PublicYardTVBoardPage() {
  const [logs, setLogs] = useState<MilkProcessLog[]>([]);
  const [currentTime, setCurrentTime] = useState<Date>(new Date());

  const fetchLogs = async () => {
    try {
      const res = await fetch('/api/logs');
      const data = await res.json();
      if (data.logs) {
        setLogs(data.logs);
      }
    } catch (_err) {
      // Handled
    }
  };

  useEffect(() => {
    fetchLogs();
    const interval = setInterval(() => {
      fetchLogs();
      setCurrentTime(new Date());
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  const activeVehicles = logs
    .filter((l) => l.status !== 'Completed')
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

  return (
    <div className="min-h-screen w-screen bg-[#0F172A] text-white p-6 font-sans flex flex-col justify-between">
      {/* TV Header */}
      <div className="flex items-center justify-between pb-6 border-b border-slate-800">
        <div className="flex items-center space-x-4">
          <div className="p-3 bg-[#1E40AF] rounded-2xl shadow-lg">
            <Tv className="w-8 h-8 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-black tracking-tight text-white">PARKING YARD VEHICLE STATUS BOARD</h1>
            <p className="text-xs text-blue-400 font-extrabold uppercase tracking-widest mt-0.5">
              Live Queue Positioning for Tanker Drivers & Security
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-2 px-4 py-2 rounded-xl bg-emerald-950/80 border border-emerald-800 text-emerald-300 text-xs font-black">
            <Radio className="w-4 h-4 text-emerald-400 animate-pulse" />
            <span>LIVE YARD FEED</span>
          </div>
          <div className="px-4 py-2 rounded-xl bg-slate-900 border border-slate-800 font-mono text-sm font-black text-slate-300">
            {currentTime.toLocaleTimeString()}
          </div>
        </div>
      </div>

      {/* Main Queue Display */}
      <div className="my-6 flex-1 overflow-y-auto">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {activeVehicles.length === 0 ? (
            <div className="col-span-full p-16 text-center border border-dashed border-slate-800 rounded-2xl text-slate-500 font-bold text-sm">
              No active milk tankers currently waiting in plant yard.
            </div>
          ) : (
            activeVehicles.map((vehicle, idx) => {
              const isNext = idx === 0;
              const isRejected = vehicle.calculated_status === 'Rejected';

              return (
                <div
                  key={`tv-vehicle-${String(vehicle.id)}`}
                  className={`p-5 rounded-2xl border shadow-lg flex flex-col justify-between space-y-4 transition-all ${
                    isNext
                      ? 'bg-gradient-to-br from-blue-900/90 to-indigo-950 border-blue-500 ring-2 ring-blue-500/50'
                      : isRejected
                      ? 'bg-rose-950/50 border-rose-700'
                      : 'bg-slate-900/90 border-slate-800'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span
                      className={`px-3 py-1 rounded-full text-xs font-black font-mono tracking-wider ${
                        isNext
                          ? 'bg-blue-500 text-white animate-bounce'
                          : isRejected
                          ? 'bg-rose-600 text-white'
                          : 'bg-slate-800 text-slate-300'
                      }`}
                    >
                      {isNext ? 'NEXT IN LINE' : isRejected ? 'STOPPED' : `POSITION #${idx + 1}`}
                    </span>
                    <span className="text-xs font-extrabold text-slate-400 font-mono">
                      Token #{vehicle.token_number || 'PENDING'}
                    </span>
                  </div>

                  <div>
                    <h2 className="text-3xl font-black font-mono tracking-tight text-white">
                      {vehicle.vehicle_number}
                    </h2>
                    <p className="text-xs font-bold text-slate-300 truncate mt-1">
                      {vehicle.zonal_contractor_name} ({vehicle.portion_number})
                    </p>
                  </div>

                  <div className="flex items-center justify-between pt-3 border-t border-slate-800/80 text-xs font-extrabold">
                    <span className="text-slate-400 font-mono">Station:</span>
                    <span
                      className={`px-3 py-1 rounded-lg uppercase tracking-wider text-[11px] ${
                        vehicle.status === 'Dispatched'
                          ? 'bg-blue-950 text-blue-300 border border-blue-800'
                          : 'bg-amber-950 text-amber-300 border border-amber-800'
                      }`}
                    >
                      {vehicle.status}
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* TV Footer Notice */}
      <div className="pt-4 border-t border-slate-800 flex items-center justify-between text-xs font-bold text-slate-500">
        <span>Public Yard Display Board • Protected Privacy Layout</span>
        <span>Automatic Sync Interval: 5s</span>
      </div>
    </div>
  );
}
