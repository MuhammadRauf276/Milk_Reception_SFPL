'use client';

import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Truck,
  Building2,
  Filter,
  Layers,
  ShieldAlert,
  Sliders,
  Network,
  Route as RouteIcon,
  FileSpreadsheet,
  TrendingUp,
  Scale,
} from 'lucide-react';
import { toast } from '@/frontend/lib/appToast';
import { formatDate } from '@/lib/format';
import type { MpdTabId, MpdExecutiveTelemetryData } from './types';
import { MpdExecutiveKpiRibbon } from './components/MpdExecutiveKpiRibbon';
import { MpdFleetRadarScreen } from './screens/MpdFleetRadarScreen';
import { MpdSourcesScreen } from './screens/MpdSourcesScreen';
import { MpdQualityScreen } from './screens/MpdQualityScreen';
import { MpdLossScreen } from './screens/MpdLossScreen';
import { MpdGovernanceScreen } from './screens/MpdGovernanceScreen';
import { MpdPolicyScreen } from './screens/MpdPolicyScreen';
import { MpdDispatchVsPlantScreen } from './screens/MpdDispatchVsPlantScreen';
import { ZMCCSubordinateHierarchyScreen } from '@/frontend/modules/dashboard/zmcc/ZMCCSubordinateHierarchyScreen';
import { ZMCCOperationalJourneysScreen } from '@/frontend/modules/dashboard/zmcc/ZMCCOperationalJourneysScreen';
import { ZMCCComprehensiveReportsScreen } from '@/frontend/modules/dashboard/zmcc/ZMCCComprehensiveReportsScreen';
import { ZMCCDynamicBIAnalyticsScreen } from '@/frontend/modules/dashboard/zmcc/ZMCCDynamicBIAnalyticsScreen';
import { DynamicReportGeneratorScreen } from '@/frontend/modules/dashboard/reports/DynamicReportGeneratorScreen';

import type { User } from '@core/types';
import { PageHeader } from '@/components/ui/page-header';
import { SegmentedTabs } from '@/components/ui/segmented-tabs';
import { Button } from '@/components/ui/button';
import { getErrorMessage } from '@/lib/errors';
import { fetchJson } from '@/lib/query/fetchJson';
import { fadeSlide } from '@/components/motion/presets';
import { canSeeTestPolicies } from '@/lib/test-policy-access';
import { ErrorPopup } from '@/components/ui/error-popup';

interface MpdExecutiveWorkspaceProps {
  currentUser?: User | null;
  initialData?: MpdExecutiveTelemetryData;
}

