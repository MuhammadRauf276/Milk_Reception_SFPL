'use client';

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { stationQueryKeys } from '@/lib/query/stationQueryKeys';
import type { User } from '@/backend/core/types';
import { MapPin, Search, Check, ChevronDown, AlertCircle } from 'lucide-react';
import { Modal } from '@/components/ui/modal';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { resolveDelegationContext } from './stations';

export interface ProcurementSourceItem {
  id: string;
  code: string;
  name: string;
  is_active?: boolean;
}

interface SourceContextSelectorProps {
  currentUser: User | null;
  /** Explicit callback when source is selected */
  onSourceChanged?: (source: ProcurementSourceItem) => void;
  /** Pass-through ref to trigger button */
  triggerRef?: React.RefObject<HTMLButtonElement | null>;
  /** Optional custom trigger render */
  renderTriggerOnly?: boolean;
}

export const SourceContextSelector: React.FC<SourceContextSelectorProps> = ({
  currentUser,
  onSourceChanged,
  triggerRef,
  renderTriggerOnly = false,
}) => {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // User manual modal open/close override
  const [modalOverride, setModalOverride] = useState<boolean | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const delegation = resolveDelegationContext(currentUser, pathname, searchParams);
  const isSystemScope =
    currentUser?.role === 'SUPER_ADMIN' ||
    currentUser?.role === 'DATA_EXECUTIVE' ||
    currentUser?.role === 'HEAD_OF_MPD';

  // Only system-wide roles operating regional stations need the selector
  const shouldRender = isSystemScope && delegation.isRegional && delegation.station !== null;

  const currentZmccIdFromUrl =
    searchParams?.get('zmccId') || searchParams?.get('zmcc_id') || searchParams?.get('sourceId');

  const targetSourceType = delegation.station?.targetSourceType;
  const endpoint =
    targetSourceType === 'CONTRACTOR'
      ? '/api/zmcc/arrivals/contractors'
      : '/api/zmcc/sources';

  const sourcesQuery = useQuery({
    queryKey: stationQueryKeys.zmcc.sources(targetSourceType ?? 'ALL'),
    queryFn: async ({ signal }) => {
      const res = await fetch(endpoint, { signal });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to load facilities');
      }
      return res.json();
    },
    enabled: Boolean(shouldRender && targetSourceType),
    staleTime: 10 * 60_000,
    gcTime: 30 * 60_000,
  });

  const sources: ProcurementSourceItem[] = useMemo(() => {
    const data = sourcesQuery.data;
    if (!data) return [];
    if (Array.isArray(data)) return data;
    if (Array.isArray(data.zmccs)) return data.zmccs;
    if (Array.isArray(data.sources)) return data.sources;
    return [];
  }, [sourcesQuery.data]);

  const loading = sourcesQuery.isPending;
  const error = sourcesQuery.error instanceof Error
    ? sourcesQuery.error.message
    : sourcesQuery.error
    ? 'Failed to fetch facilities'
    : null;

  // Currently selected source item
  const selectedSource = useMemo(() => {
    if (!currentZmccIdFromUrl) return null;
    return sources.find((s) => s.id === currentZmccIdFromUrl) ?? null;
  }, [sources, currentZmccIdFromUrl]);

  // Synchronize onSourceChanged safely without re-render loop
  const lastNotifiedSourceIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (currentZmccIdFromUrl && sources.length > 0) {
      const matched = sources.find((s) => s.id === currentZmccIdFromUrl);
      if (matched && matched.id !== lastNotifiedSourceIdRef.current) {
        lastNotifiedSourceIdRef.current = matched.id;
        onSourceChanged?.(matched);
      }
    }
  }, [currentZmccIdFromUrl, sources, onSourceChanged]);

  const handleSelectSource = useCallback(
    (source: ProcurementSourceItem) => {
      setModalOverride(false);
      if (onSourceChanged) {
        onSourceChanged(source);
      }

      // Update URL with persisted ?zmccId=...
      const currentParams = new URLSearchParams(searchParams ? searchParams.toString() : '');
      const paramKey = targetSourceType === 'CONTRACTOR' ? 'sourceId' : 'zmccId';
      currentParams.set(paramKey, source.id);
      // Remove deprecated key if exists
      if (paramKey === 'zmccId') {
        currentParams.delete('zmcc_id');
      }

      router.replace(`${pathname}?${currentParams.toString()}`);
    },
    [searchParams, targetSourceType, pathname, router, onSourceChanged]
  );

  const filteredSources = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return sources;
    return sources.filter(
      (s) => s.name.toLowerCase().includes(q) || s.code.toLowerCase().includes(q)
    );
  }, [sources, searchQuery]);

  if (!shouldRender) {
    return null;
  }

  // Derive isOpen declaratively: if user interacted, respect override; otherwise prompt when no source bound
  const isOpen = modalOverride !== null ? modalOverride : !currentZmccIdFromUrl;

  const isContractor = targetSourceType === 'CONTRACTOR';
  const entityName = isContractor ? 'Contractor' : 'ZMCC';
  const displayLabel = selectedSource ? selectedSource.name : `Select ${entityName}`;

  return (
    <>
      {/* Header Trigger Button */}
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setModalOverride(true)}
        aria-label={`Current location: ${displayLabel}. Click to switch.`}
        className="inline-flex min-h-11 items-center gap-1.5 rounded-md border border-border bg-card hover:bg-muted/80 px-2.5 py-1 text-xs font-medium text-foreground transition-colors cursor-pointer shadow-2xs max-w-[200px]"
      >
        <MapPin className="h-3.5 w-3.5 text-primary shrink-0" aria-hidden="true" />
        <span className="truncate">{displayLabel}</span>
        <span className="text-[10px] text-muted-foreground font-normal shrink-0">(Change)</span>
        <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" aria-hidden="true" />
      </button>

      {/* Searchable Modal */}
      {!renderTriggerOnly && isOpen && (
        <Modal
          showHeader
          onClose={() => setModalOverride(false)}
          title={`Select ${entityName} Station Location`}
          description={`Select which ${entityName} facility you are operating or covering as ${delegation.subordinateRoleLabel}.`}
        >
          <div className="space-y-4 pt-1">
            {/* Search Input */}
            <div className="relative">
              <Search
                className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={`Search ${entityName} by name or code…`}
                className="pl-9 text-sm"
                autoFocus
              />
            </div>

            {/* Error Message */}
            {error && (
              <div className="flex items-center gap-2 rounded-md bg-destructive/10 p-3 text-xs text-destructive">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {/* List */}
            <div className="max-h-64 overflow-y-auto divide-y rounded-md border scrollbar-thin">
              {loading ? (
                <div className="flex flex-col items-center justify-center gap-2 py-8">
                  <Spinner className="h-5 w-5 text-primary" />
                  <span className="text-xs text-muted-foreground">Loading {entityName} locations…</span>
                </div>
              ) : filteredSources.length === 0 ? (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  No {entityName} locations found.
                </div>
              ) : (
                filteredSources.map((source) => {
                  const isCurrent = source.id === currentZmccIdFromUrl;
                  return (
                    <button
                      key={source.id}
                      type="button"
                      onClick={() => handleSelectSource(source)}
                      className={`flex w-full items-center justify-between px-3.5 py-2.5 text-left text-sm transition-colors hover:bg-primary/[0.07] ${
                        isCurrent ? 'bg-primary/[0.07] font-medium text-primary' : 'text-foreground'
                      }`}
                    >
                      <div className="min-w-0 pr-2">
                        <p className="truncate font-medium">{source.name}</p>
                        <p className="truncate text-xs text-muted-foreground">{source.code}</p>
                      </div>
                      {isCurrent ? (
                        <Check className="h-4 w-4 text-primary shrink-0" aria-hidden="true" />
                      ) : null}
                    </button>
                  );
                })
              )}
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => setModalOverride(false)}
                className="min-h-11 rounded-md border border-border bg-card px-3.5 py-1.5 text-xs font-medium text-foreground hover:bg-muted transition-colors cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
};
