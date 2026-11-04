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
import { toast } from 'sonner';
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
  const [mpdReportMode, setMpdReportMode] = useState<'STUDIO' | 'LEDGERS'>('STUDIO');

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
      id: 'HIERARCHY',
      label: 'Hierarchy',
      icon: <Network className="w-4 h-4" />,
    },
    {
      id: 'MOT_JOURNEYS',
      label: 'MOT Journeys',
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
    ...(canSeeTestPolicies(currentUser?.role)
      ? [
          {
            id: 'POLICIES' as const,
            label: 'Testing Policies',
            icon: <Sliders className="w-4 h-4" />,
          },
        ]
      : []),
  ];

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Executive Command Center Header */}
      <PageHeader
        title="Executive command center"
        description={
          <span className="inline-flex flex-wrap items-center gap-x-2">
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
      {telemetry && activeTab === 'FLEET_RADAR' && <MpdExecutiveKpiRibbon summary={telemetry.summary} isLoading={loading} />}

      {/* Segmented Sub-Screen Tabs Bar */}
      <div className="overflow-x-auto pb-1">
        <SegmentedTabs
          label="Executive views"
          value={activeTab}
          onValueChange={(val) => {
            setActiveTab(val);
            if (typeof window !== 'undefined') {
              const url = new URL(window.location.href);
              url.searchParams.set('view', val);
              window.history.replaceState({}, '', url.toString());
            }
          }}
          mobileOnly={false}
          className="lg:inline-flex"
          tabs={tabs.map((tab) => ({ value: tab.id, label: tab.label, icon: tab.icon as React.ReactElement, count: tab.count }))}
        />
      </div>

      {/* Multi-Facility ZMCC Selector for Scoped Views */}
      {['HIERARCHY', 'MOT_JOURNEYS', 'REPORTS', 'DISPATCH_VS_PLANT', 'ANALYTICS'].includes(activeTab) && (
        <div className="flex flex-wrap items-center justify-between gap-3 bg-card border border-border p-3 rounded-xl shadow-xs animate-panel-in">
          <div className="flex items-center gap-2.5">
            <Building2 className="w-4 h-4 text-primary shrink-0" />
            <span className="text-xs font-semibold text-slate-700">ZMCC Facility Scope:</span>
            <select
              value={selectedZmccId}
              onChange={(e) => setSelectedZmccId(e.target.value)}
              className="text-xs bg-background border border-border rounded-lg px-3 py-1.5 font-medium text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-primary/20 cursor-pointer"
            >
              <option value="">All ZMCC Centers (Consolidated Enterprise View)</option>
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
              Reset to All Facilities
            </Button>
          )}
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="bg-card border-border p-4 rounded-xl border text-rose-800 text-xs font-semibold flex items-center gap-2 animate-panel-in">
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
                <div className="flex items-center justify-between border-b border-border pb-3">
                  <div className="flex items-center gap-1.5 bg-muted/60 p-1 rounded-xl">
                    <button
                      type="button"
                      onClick={() => setMpdReportMode('STUDIO')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                        mpdReportMode === 'STUDIO'
                          ? 'bg-background text-foreground shadow-2xs font-semibold'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      Dynamic Report Studio
                    </button>
                    <button
                      type="button"
                      onClick={() => setMpdReportMode('LEDGERS')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                        mpdReportMode === 'LEDGERS'
                          ? 'bg-background text-foreground shadow-2xs font-semibold'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      Standard Operational Ledgers
                    </button>
                  </div>
                </div>

                {mpdReportMode === 'STUDIO' ? (
                  <DynamicReportGeneratorScreen
                    currentUser={currentUser ?? null}
                    targetZmccId={selectedZmccId || undefined}
                  />
                ) : (
                  <ZMCCComprehensiveReportsScreen
                    currentUser={currentUser ?? null}
                    targetZmccId={selectedZmccId || undefined}
                  />
                )}
              </div>
            )}
            
          </>
        ) : (
          <div className="bg-card border-border border rounded-xl p-12 text-center text-slate-500 text-xs">
            Loading MPD Executive Telemetry…
          </div>
        )}
      </motion.div>
      </AnimatePresence>
    </div>
  );
};
