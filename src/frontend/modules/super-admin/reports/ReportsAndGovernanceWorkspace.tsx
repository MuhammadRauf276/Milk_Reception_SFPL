'use client';

import React, { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  FileSpreadsheet,
  UserCheck,
  AlertTriangle,
  Layers,
} from 'lucide-react';
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

  const handleTabChange = (tab: ReportSubTab) => {
    const sp = new URLSearchParams(searchParams.toString());
    sp.set('tab', tab);
    router.push(`/super-admin/reports?${sp.toString()}`);
  };

  return (
    <div className="w-full max-w-full space-y-4 overflow-x-hidden p-1">
      {/* Sub-Tabs Navigation Bar */}
      <div className="flex items-center gap-1 rounded-2xl border border-slate-200 bg-white p-1.5 shadow-2xs">
        <button
          type="button"
          onClick={() => handleTabChange('daily')}
          className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition ${
            activeTab === 'daily'
              ? 'bg-primary text-white shadow-2xs'
              : 'bg-transparent text-slate-600 hover:bg-slate-50 hover:text-slate-900'
          }`}
        >
          <FileSpreadsheet className="h-4 w-4" />
          <span>Daily Quality & Operations</span>
        </button>

        <button
          type="button"
          onClick={() => handleTabChange('hierarchy')}
          className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition ${
            activeTab === 'hierarchy'
              ? 'bg-primary text-white shadow-2xs'
              : 'bg-transparent text-slate-600 hover:bg-slate-50 hover:text-slate-900'
          }`}
        >
          <UserCheck className="h-4 w-4" />
          <span>Work for Lower Roles</span>
        </button>

        <button
          type="button"
          onClick={() => handleTabChange('warnings')}
          className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition ${
            activeTab === 'warnings'
              ? 'bg-primary text-white shadow-2xs'
              : 'bg-transparent text-slate-600 hover:bg-slate-50 hover:text-slate-900'
          }`}
        >
          <AlertTriangle className="h-4 w-4" />
          <span>Warning Limits & Policy</span>
        </button>
      </div>

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
    <Suspense fallback={<div className="p-8 text-xs font-semibold text-slate-500">Loading Executive Reports…</div>}>
      <ReportsContent />
    </Suspense>
  );
}
