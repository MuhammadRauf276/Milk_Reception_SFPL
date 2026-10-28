'use client';

import React from 'react';
import { User } from '@core/types';
import { WeighbridgeUnifiedStation } from './WeighbridgeUnifiedStation';
import type { WeighbridgeTab } from './weighbridgeTypes';

export type { WeighbridgeTab };

interface WeighbridgeWorkspaceProps {
  currentUser?: User | null;
  activeTab?: WeighbridgeTab;
  onTabChange?: (tab: WeighbridgeTab) => void;
}

export const WeighbridgeWorkspace: React.FC<WeighbridgeWorkspaceProps> = () => {
  return (
    <div className="w-full max-w-7xl mx-auto space-y-6 text-foreground">
      <WeighbridgeUnifiedStation />
    </div>
  );
};
