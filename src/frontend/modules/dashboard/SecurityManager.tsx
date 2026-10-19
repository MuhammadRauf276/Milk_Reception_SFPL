'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { MilkProcessLog, User } from '@core/types';
import { Header } from '@modules/shared/Header';
import { HierarchicalNavDrawer } from '@modules/shared/navigation/HierarchicalNavDrawer';
import { ShieldCheck, Search, AlertTriangle } from 'lucide-react';

export const SecurityManager: React.FC = () => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [logs, setLogs] = useState<MilkProcessLog[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const hamburgerButtonRef = React.useRef<HTMLButtonElement | null>(null);

  const openDrawer = useCallback(() => setIsDrawerOpen(true), []);
  const closeDrawer = useCallback(() => {
    setIsDrawerOpen(false);
    setTimeout(() => {
      hamburgerButtonRef.current?.focus();
    }, 0);
  }, []);

  const fetchUser = () =>
    fetch('/api/auth/me')
      .then(async (res) => {
        const data = await res.json();
        if (data.user) setCurrentUser(data.user);
      })
      .catch(() => {
        // Fallback
      });

  const fetchLogs = useCallback(
    () =>
      fetch('/api/logs?mode=live')
        .then(async (res) => {
          const data = await res.json();
          const items = data.items || data.logs;
          if (items) setLogs(items);
        })
        .catch(() => {
          // Error
        }),
    []
  );

  useEffect(() => {
    fetchUser();
    fetchLogs();
    const interval = setInterval(fetchLogs, 10000);
    return () => clearInterval(interval);
  }, [fetchLogs]);

  const handleManualSync = async () => {
    setIsLoading(true);
    await fetchLogs();
    setTimeout(() => setIsLoading(false), 500);
  };

  // Helper to calculate minutes between two HH:mm strings
  const getMinutesBetween = (timeA?: string | null, timeB?: string | null): number | null => {
    if (!timeA || !timeB) return null;
    const [hA, mA] = timeA.split(':').map(Number);
    const [hB, mB] = timeB.split(':').map(Number);
    if (isNaN(hA) || isNaN(mA) || isNaN(hB) || isNaN(mB)) return null;

    const minsA = hA * 60 + mA;
    const minsB = hB * 60 + mB;
    const diff = minsB - minsA;
    return diff >= 0 ? diff : diff + 1440; // Handle midnight wrap if needed
  };

  const filteredLogs = logs.filter(
    (log) =>
      log.vehicle_number.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (log.token_number && log.token_number.toLowerCase().includes(searchQuery.toLowerCase())) ||
      log.zonal_contractor_name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Calculate Security Performance Metrics
  const totalGateEntries = logs.filter((l) => l.igp_time).length;
  const delayedTransitCount = logs.filter((l) => {
    const transitMins = getMinutesBetween(l.igp_time, l.sampling_time_start);
    return transitMins !== null && transitMins > 15;
  }).length;
  const completedGateOuts = logs.filter((l) => l.out_from_gate_time).length;

  return (
    <div className="min-h-screen bg-subtle text-foreground flex flex-col font-sans w-full max-w-full overflow-x-hidden">
      <Header
        currentUser={currentUser}
        title="Security Manager"
        showBranding={true}
        showMenuButton={true}
        onMenuClick={openDrawer}
        menuButtonRef={hamburgerButtonRef}
      />

      <HierarchicalNavDrawer
        currentUser={currentUser}
        isOpen={isDrawerOpen}
        onClose={closeDrawer}
        triggerButtonRef={hamburgerButtonRef}
      />

      <main className="flex-1 p-4 sm:p-6 overflow-y-auto space-y-6 w-full max-w-full">
          {/* Top Header Panel */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-5 rounded-xl bg-white border border-border-strong shadow-xs">
            <div>
              <div className="flex items-center space-x-2.5 flex-wrap gap-y-1">
                <ShieldCheck className="w-6 h-6 text-primary" />
                <h1 className="text-xl font-semibold tracking-tight text-foreground">
                  Security Time Audit & Gate Performance
                </h1>
              </div>
            </div>

            <button
              type="button"
              onClick={handleManualSync}
              disabled={isLoading}
              className="flex items-center justify-center space-x-2 px-4 py-2.5 min-h-[44px] rounded-xl bg-subtle border border-border-strong text-xs font-semibold text-foreground hover:bg-muted/60 active:scale-95 transition-all shadow-xs disabled:opacity-50 self-start md:self-auto"
            >
              <span>{isLoading ? 'Syncing…' : 'Refresh Audit Log'}</span>
            </button>
          </div>

          {/* SECURITY AUDIT METRIC CARDS */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {/* Blue Box: Gate Entries */}
            <div className="p-5 rounded-xl bg-blue-50 border border-blue-200 shadow-xs space-y-1.5 transition-all hover:bg-blue-100/80">
              <span className="text-primary-hover font-sans block text-[11px] font-semibold uppercase tracking-wider">
                Total Gate 2 IGP Entries
              </span>
              <div className="text-2xl sm:text-3xl font-semibold tabular-nums text-foreground">
                {totalGateEntries} <span className="text-base font-semibold font-sans text-slate-600">Vehicles</span>
              </div>
              <span className="text-[11px] text-primary-hover font-semibold block">Issued entry tokens</span>
            </div>

            {/* Red Alert Box: Delays */}
            <div className="p-5 rounded-xl bg-red-50 border border-red-200 shadow-xs space-y-1.5 transition-all hover:bg-red-100/80">
              <span className="text-red-800 font-sans block text-[11px] font-semibold uppercase tracking-wider">
                Gate-to-Lab Transit Delays (&gt;15 mins)
              </span>
              <div className="text-2xl sm:text-3xl font-semibold tabular-nums text-red-800 flex items-center gap-2">
                <AlertTriangle className="w-6 h-6 text-red-800 shrink-0" />
                <span>{delayedTransitCount} <span className="text-base font-semibold font-sans text-red-800">Delays</span></span>
              </div>
              <span className="text-[11px] text-red-800 font-semibold block">Flagged for team review</span>
            </div>

            {/* Green Box: Completed Clearance */}
            <div className="p-5 rounded-xl bg-green-50 border border-green-200 shadow-xs space-y-1.5 transition-all hover:bg-green-100/80">
              <span className="text-green-800 font-sans block text-[11px] font-semibold uppercase tracking-wider">
                Completed Gate Clearance Outs
              </span>
              <div className="text-2xl sm:text-3xl font-semibold tabular-nums text-green-800">
                {completedGateOuts} <span className="text-base font-semibold font-sans text-slate-600">Vehicles</span>
              </div>
              <span className="text-[11px] text-green-800 font-semibold block">Final out timestamp recorded</span>
            </div>
          </div>

          {/* Filter Bar */}
          <div className="p-4 rounded-xl bg-white border border-border-strong shadow-xs flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
            <div className="relative w-full sm:max-w-xs">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search vehicle #, token #…"
                className="w-full pl-10 pr-4 py-2.5 min-h-[44px] text-xs font-semibold rounded-xl bg-subtle border border-border-strong text-foreground focus:ring-2 focus:ring-primary outline-hidden shadow-2xs"
              />
            </div>
            <span className="text-xs font-semibold text-slate-700 self-end sm:self-center">
              Audited Records: <strong className="tabular-nums text-foreground">{filteredLogs.length}</strong>
            </span>
          </div>

          {/* SECURITY AUDIT LEDGER TABLE */}
          <div className="p-5 rounded-xl bg-white border border-border-strong shadow-xs space-y-4 text-foreground">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-border">
              <h3 className="text-sm font-semibold text-foreground">
                Guard Team Station Timestamps & Transit Durations
              </h3>
              <span className="text-[10px] font-semibold text-red-800 bg-red-50 px-2.5 py-1 rounded-lg border border-red-200 self-start sm:self-auto">
                Auto-Alerts Enabled (&gt;15m Gate-to-Lab)
              </span>
            </div>

            <div className="overflow-x-auto rounded-xl border border-border-strong bg-subtle">
              <table className="w-full text-left border-collapse text-xs tabular-nums">
                <thead>
                  <tr className="bg-muted/60 border-b border-border-strong text-foreground font-sans font-semibold uppercase text-[10px] tracking-wider whitespace-nowrap">
                    <th className="p-3">Date</th>
                    <th className="p-3">Vehicle #</th>
                    <th className="p-3">Token #</th>
                    <th className="p-3">IGP Time (Gate 2)</th>
                    <th className="p-3">1st Weight Time</th>
                    <th className="p-3">2nd Weight Time</th>
                    <th className="p-3">Out-from-Gate</th>
                    <th className="p-3 text-right">Gate-to-Gate Duration</th>
                    <th className="p-3 text-center">Transit Delay Alert</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border font-semibold text-foreground">
                  {filteredLogs.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="p-8 text-center text-slate-500 font-sans font-semibold">
                        No security audit records found.
                      </td>
                    </tr>
                  ) : (
                    filteredLogs.map((log) => {
                      const transitMins = getMinutesBetween(log.igp_time, log.sampling_time_start);
                      const hasTransitDelayAlert = transitMins !== null && transitMins > 15;
                      const totalGateMins = getMinutesBetween(log.igp_time, log.out_from_gate_time);

                      return (
                        <tr
                          key={`sec-mgr-log-${String(log.id)}`}
                          className={`hover:bg-muted/40 transition-colors ${
                            hasTransitDelayAlert ? 'bg-red-50 border-l-4 border-l-red-800' : ''
                          }`}
                        >
                          {/* Date */}
                          <td className="p-3 text-slate-600 font-semibold font-sans whitespace-nowrap">
                            {log.dispatch_date || log.created_at.split('T')[0]}
                          </td>

                          {/* Vehicle # */}
                          <td className="p-3 font-semibold text-foreground tabular-nums text-sm whitespace-nowrap">
                            {log.vehicle_number}
                          </td>

                          {/* Token # */}
                          <td className="p-3 whitespace-nowrap">
                            <span className="px-2 py-0.5 rounded text-[10px] bg-blue-50 border border-blue-200 font-semibold text-primary-hover">
                              {log.token_number || 'PENDING'}
                            </span>
                          </td>

                          {/* IGP Time */}
                          <td className="p-3 text-slate-700 whitespace-nowrap">
                            {log.igp_time || '—'}
                          </td>

                          {/* 1st Weight Time */}
                          <td className="p-3 text-slate-700 whitespace-nowrap">
                            {log.first_weight_time || '—'}
                          </td>

                          {/* 2nd Weight Time */}
                          <td className="p-3 text-slate-700 whitespace-nowrap">
                            {log.second_weight_time || '—'}
                          </td>

                          {/* Out-from-Gate */}
                          <td className="p-3 text-slate-700 whitespace-nowrap">
                            {log.out_from_gate_time || '—'}
                          </td>

                          {/* Gate-to-Gate Duration */}
                          <td className="p-3 text-right whitespace-nowrap">
                            <span className="font-semibold text-foreground">
                              {totalGateMins !== null ? `${totalGateMins} mins` : 'In Pipeline'}
                            </span>
                          </td>

                          {/* Transit Delay Alert */}
                          <td className="p-3 text-center whitespace-nowrap">
                            {hasTransitDelayAlert ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-semibold uppercase bg-red-50 text-red-800 border border-red-200 animate-pulse">
                                <AlertTriangle className="w-3.5 h-3.5 text-red-800" />
                                Gate-to-Lab Delay ({transitMins}m)
                              </span>
                            ) : (
                              <span className="text-[10px] text-slate-400 font-sans font-semibold">Normal</span>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </main>
      </div>
    );
  };
