'use client';

import React, { useEffect, useState, useCallback } from 'react';
import {
  Truck,
  Building2,
  Filter,
  Layers,
  ShieldAlert,
  Sliders,
  RefreshCw,
  Clock,
  Calendar,
} from 'lucide-react';
import type { MpdTabId, MpdExecutiveTelemetryData } from './types';
import { MpdExecutiveKpiRibbon } from './components/MpdExecutiveKpiRibbon';
import { MpdFleetRadarScreen } from './screens/MpdFleetRadarScreen';
import { MpdSourcesScreen } from './screens/MpdSourcesScreen';
import { MpdQualityScreen } from './screens/MpdQualityScreen';
import { MpdLossScreen } from './screens/MpdLossScreen';
import { MpdGovernanceScreen } from './screens/MpdGovernanceScreen';
import { MpdPolicyScreen } from './screens/MpdPolicyScreen';

import type { User } from '@core/types';

interface MpdExecutiveWorkspaceProps {
  currentUser?: User | null;
  initialData?: MpdExecutiveTelemetryData;
}

export const MpdExecutiveWorkspace: React.FC<MpdExecutiveWorkspaceProps> = ({ currentUser, initialData }) => {
  const [activeTab, setActiveTab] = useState<MpdTabId>('FLEET_RADAR');
  const [telemetry, setTelemetry] = useState<MpdExecutiveTelemetryData | null>(initialData || null);
  const [loading, setLoading] = useState(!initialData);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date>(new Date());

  const fetchTelemetry = useCallback(async (isManual = false) => {
    if (isManual) setIsRefreshing(true);
    setError(null);
    try {
      const res = await fetch('/api/mpd/executive-overview', { cache: 'no-store' });
      const json = await res.json();
      if (res.ok && json.success) {
        setTelemetry(json.data);
        setLastRefreshedAt(new Date());
      } else {
        setError(json.error || 'Failed to load MPD Executive Telemetry.');
      }
    } catch (err: any) {
      setError(err?.message || 'Network error fetching telemetry.');
    } finally {
      setLoading(false);
      if (isManual) setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (!initialData) {
      fetchTelemetry();
    }
    // Periodic auto-refresh every 30 seconds
    const interval = setInterval(() => {
      fetchTelemetry();
    }, 30000);

    return () => clearInterval(interval);
  }, [fetchTelemetry, initialData]);

  const handleAuditAction = async (id: string, action: 'APPROVED' | 'FLAGGED', remarks?: string) => {
    try {
      const res = await fetch('/api/mpd/governance-exceptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ exceptionId: id, action, remarks }),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        // Update local state optimistically
        if (telemetry) {
          setTelemetry({
            ...telemetry,
            governanceOverrides: telemetry.governanceOverrides.map((o) =>
              o.id === id ? { ...o, status: action } : o
            ),
          });
        }
      } else {
        alert(json.error || 'Failed to submit audit decision.');
      }
    } catch (err: any) {
      alert(err.message || 'Network error during audit.');
    }
  };

  const tabs: Array<{ id: MpdTabId; label: string; icon: React.ReactNode; count?: number }> = [
    {
      id: 'FLEET_RADAR',
      label: 'Live Fleet Radar',
      icon: <Truck className="w-4 h-4" />,
      count: telemetry ? telemetry.inTransitTankers.length + telemetry.motRoutes.length : undefined,
    },
    {
      id: 'SOURCES',
      label: 'Sources & Silos',
      icon: <Building2 className="w-4 h-4" />,
      count: telemetry ? telemetry.zmccCenters.length + telemetry.plantContractors.length : undefined,
    },
    {
      id: 'QUALITY_FUNNEL',
      label: 'Quality Screening',
      icon: <Filter className="w-4 h-4" />,
    },
    {
      id: 'LOSS_DIAGNOSTICS',
      label: 'Supply Chain Loss',
      icon: <Layers className="w-4 h-4" />,
    },
    {
      id: 'GOVERNANCE',
      label: 'Exception Desk',
      icon: <ShieldAlert className="w-4 h-4" />,
      count: telemetry ? telemetry.governanceOverrides.filter((o) => o.status === 'PENDING_AUDIT').length : undefined,
    },
    {
      id: 'POLICIES',
      label: 'Testing Policies',
      icon: <Sliders className="w-4 h-4" />,
    },
  ];

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Executive Command Center Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-4 sm:p-5 rounded-2xl border border-[#EAE4D5] shadow-sm">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-wider text-[#1E3A8A] bg-blue-50 px-2.5 py-0.5 rounded-full border border-blue-100">
              Milk Procurement Division
            </span>
            <span className="text-xs text-slate-400">•</span>
            <span className="text-xs font-semibold text-slate-600 flex items-center gap-1">
              <Calendar className="w-3.5 h-3.5 text-slate-400" />
              {telemetry?.calendarDate || new Date().toISOString().split('T')[0]}
            </span>
          </div>
          <h1 className="text-xl sm:text-2xl font-black text-[#111311] tracking-tight mt-1">
            Executive Command Center
          </h1>
          <p className="text-xs text-slate-600 mt-0.5">
            Unified telemetry across ZMCC chilling centers, village MOT routes, in-transit tankers, and direct Plant contractors.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="text-right hidden sm:block">
            <div className="text-xs text-slate-500 font-medium">Last Telemetry Sync</div>
            <div className="text-xs font-mono font-bold text-slate-700 flex items-center gap-1 justify-end">
              <Clock className="w-3 h-3 text-slate-400" />
              {lastRefreshedAt.toLocaleTimeString()}
            </div>
          </div>
          <button
            onClick={() => fetchTelemetry(true)}
            disabled={isRefreshing}
            aria-label="Refresh telemetry data"
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold bg-[#1E3A8A] hover:bg-[#1E3A8A]/90 text-white transition-all shadow-sm disabled:opacity-60 min-h-[44px]"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
            <span>{isRefreshing ? 'Syncing...' : 'Refresh'}</span>
          </button>
        </div>
      </div>

      {/* Top Level KPI Ribbon */}
      {telemetry && <MpdExecutiveKpiRibbon summary={telemetry.summary} isLoading={loading} />}

      {/* Segmented Sub-Screen Tabs Bar */}
      <div className="bg-white border border-[#EAE4D5] rounded-2xl p-1.5 shadow-sm overflow-x-auto">
        <div className="flex items-center gap-1 min-w-max">
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition-all min-h-[40px] ${
                  isActive
                    ? 'bg-[#1E3A8A] text-white shadow-sm'
                    : 'text-slate-600 hover:text-[#111311] hover:bg-slate-50'
                }`}
              >
                {tab.icon}
                <span>{tab.label}</span>
                {typeof tab.count === 'number' && (
                  <span
                    className={`font-mono text-xs px-1.5 py-0.5 rounded-full ${
                      isActive ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-700'
                    }`}
                  >
                    {tab.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-semibold flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 text-rose-600 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Tab Screen Content */}
      <div className="transition-all duration-150">
        {telemetry ? (
          <>
            {activeTab === 'FLEET_RADAR' && (
              <MpdFleetRadarScreen
                tankers={telemetry.inTransitTankers}
                routes={telemetry.motRoutes}
                substitutes={telemetry.emergencySubstitutes}
              />
            )}
            {activeTab === 'SOURCES' && (
              <MpdSourcesScreen
                zmccs={telemetry.zmccCenters}
                contractors={telemetry.plantContractors}
              />
            )}
            {activeTab === 'QUALITY_FUNNEL' && (
              <MpdQualityScreen qualityFunnel={telemetry.qualityFunnel} />
            )}
            {activeTab === 'LOSS_DIAGNOSTICS' && <MpdLossScreen summary={telemetry.summary} />}
            {activeTab === 'GOVERNANCE' && (
              <MpdGovernanceScreen
                overrides={telemetry.governanceOverrides}
                onAuditAction={handleAuditAction}
              />
            )}
            {activeTab === 'POLICIES' && <MpdPolicyScreen currentUser={currentUser} />}
          </>
        ) : (
          <div className="bg-white border border-[#EAE4D5] rounded-2xl p-12 text-center text-slate-500 text-xs">
            Loading MPD Executive Telemetry...
          </div>
        )}
      </div>
    </div>
  );
};