export const MpdExecutiveWorkspace: React.FC<MpdExecutiveWorkspaceProps> = ({ currentUser, initialData }) => {
  const searchParams = useSearchParams();
  const rawUrlView = searchParams?.get('view')?.toUpperCase();
  const urlView = rawUrlView === 'ANALYTICS' ? 'REPORTS' : rawUrlView;
  const validViews: MpdTabId[] = [
    'FLEET_RADAR',
    'HIERARCHY',
    'MOT_JOURNEYS',
    'REPORTS',
    'DISPATCH_VS_PLANT',
    'SOURCES',
    'QUALITY_FUNNEL',
    'LOSS_DIAGNOSTICS',
    'GOVERNANCE',
    ...(canSeeTestPolicies(currentUser?.role) ? (['POLICIES'] as const) : []),
  ];
  const [activeTab, setActiveTab] = useState<MpdTabId>(
    validViews.includes(urlView as MpdTabId) ? (urlView as MpdTabId) : 'FLEET_RADAR'
  );
  useEffect(() => {
    if (validViews.includes(urlView as MpdTabId)) setActiveTab(urlView as MpdTabId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlView]);
  const queryClient = useQueryClient();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [selectedZmccId, setSelectedZmccId] = useState<string>('');
  const urlReport = searchParams?.get('report')?.toUpperCase();
  const mpdReportMode = urlReport && urlReport !== 'BUILDER' ? 'LEDGERS' : 'STUDIO';

  const telemetryQuery = useQuery({
    queryKey: ['mpd', 'executive-overview'],
    queryFn: async ({ signal }) => {
      const json = await fetchJson<{ success?: boolean; data: MpdExecutiveTelemetryData; error?: string }>(
        '/api/mpd/executive-overview',
        { cache: 'no-store', signal }
      );
      if (!json.success) throw new Error(json.error || 'Could not load MPD data.');
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
      id: 'HIERARCHY',
      label: 'Hierarchy',
      icon: <Network className="w-4 h-4" />,
    },
    {
      id: 'MOT_JOURNEYS',
      label: 'Mobile Tester journeys',
      icon: <RouteIcon className="w-4 h-4" />,
      count: telemetry ? telemetry.motRoutes.length : undefined,
    },
    {
      id: 'DISPATCH_VS_PLANT',
      label: 'Dispatch vs Plant',
      icon: <Scale className="w-4 h-4" />,
    },
    {
      id: 'REPORTS',
      label: 'Reports',
      icon: <FileSpreadsheet className="w-4 h-4" />,
    },

    {
      id: 'SOURCES',
      label: 'Sources & Silos',
      icon: <Building2 className="w-4 h-4" />,
      count: telemetry ? telemetry.zmccCenters.length + telemetry.plantContractors.length : undefined,
    },
    {
      id: 'QUALITY_FUNNEL',
      label: 'Quality screening',
      icon: <Filter className="w-4 h-4" />,
    },
    {
      id: 'LOSS_DIAGNOSTICS',
      label: 'Whole Loss / Gain',
      icon: <Layers className="w-4 h-4" />,
    },
    {
      id: 'GOVERNANCE',
      label: 'Exception desk',
      icon: <ShieldAlert className="w-4 h-4" />,
      count:
        telemetry && Array.isArray(telemetry.governanceOverrides)
          ? telemetry.governanceOverrides.filter((o) => o.status === 'PENDING_AUDIT').length
          : undefined,
    },
    ...(canSeeTestPolicies(currentUser?.role)
      ? [
          {
            id: 'POLICIES' as const,
            label: 'Test policies',
            icon: <Sliders className="w-4 h-4" />,
          },
        ]
      : []),
  ];

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Executive Command Center Header */}
      <PageHeader
        title="Command center"
        description={
          <span className="inline-flex flex-wrap items-center gap-x-2">
            <span className="tabular-nums">{formatDate(telemetry?.calendarDate || new Date())}</span>
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
      {telemetry && activeTab === 'FLEET_RADAR' && <MpdExecutiveKpiRibbon summary={telemetry.summary} isLoading={loading} />}

            {/* Multi-Facility ZMCC Selector for Scoped Views */}
      {['HIERARCHY', 'MOT_JOURNEYS', 'REPORTS', 'DISPATCH_VS_PLANT', 'ANALYTICS'].includes(activeTab) && (
        <div className="flex flex-wrap items-center justify-between gap-3 bg-card border border-border p-3 rounded-xl shadow-xs animate-panel-in">
          <div className="flex w-full min-w-0 items-center gap-2 sm:w-auto">
            <Building2 className="w-4 h-4 text-muted-foreground shrink-0" />
            <span className="shrink-0 text-xs font-semibold text-secondary-foreground">ZMCC scope</span>
            <select
              value={selectedZmccId}
              onChange={(e) => setSelectedZmccId(e.target.value)}
              className="min-w-0 flex-1 text-xs bg-background border border-border rounded-lg px-3 py-2 font-medium text-foreground focus:outline-hidden focus:ring-2 focus:ring-primary/20 cursor-pointer sm:flex-none"
            >
              <option value="">All ZMCCs</option>
              {telemetry?.zmccCenters?.map((zmcc) => (
                <option key={zmcc.id} value={zmcc.id}>
                  {zmcc.code} · {zmcc.name}
                </option>
              ))}
            </select>
          </div>
          {selectedZmccId && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSelectedZmccId('')}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Show all ZMCCs
            </Button>
          )}
        </div>
      )}

      {/* Error state */}
      <ErrorPopup message={error} />

      {/* Tab Screen Content */}
      <AnimatePresence mode="wait" initial={false}>
      <motion.div key={activeTab} variants={fadeSlide} initial="initial" animate="animate" exit="exit">
        {telemetry ? (
          <>
            {activeTab === 'FLEET_RADAR' && (
              <MpdFleetRadarScreen
                tankers={telemetry.inTransitTankers}
                routes={telemetry.motRoutes}
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
            {activeTab === 'LOSS_DIAGNOSTICS' && <MpdLossScreen role={currentUser?.role} />}
            {activeTab === 'GOVERNANCE' && (
              <MpdGovernanceScreen
                overrides={telemetry.governanceOverrides}
                zmccs={telemetry.zmccCenters}
                onAuditAction={handleAuditAction}
              />
            )}
            {activeTab === 'POLICIES' && <MpdPolicyScreen currentUser={currentUser} />}
            {activeTab === 'HIERARCHY' && (
              <ZMCCSubordinateHierarchyScreen
                currentUser={currentUser ?? null}
                targetZmccId={selectedZmccId || undefined}
                onSelectFacility={(id) => setSelectedZmccId(id)}
              />
            )}
            {activeTab === 'MOT_JOURNEYS' && (
              <ZMCCOperationalJourneysScreen
                currentUser={currentUser ?? null}
                targetZmccId={selectedZmccId || undefined}
              />
            )}
            {activeTab === 'DISPATCH_VS_PLANT' && (
              <MpdDispatchVsPlantScreen zmccId={selectedZmccId || undefined} onOpenTab={(tab) => setActiveTab(tab)} />
            )}
            {activeTab === 'REPORTS' && (
              <div className="space-y-6">
                
                {mpdReportMode === 'STUDIO' ? (
                  <DynamicReportGeneratorScreen
                    currentUser={currentUser ?? null}
                    targetZmccId={selectedZmccId || undefined}
                  />
                ) : (
                  <ZMCCComprehensiveReportsScreen
                    currentUser={currentUser ?? null}
                    targetZmccId={selectedZmccId || undefined}
                    initialView={urlReport}
                  />
                )}
              </div>
            )}
            
          </>
        ) : (
          <div className="bg-card border-border border rounded-xl p-12 text-center text-muted-foreground text-xs">
            Loading
          </div>
        )}
      </motion.div>
      </AnimatePresence>
    </div>
  );
};
