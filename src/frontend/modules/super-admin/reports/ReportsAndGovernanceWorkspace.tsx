'use client';

import React, { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  FileSpreadsheet,
  UserCheck,
  AlertTriangle,
  Layers,
} from 'lucide-react';
import { SkeletonTable } from '@/components/ui/loaders';
import { DailyReportDashboard } from '../daily-report/DailyReportDashboard';
import { HierarchyWorkView } from './HierarchyWorkView';
import { WarningLimitsGovernanceView } from './WarningLimitsGovernanceView';

export type ReportSubTab = 'daily' | 'hierarchy' | 'warnings';

function ReportsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeTabParam = searchParams.get('tab')?.toLowerCase() as ReportSubTab | null;
  const activeTab: ReportSubTab =
    activeTabParam === 'hierarchy' || activeTabParam === 'warnings' ? activeTabParam : 'daily';

  return (
    <div className="w-full min-w-0 max-w-full space-y-4 p-1">

      {/* Tab Panels */}
      <div className="pt-1">
        {activeTab === 'daily' && <DailyReportDashboard />}
        {activeTab === 'hierarchy' && <HierarchyWorkView />}
        {activeTab === 'warnings' && <WarningLimitsGovernanceView />}
      </div>
    </div>
  );
}

export function ReportsAndGovernanceWorkspace() {
  return (
    <Suspense fallback={<SkeletonTable rows={8} />}>
      <ReportsContent />
    </Suspense>
  );
}
