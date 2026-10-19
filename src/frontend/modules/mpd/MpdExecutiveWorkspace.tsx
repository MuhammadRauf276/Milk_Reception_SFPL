'use client';

import React, { useEffect, useState, useCallback } from 'react';
import {
  Truck,
  Building2,
  Filter,
  Layers,
  ShieldAlert,
  Sliders,
} from 'lucide-react';
import { toast } from 'sonner';
import type { MpdTabId, MpdExecutiveTelemetryData } from './types';
import { MpdExecutiveKpiRibbon } from './components/MpdExecutiveKpiRibbon';
import { MpdFleetRadarScreen } from './screens/MpdFleetRadarScreen';
import { MpdSourcesScreen } from './screens/MpdSourcesScreen';
import { MpdQualityScreen } from './screens/MpdQualityScreen';
import { MpdLossScreen } from './screens/MpdLossScreen';
import { MpdGovernanceScreen } from './screens/MpdGovernanceScreen';
import { MpdPolicyScreen } from './screens/MpdPolicyScreen';

import type { User } from '@core/types';
import { PageHeader } from '@/components/ui/page-header';
import { SegmentedTabs } from '@/components/ui/segmented-tabs';
import { Button } from '@/components/ui/button';
import { getErrorMessage } from '@/lib/errors';

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

  const loadTelemetry = useCallback(
    (isManual = false) =>
      fetch('/api/mpd/executive-overview', { cache: 'no-store' })
        .then(async (res) => {
          const json = await res.json();
          if (res.ok && json.success) {
            setTelemetry(json.data);
            setError(null);
          } else {
            setError(json.error || 'Failed to load MPD Executive Telemetry.');
          }
        })
        .catch((err) => {
          setError(getErrorMessage(err) || 'Network error fetching telemetry.');
        })
        .finally(() => {
          setLoading(false);
          if (isManual) setIsRefreshing(false);
        }),
    []
  );

  const fetchTelemetry = (isManual = false) => {
    if (isManual) setIsRefreshing(true);
    setError(null);
    return loadTelemetry(isManual);
  };

  useEffect(() => {
    if (!initialData) {
      loadTelemetry();
    }
    // Periodic auto-refresh every 30 seconds
    const interval = setInterval(() => {
      loadTelemetry();
    }, 30000);

    return () => clearInterval(interval);
  }, [loadTelemetry, initialData]);

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
        toast.success('Audit decision recorded');
      } else {
        toast.error(json.error || 'Failed to submit audit decision.');
      }
    } catch (err) {
      toast.error(getErrorMessage(err) || 'Network error during audit.');
    }
  };

  const tabs: Array<{ id: MpdTabId; label: string; icon: React.ReactNode; count?: number }> = [
    {
      id: 'FLEET_RADAR',
      label: 'Fleet radar',
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
      <PageHeader
        title="Executive command center"
        description={
          <span className="inline-flex flex-wrap items-center gap-x-2">
            <span>ZMCCs, MOT routes, in-transit tankers and plant contractors</span>
            <span aria-hidden="true">·</span>
            <span className="tabular-nums">{telemetry?.calendarDate || new Date().toISOString().split('T')[0]}</span>
          </span>
        }
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => fetchTelemetry(true)} disabled={isRefreshing}>
              {isRefreshing ? 'Refreshing…' : 'Refresh'}
            </Button>
          </>
        }
      />

      {/* Top Level KPI Ribbon */}
      {telemetry && <MpdExecutiveKpiRibbon summary={telemetry.summary} isLoading={loading} />}

      {/* Segmented Sub-Screen Tabs Bar */}
      <SegmentedTabs
        label="Executive views"
        value={activeTab}
        onValueChange={setActiveTab}
        tabs={tabs.map((tab) => ({ value: tab.id, label: tab.label, icon: tab.icon as React.ReactElement, count: tab.count }))}
      />

      {/* Error state */}
      {error && (
        <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-semibold flex items-center gap-2 animate-panel-in">
          <ShieldAlert className="w-4 h-4 text-rose-600 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Tab Screen Content */}
      <div key={activeTab} className="animate-panel-in">
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
            {activeTab === 'LOSS_DIAGNOSTICS' && <MpdLossScreen lossTiers={telemetry.lossTiers} />}
            {activeTab === 'GOVERNANCE' && (
              <MpdGovernanceScreen
                overrides={telemetry.governanceOverrides}
                onAuditAction={handleAuditAction}
              />
            )}
            {activeTab === 'POLICIES' && <MpdPolicyScreen currentUser={currentUser} />}
          </>
        ) : (
          <div className="bg-white border border-border rounded-xl p-12 text-center text-slate-500 text-xs">
            Loading MPD Executive Telemetry…
          </div>
        )}
      </div>
    </div>
  );
};
