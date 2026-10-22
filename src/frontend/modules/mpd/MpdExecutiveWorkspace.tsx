'use client';

import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
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
import { fetchJson } from '@/lib/query/fetchJson';
import { fadeSlide } from '@/components/motion/presets';

interface MpdExecutiveWorkspaceProps {
  currentUser?: User | null;
  initialData?: MpdExecutiveTelemetryData;
}

export const MpdExecutiveWorkspace: React.FC<MpdExecutiveWorkspaceProps> = ({ currentUser, initialData }) => {
  const [activeTab, setActiveTab] = useState<MpdTabId>('FLEET_RADAR');
  const queryClient = useQueryClient();
  const [isRefreshing, setIsRefreshing] = useState(false);

  const telemetryQuery = useQuery({
    queryKey: ['mpd', 'executive-overview'],
    queryFn: async ({ signal }) => {
      const json = await fetchJson<{ success?: boolean; data: MpdExecutiveTelemetryData; error?: string }>(
        '/api/mpd/executive-overview',
        { cache: 'no-store', signal }
      );
      if (!json.success) throw new Error(json.error || 'Failed to load MPD Executive Telemetry.');
      return json.data;
    },
    initialData,
    // Periodic auto-refresh every 30 seconds (only while the tab is visible).
    refetchInterval: 30000,
    refetchIntervalInBackground: false,
  });
  const telemetry = telemetryQuery.data ?? null;
  const loading = telemetryQuery.isPending;
  const error = telemetryQuery.error ? getErrorMessage(telemetryQuery.error) || 'Network error fetching telemetry.' : null;

  const fetchTelemetry = async (isManual = false) => {
    if (isManual) setIsRefreshing(true);
    try {
      await telemetryQuery.refetch();
    } finally {
      if (isManual) setIsRefreshing(false);
    }
  };

  const handleAuditAction = async (id: string, action: 'APPROVED' | 'FLAGGED', remarks?: string) => {
    try {
      const json = await fetchJson<{ success?: boolean; error?: string }>('/api/mpd/governance-exceptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ exceptionId: id, action, remarks }),
      });
      if (json.success) {
        // Update cached telemetry optimistically (no page reload).
        queryClient.setQueryData<MpdExecutiveTelemetryData>(['mpd', 'executive-overview'], (old) =>
          old
            ? { ...old, governanceOverrides: old.governanceOverrides.map((o) => (o.id === id ? { ...o, status: action } : o)) }
            : old
        );
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
      count:
        telemetry && Array.isArray(telemetry.governanceOverrides)
          ? telemetry.governanceOverrides.filter((o) => o.status === 'PENDING_AUDIT').length
          : undefined,
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
      <AnimatePresence mode="wait" initial={false}>
      <motion.div key={activeTab} variants={fadeSlide} initial="initial" animate="animate" exit="exit">
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
                intakeBySource={telemetry.intakeBySource}
              />
            )}
            {activeTab === 'QUALITY_FUNNEL' && (
              <MpdQualityScreen qualityFunnel={telemetry.qualityFunnel} />
            )}
            {activeTab === 'LOSS_DIAGNOSTICS' && <MpdLossScreen lossTiers={telemetry.lossTiers} />}
            {activeTab === 'GOVERNANCE' && (
              <MpdGovernanceScreen
                overrides={telemetry.governanceOverrides}
                zmccs={telemetry.zmccCenters}
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
      </motion.div>
      </AnimatePresence>
    </div>
  );
};
