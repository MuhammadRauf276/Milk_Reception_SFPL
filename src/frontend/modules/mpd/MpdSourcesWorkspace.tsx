'use client';

import React, { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { Milk, Truck } from 'lucide-react';
import { fetchJson } from '@/lib/query/fetchJson';
import { PageHeader } from '@/components/ui/page-header';
import { Spinner } from '@/components/ui/spinner';
import { MilkSourcesPanel } from '@/frontend/modules/mpd/sources/MilkSourcesPanel';
import { ContractorsPanel } from '@/frontend/modules/mpd/sources/ContractorsPanel';
import type {
  ErpSourceItem,
  ZmccOption,
  ContractorItem,
  SourceFeedback,
} from '@/frontend/modules/mpd/sources/sourceTypes';

/** Milk Sources (name + ERP code) and plant Contractors. Used by MPD Head, Data Executive and Super Admin only. */
export function MpdSourcesWorkspace() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeSubTab: 'SOURCES' | 'CONTRACTORS' =
    searchParams?.get('view')?.toUpperCase() === 'CONTRACTORS' ? 'CONTRACTORS' : 'SOURCES';
  const setActiveSubTab = (tab: 'SOURCES' | 'CONTRACTORS') =>
    router.replace(tab === 'CONTRACTORS' ? '/sources?view=CONTRACTORS' : '/sources');
  const [feedback, setFeedback] = useState<SourceFeedback>(null);
  const queryClient = useQueryClient();

  const sourcesQuery = useQuery({
    queryKey: ['mpd', 'erp-sources'],
    queryFn: ({ signal }) =>
      fetchJson<{ erp_sources?: ErpSourceItem[] }>('/api/mpd/sources/erp-sources', { signal, cache: 'no-store' }),
  });

  const zmccsQuery = useQuery({
    queryKey: ['mpd', 'zmcc-sources'],
    queryFn: ({ signal }) =>
      fetchJson<{ zmccs?: ZmccOption[] }>('/api/zmcc/sources', { signal, cache: 'no-store' }),
  });

  const contractorsQuery = useQuery({
    queryKey: ['mpd', 'contractors'],
    queryFn: ({ signal }) =>
      fetchJson<{ contractors?: ContractorItem[] }>('/api/mpd/sources/contractors', { signal, cache: 'no-store' }),
  });

  const sources: ErpSourceItem[] = useMemo(() => sourcesQuery.data?.erp_sources ?? [], [sourcesQuery.data]);
  const zmccOptions: ZmccOption[] = useMemo(() => zmccsQuery.data?.zmccs ?? [], [zmccsQuery.data]);
  const contractors: ContractorItem[] = useMemo(
    () => contractorsQuery.data?.contractors ?? [],
    [contractorsQuery.data]
  );

  const handleChanged = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['mpd', 'erp-sources'] }),
      queryClient.invalidateQueries({ queryKey: ['mpd', 'contractors'] }),
    ]);
  };

  const isLoading = sourcesQuery.isPending || zmccsQuery.isPending || contractorsQuery.isPending;

  const tabClass = (active: boolean) =>
    `min-h-11 px-4 py-2 rounded-lg text-xs font-bold transition flex items-center gap-2 ${
      active ? 'bg-primary text-white shadow-xs' : 'text-slate-600 hover:bg-slate-100'
    }`;

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <PageHeader
        title="Milk Sources & Contractors"
      />

      <AnimatePresence>
        {feedback && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            className={`p-3.5 rounded-xl border text-xs font-semibold flex items-center justify-between gap-3 ${
              feedback.type === 'success'
                ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                : 'bg-rose-50 text-rose-800 border-rose-300'
            }`}
          >
            <span>{feedback.message}</span>
            <button type="button" onClick={() => setFeedback(null)} className="min-h-11 px-2 text-xs opacity-70 hover:opacity-100 min-w-11">
              Dismiss
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex items-center gap-2 border-b border-border pb-2 overflow-x-auto lg:hidden">
        <button type="button" onClick={() => setActiveSubTab('SOURCES')} className={tabClass(activeSubTab === 'SOURCES')}>
          <Milk className="w-4 h-4" />
          <span>Milk Sources ({sources.length})</span>
        </button>
        <button type="button" onClick={() => setActiveSubTab('CONTRACTORS')} className={tabClass(activeSubTab === 'CONTRACTORS')}>
          <Truck className="w-4 h-4" />
          <span>Contractors ({contractors.length})</span>
        </button>
      </div>

      {isLoading ? (
        <div className="bg-card border-border flex items-center justify-center p-12 rounded-xl border">
          <Spinner className="w-6 h-6 text-primary" />
          <span className="ml-2 text-xs text-slate-500 font-medium">Loading…</span>
        </div>
      ) : activeSubTab === 'SOURCES' ? (
        <MilkSourcesPanel sources={sources} zmccOptions={zmccOptions} onFeedback={setFeedback} onChanged={handleChanged} />
      ) : (
        <ContractorsPanel contractors={contractors} onFeedback={setFeedback} onChanged={handleChanged} />
      )}
    </div>
  );
}
