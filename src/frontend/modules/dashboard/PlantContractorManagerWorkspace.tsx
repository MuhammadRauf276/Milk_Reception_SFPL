'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { MilkProcessLog, User } from '@backend/core/types';
import { Sidebar } from '@modules/shared/Sidebar';
import { Header } from '@modules/shared/Header';
import { ContractorOverview } from './contractor/ContractorOverview';
import { ContractorLivePipeline } from './contractor/ContractorLivePipeline';
import { ContractorQualityRejections } from './contractor/ContractorQualityRejections';
import { ContractorReceiptsReconciliation } from './contractor/ContractorReceiptsReconciliation';
import { PlantContractorTab } from './contractor/contractorManagerTypes';
import {
  LayoutDashboard,
  Truck,
  FlaskConical,
  Receipt,
  History,
  RefreshCw,
  Building2,
  Calendar,
  AlertCircle,
} from 'lucide-react';

interface PlantContractorManagerWorkspaceProps {
  currentUser: User | null;
}

const TABS: { id: PlantContractorTab; label: string; icon: React.FC<any> }[] = [
  { id: 'OVERVIEW', label: 'Overview', icon: LayoutDashboard },
  { id: 'LIVE', label: 'Live Pipeline', icon: Truck },
  { id: 'QUALITY', label: 'Quality & Rejections', icon: FlaskConical },
  { id: 'RECEIPTS', label: 'Receipts & Reconciliation', icon: Receipt },
  { id: 'HISTORY', label: 'History & Reports', icon: History },
];

export const PlantContractorManagerWorkspace: React.FC<PlantContractorManagerWorkspaceProps> = ({
  currentUser,
}) => {
  const [activeTab, setActiveTab] = useState<PlantContractorTab>('OVERVIEW');
  const [serverBusinessDate, setServerBusinessDate] = useState<string>('');
  const [logs, setLogs] = useState<MilkProcessLog[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const assignedSourceName = useMemo(() => {
    return currentUser?.zone || currentUser?.department || 'Assigned Plant Contractor';
  }, [currentUser]);

  const activePipelineCount = useMemo(() => {
    return logs.filter((l) => !l.final_receipt_exists && l.status !== 'CANCELLED').length;
  }, [logs]);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/logs');
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to fetch operational logs');
      }
      if (data.logs) {
        setLogs(data.logs);
      }
      if (data.serverBusinessDate) {
        setServerBusinessDate(data.serverBusinessDate);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load contractor operational logs');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  return (
    <div className="flex h-screen bg-[#FDFBF9] overflow-hidden">
      {/* Shared Application Sidebar */}
      <Sidebar
        currentUser={currentUser}
        activeCount={activePipelineCount}
      />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Header */}
        <Header
          currentUser={currentUser}
          title="Plant Contractor Manager Station"
        />

        {/* Workspace Toolbar */}
        <div className="bg-[#FAF6F0] border-b border-[#EAE4D5] px-4 sm:px-6 py-3 shrink-0">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <div className="flex items-center space-x-2">
                <span className="px-2 py-0.5 rounded text-[10px] font-black bg-blue-100 text-blue-900 uppercase tracking-widest border border-blue-200">
                  Direct-to-Plant Supplier
                </span>
                <span className="text-xs text-slate-500 font-bold">•</span>
                <span className="text-xs font-bold text-slate-700 flex items-center space-x-1">
                  <Building2 className="w-3.5 h-3.5 text-blue-700 shrink-0" />
                  <span>{assignedSourceName}</span>
                </span>
              </div>
              <h1 className="text-lg font-black text-slate-900 tracking-tight mt-0.5">
                Plant Contractor Manager Station
              </h1>
            </div>

            <div className="flex items-center space-x-2 self-start sm:self-auto">
              {serverBusinessDate && (
                <div className="flex items-center space-x-1.5 px-2.5 py-1 bg-white border border-[#EAE4D5] rounded-lg text-xs font-mono font-bold text-slate-700 shadow-sm">
                  <Calendar className="w-3.5 h-3.5 text-blue-700" />
                  <span>{serverBusinessDate}</span>
                </div>
              )}
              <button
                type="button"
                onClick={fetchLogs}
                disabled={loading}
                className="flex items-center space-x-1 px-3 py-1.5 min-h-[38px] bg-white hover:bg-slate-50 border border-[#C4B9A3] rounded-lg text-xs font-bold text-slate-700 shadow-sm transition active:scale-95 disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                <span>Refresh</span>
              </button>
            </div>
          </div>

          {/* Navigation Tab Strip */}
          <div className="flex items-center space-x-1 mt-3 overflow-x-auto scrollbar-thin scroll-smooth -mb-px pt-1">
            {TABS.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center space-x-2 px-3.5 py-2 min-h-[44px] text-xs font-bold rounded-t-lg border-b-2 whitespace-nowrap transition shrink-0 ${
                    isActive
                      ? 'border-blue-900 text-blue-900 bg-white shadow-sm'
                      : 'border-transparent text-slate-600 hover:text-slate-900 hover:bg-white/50'
                  }`}
                >
                  <Icon className={`w-4 h-4 ${isActive ? 'text-blue-900' : 'text-slate-500'}`} />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Tab Content Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 bg-slate-50/50">
          {error && (
            <div className="p-4 mb-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-bold flex items-center space-x-2 shadow-sm">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {activeTab === 'OVERVIEW' && (
            <ContractorOverview
              logs={logs}
              serverBusinessDate={serverBusinessDate}
              assignedSourceName={assignedSourceName}
              isLoading={loading}
              error={error}
            />
          )}

          {activeTab === 'LIVE' && (
            <ContractorLivePipeline
              logs={logs}
              assignedSourceName={assignedSourceName}
              isLoading={loading}
              error={error}
            />
          )}

          {activeTab === 'QUALITY' && (
            <ContractorQualityRejections
              logs={logs}
              serverBusinessDate={serverBusinessDate}
              assignedSourceName={assignedSourceName}
              isLoading={loading}
              error={error}
            />
          )}

          {activeTab === 'RECEIPTS' && (
            <ContractorReceiptsReconciliation
              logs={logs}
              serverBusinessDate={serverBusinessDate}
              assignedSourceName={assignedSourceName}
              isLoading={loading}
              error={error}
            />
          )}

          {activeTab !== 'OVERVIEW' &&
            activeTab !== 'LIVE' &&
            activeTab !== 'QUALITY' &&
            activeTab !== 'RECEIPTS' && (
              <div className="bg-white rounded-2xl border border-[#EAE4D5] p-8 text-center space-y-3 shadow-sm">
                <div className="p-3 bg-blue-50 text-blue-800 rounded-full w-12 h-12 flex items-center justify-center mx-auto">
                  <Building2 className="w-6 h-6" />
                </div>
                <h3 className="text-base font-extrabold text-slate-900">
                  {TABS.find((t) => t.id === activeTab)?.label}
                </h3>
                <p className="text-xs text-slate-500 max-w-sm mx-auto font-medium">
                  Available in the next Stage 4F implementation slice.
                </p>
              </div>
            )}
        </div>
      </div>
    </div>
  );
};
