'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { MilkProcessLog, User } from '@backend/core/types';
import { Sidebar } from '@modules/shared/Sidebar';
import { Header } from '@modules/shared/Header';
import { ContractorOverview } from './contractor/ContractorOverview';
import { ContractorLivePipeline } from './contractor/ContractorLivePipeline';
import { ContractorQualityRejections } from './contractor/ContractorQualityRejections';
import { ContractorReceiptsReconciliation } from './contractor/ContractorReceiptsReconciliation';
import { ContractorHistoryReports } from './contractor/ContractorHistoryReports';
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

const TABS: { id: PlantContractorTab; label: string; icon: React.FC<{ className?: string }> }[] = [
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
  const [page, setPage] = useState<number>(1);
  const [pageSize] = useState<number>(20);
  const [totalPages, setTotalPages] = useState<number>(1);
  const [totalRecords, setTotalRecords] = useState<number>(0);
  const [hasMore, setHasMore] = useState<boolean>(false);
  const [summary, setSummary] = useState<{
    totalVisits?: number;
    completedVisits?: number;
    activeInPlantVisits?: number;
  } | null>(null);

  const assignedSourceName = useMemo(() => {
    return currentUser?.zone || currentUser?.department || 'Assigned Plant Contractor';
  }, [currentUser]);

  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);

  const activePipelineCount = useMemo(() => {
    return logs.filter((l) => !l.final_receipt_exists && l.status !== 'CANCELLED').length;
  }, [logs]);

  const fetchLogs = useCallback(
    async (targetPage: number = 1) => {
      setLoading(true);
      setError(null);
      try {
        const mode = activeTab === 'LIVE' ? 'live' : 'recent';
        const params = new URLSearchParams();
        params.append('mode', mode);
        params.append('page', String(targetPage));
        params.append('pageSize', String(pageSize));

        const res = await fetch(`/api/logs?${params.toString()}`);
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || 'Failed to fetch operational logs');
        }
        const items = data.items || data.logs;
        if (items) {
          setLogs(items);
        }
        if (data.pagination) {
          setPage(data.pagination.page || targetPage);
          setTotalPages(data.pagination.totalPages || data.pagination.total_pages || 1);
          setTotalRecords(data.pagination.totalRecords || data.pagination.total_count || 0);
          setHasMore(Boolean(data.pagination.hasMore ?? data.pagination.has_more));
        }
        if (data.summary) {
          setSummary(data.summary);
        }
        if (data.serverBusinessDate) {
          setServerBusinessDate(data.serverBusinessDate);
        }
      } catch (err: any) {
        setError(err.message || 'Failed to load contractor operational logs');
      } finally {
        setLoading(false);
      }
    },
    [activeTab, pageSize]
  );

  useEffect(() => {
    fetchLogs(1);
  }, [fetchLogs]);

  return (
    <div className="w-full max-w-full flex h-screen bg-[#FDFBF9] text-[#111311] overflow-hidden font-sans">
      {/* Shared Application Sidebar Drawer */}
      <Sidebar
        currentUser={currentUser}
        activeCount={activePipelineCount}
        isMobileOpen={isMobileNavOpen}
        onCloseMobile={() => setIsMobileNavOpen(false)}
      />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden w-full max-w-full">
        {/* Header */}
        <Header
          currentUser={currentUser}
          title="Plant Contractor Manager Station"
          onMenuClick={() => setIsMobileNavOpen((prev) => !prev)}
        />

        {/* Workspace Toolbar */}
        <div className="bg-white border-b border-[#C4B9A3] px-4 sm:px-6 py-3.5 shrink-0 shadow-xs">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <div className="flex items-center space-x-2 flex-wrap">
                <span className="px-2 py-0.5 rounded-md text-[10px] font-black bg-blue-100 text-[#1E3A8A] uppercase tracking-wider border border-blue-200">
                  Direct-to-Plant Supplier
                </span>
                <span className="text-xs text-slate-400 font-bold">•</span>
                <span className="text-xs font-bold text-slate-700 flex items-center space-x-1">
                  <Building2 className="w-3.5 h-3.5 text-[#1E3A8A] shrink-0" />
                  <span>{assignedSourceName}</span>
                </span>
              </div>
              <h1 className="text-lg font-black text-[#111311] tracking-tight mt-0.5">
                Plant Contractor Manager Station
              </h1>
            </div>

            <div className="flex items-center space-x-2 self-start sm:self-auto">
              {serverBusinessDate && (
                <div className="flex items-center space-x-1.5 px-3 py-1.5 bg-[#FDFBF9] border border-[#C4B9A3] rounded-xl text-xs font-mono font-bold text-slate-700 shadow-xs">
                  <Calendar className="w-3.5 h-3.5 text-[#1E3A8A]" />
                  <span>{serverBusinessDate}</span>
                </div>
              )}
              <button
                type="button"
                onClick={() => fetchLogs(page)}
                disabled={loading}
                className="flex items-center space-x-1.5 px-3.5 py-2 min-h-[44px] bg-[#FDFBF9] hover:bg-[#EFE9D9]/60 border border-[#C4B9A3] rounded-xl text-xs font-black text-[#111311] shadow-xs transition active:scale-95 disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 text-[#1E3A8A] ${loading ? 'animate-spin' : ''}`} />
                <span>Refresh</span>
              </button>
            </div>
          </div>

          {/* Navigation Tab Strip */}
          <div className="flex items-center space-x-1.5 mt-3.5 overflow-x-auto scrollbar-thin -mb-px pt-1">
            {TABS.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => {
                    setActiveTab(tab.id);
                    setPage(1);
                  }}
                  className={`flex items-center space-x-2 px-4 py-2.5 min-h-[44px] text-xs font-black rounded-t-xl border-t border-l border-r whitespace-nowrap transition shrink-0 ${
                    isActive
                      ? 'border-[#C4B9A3] text-[#1E3A8A] bg-[#FDFBF9] shadow-xs'
                      : 'border-transparent text-slate-600 hover:text-[#111311] hover:bg-[#EFE9D9]/40'
                  }`}
                >
                  <Icon className={`w-4 h-4 ${isActive ? 'text-[#1E3A8A]' : 'text-slate-500'}`} />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Tab Content Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 bg-[#FDFBF9] space-y-6">
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
              pagination={{
                page,
                totalPages,
                totalRecords,
                hasMore,
              }}
              summary={summary || undefined}
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

          {activeTab === 'HISTORY' && (
            <ContractorHistoryReports
              initialLogs={logs}
              serverBusinessDate={serverBusinessDate}
              assignedSourceName={assignedSourceName}
            />
          )}

          {/* Pagination bar for non-history tabs */}
          {activeTab !== 'HISTORY' && totalRecords > 0 && (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 bg-white border border-[#C4B9A3] rounded-xl text-xs shadow-xs mt-4">
              <div className="text-slate-600 font-medium">
                Showing page <span className="font-bold text-slate-900">{page}</span> of{' '}
                <span className="font-bold text-slate-900">{totalPages}</span>{' '}
                (<span className="font-bold text-slate-900">{totalRecords}</span> total visits)
                {totalPages > 1 && (
                  <span className="ml-2 text-[11px] text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                    Bounded view • navigate pages for older records
                  </span>
                )}
              </div>
              <div className="flex items-center space-x-2">
                <button
                  type="button"
                  onClick={() => {
                    const prevPage = Math.max(1, page - 1);
                    fetchLogs(prevPage);
                  }}
                  disabled={page <= 1 || loading}
                  className="px-3.5 py-1.5 min-h-[36px] bg-[#FDFBF9] hover:bg-[#EFE9D9]/60 border border-[#C4B9A3] rounded-lg font-bold text-[#111311] disabled:opacity-40 disabled:cursor-not-allowed transition"
                >
                  Previous
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const nextPage = Math.min(totalPages, page + 1);
                    fetchLogs(nextPage);
                  }}
                  disabled={page >= totalPages || !hasMore || loading}
                  className="px-3.5 py-1.5 min-h-[36px] bg-[#FDFBF9] hover:bg-[#EFE9D9]/60 border border-[#C4B9A3] rounded-lg font-bold text-[#111311] disabled:opacity-40 disabled:cursor-not-allowed transition"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
