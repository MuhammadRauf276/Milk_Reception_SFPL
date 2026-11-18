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
      setError(err.message || 'Overview did not load');
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
          title: 'Plant silos',
          subtitle: 'Stock, @13 TS and capacity',
        };
      case 'HISTORY':
        return {
          title: 'Station audits',
          subtitle: 'Weighments and unloadings',
        };
      case 'OVERVIEW':
      default:
        return {
          title: 'Live stations',
          subtitle: 'Intake, scale and silo bays',
        };
    }
  }, [currentTab]);

  if (loading && !data) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[40dvh]">
        <PageLoader label="Loading…" />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-6 text-center space-y-3 max-w-lg mx-auto">
        <AlertCircle className="h-7 w-7 text-destructive mx-auto" />
        <h3 className="text-base font-semibold text-foreground">Data did not load</h3>
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
          <h2 className="text-lg sm:text-xl font-semibold text-foreground">
            {viewMetadata.title}
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {viewMetadata.subtitle}
          </p>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-center">
          {data && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border/70 bg-card text-xs text-muted-foreground shadow-2xs">
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
            className="min-h-9 h-9 w-9 shrink-0 p-0 rounded-lg text-muted-foreground hover:text-foreground"
            title="Refresh data"
          >
            <Loader2 className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {/* 2. Mobile View Switcher (Only on screens < 1024px; desktop uses Left Sidebar) */}

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
