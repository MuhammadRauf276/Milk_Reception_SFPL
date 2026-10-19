'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { MilkProcessLog, User } from '@backend/core/types';
import { ContractorOverview } from './contractor/ContractorOverview';
import { ContractorLivePipeline } from './contractor/ContractorLivePipeline';
import { ContractorQualityRejections } from './contractor/ContractorQualityRejections';
import { ContractorReceiptsReconciliation } from './contractor/ContractorReceiptsReconciliation';
import { ContractorHistoryReports } from './contractor/ContractorHistoryReports';
import { PlantContractorTab } from './contractor/contractorManagerTypes';
import {
  Building2,
  Calendar,
  AlertCircle,
} from 'lucide-react';
import { getErrorMessage } from '@/lib/errors';

interface PlantContractorManagerWorkspaceProps {
  currentUser: User | null;
  activeTab?: PlantContractorTab;
  onTabChange?: (tab: PlantContractorTab) => void;
}

export const PlantContractorManagerWorkspace: React.FC<PlantContractorManagerWorkspaceProps> = ({
  currentUser,
  activeTab: controlledTab,
  onTabChange,
}) => {
  const [internalTab, setInternalTab] = useState<PlantContractorTab>('OVERVIEW');
  const activeTab = controlledTab !== undefined ? controlledTab : internalTab;

  const setActiveTab = (tab: PlantContractorTab) => {
    if (tab !== activeTab) setLoading(true);
    setInternalTab(tab);
    if (onTabChange) onTabChange(tab);
  };
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

  const loadLogs = useCallback(
    (targetPage: number = 1) => {
      const mode = activeTab === 'LIVE' ? 'live' : 'recent';
      const params = new URLSearchParams();
      params.append('mode', mode);
      params.append('page', String(targetPage));
      params.append('pageSize', String(pageSize));

      return fetch(`/api/logs?${params.toString()}`)
        .then(async (res) => {
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
          setError(null);
        })
        .catch((err) => {
          setError(getErrorMessage(err) || 'Failed to load contractor operational logs');
        })
        .finally(() => {
          setLoading(false);
        });
    },
    [activeTab, pageSize]
  );

  // User-initiated reloads show the loading state; the mount/tab effect does not need to.
  const fetchLogs = (targetPage: number = 1) => {
    setLoading(true);
    setError(null);
    return loadLogs(targetPage);
  };

  useEffect(() => {
    loadLogs(1);
  }, [loadLogs]);

  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-hidden w-full max-w-full">
      <div className="bg-card border-b px-4 sm:px-6 py-4 shrink-0">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <div className="flex items-center space-x-2 flex-wrap">
                <span className="px-2 py-0.5 rounded-md text-[11px] font-medium bg-primary/10 text-primary">
                  Direct-to-plant supplier
                </span>
                <span className="text-xs text-slate-400 font-semibold">·</span>
                <span className="text-xs font-semibold text-slate-700 flex items-center space-x-1">
                  <Building2 className="w-3.5 h-3.5 text-primary shrink-0" />
                  <span>{assignedSourceName}</span>
                </span>
              </div>
              <h1 className="text-lg font-semibold text-foreground tracking-tight mt-0.5">
                Contractor operations
              </h1>
            </div>

            <div className="flex items-center space-x-2 self-start sm:self-auto">
              {serverBusinessDate && (
                <div className="flex items-center space-x-1.5 px-3 py-1.5 bg-subtle border border-border-strong rounded-xl text-xs tabular-nums font-semibold text-slate-700 shadow-2xs">
                  <Calendar className="w-3.5 h-3.5 text-primary" />
                  <span>{serverBusinessDate}</span>
                </div>
              )}
              <button
                type="button"
                onClick={() => fetchLogs(page)}
                disabled={loading}
                className="flex items-center space-x-1.5 px-3.5 py-2 min-h-[44px] bg-subtle hover:bg-muted/60 border border-border-strong rounded-xl text-xs font-semibold text-foreground shadow-2xs transition active:scale-95 disabled:opacity-50"
              >
                <span>Refresh</span>
              </button>
            </div>
          </div>

        </div>

        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
          {error && (
            <div className="p-4 mb-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-semibold flex items-center space-x-2 shadow-xs animate-panel-in">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div key={activeTab} className="animate-panel-in">
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
          </div>

          {activeTab !== 'HISTORY' && totalRecords > 0 && (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 bg-white border border-border-strong rounded-xl text-xs shadow-2xs mt-4">
              <div className="text-slate-600 font-medium">
                Showing page <span className="font-semibold text-slate-900">{page}</span> of{' '}
                <span className="font-semibold text-slate-900">{totalPages}</span>{' '}
                (<span className="font-semibold text-slate-900">{totalRecords}</span> total visits)
                {totalPages > 1 && (
                  <span className="ml-2 text-[11px] text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                    Bounded view · navigate pages for older records
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
                  className="px-3.5 py-1.5 min-h-[36px] bg-subtle hover:bg-muted/60 border border-border-strong rounded-lg font-semibold text-foreground disabled:opacity-40 disabled:cursor-not-allowed transition"
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
                  className="px-3.5 py-1.5 min-h-[36px] bg-subtle hover:bg-muted/60 border border-border-strong rounded-lg font-semibold text-foreground disabled:opacity-40 disabled:cursor-not-allowed transition"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };
