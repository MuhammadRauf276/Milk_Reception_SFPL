'use client';

import React from 'react';
import { User } from '@core/types';
import { WeighbridgeUnifiedStation } from './WeighbridgeUnifiedStation';
import type { WeighbridgeTab, WeighbridgeFilter } from './weighbridgeTypes';

export type { WeighbridgeTab, WeighbridgeFilter };

interface WeighbridgeWorkspaceProps {
  currentUser?: User | null;
  activeTab?: WeighbridgeFilter | WeighbridgeTab;
  onTabChange?: (tab: WeighbridgeFilter) => void;
}

export const WeighbridgeWorkspace: React.FC<WeighbridgeWorkspaceProps> = ({
  activeTab,
  onTabChange,
}) => {
  const normalizedFilter: WeighbridgeFilter | undefined =
    activeTab === 'FIRST_WEIGHT'
      ? 'SCALE_ACTION'
      : activeTab === 'SECOND_WEIGHT'
      ? 'AT_SILO'
      : activeTab === 'PROGRESSIVE'
      ? 'SCALE_ACTION'
      : activeTab;

  return (
    <div className="w-full max-w-7xl mx-auto space-y-6 text-foreground">
      <WeighbridgeUnifiedStation activeTab={normalizedFilter} onTabChange={onTabChange} />
    </div>
  );
};
