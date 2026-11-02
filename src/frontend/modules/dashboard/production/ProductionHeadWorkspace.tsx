'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Loader2, Calendar, AlertCircle, Activity, Database, History } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PageLoader } from '@/components/ui/spinner';
import { ProductionHeadKpiCards } from './ProductionHeadKpiCards';
import { TeamStationActionCards } from './TeamStationActionCards';
import { SubordinateWorkHistoryFeed } from './SubordinateWorkHistoryFeed';
import { PlantSiloInventoryGrid } from './PlantSiloInventoryGrid';
import type { ProductionHeadOverviewResult } from '@/backend/services/productionHeadOverviewService';
import type { User } from '@/backend/core/types';

export type ProductionHeadTab = 'OVERVIEW' | 'SILOS' | 'HISTORY';

interface ProductionHeadWorkspaceProps {
  currentUser: User;
  activeTab?: ProductionHeadTab;
  onTabChange?: (tab: ProductionHeadTab) => void;
}

export const ProductionHeadWorkspace: React.FC<ProductionHeadWorkspaceProps> = ({
  currentUser: _currentUser,
  activeTab: controlledTab,
  onTabChange,
}) => {
  const [internalTab, setInternalTab] = useState<ProductionHeadTab>('OVERVIEW');
  const currentTab = controlledTab ?? internalTab;

  const handleTabChange = (tab: ProductionHeadTab) => {
    setInternalTab(tab);
    if (onTabChange) onTabChange(tab);
  };

  const [data, setData] = useState<ProductionHeadOverviewResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async (isSilent = false) => {
    if (!isSilent) setLoading(true);
    else setRefreshing(true);
    setError(null);

    try {
      const res = await fetch('/api/production-head/overview');
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || `HTTP ${res.status}`);
      }
      const json: ProductionHeadOverviewResult = await res.json();
      setData(json);
    } catch (err: any) {
      console.error('Failed to load production head overview:', err);
      setError(err.message || 'Failed to load production overview');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchData();

    const interval = setInterval(() => {
      fetchData(true);
    }, 20000);

    return () => clearInterval(interval);
  }, [fetchData]);

  const viewMetadata = useMemo(() => {
    switch (currentTab) {
      case 'SILOS':
        return {
          title: 'Plant Silo Inventory',
          subtitle: 'Storage volume, @13% TS metrics, capacity utilization & CIP state',
        };
      case 'HISTORY':
        return {
          title: 'Subordinate Station Audits',
          subtitle: 'Weighbridge scale weighments and silo offloading events',
        };
      case 'OVERVIEW':
      default:
        return {
          title: 'Live Station Oversight',
          subtitle: 'Real-time plant intake, active scale operations & silo reception bays',
        };
    }
  }, [currentTab]);

  if (loading && !data) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[40vh]">
        <PageLoader label="Loading Production Hub…" />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-center space-y-3 max-w-lg mx-auto">
        <AlertCircle className="h-7 w-7 text-destructive mx-auto" />
        <h3 className="text-base font-bold text-foreground">Failed to Load Command Data</h3>
        <p className="text-xs text-muted-foreground">{error}</p>
        <Button onClick={() => fetchData()} size="sm" variant="outline" className="text-xs min-h-11 px-4">
          Try Again
        </Button>
      </div>
    );
  }

  return (
    <div className="w-full max-w-7xl mx-auto space-y-4">
      {/* 1. Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-border/60">
        <div>
          <h2 className="text-lg sm:text-xl font-bold tracking-tight text-foreground">
            {viewMetadata.title}
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {viewMetadata.subtitle}
          </p>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-center">
          {data && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border/70 bg-card text-xs text-muted-foreground shadow-2xs">
              <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
              <span>Business Day:</span>
              <strong className="text-foreground font-mono">{data.businessDate}</strong>
            </div>
          )}

          <Button
            onClick={() => fetchData(true)}
            size="sm"
            variant="outline"
            disabled={refreshing}
            className="min-h-9 h-9 w-9 p-0 rounded-lg text-muted-foreground hover:text-foreground"
            title="Refresh data"
          >
            <Loader2 className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {/* 2. Mobile View Switcher (Only on screens < 1024px; desktop uses Left Sidebar) */}
      <div className="lg:hidden flex items-center p-1 rounded-xl border border-border bg-muted/30 text-xs font-semibold">
        <button
          type="button"
          onClick={() => handleTabChange('OVERVIEW')}
          className={`flex-1 min-h-10 py-2 px-2 rounded-lg flex items-center justify-center gap-1.5 transition-all ${
            currentTab === 'OVERVIEW'
              ? 'bg-background text-foreground shadow-2xs font-bold'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <Activity className="h-3.5 w-3.5" />
          <span>Live Stations</span>
        </button>
        <button
          type="button"
          onClick={() => handleTabChange('SILOS')}
          className={`flex-1 min-h-10 py-2 px-2 rounded-lg flex items-center justify-center gap-1.5 transition-all ${
            currentTab === 'SILOS'
              ? 'bg-background text-foreground shadow-2xs font-bold'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <Database className="h-3.5 w-3.5" />
          <span>Plant Silos</span>
          {data && (
            <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-muted text-foreground">
              {data.silos.length}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={() => handleTabChange('HISTORY')}
          className={`flex-1 min-h-10 py-2 px-2 rounded-lg flex items-center justify-center gap-1.5 transition-all ${
            currentTab === 'HISTORY'
              ? 'bg-background text-foreground shadow-2xs font-bold'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <History className="h-3.5 w-3.5" />
          <span>Staff History</span>
        </button>
      </div>

      {/* 3. Tab View Content */}
      {data && (
        <div className="pt-1">
          {currentTab === 'OVERVIEW' && (
            <div className="space-y-4">
              {/* KPI Stat Cards */}
              <ProductionHeadKpiCards
                kpis={data.kpis}
                waitingForGrossCount={data.teamStations.weighbridge.waitingForGrossCount}
                waitingForTareCount={data.teamStations.weighbridge.waitingForTareCount}
              />

              {/* Real-time Subordinate Stations Oversight */}
              <TeamStationActionCards stations={data.teamStations} />
            </div>
          )}

          {currentTab === 'SILOS' && (
            <PlantSiloInventoryGrid silos={data.silos} />
          )}

          {currentTab === 'HISTORY' && (
            <SubordinateWorkHistoryFeed history={data.subordinateWorkHistory} />
          )}
        </div>
      )}
    </div>
  );
};
