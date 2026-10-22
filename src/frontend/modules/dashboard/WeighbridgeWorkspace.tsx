import React, { useState } from 'react';
import { User } from '@core/types';
import { PageHeader } from '@/components/ui/page-header';
import { SegmentedTabs } from '@/components/ui/segmented-tabs';
import { Scale, Truck } from 'lucide-react';
import { WeighbridgeFirstWeightPanel } from './WeighbridgeFirstWeightPanel';
import { WeighbridgeSecondWeightPanel } from './WeighbridgeSecondWeightPanel';
import type { WeighbridgeTab } from './weighbridgeTypes';

export type { WeighbridgeTab };

interface WeighbridgeWorkspaceProps {
  currentUser?: User | null;
  activeTab?: WeighbridgeTab;
  onTabChange?: (tab: WeighbridgeTab) => void;
}

export const WeighbridgeWorkspace: React.FC<WeighbridgeWorkspaceProps> = ({
  activeTab: controlledTab,
  onTabChange,
}) => {
  const [internalTab, setInternalTab] = useState<WeighbridgeTab>('FIRST_WEIGHT');
  const activeTab = controlledTab !== undefined ? controlledTab : internalTab;

  const handleTabChange = (tab: WeighbridgeTab) => {
    setInternalTab(tab);
    if (onTabChange) onTabChange(tab);
  };

  return (
    <div className="w-full max-w-7xl mx-auto space-y-6 text-foreground">
      <PageHeader
        title={
          activeTab === 'FIRST_WEIGHT'
            ? 'Weighbridge · First Weight (Gross)'
            : 'Weighbridge · Second Weight (Tare)'
        }
        description={
          activeTab === 'FIRST_WEIGHT'
            ? 'Record first (loaded vehicle) gross weight on Scale 1 and lock operational business date.'
            : 'Record second (empty / tare) weight on Scale 2 after silo unloading.'
        }
      />

      <SegmentedTabs
        tabs={[
          {
            value: 'FIRST_WEIGHT',
            label: 'Scale 1 · First Weight (Gross)',
            icon: Truck,
          },
          {
            value: 'SECOND_WEIGHT',
            label: 'Scale 2 · Second Weight (Tare)',
            icon: Scale,
          },
        ]}
        value={activeTab}
        onValueChange={handleTabChange}
        label="Weighbridge Scales"
      />

      {activeTab === 'FIRST_WEIGHT' && <WeighbridgeFirstWeightPanel />}
      {activeTab === 'SECOND_WEIGHT' && <WeighbridgeSecondWeightPanel />}
    </div>
  );
};
