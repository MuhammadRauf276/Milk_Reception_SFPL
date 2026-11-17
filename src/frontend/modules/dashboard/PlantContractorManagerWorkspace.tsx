'use client';

import React, { useState, useMemo } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchJson } from '@/lib/query/fetchJson';
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
import { Pagination, useListPageSize } from '@/components/ui/pagination';
import { ErrorPopup } from '@/components/ui/error-popup';

interface PlantContractorManagerWorkspaceProps {
  currentUser: User | null;
  activeTab?: PlantContractorTab;
  onTabChange?: (tab: PlantContractorTab) => void;
}

export const PlantContractorManagerWorkspace: React.FC<PlantContractorManagerWorkspaceProps> = ({
  currentUser,
  activeTab: controlledTab,

}) => {
  const [internalTab] = useState<PlantContractorTab>('OVERVIEW');
  const activeTab = controlledTab !== undefined ? controlledTab : internalTab;

  const [page, setPage] = useState<number>(1);
  const pageSize = useListPageSize(25);
  const queryClient = useQueryClient();
  type LogsResponse = {
    items?: MilkProcessLog[];
    logs?: MilkProcessLog[];
    pagination?: {
      page?: number; totalPages?: number; total_pages?: number;
      totalRecords?: number; total_count?: number; hasMore?: boolean; has_more?: boolean;
    };
    summary?: { totalVisits?: number; completedVisits?: number; activeInPlantVisits?: number };
    serverBusinessDate?: string;
  };
  const mode = activeTab === 'LIVE' ? 'live' : 'recent';
  const logsQuery = useQuery({
    queryKey: ['contractor', 'plant-logs', { mode, page, pageSize }],
    queryFn: ({ signal }) => {
      const params = new URLSearchParams({ mode, page: String(page), pageSize: String(pageSize) });
      return fetchJson<LogsResponse>(`/api/logs?${params.toString()}`, { signal });
    },
    placeholderData: keepPreviousData,
    refetchInterval: activeTab === 'LIVE' ? 30_000 : false,
  });
  const logsData = logsQuery.data;
  const logs = useMemo(() => logsData?.items ?? logsData?.logs ?? [], [logsData]);
  const loading = logsQuery.isPending;
  const error = logsQuery.isError ? getErrorMessage(logsQuery.error) || 'Logs did not load' : null;
  const totalPages = logsData?.pagination?.totalPages || logsData?.pagination?.total_pages || 1;
  const totalRecords = logsData?.pagination?.totalRecords || logsData?.pagination?.total_count || 0;
  const hasMore = Boolean(logsData?.pagination?.hasMore ?? logsData?.pagination?.has_more);
  const summary = logsData?.summary ?? null;
  const serverBusinessDate = logsData?.serverBusinessDate ?? '';

  const assignedSourceName = useMemo(() => {
    return currentUser?.zone || currentUser?.department || 'Plant contractor';
  }, [currentUser]);

  // Page change or manual reload.
  const fetchLogs = (targetPage: number = 1) => {
    if (targetPage === page) return queryClient.invalidateQueries({ queryKey: ['contractor', 'plant-logs'] });
    setPage(targetPage);
    return Promise.resolve();
  };

  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-hidden w-full max-w-full">
      <div className="bg-card border-b px-4 sm:px-6 py-4 shrink-0">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <div className="flex items-center space-x-2 flex-wrap">
<span className="text-xs font-semibold text-secondary-foreground flex items-center space-x-1">
                  <Building2 className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  <span>{assignedSourceName}</span>
                </span>
              </div>
              <h1 className="text-lg font-semibold text-foreground mt-0.5">
                Contractor operations
              </h1>
            </div>

            <div className="flex items-center space-x-2 self-start sm:self-auto">
              {serverBusinessDate && (
                <div className="flex items-center space-x-1.5 px-3 py-2 bg-subtle border border-border-strong rounded-xl text-xs tabular-nums font-semibold text-secondary-foreground shadow-2xs">
                  <Calendar className="w-3.5 h-3.5 text-muted-foreground" />
                  <span>{serverBusinessDate}</span>
                </div>
              )}
              <button
                type="button"
                onClick={() => fetchLogs(page)}
                disabled={loading}
                className="flex items-center space-x-1.5 px-4 py-2 min-h-11 bg-subtle hover:bg-muted/60 border border-border-strong rounded-xl text-xs font-semibold text-foreground shadow-2xs transition active:scale-95 disabled:opacity-50"
              >
                <span>Refresh</span>
              </button>
            </div>
          </div>

        </div>

        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
          <ErrorPopup message={error} />

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
            <div className="mt-4 bg-card border border-border-strong rounded-xl overflow-hidden shadow-2xs">
              <Pagination
                page={page}
                totalPages={totalPages}
                totalRecords={totalRecords}
                pageSize={pageSize}
                noun="visits"
                disabled={loading}
                onPageChange={(p) => fetchLogs(p)}
              />
            </div>
          )}
        </div>
      </div>
    );
  };
